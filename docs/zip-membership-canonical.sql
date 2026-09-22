-- =====================================================================================
-- ZIP MEMBERSHIP IS GEOGRAPHY, NOT PROXIMITY — ONE CANONICAL AUTHORITY (DDL of record)
--
-- THE RULE (founder, 2026-09-04, restated 2026-09-22 for EVERY Type and EVERY source):
--   A ZIP search represents the ENTIRE authoritative ZIP/ZCTA geography. A record belongs
--   to a ZIP iff ST_Intersects(point, authoritative ZCTA boundary) — boundary-inclusive.
--   Never a centroid, a radius, a nearest point, a buffer or a candidate-retrieval circle.
--   Type classification and source provenance are INPUTS TO NOTHING HERE.
--
-- WHAT WAS FOUND, measured on production 2026-09-22 before this file (no sampling):
--   * Authoritative development (geo.zip_authoritative_marker, the N5 plane): 1,004,080
--     markers, 1,004,080 inside, 0 outside. Already canonical — untouched here.
--   * NATIONAL DATA-CENTER plane (public.national_dc_for_zip, called by Map 1 ZIP mode with
--     p_radius_mi => 5): membership was a 5-mile great-circle radius around
--     development_reports.home_lat/home_lng — a ZIP CENTROID. Over the 12,013 ZIPs Fix 29
--     admits: 8,369 placements served, 1,014 inside, 7,355 OUTSIDE, on 1,918 ZIP pages;
--     and 69 true members (inside the polygon, beyond 5 mi) on 25 ZIP pages were NEVER
--     served. Both directions of the defect, in one function.
--   * FACILITY plane (development_reports.sites points that are not development): 216,221
--     points, 103,724 OUTSIDE their ZIP's boundary. Every one draws a TYPE pin — the shipped
--     resolver (lib/map.js HS.resolveMarker, overlay-on-Type + dual identity) maps the only
--     four class inputs in production, layer industrial / energy / logistics / datacenter,
--     to Industrial / Roads & infrastructure / Industrial / Data center. A Type pin is a
--     claim about the ZIP (Fix 28's own root-cause statement). Fix 28 enforced membership
--     for Data center ONLY; every other Type kept radius membership.
--
-- WHAT THIS FILE DOES (AS APPLIED — read the REVERTED note before replaying anything):
--   1. ONE boundary accessor + ONE point predicate, in `geo`. The national read below calls
--      them; nothing in this file carries a second ST_Intersects.
--   2. public.national_dc_zip_members(p_zip): the national plane read for ZIP mode.
--      Candidates are retrieved by the ZCTA POLYGON'S BOUNDING BOX (complete by
--      construction — no radius can lose an inside record), membership is the canonical
--      predicate, and every row carries its verdict. No boundary -> no rows (Fix 29).
--      Measured after, all 12,722 canonical ZIPs, independent ST_Covers: 1,083 served,
--      1,083 inside, 0 outside, 1,083 true members, 0 missed.
--
-- ⛔ REVERTED THE SAME DAY — THE FACILITY PLANE IS STILL OPEN. This file first also replaced
--   public.dev_reports_enforce_dc_zip_membership() (the Fix 28 trigger) with a plane-wide
--   version that stamped every facility with its verdict and removed outside ones for every
--   Type. It rebuilt the whole `sites` array on EVERY write (Fix 28 rebuilds only when a
--   correction is needed; rows reach 19.6 MB). Its backfill — first four concurrent ~50 MB
--   batches, then one sequential <= 3 MB/min cron job — coincided with THREE production
--   Postgres restarts (22:27:21Z, 22:34:30Z "not properly shut down", 22:36:36Z), with none in
--   the 24 h before. The Fix 28 bodies were restored verbatim (migration
--   revert_zip_membership_trigger_to_fix28; md5 b4697ba0… / 22479bc5… equal Fix 28's parity
--   record) and the backfill objects dropped. That trigger is deliberately NOT in this file,
--   so replaying it cannot reinstall it. Rows it had already rewritten keep their stamps until
--   the rolling refresh rewrites them; nothing reads the stamp.

-- MISSING GEOMETRY: 'not_measured'. Never a centroid, never a radius, never "empty".
-- =====================================================================================

begin;

