do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
truncate geo.zcta_boundary;
-- 90001: an L-SHAPE (its bbox is far larger than the polygon; the notch x in (1,2], y in (1,2] is bbox-only)
-- 90002: its neighbour, sharing the edge x=1 for y in [0,1]
-- 90003: a small square far from the others (used for the hole cases)
insert into geo.zcta_boundary values
 ('90001', ST_Multi(ST_GeomFromText('POLYGON((0 0,2 0,2 1,1 1,1 2,0 2,0 0))',4269))),
 ('90002', ST_Multi(ST_GeomFromText('POLYGON((1 0,2 0,2 1,1 1,1 0))',4269))),
 ('90003', ST_Multi(ST_GeomFromText('POLYGON((10 10,11 10,11 11,10 11,10 10))',4269)));
