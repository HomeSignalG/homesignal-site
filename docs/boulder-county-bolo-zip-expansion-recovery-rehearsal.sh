#!/bin/bash
# Local rehearsal harness for the ZIP-expansion recovery. DISPOSABLE LOCAL DATABASES ONLY; never point at a shared or
# production server. See the doc for the prerequisites and how each input file is produced.
#   usage: PGHOST=/path/to/socket PGPORT=5432 PGUSER=postgres DIR=/path/to/inputs ./rehearse.sh
# DIR must contain: fixtures.sql, functions.sql, zips.txt, forward.sql, recovery.sql, rh-expected-md5.txt
set -u
DIR=${DIR:?}; DB=${DB:-rh}
ADMIN="psql -X -q -v ON_ERROR_STOP=1 -d postgres"
PSQL="psql -X -q -v ON_ERROR_STOP=1 -d $DB"
cd "$DIR"
pass=0; fail=0
ok(){ echo "PASS  $1"; pass=$((pass+1)); }
bad(){ echo "FAIL  $1"; fail=$((fail+1)); }
snap(){ $PSQL -Atq -F' | ' -c "select * from rh_state()"; }
runfile(){ $PSQL -At -c "$(cat $1)" 2>&1; echo "EXIT=$?"; }
build(){
  $ADMIN -c "drop database if exists $DB" -c "create database $DB" || exit 2
  python3 -I - <<'PY' > registry_roots.sql
z=open('zips.txt').read().split()
print("insert into public.canonical_zip_registry (zip,gold_master_version,workbook_sha256) values")
print(",\n".join("('%s','2.4','baseline-fixture')"%x for x in z)+";")
print("insert into public.communities (id,name,county,state,zip_codes,level,government_topics,slug) values")
print("('0df863af-f218-4177-a885-fbffa17a5ec3','Boulder County','Boulder','CO',array['80301','80302','80303','80304','80305','80501','80503'],'county','{}','boulder-county-co'),")
print("('89204fa7-3f7f-47e2-a86a-31df5054d8ef','Jefferson County','Jefferson','CO',array['80001','80002','80004','80005','80007','80123','80127','80401','80403','80439'],'county','{}','jefferson-county-co');")
PY
  for f in fixtures.sql functions.sql registry_roots.sql; do $PSQL -f $f || { echo "build failed: $f"; exit 2; }; done
  got=$($PSQL -Atq -c "select (select md5(string_agg(zip,',' order by zip collate \"C\")) from canonical_zip_registry)||' '||(select string_agg(md5(prosrc),',' order by proname) from pg_proc where proname in ('canonical_zip_guard_selftest','enforce_canonical_zip','alert_catalog_absorb_offered_topics'))")
  [ "$got" = "$(cat rh-expected-md5.txt)" ] || { echo "FIDELITY CHECK FAILED: local baseline md5s '$got' differ from rh-expected-md5.txt"; exit 2; }
  snap > baseline.state
}
refuse(){ # name perturb revert needle
  SAVED=$($PSQL -Atq -F'~' -c "select string_agg(slug||'='||zip_codes::text, '~') from communities where level='county'")
  $PSQL -c "$2" >/dev/null 2>&1 || { bad "$1 (perturbation failed)"; return; }
  snap > s_pre.txt; out=$(runfile recovery.sql); snap > s_post.txt
  echo "$out" | grep -q 'EXIT=1' && echo "$out" | grep -qi "${4:-refusing}" && cmp -s s_pre.txt s_post.txt && ok "$1 refused, state unchanged" || { bad "$1"; echo "$out" | head -4; }
  $PSQL -c "$3" >/dev/null 2>&1 || echo "   (revert failed for $1)"
  for kv in ${SAVED//\~/ }; do $PSQL -c "update communities set zip_codes='${kv#*=}'::text[] where slug='${kv%%=*}'" >/dev/null; done
}
FWD="$PSQL -At -c \"\$(cat forward.sql)\""
# ===== P2: pre-existing membership scenarios (fresh baseline)
build
out=$($PSQL -c "update communities set zip_codes = zip_codes || array['80026'] where slug='boulder-county-co'" 2>&1); echo "$out" | grep -q 'not in the approved Gold Master registry' && ok "G1 guard: a ZIP outside the registry cannot be written into a county array" || bad "G1"
$PSQL -c "insert into canonical_zip_registry values ('80026','2.3','pre-existing'); update communities set zip_codes = zip_codes || array['80026'] where slug='boulder-county-co'" >/dev/null
out=$(runfile forward.sql); echo "$out" | grep -q 'EXIT=0' || bad "P2 forward"
snap > s_pre.txt; out=$(runfile recovery.sql); snap > s_post.txt
echo "$out" | grep -q 'EXIT=1' && echo "$out" | grep -q 'not the expansion output' && cmp -s s_pre.txt s_post.txt && ok "P2 pre-existing registry+array ZIP: recovery refuses (registry row is not forward output), state unchanged" || { bad "P2"; echo "$out"|head -3; }
# ===== main flow (fresh baseline)
build
snap > s_base.txt; cmp -s s_base.txt baseline.state && ok "S0 baseline equals verified baseline" || bad "S0"
out=$(runfile forward.sql); echo "$out" | grep -q 'EXIT=0' && ok "S1 forward applies" || { bad "S1"; echo "$out"; }
snap > s_exp.txt
out=$(runfile recovery.sql); echo "$out" | tail -2
echo "$out" | grep -q 'EXIT=0' && echo "$out" | grep -q 'ZIP_EXPANSION_RECOVERY_OK|recovered|12746|ad61d07cabc455edd9468e1ed0401a74|0|0|8d6bee1c736996ab9c1a6ff64247ab95' && ok "S2 recovery runs; reference data for the ZIPs (zcta_boundary, place_overlap) did not block; receipt correct" || bad "S2"
snap > s_rec.txt; cmp -s s_rec.txt baseline.state && ok "S3 recovered logical state equals the verified baseline (registry, communities, arrays, guard body, catalog, dependents)" || { bad "S3"; diff s_rec.txt baseline.state; }
out=$(runfile recovery.sql); echo "$out" | grep -q 'EXIT=0' && echo "$out" | grep -q 'already_recovered_no_change' && ok "S4 repeat run is an explicit no-op" || bad "S4"
snap > s_rec2.txt; cmp -s s_rec2.txt baseline.state && ok "S4b repeat leaves baseline unchanged" || bad "S4b"
runfile forward.sql >/dev/null; snap > s_exp.txt
ID=$($PSQL -Atq -c "select id from communities where slug='boulder-80310'")
refuse "R1 altered ZIP page name" "update communities set name='X' where slug='lafayette-80026'" "update communities set name='Lafayette (80026)' where slug='lafayette-80026'"
refuse "R2 altered registry row" "update canonical_zip_registry set workbook_sha256='x' where zip='80310'" "update canonical_zip_registry set workbook_sha256='6010b50953d2123330397e52d54163486e5705b882ed3dfdc4ad70ed0a990f12' where zip='80310'"
refuse "R3a FK dependent (alerts)" "insert into alerts(community_id) values ('$ID')" "delete from alerts" "dependent or serving"
refuse "R3b text community_id (feeds)" "insert into feeds values ('f1','$ID')" "delete from feeds" "dependent or serving"
refuse "R3c zip_code reference (events)" "insert into events(zip_code) values ('80026')" "delete from events" "dependent or serving"
refuse "R3d char(5) zip reference" "insert into app_zip_geography_cutover values ('80027')" "delete from app_zip_geography_cutover" "dependent or serving"
refuse "R3e zip request row" "insert into zip_request_builds(zip) values ('80021')" "delete from zip_request_builds" "dependent or serving"
refuse "R3f cascading FK row (self_reports)" "insert into self_reports(community_id) values ('$ID')" "delete from self_reports" "dependent or serving"
refuse "R4a duplicate ZIP in Boulder array" "update communities set zip_codes = zip_codes || array['80026'] where slug='boulder-county-co'" "select 1" "county ZIP array"
refuse "R4b Boulder ZIP in Jefferson array" "update communities set zip_codes = zip_codes || array['80310'] where slug='jefferson-county-co'" "select 1" "county ZIP array"
refuse "R4c pinned baseline ZIP missing from array" "update communities set zip_codes = array_remove(zip_codes,'80301') where slug='boulder-county-co'" "select 1" "ambiguous"
refuse "R4d added ZIP positioned before baseline" "update communities set zip_codes = array['80026'] || array_remove(zip_codes,'80026') where slug='boulder-county-co'" "select 1" "not positioned after"
refuse "R5 another community claims a ZIP" "insert into communities(name,county,state,zip_codes,level,slug) values ('X','Boulder','CO',array['80310'],'zip','x-80310')" "delete from communities where slug='x-80310'" "another community"
refuse "R6 guard body altered" "do \$\$ declare s text; begin select prosrc into s from pg_proc where proname='canonical_zip_guard_selftest'; execute format('create or replace function public.canonical_zip_guard_selftest() returns table (case_name text, expected text, blocked boolean, passed boolean, detail text) language plpgsql security definer set search_path = public, pg_temp as %L', s||E'\n-- later edit'); end \$\$" "do \$\$ declare s text; begin select prosrc into s from pg_proc where proname='canonical_zip_guard_selftest'; execute format('create or replace function public.canonical_zip_guard_selftest() returns table (case_name text, expected text, blocked boolean, passed boolean, detail text) language plpgsql security definer set search_path = public, pg_temp as %L', replace(s,E'\n-- later edit','')); end \$\$" "changed after expansion"
refuse "R7 v2 city row exists" "insert into communities(name,county,state,zip_codes,level,slug,parent_id) values ('Boulder','Boulder','CO','{}','city','boulder-co',(select id from communities where slug='boulder-county-co'))" "delete from communities where slug='boulder-co'" "v2 rollback"
refuse "R8 extra registry ZIP" "insert into canonical_zip_registry values ('80306','2.5','independent')" "delete from canonical_zip_registry where zip='80306'" "registry outside"
refuse "R9 child parented to a ZIP page" "insert into communities(name,county,state,zip_codes,level,slug,parent_id) values ('Kid','Boulder','CO','{}','city','kid',(select id from communities where slug='boulder-80310'))" "delete from communities where slug='kid'" "parented"
refuse "R10 partial state" "delete from communities where slug='broomfield-80021'" "insert into communities(name,county,state,zip_codes,level,parent_id,government_topics,slug) select 'Broomfield (80021)','Jefferson','CO',array['80021'],'zip',(select id from communities where slug='jefferson-county-co'),'{}','broomfield-80021'" "partial or mixed"
refuse "R11 generation opened after expansion" "insert into geo.n5_generation values ('gen-new','ACTIVE', now() + interval '1 second')" "delete from geo.n5_generation where generation_id='gen-new'" "generation was opened"
refuse "R12 generation still building" "insert into geo.n5_generation values ('gen-b','BUILDING','2026-11-02 00:40:00+00')" "delete from geo.n5_generation where generation_id='gen-b'" "generation was opened"
refuse "R13 serving status row" "insert into geo.maps_zip_geography_status values ('gen-old','80026')" "delete from geo.maps_zip_geography_status" "geo.maps_zip_geography_status"
refuse "R14 serving membership row" "insert into geo.zip_authoritative_membership values ('gen-old','80027','k')" "delete from geo.zip_authoritative_membership" "geo.zip_authoritative_membership"
refuse "R15 serving marker row" "insert into geo.zip_authoritative_marker values ('gen-old','80310','k',0)" "delete from geo.zip_authoritative_marker" "geo.zip_authoritative_marker"
refuse "R16 boundary_membership row" "insert into geo.n5_boundary_membership values ('gen-old','80021','k')" "delete from geo.n5_boundary_membership" "geo.n5_boundary_membership"
refuse "R17 generation_unresolved row" "insert into geo.n5_generation_unresolved values ('gen-old','k','80026')" "delete from geo.n5_generation_unresolved" "geo.n5_generation_unresolved"
refuse "R18 maps export row" "insert into geo.maps_zip_export values ('80310')" "delete from geo.maps_zip_export" "geo.maps_zip_export"
refuse "R19 preservation community_meta row" "insert into preservation.community_meta values ('s1','80026')" "delete from preservation.community_meta" "preservation.community_meta"
refuse "R20 preservation development_report row" "insert into preservation.development_report values ('s1','80021')" "delete from preservation.development_report" "preservation.development_report"
refuse "R21 another cascading FK" "alter table alerts drop constraint alerts_community_id_fkey; alter table alerts add foreign key (community_id) references communities(id) on delete cascade" "alter table alerts drop constraint alerts_community_id_fkey; alter table alerts add foreign key (community_id) references communities(id)" "cascades or nulls"
# R22 lock contention: another session holds a conflicting lock on self_reports
( $PSQL -c "begin; insert into self_reports(community_id) values (null); select pg_sleep(14); rollback;" >/dev/null 2>&1 ) &
sleep 2; snap > s_pre.txt; out=$(runfile recovery.sql); snap > s_post.txt; wait
echo "$out" | grep -q 'EXIT=1' && echo "$out" | grep -qi 'lock timeout' && cmp -s s_pre.txt s_post.txt && ok "R22 lock held by another session: fails after lock_timeout, state unchanged" || { bad "R22"; echo "$out"|head -3; }
# R23 atomicity: an error AFTER the first deletes must roll everything back
$PSQL -c "create function boom() returns trigger language plpgsql as \$\$ begin raise exception 'BOOM late failure'; end \$\$; create trigger boom_t before delete on canonical_zip_registry for each row execute function boom();" >/dev/null
snap > s_pre.txt; out=$(runfile recovery.sql); snap > s_post.txt
echo "$out" | grep -q 'EXIT=1' && echo "$out" | grep -q 'BOOM' && cmp -s s_pre.txt s_post.txt && ok "R23 failure after pages/arrays were changed rolls the whole recovery back" || { bad "R23"; echo "$out"|head -3; }
$PSQL -c "drop trigger boom_t on canonical_zip_registry; drop function boom()" >/dev/null
# ===== preservation of independent safe changes
$PSQL -c "update communities set zip_codes = zip_codes || array['80001'] where slug='boulder-county-co'; update communities set name='Boulder County (renamed)' where slug='boulder-county-co'; insert into communities(name,county,state,zip_codes,level,slug,parent_id) values ('Other (80001)','Jefferson','CO',array['80001'],'zip','other-80001',(select id from communities where slug='jefferson-county-co'));" >/dev/null
out=$(runfile recovery.sql); echo "$out" | grep -q 'EXIT=0' && ok "P1 independent safe changes: recovery proceeds" || { bad "P1"; echo "$out"|head -3; }
$PSQL -Atq -c "select (select array_to_string(zip_codes,',') from communities where slug='boulder-county-co')||'|'||(select name from communities where slug='boulder-county-co')||'|'||(select count(*) from communities where slug='other-80001')" > p1.txt
grep -qx '80001,80002,80003' p1.txt >/dev/null 2>&1
grep -qx '80301,80302,80303,80304,80305,80501,80503,80001|Boulder County (renamed)|1' p1.txt && ok "P1 independent array value, rename and unrelated row preserved" || bad "P1 values"
echo "RESULT pass=$pass fail=$fail"
