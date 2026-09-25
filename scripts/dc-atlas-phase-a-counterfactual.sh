#!/usr/bin/env bash
# dc-atlas-phase-a-counterfactual.sh — AFTER Phase A is applied: does Phase A change anything, on the
# data production holds NOW?
#
# Why a counterfactual and not a before/after diff: production's data moves under the deployment
# (the daily Compute Atlas acquisition, the daily Epoch acquisition, the hourly resolvers), so a
# before/after diff of production mixes the deployment's effect with the data's. This isolates the
# code: the SAME production data is resolved by the OLD code (main@f9d1326, before #1335) and by the
# NEW code (production's current definitions, Atlas NOT admitted), each on its own disposable replica
# of production's own database image, and the two are compared row for row.
#
# PRODUCTION IS ONLY READ (prod_select: one SELECT per session, READ ONLY, 2 s lock_timeout).
#
# Gates (all must hold):
#   * the NEW replica reproduces production's Map 1 over every registry ZIP, row for row (parity:
#     proves the replica IS production);
#   * OLD vs NEW after each side's resolvers: Map 1 rows / ZIP pages / facilities / full-row
#     fingerprint equal; added = removed = moved = ZIP-changed = 0; geography decisions (the 8
#     decision fields) equal; identity rows equal;
#   * Atlas NOT admitted in production and on the NEW replica; 0 Atlas rows in NEW's geography evidence.
set -euo pipefail
: "${PROD_DB_URL:?}" "${PGHOST:?}"
root="$(cd "$(dirname "$0")/.." && pwd)"
OLD_SHA=f9d1326
w="$(mktemp -d)"
L() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
md5_sorted() { LC_ALL=C sort "$1" | md5sum | cut -d' ' -f1; }
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

echo "== 1. production state (read-only)"
prod_select "select now()::text, public.dc_derived_address_admitted('compute_atlas','facilities')::text, public.dc_derived_address_admitted('epoch_ai','data_centers')::text,
  (select count(*) from public.dc_address_geocode)::text, (select max(completed_at) from public.dc_acquisition_run)::text,
  (select max(updated_at) from public.dc_entity_geography)::text" "$w/prod_state.csv"
echo "  now, atlas_admitted, epoch_admitted, geocodes, last_acquisition, geography_max_updated: $(cat "$w/prod_state.csv")"
[ "$(cut -d, -f2 "$w/prod_state.csv")" = false ] || { echo "🛑 Atlas is admitted in production"; exit 1; }
[ "$(cut -d, -f3 "$w/prod_state.csv")" = true ] || { echo "FAIL: Epoch not admitted in production"; exit 1; }

build() { # $1 = db, $2 = git ref for the DDL of record ('' = working tree)
  dropdb --if-exists "$1"; createdb "$1"
  for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
           docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
    if [ -n "$2" ]; then git -C "$root" show "$2:$f" > "$w/ddl.sql"; else cp "$root/$f" "$w/ddl.sql"; fi
    L -d "$1" -f "$w/ddl.sql" >/dev/null
  done
  L -d "$1" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
}
echo "== 2. replicas: OLD = main@$OLD_SHA DDL of record; NEW = this checkout's DDL of record"
build rep_old "$OLD_SHA"
build rep_new ""

echo "== 3. one copy of production's tables, loaded into BOTH replicas"
TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography dc_address_geocode national_dc_records canonical_zip_registry"
for db in rep_old rep_new; do
  { echo "set session_replication_role = replica;"; echo "truncate $(sed 's/\([a-z_]*\)/public.\1/g; s/ /, /g' <<<"$TABLES"), geo.zcta_boundary cascade;"; } > "$w/load_$db.sql"
done
for t in $TABLES; do
  cols="$(L -d rep_new -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  cols_old="$(L -d rep_old -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  [ -n "$cols" ] && [ "$cols" = "$cols_old" ] || { echo "REFUSED: table $t differs between the two DDLs ($cols | $cols_old)"; exit 1; }
  prod_select "select $cols from public.$t" "$w/$t.csv"
  for db in rep_old rep_new; do echo "\\copy public.$t ($cols) from '$w/$t.csv' with (format csv)" >> "$w/load_$db.sql"; done
  printf '  %-26s %8s rows\n' "$t" "$(wc -l < "$w/$t.csv")"
done
prod_select "select z.zcta5, z.geom from geo.zcta_boundary z where z.zcta5 in (
  select z2.zcta5 from (
    select source_native_lat, source_native_lon from public.dc_source_observation where source_native_lat is not null and source_native_lon is not null
    union all select lat, lng from public.dc_entity_geography where lat is not null and lng is not null
    union all select lat, lng from public.dc_address_geocode where lat is not null and lng is not null
    union all select lat, lng from public.national_dc_records where lat is not null and lng is not null
  ) p(lat, lng)
  join geo.zcta_boundary z2 on st_dwithin(z2.geom, st_setsrid(st_makepoint(p.lng, p.lat), 4269), 0.2))" "$w/zcta.csv"
