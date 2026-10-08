#!/usr/bin/env bash
# dc-osm-map1-gate.sh — C3c AUTOMATED GATE (founder, 2026-09-26: "no manual human review", "automated checks").
#
# What would the C3c Map 1 change do to TODAY's production data? Production is only READ; the change is
# applied to a disposable replica only. Exits non-zero unless every gate check in docs/dc-osm-map1-gate.sql
# passes, so the apply job in dc-osm-map1-apply.yml (which needs this job) can only run on a pass.
#
#   0. production preconditions (read-only): C3a live, C3c not yet applied;
#   1. a replica of this checkout's DDL of record, rolled back to production's EXACT pre-C3c definitions
#      with docs/dc-osm-map1-rollback.sql (whose post-condition proves the fingerprints), then production's
#      rows copied in read-only, floats exact;
#   2. PARITY: the replica's Map 1 over every registry ZIP equals production's, row for row;
#   3. docs/dc-osm-map1-apply.sql -- the byte-identical production artifact -- applied to the replica;
#   4. STEADY STATE: both resolvers then write nothing (the switch reaches no canonical decision);
#   5. the gate: after == prediction exactly, no pin moved, no row added, every change an admitted OSM
#      check outcome, canonical rows byte-identical, withheld <= disagreements, rows reconcile.
#
# Dispatch-only from main in CI: it holds a production credential. DCO_GATE_OFFLINE=1 lets the offline proof
# point it at a disposable stand-in instead.
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

SWITCH_BEFORE=31cb6c9e7481311ab33042a8845c9276
MAP1_BEFORE=9fc1c9f51375f25db5658a14ca36937c
Q_MAP="select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"
TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography dc_address_geocode national_dc_records canonical_zip_registry"
REP=dco_gate

echo "== 0. production preconditions (read-only)"
prod_copy "select now() at time zone 'UTC' as now_utc,
  (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'dc_derived_address_admitted') as switch_md5,
  (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'map1_dc_zip_members') as map1_md5,
  (to_regclass('public.dc_osm_address_check') is not null) as c3a_live,
  (select count(*) from public.dc_geocode_queue) as queue_rows" "$w/pre.csv"
sed 's/^/  /' "$w/pre.csv"
IFS=, read -r _ SW M1 C3A QR < <(tail -1 "$w/pre.csv")
[ "$C3A" = t ] || { echo "REFUSED: C3a (the OSM layer check) is not live in production"; exit 1; }
[ "$SW" = "$SWITCH_BEFORE" ] && [ "$M1" = "$MAP1_BEFORE" ] \
  || { echo "REFUSED: production is not the pre-C3c state (switch $SW, map1 $M1); nothing to gate"; exit 1; }
echo "  queue rows still waiting for the geocoder: $QR (checked as UNCHECKED_NOT_YET_GEOCODED: never withheld)"

echo "== 1. replica: this checkout's DDL, rolled back to production's pre-C3c definitions, production's rows"
dropdb --if-exists "$REP"; createdb "$REP"
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  L -d "$REP" -f "$root/$f" >/dev/null
done
L -d "$REP" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
L -d "$REP" -f "$root/docs/dc-osm-map1-rollback.sql" >/dev/null || { echo "REFUSED: the rollback artifact did not reproduce the pre-C3c definitions"; exit 1; }
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
L -d "$REP" -c "create table public.gate_before as $Q_MAP" >/dev/null

echo "== 3. apply the production artifact to the replica (never to production here)"
L -d "$REP" -f "$root/docs/dc-osm-map1-apply.sql" >/dev/null || { echo "FAIL: the C3c apply artifact did not apply on the replica"; exit 1; }
L -d "$REP" -c "create table public.gate_after as $Q_MAP" >/dev/null

echo "== 4. STEADY STATE: the resolvers write nothing after the switch (it reaches no canonical decision)"
steady="$(L -d "$REP" -tA -F'|' -c "select metric, value from public.dc_resolve_canonical(true, false)
                                     where metric in ('ENTITIES_MINTED','OBSERVATIONS_NEWLY_LINKED','OBSERVATIONS_RELINKED','ENTITIES_SUPERSEDED')
                                     union all select metric, value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN'")"
echo "$steady" | sed 's/^/  /'
nonzero="$(awk -F'|' '$2 != "0"' <<<"$steady")"
[ "$(wc -l <<<"$steady")" = 5 ] && [ -z "$nonzero" ] || { echo "FAIL: a resolver wrote after the C3c switch"; exit 1; }
L -d "$REP" -c "create table public.gate_after_resolve as $Q_MAP" >/dev/null
same="$(L -d "$REP" -tA -c "select (select count(*) from (select * from public.gate_after except select * from public.gate_after_resolve) x)
                                  + (select count(*) from (select * from public.gate_after_resolve except select * from public.gate_after) y)")"
[ "$same" = 0 ] || { echo "FAIL: Map 1 moved when the resolvers ran after the switch ($same rows)"; exit 1; }

echo "== 5. THE GATE"
L -d "$REP" -tA -F'|' -P pager=off -f "$root/docs/dc-osm-map1-gate.sql" | tee "$w/gate.txt"
n_g="$(grep -cE '^G[0-9]+_' "$w/gate.txt" || true)"
bad="$(grep -E '^G[0-9]+_' "$w/gate.txt" | awk -F'|' '$2 != "true"' || true)"
[ "$n_g" = 11 ] || { echo "FAIL: only $n_g gate checks ran (expected 11)"; exit 1; }
if [ -n "$bad" ]; then echo "GATE REFUSED:"; echo "$bad"; exit 1; fi
echo "GATE PASSED: $(grep '^G06' "$w/gate.txt" | cut -d'|' -f3), $(grep '^G07' "$w/gate.txt" | cut -d'|' -f3); every change is an admitted OSM check outcome, no pin moved, canonical rows untouched. Production was only read."
