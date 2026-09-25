#!/usr/bin/env bash
# dc-atlas-phase-a-proof.sh — the HARDENED Phase A zero-effect proof. Supersedes
# dc-atlas-phase-a-counterfactual.sh, which copied production AFTER the new-code identity run and
# whose comparator was never shown able to detect a difference.
#
# QUESTION (only this): given the same production evidence, does the Phase A code with Atlas
# unadmitted decide identity, canonical geography or Map 1 differently from the pre-#1335 code?
#
# PRODUCTION IS ONLY READ (prod_copy: one SELECT per session, READ ONLY, 2 s lock_timeout).
#
# 1. TRUE PRE-IDENTITY STATE, reconstructed from production's own history, never guessed:
#    T = 2026-09-25 15:25:00.080497Z, the start of the first identity run after the 14:44Z Atlas and
#    15:10Z Epoch acquisitions (cron.job_run_details). Measured before this script was written:
#      * 0 identity/geography writes of any kind between the 13:43:12Z snapshot and T;
#      * at T the resolver relinked 0 pre-existing links and re-decided 0 pre-existing decisions;
#      * every identity write after T carries T's transaction time; 16:25/17:25 wrote nothing.
#    So, at T:
#      observations/runs  = rows whose acquisition run started before T            (immutable)
#      derived geocodes   = rows derived before T                                  (append-only)
#      links, decisions   = current rows linked/decided before T                  (untouched at T)
#      entities           = current rows created before T; their MUTABLE fields (classification,
#                           counts, supersession) from the 13:43:12Z snapshot, the only record of
#                           their pre-T values (2,275 were modified at T)
#      geography          = the 13:43:12Z snapshot (0 geography writes between it and T)
#    and every one of these is VALIDATED below against evidence the reconstruction did not use.
# 2. OLD (main@f9d1326 DDL) and NEW (this checkout's DDL, Atlas unadmitted) start from that state,
#    fingerprinted identical; each runs its OWN identity then geography resolver; identity,
#    geography and Map 1 over every registry ZIP are compared row for row.
# 3. POSITIVE CONTROLS on disposable clones, through the SAME comparator (scripts/dc_phase_a_proof.py):
#    each must produce its exact expected nonzero result, or the run fails.
set -euo pipefail
: "${PROD_DB_URL:?}" "${PGHOST:?}"
root="$(cd "$(dirname "$0")/.." && pwd)"
OLD_SHA=f9d1326
S='2026-09-25 13:43:12+00'            # supabase_migrations 20260925134312 dc_atlas_phase_a_before_snapshot_20260925
T='2026-09-25 15:25:00.080497+00'     # cron.job_run_details: dc-resolve-canonical start
B1452='2026-09-25 14:52:45.962434+00' # live Map 1 measurement, recorded in the deploy receipt
LIVE1452_ROWS=1084; LIVE1452_MD5=c874ef2ad394c9dc5988f6f4929a5128
SNAP_IDENT_ROWS=19993; SNAP_IDENT_FP=331dd3c30518f1f258242d2e1cc91754
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
  PGOPTIONS='-c default_transaction_read_only=on -c lock_timeout=2s -c statement_timeout=15min -c idle_in_transaction_session_timeout=60s -c TimeZone=UTC' \
    psql "$PROD_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "\\copy ($q) to '$2' with (format csv, header)"
}
rcopy() { L -d "$1" -c "set timezone = 'UTC'" -c "\\copy ($2) to '$3' with (format csv, header)"; }
clone() { dropdb --if-exists "$2"; createdb -T "$1" "$2"; }

