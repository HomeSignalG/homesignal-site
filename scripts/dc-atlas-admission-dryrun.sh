#!/usr/bin/env bash
# dc-atlas-admission-dryrun.sh - STAGE 8 of the Atlas plan: what would ADMITTING Atlas change, on TODAY's data?
#
# PRODUCTION IS ONLY READ (prod_copy: one SELECT per READ ONLY transaction, asserted in-session, rolled back;
# helpers copied verbatim from scripts/dc-atlas-phase-a-proof.sh, where they were proven).
#
#   1. copy current production (Phase A live, Atlas NOT admitted) into ONE disposable replica built from
#      this checkout's DDL of record, floats copied exactly;
#   2. PARITY: the replica's Map 1 over every registry ZIP must equal production's, row for row;
#   3. STEADY STATE: re-running both resolvers on the replica must write nothing, so its decisions are
#      production's rather than a re-derivation;
#   4. PHASE D on the replica only: the one-line admission switch taken from the DDL of record's own body,
#      then the identity and geography resolvers;
#   5. the existing national report (docs/dc-atlas-dryrun-report.sql): every bucket reconciled, EVERY changed
#      facility printed individually, architecture zeros;
#   6. ATTRIBUTION: every Map 1 change belongs to an entity whose geography or identity decision changed.
#
# Nothing is admitted in production. Dispatch-only from main: the workflow holds a production credential.
set -euo pipefail
: "${PROD_DB_URL:?}" "${PGHOST:?}"
root="$(cd "$(dirname "$0")/.." && pwd)"
w="$(mktemp -d)"; CMP="python3 $root/scripts/dc_phase_a_proof.py"
L() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
FAILS=0; fail() { echo "FAIL: $*"; FAILS=$((FAILS+1)); }
prod_copy() { # $1 = one SELECT/WITH query, $2 = output CSV (with header)
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
  # READ ONLY IS ENFORCED IN THE TRANSACTION, not by connection options: the production URL goes through a
  # pooler that DROPS startup options (measured: run 36174738257 hit the database's 2 min statement_timeout
  # although PGOPTIONS asked for 15 min, and a fresh session reads default_transaction_read_only = off).
  # So every read runs inside BEGIN ... READ ONLY, asserted in-session before the copy, then rolled back.
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
# EXACT FLOATS: production's configuration file sets extra_float_digits = 0, so its default text output of
# a float8 is rounded to 15 significant digits. Copied that way, every coordinate a replica is built from
# would be rounded (run 36175378803: 18 geocoded points moved in their 16th-17th digit), and every compared
# float would be blind below the 15th digit. Every production read and every compared dump sets 3
# (shortest round-trip exact).
clone() { dropdb --if-exists "$2"; createdb -T "$1" "$2"; }

Q_ENT="select canonical_entity_id, entity_grain, classification, classification_conflict, rule_version, observation_count, source_count, superseded_by, supersede_reason from public.dc_canonical_entity"
Q_LINK="select home_signal_observation_id, canonical_entity_id, source_key, distribution_key, publisher_record_id, observation_classification, classification_rule_key, classification_evidence, link_rule_key from public.dc_entity_observation"
Q_DEC="select observation_a, observation_b, decision_state, candidate_rule_key, decision_rule_key, rule_version, evidence from public.dc_identity_decision"
# every decision column; rule_version (a restamp, not a decision) and the two timestamps are the only exclusions.
# Geometry is compared as EXACT EWKB, never st_astext: text is formatted by the PostGIS version, which differs
# between production and the replica image, so identical points can print differently (run 36173136525: 18 rows).
# CSVs carry NULL as \N so the comparator can tell NULL from ''.
Q_GEO="select canonical_entity_id, geography_status, geometry_type, encode(st_asewkb(geom), 'hex') geom_ewkb, lat, lng, coordinate_decimals, authority_source_key, authority_observation_id, publisher_precision, quality_flags, rule_key, positional_uncertainty_m, provenance from public.dc_entity_geography"
Q_MAP="select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m"
Q_SNAPTXT="select 'entity' k, canonical_entity_id::text a, null::text b, concat_ws('|', entity_grain, classification, classification_conflict, rule_version, observation_count, source_count, superseded_by, supersede_reason) v from public.dc_canonical_entity
  union all select 'link', home_signal_observation_id::text, canonical_entity_id::text, concat_ws('|', source_key, distribution_key, link_rule_key) from public.dc_entity_observation
  union all select 'decision', observation_a::text, observation_b::text, concat_ws('|', decision_state, candidate_rule_key, decision_rule_key, rule_version) from public.dc_identity_decision"
dump() { # $1 db, $2 dir, $3 parts (comma list; entities+links always)
  mkdir -p "$2"
  rcopy "$1" "$Q_ENT" "$2/entities.csv"; rcopy "$1" "$Q_LINK" "$2/links.csv"
  case ",$3," in *,decisions,*) rcopy "$1" "$Q_DEC" "$2/decisions.csv";; esac
  case ",$3," in *,geo,*) rcopy "$1" "$Q_GEO" "$2/geo.csv";; esac
  case ",$3," in *,map1,*) rcopy "$1" "$Q_MAP" "$2/map1.csv";; esac
}

TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography dc_address_geocode national_dc_records canonical_zip_registry"
REP=rep

echo "== 0. live production preconditions (read-only)"
prod_copy "select now() at time zone 'UTC' as now_utc, public.dc_derived_address_admitted('compute_atlas','facilities') as atlas_admitted,
  (select count(*) from public.dc_entity_geography_evidence where source_key='compute_atlas' and evidence_class='DERIVED_ADDRESS') as atlas_evidence_rows,
  (select count(*) from public.dc_entity_geography_evidence where source_key='epoch_ai' and evidence_class='DERIVED_ADDRESS') as epoch_evidence_rows,
  (select count(*) from public.dc_address_geocode) as geocodes,
  (select max(started_at) from public.dc_acquisition_run) as newest_run,
  (select postgis_lib_version()) as postgis" "$w/pre.csv"
sed 's/^/  /' "$w/pre.csv"
IFS=, read -r _ ADM AEV _ _ _ _ < <(tail -1 "$w/pre.csv")
[ "$ADM" = f ] || { echo "STOP: Atlas is already admitted in production; this dry run answers a question that no longer exists"; exit 1; }
[ "$AEV" = 0 ] || { echo "STOP: Atlas derived evidence is already live in production"; exit 1; }

echo "== 1. one read-only copy of production into a replica of this checkout's DDL"
dropdb --if-exists "$REP"; createdb "$REP"
for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
         docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
  L -d "$REP" -f "$root/$f" >/dev/null
done
L -d "$REP" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
for t in $TABLES; do
  cols="$(L -d "$REP" -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  [ -n "$cols" ] || { echo "REFUSED: $t missing in the replica DDL"; exit 1; }
  prod_copy "select $cols from public.$t" "$w/$t.csv"
  printf '  %-26s %8s rows\n' "$t" "$(($(wc -l < "$w/$t.csv") - 1))"
done
prod_copy "select z.zcta5, z.geom from geo.zcta_boundary z where z.zcta5 in (
  select z2.zcta5 from (
    select source_native_lat, source_native_lon from public.dc_source_observation where source_native_lat is not null and source_native_lon is not null
    union all select lat, lng from public.dc_entity_geography where lat is not null and lng is not null
    union all select lat, lng from public.dc_address_geocode where lat is not null and lng is not null
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

echo "== 2. PARITY: the replica reproduces production's Map 1 over every registry ZIP"
mkdir -p "$w/prod" "$w/par"
prod_copy "$Q_MAP" "$w/prod/map1.csv"; prod_copy "$Q_ENT" "$w/prod/entities.csv"; prod_copy "$Q_LINK" "$w/prod/links.csv"
rcopy "$REP" "$Q_MAP" "$w/par/map1.csv"; rcopy "$REP" "$Q_ENT" "$w/par/entities.csv"; rcopy "$REP" "$Q_LINK" "$w/par/links.csv"
python3 -c "import csv; r=list(csv.reader(open('$w/prod/entities.csv'))); w=csv.writer(open('$w/all_ids.csv','w')); w.writerow(['canonical_entity_id']); [w.writerow([x[0]]) for x in r[1:]]"
$CMP compare "$w/prod" "$w/par" "$w/all_ids.csv" map1 zero > "$w/parity.json" || { cat "$w/parity.json"; echo "FAIL: the replica is not production"; exit 1; }
echo "  PARITY PASS $(cat "$w/parity.json")"

echo "== 3. STEADY STATE: the resolvers on the replica write nothing before admission"
L -d "$REP" <<SQL >/dev/null
create function public.dryrun_identity_rows() returns table(k text) language sql as \$\$
  select 'E|' || canonical_entity_id || '|' || entity_grain || '|' || classification || '|' || coalesce(superseded_by::text, '') from public.dc_canonical_entity
  union all select 'L|' || canonical_entity_id || '|' || home_signal_observation_id || '|' || link_rule_key from public.dc_entity_observation
  union all select 'D|' || observation_a || '|' || observation_b || '|' || candidate_rule_key || '|' || decision_state || '|' || coalesce(decision_rule_key, '') from public.dc_identity_decision
  union all select 'O|' || canonical_entity_id || '|' || other_entity_id || '|' || candidate_rule_key from public.dc_entity_identity_open \$\$;
create table public.dryrun_before as select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m;
create table public.dryrun_geo_before as select * from public.dc_entity_geography;
create table public.dryrun_id_before as select k from public.dryrun_identity_rows();
create table public.dryrun_src_before as select home_signal_observation_id, source_native_lat, source_native_lon, raw_payload from public.dc_source_observation;
SQL
L -d "$REP" -tA -F'|' -c "select metric, value from public.dc_resolve_canonical(true, false)" | LC_ALL=C sort > "$w/steady_id.txt"
L -d "$REP" -tA -F'|' -c "select 'ROWS_WRITTEN', value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN'" > "$w/steady_geo.txt"
{ grep -E '^(ENTITIES_MINTED|OBSERVATIONS_NEWLY_LINKED|OBSERVATIONS_RELINKED|ENTITIES_SUPERSEDED)\|' "$w/steady_id.txt" || true; } | sed 's/^/  /'
sed 's/^/  geography /' "$w/steady_geo.txt"
STEADY_ID="$(grep -cE '^(ENTITIES_MINTED|OBSERVATIONS_NEWLY_LINKED|OBSERVATIONS_RELINKED|ENTITIES_SUPERSEDED)\|0$' "$w/steady_id.txt" || true)"
[ "$STEADY_ID" = 4 ] && [ "$(cat "$w/steady_geo.txt")" = "ROWS_WRITTEN|0" ] \
  || { echo "FAIL: the resolvers write on the unadmitted replica, so its decisions are not production's (has production moved since the copy?)"; exit 1; }
L -d "$REP" <<SQL >/dev/null
create table public.dryrun_phase_a as select * from public.dryrun_before;
create table public.dryrun_geo_phase_a as select * from public.dryrun_geo_before;
SQL
echo "  STEADY STATE PASS (production already carries Phase A, so the report's 'before' and 'Phase A' are one state)"

echo "== 4. PHASE D on the replica only: the admission switch, then both resolvers"
python3 - "$root/docs/dc-step3d-derived-location.sql" > "$w/admit.sql" <<'PYADMIT'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"create or replace function public\.dc_derived_address_admitted\(.*?\$\$;", s, re.S)
old = "in (('epoch_ai', 'data_centers'))"
assert m and m.group(0).count(old) == 1, 'admission body shape changed'
print(m.group(0).replace(old, "in (('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities'))"))
PYADMIT
L -d "$REP" -f "$w/admit.sql" >/dev/null
L -d "$REP" -tA -F'|' <<SQL | sed 's/^/  phase D  /'
select 'ATLAS_ADMITTED_ON_REPLICA', public.dc_derived_address_admitted('compute_atlas','facilities')::text;
select 'RESOLVE_CANONICAL', metric, value from public.dc_resolve_canonical(true, false) where metric in ('ENTITIES_MINTED','OBSERVATIONS_NEWLY_LINKED','OBSERVATIONS_RELINKED','ENTITIES_SUPERSEDED');
select 'RESOLVE_GEOGRAPHY', metric, value from public.dc_resolve_geography(true) where metric in ('ENTITIES','ROWS_WRITTEN');
select 'RESOLVE_GEOGRAPHY_AGAIN', metric, value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN';
SQL

