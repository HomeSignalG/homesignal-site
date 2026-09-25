#!/usr/bin/env bash
# dc-atlas-phase-a-proof.sh — the HARDENED Phase A zero-effect proof. Supersedes
# dc-atlas-phase-a-counterfactual.sh, which copied production AFTER the new-code identity run and
# whose comparator was never shown able to detect a difference.
#
# QUESTION (only this): given the same production evidence, does the Phase A code with Atlas
# unadmitted decide identity, canonical geography or Map 1 differently from the pre-#1335 code?
#
# PRODUCTION IS ONLY READ (prod_copy: one SELECT per READ ONLY transaction, asserted in-session, rolled back).
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
#    and every one of these is VALIDATED below against evidence the reconstruction did not use:
#      V1 the S state reproduces the snapshot's own Map 1 table; V2 the 14:52:45Z state reproduces the
#      live Map 1 measured then; V3 the resolver runs in [S,T) saw only the S state and the OLD code
#      they ran writes nothing on it (so a write hidden by a later T timestamp cannot exist);
#      step 7 the NEW replay reproduces production's actual 15:25/15:35 outcome.
# 2. OLD (main@f9d1326 DDL; its 7 DDL files are byte-identical to #1335's merge parent 71659bb) and NEW
#    (this checkout's DDL, Atlas unadmitted) — asserted to be DIFFERENT code in step 1a — start from that state,
#    fingerprinted identical; each runs its OWN identity then geography resolver; identity,
#    geography and Map 1 over every registry ZIP are compared row for row.
# 3. POSITIVE CONTROLS on disposable clones, each with an exact expected result, or the run fails:
#    Map 1 move, equal-totals swap, identity (entity; link + decision), geography, and admission END TO
#    END (the NEW resolvers re-run with Atlas admitted) all go through the SAME comparator
#    (scripts/dc_phase_a_proof.py); the admission and evidence-leak GATE controls must show Atlas
#    evidence rows > 0 with Epoch's count unchanged; the parity control must be refused.
# 4. Phase A also changed ACQUISITION: its Atlas queue derived geocodes that did not exist before, and a
#    derivation is keyed by address text alone. Step 4 proves no admitted observation consumes one, and
#    step 6b replays OLD in the true pre-#1335 world (without them) and must equal the replay.
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
# This proof is a DATED receipt of 2026-09-25: step 7 compares the replay with production's decisions as
# the T runs left them. Once production resolves anything later, those decisions are gone and the proof
# cannot be re-derived as written; it must REFUSE, never pass on a moved production.
ID_LAST='2026-09-25 15:25:00.081306+00'; GEO_LAST='2026-09-25 15:35:00.081314+00'
prod_copy "select (select count(*) from public.dc_canonical_entity where created_at > '$ID_LAST' or updated_at > '$ID_LAST')
     + (select count(*) from public.dc_entity_observation where linked_at > '$ID_LAST')
     + (select count(*) from public.dc_identity_decision where decided_at > '$ID_LAST') as identity_writes_after_t_run,
  (select count(*) from public.dc_entity_geography where created_at > '$GEO_LAST' or updated_at > '$GEO_LAST') as geo_writes_after_t_run,
  (select count(*) from public.dc_entity_geography where updated_at = '$GEO_LAST') as control_geo_rows_at_t_run" "$w/quiet.csv"
sed 's/^/  /' "$w/quiet.csv"
IFS=, read -r QI QG QC < <(tail -1 "$w/quiet.csv")
[ "$QI" = 0 ] && [ "$QG" = 0 ] && [ "$QC" -gt 0 ] || { echo "🛑 DATED: production has resolved evidence after the 15:25/15:35 runs this proof replays; it is a receipt of 2026-09-25, not re-runnable as written"; exit 1; }

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
  # the replica's run table is the fixture's (no timestamps): each run's real start time is read from
  # production into this helper, and the time boundary filters by run id through it
  L -d "$1" -c "create table public._run_time (id uuid primary key, started_at timestamptz not null)"
  L -d "$1" -c "create table public._snap_geo as select canonical_entity_id, geography_status, geometry_type, null::text geom_wkt, lat, lng, coordinate_decimals, authority_source_key, authority_observation_id, publisher_precision, quality_flags, rule_key, rule_version, provenance, positional_uncertainty_m, created_at, updated_at from public.dc_entity_geography limit 0"
  L -d "$1" -c "create table public._snap_map1 as select r.zip, m.* from public.canonical_zip_registry r cross join lateral public.map1_dc_zip_members(r.zip) m limit 0"
}
build tmpl_old "$OLD_SHA"; build tmpl_new ""
echo "== 1a. OLD and NEW are genuinely different code (an identical pair would make every zero below vacuous)"
DEFQ="select p.proname k, md5(p.prosrc) v from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('map1_dc_zip_members','dc_record_citation','dc_resolve_canonical','dc_resolve_geography','dc_derived_address_admitted')
      union all select c.relname, md5(pg_get_viewdef(c.oid)) from pg_class c where c.relnamespace = 'public'::regnamespace
        and c.relname in ('dc_current_observation','dc_entity_geography_evidence','dc_identity_candidate','dc_observation_derived_point')"