Q_ENT="select canonical_entity_id, entity_grain, classification, classification_conflict, rule_version, observation_count, source_count, superseded_by, supersede_reason from public.dc_canonical_entity"
Q_LINK="select home_signal_observation_id, canonical_entity_id, source_key, distribution_key, publisher_record_id, observation_classification, classification_rule_key, classification_evidence, link_rule_key from public.dc_entity_observation"
Q_DEC="select observation_a, observation_b, decision_state, candidate_rule_key, decision_rule_key, rule_version, evidence from public.dc_identity_decision"
Q_GEO="select canonical_entity_id, geography_status, geometry_type, lat, lng, coordinate_decimals, authority_source_key, authority_observation_id, publisher_precision, quality_flags, rule_key, positional_uncertainty_m, provenance from public.dc_entity_geography"
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
GATE_SQL="select 'ATLAS_ADMITTED', public.dc_derived_address_admitted('compute_atlas','facilities');
select 'ATLAS_EVIDENCE_ROWS', count(*) from public.dc_entity_geography_evidence where source_key = 'compute_atlas' and evidence_class = 'DERIVED_ADDRESS';
select 'EPOCH_EVIDENCE_ROWS', count(*) from public.dc_entity_geography_evidence where source_key = 'epoch_ai' and evidence_class = 'DERIVED_ADDRESS';"
gate() { L -d "$1" -tA -F'|' -c "$GATE_SQL" > "$2"; $CMP gate "$2"; }

echo "== 0. live production preconditions (read-only)"
prod_copy "select now() at time zone 'UTC' as now_utc, public.dc_derived_address_admitted('compute_atlas','facilities') as atlas_admitted,
  (select count(*) from public.dc_entity_geography_evidence where source_key='compute_atlas' and evidence_class='DERIVED_ADDRESS') as atlas_evidence_rows,
  (select count(*) from public.dc_entity_geography_evidence where source_key='epoch_ai' and evidence_class='DERIVED_ADDRESS') as epoch_evidence_rows,
  (select count(*) from public.dc_acquisition_run where started_at >= '$T') as runs_after_t,
  (select max(greatest(created_at, updated_at)) from public.dc_canonical_entity) as ent_last_write,
  (select max(greatest(created_at, updated_at)) from public.dc_entity_geography) as geo_last_write" "$w/pre.csv"
cat "$w/pre.csv" | sed 's/^/  /'
IFS=, read -r _ ADM AEV EEV RUNS_AFTER _ _ < <(tail -1 "$w/pre.csv")
[ "$ADM" = f ] || { echo "🛑 STOP: Atlas is admitted in production"; exit 1; }
[ "$AEV" = 0 ] || { echo "🛑 STOP: Atlas derived evidence is live in production"; exit 1; }

