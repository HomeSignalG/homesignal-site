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
-- No ST_Centroid, no ST_PointOnSurface, and no geo.n5_rep_point() (the
-- representative-point reducer used by the A3 shadow path) appears below.
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
  )
  select h.source_key,
         h.feature_id,
         h.registry_id,
         h.provenance,
         h.distance_mi,
         h.geometry_type,
         ((select count(*) from hit) > p_limit) as has_more
    from hit h
   order by h.distance_mi, h.source_key, h.feature_id   -- nearest first; deterministic ties
   limit p_limit;
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
  'whether further matching geometry exists — do not infer truncation from the row count.';

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
