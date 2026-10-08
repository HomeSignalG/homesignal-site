#!/usr/bin/env bash
# STEP 11 (C5): the per-marker address-check view on a disposable stand-in, built exactly like the C7 offline
# proof's (this checkout's DDL of record + the OSM suite's fixture + one Atlas record + derivations).
# Proves: one row per Map 1 marker, every row has a state and a reason, only the four states exist, and each
# fixture record lands in the state the shared decisions give it.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
DB=dc_map1_address_check_t
cd "$root"
dropdb --if-exists "$DB"; createdb "$DB"
P -d "$DB" -c "create extension if not exists postgis" >/dev/null 2>&1 || true
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql \
         docs/map1-dc-publication.sql; do
  P -d "$DB" -f "$f" >/dev/null
done
awk '/^-- ── PHASE A: the C3a deployment/{exit} {print}' test/dc_osm_layer_pg/suite.sql > "$tmp/fixture.sql"
grep -q '^create temp table _obs_fp as' "$tmp/fixture.sql" || { echo "FAIL: the OSM suite's fixture section was not located"; exit 1; }
P -d "$DB" <<SQL >/dev/null
\i $tmp/fixture.sql
create table if not exists public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary on conflict do nothing;
\\i docs/dc-map1-address-check.sql
insert into public.dc_address_geocode (geocoder_query, canonical_addr, ladder_version, provider, match_type, lat, lng,
                                       matched_address, provider_candidates, run_ref)
select q, upper(q), public.dc_geocode_ladder_version(), p, mt, la, ln, ma, c, 'address-check-test' from (values
 ('20 Osm Road, Osmton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.1050, -100.9050, '20 OSM RD, OSMTON, SD, 57031', 1),
 ('30 Far Lane, Farton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2000, -100.8500, '30 FAR LN, FARTON, SD, 57031', 1),
 ('40 Fail Way, Failton, SD 57031', 'none', 'failed', null, null, null, null),
 ('60 Area Road, Areaton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.4010, -100.9010, '60 AREA RD, ARETON, SD, 57031', 1),
 ('10 Shared Road, Sharedton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2505, -100.7005, '10 SHARED RD, SHAREDTON, SD, 57031', 1)
) v(q, p, mt, la, ln, ma, c);
select count(*) >= 0 from public.dc_resolve_canonical(true, false);
select count(*) >= 0 from public.dc_resolve_geography(true);
SQL
P -d "$DB" -tA -F'|' <<'SQL' | tee "$tmp/out.txt"
with m as (select r.zip, x.source_key from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) x),
     v as (select * from public.dc_map1_address_check)
select 'A1_ONE_ROW_PER_MARKER', ((select count(*) from v) = (select count(*) from m)
        and (select count(*) from (select distinct zip, source_key from v) d) = (select count(*) from m)
        and not exists (select zip, source_key from m except select zip, source_key from v))::text,
       (select count(*) from v) || ' rows / ' || (select count(*) from m) || ' markers'
union all select 'A2_EVERY_ROW_HAS_STATE_AND_REASON',
       (not exists (select 1 from v where check_state is null or reason_code is null or reason is null or btrim(reason) = ''))::text, null
union all select 'A3_ONLY_THE_FOUR_STATES',
       (not exists (select 1 from v where check_state not in ('CHECKED','CHECKABLE_NO_CLEAN_MATCH','NOT_CHECKABLE','PENDING')))::text,
       (select string_agg(distinct check_state, ',') from v)
union all select 'A4_NOT_EMPTY', ((select count(*) from v) > 0)::text, null
union all select 'ROW', project_name, layer || '|' || check_state || '|' || reason_code from v;
SQL
bad="$(grep -E '^A[0-9]_' "$tmp/out.txt" | awk -F'|' '$2 != "true"' || true)"
[ "$(grep -cE '^A[0-9]_' "$tmp/out.txt")" = 4 ] && [ -z "$bad" ] || { echo "FAIL:"; echo "$bad"; exit 1; }
# each fixture record lands where the shared decisions put it
exp() { grep -qx "ROW|$1|$2" "$tmp/out.txt" || { echo "FAIL: expected ROW|$1|$2"; exit 1; }; }
exp 'Corrob OSM' 'openstreetmap|CHECKED|CORROBORATED_BY_OWN_ADDRESS'
exp 'Failed OSM' 'openstreetmap|CHECKABLE_NO_CLEAN_MATCH|REJECTED_NO_MATCH'
exp 'Blank OSM' 'openstreetmap|NOT_CHECKABLE|BLANK'
exp 'Nolocal OSM' 'openstreetmap|NOT_CHECKABLE|NO_LOCALITY'
exp 'Area OSM' 'openstreetmap|NOT_CHECKABLE|NO_SITE_CLAIM'
exp 'Shared Atlas' 'canonical|CHECKED|CORROBORATED_BY_OWN_ADDRESS'
grep -q '^ROW|Far OSM|' "$tmp/out.txt" && { echo "FAIL: Far OSM is withheld from Map 1 and must not appear"; exit 1; }
echo "ALL STEP 11 ADDRESS-CHECK VIEW CHECKS PASSED"
