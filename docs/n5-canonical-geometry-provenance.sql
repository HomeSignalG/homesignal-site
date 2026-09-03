-- ============================================================================
-- N5 SNAPSHOT ATTRIBUTION, POINT-REJECT CURRENT-STATE TRANSITION,
-- AND THE VERDICT PUBLICATION TABLES
-- ----------------------------------------------------------------------------
-- ⚠️ REWRITTEN 2026-09-03 AGAINST THE MEASURED PRODUCTION PRE-STATE.
--
-- The previous version of this file was written against a pre-state that no longer exists and
-- COULD NOT HAVE APPLIED. A parallel session (branch claude/homesignal-zip-forensics-13xkmw,
-- commit f7c4b79) applied its own provenance/key/reject migration to production on
-- 2026-09-02 ~23:48-23:50Z and then materialised 718,278 canonical proven points and 5,171
-- rejects. Full receipt: docs/n5-applied-state-of-record.md. Object-by-object responsibility:
-- docs/n5-object-ownership.md. READ BOTH BEFORE EDITING THIS FILE.
--
-- Two concrete failures in the old version, both now fixed:
--   1. it added verdict_snapshot_id and immediately enforced the biconditional, which 718,278
--      pre-existing proven rows would have violated -> ADD CONSTRAINT raises, whole migration
--      rolls back. It failed safe, but it failed.
--   2. it used `create table if not exists geo.n5_point_reject`, a SILENT NO-OP against the
--      table that already exists with a different shape and a different primary key.
--
-- STRATEGY (approved "Option D"):
--   GEOMETRY -> attribute in place. The 718,278 legacy points are PROVEN EQUAL to the current
--     approved eligible set (eight independent difference measures, all zero). Deleting and
--     rebuilding provably-correct data would be destruction without a finding.
--   REJECTS  -> archive, then rebuild. The 5,171 legacy rows carry the ONLY durable snapshot
--     provenance the ad-hoc materialisation left, so they are preserved before anything is
--     dropped; the live table then becomes current-state-only, as the architecture requires.
--
-- WHAT THIS FILE DOES NOT DO: it does not populate geo.n5_proven_verdict, does not run the
-- canonical sweep, does not run any shard, reclaims nothing, and does not touch
-- geo.b4_candidate_zcta_measurement. It also does NOT re-run the parallel session's SQL.
--
-- ============================================================================
-- §0  ONE TRANSACTION — apply whole or not at all
-- ============================================================================
-- Every statement below is transactional DDL in PostgreSQL. Applied piecemeal, a failure after
-- the reject rows are deleted but before they are rebuilt would leave production with an empty
-- current-state ledger.
--
-- APPLY THIS FILE AS A SINGLE STATEMENT/SCRIPT so BEGIN...COMMIT actually brackets it. If the
-- execution mechanism cannot do that, DO NOT APPLY IT: emulating atomic DDL with
-- application-side best effort is exactly the failure this guard exists to prevent.
--
-- STILL GOVERNING, carried forward from the previous revision:
--
--   OUTSIDE_JURISDICTION stays in the reject vocabulary but is RESERVED and UNUSED in v1.
--   Jurisdiction validation waits for an authoritative project-level jurisdiction field or
--   boundary. ZIP-page materialization is NOT jurisdiction evidence and MUST NOT be used as a
--   substitute: preservation.app_project_identity.zip is the ZIP PAGE a project was
--   materialized onto (up to 217 per project), not an address ZIP. v1 never emits
--   'OUTSIDE_JURISDICTION'. The vocabulary itself belongs to the parallel session's
--   n5_point_reject_reason_ck, which §1 validates rather than re-authoring.
--
--   geo.n5_snapshot carries a second row, 'n5-2026-09-02T173042Z', with NO rows in
--   preservation.app_project_identity and referenced by no shard. Status:
--   ORPHAN / INPUT BASELINE ABSENT / NOT CONSUMABLE. It is preserved as evidence until its
--   provenance is separately resolved, and must never be selected as a run snapshot.

begin;

-- ============================================================================
-- §1  PRE-STATE CLASSIFICATION — A migrate / B no-op / C fail loudly
-- ============================================================================
-- Idempotence must never mean "ignore unexpected schema". IF EXISTS / IF NOT EXISTS hide the
-- SHAPE of an object that already exists, which is exactly how failure (2) above happened. So
-- the pre-state is classified explicitly, and anything unrecognised raises here — before any
-- write — rather than being silently absorbed.

do $classify$
declare
  has_vsid      bool;  has_bicond   bool;  has_ptns   bool;
  reject_pk     text;  has_archive  bool;  prov_ck    text;
  prov_notnull  bool;  assoc_pk     text;  state      text;
