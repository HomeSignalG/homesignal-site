#!/usr/bin/env bash
# Executable ZIP-membership suite against a DISPOSABLE PostGIS (never production).
# 1. the shipped functions pass every check; 2. each prohibited mutation fails >= 1 check.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_shipped() {
  P -f "$here/fixture_schema.sql" >/dev/null
  P -f "$root/docs/fix28-datacenter-zip-membership.sql" >/dev/null
  P -f "$root/docs/zip-membership-canonical.sql" >/dev/null
}
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

apply_shipped
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 20 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped functions do not pass"; exit 1; fi

status=0
for m in "$here/mutations/centroid_radius.sql" "$here/mutations/national_bypass.sql" \
         "$root/docs/fix28-datacenter-zip-membership.sql"; do
  apply_shipped
  P -f "$m" >/dev/null
  out="$(suite)"; n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    echo "KILLED   $(basename "$m") — $n_fail check(s) failed:"; grep '|f|' <<<"$out" | sed 's/^/    /' | head -12
  else
    echo "SURVIVED $(basename "$m") — the suite cannot see this regression"; status=1
  fi
done
apply_shipped
exit $status
