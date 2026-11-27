-- Executable checks for docs/zip-scope-members-geom.sql against a disposable PostGIS (never production).
-- Coordinates in features are [x=lng, y=lat]. ZIP 90001 is an L-SHAPE: arms x in [0,2],y in [0,1] and x in [0,1],y in [1,2];
-- the notch x in (1,2], y in (1,2] is INSIDE its bounding box and OUTSIDE the polygon. 90003 is a small square used for holes.
\set ON_ERROR_STOP 0
create temp table res(name text, ok boolean, detail text);
create or replace function pg_temp.chk(n text, ok boolean, d text default '') returns void language sql as
$$ insert into res values (n, coalesce(ok,false), d) $$;
-- the verdict of ONE feature
create or replace function pg_temp.v(z text, k text, c text) returns text language sql as
$$ select verdict from public.zip_scope_members_geom(z, jsonb_build_array(jsonb_build_object('k', k, 'c', c::jsonb))) $$;
-- the SERVING rule on the same feature, built the way the serving build builds it (winding aware, holes honoured)
create or replace function pg_temp.serving_poly(outer_ring text, hole text default null) returns geometry language sql as
$$ select ST_SetSRID(case when hole is null then ST_MakePolygon(ST_GeomFromText(outer_ring))
                          else ST_MakePolygon(ST_GeomFromText(outer_ring), array[ST_GeomFromText(hole)]) end, 4269) $$;

-- 1 LINES: the case that exposed the gap
select pg_temp.chk('G01 a line that CROSSES the polygon with its midpoint pin OUTSIDE is a member (the known gap, closed)',
  pg_temp.v('90001','paths','[[[-5,0.5],[2.5,0.5]]]') = 'member');
select pg_temp.chk('G02 a crossing line with NO vertex inside the polygon is a member (a vertex-only test would miss it)',
  pg_temp.v('90001','paths','[[[-1,0.5],[3,0.5]]]') = 'member');
select pg_temp.chk('G03 a line wholly outside is outside', pg_temp.v('90001','paths','[[[5,5],[6,6]]]') = 'outside');
select pg_temp.chk('G04 a line inside the BBOX but in the L-notch (outside the polygon) is outside',
  pg_temp.v('90001','paths','[[[1.2,1.2],[1.8,1.8]]]') = 'outside');
select pg_temp.chk('G05 boundary-INCLUSIVE: a line ending exactly on a polygon vertex is a member',
  pg_temp.v('90001','paths','[[[-1,2],[0,2]]]') = 'member');
select pg_temp.chk('G06 a line along the shared edge is a member of BOTH neighbours',
  pg_temp.v('90001','paths','[[[1,0],[1,1]]]') = 'member' and pg_temp.v('90002','paths','[[[1,0],[1,1]]]') = 'member');
select pg_temp.chk('G07 MULTIPART line: one part inside is enough; all parts outside is outside',
  pg_temp.v('90001','paths','[[[-5,-5],[-4,-4]],[[0.5,0.5],[0.6,0.6]]]') = 'member'
  and pg_temp.v('90001','paths','[[[-5,-5],[-4,-4]],[[7,7],[8,8]]]') = 'outside');

-- 2 POLYGONS
select pg_temp.chk('G08 a polygon straddling the boundary is a member',
  pg_temp.v('90001','rings','[[[1.5,0.5],[1.5,0.9],[3,0.9],[3,0.5],[1.5,0.5]]]') = 'member');
select pg_temp.chk('G09 a polygon wholly outside is outside',
  pg_temp.v('90001','rings','[[[5,5],[5,6],[6,6],[6,5],[5,5]]]') = 'outside');
select pg_temp.chk('G10 a polygon that CONTAINS the ZIP is a member',
  pg_temp.v('90001','rings','[[[-5,-5],[-5,5],[5,5],[5,-5],[-5,-5]]]') = 'member');
select pg_temp.chk('G11 a polygon inside the BBOX but wholly in the notch is outside (bbox is not membership)',
  pg_temp.v('90001','rings','[[[1.2,1.2],[1.2,1.8],[1.8,1.8],[1.8,1.2],[1.2,1.2]]]') = 'outside');
select pg_temp.chk('G12 MULTIPART polygon: one far part and one overlapping part is a member',
  pg_temp.v('90001','rings','[[[20,20],[20,21],[21,21],[21,20],[20,20]],[[1.5,0.5],[1.5,0.9],[3,0.9],[3,0.5],[1.5,0.5]]]') = 'member');
select pg_temp.chk('G13 a polygon touching the boundary at ONE point is a member (inclusive)',
  pg_temp.v('90001','rings','[[[2,0],[3,0],[3,-1],[2,-1],[2,0]]]') = 'member');