for db in tmpl_old tmpl_new; do L -d "$db" -tA -F'|' -c "$DEFQ" | LC_ALL=C sort > "$w/defs_$db.txt"; done
python3 - "$w/defs_tmpl_old.txt" "$w/defs_tmpl_new.txt" <<'PY' || { fail "CODE_DIFFERS"; exit 1; }
import sys
o = dict(l.strip().split('|') for l in open(sys.argv[1]) if l.strip())
n = dict(l.strip().split('|') for l in open(sys.argv[2]) if l.strip())
for k in sorted(set(o) | set(n)):
    print(f'  {k:32s} OLD {o.get(k, "absent")[:12]:12s} NEW {n.get(k, "absent")[:12]:12s} {"same" if o.get(k) == n.get(k) else "DIFFERENT"}')
bad = []
if 'dc_derived_address_admitted' in o or 'dc_derived_address_admitted' not in n: bad.append('admission function must exist on NEW only')
if o.get('dc_resolve_geography') == n.get('dc_resolve_geography'): bad.append('geography resolver must differ')
for k in ('map1_dc_zip_members', 'dc_record_citation', 'dc_current_observation'):
    if not o.get(k) or o.get(k) != n.get(k): bad.append(f'{k} must be present and identical (Phase A does not change Map 1)')
print('  CODE_DIFFERS ' + ('PASS' if not bad else 'FAIL ' + '; '.join(bad)))
sys.exit(1 if bad else 0)
PY
prod_copy "select postgis_lib_version() as postgis" "$w/pgis.csv"
echo "  POSTGIS production $(tail -1 "$w/pgis.csv") | replicas $(L -d tmpl_new -tA -c 'select postgis_lib_version()')"
for t in $TABLES; do
  cols="$(L -d tmpl_new -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  cols_old="$(L -d tmpl_old -tA -c "select string_agg(quote_ident(column_name), ',' order by ordinal_position) from information_schema.columns where table_schema = 'public' and table_name = '$t' and is_generated = 'NEVER'")"
  [ -n "$cols" ] && [ "$cols" = "$cols_old" ] || { echo "REFUSED: $t differs between the two DDLs"; exit 1; }
  prod_copy "select $cols from public.$t" "$w/$t.csv"
  printf '  %-26s %8s rows\n' "$t" "$(($(wc -l < "$w/$t.csv") - 1))"
done
prod_copy "select k, a, b, v from public.dc_phase_a_ident_before_20260925" "$w/snap_ident.csv"
prod_copy "select id, started_at from public.dc_acquisition_run" "$w/run_time.csv"
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
    for t in $TABLES; do echo "\\copy public.$t ($(head -1 "$w/$t.csv")) from '$w/$t.csv' with (format csv, header, null '\N')"; done
    echo "\\copy geo.zcta_boundary (zcta5, geom) from '$w/zcta.csv' with (format csv, header, null '\N')"
    echo "\\copy public._snap_ident from '$w/snap_ident.csv' with (format csv, header, null '\N')"
    echo "\\copy public._run_time from '$w/run_time.csv' with (format csv, header, null '\N')"
    echo "\\copy public._snap_geo from '$w/snap_geo.csv' with (format csv, header, null '\N')"
    echo "\\copy public._snap_map1 from '$w/snap_map1.csv' with (format csv, header, null '\N')"
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
do \$chk\$ begin
  if exists (select 1 from public.dc_acquisition_run a where not exists (select 1 from public._run_time t where t.id = a.id)) then
    raise exception 'a replica run has no production start time';
  end if; end \$chk\$;
