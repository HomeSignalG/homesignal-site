#!/usr/bin/env bash
# Executable suite for EPOCH CANONICAL GEOGRAPHY against a DISPOSABLE PostGIS (never production).
# Applies the SHIPPED chain in production order, then runs suite.sql:
#   zip membership -> evidence fixture -> Step 3D (derived location) -> Step 3A (identity)
#   -> Step 3B (geography) -> the ONE Map 1 reader; derivations loaded by the writer's OWN load SQL.
# 1. the shipped files pass every check; 2. each prohibited mutation fails >= 1 check.
# A mutation whose anchor is missing, or that does not apply, is a harness failure, never a pass.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
CHAIN=(docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql
       docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql)
LOAD=docs/dc-geocode-observations-load.sql

# apply_chain [MUTATED_REL MUTATED_ABS]: the base + chain, one file optionally substituted
apply_chain() {
  P -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null 2>&1
  P -f "$root/docs/zip-membership-canonical.sql" >/dev/null 2>&1
  P -f "$here/fixture.sql" >/dev/null 2>&1
  local f src
  for f in "${CHAIN[@]}"; do
    src="$root/$f"; [ "${1:-}" = "$f" ] && src="$2"
    P -f "$src" >/dev/null 2>"$tmp/err" || { cat "$tmp/err" >&2; return 1; }
  done
}
suite() { P -v loadsql="$1" -tA -F'|' -f "$here/suite.sql" 2>"$tmp/suite_err" | grep -E '^[EZ][0-9]' || true; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

apply_chain
out="$(suite "$root/$LOAD")"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 35 ] || [ "$n_fail" -ne 0 ]; then
  cat "$tmp/suite_err" >&2; echo "FAIL — the shipped Epoch geography path does not pass"; exit 1
fi

status=0
while read -r name rel; do
  python3 "$here/mutate.py" "$name" "$root/$rel" >"$tmp/mutated.sql" || { echo "HARNESS  $name — anchor missing"; status=1; continue; }
  loadsql="$root/$LOAD"
  if [ "$rel" = "$LOAD" ]; then
    loadsql="$tmp/mutated.sql"; applied=0; apply_chain && applied=1
  else
    applied=0; apply_chain "$rel" "$tmp/mutated.sql" && applied=1
  fi
  if [ "$applied" -ne 1 ]; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  out="$(suite "$loadsql")"
  n_all=$(grep -c '|' <<<"$out" || true); n_fail=$(fails_of "$out")
  # a suite that dies part-way reports fewer checks: that is a kill only because a check is missing
  if [ "$n_all" -lt 35 ]; then n_fail=$((n_fail + 35 - n_all)); fi
  if [ "$n_fail" -gt 0 ]; then
    echo "KILLED   $name — $n_fail check(s) failed:"; { grep '|f|' <<<"$out" || true; } | cut -d'|' -f1 | sed 's/^/    /' | head -4
    if [ "$n_all" -lt 35 ]; then echo "    (suite stopped after $n_all checks: $(grep -m1 ERROR "$tmp/suite_err" | cut -c1-160))"; fi
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_chain
exit $status
