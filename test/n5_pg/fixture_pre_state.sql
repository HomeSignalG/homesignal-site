-- ============================================================================
-- N5 DISPOSABLE-DATABASE FIXTURE — THE *ACTUAL* PRE-MIGRATION PRODUCTION STATE
-- ----------------------------------------------------------------------------
-- ⚠️ WHAT CHANGED, AND WHY IT MATTERS MORE THAN ANYTHING ELSE IN THIS FILE
--
-- The previous version of this fixture modelled the state of the world BEFORE
-- commit f7c4b79 — no `provenance` column, no reject table at all, and the
-- association primary key still (source_key, zip, evidence). That state NO LONGER
-- EXISTS. A PARALLEL SESSION applied f7c4b79's docs/n5-provenance-and-key-migration.sql
-- to production, and then materialised 718,278 canonical points and 5,171 point
-- rejects with AD-HOC SQL that is committed in no repository ref.
--
-- Testing the migration against the pre-f7c4b79 shape therefore proved it correct for
-- a database that cannot be the target. This fixture models the shape that IS the
-- target, so a green suite means something.
--
-- ============================================================================
-- PROVENANCE OF EVERY MODELLED FACT — three tiers, never blurred
-- ============================================================================
-- TIER 1 — RECOVERED FROM A COMMITTED REF. The exact DDL applied to production for
--   the provenance column, its CHECK, the reject table with PK (source_key, reason)
--   and its reason CHECK, the RLS posture, and the association PK swap. Source:
--   `git show f7c4b79:docs/n5-provenance-and-key-migration.sql`.
--
-- TIER 2 — MEASURED PRODUCTION RECEIPT, founder-verified. Row populations and the
--   partition that closes over them. Source: commit 4027754, QUEUE.md:
--   718,278 `proven_stored_point` + 8,626 `recovered_authoritative`; rejects
--   4,877 MULTI_COORD_UNRESOLVED + 294 NULL_COORD; and
--   718,278 + 4,877 + 294 = 723,449 PROVEN projects "closing exactly".
--   The other four reject reasons measured ZERO, so this fixture emits only the two
--   reasons production actually holds.
--
-- TIER 3 — RECONSTRUCTED, NOT VERIFIABLE FROM ANY DURABLE REF. The `detail` jsonb
--   payload shape `{"snapshot": ..., "distinct_coords": N}`. `git log --all -S"distinct_coords"`
--   returns ZERO commits, so the ad-hoc SQL that wrote it is unrecoverable and this
--   shape is modelled from the narrative, not from evidence. Anything that depends on
--   the payload's INTERNAL KEYS is therefore proving behaviour against a reconstruction.
--   The migration is deliberately written not to depend on `distinct_coords` at all;
--   it reads only `detail->>'snapshot'`, and it PRESERVES the payload opaquely.
--
-- ⚠️ NOT MODELLED, DELIBERATELY: a constraint named `n5_geom_semantics_ck`. It was
--   described as present in production, but it appears in ZERO commits across ALL refs
--   of BOTH repositories, and no ref states its predicate. Inventing a predicate for a
--   constraint whose definition is unknown would put a fabricated invariant into the one
--   file whose entire purpose is fidelity. If that constraint is real, its definition
--   must be introspected from production and added here before this fixture is complete.
--
-- ⚠️ STILL A RECONSTRUCTION IN ONE RESPECT: the columns of the geo.n5_* tables that
--   PREDATE f7c4b79 (n5_geom's own columns, n5_frozen, n5_shard, n5_zcta, n5_snapshot,
--   n5_accepted_source) have no committed DDL anywhere, and this container holds no
--   database credentials. Those remain derived from the builder's own column usage.
-- ============================================================================

create schema if not exists geo;
create schema if not exists preservation;
create schema if not exists public;

-- preservation.app_project_identity
--   columns: docs/preservation-baseline-phase1.sql `ins_identity` insert list.
--   read by: n5_shard.py refresh_proven_verdict_sql / validate_verdict_completeness /
--            assert_frozen_input_present / run_shard FREEZE, and — new in the corrected
--            migration — the fail-closed legacy geometry gate.
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
--   finished_at/detail (jsonb). `zips` is integer, not bigint (type fidelity).
create table geo.n5_shard (
  snapshot_id text        not null,
  z3          character(3) not null,
  projects    bigint,
  pairs       bigint,
  zips        integer,
  checksum    numeric,
  state       text        not null default 'pending',
  started_at  timestamptz,
  finished_at timestamptz,
  detail      jsonb,
  primary key (snapshot_id, z3)
);