delete from public.dc_source_observation o using public._run_time r where r.id = o.acquisition_run_id and r.started_at >= '$2';
delete from public.dc_acquisition_run a using public._run_time r where r.id = a.id and r.started_at >= '$2';
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
# the live 14:52:45Z fingerprint was taken in a production session, whose extra_float_digits is 0: match it
V2="$(L -d val_1452 -tA -c "set timezone='UTC'" -c "set extra_float_digits = 0" -c "select count(*) || ' ' || md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from ($Q_MAP) x")"
echo "  V2 boundary 14:52:45Z: reconstructed Map 1 = $V2 | live measurement at that instant = $LIVE1452_ROWS $LIVE1452_MD5"
[ "$V2" = "$LIVE1452_ROWS $LIVE1452_MD5" ] || fail "V2 reconstruction does not reproduce the live 14:52:45Z Map 1 measurement"
dropdb val_1452

# V3 closes the one gap timestamps cannot: an identity/geography row modified in [S,T) and AGAIN at T would
# carry T's timestamp and hide the first write. So prove the resolver runs in [S,T) wrote nothing at all:
# (a) production: every resolver run in [S,T) ended before the first new input after S (acquisition run
#     or derived geocode), so each saw exactly the S state; and no row carries a write time in [S,T);
# (b) replica: the OLD code (what production ran before the 14:49Z apply) re-run on the S state writes 0.
echo "== 3b. V3: the resolver runs between the snapshot and T wrote nothing"
RJOBS="from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname in ('dc-resolve-canonical','dc-resolve-geography') and d.start_time >= '$S' and d.start_time < '$T'"
prod_copy "select (select count(*) $RJOBS) as resolver_runs, (select string_agg(j.jobname || '@' || d.start_time || '/' || d.status, ' ' order by d.start_time) $RJOBS) as runs,
  (select max(d.end_time) $RJOBS) as last_resolver_end,
  (select min(started_at) from public.dc_acquisition_run where started_at >= '$S') as first_run_after_s,
  (select min(derived_at) from public.dc_address_geocode where derived_at >= '$S') as first_geocode_after_s,
  (select count(*) from public.dc_canonical_entity where (created_at >= '$S' and created_at < '$T') or (updated_at >= '$S' and updated_at < '$T')) as entity_writes_s_t,
  (select count(*) from public.dc_entity_observation where linked_at >= '$S' and linked_at < '$T') as link_writes_s_t,
  (select count(*) from public.dc_identity_decision where decided_at >= '$S' and decided_at < '$T') as decision_writes_s_t,
  (select count(*) from public.dc_entity_geography where (created_at >= '$S' and created_at < '$T') or (updated_at >= '$S' and updated_at < '$T')) as geo_writes_s_t" "$w/v3.csv"
sed 's/^/  /' "$w/v3.csv"
python3 - "$w/v3.csv" <<'PY' || fail "V3 production premises"
import csv, sys
from datetime import datetime
r = list(csv.DictReader(open(sys.argv[1])))[0]
ts = lambda s: datetime.fromisoformat(s.replace('+00', '+00:00')) if s and s != '\\N' else None
end, run, geo = ts(r['last_resolver_end']), ts(r['first_run_after_s']), ts(r['first_geocode_after_s'])
bad = []
if int(r['resolver_runs']) < 1: bad.append('control: no resolver run found in [S,T)')
if end is None or run is None or not run > end: bad.append('an acquisition run started before the last resolver run in [S,T) ended')
if geo is not None and not geo > end: bad.append('a geocode was derived before the last resolver run in [S,T) ended')
for k in ('entity_writes_s_t', 'link_writes_s_t', 'decision_writes_s_t', 'geo_writes_s_t'):
    if r[k] != '0': bad.append(f'{k}={r[k]}')
