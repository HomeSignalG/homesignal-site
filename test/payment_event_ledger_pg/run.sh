#!/usr/bin/env bash
# Executable suite for the payment-event ledger (docs/payment-event-ledger.sql) against a DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. it applies twice with an identical result;
# 3. its ROLLBACK block removes every object it made, leaves the stand-in subscriptions table untouched, and re-applies to
#    an identical result; 4. two CONCURRENT sessions: a retry race on one key records once, and an older event racing a newer
#    one is not reported as the latest; 5. each prohibited mutation fails >= 1 check (mutations named rollback_* are judged by
#    step 3, race_* by step 4, every other by the suite).
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present; this suite only ever addresses the disposable database."; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
reset_db() { P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$here/fixture.sql" >/dev/null; }
apply_file() { P -f "$1" >/dev/null 2>&1; }
apply_base() { reset_db; apply_file "$1"; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
SQL="$root/docs/payment-event-ledger.sql"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

# the definition a second apply (or a re-apply after a rollback) must leave exactly as a fresh install has it
fp() { P -tA -c "select md5(
    coalesce((select string_agg(column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-') || ':' || coalesce(generation_expression, '-'), ',' order by column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name = 'payment_event'), '')
  || coalesce((select string_agg(conname || ':' || pg_get_constraintdef(oid), ',' order by conname collate \"C\") from pg_constraint where conrelid = 'public.payment_event'::regclass), '')
  || coalesce((select string_agg(pg_get_functiondef(p.oid), ',' order by p.proname collate \"C\") from pg_proc p where p.proname like 'payment\\_event\\_%'), '')
  || coalesce((select string_agg(a.proname || coalesce(a.proacl::text, ''), ',' order by a.proname collate \"C\") from pg_proc a where a.proname like 'payment\\_event\\_%'), '')
  || coalesce((select relacl::text from pg_class where oid = 'public.payment_event'::regclass), '')
  || coalesce((select relrowsecurity::text from pg_class where oid = 'public.payment_event'::regclass), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where tgrelid = 'public.payment_event'::regclass and not tgisinternal), '')
  || coalesce((select string_agg(indexdef, ',' order by indexname collate \"C\") from pg_indexes where tablename = 'payment_event'), ''))"; }

rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }

# Step 3 for one candidate file. Prints what failed; returns non-zero if anything did (3 = the harness itself could not run it).
rollback_checks() {
  local f="$1" bad=0 fresh after left subs_before subs_after rb
  apply_base "$f" || { echo "  HARNESS — the file does not apply to an empty database"; return 3; }
  fresh="$(fp)"
  P -c "select * from public.payment_event_record('{\"processor\":\"lemonsqueezy\",\"idempotency_key\":\"rb-1\",\"subscription_ref\":\"8001\",\"event_name\":\"subscription_created\",\"processor_status\":\"active\",\"occurred_at\":\"2026-10-06T10:00:00Z\",\"livemode\":true}')" >/dev/null 2>&1 \
    || { echo "  HARNESS — could not record an event before the rollback"; return 3; }
  subs_before="$(Q "select md5(string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\")) from pg_trigger where tgrelid = 'public.subscriptions'::regclass and not tgisinternal") $(Q "select count(*) from public.subscriptions")"
  rb="$(rollback_sql "$f")"
  if [ -z "$rb" ]; then echo "  HARNESS — the file carries no ROLLBACK-BEGIN / ROLLBACK-END block"; return 3; fi
  if ! P -1 >/dev/null 2>"$tmp/err" <<<"$rb"; then echo "  R01 the rollback block did not run: $(head -c 200 "$tmp/err" | tr '\n' ' ')"; bad=1; fi
  left="$(Q "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'payment\\_event%') + (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname like 'payment\\_event\\_%') + (select count(*) from pg_type where typnamespace = 'public'::regnamespace and typname like '%payment\\_event%')" 2>/dev/null || echo error)"
  if [ "$left" != "0" ]; then echo "  R02 after the rollback $left object(s) named payment_event remain (tables, indexes, sequences, functions, types)"; bad=1; fi
  subs_after="$(Q "select md5(string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\")) from pg_trigger where tgrelid = 'public.subscriptions'::regclass and not tgisinternal" 2>/dev/null || echo gone) $(Q "select count(*) from public.subscriptions" 2>/dev/null || echo gone)"
  if [ "$subs_before" != "$subs_after" ]; then echo "  R03 the rollback touched the stand-in subscriptions table"; bad=1; fi
  if ! apply_file "$f"; then echo "  R04 the file does not re-apply after its own rollback"; return 1; fi
  after="$(fp)"
  if [ "$fresh" != "$after" ]; then echo "  R05 re-applying after the rollback does not reproduce the fresh definition"; bad=1; fi
  return $bad
}

# Step 4 for one candidate file: two real concurrent sessions. A records and then HOLDS ITS TRANSACTION OPEN for 2.5 s; B starts
# only once A is observed sleeping inside that transaction (so the overlap is real, not hoped for) and must wait behind it.
wait_for_sleeper() {
  local i
  for i in $(seq 1 100); do
    if [ "$(Q "select count(*) from pg_stat_activity where state = 'active' and query like '%pg_sleep(2.5)%' and pid <> pg_backend_pid()")" -ge 1 ]; then return 0; fi
    sleep 0.1
  done
  return 1
}
now_ms() { echo $(( $(date +%s%N) / 1000000 )); }
race_checks() {
  local f="$1" bad=0 pid t0 t1 ra rb ms n latest e_new e_old
  apply_base "$f" || { echo "  HARNESS — the file does not apply to an empty database"; return 3; }
  # R1 — the same key from two sessions at once (a webhook retry racing the original)
  e_new='{"processor":"lemonsqueezy","idempotency_key":"race-1","subscription_ref":"7001","event_name":"subscription_updated","processor_status":"active","occurred_at":"2026-10-06T15:00:00Z","livemode":true}'
  P -1 -tA -c "select outcome || ':' || is_latest from public.payment_event_record('$e_new'::jsonb)" -c "select pg_sleep(2.5)" >"$tmp/ra" 2>&1 &
  pid=$!
  if ! wait_for_sleeper; then wait "$pid" || true; echo "  HARNESS — session A never reached its open transaction"; return 3; fi
  t0="$(now_ms)"
  rb="$(P -tA -c "select outcome || ':' || is_latest from public.payment_event_record('$e_new'::jsonb)" 2>&1 || true)"
  t1="$(now_ms)"
  wait "$pid" || true
  ra="$(grep -E 'RECORDED|DUPLICATE' "$tmp/ra" | head -1 || true)"
  ms=$(( t1 - t0 )); n="$(Q "select count(*) from public.payment_event")"
  if [ "$ra" != "RECORDED:true" ] || [ "$rb" != "DUPLICATE:true" ]; then echo "  R1 the same key from two sessions: wanted RECORDED:true then DUPLICATE:true, got '$ra' and '$rb'"; bad=1; fi
  if [ "$n" != "1" ]; then echo "  R1b the same key from two sessions stored $n rows, not 1"; bad=1; fi
  if [ "$ms" -lt 1000 ]; then echo "  R1c the second session did not wait behind the first (${ms} ms): the race was not real"; bad=1; fi
  # R2 — an OLDER event racing a NEWER one for the same subscription: the older one must not be reported as the latest
  e_new='{"processor":"lemonsqueezy","idempotency_key":"race-new","subscription_ref":"7002","event_name":"subscription_updated","processor_status":"active","occurred_at":"2026-10-06T15:00:00Z","livemode":true}'
  e_old='{"processor":"lemonsqueezy","idempotency_key":"race-old","subscription_ref":"7002","event_name":"subscription_created","processor_status":"on_trial","occurred_at":"2026-10-06T14:00:00Z","livemode":true}'
  P -1 -tA -c "select outcome || ':' || is_latest from public.payment_event_record('$e_new'::jsonb)" -c "select pg_sleep(2.5)" >"$tmp/ra" 2>&1 &
  pid=$!
  if ! wait_for_sleeper; then wait "$pid" || true; echo "  HARNESS — session A never reached its open transaction (R2)"; return 3; fi
  t0="$(now_ms)"
  rb="$(P -tA -c "select outcome || ':' || is_latest from public.payment_event_record('$e_old'::jsonb)" 2>&1 || true)"
  t1="$(now_ms)"
  wait "$pid" || true
  ra="$(grep -E 'RECORDED|DUPLICATE' "$tmp/ra" | head -1 || true)"
  ms=$(( t1 - t0 )); n="$(Q "select count(*) from public.payment_event where subscription_ref = '7002'")"
  latest="$(Q "select idempotency_key from public.payment_event where event_id = public.payment_event_latest_id('lemonsqueezy', true, '7002')")"
  if [ "$ra" != "RECORDED:true" ] || [ "$rb" != "RECORDED:false" ]; then echo "  R2 older event racing a newer one: wanted RECORDED:true (newer) and RECORDED:false (older), got '$ra' and '$rb'"; bad=1; fi
  if [ "$n" != "2" ] || [ "$latest" != "race-new" ]; then echo "  R2b after the race: $n rows for the subscription (wanted 2), latest is '$latest' (wanted race-new)"; bad=1; fi
  if [ "$ms" -lt 1000 ]; then echo "  R2c the older event's session did not wait behind the newer one's (${ms} ms): the race was not real"; bad=1; fi
  return $bad
}

apply_base "$SQL" || { echo "FAIL — the SQL of record does not apply"; exit 1; }
fp1="$(fp)"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 50 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped ledger does not pass"; exit 1; fi

# applying the file a second time must be a no-op (idempotent): same columns, constraints, functions, grants, triggers, indexes
apply_file "$SQL" || { echo "FAIL — the SQL of record is not idempotent (the second apply failed)"; exit 1; }
fp2="$(fp)"
if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then echo "FAIL — a second apply changed the definition ($fp1 vs $fp2)"; exit 1; fi
echo "APPLIED TWICE with an identical definition"

if rollback_checks "$SQL"; then
  echo "ROLLED BACK every object, left the subscriptions stand-in untouched, and re-applied to an identical definition"
else
  echo "FAIL — the rollback"; exit 1
fi

if race_checks "$SQL"; then
  echo "RACED: a retry on one key recorded once, and an older event racing a newer one was not reported as the latest"
else
  echo "FAIL — the concurrent-session checks"; exit 1
fi

status=0
mfile="$tmp/mutated.sql"
while IFS= read -r name; do
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  printf '%s\n' "$mutated" > "$mfile"
  case "$name" in
    rollback_*)
      rc=0; msg="$(rollback_checks "$mfile" 2>&1)" || rc=$?
      if [ "$rc" -eq 3 ]; then echo "HARNESS  $name — $msg"; status=1
      elif [ "$rc" -ne 0 ]; then echo "KILLED   $name — the rollback checks failed:"; echo "$msg" | sed 's/^/    /' | sed -n '1,3p'
      else echo "SURVIVED $name — the rollback checks cannot see this regression"; status=1; fi
      continue;;
    race_*)
      rc=0; msg="$(race_checks "$mfile" 2>&1)" || rc=$?
      if [ "$rc" -eq 3 ]; then echo "HARNESS  $name — $msg"; status=1
      elif [ "$rc" -ne 0 ]; then echo "KILLED   $name — the concurrent-session checks failed:"; echo "$msg" | sed 's/^/    /' | sed -n '1,3p'
      else echo "SURVIVED $name — the concurrent-session checks cannot see this regression"; status=1; fi
      continue;;
  esac
  if ! apply_base "$mfile"; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  # a mutation that makes the suite ERROR is caught too: an error is a failed check
  out="$(suite 2>&1)" || out="$out
suite errored|f|"
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    # print the first four failures. NOT `| head -4`: under pipefail, head exits after four lines while cut is still writing,
    # cut dies with "Broken pipe", and the run ends. `sed -n 1,4p` reads to the end, so nothing upstream is ever cut off.
    echo "KILLED   $name — $n_fail check(s) failed:"; { grep '|f|' <<<"$out" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base "$SQL"
exit $status