echo "== 1. one read-only copy of production + the retained 13:43:12Z snapshot"
TABLES="dc_source dc_acquisition_run dc_source_observation dc_canonical_entity dc_entity_observation dc_identity_decision dc_entity_geography dc_address_geocode national_dc_records canonical_zip_registry"
build() { # $1 db, $2 git ref ('' = checkout)
  dropdb --if-exists "$1"; createdb "$1"
  for f in test/zip_membership_pg/fixture_schema.sql docs/zip-membership-canonical.sql test/dc_epoch_geography_pg/fixture.sql \
           docs/dc-step3d-derived-location.sql docs/dc-step3a-canonical-identity.sql docs/dc-step3b-canonical-geography.sql docs/map1-dc-publication.sql; do
    if [ -n "$2" ]; then git -C "$root" show "$2:$f" > "$w/ddl.sql"; else cp "$root/$f" "$w/ddl.sql"; fi
    L -d "$1" -f "$w/ddl.sql" >/dev/null
  done
  L -d "$1" -c "create table if not exists public.canonical_zip_registry (zip text primary key)"
  L -d "$1" -c "create table public._snap_ident (k text, a text, b text, v text)"
  L -d "$1" -c "create table public._snap_geo as select canonical_entity_id, geography_status, geometry_type, null::text geom_wkt, lat, lng, coordinate_decimals, authority_source_key, authority_observation_id, publisher_precision, quality_flags, rule_key, rule_version, provenance, positional_uncertainty_m, created_at, updated_at from public.dc_entity_geography limit 0"
  L -d "$1" -c "create table public._snap_map1 as select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m limit 0"
}
build tmpl_old "$OLD_SHA"; build tmpl_new ""
for t in $TABLES; do
  cols="$(L -d tmpl_new -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  cols_old="$(L -d tmpl_old -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  [ -n "$cols" ] && [ "$cols" = "$cols_old" ] || { echo "REFUSED: $t differs between the two DDLs"; exit 1; }
  prod_copy "select $cols from public.$t" "$w/$t.csv"
  printf '  %-26s %8s rows\n' "$t" "$(($(wc -l < "$w/$t.csv") - 1))"
done
prod_copy "select k, a, b, v from public.dc_phase_a_ident_before_20260925" "$w/snap_ident.csv"
prod_copy "select canonical_entity_id, geography_status, geometry_type, geom_wkt, lat, lng, coordinate_decimals, authority_source_key, authority_observation_id, publisher_precision, quality_flags, rule_key, rule_version, provenance, positional_uncertainty_m, created_at, updated_at from public.dc_phase_a_geo_before_20260925" "$w/snap_geo.csv"
prod_copy "select * from public.dc_phase_a_map1_before_20260925" "$w/snap_map1.csv"
echo "  snapshot: ident $(($(wc -l < "$w/snap_ident.csv") - 1)) · geo $(($(wc -l < "$w/snap_geo.csv") - 1)) · map1 $(($(wc -l < "$w/snap_map1.csv") - 1))"
prod_copy "select z.zcta5, z.geom from geo.zcta_boundary z where z.zcta5 in (
  select z2.zcta5 from (
    select source_native_lat, source_native_lon from public.dc_source_observation where source_native_lat is not null and source_native_lon is not null
    union all select lat, lng from public.dc_entity_geography where lat is not null and lng is not null
    union all select lat, lng from public.dc_phase_a_geo_before_20260925 where lat is not null and lng is not null
    union all select lat, lng from public.dc_address_geocode where lat is not null and lng is not null
    union all select lat, lng from public.national_dc_records where lat is not null and lng is not null
  ) p(lat, lng)
  join geo.zcta_boundary z2 on st_dwithin(z2.geom, st_setsrid(st_makepoint(p.lng, p.lat), 4269), 0.2))" "$w/zcta.csv"
for db in tmpl_old tmpl_new; do
  { echo "set session_replication_role = replica;"
    echo "truncate $(sed 's/\([a-z_]*\)/public.\1/g; s/ /, /g' <<<"$TABLES"), geo.zcta_boundary cascade;"
    for t in $TABLES; do echo "\\copy public.$t ($(head -1 "$w/$t.csv")) from '$w/$t.csv' with (format csv, header)"; done
    echo "\\copy geo.zcta_boundary (zcta5, geom) from '$w/zcta.csv' with (format csv, header)"
    echo "\\copy public._snap_ident from '$w/snap_ident.csv' with (format csv, header)"
    echo "\\copy public._snap_geo from '$w/snap_geo.csv' with (format csv, header)"
    echo "\\copy public._snap_map1 from '$w/snap_map1.csv' with (format csv, header)"
  } > "$w/load.sql"
  L -d "$db" -f "$w/load.sql" >/dev/null
  for t in $TABLES; do
    n="$(L -d "$db" -tA -c "select count(*) from public.$t")"
    [ "$n" = "$(($(wc -l < "$w/$t.csv") - 1))" ] || { echo "REFUSED: $db.$t loaded $n rows"; exit 1; }
  done
done