select pg_temp.chk('G14 an UNCLOSED ring is closed, not rejected',
  pg_temp.v('90001','rings','[[[1.5,0.5],[1.5,0.9],[3,0.9],[3,0.5]]]') = 'member');
select pg_temp.chk('G15 a self-intersecting (bow-tie) ring that crosses the polygon does not fail and is a member',
  pg_temp.v('90001','rings','[[[-1,-1],[3,3],[3,-1],[-1,3],[-1,-1]]]') = 'member');

-- 3 HOLES: ArcGIS convention is clockwise = outer, counter-clockwise = hole. The filter does NOT read winding.
select pg_temp.chk('G16 a hole that covers only PART of the ZIP leaves the ZIP a member (and the serving rule agrees)',
  pg_temp.v('90001','rings','[[[-1,-1],[-1,3],[3,3],[3,-1],[-1,-1]],[[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8],[0.2,0.2]]]') = 'member'
  and geo.zip_geom_membership_in(geo.zip_membership_boundary('90001'),
        pg_temp.serving_poly('LINESTRING(-1 -1,-1 3,3 3,3 -1,-1 -1)','LINESTRING(0.2 0.2,0.8 0.2,0.8 0.8,0.2 0.8,0.2 0.2)')) = 'member');
select pg_temp.chk('G17 THE ONE KNOWN ASYMMETRY: a ZIP wholly inside a hole is a CONSERVATIVE member here while the serving geometry says outside',
  pg_temp.v('90003','rings','[[[5,5],[5,20],[20,20],[20,5],[5,5]],[[9,9],[12,9],[12,12],[9,12],[9,9]]]') = 'member'
  and geo.zip_geom_membership_in(geo.zip_membership_boundary('90003'),
        pg_temp.serving_poly('LINESTRING(5 5,5 20,20 20,20 5,5 5)','LINESTRING(9 9,12 9,12 12,9 12,9 9)')) = 'outside');

-- 4 POINTS and the consistency of the two predicates
select pg_temp.chk('G18 a multipoint with one point inside is a member; all outside is outside',
  pg_temp.v('90001','points','[[[0.5,0.5],[9,9]]]') = 'member' and pg_temp.v('90001','points','[[[9,9]]]') = 'outside');
select pg_temp.chk('G19 over a 1000-point grid the geometry predicate on a one-point geometry equals geo.zip_point_membership_in',
  (select count(*) from (
     select g.i, h.j,
            geo.zip_geom_membership_in(geo.zip_membership_boundary('90001'), ST_SetSRID(ST_MakePoint(h.j/100.0, g.i/100.0),4269)) as got,
            geo.zip_point_membership_in(geo.zip_membership_boundary('90001'), g.i/100.0, h.j/100.0) as want
       from generate_series(-20,220,8) g(i) cross join generate_series(-20,220,8) h(j)
     ) q where got is distinct from want) = 0);

-- 5 UNUSABLE ELEMENTS never fail the batch and never lose correspondence
select pg_temp.chk('G20 degenerate geometry is no_coordinates: ring of two points, path of one point, empty parts',
  pg_temp.v('90001','rings','[[[0,0],[1,1]]]') = 'no_coordinates'
  and pg_temp.v('90001','paths','[[[0,0]]]') = 'no_coordinates'
  and pg_temp.v('90001','paths','[]') = 'no_coordinates');
select pg_temp.chk('G21 malformed ELEMENTS are no_coordinates, order and count preserved',
  (select string_agg(ord||':'||verdict, ',' order by ord) from public.zip_scope_members_geom('90001',
    '[{"k":"paths","c":[[[0.5,0.5],[0.6,0.6]]]},"x",{"k":"zzz","c":[]},{"k":"paths"},{"k":"paths","c":[[[999,0],[1,1]]]},{"k":"paths","c":[["a"]]},{"k":"paths","c":[[[0,1e400],[1,1]]]},{"k":"rings","c":[[[1.5,0.5],[1.5,0.9],[3,0.9],[3,0.5],[1.5,0.5]]]}]'))
  = '1:member,2:no_coordinates,3:no_coordinates,4:no_coordinates,5:no_coordinates,6:no_coordinates,7:no_coordinates,8:member');
select pg_temp.chk('G22 a ZIP with no boundary: every element not_measured (never a guess)',
  (select string_agg(distinct verdict,',') from public.zip_scope_members_geom('00000',
    '[{"k":"paths","c":[[[0,0],[1,1]]]},{"k":"rings","c":[[[0,0],[0,1],[1,1],[0,0]]]}]')) = 'not_measured');
