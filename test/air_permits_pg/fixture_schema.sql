-- Stand-ins for the production pieces docs/air-permits.sql relies on (copied from the water-rights fixture; PostGIS is real).
-- FIXTURE DATA ONLY: nothing here is production evidence. 78521 is a stand-in box over the Starbase area.
drop schema if exists net cascade; drop schema if exists cron cascade; drop schema if exists geo cascade;
drop table if exists public.air_permit_record_observations, public.air_permit_records, public.air_permit_runs,
  public.air_permit_states, public.air_permit_sources, public.communities cascade;
drop function if exists public.air_permits_for_zip(text), public.map1_air_permits_near(double precision,double precision,double precision),
  public.air_permits_ingest(text, jsonb, boolean) cascade;
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
insert into geo.zcta_boundary values
  ('78521', ST_SetSRID(ST_GeomFromText('POLYGON((-97.45 25.88,-97.30 25.88,-97.30 26.02,-97.45 26.02,-97.45 25.88))'), 4269)),
  ('83706', ST_SetSRID(ST_GeomFromText('POLYGON((-116.75 43.60,-116.40 43.60,-116.40 43.90,-116.75 43.90,-116.75 43.60))'), 4269)),
  -- 90001 is a TRIANGLE: a point inside its bounding box can still be outside the ZIP
  ('90001', ST_SetSRID(ST_GeomFromText('POLYGON((-118.30 33.90,-118.20 33.90,-118.30 34.00,-118.30 33.90))'), 4269));
create table public.communities (id bigserial primary key, level text, zip_codes text[], state text, county text, name text);
insert into public.communities (level, zip_codes, state, county, name) values
  ('zip', '{78521}', 'TX', 'Cameron', 'Brownsville (78521)'),
  ('zip', '{78999}', 'TX', 'Cameron', 'No Area (78999)'),
  ('zip', '{83706}', 'ID', 'Ada', 'Boise (83706)'),
  ('zip', '{90001}', 'CA', 'Los Angeles', 'Los Angeles (90001)'),
  ('zip', '{33301}', 'FL', 'Broward', 'Fort Lauderdale (33301)');
