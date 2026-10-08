#!/usr/bin/env bash
# Executable suite for Property Watch (docs/property-watch.sql) against a DISPOSABLE Postgres (never production).
# It stands on the REAL account spine, private context, snapshot, evaluation entitlement and saved-reports functions, applied unmutated.
# 1. the shipped SQL passes every check of suite.sql, and applying it changes NOTHING about the layers it stands on;
# 2. REAL concurrent sessions: two callers racing for a brokerage's last place under the limit of 25 - exactly one wins and the other is
#    refused WATCH_LIMIT_REACHED; two callers starting the SAME watch at once make ONE; a start under REPEATABLE READ is refused (55000); and
#    two job runs claiming at once take DISJOINT watches (SKIP LOCKED);
# 3. it applies twice with an identical result;
# 4. its ROLLBACK (the footer of the file, extracted and run) removes the two tables and sixteen functions it created, with watches stored,
#    CLOSES every follow need it opened, leaves everything beneath it exactly as it was, and re-applying gives exactly the first apply;
# 5. it REFUSES, creating nothing, when a layer it stands on is absent;
# 6. each prohibited mutation fails >= 1 NAMED check (of suite.sql or of the scenarios above). A mutation that makes the suite CRASH does
#    not count as killed: a crash names nothing, so it is reported and fails the run. A mutation whose anchor is missing is a harness failure.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
SQL="${WATCH_SQL:-$root/docs/property-watch.sql}"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports)
reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public;" >/dev/null 2>&1; P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null; }
apply_deps() {
  for f in "${DEPS[@]}"; do P -f "$root/docs/$f.sql" >/dev/null 2>&1 || { echo "FAIL - docs/$f.sql does not apply"; exit 1; }; done
}
apply_base() { reset_db; apply_deps; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }

