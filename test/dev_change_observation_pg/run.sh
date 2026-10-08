#!/usr/bin/env bash
# Executable suite for the recurring observation job and its alarm (docs/dev-change-observation-schedule.sql)
# against a DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. it applies twice with an identical result; 3. its rollback restores the
# monitor byte for byte, unschedules the job and removes only its own functions; 4. it refuses, changing nothing,
# when what it depends on is missing; 5. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
SQL="$root/docs/dev-change-observation-schedule.sql"

# the ledger WITH option (b), the Order D driver, the reportable view, the pg_cron stand-in and a stand-in monitor.
# $1 = the ledger SQL to apply (the shipped one, or the version applied to production before option (b)).
base_with() {
  P -c "drop schema if exists public cascade; create schema public; drop schema if exists cron cascade;" >/dev/null 2>&1
  P -f "$root/test/dev_change_ledger_pg/fixture.sql" >/dev/null
  P -f "$root/test/dev_change_baseline_pg/fixture.sql" >/dev/null
  P -f "$1" >/dev/null 2>&1 || { echo "FAIL — $1 does not apply"; exit 1; }
  P -f "$root/docs/dev-change-baseline.sql" >/dev/null 2>&1 || { echo "FAIL — docs/dev-change-baseline.sql does not apply"; exit 1; }
  P -f "$root/docs/dev-change-reportable.sql" >/dev/null 2>&1 || { echo "FAIL — docs/dev-change-reportable.sql does not apply"; exit 1; }
  P -f "$root/test/report_private_context_purge_pg/fixture_cron.sql" >/dev/null 2>&1
  P -f "$here/fixture_cron_runs.sql" >/dev/null
  P -f "$root/test/report_private_context_purge_pg/fixture_monitor.sql" >/dev/null
}
apply_base()   { base_with "$root/docs/dev-change-ledger.sql"; }
# the whole file is ONE transaction, as a migration runs it
apply_file()   { P -1 -f "$1" >/dev/null 2>"$tmp/err"; }
# everything the file changes: the monitor, the two functions and their grants, the job (without its id)
fp() { Q "select md5(
   coalesce(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure), '')
|| coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '' order by p.proname collate \"C\") from pg_proc p where p.proname in ('dev_change_observe_scheduled', 'dev_change_observation_health')), '')
|| coalesce((select string_agg(jobname || '|' || schedule || '|' || command || '|' || active::text, ',' order by jobname) from cron.job), ''))"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }
emit() { printf '%s|%s|%s\n' "$1" "$2" "${3:-}"; }
tf() { if [ "$2" = "$3" ]; then emit "$1" t "$2"; else emit "$1" f "got [$2] want [$3]"; fi; }
ledger_fp() { Q "select md5(coalesce((select string_agg(t::text, ',' order by identity_key) from public.dev_change_project t), '')
                  || coalesce((select string_agg(e::text, ',' order by id) from public.dev_change_event e), ''))"; }

