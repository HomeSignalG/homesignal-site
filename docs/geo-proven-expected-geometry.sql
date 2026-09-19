-- ============================================================================
-- PROVEN EXPECTED GEOMETRY — the permanent steady-state adapter.
--
-- PARKED. NOT APPLIED. Creating this function schedules nothing and mutates no
-- plane: it is a pure read that RETURNS the expected feature set. The Phase 5
-- reconciler owns convergence.
--
-- ----------------------------------------------------------------------------
-- WHY THIS EXISTS: THERE IS NO CURRENT PROVEN WRITER. Measured 2026-09-19.
--
--   * The only production inserts into geo.n5_geom are scripts/n5_shard.py:494
--     and :500, and BOTH hard-code provenance='recovered_authoritative'.
--   * Every occurrence of 'proven_stored_point' in shipped code is a test
--     fixture or a read-path assertion. No writer.
--   * All 718,278 proven_stored_point rows carry ONE recovered_at -
--     2026-09-03 20:48:18.372585+00, a single distinct minute - and
--     verdict_snapshot_id 'phase1-2026-09-01', with first_z3 NULL on every row.
--     One set-based statement, stamped with the FROZEN snapshot, no shard
--     provenance. For contrast the RECOVERY half spans 417 distinct minutes
--     across 2026-09-02..09-05 over 425 distinct first_z3 values, which is what
--     an incrementally-running process looks like.
--   * It is not in supabase_migrations.schema_migrations either: the nearest
--     recorded migration is 20260903204603, two minutes earlier.
--
--   => PROVEN geometry was produced ONCE, off the frozen snapshot, by a
--      statement that is not in the repo and not in the migration ledger. A
--      brand-new PROVEN project arriving tomorrow has nothing to materialise it.
--
-- ----------------------------------------------------------------------------
-- THE STORED-COORDINATE CONTRACT — MEASURED, NOT ASSUMED.
--
-- ⛔ IT IS NOT min(id), AND IT IS NOT "one source row". Measured over
-- frisco-active-building-permits (550 keys / 956 live development rows):
--
--     keys with exactly one live row .................. 326
--     keys with MORE than one live row ................ 224   (up to 5)
--     keys whose rows AGREE on one coordinate ......... 548
--     keys whose rows DISAGREE ........................   2
--     keys with no coordinate / null island / invalid . 0 / 0 / 0
--
-- Multi-row keys are NORMAL, not a defect: public.app_projects is keyed
-- (zip, source_key, source_seq), so one project spanning two ZIPs is two rows.
-- The rows overwhelmingly AGREE. So the rule is AGREEMENT, never SELECTION -
-- picking min(id) would silently choose one of two contradictory coordinates and
-- publish it as authoritative.
--
-- That is exactly what geo.n5_point_reject's CLOSED reason domain already
-- encodes (docs/n5-provenance-and-key-migration.sql): NO_REGISTRY_VERDICT,
-- NULL_COORD, NULL_ISLAND, OUTSIDE_JURISDICTION, INVALID_COORD,
-- MULTI_COORD_UNRESOLVED. The contract was designed; only the writer was missing.
-- This function implements that contract and invents no new reason.
--
-- ----------------------------------------------------------------------------
-- OUTPUT SHAPE = geo.n5_geom_incoming, deliberately. The Phase 5 reconciler
-- consumes it UNCHANGED, which is what keeps expected-geometry and convergence
-- as two separate concerns.
-- ============================================================================

begin;

create or replace function geo.proven_expected_geometry(_keys text[])
returns table (
  source_key      text,
  registry_id     text,
  feature_id      text,
  outcome         smallint,
  geom            geometry,
  invalid_reason  text,
  provenance      text
)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $fn$
with named as (select unnest(_keys) sk),
-- Live evidence only. NEVER preservation.app_project_identity: the frozen
-- snapshot is what froze this pipeline, and a steady-state adapter that reads it
-- would reproduce the original defect with new code.
live as (
  select p.source_key sk, p.registry_id,
         p.lat, p.lng
    from public.app_projects p
    join named n on n.sk = p.source_key
   where p.record_kind = 'development'),
-- Treatment comes from the catalogue. A key whose registry has no treatment row
-- is a GOVERNANCE HOLD, and a hold must not be silently materialised.
treat as (
  select l.sk,
         min(l.registry_id) registry_id,
         (select s.treatment from geo.n5_accepted_source s
           where s.registry_id = min(l.registry_id)) treatment
    from live l group by l.sk),