FN="(p.proname like 'property\\_watch%' or p.proname like 'evaluation\\_property\\_watch%')"
# the definition and privileges of this file's functions, and the shape of its two tables (columns, constraints, triggers)
fp_mine() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name like 'property\\_watch%'), '')
  || coalesce((select string_agg(conrelid::regclass::text || ':' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\") from pg_constraint where conrelid in ('public.property_watch'::regclass, 'public.property_watch_seen'::regclass)), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where not tgisinternal and tgrelid = 'public.property_watch'::regclass), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'property\\_watch%' and c.relkind = 'r'), ''))"; }
# everything this file stands on and must not touch: every OTHER function in public (with its privileges), every other table's columns and privileges, every other trigger
fp_deps() { P -tA -c "select md5(
    coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.oid::regprocedure::text collate \"C\")
                from pg_proc p where p.pronamespace = 'public'::regnamespace and not $FN), '')
  || coalesce((select string_agg(table_name || ':' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '-'), ',' order by table_name collate \"C\", column_name collate \"C\")
                from information_schema.columns where table_schema = 'public' and table_name not like 'property\\_watch%'), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, '') || c.relrowsecurity::text, ',' order by c.relname collate \"C\") from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname not like 'property\\_watch%'), '')
  || coalesce((select string_agg(pg_get_triggerdef(oid), ',' order by tgname collate \"C\") from pg_trigger where not tgisinternal and tgrelid not in (select oid from pg_class where relname like 'property\\_watch%')), ''))"; }
n_mine() { P -tA -c "select (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and $FN) + (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname like 'property\\_watch%' and relkind = 'r')"; }

# ---- the real-session scenarios (they build their own population) ---------------------------------------------------------
U8='a0000000-0000-4000-8000-000000000008'; U9='a0000000-0000-4000-8000-000000000009'; U12='a0000000-0000-4000-8000-000000000012'
fox_report() { P -tA -c "select c.report_id from public.evaluation_credit c join public.evaluation e on e.evaluation_id = c.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Fox Company' and c.ordinal = $1"; }
scenarios() {
  P -c "delete from public.property_watch" >/dev/null
  # Fox: the owner watches 10 reports, one agent 10 and a second agent 4: 24 of the 25 places are taken
  P -c "do \$\$ declare n int; r uuid; begin
          for n in 1..10 loop select c.report_id into r from public.evaluation_credit c join public.evaluation e on e.evaluation_id = c.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Fox Company' and c.ordinal = n;
            perform public.evaluation_property_watch_start('$U8', r); end loop;
          for n in 1..10 loop select c.report_id into r from public.evaluation_credit c join public.evaluation e on e.evaluation_id = c.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Fox Company' and c.ordinal = n;
            perform public.evaluation_property_watch_start('$U9', r); end loop;
          for n in 1..4 loop select c.report_id into r from public.evaluation_credit c join public.evaluation e on e.evaluation_id = c.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Fox Company' and c.ordinal = n;
            perform public.evaluation_property_watch_start('$U12', r); end loop; end \$\$" >/dev/null
  local r5 r6 r7 r8; r5="$(fox_report 5)"; r6="$(fox_report 6)"; r7="$(fox_report 7)"; r8="$(fox_report 8)"
  local o1 o2; o1="$(mktemp)"; o2="$(mktemp)"
  # session 1 takes the 25th place and holds its transaction open; session 2 asks for a different report while that is uncommitted
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select 'won' from public.evaluation_property_watch_start('$U12', '$r5');
select pg_sleep(2.5);
commit;
SQL
  ) &
  local bg=$!
  sleep 0.8
  P -tA -c "select 'won' from public.evaluation_property_watch_start('$U12', '$r6')" >"$o2" 2>&1 || true
  wait "$bg" || true
  local total w1 w2; total="$(P -tA -c "select count(*) from public.property_watch")"
  w1="$(grep -c '^won$' "$o1" || true)"; w2="$(grep -c '^won$' "$o2" || true)"
  if [ "$w1" = "1" ] && [ "$w2" = "0" ] && grep -q 'WATCH_LIMIT_REACHED' "$o2" && [ "$total" = "25" ]; then
    echo "RACE|t|two callers raced for the 25th place: one won, the other was refused WATCH_LIMIT_REACHED, and the brokerage holds exactly 25 ($total)"
  else
    echo "RACE|f|won=$w1/$w2 total=$total; second session said: $(tr '\n' ' ' <"$o2" | cut -c1-160)"
  fi
  rm -f "$o1" "$o2"
  # make room for one, then two sessions start the SAME watch at once: there is ONE row, and the second is told it was already watching
  P -c "select public.evaluation_property_watch_stop('$U12', (select watch_id from public.property_watch where user_id = '$U12' and report_id = '$r5'))" >/dev/null
  o1="$(mktemp)"; o2="$(mktemp)"
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select 'started=' || started from public.evaluation_property_watch_start('$U12', '$r7');
select pg_sleep(2.5);
commit;
SQL
  ) &
  bg=$!
  sleep 0.8
  P -tA -c "select 'started=' || started from public.evaluation_property_watch_start('$U12', '$r7')" >"$o2" 2>&1 || true
  wait "$bg" || true
  local rows; rows="$(P -tA -c "select count(*) from public.property_watch where user_id = '$U12' and report_id = '$r7'")"
  if grep -q '^started=true$' "$o1" && grep -q '^started=false$' "$o2" && [ "$rows" = "1" ]; then
    echo "SAME_WATCH|t|two sessions started the same watch at once: one made it, the other was told it was already watching, and there is one row"
  else
    echo "SAME_WATCH|f|rows=$rows; first said: $(tr '\n' ' ' <"$o1" | cut -c1-100); second said: $(tr '\n' ' ' <"$o2" | cut -c1-100)"
  fi
  rm -f "$o1" "$o2"
  # at REPEATABLE READ the count could be taken on a stale snapshot: the function refuses instead
  local before rc after; before="$(P -tA -c "select count(*) from public.property_watch")"
  rc="$(psql -X -q -v ON_ERROR_STOP=0 -v VERBOSITY=verbose -tA 2>&1 <<SQL
begin isolation level repeatable read;
select * from public.evaluation_property_watch_start('$U12', '$r8');
rollback;
SQL
)"
  after="$(P -tA -c "select count(*) from public.property_watch")"
  if grep -q '55000' <<<"$rc" && grep -q 'READ COMMITTED' <<<"$rc" && [ "$after" = "$before" ]; then
    echo "REPEATABLE_READ|t|a start under REPEATABLE READ is refused (55000) and stores nothing"
  else
    echo "REPEATABLE_READ|f|after=$after before=$before; said: $(tr '\n' ' ' <<<"$rc" | cut -c1-160)"
  fi
  # two job runs claim at the same moment: they take DISJOINT watches (the second skips what the first holds rather than waiting for it)
  P -c "update public.property_watch set next_due_at = now() - interval '1 hour', lease_until = null, retry_after = null" >/dev/null
  o1="$(mktemp)"; o2="$(mktemp)"
  ( P -tA -f - >"$o1" 2>&1 <<SQL
begin;
select watch_id from public.property_watch_claim(10);
select pg_sleep(4);
commit;
SQL
  ) &
  bg=$!
  sleep 0.8
  local t0 t1 waited_ms; t0="$(date +%s%N)"
  P -tA -c "select watch_id from public.property_watch_claim(10)" >"$o2" 2>&1 || true
  t1="$(date +%s%N)"; waited_ms=$(( (t1 - t0) / 1000000 ))
  wait "$bg" || true
  local c1 c2 both leased
  c1="$(grep -Ec '^[0-9a-f-]{36}$' "$o1" || true)"; c2="$(grep -Ec '^[0-9a-f-]{36}$' "$o2" || true)"
  both="$(sort "$o1" "$o2" | grep -E '^[0-9a-f-]{36}$' | sort | uniq -d | wc -l)"
  leased="$(P -tA -c "select count(*) from public.property_watch where lease_until > now()")"
  # The outcome alone cannot tell SKIP LOCKED from a plain row lock: a second run that WAITS for the first run's uncommitted claim also ends
  # up with disjoint watches (it re-reads the rows once they are leased). What differs is the time: the first run holds its claim for 4 seconds
  # from before the second starts, so a second run that waited could not return in under 3. It must return at once.
  if [ "$c1" = "10" ] && [ "$c2" = "10" ] && [ "$both" = "0" ] && [ "$leased" = "20" ] && [ "$waited_ms" -lt 2000 ]; then
    echo "CLAIM|t|two job runs claimed at once: ten watches each, none in common, exactly twenty are leased, and the second did not wait for the first (${waited_ms} ms while the first held its claim for 4 s)"
  else
    echo "CLAIM|f|first=$c1 second=$c2 in-common=$both leased=$leased second-waited=${waited_ms}ms; second said: $(tr '\n' ' ' <"$o2" | cut -c1-120)"
  fi
  rm -f "$o1" "$o2"
}

