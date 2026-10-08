#!/usr/bin/env bash
# dc-verdict-gate.sh — C7 AUTOMATED GATE (founder, 2026-09-26: "no manual human review", "automated checks").
#
# What would the tightened derived-point verdict do to TODAY's production data? Production is only READ;
# the change is applied to a disposable replica only. Exits non-zero unless every gate check in
# docs/dc-verdict-gate.sql passes, so the apply job in dc-verdict-apply.yml (which needs this job) can only
# run on a pass.
#
#   0. production preconditions (read-only): the pre-C7 verdict, the C3c switch and reader live;
#   1. a replica of this checkout's DDL of record, rolled back to production's EXACT pre-C7 verdict with
#      docs/dc-verdict-rollback.sql (whose post-condition proves the fingerprint), then production's rows
#      copied in read-only, floats exact;
#   2. PARITY: the replica's Map 1 over every registry ZIP equals production's, row for row;
#   3. BASELINE: both resolvers run on the replica BEFORE the change, so anything production has not yet
#      resolved is settled first and only C7's own effect is compared (what they wrote is reported);
#   4. docs/dc-verdict-apply.sql -- the byte-identical production artifact -- applied to the replica, then
#      both resolvers run (the verdict reaches canonical placements only through them), then run AGAIN and
#      must write nothing (steady state);
#   5. the gate: every verdict flip is the rule's prediction, every Map 1 change belongs to an entity or
#      OSM record reading a flipped address and is of an allowed kind, no pin moved, identity unchanged,
#      every other entity's geography byte-identical, rows reconcile.
set -euo pipefail
: "${PROD_DB_URL:?}" "${PGHOST:?}"
root="$(cd "$(dirname "$0")/.." && pwd)"
w="$(mktemp -d)"
L() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
prod_copy() { # $1 = one SELECT/WITH query, $2 = output CSV (with header). Verbatim from dc-atlas-admission-dryrun.sh.
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
  psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 \
    -c "begin transaction isolation level repeatable read, read only" \
    -c "set local statement_timeout = '15min'" -c "set local lock_timeout = '2s'" \
    -c "set local idle_in_transaction_session_timeout = '60s'" -c "set local timezone = 'UTC'" \
    -c "set local extra_float_digits = 3" \
    -c "do \$\$ begin if current_setting('transaction_read_only') <> 'on' then raise exception 'prod_copy: transaction is not read-only'; end if; end \$\$" \
    -c "\\copy ($q) to '$2' with (format csv, header, null '\N')" \
    -c "rollback"
}
rcopy() { L -d "$1" -c "set timezone = 'UTC'" -c "set extra_float_digits = 3" -c "\\copy ($2) to '$3' with (format csv, header, null '\N')"; }

VERDICT_BEFORE=4cd5b97def7d6179900cd95ec452d9a7
SWITCH_LIVE=2c05d65aba736fab7c79199e78614ab6
MAP1_LIVE=2146b68afc2cda03948b1e1cd51b29b8
Q_MAP="select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"
TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography dc_address_geocode national_dc_records canonical_zip_registry"
REP=dcv_gate
RESOLVE="select 'canonical:' || metric, value from public.dc_resolve_canonical(true, false)
          where metric in ('ENTITIES_MINTED','OBSERVATIONS_NEWLY_LINKED','OBSERVATIONS_RELINKED','ENTITIES_SUPERSEDED')
         union all select 'geography:' || metric, value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN'"

echo "== 0. production preconditions (read-only)"
prod_copy "select now() at time zone 'UTC' as now_utc,
  (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'dc_derived_point_verdict') as verdict_md5,
  (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'dc_derived_address_admitted') as switch_md5,
  (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'map1_dc_zip_members') as map1_md5" "$w/pre.csv"
sed 's/^/  /' "$w/pre.csv"
IFS=, read -r _ VD SW M1 < <(tail -1 "$w/pre.csv")
[ "$SW" = "$SWITCH_LIVE" ] && [ "$M1" = "$MAP1_LIVE" ] \
  || { echo "REFUSED: production is not the C3c state (switch $SW, map1 $M1)"; exit 1; }
[ "$VD" = "$VERDICT_BEFORE" ] || { echo "REFUSED: production is not the pre-C7 verdict ($VD); nothing to gate"; exit 1; }

echo "== 1. replica: this checkout's DDL, rolled back to production's pre-C7 verdict, production's rows"
dropdb --if-exists "$REP"; createdb "$REP"
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  L -d "$REP" -f "$root/$f" >/dev/null
done
L -d "$REP" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
L -d "$REP" -f "$root/docs/dc-verdict-rollback.sql" >/dev/null || { echo "REFUSED: the rollback artifact did not reproduce the pre-C7 verdict"; exit 1; }
for t in $TABLES; do
  cols="$(L -d "$REP" -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  [ -n "$cols" ] || { echo "REFUSED: $t missing in the replica DDL"; exit 1; }
  prod_copy "select $cols from public.$t" "$w/$t.csv"
  printf '  %-26s %8s rows\n' "$t" "$(($(wc -l < "$w/$t.csv") - 1))"
