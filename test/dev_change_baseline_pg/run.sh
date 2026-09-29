#!/usr/bin/env bash
# Executable suite for the Development change baseline driver (docs/dev-change-baseline.sql) against a
# DISPOSABLE Postgres (never production).
# 1. the shipped SQL passes every check; 2. it applies twice; 3. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
case "$PGDATABASE" in *disposable*) ;; *) echo "ABORT: PGDATABASE must name a disposable database (got '$PGDATABASE')"; exit 1;; esac
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_base() {
  P -c "drop schema public cascade; create schema public;" >/dev/null 2>&1
  P -f "$root/test/dev_change_ledger_pg/fixture.sql" >/dev/null
  P -f "$here/fixture.sql" >/dev/null
  P -f "$root/docs/dev-change-ledger.sql" >/dev/null 2>&1
}
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }
SQL="$root/docs/dev-change-baseline.sql"

apply_base
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record does not apply"; exit 1; }
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 30 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped baseline driver does not pass"; exit 1; fi

# applying the file a second time must be a no-op (idempotent)
P -f "$SQL" >/dev/null 2>&1 || { echo "FAIL — the SQL of record is not idempotent"; exit 1; }

status=0
while IFS= read -r name; do
  apply_base
  mutated="$(python3 "$here/mutate.py" "$name" "$SQL")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  if ! P <<<"$mutated" >/dev/null 2>&1; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  # a mutation that makes the driver ERROR is caught too: an error is a failed check
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
