-- ============================================================================
-- STEP 3C · FORWARD MIGRATION — THE LEDGER COUNTED STORAGE ROWS, NOT RESIDENT RECORDS
-- Migration: dc_step3c_ledger_distinct_record_grain_20260922
-- DDL of record. Supersedes the DERIVATION in dc-step3c-resident-lineage-ledger.sql; that file
-- stays in the repo unedited because it describes a migration that was already applied.
-- ============================================================================
--
-- WHAT THE FIRST LEDGER GOT WRONG, MEASURED 2026-09-22 (the view's own rows, grouped):
--
--   app_projects:development   182 rows  104 distinct source keys
--   app_projects:facility      401 rows  274 distinct source keys
--   national_dc_records/osm   1824 rows 1824 distinct source keys
--                             ----
--                             2407 = 182 + 401 + 1824, exactly
--
--   (1) ROWS, NOT RECORDS. app_projects is materialised per ZIP, so one EPA FRS facility near
--       95 ZIP centres is 95 rows. 583 rows are 378 source records.
--   (2) CANDIDATES, NOT DATA CENTRES. The row filter is a regex SUPERSET. The shipped resident
--       classifiers (lib/map.js, run for real by scripts/dc-step3c-reconcile.mjs) accept 366
--       of the 378 keys; e.g. 37 `other project` rows are candidates that no reader draws.
--   (3) STORAGE, NOT RESIDENT-FACING. All 1,824 OSM rows were counted. national_dc_for_zip
--       serves only map_eligible rows (1,384), and only 1,087 of those are within its radius
--       of any ZIP page that Fix 29 admits. 440 + 297 = 737 rows no resident can ever see.
--   (4) AN UNSCOPED IDENTITY JOIN. `o.publisher_record_id = u.source_native_key` matched a
--       bare id against EVERY source and EVERY historical run. It returned nothing only
--       because no id happened to collide. Identity is (source, publisher id) or nothing,
--       and only CURRENT observations are canonical evidence (dc_current_observation).
--   (5) AN UNPROVEN DISPOSITION. REACQUIRABLE_FROM_ORIGINAL_SOURCE was asserted from a
--       non-null key, before anyone asked a publisher whether the record still exists.
--
-- WHAT THIS VIEW IS NOW. The LINEAGE plane of the Step 3C reconciliation, at the grain of
-- ONE PUBLISHER-NATIVE SOURCE IDENTITY, with every fact taken from its existing authority:
--
--   identity       app_projects.source_key / national_dc_records.source_key (publisher ids)
--   reachability   public.national_dc_for_zip itself, over the ZIPs Fix 29 admits
--                  (geo.maps_zip_geography_status = 'boundary_complete'). The RPC is CALLED,
--                  not re-implemented; app_projects is anon-readable (policy app_projects_read)
--   evidence       public.dc_current_observation, joined on (source_key, publisher_record_id)
--
-- WHAT IT STILL DELIBERATELY DOES NOT DO:
--   * It does not decide "is this a data centre". Three shipped readers answer that and they
--     DISAGREE on real rows (Map 1's site path reads label/use_type; the dossier and MAPS read
--     type_raw). The view carries each record's raw classifier inputs and the report runs the
--     real classifiers on them. A SQL copy would be a second decider.
--   * It does not assign a final disposition. That needs the classifier verdict, so it lives
--     in scripts/dc-step3c-reconcile.mjs, whose vocabulary is closed and whose sums are checked.
--   * No geography. It reads the EXISTING resident reachability; it assigns nothing to a place.
--
-- It is a VIEW: it stores nothing, owns no rows, and cannot drift from what it describes.

drop view if exists public.dc_resident_lineage_ledger;

create view public.dc_resident_lineage_ledger
with (security_invoker = true) as
with
-- The candidate superset. A LEAD filter, never a decider: every literal the shipped
-- classifier matches (DATACENTER_RE, TYPE_EXACT) contains data<=3 non-letters>cent|hall,
-- hyper or server, and test/dc-step3c-reconcile.test.mjs asserts that against lib/map.js.
legacy_rows as (
  select p.*
    from public.app_projects p
   where p.type     ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'
      or p.type_raw ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'
      or p.name     ~* 'data[^a-z]{0,3}(cent|hall)|hyper|server'
),
legacy as (
  select
    -- A row with NO publisher-native key keeps its own row (keyed by its HomeSignal id and
    -- flagged), never dropped: filtering it out would be an omitted resident record that
    -- every sum below would still balance around.
    coalesce(r.source_key, 'app_projects:' || r.id::text) as record_key,
    (r.source_key is not null)                          as has_source_native_key,
    case when min(r.record_kind) = 'facility' then 'legacy_facility'
         else 'legacy_development' end                  as source_population,
    case when min(r.record_kind) = 'facility' then 'FACILITY_REGISTRATION'
         else 'DEVELOPMENT_FILING' end                  as record_grain,
    'app_projects'::text                                as resident_storage_plane,
    min(r.registry_id)                                  as publisher_or_dataset,
    min(r.source_key_basis)                             as source_native_key_basis,
    min(r.source_ref)                                   as source_url,
    count(*)::int                                       as storage_rows,
    count(distinct r.zip)::int                          as resident_zip_count,
    count(distinct r.record_kind)::int                  as record_kind_count,
    jsonb_agg(distinct jsonb_build_object(
        'record_kind', r.record_kind, 'type', r.type, 'type_raw', r.type_raw,
        'name', r.name, 'status', r.status, 'stage', r.stage,
        'registry_id', r.registry_id, 'source_ref', r.source_ref))
                                                        as classifier_inputs,
    null::boolean                                       as osm_map_eligible,
    true                                                as resident_reachable,
    'app_projects is anon-readable (policy app_projects_read)'::text
                                                        as reachability_basis,
    -- DECLARED, never inferred. No dc_source is registered for any legacy publisher, so this
    -- is NULL and the evidence join below cannot match. Onboarding a publisher through
    -- dc_evidence_writer sets it here, in the same PR.
    null::text                                          as dc_source_key
  from legacy_rows r
  group by coalesce(r.source_key, 'app_projects:' || r.id::text), (r.source_key is not null)
),
admitted as (
  select s.zip
    from geo.maps_zip_geography_status s
    join public.development_reports d on d.zip = s.zip
   where s.status = 'boundary_complete'
),
reached as (
  select distinct r.source_key
    from admitted a
    cross join lateral public.national_dc_for_zip(a.zip, 5) r
),
osm as (
  select
    n.source_key                                        as record_key,
    (n.source_key is not null)                          as has_source_native_key,
    'osm'::text                                         as source_population,
    'PHYSICAL_SITE'::text                               as record_grain,
    'national_dc_records'::text                         as resident_storage_plane,
    n.source_name                                       as publisher_or_dataset,
    ('osm:' || n.osm_type)                              as source_native_key_basis,
    n.source_url                                        as source_url,
    1                                                   as storage_rows,
    null::int                                           as resident_zip_count,
    1                                                   as record_kind_count,
    null::jsonb                                         as classifier_inputs,
    n.map_eligible                                      as osm_map_eligible,
    (x.source_key is not null)                          as resident_reachable,
    case when x.source_key is not null
           then 'returned by national_dc_for_zip for >= 1 Fix-29-admitted ZIP page'
         when not n.map_eligible
           then 'never served: national_dc_for_zip filters map_eligible'
         else 'map_eligible but returned for no admitted ZIP page' end
                                                        as reachability_basis,
    null::text                                          as dc_source_key  -- OSM is not a registered dc_source
  from public.national_dc_records n
  left join reached x on x.source_key = n.source_key
),
unioned as (select * from legacy union all select * from osm)
select
  u.record_key,
  u.has_source_native_key,
  u.source_population,
  u.record_grain,
  u.resident_storage_plane,
  u.publisher_or_dataset,
  u.source_native_key_basis,
  u.source_url,
  u.storage_rows,
  u.resident_zip_count,
  u.record_kind_count,
  u.classifier_inputs,
  u.osm_map_eligible,
  u.resident_reachable,
  u.reachability_basis,
  u.dc_source_key,
  o.home_signal_observation_id                          as source_observation_id,
  eo.canonical_entity_id                                as canonical_entity_id,
  'docs/dc-step3c-ledger-distinct-record-grain.sql'::text as proof_reference
from unioned u
left join public.dc_current_observation o
       on o.source_key = u.dc_source_key     -- scoped: (source, publisher id) or nothing
      and o.publisher_record_id = u.record_key
left join public.dc_entity_observation eo
       on eo.home_signal_observation_id = o.home_signal_observation_id;

comment on view public.dc_resident_lineage_ledger is
  'Step 3C RECONCILIATION plane (read model). One row per publisher-native source identity '
  'behind a resident data-centre CANDIDATE, with lineage, the existing reachability authority '
  'and scoped evidence linkage. Stores nothing; classifies nothing (scripts/dc-step3c-reconcile.mjs '
  'runs the shipped classifiers); assigns no geography.';

revoke all on public.dc_resident_lineage_ledger from anon, authenticated;

-- FAIL CLOSED, and prove the grain rather than assume it.
do $verify$
declare
  n_rows int; n_keys int; n_grants int; n_geo int; n_osm int; n_reach int; n_multi int;
begin
  select count(*), count(distinct record_key) into n_rows, n_keys
    from public.dc_resident_lineage_ledger;
  if n_rows = 0 then
    raise exception 'ledger is empty -- a reconciliation that reconciles nothing is not a control';
  end if;
  if n_rows <> n_keys then
    raise exception 'ledger grain broken: % rows for % source identities', n_rows, n_keys;
  end if;

  select count(*) into n_osm from public.dc_resident_lineage_ledger where source_population = 'osm';
  if n_osm <> (select count(*) from public.national_dc_records) then
    raise exception 'osm population % does not cover national_dc_records', n_osm;
  end if;

  select count(*) into n_reach from public.dc_resident_lineage_ledger
   where source_population = 'osm' and resident_reachable and not osm_map_eligible;
  if n_reach <> 0 then
    raise exception '% ineligible OSM rows marked reachable -- the RPC filters them', n_reach;
  end if;

  -- A source key that is BOTH a facility and a development would be one identity with two
  -- grains; it must be surfaced, not collapsed by min().
  select count(*) into n_multi from public.dc_resident_lineage_ledger where record_kind_count <> 1;
  if n_multi <> 0 then
    raise exception '% source identities carry more than one record_kind', n_multi;
  end if;

  select count(*) into n_grants from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'dc_resident_lineage_ledger'
     and grantee in ('anon', 'authenticated');
  if n_grants <> 0 then
    raise exception 'ledger is anon-readable (% grants)', n_grants;
  end if;

  select count(*) into n_geo from information_schema.columns
   where table_schema = 'public' and table_name = 'dc_resident_lineage_ledger'
     and (lower(column_name) like '%zcta%' or lower(column_name) like '%community%'
       or lower(column_name) like '%centroid%' or lower(column_name) like '%radius%'
       or lower(column_name) in ('zip', 'resident_zip'));
  if n_geo <> 0 then
    raise exception 'ledger carries % geography column(s)', n_geo;
  end if;
end
$verify$;

-- APPLIED 2026-09-22 18:41:38Z as migration 20260922184138
-- dc_step3c_ledger_distinct_record_grain_20260922, EXACTLY as written above. The MCP client
-- timed out at 60s while the server was still running the verify block (each of its five
-- queries evaluates the view, and each evaluation scans app_projects with the superset
-- regex); the transaction committed at ~18:43:22Z, so every check above PASSED -- a failed
-- check raises and rolls the whole migration back. The next migration touching this view
-- should evaluate it once into a temp table and check that.
