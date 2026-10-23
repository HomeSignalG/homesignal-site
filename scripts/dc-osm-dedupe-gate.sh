#!/usr/bin/env bash
# dc-osm-dedupe-gate.sh — AUTOMATED GATE for the founder's same-building ruling (2026-10-23, "b"): hide an
# OpenStreetMap pin when exactly one canonical pin drawn on the same ZIP page lies within 150 m and names
# the same site. Production is only READ; the change is applied to a disposable replica only. Exits non-zero
# unless every gate check passes, so the apply job in dc-osm-dedupe-apply.yml (which needs this job) can only
# run on a pass.
#
#   0. production preconditions (read-only): the reader is the 2026-10-23 body, the helper does not exist;
#   1. a replica of this checkout's DDL of record, rolled back to production's EXACT current definitions
#      with docs/dc-osm-dedupe-rollback.sql (whose post-condition proves the fingerprint), then production's
#      rows copied in read-only, floats exact;
#   2. PARITY: the replica's Map 1 over every registry ZIP equals production's, row for row;
#   3. docs/dc-osm-dedupe-apply.sql -- the byte-identical production artifact -- applied to the replica;
#   4. STEADY STATE: both resolvers then write nothing and Map 1 does not move;
#   5. the gate (scripts/dc_osm_dedupe_gate.py): the after-state equals a prediction computed in Python from
#      the before-state alone (its own distance and name rule, never the reader), no row added, no pin moved,
#      canonical rows untouched, every removal an OSM pin with exactly one same-page canonical twin.
#
# Dispatch-only from main in CI: it holds a production credential. DCD_GATE_ARTIFACT lets the offline proof
# hand it a deliberately wrong artifact (the negative control); the workflow never sets it.
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


MAP1_BEFORE=2146b68afc2cda03948b1e1cd51b29b8
ART="${DCD_GATE_ARTIFACT:-docs/dc-osm-dedupe-apply.sql}"
Q_MAP="select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"
TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography dc_address_geocode national_dc_records canonical_zip_registry"
REP=dcd_gate

echo "== 0. production preconditions (read-only)"
prod_copy "select now() at time zone 'UTC' as now_utc,
  (select md5(prosrc) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'map1_dc_zip_members') as map1_md5,
  (to_regprocedure('public.dc_names_same_site(text,text,text,text)') is not null) as helper_exists" "$w/pre.csv"
sed 's/^/  /' "$w/pre.csv"
IFS=, read -r _ M1 HX < <(tail -1 "$w/pre.csv")
[ "$M1" = "$MAP1_BEFORE" ] && [ "$HX" = f ] \
  || { echo "REFUSED: production is not the 2026-10-23 state (map1 $M1, helper $HX); nothing to gate"; exit 1; }

echo "== 1. replica: this checkout's DDL, rolled back to production's current definitions, production's rows"
dropdb --if-exists "$REP"; createdb "$REP"
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  L -d "$REP" -f "$root/$f" >/dev/null
done
L -d "$REP" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
L -d "$REP" -f "$root/docs/dc-osm-dedupe-rollback.sql" >/dev/null || { echo "REFUSED: the rollback artifact did not reproduce production's current definitions"; exit 1; }
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
echo "  artifact: $ART sha256 $(sha256sum "$root/$ART" | cut -d' ' -f1)"
L -d "$REP" -f "$root/$ART" >/dev/null || { echo "FAIL: the apply artifact did not apply on the replica"; exit 1; }
L -d "$REP" -c "create table public.gate_after as $Q_MAP" >/dev/null

echo "== 4. STEADY STATE: the resolvers write nothing and Map 1 does not move"
steady="$(L -d "$REP" -tA -F'|' -c "select metric, value from public.dc_resolve_canonical(true, false)
                                     where metric in ('ENTITIES_MINTED','OBSERVATIONS_NEWLY_LINKED','OBSERVATIONS_RELINKED','ENTITIES_SUPERSEDED')
                                     union all select metric, value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN'")"
echo "$steady" | sed 's/^/  /'
nonzero="$(awk -F'|' '$2 != "0"' <<<"$steady")"
[ "$(wc -l <<<"$steady")" = 5 ] && [ -z "$nonzero" ] || { echo "FAIL: a resolver wrote after the change"; exit 1; }
L -d "$REP" -c "create table public.gate_after_resolve as $Q_MAP" >/dev/null
same="$(L -d "$REP" -tA -c "select (select count(*) from (select * from public.gate_after except select * from public.gate_after_resolve) x)
                                  + (select count(*) from (select * from public.gate_after_resolve except select * from public.gate_after) y)")"
[ "$same" = 0 ] || { echo "FAIL: Map 1 moved when the resolvers ran after the change ($same rows)"; exit 1; }

echo "== 5. THE GATE"
rcopy "$REP" "select * from public.gate_before" "$w/before.csv"
rcopy "$REP" "select * from public.gate_after" "$w/after.csv"
python3 "$root/scripts/dc_osm_dedupe_gate.py" "$w/before.csv" "$w/after.csv"
echo "GATE PASSED. Production was only read."
