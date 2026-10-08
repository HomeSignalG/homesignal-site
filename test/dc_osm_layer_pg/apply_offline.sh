#!/usr/bin/env bash
# Offline proof of scripts/dc-osm-layer-apply.sh (C3a) against a DISPOSABLE stand-in for production
# ("fakeprod"): this checkout's DDL of record with the C3a rollback applied (i.e. the pre-C3a state
# production carries today, proven by the rollback's own post-condition), plus the OSM suite's fixture
# rows. Proves, before the script is ever pointed at production:
#   1. DRIFT GUARD: a live function that no longer fingerprints to main is refused inside the artifact,
#      and nothing is committed;
#   2. BOUNDED LOCK WAIT: with another session holding dc_geocode_queue, the apply FAILS on
#      lock_timeout within seconds and commits nothing;
#   3. the apply then succeeds: both OSM views exist, OSM is not admitted, definitions equal the DDL of
#      record, the queue gains the OSM addresses, and Map 1 is byte-identical;
#   4. a second apply is REFUSED;
#   5. the rollback succeeds, Map 1 is still byte-identical, a second rollback is refused, and the
#      apply can be re-applied after it.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod_osm_layer
cd "$root"

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -c "create extension if not exists postgis" >/dev/null 2>&1 || true
P -d "$FP" -f test/zip_membership_pg/fixture_schema.sql >/dev/null
P -d "$FP" -f docs/zip-membership-canonical.sql >/dev/null
P -d "$FP" -f test/dc_epoch_geography_pg/fixture.sql >/dev/null
for f in docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  P -d "$FP" -f "$f" >/dev/null
done
awk '/^-- ── before any derivation/{exit} {print}' "$here/suite.sql" > "$tmp/fixture.sql"
grep -q '^create temp table _obs_fp as' "$tmp/fixture.sql" || { echo "FAIL: the suite's fixture section was not located"; exit 1; }
P -d "$FP" <<SQL >/dev/null
\i $tmp/fixture.sql
create table if not exists public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary on conflict do nothing;
SQL
P -d "$FP" -f docs/dc-osm-layer-rollback.sql >/dev/null || { echo "FAIL: could not reach the pre-C3a state"; exit 1; }
P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_canonical(true, false)" >/dev/null
P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_geography(true)" >/dev/null
URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/$FP"
Q() { P -d "$FP" -tA -c "$1"; }
state() { Q "select ((to_regclass('public.dc_osm_derived_point') is not null)::int + (to_regclass('public.dc_osm_address_check') is not null)::int) || '/' || (select md5(prosrc) from pg_proc where proname = 'dc_publisher_stated_address') || '/' || md5(pg_get_viewdef('public.dc_geocode_queue'::regclass))"; }
M1() { Q "select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) x"; }
PRE="0/83675b5b646487fe1cc70041749232f5/4a52710c5a8b9cdb140314746896bfc3"
[ "$(state)" = "$PRE" ] || { echo "FAIL: fakeprod is not the pre-C3a state ($(state))"; exit 1; }
[ "$(Q "select count(*) from public.national_dc_records where map_eligible")" -gt 0 ] || { echo "FAIL: control: fakeprod carries no OSM row"; exit 1; }
map_before="$(M1)"
[ "$(Q "select count(*) from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m where m.publication_basis = 'legacy_osm_compat'")" -gt 0 ] \
  || { echo "FAIL: control: no OSM row on Map 1 in fakeprod"; exit 1; }
queue_before="$(Q "select count(*) from public.dc_geocode_queue")"
echo "  fakeprod: $(state), Map 1 $map_before, queue $queue_before"

echo "== 1. DRIFT GUARD: a shared function that no longer fingerprints to main is refused inside the artifact"
Q "select pg_get_functiondef('public.dc_site_claims_conflict'::regproc)" > "$tmp/orig_fn.sql"
Q "create or replace function public.dc_site_claims_conflict(p_class_a text, p_uncertainty_a double precision, p_lat_a double precision, p_lng_a double precision, p_class_b text, p_uncertainty_b double precision, p_lat_b double precision, p_lng_b double precision) returns boolean language sql immutable set search_path to 'public', 'pg_temp' as \$\$ select false \$\$" >/dev/null
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-layer-apply.sh > "$tmp/drift.txt" 2>&1; rc=$?
set -e
sed 's/^/  | /' "$tmp/drift.txt"
[ "$rc" != 0 ] && grep -q 'DRIFT: production no longer matches main' "$tmp/drift.txt" && grep -q 'dc_site_claims_conflict' "$tmp/drift.txt" \
  || { echo "FAIL: drifted function not refused by the guard"; exit 1; }
[ "$(state)" = "$PRE" ] || { echo "FAIL: a refused apply changed state"; exit 1; }
P -d "$FP" -f "$tmp/orig_fn.sql" >/dev/null
echo "  PASS: refused by the in-artifact guard; nothing changed"

