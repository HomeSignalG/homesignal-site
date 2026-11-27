-- docs/zip-scope-members-geom.sql — DDL of record for the WHOLE-GEOMETRY widened-scope membership test
--   geo.zip_geom_membership_in(p_boundary, p_geom)      the predicate (twin of geo.zip_point_membership_in)
--   geo.zip_scope_feature_geom(p_feat)                   ArcGIS rings / paths / points -> one geometry
--   public.zip_scope_members_geom(p_zip, p_feats)        the batch wrapper the engine calls
-- STATUS: NOT APPLIED. Applying it is a separate, explicitly authorised step. Written 2026-11-19.
--
-- WHY (docs/denton-workstream-b-2026-10-14.md §2.3; test/scope-nonpoint-membership.test.mjs)
-- The widened ZIP scope (sources/scope-box.ts) fetches the union of the legacy centroid square and the polygon's bounding
-- box. Records the box ADDS are tested against the canonical polygon before they are stored. For a POINT record the test is
-- the point predicate and equals the serving rule. For a LINE or POLYGON record it used the feature's single PIN
-- (half-length point / area centroid) while serving membership is ST_Intersects of the WHOLE geometry
-- (docs/n5-generation-publish.sql step 1). A corridor that crosses the polygon with its pin outside was excluded at fetch
-- time, counted as a correct exclusion, and could never be recovered by N5, which only re-reads geometry for keys that were
-- already stored. This file adds the missing whole-geometry test. Pins remain for DISPLAY; they no longer EXCLUDE.
--
-- THE CONTRACT (read before changing anything; it is pinned by test/zip_scope_members_geom_pg)
--   This is a CONSERVATIVE PREFILTER, not a second membership rule.
--     * It MAY keep a candidate the serving rule would later drop.
--     * It MUST NEVER discard a feature the serving rule would include.
--   N5 remains the only authority for exact geographic membership: it rebuilds the publisher's geometry with its own
--   winding-aware converter and decides ST_Intersects(ST_MakeValid(geometry), ZIP polygon). Nothing here replaces that.
--
-- WHAT IS REUSED, AND WHAT DIFFERS (stated precisely; it is NOT "the same implementation")
--   REUSED, unchanged and not copied:
--     * the ZIP polygon:           geo.zip_membership_boundary(p_zip)
--     * the intersection test:     ST_Intersects(ST_MakeValid(<geometry>), <ZIP polygon>), boundary-INCLUSIVE, SRID 4269
--     * the verdict vocabulary:    member | outside | not_measured | no_coordinates  (same as geo.zip_point_membership_in)
--     * the call contract of public.zip_scope_members: ordered, one row per input element, malformed element ->
--       no_coordinates, malformed CALL raises 22023, service role only.
--   DIFFERENT, deliberately:
--     * Polygons. The serving build interprets ArcGIS rings with the shapefile winding rule (scripts/phase2_b1_zcta.py
--       rings_to_multipolygon_wkt: clockwise = outer, counter-clockwise = hole) and so honours holes. This function does NOT
--       interpret winding. It treats EVERY ring as a FILLED polygon. A holed polygon is therefore replaced by its outer
--       rings, which is a SUPERSET of the serving geometry. Consequence: the only way this function and the serving rule can
--       disagree is "this says member, serving says outside", and the only known case is a ZIP lying entirely inside a hole.
--       That direction is safe by construction; the opposite direction (discarding an included feature) is impossible
--       because the serving geometry is always contained in the union of the filled rings. No second winding
--       implementation is introduced, which is why the Python converter is not re-implemented here.
--     * Lines and points are exact: a path becomes a linestring, a multipoint a multipoint.
--   test/zip_scope_members_geom_pg/parity.py runs the REAL Python serving converter against this function on generated
--   fixtures and fails on any "serving says member, this says outside".
--
-- INPUT  p_feats: a JSON array, at most 200 elements and at most 250000 vertices in total (a larger call RAISES 22023;
--        the engine chunks below both limits and never sends more). Each element:
--          {"k": "rings" | "paths" | "points", "c": [ [ [x,y], [x,y], ... ], ... ]}
--        x = longitude, y = latitude (ArcGIS JSON in outSR 4326), one inner array per ring / path / point set.
-- OUTPUT one row per input element in input order: ord (1-based) | verdict.
--        A malformed or unbuildable element yields 'no_coordinates' for THAT element; it never fails the batch and never
--        loses correspondence. The ENGINE treats 'no_coordinates' as "not tested": it KEEPS the feature, counts it, and
--        reports the read as incomplete (sources/scope-members.ts). It never discards on an unresolved test.
--        A ZIP with no usable boundary yields 'not_measured' for every element.
--
-- ACCESS: service role only. Supabase's default privileges grant EXECUTE on every new public function to anon and
-- authenticated DIRECTLY; `revoke ... from public` does not remove that, so they are revoked by name and proven below.
-- SECURITY DEFINER with a pinned search_path. Additive only: no table is touched.
--
-- ROLLBACK (no data effect): drop function if exists public.zip_scope_members_geom(text, jsonb);
--                            drop function if exists geo.zip_scope_feature_geom(jsonb);
--                            drop function if exists geo.zip_geom_membership_in(geometry, geometry);
-- With the wrapper absent the engine falls back to the legacy scope and reports the read as `fallback` / incomplete.