begin
  select exists (select 1 from information_schema.columns
                  where table_schema='geo' and table_name='n5_geom'
                    and column_name='verdict_snapshot_id') into has_vsid;
  select exists (select 1 from pg_constraint
                  where conname='n5_geom_verdict_snapshot_ck') into has_bicond;
  select exists (select 1 from pg_constraint
                  where conname='n5_geom_pt_namespace_ck') into has_ptns;
  select exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                  where n.nspname='geo' and c.relname='n5_point_reject_archive') into has_archive;
  select pg_get_constraintdef(oid) into prov_ck  from pg_constraint
   where conname='n5_geom_provenance_ck';
  select attnotnull into prov_notnull from pg_attribute
   where attrelid='geo.n5_geom'::regclass and attname='provenance';
  select pg_get_constraintdef(oid) into reject_pk from pg_constraint
   where conrelid='geo.n5_point_reject'::regclass and contype='p';
  select pg_get_constraintdef(oid) into assoc_pk  from pg_constraint
   where conrelid='geo.n5_association'::regclass and contype='p';

  -- ---- objects owned by the PARALLEL session: VALIDATE, never re-create -------------------
  if prov_ck is null or prov_ck !~ 'recovered_authoritative'
                     or prov_ck !~ 'proven_stored_point' then
    raise exception 'STOP: n5_geom_provenance_ck is missing or unrecognised (%). The parallel '
      'session owns this constraint; this migration validates it and must not author it.', prov_ck;
  end if;
  if not coalesce(prov_notnull,false) then
    raise exception 'STOP: geo.n5_geom.provenance is not NOT NULL. Pre-state does not match the '
      'applied state of record.';
  end if;
  if assoc_pk is distinct from 'PRIMARY KEY (source_key, zip)' then
    raise exception 'STOP: geo.n5_association PK is % - expected PRIMARY KEY (source_key, zip), '
      'already applied by the parallel session.', assoc_pk;
  end if;

  -- ---- classify -------------------------------------------------------------------------
  if not has_vsid and not has_bicond and not has_ptns
     and reject_pk = 'PRIMARY KEY (source_key, reason)' then
    state := 'A_LEGACY';                      -- the real, measured production pre-state
  elsif has_vsid and has_bicond and has_ptns
     and reject_pk = 'PRIMARY KEY (source_key)' then
    state := 'B_ALREADY_APPLIED';             -- fully corrected already
  else
    raise exception
      'STOP: PARTIALLY MIGRATED OR UNRECOGNISED PRE-STATE. verdict_snapshot_id=%, '
      'biconditional=%, pt_namespace=%, reject_pk=%. Refusing to guess. Reconcile by hand '
      'against docs/n5-object-ownership.md. (archive present: %)',
      has_vsid, has_bicond, has_ptns, reject_pk, has_archive;
  end if;
  raise notice 'N5 pre-state classified as %', state;
end $classify$;

