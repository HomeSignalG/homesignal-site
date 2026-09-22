-- Minimal, self-contained schema for exercising the SHIPPED docs/zip-membership-canonical.sql
-- against a DISPOSABLE PostGIS. Only the columns the two files
-- read or write are reproduced, with production's names and types (geo.zcta_boundary is
-- MULTIPOLYGON SRID 4269, unique on zcta5, exactly as in production, verified 2026-09-22), so a
-- pass here is evidence about the real functions rather than about a stand-in.
create extension if not exists postgis;
create schema if not exists geo;

drop table if exists geo.zcta_boundary cascade;
create table geo.zcta_boundary (
  zcta5 text primary key,
  geom  geometry(MultiPolygon, 4269)
);
create index zcta_boundary_geom_gix on geo.zcta_boundary using gist (geom);

drop table if exists public.development_reports cascade;
create table public.development_reports (
  zip          text primary key,
  home_lat     double precision,
  home_lng     double precision,
  counts       jsonb,
  sites        jsonb,
  refreshed_at timestamptz
);

drop table if exists public.national_dc_records cascade;
create table public.national_dc_records (
  id                    uuid primary key default gen_random_uuid(),
  source_name           text not null default 'OpenStreetMap',
  source_key            text not null,
  source_record_id      text not null,
  osm_type              text not null,
  source_url            text not null,
  project_name          text,
  developer_or_operator text,
  raw_status            text not null,
  normalized_status     text not null,
  project_type          text not null default 'datacenter',
  lat                   double precision,
  lng                   double precision,
  location_text         text,
  location_precision    text not null,
  raw_tags              jsonb not null default '{}'::jsonb,
  imported_at           timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  map_eligible          boolean not null default false,
  map_exclusion_reason  text,
  -- production's CHECK constraints, verbatim (pg_get_constraintdef, 2026-09-22)
  constraint national_dc_records_location_precision_check check ((location_precision = any (array['precise_location'::text, 'approximate_campus_area'::text, 'approximate_project_area'::text, 'none'::text]))),
  constraint national_dc_records_osm_type_check check ((osm_type = any (array['node'::text, 'way'::text, 'relation'::text]))),
  constraint national_dc_records_normalized_status_check check ((normalized_status = any (array['announced'::text, 'site_selection'::text, 'pre_development'::text, 'planned'::text, 'proposed'::text, 'permitted'::text, 'under_construction'::text, 'operational'::text, 'cancelled'::text, 'shelved'::text, 'blocked'::text, 'unknown'::text]))),
  constraint national_dc_eligible_requires_evidence check ((((map_eligible = false) and (map_exclusion_reason is not null)) or ((map_eligible = true) and (source_url <> ''::text) and (lat is not null) and (lng is not null) and ((lat >= ('-90'::integer)::double precision) and (lat <= (90)::double precision)) and ((lng >= ('-180'::integer)::double precision) and (lng <= (180)::double precision)) and (not ((lat = (0)::double precision) and (lng = (0)::double precision))) and (location_precision <> 'none'::text) and (normalized_status = any (array['announced'::text, 'site_selection'::text, 'pre_development'::text, 'planned'::text, 'proposed'::text, 'permitted'::text, 'under_construction'::text, 'operational'::text])))))
);

-- the roles the grant statements name
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

-- which ZIPs the suite may use: one WITH a boundary (the suite writes the synthetic polygon
-- into it) and one WITHOUT. Production runs pick real canonical ZIPs (see run notes).
create table if not exists public._zm_cfg (zip_with text, zip_without text);
delete from public._zm_cfg;
insert into public._zm_cfg values ('99901', '99902');