print('  V3_PRODUCTION ' + ('PASS' if not bad else 'FAIL ' + '; '.join(bad)))
sys.exit(1 if bad else 0)
PY
clone tmpl_old v3; reconstruct v3 "$S"
L -d v3 -tA -c "select canonical_entity_id from public.dc_canonical_entity" | { echo canonical_entity_id; cat; } > "$w/v3_ids.csv"
V3FP="$(L -d v3 -tA -c "with t as ($Q_SNAPTXT) select count(*) || ' ' || md5(string_agg(concat_ws('~',k,a,b,v), E'\n' order by concat_ws('~',k,a,b,v) collate \"C\")) from t")"
[ "$V3FP" = "$SNAP_IDENT_ROWS $SNAP_IDENT_FP" ] || fail "V3: the S state is not the snapshot identity ($V3FP)"
dump v3 "$w/v3_pre" decisions,geo
L -d v3 -tA -F'|' -c "select metric, value from public.dc_resolve_canonical(true, false)" | LC_ALL=C sort > "$w/v3_id.txt"
L -d v3 -tA -F'|' -c "select metric, value from public.dc_resolve_geography(true) where metric = 'ROWS_WRITTEN'" > "$w/v3_geo.txt"
dump v3 "$w/v3_post" decisions,geo; dropdb v3
V3M="$({ grep -E '^(ENTITIES_MINTED|OBSERVATIONS_NEWLY_LINKED|OBSERVATIONS_RELINKED|ENTITIES_SUPERSEDED)\|' "$w/v3_id.txt" || true; } | tr '\n' ' ')$(tr '\n' ' ' < "$w/v3_geo.txt")"
echo "  V3 OLD code re-run on the S state: $V3M"
[ "$(grep -cE '^(ENTITIES_MINTED|OBSERVATIONS_NEWLY_LINKED|OBSERVATIONS_RELINKED|ENTITIES_SUPERSEDED)\|0$' "$w/v3_id.txt")" = 4 ] \
  && [ "$(cat "$w/v3_geo.txt")" = "ROWS_WRITTEN|0" ] || fail "V3: the OLD resolvers write on the S state"
$CMP compare "$w/v3_pre" "$w/v3_post" "$w/v3_ids.csv" entities,links,decisions,geo zero > "$w/v3.json" || fail "V3: S state changed under the OLD resolvers"
echo "  V3 $(cat "$w/v3.json")"

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
        (select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select home_signal_observation_id, acquisition_run_id, md5(raw_payload::text) from public.dc_source_observation) x),
        (select md5(string_agg(x::text, E'\n' order by x::text collate \"C\")) from (select a.id, a.source_key, a.distribution_key, a.run_seq, a.completeness_state, t.started_at from public.dc_acquisition_run a join public._run_time t using (id)) x),
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
# A derivation is keyed by address text, not by source: one queued for Atlas by Phase A would be read by
# any ADMITTED observation stating the same line, and in the pre-#1335 world it would not yet exist.
IFS='|' read -r PN_ADM PN_ADM_ANY PN_UNADM < <(L -d rep_new -tA -F'|' -c "select
  count(*) filter (where admitted and derivation_id is not null and derived_at >= '$S'),
  count(*) filter (where admitted and derivation_id is not null),
  count(*) filter (where not admitted and derivation_id is not null and derived_at >= '$S') from public.dc_observation_derived_point")
IFS='|' read -r PO_CONS PO_ANY < <(L -d rep_old -tA -F'|' -c "select
  count(*) filter (where derivation_id is not null and derived_at >= '$S'),
  count(*) filter (where derivation_id is not null) from public.dc_observation_derived_point")
echo "  PHASE_A_ONLY_DERIVATIONS read by an admitted observation: NEW $PN_ADM (controls: admitted consumers $PN_ADM_ANY, unadmitted consumers of them $PN_UNADM) | OLD $PO_CONS (control: consumers $PO_ANY)"
[ "$PN_ADM" = 0 ] && [ "$PO_CONS" = 0 ] && [ "$PN_ADM_ANY" -gt 0 ] && [ "$PN_UNADM" -gt 0 ] && [ "$PO_ANY" -gt 0 ] \
  || fail "an admitted observation consumes a derivation only Phase A's queue produced (or a control is zero)"
clone rep_old rep_old_start; clone rep_new rep_new_start

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
for db in rep_old rep_new; do
  echo "  $db GEO_RULE_VERSIONS $(L -d "$db" -tA -c "select string_agg('v' || coalesce(rule_version::text, 'null') || '=' || n, ' ' order by rule_version) from (select rule_version, count(*) n from public.dc_entity_geography group by 1) x")"
done
dump rep_old "$w/f_old" decisions,geo,map1; dump rep_new "$w/f_new" decisions,geo,map1
$CMP compare "$w/f_old" "$w/f_new" "$w/start_ids.csv" entities,links,decisions,geo,map1 zero > "$w/final.json" || fail "OLD vs NEW differ after geography / Map 1"
echo "  FINAL $(cat "$w/final.json")"
gate rep_new "$w/gate_real.txt" | sed 's/^/  NEW /' || fail "admission/evidence gate on the NEW replica"
sed 's/^/  NEW /' "$w/gate_real.txt"

echo "== 6b. TRUE PRE-#1335 WORLD: OLD without the geocodes only Phase A's Atlas queue derived must equal the replay"
REMOVED="$(L -d rep_old_start -tA -c "set session_replication_role = replica" -c "with d as (delete from public.dc_address_geocode where derived_at >= '$S' returning 1) select count(*) from d")"
KEPT="$(L -d rep_old_start -tA -c "select count(*) from public.dc_address_geocode")"
echo "  geocodes removed (derived after the snapshot, all by Phase A's queue) $REMOVED | kept $KEPT"
[ "$REMOVED" -gt 0 ] && [ "$KEPT" -gt 0 ] || fail "6b control: nothing removed or nothing kept"
L -d rep_old_start -tA -c "select metric, value from public.dc_resolve_canonical(true, false)" >/dev/null
L -d rep_old_start -tA -c "select metric, value from public.dc_resolve_geography(true)" >/dev/null
dump rep_old_start "$w/f_oldw" decisions,geo,map1; dropdb rep_old_start
$CMP compare "$w/f_old" "$w/f_oldw" "$w/start_ids.csv" entities,links,decisions,geo,map1 zero > "$w/oldw.json" || fail "the true pre-#1335 world decides differently from the replay"
echo "  TRUE_OLD_WORLD_VS_REPLAY $(cat "$w/oldw.json")"

echo "== 7. REPLAY vs PRODUCTION: the NEW replay reproduces what production actually decided at 15:25/15:35"
prod_copy "$Q_DEC" "$w/prod/decisions.csv"; prod_copy "$Q_GEO" "$w/prod/geo.csv"
$CMP compare "$w/prod" "$w/f_new" "$w/start_ids.csv" entities,links,decisions,geo,map1 zero > "$w/v4.json" || fail "the NEW replay does not reproduce production's actual outcome"
echo "  REPLAY_VS_PRODUCTION $(cat "$w/v4.json")"
# DIAGNOSTIC, not a gate: the same geometry as TEXT. It can differ only in how two PostGIS versions print
# bit-identical points (the gated comparison above uses exact EWKB); diff_columns names what differs.
Q_GEOTXT="select canonical_entity_id, st_astext(geom) geom_text from public.dc_entity_geography"
mkdir -p "$w/dx_prod" "$w/dx_new"
cp "$w/prod/entities.csv" "$w/prod/links.csv" "$w/dx_prod/"; cp "$w/f_new/entities.csv" "$w/f_new/links.csv" "$w/dx_new/"
prod_copy "$Q_GEOTXT" "$w/dx_prod/geo.csv"; rcopy rep_new "$Q_GEOTXT" "$w/dx_new/geo.csv"
echo "  DIAGNOSTIC geometry-as-text (not gated): $($CMP compare "$w/dx_prod" "$w/dx_new" "$w/start_ids.csv" geo zero || true)"
python3 - "$root/scripts" "$w/dx_prod" "$w/dx_new" "$w/start_ids.csv" <<'PY' || true
import sys; sys.path.insert(0, sys.argv[1]); import dc_phase_a_proof as P
ids = {r[0] for r in P.read(sys.argv[4])[1]}
a = dict(P.load_side(sys.argv[2], ids)['geo'][1]); b = dict(P.load_side(sys.argv[3], ids)['geo'][1])
d = sorted(k for k in set(a) & set(b) if a[k] != b[k])
print(f'  DIAGNOSTIC text-differing rows: {len(d)}')
for k in d[:3]:
    print(f'    {k}: production {a[k]} | replay {b[k]}')
PY

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
echo '  IDENTITY: expected {"entities.row_diff": 2, "links.row_diff": 0, "decisions.row_diff": 0, "identity_row_diff": 2}'
echo "  IDENTITY: observed $(head -1 "$w/c_IDENTITY.txt")"; echo "  IDENTITY: DETECTED=$r"; [ "$r" = true ] || fail "control IDENTITY not detected"
# a uuid-valued field (one link repointed between two starting entities) and one decision state
clone rep_new_postid c_ld
L -d c_ld <<SQL >/dev/null
set session_replication_role = replica;
create temp table st as select a::uuid e from public._snap_ident where k = 'entity';
create temp table src as select eo.canonical_entity_id e from public.dc_entity_observation eo join st on st.e = eo.canonical_entity_id
  group by 1 having count(*) >= 2 order by 1 limit 1;
create temp table tgt as select e from st where e <> (select e from src) and exists (select 1 from public.dc_canonical_entity c where c.canonical_entity_id = st.e) order by 1 limit 1;
update public.dc_entity_observation set canonical_entity_id = (select e from tgt)
 where home_signal_observation_id = (select max(home_signal_observation_id::text)::uuid from public.dc_entity_observation where canonical_entity_id = (select e from src));
update public.dc_identity_decision set decision_state = case when decision_state = 'UNRESOLVED' then 'POSSIBLE_MATCH' else 'UNRESOLVED' end
 where decision_id = (select decision_id from public.dc_identity_decision order by observation_a, observation_b, candidate_rule_key limit 1);
SQL
dump c_ld "$w/c_ld" decisions; dropdb c_ld
if $CMP compare "$w/id_old" "$w/c_ld" "$w/start_ids.csv" entities,links,decisions control '{"entities.row_diff": 0, "links.row_diff": 2, "decisions.row_diff": 2, "identity_row_diff": 4}' > "$w/c_LD.txt"; then r=true; else r=false; fi
echo '  LINK_AND_DECISION: expected {"entities.row_diff": 0, "links.row_diff": 2, "decisions.row_diff": 2, "identity_row_diff": 4}'
echo "  LINK_AND_DECISION: observed $(head -1 "$w/c_LD.txt")"; echo "  LINK_AND_DECISION: DETECTED=$r"; [ "$r" = true ] || fail "control LINK_AND_DECISION not detected"
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
EPOCH_REAL="$(grep '^EPOCH_EVIDENCE_ROWS|' "$w/gate_real.txt" | cut -d'|' -f2)"
gate_control() { # $1 name, $2 db, $3 expected ATLAS_ADMITTED: the gate must FAIL for exactly the expected reason
  local r=false
  if L -d "$2" -tA -F'|' -c "$GATE_SQL" > "$w/gate_$1.txt"; then
    if ! $CMP gate "$w/gate_$1.txt" > "$w/c_$1.txt"; then
      python3 - "$w/gate_$1.txt" "$3" "$EPOCH_REAL" <<'PY' && r=true
import sys
kv = dict(l.strip().split('|', 1) for l in open(sys.argv[1]) if '|' in l)
ok = kv.get('ATLAS_ADMITTED') == sys.argv[2] and int(kv.get('ATLAS_EVIDENCE_ROWS', '0')) > 0 and kv.get('EPOCH_EVIDENCE_ROWS') == sys.argv[3]
sys.exit(0 if ok else 1)
PY
    fi
  fi
  echo "  $1: expected ATLAS_ADMITTED=$3, ATLAS_EVIDENCE_ROWS>0, EPOCH_EVIDENCE_ROWS=$EPOCH_REAL, gate FAIL"
  echo "  $1: observed $(tr '\n' ' ' < "$w/gate_$1.txt")-> $(cat "$w/c_$1.txt" 2>/dev/null) DETECTED=$r"
  [ "$r" = true ] || fail "control $1 not detected"
}
clone rep_new c_admit; L -d c_admit -f "$w/admit.sql" >/dev/null
gate_control ADMISSION c_admit t
dropdb c_admit
# END TO END: the NEW resolvers themselves, with Atlas admitted, must produce a difference the comparator sees
clone rep_new_start c_e2e; L -d c_e2e -f "$w/admit.sql" >/dev/null
L -d c_e2e -tA -c "select metric, value from public.dc_resolve_canonical(true, false)" >/dev/null
L -d c_e2e -tA -c "select metric, value from public.dc_resolve_geography(true)" >/dev/null
dump c_e2e "$w/c_e2e" decisions,geo,map1; dropdb c_e2e
control ADMISSION_END_TO_END "$w/c_e2e" entities,links,decisions,geo,map1 '{}'
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
gate_control EVIDENCE_LEAK c_leak f   # must leak WITHOUT admission
dropdb c_leak
echo "  PARITY_NEGATIVE_CONTROL: DETECTED=$PARITY_NEG"

echo "== 9. result"
if [ "$FAILS" -ne 0 ]; then echo "PHASE A ZERO-EFFECT PROOF — NOT PROVEN ($FAILS failure(s) above)"; exit 1; fi
echo "PHASE A ZERO-EFFECT PROOF — every control detected; OLD and NEW identical from the reconstructed pre-identity state; replay reproduces production. Production was only read."
