-- ============================================================================
-- N5 DISPOSABLE-DATABASE FIXTURE — RECONSTRUCTED PRE-MIGRATION STATE
-- ----------------------------------------------------------------------------
-- ⚠️ THIS IS A RECONSTRUCTION, AND THAT IS A LIMITATION OF THE RECEIPT.
--
-- The production geo.n5_* tables were created ad hoc; NO DDL for them is committed
-- anywhere in this repository (verified: the only `create table ... geo.n5_` statements
-- in the tree are the four NEW tables in docs/n5-canonical-geometry-provenance.sql).
-- The agent container holds no database credentials, so the real pre-state cannot be
-- introspected from here and MUST NOT be taken from production in any case.
--
-- Every column below is therefore DERIVED FROM THE BUILDER'S OWN USAGE at 81c1d3b, with
-- the deriving line cited. A migration test against this fixture proves the migration is
-- correct FOR THIS SHAPE. If production's shape differs in a way the citations do not
-- capture, that difference is not covered.
--
-- preservation.app_project_identity is the exception: its columns are taken verbatim
-- from the committed docs/preservation-baseline-phase1.sql insert list.
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
  registry_id text primary key,
  treatment   text not null
);

-- geo.n5_snapshot — main() selects sources/projects/pairs/n_rows; the gate counts rows.
create table geo.n5_snapshot (
  snapshot_id text primary key,
  sources     bigint,
  projects    bigint,
  pairs       bigint,
  n_rows      bigint
);

-- geo.n5_shard — run_shard reads projects/pairs/zips/checksum; writes state/started_at/
--   finished_at/detail (jsonb).
create table geo.n5_shard (
  snapshot_id text        not null,
  z3          character(3) not null,
  projects    bigint,
  pairs       bigint,
  zips        bigint,
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
  source_seq       integer,
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
  source_key     text not null,
  registry_id    text,
  feature_id     text not null,
  outcome        smallint,
  geom           geometry(Geometry, 4269),
  invalid_reason text,
  first_z3       character(3),
  recovered_at   timestamptz not null default now(),
  constraint n5_geom_pkey primary key (source_key, feature_id)
);
create index n5_geom_gix on geo.n5_geom using gist (geom);

-- geo.n5_association — PRE-MIGRATION KEY IS (source_key, zip, evidence). That is the
--   defect §3 of the migration corrects; the fixture must carry the WRONG key or the
--   migration test proves nothing.
create table geo.n5_association (
  source_key text         not null,
  zip        character(5) not null,
  evidence   smallint     not null,
  constraint n5_association_pkey primary key (source_key, zip, evidence)
);
