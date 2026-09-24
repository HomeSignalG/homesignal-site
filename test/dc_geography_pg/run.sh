#!/usr/bin/env bash
# Executable suite for CANONICAL DC GEOGRAPHY (docs/dc-step3b-canonical-geography.sql) against a
# DISPOSABLE PostGIS (never production).
# 1. the shipped file passes every check; 2. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing, or that does not apply, is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
cd "$here"   # the suite loads its corpus with a relative \copy
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_base() { P -f "$here/fixture.sql" >/dev/null; }
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

apply_base
P -f "$root/docs/dc-step3b-canonical-geography.sql" >/dev/null
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 14 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped geography does not pass"; exit 1; fi

status=0
while IFS= read -r name; do
  apply_base
  mutated="$(python3 "$here/mutate.py" "$name" "$root/docs/dc-step3b-canonical-geography.sql")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  if ! P <<<"$mutated" >/dev/null; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
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
