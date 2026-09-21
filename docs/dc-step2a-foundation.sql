-- STEP 2A — MINIMUM EVIDENCE FOUNDATION for national data-center source ingest.
-- DDL OF RECORD. APPLIED 2026-09-21 to project qwnnmljucajnexpxdgxr as three migrations:
--   20260921221056  dc_step2a_evidence_foundation           sections 1-5
--   20260921221318  dc_step2a_selftest                      section 6
--   20260921221903  dc_step2a_selftest_pin_seeded_contract  check 52, spliced into the live body
-- Live is byte-identical to this file on all 7 function bodies (md5 of pg_proc.prosrc):
--   dc_source_contract_stamp    0fb171eb21a7e59fed7f2ce7fd576373
--   dc_acquisition_run_guard    31aab8306a27dccf764c3f87e3d1cf3e
--   dc_source_observation_guard 3e4c10dcda59b02b605abf79e43667a0
--   dc_mark_run_advanced        cd0614b23ac2a29453d48683087ce16f
--   dc_step2a_expect_fail       1861fefb7cae48d6087d5af0f1372150
--   dc_step2a_expect_ok         5879f15776f141a0bab44d8c1229e673
--   dc_step2a_selftest          961caf6a8be196641df42b614599826f
-- and on the object set: 22 check constraints, 3 FKs, 12 non-pkey indexes, 6 triggers, 0 policies,
-- 0 anon/authenticated grants. Selftest: 54 checks, 54 passing.
--
-- CHECK 52 EXISTS BECAUSE A MUTATION FOUND THE SUITE'S OWN GAP, not because review did. Widening
-- Atlas's anti-truncation floor 1000 -> 1 originally moved NO check: check 20 proves the floor
-- MECHANISM on the selftest's fixture source, and nothing defended the MEASURED value on the
-- seeded ones. Six mutations against the live guards now kill: drop the observation guard -> 11
-- checks, add the forbidden global unique -> 2 (34 and 37, the structural pin and its positive
-- control), drop dc_run_only_complete_advances -> 1, widen either seeded floor -> 1, flip a
-- seeded capability -> 1, flip Atlas to ACTIVE -> 1, grant anon SELECT -> 1.
--
-- SCOPE, stated so it cannot be widened by reading: this installs THREE tables that let a
-- future Atlas/Epoch producer preserve source evidence. It contains NO producer, NO schedule,
-- NO canonical identity, NO lifecycle resolution, NO geography, NO ZIP membership, NO resident
-- reader, and it touches NOTHING that already exists (app_projects, app_zip_projects_markers,
-- national_dc_for_zip, development_reports, geo.*, Map 1, MAPS are all untouched).
--
-- WHY THREE AND NOT FOUR. The v2 contract proposed a fourth table, dc_source_record_state, to
-- hold last_seen / not-seen. It was an artifact of v2's own identity error: v2 keyed observations
-- UNIQUE (source_key, semantic_fingerprint) GLOBALLY, which COLLAPSED a repeated publisher
-- assertion into one row and therefore destroyed the very history "last seen" would have to be
-- derived from. Once observation identity is ACQUISITION-SCOPED (CTO brief §6, implemented
-- below), every one of those facts is a query over immutable rows:
--     first_seen = min(r.completed_at) over that record's observations
--     last_seen  = max(r.completed_at) over that record's observations
--     current    = the observation from the newest SUCCESS_COMPLETE run
--     not-seen   = anti-join: present in complete run N, absent from complete run N+1
-- Materialising them is a cache with its own staleness and its own second owner of truth.
-- dc_source_record_state is DEFERRED, not removed; add it deliberately if a measured producer
-- actually needs the materialisation.
--
-- RLS NOTE, because it is load-bearing rather than incidental: every table here has RLS ON and
-- ZERO policies, so anon and authenticated see nothing. The guard functions are SECURITY INVOKER,
-- which means a non-BYPASSRLS caller cannot even read the run row an observation references and
-- the insert is refused. That is the intended fail-closed direction: the only role that can write
-- Step 2A evidence is the service role a future producer would run as.

-- TRANSACTION: this file carries NO explicit begin/commit, matching every applied SQL file
-- in this repo. Postgres runs a multi-statement string as ONE implicit transaction under the
-- simple query protocol, and `apply_migration` owns the transaction itself; a nested `begin`
-- would warn and a mid-file `commit` would end the tool's transaction early -- which this
-- file did, leaving the selftest section outside it. Apply the whole file as one batch.

-- ===========================================================================================
-- 1. public.dc_source — MUTABLE registry, versioned contract
-- ===========================================================================================
create table if not exists public.dc_source (
  source_key                    text        primary key,
  publisher                     text        not null,
  dataset_name                  text        not null,
  homepage_url                  text,
  licence                       text        not null,
  -- The artifacts this ONE publisher dataset distributes. Epoch publishes two companion CSVs
  -- from one dataset and one documentation contract; modelling them as two independent sources
  -- would manufacture corroboration between a dataset and its own timeline file.
  distributions                 text[]      not null,
  supplies_publisher_record_id  boolean     not null,
  supplies_geometry             boolean     not null,
  supplies_lifecycle_status     boolean     not null,
  supplies_release_identity     boolean     not null,
  preserves_record_bytes        boolean     not null,
  -- ANTI-TRUNCATION FLOOR. A complete acquisition may not report fewer records than this.
  -- Enforced in dc_acquisition_run_guard against the run's FROZEN contract, so a shrunken or
  -- half-downloaded artifact cannot be declared SUCCESS_COMPLETE and later read as removals.
  expected_min_records          integer     not null default 1,
  not_seen_vocabulary           text        not null,
  -- The contract version an acquisition is judged against. Bumped automatically whenever any
  -- capability changes, so a later registry edit can never reinterpret an earlier acquisition.
  contract_version              integer     not null default 1,
  contract_fingerprint          text        not null default '',
  schedule_cron                 text,
  active_state                  text        not null default 'NOT_ACTIVE',
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  constraint dc_source_distributions_nonempty check (cardinality(distributions) >= 1),
  constraint dc_source_min_records_positive   check (expected_min_records > 0),
  constraint dc_source_not_seen_vocab         check (not_seen_vocabulary in
                                                ('SOURCE_RECORD_NOT_SEEN','NOT_OBSERVED_IN_CURRENT_RELEASE')),
  constraint dc_source_contract_version_pos   check (contract_version > 0),
  constraint dc_source_active_state           check (active_state in ('NOT_ACTIVE','ACTIVE')),
  -- ACTIVE is a claim about a scheduled, proven feed. Step 2A ships both sources NOT_ACTIVE and
  -- this constraint makes "ACTIVE with no schedule" unrepresentable.
  constraint dc_source_active_needs_schedule  check (active_state = 'NOT_ACTIVE' or schedule_cron is not null)
);