for db in rep_old rep_new; do
  echo "\\copy geo.zcta_boundary (zcta5, geom) from '$w/zcta.csv' with (format csv)" >> "$w/load_$db.sql"
  L -d "$db" -f "$w/load_$db.sql" >/dev/null
  for t in $TABLES; do
    n="$(L -d "$db" -tA -c "select count(*) from public.$t")"
    [ "$n" = "$(wc -l < "$w/$t.csv" | tr -d ' ')" ] || { echo "REFUSED: $db.$t loaded $n rows"; exit 1; }
  done
done
echo "  ZCTA polygons: $(wc -l < "$w/zcta.csv") (both replicas)"

echo "== 4. PARITY: the NEW replica reproduces production's Map 1 over every registry ZIP (before any resolver)"
Q="select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"
prod_select "$Q" "$w/map_prod.csv"
L -d rep_new -c "\\copy ($Q) to '$w/map_new0.csv' with (format csv)"
a="$(md5_sorted "$w/map_prod.csv")"; b="$(md5_sorted "$w/map_new0.csv")"
echo "  production $(wc -l < "$w/map_prod.csv") rows md5 $a"
echo "  NEW replica $(wc -l < "$w/map_new0.csv") rows md5 $b"
[ "$a" = "$b" ] || { diff <(LC_ALL=C sort "$w/map_prod.csv") <(LC_ALL=C sort "$w/map_new0.csv") | head -10 || true; echo "REFUSED: replica is not production"; exit 1; }
echo "  PARITY PASS"

echo "== 4b. the resolvers' INPUTS, OLD vs NEW on the same data (identity candidates; geography evidence)"
# dc_resolve_canonical is byte-identical on both sides, so equal candidate sets mean equal identity
# decisions; dc_resolve_geography is not (rule_version 5), so its OUTPUTS are compared in step 6 too.
for db in rep_old rep_new; do
  L -d "$db" -c "\\copy (select row_to_json(c)::text from public.dc_identity_candidate c) to '$w/cand_$db.txt'"
  L -d "$db" -c "\\copy (select row_to_json(e)::text from (select canonical_entity_id, oid, source_key, prec, lat, lng, decimals, basis, basis_rule, uncertainty_m, evidence_class from public.dc_entity_geography_evidence) e) to '$w/ev_$db.txt'"
  L -d "$db" -tA -c "select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'dc_resolve_canonical'" > "$w/canon_md5_$db.txt"
done
for k in cand ev; do
  a="$(md5_sorted "$w/${k}_rep_old.txt")"; b="$(md5_sorted "$w/${k}_rep_new.txt")"
  echo "  $k: OLD $(wc -l < "$w/${k}_rep_old.txt") rows $a | NEW $(wc -l < "$w/${k}_rep_new.txt") rows $b"
  [ "$(wc -l < "$w/${k}_rep_old.txt")" -gt 0 ] || { echo "FAIL: control: $k is empty"; exit 1; }
  [ "$a" = "$b" ] || { diff <(LC_ALL=C sort "$w/${k}_rep_old.txt") <(LC_ALL=C sort "$w/${k}_rep_new.txt") | head -10 || true; echo "FAIL: Phase A changes the resolver input $k"; exit 1; }
done
cmp -s "$w/canon_md5_rep_old.txt" "$w/canon_md5_rep_new.txt" || { echo "FAIL: dc_resolve_canonical differs between OLD and NEW"; exit 1; }
echo "  INPUT_PARITY PASS: identity candidates and geography evidence identical; dc_resolve_canonical identical ($(cat "$w/canon_md5_rep_new.txt"))"

echo "== 5. each replica runs ITS OWN resolvers (identity then geography), exactly as the hourly cron does"
for db in rep_old rep_new; do
  L -d "$db" -tA -F'|' <<'SQL' | sed "s/^/  $db /"
select 'CANONICAL', metric, value from public.dc_resolve_canonical(true, false) where metric in ('ENTITIES_MINTED','OBSERVATIONS_RELINKED','REFUSED_IDENTITY_PENDING');
select 'GEOGRAPHY', metric, value from public.dc_resolve_geography(true) where metric in ('ENTITIES','ROWS_WRITTEN');
select 'GEOGRAPHY_AGAIN', metric, value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN';
SQL
  L -d "$db" -c "\\copy ($Q) to '$w/map_$db.csv' with (format csv)"
  L -d "$db" -c "\\copy (select canonical_entity_id, geography_status, lat, lng, quality_flags, rule_key, authority_observation_id, positional_uncertainty_m, provenance from public.dc_entity_geography) to '$w/geo_$db.csv' with (format csv)"
  L -d "$db" -c "\\copy (select 'E', canonical_entity_id::text, concat_ws('|', entity_grain, classification, classification_conflict, observation_count, source_count, superseded_by, supersede_reason) from public.dc_canonical_entity
                        union all select 'L', home_signal_observation_id::text, concat_ws('|', canonical_entity_id, source_key, distribution_key, link_rule_key) from public.dc_entity_observation
                        union all select 'D', observation_a::text || '/' || observation_b::text, concat_ws('|', decision_state, candidate_rule_key, decision_rule_key) from public.dc_identity_decision) to '$w/id_$db.csv' with (format csv)"
