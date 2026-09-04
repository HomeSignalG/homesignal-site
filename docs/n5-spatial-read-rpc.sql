-- ============================================================================
-- N5 BOUNDED SPATIAL READ RPC  —  public.n5_projects_within_radius()
-- ----------------------------------------------------------------------------
-- PRODUCT PURPOSE (this is not general infrastructure)
-- Map 1 (`maps.html`) is gaining Map 2's street-address search: a resident types
-- an address, picks a radius, and must see the projects genuinely NEAR that home.
--
-- ⚖️ FOUNDER DECISION 2026-09-03 — THE RADIUS QUESTION IS:
--
--     "ANY CANONICAL PHYSICALLY LOCATED PROJECT GEOMETRY NEAR THIS HOME."
--
-- So the radius corpus INCLUDES BOTH eligible provenance classes:
--     * proven_stored_point        — the frozen snapshot coordinate, materialised
--                                    as a point at feature_id 'pt:1'
--     * recovered_authoritative    — publisher geometry fetched by
--                                    scripts/n5_shard.py::recover_shard
-- It is NOT restricted to recovered_authoritative.
--
-- ⚠️ THE TWO CLASSES ARE NOT SEMANTICALLY IDENTICAL, so `provenance` is a
-- RETURNED COLUMN and every row identifies its own evidence class. A caller may
-- present them differently; it may not conflate them. A stored point is a
-- coordinate the source asserted, not publisher geometry — do not describe it
-- as recovered publisher geometry, and do not invent stronger evidentiary
-- language for it than "the snapshot's stored coordinate".
--
-- ----------------------------------------------------------------------------
-- REVISION 3 (2026-09-04) — MARKER POSITION. Revision 2 returned no coordinate at
-- all, so Map 1 could not place a returned row on the map: it had identity,
-- provenance, distance and geometry type, and nothing to draw. Revision 3 adds
-- `marker_lat` / `marker_lng`, derived from the SAME geometry whose
-- (source_key, feature_id) the row returns.
--
-- ⚠️ MARKER, NOT LOCATION, AND NOT DISTANCE. These two columns are PRESENTATION
-- ONLY — where to draw one pin for this feature. They are:
--     * NEVER used to filter (ST_DWithin) or to measure (ST_Distance). Both still
--       run against the TRUE geometry, exactly as in revision 2, and the marker is
--       derived AFTER the radius filter, the ordering and the page limit have all
--       been applied. A marker cannot change which rows come back or in what order.
--     * NEVER hydrated from app_projects, app_properties, source_ref, source_seq, a
--       ZIP association, another feature_id, or any representative project point.
--       The ONLY input is g.geom of the row being returned.
--     * NOT the answer to "how far is this project" — `distance_mi` is, and for a
--       polygon or a long line the nearest point of the geometry is generally NOT
--       the marker. See the disclosed property under MARKER POSITION below.
--
-- ⛔ THIS REVISION CANNOT BE APPLIED WITH `create or replace` ALONE. Adding columns
-- to RETURNS TABLE changes the function's return type, which PostgreSQL refuses to
-- replace ("cannot change return type of existing function"). The DROP below is
-- therefore load-bearing, and it revokes the existing grants — which is why the
-- GRANTS section at the foot of this file re-applies them.
--
-- ----------------------------------------------------------------------------
-- REVISION 2 (2026-09-03) — WHAT CHANGED AND WHY. Revision 1 (PR #1015,
-- 2026-09-02) was written when geo.n5_geom held RECOVERY geometry only, and its
-- assumptions are now obsolete. The canonical corpus has since been published
-- and synchronised (snapshot phase1-2026-09-01, CANONICAL SYNC COMPLETE
-- 2026-09-03 20:49:04.959655Z — docs/n5-production-application-plan.md §11):
--
--     provenance                outcome  rows      queryable
--     proven_stored_point       1        718,278   yes
--     recovered_authoritative   1         23,283   yes
--     recovered_authoritative   3              1   no (NO_GEOMETRY, geom NULL)
--                                        -------
--     geo.n5_geom total                  741,562   741,561 queryable
--
-- Those counts are the measured shape of the corpus on that date. They are
-- DOCUMENTATION ONLY and are deliberately NOT hard-coded into any runtime
-- predicate: the predicate is structural, so the function stays correct as the
-- corpus grows.
--
-- Five defects in revision 1 are corrected here:
--
--   1. PROVENANCE CONFLATION. Revision 1 returned no `provenance` column while
--      admitting both classes, and its COMMENT claimed it returned only
--      "recovered authoritative geometry". Under that contract Map 1 would have
--      presented 718,278 single stored points as authoritative publisher
--      geometry — 96.9% of everything it returns. Fixed: `provenance` is
--      returned and the comment states both classes.
--   2. SILENT TRUNCATION. Revision 1 ended in a bare `limit 2000` with no
--      truncation signal, and was sized against a corpus of 8,625 geometry rows
--      (it measured 25/28/52/69 rows at 0.5/1/2/5 mi). The queryable corpus is
--      now 741,561 — 86x larger. Measured 2026-09-03 on 0.1-degree cells (~6.9
--      mi, SMALLER than a 5-mi-radius circle, so a lower bound): max 23,321
--      points in one cell, 87 cells over 2,000, and 397,241 of 718,278 proven
--      points (55.3%) sit in cells that already exceed 2,000. A bare LIMIT
--      would therefore truncate silently across every dense metro. Fixed: see
--      RESULT BOUNDS below — the caller supplies a limit, a hard server maximum
--      bounds it, and `has_more` is explicit.
--   3. NO LIFECYCLE GATE. Revision 1 read geo.n5_geom unconditionally, so a
--      query issued DURING sync-canonical — after canonical_synced_at is
--      cleared and before it is restored — would have served a half-swept
--      corpus as authoritative. Fixed: see LIFECYCLE GATE below; it FAILS
--      CLOSED.
--   4. NO SNAPSHOT ISOLATION. Fixed: proven points must carry the consumable
--      snapshot's verdict_snapshot_id.
--   5. MISLEADING RETURNED COLUMNS. `first_z3` is NULL on all 718,278 proven
--      rows (the sweep writes null) and on 14,658 of 23,284 recovered rows —
--      only 8,626 rows corpus-wide carry it, almost exactly the 8,625 revision 1
--      was measured against. `recovered_at` on a proven row is the canonical
--      SYNC stamp (2026-09-03 20:49), not a recovery time. Both are REMOVED
--      rather than renamed: no pre-existing canonical semantic could be proven
--      for either under this contract, and inventing one is worse than dropping
--      it. `outcome` is removed too — the predicate pins it to 1, so returning
--      it conveys nothing.
--
-- ----------------------------------------------------------------------------
-- WHY geo.n5_geom AND NOT app_projects
-- `app_projects` stores ONE representative lat/lng per row. Authoritative source
-- geometry here is polygons and polylines, so no view over a representative point
-- can answer distance-to-polygon at any effort. `geo.n5_geom` is the durable
-- authoritative store, keyed (source_key, feature_id) — project identity and
-- geometry-instance identity respectively.
--
-- 📌 THE A3 `source_key` ACCESS-PATH FINDING IS NOT A REASON TO CHANGE THIS
-- FUNCTION. That benchmark measured an app_projects/shadow-read path
-- (geo.n5_a3_projects_one_pass). This function reads geo.n5_geom directly and
-- joins app_projects nowhere; geo.n5_geom carries its own `n5_geom_sk_ix`
-- btree(source_key) alongside the GiST. Recorded and NOT acted on: app_projects
-- was observed 2026-09-03 to carry `app_projects_source_key_kind_idx
-- (source_key, record_kind)`, a leading-source_key index, which means the
-- earlier A3 premise — that the only source_key-bearing index was
-- (zip, source_key, source_seq) — may itself now be stale. That is the parallel
-- session's object; it is not touched here.
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
--   * The result grain is exactly the table's primary key,
--     n5_geom_pkey (source_key, feature_id).
--
-- ----------------------------------------------------------------------------
-- ELIGIBILITY PREDICATE — a positive allowlist, structural, fails closed
--     outcome = 1
--       AND geom IS NOT NULL
--       AND provenance IN ('proven_stored_point','recovered_authoritative')
--       AND (provenance = 'recovered_authoritative'
--            OR verdict_snapshot_id = <the consumable snapshot>)
--
-- `outcome = 1` is written by the builder together with a parsed geometry and a
-- NULL invalid_reason. It is a POSITIVE allowlist, never a denylist, so an
-- outcome code minted in future fails CLOSED. `provenance` is likewise
-- allowlisted by name rather than "not excluded", so a third provenance class
-- added later is refused until this predicate names it.
--
-- REJECTED IDENTITIES are excluded twice over. sync_canonical() DELETES the pt:1
-- of every ineligible source_key, so a rejected identity has no proven geometry
-- to return; verified live 2026-09-03 against the synchronised corpus — 5,171
-- rejects, of which 0 carry a proven point and 0 carry RPC-visible recovered
-- geometry. But that is a property of the SWEEP, not of this function, so the
-- predicate ALSO carries an explicit `not exists` against geo.n5_point_reject,
-- scoped to proven points. NULL_COORD and MULTI_COORD_UNRESOLVED therefore
-- cannot enter a radius result even if canonical geometry were to drift.
--   ⚠️ The reject clause is scoped to `provenance = 'proven_stored_point'` ON
--   PURPOSE. A reject records that the snapshot's stored COORDINATE was unusable;
--   it is not a verdict against real publisher geometry for the same project, and
--   suppressing recovered geometry on that basis would discard good data.
--
-- ----------------------------------------------------------------------------
-- LIFECYCLE GATE — READY + canonical-synced, FAIL CLOSED
-- The function refuses to serve unless exactly ONE snapshot in
-- geo.n5_verdict_manifest satisfies BOTH:
--     state = 'READY'                  (the verdict is complete and readable)
--     canonical_synced_at IS NOT NULL  (the canonical sweep for it has finished)
-- These are the EXISTING lifecycle semantics — the same two claims
-- n5_shard.py::assert_snapshot_consumable() requires of a shard — not a weaker
-- independent definition invented here.
--
-- `select ... into STRICT` is the mechanism, and it fails closed in BOTH
-- directions: NO_DATA_FOUND when nothing is consumable, TOO_MANY_ROWS when the
-- corpus is ambiguous. Neither is allowed to degrade into "serve anyway".
--
-- 🔑 THE MID-SWEEP CASE IS THE ONE THAT MATTERS. sync_canonical() NULLs
-- canonical_synced_at as its FIRST durable act and restores it only after both
-- set-equality verifications pass. So for the whole duration of a sweep there is
-- no consumable snapshot and this function RAISES rather than returning a
-- partial corpus. A radius answer during a sweep would be wrong in a way no
-- caller could detect.
--
-- ----------------------------------------------------------------------------
-- RESULT BOUNDS AND THE TRUNCATION CONTRACT
-- Radius stays bounded to the product allowlist (0.5/1/2/5 mi), so this is never
-- an unbounded national read. On top of that:
--     * p_limit is CALLER-SUPPLIED (default 500), and is REJECTED — never
--       clamped — if it is below 1 or above the hard server maximum.
--     * v_max_rows (2000) is a hard server ceiling the caller cannot exceed.
--     * `has_more` is an EXPLICIT returned column on every row.
-- `has_more` is computed by fetching p_limit + 1 rows and reporting whether the
-- extra one existed, then returning at most p_limit. So:
--     has_more = false -> the result IS the complete match set, and its row
--                         count is the true number of matching geometries.
--     has_more = true  -> more matching geometry exists beyond what was
--                         returned.
-- A caller must NOT infer truncation from `rows == p_limit`; that is precisely
-- the inference revision 1 forced and it is ambiguous when the true count
-- equals the limit exactly. When zero rows are returned nothing matched, and
-- has_more is false by construction (p_limit >= 1, so a match would have
-- produced a row).
--
-- ----------------------------------------------------------------------------
-- GEOMETRY SEMANTICS — true geometry, never a centroid
-- Stored SRID is 4269 (NAD83), NOT 4326, so geometry is transformed to 4326
-- before the geography cast; `geography` is defined on 4326. Verified live
-- 2026-09-03: SRID is uniformly 4269 across all 741,561 queryable rows, on both
-- provenance classes, so the transform is correct and uniform.
--   point   -> true point distance
--   line    -> distance to the line
--   polygon -> distance to the polygon; a home INSIDE it is distance 0
-- Verified live 2026-09-02 against a real stored MultiPolygon: home placed at
-- ST_PointOnSurface returned distance 0.0000 m, and a point 1 mile east returned
-- 1540.6 m — i.e. distance to the polygon EDGE, not to a centroid.
-- Geometry types present, measured 2026-09-03: proven ST_Point 718,278;
-- recovered ST_MultiPolygon 9,083, ST_MultiLineString 8,177, ST_Point 6,023.
-- Re-measured 2026-09-04 across the whole eligible corpus (the RECOVERY corpus is
-- LIVE and point-in-time by founder ruling, so these numbers move): POINT 724,301,
-- MULTILINESTRING 10,444, MULTIPOLYGON 9,125 — 743,870 rows, every one SRID 4269,
-- zero empty geometries, and NO MultiPoint, GeometryCollection or singular
-- LineString/Polygon anywhere.
-- No ST_Centroid and no geo.n5_rep_point() (the representative-point reducer used
-- by the A3 shadow path) appears below, in ANY region of the function.
-- ST_PointOnSurface appears in exactly ONE place — the polygon branch of the MARKER
-- derivation, which runs after filtering and can never influence a distance. It is
-- absent from the spatial filter region.
--
-- ----------------------------------------------------------------------------
-- MARKER POSITION — one drawable point per returned feature, derived from that
-- feature's own geometry. Every rule below was chosen against measurement, not
-- preference, and the measurements are live against the canonical corpus.
--
-- THE RULE
--   principal part := the largest part of the geometry (ST_Dump ordered by
--                     ST_Area desc for polygonal input, ST_Length desc for linear,
--                     tie-broken by dump path — deterministic either way)
--   POINT ................. the geometry itself
--   LINESTRING /
--   MULTILINESTRING ....... the VERTEX of the principal part nearest that part's
--                           length midpoint (ST_LineInterpolatePoint(part, 0.5)),
--                           tie-broken by vertex index
--   POLYGON /
--   MULTIPOLYGON .......... ST_PointOnSurface of the principal part; if that part
--                           is invalid it is repaired first with ST_MakeValid and
--                           ST_CollectionExtract(..., 3), and an empty repair
--                           yields NULL rather than a guess
--   anything else ......... NULL — a geometry class this function has never seen
--                           gets no marker, it does not get an approximated one
--
-- 🔑 WHY A VERTEX FOR LINES, AND NOT THE INTERPOLATED MIDPOINT. The midpoint is the
-- obvious answer and it FAILS the "the marker lies on this geometry" test. Measured
-- 2026-09-04 on 200 real MULTILINESTRINGs from the corpus:
--     ST_LineInterpolatePoint(part, 0.5)          ST_Intersects   0 / 200
--     ST_ClosestPoint(part, that midpoint)        ST_Intersects   0 / 200
--     the vertex nearest that midpoint            ST_Intersects 200 / 200
-- The interpolated point misses by at most 7.1e-15 degrees (ST_Distance) — it is a
-- floating-point representability residue, not a placement error: the point at
-- parameter 0.5 of a segment is in general not exactly collinear with that segment
-- in double precision, so the exact-arithmetic predicate correctly says false.
-- Snapping with ST_ClosestPoint does not repair it (3.6e-15 degrees, still 0/200).
-- Only an actual stored VERTEX satisfies the predicate exactly, at distance 0.
--
-- WHY NOT ST_PointOnSurface FOR LINES TOO (it would be one uniform rule). It also
-- guarantees membership — 200/200, distance 0, because GEOS returns a vertex — but
-- it is measurably the worse marker. Offset from the line's length midpoint, same
-- 200 features:
--     ST_PointOnSurface   mean  95.5 m   >50 m: 104/200   >500 m: 5/200
--     nearest vertex      mean  47.8 m   >50 m:  50/200   >500 m: 2/200
-- Same guarantee, worse centring, so the explicit rule wins. It is also stable
-- across PostGIS versions in a way GEOS's interior-point choice is not.
--
-- ⚠️ DISCLOSED PROPERTY, NOT HIDDEN. On a long, sparse-vertex line the nearest
-- vertex can sit well away from the middle: worst case measured 2,215 m, on a
-- corpus whose line parts average 7.2 km and reach 51.5 km. The marker is still a
-- point OF the feature, and `distance_mi` remains the distance to the nearest point
-- of the true geometry — so a caller must never derive distance from the marker,
-- nor describe the marker as "the project's location". One pin on a 51 km highway
-- is arbitrary wherever it is placed; this one is at least provably on the road.
--
-- VERIFIED ON THE REAL CORPUS, 2026-09-04 — the marker lies ON the geometry
-- (ST_Intersects true AND ST_Distance exactly 0), is a POINT, is never NULL and is
-- never empty:
--     MULTILINESTRING   10,435 / 10,435   (whole eligible line corpus)
--     MULTIPOLYGON       9,125 /  9,125   (whole eligible polygon corpus,
--                                          including all 4 invalid geometries)
-- and re-run with the EXACT expression shipped below, at the worst-case page size
-- this function can ever emit (p_limit = v_max_rows = 2,000): 2,000/2,000 on lines
-- and 2,000/2,000 on polygons, the polygon batch again including all 4 invalid rows.
-- Points are the identity case and need no derivation.
--
-- CRS. The marker is emitted in EPSG:4326 as plain lat/lng, because that is what a
-- web map consumes. The corpus is uniformly SRID 4269 today, so the transform runs;
-- it is nonetheless guarded and FAILS CLOSED — SRID 0, or an SRID absent from
-- spatial_ref_sys, yields a NULL marker rather than an untransformed coordinate
-- silently presented as WGS84. A NULL marker is an honest "cannot place this"; a
-- wrong one is a lie a map cannot detect.
--
-- ----------------------------------------------------------------------------
-- PERFORMANCE — uses the EXISTING index; no new index is created
-- geo.n5_geom already carries `n5_geom_gix` GiST (geom), in the stored SRID 4269.
-- A geography ST_DWithin alone could not use it (the cast is an expression), so
-- the query pairs an index-usable `&&` bounding-box prefilter in the NATIVE SRID
-- with the exact geography refinement. The prefilter is deliberately generous
-- (10% margin) because a prefilter that excludes a true match is a correctness
-- bug, not an optimisation.
-- Verified 2026-09-03 with EXPLAIN (no ANALYZE) on the synchronised corpus:
--     Index Scan using n5_geom_gix on n5_geom g
--       Index Cond: ((geom IS NOT NULL) AND (geom && '...'::geometry))
--       Filter: ((outcome = 1) AND st_dwithin(...))
-- The index bounds the scan to a bounding box before any transform/geography
-- work, so cost tracks LOCAL feature density, not national table size.
-- ============================================================================