echo "== 5. report (replica only): every bucket reconciled, every changed facility individually"
L -d "$REP" -tA -F'|' -P pager=off <<SQL | tee "$w/report.txt"
create temp table _before as select * from public.dryrun_before;
create temp table _geo_before as select * from public.dryrun_geo_before;
create temp table _id_before as select * from public.dryrun_id_before;
create temp table _phase_a as select * from public.dryrun_phase_a;
create temp table _geo_phase_a as select * from public.dryrun_geo_phase_a;
create temp table _src_before as select * from public.dryrun_src_before;
create temp table _id_after as select k from public.dryrun_identity_rows();
\\i $root/docs/dc-atlas-dryrun-report.sql
-- 6. ATTRIBUTION: a Map 1 change whose entity changed neither geography nor identity is unexplained
select 'A01_UNATTRIBUTED_MAP1_CHANGES_ZERO', count(*)::text from _chg c
 where c.kind <> 'UNCHANGED' and c.ce is not null
   and not exists (select 1 from _geo_before b full join public.dc_entity_geography a using (canonical_entity_id)
                    where coalesce(a.canonical_entity_id, b.canonical_entity_id) = c.ce
                      and (b.geography_status, b.lat, b.lng, b.quality_flags, b.rule_key)
                          is distinct from (a.geography_status, a.lat, a.lng, a.quality_flags, a.rule_key))
   and not exists (select 1 from ((select k from _id_before except select k from _id_after)
                                  union all (select k from _id_after except select k from _id_before)) d
                    where position(c.ce::text in d.k) > 0);
select 'A02 MAP1_CHANGES_WITHOUT_A_CANONICAL_ENTITY', count(*)::text from _chg c where c.kind <> 'UNCHANGED' and c.ce is null;
SQL

bad_zero=$(grep -E '^[A-Z0-9]+_[A-Z0-9_]*_ZERO\|' "$w/report.txt" | awk -F'|' '$2 != "0"' || true)
bad_rc=$(grep -E '^RC_' "$w/report.txt" | awk -F'|' '$2 != "true"' || true)
n_rc=$(grep -cE '^RC_' "$w/report.txt" || true)
[ "$n_rc" -ge 5 ] || { echo "FAIL: only $n_rc reconciliation rows ran"; exit 1; }
[ -z "$bad_rc" ] || { echo "FAIL: a bucket set does not reconcile: $bad_rc"; exit 1; }
if [ -n "$bad_zero" ]; then echo "REVIEW: a required-zero receipt is not zero (listed for review, not hidden):"; echo "$bad_zero"; exit 1; fi
echo "ADMISSION DRY RUN COMPLETE: every change is listed and attributed; every bucket reconciles. Production was only read; Atlas is not admitted."
