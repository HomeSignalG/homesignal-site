-- ============================================================================
-- N5 DISPOSABLE-DATABASE FIXTURE — RECONSTRUCTED PRE-MIGRATION STATE
-- ----------------------------------------------------------------------------
-- ✅ MEASURED, NOT RECONSTRUCTED (2026-09-03). Earlier revisions of this file derived the
-- shape from the builder's own column usage because no DDL was committed and the container
-- held no credentials. Both halves of that changed: read-only production introspection is
-- now available, and the DDL origin is known - branch claude/homesignal-zip-forensics-13xkmw,
-- commit f7c4b79, docs/n5-provenance-and-key-migration.sql.
--
-- Every column, type, nullability, PK and CHECK below now matches production as introspected
-- on 2026-09-03. Receipts: docs/n5-applied-state-of-record.md.
--
-- ⚠️ WHAT THIS FIXTURE DELIBERATELY CARRIES, because the migration must survive it:
--   * geo.n5_geom.provenance ALREADY EXISTS, NOT NULL, with n5_geom_provenance_ck applied
--   * production's extra n5_geom_semantics_ck
--   * NO verdict_snapshot_id, NO n5_geom_verdict_snapshot_ck, NO n5_geom_pt_namespace_ck
--   * geo.n5_point_reject in its OLD shape: PK (source_key, reason), detail jsonb, and none
--     of lat / lng / observed_in_z3 / verdict_snapshot_id
--   * geo.n5_association PK ALREADY (source_key, zip)
-- The legacy ROW population lives in fixture_legacy_seed.sql so migration-only tests can
-- opt out of it.
--
-- preservation.app_project_identity columns are taken verbatim from the committed
-- docs/preservation-baseline-phase1.sql insert list.
-- ============================================================================

create schema if not exists geo;
create schema if not exists preservation;
create schema if not exists public;

-- preservation.app_project_identity
--   columns: docs/preservation-baseline-phase1.sql `ins_identity` insert list.
--   read by: n5_shard.py refresh_proven_verdict_sql / validate_verdict_completeness /
--            assert_frozen_input_present / run_shard FREEZE.
create table preservation.app_project_identity (
  snapshot_id     text not null,
  app_project_id  uuid,
  zip             text,
  source_key      text,
  source_seq      integer,
  registry_id     text,
  record_kind     text,
  source_ref      text,
  submitted_at    timestamptz,
  lat             double precision,
  lng             double precision,
  identity_hash   bytea,
  content_hash    bytea
);
create index on preservation.app_project_identity (snapshot_id, app_project_id);

-- public.app_projects — run_shard FREEZE left-joins it for source_key_basis only.
create table public.app_projects (
  id                uuid primary key,
  source_key_basis  text
);

-- geo.n5_accepted_source — registry verdict. n5_shard.py: `join geo.n5_accepted_source a
--   on a.registry_id = coalesce(i.registry_id,'(null)')` + `where a.treatment='PROVEN'`.
create table geo.n5_accepted_source (
  registry_id text   primary key,
  treatment   text   not null,
  projects    bigint not null default 0,   -- production: NOT NULL
  pairs       bigint not null default 0    -- production: NOT NULL
);

-- geo.n5_snapshot — main() selects sources/projects/pairs/n_rows; the gate counts rows.
create table geo.n5_snapshot (
  snapshot_id text        primary key,
  taken_at    timestamptz not null default now(),   -- production: NOT NULL
  cutoff      timestamptz not null default now(),   -- production: NOT NULL
  scope       text        not null default 'national',
  sources     integer     not null default 0,       -- production: integer, NOT NULL
  projects    bigint      not null default 0,
  pairs       bigint      not null default 0,
  n_rows      bigint      not null default 0,
  checksum    numeric     not null default 0,       -- production: NOT NULL
  notes       text
);

