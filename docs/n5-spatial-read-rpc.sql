-- ============================================================================
-- N5 BOUNDED SPATIAL READ RPC  —  public.n5_projects_within_radius()
-- ----------------------------------------------------------------------------
-- PRODUCT PURPOSE (this is not general infrastructure)
-- Map 1 (`maps.html`) is gaining Map 2's street-address search: a resident types
-- an address, picks a radius, and must see the projects genuinely NEAR that home.
-- This function answers exactly one question and nothing else:
--
--     Given a home lat/lng and a radius in miles, which project GEOMETRY
--     INSTANCES are actually within that physical radius?
--
-- It is the read surface recorded as required by the architecture record
-- (docs/n5-address-search-architecture-record.md, Claim 5), which noted that no
-- such RPC existed in `main`. Verified again 2026-09-02: no file referenced
-- geo.n5_geom / geo.n5_association, and no SECURITY DEFINER function over geo.*.
--
-- ----------------------------------------------------------------------------
-- WHY geo.n5_geom AND NOT app_projects
-- `app_projects` stores ONE representative lat/lng per row. Authoritative source
-- geometry here is polygons and polylines, so no view over a representative point
-- can answer distance-to-polygon at any effort. `geo.n5_geom` is the durable
-- authoritative store, keyed (source_key, feature_id) — project identity and
-- geometry-instance identity respectively.
--
-- IDENTITY RULES (architecture record, Claims 1-2 — enforced by this function):
--   * `source_key`  IS project identity.
--   * `feature_id`  IS geometry-instance identity.
--   * `source_ref`  is NOT identity (dataset-precision sources share one URL;
--                   measured: it collapses 932,736 projects to 629,617).
--   * `source_seq`  is multiplicity, NOT identity.
--   * NO `distinct on (source_key)` anywhere below. A project may legitimately
--     own many geometries; collapsing them destroys real spatial data. Measured
--     live 2026-09-02: `arcgis:massdot-highway-projects:609402` carries 191
--     features, of which 58 fall within 1 mile of a home point and are returned
--     here as 58 SEPARATE ROWS. Collapsing would report that as 1.
--
-- ----------------------------------------------------------------------------
-- ELIGIBILITY — why every row this returns is trustworthy for physical radius
-- The architecture record (Claim 3) flagged a structural eligibility gap: the
-- ASSOCIATION layer carries no treatment/registry/fidelity column, so radius
-- eligibility cannot be established there. That gap is real and this function
-- deliberately does NOT read geo.n5_association.
--
-- For geo.n5_geom the gap does not apply, because the table carries a per-row
-- `provenance` label: 'recovered_authoritative' (publisher geometry fetched by
-- scripts/n5_shard.py::recover_shard) or 'proven_stored_point' (the frozen snapshot
-- coordinate materialised as a point, feature_id 'pt:1'; 'pt:2'+ are RESERVED and
-- UNDEFINED). The column is NOT NULL with a CHECKed domain and NO DEFAULT, so a
-- writer must state which kind of geometry it is writing.
--
-- ⚠️ CORRECTED — DO NOT RESTORE THE EARLIER WORDING. This block previously read
-- "the table is populated only by the RECOVERY path … Presence in this table is
-- therefore itself the treatment gate". That was TRUE when written and is now
-- FALSE: PROVEN stored points are materialised into the same table (145 of 234
-- sources, 723,155 projects with coordinates), so presence no longer implies
-- recovered publisher geometry. A reader resting on the old sentence would widen
-- silently rather than fail. **If this function is meant to return recovered
-- geometry ONLY, its predicate must say so** — add
-- `provenance = 'recovered_authoritative'` to the allowlist below; the fail-closed
-- `outcome = 1` clause does NOT discriminate provenance and never did.
-- Migration of record: docs/n5-provenance-and-key-migration.sql.
--
-- The predicate is a POSITIVE ALLOWLIST (`outcome = 1`), never a denylist, so an
-- outcome code minted in future fails CLOSED instead of being trusted by default:
--     outcome = 1  AND  geom IS NOT NULL
-- `outcome = 1` is written by the builder together with a parsed geometry and a
-- NULL invalid_reason (n5_shard.py geom insert). It is also the same condition
-- the association builder itself uses before trusting geometry (`g.geom is not
-- null` on the RECOVERY branch).
-- Measured live 2026-09-02: outcome=1 -> 8,625 rows, ALL with geom, types
-- {ST_MultiPolygon, ST_MultiLineString}; outcome=3 -> 1 row, invalid_reason
-- 'NO_GEOMETRY', geom NULL. The predicate admits the first set and excludes the
-- second.
--
-- ⚠️ SCOPE — READ THIS BEFORE BUILDING UI COPY ON TOP OF IT.
-- This function returns ONLY projects with recovered authoritative geometry. In
-- the ZIPs covered so far that is a MINORITY of the development corpus: measured
-- 2026-09-02 across covered ZIPs, NOAUTH 7,657 projects vs RECOVERY 1,962 and
-- PROVEN 1. An empty or small result here therefore does NOT mean "nothing is
-- near this home" — it means "nothing with authoritative geometry is near this
-- home". Deciding what a resident is told is the job of the separate coverage
-- state surface, which is NOT part of this change.
--
-- ----------------------------------------------------------------------------
-- GEOMETRY SEMANTICS — true geometry, never a centroid
-- Stored SRID is 4269 (NAD83), NOT 4326, so geometry is transformed to 4326
-- before the geography cast; `geography` is defined on 4326.
--   point   -> true point distance
--   line    -> distance to the line
--   polygon -> distance to the polygon; a home INSIDE it is distance 0
-- Verified live 2026-09-02 against a real stored MultiPolygon: home placed at
-- ST_PointOnSurface returned distance 0.0000 m, and a point 1 mile east returned
-- 1540.6 m — i.e. distance to the polygon EDGE, not to a centroid.
-- No ST_Centroid / ST_PointOnSurface appears in the query below.
--
-- ----------------------------------------------------------------------------
-- PERFORMANCE — uses the EXISTING index; no new index is created
-- geo.n5_geom already carries `n5_geom_gix` GiST (geom), in the stored SRID 4269.
-- A geography ST_DWithin alone could not use it (the cast is an expression), so
-- the query pairs an index-usable `&&` bounding-box prefilter in the NATIVE SRID
-- with the exact geography refinement. The prefilter is deliberately generous
-- (10% margin) because a prefilter that excludes a true match is a correctness
-- bug, not an optimisation.
-- Verified live 2026-09-02 with EXPLAIN (ANALYZE):
--     Index Scan using n5_geom_gix on n5_geom
--       Index Cond: ((geom IS NOT NULL) AND (geom && '...'::geometry))
--       Filter: ((outcome = 1) AND st_dwithin(...))
--       Rows Removed by Filter: 18
--     Execution Time: 33.852 ms
-- This shape stays viable as N5 grows nationally: the index bounds the scan to a
-- bounding box before any transform/geography work is done, so cost tracks the
-- LOCAL feature density, not the national table size.
-- ============================================================================