# ---- 1. the shipped SQL passes, and touches nothing it depends on ----------------------------------------------------------------
apply_base
dep0="$(fp_deps)"
[ "$(n_mine)" = "0" ] || { echo "FAIL - the watch objects exist before the file is applied"; exit 1; }
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record does not apply"; exit 1; }
dep1="$(fp_deps)"; mine1="$(fp_mine)"
if [ -z "$dep0" ] || [ "$dep0" != "$dep1" ]; then echo "FAIL - applying the watch file changed something it stands on ($dep0 vs $dep1)"; exit 1; fi
[ "$(n_mine)" = "18" ] || { echo "FAIL - expected 18 objects (16 functions, 2 tables), found $(n_mine)"; exit 1; }
echo "UNTOUCHED - every other function, table, privilege and trigger has an identical definition before and after this file is applied"
out="$(suite)"; echo "$out" | sed 's/^/  /' | cut -c1-230
n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 60 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL - the shipped watch layer does not pass"; exit 1; fi

# ---- 2. real sessions ---------------------------------------------------------------------------------------------------------
sc="$(scenarios)"; echo "$sc" | sed 's/^/  /'
if [ "$(grep -c '|t|' <<<"$sc" || true)" -ne 4 ] || grep -q '|f|' <<<"$sc"; then echo "FAIL - the real-session scenarios do not pass"; exit 1; fi

# ---- 3. applying it a second time is a no-op ----------------------------------------------------------------------------------
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record is not idempotent"; exit 1; }
mine2="$(fp_mine)"; dep2="$(fp_deps)"
if [ -z "$mine1" ] || [ "$mine1" != "$mine2" ] || [ "$dep0" != "$dep2" ]; then echo "FAIL - a second apply changed a definition"; exit 1; fi
echo "APPLIED TWICE with an identical definition"

