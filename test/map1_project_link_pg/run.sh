#!/usr/bin/env bash
# Executable suite for docs/map1-project-link.sql (the Map 1 project link and its documents) against a
# DISPOSABLE PostGIS. 1. the shipped file passes every check (applied twice: it must be re-runnable);
# 2. each prohibited mutation fails at least one check. Built on the Map 1 data-centre fixture, because
# map1_project_locate asks map1_dc_zip_members whether a data center is drawn.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  psql -X -q -c "drop table if exists public.dc_osm_address_check, public.dc_observation_record_key, geo.n5_serving_membership, public.canonical_zip_registry cascade" >/dev/null 2>&1 || true
}
trap cleanup EXIT
apply_base() {
  P -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null
  P -f "$root/docs/zip-membership-canonical.sql" >/dev/null
  P -f "$root/test/map1_dc_publication_pg/fixture_dc.sql" >/dev/null
  python3 "$root/test/dc_epoch_geography_pg/build_apply.py" --extract docs/dc-step3a-canonical-identity.sql \
    'create or replace function public.dc_record_citation(' | P >/dev/null
  P -f "$root/docs/map1-dc-publication.sql" >/dev/null
  P -f "$here/fixture_extra.sql" >/dev/null
  P -c "drop table if exists public.map1_project_document_decision, public.map1_project_document cascade" >/dev/null
}
suite() { P -tA -F'|' -f "$here/suite.sql"; }
fails_of() { grep -c '|f|' <<<"$1" || true; }

apply_base
P -f "$root/docs/map1-project-link.sql" >/dev/null
P -f "$root/docs/map1-project-link.sql" >/dev/null
out="$(suite)"; echo "$out" | sed 's/^/  /'
n_all=$(grep -c '|' <<<"$out"); n_fail=$(fails_of "$out")
echo "SHIPPED: $n_all checks, $n_fail failed"
if [ "$n_all" -lt 27 ] || [ "$n_fail" -ne 0 ]; then echo "FAIL — the shipped file does not pass"; exit 1; fi

status=0
while IFS= read -r name; do
  apply_base
  mutated="$(python3 "$here/mutate.py" "$name" "$root/docs/map1-project-link.sql")" || { echo "HARNESS $name — anchor missing"; status=1; continue; }
  if ! P <<<"$mutated" >/dev/null; then echo "HARNESS  $name — the mutated SQL did not apply"; status=1; continue; fi
  out="$(suite 2>&1)" || out="$out
suite errored|f|"
  n_fail=$(fails_of "$out")
  if [ "$n_fail" -gt 0 ]; then
    echo "KILLED   $name — $n_fail check(s) failed:"; grep '|f|' <<<"$out" | sed 's/^/    /' | cut -c1-240 | head -4
  else
    echo "SURVIVED $name — the suite cannot see this regression"; status=1
  fi
done < <(python3 "$here/mutate.py" --list)
exit $status
