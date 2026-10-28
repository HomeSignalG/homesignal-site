#!/usr/bin/env bash
# State water-rights suite against a DISPOSABLE PostGIS (never production).
# 1. the shipped SQL passes every check; 2. each prohibited mutation fails >= 1 check.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_sql() {
  P -c "create extension if not exists postgis" >/dev/null 2>&1
  P -f "$here/fixture_schema.sql" >/dev/null 2>&1
  P -f "$1" >/dev/null
}
shipped="$root/docs/state-water-rights.sql"
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

apply_sql "$shipped"
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 35 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped SQL does not pass"; exit 1; fi

status=0
tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
for m in "$here"/mutations/*.sed; do
  sed -f "$m" "$shipped" > "$tmp"
  if cmp -s "$tmp" "$shipped"; then
    echo "NO-OP    $(basename "$m") — the mutation did not change the file"; status=1; continue
  fi
  apply_sql "$tmp" 2>/dev/null || true
  out="$(suite 2>&1 || true)"; n_fail=$(fails_of "$out")
  n_got=$(grep -c '|[tf]|' <<<"$out" || true)
  if [ "$n_fail" -gt 0 ] || [ "$n_got" -lt "$n_all" ]; then
    echo "KILLED   $(basename "$m") — $n_fail check(s) failed"
  else
    echo "SURVIVED $(basename "$m") — the suite cannot see this regression"; status=1
  fi
done
apply_sql "$shipped"
exit $status
