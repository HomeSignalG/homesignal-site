#!/usr/bin/env bash
# Executable suite for docs/zip-scope-members.sql on a DISPOSABLE PostGIS (never production).
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_shipped() {
  P -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null 2>&1
  P -f "$root/docs/zip-membership-canonical.sql" >/dev/null
  P -f "$here/fixture.sql" >/dev/null
  P -f "${1:-$root/docs/zip-scope-members.sql}" >/dev/null
}
suite() { psql -X -q -tA -f "$here/suite.sql" 2>&1 | grep '|' ; }
apply_shipped
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(grep -c '|f|' <<<"$out" || true)
echo "SHIPPED: $n_all checks, $n_fail failed"
[ "$n_all" -ge 22 ] && [ "$n_fail" -eq 0 ] || { echo "FAIL — the shipped function does not pass"; exit 1; }
status=0
for m in "$here"/mutations/*.sql; do
  apply_shipped
  P -f "$m" >/dev/null
  out="$(suite)"; nf=$(grep -c '|f|' <<<"$out" || true)
  if [ "$nf" -gt 0 ]; then echo "KILLED   $(basename "$m") — $nf check(s) failed"; else echo "SURVIVED $(basename "$m")"; status=1; fi
done
apply_shipped
exit $status
