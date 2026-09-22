-- ============================================================================
-- STEP 3C · THE RESIDENT LINEAGE LEDGER
-- Applied 2026-09-22 as migration dc_step3c_resident_lineage_ledger_20260922.
-- DDL of record. This file is the `proof_reference` every ledger row points at.
-- ============================================================================
--
-- ONE reconciliation mechanism that answers, for every resident-facing data-centre CANDIDATE
-- record, where its evidence is. What it deliberately is NOT:
--
--   * NOT A CLASSIFIER. "Is this a data centre?" has exactly one owner:
--     homesignal-site lib/map.js::statedDataCenter, ported verbatim to homesignal-ingest
--     bluesky/lib/maps-datacenter.mjs and parity-tested against a production cohort.
--     Re-implementing that regex in SQL would be a SECOND DECIDER, which is precisely what
--     this architecture forbids. So this view ledgers the CANDIDATE SUPERSET -- the rows the
--     one classifier is ever asked about -- and records LINEAGE only.
--   * NOT A TRUTH PLANE. It writes nothing and owns no rows. Every column is derived from
--     authoritative state, so the ledger is REPRODUCIBLE rather than stored, and it cannot
--     drift from the thing it describes.
--   * NOT GEOGRAPHY. No ZCTA, community, centroid or radius column exists here. `resident_zip`
--     is carried only as the locating key the resident row ALREADY has; it is never an
--     assignment of a canonical entity to a place. ZIP_ASSIGNMENTS_CREATED = 0.
--
-- THE ONLY JOIN TO EVIDENCE is exact equality on a key the PUBLISHER issued
-- (publisher_record_id). No name, operator, address, postal code or coordinate comparison
-- appears anywhere in this view. Step 3A measured a data centre and its own power plant at
-- BYTE-IDENTICAL COORDINATES -- that is the permanent control, and it is why coordinate
-- equality can never establish identity here or anywhere else.
--
-- CLOSED DISPOSITION VOCABULARY. No free-form OTHER; adding a value is a deliberate edit.
--   BACKED_BY_CANONICAL_EVIDENCE           a link to canonical evidence exists for this row
--   REACQUIRABLE_FROM_ORIGINAL_SOURCE      publisher + dataset + source-native id all survive
--   LEGACY_WITHOUT_RECOVERABLE_PROVENANCE  no source-native identity survives on the row
--
-- ⚠️ MEASURED 2026-09-22: every row lands in REACQUIRABLE_FROM_ORIGINAL_SOURCE, and that is a
-- MEASUREMENT rather than a design goal -- 583 of 583 app_projects candidates and 1,824 of
-- 1,824 national_dc_records carry a publisher, a dataset and a source-native record id.
-- A previous session reported 545 of these as LEGACY_WITHOUT_RECOVERABLE_PROVENANCE by
-- reasoning from "the engine preserves no artifact" WITHOUT READING THE PROVENANCE COLUMNS.
-- That conclusion was wrong in the direction that matters: no ARTIFACT is retained, but the
-- IDENTITY is, and identity is what re-acquisition needs. Read the column.

