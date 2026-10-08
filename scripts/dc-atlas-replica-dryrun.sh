#!/usr/bin/env bash
# PRODUCTION DRY RUN of ATLAS COORDINATE VALIDATION -- OFF-DATABASE (the #1324 method).
#
# PRODUCTION IS ONLY EVER READ, and only through prod_select(): one SELECT per session, inside a READ
# ONLY transaction (default_transaction_read_only=on), with a 2 s lock_timeout. No DDL, no temp
# table, no scratch schema, no transaction left open in production -- ever (CLAUDE.md 7.11: two
# earlier dry runs that ran DDL "harmlessly" in production locked live relations).
#
# Every change happens in a DISPOSABLE PostGIS on the runner, production's own database image:
#   1. prod: the live definitions fingerprint as main@f9d1326 (test/dc_atlas_validation_pg/build_apply.py
#      EXPECT_LIVE) and nothing this change introduces exists yet;
#   2. local: a replica from main@f9d1326's DDL of record; same engine byte for byte, same definitions;
#   3. prod -> local: every evidence, canonical and derived-evidence table (row counts verified);
#   3b. schema signature parity (written tables, every dc_% view and function, the Map 1 reader);
#   4. the queue: main's (what production would derive today) and the branch's (+ every Atlas address);
#   5. the production ladder, DCG_DRY_RUN=1 (the geocode cache is read, never written), timed;
#   6. prod -> local: every ZCTA polygon near any point either side could place;
#   7. PARITY: the replica's Map 1 output over ALL registry ZIPs equals production's, row for row;
#   8. BASELINE: main's own code settles the replica (main's pending derivations loaded, main's two
#      resolvers run) -- every later delta is attributable to THIS change alone;
#      PHASE A: apply docs/dc-atlas-validation-apply.sql, load the Atlas derivations, run the resolvers;
#      PHASE D: the reviewed admission simulated (dc_derived_address_admitted gains Atlas), resolvers;
#   9. the report (docs/dc-atlas-dryrun-report.sql): every bucket reconciled, every changed facility.
set -euo pipefail
: "${PROD_DB_URL:?}" "${PGHOST:?}" "${PGUSER:?}"
[ -n "${DCG_REPLAY:-}" ] || : "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
MAIN_SHA="${MAIN_SHA:-f9d1326}"
root="$(cd "$(dirname "$0")/.." && pwd)"
w="$(mktemp -d)"; trap 'rm -rf "$w"' EXIT
REP=dcatl

# ── the ONLY way this script touches production ─────────────────────────────────────────────────
prod_select() { # $1 = one SELECT/WITH query, $2 = output CSV
  python3 - "$1" <<'PY' || { echo "REFUSED: not a single read-only SELECT" >&2; exit 1; }
import re, sys
q = sys.argv[1].strip()
ok = re.match(r'(?is)^(select|with)\b', q) and ';' not in q and not re.search(
    r'(?i)\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|copy|call|do|set|reset|'
    r'lock|vacuum|analyze|refresh|comment|listen|notify|nextval|setval|pg_terminate_backend|'
    r'pg_cancel_backend|pg_advisory_lock|dblink|lo_import|pg_read_file)\b', q)
sys.exit(0 if ok else 1)
PY
  local q; q="$(tr '\n' ' ' <<<"$1")"
  PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=15min -c idle_in_transaction_session_timeout=60s' \
    psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "\\copy ($q) to '$2' with (format csv)"
}
L() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
md5_sorted() { LC_ALL=C sort "$1" | md5sum | cut -d' ' -f1; }