done
L -d rep_new -tA -F'|' <<'SQL' | tee "$w/new_admission.txt" | sed 's/^/  rep_new /'
select 'ATLAS_ADMITTED', public.dc_derived_address_admitted('compute_atlas','facilities');
select 'ATLAS_DERIVED_ACCEPTED', count(*) from public.dc_observation_derived_point where source_key = 'compute_atlas' and verdict = 'ACCEPTED';
select 'ATLAS_EVIDENCE_ROWS', count(*) from public.dc_entity_geography_evidence where source_key = 'compute_atlas' and evidence_class = 'DERIVED_ADDRESS';
select 'EPOCH_EVIDENCE_ROWS', count(*) from public.dc_entity_geography_evidence where source_key = 'epoch_ai' and evidence_class = 'DERIVED_ADDRESS';
SQL

echo "== 6. OLD vs NEW on the same data"
python3 - "$w" <<'PY'
import csv, sys, hashlib, collections
w = sys.argv[1]
def rows(f): return [tuple(r) for r in csv.reader(open(f"{w}/{f}"))]
def fp(rs): return hashlib.md5('\n'.join(sorted(','.join(r) for r in rs)).encode()).hexdigest()
mo, mn = rows('map_rep_old.csv'), rows('map_rep_new.csv')
def by_src(rs):  # zip, then map1 columns: source_key is column 1
    d = collections.defaultdict(list)
    for r in rs: d[r[1]].append(r)
    return {k: (sorted(x[0] for x in v), sorted((x[11], x[12]) for x in v)) for k, v in d.items()}
bo, bn = by_src(mo), by_src(mn)
co, cn = collections.Counter(mo), collections.Counter(mn)
out = {
  'MAP1_ROWS old/new': f"{len(mo)} / {len(mn)}",
  'MAP1_ZIPS old/new': f"{len({r[0] for r in mo})} / {len({r[0] for r in mn})}",
  'MAP1_FACILITIES old/new': f"{len(bo)} / {len(bn)}",
  'MAP1_ENTITIES old/new': f"{len({r[19] for r in mo if r[19]})} / {len({r[19] for r in mn if r[19]})}",
  'MAP1_FP old': fp(mo), 'MAP1_FP new': fp(mn),
  'MAP1_ROW_DIFF_ZERO': sum(((co - cn) + (cn - co)).values()),
  'ADDED_ZERO': len(set(bn) - set(bo)), 'REMOVED_ZERO': len(set(bo) - set(bn)),
  'MOVED_ZERO': sum(1 for k in set(bo) & set(bn) if bo[k][1] != bn[k][1]),
  'ZIP_CHANGED_ZERO': sum(1 for k in set(bo) & set(bn) if bo[k][0] != bn[k][0]),
}
go, gn = collections.Counter(rows('geo_rep_old.csv')), collections.Counter(rows('geo_rep_new.csv'))
out['GEO_ENTITIES old/new'] = f"{sum(go.values())} / {sum(gn.values())}"
out['GEO_DECISION_DIFF_ZERO'] = sum(((go - gn) + (gn - go)).values())
io, inn = collections.Counter(rows('id_rep_old.csv')), collections.Counter(rows('id_rep_new.csv'))
out['IDENTITY_ROWS old/new'] = f"{sum(io.values())} / {sum(inn.values())}"
out['IDENTITY_DIFF_ZERO'] = sum(((io - inn) + (inn - io)).values())
for k, v in out.items(): print(f"  {k}|{v}")
bad = [k for k, v in out.items() if k.endswith('_ZERO') and v != 0]
if out['MAP1_FP old'] != out['MAP1_FP new']: bad.append('MAP1_FP')
if bad: sys.exit('FAIL: Phase A changes an outcome on production data: ' + ', '.join(bad))
PY
adm() { grep "^$1|" "$w/new_admission.txt" | cut -d'|' -f2; }
[ "$(adm ATLAS_ADMITTED)" = f ] && [ "$(adm ATLAS_EVIDENCE_ROWS)" = 0 ] || { echo "🛑 FAIL: Atlas reaches the decision plane"; exit 1; }
echo "COUNTERFACTUAL COMPLETE: on production's current data, the Phase A code and the pre-#1335 code produce identical Map 1, geography and identity. Production was only read."
