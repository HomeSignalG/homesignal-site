-- ============================================================================
-- N5 CANONICAL GEOMETRY — VERDICT SNAPSHOT ATTRIBUTION, NAMESPACE RESERVATION,
-- POINT-REJECT ARCHIVE-AND-REBUILD, AND ASSOCIATION STAGING
-- ============================================================================
-- ⚠️ READ THIS BEFORE ANYTHING ELSE: THIS MIGRATION IS A *CORRECTION* OF A KNOWN
--    PRODUCTION STATE, NOT A GREENFIELD INSTALLER.
--
-- A PARALLEL SESSION already wrote production. Commit f7c4b79 on branch
-- claude/homesignal-zip-forensics-13xkmw applied docs/n5-provenance-and-key-migration.sql,
-- which created geo.n5_geom.provenance (+ its CHECK, + NOT NULL), created
-- geo.n5_point_reject with PK (source_key, reason), and changed the geo.n5_association
-- primary key to (source_key, zip) by table swap. Separately, AD-HOC SQL THAT EXISTS IN
-- NO REPOSITORY REF materialised 718,278 canonical `proven_stored_point` geometries and
-- 5,171 point rejects.
--
-- Those objects are therefore NOT owned by this file and MUST NOT be re-created by it.
-- The full object-by-object division of ownership, and the reconstruction of the SQL that
-- is not recoverable, is docs/n5-applied-state-of-record.md. Read it before editing here.
--
-- WHAT THIS FILE STILL OWNS
--   1. geo.n5_geom.verdict_snapshot_id            — the column, and the BACKFILL of the
--                                                   718,278 existing canonical points
--   2. n5_geom_verdict_snapshot_ck                — the biconditional
--   3. n5_geom_pt_namespace_ck                    — the pt: namespace reservation
--   4. geo.n5_point_reject_archive                — preserve the legacy reject provenance
--   5. geo.n5_point_reject                        — EXPLICIT transition to the target shape
--   6. geo.n5_proven_verdict                      — new table (absent in production)
--   7. geo.n5_verdict_manifest                    — new table (absent in production)
--   8. geo.n5_association_stage                   — new table (absent in production)
--   9. VALIDATION ONLY of everything f7c4b79 owns — never re-application
--
-- WHY THERE IS A FAIL-CLOSED GATE AND NOT A COMMENT SAYING "SHOULD BE FINE"
-- The 718,278 canonical points are attributed to verdict snapshot 'phase1-2026-09-01' by
-- a BACKFILL, and a backfill is a CLAIM about which eligibility universe produced those
-- rows. Nothing in the database records that claim today — the ad-hoc materialisation left
-- no stamp — so the ONLY thing that can justify it is set-and-coordinate identity against
-- the authoritative baseline, re-derived and re-proved at apply time. A PARALLEL WRITER IS
-- ACTIVE ON THESE SAME TABLES, so that proof cannot be a design-time argument: §6 re-runs
-- it inside this transaction, immediately before the backfill, and aborts on any deviation.
--
-- ============================================================================
-- §0  ONE TRANSACTION — this file must be applied whole or not at all
-- ============================================================================
-- Every statement below is transactional DDL in PostgreSQL. Applied statement-by-statement
-- (which is what the Supabase query endpoint does with separate calls), a failure after
-- geo.n5_point_reject is DROPPED but before the rebuilt table is renamed into its place
-- would leave production with NO reject ledger at all, and nothing to detect it.
--
-- APPLY THIS FILE AS A SINGLE STATEMENT/SCRIPT so BEGIN...COMMIT actually brackets it. If the
-- execution mechanism cannot do that, DO NOT APPLY IT: emulating atomic DDL with
-- application-side best effort is exactly the failure this guard exists to prevent. The
-- fail-closed gate and the write it guards MUST share one transaction — a transport that
-- cannot promise that is unacceptable, because the gate would then prove a state that the
-- parallel writer is free to change before the write lands.

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
-- §2  PRE-STATE CLASSIFICATION — three outcomes, and one of them is ABORT
-- ============================================================================
-- Idempotence here does NOT mean "tolerate whatever is there". `if not exists` is a
-- convenience for re-running a KNOWN state, and a liability when the state is unknown:
-- `create table if not exists geo.n5_point_reject (...target shape...)` against the legacy
-- table SILENTLY SUCCEEDS and leaves the incompatible shape in place, so the migration
-- reports success and the sweep fails later in production. That is measured, not theorised
-- (see docs/n5-applied-state-of-record.md, "the two defects the real pre-state exposes").
--
-- So the shape is classified FIRST, and every branch below reads the classification:
--
--   LEGACY    exactly the post-f7c4b79 / post-ad-hoc state. Migrate, once.
--   CORRECTED this migration already applied. Validate the definitions and change nothing.
--   anything else -> RAISE. No silent repair, no partial re-application.

do $mig$
declare
  v_snapshot   text := 'phase1-2026-09-01';
  v_prov       boolean; v_prov_nn boolean; v_prov_ck boolean;
  v_vsid       boolean; v_vsid_ck boolean; v_ptns_ck boolean;
  v_geom_pk    text;    v_assoc_pk text;   v_rej_pk   text;
  v_rej_detail boolean; v_rej_vsid boolean; v_rej_lat boolean; v_rej_obs boolean;
  v_archive    boolean;
  v_state      text;