-- geo.n5_frozen — run_shard FREEZE insert column list, verbatim. `source_seq` is
--   smallint, not integer (type fidelity).
create table geo.n5_frozen (
  z3               character(3) not null,
  source_key       text,
  zip              text,
  source_seq       smallint,
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

-- ============================================================================
-- geo.n5_geom — POST-f7c4b79, PRE-#1016
-- ----------------------------------------------------------------------------
-- TIER 1. `provenance` is ALREADY PRESENT, ALREADY NOT NULL, ALREADY CHECKed, and
-- deliberately has NO DEFAULT — exactly as f7c4b79 left it. The three things #1016
-- still owns are ABSENT and must stay absent here:
--   * verdict_snapshot_id          (the column)
--   * n5_geom_verdict_snapshot_ck  (the biconditional)
--   * n5_geom_pt_namespace_ck      (the pt: namespace reservation)
-- ============================================================================
create table geo.n5_geom (
  source_key     text not null,
  registry_id    text,
  feature_id     text not null,
  outcome        smallint,
  geom           geometry(Geometry, 4269),
  invalid_reason text,
  first_z3       character(3),
  recovered_at   timestamptz not null default now(),
  provenance     text not null,
  constraint n5_geom_pkey primary key (source_key, feature_id),
  constraint n5_geom_provenance_ck
    check (provenance in ('recovered_authoritative','proven_stored_point'))
);
create index n5_geom_gix on geo.n5_geom using gist (geom);

-- ============================================================================
-- geo.n5_point_reject — THE LEGACY SHAPE, WHICH IS *INCOMPATIBLE* WITH #1016's
-- ----------------------------------------------------------------------------
-- TIER 1. This is the single most important line in the file: the table EXISTS, so
-- #1016's `create table if not exists geo.n5_point_reject (...)` SILENTLY NO-OPS and
-- leaves this shape in place. The PK is (source_key, reason) — NOT (source_key) — and
-- lat/lng/observed_in_z3/verdict_snapshot_id DO NOT EXIST. `detail` exists here and
-- does NOT exist in #1016's target shape, so a naive rebuild DESTROYS the only durable
-- provenance the legacy run left behind.
-- ============================================================================
create table geo.n5_point_reject (
  source_key   text        not null,
  registry_id  text,
  reason       text        not null,
  detail       jsonb,
  rejected_at  timestamptz not null default now(),
  constraint n5_point_reject_pkey primary key (source_key, reason),
  constraint n5_point_reject_reason_ck
    check (reason in ('NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND',
                    'OUTSIDE_JURISDICTION','INVALID_COORD','MULTI_COORD_UNRESOLVED'))
);
alter table geo.n5_point_reject enable row level security;

-- ============================================================================
-- geo.n5_association — THE KEY IS ALREADY CORRECT
-- ----------------------------------------------------------------------------
-- TIER 1. f7c4b79 already changed this key by table swap (create _new, copy, verify
-- counts, drop, rename, rename index). The pre-state therefore carries (source_key, zip)
-- ALREADY, and #1016 no longer OWNS this change — it can only VALIDATE it. A fixture
-- carrying the old three-column key would test a transition that cannot occur.
-- ============================================================================
create table geo.n5_association (
  source_key text         not null,
  zip        character(5) not null,
  evidence   smallint     not null,
  constraint n5_association_pkey primary key (source_key, zip)
);
alter table geo.n5_association enable row level security;

-- ============================================================================
-- THE LEGACY POPULATION — a miniature of the ad-hoc materialisation
-- ----------------------------------------------------------------------------
-- TIER 2 in STRUCTURE, scaled down in SIZE. Production holds 718,278 canonical points
-- and 5,171 rejects partitioning 723,449 PROVEN source_keys exactly. This models the
-- same partition at 3 + 3 over 6, preserving every structural property the migration's
-- fail-closed gate actually tests:
--
--   * the canonical proven set equals the CURRENT-RULE ELIGIBLE set, both directions
--   * canonical coordinates equal the authoritative eligible coordinates exactly
--   * every canonical row is feature_id 'pt:1' and a POINT in SRID 4269
--   * no source_key holds more than one legacy PROVEN geometry
--   * recovered geometry never squats the pt: namespace
--   * the reject partition CLOSES the authoritative PROVEN population with no overlap
--   * only the two reason values production actually holds are present
--   * a project appearing on several page ZIPs with ONE coordinate is still eligible
--     (production: 72,856 of 723,449 PROVEN source_keys appear in more than one z3)
--
-- The legacy keys are namespaced `lg-` so they cannot collide with the `sk-`/`a-`..`i-`
-- keys the behavioural groups seed later in the suite.
-- ============================================================================

insert into geo.n5_accepted_source (registry_id, treatment) values
  ('r-legacy-proven', 'PROVEN'),
  ('r-legacy-rec',    'RECOVERY');

insert into geo.n5_snapshot (snapshot_id, sources, projects, pairs, n_rows)
values ('phase1-2026-09-01', 2, 7, 9, 9);

-- The authoritative frozen identity baseline. `refresh_proven_verdict_sql()`'s derivation
-- over these rows is what the migration's gate re-derives and demands agreement with.
insert into preservation.app_project_identity
  (snapshot_id, source_key, zip, registry_id, lat, lng, source_seq, record_kind) values
  -- ELIGIBLE: exactly one distinct observed coordinate pair, in range, not null island
  ('phase1-2026-09-01', 'lg-elig-1', '30001', 'r-legacy-proven',  41.10, -111.10, 1, 'development'),
  ('phase1-2026-09-01', 'lg-elig-2', '30002', 'r-legacy-proven',  41.20, -111.20, 1, 'development'),
  -- same project, second page ZIP, IDENTICAL coordinate -> still ONE distinct pair
  ('phase1-2026-09-01', 'lg-elig-2', '30003', 'r-legacy-proven',  41.20, -111.20, 2, 'development'),
  ('phase1-2026-09-01', 'lg-elig-3', '30004', 'r-legacy-proven',  41.30, -111.30, 1, 'development'),
  -- MULTI_COORD_UNRESOLVED: two and three distinct observed pairs
  ('phase1-2026-09-01', 'lg-multi-1', '30005', 'r-legacy-proven', 41.40, -111.40, 1, 'development'),
  ('phase1-2026-09-01', 'lg-multi-1', '30005', 'r-legacy-proven', 41.45, -111.45, 2, 'development'),
  ('phase1-2026-09-01', 'lg-multi-2', '30006', 'r-legacy-proven', 41.50, -111.50, 1, 'development'),
  ('phase1-2026-09-01', 'lg-multi-2', '30006', 'r-legacy-proven', 41.55, -111.55, 2, 'development'),
  ('phase1-2026-09-01', 'lg-multi-2', '30006', 'r-legacy-proven', 41.56, -111.56, 3, 'development'),
  -- NULL_COORD: zero distinct observed pairs
  ('phase1-2026-09-01', 'lg-null-1', '30007', 'r-legacy-proven',  null,  null,   1, 'development'),
  -- NOT in the PROVEN population at all: its registry verdict is RECOVERY
  ('phase1-2026-09-01', 'lg-rec-1',  '30008', 'r-legacy-rec',     41.60, -111.60, 1, 'development');

-- The 718,278-analogue: canonical PROVEN geometry materialised by the ad-hoc SQL.
-- feature_id is 'pt:1' for every row (production: 100%), the coordinate is the
-- authoritative eligible pair, and verdict_snapshot_id CANNOT be set because the
-- column does not exist yet. THAT ABSENCE IS THE DEFECT #1016 HAS TO CORRECT.
insert into geo.n5_geom
  (source_key, registry_id, feature_id, outcome, geom, first_z3, provenance) values
  ('lg-elig-1', 'r-legacy-proven', 'pt:1', 1,
   ST_SetSRID(ST_MakePoint(-111.10, 41.10), 4269), null, 'proven_stored_point'),
  ('lg-elig-2', 'r-legacy-proven', 'pt:1', 1,
   ST_SetSRID(ST_MakePoint(-111.20, 41.20), 4269), null, 'proven_stored_point'),
  ('lg-elig-3', 'r-legacy-proven', 'pt:1', 1,
   ST_SetSRID(ST_MakePoint(-111.30, 41.30), 4269), null, 'proven_stored_point');

-- The 8,626-analogue: RECOVERY geometry fetched from the publisher. One project owning
-- TWO features, because a project legitimately may — collapsing them with DISTINCT ON is
-- the error the n5_geom table comment warns about. Publisher feature ids never start 'pt:'.
insert into geo.n5_geom
  (source_key, registry_id, feature_id, outcome, geom, first_z3, provenance) values
  ('lg-rec-1', 'r-legacy-rec', 'oid-101', 1,
   ST_SetSRID(ST_MakePoint(-111.60, 41.60), 4269), '300', 'recovered_authoritative'),
  ('lg-rec-1', 'r-legacy-rec', 'oid-102', 1,
   ST_SetSRID(ST_MakePoint(-111.61, 41.61), 4269), '300', 'recovered_authoritative');

-- The 5,171-analogue: the ONLY durable provenance the legacy run produced. Old shape,
-- old key, `detail` carrying the snapshot attribution (TIER 3 payload shape), and fixed
-- `rejected_at` values so the archive gate's preservation check is actually falsifiable.
insert into geo.n5_point_reject (source_key, registry_id, reason, detail, rejected_at) values
  ('lg-multi-1', 'r-legacy-proven', 'MULTI_COORD_UNRESOLVED',
   '{"snapshot":"phase1-2026-09-01","distinct_coords":2}'::jsonb,
   '2026-09-01 04:05:06+00'),
  ('lg-multi-2', 'r-legacy-proven', 'MULTI_COORD_UNRESOLVED',
   '{"snapshot":"phase1-2026-09-01","distinct_coords":3}'::jsonb,
   '2026-09-01 04:05:07+00'),
  ('lg-null-1',  'r-legacy-proven', 'NULL_COORD',
   '{"snapshot":"phase1-2026-09-01","distinct_coords":0}'::jsonb,
   '2026-09-01 04:05:08+00');

-- Pre-existing associations under the already-correct key.
insert into geo.n5_association (source_key, zip, evidence) values
  ('lg-elig-1', '30001', 1),
  ('lg-elig-2', '30002', 1),
  ('lg-elig-3', '30004', 2);
