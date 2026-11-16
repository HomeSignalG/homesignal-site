-- Stand-ins for the objects docs/map1-project-link.sql reads beyond the Map 1 data-centre fixture.
-- Production names and the columns read; tables stand in for views (fixture convention). Dropped on exit by run.sh.
drop table if exists public.dc_observation_record_key cascade;
create table public.dc_observation_record_key (
  home_signal_observation_id uuid primary key,
  record_key text not null,
  record_key_rank integer not null
);
drop table if exists geo.n5_serving_membership cascade;
create table geo.n5_serving_membership (zcta5 char(5) not null, source_key text not null);
drop table if exists public.canonical_zip_registry cascade;
create table public.canonical_zip_registry (zip text primary key);
-- public._hs_is_admin (docs/impact-stories.sql) reads the caller's JWT; here a setting says who is calling.
create or replace function public._hs_is_admin() returns text language plpgsql stable as $$
begin
  if coalesce(current_setting('test.admin', true), '') <> 'yes' then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return 'founder@test';
end $$;