echo "== 2. PARITY: a replica of CURRENT production reproduces production's Map 1 over every registry ZIP"
prod_copy "$Q_MAP" "$w/prod_map1.csv"; prod_copy "$Q_ENT" "$w/prod_entities.csv"; prod_copy "$Q_LINK" "$w/prod_links.csv"
mkdir -p "$w/prod" && cp "$w/prod_map1.csv" "$w/prod/map1.csv" && cp "$w/prod_entities.csv" "$w/prod/entities.csv" && cp "$w/prod_links.csv" "$w/prod/links.csv"
python3 -c "import csv,sys; r=list(csv.reader(open('$w/prod/entities.csv'))); w=csv.writer(open('$w/all_ids.csv','w')); w.writerow(['canonical_entity_id']); [w.writerow([x[0]]) for x in r[1:]]"
dump tmpl_new "$w/par" map1
$CMP compare "$w/prod" "$w/par" "$w/all_ids.csv" map1 zero > "$w/parity.json" || { cat "$w/parity.json"; fail "replica is not production"; exit 1; }
echo "  PARITY PASS $(cat "$w/parity.json")"
echo "== 2b. PARITY NEGATIVE CONTROL: one nudged Map 1 input on a clone must be refused"
clone tmpl_new ctl_parity
L -d ctl_parity -c "update public.dc_entity_geography set lat = lat + 1e-7 where canonical_entity_id = (
   select m.canonical_entity_id from ($Q_MAP) m where m.publication_basis = 'canonical' and m.zip in (select zip from ($Q_MAP) z group by zip having count(*) = 1)
    group by m.canonical_entity_id having count(*) = 1 order by m.canonical_entity_id limit 1)" >/dev/null
dump ctl_parity "$w/ctl_parity" map1
if $CMP compare "$w/prod" "$w/ctl_parity" "$w/all_ids.csv" map1 control '{"map1.row_diff": 2, "map1.moved": 1, "map1.added": 0, "map1.removed": 0}' > "$w/c_parity.txt"; then
  PARITY_NEG=true; else PARITY_NEG=false; fi
tail -2 "$w/c_parity.txt" | sed 's/^/  /'; dropdb ctl_parity
[ "$PARITY_NEG" = true ] || fail "PARITY_NEGATIVE_CONTROL not detected"

reconstruct() { # $1 db, $2 boundary for observations/runs/geocodes
  L -d "$1" <<SQL >/dev/null
set session_replication_role = replica;
delete from public.dc_source_observation o using public.dc_acquisition_run r where r.id = o.acquisition_run_id and r.started_at >= '$2';
delete from public.dc_acquisition_run where started_at >= '$2';
delete from public.dc_address_geocode where derived_at >= '$2';
delete from public.dc_identity_decision where decided_at >= '$T';
delete from public.dc_entity_observation where linked_at >= '$T';
delete from public.dc_canonical_entity where created_at >= '$T';
update public.dc_canonical_entity e set
   entity_grain = split_part(s.v, '|', 1), classification = split_part(s.v, '|', 2),
   classification_conflict = split_part(s.v, '|', 3)::boolean, rule_version = split_part(s.v, '|', 4)::int,
   observation_count = split_part(s.v, '|', 5)::int, source_count = split_part(s.v, '|', 6)::int,
   superseded_by = nullif(split_part(s.v, '|', 7), '')::uuid,
   supersede_reason = case when split_part(s.v, '|', 7) = '' then null
                           else substr(s.v, length(array_to_string((string_to_array(s.v, '|'))[1:7], '|')) + 2) end
  from public._snap_ident s where s.k = 'entity' and s.a = e.canonical_entity_id::text;
truncate public.dc_entity_geography;
insert into public.dc_entity_geography (canonical_entity_id, geography_status, geometry_type, geom, lat, lng, coordinate_decimals,
       authority_source_key, authority_observation_id, publisher_precision, quality_flags, rule_key, rule_version, provenance,
       positional_uncertainty_m, created_at, updated_at)
select canonical_entity_id, geography_status, geometry_type,
       case when geom_wkt is null then null else st_setsrid(st_geomfromtext(geom_wkt), 4326) end, lat, lng, coordinate_decimals,
       authority_source_key, authority_observation_id, publisher_precision, quality_flags, rule_key, rule_version, provenance,
       positional_uncertainty_m, created_at, updated_at from public._snap_geo;
SQL
}

