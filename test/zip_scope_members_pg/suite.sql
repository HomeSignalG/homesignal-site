-- Executable checks for docs/zip-scope-members.sql against a disposable PostGIS.
-- ZIP 90001 is an L-SHAPE (irregular, bbox far larger than the polygon); 90002 is its neighbour
-- sharing the edge x=1 for y in [0,1]. Nothing here is a real ZIP; the logic is ZIP-agnostic.
\set ON_ERROR_STOP 0
create temp table res(name text, ok boolean, detail text);
create or replace function pg_temp.chk(n text, ok boolean, d text default '') returns void language sql as
$$ insert into res values (n, coalesce(ok,false), d) $$;

-- 1 correspondence + verdict per class (lat,lng pairs)
select pg_temp.chk('M01 L-shape: inside the vertical arm is member',
  (select verdict from public.zip_scope_members('90001','[[0.5,0.5]]') )='member');
select pg_temp.chk('M02 L-shape: inside the foot is member',
  (select verdict from public.zip_scope_members('90001','[[0.5,1.5]]') )='member');
select pg_temp.chk('M03 L-shape: BBOX-ONLY corner (inside bbox, outside polygon) is outside',
  (select verdict from public.zip_scope_members('90001','[[1.5,1.5]]') )='outside');
select pg_temp.chk('M04 boundary-INCLUSIVE: a vertex on the edge is member (and so is the shared edge for the neighbour)',
  (select string_agg(verdict,',') from public.zip_scope_members('90001','[[1.0,1.5]]'))='member'
  and (select string_agg(verdict,',') from public.zip_scope_members('90002','[[1.0,1.5]]'))='member');
select pg_temp.chk('M05 far outside the bbox is outside',
  (select verdict from public.zip_scope_members('90001','[[40,-100]]') )='outside');
select pg_temp.chk('M06 centroid proximity is NOT membership (point 0.01 outside, near centroid of bbox)',
  (select verdict from public.zip_scope_members('90001','[[1.01,1.01]]') )='outside');
select pg_temp.chk('M07 order and count preserved on a mixed batch',
  (select string_agg(ord||':'||verdict, ',' order by ord) from public.zip_scope_members('90001',
    '[[0.5,0.5],[1.5,1.5],[40,-100],[0.5,1.5],[1.0,1.5]]'))
  = '1:member,2:outside,3:outside,4:member,5:member');
select pg_temp.chk('M08 malformed ELEMENTS are no_coordinates and do not lose correspondence',
  (select string_agg(ord||':'||verdict, ',' order by ord) from public.zip_scope_members('90001',
    '[[0.5,0.5],"x",[999,1],[1],[null,1],[0.5,0.5,9],[0.5,"a"],[1e400,1],[0.5,0.5]]'))
  = '1:member,2:no_coordinates,3:no_coordinates,4:no_coordinates,5:no_coordinates,6:no_coordinates,7:no_coordinates,8:no_coordinates,9:member');
select pg_temp.chk('M09 ZIP with no boundary: every element not_measured (never a guess)',
  (select string_agg(distinct verdict,',') from public.zip_scope_members('00000','[[0.5,0.5],[1.5,1.5]]'))='not_measured');
select pg_temp.chk('M10 empty array returns no rows', (select count(*) from public.zip_scope_members('90001','[]'))=0);

-- 2 malformed CALLS raise (caller must fall back to legacy)
do $$ begin perform * from public.zip_scope_members('9000','[[0,0]]'); perform pg_temp.chk('M11a short ZIP raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('M11a short ZIP raises', true); end $$;
do $$ begin perform * from public.zip_scope_members('90001','{"a":1}'); perform pg_temp.chk('M11b non-array raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('M11b non-array raises', true); end $$;
do $$ begin perform * from public.zip_scope_members('90001', null); perform pg_temp.chk('M11c null points raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('M11c null points raises', true); end $$;
do $$ begin perform * from public.zip_scope_members(null, '[]'); perform pg_temp.chk('M11d null ZIP raises', false);
exception when sqlstate '22023' then perform pg_temp.chk('M11d null ZIP raises', true); end $$;
do $$ begin
  perform * from public.zip_scope_members('90001', (select jsonb_agg(jsonb_build_array(0.5,0.5)) from generate_series(1,1001)));
  perform pg_temp.chk('M12 1001 points raises (bounded batch)', false);
exception when sqlstate '22023' then perform pg_temp.chk('M12 1001 points raises (bounded batch)', true); end $$;
select pg_temp.chk('M12b exactly 1000 points is accepted',
  (select count(*) from public.zip_scope_members('90001', (select jsonb_agg(jsonb_build_array(0.5,0.5)) from generate_series(1,1000))))=1000);

-- 3 equals the canonical predicate, point for point (no second definition)
select pg_temp.chk('M13 equals geo.zip_point_membership_in over a 1000-point grid',
  (select count(*) from (
     select g.i, h.j,
            (select verdict from public.zip_scope_members('90001', jsonb_build_array(jsonb_build_array(g.i/100.0, h.j/100.0)))) as got,
            geo.zip_point_membership_in(geo.zip_membership_boundary('90001'), g.i/100.0, h.j/100.0) as want
       from generate_series(-20,220,8) g(i) cross join generate_series(-20,220,8) h(j)
     ) q where got is distinct from want)=0);

-- 4 privileges
select pg_temp.chk('M14 anon cannot execute', not has_function_privilege('anon','public.zip_scope_members(text,jsonb)','execute'));
select pg_temp.chk('M15 authenticated cannot execute', not has_function_privilege('authenticated','public.zip_scope_members(text,jsonb)','execute'));
select pg_temp.chk('M16 service_role can execute', has_function_privilege('service_role','public.zip_scope_members(text,jsonb)','execute'));
select pg_temp.chk('M17 SECURITY DEFINER with pinned search_path',
  (select prosecdef and proconfig::text like '%search_path=geo, public, pg_temp%' from pg_proc where oid='public.zip_scope_members(text,jsonb)'::regprocedure));

-- 5 performance: one call of 1000 points against the polygon stays well under a second
do $$ declare t0 timestamptz := clock_timestamp(); n int; ms numeric;
begin
  select count(*) into n from public.zip_scope_members('90001',
    (select jsonb_agg(jsonb_build_array(random()*2, random()*2)) from generate_series(1,1000)));
  ms := extract(milliseconds from clock_timestamp()-t0);
  perform pg_temp.chk('M18 1000-point batch < 1000 ms', n=1000 and ms<1000, ms::text||' ms');
end $$;

select name||'|'||case when ok then 't' else 'f' end||'|'||detail from res order by name;
