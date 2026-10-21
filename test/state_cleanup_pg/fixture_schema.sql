-- Stand-ins for the production pieces docs/state-cleanup-sites.sql relies on.
-- PostGIS is real (the CI service image / a local install); pg_net, pg_cron and Supabase roles are
-- small stubs; geo.* is copied verbatim from production (read 2026-10-21).
drop schema if exists net cascade; drop schema if exists cron cascade; drop schema if exists geo cascade;
drop function if exists public.state_cleanup_fl_fire(), public.state_cleanup_fl_collect(),
  public.map1_state_cleanup_zip_members(text), public.map1_state_cleanup_near(double precision, double precision, double precision) cascade;
drop table if exists public.state_cleanup_site_observations, public.state_cleanup_runs, public.state_cleanup_sites cascade;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
-- Supabase's default privileges: new functions in public are executable by anon/authenticated.
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
  select b.geom
    from geo.zcta_boundary b
   where b.zcta5 = p_zip
     and b.geom is not null
     and ST_GeometryType(b.geom) in ('ST_Polygon', 'ST_MultiPolygon')
     and not ST_IsEmpty(b.geom);
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
-- 33301 stand-in: a square around downtown Fort Lauderdale (NAD83, like production)
insert into geo.zcta_boundary values
  ('33301', ST_SetSRID(ST_GeomFromText('POLYGON((-80.16 26.10,-80.11 26.10,-80.11 26.14,-80.16 26.14,-80.16 26.10))'), 4269)),
  ('33309', ST_SetSRID(ST_GeomFromText('POLYGON((-80.20 26.17,-80.15 26.17,-80.15 26.21,-80.20 26.21,-80.20 26.17))'), 4269));