coords as (
  select l.sk,
         count(*) rows_n,
         count(*) filter (where l.lat is not null and l.lng is not null) with_coord,
         count(*) filter (where l.lat = 0 and l.lng = 0) null_island,
         count(*) filter (where l.lat is not null and l.lng is not null
                            and (l.lat not between -90 and 90
                              or l.lng not between -180 and 180)) invalid,
         -- Rounded to 6dp (~11 cm) before DISTINCT, so float noise in the last
         -- bits is not reported as two contradictory locations.
         count(distinct (round(l.lat::numeric,6)::text||','||round(l.lng::numeric,6)::text))
           filter (where l.lat is not null and l.lng is not null
                     and not (l.lat = 0 and l.lng = 0)
                     and l.lat between -90 and 90 and l.lng between -180 and 180) distinct_ok,
         min(round(l.lat::numeric,6)) filter (where l.lat is not null and l.lng is not null
                     and not (l.lat = 0 and l.lng = 0)
                     and l.lat between -90 and 90 and l.lng between -180 and 180) lat_one,
         min(round(l.lng::numeric,6)) filter (where l.lat is not null and l.lng is not null
                     and not (l.lat = 0 and l.lng = 0)
                     and l.lat between -90 and 90 and l.lng between -180 and 180) lng_one
    from live l group by l.sk)
select
  n.sk::text as source_key,
  coalesce(t.registry_id, '(unknown)')::text as registry_id,
  -- 'pt:1' is the CONTRACT, stated in the geo.n5_geom table comment: PROVEN is
  -- one point per key and 'pt:2' and beyond are RESERVED and UNDEFINED. One
  -- agreed coordinate per key is precisely what makes that safe.
  'pt:1'::text as feature_id,
  (case
     when t.sk is null                              then 3   -- no live evidence at all
     when t.treatment is null                       then 3
     when t.treatment <> 'PROVEN'                   then 3
     when c.with_coord = 0                          then 3
     when c.invalid > 0                             then 3
     when c.distinct_ok = 0 and c.null_island > 0   then 3
     when c.distinct_ok > 1                         then 3
     else 1
   end)::smallint as outcome,
  (case
     when t.sk is not null and t.treatment = 'PROVEN'
          and c.with_coord > 0 and c.invalid = 0 and c.distinct_ok = 1
     then ST_SetSRID(ST_MakePoint(c.lng_one::double precision,
                                  c.lat_one::double precision), 4269)
     else null
   end) as geom,
  (case
     -- SOURCE_REMOVED is the one reason NOT in n5_point_reject's closed domain,
     -- and it is deliberately written to n5_geom.invalid_reason (free text, the
     -- same channel 'NO_GEOMETRY' already uses) rather than widening that CHECK.
     -- It is also what makes an AUTHORITATIVE EMPTY expected set expressible:
     -- no live app_projects row is LOCAL evidence of removal, unlike a failed
     -- remote fetch, so it may legitimately retire geography.
     when t.sk is null                              then 'SOURCE_REMOVED'
     when t.treatment is null                       then 'NO_REGISTRY_VERDICT'
     when t.treatment <> 'PROVEN'                   then 'NOT_PROVEN_TREATMENT'
     when c.with_coord = 0                          then 'NULL_COORD'
     when c.invalid > 0                             then 'INVALID_COORD'
     when c.distinct_ok = 0 and c.null_island > 0   then 'NULL_ISLAND'
     when c.distinct_ok > 1                         then 'MULTI_COORD_UNRESOLVED'
     else null
   end)::text as invalid_reason,
  'proven_stored_point'::text as provenance
from named n
left join treat  t on t.sk = n.sk
left join coords c on c.sk = n.sk;
$fn$;

revoke all on function geo.proven_expected_geometry(text[]) from public;

comment on function geo.proven_expected_geometry(text[]) is
  'Permanent PROVEN expected-geometry adapter. Source-key scoped, deterministic, '
  'idempotent, reads LIVE public.app_projects only - never '
  'preservation.app_project_identity - and never ZIP3. Emits exactly the shape '
  'geo.n5_geom_incoming takes so the Phase 5 reconciler consumes it unchanged. '
  'It performs NO downstream mutation: convergence belongs to the reconciler. '
  'A key with no live evidence yields outcome 3 / SOURCE_REMOVED, which is an '
  'AUTHORITATIVE empty set and retires geography; a key whose rows disagree on '
  'coordinates yields MULTI_COORD_UNRESOLVED and is never resolved by picking '
  'one - see the measured contract in this file.';

commit;

-- ============================================================================
-- ⚠️ OUT OF SCOPE, STATED SO IT IS NOT MISTAKEN FOR DONE
--   * OUTSIDE_JURISDICTION is in n5_point_reject's domain and is NOT evaluated
--     here: it needs the registry's declared coverage envelope, which is a
--     separate contract. Its absence cannot fabricate a point - it can only
--     fail to reject one that the other five rules admit.
--   * Tombstone rows (outcome 3 / SOURCE_REMOVED) accumulate in geo.n5_geom.
--     Clearing them is national orphan cleanup, which is explicitly out of scope.
--     They are harmless to residents: every downstream stage requires outcome=1.
-- ============================================================================
