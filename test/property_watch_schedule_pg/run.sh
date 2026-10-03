#!/usr/bin/env bash
# Executable suite for the Watch's schedule and its monitor check (docs/property-watch-schedule.sql) against a DISPOSABLE Postgres (never production).
# It stands on the REAL watch layer (docs/property-watch.sql) and the real layers beneath it, applied unmutated, plus stand-ins for pg_cron, pg_net,
# the vault and the monitor (the fixtures say what each reproduces).
# 1. the shipped SQL passes every check of suite.sql; 2. it applies twice with an identical result, and re-applying RE-ARMS a job someone
# deactivated; 3. its rollback restores the monitor byte for byte, unschedules the job, drops the two functions and leaves every watch alone;
# 4. it REFUSES, changing nothing, when what it stands on is missing (the watch layer, the monitor's splice anchor, the vault secret);
# 5. each prohibited mutation fails >= 1 check. A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
if [ -n "${SUPABASE_DB_URL:-}${SUPABASE_ACCESS_TOKEN:-}${SUPABASE_WRITE_KEY:-}" ]; then echo "ABORT: a Supabase credential is present"; exit 1; fi
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
SQL="${SCHEDULE_SQL:-$root/docs/property-watch-schedule.sql}"
WATCH="$root/docs/property-watch.sql"
DEPS=(brokerage-account-spine report-private-context report-snapshot evaluation-entitlement saved-reports)

reset_db() { P -c "drop schema if exists auth cascade; drop schema public cascade; create schema public; drop schema if exists cron cascade; drop schema if exists net cascade; drop schema if exists vault cascade;" >/dev/null 2>&1
             P -f "$root/test/evaluation_entitlement_pg/fixture.sql" >/dev/null; }
apply_deps() { local dep; for dep in "${DEPS[@]}"; do P -f "$root/docs/$dep.sql" >/dev/null 2>&1 || { echo "FAIL - docs/$dep.sql does not apply"; exit 1; }; done; }
stand_ins() { P -f "$here/fixture_cron.sql" >/dev/null; P -f "$here/fixture_net_vault.sql" >/dev/null; P -f "$here/fixture_monitor.sql" >/dev/null; }
seed_secret() { Q "insert into vault.decrypted_secrets values ('signup_hook_secret', 'S3CR3T-vault-value')" >/dev/null; }
apply_base() { reset_db; apply_deps
               P -f "$WATCH" >/dev/null 2>&1 || { echo "FAIL - docs/property-watch.sql does not apply"; exit 1; }
               stand_ins; seed_secret; }
# the whole file is ONE transaction, as a migration runs it
apply_file() { P -1 -f "$1" >/dev/null 2>"$tmp/err"; }
# everything the file changes: the monitor, the two functions and their grants, the job (without its id)
fp() { Q "select md5(
   coalesce(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure), '')
|| coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname collate \"C\") from pg_proc p where p.proname in ('property_watch_run_scheduled', 'property_watch_job_health')), '')
|| coalesce((select string_agg(jobname || '|' || schedule || '|' || command || '|' || active::text, ',' order by jobname collate \"C\") from cron.job), ''))"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }
emit() { printf '%s|%s|%s\n' "$1" "$2" "${3:-}"; }
tf() { if [ "$2" = "$3" ]; then emit "$1" t "$2"; else emit "$1" f "got [$2] want [$3]"; fi; }

# every check for the SQL file given: the disposable-database suite, then the file-level properties
checks() {
  local f="$1" stub_md5 fp1 fp2
  apply_base
  stub_md5="$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")"
  if ! apply_file "$f"; then emit 'apply' f "the SQL does not apply: $(tr '\n' ' ' <"$tmp/err" | head -c 300)"; return 0; fi
  # the suite changes the monitor's inputs but never its definition; the file-level checks below start from a clean apply.
  # A suite that ERRORS names no check, so it is reported as a CRASH (never as a kill): the regression would be caught by accident.
  local sout
  if sout="$(P -tA -F'|' -f "$here/suite.sql" 2>&1)"; then printf '%s\n' "$sout"; else emit 'CRASH' f "the suite errored instead of failing a named check: $(printf '%s' "$sout" | tr '\n' ' ' | head -c 240)"; fi

  apply_base; apply_file "$f" || true
  fp1="$(fp)"
  if apply_file "$f"; then fp2="$(fp)"; else fp2="re-apply refused: $(tr '\n' ' ' <"$tmp/err" | head -c 200)"; fi
  tf 'A01 applying the file a second time changes nothing (monitor, the two functions, grants, job)' "$([ "$fp1" = "$fp2" ] && echo same || echo "$fp1 vs $fp2")" 'same'
  tf 'A02 a second apply leaves ONE job, and the monitor carries the check ONCE' "$(Q "select (select count(*) from cron.job where jobname = 'property-watch-run') || '/' || ((length(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure)) - length(replace(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure), '>>> property_watch_run (begin)', ''))) / length('>>> property_watch_run (begin)'))")" '1/1'

  Q "update cron.job set active = false where jobname = 'property-watch-run'" >/dev/null
  apply_file "$f" || true
  tf 'A03 re-applying the file RE-ARMS a job someone deactivated (arming is the job of this file, so a stale off-switch cannot outlive it)' "$(Q "select active from cron.job where jobname = 'property-watch-run'")" 't'
  Q "update cron.job set schedule = '0 0 1 1 *' where jobname = 'property-watch-run'" >/dev/null
  apply_file "$f" || true
  tf 'A04 and puts a changed schedule back' "$(Q "select schedule from cron.job where jobname = 'property-watch-run'")" '3,13,23,33,43,53 * * * *'

  P -1 >/dev/null 2>"$tmp/err" <<<"$(rollback_sql "$f")" || true
  tf 'R01 the rollback restores the monitor BYTE FOR BYTE' "$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")" "$stub_md5"
  tf 'R02 the rollback unschedules the job' "$(Q "select count(*) from cron.job where jobname = 'property-watch-run'")" '0'
  tf 'R03 the rollback drops both functions' "$(Q "select count(*) from pg_proc where proname in ('property_watch_run_scheduled', 'property_watch_job_health')")" '0'
  # The disposable database holds no watch here (the population lives in suite.sql), so "no watch changed" is shown on the rollback's TEXT: it
  # contains no statement that writes, deletes or drops anything of the watch layer. A positive control: the same scan finds the delete in the
  # watch layer's own rollback, so the scan can see one.
  tf 'R04 the rollback touches no watch: its text has no insert, update, delete, truncate or table drop (a positive control: the watch layer''s own rollback does)' \
     "$(grep -Eic '\b(insert|update|delete|truncate|drop table)\b' <<<"$(rollback_sql "$f")")/$(grep -Eic '\b(delete from|drop table)\b' <<<"$(rollback_sql "$WATCH")")" '0/3'
  if apply_file "$f"; then fp2="$(fp)"; else fp2="re-apply after rollback refused"; fi
  tf 'R05 re-applying after a rollback gives exactly the first apply' "$([ "$fp1" = "$fp2" ] && echo same || echo different)" 'same'
  # the rollback is repeatable
  P -1 >/dev/null 2>"$tmp/err" <<<"$(rollback_sql "$f")" || true
  tf 'R06 the rollback is safe to run twice' "$(P -1 >/dev/null 2>&1 <<<"$(rollback_sql "$f")" && echo ok || echo failed)" 'ok'

  # fails closed: without the watch layer, nothing is scheduled and nothing is spliced
  reset_db; apply_deps; stand_ins; seed_secret
  stub_md5="$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")"
  if apply_file "$f"; then emit 'N01 without the watch layer the file is REFUSED' f 'it applied'
  else tf 'N01 without the watch layer the file is REFUSED, naming it' "$(grep -c 'docs/property-watch.sql is not applied' "$tmp/err")" '1'; fi
  tf 'N02 the refusal armed nothing and spliced nothing' "$(Q "select (select count(*) from cron.job) || '/' || (select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure)) = '$stub_md5')")" '0/true'

  # fails closed: a monitor with no single anchor cannot carry the alarm, so the job must not be armed
  apply_base
  P >/dev/null <<'SQL'
