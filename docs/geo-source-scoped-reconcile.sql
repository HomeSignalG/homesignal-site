-- ============================================================================
-- SOURCE-SCOPED GEOGRAPHY RECONCILE — the Phase 4 mutation primitive.
-- PARKED, NOT APPLIED. Phase 4 forbids production geography mutation.
--
-- WHAT IT REPLACES, AND WHY THAT MATTERS
--   geo.zip_authoritative_membership and geo.zip_authoritative_marker are today
--   rebuilt by a PREFIX-WIDE delete:
--     scripts/n5_unit_a_shadow.py:193   delete from {MEMB} where left(zcta5,3) = {PFX}
--     scripts/n5_a3_markers.py:130      delete from {MARK} where left(zcta5,3) = {PFX}
--   so processing ONE changed project destroys and recreates the geography of every
--   unrelated project sharing its first three ZIP digits. Measured on the Phase 0
--   population: repairing 3,152 affected ZIPs that way would delete and rebuild
--   775,459 of 901,465 membership rows — 86% of verified national geography.
--
-- THE CONTRACT
--   Given a BOUNDED SET OF SOURCE KEYS, reconcile exactly those keys' geography:
--     NEW - CURRENT        -> INSERT
--     intersection changed -> UPDATE
--     CURRENT - NEW        -> DELETE   (scoped to the processed keys, never a prefix)
--   The mutation scope NEVER widens because another project shares a ZIP, ZIP3,
--   registry or batch. Phase 5 supplies the key set; this primitive does not care
--   how the keys were discovered.
--
-- IDENTITIES (verified live 2026-09-19 against pg_index)
--   geo.n5_geom                        PK (source_key, feature_id)
--   geo.n5_boundary_membership         PK (zcta5, source_key)
--   geo.zip_authoritative_membership   PK (zcta5, source_key)
--   geo.zip_authoritative_marker       PK (zcta5, source_key, marker_seq)
--   A key legitimately spans MANY ZCTAs and MANY markers. Nothing here collapses that.
--
-- THE ENABLER — no per-prefix TIGER scratch table is needed
--   geo.zcta_boundary holds 33,791 national ZCTA polygons with a GiST index
--   (zcta_boundary_geom_gix). Measured read-only: expected-set computation for 3 keys
--   ran in 11.7 ms using that index (~3.9 ms/key). The existing scripts load TIGER into
--   a per-prefix scratch table because they are prefix-shaped; a key-scoped run does not
--   need to.
--
-- ⚠️ SCOPE LIMITS, STATED SO THEY ARE NOT ASSUMED AWAY
--   1. This reconciles the two RESIDENT-FACING tables. geo.n5_boundary_membership is
--      INSERT ... ON CONFLICT DO NOTHING today (n5_boundary_first.py:49) and has NO
--      removal path at all; geo.n5_geom is ON CONFLICT DO NOTHING (n5_shard.py:500), so
--      changed upstream geometry never updates. Both are Phase 5 questions.
--   2. Running this over a key set does NOT perform the national stale/orphan cleanup.
--      That is deliberately a later, separately controlled phase.
--   3. record_kind is carried in the predicates because the membership PK does not
--      include it (all 901,465 rows are 'development' today).
-- ============================================================================

-- ----------------------------------------------------------------- EXPECTED SET
-- Same PostGIS shape as scripts/n5_unit_a_shadow.py's POPULATE, but bounded by the
-- KEY SET and resolved against the national ZCTA table instead of a prefix scratch.
create or replace function geo.n5_expected_membership(p_keys text[])
returns table (zcta5 text, source_key text, lat double precision, lng double precision,
               point_rule text, clip_dim smallint, feature_count int, geom_family text)
language sql stable as $fn$
  select b.zcta5, k.source_key,
         case when p.pt is null then null else ST_Y(p.pt) end,
         case when p.pt is null then null else ST_X(p.pt) end,
         p.rule, x.dim, x.nfeat, x.family
    from unnest(p_keys) as k(source_key)
    join geo.zcta_boundary b on exists (
         select 1 from geo.n5_geom g
          where g.source_key = k.source_key and g.outcome = 1 and g.geom is not null
            and ST_Intersects(ST_MakeValid(g.geom), b.geom))
    cross join lateral (
         select ST_Intersection(ST_MakeValid(ST_Union(g.geom)), b.geom) clip,
                count(*)::int nfeat, min(ST_GeometryType(g.geom)) family
           from geo.n5_geom g
          where g.source_key = k.source_key and g.outcome = 1 and g.geom is not null
            and ST_Intersects(ST_MakeValid(g.geom), b.geom)) f
    cross join lateral (select f.clip, f.nfeat, f.family,
                        case when f.clip is null then null else ST_Dimension(f.clip) end::smallint dim) x
    cross join lateral geo.n5_rep_point(x.clip) p;