FNS="'dc_adjudicate_pair','dc_derived_point_verdict','dc_geocode_input','dc_resolve_canonical','dc_resolve_geography','dc_site_claims_conflict','map1_dc_zip_members'"
expect_fns() { # $1 = CSV (proname, md5) -- must equal the apply's EXPECT_LIVE exactly
  python3 - "$1" "$root" <<'PY'
import csv, sys, importlib.util
spec = importlib.util.spec_from_file_location('b', sys.argv[2] + '/test/dc_atlas_validation_pg/build_apply.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
got = {r[0]: r[1] for r in csv.reader(open(sys.argv[1]))}
if got != b.EXPECT_LIVE:
    sys.exit(f'REFUSED: definitions differ from main: {got} != {b.EXPECT_LIVE}')
print(f'  {len(got)}/{len(b.EXPECT_LIVE)} definitions fingerprint as main')
PY
}

echo "== 1. production definitions (read-only)"
prod_select "select proname, md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname in ($FNS) order by proname" "$w/prod_fns.csv"
expect_fns "$w/prod_fns.csv"
prod_select "select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname in ('dc_publisher_stated_address','dc_geocodable_site_address','dc_derived_address_admitted')" "$w/prod_pre.csv"
[ "$(cat "$w/prod_pre.csv")" = "0" ] || { echo "REFUSED: production already carries this change"; exit 1; }
ENGINE_Q="select current_setting('server_version'), postgis_full_version()"
prod_select "$ENGINE_Q" "$w/prod_engine.csv"

echo "== 2. local replica from main@$MAIN_SHA"
dropdb --if-exists "$REP"; createdb "$REP"
L -d "$REP" -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null
git -C "$root" show "$MAIN_SHA:docs/zip-membership-canonical.sql" > "$w/zm.sql"; L -d "$REP" -f "$w/zm.sql" >/dev/null
git -C "$root" show "$MAIN_SHA:test/dc_epoch_geography_pg/fixture.sql" > "$w/fx.sql"; L -d "$REP" -f "$w/fx.sql" >/dev/null
for f in docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  git -C "$root" show "$MAIN_SHA:$f" > "$w/chain.sql"; L -d "$REP" -f "$w/chain.sql" >/dev/null
done
L -d "$REP" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
L -d "$REP" -c "\\copy ($ENGINE_Q) to '$w/rep_engine.csv' with (format csv)"
if ! cmp -s "$w/prod_engine.csv" "$w/rep_engine.csv"; then
  echo "  production: $(cat "$w/prod_engine.csv")"; echo "  replica:    $(cat "$w/rep_engine.csv")"
  echo "REFUSED: the replica's geometry engine is not production's"; exit 1
fi
echo "  PRODUCTION_POSTGIS_VERSION_PARITY PASS: $(cat "$w/rep_engine.csv")"
L -d "$REP" -c "\\copy (select proname, md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname in ($FNS) order by proname) to '$w/rep_fns.csv' with (format csv)"
expect_fns "$w/rep_fns.csv"

echo "== 3. copy the evidence, canonical and derived-evidence tables (production read-only -> replica)"
TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography dc_address_geocode national_dc_records canonical_zip_registry"
{ echo "set session_replication_role = replica;"; echo "truncate $(sed 's/\([a-z_]*\)/public.\1/g; s/ /, /g' <<<"$TABLES"), geo.zcta_boundary cascade;"; } > "$w/load.sql"
for t in $TABLES; do
  cols="$(L -d "$REP" -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  [ -n "$cols" ] || { echo "REFUSED: replica has no table $t"; exit 1; }
  prod_select "select $cols from public.$t" "$w/$t.csv"
  echo "\\copy public.$t ($cols) from '$w/$t.csv' with (format csv)" >> "$w/load.sql"
  printf '  %-26s %8s rows\n' "$t" "$(wc -l < "$w/$t.csv")"
done
L -d "$REP" -f "$w/load.sql"
for t in $TABLES; do
  n="$(L -d "$REP" -tA -c "select count(*) from public.$t")"
  [ "$n" = "$(wc -l < "$w/$t.csv" | tr -d ' ')" ] || { echo "REFUSED: $t loaded $n rows"; exit 1; }
done

echo "== 3b. SCHEMA: every object the chain reads or writes is production's"
WRITTEN="'dc_canonical_entity','dc_entity_observation','dc_identity_decision','dc_entity_geography','dc_address_geocode'"
SIG="select k, n, d from (
  select 'table' k, c.relname n, a.attname || ' ' || format_type(a.atttypid, a.atttypmod) || case when a.attnotnull then ' not null' else '' end || coalesce(' default ' || pg_get_expr(ad.adbin, ad.adrelid), '') || case when a.attgenerated <> '' then ' generated' else '' end d
    from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
   where s.nspname = 'public' and c.relname in ($WRITTEN)
  union all select 'constraint', t.relname, o.conname || ' ' || pg_get_constraintdef(o.oid)
    from pg_constraint o join pg_class t on t.oid = o.conrelid join pg_namespace s on s.oid = t.relnamespace
   where s.nspname = 'public' and t.relname in ($WRITTEN)
  union all select 'trigger', t.relname, pg_get_triggerdef(g.oid)
    from pg_trigger g join pg_class t on t.oid = g.tgrelid join pg_namespace s on s.oid = t.relnamespace
   where not g.tgisinternal and s.nspname = 'public' and t.relname in ($WRITTEN)
  union all select 'index', t.relname, pg_get_indexdef(i.indexrelid)
    from pg_index i join pg_class t on t.oid = i.indrelid join pg_namespace s on s.oid = t.relnamespace
   where s.nspname = 'public' and t.relname in ($WRITTEN)
  union all select 'view', c.relname, md5(pg_get_viewdef(c.oid))
    from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'v' and c.relname like 'dc\\_%'
  union all select 'function', s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', md5(p.prosrc)
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where (s.nspname = 'public' and (p.proname like 'dc\\_%' or p.proname = 'map1_dc_zip_members'))
      or (s.nspname = 'geo' and p.proname like 'zip\\_%')
  union all select 'readcol', c.relname, a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
    from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
   where s.nspname = 'public' and c.relname in ('dc_source','dc_acquisition_run','dc_source_observation','national_dc_records','canonical_zip_registry')
) x"
prod_select "$SIG" "$w/prod_sig.csv"
L -d "$REP" -c "\\copy ($(tr '\n' ' ' <<<"$SIG")) to '$w/rep_sig.csv' with (format csv)"
python3 - "$w/prod_sig.csv" "$w/rep_sig.csv" <<'PY2'
import csv, sys
prod = set(map(tuple, csv.reader(open(sys.argv[1])))); rep = set(map(tuple, csv.reader(open(sys.argv[2]))))
bad = []
for kind in ('table', 'constraint', 'trigger', 'index', 'view', 'function'):
    rp = {r for r in rep if r[0] == kind}; pp = {r for r in prod if r[0] == kind}
    names = {r[1] for r in rp} if kind in ('view', 'function') else {r[1] for r in rp} | {r[1] for r in pp}
    for r in sorted(rp - pp): bad.append('replica-only ' + ' | '.join(r))
    for r in sorted(pp - rp):
        if r[1] in names: bad.append('production-only ' + ' | '.join(r))
