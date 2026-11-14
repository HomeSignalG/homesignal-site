-- Stand-ins for what docs/map1-dc-zip-listing.sql uses: Supabase roles, pg_cron, the ZIP registry
-- and map1_dc_zip_members (same signature as production, rows from a table).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_read_only_user') then create role supabase_read_only_user; end if;
end $$;
create schema if not exists cron;
create table if not exists cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job(jobname, schedule, command) values (n, s, c) returning jobid $$;
create or replace function cron.unschedule(id bigint) returns boolean language sql as
  $$ delete from cron.job where jobid = id returning true $$;
create table public.canonical_zip_registry (zip text primary key);
insert into public.canonical_zip_registry values ('94612'),('94607'),('10001'),('99999'),('12345');
create table public.fx_members (zip text, source_key text, project_name text, map_status text, raw_status text,
  zip_membership text, has_more boolean default false, last_seen_at timestamptz default now(), lat float8 default 1);
insert into public.fx_members (zip, source_key, project_name, map_status, raw_status, zip_membership) values
  ('94612', 'dc:b', 'Second', 'Approved', 'under_construction', 'member'),
  ('94612', 'dc:A', 'First', 'Proposed', 'proposed', 'member'),
  ('94612', 'dc:z', 'Outside', 'Operating', 'operating', 'outside'),
  ('94607', 'osm:1', 'Hall', 'Operating', 'operating', 'member');
insert into public.fx_members (zip, source_key, project_name, map_status, raw_status, zip_membership, has_more) values
  ('10001', 'dc:t', 'Truncated', 'Operating', 'operating', 'member', true);
create or replace function public.map1_dc_zip_members(p_zip text)
returns table(source_key text, source_name text, source_url text, source_licence text, project_name text,
  developer_or_operator text, raw_status text, normalized_status text, map_status text, project_type text,
  lat double precision, lng double precision, location_text text, location_precision text, distance_mi numeric,
  last_seen_at timestamptz, has_more boolean, zip_membership text, canonical_entity_id uuid,
  publication_basis text, quality_flags text[], source_count integer)
language plpgsql stable as $$
begin
  if p_zip = '12345' then raise exception 'boom for %', p_zip; end if;
  return query select f.source_key, 'Src'::text, 'https://example.org/'||f.source_key, 'CC BY 4.0'::text, f.project_name,
    null::text, f.raw_status, f.raw_status, f.map_status, 'datacenter'::text, f.lat, 1::float8, null::text, null::text,
    null::numeric, f.last_seen_at, f.has_more, f.zip_membership, null::uuid, null::text, null::text[], 1
    from public.fx_members f where f.zip = p_zip;
end $$;
