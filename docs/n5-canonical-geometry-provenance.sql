-- ============================================================================
-- N5 CANONICAL GEOMETRY — EXPLICIT PROVENANCE, ASSOCIATION KEY CORRECTION,
-- POINT REJECT LEDGER, AND ASSOCIATION STAGING
-- ----------------------------------------------------------------------------
-- SCOPE — what this migration deliberately does NOT do
-- This is a SCHEMA-ONLY change. It does not rebuild any shard, does not
-- materialize PROVEN points, does not run shard 760, reclaims nothing, and does
-- not touch geo.b4_candidate_zcta_measurement. Production PROVEN materialization
-- happens later, at shard time, under separate authorization, so that before/after
-- receipts can be captured per shard. Schema change and data change are separated
-- on purpose: an uncontrolled national backfill would produce ~730k rows with no
-- receipt and no way to attribute them to a shard.
--
-- ============================================================================
-- §0  ONE TRANSACTION — this file must be applied whole or not at all
-- ============================================================================
-- Every statement below is transactional DDL in PostgreSQL. Applied statement-by-statement
-- (which is what the Supabase query endpoint does with separate calls), a failure after the
-- association PK is DROPPED but before it is ADDED would leave geo.n5_association with NO
-- primary key and no uniqueness, in production, with nothing to detect it.
--
-- APPLY THIS FILE AS A SINGLE STATEMENT/SCRIPT so BEGIN...COMMIT actually brackets it. If the
-- execution mechanism cannot do that, DO NOT APPLY IT: emulating atomic DDL with
-- application-side best effort is exactly the failure this guard exists to prevent.

begin;

-- ============================================================================
-- §1  geo.n5_geom IS CANONICAL PRODUCT DATA — NOT A DISPOSABLE CACHE
-- ============================================================================
-- The builder previously described this table as "the cross-shard geometry cache".
-- That wording is wrong in the only way that matters: a future session reading
-- "cache" during a disk emergency would reclaim it in good faith and delete the
-- product's authoritative spatial corpus.

comment on table geo.n5_geom is
  'PERMANENT CANONICAL PRODUCT GEOMETRY - the authoritative spatial corpus behind Map 1 '
  'address/radius reads. It incidentally enables geometry reuse across shards, but that '
  'does NOT make it a disposable build cache. It MUST NOT be reclaimed, truncated, or '
  'dropped to recover disk. Reclaiming it deletes the product''s spatial corpus.';

-- ============================================================================
-- §2  EXPLICIT PROVENANCE  (add nullable -> backfill -> assert -> CHECK -> NOT NULL)
-- ============================================================================
-- Until now, eligibility rested on an IMPLICIT invariant: "presence in n5_geom implies
-- RECOVERY", true only because recover_shard filters treatment='RECOVERY'. Once PROVEN
-- points are persisted here that invariant ends, so the distinction becomes an explicit,
-- machine-checkable value.
--
-- NO DEFAULT IS DECLARED, deliberately. A default would silently classify future geometry
-- written by a code path that forgot to set it. Without one, such an INSERT fails loudly.

alter table geo.n5_geom add column if not exists provenance text;

-- Backfill: every existing row is recovered authoritative geometry. Safe because this
-- table is RECOVERY-exclusive today - recover_shard is its only writer and it selects
-- `where z3=<shard> and treatment='RECOVERY'`.
update geo.n5_geom set provenance = 'recovered_authoritative' where provenance is null;

-- Assert zero NULL before enforcing. Fail loudly rather than constraining a dirty table.
do $$
declare n_null bigint;
begin
  select count(*) into n_null from geo.n5_geom where provenance is null;
  if n_null <> 0 then
    raise exception 'n5_geom provenance backfill incomplete: % NULL rows remain', n_null;
  end if;
end $$;

alter table geo.n5_geom drop constraint if exists n5_geom_provenance_ck;
alter table geo.n5_geom add constraint n5_geom_provenance_ck
  check (provenance in ('recovered_authoritative','proven_stored_point'));

alter table geo.n5_geom alter column provenance set not null;