echo "== 2. NEGATIVE CONTROL: a session holding dc_geocode_queue makes the apply fail FAST"
PGAPPNAME=dc-offline-blocker P -d "$FP" -c "begin; lock table public.dc_geocode_queue in access exclusive mode; select pg_sleep(40); commit;" >/dev/null 2>&1 &
blk=$!; sleep 2
t0=$(date +%s)
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_OFFLINE_ALLOW_LOCKS=1 bash scripts/dc-osm-layer-apply.sh > "$tmp/neg.txt" 2>&1; rc=$?
set -e
el=$(( $(date +%s) - t0 ))
Q "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'dc-offline-blocker'" >/dev/null
wait "$blk" 2>/dev/null || true
sed 's/^/  | /' "$tmp/neg.txt"
[ "$rc" != 0 ] || { echo "FAIL: the apply succeeded while the queue was locked"; exit 1; }
grep -qE 'lock timeout|canceling statement due to lock timeout' "$tmp/neg.txt" || { echo "FAIL: the apply did not fail on lock_timeout"; exit 1; }
[ "$el" -lt 30 ] || { echo "FAIL: the lock wait was not bounded (${el}s)"; exit 1; }
[ "$(state)" = "$PRE" ] || { echo "FAIL: a failed apply left partial state ($(state))"; exit 1; }
echo "  PASS: failed on lock_timeout after ${el}s total; nothing changed"

echo "== 3. the apply succeeds: OSM views present, OSM not admitted, definitions = DDL of record, Map 1 unmoved"
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-layer-apply.sh > "$tmp/ok.txt" 2>&1 || { sed 's/^/  | /' "$tmp/ok.txt"; echo "FAIL: apply exited non-zero"; exit 1; }
sed 's/^/  /' "$tmp/ok.txt"
grep -q '^OSM LAYER CHECK APPLIED' "$tmp/ok.txt" && grep -q 'OSM_VIEWS=2' "$tmp/ok.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/ok.txt" \
  || { echo "FAIL: apply did not complete"; exit 1; }
[ "$(M1)" = "$map_before" ] || { echo "FAIL: Map 1 moved on the apply"; exit 1; }
[ "$(Q "select count(*) from public.dc_geocode_queue")" -gt "$queue_before" ] || { echo "FAIL: control: the queue did not gain the OSM addresses"; exit 1; }
[ "$(Q "select count(*) from public.dc_osm_address_check where check_outcome = 'UNCHECKED_NOT_YET_GEOCODED'")" -gt 0 ] || { echo "FAIL: control: the OSM check reports nothing"; exit 1; }
Q "select count(*) from public.dc_resolve_geography(true)" >/dev/null
[ "$(M1)" = "$map_before" ] || { echo "FAIL: a resolver run after the apply moved Map 1 (OSM reached a decision)"; exit 1; }
echo "  PASS: $(state); queue $queue_before -> $(Q "select count(*) from public.dc_geocode_queue"); Map 1 unchanged, also after a resolver run"

echo "== 4. a second apply is refused"
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-layer-apply.sh > "$tmp/again.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/again.txt" || { echo "FAIL: second apply not refused"; cat "$tmp/again.txt"; exit 1; }
echo "  PASS: refused"

echo "== 5. ROLLBACK: the pre-C3a definitions return; Map 1 unmoved; a second rollback is refused; re-apply works"
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_MODE=rollback bash scripts/dc-osm-layer-apply.sh > "$tmp/rb.txt" 2>&1 || { sed 's/^/  | /' "$tmp/rb.txt"; echo "FAIL: rollback exited non-zero"; exit 1; }
sed 's/^/  /' "$tmp/rb.txt"
grep -q '^OSM LAYER CHECK ROLLED BACK' "$tmp/rb.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/rb.txt" || { echo "FAIL: rollback did not complete"; exit 1; }
[ "$(state)" = "$PRE" ] || { echo "FAIL: state after rollback $(state)"; exit 1; }
[ "$(M1)" = "$map_before" ] || { echo "FAIL: Map 1 moved on the rollback"; exit 1; }
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_MODE=rollback bash scripts/dc-osm-layer-apply.sh > "$tmp/rb2.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/rb2.txt" || { echo "FAIL: second rollback not refused"; cat "$tmp/rb2.txt"; exit 1; }
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-layer-apply.sh > "$tmp/re.txt" 2>&1 || { sed 's/^/  | /' "$tmp/re.txt"; echo "FAIL: re-apply after rollback failed"; exit 1; }
case "$(state)" in 2/*) ;; *) echo "FAIL: state after re-apply $(state)"; exit 1;; esac
echo "  PASS: rollback restored $PRE; second rollback refused; re-apply succeeds"
echo "ALL OSM LAYER APPLY OFFLINE CHECKS PASSED"