comment on table public.dc_source is
  'Step 2A. Extensible source registry (Atlas, Epoch, and later OSM / local-government / other '
  'approved sources). MUTABLE configuration: capability flags describe the source TODAY. '
  'Historical acquisitions are governed by the contract SNAPSHOT on dc_acquisition_run, never by '
  'this table, so editing a row here can never reinterpret yesterday''s evidence.';

create or replace function public.dc_source_contract_stamp()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  changed boolean := false;
begin
  if tg_op = 'UPDATE' then
    changed := (new.supplies_publisher_record_id is distinct from old.supplies_publisher_record_id)
            or (new.supplies_geometry            is distinct from old.supplies_geometry)
            or (new.supplies_lifecycle_status    is distinct from old.supplies_lifecycle_status)
            or (new.supplies_release_identity    is distinct from old.supplies_release_identity)
            or (new.preserves_record_bytes       is distinct from old.preserves_record_bytes)
            or (new.distributions                is distinct from old.distributions)
            or (new.expected_min_records         is distinct from old.expected_min_records)
            or (new.not_seen_vocabulary          is distinct from old.not_seen_vocabulary);
    if changed then
      new.contract_version := old.contract_version + 1;
    else
      new.contract_version := old.contract_version;
    end if;
    new.updated_at := now();
  end if;
  -- The fingerprint covers exactly the fields the version tracks, in a fixed order, with the
  -- distribution list SORTED so a cosmetic reordering is not a contract change.
  new.contract_fingerprint := md5(
    new.source_key || '|' || new.contract_version::text || '|'
    || new.supplies_publisher_record_id::text || '|' || new.supplies_geometry::text || '|'
    || new.supplies_lifecycle_status::text    || '|' || new.supplies_release_identity::text || '|'
    || new.preserves_record_bytes::text       || '|' || new.expected_min_records::text || '|'
    || new.not_seen_vocabulary || '|'
    || (select string_agg(d, ',' order by d) from unnest(new.distributions) d)
  );
  return new;
end;
$fn$;

drop trigger if exists dc_source_contract_stamp_trg on public.dc_source;
create trigger dc_source_contract_stamp_trg
  before insert or update on public.dc_source
  for each row execute function public.dc_source_contract_stamp();