rcols = {r for r in rep if r[0] == 'readcol'}; pcols = {r for r in prod if r[0] == 'readcol'}
for r in sorted(rcols - pcols): bad.append('replica column absent or retyped in production ' + ' | '.join(r))
if bad:
    print('\n'.join('  ' + b for b in bad)); sys.exit('REFUSED: the replica schema is not production\'s for the objects the chain uses')
print(f'  REPLICA_SCHEMA_PARITY PASS: {sum(1 for r in rep if r[0] != "readcol")} signature rows equal on both sides')
PY2

echo "== 4. queues: main's (what production derives today) and the branch's"
git -C "$root" show "$MAIN_SHA:docs/dc-geocode-observations-queue.sql" > "$w/queue-main.sql"
L -d "$REP" -tA -f "$w/queue-main.sql" > "$w/q-main.jsonl"   # main's own queue, on main's own views
dropdb --if-exists dcq; createdb -T "$REP" dcq
L -d dcq -f "$root/docs/dc-atlas-validation-apply.sql" >/dev/null
L -d dcq -tA -f "$root/docs/dc-geocode-observations-queue.sql" > "$w/q-branch.jsonl"
L -d dcq -tA -c "select count(*) filter (where admitted), count(*) filter (where not admitted) from public.dc_geocode_queue" > "$w/q-split.txt"
dropdb dcq
echo "  main queue: $(grep -c . "$w/q-main.jsonl" || true)   branch queue: $(grep -c . "$w/q-branch.jsonl" || true)   (admitted|not admitted: $(cat "$w/q-split.txt"))"
python3 - "$w/q-main.jsonl" "$w/q-branch.jsonl" <<'PY'
import json, sys
m = {json.loads(l)['geocoder_query'] for l in open(sys.argv[1]) if l.strip()}
b = {json.loads(l)['geocoder_query'] for l in open(sys.argv[2]) if l.strip()}
if not m <= b: sys.exit(f'REFUSED: the branch queue drops {len(m - b)} address(es) main would derive')
print(f'  every main-queued address is still queued on the branch ({len(m)} of {len(b)})')
PY

echo "== 5. derive through the production ladder (dry-run store; nothing written)"
if [ -n "${DCG_REPLAY:-}" ]; then cp "$DCG_REPLAY" "$w/dcg-out.jsonl"; else
DCG_INPUT="$w/q-branch.jsonl" DCG_OUTPUT="$w/dcg-out.jsonl" RUN_REF="dryrun:${GITHUB_RUN_ID:-local}" DCG_DRY_RUN=1 \
  deno run --allow-net --allow-env --allow-read --allow-write="$w" "$root/scripts/dc-geocode-observations.ts"; fi

