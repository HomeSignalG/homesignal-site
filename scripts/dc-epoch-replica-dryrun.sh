#!/usr/bin/env bash
# PRODUCTION DRY RUN of automatic Epoch canonical geography -- OFF-DATABASE.
#
# PRODUCTION IS ONLY EVER READ, and only through prod_select(): one SELECT per session, inside a
# READ ONLY transaction (default_transaction_read_only=on), with a short lock_timeout. No DDL, no
# temp table, no scratch schema, no transaction left open in production -- ever.
#
# Why (2026-09-24, two incidents): a dry run that ran the apply's DDL inside a transaction it rolled
# back held ACCESS EXCLUSIVE on public.dc_entity_geography for ~7 minutes (one resident Map 1 call
# returned 500); the replacement built the chain in a scratch schema instead, and its DDL still took
# ACCESS EXCLUSIVE locks outside that schema (auth/storage/realtime relations were reported, blocking
# a Realtime metrics query) until the backend was terminated. "Rolled back" is not harmless, and a
# scratch schema is not isolation: DDL in production is never a dry run.
#
# So every change happens in a DISPOSABLE PostGIS on the runner (PGHOST/PGUSER/PGPASSWORD):
#   1. prod: the four live definitions the apply replaces must fingerprint as main@MAIN_SHA;
#   2. local: build the pre-apply replica from main@MAIN_SHA's DDL of record; its four definitions
#      must fingerprint identically (the replica IS the live code);
#   3. prod -> local: copy the evidence and canonical tables (the replica's own column lists);
#   4. local copy: apply docs/dc-epoch-geography-apply.sql, export the geocode queue;
#   5. the production geocoding ladder, DCG_DRY_RUN=1 (cache read, never written);
#   6. prod -> local: the ZCTA polygons near every point either state could place;
#   7. PARITY: the replica's Map 1 output over all registry ZIPs must equal production's, row for
#      row -- a replica that differs from production proves nothing, so a mismatch is a refusal;
#   8. local: apply, load the derivations, run the two scheduled resolvers, run the report.
set -euo pipefail
: "${PROD_DB_URL:?}" "${PGHOST:?}" "${PGUSER:?}"
# DCG_REPLAY=FILE replays a recorded derivation instead of calling the ladder (the offline test of
# this script uses it; the workflow never sets it)
[ -n "${DCG_REPLAY:-}" ] || : "${SUPABASE_URL:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}"
MAIN_SHA="${MAIN_SHA:-58aeb8c}"
root="$(cd "$(dirname "$0")/.." && pwd)"
w="$(mktemp -d)"; trap 'rm -rf "$w"' EXIT
REP=dcrep

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
  local q; q="$(tr '\n' ' ' <<<"$1")"   # a psql backslash command ends at a newline
  PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=15min -c idle_in_transaction_session_timeout=60s' \
    psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "\\copy ($q) to '$2' with (format csv)"
}
L() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
md5_sorted() { LC_ALL=C sort "$1" | md5sum | cut -d' ' -f1; }

FNS="'dc_adjudicate_pair','dc_resolve_canonical','dc_resolve_geography','map1_dc_zip_members'"
expect_fns() { # $1 = CSV of (proname, md5) -- must equal build_apply.EXPECT_LIVE exactly
  python3 - "$1" "$root" <<'PY'
import csv, sys, importlib.util
spec = importlib.util.spec_from_file_location('b', sys.argv[2] + '/test/dc_epoch_geography_pg/build_apply.py')
b = importlib.util.module_from_spec(spec); spec.loader.exec_module(b)
got = {r[0]: r[1] for r in csv.reader(open(sys.argv[1]))}
if got != b.EXPECT_LIVE:
    sys.exit(f'REFUSED: definitions differ from main: {got} != {b.EXPECT_LIVE}')
print('  4/4 definitions fingerprint as main')
PY
}

echo "== 1. production definitions (read-only)"
prod_select "select proname, md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname in ($FNS) order by proname" "$w/prod_fns.csv"
expect_fns "$w/prod_fns.csv"
prod_select "select (to_regclass('public.dc_address_geocode') is null)::text, (to_regnamespace('dcdry') is null)::text" "$w/prod_pre.csv"
[ "$(cat "$w/prod_pre.csv")" = "true,true" ] || { echo "REFUSED: production is not in the pre-apply state: $(cat "$w/prod_pre.csv")"; exit 1; }
ENGINE_Q="select current_setting('server_version'), postgis_full_version()"
prod_select "$ENGINE_Q" "$w/prod_engine.csv"