-- ===========================================================================================
-- 2. public.dc_acquisition_run — the audit boundary. Every attempt is a receipt.
-- ===========================================================================================
create table if not exists public.dc_acquisition_run (
  id                           uuid        primary key default gen_random_uuid(),
  source_key                   text        not null references public.dc_source(source_key),
  distribution_key             text        not null,
  run_seq                      bigint      generated always as identity,
  trigger_kind                 text        not null,
  -- IMMUTABLE CONTRACT SNAPSHOT. Stamped from dc_source at INSERT and frozen for ever. Every
  -- capability rule an observation is judged by is read from HERE.
  source_contract_version      integer     not null,
  source_contract              jsonb       not null,
  source_contract_fingerprint  text        not null,
  started_at                   timestamptz not null default now(),
  completed_at                 timestamptz,
  request_url                  text        not null,
  request_method               text        not null default 'GET',
  http_status                  integer,
  transport_error              text,
  artifact_bytes               bigint,
  artifact_sha256              text,
  artifact_media_type          text,
  artifact_ref                 text,
  -- PUBLISHER-DECLARED release identity. Refused for a source whose contract supplies none.
  source_release_identity      jsonb       not null default '{}'::jsonb,
  source_release_key           text,
  -- HomeSignal-DERIVED stand-in for a source with no publisher release identity. Always allowed:
  -- it is explicitly ours and is never presented as the publisher's own version.
  content_release_key          text,
  parser_key                   text        not null,
  parser_version               text        not null,
  schema_fingerprint           text,
  records_seen                 integer,
  records_parsed               integer,
  records_rejected             integer,
  completeness_state           text,
  failure_detail               jsonb,
  source_declared_freshness    timestamptz,
  observed_freshness           timestamptz,
  advanced_observations        boolean     not null default false,
  notes                        text,
  constraint dc_run_trigger_kind      check (trigger_kind in ('manual','scheduled','backfill')),
  constraint dc_run_state_vocab       check (completeness_state is null or completeness_state in
                                        ('SUCCESS_COMPLETE','SUCCESS_ZERO','PARTIAL','TRUNCATED',
                                         'SCHEMA_CHANGED','PARSE_FAILED','FETCH_FAILED','STALE_SOURCE')),
  -- An in-flight run has no outcome yet, and saying so is more honest than a placeholder state.
  constraint dc_run_state_iff_done    check ((completed_at is null) = (completeness_state is null)),
  constraint dc_run_time_order        check (completed_at is null or completed_at >= started_at),
  constraint dc_run_sha_shape         check (artifact_sha256 is null or artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint dc_run_counts_nonneg     check (coalesce(records_seen,0) >= 0
                                         and coalesce(records_parsed,0) >= 0
                                         and coalesce(records_rejected,0) >= 0
                                         and coalesce(artifact_bytes,0) >= 0),
  -- SUCCESS_COMPLETE is a comparison, never an opinion.
  constraint dc_run_complete_shape    check (
      completeness_state is distinct from 'SUCCESS_COMPLETE'
      or (http_status = 200 and artifact_sha256 is not null and schema_fingerprint is not null
          and records_seen > 0 and records_parsed = records_seen)),
  constraint dc_run_zero_shape        check (completeness_state is distinct from 'SUCCESS_ZERO'
                                         or records_seen = 0),
  constraint dc_run_fetch_failed      check (completeness_state is distinct from 'FETCH_FAILED'
                                         or http_status is null or http_status >= 400),
  -- THE INVARIANT, in the database and not in a producer convention.
  constraint dc_run_only_complete_advances check
    (advanced_observations = false or completeness_state = 'SUCCESS_COMPLETE')
);

comment on table public.dc_acquisition_run is
  'Step 2A. One row per acquisition ATTEMPT, successful or not, so an absence can never be '
  'confused with a failure. APPEND-ONLY: DELETE and TRUNCATE are refused, and a completed run is '
  'immutable except advanced_observations/notes. Only completeness_state = SUCCESS_COMPLETE may '
  'advance observations, enforced both by dc_run_only_complete_advances and by the observation '
  'insert guard.';

create unique index if not exists dc_run_source_seq_uidx on public.dc_acquisition_run (source_key, run_seq);
create index if not exists dc_run_source_started_idx  on public.dc_acquisition_run (source_key, started_at desc);
create index if not exists dc_run_source_state_idx    on public.dc_acquisition_run (source_key, completeness_state, completed_at desc);
create index if not exists dc_run_artifact_sha_idx    on public.dc_acquisition_run (source_key, artifact_sha256);

create or replace function public.dc_acquisition_run_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  s public.dc_source%rowtype;
  c jsonb;
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'dc_acquisition_run is an append-only receipt log: TRUNCATE is refused';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'dc_acquisition_run is an append-only receipt log: DELETE is refused (run %)', old.id;
  end if;

  if tg_op = 'INSERT' then
    select * into s from public.dc_source where source_key = new.source_key;
    if not found then
      raise exception 'dc_acquisition_run: unknown source_key %', new.source_key;
    end if;
    if not (new.distribution_key = any (s.distributions)) then
      raise exception 'dc_acquisition_run: distribution_key % is not declared by source % (declared: %)',
        new.distribution_key, new.source_key, s.distributions;
    end if;
    -- Freeze the contract this acquisition is governed by. Every field the fingerprint covers is
    -- in the snapshot, so the snapshot can be re-fingerprinted and checked (selftest 33).
    new.source_contract_version     := s.contract_version;
    new.source_contract_fingerprint := s.contract_fingerprint;
    new.source_contract := jsonb_build_object(
      'source_key',                   s.source_key,
      'contract_version',             s.contract_version,
      'supplies_publisher_record_id', s.supplies_publisher_record_id,
      'supplies_geometry',            s.supplies_geometry,
      'supplies_lifecycle_status',    s.supplies_lifecycle_status,
      'supplies_release_identity',    s.supplies_release_identity,
      'preserves_record_bytes',       s.preserves_record_bytes,
      'expected_min_records',         s.expected_min_records,
      'not_seen_vocabulary',          s.not_seen_vocabulary,
      'distributions',                to_jsonb(s.distributions));
  else
    -- UPDATE.
    if new.source_contract             is distinct from old.source_contract
       or new.source_contract_version     is distinct from old.source_contract_version
       or new.source_contract_fingerprint is distinct from old.source_contract_fingerprint then
      raise exception 'dc_acquisition_run: the contract snapshot is immutable (run %)', old.id;
    end if;
    if new.source_key is distinct from old.source_key
       or new.distribution_key is distinct from old.distribution_key then
      raise exception 'dc_acquisition_run: source_key/distribution_key are immutable (run %)', old.id;
    end if;
    -- A run may be FINISHED once. After that only the two observability fields move.
    if old.completed_at is not null then
      if (to_jsonb(new) - 'advanced_observations' - 'notes')
         is distinct from (to_jsonb(old) - 'advanced_observations' - 'notes') then
        raise exception 'dc_acquisition_run: a completed run is immutable except advanced_observations/notes (run %)', old.id;
      end if;
    end if;
  end if;

  -- CAPABILITY + COMPLETENESS RULES, read from the FROZEN snapshot on both INSERT and UPDATE, so
  -- an in-flight run cannot acquire a capability it was never granted by being completed later.
  c := new.source_contract;
  if (c->>'supplies_release_identity')::boolean is not true
     and (new.source_release_identity <> '{}'::jsonb or new.source_release_key is not null) then
    raise exception 'source % contract v% supplies no release identity; refusing to fabricate one',
      new.source_key, c->>'contract_version';
  end if;
  if new.completeness_state = 'SUCCESS_COMPLETE'
     and new.records_seen < (c->>'expected_min_records')::integer then
    raise exception 'run % reports % records against a floor of % for source % contract v%: a short artifact is TRUNCATED/PARTIAL, never SUCCESS_COMPLETE',
      new.id, new.records_seen, c->>'expected_min_records', new.source_key, c->>'contract_version';
  end if;

  return new;
end;
$fn$;

drop trigger if exists dc_acquisition_run_guard_trg on public.dc_acquisition_run;
create trigger dc_acquisition_run_guard_trg
  before insert or update or delete on public.dc_acquisition_run
  for each row execute function public.dc_acquisition_run_guard();

-- A row trigger never fires for TRUNCATE, so immutability needs its own statement trigger or it
-- is one command away from being untrue.
drop trigger if exists dc_acquisition_run_truncate_trg on public.dc_acquisition_run;
create trigger dc_acquisition_run_truncate_trg
  before truncate on public.dc_acquisition_run
  for each statement execute function public.dc_acquisition_run_guard();

-- ===========================================================================================
-- 3. public.dc_source_observation — IMMUTABLE. What a publisher asserted in ONE acquisition.
-- ===========================================================================================
create table if not exists public.dc_source_observation (
  home_signal_observation_id        uuid        primary key default gen_random_uuid(),
  acquisition_run_id                uuid        not null references public.dc_acquisition_run(id),
  source_key                        text        not null references public.dc_source(source_key),
  distribution_key                  text        not null,
  -- Atlas record identity, and ONLY that. It is never a facility, campus or project identity.
  -- NULL for any source whose contract says it supplies none; never fabricated.
  publisher_record_id               text,
  -- ARTIFACT-LOCAL position. Same-acquisition duplicate protection for a source with no
  -- publisher id. It is NOT cross-release identity and must never be used as one.
  source_row_ordinal                integer     not null,
  -- THREE HASHES, three different things (CTO brief §8). None is an identity.
  raw_record_sha256                 text,       -- exact record representation, where preserved
  semantic_observation_fingerprint  text        not null,  -- canonical PARSED content
  raw_payload                       jsonb       not null,
  raw_payload_ref                   text,
  source_native_name                text,
  source_native_type                text,
  source_native_status              text,
  source_native_operator            text,
  source_native_operator_confidence text,
  source_native_address             jsonb,
  -- PUBLISHER GEOMETRY ONLY, stored as plain numbers on purpose: no geometry type, no spatial
  -- index, nothing that could participate in a membership decision. Step 2A has no geography.
  source_native_lon                 double precision,
  source_native_lat                 double precision,
  source_native_precision           text,
  source_timestamps                 jsonb,
  normalization_version             text        not null,
  observed_at                       timestamptz not null default now(),
  constraint dc_obs_ordinal_nonneg  check (source_row_ordinal >= 0),
  constraint dc_obs_rawsha_shape    check (raw_record_sha256 is null or raw_record_sha256 ~ '^[0-9a-f]{64}$'),
  constraint dc_obs_semantic_shape  check (semantic_observation_fingerprint ~ '^[0-9a-f]{64}$'),
  -- Unknown stays unknown: absence is NULL, never an empty-string sentinel. A publisher that
  -- literally publishes the word "Unknown" is stored verbatim -- the prohibition is on OUR
  -- fabrication, not on the publisher's own vocabulary.
  constraint dc_obs_no_empty_text   check (
       coalesce(source_native_name,'x') <> ''
   and coalesce(source_native_type,'x') <> ''
   and coalesce(source_native_status,'x') <> ''
   and coalesce(source_native_operator,'x') <> ''
   and coalesce(source_native_operator_confidence,'x') <> ''
   and coalesce(source_native_precision,'x') <> ''
   and coalesce(publisher_record_id,'x') <> ''),
  constraint dc_obs_lonlat_together check ((source_native_lon is null) = (source_native_lat is null)),
  constraint dc_obs_lonlat_range    check (source_native_lon is null
                                       or (source_native_lon between -180 and 180
                                       and source_native_lat between -90 and 90))
);

comment on table public.dc_source_observation is
  'Step 2A. IMMUTABLE historical evidence: what a publisher asserted in ONE complete acquisition. '
  'UPDATE, DELETE and TRUNCATE are all refused. Identity is ACQUISITION-SCOPED -- the same '
  'unchanged record seen in a later complete run is a NEW row, because "same content" is not '
  '"same historical event". No canonical entity identity exists in Step 2A, so nothing here can '
  'express a facility/campus/project match.';

-- SAME-RUN duplicate protection, three ways, each scoped to ONE acquisition.
create unique index if not exists dc_obs_run_ordinal_uidx
  on public.dc_source_observation (acquisition_run_id, source_row_ordinal);
create unique index if not exists dc_obs_run_publisher_uidx
  on public.dc_source_observation (acquisition_run_id, publisher_record_id)
  where publisher_record_id is not null;
-- Measured basis: Atlas 2,025 records / 2,025 unique ids, Epoch 86 rows / 86 distinct names --
-- no artifact observed carries two semantically identical records. If a publisher ever ships
-- one, the run fails loudly instead of silently de-duplicating a publisher anomaly.
create unique index if not exists dc_obs_run_semantic_uidx
  on public.dc_source_observation (acquisition_run_id, semantic_observation_fingerprint);
-- DELIBERATELY NOT UNIQUE GLOBALLY on (source_key, semantic_observation_fingerprint) or on
-- (source_key, publisher_record_id): a repeated publisher assertion is history, not a duplicate.
-- Selftest 34/35 pin the ABSENCE of those indexes, because dropping the prohibition would move
-- no other number.
create index if not exists dc_obs_source_publisher_idx
  on public.dc_source_observation (source_key, publisher_record_id);
create index if not exists dc_obs_source_semantic_idx
  on public.dc_source_observation (source_key, semantic_observation_fingerprint);
create index if not exists dc_obs_run_idx on public.dc_source_observation (acquisition_run_id);
create index if not exists dc_obs_payload_gin on public.dc_source_observation using gin (raw_payload);
create index if not exists dc_obs_address_gin on public.dc_source_observation using gin (source_native_address);

create or replace function public.dc_source_observation_guard()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  r public.dc_acquisition_run%rowtype;
  c jsonb;
begin
  if tg_op in ('UPDATE','DELETE','TRUNCATE') then
    raise exception 'dc_source_observation is immutable historical evidence: % is refused', tg_op;
  end if;

  select * into r from public.dc_acquisition_run where id = new.acquisition_run_id;
  if not found then
    raise exception 'dc_source_observation: unknown acquisition_run_id %', new.acquisition_run_id;
  end if;
  if r.completeness_state is distinct from 'SUCCESS_COMPLETE' then
    raise exception 'dc_source_observation: run % is % -- only SUCCESS_COMPLETE may advance observations',
      r.id, coalesce(r.completeness_state,'IN_FLIGHT');
  end if;
  if new.source_key <> r.source_key or new.distribution_key <> r.distribution_key then
    raise exception 'dc_source_observation: (%,%) does not match its run (%,%)',
      new.source_key, new.distribution_key, r.source_key, r.distribution_key;
  end if;

  -- CAPABILITY ENFORCEMENT READS THE RUN'S FROZEN CONTRACT, never the live registry. Editing
  -- dc_source tomorrow therefore cannot change what yesterday's acquisition was allowed to say.
  c := r.source_contract;
  if (c->>'supplies_publisher_record_id')::boolean is not true and new.publisher_record_id is not null then
    raise exception 'source % contract v% supplies no publisher_record_id; refusing to fabricate one',
      new.source_key, c->>'contract_version';
  end if;
  if (c->>'supplies_geometry')::boolean is not true and new.source_native_lon is not null then
    raise exception 'source % contract v% supplies no geometry; refusing publisher coordinates',
      new.source_key, c->>'contract_version';
  end if;
  if (c->>'supplies_lifecycle_status')::boolean is not true and new.source_native_status is not null then
    raise exception 'source % contract v% supplies no lifecycle status; refusing one',
      new.source_key, c->>'contract_version';
  end if;
  if (c->>'preserves_record_bytes')::boolean is not true and new.raw_record_sha256 is not null then
    raise exception 'source % contract v% does not preserve exact record bytes; refusing raw_record_sha256',
      new.source_key, c->>'contract_version';
  end if;

  return new;
end;
$fn$;

drop trigger if exists dc_source_observation_guard_trg on public.dc_source_observation;
create trigger dc_source_observation_guard_trg
  before insert or update or delete on public.dc_source_observation
  for each row execute function public.dc_source_observation_guard();

drop trigger if exists dc_source_observation_truncate_trg on public.dc_source_observation;
create trigger dc_source_observation_truncate_trg
  before truncate on public.dc_source_observation
  for each statement execute function public.dc_source_observation_guard();

-- A producer cannot forget to record that a run advanced observations. Statement-level with a
-- transition table: one UPDATE per insert STATEMENT, not one per 2,025 rows.
create or replace function public.dc_mark_run_advanced()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  update public.dc_acquisition_run r
     set advanced_observations = true
   where r.id in (select distinct i.acquisition_run_id from ins i)
     and r.advanced_observations = false;
  return null;
end;
$fn$;

drop trigger if exists dc_mark_run_advanced_trg on public.dc_source_observation;
create trigger dc_mark_run_advanced_trg
  after insert on public.dc_source_observation
  referencing new table as ins
  for each statement execute function public.dc_mark_run_advanced();

-- ===========================================================================================
-- 4. SECURITY — RLS on, zero resident access. Step 2A is evidence staging, not resident truth.
-- ===========================================================================================
alter table public.dc_source             enable row level security;
alter table public.dc_acquisition_run    enable row level security;
alter table public.dc_source_observation enable row level security;
-- No policies are created: with RLS enabled and no policy, every non-BYPASSRLS role sees nothing.
revoke all on public.dc_source, public.dc_acquisition_run, public.dc_source_observation from public;
revoke all on public.dc_source, public.dc_acquisition_run, public.dc_source_observation from anon;
revoke all on public.dc_source, public.dc_acquisition_run, public.dc_source_observation from authenticated;
revoke all on function public.dc_source_contract_stamp()    from public, anon, authenticated;
revoke all on function public.dc_acquisition_run_guard()    from public, anon, authenticated;
revoke all on function public.dc_source_observation_guard() from public, anon, authenticated;
revoke all on function public.dc_mark_run_advanced()        from public, anon, authenticated;

-- ===========================================================================================
-- 5. SEED — both sources NOT_ACTIVE, no schedule. Capabilities are MEASURED, not assumed.
-- ===========================================================================================
insert into public.dc_source (
  source_key, publisher, dataset_name, homepage_url, licence, distributions,
  supplies_publisher_record_id, supplies_geometry, supplies_lifecycle_status,
  supplies_release_identity, preserves_record_bytes,
  expected_min_records, not_seen_vocabulary, schedule_cron, active_state)
values
  -- Floor 1000 against a measured 2,025 records: conservative enough that ordinary publisher
  -- churn does not trip it, strict enough that a half-downloaded artifact can never be called
  -- complete and then read as ~1,000 removals.
  ('compute_atlas', 'Compute Atlas (Edward Kubiak)', 'Compute Atlas US data-center dataset',
   'https://www.compute-atlas.com', 'CC BY 4.0', array['facilities'],
   true,  true,  true,  true,  true,
   1000, 'SOURCE_RECORD_NOT_SEEN', null, 'NOT_ACTIVE'),
  -- ONE Epoch source, TWO companion distributions. Measured basis: both CSVs are served from the
  -- same path root (epoch.ai/data/data_centers/), documented by one methodology page, and the
  -- timelines file joins to the facilities file on its own `Data center` column -- 86 distinct
  -- values against 86 facility rows. They are one dataset, not two independent corroborating
  -- sources, and modelling them as two would manufacture agreement between a dataset and its
  -- own timeline file. The floor of 50 is the same measurement: facilities = 86 rows, and
  -- timelines carries at least the 86 distinct data centers it names, so 50 is below both.
  ('epoch_ai', 'Epoch AI', 'Epoch AI AI Data Centers',
   'https://epoch.ai/data/ai-data-centers', 'CC BY 4.0', array['data_centers','timelines'],
   false, false, false, false, true,
   50,   'NOT_OBSERVED_IN_CURRENT_RELEASE', null, 'NOT_ACTIVE')
on conflict (source_key) do nothing;


-- ===========================================================================================
-- 6. SELFTEST — mutation tests WITH positive controls.
--
-- Repo precedent: public.canonical_zip_guard_selftest(). Two properties this instrument has to
-- have, because this repo has been bitten by both:
--
--   (a) A NO-OP IMPLEMENTATION MUST NOT SCORE GREEN. Every negative check is paired with a
--       positive control, and a blanket-deny would fail checks 36-44 and 50-52.
--   (b) A TYPO MUST NOT READ AS A GUARD FIRING. dc_step2a_expect_fail() requires the error
--       message to MATCH the guard being tested, so a misspelled column ("relation does not
--       exist") is reported as a FAILURE, not banked as a refusal. Without that, every negative
--       test passes for the wrong reason and the suite attests to nothing.
--
-- Every write happens inside a subtransaction that is rolled back, so calling this against
-- production leaves nothing behind -- and check 53 PROVES that rather than assuming it.
-- ===========================================================================================

create or replace function public.dc_step2a_expect_fail(p_sql text, p_expect text)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  execute p_sql;
  -- It succeeded when it should not have. Roll the unexpected write back.
  raise exception using errcode = 'HS998';
exception
  when sqlstate 'HS998' then
    return 'NO ERROR RAISED (the statement was accepted)';
  when others then
    if sqlerrm ~ p_expect then
      return null;                                   -- refused, and refused for the right reason
    end if;
    return format('WRONG ERROR [%s] %s (expected to match: %s)', sqlstate, sqlerrm, p_expect);
end;
$fn$;

create or replace function public.dc_step2a_expect_ok(p_sql text)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
begin
  execute p_sql;
  raise exception using errcode = 'HS999';           -- succeeded; roll it back
exception
  when sqlstate 'HS999' then
    return null;
  when others then
    return format('REFUSED [%s] %s', sqlstate, sqlerrm);
end;
$fn$;

create or replace function public.dc_step2a_selftest()
returns table (check_name text, passed boolean, detail text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $fn$
declare
  res       jsonb := '[]'::jsonb;
  obs_fmt   text;
  run_fmt   text;
  SRC_FULL  constant text := '__selftest_full__';
  SRC_BARE  constant text := '__selftest_bare__';
  FP1 constant text := repeat('a',64);
  FP2 constant text := repeat('b',64);
  FP5 constant text := repeat('c',64);
  FP6 constant text := repeat('d',64);
  FP7 constant text := repeat('e',64);
  FP8 constant text := repeat('f',64);
  SHA constant text := repeat('1',64);
  r_ok uuid; r_ok2 uuid; r_inflight uuid; r_failed uuid; r_bare uuid; r_v2 uuid;
  v1 integer; v2 integer; v3 integer;
  snap jsonb; fp_live text; fp_recomputed text;
  n integer; m integer; leaked integer;
  bad text;
begin
  obs_fmt := $q$insert into public.dc_source_observation
      (acquisition_run_id,source_key,distribution_key,source_row_ordinal,
       semantic_observation_fingerprint,raw_payload,normalization_version%s)
    values (%L,%L,%L,%s,%L,'{}'::jsonb,'nv1'%s)$q$;
  run_fmt := $q$insert into public.dc_acquisition_run
      (source_key,distribution_key,trigger_kind,request_url,parser_key,parser_version,
       source_contract_version,source_contract,source_contract_fingerprint%s)
    values (%L,%L,'manual','https://selftest.invalid','p','1',0,'{}'::jsonb,''%s)$q$;

  begin   -- ============ FIXTURE SUBTRANSACTION (rolled back by the HS999 sentinel) ============

  insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
      supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
      supplies_release_identity,preserves_record_bytes,expected_min_records,not_seen_vocabulary)
    values (SRC_FULL,'selftest','selftest','none',array['facilities'],
      true,true,true,true,true,2,'SOURCE_RECORD_NOT_SEEN');
  insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
      supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
      supplies_release_identity,preserves_record_bytes,expected_min_records,not_seen_vocabulary)
    values (SRC_BARE,'selftest','selftest','none',array['data_centers','timelines'],
      false,false,false,false,false,1,'NOT_OBSERVED_IN_CURRENT_RELEASE');

  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',2,2,'SUCCESS_COMPLETE') returning id into r_ok;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',2,2,'SUCCESS_COMPLETE') returning id into r_ok2;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'')
    returning id into r_inflight;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),503,'FETCH_FAILED') returning id into r_failed;
  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_BARE,'data_centers','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',1,1,'SUCCESS_COMPLETE') returning id into r_bare;

  -- one real observation, so the same-run duplicate checks have something to collide with
  execute format(obs_fmt, ',publisher_record_id', r_ok, SRC_FULL, 'facilities', 0, FP1, ',''PUB-1''');

  -- ---- NEGATIVE: only a SUCCESS_COMPLETE run may advance observations -----------------------
  res := res || jsonb_build_object('n','01 observation refused against an IN-FLIGHT run','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_inflight,SRC_FULL,'facilities',1,FP2,''),'only SUCCESS_COMPLETE'));
  res := res || jsonb_build_object('n','02 observation refused against a FETCH_FAILED run','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_failed,SRC_FULL,'facilities',1,FP2,''),'only SUCCESS_COMPLETE'));

  -- ---- NEGATIVE: same-run duplicates fail, three ways ---------------------------------------
  res := res || jsonb_build_object('n','03 duplicate (run, source_row_ordinal) refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_FULL,'facilities',0,FP2,''),'dc_obs_run_ordinal_uidx'));
  res := res || jsonb_build_object('n','04 duplicate (run, publisher_record_id) refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',publisher_record_id',r_ok,SRC_FULL,'facilities',1,FP2,',''PUB-1'''),
      'dc_obs_run_publisher_uidx'));
  res := res || jsonb_build_object('n','05 duplicate (run, semantic fingerprint) refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_FULL,'facilities',1,FP1,''),'dc_obs_run_semantic_uidx'));

  -- ---- NEGATIVE: observations are immutable -------------------------------------------------
  res := res || jsonb_build_object('n','06 UPDATE of an observation refused','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_source_observation set source_native_name='x'
               where acquisition_run_id=%L$q$, r_ok),'immutable historical evidence'));
  res := res || jsonb_build_object('n','07 DELETE of an observation refused','d',
    public.dc_step2a_expect_fail(
      format($q$delete from public.dc_source_observation where acquisition_run_id=%L$q$, r_ok),
      'immutable historical evidence'));
  res := res || jsonb_build_object('n','08 TRUNCATE of observations refused','d',
    public.dc_step2a_expect_fail(
      'truncate public.dc_source_observation','immutable historical evidence'));

  -- ---- NEGATIVE: capability enforcement, read from the run FROZEN contract -------------------
  res := res || jsonb_build_object('n','09 publisher_record_id refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',publisher_record_id',r_bare,SRC_BARE,'data_centers',0,FP2,',''X'''),
      'supplies no publisher_record_id'));
  res := res || jsonb_build_object('n','10 geometry refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon,source_native_lat',r_bare,SRC_BARE,'data_centers',0,FP2,',1.0,2.0'),
      'supplies no geometry'));
  res := res || jsonb_build_object('n','11 lifecycle status refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_status',r_bare,SRC_BARE,'data_centers',0,FP2,',''Operating'''),
      'supplies no lifecycle status'));
  res := res || jsonb_build_object('n','12 raw_record_sha256 refused where bytes are not preserved','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',raw_record_sha256',r_bare,SRC_BARE,'data_centers',0,FP2,','||quote_literal(SHA)),
      'does not preserve exact record bytes'));

  -- ---- NEGATIVE: an observation cannot drift from its own run --------------------------------
  res := res || jsonb_build_object('n','13 observation whose source does not match its run refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_BARE,'facilities',9,FP2,''),'does not match its run'));

  -- ---- NEGATIVE: unknown stays NULL; no sentinels, no impossible coordinates -----------------
  res := res || jsonb_build_object('n','14 empty-string source value refused (absence is NULL)','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_name',r_ok,SRC_FULL,'facilities',9,FP2,','''''),
      'dc_obs_no_empty_text'));
  res := res || jsonb_build_object('n','15 longitude without latitude refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon',r_ok,SRC_FULL,'facilities',9,FP2,',1.0'),
      'dc_obs_lonlat_together'));
  res := res || jsonb_build_object('n','16 out-of-range coordinate refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon,source_native_lat',r_ok,SRC_FULL,'facilities',9,FP2,',999,0'),
      'dc_obs_lonlat_range'));
  res := res || jsonb_build_object('n','17 malformed semantic fingerprint refused','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,'',r_ok,SRC_FULL,'facilities',9,'not-a-sha',''),'dc_obs_semantic_shape'));

  -- ---- NEGATIVE: SUCCESS_COMPLETE is a comparison, never an opinion --------------------------
  res := res || jsonb_build_object('n','18 SUCCESS_COMPLETE with records_parsed < records_seen refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',
             ',now(),200,'||quote_literal(SHA)||',''sf'',5,4,''SUCCESS_COMPLETE'''),
      'dc_run_complete_shape'));
  res := res || jsonb_build_object('n','19 SUCCESS_COMPLETE with a non-200 status refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',
             ',now(),500,'||quote_literal(SHA)||',''sf'',5,5,''SUCCESS_COMPLETE'''),
      'dc_run_complete_shape'));
  res := res || jsonb_build_object('n','20 SUCCESS_COMPLETE below the anti-truncation floor refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',
             ',now(),200,'||quote_literal(SHA)||',''sf'',1,1,''SUCCESS_COMPLETE'''),
      'a short artifact is TRUNCATED'));
  res := res || jsonb_build_object('n','21 completed run with no outcome refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at',SRC_FULL,'facilities',',now()'),'dc_run_state_iff_done'));
  res := res || jsonb_build_object('n','22 outcome on a run that never completed refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completeness_state',SRC_FULL,'facilities',',''PARSE_FAILED'''),
      'dc_run_state_iff_done'));
  res := res || jsonb_build_object('n','23 a non-complete run may not claim it advanced observations','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',completed_at,http_status,completeness_state,advanced_observations',
             SRC_FULL,'facilities',',now(),200,''PARTIAL'',true'),
      'dc_run_only_complete_advances'));

  -- ---- NEGATIVE: a run cannot invent a source, a distribution, or a release identity ---------
  res := res || jsonb_build_object('n','24 run on an undeclared distribution refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,'',SRC_FULL,'timelines',''),'is not declared by source'));
  res := res || jsonb_build_object('n','25 run on an unknown source refused','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,'','__no_such_source__','facilities',''),'unknown source_key'));
  res := res || jsonb_build_object('n','26 publisher release identity refused where the contract supplies none','d',
    public.dc_step2a_expect_fail(
      format(run_fmt,',source_release_key',SRC_BARE,'data_centers',',''v2026-09'''),
      'supplies no release identity'));

  -- ---- NEGATIVE: runs are append-only receipts ----------------------------------------------
  res := res || jsonb_build_object('n','27 DELETE of an acquisition run refused','d',
    public.dc_step2a_expect_fail(
      format('delete from public.dc_acquisition_run where id=%L', r_inflight),
      'append-only receipt log'));
  res := res || jsonb_build_object('n','28 TRUNCATE of the evidence tables refused','d',
    public.dc_step2a_expect_fail(
      'truncate public.dc_source_observation, public.dc_acquisition_run','TRUNCATE is refused'));
  res := res || jsonb_build_object('n','29 a completed run is immutable','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set completeness_state='PARTIAL' where id=%L$q$, r_ok),
      'a completed run is immutable'));
  res := res || jsonb_build_object('n','30 the frozen contract snapshot is immutable','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set source_contract='{}'::jsonb where id=%L$q$, r_ok),
      'contract snapshot is immutable'));
  res := res || jsonb_build_object('n','31 a run cannot change source_key/distribution_key','d',
    public.dc_step2a_expect_fail(
      format($q$update public.dc_acquisition_run set distribution_key='timelines' where id=%L$q$, r_inflight),
      'source_key/distribution_key are immutable'));

  -- ---- NEGATIVE: ACTIVE without a schedule is unrepresentable --------------------------------
  res := res || jsonb_build_object('n','32 ACTIVE source with no schedule refused','d',
    public.dc_step2a_expect_fail(
      $q$insert into public.dc_source (source_key,publisher,dataset_name,licence,distributions,
           supplies_publisher_record_id,supplies_geometry,supplies_lifecycle_status,
           supplies_release_identity,preserves_record_bytes,not_seen_vocabulary,active_state)
         values ('__selftest_active__','x','x','none',array['facilities'],
           false,false,false,false,false,'SOURCE_RECORD_NOT_SEEN','ACTIVE')$q$,
      'dc_source_active_needs_schedule'));

  -- ---- POSITIVE CONTROL: the snapshot reproduces the frozen fingerprint ----------------------
  select source_contract, source_contract_fingerprint into snap, fp_live
    from public.dc_acquisition_run where id = r_ok;
  fp_recomputed := md5(
      (snap->>'source_key') || '|' || (snap->>'contract_version') || '|'
   || (snap->>'supplies_publisher_record_id') || '|' || (snap->>'supplies_geometry') || '|'
   || (snap->>'supplies_lifecycle_status')    || '|' || (snap->>'supplies_release_identity') || '|'
   || (snap->>'preserves_record_bytes')       || '|' || (snap->>'expected_min_records') || '|'
   || (snap->>'not_seen_vocabulary') || '|'
   || (select string_agg(d, ',' order by d) from jsonb_array_elements_text(snap->'distributions') d));
  res := res || jsonb_build_object('n','33 the frozen snapshot re-fingerprints to the frozen fingerprint','d',
    case when fp_recomputed = fp_live and fp_live <> '' then null
         else format('snapshot md5 %s vs stored %s', fp_recomputed, fp_live) end);

  -- ---- STRUCTURAL: the forbidden GLOBAL uniqueness must be ABSENT ----------------------------
  select count(*) into n from pg_indexes
   where schemaname='public' and tablename='dc_source_observation'
     and indexdef like '%UNIQUE%' and indexdef like '%source_key%'
     and indexdef like '%semantic_observation_fingerprint%';
  res := res || jsonb_build_object('n','34 NO global unique on (source_key, semantic fingerprint)','d',
    case when n = 0 then null else format('%s such index(es) exist -- repeated publisher assertions would collapse', n) end);
  select count(*) into n from pg_indexes
   where schemaname='public' and tablename='dc_source_observation'
     and indexdef like '%UNIQUE%' and indexdef like '%source_key%'
     and indexdef like '%publisher_record_id%';
  res := res || jsonb_build_object('n','35 NO global unique on (source_key, publisher_record_id)','d',
    case when n = 0 then null else format('%s such index(es) exist -- a re-published record would collapse', n) end);

  -- ---- POSITIVE CONTROLS: a blanket deny must NOT score green --------------------------------
  res := res || jsonb_build_object('n','36 a well-formed observation is ACCEPTED','d',
    public.dc_step2a_expect_ok(
      format(obs_fmt,',publisher_record_id,source_native_name,source_native_status,source_native_lon,source_native_lat,raw_record_sha256',
             r_ok,SRC_FULL,'facilities',7,FP6,
             ',''PUB-7'',''Selftest DC'',''Operating'',-97.7,30.2,'||quote_literal(SHA))));
  res := res || jsonb_build_object('n','37 the SAME semantic fingerprint in a DIFFERENT run is ACCEPTED (acquisition-scoped identity)','d',
    public.dc_step2a_expect_ok(format(obs_fmt,'',r_ok2,SRC_FULL,'facilities',0,FP1,'')));
  res := res || jsonb_build_object('n','38 the SAME publisher_record_id in a DIFFERENT run is ACCEPTED','d',
    public.dc_step2a_expect_ok(
      format(obs_fmt,',publisher_record_id',r_ok2,SRC_FULL,'facilities',1,FP7,',''PUB-1''')));
  res := res || jsonb_build_object('n','39 notes/advanced_observations still move on a completed run','d',
    public.dc_step2a_expect_ok(
      format($q$update public.dc_acquisition_run set notes='ok', advanced_observations=true where id=%L$q$, r_ok)));
  res := res || jsonb_build_object('n','40 an all-NULL observation from a no-capability source is ACCEPTED','d',
    public.dc_step2a_expect_ok(format(obs_fmt,'',r_bare,SRC_BARE,'data_centers',0,FP8,'')));
  res := res || jsonb_build_object('n','41 an honest SUCCESS_ZERO release is representable','d',
    public.dc_step2a_expect_ok(
      format(run_fmt,',completed_at,http_status,records_seen,records_parsed,completeness_state',
             SRC_FULL,'facilities',',now(),200,0,0,''SUCCESS_ZERO''')));

  -- ---- CONTRACT VERSIONING: an edit to the registry must not reinterpret history -------------
  select contract_version into v1 from public.dc_source where source_key = SRC_FULL;
  update public.dc_source set homepage_url = 'https://cosmetic.invalid' where source_key = SRC_FULL;
  select contract_version into v2 from public.dc_source where source_key = SRC_FULL;
  res := res || jsonb_build_object('n','42 a cosmetic registry edit does NOT bump contract_version','d',
    case when v2 = v1 then null else format('version moved %s -> %s on a homepage_url edit', v1, v2) end);

  update public.dc_source set supplies_geometry = false where source_key = SRC_FULL;
  select contract_version into v3 from public.dc_source where source_key = SRC_FULL;
  res := res || jsonb_build_object('n','43 a capability edit DOES bump contract_version','d',
    case when v3 = v1 + 1 then null else format('version %s -> %s on a capability edit (expected %s)', v1, v3, v1+1) end);

  insert into public.dc_acquisition_run (source_key,distribution_key,trigger_kind,request_url,
      parser_key,parser_version,source_contract_version,source_contract,source_contract_fingerprint,
      completed_at,http_status,artifact_sha256,schema_fingerprint,records_seen,records_parsed,
      completeness_state)
    values (SRC_FULL,'facilities','manual','https://selftest.invalid','p','1',0,'{}'::jsonb,'',
      now(),200,SHA,'sf',2,2,'SUCCESS_COMPLETE') returning id into r_v2;

  select count(*) into n from public.dc_acquisition_run
   where id = r_ok  and (source_contract->>'supplies_geometry')::boolean is true
     and source_contract_version = v1;
  select count(*) into m from public.dc_acquisition_run
   where id = r_v2 and (source_contract->>'supplies_geometry')::boolean is false
     and source_contract_version = v3;
  res := res || jsonb_build_object('n','44 the OLD run keeps the OLD frozen contract, the NEW run takes the NEW one','d',
    case when n = 1 and m = 1 then null else format('old-run match %s, new-run match %s (both must be 1)', n, m) end);

  res := res || jsonb_build_object('n','45 HEADLINE: geometry is still ACCEPTED on the pre-edit run','d',
    public.dc_step2a_expect_ok(
      format(obs_fmt,',source_native_lon,source_native_lat',r_ok,SRC_FULL,'facilities',8,FP5,',-97.7,30.2')));
  res := res || jsonb_build_object('n','46 HEADLINE: the same geometry is REFUSED on the post-edit run','d',
    public.dc_step2a_expect_fail(
      format(obs_fmt,',source_native_lon,source_native_lat',r_v2,SRC_FULL,'facilities',0,FP5,',-97.7,30.2'),
      'supplies no geometry'));

  raise exception using errcode = 'HS999';
  exception when sqlstate 'HS999' then null;
  end;   -- ============ FIXTURE ROLLED BACK ============

  -- ---- STRUCTURAL / SECURITY, read-only, outside the fixture ---------------------------------
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname='public' and c.relrowsecurity
     and c.relname in ('dc_source','dc_acquisition_run','dc_source_observation');
  select count(*) into m from pg_policies
   where schemaname='public' and tablename in ('dc_source','dc_acquisition_run','dc_source_observation');
  res := res || jsonb_build_object('n','47 RLS enabled on all 3 tables with ZERO policies','d',
    case when n = 3 and m = 0 then null else format('rls_enabled=%s (need 3), policies=%s (need 0)', n, m) end);

  bad := null;
  select string_agg(format('%s:%s:%s', rolename, tbl, priv), ', ') into bad
    from (select r.rolename, t.tbl, p.priv
            from (values ('anon'),('authenticated')) r(rolename)
            cross join (values ('public.dc_source'),('public.dc_acquisition_run'),
                               ('public.dc_source_observation')) t(tbl)
            cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES')) p(priv)
           where to_regrole(r.rolename) is not null
             and has_table_privilege(r.rolename, t.tbl, p.priv)) q;
  res := res || jsonb_build_object('n','48 anon and authenticated hold ZERO privileges on all 3 tables','d', bad);

  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace ns on ns.oid = c.relnamespace
   where not t.tgisinternal and ns.nspname='public'
     and c.relname in ('dc_source','dc_acquisition_run','dc_source_observation');
  res := res || jsonb_build_object('n','49 all 6 guard triggers are installed','d',
    case when n = 6 then null else format('%s non-internal triggers found, expected 6', n) end);

  select count(*) into n from pg_trigger t join pg_class c on c.oid = t.tgrelid
   where not t.tgisinternal and c.relname='dc_acquisition_run'
     and t.tgname='dc_acquisition_run_truncate_trg' and (t.tgtype & 32) <> 0;
  res := res || jsonb_build_object('n','50 the run TRUNCATE guard is installed (structural: an FK also blocks that TRUNCATE, so behaviour alone cannot attribute it)','d',
    case when n = 1 then null else 'BEFORE TRUNCATE trigger missing on dc_acquisition_run' end);

  select count(*) into n from public.dc_source
   where source_key in ('compute_atlas','epoch_ai')
     and active_state = 'NOT_ACTIVE' and schedule_cron is null;
  res := res || jsonb_build_object('n','51 Atlas and Epoch are seeded NOT_ACTIVE with no schedule','d',
    case when n = 2 then null else format('%s of 2 seeded sources are NOT_ACTIVE with a null schedule', n) end);

  -- The seeded contract is a MEASURED claim, so the suite has to defend it. Without this the
  -- anti-truncation floor could be widened 1000 -> 1 and NOTHING would move: check 20 proves the
  -- MECHANISM on the fixture source, not the VALUE on the seeded ones. Found by mutation, not by
  -- review -- the same shape as a guard whose removal moves no number.
  select count(*) into n from public.dc_source
   where (source_key = 'compute_atlas'
          and supplies_publisher_record_id and supplies_geometry and supplies_lifecycle_status
          and supplies_release_identity and preserves_record_bytes
          and expected_min_records = 1000
          and not_seen_vocabulary = 'SOURCE_RECORD_NOT_SEEN'
          and distributions = array['facilities']
          and contract_version = 1)
      or (source_key = 'epoch_ai'
          and not supplies_publisher_record_id and not supplies_geometry
          and not supplies_lifecycle_status and not supplies_release_identity
          and preserves_record_bytes
          and expected_min_records = 50
          and not_seen_vocabulary = 'NOT_OBSERVED_IN_CURRENT_RELEASE'
          and distributions = array['data_centers','timelines']
          and contract_version = 1);
  res := res || jsonb_build_object('n','52 the SEEDED capability contract and anti-truncation floors are unedited','d',
    case when n = 2 then null else format('%s of 2 seeded contracts match what was measured (Atlas 2,025 records -> floor 1000; Epoch 86 rows -> floor 50)', n) end);

  select count(*) into n from public.dc_acquisition_run;
  res := res || jsonb_build_object('n','53 CONTROL: zero acquisition runs exist (Step 2A ships no producer)','d',
    case when n = 0 then null else format('%s run(s) exist -- something is acquiring', n) end);

  select (select count(*) from public.dc_source where source_key like '\_\_selftest%')
       + (select count(*) from public.dc_acquisition_run where source_key like '\_\_selftest%')
       + (select count(*) from public.dc_source_observation where source_key like '\_\_selftest%')
    into leaked;
  res := res || jsonb_build_object('n','54 CONTROL: the selftest left NOTHING behind','d',
    case when leaked = 0 then null else format('%s selftest row(s) leaked into production tables', leaked) end);

  return query
    select e->>'n', (e->>'d') is null, e->>'d' from jsonb_array_elements(res) e;
end;
$fn$;

revoke all on function public.dc_step2a_expect_fail(text,text) from public, anon, authenticated;
revoke all on function public.dc_step2a_expect_ok(text)        from public, anon, authenticated;
revoke all on function public.dc_step2a_selftest()             from public, anon, authenticated;