comment on column geo.n5_geom.provenance is
  'How this geometry instance became radius-eligible. recovered_authoritative = fetched from '
  'the publisher for a RECOVERY-treatment project. proven_stored_point = the fidelity-proven '
  'stored coordinate of a PROVEN-treatment project, admitted at INSERTION through the registry '
  'verdict + per-project sanity gate. Allowlist + NOT NULL + no DEFAULT: an unrecognised or '
  'absent provenance cannot be written, so it can never become radius-eligible by default.';

-- Structurally reserve the 'pt:' namespace. Until now it was only OBSERVED that publisher
-- feature ids do not start 'pt:' (0 of 8,626). Observation is not a guarantee, so the
-- biconditional is enforced: a proven stored point is EXACTLY 'pt:1', and no recovered row
-- may squat the reserved namespace. 'pt:2'+ stays undefined and is therefore prohibited.
do $$
declare bad bigint;
begin
  select count(*) into bad from geo.n5_geom
   where (provenance = 'proven_stored_point') <> (feature_id = 'pt:1')
      or (provenance = 'recovered_authoritative' and feature_id like 'pt:%');
  if bad <> 0 then
    raise exception
      'STOP: % existing geo.n5_geom row(s) violate the pt: namespace reservation. '
      'Existing feature ids are NOT modified automatically - resolve manually.', bad;
  end if;
end $$;

alter table geo.n5_geom drop constraint if exists n5_geom_pt_namespace_ck;
alter table geo.n5_geom add constraint n5_geom_pt_namespace_ck
  check ((provenance = 'proven_stored_point') = (feature_id = 'pt:1'));

-- ============================================================================
-- §3  ASSOCIATION PRIMARY KEY CORRECTION  (a correctness bug, not cleanup)
-- ============================================================================
-- geo.n5_association was keyed (source_key, zip, evidence), which makes a CLASSIFICATION
-- part of IDENTITY. evidence is mutable state: one (source_key, zip) has exactly one current
-- evidence class, assigned by a single CASE in build_associations. Under the old key a pair
-- reclassified 2 -> 1 INSERTS A SECOND ROW instead of replacing, and the pair then appears in
-- both the refuted and the verified class - corrupting v1..v4, the association total, and the
-- derived refutation rate simultaneously.
--
-- Latent today (measured: 0 occurrences) and live the instant anything rebuilds. It is
-- therefore corrected BEFORE any rebuild-capable builder behaviour can run.

do $$
declare dup bigint; conflicting bigint;
begin
  select count(*) into dup from (
    select source_key, zip from geo.n5_association group by 1,2 having count(*) > 1) t;
  select count(*) into conflicting from (
    select source_key, zip from geo.n5_association group by 1,2 having count(distinct evidence) > 1) t;
  if dup <> 0 or conflicting <> 0 then
    raise exception
      'STOP: n5_association needs reconciliation first - % duplicate (source_key,zip), % conflicting-evidence pairs. '
      'Automatic reconciliation is deliberately NOT attempted.', dup, conflicting;
  end if;
end $$;

alter table geo.n5_association drop constraint if exists n5_association_pkey;
alter table geo.n5_association add constraint n5_association_pkey
  primary key (source_key, zip);

comment on column geo.n5_association.evidence is
  'Mutable classification (1 geometry_verified / 2 legacy_unverifiable / 3 legacy_unsupported / '
  '4 unresolved). NOT part of identity - identity is (source_key, zip), one current class per pair.';

-- ============================================================================
-- §4  POINT REJECT LEDGER — a rejected candidate must never silently disappear
-- ============================================================================
-- Answers, durably: "why was source_key X not materialized as radius-eligible geometry?"

create table if not exists geo.n5_point_reject (
  source_key      text        not null,
  registry_id     text,
  lat             double precision,
  lng             double precision,
  reason          text        not null,
  observed_in_z3  character(3),
  rejected_at     timestamptz not null default now(),
  -- PROJECT-GLOBAL identity. z3 is diagnostic "observed during" metadata only: a source_key
  -- can appear in up to 12 shards, and keying rejection by z3 would let one project hold
  -- several contradictory "current" reasons at once. There is exactly ONE current answer to
  -- "why is source_key X not materialized?".
  constraint n5_point_reject_pkey primary key (source_key),
  constraint n5_point_reject_reason_ck check (reason in (
    'NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND',
    'OUTSIDE_JURISDICTION','INVALID_COORD','MULTI_COORD_UNRESOLVED'))
);

