#!/usr/bin/env bash
# Offline proof of the same-building AUTOMATED GATE (scripts/dc-osm-dedupe-gate.sh) and apply script
# (scripts/dc-osm-dedupe-apply.sh) against a DISPOSABLE stand-in for production ("fakeprod"): this checkout's
# DDL of record with docs/dc-osm-dedupe-rollback.sql applied (the state production carries on 2026-10-23,
# proven by that artifact's post-condition), the OSM suite's fixture rows, and three added OSM pins:
#   TWIN   the same name as the fixture's published canonical pin, ~55 m away -> the ruling hides it
#   CODE   the same brand with a site code the canonical pin does not carry    -> kept
#   OTHER  an unrelated name, ~55 m away                                       -> kept (distance never decides)
#   1. the GATE PASSES on the real artifact, hiding exactly TWIN;
#   2. the GATE REFUSES a CONSISTENTLY wrong artifact (the name test removed, its own post-condition
#      fingerprint updated to match): distance alone then decides, and the removals no longer match the
#      prediction;
#   3. the apply refuses drift; 4. fails fast on a held lock; 5. succeeds, and live Map 1 then lacks
#      exactly TWIN; 6. a second apply is refused; 7. rollback restores Map 1 exactly, a second rollback
#      is refused, and re-apply works.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"; osm="$root/test/dc_osm_layer_pg"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod_osm_dedupe
cd "$root"

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -c "create extension if not exists postgis" >/dev/null 2>&1 || true
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  P -d "$FP" -f "$f" >/dev/null
done
awk '/^-- ── PHASE A: the C3a deployment/{exit} {print}' "$osm/suite.sql" > "$tmp/fixture.sql"
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
P -d "$FP" -f docs/dc-osm-dedupe-rollback.sql >/dev/null || { echo "FAIL: could not reach the 2026-10-23 state"; exit 1; }
P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_canonical(true, false)" >/dev/null
P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_geography(true)" >/dev/null
# the three added OSM pins, all ~55 m from the fixture's one published canonical pin
P -d "$FP" <<'SQL' >/dev/null
create temp table _c as
select r.zip, m.*
  from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m
 where m.publication_basis = 'canonical';
do $$ begin if (select count(*) from _c) <> 1 then raise exception 'control: expected exactly 1 published canonical pin'; end if; end $$;
insert into public.national_dc_records
  (source_key, source_record_id, osm_type, source_url, project_name, developer_or_operator, raw_status,
   normalized_status, lat, lng, location_precision, map_eligible, map_exclusion_reason)
select 'osm:dedupe/' || v.k, v.k, 'way', 'https://example.test/dedupe/' || v.k,
       coalesce(v.nm, c.project_name), null, 'operational', 'operational',
       c.lat + v.dlat, c.lng + v.dlng, 'precise_location', true, null
  from _c c
 cross join (values ('twin', null::text, 0.0005, 0.0), ('code', 'Shared QQ1', -0.0005, 0.0),
                    ('other', 'Completely Unrelated Facility', 0.0, 0.0006)) v(k, nm, dlat, dlng);
SQL
URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/$FP"
Q() { P -d "$FP" -tA -c "$1"; }
state() { Q "select (to_regprocedure('public.dc_names_same_site(text,text,text,text)') is not null) || '/' || (select md5(prosrc) from pg_proc where proname = 'map1_dc_zip_members')"; }
M1() { Q "select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) x"; }
ADDED() { Q "select coalesce(string_agg(m.source_key, ',' order by m.source_key collate \"C\"), '') from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m where m.source_key like 'osm:dedupe/%'"; }
PRE="false/2146b68afc2cda03948b1e1cd51b29b8"
[ "$(state)" = "$PRE" ] || { echo "FAIL: fakeprod is not the 2026-10-23 state ($(state))"; exit 1; }
[ "$(ADDED)" = "osm:dedupe/code,osm:dedupe/other,osm:dedupe/twin" ] || { echo "FAIL: control: the three added pins are not all on Map 1 before ($(ADDED))"; exit 1; }
map_before="$(M1)"
echo "  fakeprod: $(state); added pins on Map 1: $(ADDED)"