-- The return type changes in revision 3 (marker_lat / marker_lng), and PostgreSQL
-- cannot REPLACE a function's return type. Dropping by the EXACT 4-argument
-- signature is therefore required, and is why the grants are re-applied below.
drop function if exists public.n5_projects_within_radius(double precision, double precision, numeric, integer);

create or replace function public.n5_projects_within_radius(
  p_lat        double precision,
  p_lng        double precision,
  p_radius_mi  numeric,
  p_limit      integer default 500
)
returns table (
  source_key    text,
  feature_id    text,
  registry_id   text,
  provenance    text,
  distance_mi   double precision,
  geometry_type text,
  -- PRESENTATION ONLY. Where to draw this feature's pin, in EPSG:4326, derived from
  -- this row's own geometry. NULL when no marker can be derived honestly. Never an
  -- input to any filter or distance, and never "the project's location".
  marker_lat    double precision,
  marker_lng    double precision,
  has_more      boolean
)
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  -- Product radii for Map 1. An allowlist, not a range check: a range check would
  -- silently accept 4.9 and quietly broaden the query beyond what the UI offers.
  -- It also rejects zero, negative and excessive radii without a separate clause.
  v_allowed   constant numeric[] := array[0.5, 1, 2, 5];
  -- HARD SERVER CEILING on returned rows. A caller may ask for less; it may not
  -- ask for more, and an over-large request is REFUSED rather than clamped, so a
  -- caller can never believe it received more than it did.
  v_max_rows  constant integer := 2000;
  -- The eligible provenance classes, named positively (founder decision above).
  v_prov      constant text[] := array['proven_stored_point','recovered_authoritative'];
  v_snapshot  text;
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
  if p_limit is null then
    raise exception 'n5_projects_within_radius: limit is required'
      using errcode = '22023';
  end if;
  if p_limit < 1 then
    raise exception 'n5_projects_within_radius: limit % must be at least 1', p_limit
      using errcode = '22023';
  end if;
  if p_limit > v_max_rows then
    raise exception 'n5_projects_within_radius: limit % exceeds the server maximum of %',
                    p_limit, v_max_rows
      using errcode = '22023';
  end if;

  -- ---- LIFECYCLE GATE. Fails closed in both directions. ---------------------
  -- Mid-sweep, canonical_synced_at is NULL and this raises rather than serving a
  -- partially swept corpus.
  begin
    select m.snapshot_id
      into strict v_snapshot
      from geo.n5_verdict_manifest m
     where m.state = 'READY'
       and m.canonical_synced_at is not null;
  exception
    when no_data_found then
      raise exception 'n5_projects_within_radius: no consumable canonical snapshot '
                      '(requires state=READY and canonical_synced_at set). Refusing to '
                      'serve an unsynchronised or partially swept corpus.'
        using errcode = '55000';
    when too_many_rows then
      raise exception 'n5_projects_within_radius: more than one READY and canonically '
                      'synced snapshot; the canonical corpus is ambiguous. Refusing to serve.'
        using errcode = '55000';
  end;

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

  -- `hit` is fetched at p_limit + 1 so the extra row PROVES whether more matching
  -- geometry exists, without a second full count. MATERIALIZED because it is
  -- referenced twice and must be computed exactly once.
  return query
  with hit as materialized (
    select g.source_key   as source_key,
           g.feature_id   as feature_id,
           g.registry_id  as registry_id,
           g.provenance   as provenance,
           st_distance(st_transform(g.geom, 4326)::geography,
                       v_home4326::geography) / 1609.344 as distance_mi,
           st_geometrytype(g.geom) as geometry_type
      from geo.n5_geom g
     where g.outcome = 1                        -- positive allowlist; fails closed
       and g.geom is not null
       and g.provenance = any (v_prov)          -- named classes only; fails closed
       -- snapshot isolation: a proven point must belong to the consumable
       -- snapshot. Recovered geometry is not snapshot-scoped and carries
       -- verdict_snapshot_id NULL by design (all 23,284 rows, measured).
       and (g.provenance = 'recovered_authoritative'
            or g.verdict_snapshot_id = v_snapshot)
       -- DEFENCE IN DEPTH on rejected identities, scoped to the PROVEN point only.
       -- The sweep already deletes a rejected identity's pt:1, so this is normally
       -- a no-op (0 rows corpus-wide, measured); it makes the exclusion a property
       -- of THIS function rather than of "the sweep must have run correctly".
       -- ⚠️ It deliberately does NOT exclude a rejected identity's RECOVERED
       -- geometry: a reject means the snapshot's stored COORDINATE was unusable
       -- (NULL_COORD / MULTI_COORD_UNRESOLVED), which says nothing against real
       -- publisher geometry for the same project. Excluding that would destroy
       -- good data to punish a bad coordinate.
       and not (g.provenance = 'proven_stored_point'
                and exists (select 1 from geo.n5_point_reject r
                             where r.source_key = g.source_key))
       -- index-usable prefilter in the stored SRID (uses n5_geom_gix)
       and g.geom && st_expand(v_home4269, v_deg_lng, v_deg_lat)
       -- exact answer on the TRUE geometry, in metres
       and st_dwithin(st_transform(g.geom, 4326)::geography,
                      v_home4326::geography, v_meters)
     order by distance_mi, source_key, feature_id
     limit p_limit + 1
  ),
  -- ---- PAGE. The caller's page, fixed BEFORE any marker work happens, so marker
  -- derivation is bounded by p_limit and can never touch a row that was filtered out.
  page as (
    select h.source_key   as source_key,
           h.feature_id   as feature_id,
           h.registry_id  as registry_id,
           h.provenance   as provenance,
           h.distance_mi  as distance_mi,
           h.geometry_type as geometry_type
      from hit h
     order by h.distance_mi, h.source_key, h.feature_id
     limit p_limit
  ),
  -- ---- PRINCIPAL PART. The largest part of THIS row's own geometry: by area for
  -- polygonal input, by length for linear. LEFT JOINs throughout, so a row can lose
  -- its marker but can never be dropped from the result by marker derivation.
  part as (
    select p.source_key, p.feature_id, p.registry_id, p.provenance,
           p.distance_mi, p.geometry_type,
           g.geom              as g_geom,
           geometrytype(g.geom) as g_type,
           lp.geom             as principal
      from page p
      left join geo.n5_geom g
             on g.source_key = p.source_key
            and g.feature_id = p.feature_id
      left join lateral (
        select d.geom
          from st_dump(g.geom) d
         where geometrytype(g.geom) in ('LINESTRING','MULTILINESTRING','POLYGON','MULTIPOLYGON')
         order by case when geometrytype(g.geom) in ('POLYGON','MULTIPOLYGON')
                       then st_area(d.geom)
                       else st_length(d.geom)
                  end desc,
                  d.path[1]
         limit 1
      ) lp on true
  ),
  -- ---- MARKER. Derived from g_geom and NOTHING else. See MARKER POSITION above for
  -- the measurements behind each branch; the else-branch fails CLOSED to NULL.
  marked as (
    select t.source_key, t.feature_id, t.registry_id, t.provenance,
           t.distance_mi, t.geometry_type,
           case
             when t.g_geom is null or st_isempty(t.g_geom) then null
             -- a point IS its own marker; no derivation, no approximation
             when t.g_type = 'POINT' then t.g_geom
             when t.principal is null then null
             -- the vertex nearest the principal part's length midpoint. An
             -- interpolated midpoint is NOT used: measured 0/200 on ST_Intersects.
             when t.g_type in ('LINESTRING','MULTILINESTRING') then (
               select dp.geom
                 from st_dumppoints(t.principal) dp
                order by st_distance(dp.geom, st_lineinterpolatepoint(t.principal, 0.5)),
                         dp.path[1]
                limit 1)
             -- ST_PointOnSurface is guaranteed to lie ON the surface, unlike a
             -- centroid, which for a concave or multipart polygon can fall outside
             -- it entirely. An invalid ring is repaired first; an empty repair
             -- yields NULL rather than a fabricated point.
             when t.g_type in ('POLYGON','MULTIPOLYGON') then (
               select case when v.g is null or st_isempty(v.g) then null
                           else st_pointonsurface(v.g) end
                 from (select case when st_isvalid(t.principal) then t.principal
                                   else st_collectionextract(st_makevalid(t.principal), 3)
                              end as g) v)
             else null
           end as marker_geom
      from part t
  ),
  -- ---- CRS. To 4326 for the web map, guarded and FAIL CLOSED: an unknown or
  -- unregistered SRID yields NULL, never an untransformed coordinate labelled WGS84.
  placed as (
    select m.source_key, m.feature_id, m.registry_id, m.provenance,
           m.distance_mi, m.geometry_type,
           case
             when m.marker_geom is null or st_isempty(m.marker_geom) then null
             when st_srid(m.marker_geom) = 4326 then m.marker_geom
             when st_srid(m.marker_geom) > 0
              and exists (select 1 from public.spatial_ref_sys srs
                           where srs.srid = st_srid(m.marker_geom))
                  then st_transform(m.marker_geom, 4326)
             else null
           end as marker4326
      from marked m
  )
  select pl.source_key,
         pl.feature_id,
         pl.registry_id,
         pl.provenance,
         pl.distance_mi,
         pl.geometry_type,
         st_y(pl.marker4326) as marker_lat,
         st_x(pl.marker4326) as marker_lng,
         ((select count(*) from hit) > p_limit) as has_more
    from placed pl
   order by pl.distance_mi, pl.source_key, pl.feature_id;  -- nearest first; deterministic ties
