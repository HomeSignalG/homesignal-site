#!/usr/bin/env bash
# Offline proof of the C7 AUTOMATED GATE (scripts/dc-verdict-gate.sh) and apply script
# (scripts/dc-verdict-apply.sh) against a DISPOSABLE stand-in for production ("fakeprod"): this checkout's
# DDL of record with docs/dc-verdict-rollback.sql applied (the pre-C7 verdict production carries, proven by
# that artifact's post-condition), plus the OSM suite's fixture rows and derivations, with three addresses
# given the shapes C7 is about:
#   * '10 S Shared Road' (one Atlas record + one OSM record) matched as 10 N SHARED RD, near both pins:
#     before C7 both are CORROBORATED; after, the corroboration is withdrawn from both;
#   * '11 S Dir Road' (a new OSM record) matched as 11 N DIR RD ~12 km away: before C7 the pin is WITHHELD
#     (SOURCES_DISAGREE); after, the disagreement was never evidence and the pin is RESTORED;
#   * '30 Far Lane' matched as 30 E FAR LN: a query WITHOUT a direction. C7 must leave it alone.
#   1. the GATE PASSES on the real artifact: 2 flips, 1 restored, 2 corroborations withdrawn, 0 removed;
#   2. the GATE REFUSES a wrong verdict that also rejects a directionless query (Far Lane): the artifact's
#      own post-condition passes, only the gate's independent prediction catches it;
#   3. the apply refuses drift; 4. fails fast on a held lock; 5. succeeds; after the :35 resolver the live
#      Map 1 equals the gate's replica result; 6. a second apply is refused; 7. rollback + resolver
#      restores the pre-C7 Map 1 exactly, a second rollback is refused, and re-apply works.
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod_verdict
cd "$root"

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -c "create extension if not exists postgis" >/dev/null 2>&1 || true
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  P -d "$FP" -f "$f" >/dev/null
done
awk '/^-- ── PHASE A: the C3a deployment/{exit} {print}' test/dc_osm_layer_pg/suite.sql > "$tmp/fixture.sql"
grep -q '^create temp table _obs_fp as' "$tmp/fixture.sql" || { echo "FAIL: the OSM suite's fixture section was not located"; exit 1; }
# the shared Atlas + OSM address gains a leading direction (both occurrences, exactly)
python3 - "$tmp/fixture.sql" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
for old, new in ((" pg_temp.addr('10', 'Shared Road', 'Sharedton')", " pg_temp.addr('10', 'S Shared Road', 'Sharedton')"),
                 ("'street', '10 Shared Road'", "'street', '10 S Shared Road'")):
    assert s.count(old) == 1, old
    s = s.replace(old, new)
open(p, 'w').write(s)
PY
P -d "$FP" <<SQL >/dev/null
\i $tmp/fixture.sql
-- [O10] a precise pin withheld ONLY because its address matched the opposite side of the road
select pg_temp.osm(10, 'Dir OSM', 45.05, -100.80, 'precise_location', pg_temp.addr('11', 'S Dir Road', 'Dirton'));
create table if not exists public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary on conflict do nothing;
insert into public.dc_address_geocode (geocoder_query, canonical_addr, ladder_version, provider, match_type, lat, lng,
                                       matched_address, provider_candidates, run_ref)