-- ── 1. the predicate ─────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function geo.zip_geom_membership_in(p_boundary geometry, p_geom geometry)
returns text
language sql
immutable
set search_path = geo, public, pg_temp
as $fn$
  select case
    when p_geom is null or ST_IsEmpty(p_geom) then 'no_coordinates'
    when p_boundary is null then 'not_measured'
    -- Each PART is made valid and tested on its own. A filled hole ring overlaps its own outer ring; making the whole
    -- collection valid at once would XOR them back into a holed polygon and defeat the conservative superset.
    when exists (
      select 1 from ST_Dump(ST_SetSRID(p_geom, 4269)) d
       where ST_Intersects(ST_MakeValid(d.geom), p_boundary)
    ) then 'member'
    else 'outside'
  end;
$fn$;

-- ── 2. one ArcGIS feature -> one geometry (NO winding interpretation; see the header) ────────────────────────────────
create or replace function geo.zip_scope_feature_geom(p_feat jsonb)
returns geometry
language plpgsql
immutable
set search_path = geo, public, pg_temp
as $fn$
declare
  k text;
  part jsonb;
  pts geometry[];
  pt jsonb;
  x double precision;
  y double precision;
  parts geometry[] := '{}';
  first_pt geometry;
  last_pt geometry;
begin
  if p_feat is null or jsonb_typeof(p_feat) <> 'object' or jsonb_typeof(p_feat -> 'c') <> 'array' then
    return null;
  end if;
  k := p_feat ->> 'k';
  if k is null or k not in ('rings', 'paths', 'points') then
    return null;
  end if;

  for part in select value from jsonb_array_elements(p_feat -> 'c') loop
    if jsonb_typeof(part) <> 'array' then
      return null;                                   -- a malformed part makes the whole element unusable (never a guess)
    end if;
    pts := '{}';
    for pt in select value from jsonb_array_elements(part) loop
      if jsonb_typeof(pt) <> 'array' or jsonb_array_length(pt) < 2
         or jsonb_typeof(pt -> 0) <> 'number' or jsonb_typeof(pt -> 1) <> 'number' then
        return null;
      end if;
      x := (pt ->> 0)::double precision;
      y := (pt ->> 1)::double precision;
      if abs(x) > 180 or abs(y) > 90 then
        return null;                                 -- outside the lng/lat domain: not coordinates
      end if;
      pts := pts || ST_SetSRID(ST_MakePoint(x, y), 4269);
    end loop;

    if k = 'points' then
      parts := parts || pts;
    elsif k = 'paths' then
      if coalesce(array_length(pts, 1), 0) >= 2 then
        parts := parts || ST_MakeLine(pts);
      end if;
    else  -- 'rings': every ring is a FILLED polygon (a superset of a holed one); never read as a hole
      if coalesce(array_length(pts, 1), 0) >= 3 then
        first_pt := pts[1];
        last_pt := pts[array_length(pts, 1)];
        if not ST_Equals(first_pt, last_pt) then
          pts := pts || first_pt;                    -- close an unclosed ring
        end if;
        if array_length(pts, 1) >= 4 then
          parts := parts || ST_MakePolygon(ST_MakeLine(pts));
        end if;
      end if;
    end if;
  end loop;

  if coalesce(array_length(parts, 1), 0) = 0 then
    return null;
  end if;
  return ST_SetSRID(ST_Collect(parts), 4269);
exception when others then
  return null;     -- an element that cannot be built (e.g. a number outside double range) is unusable, never a batch failure
end;
$fn$;

