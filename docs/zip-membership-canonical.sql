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
-- WHAT THIS FILE DOES:
--   1. ONE boundary accessor + ONE point predicate, in `geo`. Every membership decision in
--      this file goes through them, and so does Fix 28's retained predicate — there is no
--      second ST_Intersects anywhere on the Map 1 ZIP-mode path.
--   2. The development_reports trigger becomes TYPE-INDEPENDENT on the FACILITY PLANE:
--      every non-development point is STAMPED with the canonical verdict
--      (`zip_membership`), and a verdict of 'outside' removes it from this ZIP's row, with
--      the row's counters reduced by exactly what was removed. The plane is decided by
--      `relevance`, never by Type or source, so a future Type or a future facility feed
--      inherits it with no code of its own.
--   3. DEVELOPMENT-PLANE points in development_reports are CANDIDATES, not members. They
--      are the INPUT to canonical N5 membership (public.n5_expected_input reads
--      app_projects, which app_refresh_zip builds from these rows), so dropping them would
--      destroy the one path that finds a record inside a large ZIP but beyond its own
--      report's retrieval radius. They are never rendered by Map 1 ZIP mode
--      (HS.zipModeSites replaces them with the authoritative plane) and are not stamped.
--      Fix 28's Data-center exclusion of outside development candidates is RETAINED
--      unchanged, now routed through the canonical predicate; it protects app_changes, a
--      non-Map-1 surface, and removing it is a separate decision (see the report).
--   4. public.national_dc_zip_members(p_zip): the national plane read for ZIP mode.
--      Candidates are retrieved by the ZCTA POLYGON'S BOUNDING BOX (complete by
--      construction — no radius can lose an inside record), membership is the canonical
--      predicate, and every row carries its verdict. No boundary -> no rows (Fix 29).
--
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

-- Coordinates in development_reports.sites are TEXT inside jsonb. A malformed value must
-- read as no_coordinates, never raise inside a trigger on the */2 refresh path.
create or replace function geo.jsonb_coord(p jsonb, p_key text)
returns double precision
language sql
immutable
as $function$
  select case when btrim(p->>p_key) ~ '^[-+]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][-+]?[0-9]+)?$'
              then btrim(p->>p_key)::double precision end;
$function$;

-- ── 2. Fix 28's predicate, routed through the canonical one (behaviour unchanged).
create or replace function public.zip_dc_membership_outside(p_zip text, site jsonb, p_geom geometry)
returns boolean
language sql
immutable
set search_path to 'public', 'geo', 'pg_temp'
as $function$
  select p_geom is not null
     and public.map_site_is_datacenter_type(site)
     and (site->>'scope') = 'point'
     and geo.zip_point_membership_in(p_geom, geo.jsonb_coord(site, 'lat'), geo.jsonb_coord(site, 'lng')) = 'outside';
$function$;

-- ── 3. THE ROW ENFORCEMENT — universal on the facility plane.
-- Same trigger, same name, same firing (BEFORE INSERT OR UPDATE OF sites), so every writer
-- — the */2 rolling refresh, a manual refresh, a backfill, a writer that does not exist
-- yet — passes through it.
create or replace function public.dev_reports_enforce_dc_zip_membership()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
declare
  v_geom  geometry;
  v_n_fac int; v_n_dev int; v_n_prop int; v_n_appr int; v_n_oper int; v_n_comm int;
  v_n_drop int;
  v_kept  jsonb;
  v_c     jsonb;