-- ============================================================================
-- §2  SNAPSHOT ATTRIBUTION COLUMN  (owned by #1016)
-- ============================================================================
-- Nullable with NO DEFAULT, deliberately: NULL is the correct and required value for
-- recovered_authoritative geometry, and a default would silently attribute future rows.

alter table geo.n5_geom add column if not exists verdict_snapshot_id text;

comment on column geo.n5_geom.verdict_snapshot_id is
  'The global PROVEN verdict snapshot that produced this stored point''s CURRENT state. '
  'Non-null exactly when provenance=''proven_stored_point'' (enforced by '
  'n5_geom_verdict_snapshot_ck). NULL for recovered_authoritative geometry, which comes from '
  'the publisher rather than from a verdict.';

-- ============================================================================
-- §2b  UNIQUE VERDICT DERIVATION  (B2) — a MULTIPLICITY invariant, nothing else
-- ============================================================================
-- The authoritative PROVEN derivation must yield EXACTLY ONE row per source_key. §3's gate
-- and §5's rebuild both read that derivation, and neither can detect a violation:
--
--   * §3 compares sets with EXCEPT on source_key, which DEDUPES - a source_key derived twice
--     produces zero set difference in either direction.
--   * §3's closure check (eligible + ineligible = authoritative) double-counts the duplicate
--     on BOTH sides, so it still balances.
--   * §3's coordinate check joins the duplicate rows to the one canonical point; if the two
--     derivations carry the same coordinate, it reports zero mismatches.
--   * §5's rebuild only inserts INELIGIBLE rows, so an ELIGIBLE duplicate never reaches the
--     (source_key) primary key that would otherwise have raised.
--
-- A duplicated ELIGIBLE derivation therefore clears every existing gate and commits, and is
-- only discovered later when `publish-verdict` violates n5_proven_verdict's
-- (snapshot_id, source_key) key. That is too late: canonical geometry has already been
-- attributed by then. So the multiplicity is proven DIRECTLY, here, before §3 and before any
-- attribution or destruction.
--
-- This is a multiplicity invariant ONLY. It changes no eligibility semantics: not the
-- accepted-source treatment rules, not the global coordinate rules, not
-- MULTI_COORD_UNRESOLVED or NULL_COORD, not snapshot selection, not registry eligibility,
-- not canonical geometry identity, not 'pt:1', not association identity. A violation is
-- RAISED, never deduplicated, and no coordinate is ever chosen arbitrarily.
--
-- It runs UNCONDITIONALLY - not behind §3's "are there legacy points" early return - because
-- §5's rebuild reads the same derivation whether or not legacy geometry exists. Cost is one
-- additional pass over preservation.app_project_identity, which is the correct price for
-- proving the derivation well-formed before acting on it.

do $multiplicity$
declare dup_keys bigint; derived_rows bigint; derived_keys bigint; worst text;
begin
  create temporary table _n5_derivation on commit drop as
  select distinct i.source_key, coalesce(i.registry_id,'(null)') as registry_id
    from preservation.app_project_identity i
    join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
   where a.treatment = 'PROVEN'
     and i.snapshot_id = 'phase1-2026-09-01'
     and i.record_kind = 'development';

  select count(*), count(distinct d.source_key) into derived_rows, derived_keys
    from _n5_derivation d;

  -- THE INVARIANT, stated directly: one derivation row per source_key.
  select count(*) into dup_keys from (
    select d.source_key from _n5_derivation d group by d.source_key having count(*) <> 1) t;

  if dup_keys <> 0 then
    select string_agg(x.source_key || ' x' || x.n, ', ')
      into worst
      from (select d.source_key, count(*) n from _n5_derivation d
             group by d.source_key having count(*) <> 1
             order by count(*) desc, d.source_key limit 5) x;
    raise exception 'STOP: the authoritative PROVEN derivation is not one row per source_key - '
      '% source_key(s) derive multiple rows (derived_rows=%, distinct source_keys=%). '
      'Examples: %. This is NOT deduplicated automatically and no coordinate is chosen '
      'arbitrarily: a source_key carrying more than one PROVEN registry verdict must be '
      'resolved at the source. Refusing to attribute canonical geometry.',
      dup_keys, derived_rows, derived_keys, coalesce(worst, '(none)');
  end if;
  raise notice 'MULTIPLICITY INVARIANT PASSED - % derivation rows, % distinct source_keys',
               derived_rows, derived_keys;
end $multiplicity$;

-- ============================================================================
-- §3  FAIL-CLOSED LEGACY GEOMETRY GATE
-- ============================================================================
-- The 718,278 pre-existing proven points are attributed to a snapshot IN PLACE. That is only
-- sound if they ARE that snapshot's eligible set, so this asserts it rather than assuming it.
--
-- THE GATE MUST ACCEPT THE EXPECTED LEGACY STATE. It fails only when legacy points exist AND
-- the invariants do not hold. There is no silent repair and no automatic delete/rebuild.
--
-- ⚠️ THIS GATE ALSO RE-RUNS AT APPLY TIME, BY CONSTRUCTION: it is part of the same transaction
-- as the backfill below, so it is evaluated against apply-time truth, not against the
-- design-time measurement. A parallel writer mutates these same tables (Rule #0a), and
-- Option-A attribution rests on set/coordinate identity rather than on a stamp the legacy
-- writer left on n5_geom - so the proof has to be taken again, here, immediately before the
-- write it authorises.

do $gate$
declare
  snap            text;
  n_snap          bigint;
  legacy_points   bigint;
  d_canon_elig    bigint;  d_elig_canon  bigint;
  coord_bad       bigint;  nonpoint      bigint;
  wrong_fid       bigint;  multi_geom    bigint;  rec_squat bigint;
  d_inel_rej      bigint;  d_rej_inel    bigint;  reason_bad bigint;
  elig_n          bigint;  inel_n        bigint;  auth_n     bigint;
begin
  select count(*) into legacy_points from geo.n5_geom where provenance='proven_stored_point';
  if legacy_points = 0 then
    raise notice 'no legacy proven points present - attribution gate not applicable';
    return;
  end if;

  -- The snapshot is READ FROM THE DATA, not asserted by this file. Every legacy reject row
  -- carries detail->>'snapshot'; if the corpus disagrees with itself, stop.
  select count(distinct detail->>'snapshot'), min(detail->>'snapshot')
    into n_snap, snap from geo.n5_point_reject;
  if n_snap is distinct from 1 or snap is null then
    raise exception 'STOP: legacy rejects carry % distinct snapshot values (expected exactly 1). '
      'Snapshot attribution cannot be derived from the data.', n_snap;
  end if;
  if snap <> 'phase1-2026-09-01' then
    raise exception 'STOP: legacy snapshot in data is %, not the expected phase1-2026-09-01. '
      'Re-measure before attributing.', snap;
  end if;

  -- Recompute the authoritative expectation under the CURRENT approved rules.
  create temporary table _n5_gate_v on commit drop as
  with src as (
    select i.source_key, coalesce(i.registry_id,'(null)') registry_id, i.lat, i.lng
      from preservation.app_project_identity i
     where i.snapshot_id = snap and i.record_kind = 'development'),
  verdict_reg as (select registry_id from geo.n5_accepted_source where treatment='PROVEN'),
  proven as (select distinct s.source_key, s.registry_id from src s
              where exists (select 1 from verdict_reg v where v.registry_id = s.registry_id)),
  pairs as (select distinct source_key, lat, lng from src
             where lat is not null and lng is not null),
  pc  as (select source_key, count(*) ncoord from pairs group by source_key),
  cnt as (select p.source_key, p.registry_id, coalesce(pc.ncoord,0) ncoord
            from proven p left join pc using (source_key)),
  sel as (select pr.source_key, pr.lat, pr.lng
            from pairs pr join cnt c using (source_key) where c.ncoord = 1)
  select c.source_key, c.registry_id, c.ncoord, sl.lat, sl.lng,
         case when c.ncoord > 1 then 'MULTI_COORD_UNRESOLVED'
              when c.ncoord = 0 then 'NULL_COORD'
              when sl.lat not between -90 and 90
                or sl.lng not between -180 and 180 then 'INVALID_COORD'
              when abs(sl.lat) < 1e-9 and abs(sl.lng) < 1e-9 then 'NULL_ISLAND'
              else 'ELIGIBLE' end as verdict
    from cnt c left join sel sl using (source_key);

  select count(*) into auth_n from _n5_gate_v;
  select count(*) into elig_n from _n5_gate_v where verdict='ELIGIBLE';
  select count(*) into inel_n from _n5_gate_v where verdict<>'ELIGIBLE';

  -- (1) canonical proven set == expected ELIGIBLE set, BOTH directions
  select count(*) into d_canon_elig from (
    select source_key from geo.n5_geom where provenance='proven_stored_point'
    except select source_key from _n5_gate_v where verdict='ELIGIBLE') t;
  select count(*) into d_elig_canon from (
    select source_key from _n5_gate_v where verdict='ELIGIBLE'
    except select source_key from geo.n5_geom where provenance='proven_stored_point') t;

  -- (2) coordinates equal the authoritative eligible coordinate
  select count(*) into coord_bad
    from _n5_gate_v v join geo.n5_geom g on g.source_key=v.source_key
   where v.verdict='ELIGIBLE' and g.provenance='proven_stored_point'
     and (g.geom is null or abs(ST_X(g.geom)-v.lng) > 1e-9 or abs(ST_Y(g.geom)-v.lat) > 1e-9);

  -- (3) all legacy proven rows are ST_Point; (4) all use pt:1; (5) one geometry per source_key
  select count(*) into nonpoint from geo.n5_geom
   where provenance='proven_stored_point' and (geom is null or ST_GeometryType(geom)<>'ST_Point');
  select count(*) into wrong_fid from geo.n5_geom
   where provenance='proven_stored_point' and feature_id <> 'pt:1';
  select count(*) into multi_geom from (select source_key from geo.n5_geom
     where provenance='proven_stored_point' group by 1 having count(*)>1) t;
  -- (6) no recovered geometry squats the reserved namespace
  select count(*) into rec_squat from geo.n5_geom
   where provenance='recovered_authoritative' and feature_id like 'pt:%';

  -- (7) the reject partition closes the authoritative PROVEN population
  select count(*) into d_inel_rej from (
    select source_key from _n5_gate_v where verdict<>'ELIGIBLE'
    except select source_key from geo.n5_point_reject) t;
  select count(*) into d_rej_inel from (
    select source_key from geo.n5_point_reject
    except select source_key from _n5_gate_v where verdict<>'ELIGIBLE') t;
  select count(*) into reason_bad
    from _n5_gate_v v join geo.n5_point_reject r on r.source_key=v.source_key
   where v.verdict<>'ELIGIBLE' and r.reason is distinct from v.verdict;

  raise notice 'gate: authoritative=% eligible=% ineligible=% legacy_points=%',
               auth_n, elig_n, inel_n, legacy_points;

  if d_canon_elig <> 0 or d_elig_canon <> 0 then
    raise exception 'STOP: legacy canonical proven set does not equal the expected ELIGIBLE set '
      'for % - canonical-not-eligible=%, eligible-not-canonical=%. Attribution refused.',
      snap, d_canon_elig, d_elig_canon;
  end if;
  if coord_bad <> 0 then
    raise exception 'STOP: % legacy point(s) do not carry the authoritative eligible coordinate '
      'for %. Attribution refused.', coord_bad, snap;
  end if;
  if nonpoint <> 0 or wrong_fid <> 0 or multi_geom <> 0 or rec_squat <> 0 then
    raise exception 'STOP: legacy geometry namespace violated - non-point=%, wrong feature_id=%, '
      'source_keys with >1 proven geometry=%, recovered squatting pt:*=%.',
      nonpoint, wrong_fid, multi_geom, rec_squat;
  end if;
  if d_inel_rej <> 0 or d_rej_inel <> 0 or reason_bad <> 0 then
    raise exception 'STOP: legacy reject partition does not close the authoritative PROVEN '
      'population - ineligible-not-rejected=%, rejected-not-ineligible=%, reason mismatch=%.',
      d_inel_rej, d_rej_inel, reason_bad;
  end if;
  if elig_n + inel_n <> auth_n then
    raise exception 'STOP: expected verdicts do not close on the authoritative population '
      '(% + % <> %).', elig_n, inel_n, auth_n;
  end if;
  raise notice 'GATE PASSED - legacy state is exactly the % eligible/ineligible partition', snap;
end $gate$;

-- ============================================================================
-- §4  ATTRIBUTE THE LEGACY POINTS, THEN ENFORCE THE INVARIANTS
-- ============================================================================
-- Only proven_stored_point rows are touched. recovered_authoritative rows keep NULL, which the
-- biconditional then requires of them.

update geo.n5_geom
   set verdict_snapshot_id = 'phase1-2026-09-01'
 where provenance = 'proven_stored_point'
   and verdict_snapshot_id is distinct from 'phase1-2026-09-01';

do $assert_attr$
declare bad_proven bigint; bad_rec bigint;
begin
  select count(*) into bad_proven from geo.n5_geom
   where provenance='proven_stored_point' and verdict_snapshot_id is null;
  select count(*) into bad_rec from geo.n5_geom
   where provenance='recovered_authoritative' and verdict_snapshot_id is not null;
  if bad_proven <> 0 or bad_rec <> 0 then
    raise exception 'STOP: attribution incomplete - proven with NULL snapshot=%, recovered with '
      'non-NULL snapshot=%. Refusing to add the constraint.', bad_proven, bad_rec;
  end if;
end $assert_attr$;

alter table geo.n5_geom drop constraint if exists n5_geom_verdict_snapshot_ck;
alter table geo.n5_geom add constraint n5_geom_verdict_snapshot_ck
  check ((provenance = 'proven_stored_point') = (verdict_snapshot_id is not null));

-- Reserve the 'pt:' namespace structurally. Precondition measured 0 violators in production and
-- re-asserted by the gate above; this makes it impossible going forward.
alter table geo.n5_geom drop constraint if exists n5_geom_pt_namespace_ck;
alter table geo.n5_geom add constraint n5_geom_pt_namespace_ck
  check ((provenance = 'proven_stored_point') = (feature_id = 'pt:1'));

-- ============================================================================
-- §5  POINT REJECT — ARCHIVE, PROVE THE ARCHIVE, THEN REBUILD CURRENT STATE
-- ============================================================================
-- The live table is CURRENT STATE (one row per project, replaced across snapshots). The 5,171
-- legacy rows are HISTORY and are the only durable record of the ad-hoc materialisation's
-- snapshot. So: copy them out, PROVE the copy is complete, and only then touch the original.

create table if not exists geo.n5_point_reject_archive (
  source_key           text        not null,
  registry_id          text,
  reason               text        not null,
  detail               jsonb,
  rejected_at          timestamptz not null,
  archived_snapshot_id text,                 -- lifted from detail->>'snapshot'
  archived_at          timestamptz not null default now(),
  archived_by          text        not null, -- which migration performed the archive
  constraint n5_point_reject_archive_pkey primary key (source_key, reason, rejected_at)
);
alter table geo.n5_point_reject_archive enable row level security;

comment on table geo.n5_point_reject_archive is
  'HISTORICAL point-reject receipts. Preserves the rows written by the ad-hoc PROVEN '
  'materialisation of 2026-09-02 23:50:51Z, whose `detail` is the only durable record of the '
  'snapshot that produced them (see docs/n5-applied-state-of-record.md). geo.n5_point_reject '
  'itself is CURRENT STATE ONLY - one row per project, replaced across snapshots - so history '
  'has to live here or be lost.';

-- ---------------------------------------------------------------------------
-- THE REJECT TRANSITION IS CONDITIONAL ON THE PRE-STATE, and that is load-bearing.
--
-- It ran unconditionally in the first draft of this file, and the executable suite caught what
-- that costs: on a second apply the live table holds the REBUILT current-state rows, whose
-- rejected_at is now() rather than the legacy instant. Re-archiving those grew the archive on
-- every apply (2 -> 4 -> 6 ...) and, worse, made the archive-complete gate unfalsifiable,
-- because a fresh rejected_at never collides with the legacy row it was supposed to protect.
--
-- So: archive + rebuild happen ONLY while the reject PK is still the legacy (source_key,
-- reason). Once it is (source_key), the table is already current-state and this is a no-op -
-- which is what §4 case B requires anyway.
-- ---------------------------------------------------------------------------
do $reject_transition$
declare
  pk text; live_n bigint; arch_n bigint;
  missing bigint; detail_lost bigint; ts_lost bigint;
begin
  select pg_get_constraintdef(oid) into pk from pg_constraint
   where conrelid='geo.n5_point_reject'::regclass and contype='p';

  if pk = 'PRIMARY KEY (source_key)' then
    raise notice 'reject table already transitioned to current-state shape - no-op';
    return;
  end if;

  -- ---- archive the legacy rows. Idempotent: the PK includes rejected_at, which the legacy
  -- ---- writer set once and which is never rewritten here.
  insert into geo.n5_point_reject_archive
      (source_key, registry_id, reason, detail, rejected_at, archived_snapshot_id, archived_by)
  select r.source_key, r.registry_id, r.reason, r.detail, r.rejected_at,
         r.detail->>'snapshot', 'n5-canonical-geometry-provenance'
    from geo.n5_point_reject r
  on conflict (source_key, reason, rejected_at) do nothing;

  -- ---- HARD ORDERING GATE: the destructive step below is UNREACHABLE unless the archive is
  -- ---- provably complete, with detail and rejected_at preserved row by row.
  select count(*) into live_n from geo.n5_point_reject;
  if live_n > 0 then
    select count(*) into arch_n from geo.n5_point_reject_archive;
    select count(*) into missing from (
      select source_key, reason, rejected_at from geo.n5_point_reject
      except
      select source_key, reason, rejected_at from geo.n5_point_reject_archive) t;
    select count(*) into detail_lost
      from geo.n5_point_reject r
      join geo.n5_point_reject_archive a
        on a.source_key=r.source_key and a.reason=r.reason and a.rejected_at=r.rejected_at
     where a.detail is distinct from r.detail;
    select count(*) into ts_lost
      from geo.n5_point_reject r
     where not exists (select 1 from geo.n5_point_reject_archive a
                        where a.source_key=r.source_key and a.reason=r.reason
                          and a.rejected_at = r.rejected_at);
    if missing <> 0 or detail_lost <> 0 or ts_lost <> 0 or arch_n < live_n then
      raise exception 'STOP: reject archive is NOT provably complete - live=%, archived=%, '
        'missing=%, detail lost=%, timestamp lost=%. Refusing to drop or rebuild the only '
        'durable provenance from the legacy materialisation.',
        live_n, arch_n, missing, detail_lost, ts_lost;
    end if;
    raise notice 'ARCHIVE GATE PASSED - % legacy reject row(s) preserved with detail and '
                 'rejected_at intact', live_n;
  end if;

  -- ---- explicit schema transition. NOT `create table if not exists`, which is a silent
  -- ---- no-op against the existing incompatible table and is how this was missed the first time.
  alter table geo.n5_point_reject add column if not exists lat                 double precision;
  alter table geo.n5_point_reject add column if not exists lng                 double precision;
  alter table geo.n5_point_reject add column if not exists observed_in_z3      character(3);
  alter table geo.n5_point_reject add column if not exists verdict_snapshot_id text;

  -- Current state is rebuilt from the authoritative rules below, so the historical rows leave
  -- the live table. They are archived and gated above; THIS is the destructive step.
  delete from geo.n5_point_reject;

  alter table geo.n5_point_reject drop constraint if exists n5_point_reject_pkey;
  alter table geo.n5_point_reject add constraint n5_point_reject_pkey primary key (source_key);

  -- Rebuild CURRENT-STATE rejects from the authoritative identity + registry verdict, using the
  -- same rule expression as scripts/n5_shard.py::refresh_proven_verdict_sql. The old historical
  -- table is NOT treated as though it were already current state.
  insert into geo.n5_point_reject
      (source_key, registry_id, reason, detail, lat, lng, observed_in_z3, verdict_snapshot_id)
  with src as (
    select i.source_key, coalesce(i.registry_id,'(null)') registry_id, i.lat, i.lng
      from preservation.app_project_identity i
     where i.snapshot_id = 'phase1-2026-09-01' and i.record_kind = 'development'),
  verdict_reg as (select registry_id from geo.n5_accepted_source where treatment='PROVEN'),
  proven as (select distinct s.source_key, s.registry_id from src s
              where exists (select 1 from verdict_reg v where v.registry_id = s.registry_id)),
  pairs as (select distinct source_key, lat, lng from src
             where lat is not null and lng is not null),
  pc  as (select source_key, count(*) ncoord from pairs group by source_key),
  cnt as (select p.source_key, p.registry_id, coalesce(pc.ncoord,0) ncoord
            from proven p left join pc using (source_key)),
  sel as (select pr.source_key, pr.lat, pr.lng
            from pairs pr join cnt c using (source_key) where c.ncoord = 1)
  select c.source_key, c.registry_id,
         case when c.ncoord > 1 then 'MULTI_COORD_UNRESOLVED'
              when c.ncoord = 0 then 'NULL_COORD'
              when sl.lat not between -90 and 90
                or sl.lng not between -180 and 180 then 'INVALID_COORD'
              when abs(sl.lat) < 1e-9 and abs(sl.lng) < 1e-9 then 'NULL_ISLAND'
              else 'ELIGIBLE' end,
         jsonb_build_object('snapshot','phase1-2026-09-01','distinct_coords', c.ncoord),
         sl.lat, sl.lng, null, 'phase1-2026-09-01'
    from cnt c left join sel sl using (source_key)
   where not (c.ncoord = 1
              and sl.lat between -90 and 90 and sl.lng between -180 and 180
              and not (abs(sl.lat) < 1e-9 and abs(sl.lng) < 1e-9));

  alter table geo.n5_point_reject alter column verdict_snapshot_id set not null;
end $reject_transition$;

-- The CURRENT state must reproduce the archived legacy partition exactly. It does today
-- (measured: 0 differences in both directions, 0 reason mismatches - see
-- docs/n5-applied-state-of-record.md §5). Asserting it means a silent divergence between the
-- legacy evidence and the current rules cannot pass unnoticed. Runs in BOTH state A and state
-- B, so a later apply re-proves it rather than assuming the first one still holds.
do $rebuild_gate$
declare d1 bigint; d2 bigint; rbad bigint; elig_with_reject bigint; arch_n bigint;
begin
  select count(*) into arch_n from geo.n5_point_reject_archive
   where archived_snapshot_id = 'phase1-2026-09-01';
  if arch_n = 0 then
    raise notice 'no archived legacy partition to reconcile against - skipping rebuild gate';
    return;
  end if;
  select count(*) into d1 from (
    select source_key from geo.n5_point_reject_archive
     where archived_snapshot_id = 'phase1-2026-09-01'
    except select source_key from geo.n5_point_reject) t;
  select count(*) into d2 from (
    select source_key from geo.n5_point_reject
    except select source_key from geo.n5_point_reject_archive
           where archived_snapshot_id = 'phase1-2026-09-01') t;
  select count(*) into rbad
    from geo.n5_point_reject r join geo.n5_point_reject_archive a
      on a.source_key = r.source_key and a.archived_snapshot_id = 'phase1-2026-09-01'
   where a.reason is distinct from r.reason;
  select count(*) into elig_with_reject
    from geo.n5_point_reject r join geo.n5_geom g on g.source_key = r.source_key
   where g.provenance = 'proven_stored_point';
  if d1 <> 0 or d2 <> 0 or rbad <> 0 or elig_with_reject <> 0 then
    raise exception 'STOP: current-state rejects do not reproduce the archived legacy '
      'partition - archived-not-current=%, current-not-archived=%, reason mismatch=%, '
      'canonical-point-carrying-a-reject=%.', d1, d2, rbad, elig_with_reject;
  end if;
  raise notice 'REBUILD GATE PASSED - current-state rejects reproduce the archived partition';
end $rebuild_gate$;

comment on table geo.n5_point_reject is
  'CURRENT STATE ONLY. Why a PROVEN-treatment project is NOT materialised as canonical '
  'radius-eligible geometry, one row per project (PK source_key), replaced - never accumulated - '
  'across snapshots. verdict_snapshot_id records which eligibility universe produced the current '
  'answer. HISTORY LIVES IN geo.n5_point_reject_archive; do not read this table for provenance '
  'of a past snapshot.';

-- ============================================================================
-- §6  VERDICT PUBLICATION TABLES  (owned by #1016; absent from production)
-- ============================================================================

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
  constraint n5_proven_verdict_eligible_ck check (
    verdict <> 'ELIGIBLE' or (ncoord = 1 and lat is not null and lng is not null))
);
alter table geo.n5_proven_verdict enable row level security;

create table if not exists geo.n5_verdict_manifest (
  snapshot_id           text        not null,
  state                 text        not null,
  expected_source_keys  bigint,
  verdict_rows          bigint,
  eligible_rows         bigint,
  reject_counts         jsonb,
  fingerprint           text,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  canonical_synced_at   timestamptz,
  constraint n5_verdict_manifest_pkey primary key (snapshot_id),
  constraint n5_verdict_manifest_state_ck check (state in ('BUILDING','READY','FAILED')),
  -- EVERY metric asserted NOT NULL individually BEFORE the equality: PostgreSQL ACCEPTS a CHECK
  -- that evaluates to NULL, and `verdict_rows = expected_source_keys` is NULL whenever either
  -- side is. Under `and`, a failed is-not-null yields FALSE (never NULL), so the whole
  -- conjunction is three-valued-safe.
  constraint n5_verdict_manifest_ready_ck check (
    state <> 'READY' or (completed_at          is not null
                     and expected_source_keys  is not null
                     and verdict_rows          is not null
                     and eligible_rows         is not null
                     and reject_counts         is not null
                     and fingerprint           is not null
                     and verdict_rows = expected_source_keys)),
  constraint n5_verdict_manifest_sync_ck check (
    canonical_synced_at is null or state = 'READY')
);
alter table geo.n5_verdict_manifest enable row level security;

comment on table geo.n5_verdict_manifest is
  'Publication state of the global PROVEN eligibility derivation for one frozen input snapshot. '
  'state=READY means the verdict is complete and safe to read; canonical_synced_at means the '
  'global canonical-point sweep for that snapshot has completed. A shard requires BOTH.';

comment on table geo.n5_proven_verdict is
  'PROJECT-GLOBAL eligibility verdict for PROVEN stored points, computed once per snapshot from '
  'preservation.app_project_identity. Keyed by source_key alone - NOT by z3 - so every shard '
  'reaches the identical verdict and processing order cannot change the outcome. '
  'NOT POPULATED BY THIS MIGRATION.';

create table if not exists geo.n5_association_stage (
  z3          character(3) not null,
  source_key  text         not null,
  zip         character(5) not null,
  evidence    smallint     not null,
  constraint n5_association_stage_pkey primary key (z3, source_key, zip),
  constraint n5_association_stage_evidence_ck check (evidence in (1,2,3,4))
);
alter table geo.n5_association_stage enable row level security;

comment on table geo.n5_association_stage is
  'Per-shard staging for the stage-and-swap rebuild. The PK (z3, source_key, zip) enforces the '
  'same one-class-per-pair identity as the authoritative table, so a staging run that would '
  'produce two rows for one pair fails HERE rather than corrupting production.';

-- ============================================================================
-- §6b  POST-CREATION DEFINITION VALIDATION  (B1)
-- ============================================================================
-- `create table if not exists` accepts an existing object of the right NAME whatever its
-- SHAPE. That is exactly how the reject-table defect was missed: the table already existed
-- with a different primary key and four missing columns, and the create was a silent no-op.
-- §1 classifies the PRE-state; this closes the other half by proving, AFTER the creates, that
-- each of the three lifecycle tables actually has the definition the runtime depends on.
--
-- It reads the CATALOG (pg_attribute / pg_constraint / format_type), not the text of this
-- file, so it is immune to formatting and to how Postgres chooses to print a definition.
-- Cosmetic equivalence is not required; semantic equivalence is required for every property
-- the publication pipeline relies on.
--
-- Runs in BOTH the legacy and already-corrected branches - "already applied" is a claim that
-- has to survive being checked too. An incompatible shape RAISES: no ALTER-to-repair, no
-- drop/recreate, no silent acceptance.

do $defn$
declare
  bad text := '';
  got text;
begin
  -- ---- primary keys (ordered column lists) --------------------------------------------
  for got in
    select t.tbl || ' pk=(' || coalesce(t.actual,'<none>') || ') expected=(' || t.want || ')'
      from (values
        ('geo.n5_proven_verdict',       'snapshot_id,source_key'),
        ('geo.n5_verdict_manifest',     'snapshot_id'),
        ('geo.n5_association_stage',    'z3,source_key,zip'),
        -- the table this whole finding came from: prove its FINAL shape too, not just the
        -- pre-state §1 checked. In state B the transition no-ops, so a later hand-alteration
        -- would otherwise pass unnoticed.
        ('geo.n5_point_reject',         'source_key'),
        ('geo.n5_point_reject_archive', 'source_key,reason,rejected_at')
      ) v(tbl, want)
      cross join lateral (
        select v.tbl as tbl, v.want as want,
               (select string_agg(a.attname, ',' order by k.ord)
                  from pg_constraint c
                  join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
                  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
                 where c.conrelid = to_regclass(v.tbl) and c.contype = 'p') as actual
      ) t
     where t.actual is distinct from t.want
  loop
    bad := bad || ' PK ' || got || ';';
  end loop;

  -- ---- columns: presence, type where semantics depend on it, and nullability ----------
  -- snapshot columns, verdict/eligibility columns, coordinate columns and the stage grain
  -- are all covered here; a wrong type or a wrong NOT NULL is as fatal as an absent column.
  for got in
    select w.tbl || '.' || w.col || ' expected ' || w.typ
           || case when w.nn then ' NOT NULL' else ' NULL' end
           || ' got ' || coalesce(act.typ, '<absent>')
           || case when act.typ is null then ''
                   when act.nn then ' NOT NULL' else ' NULL' end
      from (values
        -- geo.n5_proven_verdict — the eligibility record the sweep reads
        ('geo.n5_proven_verdict','snapshot_id','text',true),
        ('geo.n5_proven_verdict','source_key','text',true),
        ('geo.n5_proven_verdict','registry_id','text',false),
        ('geo.n5_proven_verdict','ncoord','integer',true),
        ('geo.n5_proven_verdict','lat','double precision',false),
        ('geo.n5_proven_verdict','lng','double precision',false),
        ('geo.n5_proven_verdict','verdict','text',true),
        ('geo.n5_proven_verdict','computed_at','timestamp with time zone',true),
        -- geo.n5_verdict_manifest — the publication state machine
        ('geo.n5_verdict_manifest','snapshot_id','text',true),
        ('geo.n5_verdict_manifest','state','text',true),
        ('geo.n5_verdict_manifest','expected_source_keys','bigint',false),
        ('geo.n5_verdict_manifest','verdict_rows','bigint',false),
        ('geo.n5_verdict_manifest','eligible_rows','bigint',false),
        ('geo.n5_verdict_manifest','reject_counts','jsonb',false),
        ('geo.n5_verdict_manifest','fingerprint','text',false),
        ('geo.n5_verdict_manifest','started_at','timestamp with time zone',true),
        ('geo.n5_verdict_manifest','completed_at','timestamp with time zone',false),
        ('geo.n5_verdict_manifest','canonical_synced_at','timestamp with time zone',false),
        -- geo.n5_association_stage — the stage-and-swap grain
        ('geo.n5_association_stage','z3','character(3)',true),
        ('geo.n5_association_stage','source_key','text',true),
        ('geo.n5_association_stage','zip','character(5)',true),
        ('geo.n5_association_stage','evidence','smallint',true),
        -- geo.n5_point_reject — the CURRENT-STATE ledger the sweep writes. These are exactly
        -- the columns whose absence the silent create-if-not-exists no-op produced.
        ('geo.n5_point_reject','source_key','text',true),
        ('geo.n5_point_reject','registry_id','text',false),
        ('geo.n5_point_reject','reason','text',true),
        ('geo.n5_point_reject','detail','jsonb',false),
        ('geo.n5_point_reject','rejected_at','timestamp with time zone',true),
        ('geo.n5_point_reject','lat','double precision',false),
        ('geo.n5_point_reject','lng','double precision',false),
        ('geo.n5_point_reject','observed_in_z3','character(3)',false),
        ('geo.n5_point_reject','verdict_snapshot_id','text',true)
      ) w(tbl, col, typ, nn)
      left join lateral (
        select format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull as nn
          from pg_attribute a
         where a.attrelid = to_regclass(w.tbl) and a.attname = w.col
           and a.attnum > 0 and not a.attisdropped
      ) act on true
     where act.typ is null
        or act.typ <> w.typ
        or act.nn is distinct from w.nn
  loop
    bad := bad || ' COLUMN ' || got || ';';
  end loop;

  -- ---- migration-critical CHECK constraints, by DEFINITION not by name alone ----------
  -- Each pattern names a semantic token the runtime depends on. Read from
  -- pg_get_constraintdef, which Postgres normalises, so this is not a formatting comparison.
  for got in
    select r.conname || ' on ' || r.tbl
             || case when d.def is null then ' ABSENT' else ' def=' || d.def end
      from (values
        ('geo.n5_proven_verdict','n5_proven_verdict_ck','MULTI_COORD_UNRESOLVED'),
        ('geo.n5_proven_verdict','n5_proven_verdict_ck','NO_REGISTRY_VERDICT'),
        ('geo.n5_proven_verdict','n5_proven_verdict_eligible_ck','ncoord'),
        ('geo.n5_verdict_manifest','n5_verdict_manifest_state_ck','BUILDING'),
        ('geo.n5_verdict_manifest','n5_verdict_manifest_ready_ck','verdict_rows'),
        ('geo.n5_verdict_manifest','n5_verdict_manifest_ready_ck','expected_source_keys'),
        ('geo.n5_verdict_manifest','n5_verdict_manifest_ready_ck','reject_counts'),
        ('geo.n5_verdict_manifest','n5_verdict_manifest_ready_ck','fingerprint'),
        ('geo.n5_verdict_manifest','n5_verdict_manifest_sync_ck','canonical_synced_at'),
        ('geo.n5_association_stage','n5_association_stage_evidence_ck','evidence'),
        -- the two structural invariants #1016 owns on canonical geometry
        ('geo.n5_geom','n5_geom_verdict_snapshot_ck','verdict_snapshot_id'),
        ('geo.n5_geom','n5_geom_pt_namespace_ck','pt:1'),
        -- and the reject reason domain, owned by the parallel session, validated here
        ('geo.n5_point_reject','n5_point_reject_reason_ck','MULTI_COORD_UNRESOLVED')
      ) r(tbl, conname, token)
      left join lateral (
        select pg_get_constraintdef(c.oid) as def
          from pg_constraint c
         where c.conrelid = to_regclass(r.tbl) and c.conname = r.conname and c.contype = 'c'
      ) d on true
     where d.def is null or position(r.token in d.def) = 0
  loop
    bad := bad || ' CHECK ' || got || ';';
  end loop;

  if bad <> '' then
    raise exception 'STOP: lifecycle-table definition validation FAILED -%. An object of the '
      'right NAME but the wrong SHAPE is exactly what `create table if not exists` conceals, '
      'which is why this reads catalog definitions rather than trusting names. Not repaired '
      'automatically: reconcile by hand against docs/n5-object-ownership.md.', bad;
  end if;
  raise notice 'DEFINITION VALIDATION PASSED - all three lifecycle tables match the contract';
end $defn$;

-- ============================================================================
-- §7  ASSOCIATION KEY — ALREADY APPLIED BY THE PARALLEL SESSION
-- ============================================================================
-- The old version of this file dropped and re-added n5_association_pkey. Production already
-- carries PRIMARY KEY (source_key, zip), applied by f7c4b79 as a create-copy-drop-rename table
-- swap. §1 asserts it. Re-dropping and re-adding an identical PK would rewrite the index for no
-- reason and would re-author an object this migration does not own.

comment on column geo.n5_association.evidence is
  'Mutable classification (1 geometry_verified / 2 legacy_unverifiable / 3 legacy_unsupported / '
  '4 unresolved). NOT part of identity - identity is (source_key, zip), one current class per '
  'pair.';

commit;