end
$fn$;

comment on function public.n5_projects_within_radius(double precision, double precision, numeric, integer) is
  'Map 1 address search: canonical project GEOMETRY INSTANCES (source_key, feature_id) whose '
  'geometry lies within a product radius (0.5/1/2/5 mi) of a home point. Returns BOTH eligible '
  'evidence classes and identifies each one in the `provenance` column: proven_stored_point (the '
  'snapshot''s stored coordinate, materialised as a point) and recovered_authoritative (publisher '
  'geometry). These are NOT equivalent and must not be presented as interchangeable; a stored '
  'point is not recovered publisher geometry. One row per geometry instance, never collapsed per '
  'source_key. Refuses to serve unless exactly one snapshot is READY with canonical_synced_at set, '
  'so a query during the canonical sweep raises instead of returning a partial corpus. Result size '
  'is caller-bounded (p_limit, default 500, server maximum 2000) and `has_more` states explicitly '
  'whether further matching geometry exists — do not infer truncation from the row count. '
  'marker_lat/marker_lng are PRESENTATION ONLY: one drawable point derived from that same row''s '
  'geometry (a point is itself; a line uses the vertex nearest its longest part''s midpoint; a '
  'polygon uses ST_PointOnSurface of its largest part, never a centroid), emitted in EPSG:4326 and '
  'NULL when none can be derived honestly. They are never used to filter or to measure — '
  'distance_mi is measured against the true geometry, so for a polygon or a long line the marker '
  'is generally NOT the nearest point. Do not treat the marker as the project''s location, and do '
  'not compute distance from it.';