echo "== 6. ZCTA polygons near every point either side could place (production read-only)"
read -r LATS LNGS < <(python3 - "$w/dcg-out.jsonl" <<'PY'
import json, sys
pts = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
pts = [p for p in pts if p.get('lat') is not None and p.get('lng') is not None]
print('{' + ','.join(repr(float(p['lat'])) for p in pts) + '}', '{' + ','.join(repr(float(p['lng'])) for p in pts) + '}')
PY
)
prod_select "select z.zcta5, z.geom from geo.zcta_boundary z where z.zcta5 in (
  select z2.zcta5 from (
    select source_native_lat, source_native_lon from public.dc_source_observation where source_native_lat is not null and source_native_lon is not null
    union all select lat, lng from public.dc_entity_geography where lat is not null and lng is not null
    union all select lat, lng from public.dc_address_geocode where lat is not null and lng is not null
    union all select lat, lng from public.national_dc_records where lat is not null and lng is not null
    union all select * from unnest('$LATS'::float8[], '$LNGS'::float8[])
  ) p(lat, lng)
  join geo.zcta_boundary z2 on st_dwithin(z2.geom, st_setsrid(st_makepoint(p.lng, p.lat), 4269), 0.2))" "$w/zcta.csv"
L -d "$REP" -c "\\copy geo.zcta_boundary (zcta5, geom) from '$w/zcta.csv' with (format csv)"
echo "  ZCTA polygons copied: $(wc -l < "$w/zcta.csv")"

if [ -n "${DRYRUN_TEST_TAMPER_REPLICA_SQL:-}" ]; then   # offline harness only: the replica, never production
  echo "  (test) tampering with the replica only"; L -d "$REP" -c "$DRYRUN_TEST_TAMPER_REPLICA_SQL" >/dev/null
fi

echo "== 7. PARITY: the replica's Map 1 output over every registry ZIP must equal production's"
Q="select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"
prod_select "$Q" "$w/before_prod.csv"
L -d "$REP" -c "\\copy ($Q) to '$w/before_rep.csv' with (format csv)"
a="$(md5_sorted "$w/before_prod.csv")"; b="$(md5_sorted "$w/before_rep.csv")"
echo "  registry ZIP pages checked: $(L -d "$REP" -tA -c 'select count(*) from public.canonical_zip_registry')"
echo "  production $(wc -l < "$w/before_prod.csv") rows md5 $a"
echo "  replica    $(wc -l < "$w/before_rep.csv") rows md5 $b"
if [ "$a" != "$b" ]; then
  { diff <(LC_ALL=C sort "$w/before_prod.csv") <(LC_ALL=C sort "$w/before_rep.csv") || true; } | head -20
  echo "REFUSED: the replica does not reproduce production's Map 1 output"; exit 1
fi

echo "== 8. BASELINE (main's code) -> PHASE A (apply, Atlas acquired) -> PHASE D (Atlas admitted)"
python3 - "$w/dcg-out.jsonl" "$w/q-main.jsonl" "$w/d-main.jsonl" "$w/d-rest.jsonl" <<'PY'
import json, sys
m = {json.loads(l)['geocoder_query'] for l in open(sys.argv[2]) if l.strip()}
with open(sys.argv[3], 'w') as a, open(sys.argv[4], 'w') as b:
    for l in open(sys.argv[1]):
        if l.strip(): (a if json.loads(l)['geocoder_query'] in m else b).write(l)
PY
git -C "$root" show "$MAIN_SHA:docs/dc-geocode-observations-load.sql" > "$w/load-main.sql"
SNAP="create table public.dryrun_%s as select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m;
      create table public.dryrun_geo_%s as select * from public.dc_entity_geography;
      create table public.dryrun_id_%s as select k from public.dryrun_identity_rows();"
L -d "$REP" <<SQL >/dev/null
create function public.dryrun_identity_rows() returns table(k text) language sql as \$\$
  select 'E|' || canonical_entity_id || '|' || entity_grain || '|' || classification || '|' || coalesce(superseded_by::text, '') from public.dc_canonical_entity
  union all select 'L|' || canonical_entity_id || '|' || home_signal_observation_id || '|' || link_rule_key from public.dc_entity_observation
  union all select 'D|' || observation_a || '|' || observation_b || '|' || candidate_rule_key || '|' || decision_state || '|' || coalesce(decision_rule_key, '') from public.dc_identity_decision
  union all select 'O|' || canonical_entity_id || '|' || other_entity_id || '|' || candidate_rule_key from public.dc_entity_identity_open \$\$;
