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

echo "== 2. local pre-apply replica from main@$MAIN_SHA"
dropdb --if-exists "$REP"; createdb "$REP"
L -d "$REP" -f "$root/test/zip_membership_pg/fixture_schema.sql" >/dev/null
git -C "$root" show "$MAIN_SHA:docs/zip-membership-canonical.sql" > "$w/zm.sql"; L -d "$REP" -f "$w/zm.sql" >/dev/null
L -d "$REP" -f "$root/test/dc_epoch_geography_pg/fixture.sql" >/dev/null
for f in docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  git -C "$root" show "$MAIN_SHA:$f" > "$w/chain.sql"; L -d "$REP" -f "$w/chain.sql" >/dev/null
done
L -d "$REP" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
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
  diff <(LC_ALL=C sort "$w/before_prod.csv") <(LC_ALL=C sort "$w/before_rep.csv") | head -20
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

bad=$(grep -E '^(I06|I07|I08|I09|G07|G08|G09|L5|N08|N09) ' "$w/report.txt" | awk -F'|' '$3 != "0"' || true)
grep -q '^R6 RECONCILES (R1..R5 = I01)||true$' "$w/report.txt" || { echo "FAIL: the corpus does not reconcile"; exit 1; }
[ -z "$bad" ] || { echo "FAIL: a required-zero receipt is not zero: $bad"; exit 1; }
echo "DRY RUN COMPLETE: corpus reconciles, every required-zero receipt is 0. Production was only read."