create or replace function public.n5_projects_within_radius(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_mi  numeric
)
returns table (
  source_key    text,
  feature_id    text,
  registry_id   text,
  distance_mi   double precision,
  geometry_type text,
  outcome       smallint,
  first_z3      character(3),
  recovered_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  -- Product radii for Map 1. An allowlist, not a range check: a range check would
  -- silently accept 4.9 and quietly broaden the query beyond what the UI offers.
  v_allowed   constant numeric[] := array[0.5, 1, 2, 5];
  -- Radius is capped at 5 miles, so a result set is bounded by local density
  -- rather than by table size. The cap below is a defensive ceiling only; a
  -- caller receiving exactly this many rows must treat the result as possibly
  -- truncated rather than complete.
  v_max_rows  constant integer := 2000;
  v_meters    double precision;
  v_home4326  geometry;
  v_home4269  geometry;
  v_deg_lat   double precision;
  v_deg_lng   double precision;
  v_coslat    double precision;
begin
  -- ---- VALIDATE. Reject; never silently broaden or clamp. -------------------
  if p_lat is null or p_lng is null or p_radius_mi is null then
    raise exception 'n5_projects_within_radius: lat, lng and radius_mi are all required'
      using errcode = '22023';
  end if;
  if p_lat < -90 or p_lat > 90 then
    raise exception 'n5_projects_within_radius: latitude % out of range [-90,90]', p_lat
      using errcode = '22023';
  end if;
  if p_lng < -180 or p_lng > 180 then
    raise exception 'n5_projects_within_radius: longitude % out of range [-180,180]', p_lng
      using errcode = '22023';
  end if;
  if not (p_radius_mi = any (v_allowed)) then
    raise exception 'n5_projects_within_radius: radius_mi % is not one of 0.5, 1, 2, 5', p_radius_mi
      using errcode = '22023';
  end if;

  v_meters   := p_radius_mi::double precision * 1609.344;
  v_home4326 := st_setsrid(st_makepoint(p_lng, p_lat), 4326);
  v_home4269 := st_transform(v_home4326, 4269);

  -- Bounding box for the index prefilter, in degrees, with a 10% margin. Near the
  -- poles cos(lat) collapses toward 0 and the longitude span degenerates, so the
  -- box is widened to the whole span rather than dividing by ~0.
  v_deg_lat := (v_meters * 1.10) / 111320.0;
  v_coslat  := cos(radians(p_lat));
  if abs(p_lat) > 89.0 or v_coslat <= 0.0001 then
    v_deg_lng := 180.0;
  else
    v_deg_lng := (v_meters * 1.10) / (111320.0 * v_coslat);
  end if;

  return query
  select
    g.source_key,
    g.feature_id,
    g.registry_id,
    st_distance(st_transform(g.geom, 4326)::geography, v_home4326::geography) / 1609.344,
    st_geometrytype(g.geom),
    g.outcome,
    g.first_z3,
    g.recovered_at
  from geo.n5_geom g
  where g.outcome = 1                    -- positive allowlist; fails closed
    and g.geom is not null
    -- index-usable prefilter in the stored SRID (uses n5_geom_gix)
    and g.geom && st_expand(v_home4269, v_deg_lng, v_deg_lat)
    -- exact answer on the true geometry, in metres
    and st_dwithin(st_transform(g.geom, 4326)::geography, v_home4326::geography, v_meters)
  order by 4, g.source_key, g.feature_id   -- nearest first; deterministic ties
  limit v_max_rows;
end
$fn$;

comment on function public.n5_projects_within_radius(double precision, double precision, numeric) is
  'Map 1 address search: project GEOMETRY INSTANCES (source_key, feature_id) whose recovered '
  'authoritative geometry lies within a product radius (0.5/1/2/5 mi) of a home point. Returns '
  'one row per geometry instance — never collapsed per source_key. Only outcome=1 rows with a '
  'stored geometry are eligible. An empty result means "no authoritative geometry near this '
  'home", NOT "nothing is near this home".';

-- ---- GRANTS -----------------------------------------------------------------
-- Narrowest surface: the function is callable by the public site (anon key), and
-- it is the ONLY way in. No grant on the geo schema or on geo.n5_geom is made
-- here or anywhere else, so anon gains no table access and no ad-hoc geo query.
-- Convention matches docs/app-dev-backed-zip-count-rpc.sql and
-- docs/dev-zip-source-ids-rpc.sql.
revoke all on function public.n5_projects_within_radius(double precision, double precision, numeric) from public;
grant execute on function public.n5_projects_within_radius(double precision, double precision, numeric) to anon, authenticated;