-- ---- GRANTS -----------------------------------------------------------------
-- Narrowest surface: the function is callable by the public site (anon key), and
-- it is the ONLY way in. No grant on the geo schema, on geo.n5_geom or on
-- geo.n5_verdict_manifest is made here or anywhere else, so anon gains no table
-- access and no ad-hoc geo query. Convention matches
-- docs/app-dev-backed-zip-count-rpc.sql and docs/dev-zip-source-ids-rpc.sql.
--
-- 🔒 OWNERSHIP IS LOAD-BEARING AND MUST BE VERIFIED AT APPLY TIME.
-- geo.n5_geom and geo.n5_verdict_manifest both have RLS ENABLED with ZERO
-- POLICIES and relforcerowsecurity = false (measured 2026-09-03), and neither
-- anon nor authenticated holds SELECT on them. A table owner bypasses RLS when
-- force is off, so this function reads rows ONLY IF it is owned by the tables'
-- owner, `postgres`. Applied by any other role it will create successfully,
-- pass every structural test, and then return ZERO ROWS for every query — a
-- silent empty result indistinguishable from "nothing near this home". The
-- apply plan therefore verifies proowner explicitly; see
-- docs/n5-spatial-read-rpc-readiness.md.
revoke all on function public.n5_projects_within_radius(double precision, double precision, numeric, integer) from public;
grant execute on function public.n5_projects_within_radius(double precision, double precision, numeric, integer) to anon, authenticated;