-- OUTSIDE_JURISDICTION stays in the vocabulary but is RESERVED and UNUSED in v1.
-- Jurisdiction validation is reserved until an authoritative project-level jurisdiction field
-- or boundary is available. ZIP-page materialization is NOT jurisdiction evidence and MUST NOT
-- be used as a substitute: preservation.app_project_identity.zip is the ZIP PAGE a project was
-- materialized onto (up to 217 per project), not an address ZIP. v1 never emits this reason.

-- ============================================================================
-- §4b  PROJECT-GLOBAL PROVEN VERDICT  (required: the alternative is a full scan per shard)
-- ============================================================================
-- MEASURED 2026-09-02: preservation.app_project_identity carries exactly ONE index,
-- (snapshot_id, app_project_id). There is no index on source_key, so a per-shard global
-- verdict lookup plans as `Parallel Seq Scan ... cost=0.00..149046.81` for a SINGLE key over a
-- 1,125 MB table. Evaluating ~17k source_keys interactively per shard would scan the national
-- table repeatedly. Correctness first, then bounded execution: the verdict is precomputed once
-- per snapshot at project-global grain and read by key.
--
-- Grain is source_key ALONE. Not z3. z3 is processing/resume provenance, never geometry
-- ownership - which is what makes shard processing order-independent.

create table if not exists geo.n5_proven_verdict (
  snapshot_id  text        not null,
  source_key   text        not null,
  registry_id  text,
  ncoord       integer     not null,
  lat          double precision,
  lng          double precision,
  verdict      text        not null,
  computed_at  timestamptz not null default now(),
  constraint n5_proven_verdict_pkey primary key (snapshot_id, source_key),
  constraint n5_proven_verdict_ck check (verdict in (
    'ELIGIBLE','NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND',
    'INVALID_COORD','MULTI_COORD_UNRESOLVED')),
  -- An eligible verdict must carry exactly one observed coordinate pair.
  constraint n5_proven_verdict_eligible_ck check (
    verdict <> 'ELIGIBLE' or (ncoord = 1 and lat is not null and lng is not null))
);

comment on table geo.n5_proven_verdict is
  'PROJECT-GLOBAL eligibility verdict for PROVEN stored points, computed once per snapshot from '
  'preservation.app_project_identity (the authoritative frozen identity baseline that yields '
  '723,449 PROVEN source_keys). Keyed by source_key alone - NOT by z3 - so every shard reaches '
  'the identical verdict and processing order cannot change the outcome. Multi-coordinate is a '
  'GLOBAL condition: shard A can no longer materialize a point that shard B would later '
  'discover to be multi-coordinate. NOT POPULATED BY THIS MIGRATION.';

comment on table geo.n5_point_reject is
  'Why a PROVEN-treatment project was NOT materialized into canonical radius-eligible geometry. '
  'The PK (z3, source_key, reason) makes reject recording deterministic and idempotent under '
  'rerun. Failures are recorded, never silently dropped.';

-- ============================================================================
-- §5  ASSOCIATION STAGING  (stage-and-swap rebuild)
-- ============================================================================
-- geo.n5_stage is a manifest of counts, not row storage, so association staging needs its
-- own table. A rebuilt shard is materialized here FIRST; the authoritative set in
-- geo.n5_association is untouched until reconciliation passes and the swap commits.

create table if not exists geo.n5_association_stage (
  z3          character(3) not null,
  source_key  text         not null,
  zip         character(5) not null,
  evidence    smallint     not null,
  constraint n5_association_stage_pkey primary key (z3, source_key, zip),
  constraint n5_association_stage_evidence_ck check (evidence in (1,2,3,4))
);

comment on table geo.n5_association_stage is
  'Per-shard staging for the stage-and-swap rebuild. The PK (z3, source_key, zip) enforces the '
  'same one-class-per-pair identity as the authoritative table, so a staging run that would '
  'produce two rows for one pair fails HERE rather than corrupting production.';

commit;
