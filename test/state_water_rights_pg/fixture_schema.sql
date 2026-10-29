-- Stand-ins for the production pieces docs/state-water-rights.sql relies on. PostGIS is real;
-- pg_net, pg_cron, Supabase roles and public.communities are small stubs; geo.* is copied from
-- test/state_cleanup_pg/fixture_schema.sql (itself verbatim from production, read 2026-10-21).
drop schema if exists net cascade; drop schema if exists cron cascade; drop schema if exists geo cascade;
drop table if exists public.water_rights_filing_observations, public.water_rights_runs, public.water_rights_states,
  public.water_rights_sources, public.water_rights_filings, public.communities cascade;
drop function if exists public.water_rights_for_zip(text), public.water_rights_fire(text), public.water_rights_collect() cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create schema net;
create table net.http_request_log (id bigserial primary key, url text, timeout_milliseconds int);
create table net._http_response (id bigint primary key, status_code int, content text, created timestamptz default now());
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.http_request_log (url, timeout_milliseconds) values (url, timeout_milliseconds) returning id
$$;

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (n, s, c)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(j bigint) returns boolean language sql as $$ delete from cron.job where jobid = j returning true $$;

create schema geo;
create table geo.zcta_boundary (zcta5 char(5) primary key, geom geometry);
create function geo.zip_membership_boundary(p_zip text) returns geometry language sql stable as $$
  select b.geom from geo.zcta_boundary b
   where b.zcta5 = p_zip and b.geom is not null
     and ST_GeometryType(b.geom) in ('ST_Polygon', 'ST_MultiPolygon') and not ST_IsEmpty(b.geom);
$$;
create function geo.zip_point_membership_in(p_boundary geometry, p_lat double precision, p_lng double precision)
returns text language sql immutable as $$
  select case
    when p_lat is null or p_lng is null
      or p_lat = 'NaN'::float8 or p_lng = 'NaN'::float8
      or p_lat not between -90 and 90 or p_lng not between -180 and 180 then 'no_coordinates'
    when p_boundary is null then 'not_measured'
    when ST_Intersects(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4269), p_boundary) then 'member'
    else 'outside'
  end;
$$;
-- 84336 Snowville UT stand-in (holds a55167's two points), 84302 Brigham City UT stand-in,
-- 83706 Boise ID stand-in, 89501 Reno NV stand-in. 84999 is a UT page with no Census area. 33301 is a Florida page.
insert into geo.zcta_boundary values
  ('84336', ST_SetSRID(ST_GeomFromText('POLYGON((-112.80 41.68,-112.60 41.68,-112.60 41.80,-112.80 41.80,-112.80 41.68))'), 4269)),
  -- 84302 is a TRIANGLE, so a point inside its bounding box can still be outside the ZIP
  ('84302', ST_SetSRID(ST_GeomFromText('POLYGON((-112.10 41.48,-111.98 41.48,-112.10 41.56,-112.10 41.48))'), 4269)),
  ('83706', ST_SetSRID(ST_GeomFromText('POLYGON((-116.75 43.60,-116.40 43.60,-116.40 43.90,-116.75 43.90,-116.75 43.60))'), 4269)),
  ('33301', ST_SetSRID(ST_GeomFromText('POLYGON((-80.16 26.10,-80.11 26.10,-80.11 26.14,-80.16 26.14,-80.16 26.10))'), 4269)),
  ('89501', ST_SetSRID(ST_GeomFromText('POLYGON((-119.85 39.50,-119.78 39.50,-119.78 39.55,-119.85 39.55,-119.85 39.50))'), 4269));

create table public.communities (id bigserial primary key, level text, zip_codes text[], state text, name text);
insert into public.communities (level, zip_codes, state, name) values
  ('zip', '{84336}', 'UT', 'Snowville (84336)'), ('zip', '{84302}', 'UT', 'Brigham City (84302)'),
  ('zip', '{84999}', 'UT', 'No Area (84999)'), ('zip', '{83706}', 'ID', 'Boise (83706)'),
  ('zip', '{33301}', 'FL', 'Fort Lauderdale (33301)'), ('zip', '{89501}', 'NV', 'Reno (89501)'),
  ('county', '{84336,84302}', 'UT', 'Box Elder County');