done
prod_copy "select z.zcta5, z.geom from geo.zcta_boundary z where z.zcta5 in (
  select z2.zcta5 from (
    select lat, lng from public.dc_entity_geography where lat is not null and lng is not null
    union all select lat, lng from public.national_dc_records where lat is not null and lng is not null
  ) p(lat, lng)
  join geo.zcta_boundary z2 on st_dwithin(z2.geom, st_setsrid(st_makepoint(p.lng, p.lat), 4269), 0.2))" "$w/zcta.csv"
{ echo "set session_replication_role = replica;"
  echo "truncate $(sed 's/\([a-z_]*\)/public.\1/g; s/ /, /g' <<<"$TABLES"), geo.zcta_boundary cascade;"
  for t in $TABLES; do echo "\\copy public.$t ($(head -1 "$w/$t.csv")) from '$w/$t.csv' with (format csv, header, null '\N')"; done
  echo "\\copy geo.zcta_boundary (zcta5, geom) from '$w/zcta.csv' with (format csv, header, null '\N')"
} > "$w/load.sql"
L -d "$REP" -f "$w/load.sql" >/dev/null
for t in $TABLES; do
  n="$(L -d "$REP" -tA -c "select count(*) from public.$t")"
  [ "$n" = "$(($(wc -l < "$w/$t.csv") - 1))" ] || { echo "REFUSED: $REP.$t loaded $n rows"; exit 1; }
done

echo "== 2. PARITY: the replica's Map 1 equals production's, row for row"
prod_copy "$Q_MAP" "$w/prod_map1.csv"; rcopy "$REP" "$Q_MAP" "$w/rep_map1.csv"
python3 - "$w/prod_map1.csv" "$w/rep_map1.csv" <<'PY' || exit 1
import csv, sys
a = sorted(map(tuple, csv.reader(open(sys.argv[1])))); b = sorted(map(tuple, csv.reader(open(sys.argv[2]))))
if a != b or len(a) < 2:
    print(f'FAIL: replica Map 1 differs from production ({len(a)-1} vs {len(b)-1} rows; '
          f'{len(set(a) ^ set(b))} rows differ)'); sys.exit(1)
print(f'  PARITY PASS: {len(a) - 1} Map 1 rows identical')
PY

echo "== 3. BASELINE: both resolvers run on the replica before the change (settles anything production has not)"
L -d "$REP" -tA -F'|' -c "$RESOLVE" | sed 's/^/  baseline /'
L -d "$REP" -q <<'SQL'
create table public.gate_before as select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m;
create table public.gate_geo_before as select * from public.dc_entity_geography;
create table public.gate_osm_before as select * from public.dc_osm_address_check;
create table public.gate_verdict_before as
  select d.geocoder_query, d.matched_address, v.verdict from public.dc_address_geocode d
  cross join lateral public.dc_derived_point_verdict(d.match_type, d.provider_candidates, d.geocoder_query, d.matched_address, d.lat, d.lng) v
  where d.ladder_version = public.dc_geocode_ladder_version();
create table public.gate_ident_before as
  select (select count(*) from public.dc_canonical_entity) as entities, (select count(*) from public.dc_entity_observation) as links,
         (select count(*) from public.dc_identity_decision) as decisions,
         (select md5(string_agg(canonical_entity_id::text || ':' || home_signal_observation_id::text, ',' order by canonical_entity_id::text || ':' || home_signal_observation_id::text collate "C"))
            from public.dc_entity_observation) as links_md5;
SQL

echo "== 4. apply the production artifact to the replica (never to production here), then the resolvers"
L -d "$REP" -f "$root/docs/dc-verdict-apply.sql" >/dev/null || { echo "FAIL: the C7 apply artifact did not apply on the replica"; exit 1; }
L -d "$REP" -tA -F'|' -c "$RESOLVE" | sed 's/^/  after-change /'
L -d "$REP" -c "create table public.gate_after as $Q_MAP" >/dev/null
steady="$(L -d "$REP" -tA -F'|' -c "$RESOLVE")"
echo "$steady" | sed 's/^/  steady /'
nonzero="$(awk -F'|' '$2 != "0"' <<<"$steady")"
[ "$(wc -l <<<"$steady")" = 5 ] && [ -z "$nonzero" ] || { echo "FAIL: a resolver still wrote on a second run after the change"; exit 1; }

echo "== 5. THE GATE"
L -d "$REP" -tA -F'|' -P pager=off -f "$root/docs/dc-verdict-gate.sql" | tee "$w/gate.txt"
n_g="$(grep -cE '^G[0-9]+_' "$w/gate.txt" || true)"
bad="$(grep -E '^G[0-9]+_' "$w/gate.txt" | awk -F'|' '$2 != "true"' || true)"
[ "$n_g" = 12 ] || { echo "FAIL: only $n_g gate checks ran (expected 12)"; exit 1; }
if [ -n "$bad" ]; then echo "GATE REFUSED:"; echo "$bad"; exit 1; fi
echo "GATE PASSED: $(grep '^G02' "$w/gate.txt" | cut -d'|' -f3); $(grep '^G11' "$w/gate.txt" | cut -d'|' -f3). Every change reads a flipped address, no pin moved, identity unchanged. Production was only read."