create table public.dryrun_src_before as select home_signal_observation_id, source_native_lat, source_native_lon, raw_payload from public.dc_source_observation;
create temp table _dcg_in(j jsonb);
\\copy _dcg_in(j) from '$w/d-main.jsonl' with (format csv, quote e'\\x01', delimiter e'\\x02')
\\i $w/load-main.sql
SQL
L -d "$REP" -tA -F'|' <<SQL | sed 's/^/  baseline /'
select 'RESOLVE_CANONICAL', metric, value from public.dc_resolve_canonical(true, false) where metric in ('MODE','ENTITIES_MINTED','OBSERVATIONS_RELINKED','REFUSED_IDENTITY_PENDING');
select 'RESOLVE_GEOGRAPHY', metric, value from public.dc_resolve_geography(true) where metric in ('MODE','ENTITIES','ROWS_WRITTEN','REFUSED_IDENTITY_PENDING');
$(printf "$SNAP" before before before)
select 'BASELINE_ROWS_VS_PRODUCTION', (select count(*) from public.dryrun_before)::text || ' vs $(wc -l < "$w/before_prod.csv" | tr -d ' ')';
SQL
L -d "$REP" -f "$root/docs/dc-atlas-validation-apply.sql" >/dev/null
L -d "$REP" -tA -F'|' <<SQL | sed 's/^/  phase A  /'
create temp table _dcg_in(j jsonb);
\\copy _dcg_in(j) from '$w/d-rest.jsonl' with (format csv, quote e'\\x01', delimiter e'\\x02')
\\i $root/docs/dc-geocode-observations-load.sql
select 'RESOLVE_CANONICAL', metric, value from public.dc_resolve_canonical(true, false) where metric in ('MODE','ENTITIES_MINTED','OBSERVATIONS_RELINKED','REFUSED_IDENTITY_PENDING');
select 'RESOLVE_GEOGRAPHY', metric, value from public.dc_resolve_geography(true) where metric in ('MODE','ENTITIES','ROWS_WRITTEN','REFUSED_IDENTITY_PENDING');
$(printf "$SNAP" phase_a phase_a phase_a)
SQL
# PHASE D: exactly the one-line production switch, taken from the DDL of record's own body (never retyped)
python3 - "$root/docs/dc-step3d-derived-location.sql" > "$w/admit.sql" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"create or replace function public\.dc_derived_address_admitted\(.*?\$\$;", s, re.S)
old = "in (('epoch_ai', 'data_centers'))"
assert m and m.group(0).count(old) == 1, 'admission body shape changed'
print(m.group(0).replace(old, "in (('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities'))"))
PY
L -d "$REP" -f "$w/admit.sql" >/dev/null
L -d "$REP" -tA -F'|' <<SQL | sed 's/^/  phase D  /'
select 'RESOLVE_CANONICAL', metric, value from public.dc_resolve_canonical(true, false) where metric in ('MODE','ENTITIES_MINTED','OBSERVATIONS_RELINKED','REFUSED_IDENTITY_PENDING');
select 'RESOLVE_GEOGRAPHY', metric, value from public.dc_resolve_geography(true) where metric in ('MODE','ENTITIES','ROWS_WRITTEN','REFUSED_IDENTITY_PENDING');
select 'RESOLVE_GEOGRAPHY_AGAIN', metric, value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN';
SQL

echo "== 9. report (replica only)"
L -d "$REP" -tA -F'|' -P pager=off <<SQL | tee "$w/report.txt"
create temp table _before as select * from public.dryrun_before;
create temp table _geo_before as select * from public.dryrun_geo_before;
create temp table _id_before as select * from public.dryrun_id_before;
create temp table _phase_a as select * from public.dryrun_phase_a;
create temp table _geo_phase_a as select * from public.dryrun_geo_phase_a;
create temp table _src_before as select * from public.dryrun_src_before;
create temp table _id_after as select k from public.dryrun_identity_rows();
\\i $root/docs/dc-atlas-dryrun-report.sql
SQL

bad_zero=$(grep -E '^[A-Z0-9]+_[A-Z0-9_]*_ZERO\|' "$w/report.txt" | awk -F'|' '$2 != "0"' || true)
bad_rc=$(grep -E '^RC_' "$w/report.txt" | awk -F'|' '$2 != "true"' || true)
n_rc=$(grep -cE '^RC_' "$w/report.txt" || true)
[ "$n_rc" -ge 5 ] || { echo "FAIL: only $n_rc reconciliation rows ran"; exit 1; }
[ -z "$bad_rc" ] || { echo "FAIL: a bucket set does not reconcile: $bad_rc"; exit 1; }
[ -z "$bad_zero" ] || { echo "FAIL: a required-zero receipt is not zero: $bad_zero"; exit 1; }
echo "DRY RUN COMPLETE: every bucket reconciles; every required-zero receipt is 0. Production was only read."
