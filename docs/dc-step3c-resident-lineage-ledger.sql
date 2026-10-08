-- ============================================================================
-- DDL OF RECORD for migration 20260922164240 dc_step3c_resident_lineage_ledger_20260922
-- ============================================================================
-- Everything between the BEGIN/END markers below is the statement AS APPLIED, byte for
-- byte: read back from supabase_migrations.schema_migrations.statements on 2026-09-22 and
-- fingerprinted  length 7500  md5 a71a969daa076ae68415f617f5418ba4.
-- test/dc-step3c-reconcile.test.mjs section 7 recomputes that fingerprint from this file.
--
-- WHY THIS FILE WAS REWRITTEN. Commit d76d96c (another session's Step 3C work) committed a
-- file here that was a later REVISION of this migration, not the statement that ran:
--   re-aligned whitespace and a verify variable renamed n_zip -> n_geo. Behaviour is
--   identical; the bytes are not. This migration is also SUPERSEDED: 20260922184138
--   (docs/dc-step3c-ledger-distinct-record-grain.sql) drops and recreates the view.
-- A DDL of record that is not the applied statement cannot reproduce production, which is
-- the only thing a DDL of record is for. So this is not a correction to the migration --
-- production is unchanged -- it is a correction to the RECORD of it.
-- ============================================================================
-- ----- BEGIN APPLIED STATEMENT -----
-- STEP 3C · THE RESIDENT LINEAGE LEDGER
--
-- ONE reconciliation mechanism that answers, for every resident-facing data-centre CANDIDATE
-- record, where its evidence is. It is NOT a truth plane and NOT a classifier:
--
--   * IT DOES NOT DECIDE WHAT IS A DATA CENTRE. That decision has exactly one owner --
--     homesignal-site lib/map.js::statedDataCenter, ported verbatim to homesignal-ingest
--     bluesky/lib/maps-datacenter.mjs and parity-tested. Re-implementing it in SQL would be a
--     second decider, which the architecture forbids. This view therefore ledgers the
--     CANDIDATE SUPERSET (the rows that classifier is ever asked about) and records LINEAGE.
--   * IT WRITES NOTHING and owns no rows. Every column is derived from authoritative state,
--     so the ledger is reproducible rather than stored.
--   * IT CREATES NO GEOGRAPHY. No ZIP, ZCTA, community, centroid or radius column exists here;
--     `resident_zip` is carried ONLY as the locating key of the resident row that already has
--     one, never as an assignment of a canonical entity to a place.
--
-- DISPOSITION VOCABULARY IS CLOSED. No free-form OTHER. Adding a value is a deliberate edit.
--   BACKED_BY_CANONICAL_EVIDENCE      a link to canonical evidence exists for this row
--   REACQUIRABLE_FROM_ORIGINAL_SOURCE source, dataset and source-native id all survive
--   LEGACY_SOURCE_KNOWN_RECORD_GONE   publisher identified, record no longer published
--   LEGACY_WITHOUT_RECOVERABLE_PROVENANCE  no source-native identity survives
--   DERIVED_DUPLICATE                 a materialisation of another ledgered row
--
-- ⚠️ TODAY EVERY ROW LANDS IN REACQUIRABLE_FROM_ORIGINAL_SOURCE, and that is a MEASUREMENT,
-- not a design goal: 583 of 583 app_projects candidates and 1,824 of 1,824 national_dc_records
-- carry a publisher, a dataset and a source-native record id. An earlier session reported 545
-- of these as LEGACY_WITHOUT_RECOVERABLE_PROVENANCE by reasoning from "the engine preserves no
-- artifact" WITHOUT READING THE PROVENANCE COLUMNS. That was wrong: no artifact is retained,
-- but the IDENTITY is, and identity is what re-acquisition needs.

create or replace view public.dc_resident_lineage_ledger
with (security_invoker = true) as
with app as (
  select
    p.id::text                            as resident_record_id,
    'app_projects'::text                  as resident_storage_plane,
    ('app_projects:' || p.record_kind)    as source_population,
    p.registry_id                         as publisher_or_dataset,
    p.source_key                          as source_native_key,
    p.source_key_basis                    as source_native_key_basis,
    p.source_ref                          as source_url,
    p.zip                                 as resident_zip
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
  -- canonical evidence status: is there evidence for this resident row today?
  -- There is exactly one honest answer while the evidence plane holds only compute_atlas and
  -- epoch_ai: NONE. This is computed, never asserted -- if a future adapter onboards one of
  -- these publishers, the join below starts returning rows and the status moves on its own.
  case when eo.home_signal_observation_id is not null
       then 'BACKED_BY_CANONICAL_EVIDENCE'
       else 'NO_CANONICAL_EVIDENCE' end                 as canonical_evidence_status,
  eo.home_signal_observation_id                          as source_observation_id,
  eo.canonical_entity_id                                 as canonical_entity_id,
  case
    when eo.home_signal_observation_id is not null then 'BACKED_BY_CANONICAL_EVIDENCE'
    when u.source_native_key is not null
     and u.publisher_or_dataset is not null            then 'REACQUIRABLE_FROM_ORIGINAL_SOURCE'
    else 'LEGACY_WITHOUT_RECOVERABLE_PROVENANCE'
  end                                                    as disposition,
  case
    when eo.home_signal_observation_id is not null then 'linked to canonical evidence'
    when u.source_native_key is not null
     and u.publisher_or_dataset is not null
      then 'publisher + dataset + source-native id all present; not yet onboarded through dc_evidence_writer'
    else 'no source-native identity survives on the resident row'
  end                                                    as reason,
  'docs/dc-step3c-resident-lineage-ledger.sql'           as proof_reference
from unioned u
-- The ONLY legitimate join to evidence is on the source-native key, and it is deliberately
-- exact-equality on a key the publisher issued. No name, operator, address, postal code or
-- coordinate comparison appears anywhere in this view -- those cannot establish identity
-- (Step 3A measured a data centre and its own power plant at byte-identical coordinates).
left join public.dc_source_observation o
       on o.publisher_record_id = u.source_native_key
left join public.dc_entity_observation eo
       on eo.home_signal_observation_id = o.home_signal_observation_id;

comment on view public.dc_resident_lineage_ledger is
  'Step 3C reconciliation: one row per resident-facing data-centre CANDIDATE record with its '
  'lineage and a closed-vocabulary disposition. Derives everything; stores nothing; decides no '
  'classification and creates no geography.';

revoke all on public.dc_resident_lineage_ledger from anon, authenticated;

do $verify$
declare n_total int; n_grants int; n_zip int;
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

  -- §18: this object must create no geography. resident_zip is a CARRIED key, not an assignment.
  select count(*) into n_zip from information_schema.columns
   where table_schema='public' and table_name='dc_resident_lineage_ledger'
     and ( lower(column_name) like '%zcta%' or lower(column_name) like '%community%'
        or lower(column_name) like '%centroid%' or lower(column_name) like '%radius%' );
  if n_zip <> 0 then
    raise exception 'ledger introduced % geography column(s) -- forbidden in Step 3C', n_zip;
  end if;
end
$verify$;
-- ----- END APPLIED STATEMENT -----

-- ⚠️ SUPERSEDED MEASUREMENT, retained as the dated receipt. The 2,407 below counts STORAGE
-- ROWS of a regex CANDIDATE superset, including 737 OSM rows no resident can reach, and its
-- REACQUIRABLE disposition was asserted from a non-null key before any publisher was asked.
-- Corrected by 20260922184138; see that file's header for the arithmetic.
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