create or replace function public.pipeline_health_tick() returns table(result_check text, result_ok boolean, result_detail text)
language plpgsql as $f$ begin return; end $f$;
SQL
  if apply_file "$f"; then emit 'N03 a monitor with no splice anchor is REFUSED' f 'it applied'
  else tf 'N03 a monitor with no splice anchor is REFUSED, before anything is armed' "$(grep -c 'no single splice anchor' "$tmp/err")" '1'; fi
  tf 'N04 that refusal armed nothing and created neither function' "$(Q "select (select count(*) from cron.job) || '/' || (select count(*) from pg_proc where proname in ('property_watch_run_scheduled', 'property_watch_job_health'))")" '0/0'

  # fails closed: no scheduler secret in the vault, so the job could not authenticate
  for why in absent empty blank; do
    apply_base
    case "$why" in absent) Q "delete from vault.decrypted_secrets" >/dev/null;; empty) Q "update vault.decrypted_secrets set decrypted_secret = ''" >/dev/null;; blank) Q "update vault.decrypted_secrets set decrypted_secret = '  '" >/dev/null;; esac
    if apply_file "$f"; then emit "N05 vault secret ($why) is REFUSED" f 'it applied'
    else tf "N05 a vault secret that is $why is REFUSED, saying so, with nothing armed" "$(grep -c 'signup_hook_secret is missing or empty' "$tmp/err")/$(Q "select count(*) from cron.job")" '1/0'; fi
  done
}

fails_of() { grep -c '|f|' <<<"$1" || true; }

out="$(checks "$SQL")"; echo "$out" | sed 's/^/  /' | cut -c1-230
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 40 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL - the shipped watch schedule does not pass"; exit 1; fi

[ -z "${ONLY_SHIPPED:-}" ] || exit 0
status=0
while IFS= read -r name; do
  if [ -n "${MUTATION_FILTER:-}" ] && ! [[ "$name" =~ $MUTATION_FILTER ]]; then continue; fi
  mutated="$tmp/mutated.sql"
  python3 "$here/mutate.py" "$name" "$SQL" >"$mutated" || { echo "HARNESS $name - anchor missing"; status=1; continue; }
  out="$(checks "$mutated" 2>&1)" || out="$out
suite errored|f|"
  if grep -q '^apply|f|' <<<"$out"; then echo "HARNESS  $name - the mutated SQL did not apply"; status=1; continue; fi
  if grep -q '^CRASH|f|' <<<"$out"; then echo "CRASHED  $name - the suite errored instead of failing a named check:"; { grep '^CRASH|f|' <<<"$out" || true; } | cut -c1-200 | sed -n '1,2s/^/    /p'; status=1; continue; fi
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    # first four failures. NOT `| head -4`: under pipefail head exits early, cut dies with "Broken pipe" (measured on the F2 harness).
    echo "KILLED   $name - $n_fail check(s) failed:"; { grep '|f|' <<<"$out" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
  else
    echo "SURVIVED $name - the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