select q, upper(q), public.dc_geocode_ladder_version(), p, mt, la, ln, ma, c, 'verdict-offline' from (values
 ('20 Osm Road, Osmton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.1050, -100.9050, '20 OSM RD, OSMTON, SD, 57031', 1),
 ('30 Far Lane, Farton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2000, -100.8500, '30 E FAR LN, FARTON, SD, 57031', 1),
 ('40 Fail Way, Failton, SD 57031', 'none', 'failed', null, null, null, null),
 ('60 Area Road, Areaton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.4010, -100.9010, '60 AREA RD, ARETON, SD, 57031', 1),
 ('10 S Shared Road, Sharedton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.2505, -100.7005, '10 N SHARED RD, SHAREDTON, SD, 57031', 1),
 ('11 S Dir Road, Dirton, SD 57031', 'census_onelineaddress', 'range_interpolated', 45.0500, -100.9500, '11 N DIR RD, DIRTON, SD, 57031', 1)
) v(q, p, mt, la, ln, ma, c);
SQL
P -d "$FP" -f docs/dc-verdict-rollback.sql >/dev/null || { echo "FAIL: could not reach the pre-C7 verdict"; exit 1; }
RESOLVE() { P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_canonical(true, false)" >/dev/null
            P -d "$FP" -tA -c "select count(*) >= 0 from public.dc_resolve_geography(true)" >/dev/null; }
RESOLVE
URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT:-5432}/$FP"
Q() { P -d "$FP" -tA -c "$1"; }
state() { Q "select (select md5(prosrc) from pg_proc where proname = 'dc_derived_point_verdict') || '/' || (select md5(prosrc) from pg_proc where proname = 'dc_derived_address_admitted') || '/' || (select md5(prosrc) from pg_proc where proname = 'map1_dc_zip_members')"; }
M1() { Q "select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m) x"; }
# rows / flagged, for OSM and canonical separately, plus whether Dir OSM is drawn
SHAPE() { Q "select count(*) filter (where publication_basis = 'legacy_osm_compat') || '/' || count(*) filter (where publication_basis = 'legacy_osm_compat' and quality_flags <> '{}')
               || ' canon ' || count(*) filter (where publication_basis = 'canonical') || '/' || count(*) filter (where publication_basis = 'canonical' and 'CORROBORATED_BY_DERIVED_ADDRESS' = any (quality_flags))
               || ' dir ' || count(*) filter (where project_name = 'Dir OSM')
             from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"; }
PRE="4cd5b97def7d6179900cd95ec452d9a7/2c05d65aba736fab7c79199e78614ab6/2146b68afc2cda03948b1e1cd51b29b8"
[ "$(state)" = "$PRE" ] || { echo "FAIL: fakeprod is not the pre-C7 state ($(state))"; exit 1; }
[ "$(Q "select check_outcome from public.dc_osm_address_check c join public.national_dc_records n on n.id = c.osm_record_id where n.project_name = 'Dir OSM'")" = SOURCES_DISAGREE ] \
  && [ "$(Q "select check_outcome from public.dc_osm_address_check c join public.national_dc_records n on n.id = c.osm_record_id where n.project_name = 'Shared OSM'")" = CORROBORATED ] \
  || { echo "FAIL: control: fakeprod's C7 cases are not in their pre-C7 shape"; exit 1; }
map_before="$(M1)"; shape_before="$(SHAPE)"
echo "  fakeprod: $(state); OSM rows/flagged, canonical rows/corroborated, Dir OSM drawn: $shape_before"
[ "$shape_before" != "${shape_before/ dir 0/}" ] || { echo "FAIL: control: Dir OSM should be withheld before C7 ($shape_before)"; exit 1; }

echo "== 1. THE GATE PASSES on the committed artifact"
PROD_DB_URL="$URL" bash scripts/dc-verdict-gate.sh > "$tmp/gate.txt" 2>&1 || { sed 's/^/  | /' "$tmp/gate.txt"; echo "FAIL: the gate refused the real change"; exit 1; }
{ grep -E '^(G[0-9]+_|CHANGE|GATE|  PARITY|  (baseline|after-change|steady))' "$tmp/gate.txt" || true; } | sed 's/^/  /'
grep -q '^G02_EVERY_FLIP_IS_ACCEPTED_TO_MATCH_DIVERGES|true|2 addresses flipped$' "$tmp/gate.txt" \
  && grep -q '^G06_EVERY_ADDED_ROW_WAS_WITHHELD_ON_A_FLIPPED_DISAGREEMENT|true|1 added$' "$tmp/gate.txt" \
  && grep -q '^G07_EVERY_REMOVED_ROW_WAS_PLACED_ON_A_FLIPPED_DERIVED_POINT|true|0 removed$' "$tmp/gate.txt" \
  && grep -q '^G08_EVERY_CHANGED_ROW_ONLY_DROPS_THE_CORROBORATION|true|2 corroborations withdrawn$' "$tmp/gate.txt" \
  && grep -q '^CHANGE|RESTORED|99931 osm:way/10 Dir OSM$' "$tmp/gate.txt" \
  || { echo "FAIL: the gate passed but not with exactly 2 flips, Dir OSM restored and 2 corroborations withdrawn"; exit 1; }
[ "$(state)" = "$PRE" ] && [ "$(M1)" = "$map_before" ] || { echo "FAIL: the gate changed \"production\""; exit 1; }
echo "  PASS: 2 flips; Dir OSM restored; 2 corroborations withdrawn; \"production\" untouched"

echo "== 2. NEGATIVE CONTROL: the gate REFUSES a verdict that also rejects a directionless query"
cp docs/dc-verdict-apply.sql "$tmp/apply.orig"
# A CONSISTENTLY wrong artifact: the verdict changed AND the artifact's own post-condition fingerprint
# updated to match (as a wrong DDL of record regenerated through the builder would be). The artifact's
# self-check therefore passes; only the gate's INDEPENDENT prediction can catch it.
python3 - docs/dc-verdict-apply.sql <<'PY'
import hashlib, re, sys
p = sys.argv[1]; s = open(p).read()
body = lambda x: hashlib.md5(re.search(r'\bas \$fn\$(.*?)\$fn\$', x, re.S).group(1).encode()).hexdigest()
old_md5 = body(s)
old = "elsif q_dir is not null and m_dir is not null and q_dir <> m_dir then"
assert s.count(old) == 1
s = s.replace(old, "elsif m_dir is not null and q_dir is distinct from m_dir then")
assert s.count(old_md5) == 1, 'post-condition fingerprint not found exactly once'
open(p, 'w').write(s.replace(old_md5, body(s)))
PY
set +e
PROD_DB_URL="$URL" bash scripts/dc-verdict-gate.sh > "$tmp/gate_bad.txt" 2>&1; rc=$?
set -e
cp "$tmp/apply.orig" docs/dc-verdict-apply.sql
{ grep -E '^(G0[2-7]_|GATE|FAIL)' "$tmp/gate_bad.txt" || true; } | sed 's/^/  | /'
[ "$rc" != 0 ] && grep -q '^GATE REFUSED' "$tmp/gate_bad.txt" && grep -q '^G03_FLIPS_EQUAL_THE_INDEPENDENT_PREDICTION|false' "$tmp/gate_bad.txt" \
  || { echo "FAIL: the gate did not refuse a wrong verdict"; exit 1; }
echo "  PASS: refused (G03: a flip the rule does not predict)"

echo "== 3. the apply refuses drift inside the artifact"
python3 - docs/dc-verdict-rollback.sql > "$tmp/verdict_before.sql" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"create or replace function public\.dc_derived_point_verdict\(.*?\$fn\$;", s, re.S)
assert m; print(m.group(0))
PY
sed 's/an area centroid is not a site/an area centroid is not a site (drifted)/' "$tmp/verdict_before.sql" > "$tmp/verdict_drift.sql"
cmp -s "$tmp/verdict_before.sql" "$tmp/verdict_drift.sql" && { echo "FAIL: control: the drift edit did not change the body"; exit 1; }
P -d "$FP" -f "$tmp/verdict_drift.sql" >/dev/null
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-verdict-apply.sh > "$tmp/drift.txt" 2>&1; rc=$?
set -e
{ grep -E 'DRIFT|REFUSED' "$tmp/drift.txt" || true; } | sed 's/^/  | /'
[ "$rc" != 0 ] && grep -qE 'REFUSED: production already carries this change, or has drifted|DRIFT: production is not the pre-C7 state' "$tmp/drift.txt" \
  || { echo "FAIL: drifted verdict not refused"; exit 1; }
P -d "$FP" -f "$tmp/verdict_before.sql" >/dev/null   # restore the pre-C7 verdict (the artifact's own text)
[ "$(state)" = "$PRE" ] || { echo "FAIL: state not restored after the drift probe ($(state))"; exit 1; }
echo "  PASS: refused; nothing applied"

echo "== 4. NEGATIVE CONTROL: a session holding the verdict's catalog row makes the apply fail FAST"
PGAPPNAME=dc-offline-blocker P -d "$FP" -c "begin; $(cat "$tmp/verdict_before.sql") select pg_sleep(40); commit;" >/dev/null 2>&1 &
blk=$!; sleep 2
t0=$(date +%s)
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_OFFLINE_ALLOW_LOCKS=1 bash scripts/dc-verdict-apply.sh > "$tmp/neg.txt" 2>&1; rc=$?
set -e
el=$(( $(date +%s) - t0 ))
Q "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'dc-offline-blocker'" >/dev/null
wait "$blk" 2>/dev/null || true
[ "$rc" != 0 ] && grep -qE 'lock timeout' "$tmp/neg.txt" || { sed 's/^/  | /' "$tmp/neg.txt"; echo "FAIL: the apply did not fail on lock_timeout"; exit 1; }
[ "$el" -lt 30 ] || { echo "FAIL: the lock wait was not bounded (${el}s)"; exit 1; }
[ "$(state)" = "$PRE" ] || { echo "FAIL: a failed apply left partial state ($(state))"; exit 1; }
echo "  PASS: failed on lock_timeout after ${el}s; nothing changed"

echo "== 5. the apply succeeds; after the resolver, live Map 1 carries exactly the gated change"
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-verdict-apply.sh > "$tmp/ok.txt" 2>&1 || { sed 's/^/  | /' "$tmp/ok.txt"; echo "FAIL: apply exited non-zero"; exit 1; }
{ grep -E '^  (VERDICT_|QUEUE_)|DEFINITION_PARITY|^VERDICT CHANGE' "$tmp/ok.txt" || true; } | sed 's/^/  /'
grep -q '^VERDICT CHANGE APPLIED' "$tmp/ok.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/ok.txt" || { echo "FAIL: apply did not complete"; exit 1; }
RESOLVE
shape_after="$(SHAPE)"
want="$(python3 - "$shape_before" <<'PY'
import re, sys
o, of, c, cf, d = map(int, re.match(r'(\d+)/(\d+) canon (\d+)/(\d+) dir (\d+)', sys.argv[1]).groups())
print(f'{o + 1}/{of - 1} canon {c}/{cf - 1} dir {d + 1}')   # Dir OSM restored; Shared OSM + Shared Atlas uncorroborated
PY
)"
[ "$shape_after" = "$want" ] || { echo "FAIL: after apply + resolver the Map 1 shape is $shape_after, expected $want"; exit 1; }
echo "  PASS: $(state); $shape_before -> $shape_after"

echo "== 6. a second apply is refused"
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-verdict-apply.sh > "$tmp/again.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/again.txt" || { echo "FAIL: second apply not refused"; cat "$tmp/again.txt"; exit 1; }
echo "  PASS: refused"

echo "== 7. ROLLBACK + resolver restores the pre-C7 Map 1 exactly; a second rollback is refused; re-apply works"
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_MODE=rollback bash scripts/dc-verdict-apply.sh > "$tmp/rb.txt" 2>&1 || { sed 's/^/  | /' "$tmp/rb.txt"; echo "FAIL: rollback exited non-zero"; exit 1; }
grep -q '^VERDICT CHANGE ROLLED BACK' "$tmp/rb.txt" && grep -q 'DEFINITION_PARITY PASS' "$tmp/rb.txt" || { echo "FAIL: rollback did not complete"; exit 1; }
RESOLVE
[ "$(state)" = "$PRE" ] && [ "$(M1)" = "$map_before" ] || { echo "FAIL: rollback + resolver did not restore the pre-C7 state and Map 1"; exit 1; }
set +e
PROD_DB_URL="$URL" DCO_OFFLINE=1 DCO_MODE=rollback bash scripts/dc-verdict-apply.sh > "$tmp/rb2.txt" 2>&1; rc=$?
set -e
[ "$rc" != 0 ] && grep -q 'already carries this change' "$tmp/rb2.txt" || { echo "FAIL: second rollback not refused"; cat "$tmp/rb2.txt"; exit 1; }
PROD_DB_URL="$URL" DCO_OFFLINE=1 bash scripts/dc-verdict-apply.sh > "$tmp/re.txt" 2>&1 || { sed 's/^/  | /' "$tmp/re.txt"; echo "FAIL: re-apply failed"; exit 1; }
RESOLVE
[ "$(SHAPE)" = "$want" ] || { echo "FAIL: re-apply shape $(SHAPE)"; exit 1; }
echo "  PASS: Map 1 restored byte for byte ($map_before); second rollback refused; re-apply succeeds"
echo "ALL C7 GATE + APPLY OFFLINE CHECKS PASSED"