begin
  -- The three tables f7c4b79 owns must all be present. Their absence does not mean
  -- "greenfield, go ahead" - it means production is not the database this file models.
  if to_regclass('geo.n5_geom') is null
     or to_regclass('geo.n5_point_reject') is null
     or to_regclass('geo.n5_association') is null then
    raise exception
      'STOP: N5 pre-state unrecognised. geo.n5_geom=%, geo.n5_point_reject=%, '
      'geo.n5_association=%. This migration CORRECTS the post-f7c4b79 production state; '
      'it is not a greenfield installer and will not invent the tables it expects.',
      to_regclass('geo.n5_geom'), to_regclass('geo.n5_point_reject'),
      to_regclass('geo.n5_association');
  end if;

  select
    (select exists (select 1 from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_geom' and c.column_name='provenance')),
    (select coalesce((select c.is_nullable='NO' from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_geom' and c.column_name='provenance'),
        false)),
    (select exists (select 1 from pg_constraint
        where conrelid=to_regclass('geo.n5_geom') and conname='n5_geom_provenance_ck')),
    (select exists (select 1 from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_geom'
          and c.column_name='verdict_snapshot_id')),
    (select exists (select 1 from pg_constraint
        where conrelid=to_regclass('geo.n5_geom') and conname='n5_geom_verdict_snapshot_ck')),
    (select exists (select 1 from pg_constraint
        where conrelid=to_regclass('geo.n5_geom') and conname='n5_geom_pt_namespace_ck')),
    (select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
       where c.conrelid=to_regclass('geo.n5_geom') and c.contype='p'),
    (select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
       where c.conrelid=to_regclass('geo.n5_association') and c.contype='p'),
    (select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
       where c.conrelid=to_regclass('geo.n5_point_reject') and c.contype='p'),
    (select exists (select 1 from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_point_reject'
          and c.column_name='detail')),
    (select exists (select 1 from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_point_reject'
          and c.column_name='verdict_snapshot_id')),
    (select exists (select 1 from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_point_reject'
          and c.column_name='lat')),
    (select exists (select 1 from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_point_reject'
          and c.column_name='observed_in_z3')),
    (to_regclass('geo.n5_point_reject_archive') is not null)
  into v_prov, v_prov_nn, v_prov_ck, v_vsid, v_vsid_ck, v_ptns_ck,
       v_geom_pk, v_assoc_pk, v_rej_pk, v_rej_detail, v_rej_vsid, v_rej_lat, v_rej_obs,
       v_archive;

  -- Invariants that hold in BOTH acceptable states, because f7c4b79 established them and
  -- nothing here is permitted to re-establish them. A deviation means our model of
  -- production is wrong, and the correct response to that is to stop.
  if v_geom_pk is distinct from 'source_key,feature_id' then
    raise exception 'STOP: geo.n5_geom primary key is (%), expected (source_key,feature_id). '
      'source_key is PROJECT identity and feature_id is GEOMETRY-INSTANCE identity; a '
      'different key means a different table than this migration reasons about.', v_geom_pk;
  end if;
  if not (v_prov and v_prov_nn and v_prov_ck) then
    raise exception 'STOP: geo.n5_geom.provenance is not in the shape f7c4b79 left it '
      '(present=%, not_null=%, check=%). This migration VALIDATES that column; it does not create it '
      '- see docs/n5-applied-state-of-record.md.', v_prov, v_prov_nn, v_prov_ck;
  end if;
  -- §3 of f7c4b79 already swapped this key. #1016 can only confirm it.
  if v_assoc_pk is distinct from 'source_key,zip' then
    raise exception 'STOP: geo.n5_association primary key is (%), expected (source_key,zip). '
      'f7c4b79 already corrected this key by table swap; a legacy (source_key,zip,evidence) '
      'key here means that swap did not take, and re-doing it blind is not the fix.',
      v_assoc_pk;
  end if;

  if (not v_vsid) and (not v_vsid_ck) and (not v_ptns_ck)
     and v_rej_pk = 'source_key,reason'
     and v_rej_detail and (not v_rej_vsid) and (not v_rej_lat) and (not v_rej_obs) then
    v_state := 'LEGACY';
  elsif v_vsid and v_vsid_ck and v_ptns_ck
     and v_rej_pk = 'source_key'
     and v_rej_vsid and v_rej_lat and v_rej_obs and v_rej_detail and v_archive then
    v_state := 'CORRECTED';
  else
    raise exception
      'STOP: N5 pre-state is neither the expected LEGACY state nor an already-CORRECTED '
      'one, so it is PARTIAL or UNMODELLED and this migration refuses to guess. Observed: '
      'geom.verdict_snapshot_id=%, n5_geom_verdict_snapshot_ck=%, n5_geom_pt_namespace_ck=%, '
      'reject PK=(%), reject.detail=%, reject.verdict_snapshot_id=%, reject.lat=%, '
      'reject.observed_in_z3=%, reject archive present=%. Resolve by hand; a partially '
      'applied correction must never be completed by a migration that cannot see how it '
      'got that way.',
      v_vsid, v_vsid_ck, v_ptns_ck, v_rej_pk, v_rej_detail, v_rej_vsid, v_rej_lat,
      v_rej_obs, v_archive;
  end if;

  perform set_config('n5.prestate', v_state, true);
  perform set_config('n5.snapshot', v_snapshot, true);
  raise notice 'N5 pre-state classified: % (target verdict snapshot %)', v_state, v_snapshot;
end $mig$;

-- ============================================================================
-- §3  PROVENANCE — VALIDATE THE DEFINITION, DO NOT RE-APPLY IT
-- ============================================================================
-- f7c4b79 created this column, backfilled every existing row to
-- 'recovered_authoritative', asserted zero NULLs, added the CHECK and set NOT NULL. Since
-- then the ad-hoc materialisation added 718,278 rows carrying 'proven_stored_point'.
--
-- RE-RUNNING f7c4b79's BACKFILL HERE WOULD BE A LOADED GUN: `update geo.n5_geom set
-- provenance='recovered_authoritative' where provenance is null` is harmless only because
-- the column is already NOT NULL. If a future edit reordered that statement ahead of the
-- NOT NULL, it would relabel canonical PROVEN geometry as publisher geometry and silently
-- widen every radius read. §2 has already proved the column's shape; nothing is written.
-- The definition this file validates, and will not recreate, is:
--   check (provenance in ('recovered_authoritative','proven_stored_point'))

comment on column geo.n5_geom.provenance is
  'How this geometry instance became radius-eligible. recovered_authoritative = fetched from '
  'the publisher for a RECOVERY-treatment project. proven_stored_point = the fidelity-proven '
  'stored coordinate of a PROVEN-treatment project, admitted at INSERTION through the registry '
  'verdict + per-project sanity gate. Allowlist + NOT NULL + no DEFAULT: an unrecognised or '
  'absent provenance cannot be written, so it can never become radius-eligible by default. '
  'CREATED BY f7c4b79, NOT by docs/n5-canonical-geometry-provenance.sql.';

-- ============================================================================
-- §4  verdict_snapshot_id — ADD THE COLUMN (nullable, unconstrained, for now)
-- ============================================================================
-- Which GLOBAL verdict snapshot produced a stored point's CURRENT state. Without this there
-- is no way to prove which eligibility universe a pt:1 came from, and the S1->S2 sweep has
-- nothing to target. NULL for recovered geometry: a recovered feature comes from the
-- publisher, not from a verdict.
--
-- The column is added BEFORE the gate and the biconditional is added AFTER the backfill, in
-- that order, deliberately. Adding the constraint first is precisely the defect measured
-- against the real pre-state: 718,278 existing 'proven_stored_point' rows have no
-- verdict_snapshot_id, so the biconditional is violated at creation and the whole
-- transaction rolls back.

alter table geo.n5_geom add column if not exists verdict_snapshot_id text;

comment on column geo.n5_geom.verdict_snapshot_id is
  'The global PROVEN verdict snapshot that produced this stored point''s CURRENT state. '
  'Non-null exactly when provenance=''proven_stored_point'' (enforced). Refreshed together '
  'with geom whenever the canonical sweep republishes the point under a newer snapshot.';

-- ============================================================================
-- §5  THE AUTHORITATIVE EXPECTATION — re-derived here, never taken on trust
-- ============================================================================
-- The gate in §6 compares canonical geometry against the CURRENT-RULE eligibility of the
-- authoritative frozen baseline. That expectation is derived HERE, by the same relation
-- scripts/n5_shard.py::refresh_proven_verdict_sql() uses, so the gate cannot pass against a
-- stale or differently-derived idea of what "eligible" means:
--
--   * source: preservation.app_project_identity, snapshot-filtered, record_kind='development'
--   * PROVEN population: registry_id joined to geo.n5_accepted_source, treatment='PROVEN'
--   * ncoord: DISTINCT OBSERVED (lat,lng) pairs, both non-null ON THE SAME ROW, so a
--     latitude from one row can never be paired with a longitude from another
--   * ELIGIBLE: ncoord=1, in range, and not null island
--
-- TEMPORARY and ON COMMIT DROP: this is apply-time scaffolding, and it must not survive into
-- production as a table nobody owns. geo.n5_proven_verdict is NOT populated by this file.

do $mig$
begin
  if current_setting('n5.prestate', true) <> 'LEGACY' then
    raise notice 'pre-state is %, skipping the legacy expectation build',
                 current_setting('n5.prestate', true);
    return;
  end if;

  execute format($q$
    create temporary table _n5_expected_verdict on commit drop as
    with src as (
      select i.source_key, coalesce(i.registry_id,'(null)') registry_id, i.lat, i.lng
        from preservation.app_project_identity i
       where i.snapshot_id=%L and i.record_kind='development'),
    verdict_reg as (select registry_id from geo.n5_accepted_source where treatment='PROVEN'),
    proven as (select distinct s.source_key, s.registry_id from src s
                where exists (select 1 from verdict_reg v where v.registry_id=s.registry_id)),
    pairs as (select distinct source_key, lat, lng from src
               where lat is not null and lng is not null),
    cnt as (select p.source_key,
                   (select count(*) from pairs q where q.source_key=p.source_key) ncoord
              from proven p),
    sel as (select pr.source_key, pr.lat, pr.lng
              from pairs pr join cnt c on c.source_key=pr.source_key and c.ncoord=1)
    select p.source_key, p.registry_id, c.ncoord, sl.lat, sl.lng,
           case when c.ncoord > 1                              then 'MULTI_COORD_UNRESOLVED'
                when c.ncoord = 0                              then 'NULL_COORD'
                when sl.lat not between -90 and 90
                  or sl.lng not between -180 and 180           then 'INVALID_COORD'
                when abs(sl.lat) < 1e-9 and abs(sl.lng) < 1e-9 then 'NULL_ISLAND'
                else 'ELIGIBLE' end as verdict
      from proven p join cnt c using (source_key) left join sel sl using (source_key)
  $q$, current_setting('n5.snapshot', true));

  create index on _n5_expected_verdict (source_key);
end $mig$;

-- ============================================================================
-- §6  THE FAIL-CLOSED LEGACY GEOMETRY GATE
-- ============================================================================
-- ACCEPT THE EXPECTED LEGACY STATE. The presence of legacy PROVEN points is NOT an error -
-- it is the whole reason this migration exists, and failing on it would make the corrected
-- migration unappliable for the same reason the uncorrected one was. What is an error is
-- legacy PROVEN points whose invariants do not hold, because the backfill in §7 attributes
-- them to a snapshot on the strength of exactly those invariants.
--
-- THIS GATE IS NOT DESIGN-TIME-ONLY. Attribution rests on set and coordinate identity, not
-- on a stamp the ad-hoc run left behind (it left none). A parallel writer mutates these same
-- tables. So the proof has to be taken in the same transaction as the write it justifies,
-- which is what this block is, and re-taken at production apply time - it is not a receipt
-- from an earlier session.
--
-- EVERY failure raises. There is NO silent normalisation and NO automatic repair: a
-- mismatch means the canonical corpus and the authoritative baseline disagree, and choosing
-- a winner is a founder decision, not a migration's.

do $mig$
declare
  v_snap      text := current_setting('n5.snapshot', true);
  n_dup_key   bigint; n_proven bigint; n_elig bigint;
  n_canon     bigint; n_canon_keys bigint;
  n_e_not_c   bigint; n_c_not_e bigint; n_coord bigint;
  n_notpoint  bigint; n_badsrid bigint; n_badfid bigint;
  n_squat     bigint;
  n_rej       bigint; n_i_not_r bigint; n_r_not_i bigint; n_reason bigint; n_rej_elig bigint;
  n_snapattr  bigint; n_snapnull bigint;
begin
  if current_setting('n5.prestate', true) <> 'LEGACY' then
    raise notice 'pre-state is CORRECTED; the legacy geometry gate does not apply';
    return;
  end if;

  -- 0. The expectation itself must be well formed: one verdict per project. A source_key
  --    carrying two PROVEN registry_ids would make "the" eligible coordinate ambiguous and
  --    would violate geo.n5_proven_verdict's own (snapshot_id, source_key) key later.
  select count(*) into n_dup_key from (
    select source_key from _n5_expected_verdict group by 1 having count(*) > 1) t;
  if n_dup_key <> 0 then
    raise exception 'STOP: % source_key(s) derive more than one PROVEN verdict row for '
      'snapshot %. The authoritative baseline is ambiguous; resolve it before attributing '
      'any canonical geometry to it.', n_dup_key, v_snap;
  end if;

  select count(*) filter (where true),
         count(*) filter (where verdict='ELIGIBLE')
    into n_proven, n_elig from _n5_expected_verdict;

  select count(*), count(distinct source_key) into n_canon, n_canon_keys
    from geo.n5_geom where provenance='proven_stored_point';

  -- 1. SET EQUALITY, BOTH DIRECTIONS. One direction passes while canonical geometry still
  --    holds points the current rule rejects.
  select (select count(*) from (
            select source_key from _n5_expected_verdict where verdict='ELIGIBLE'
            except
            select source_key from geo.n5_geom where provenance='proven_stored_point') t),
         (select count(*) from (
            select source_key from geo.n5_geom where provenance='proven_stored_point'
            except
            select source_key from _n5_expected_verdict where verdict='ELIGIBLE') t)
    into n_e_not_c, n_c_not_e;

  -- 2. COORDINATE EQUALITY against the authoritative eligible pair, and the SRID the whole
  --    corpus is stored in. A point at the right key with the wrong coordinate is worse
  --    than a missing point: it reads as authoritative.
  select count(*) into n_coord
    from _n5_expected_verdict e
    join geo.n5_geom g on g.source_key=e.source_key and g.provenance='proven_stored_point'
   where e.verdict='ELIGIBLE'
     and (g.geom is null
          or abs(ST_X(g.geom) - e.lng) > 1e-9
          or abs(ST_Y(g.geom) - e.lat) > 1e-9);

  -- 3. GEOMETRY TYPE and SRID.
  select count(*) filter (where GeometryType(geom) is distinct from 'POINT'),
         count(*) filter (where ST_SRID(geom) is distinct from 4269)
    into n_notpoint, n_badsrid
    from geo.n5_geom where provenance='proven_stored_point';

  -- 4. NAMESPACE. Every canonical point is exactly 'pt:1' - pt:2+ is reserved and undefined.
  select count(*) into n_badfid
    from geo.n5_geom where provenance='proven_stored_point' and feature_id is distinct from 'pt:1';

  -- 5. No recovered row squatting the reserved namespace. Until now this was only OBSERVED
  --    (0 of 8,626); observation is not a guarantee, which is why §8 makes it structural.
  select count(*) into n_squat
    from geo.n5_geom where provenance='recovered_authoritative' and feature_id like 'pt:%';

  -- 6. THE REJECT PARTITION MUST CLOSE THE AUTHORITATIVE PROVEN POPULATION.
  --    Production receipt (4027754, founder-verified): 718,278 + 4,877 + 294 = 723,449,
  --    "closing exactly". If it does not close, the canonical set is not the eligible set
  --    complement and the whole attribution argument collapses.
  select count(*) into n_rej from geo.n5_point_reject;
  select (select count(*) from (
            select source_key from _n5_expected_verdict where verdict<>'ELIGIBLE'
            except select source_key from geo.n5_point_reject) t),
         (select count(*) from (
            select source_key from geo.n5_point_reject
            except select source_key from _n5_expected_verdict where verdict<>'ELIGIBLE') t),
         (select count(*) from geo.n5_point_reject r
            join _n5_expected_verdict e on e.source_key=r.source_key
           where r.reason is distinct from e.verdict),
         (select count(*) from geo.n5_point_reject r
            join _n5_expected_verdict e on e.source_key=r.source_key
           where e.verdict='ELIGIBLE')
    into n_i_not_r, n_r_not_i, n_reason, n_rej_elig;

  -- 7. SNAPSHOT ATTRIBUTION. The legacy reject `detail` is the ONLY durable statement of
  --    which snapshot the ad-hoc run used. If it does not uniformly name the snapshot this
  --    migration is about to stamp onto 718,278 geometry rows, the stamp is a guess.
  select count(*) filter (where detail->>'snapshot' is distinct from v_snap),
         count(*) filter (where detail is null or detail->>'snapshot' is null)
    into n_snapattr, n_snapnull from geo.n5_point_reject;

  if n_e_not_c <> 0 or n_c_not_e <> 0 or n_coord <> 0
     or n_notpoint <> 0 or n_badsrid <> 0 or n_badfid <> 0 or n_squat <> 0
     or n_canon <> n_canon_keys
     or n_i_not_r <> 0 or n_r_not_i <> 0 or n_reason <> 0 or n_rej_elig <> 0
     or n_canon + n_rej <> n_proven
     or n_snapattr <> 0 or n_snapnull <> 0 then
    raise exception
      E'STOP: the legacy canonical state does NOT satisfy the invariants that would justify '
      'attributing it to verdict snapshot %.\n'
      '  eligible_not_canonical      = %   (must be 0)\n'
      '  canonical_not_eligible      = %   (must be 0)\n'
      '  coordinate_mismatch         = %   (must be 0)\n'
      '  non_point_geometry          = %   (must be 0)\n'
      '  wrong_srid                  = %   (must be 0)\n'
      '  wrong_feature_id            = %   (must be 0, canonical is exactly pt:1)\n'
      '  recovered_squatting_pt      = %   (must be 0)\n'
      '  canonical_rows / keys       = % / %  (must be equal: one PROVEN geometry per project)\n'
      '  ineligible_not_rejected     = %   (must be 0)\n'
      '  rejected_not_ineligible     = %   (must be 0)\n'
      '  reject_reason_mismatch      = %   (must be 0)\n'
      '  eligible_carrying_a_reject  = %   (must be 0)\n'
      '  canonical + rejects         = % + % = %, PROVEN population = %  (must close)\n'
      '  reject_snapshot_mismatch    = %   (must be 0)\n'
      '  reject_snapshot_absent      = %   (must be 0)\n'
      'NOTHING HAS BEEN WRITTEN and this transaction is aborting. This is not repairable '
      'by a migration: the canonical corpus and the authoritative baseline disagree, and '
      'deciding which one is right is a founder decision.',
      v_snap, n_e_not_c, n_c_not_e, n_coord, n_notpoint, n_badsrid, n_badfid, n_squat,
      n_canon, n_canon_keys, n_i_not_r, n_r_not_i, n_reason, n_rej_elig,
      n_canon, n_rej, n_canon + n_rej, n_proven, n_snapattr, n_snapnull;
  end if;

  raise notice 'legacy geometry gate PASSED: % canonical points = % eligible; % rejects close '
               'the % PROVEN population under snapshot %',
               n_canon, n_elig, n_rej, n_proven, v_snap;
end $mig$;

-- ============================================================================
-- §7  BACKFILL — proven_stored_point ONLY, and only what the gate just proved
-- ============================================================================
-- recovered_authoritative is left NULL, deliberately and permanently: a publisher feature
-- does not come from a verdict, so giving it one would be a fabricated provenance claim in
-- the column that exists to prevent exactly that.
--
-- `verdict_snapshot_id is null` scopes the write so a re-run touches nothing, and so a point
-- already republished under a NEWER snapshot by the canonical sweep is never dragged
-- backwards to phase1.

update geo.n5_geom
   set verdict_snapshot_id = current_setting('n5.snapshot', true)
 where provenance = 'proven_stored_point'
   and verdict_snapshot_id is null;

do $mig$
declare n_prov_null bigint; n_rec_set bigint;
begin
  select count(*) into n_prov_null from geo.n5_geom
   where provenance='proven_stored_point' and verdict_snapshot_id is null;
  select count(*) into n_rec_set from geo.n5_geom
   where provenance='recovered_authoritative' and verdict_snapshot_id is not null;
  if n_prov_null <> 0 or n_rec_set <> 0 then
    raise exception 'STOP: backfill did not close - % proven rows still NULL, % recovered '
      'rows carry a verdict snapshot they must never have.', n_prov_null, n_rec_set;
  end if;
end $mig$;

-- ============================================================================
-- §8  THE TWO STRUCTURAL CONSTRAINTS #1016 OWNS
-- ============================================================================
-- Added AFTER the backfill, so they are enforced against a corpus already proved to satisfy
-- them. `drop constraint if exists` then `add constraint` is not sloppiness: it guarantees
-- the resulting DEFINITION rather than accepting whatever an object of that name happens to
-- say, which is the §2 lesson applied to constraints.

alter table geo.n5_geom drop constraint if exists n5_geom_verdict_snapshot_ck;
alter table geo.n5_geom add constraint n5_geom_verdict_snapshot_ck
  check ((provenance = 'proven_stored_point') = (verdict_snapshot_id is not null));

-- Structurally reserve the 'pt:' namespace. Until now it was only OBSERVED that publisher
-- feature ids do not start 'pt:' (0 of 8,626). Observation is not a guarantee, so the
-- biconditional is enforced: a proven stored point is EXACTLY 'pt:1', and no recovered row
-- may squat the reserved namespace. 'pt:2'+ stays undefined and is therefore prohibited.
alter table geo.n5_geom drop constraint if exists n5_geom_pt_namespace_ck;
alter table geo.n5_geom add constraint n5_geom_pt_namespace_ck
  check ((provenance = 'proven_stored_point') = (feature_id = 'pt:1'));

-- ============================================================================
-- §9  ASSOCIATION KEY — ALREADY CORRECT, VALIDATED IN §2, NOT TOUCHED HERE
-- ============================================================================
-- geo.n5_association was keyed (source_key, zip, evidence), which makes a CLASSIFICATION
-- part of IDENTITY. evidence is mutable state: one (source_key, zip) has exactly one current
-- evidence class, assigned by a single CASE in build_associations. Under the old key a pair
-- reclassified 2 -> 1 INSERTS A SECOND ROW instead of replacing, and the pair then appears in
-- both the refuted and the verified class - corrupting v1..v4, the association total, and the
-- derived refutation rate simultaneously.
--
-- f7c4b79 ALREADY CORRECTED IT, by table swap. This file therefore owns no DDL here. It
-- would be actively harmful to re-issue `drop constraint if exists n5_association_pkey; add
-- constraint ... primary key (source_key, zip)`: on a 723k-row table that rebuilds the index
-- under an ACCESS EXCLUSIVE lock to reach a state already reached, and it would MASK the one
-- condition worth knowing about - a key that is NOT (source_key, zip), which §2 raises on.

comment on column geo.n5_association.evidence is
  'Mutable classification (1 geometry_verified / 2 legacy_unverifiable / 3 legacy_unsupported / '
  '4 unresolved). NOT part of identity - identity is (source_key, zip), one current class per '
  'pair. The key was corrected by f7c4b79, not by this file.';

-- ============================================================================
-- §10  POINT REJECT — ARCHIVE, PROVE THE ARCHIVE, *THEN* REBUILD
-- ============================================================================
-- The 5,171-row legacy reject table is the ONLY durable provenance the ad-hoc materialisation
-- produced: its `detail` payload carries the snapshot attribution and the observed
-- multi-coordinate count, and the SQL that wrote it exists in no ref
-- (`git log --all -S"distinct_coords"` = 0 commits). #1016's target shape has NO `detail`
-- column at all, so a naive rebuild DESTROYS it - permanently, with no way to recover it.
--
-- Hence: archive first, PROVE the archive is complete, and only then let the destructive step
-- become reachable. The ordering is enforced by the transaction, not by comment order: the
-- `drop table` lives AFTER a gate that raises, so it cannot execute unless the only durable
-- provenance is already safely copied.
--
-- And the rebuild is an EXPLICIT SCHEMA TRANSITION, never
-- `create table if not exists ...target shape...` against the incompatible table - that is
-- measured to succeed silently and leave the legacy shape in place.

create table if not exists geo.n5_point_reject_archive (
  archive_id           bigint generated always as identity,
  archived_at          timestamptz not null default now(),
  archive_reason       text        not null,
  source_key           text        not null,
  registry_id          text,
  reason               text        not null,
  detail               jsonb,
  rejected_at          timestamptz,
  snapshot_attribution text,
  -- The legacy key IS (source_key, reason), so carrying it here makes the archive insert
  -- idempotent by construction: `on conflict do nothing` can never duplicate a legacy row,
  -- however many times this migration is re-run.
  constraint n5_point_reject_archive_pkey primary key (source_key, reason),
  constraint n5_point_reject_archive_id_key unique (archive_id)
);

comment on table geo.n5_point_reject_archive is
  'IMMUTABLE PROVENANCE ARCHIVE. Verbatim copy of geo.n5_point_reject as the legacy ad-hoc '
  'materialisation left it, taken before that table was rebuilt to its current-state shape. '
  'It exists because the legacy `detail` payload is the only durable record of that run and '
  'the SQL which produced it is committed in no repository ref. NEVER truncated, never '
  'rebuilt, and not a current-state table - read geo.n5_point_reject for current answers.';

do $mig$
declare
  v_snap    text := current_setting('n5.snapshot', true);
  n_live    bigint; n_arch bigint; n_mismatch bigint;
  n_new     bigint; n_expected bigint; n_detail_lost bigint; n_reason_bad bigint;
  n_elig_rej bigint;
begin
  if current_setting('n5.prestate', true) <> 'LEGACY' then
    -- CORRECTED: validate and change nothing. `if not exists` already made the archive a
    -- no-op above; the rest of this block is destructive and must not be reachable.
    if to_regclass('geo.n5_point_reject_archive') is null
       or (select count(*) from geo.n5_point_reject_archive) = 0 then
      raise exception 'STOP: pre-state classified CORRECTED, but the reject archive is '
        'absent or empty. A corrected database must still be able to show where the legacy '
        'provenance went.';
    end if;
    raise notice 'pre-state is CORRECTED; reject ledger validated, nothing rebuilt';
    return;
  end if;

  -- ---- 1. ARCHIVE, verbatim.
  insert into geo.n5_point_reject_archive
    (archive_reason, source_key, registry_id, reason, detail, rejected_at, snapshot_attribution)
  select 'PRE-#1016 LEGACY AD-HOC MATERIALISATION',
         l.source_key, l.registry_id, l.reason, l.detail, l.rejected_at,
         l.detail->>'snapshot'
    from geo.n5_point_reject l
  on conflict (source_key, reason) do nothing;

  -- ---- 2. THE HARD ORDERING GATE. Everything below this is destructive.
  --         Not "count matches" alone - EVERY live row must have a field-for-field archive
  --         counterpart, because a count can match while a payload was silently dropped.
  select count(*) into n_live from geo.n5_point_reject;
  select count(*) into n_arch from geo.n5_point_reject_archive
   where archive_reason = 'PRE-#1016 LEGACY AD-HOC MATERIALISATION';
  select count(*) into n_mismatch
    from geo.n5_point_reject l
   where not exists (
     select 1 from geo.n5_point_reject_archive a
      where a.source_key = l.source_key
        and a.reason      = l.reason
        and a.detail      is not distinct from l.detail
        and a.rejected_at is not distinct from l.rejected_at
        and a.registry_id is not distinct from l.registry_id);

  if n_live <> n_arch or n_mismatch <> 0 then
    raise exception
      'STOP: the reject archive is NOT provably complete - live=%, archived=%, rows whose '
      'detail/rejected_at/registry_id did not round-trip=%. The rebuild is DESTRUCTIVE and '
      'the legacy `detail` payload exists in no repository ref, so it is unrecoverable once '
      'dropped. Refusing to make the destructive step reachable.',
      n_live, n_arch, n_mismatch;
  end if;
  raise notice 'reject archive proved complete: % of % rows, 0 field mismatches',
               n_arch, n_live;

  -- ---- 3. EXPLICIT SCHEMA TRANSITION to the current-state shape.
  --         `detail` is RETAINED, against #1016's original target shape which omitted it:
  --         dropping the one column that records why the legacy run reached its answer, in
  --         the table whose entire job is recording why, is not a simplification.
  execute $q$
    create table geo.n5_point_reject_new (
      source_key           text        not null,
      registry_id          text,
      lat                  double precision,
      lng                  double precision,
      reason               text        not null,
      observed_in_z3       character(3),
      detail               jsonb,
      rejected_at          timestamptz not null default now(),
      verdict_snapshot_id  text        not null,
      constraint n5_point_reject_new_pkey primary key (source_key),
      constraint n5_point_reject_new_reason_ck check (reason in (
        'NO_REGISTRY_VERDICT','NULL_COORD','NULL_ISLAND',
        'OUTSIDE_JURISDICTION','INVALID_COORD','MULTI_COORD_UNRESOLVED'))
    )
  $q$;
  execute 'alter table geo.n5_point_reject_new enable row level security';

  -- CURRENT STATE is rebuilt from the AUTHORITATIVE snapshot/verdict semantics, not copied
  -- from the legacy rows - the legacy table is provenance, not truth. lat/lng follow the
  -- sweep's own rule: present only where exactly one coordinate pair was observed (so
  -- INVALID_COORD / NULL_ISLAND carry one and MULTI/NULL_COORD carry none). observed_in_z3
  -- is NULL because no shard has observed these projects yet - it is "seen during" metadata,
  -- and inventing a z3 here would fabricate processing provenance.
  insert into geo.n5_point_reject_new
    (source_key, registry_id, lat, lng, reason, observed_in_z3, detail, rejected_at,
     verdict_snapshot_id)
  select e.source_key, e.registry_id, e.lat, e.lng, e.verdict, null,
         a.detail, coalesce(a.rejected_at, now()), v_snap
    from _n5_expected_verdict e
    left join geo.n5_point_reject_archive a
           on a.source_key = e.source_key and a.reason = e.verdict
   where e.verdict <> 'ELIGIBLE';

  -- ---- 4. POST-CONDITIONS, before the swap is allowed to stand.
  select count(*) into n_new from geo.n5_point_reject_new;
  select count(*) into n_expected from _n5_expected_verdict where verdict <> 'ELIGIBLE';
  select count(*) into n_detail_lost
    from geo.n5_point_reject l
    left join geo.n5_point_reject_new n
           on n.source_key = l.source_key and n.reason = l.reason
   where n.source_key is null or n.detail is distinct from l.detail;
  select count(*) into n_reason_bad
    from geo.n5_point_reject_new n
    join _n5_expected_verdict e on e.source_key = n.source_key
   where n.reason is distinct from e.verdict or n.verdict_snapshot_id is distinct from v_snap;
  select count(*) into n_elig_rej
    from geo.n5_point_reject_new n
    join _n5_expected_verdict e on e.source_key = n.source_key
   where e.verdict = 'ELIGIBLE';

  if n_new <> n_expected or n_new <> n_live or n_detail_lost <> 0
     or n_reason_bad <> 0 or n_elig_rej <> 0 then
    raise exception
      'STOP: the rebuilt reject ledger does not reconcile - rebuilt=%, expected ineligible=%, '
      'legacy live=%, legacy rows whose detail did not carry across=%, reason/snapshot '
      'mismatches=%, ELIGIBLE projects carrying a reject=%.',
      n_new, n_expected, n_live, n_detail_lost, n_reason_bad, n_elig_rej;
  end if;

  -- ---- 5. THE SWAP. Reachable only because every gate above passed.
  execute 'drop table geo.n5_point_reject';
  execute 'alter table geo.n5_point_reject_new rename to n5_point_reject';
  -- `alter table ... rename constraint` renames the backing index with it, so the PK index
  -- does not keep the _new name.
  execute 'alter table geo.n5_point_reject
             rename constraint n5_point_reject_new_pkey to n5_point_reject_pkey';
  execute 'alter table geo.n5_point_reject
             rename constraint n5_point_reject_new_reason_ck to n5_point_reject_reason_ck';

  raise notice 'reject ledger rebuilt: % current rows, % archived, detail preserved',
               n_new, n_arch;
end $mig$;

comment on table geo.n5_point_reject is
  'CURRENT STATE. Why a PROVEN-treatment project was NOT materialised into canonical '
  'radius-eligible geometry. The PK is (source_key) ALONE - project-global, so one project '
  'has exactly one CURRENT reason rather than one contradictory reason per z3. z3 is demoted '
  'to the diagnostic column observed_in_z3. Failures are recorded, never silently dropped. '
  'The pre-#1016 rows, and the legacy `detail` payload of the ad-hoc materialisation, are '
  'preserved verbatim in geo.n5_point_reject_archive.';

-- OUTSIDE_JURISDICTION stays in the vocabulary but is RESERVED and UNUSED in v1.
-- Jurisdiction validation is reserved until an authoritative project-level jurisdiction field
-- or boundary is available. ZIP-page materialization is NOT jurisdiction evidence and MUST NOT
-- be used as a substitute: preservation.app_project_identity.zip is the ZIP PAGE a project was
-- materialized onto (up to 217 per project), not an address ZIP. v1 never emits this reason.

-- ============================================================================
-- §11  PROJECT-GLOBAL PROVEN VERDICT  (required: the alternative is a full scan per shard)
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
--
-- ABSENT IN PRODUCTION, so this file genuinely creates it. Every `if not exists` below is
-- followed by a definition check in §14, because §2's lesson applies to these tables too.

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

-- ============================================================================
-- §12  VERDICT PUBLICATION + CANONICAL SYNCHRONIZATION STATE
-- ============================================================================
-- Deliberately NOT folded into geo.n5_snapshot. That table records the existence and shape of
-- a frozen INPUT baseline; this one records whether the global PROVEN eligibility derivation
-- OVER that baseline is complete and consumable. Different facts, different lifecycles.
--
-- TWO gates, because READY and "canonical geometry has been swept" are different claims:
--   state='READY'            -> the verdict is complete and safe to READ.
--   canonical_synced_at set  -> the global S1->S2 canonical point sweep for this snapshot has
--                               finished, so shards may consume it.
-- Overloading READY to mean both would let a shard run against a verdict whose canonical
-- corpus still holds the previous snapshot's points.
--
-- OPERATIONAL NOTE (evidence, do not act on it here): geo.n5_snapshot currently carries a
-- second row, 'n5-2026-09-02T173042Z', which has NO rows in preservation.app_project_identity
-- and is referenced by no shard. Status: ORPHAN / INPUT BASELINE ABSENT / NOT CONSUMABLE.
-- It is preserved as evidence until its provenance is separately resolved; it must never be
-- selected as a run snapshot.

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
  -- Completeness must have been RECORDED, not merely claimed, before READY.
  --
  -- EVERY metric is asserted NOT NULL individually before the equality is evaluated. This is
  -- not belt-and-braces: PostgreSQL ACCEPTS a CHECK that evaluates to NULL, and
  -- `verdict_rows = expected_source_keys` is NULL whenever either side is NULL. The previous
  -- form therefore admitted state='READY' with verdict_rows NULL - a snapshot claiming
  -- completeness while recording none. Under `and`, a failed is-not-null yields FALSE (never
  -- NULL), so the whole conjunction is three-valued-safe: it is TRUE or FALSE, never NULL.
  constraint n5_verdict_manifest_ready_ck check (
    state <> 'READY' or (completed_at          is not null
                     and expected_source_keys  is not null
                     and verdict_rows          is not null
                     and eligible_rows         is not null
                     and reject_counts         is not null
                     and fingerprint           is not null
                     and verdict_rows = expected_source_keys)),
  -- Canonical synchronization is only meaningful for a READY verdict.
  constraint n5_verdict_manifest_sync_ck check (
    canonical_synced_at is null or state = 'READY')
);

comment on table geo.n5_verdict_manifest is
  'Publication state of the global PROVEN eligibility derivation for one frozen input '
  'snapshot. state=READY means the verdict is complete and safe to read; canonical_synced_at '
  'means the global canonical-point sweep for that snapshot has completed. A shard requires '
  'BOTH before it may consume the snapshot.';

comment on table geo.n5_proven_verdict is
  'PROJECT-GLOBAL eligibility verdict for PROVEN stored points, computed once per snapshot from '
  'preservation.app_project_identity (the authoritative frozen identity baseline that yields '
  '723,449 PROVEN source_keys). Keyed by source_key alone - NOT by z3 - so every shard reaches '
  'the identical verdict and processing order cannot change the outcome. Multi-coordinate is a '
  'GLOBAL condition: shard A can no longer materialize a point that shard B would later '
  'discover to be multi-coordinate. NOT POPULATED BY THIS MIGRATION.';

-- ============================================================================
-- §13  ASSOCIATION STAGING  (stage-and-swap rebuild)
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

-- ============================================================================
-- §14  FINAL VALIDATION — every object this file claims, checked by DEFINITION
-- ============================================================================
-- The closing half of §2's contract. `create table if not exists` accepts an existing object
-- of the right NAME whatever its SHAPE, so an object created by some earlier partial attempt
-- would otherwise pass silently and fail at runtime. Each expected key and column is
-- verified, and this runs in BOTH the LEGACY and CORRECTED branches - "already applied" is a
-- claim that has to survive being checked too.

do $mig$
declare
  v_missing text := '';
  procedure_note text;
begin
  if (select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
       where c.conrelid=to_regclass('geo.n5_point_reject') and c.contype='p')
     is distinct from 'source_key' then
    v_missing := v_missing || ' n5_point_reject.pk<>(source_key);';
  end if;

  if (select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
       where c.conrelid=to_regclass('geo.n5_proven_verdict') and c.contype='p')
     is distinct from 'snapshot_id,source_key' then
    v_missing := v_missing || ' n5_proven_verdict.pk<>(snapshot_id,source_key);';
  end if;

  if (select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
       where c.conrelid=to_regclass('geo.n5_association_stage') and c.contype='p')
     is distinct from 'z3,source_key,zip' then
    v_missing := v_missing || ' n5_association_stage.pk<>(z3,source_key,zip);';
  end if;

  if (select string_agg(a.attname, ',' order by k.ord) from pg_constraint c
        join lateral unnest(c.conkey) with ordinality k(attnum, ord) on true
        join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attnum
       where c.conrelid=to_regclass('geo.n5_verdict_manifest') and c.contype='p')
     is distinct from 'snapshot_id' then
    v_missing := v_missing || ' n5_verdict_manifest.pk<>(snapshot_id);';
  end if;

  -- The columns the sweep in scripts/n5_shard.py actually writes. A missing one here is the
  -- runtime failure that the silent create-if-not-exists no-op produced.
  select string_agg(want, ',') into procedure_note from (
    select want from (values ('lat'),('lng'),('observed_in_z3'),('verdict_snapshot_id'),
                             ('detail'),('registry_id'),('reason'),('rejected_at')) v(want)
     where not exists (select 1 from information_schema.columns c
        where c.table_schema='geo' and c.table_name='n5_point_reject'
          and c.column_name=v.want)) z;
  if procedure_note is not null then
    v_missing := v_missing || ' n5_point_reject missing columns: ' || procedure_note || ';';
  end if;

  if not exists (select 1 from pg_constraint
      where conrelid=to_regclass('geo.n5_geom') and conname='n5_geom_verdict_snapshot_ck') then
    v_missing := v_missing || ' n5_geom_verdict_snapshot_ck absent;';
  end if;
  if not exists (select 1 from pg_constraint
      where conrelid=to_regclass('geo.n5_geom') and conname='n5_geom_pt_namespace_ck') then
    v_missing := v_missing || ' n5_geom_pt_namespace_ck absent;';
  end if;
  if to_regclass('geo.n5_point_reject_archive') is null then
    v_missing := v_missing || ' n5_point_reject_archive absent;';
  end if;

  if v_missing <> '' then
    raise exception 'STOP: post-migration validation failed -%. An object of the right NAME '
      'but the wrong SHAPE is exactly what `if not exists` conceals, which is why this check '
      'reads definitions rather than trusting names.', v_missing;
  end if;

  raise notice 'N5 post-migration validation passed (pre-state was %)',
               current_setting('n5.prestate', true);
end $mig$;

commit;
