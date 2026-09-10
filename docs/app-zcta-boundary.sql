-- PCM-3 — the ZCTA boundary delivery contract. DDL of record.
--
-- WHAT THIS EXISTS FOR. HS.buildLive can draw and fit a polygon (PCM-2), and nothing in the
-- browser can reach one: geo has no USAGE for anon or authenticated, and it must not get any.
-- The FUNCTION is the delivery surface, not the table — the same reason recorded in
-- docs/n5-unit-a4-delivery-contract.sql.
--
-- WHY THE TRANSFORM IS EXPLICIT AND NOT ASSUMED. geo.zcta_boundary stores the publisher's own
-- geometry at the SRID its .prj declares — 4269 (NAD83) for the TIGER/Line 2025 vintage. NAD83
-- and WGS84 differ by ~1-2 m in CONUS, so a 4269 ring "looks like" lon/lat and would render
-- without complaint. Leaflet and MapLibre both mean WGS84 by "GeoJSON", and RFC 7946 says so.
-- Shipping 4269 because it looks close enough is a silent CRS guess. The transform happens
-- HERE, at read time; the stored rows stay 4269 and are never rewritten to "make Leaflet happy".
--
-- WHY NOT anon. Census ZCTA polygons are public data — the CAPABILITY is not. ZIP context
-- visualization is authenticated-only (the A-022 posture on /community/<zip>/), so PCM-4 will
-- call this under a signed-in session (JWT -> authenticated). Granting anon here would put the
-- capability on the protected public acquisition surface by accident.
--
-- Least privilege: SECURITY DEFINER, fixed search_path, no dynamic SQL, the input validated
-- against a closed pattern, EXECUTE revoked from PUBLIC and granted explicitly.

create or replace function public.app_zcta_boundary(p_zip text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
declare
  v_geom geometry;
begin
  -- Closed vocabulary, refused rather than coerced. Same errcode as
  -- public.app_zip_projects_markers, so a caller handles one shape of refusal.
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;

  select b.geom into v_geom from geo.zcta_boundary b where b.zcta5 = p_zip;

  -- NOT MEASURED IS NOT EMPTY, AND NEITHER IS A CIRCLE.
  -- A ZIP with no stored polygon returns status 'not_measured' with geometry NULL. It is not
  -- an error, it is not [], and it is NEVER substituted: no ST_Buffer around a centroid, no
  -- ST_Envelope of anything, no radius. lib/zip-authoritative.js rule 1 is the same rule from
  -- the other side — collapsing "nobody measured this" into "this is empty" renders a claim
  -- the data cannot support, and a circle drawn where a boundary was asked for is worse: it
  -- is a fabricated geography that looks deliberate.
  --
  -- A stored non-areal geometry (which the loader's geometry(MultiPolygon, …) column should
  -- make impossible) is treated as no usable polygon rather than coerced into one.
  if v_geom is null or ST_GeometryType(v_geom) not in ('ST_Polygon', 'ST_MultiPolygon') then
    return jsonb_build_object('zip', p_zip,
                              'status', 'not_measured',
                              'srid', null,
                              'geometry', null);
  end if;

  return jsonb_build_object(
    'zip', p_zip,
    'status', 'boundary_complete',
    'srid', 4326,
    -- ::jsonb so the caller receives a GeoJSON OBJECT, not a string it has to re-parse.
    'geometry', ST_AsGeoJSON(ST_Transform(v_geom, 4326))::jsonb);
end
$function$;

comment on function public.app_zcta_boundary(text) is
  'One ZIP''s authoritative ZCTA boundary as WGS84 GeoJSON, or not_measured + null. The '
  'delivery surface for geo.zcta_boundary, which the browser roles cannot read. Never '
  'substitutes a circle, envelope or centroid for a missing polygon.';

-- The schema comment said "no production consumer reads it". This function is that
-- consumer, so the comment is corrected HERE rather than only in the loader's finalize
-- transaction — the statement becomes true when the FUNCTION is deployed, which may be
-- before (or without) a national load.
comment on schema geo is
  'Phase 2 authoritative geographic layer. NOT exposed through PostgREST (no USAGE to '
  'anon/authenticated). Read by exactly one production consumer: the SECURITY DEFINER '
  'function public.app_zcta_boundary(text), which transforms to 4326 at read time.';

-- PRIVILEGES. anon is deliberately absent: the capability is authenticated-only.
--
-- REVOKING FROM `public` IS NOT ENOUGH, AND THE LIVE PROOF IS WHAT CAUGHT IT. This project
-- carries default privileges that grant `anon` EXECUTE on new functions in schema public, so
-- after the first deploy of this file — which revoked PUBLIC and granted only authenticated
-- and service_role — has_function_privilege('anon', …, 'EXECUTE') was still TRUE.
-- `PUBLIC` is the pseudo-role every role inherits; `anon` is a NAMED role holding its own
-- grant, and revoking the first does not touch the second. The offline test asserted the
-- FILE contained no `to anon` grant, which was true and irrelevant: nothing in this file
-- granted it. Only asking the database found it.
revoke all on function public.app_zcta_boundary(text) from public;
revoke all on function public.app_zcta_boundary(text) from anon;
grant execute on function public.app_zcta_boundary(text) to authenticated, service_role;

-- NOTE, deliberately NOT executed here: `grant usage on schema geo` appears nowhere in this
-- file and must never be added. The definer function reads geo as its owner; granting the
-- schema would expose every geo table through PostgREST.
