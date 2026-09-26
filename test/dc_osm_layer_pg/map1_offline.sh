#!/usr/bin/env bash
# Offline proof of the C3c AUTOMATED GATE (scripts/dc-osm-map1-gate.sh) and apply script
# (scripts/dc-osm-map1-apply.sh) against a DISPOSABLE stand-in for production ("fakeprod"): this
# checkout's DDL of record with docs/dc-osm-map1-rollback.sql applied (the pre-C3c state production
# carries, proven by that artifact's post-condition), plus the OSM suite's fixture rows and derivations.
#   1. the GATE PASSES on the real artifact, withholding exactly the one disagreement and flagging
#      exactly the two corroborations;
#   2. the GATE REFUSES a wrong change: a reader that withholds every unchecked pin (a real regression
#      class) is caught by the prediction, not waved through;
#   3. the apply refuses drift; 4. fails fast on a held lock; 5. succeeds, and live Map 1 then equals
#      the gate's prediction; 6. a second apply is refused; 7. rollback restores the pre-C3c Map 1
#      exactly, a second rollback is refused, and re-apply works.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod_osm_map1
cd "$root"

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -c "create extension if not exists postgis" >/dev/null 2>&1 || true
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  P -d "$FP" -f "$f" >/dev/null
done
awk '/^-- ── PHASE A: the C3a deployment/{exit} {print}' "$here/suite.sql" > "$tmp/fixture.sql"
grep -q '^create temp table _obs_fp as' "$tmp/fixture.sql" || { echo "FAIL: the suite's fixture section was not located"; exit 1; }
P -d "$FP" <<SQL >/dev/null
\i $tmp/fixture.sql
create table if not exists public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary on conflict do nothing;
insert into public.dc_address_geocode (geocoder_query, canonical_addr, ladder_version, provider, match_type, lat, lng,
                                       matched_address, provider_candidates, run_ref)