echo "== 1. THE GATE PASSES on the committed artifact"
PROD_DB_URL="$URL" bash scripts/dc-osm-dedupe-gate.sh > "$tmp/gate.txt" 2>&1 || { sed 's/^/  | /' "$tmp/gate.txt"; echo "FAIL: the gate refused the real change"; exit 1; }
{ grep -E '^(G[0-9]+_|CHANGE|GATE|  PARITY)' "$tmp/gate.txt" || true; } | sed 's/^/  /'
grep -q '^G03_REMOVED_EQUALS_PREDICTION_EXACTLY|true|1 removed / 1 predicted' "$tmp/gate.txt" \
  && grep -qE '^CHANGE\|HIDDEN\|[0-9]+ osm:dedupe/twin ' "$tmp/gate.txt" \
  && [ "$(grep -c '^CHANGE|HIDDEN|' "$tmp/gate.txt")" = 1 ] \
  || { echo "FAIL: the gate passed but did not hide exactly the twin"; exit 1; }
[ "$(state)" = "$PRE" ] && [ "$(M1)" = "$map_before" ] || { echo "FAIL: the gate changed \"production\""; exit 1; }
echo "  PASS: exactly the twin hidden; \"production\" untouched"

echo "== 2. NEGATIVE CONTROL: the gate REFUSES a consistently wrong artifact (distance alone decides)"
python3 - docs/dc-osm-dedupe-apply.sql "$tmp/bad.sql" <<'PY'
import hashlib, re, sys
s = open(sys.argv[1]).read()
body = lambda x: hashlib.md5(re.search(r'\bas \$function\$(.*?)\$function\$', x, re.S).group(1).encode()).hexdigest()
old_md5 = body(s)
old = ("\n       and public.dc_names_same_site(o.project_name, o.developer_or_operator,\n"
       "                                     c.project_name, c.developer_or_operator)")
assert s.count(old) == 1
s = s.replace(old, "")
assert s.count(old_md5) == 1, 'post-condition fingerprint not found exactly once'
open(sys.argv[2], 'w').write(s.replace(old_md5, body(s)))
PY
cp "$tmp/bad.sql" docs/dc-osm-dedupe-bad.sql
set +e
PROD_DB_URL="$URL" DCD_GATE_ARTIFACT=docs/dc-osm-dedupe-bad.sql bash scripts/dc-osm-dedupe-gate.sh > "$tmp/gate_bad.txt" 2>&1; rc=$?
set -e
rm -f docs/dc-osm-dedupe-bad.sql
{ grep -E '^(G03_|GATE|FAIL)' "$tmp/gate_bad.txt" || true; } | sed 's/^/  | /'
[ "$rc" != 0 ] && grep -q '^GATE REFUSED' "$tmp/gate_bad.txt" && grep -q '^G03_REMOVED_EQUALS_PREDICTION_EXACTLY|false' "$tmp/gate_bad.txt" \
  || { echo "FAIL: the gate did not refuse a wrong reader"; exit 1; }
echo "  PASS: refused (G03 names the unexplained removals)"

echo "== 3. the apply refuses drift inside the artifact"
P -d "$FP" -c "create function public.dc_names_same_site(text, text, text, text) returns boolean language sql immutable as 'select false'" >/dev/null
set +e
PROD_DB_URL="$URL" DCD_OFFLINE=1 bash scripts/dc-osm-dedupe-apply.sh > "$tmp/drift.txt" 2>&1; rc=$?
set -e
{ grep -E 'DRIFT|REFUSED' "$tmp/drift.txt" || true; } | sed 's/^/  | /'
[ "$rc" != 0 ] && grep -q 'production already carries this change' "$tmp/drift.txt" || { echo "FAIL: a pre-existing helper was not refused"; exit 1; }
P -d "$FP" -c "drop function public.dc_names_same_site(text, text, text, text)" >/dev/null
# the artifact's own in-transaction guard refuses too, when run directly (no preflight)
P -d "$FP" -c "create function public.dc_names_same_site(text, text, text, text) returns boolean language sql immutable as 'select false'" >/dev/null
set +e
P -d "$FP" -f docs/dc-osm-dedupe-apply.sql > "$tmp/drift2.txt" 2>&1; rc=$?
set -e
P -d "$FP" -c "drop function public.dc_names_same_site(text, text, text, text)" >/dev/null
[ "$rc" != 0 ] && grep -q 'DRIFT: production is not the 2026-10-23 state' "$tmp/drift2.txt" || { cat "$tmp/drift2.txt"; echo "FAIL: the artifact's guard did not refuse"; exit 1; }
[ "$(state)" = "$PRE" ] || { echo "FAIL: state not restored after the drift probe ($(state))"; exit 1; }
echo "  PASS: refused; nothing applied"