-- ── 1a. THE BOUNDARY ACCESSOR — the ONE definition of "usable authoritative ZIP geometry".
-- Same filters Fix 28 applied inline (polygonal, non-empty). geo.zcta_boundary is TIGER/Line
-- 2025 (2020 ZCTA delineation), SRID 4269, unique on zcta5, GiST-indexed on geom.
create or replace function geo.zip_membership_boundary(p_zip text)
returns geometry
language sql
stable
set search_path to 'geo', 'public', 'pg_temp'
as $function$
  select b.geom
    from geo.zcta_boundary b
   where b.zcta5 = p_zip
     and b.geom is not null
     and ST_GeometryType(b.geom) in ('ST_Polygon', 'ST_MultiPolygon')
     and not ST_IsEmpty(b.geom);
$function$;

-- ── 1b. THE POINT PREDICATE — the ONE definition of point-in-ZIP.
-- Takes the boundary rather than the ZIP so a caller testing many points against one ZIP
-- detoasts the polygon once. Verdicts (closed vocabulary):
--   'member'         ST_Intersects(point, boundary) — boundary-INCLUSIVE. For a point this
--                    equals ST_Covers; ZCTAs tile the country, so an edge point belongs to
--                    both neighbours rather than to neither (exclusive = silent exclusion).
--   'outside'        a usable boundary exists and the point does not touch it.
--   'not_measured'   no usable boundary. NEVER a substitute geometry.
--   'no_coordinates' the record has no usable coordinate to test.
-- The point expression is the one N5's driver uses: ST_SetSRID(ST_MakePoint(lng, lat), 4269).
create or replace function geo.zip_point_membership_in(p_boundary geometry, p_lat double precision, p_lng double precision)
returns text
language sql
immutable
set search_path to 'geo', 'public', 'pg_temp'
as $function$
  select case
    when p_lat is null or p_lng is null
      or p_lat = 'NaN'::float8 or p_lng = 'NaN'::float8
      or p_lat not between -90 and 90 or p_lng not between -180 and 180 then 'no_coordinates'
    when p_boundary is null then 'not_measured'
    when ST_Intersects(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4269), p_boundary) then 'member'
    else 'outside'
  end;
$function$;

-- ── 1c. The by-ZIP convenience form. Composition of the two above; decides nothing itself.
create or replace function geo.zip_point_membership(p_zip text, p_lat double precision, p_lng double precision)
returns text
language sql
stable
set search_path to 'geo', 'public', 'pg_temp'
as $function$
  select geo.zip_point_membership_in(geo.zip_membership_boundary(p_zip), p_lat, p_lng);
$function$;

comment on function geo.zip_point_membership_in(geometry, double precision, double precision) is
  'CANONICAL ZIP point membership: ST_Intersects(point, authoritative ZCTA boundary), '
  'boundary-inclusive. Verdicts member|outside|not_measured|no_coordinates. Takes no Type '
  'and no source — neither can change membership. docs/zip-membership-canonical.sql.';

-- ── 2. THE NATIONAL PLANE FOR ZIP MODE.
-- Same row shape as national_dc_for_zip so HS.nationalPlaneResult reads it unchanged, plus
-- `zip_membership` per row. distance_mi is NULL: ZIP mode has no HOME (zip-authoritative.js
-- rule 3). Candidate retrieval is the polygon's bounding box, which CONTAINS every member,
-- so completeness does not depend on any radius; the predicate then decides.
create or replace function public.national_dc_zip_members(p_zip text)
returns table(source_key text, source_name text, source_url text, project_name text,
              developer_or_operator text, raw_status text, normalized_status text,
              project_type text, lat double precision, lng double precision,
              location_text text, location_precision text, distance_mi numeric,
              last_seen_at timestamptz, has_more boolean, zip_membership text)
language sql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
  with g as (select geo.zip_membership_boundary(p_zip) as geom),
  bb as (select geom, ST_XMin(geom) x0, ST_XMax(geom) x1, ST_YMin(geom) y0, ST_YMax(geom) y1
           from g where geom is not null),
  lim as (select 1000::int as n),
  hits as (
    select r.source_key, r.source_name, r.source_url, r.project_name, r.developer_or_operator,
           r.raw_status, r.normalized_status, r.project_type, r.lat, r.lng,
           r.location_text, r.location_precision, r.last_seen_at,
           geo.zip_point_membership_in(bb.geom, r.lat, r.lng) as verdict
      from public.national_dc_records r, bb
     where r.map_eligible
       and r.lat between bb.y0 and bb.y1
       and r.lng between bb.x0 and bb.x1),
  members as (
    select * from hits where verdict = 'member'
     order by source_key
     limit (select n + 1 from lim)),
  counted as (select count(*) over () as total, members.* from members)
  select c.source_key, c.source_name, c.source_url, c.project_name, c.developer_or_operator,
         c.raw_status, c.normalized_status, c.project_type, c.lat, c.lng,
         c.location_text, c.location_precision, null::numeric as distance_mi, c.last_seen_at,
         (c.total > (select n from lim)) as has_more, c.verdict as zip_membership
    from counted c
   order by c.source_key
   limit (select n from lim);