$fn$;

-- --------------------------------------------------------------- THE RECONCILE
-- ONE multi-statement payload = ONE implicit transaction under the Postgres simple-query
-- protocol, the same guarantee scripts/n5_unit_a_shadow.py relies on. A partial
-- reconcile can therefore never commit: a failure between the DELETE and the UPSERT
-- rolls the whole thing back, and previously verified geography survives intact.
-- Proven by test G.
--
-- Substitute :keys with the bounded key set and :run with the run id.

-- (1) MEMBERSHIP — delete only rows of THESE keys that are no longer expected
delete from geo.zip_authoritative_membership m
 where m.source_key = any (:keys)
   and m.record_kind = 'development'
   and not exists (select 1 from geo.n5_expected_membership(:keys) e
                    where e.zcta5 = m.zcta5 and e.source_key = m.source_key);

-- (2) MEMBERSHIP — insert new, update changed, leave identical rows alone.
-- The WHERE on DO UPDATE is what makes a rerun a true no-op (test B: 0 deletes,
-- 0 upserts, byte-identical fingerprint).
insert into geo.zip_authoritative_membership
       (zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count, geom_family, run_id, record_kind)
select e.zcta5, e.source_key, e.lat, e.lng, e.point_rule, e.clip_dim, e.feature_count,
       e.geom_family, :run, 'development'
  from geo.n5_expected_membership(:keys) e
on conflict (zcta5, source_key) do update
   set lat = excluded.lat, lng = excluded.lng, point_rule = excluded.point_rule,
       clip_dim = excluded.clip_dim, feature_count = excluded.feature_count,
       geom_family = excluded.geom_family, run_id = excluded.run_id
 where geo.zip_authoritative_membership.lat          is distinct from excluded.lat
    or geo.zip_authoritative_membership.lng          is distinct from excluded.lng
    or geo.zip_authoritative_membership.point_rule   is distinct from excluded.point_rule
    or geo.zip_authoritative_membership.clip_dim     is distinct from excluded.clip_dim
    or geo.zip_authoritative_membership.feature_count is distinct from excluded.feature_count
    or geo.zip_authoritative_membership.geom_family  is distinct from excluded.geom_family;

-- (3) MARKERS — identical algebra at (zcta5, source_key, marker_seq).
-- Markers must be reconciled AFTER membership: the marker build reads membership.
delete from geo.zip_authoritative_marker k
 where k.source_key = any (:keys)
   and k.record_kind = 'development'
   and not exists (select 1 from geo.n5_expected_marker(:keys) e
                    where e.zcta5 = k.zcta5 and e.source_key = k.source_key
                      and e.marker_seq = k.marker_seq);

insert into geo.zip_authoritative_marker
       (zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim, run_id, record_kind)
select e.zcta5, e.source_key, e.marker_seq, e.lat, e.lng, e.marker_rule, e.family, e.dim,
       :run, 'development'
  from geo.n5_expected_marker(:keys) e
on conflict (zcta5, source_key, marker_seq) do update
   set lat = excluded.lat, lng = excluded.lng, marker_rule = excluded.marker_rule,
       family = excluded.family, dim = excluded.dim, run_id = excluded.run_id
 where geo.zip_authoritative_marker.lat         is distinct from excluded.lat
    or geo.zip_authoritative_marker.lng         is distinct from excluded.lng
    or geo.zip_authoritative_marker.marker_rule is distinct from excluded.marker_rule
    or geo.zip_authoritative_marker.family      is distinct from excluded.family
    or geo.zip_authoritative_marker.dim         is distinct from excluded.dim;

-- geo.n5_expected_marker(p_keys) is the key-scoped form of scripts/n5_a3_markers.py's
-- BUILD CTE chain (ST_Dump of the clip, MIN_LINE_M / MIN_AREA_M2 component filter,
-- ST_PointOnSurface per kept component). It is NOT reproduced here because Phase 4 does
-- not apply anything; porting it verbatim belongs with the apply, so that the parked
-- file and production cannot silently diverge — the trap docs/epa-decouple-phase1b
-- already paid for once ("a parked migration that is mostly comments is not a migration").