begin
  if jsonb_typeof(new.sites) is distinct from 'array' then
    return new;
  end if;

  v_geom := geo.zip_membership_boundary(new.zip);   -- null => every verdict is not_measured

  -- ONE pass: each element gets the canonical verdict. The facility plane is every POINT
  -- whose relevance is not 'development' (today: all EPA FRS facilities, relevance absent).
  -- The DC-candidate clause is Fix 28's, evaluated only when a boundary exists and only on
  -- the cheap superset Fix 28 measured to be exact.
  with j as (
    select t.o, t.x,
           (t.x->>'scope') = 'point' and coalesce(t.x->>'relevance','') <> 'development' as fac_plane,
           case when (t.x->>'scope') = 'point'
                then geo.zip_point_membership_in(v_geom, geo.jsonb_coord(t.x,'lat'), geo.jsonb_coord(t.x,'lng'))
           end as verdict
      from jsonb_array_elements(new.sites) with ordinality t(x, o)
  ),
  d as (
    select j.*,
           verdict = 'outside' and (
             fac_plane
             or ((position('data' in lower(coalesce(x->>'use_type','') || coalesce(x->>'layer','') || coalesce(x->>'label',''))) > 0
               or position('hyperscal' in lower(coalesce(x->>'use_type','') || coalesce(x->>'layer','') || coalesce(x->>'label',''))) > 0
               or position('server' in lower(coalesce(x->>'use_type','') || coalesce(x->>'layer','') || coalesce(x->>'label',''))) > 0)
                 and public.map_site_is_datacenter_type(x))
           ) as drop_it
      from j
  ),
  agg as (
    select
      coalesce(jsonb_agg(case when fac_plane then x || jsonb_build_object('zip_membership', verdict) else x end
                         order by o) filter (where not drop_it), '[]'::jsonb) as kept,
      count(*) filter (where drop_it)::int as n_drop,
      count(*) filter (where drop_it and coalesce(btrim(coalesce(x->>'registry_id','')),'') <> '')::int as n_fac,
      count(*) filter (where drop_it and x->>'relevance' = 'development')::int as n_dev,
      count(*) filter (where drop_it and x->>'relevance' = 'development' and x->>'type' = 'proposed')::int as n_prop,
      count(*) filter (where drop_it and x->>'relevance' = 'development' and x->>'type' = 'approved')::int as n_appr,
      count(*) filter (where drop_it and x->>'relevance' = 'development' and x->>'type' = 'built')::int as n_oper,
      count(*) filter (where drop_it and (x->>'comment_open')::boolean is true)::int as n_comm
    from d
  )
  select kept, n_drop, n_fac, n_dev, n_prop, n_appr, n_oper, n_comm
    into v_kept, v_n_drop, v_n_fac, v_n_dev, v_n_prop, v_n_appr, v_n_oper, v_n_comm
    from agg;

  new.sites := v_kept;               -- stamped on every write; a removal only when outside
  if v_n_drop = 0 then
    return new;
  end if;

  -- COUNTS FOLLOW MEMBERSHIP (Fix 28's rule, unchanged): each counter is reduced by the
  -- removed records' own contribution, only where the key already exists.
  v_c := coalesce(new.counts, '{}'::jsonb);
  if v_n_fac  > 0 and v_c ? 'facilities'   then v_c := jsonb_set(v_c, '{facilities}',   to_jsonb(greatest(coalesce((v_c->>'facilities')::int,0)   - v_n_fac,  0))); end if;
  if v_n_dev  > 0 and v_c ? 'development'  then v_c := jsonb_set(v_c, '{development}',  to_jsonb(greatest(coalesce((v_c->>'development')::int,0)  - v_n_dev,  0))); end if;
  if v_n_prop > 0 and v_c ? 'proposed'     then v_c := jsonb_set(v_c, '{proposed}',     to_jsonb(greatest(coalesce((v_c->>'proposed')::int,0)     - v_n_prop, 0))); end if;
  if v_n_appr > 0 and v_c ? 'approved'     then v_c := jsonb_set(v_c, '{approved}',     to_jsonb(greatest(coalesce((v_c->>'approved')::int,0)     - v_n_appr, 0))); end if;
  if v_n_oper > 0 and v_c ? 'operating'    then v_c := jsonb_set(v_c, '{operating}',    to_jsonb(greatest(coalesce((v_c->>'operating')::int,0)    - v_n_oper, 0))); end if;
  if v_n_comm > 0 and v_c ? 'comment_open' then v_c := jsonb_set(v_c, '{comment_open}', to_jsonb(greatest(coalesce((v_c->>'comment_open')::int,0) - v_n_comm, 0))); end if;
  new.counts := v_c;
  return new;
end
$function$;

-- ── 4. THE NATIONAL PLANE FOR ZIP MODE.
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

commit;

-- =====================================================================================
-- BACKFILL. The trigger does the work; touching `sites` fires it. No timestamp moves.
--   ⛔ NEVER CONCURRENTLY. On 2026-09-22 four parallel ~50 MB batches of
--      `update ... set sites = sites` preceded a silent production Postgres restart (22:27:21Z).
--   Applied instead as ONE sequential pg_cron job, <= ~3 MB compressed per minute, SKIP LOCKED
--   against the rolling refresh, self-unscheduling (migration zip_membership_backfill_job):
--     geo.zip_membership_backfill (zip, done_at)   geo.zip_membership_backfill_step()
--     cron job 'zip-membership-backfill-once'
--   Drop both objects once every row is done.
-- Then re-materialize affected ZIPs (app_refresh_zip) so app_projects follows the row;
-- app_refresh_sweep reaches them within ~7 h regardless.
--
-- ROLLBACK: re-run docs/fix28-datacenter-zip-membership.sql §2-§3 (restores the DC-only
-- trigger body and predicate) and `drop function public.national_dc_zip_members(text)`
-- after reverting homesignalmap.html. Removed facility points return on each ZIP's next
-- engine refresh.
-- =====================================================================================
