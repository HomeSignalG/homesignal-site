#!/usr/bin/env bash
# Executable suite for THE ONE Map 1 data-centre contract (docs/map1-dc-publication.sql)
# against a DISPOSABLE PostGIS (never production).
# 1. the shipped function passes every check; 2. each prohibited mutation fails >= 1 check.
# Mutations are applied to the SHIPPED file's text; a mutation whose anchor is missing is a
# harness failure, never a pass — a mutation that does not apply is indistinguishable from one
# that survives.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
apply_base() {
  P -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null
  P -f "$root/docs/zip-membership-canonical.sql" >/dev/null
  P -f "$here/fixture_dc.sql" >/dev/null
  # the reader asks Step 3A's source-keyed citation rule: load the SHIPPED statement, never a copy
  python3 "$root/test/dc_epoch_geography_pg/build_apply.py" --extract docs/dc-step3a-canonical-identity.sql \
    'create or replace function public.dc_record_citation(' | P >/dev/null
}
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

apply_base
P -f "$root/docs/map1-dc-publication.sql" >/dev/null
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 14 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped contract does not pass"; exit 1; fi

status=0
while IFS= read -r name; do
  apply_base
  mutated="$(python3 "$here/mutate.py" "$name" "$root/docs/map1-dc-publication.sql")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  if ! P <<<"$mutated" >/dev/null; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  # a mutation that makes the contract ERROR is caught too: an error is a failed check
  out="$(suite 2>&1)" || out="$out
suite errored|f|"
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    echo "KILLED   $name — $n_fail check(s) failed:"; grep '|f|' <<<"$out" | sed 's/^/    /' | cut -c1-240 | head -6
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
apply_base
exit $status