$function$;

revoke all on function public.national_dc_zip_members(text) from public;
grant execute on function public.national_dc_zip_members(text) to anon, authenticated, service_role;

-- ── 3. THE FACILITY PLANE FOR ZIP MODE — a READ, never a rewrite (2026-09-22, second design).
-- Map 1 ZIP mode used to download development_reports.sites whole (up to 19.6 MB of text,
-- ~95% development candidates it throws away) and draw every non-development point in it:
-- the EPA facility plane, radius-derived, every point a Type pin. This returns, for ONE ZIP:
--   * area / jurisdiction notices (scope <> 'point') unchanged — not point claims;
--   * facility-plane points (scope 'point', relevance <> 'development') whose canonical verdict
--     is 'member', each stamped `zip_membership: 'member'` IN THE RESPONSE ONLY;
--   * the verdict counts, so the page's facility tile counts the SAME population it draws.
-- Development points are not returned (Map 1 replaces them with the authoritative plane).
-- Nothing is written: the stored row is untouched, so the rolling refresh, Fix 28's trigger
-- and every other consumer see exactly what they saw before. The design that rewrote these
-- arrays coincided with three production restarts and is not repeated.
-- No boundary -> status 'not_measured' and NO facility points (never a radius substitute).
-- Measured before shipping (read-only, production): p50 1.7 ms / p95 11.6 ms / max 67 ms over
-- 200 random ZIPs; p50 83 / p95 127 / max 138 ms over the 20 largest report rows.
create or replace function public.zip_mode_report_sites(p_zip text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
declare
  v_sites jsonb;
  v_geom  geometry;
  v_out   jsonb;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;
  select d.sites into v_sites from public.development_reports d where d.zip = p_zip;
  if not found or jsonb_typeof(v_sites) is distinct from 'array' then
    return jsonb_build_object('zip', p_zip, 'status', 'no_report', 'sites', '[]'::jsonb,
      'facility_counts', jsonb_build_object('member', 0, 'outside', 0, 'not_measured', 0, 'no_coordinates', 0));
  end if;
  v_geom := geo.zip_membership_boundary(p_zip);
  with e as (
    select t.o, t.x,
           (t.x->>'scope') = 'point' as is_point,
           coalesce(t.x->>'relevance', '') = 'development' as is_dev
      from jsonb_array_elements(v_sites) with ordinality t(x, o)
  ),
  v as (
    select e.*,
           case when is_point and not is_dev then geo.zip_point_membership_in(v_geom,
                  case when x->>'lat' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then (x->>'lat')::float8 end,
                  case when x->>'lng' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then (x->>'lng')::float8 end)
           end as verdict
      from e
     where not (is_point and is_dev)
  )
  select jsonb_build_object(
           'zip', p_zip,
           'status', case when v_geom is null then 'not_measured' else 'complete' end,
           'sites', coalesce(jsonb_agg(case when is_point then x || jsonb_build_object('zip_membership', verdict) else x end
                                       order by o) filter (where not is_point or verdict = 'member'), '[]'::jsonb),
           'facility_counts', jsonb_build_object(
              'member',         count(*) filter (where verdict = 'member'),
              'outside',        count(*) filter (where verdict = 'outside'),
              'not_measured',   count(*) filter (where verdict = 'not_measured'),
              'no_coordinates', count(*) filter (where verdict = 'no_coordinates')))
    into v_out
    from v;
  return v_out;
end
$function$;

revoke all on function public.zip_mode_report_sites(text) from public;
grant execute on function public.zip_mode_report_sites(text) to anon, authenticated, service_role;

commit;

-- =====================================================================================
-- ROLLBACK: revert homesignalmap.html to call national_dc_for_zip, then
--   drop function public.national_dc_zip_members(text);
--   drop function geo.zip_point_membership(text, double precision, double precision);
--   drop function geo.zip_point_membership_in(geometry, double precision, double precision);
--   drop function geo.zip_membership_boundary(text);
-- =====================================================================================
