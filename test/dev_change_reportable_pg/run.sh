#!/usr/bin/env bash
# Executable suite for the reportable-events view (docs/dev-change-reportable.sql) against a
# DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. it applies twice; 3. it refuses to apply without the Order C
# ledger; 4. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_base() {
  P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1
  P -f "$root/test/dev_change_ledger_pg/fixture.sql" >/dev/null
  P -f "$root/docs/dev-change-ledger.sql" >/dev/null 2>&1
}
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
SQL="$root/docs/dev-change-reportable.sql"

apply_base
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not apply"; exit 1; }
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 18 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped reportable view does not pass"; exit 1; fi

# applying the file a second time must be a no-op (idempotent): same definition, same grants, same options
fp() { P -tA -c "select md5(pg_get_viewdef(c.oid) || coalesce(c.relacl::text, '') || coalesce(c.reloptions::text, '')) from pg_class c where c.oid = 'public.dev_change_event_reportable'::regclass"; }
fp1="$(fp)"
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record is not idempotent"; exit 1; }
fp2="$(fp)"
if [ -z "$fp1" ] || [ "$fp1" != "$fp2" ]; then echo "FAIL — a second apply changed the view ($fp1 vs $fp2)"; exit 1; fi

# without the Order C ledger the file must refuse, and must create nothing
P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1
if P -f "$SQL" >/dev/null 2>&1; then echo "FAIL — the SQL applied with no ledger installed"; exit 1; fi
if [ "$(P -tA -c "select to_regclass('public.dev_change_event_reportable') is not null")" = "t" ]; then
  echo "FAIL — a refused apply left the view behind"; exit 1
fi
echo "REFUSED without the Order C ledger, and created nothing"

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