select pg_temp.chk('G23 an empty array returns no rows', (select count(*) from public.zip_scope_members_geom('90001','[]')) = 0);
select pg_temp.chk('G24 order and count preserved on a mixed batch',
  (select string_agg(ord||':'||verdict, ',' order by ord) from public.zip_scope_members_geom('90001',
    '[{"k":"paths","c":[[[-5,0.5],[2.5,0.5]]]},{"k":"paths","c":[[[5,5],[6,6]]]},{"k":"rings","c":[[[1.2,1.2],[1.2,1.8],[1.8,1.8],[1.8,1.2],[1.2,1.2]]]},{"k":"points","c":[[[0.5,0.5]]]}]'))
  = '1:member,2:outside,3:outside,4:member');

-- 6 malformed CALLS raise (the caller must then use its fallback, never guess)
do $$ begin perform * from public.zip_scope_members_geom('9000','[]'); perform pg_temp.chk('G25a short ZIP raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('G25a short ZIP raises', true); end $$;
do $$ begin perform * from public.zip_scope_members_geom('90001','{"a":1}'); perform pg_temp.chk('G25b non-array raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('G25b non-array raises', true); end $$;
do $$ begin perform * from public.zip_scope_members_geom('90001', null); perform pg_temp.chk('G25c null features raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('G25c null features raises', true); end $$;
do $$ begin perform * from public.zip_scope_members_geom(null, '[]'); perform pg_temp.chk('G25d null ZIP raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('G25d null ZIP raises', true); end $$;
do $$ begin
  perform * from public.zip_scope_members_geom('90001', (select jsonb_agg('{"k":"points","c":[[[0.5,0.5]]]}'::jsonb) from generate_series(1,201)));
  perform pg_temp.chk('G26 201 features raises (bounded batch)', false);
exception when sqlstate '22023' then perform pg_temp.chk('G26 201 features raises (bounded batch)', true); end $$;
select pg_temp.chk('G26b exactly 200 features is accepted',
  (select count(*) from public.zip_scope_members_geom('90001', (select jsonb_agg('{"k":"points","c":[[[0.5,0.5]]]}'::jsonb) from generate_series(1,200)))) = 200);
do $$ begin
  perform * from public.zip_scope_members_geom('90001', jsonb_build_array(jsonb_build_object('k','paths','c',
    jsonb_build_array((select jsonb_agg(jsonb_build_array(0.5,0.5)) from generate_series(1,250001))))));
  perform pg_temp.chk('G27 250001 vertices raises (bounded work, checked BEFORE any geometry is built)', false);
exception when sqlstate '22023' then perform pg_temp.chk('G27 250001 vertices raises (bounded work, checked BEFORE any geometry is built)', true); end $$;

-- 7 privileges
select pg_temp.chk('G28 anon cannot execute the wrapper or either helper',
  not has_function_privilege('anon','public.zip_scope_members_geom(text,jsonb)','execute')
  and not has_function_privilege('anon','geo.zip_geom_membership_in(geometry,geometry)','execute')
  and not has_function_privilege('anon','geo.zip_scope_feature_geom(jsonb)','execute'));
select pg_temp.chk('G29 authenticated cannot execute the wrapper or either helper',
  not has_function_privilege('authenticated','public.zip_scope_members_geom(text,jsonb)','execute')
  and not has_function_privilege('authenticated','geo.zip_geom_membership_in(geometry,geometry)','execute')
  and not has_function_privilege('authenticated','geo.zip_scope_feature_geom(jsonb)','execute'));
select pg_temp.chk('G30 service_role can execute the wrapper',
  has_function_privilege('service_role','public.zip_scope_members_geom(text,jsonb)','execute'));
select pg_temp.chk('G31 the wrapper is SECURITY DEFINER with a pinned search_path',
  (select prosecdef and proconfig::text like '%search_path=geo, public, pg_temp%' from pg_proc where oid='public.zip_scope_members_geom(text,jsonb)'::regprocedure));

-- 8 performance bound: 200 features of 100 vertices each in one call
do $$ declare t0 timestamptz := clock_timestamp(); n int; ms numeric;
begin
  select count(*) into n from public.zip_scope_members_geom('90001',
    (select jsonb_agg(jsonb_build_object('k','paths','c',
        jsonb_build_array((select jsonb_agg(jsonb_build_array(random()*4-1, random()*4-1)) from generate_series(1,100))))) from generate_series(1,200)));
  ms := extract(milliseconds from clock_timestamp()-t0);
  perform pg_temp.chk('G32 200 features x 100 vertices < 2000 ms', n=200 and ms<2000, ms::text||' ms');
end $$;

select name||'|'||case when ok then 't' else 'f' end||'|'||detail from res order by name;