echo "== 3. RECONSTRUCTION VALIDATED against evidence it did not use"
clone tmpl_new val_s; reconstruct val_s "$S"
rcopy val_s "$Q_MAP" "$w/val_s_map1.csv"
python3 - "$w/snap_map1.csv" "$w/val_s_map1.csv" <<'PY' > "$w/v1.txt" || true
import csv, sys, collections
a = collections.Counter(tuple(r) for r in list(csv.reader(open(sys.argv[1])))[1:])
b = collections.Counter(tuple(r) for r in list(csv.reader(open(sys.argv[2])))[1:])
print(sum(a.values()), sum(b.values()), sum(((a - b) + (b - a)).values()))
PY
read -r V1A V1B V1D < "$w/v1.txt"
echo "  V1 boundary 13:43:12Z: reconstructed Map 1 $V1B rows vs the snapshot's own Map 1 table $V1A rows, row diff $V1D"
[ "$V1D" = 0 ] && [ "$V1A" -gt 0 ] || fail "V1 reconstruction at the snapshot boundary does not reproduce the snapshot Map 1"
dropdb val_s
clone tmpl_new val_1452; reconstruct val_1452 "$B1452"
V2="$(L -d val_1452 -tA -c "set timezone='UTC'" -c "select count(*) || ' ' || md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from ($Q_MAP) x")"
echo "  V2 boundary 14:52:45Z: reconstructed Map 1 = $V2 | live measurement at that instant = $LIVE1452_ROWS $LIVE1452_MD5"
[ "$V2" = "$LIVE1452_ROWS $LIVE1452_MD5" ] || fail "V2 reconstruction does not reproduce the live 14:52:45Z Map 1 measurement"
dropdb val_1452