echo "== 2. local pre-apply replica from main@$MAIN_SHA"
dropdb --if-exists "$REP"; createdb "$REP"
L -d "$REP" -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null
git -C "$root" show "$MAIN_SHA:docs/zip-membership-canonical.sql" > "$w/zm.sql"; L -d "$REP" -f "$w/zm.sql" >/dev/null
L -d "$REP" -f "$root/test/dc_epoch_geography_pg/fixture.sql" >/dev/null
for f in docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  git -C "$root" show "$MAIN_SHA:$f" > "$w/chain.sql"; L -d "$REP" -f "$w/chain.sql" >/dev/null
done
L -d "$REP" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
# the replica must run production's geometry engine, byte for byte, or its answer is not
# production's answer: same Postgres version, same PostGIS / GEOS / PROJ build string
L -d "$REP" -c "\\copy ($ENGINE_Q) to '$w/rep_engine.csv' with (format csv)"
if ! cmp -s "$w/prod_engine.csv" "$w/rep_engine.csv"; then
  echo "  production: $(cat "$w/prod_engine.csv")"; echo "  replica:    $(cat "$w/rep_engine.csv")"
  echo "REFUSED: the replica's geometry engine is not production's"; exit 1
fi
echo "  PRODUCTION_POSTGIS_VERSION_PARITY PASS: $(cat "$w/rep_engine.csv")"
L -d "$REP" -c "\\copy (select proname, md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname in ($FNS) order by proname) to '$w/rep_fns.csv' with (format csv)"
expect_fns "$w/rep_fns.csv"

echo "== 3. copy the evidence and canonical tables (production read-only -> replica)"
TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography national_dc_records canonical_zip_registry"
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
# One catalog signature, run on both sides. Tables the resolvers WRITE: every column (type, null,
# default, generated), constraint, trigger and index. Every dc_% view and function, the Map 1 reader
# and the geo.* membership functions: their definition text (md5). The evidence tables the chain
# only READS are built from test fixtures with the columns the chain names; each such column must
# exist in production with the same type (the copy above proves it), and the columns production has
# beyond them are listed -- the chain cannot read a column the replica lacks without erroring.
WRITTEN="'dc_canonical_entity','dc_entity_observation','dc_identity_decision','dc_entity_geography'"
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
# chain objects: every replica row must be in production, and every production row for an object
# the replica has must be in the replica (a trigger or column production has and the replica lacks
# could change what the resolvers write)
for kind in ('table', 'constraint', 'trigger', 'index', 'view', 'function'):
    rp = {r for r in rep if r[0] == kind}; pp = {r for r in prod if r[0] == kind}
    names = {r[1] for r in rp} if kind in ('view', 'function') else {r[1] for r in rp} | {r[1] for r in pp}
    for r in sorted(rp - pp): bad.append('replica-only ' + ' | '.join(r))
    for r in sorted(pp - rp):
        if r[1] in names: bad.append('production-only ' + ' | '.join(r))
extra_views = sorted({r[1] for r in prod if r[0] in ('view', 'function')} - {r[1] for r in rep if r[0] in ('view', 'function')})
# read-only evidence tables: every replica column exists in production with the same type
rcols = {r for r in rep if r[0] == 'readcol'}; pcols = {r for r in prod if r[0] == 'readcol'}
for r in sorted(rcols - pcols): bad.append('replica column absent or retyped in production ' + ' | '.join(r))
beyond = sorted(pcols - rcols)
n = sum(1 for r in rep if r[0] != 'readcol')
if bad:
    print('\n'.join('  ' + b for b in bad)); sys.exit('REFUSED: the replica schema is not production\'s for the objects the chain uses')
print(f'  REPLICA_SCHEMA_PARITY PASS: {n} signature rows equal on both sides '
      f'(written tables, every dc_% view and function, the Map 1 reader, geo.zip_* functions)')
print(f'  production columns on read-only evidence tables the chain never names: {len(beyond)}')
print(f'  production dc_% views/functions the chain does not use (not in the replica): {len(extra_views)} {extra_views}')
PY2

echo "== 4. queue (the apply on a throwaway copy of the replica)"
dropdb --if-exists dcq; createdb -T "$REP" dcq
L -d dcq -f "$root/docs/dc-epoch-geography-apply.sql" >/dev/null
L -d dcq -tA -f "$root/docs/dc-geocode-observations-queue.sql" > "$w/dcg-in.jsonl"
dropdb dcq
echo "  queued addresses: $(grep -c . "$w/dcg-in.jsonl" || true)"