# every check for the SQL file given: the disposable-database suite, then the file-level properties
checks() {
  local f="$1" stub_md5 fp1 fp2 before after lb la
  apply_base
  stub_md5="$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")"
  if ! apply_file "$f"; then emit 'apply' f "the SQL does not apply: $(tr '\n' ' ' <"$tmp/err" | head -c 300)"; return 0; fi
  # a suite that CRASHES prints nothing (its results are collected in a temp table and printed last), so a crash is a
  # failure line of its own. Never "no output = no failures" (measured 2026-10-01: two mutations read as surviving).
  if ! P -tA -F'|' -f "$here/suite.sql" 2>"$tmp/suite_err"; then
    emit 'suite' f "the suite CRASHED before printing a single result: $(tr '\n' ' ' <"$tmp/suite_err" | head -c 240)"
  fi

  apply_base; apply_file "$f" || true
  fp1="$(fp)"
  if apply_file "$f"; then fp2="$(fp)"; else fp2="re-apply refused: $(tr '\n' ' ' <"$tmp/err" | head -c 200)"; fi
  tf 'A01 applying the file a second time changes nothing (monitor, both functions, grants, job)' "$([ "$fp1" = "$fp2" ] && echo same || echo "$fp1 vs $fp2")" 'same'
  tf 'A02 a second apply leaves ONE job, not two' "$(Q "select count(*) from cron.job where jobname = 'dev-change-observe'")" '1'
  tf 'A02b the monitor carries the check exactly once after two applies' "$(Q "select (length(d) - length(replace(d, '-- >>> dev_change_observation (begin)', ''))) / length('-- >>> dev_change_observation (begin)') from (select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) d) x")" '1'

  Q "update cron.job set active = false where jobname = 'dev-change-observe'" >/dev/null
  apply_file "$f" || true
  tf 'A03 re-applying the file RE-ARMS a job someone deactivated (arming is the job of this file, so a stale off-switch cannot outlive it)' "$(Q "select active from cron.job where jobname = 'dev-change-observe'")" 't'
  Q "update cron.job set schedule = '* * * * *', command = 'select 1' where jobname = 'dev-change-observe'" >/dev/null
  apply_file "$f" || true
  tf 'A04 re-applying the file puts a tampered schedule and command back' "$(Q "select schedule || '|' || command from cron.job where jobname = 'dev-change-observe'")" '*/5 2-8 * * *|select public.dev_change_observe_scheduled()'

  # a wrapper run leaves ledger rows; the rollback must not touch one
  P -c "insert into public.canonical_zip_registry (zip) values ('92001'); insert into public.app_community_meta (zip) values ('92001');
        insert into public.app_projects (zip, record_kind, source_key, source_key_basis, source_seq, registry_id, name, type, status, stage, date_kind, submitted_at, address, provenance)
        values ('92001', 'development', 'k:rb', 'source_id:case_number', 1, 'fixture-registry', 'Alpha Plaza', 'Commercial', 'Proposed', 'Submitted', 'filed', '2026-08-01', '1 Main St',
                jsonb_build_object('refreshed_at', '2026-09-01T00:00:00.000000+00:00', 'source_vintage', 'fixture'));
        select public.dev_change_tick(public.dev_change_start_run(true, '{}'), 10, 10, 100000, 1000000, 24);
        select public.dev_change_observe_scheduled();" >/dev/null
  lb="$(ledger_fp)"
  P -1 >/dev/null 2>"$tmp/err" <<<"$(rollback_sql "$f")" || true
  la="$(ledger_fp)"
  tf 'R01 the rollback restores the monitor BYTE FOR BYTE' "$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")" "$stub_md5"
  tf 'R02 the rollback unschedules the job' "$(Q "select count(*) from cron.job where jobname = 'dev-change-observe'")" '0'
  tf 'R03 the rollback drops the two functions, and only those' "$(Q "select (select count(*) from pg_proc where proname in ('dev_change_observe_scheduled', 'dev_change_observation_health')) || '/' || (select count(*) from pg_proc where proname in ('dev_change_tick', 'dev_change_observe_zip', 'dev_change_start_run', 'dev_change_finish_run'))")" '0/4'
  tf 'R04 the rollback does not touch a single ledger row (projects and events, including the run it had written)' "$([ "$lb" = "$la" ] && echo same || echo changed)" 'same'
  tf 'R04b the run rows the job made are kept (the ledger is append-only)' "$(Q "select count(*) from public.dev_change_run where detail->>'purpose' = 'scheduled'")" '1'
  apply_file "$f" || true
  if apply_file "$f"; then fp2="$(fp)"; else fp2="re-apply after rollback refused"; fi
  tf 'R05 re-applying after a rollback gives exactly the first apply' "$([ "$fp1" = "$fp2" ] && echo same || echo different)" 'same'

  # fails closed: the ledger as applied to production BEFORE option (b) cannot be scheduled
  base_with "$root/test/dev_change_ledger_pg/as_applied.sql"
  stub_md5="$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")"
  if apply_file "$f"; then emit 'N01 without ledger option (b) the file is REFUSED' f 'it applied'
  else tf 'N01 without ledger option (b) the file is REFUSED, naming it' "$(grep -c 'option (b) (the copy-conflict hold) is not applied' "$tmp/err")" '1'; fi
  tf 'N02 that refusal armed nothing, spliced nothing and created no function' "$(Q "select (select count(*) from cron.job) || '/' || (select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure)) = '$stub_md5') || '/' || (select count(*) from pg_proc where proname in ('dev_change_observe_scheduled', 'dev_change_observation_health'))")" '0/true/0'

  # fails closed: without the Order D driver
  apply_base
  P -c "drop function public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)" >/dev/null
  if apply_file "$f"; then emit 'N03 without the Order D driver the file is REFUSED' f 'it applied'
  else tf 'N03 without the Order D driver the file is REFUSED, naming it' "$(grep -c 'docs/dev-change-baseline.sql (Order D) is not applied' "$tmp/err")" '1'; fi
  tf 'N04 that refusal armed nothing' "$(Q "select count(*) from cron.job")" '0'

  # fails closed: without the one reader of events
  apply_base
  P -c "drop view public.dev_change_event_reportable" >/dev/null
  if apply_file "$f"; then emit 'N05 without the reportable view the file is REFUSED' f 'it applied'
  else tf 'N05 without the reportable view the file is REFUSED, naming it' "$(grep -c 'dev-change-reportable.sql is not applied' "$tmp/err")" '1'; fi

  # fails closed: a monitor with no single anchor cannot carry the alarm, so the job must not be armed
  apply_base
  P >/dev/null <<'SQL'