echo "== 4. NEGATIVE CONTROL: a session holding the reader's catalog row makes the apply fail FAST"
# the blocker locks the reader's catalog row without naming it (a session naming the reader is refused
# earlier, by the preflight's active-session check, which would prove nothing about the lock wait)
PGAPPNAME=dc-offline-blocker P -d "$FP" -c "begin; select 1 from pg_proc where proname = concat('map1_dc', '_zip_members') for update; select pg_sleep(40); commit;" >/dev/null 2>&1 &
blk=$!; sleep 2
t0=$(date +%s)
set +e
PROD_DB_URL="$URL" DCD_OFFLINE=1 DCD_OFFLINE_ALLOW_LOCKS=1 bash scripts/dc-osm-dedupe-apply.sh > "$tmp/neg.txt" 2>&1; rc=$?
set -e
el=$(( $(date +%s) - t0 ))
Q "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'dc-offline-blocker'" >/dev/null
wait "$blk" 2>/dev/null || true
[ "$rc" != 0 ] && grep -qE 'lock timeout' "$tmp/neg.txt" || { sed 's/^/  | /' "$tmp/neg.txt"; echo "FAIL: the apply did not fail on lock_timeout"; exit 1; }
[ "$el" -lt 30 ] || { echo "FAIL: the lock wait was not bounded (${el}s)"; exit 1; }
[ "$(state)" = "$PRE" ] || { echo "FAIL: a failed apply left partial state ($(state))"; exit 1; }
echo "  PASS: failed on lock_timeout after ${el}s; nothing changed"

echo "== 5. the apply succeeds; live Map 1 lacks exactly the twin"
PROD_DB_URL="$URL" DCD_OFFLINE=1 bash scripts/dc-osm-dedupe-apply.sh > "$tmp/ok.txt" 2>&1 || { sed 's/^/  | /' "$tmp/ok.txt"; echo "FAIL: apply exited non-zero"; exit 1; }
{ grep -E '^  (HELPER|MAP1_|QUEUE_)|DEFINITION_PARITY|^SAME-BUILDING' "$tmp/ok.txt" || true; } | sed 's/^/  /'
grep -q '^SAME-BUILDING RULE APPLIED' "$tmp/ok.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/ok.txt" || { echo "FAIL: apply did not complete"; exit 1; }
[ "$(ADDED)" = "osm:dedupe/code,osm:dedupe/other" ] || { echo "FAIL: after apply the added pins read $(ADDED)"; exit 1; }
echo "  PASS: $(state); added pins on Map 1 now: $(ADDED)"

echo "== 6. a second apply is refused"
set +e
PROD_DB_URL="$URL" DCD_OFFLINE=1 bash scripts/dc-osm-dedupe-apply.sh > "$tmp/again.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/again.txt" || { echo "FAIL: second apply not refused"; cat "$tmp/again.txt"; exit 1; }
echo "  PASS: refused"

echo "== 7. ROLLBACK restores Map 1 exactly; a second rollback is refused; re-apply works"
PROD_DB_URL="$URL" DCD_OFFLINE=1 DCD_MODE=rollback bash scripts/dc-osm-dedupe-apply.sh > "$tmp/rb.txt" 2>&1 || { sed 's/^/  | /' "$tmp/rb.txt"; echo "FAIL: rollback exited non-zero"; exit 1; }
grep -q '^SAME-BUILDING RULE ROLLED BACK' "$tmp/rb.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/rb.txt" || { echo "FAIL: rollback did not complete"; exit 1; }
[ "$(state)" = "$PRE" ] && [ "$(M1)" = "$map_before" ] || { echo "FAIL: rollback did not restore the state and Map 1"; exit 1; }
set +e
PROD_DB_URL="$URL" DCD_OFFLINE=1 DCD_MODE=rollback bash scripts/dc-osm-dedupe-apply.sh > "$tmp/rb2.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/rb2.txt" || { echo "FAIL: second rollback not refused"; cat "$tmp/rb2.txt"; exit 1; }
PROD_DB_URL="$URL" DCD_OFFLINE=1 bash scripts/dc-osm-dedupe-apply.sh > "$tmp/re.txt" 2>&1 || { sed 's/^/  | /' "$tmp/re.txt"; echo "FAIL: re-apply failed"; exit 1; }
[ "$(ADDED)" = "osm:dedupe/code,osm:dedupe/other" ] || { echo "FAIL: re-apply added pins $(ADDED)"; exit 1; }
echo "  PASS: Map 1 restored byte for byte ($map_before); second rollback refused; re-apply succeeds"
echo "ALL SAME-BUILDING GATE + APPLY OFFLINE CHECKS PASSED"