-- ── 3. the batch wrapper ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.zip_scope_members_geom(p_zip text, p_feats jsonb)
returns table (ord integer, verdict text)
language plpgsql
stable
security definer
set search_path = geo, public, pg_temp
as $fn$
declare
  b geometry;
  total_vertices bigint;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'zip_scope_members_geom: p_zip must be exactly 5 digits' using errcode = '22023';
  end if;
  if p_feats is null or jsonb_typeof(p_feats) <> 'array' then
    raise exception 'zip_scope_members_geom: p_feats must be a JSON array of features' using errcode = '22023';
  end if;
  if jsonb_array_length(p_feats) > 200 then
    raise exception 'zip_scope_members_geom: at most 200 features per call' using errcode = '22023';
  end if;
  -- bound the work BEFORE any geometry is built (count vertices by walking the arrays; malformed shapes count as 0)
  select coalesce(sum(
           case when jsonb_typeof(f.e) = 'object' and jsonb_typeof(f.e -> 'c') = 'array' then
             (select coalesce(sum(case when jsonb_typeof(p.value) = 'array' then jsonb_array_length(p.value) else 0 end), 0)
                from jsonb_array_elements(f.e -> 'c') p)
           else 0 end), 0)
    into total_vertices
    from jsonb_array_elements(p_feats) f(e);
  if total_vertices > 250000 then
    raise exception 'zip_scope_members_geom: at most 250000 vertices per call' using errcode = '22023';
  end if;

  b := geo.zip_membership_boundary(p_zip);

  return query
  select t.ord::integer, geo.zip_geom_membership_in(b, geo.zip_scope_feature_geom(t.e))
    from jsonb_array_elements(p_feats) with ordinality as t(e, ord)
   order by t.ord;
end;
$fn$;

-- ── 4. privileges ────────────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function geo.zip_geom_membership_in(geometry, geometry) from public;
revoke all on function geo.zip_geom_membership_in(geometry, geometry) from anon, authenticated;
revoke all on function geo.zip_scope_feature_geom(jsonb) from public;
revoke all on function geo.zip_scope_feature_geom(jsonb) from anon, authenticated;
revoke all on function public.zip_scope_members_geom(text, jsonb) from public;
revoke all on function public.zip_scope_members_geom(text, jsonb) from anon, authenticated;
grant execute on function public.zip_scope_members_geom(text, jsonb) to service_role;

-- ── 5. post-conditions: fail the whole migration rather than ship an open or wrong function ─────────────────────────────
do $$
declare box geometry := ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))', 4269);
begin
  if has_function_privilege('anon', 'public.zip_scope_members_geom(text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.zip_scope_members_geom(text,jsonb)', 'execute') then
    raise exception 'zip_scope_members_geom is executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.zip_scope_members_geom(text,jsonb)', 'execute') then
    raise exception 'zip_scope_members_geom is not executable by service_role';
  end if;
  if has_function_privilege('anon', 'geo.zip_geom_membership_in(geometry,geometry)', 'execute')
     or has_function_privilege('authenticated', 'geo.zip_geom_membership_in(geometry,geometry)', 'execute')
     or has_function_privilege('anon', 'geo.zip_scope_feature_geom(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'geo.zip_scope_feature_geom(jsonb)', 'execute') then
    raise exception 'a geo helper is executable by anon/authenticated';
  end if;
  if not (select prosecdef and proconfig::text like '%search_path=geo, public, pg_temp%'
            from pg_proc where oid = 'public.zip_scope_members_geom(text,jsonb)'::regprocedure) then
    raise exception 'zip_scope_members_geom must be SECURITY DEFINER with a pinned search_path';
  end if;
  -- the line that exposed the gap: it CROSSES the box, no vertex and no midpoint pin lies inside it
  if geo.zip_geom_membership_in(box, geo.zip_scope_feature_geom('{"k":"paths","c":[[[-1,1],[3,1]]]}'::jsonb)) <> 'member' then
    raise exception 'a line crossing the polygon was not a member';
  end if;
  if geo.zip_geom_membership_in(box, geo.zip_scope_feature_geom('{"k":"paths","c":[[[5,5],[6,6]]]}'::jsonb)) <> 'outside' then
    raise exception 'a line wholly outside the polygon was not outside';
  end if;
  if geo.zip_geom_membership_in(null, geo.zip_scope_feature_geom('{"k":"paths","c":[[[0,0],[1,1]]]}'::jsonb)) <> 'not_measured' then
    raise exception 'a null boundary was not not_measured';
  end if;
end $$;
