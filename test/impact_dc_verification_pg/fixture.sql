-- Stand-ins for what docs/impact-dc-verification.sql reads, so its triggers, queue, retries and stale rules can be run on a
-- disposable Postgres. The stand-ins of Map 1's readers answer from fx_map, which each check edits.
drop schema if exists public cascade; create schema public;
drop schema if exists vault cascade; create schema vault;
drop schema if exists net cascade; create schema net;
create extension if not exists pgcrypto with schema public;
do $$ begin create role anon; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin create role service_role; exception when duplicate_object then null; end $$;

create table public.communities (id serial primary key, level text, state text, county text, name text, zip_codes text[]);
insert into public.communities (level, state, county, name, zip_codes) values
 ('zip','VA','Fauquier','Warrenton (20187)', '{20187}'), ('zip','VA','Fauquier','Warrenton (20186)', '{20186}'),
 ('zip','VA','Loudoun','Ashburn (20147)', '{20147}'), ('county','VA','Fauquier','Fauquier County', '{}'),
 ('zip','LA','Caddo Parish','Shreveport (71101)', '{71101}'), ('zip','TX','Travis','Del Valle (78617)', '{78617}');

create table public.impact_stories (id uuid primary key default gen_random_uuid());
create table public.impact_discovery_scans (id uuid primary key default gen_random_uuid());
create table public.impact_discovery_candidates (
  id uuid primary key default gen_random_uuid(), category text not null, title text not null, place text, subject text,
  lead_url text not null default 'https://bsky.app/profile/x/post/1', post_uris text[] not null default '{}',
  link_keys text[] not null default '{}', related jsonb not null default '[]', evidence jsonb not null default '{}',
  coverage jsonb not null default '{}', duplicate_of uuid references public.impact_discovery_candidates(id),
  status text not null default 'open', score integer not null default 0, metrics jsonb not null default '{}',
  discovered_at timestamptz not null default now(), last_seen_at timestamptz not null default now());

create table public.app_projects (id serial primary key, zip text, record_kind text, source_key text, name text, status text,
  lat double precision, lng double precision);

-- Map 1's readers, answered from fx_map: one row per (project key) with where the link finds it, plus the drawn row.
create table public.fx_map (project_key text primary key, state text not null, zip text, map_key text, name text, status text,
  raw_status text, lat double precision, lng double precision, location_text text, source_url text);
create or replace function public.map1_project_locate(p_key text, p_zip text default null) returns jsonb language sql stable as $$
  select coalesce((select jsonb_build_object('key', p_key, 'state', state, 'zip', zip, 'zips', jsonb_build_array(zip), 'map_key', map_key)
                     from public.fx_map where project_key = p_key), jsonb_build_object('key', p_key, 'state', 'unknown_key'))
$$;
create or replace function public.map1_dc_zip_members(p_zip text)
returns table (source_key text, project_name text, map_status text, raw_status text, lat double precision, lng double precision,
               location_text text, source_url text) language sql stable as $$
  select distinct on (map_key) map_key, name, status, raw_status, lat, lng, location_text, source_url
    from public.fx_map where zip = p_zip and state = 'found' and map_key like 'dc:%'
$$;

create table public.map1_project_document (document_id uuid primary key default gen_random_uuid(), project_key text not null,
  url text not null default 'https://x.gov/d.pdf', title text not null default 'Doc', publisher text not null default 'County',
  doc_kind text not null default 'application', doc_date date, doc_date_label text, supports text not null default 's',
  proposed_by text not null default 'verification:x', created_at timestamptz not null default now());
create table public.map1_project_document_decision (id serial primary key, document_id uuid not null, decision text not null);
create or replace function public.map1_project_document_current(p uuid) returns text language sql stable as $$
  select coalesce((select decision from public.map1_project_document_decision where document_id = p order by id desc limit 1), 'pending') $$;

create table public.fx_admin (ok boolean not null);
insert into public.fx_admin values (true);
create or replace function public._hs_is_admin() returns text language plpgsql as $$
begin if not (select ok from public.fx_admin) then raise exception 'not an admin' using errcode = '42501'; end if; return 'founder@example.test'; end $$;

create table vault.decrypted_secrets (name text, decrypted_secret text);
create table net.fx_posts (id serial primary key, url text, body jsonb);
create or replace function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) returns bigint
language sql as $$ insert into net.fx_posts (url, body) values (url, body) returning id::bigint $$;

-- A data-center topic that exists before the file is applied (the backfill must queue it).
insert into public.impact_discovery_candidates (id, category, title, place, coverage) values
 ('00000000-0000-0000-0000-000000000000', 'data_centers', 'Old topic about Vint Hill', 'Fauquier County, VA',
  '{"places":[{"state":"VA","county":"Fauquier"}]}');