create or replace view public.dc_resident_lineage_ledger
with (security_invoker = true) as
with app as (
  select
    p.id::text                         as resident_record_id,
    'app_projects'::text               as resident_storage_plane,
    ('app_projects:' || p.record_kind) as source_population,
    p.registry_id                      as publisher_or_dataset,
    p.source_key                       as source_native_key,
    p.source_key_basis                 as source_native_key_basis,
    p.source_ref                       as source_url,
    p.zip                              as resident_zip
  from public.app_projects p
  where p.type     ~* 'data[[:space:]]*cent(er|re|e)|data[[:space:]]*hall|hyperscale|server[[:space:]]*farm'
     or p.type_raw ~* 'data[[:space:]]*cent(er|re|e)|data[[:space:]]*hall|hyperscale|server[[:space:]]*farm'
     or p.name     ~* 'data[[:space:]]*cent(er|re|e)|data[[:space:]]*hall|hyperscale|server[[:space:]]*farm'
),
natl as (
  select
    n.id::text            as resident_record_id,
    'national_dc_records' as resident_storage_plane,
    'osm'                 as source_population,
    n.source_name         as publisher_or_dataset,
    n.source_key          as source_native_key,
    'osm:' || n.osm_type  as source_native_key_basis,
    n.source_url          as source_url,
    null::text            as resident_zip
  from public.national_dc_records n
),
unioned as (select * from app union all select * from natl)
select
  u.resident_record_id,
  u.resident_storage_plane,
  u.source_population,
  u.publisher_or_dataset,
  u.source_native_key,
  u.source_native_key_basis,
  u.source_url,
  u.resident_zip,
  case when eo.home_signal_observation_id is not null
       then 'BACKED_BY_CANONICAL_EVIDENCE'
       else 'NO_CANONICAL_EVIDENCE' end        as canonical_evidence_status,
  eo.home_signal_observation_id                as source_observation_id,
  eo.canonical_entity_id                       as canonical_entity_id,
  case
    when eo.home_signal_observation_id is not null then 'BACKED_BY_CANONICAL_EVIDENCE'
    when u.source_native_key is not null
     and u.publisher_or_dataset is not null    then 'REACQUIRABLE_FROM_ORIGINAL_SOURCE'
    else 'LEGACY_WITHOUT_RECOVERABLE_PROVENANCE'
  end                                          as disposition,
  case
    when eo.home_signal_observation_id is not null then 'linked to canonical evidence'
    when u.source_native_key is not null
     and u.publisher_or_dataset is not null
      then 'publisher + dataset + source-native id all present; not yet onboarded through dc_evidence_writer'
    else 'no source-native identity survives on the resident row'
  end                                          as reason,
  'docs/dc-step3c-resident-lineage-ledger.sql' as proof_reference
from unioned u
left join public.dc_source_observation o
       on o.publisher_record_id = u.source_native_key
left join public.dc_entity_observation eo
       on eo.home_signal_observation_id = o.home_signal_observation_id;

comment on view public.dc_resident_lineage_ledger is
  'Step 3C reconciliation: one row per resident-facing data-centre CANDIDATE record with its '
  'lineage and a closed-vocabulary disposition. Derives everything; stores nothing; decides no '
  'classification and creates no geography.';

-- The defect this file's sibling (dc-step3c-view-grants-fix.sql) repairs was a view that was
-- anon-readable by omission. This view is revoked in the SAME statement that creates it, and
-- the check below fails the migration if that ever stops being true.
revoke all on public.dc_resident_lineage_ledger from anon, authenticated;

do $verify$
declare n_total int; n_grants int; n_geo int;
begin
  select count(*) into n_total from public.dc_resident_lineage_ledger;
  if n_total = 0 then
    raise exception 'ledger is empty -- a reconciliation that reconciles nothing is not a control';
  end if;

  select count(*) into n_grants from information_schema.role_table_grants
   where table_schema='public' and table_name='dc_resident_lineage_ledger'
     and grantee in ('anon','authenticated');
  if n_grants <> 0 then
    raise exception 'ledger is anon-readable (% grants) -- the Step-3A view defect, repeated', n_grants;
  end if;

  select count(*) into n_geo from information_schema.columns
   where table_schema='public' and table_name='dc_resident_lineage_ledger'
     and ( lower(column_name) like '%zcta%' or lower(column_name) like '%community%'
        or lower(column_name) like '%centroid%' or lower(column_name) like '%radius%' );
  if n_geo <> 0 then
    raise exception 'ledger introduced % geography column(s) -- forbidden in Step 3C', n_geo;
  end if;
end
$verify$;

-- MEASURED AFTER APPLY (2026-09-22), and it reconciles exactly:
--   national_dc_records / osm                     1824  REACQUIRABLE_FROM_ORIGINAL_SOURCE
--   app_projects:facility                          401  REACQUIRABLE_FROM_ORIGINAL_SOURCE
--   app_projects:development                       182  REACQUIRABLE_FROM_ORIGINAL_SOURCE
--                                                 ----
--   RESIDENT_TOTAL (candidate superset)           2407   UNEXPLAINED = 0
--
--   BACKED_BY_CANONICAL_EVIDENCE                     0 -- the evidence plane holds only
--                                                       compute_atlas and epoch_ai today.
-- That zero is COMPUTED, not asserted: the join is live, so the moment an adapter onboards
-- one of these publishers through dc_evidence_writer, these rows move on their own.
