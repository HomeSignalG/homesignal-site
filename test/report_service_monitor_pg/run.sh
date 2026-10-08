#!/usr/bin/env bash
# Executable suite for the report-service email alarm (docs/report-service-monitor.sql) against a DISPOSABLE Postgres
# (never production). 1. the shipped SQL passes every check; 2. it applies twice with an identical result; 3. its rollback
# restores the monitor byte for byte and removes the job, the functions and the log; 4. it refuses, changing nothing, when
# what it depends on is missing; 5. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
Q() { P -tA -c "$1"; }
SQL="$root/docs/report-service-monitor.sql"

base_schemas() { P -c "drop schema if exists public cascade; create schema public; drop schema if exists cron cascade; drop schema if exists net cascade;" >/dev/null 2>&1
                 P -f "$root/test/report_snapshot_pg/fixture.sql" >/dev/null
                 P -f "$here/fixture_cron.sql" >/dev/null
                 P -f "$here/fixture_net.sql" >/dev/null; }
apply_base()   { base_schemas; P -f "$here/fixture_monitor.sql" >/dev/null; }
apply_file()   { P -1 -f "$1" >/dev/null 2>"$tmp/err"; }
fp() { Q "select md5(
   coalesce(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure), '')
|| coalesce((select string_agg(pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), ',' order by p.proname) from pg_proc p where p.proname in ('report_service_health', 'report_service_probe_fire')), '')
|| coalesce((select string_agg(jobname || '|' || schedule || '|' || command || '|' || active::text, ',' order by jobname) from cron.job), ''))"; }
rollback_sql() { sed -n '/^-- ROLLBACK-BEGIN$/,/^-- ROLLBACK-END$/p' "$1" | sed '1d;$d' | sed 's/^-- //'; }
emit() { printf '%s|%s|%s\n' "$1" "$2" "${3:-}"; }
tf() { if [ "$2" = "$3" ]; then emit "$1" t "$2"; else emit "$1" f "got [$2] want [$3]"; fi; }

checks() {
  local f="$1" stub_md5 fp1 fp2
  apply_base
  stub_md5="$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")"
  if ! apply_file "$f"; then emit 'apply' f "the SQL does not apply: $(tr '\n' ' ' <"$tmp/err" | head -c 300)"; return 0; fi
  P -tA -F'|' -f "$here/suite.sql"

  fp1="$(fp)"
  if apply_file "$f"; then fp2="$(fp)"; else fp2="re-apply refused: $(tr '\n' ' ' <"$tmp/err" | head -c 200)"; fi
  tf 'A01 applying the file a second time changes nothing (monitor, both functions, grants, job)' "$([ "$fp1" = "$fp2" ] && echo same || echo "$fp1 vs $fp2")" 'same'
  tf 'A02 a second apply leaves ONE job, not two' "$(Q "select count(*) from cron.job where jobname = 'report-service-probe'")" '1'
  Q "update cron.job set active = false where jobname = 'report-service-probe'" >/dev/null
  apply_file "$f" || true
  tf 'A03 re-applying the file RE-ARMS a job someone deactivated' "$(Q "select active from cron.job where jobname = 'report-service-probe'")" 't'

  P -1 >/dev/null 2>"$tmp/err" <<<"$(rollback_sql "$f")" || true
  tf 'R01 the rollback restores the monitor BYTE FOR BYTE' "$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")" "$stub_md5"
  tf 'R02 the rollback unschedules the job' "$(Q "select count(*) from cron.job where jobname = 'report-service-probe'")" '0'
  tf 'R03 the rollback drops both functions' "$(Q "select count(*) from pg_proc where proname in ('report_service_health', 'report_service_probe_fire')")" '0'
  tf 'R04 the rollback drops the probe log' "$(Q "select count(*) from pg_class where relname = 'report_service_probe'")" '0'
  if apply_file "$f"; then fp2="$(fp)"; else fp2="re-apply after rollback refused"; fi
  tf 'R05 re-applying after a rollback gives exactly the first apply' "$([ "$fp1" = "$fp2" ] && echo same || echo different)" 'same'

  # fails closed: without pg_net there is nothing to probe with, so nothing is armed and nothing is spliced
  base_schemas; P -c "drop schema net cascade" >/dev/null; P -f "$here/fixture_monitor.sql" >/dev/null
  stub_md5="$(Q "select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure))")"
  if apply_file "$f"; then emit 'N01 without pg_net the file is REFUSED' f 'it applied'
  else tf 'N01 without pg_net the file is REFUSED, naming it' "$(grep -c 'pg_net is not installed' "$tmp/err")" '1'; fi
  tf 'N02 the refusal armed nothing, created nothing and spliced nothing' "$(Q "select (select count(*) from cron.job) || '/' || (select count(*) from pg_class where relname = 'report_service_probe') || '/' || (select md5(pg_get_functiondef('public.pipeline_health_tick()'::regprocedure)) = '$stub_md5')")" '0/0/true'

  # fails closed: a monitor with no single anchor cannot carry the alarm
  apply_base
  P >/dev/null <<'SQL'
create or replace function public.pipeline_health_tick() returns table(result_check text, result_ok boolean, result_detail text)
language plpgsql as $f$ begin return; end $f$;
SQL
  if apply_file "$f"; then emit 'N03 a monitor with no splice anchor is REFUSED' f 'it applied'
  else tf 'N03 a monitor with no splice anchor is REFUSED, before anything is armed' "$(grep -c 'no single splice anchor' "$tmp/err")" '1'; fi
  tf 'N04 that refusal armed nothing' "$(Q "select count(*) from cron.job")" '0'
}

fails_of() { grep -c '|f|' <<<"$1" || true; }

out="$(checks "$SQL")"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 40 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped alarm does not pass"; exit 1; fi

[ -z "${ONLY_SHIPPED:-}" ] || exit 0
status=0
while IFS= read -r name; do
  mutated="$tmp/mutated.sql"
  python3 "$here/mutate.py" "$name" "$SQL" >"$mutated" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  out="$(checks "$mutated" 2>&1)" || out="$out
suite errored|f|"
  if grep -q '^apply|f|' <<<"$out"; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    echo "KILLED   $name — $n_fail check(s) failed:"; { grep '|f|' <<<"$out" || true; } | cut -c1-200 | sed -n '1,3s/^/    /p'
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
