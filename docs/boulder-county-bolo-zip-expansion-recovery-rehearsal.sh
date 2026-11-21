#!/bin/bash
# EVIDENCE ONLY. Local rehearsal harness used for docs/boulder-county-bolo-zip-expansion-recovery-2026-11-21.md.
# Runs against a DISPOSABLE local PostgreSQL 17.6 database "rh" (socket /tmp/rh2/data, port 55432) rebuilt from
# read-only catalog queries; it expects, in the working directory: forward.sql (the reviewed forward file, blob
# b8be7a68...), the recovery SQL, state.sql (a state-fingerprint query over registry, communities, county arrays,
# guard body md5, catalog, stand-in dependents) and baseline.state (its output on the verified baseline).
# Never point this at any shared or production database.
PSQL="psql -h /tmp/rh2/data -p 55432 -U postgres -d rh -X -q -v ON_ERROR_STOP=1"
REC=boulder-county-bolo-zip-expansion-recovery-2026-11-21.sql
pass=0; fail=0
ok(){ echo "PASS  $1"; pass=$((pass+1)); }
bad(){ echo "FAIL  $1"; fail=$((fail+1)); }
snap(){ $PSQL -Atq -F' | ' -f state.sql; }
runfile(){ $PSQL -At -c "$(cat $1)" 2>&1; echo "EXIT=$?"; }
# --- S1 baseline -> forward -> recovery -> baseline
snap > s_base.txt; cmp -s s_base.txt baseline.state && ok "S0 baseline equals pinned baseline" || bad "S0"
out=$(runfile forward.sql); echo "$out" | grep -q 'EXIT=0' && ok "S1 forward applies" || { bad "S1 forward"; echo "$out"; }
snap > s_exp.txt; grep -q 'registry | 12750' s_exp.txt && ok "S1 expanded registry 12750" || bad "S1 reg"
out=$(runfile $REC); echo "$out" | tail -3
echo "$out" | grep -q 'EXIT=0' && echo "$out" | grep -q 'ZIP_EXPANSION_RECOVERY_OK|recovered|12746|ad61d07cabc455edd9468e1ed0401a74|0|0|8d6bee1c736996ab9c1a6ff64247ab95' && ok "S2 recovery runs, receipt correct" || bad "S2 recovery"
snap > s_rec.txt; cmp -s s_rec.txt baseline.state && ok "S3 recovered state equals full pinned baseline" || { bad "S3 state differs"; diff s_rec.txt baseline.state; }
out=$(runfile $REC); echo "$out" | grep -q 'EXIT=0' && echo "$out" | grep -q 'already_recovered_no_change' && ok "S4 repeat run is an explicit no-op" || { bad "S4"; echo "$out"; }
snap > s_rec2.txt; cmp -s s_rec2.txt baseline.state && ok "S4b repeat leaves baseline unchanged" || bad "S4b"
# --- forward again for refusal tests
runfile forward.sql >/dev/null; snap > s_exp.txt
refuse(){ # name perturb revert [needle]
  SAVED=$($PSQL -Atq -F'~' -c "select string_agg(slug||'='||zip_codes::text, '~') from communities where level='county'")
  $PSQL -c "$2" >/dev/null 2>&1 || { bad "$1 (perturbation failed)"; return; }
  snap > s_pre.txt
  out=$(runfile $REC)
  snap > s_post.txt
  echo "$out" | grep -q 'EXIT=1' && echo "$out" | grep -qi "${4:-refusing}" && cmp -s s_pre.txt s_post.txt && ok "$1 refused, state unchanged" || { bad "$1"; echo "$out" | head -5; }
  $PSQL -c "$3" >/dev/null 2>&1 || echo "   (revert failed for $1)"
  for kv in ${SAVED//\~/ }; do $PSQL -c "update communities set zip_codes='${kv#*=}'::text[] where slug='${kv%%=*}'" >/dev/null; done
}
refuse "R1 altered ZIP page name" "update communities set name='Lafayette CHANGED' where slug='lafayette-80026'" "update communities set name='Lafayette (80026)' where slug='lafayette-80026'"
refuse "R2 altered registry row" "update canonical_zip_registry set workbook_sha256='x' where zip='80310'" "update canonical_zip_registry set workbook_sha256='6010b50953d2123330397e52d54163486e5705b882ed3dfdc4ad70ed0a990f12' where zip='80310'"
ID=$($PSQL -Atq -c "select id from communities where slug='boulder-80310'")
refuse "R3a FK dependent (alerts row)" "insert into alerts(community_id) values ('$ID')" "delete from alerts" "dependent records"
refuse "R3b text community_id (feeds)" "insert into feeds values ('f1','$ID')" "delete from feeds" "dependent records"
refuse "R3c zip_code reference (events)" "insert into events(zip_code) values ('80026')" "delete from events" "dependent records"
refuse "R3d char(5) zip reference" "insert into app_zip_geography_cutover values ('80027')" "delete from app_zip_geography_cutover" "dependent records"
refuse "R3e zip request row" "insert into zip_request_builds(zip) values ('80021')" "delete from zip_request_builds" "dependent records"
refuse "R4a duplicate ZIP in Boulder array" "update communities set zip_codes = zip_codes || array['80026'] where slug='boulder-county-co'" "update communities set zip_codes = array_remove(zip_codes,'80026') || array['80026'] where slug='boulder-county-co'" "county ZIP array"
refuse "R4b Boulder ZIP in Jefferson array" "update communities set zip_codes = zip_codes || array['80310'] where slug='jefferson-county-co'" "update communities set zip_codes = array_remove(zip_codes,'80310') where slug='jefferson-county-co'" "county ZIP array"
refuse "R5 another community claims a ZIP" "insert into communities(name,county,state,zip_codes,level,slug) values ('X','Boulder','CO',array['80310'],'zip','x-80310')" "delete from communities where slug='x-80310'" "another community"
refuse "R6 guard self-test body altered" "do \$\$ declare s text; begin select prosrc into s from pg_proc where proname='canonical_zip_guard_selftest'; execute format('create or replace function public.canonical_zip_guard_selftest() returns table (case_name text, expected text, blocked boolean, passed boolean, detail text) language plpgsql security definer set search_path = public, pg_temp as %L', s||E'\n-- later edit'); end \$\$" "do \$\$ declare s text; begin select prosrc into s from pg_proc where proname='canonical_zip_guard_selftest'; execute format('create or replace function public.canonical_zip_guard_selftest() returns table (case_name text, expected text, blocked boolean, passed boolean, detail text) language plpgsql security definer set search_path = public, pg_temp as %L', replace(s,E'\n-- later edit','')); end \$\$" "changed after expansion"
refuse "R7 v2 city row exists" "insert into communities(name,county,state,zip_codes,level,slug,parent_id) values ('Boulder','Boulder','CO','{}','city','boulder-co',(select id from communities where slug='boulder-county-co'))" "delete from communities where slug='boulder-co'" "v2 rollback"
refuse "R8 extra registry ZIP (independent addition)" "insert into canonical_zip_registry values ('80306','2.5','independent')" "delete from canonical_zip_registry where zip='80306'" "registry outside"
refuse "R9 child parented to a ZIP page" "insert into communities(name,county,state,zip_codes,level,slug,parent_id) values ('Kid','Boulder','CO','{}','city','kid',(select id from communities where slug='boulder-80310'))" "delete from communities where slug='kid'" "parented"
refuse "R10 partial state (one page missing)" "delete from communities where slug='broomfield-80021'" "insert into communities(name,county,state,zip_codes,level,parent_id,government_topics,slug) select 'Broomfield (80021)','Jefferson','CO',array['80021'],'zip',(select id from communities where slug='jefferson-county-co'),'{}','broomfield-80021'" "partial or mixed"
snap > s_exp2.txt; echo "--- expanded state after refusal tests (communities hash may differ only by re-created page id):"; diff s_exp.txt s_exp2.txt | head -4
# --- preservation: independent safe changes after expansion
$PSQL -c "update communities set zip_codes = zip_codes || array['80001'] where slug='boulder-county-co'; update communities set name='Boulder County (renamed)' where slug='boulder-county-co'; insert into communities(name,county,state,zip_codes,level,slug,parent_id) values ('Other (80001)','Jefferson','CO',array['80001'],'zip','other-80001',(select id from communities where slug='jefferson-county-co'));" >/dev/null
out=$(runfile $REC); echo "$out" | grep -q 'EXIT=0' && ok "P1 independent safe changes: recovery proceeds" || { bad "P1"; echo "$out"; }
$PSQL -Atq -c "select (select array_to_string(zip_codes,',') from communities where slug='boulder-county-co'), (select name from communities where slug='boulder-county-co'), (select count(*) from communities where slug='other-80001')" | tee p1.txt
grep -q '^80301,80302,80303,80304,80305,80501,80503,80001|Boulder County (renamed)|1$' p1.txt && ok "P1 independent array value, rename and unrelated row preserved; added ZIPs removed in order" || bad "P1 values"
echo "RESULT pass=$pass fail=$fail"