# ---- 4. the rollback, with watches stored ---------------------------------------------------------------------------------------
P -c "select public.property_watch_record_run((select watch_id from public.property_watch order by watch_id limit 1), 'NOTIFIED', '[{\"project_id\":\"proj-rb\",\"event_type\":\"status_changed\",\"observed_at\":\"2026-10-01T02:00:00Z\"}]'::jsonb)" >/dev/null
watches="$(P -tA -c 'select count(*) from public.property_watch')"
seen="$(P -tA -c 'select count(*) from public.property_watch_seen')"
open_before="$(P -tA -c "select count(*) from public.report_private_context_need where kind = 'follow' and closed_at is null")"
needs="$(P -tA -c 'select count(*) from public.report_private_context_need')"
if [ "$watches" -lt 20 ] || [ "$seen" -lt 1 ] || [ "$open_before" -lt 20 ]; then echo "FAIL - the rollback must be proven on a POPULATED database (watches=$watches seen=$seen open needs=$open_before)"; exit 1; fi
rb="$(rollback_sql "$SQL")"
if [ -z "$rb" ] || ! grep -q 'drop table if exists public.property_watch;' <<<"$rb"; then echo "FAIL - no rollback footer was found in the SQL of record"; exit 1; fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL - the rollback does not run"; exit 1; }
if [ "$(n_mine)" != "0" ]; then echo "FAIL - the rollback left some of the watch objects behind"; exit 1; fi
open_after="$(P -tA -c "select count(*) from public.report_private_context_need where kind = 'follow' and closed_at is null")"
if [ "$open_after" != "0" ]; then echo "FAIL - the rollback left $open_after follow needs open: the private layer would keep addresses for watches that no longer exist"; exit 1; fi
if [ "$(P -tA -c 'select count(*) from public.report_private_context_need')" != "$needs" ]; then echo "FAIL - the rollback changed the number of need rows (they are append-only: closed, never removed)"; exit 1; fi
if [ "$(fp_deps)" != "$dep0" ]; then echo "FAIL - the rollback changed a layer beneath it"; exit 1; fi
P -1 >/dev/null 2>&1 <<<"$rb" || { echo "FAIL - the rollback is not repeatable (it must be safe to run twice)"; exit 1; }
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL - the SQL of record does not re-apply after a rollback"; exit 1; }
if [ "$(fp_mine)" != "$mine1" ]; then echo "FAIL - re-applying after a rollback differs from the first apply"; exit 1; fi
echo "ROLLED BACK with $watches watches and $seen told-about rows stored: the 18 objects gone, all $open_before follow needs CLOSED (none open, none removed), every layer beneath untouched, repeatable, and re-applying gives exactly the first apply"

# ---- 5. it refuses, creating nothing, when a layer it stands on is absent ---------------------------------------------------------------
reset_db
for f in brokerage-account-spine report-private-context report-snapshot evaluation-entitlement; do P -f "$root/docs/$f.sql" >/dev/null 2>&1; done
if P -f "$SQL" >/dev/null 2>"$here/.refusal.err"; then rm -f "$here/.refusal.err"; echo "FAIL - the watch file APPLIED without the saved-reports functions"; exit 1; fi
if ! grep -q 'property_watch: apply docs/report-private-context.sql' "$here/.refusal.err" || [ "$(n_mine)" != "0" ]; then
  rm -f "$here/.refusal.err"; echo "FAIL - the refusal without the saved-reports functions did not say why, or left objects behind"; exit 1
fi
rm -f "$here/.refusal.err"
echo "REFUSED without the saved-reports functions, saying why, and creating nothing"

# ---- 6. every prohibited mutation must fail a named check -----------------------------------------------------------------------------------
status=0
tmp="$(mktemp)"; trap 'rm -f "$tmp" "$here/.refusal.err"' EXIT
while IFS= read -r name; do
  if [ -n "${MUTATION_FILTER:-}" ] && ! [[ "$name" =~ $MUTATION_FILTER ]]; then continue; fi
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name - anchor missing"; status=1; continue; }
  printf '%s\n' "$mutated" > "$tmp"
  apply_base
  if ! P -f "$tmp" >/dev/null 2>&1; then echo "HARNESS  $name - the mutated SQL did not apply"; status=1; continue; fi
  crashed=0
  mout="$(suite 2>&1)" || crashed=1
  if [ "$crashed" -eq 1 ]; then
    # a suite that errors names no check: the regression would be caught by accident, so it is not accepted as a kill
    echo "CRASHED  $name - the suite errored instead of failing a named check:"; printf '%s\n' "$mout" | cut -c1-200 | sed -n '1,3s/^/    /p'; status=1; continue
  fi
  mout="$mout"$'\n'"$(scenarios 2>&1)"
  n_fail=$(grep -c '|f|' <<<"$mout" || true)
  if [ "$n_fail" -gt 0 ]; then
    # NOT `| head -4`: under pipefail head exits while cut is still writing and the run ends. `sed -n 1,4p` reads to the end.
    echo "KILLED   $name - $n_fail check(s) failed:"; { grep '|f|' <<<"$mout" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
  else
    echo "SURVIVED $name - the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
