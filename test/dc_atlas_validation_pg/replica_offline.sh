#!/usr/bin/env bash
# Offline proof of scripts/dc-atlas-replica-dryrun.sh against a DISPOSABLE PostGIS that stands in for
# production ("fakeprod": main@MAIN_SHA's DDL of record + the Atlas suite's evidence, settled by
# main's own resolvers). Proves, before the script is ever pointed at production:
#   1. the dry run completes, every bucket reconciles and every required-zero receipt is 0;
#   2. "production" is left BYTE-IDENTICAL (every function, relation and canonical table fingerprinted);
#   3. the Phase A / Phase D outcome on the fixture is exactly the suite's: 2 withheld, 1 placed;
#   4. a replica that differs from production is REFUSED at parity (negative control, executed).
set -euo pipefail
: "${PGHOST:?}"
here="$(cd "$(dirname "$0")" && pwd)"; root="$(cd "$here/../.." && pwd)"
MAIN_SHA="${MAIN_SHA:-f9d1326}"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
P() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FP=fakeprod_atl

dropdb --if-exists "$FP"; createdb "$FP"
P -d "$FP" -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null
git -C "$root" show "$MAIN_SHA:docs/zip-membership-canonical.sql" > "$tmp/zm.sql"; P -d "$FP" -f "$tmp/zm.sql" >/dev/null
git -C "$root" show "$MAIN_SHA:test/dc_epoch_geography_pg/fixture.sql" > "$tmp/fx.sql"; P -d "$FP" -f "$tmp/fx.sql" >/dev/null
for f in docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  git -C "$root" show "$MAIN_SHA:$f" > "$tmp/c.sql"; P -d "$FP" -f "$tmp/c.sql" >/dev/null
done
# the suite's evidence (ZCTAs, runs, observations) -- everything before its queue step
awk '/^-- ── the queue, as the writer reads it/{exit} {print}' "$here/suite.sql" > "$tmp/evidence.sql"
awk '/^create temp table _dcg_all as/,/^\) v\(q, p, mt, la, ln, ma, c, src\);/' "$here/suite.sql" > "$tmp/dcg.sql"
git -C "$root" show "$MAIN_SHA:docs/dc-geocode-observations-load.sql" > "$tmp/load-main.sql"
P -d "$FP" <<SQL >/dev/null
\i $tmp/evidence.sql
create table public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry select zcta5 from geo.zcta_boundary;
\i $tmp/dcg.sql
-- "production" already holds its admitted (Epoch) derivations, as it does today
create temp table _dcg_in (j jsonb);
insert into _dcg_in select j from _dcg_all where src = 'epoch';
\i $tmp/load-main.sql
select * from public.dc_resolve_canonical(true, false);
select * from public.dc_resolve_geography(true);
\copy (select j::text from _dcg_all) to '$tmp/replay.jsonl'
SQL

fingerprint() { P -d "$FP" -tA -c "
  select md5(string_agg(x, '|' order by x collate \"C\")) from (
    select 'fn:' || p.proname || ':' || md5(p.prosrc) x from pg_proc p where p.pronamespace in ('public'::regnamespace, 'geo'::regnamespace)
    union all select 'rel:' || n.nspname || '.' || c.relname || ':' || c.relkind::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_toast_temp%'
    union all select 'rows:dc_canonical_entity:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_canonical_entity t
    union all select 'rows:dc_entity_observation:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_entity_observation t
    union all select 'rows:dc_identity_decision:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_identity_decision t
    union all select 'rows:dc_entity_geography:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_entity_geography t
    union all select 'rows:dc_address_geocode:' || md5(string_agg(t::text, ',' order by t::text collate \"C\")) from public.dc_address_geocode t
  ) s"; }
before="$(fingerprint)"

# 0. the "production" functions must be what the apply's drift guard expects, or this proof proves nothing
P -d "$FP" -tA -F, -c "select proname, md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname in
  ('dc_adjudicate_pair','dc_derived_point_verdict','dc_geocode_input','dc_resolve_canonical','dc_resolve_geography','dc_site_claims_conflict','map1_dc_zip_members') order by 1" > "$tmp/fns.csv"
python3 - "$tmp/fns.csv" "$root" <<'PY'
import csv, sys, importlib.util
spec = importlib.util.spec_from_file_location('b', sys.argv[2] + '/test/dc_atlas_validation_pg/build_apply.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
got = {r[0]: r[1] for r in csv.reader(open(sys.argv[1]))}
assert got == b.EXPECT_LIVE, f'fakeprod is not main: {got}'
print('OK 0: fakeprod carries exactly the definitions the apply guards (main@f9d1326)')
PY

export PROD_DB_URL="dbname=$FP" DCG_REPLAY="$tmp/replay.jsonl" MAIN_SHA
"$root/scripts/dc-atlas-replica-dryrun.sh" > "$tmp/run.txt" 2>&1 || { cat "$tmp/run.txt"; echo "FAIL: the dry run did not complete"; exit 1; }
grep -vE '^\s*$' "$tmp/run.txt" | head -400
after="$(fingerprint)"
[ "$before" = "$after" ] || { echo "FAIL: \"production\" changed: $before -> $after"; exit 1; }
echo "OK 1-2: dry run complete; \"production\" fingerprint unchanged ($after)"
grep -q '^M01 ROWS before / phaseA / phaseD|' "$tmp/run.txt" || { echo "FAIL: no Map 1 receipt"; exit 1; }
exp='^X REMOVED .*facility=Far Atlas|^X REMOVED .*facility=Same Zip Atlas|^X ADDED .*facility=Town Atlas'
[ "$(grep -cE "$exp" "$tmp/run.txt")" = 3 ] && [ "$(grep -cE '^X ' "$tmp/run.txt")" = 3 ] \
  || { grep -E '^X ' "$tmp/run.txt"; echo "FAIL: the national delta on the fixture is not exactly the suite's"; exit 1; }
echo "OK 3: the fixture's national delta is exactly REMOVED Far Atlas, REMOVED Same Zip Atlas, ADDED Town Atlas"

# 4. NEGATIVE CONTROL -- executed: one PUBLISHED point (a marker on a page -- an unpublished RESOLVED point
#    would leave Map 1 unchanged and make the control pass by luck) moved 50 m on the REPLICA only
DRYRUN_TEST_TAMPER_REPLICA_SQL="update public.dc_entity_geography set lat = lat + 0.00045, geom = ST_SetSRID(ST_MakePoint(lng, lat + 0.00045), 4326)
   where canonical_entity_id = (select m.canonical_entity_id from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m
                                 where m.canonical_entity_id is not null order by m.canonical_entity_id limit 1)" \
  "$root/scripts/dc-atlas-replica-dryrun.sh" > "$tmp/neg.txt" 2>&1 && { echo "FAIL: a tampered replica was ACCEPTED"; exit 1; }
grep -q 'REFUSED: the replica does not reproduce production' "$tmp/neg.txt" || { tail -5 "$tmp/neg.txt"; echo "FAIL: refused for the wrong reason"; exit 1; }
[ "$(fingerprint)" = "$before" ] || { echo "FAIL: the negative control changed production"; exit 1; }
echo "OK 4: REPLICA_PARITY_NEGATIVE_CONTROL PASS -- a replica 50 m off production is refused before anything is applied"