-- geo.n5_shard — run_shard reads projects/pairs/zips/checksum; writes state/started_at/
--   finished_at/detail (jsonb).
create table geo.n5_shard (
  snapshot_id text        not null,
  z3          character(3) not null,
  projects    bigint,
  pairs       bigint,
  zips        integer,          -- production: integer, not bigint
  checksum    numeric,
  state       text        not null default 'pending',
  started_at  timestamptz,
  finished_at timestamptz,
  detail      jsonb,
  primary key (snapshot_id, z3)
);

-- geo.n5_frozen — run_shard FREEZE insert column list, verbatim.
create table geo.n5_frozen (
  z3               character(3) not null,
  source_key       text,
  zip              text,
  source_seq       smallint,        -- production: smallint, not integer
  registry_id      text,
  treatment        text,
  lat              double precision,
  lng              double precision,
  source_key_basis text
);
create index on geo.n5_frozen (z3);

-- geo.n5_zcta — load_boundaries insert: (z3, zcta5, geom).
create table geo.n5_zcta (
  z3     character(3) not null,
  zcta5  character(5) not null,
  geom   geometry(MultiPolygon, 4269),
  primary key (z3, zcta5)
);

-- geo.n5_geom — recover_shard insert list (source_key, registry_id, feature_id, outcome,
--   geom, invalid_reason, first_z3, provenance) + `on conflict (source_key, feature_id)`,
--   + recovered_at touched by the proven upsert's DO UPDATE.
--   PRE-MIGRATION the provenance and verdict_snapshot_id columns DO NOT EXIST; the
--   migration adds them. They are deliberately absent here.
create table geo.n5_geom (
  source_key     text        not null,
  registry_id    text        not null,     -- production: NOT NULL
  feature_id     text        not null,
  outcome        smallint    not null,     -- production: NOT NULL
  geom           geometry(Geometry, 4269),
  invalid_reason text,
  first_z3       character(3),
  recovered_at   timestamptz not null default now(),
  -- ALREADY APPLIED BY THE PARALLEL SESSION (f7c4b79). NOT NULL, no default.
  provenance     text        not null,
  constraint n5_geom_pkey primary key (source_key, feature_id),
  -- production, verbatim
  constraint n5_geom_provenance_ck check
    (provenance = any (array['recovered_authoritative'::text,'proven_stored_point'::text])),
  constraint n5_geom_semantics_ck check
    (((outcome = 1) and (geom is not null)) or (outcome <> 1))
);
-- DELIBERATELY ABSENT, because #1016 is what adds them:
--   geo.n5_geom.verdict_snapshot_id · n5_geom_verdict_snapshot_ck · n5_geom_pt_namespace_ck
create index n5_geom_gix on geo.n5_geom using gist (geom);

-- geo.n5_point_reject — ALREADY EXISTS IN PRODUCTION, in an INCOMPATIBLE shape.
--   This is the table `create table if not exists` silently no-ops against. PK is
--   (source_key, reason); `detail jsonb` is present; lat / lng / observed_in_z3 /
--   verdict_snapshot_id are ABSENT. Created by f7c4b79.
create table geo.n5_point_reject (
  source_key   text        not null,
  registry_id  text,
  reason       text        not null,
  detail       jsonb,
  rejected_at  timestamptz not null default now(),
  constraint n5_point_reject_pkey primary key (source_key, reason),
  constraint n5_point_reject_reason_ck check (reason = any (array[
    'NO_REGISTRY_VERDICT'::text,'NULL_COORD'::text,'NULL_ISLAND'::text,
    'OUTSIDE_JURISDICTION'::text,'INVALID_COORD'::text,'MULTI_COORD_UNRESOLVED'::text]))
);

-- geo.n5_association — PK IS ALREADY (source_key, zip). The parallel session corrected it by
--   create-copy-drop-rename table swap in f7c4b79, so #1016 only VALIDATES it. A fixture
--   carrying the old three-column key would test a migration step that no longer exists.
create table geo.n5_association (
  source_key text         not null,
  zip        character(5) not null,
  evidence   smallint     not null,
  constraint n5_association_pkey primary key (source_key, zip)
);