echo "== 5. derive through the production ladder (dry-run store; nothing written)"
if [ -n "${DCG_REPLAY:-}" ]; then cp "$DCG_REPLAY" "$w/dcg-out.jsonl"; else
DCG_INPUT="$w/dcg-in.jsonl" DCG_OUTPUT="$w/dcg-out.jsonl" RUN_REF="dryrun:${GITHUB_RUN_ID:-local}" DCG_DRY_RUN=1 \
  deno run --allow-net --allow-env --allow-read --allow-write="$w" "$root/scripts/dc-geocode-observations.ts"; fi

echo "== 6. ZCTA polygons near every point either state could place (production read-only)"
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
    union all select lat, lng from public.national_dc_records where lat is not null and lng is not null
    union all select * from unnest('$LATS'::float8[], '$LNGS'::float8[])
  ) p(lat, lng)
  join geo.zcta_boundary z2 on st_dwithin(z2.geom, st_setsrid(st_makepoint(p.lng, p.lat), 4269), 0.2))" "$w/zcta.csv"
L -d "$REP" -c "\\copy geo.zcta_boundary (zcta5, geom) from '$w/zcta.csv' with (format csv)"
echo "  ZCTA polygons copied: $(wc -l < "$w/zcta.csv")"

# TEST SEAM (offline harness only; the workflow never sets it): SQL run on the LOCAL REPLICA -- never
# on production -- so the parity refusal below can be shown refusing a replica that differs.
if [ -n "${DRYRUN_TEST_TAMPER_REPLICA_SQL:-}" ]; then
  echo "  (test) tampering with the replica only"
  L -d "$REP" -c "$DRYRUN_TEST_TAMPER_REPLICA_SQL" >/dev/null
fi

echo "== 7. PARITY: the replica's Map 1 output must equal production's"
Q="select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"
prod_select "$Q" "$w/before_prod.csv"
L -d "$REP" -c "create table public.dryrun_before as $Q"
L -d "$REP" -c "create table public.dryrun_geo_before as select * from public.dc_entity_geography"
L -d "$REP" -c "\\copy (select * from public.dryrun_before) to '$w/before_rep.csv' with (format csv)"
a="$(md5_sorted "$w/before_prod.csv")"; b="$(md5_sorted "$w/before_rep.csv")"
echo "  production $(wc -l < "$w/before_prod.csv") rows md5 $a"
echo "  replica    $(wc -l < "$w/before_rep.csv") rows md5 $b"
if [ "$a" != "$b" ]; then
  # diff exits 1 on a difference; under set -e + pipefail that would end the script here, silently,
  # before the refusal is stated (found by the negative control)
  { diff <(LC_ALL=C sort "$w/before_prod.csv") <(LC_ALL=C sort "$w/before_rep.csv") || true; } | head -20
  echo "REFUSED: the replica does not reproduce production's Map 1 output"; exit 1
fi

echo "== 8. apply, load, resolve and report (replica only)"
L -d "$REP" -f "$root/docs/dc-epoch-geography-apply.sql" >/dev/null
L -d "$REP" -tA -F'|' -P pager=off <<SQL | tee "$w/report.txt"
create temp table _dcg_in(j jsonb);
\\copy _dcg_in(j) from '$w/dcg-out.jsonl' with (format csv, quote e'\\x01', delimiter e'\\x02')
\\i $root/docs/dc-geocode-observations-load.sql
select 'RESOLVE_CANONICAL', metric, value from public.dc_resolve_canonical(true, false);
select 'RESOLVE_GEOGRAPHY', metric, value from public.dc_resolve_geography(true);
create temp table _before as select * from public.dryrun_before;
create temp table _geo_before as select * from public.dryrun_geo_before;
\\i $root/docs/dc-epoch-dryrun-report.sql
SQL

bad=$(grep -E '^(I06|I07|I08|I09|G07|G08|G09|L5|N08|N09|GX10|GX11|GX12) ' "$w/report.txt" | awk -F'|' '$3 != "0"' || true)
grep -q '^R6 RECONCILES (R1..R5 = I01)||true$' "$w/report.txt" || { echo "FAIL: the corpus does not reconcile"; exit 1; }
[ -z "$bad" ] || { echo "FAIL: a required-zero receipt is not zero: $bad"; exit 1; }
echo "DRY RUN COMPLETE: corpus reconciles, every required-zero receipt is 0. Production was only read."