select q, upper(q), public.dc_geocode_ladder_version(), p, mt, la, ln, ma, c, 'map1-offline' from (values
 ('20 Osm Road, Osmton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.1050, -100.9050, '20 OSM RD, OSMTON, SD, 57031', 1),
 ('30 Far Lane, Farton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2000, -100.8500, '30 FAR LN, FARTON, SD, 57031', 1),
 ('40 Fail Way, Failton, SD 57031', 'none', 'failed', null, null, null, null),
 ('60 Area Road, Areaton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.4010, -100.9010, '60 AREA RD, ARETON, SD, 57031', 1),
 ('10 Shared Road, Sharedton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2505, -100.7005, '10 SHARED RD, SHAREDTON, SD, 57031', 1)
) v(q, p, mt, la, ln, ma, c);
SQL
P -d "$FP" -f docs/dc-osm-map1-rollback.sql >/dev/null || { echo "FAIL: could not reach the pre-C3c state"; exit 1; }
P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_canonical(true, false)" >/dev/null
P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_geography(true)" >/dev/null
URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/$FP"
Q() { P -d "$FP" -tA -c "$1"; }
state() { Q "select public.dc_derived_address_admitted('openstreetmap', 'telecom_data_center') || '/' || (select md5(prosrc) from pg_proc where proname = 'dc_derived_address_admitted') || '/' || (select md5(prosrc) from pg_proc where proname = 'map1_dc_zip_members')"; }
M1() { Q "select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) x"; }
OSM() { Q "select count(*) || '/' || count(*) filter (where quality_flags <> '{}') from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m where m.publication_basis = 'legacy_osm_compat'"; }
PRE="false/31cb6c9e7481311ab33042a8845c9276/9fc1c9f51375f25db5658a14ca36937c"
[ "$(state)" = "$PRE" ] || { echo "FAIL: fakeprod is not the pre-C3c state ($(state))"; exit 1; }
[ "$(Q "select count(*) from public.dc_osm_address_check where check_outcome = 'SOURCES_DISAGREE'")" = 1 ] \
  && [ "$(Q "select count(*) from public.dc_osm_address_check where check_outcome = 'CORROBORATED'")" = 2 ] \
  || { echo "FAIL: control: fakeprod's checks are not 1 disagreement + 2 corroborations"; exit 1; }
map_before="$(M1)"; osm_before="$(OSM)"
[ "$osm_before" = "8/0" ] || { echo "FAIL: control: expected 8 OSM rows, none flagged, before ($osm_before)"; exit 1; }
echo "  fakeprod: $(state), OSM rows/flagged $osm_before"

echo "== 1. THE GATE PASSES on the committed artifact"
PROD_DB_URL="$URL" bash scripts/dc-osm-map1-gate.sh > "$tmp/gate.txt" 2>&1 || { sed 's/^/  | /' "$tmp/gate.txt"; echo "FAIL: the gate refused the real change"; exit 1; }
{ grep -E '^(G[0-9]+_|CHANGE|GATE|  PARITY)' "$tmp/gate.txt" || true; } | sed 's/^/  /'
grep -q '^G06_EVERY_REMOVED_ROW_IS_AN_ADMITTED_OSM_DISAGREEMENT|true|1 removed$' "$tmp/gate.txt" \
  && grep -q '^G07_EVERY_FLAG_CHANGE_IS_AN_ADMITTED_OSM_CORROBORATION|true|2 flagged$' "$tmp/gate.txt" \
  && grep -q '^CHANGE|WITHHELD|99931 osm:way/2 Far OSM$' "$tmp/gate.txt" \
  || { echo "FAIL: the gate passed but did not withhold exactly Far OSM and flag exactly two"; exit 1; }
[ "$(state)" = "$PRE" ] && [ "$(M1)" = "$map_before" ] || { echo "FAIL: the gate changed \"production\""; exit 1; }
echo "  PASS: 1 withheld (Far OSM), 2 flagged; \"production\" untouched"

echo "== 2. NEGATIVE CONTROL: the gate REFUSES a reader that withholds every unchecked pin"
cp docs/dc-osm-map1-apply.sql "$tmp/apply.orig"
# A CONSISTENTLY wrong artifact: the reader changed AND the artifact's own post-condition fingerprint
# updated to match (as a wrong DDL of record regenerated through the builder would be). The artifact's
# self-check therefore passes; only the gate's INDEPENDENT prediction can catch it.
python3 - docs/dc-osm-map1-apply.sql <<'PY'
import hashlib, re, sys
p = sys.argv[1]; s = open(p).read()
body = lambda x: hashlib.md5(re.search(r'\bas \$function\$(.*?)\$function\$', x, re.S).group(1).encode()).hexdigest()
old_md5 = body(s)
old = "and not (coalesce(k.admitted, false) and k.check_outcome = 'SOURCES_DISAGREE'))"
assert s.count(old) == 1
s = s.replace(old, "and not (coalesce(k.admitted, false) and k.check_outcome <> 'CORROBORATED'))")
assert s.count(old_md5) == 1, 'post-condition fingerprint not found exactly once'
open(p, 'w').write(s.replace(old_md5, body(s)))
PY
set +e
PROD_DB_URL="$URL" bash scripts/dc-osm-map1-gate.sh > "$tmp/gate_bad.txt" 2>&1; rc=$?
set -e
cp "$tmp/apply.orig" docs/dc-osm-map1-apply.sql
{ grep -E '^(G0[36]_|GATE|FAIL)' "$tmp/gate_bad.txt" || true; } | sed 's/^/  | /'
[ "$rc" != 0 ] && grep -q '^GATE REFUSED' "$tmp/gate_bad.txt" && grep -q '^G03_AFTER_EQUALS_PREDICTION_EXACTLY|false' "$tmp/gate_bad.txt" \
  || { echo "FAIL: the gate did not refuse a wrong reader"; exit 1; }
echo "  PASS: refused (G03 and G06 name the unexplained removals)"

echo "== 3. the apply refuses drift inside the artifact"
python3 - docs/dc-osm-map1-rollback.sql > "$tmp/switch_before.sql" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"create or replace function public\.dc_derived_address_admitted\(.*?\$\$;", s, re.S)
assert m; print(m.group(0))
PY
P -d "$FP" -c "create or replace function public.dc_derived_address_admitted(p_source_key text, p_distribution_key text) returns boolean language sql immutable set search_path to 'public', 'pg_temp' as \$\$ select p_source_key in ('epoch_ai', 'compute_atlas') \$\$" >/dev/null
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-map1-apply.sh > "$tmp/drift.txt" 2>&1; rc=$?
set -e
{ grep -E 'DRIFT|REFUSED' "$tmp/drift.txt" || true; } | sed 's/^/  | /'
[ "$rc" != 0 ] && grep -q 'DRIFT: production is not the post-C3a state' "$tmp/drift.txt" || { echo "FAIL: drifted switch not refused by the guard"; exit 1; }
P -d "$FP" -f "$tmp/switch_before.sql" >/dev/null   # restore the pre-C3c switch (the artifact's own text)
[ "$(state)" = "$PRE" ] || { echo "FAIL: state not restored after the drift probe ($(state))"; exit 1; }
echo "  PASS: refused; nothing applied"

echo "== 4. NEGATIVE CONTROL: a session holding the switch's catalog row makes the apply fail FAST"
PGAPPNAME=dc-offline-blocker P -d "$FP" -c "begin; $(cat "$tmp/switch_before.sql") select pg_sleep(40); commit;" >/dev/null 2>&1 &
blk=$!; sleep 2
t0=$(date +%s)
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_OFFLINE_ALLOW_LOCKS=1 bash scripts/dc-osm-map1-apply.sh > "$tmp/neg.txt" 2>&1; rc=$?
set -e
el=$(( $(date +%s) - t0 ))
Q "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'dc-offline-blocker'" >/dev/null
wait "$blk" 2>/dev/null || true
[ "$rc" != 0 ] && grep -qE 'lock timeout' "$tmp/neg.txt" || { sed 's/^/  | /' "$tmp/neg.txt"; echo "FAIL: the apply did not fail on lock_timeout"; exit 1; }
[ "$el" -lt 30 ] || { echo "FAIL: the lock wait was not bounded (${el}s)"; exit 1; }
[ "$(state)" = "$PRE" ] || { echo "FAIL: a failed apply left partial state ($(state))"; exit 1; }
echo "  PASS: failed on lock_timeout after ${el}s; nothing changed"

echo "== 5. the apply succeeds; live Map 1 is exactly the gate's prediction"
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-map1-apply.sh > "$tmp/ok.txt" 2>&1 || { sed 's/^/  | /' "$tmp/ok.txt"; echo "FAIL: apply exited non-zero"; exit 1; }
{ grep -E '^  (OSM_|MAP1_|QUEUE_)|DEFINITION_PARITY|^OSM MAP 1' "$tmp/ok.txt" || true; } | sed 's/^/  /'
grep -q '^OSM MAP 1 CHANGE APPLIED' "$tmp/ok.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/ok.txt" || { echo "FAIL: apply did not complete"; exit 1; }
[ "$(OSM)" = "7/2" ] || { echo "FAIL: after apply OSM rows/flagged $(OSM), expected 7/2"; exit 1; }
[ -z "$(Q "select 1 from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m where m.project_name = 'Far OSM'")" ] \
  || { echo "FAIL: Far OSM still on Map 1"; exit 1; }
echo "  PASS: $(state); OSM rows/flagged $osm_before -> $(OSM); Far OSM withheld"

echo "== 6. a second apply is refused"
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-map1-apply.sh > "$tmp/again.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/again.txt" || { echo "FAIL: second apply not refused"; cat "$tmp/again.txt"; exit 1; }
echo "  PASS: refused"

echo "== 7. ROLLBACK restores the pre-C3c Map 1 exactly; a second rollback is refused; re-apply works"
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_MODE=rollback bash scripts/dc-osm-map1-apply.sh > "$tmp/rb.txt" 2>&1 || { sed 's/^/  | /' "$tmp/rb.txt"; echo "FAIL: rollback exited non-zero"; exit 1; }
grep -q '^OSM MAP 1 CHANGE ROLLED BACK' "$tmp/rb.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/rb.txt" || { echo "FAIL: rollback did not complete"; exit 1; }
[ "$(state)" = "$PRE" ] && [ "$(M1)" = "$map_before" ] || { echo "FAIL: rollback did not restore the pre-C3c state and Map 1"; exit 1; }
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_MODE=rollback bash scripts/dc-osm-map1-apply.sh > "$tmp/rb2.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/rb2.txt" || { echo "FAIL: second rollback not refused"; cat "$tmp/rb2.txt"; exit 1; }
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-osm-map1-apply.sh > "$tmp/re.txt" 2>&1 || { sed 's/^/  | /' "$tmp/re.txt"; echo "FAIL: re-apply failed"; exit 1; }
[ "$(OSM)" = "7/2" ] || { echo "FAIL: re-apply OSM rows/flagged $(OSM)"; exit 1; }
echo "  PASS: Map 1 restored byte for byte ($map_before); second rollback refused; re-apply succeeds"
echo "ALL C3c GATE + APPLY OFFLINE CHECKS PASSED"