create or replace function public.pipeline_health_tick() returns table(result_check text, result_ok boolean, result_detail text)
language plpgsql as $f$ begin return; end $f$;
SQL
  if apply_file "$f"; then emit 'N06 a monitor with no splice anchor is REFUSED' f 'it applied'
  else tf 'N06 a monitor with no splice anchor is REFUSED, before anything is armed' "$(grep -c 'no single splice anchor' "$tmp/err")" '1'; fi
  tf 'N07 that refusal armed nothing and created no function' "$(Q "select (select count(*) from cron.job) || '/' || (select count(*) from pg_proc where proname in ('dev_change_observe_scheduled', 'dev_change_observation_health'))")" '0/0'
}

fails_of() { grep -c '|f|' <<<"$1" || true; }

out="$(checks "$SQL")"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 60 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped observation schedule does not pass"; exit 1; fi

[ -z "${ONLY_SHIPPED:-}" ] || exit 0
status=0
while IFS= read -r name; do
  [ -z "${ONLY_MUTATION:-}" ] || [ "$name" = "$ONLY_MUTATION" ] || continue
  mutated="$tmp/mutated.sql"
  python3 "$here/mutate.py" "$name" "$SQL" >"$mutated" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  out="$(checks "$mutated" 2>&1)" || out="$out
suite errored|f|"
  if grep -q '^apply|f|' <<<"$out"; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  n_fail=$(fails_of "$out")
  # a mutation that only CRASHES the suite is not "killed": a named check must fail on its own
  n_named=$(grep '|f|' <<<"$out" | grep -vc '^suite|f|' || true)
  if [ "$n_fail" -gt 0 ] && [ "$n_named" -eq 0 ]; then
    echo "CRASHED-ONLY $name — the suite crashed and no named check failed (the regression is not seen by a check)"; status=1
  elif [ "$n_fail" -gt 0 ]; then
    # first four failures. NOT `| head -4`: under pipefail head exits early, cut dies with "Broken pipe" (measured on the F2 harness).
    echo "KILLED   $name — $n_fail check(s) failed:"; { grep '|f|' <<<"$out" || true; } | cut -c1-200 | sed -n '1,4s/^/    /p'
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
