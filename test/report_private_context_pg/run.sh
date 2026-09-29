#!/usr/bin/env bash
# Executable suite for the report private context (docs/report-private-context.sql) against a
# DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. it applies twice with an identical result;
# 3. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_base() {
  P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1
  P -f "$root/test/report_snapshot_pg/fixture.sql" >/dev/null
}
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
SQL="$root/docs/report-private-context.sql"

apply_base
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not apply"; exit 1; }
# the definition a second apply must leave exactly as it found it
fp() { P -tA -c "select md5(
    coalesce((select string_agg(conrelid::regclass::text || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text collate \"C\", conname collate \"C\") from pg_constraint where conrelid::regclass::text like 'public.report\\_private\\_context%'), '')
  || coalesce((select string_agg(pg_get_functiondef(p.oid), ',' order by p.proname collate \"C\") from pg_proc p where p.proname like 'report\\_private\\_context\\_%'), '')
  || coalesce((select string_agg(c.relname || coalesce(c.relacl::text, ''), ',' order by c.relname collate \"C\") from pg_class c where c.relname like 'report\\_private\\_context%' and c.relkind = 'r'), '')
  || coalesce((select string_agg(tgname, ',' order by tgname collate \"C\") from pg_trigger where tgrelid::regclass::text like 'public.report\\_private\\_context%' and not tgisinternal), '')
  || coalesce((select string_agg(indexdef, ',' order by indexname collate \"C\") from pg_indexes where tablename like 'report\\_private\\_context%'), ''))"; }
fp1="$(fp)"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 40 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped private context does not pass"; exit 1; fi

# applying the file a second time must be a no-op (idempotent): same constraints, functions, grants, triggers, indexes
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record is not idempotent"; exit 1; }
fp2="$(fp)"
if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then echo "FAIL — a second apply changed the definition ($fp1 vs $fp2)"; exit 1; fi
echo "APPLIED TWICE with an identical definition"

status=0
while IFS= read -r name; do
  apply_base
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  if ! P <<<"$mutated" >/dev/null 2>&1; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  # a mutation that makes the suite ERROR is caught too: an error is a failed check
  out="$(suite 2>&1)" || out="$out
suite errored|f|"
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    echo "KILLED   $name — $n_fail check(s) failed:"; grep '|f|' <<<"$out" | sed 's/^/    /' | cut -c1-200 | head -4
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