echo "== 4. the common pre-identity starting state at T = $T"
clone tmpl_old rep_old; clone tmpl_new rep_new
reconstruct rep_old "$T"; reconstruct rep_new "$T"
for db in rep_old rep_new; do
  L -d "$db" -tA -c "set timezone='UTC'" -c "
    with t as ($Q_SNAPTXT)
    select 'IDENT_ROWS|' || count(*) from t
    union all select 'IDENT_FP|' || md5(string_agg(concat_ws('~',k,a,b,v), E'\n' order by concat_ws('~',k,a,b,v) collate \"C\")) from t
    union all select 'IDENT_VS_SNAPSHOT_DIFF|' || (select count(*) from ((select k,a,b,v from t except all select k,a,b,v from public._snap_ident) union all (select k,a,b,v from public._snap_ident except all select k,a,b,v from t)) d)
    union all select 'START_FP|' || md5(concat_ws('#',
        (select md5(string_agg(concat_ws('~',k,a,b,v), E'\n' order by concat_ws('~',k,a,b,v) collate \"C\")) from t),
        (select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select home_signal_observation_id, acquisition_run_id, raw_record_sha256 from public.dc_source_observation) x),
        (select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select id, source_key, distribution_key, started_at, completeness_state from public.dc_acquisition_run) x),
        (select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select derivation_id, geocoder_query, ladder_version, match_type, lat, lng from public.dc_address_geocode) x),
        (select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from ($Q_GEO) x),
        (select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select zip from public.canonical_zip_registry) x)))
    union all select 'START_OBSERVATIONS|' || count(*) from public.dc_source_observation
    union all select 'START_CURRENT_OBSERVATIONS|' || count(*) from public.dc_current_observation
    union all select 'START_ENTITIES|' || count(*) from public.dc_canonical_entity
    union all select 'START_LINKS|' || count(*) from public.dc_entity_observation
    union all select 'START_DECISIONS|' || count(*) from public.dc_identity_decision
    union all select 'START_UNLINKED|' || count(*) from public.dc_current_observation c where not exists (select 1 from public.dc_entity_observation eo where eo.home_signal_observation_id = c.home_signal_observation_id)
    union all select 'START_GEOCODES|' || count(*) from public.dc_address_geocode
    union all select 'START_GEOGRAPHY|' || count(*) from public.dc_entity_geography" > "$w/start_$db.txt"
  sed "s/^/  $db /" "$w/start_$db.txt"
done
sv() { grep "^$2|" "$w/start_$1.txt" | cut -d'|' -f2; }
[ "$(sv rep_old START_FP)" = "$(sv rep_new START_FP)" ] || fail "OLD_START_FP != NEW_START_FP"
for db in rep_old rep_new; do
  [ "$(sv $db IDENT_ROWS)" = "$SNAP_IDENT_ROWS" ] && [ "$(sv $db IDENT_FP)" = "$SNAP_IDENT_FP" ] && [ "$(sv $db IDENT_VS_SNAPSHOT_DIFF)" = 0 ] \
    || fail "$db: reconstructed identity does not equal the 13:43:12Z snapshot fingerprint $SNAP_IDENT_FP"
done
L -d rep_new -tA -c "select canonical_entity_id from public.dc_canonical_entity" > "$w/start_ids.txt"
{ echo canonical_entity_id; cat "$w/start_ids.txt"; } > "$w/start_ids.csv"
for db in rep_old rep_new; do
  rcopy "$db" "select row_to_json(c)::text j from public.dc_identity_candidate c" "$w/cand_$db.csv"
done
CO="$(tail -n +2 "$w/cand_rep_old.csv" | LC_ALL=C sort | md5sum | cut -c1-32)"; CN="$(tail -n +2 "$w/cand_rep_new.csv" | LC_ALL=C sort | md5sum | cut -c1-32)"
echo "  IDENTITY_CANDIDATES OLD $(($(wc -l < "$w/cand_rep_old.csv") - 1)) $CO | NEW $(($(wc -l < "$w/cand_rep_new.csv") - 1)) $CN"
[ "$CO" = "$CN" ] && [ "$(wc -l < "$w/cand_rep_old.csv")" -gt 1 ] || fail "identity candidates differ (or are empty)"

echo "== 5. IDENTITY: each replica runs its own dc_resolve_canonical from the common state"
for db in rep_old rep_new; do
  L -d "$db" -tA -F'|' -c "select metric, value from public.dc_resolve_canonical(true, false)" | LC_ALL=C sort > "$w/res_id_$db.txt"
  grep -E '^(ENTITIES_MINTED|OBSERVATIONS_RELINKED|ENTITIES_SUPERSEDED|OBSERVATIONS_NEWLY_LINKED|MATCH_COMPONENTS_REFUSED_SIBLING|AUTO_MATCH_EDGES)\|' "$w/res_id_$db.txt" | sed "s/^/  $db /"
done
cmp -s "$w/res_id_rep_old.txt" "$w/res_id_rep_new.txt" || { diff "$w/res_id_rep_old.txt" "$w/res_id_rep_new.txt" | head; fail "resolver metrics differ"; }
dump rep_old "$w/id_old" decisions; dump rep_new "$w/id_new" decisions
$CMP compare "$w/id_old" "$w/id_new" "$w/start_ids.csv" entities,links,decisions zero > "$w/id.json" || fail "IDENTITY_ROW_DIFF != 0"
echo "  IDENTITY $(cat "$w/id.json")"
clone rep_new rep_new_postid

echo "== 6. GEOGRAPHY: each replica runs its own dc_resolve_geography"
for db in rep_old rep_new; do
  L -d "$db" -tA -F'|' -c "select metric, value from public.dc_resolve_geography(true) where metric in ('ENTITIES','ROWS_WRITTEN')" | sed "s/^/  $db /"
  L -d "$db" -tA -F'|' -c "select 'AGAIN_ROWS_WRITTEN', value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN'" | sed "s/^/  $db /"
done
dump rep_old "$w/f_old" decisions,geo,map1; dump rep_new "$w/f_new" decisions,geo,map1
$CMP compare "$w/f_old" "$w/f_new" "$w/start_ids.csv" entities,links,decisions,geo,map1 zero > "$w/final.json" || fail "OLD vs NEW differ after geography / Map 1"
echo "  FINAL $(cat "$w/final.json")"
gate rep_new "$w/gate_real.txt" | sed 's/^/  NEW /' || fail "admission/evidence gate on the NEW replica"
sed 's/^/  NEW /' "$w/gate_real.txt"

echo "== 7. REPLAY vs PRODUCTION: the NEW replay reproduces what production actually decided at 15:25/15:35"
prod_copy "$Q_DEC" "$w/prod/decisions.csv"; prod_copy "$Q_GEO" "$w/prod/geo.csv"
$CMP compare "$w/prod" "$w/f_new" "$w/start_ids.csv" entities,links,decisions,geo,map1 zero > "$w/v4.json" || fail "the NEW replay does not reproduce production's actual outcome"
echo "  REPLAY_VS_PRODUCTION $(cat "$w/v4.json")"

echo "== 8. POSITIVE CONTROLS (disposable clones only; the SAME comparator; exact expected results)"
N_ROWS="$(python3 -c "import json;print(json.load(open('$w/final.json'))['map1']['rows'][0])")"
N_ZIPS="$(python3 -c "import json;print(json.load(open('$w/final.json'))['map1']['zip_pages'][0])")"
N_FAC="$(python3 -c "import json;print(json.load(open('$w/final.json'))['map1']['facilities'][0])")"
control() { # $1 name, $2 dir, $3 parts, $4 expected JSON
  if $CMP compare "$w/f_old" "$2" "$w/start_ids.csv" "$3" control "$4" > "$w/c_$1.txt"; then r=true; else r=false; fi
  echo "  $1: expected $4"; echo "  $1: observed $(head -1 "$w/c_$1.txt")"; echo "  $1: DETECTED=$r"
  [ "$r" = true ] || fail "control $1 not detected"
}
# a facility that is the ONLY Map 1 row of its ZIP page: Map 1 caps rows per ZIP (has_more), so a control
# moved into a crowded ZIP could displace another row and the exact expectation would be wrong
SINGLE="select m.canonical_entity_id, min(m.zip) zip from ($Q_MAP) m where m.publication_basis = 'canonical'
  and m.zip in (select zip from ($Q_MAP) z group by zip having count(*) = 1) group by m.canonical_entity_id having count(*) = 1"
clone rep_new c_map1
L -d c_map1 -c "update public.dc_entity_geography set lat = lat + 1e-7 where canonical_entity_id = (select canonical_entity_id from ($SINGLE) s order by canonical_entity_id limit 1)" >/dev/null
dump c_map1 "$w/c_map1" map1; dropdb c_map1
control MAP1 "$w/c_map1" map1 '{"map1.row_diff": 2, "map1.moved": 1, "map1.added": 0, "map1.removed": 0, "map1.zip_changed": 0}'
clone rep_new c_swap
L -d c_swap <<SQL >/dev/null
create temp table p as select canonical_entity_id, zip from ($SINGLE) s order by canonical_entity_id limit 1;
insert into p select canonical_entity_id, zip from ($SINGLE) s where zip <> (select zip from p) order by canonical_entity_id limit 1;
create temp table g as select canonical_entity_id, lat, lng, geom from public.dc_entity_geography where canonical_entity_id in (select canonical_entity_id from p);
update public.dc_entity_geography e set lat = o.lat, lng = o.lng, geom = o.geom
  from g o where o.canonical_entity_id <> e.canonical_entity_id and e.canonical_entity_id in (select canonical_entity_id from p);
SQL
dump c_swap "$w/c_swap" map1; dropdb c_swap
control EQUAL_TOTALS_SWAP "$w/c_swap" map1 "{\"map1.rows\": [$N_ROWS, $N_ROWS], \"map1.zip_pages\": [$N_ZIPS, $N_ZIPS], \"map1.facilities\": [$N_FAC, $N_FAC], \"map1.added\": 0, \"map1.removed\": 0, \"map1.moved\": 2, \"map1.zip_changed\": 2, \"map1.row_diff\": 4}"
clone rep_new_postid c_id
L -d c_id -c "update public.dc_canonical_entity set classification = case when classification = 'NON_DC' then 'DC_CANDIDATE' else 'NON_DC' end
  where canonical_entity_id = (select canonical_entity_id from public.dc_canonical_entity where superseded_by is null and canonical_entity_id::text in (select a from public._snap_ident where k = 'entity') order by canonical_entity_id limit 1)" >/dev/null
dump c_id "$w/c_id" decisions; dropdb c_id
if $CMP compare "$w/id_old" "$w/c_id" "$w/start_ids.csv" entities,links,decisions control '{"entities.row_diff": 2, "links.row_diff": 0, "decisions.row_diff": 0, "identity_row_diff": 2}' > "$w/c_IDENTITY.txt"; then r=true; else r=false; fi
echo "  IDENTITY: observed $(head -1 "$w/c_IDENTITY.txt")"; echo "  IDENTITY: DETECTED=$r"; [ "$r" = true ] || fail "control IDENTITY not detected"
clone rep_new c_geo
L -d c_geo -c "update public.dc_entity_geography set quality_flags = array_append(quality_flags, 'PROOF_CONTROL') where canonical_entity_id = (select min(canonical_entity_id::text)::uuid from public.dc_entity_geography)" >/dev/null
dump c_geo "$w/c_geo" geo; dropdb c_geo
control GEOGRAPHY "$w/c_geo" geo '{"geo.row_diff": 2}'
python3 - "$root/docs/dc-step3d-derived-location.sql" > "$w/admit.sql" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
m = re.search(r"create or replace function public\.dc_derived_address_admitted\(.*?\$\$;", s, re.S)
old = "in (('epoch_ai', 'data_centers'))"
assert m and m.group(0).count(old) == 1, 'admission body shape changed'
print(m.group(0).replace(old, "in (('epoch_ai', 'data_centers'), ('compute_atlas', 'facilities'))"))
PY
clone rep_new c_admit; L -d c_admit -f "$w/admit.sql" >/dev/null
if gate c_admit "$w/gate_admit.txt" > "$w/c_ADMISSION.txt"; then r=false; else r=true; fi
dropdb c_admit
echo "  ADMISSION: $(tr '\n' ' ' < "$w/gate_admit.txt")-> $(cat "$w/c_ADMISSION.txt") DETECTED=$r"; [ "$r" = true ] || fail "control ADMISSION not detected"
clone rep_new c_leak
VD="$(L -d c_leak -tA -c "select pg_get_viewdef('public.dc_entity_geography_evidence'::regclass)")"
python3 - "$VD" > "$w/leak.sql" <<'PY'
import sys
v = sys.argv[1]
n = v.count(' AND dp.admitted')
assert n == 1, f'expected the admission predicate exactly once, found {n}'
print('create or replace view public.dc_entity_geography_evidence as ' + v.replace(' AND dp.admitted', '').rstrip().rstrip(';') + ';')
PY
L -d c_leak -f "$w/leak.sql" >/dev/null
if gate c_leak "$w/gate_leak.txt" > "$w/c_LEAK.txt"; then r=false; else r=true; fi
grep -q '^ATLAS_ADMITTED|f' "$w/gate_leak.txt" || r=false   # the leak control must leak WITHOUT admission
dropdb c_leak
echo "  EVIDENCE_LEAK: $(tr '\n' ' ' < "$w/gate_leak.txt")-> $(cat "$w/c_LEAK.txt") DETECTED=$r"; [ "$r" = true ] || fail "control EVIDENCE_LEAK not detected"
echo "  PARITY_NEGATIVE_CONTROL: DETECTED=$PARITY_NEG"

echo "== 9. result"
if [ "$FAILS" -ne 0 ]; then echo "PHASE A ZERO-EFFECT PROOF — NOT PROVEN ($FAILS failure(s) above)"; exit 1; fi
echo "PHASE A ZERO-EFFECT PROOF — every control detected; OLD and NEW identical from the reconstructed pre-identity state; replay reproduces production. Production was only read."
