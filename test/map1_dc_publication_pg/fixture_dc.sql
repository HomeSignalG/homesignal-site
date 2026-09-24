-- Minimal, self-contained dc_* schema for exercising the SHIPPED docs/map1-dc-publication.sql
-- against a DISPOSABLE PostGIS. Applied AFTER test/zip_membership_pg/fixture_schema.sql +
-- docs/zip-membership-canonical.sql (which supply geo.zcta_boundary, national_dc_records, the
-- canonical point predicate and the roles). Only the columns the publication contract reads
-- are reproduced, with production's names and types (information_schema, 2026-09-22), plus
-- production's posture: RLS on, nothing granted to anon/authenticated.

drop view  if exists public.dc_current_observation cascade;
drop table if exists public.dc_entity_geography cascade;
drop table if exists public.dc_entity_observation cascade;
drop table if exists public.dc_canonical_entity cascade;
drop table if exists public.dc_source_observation cascade;
drop table if exists public.dc_source cascade;

create table public.dc_source (
  source_key text primary key,
  publisher  text not null,
  licence    text not null
);

create table public.dc_source_observation (
  home_signal_observation_id uuid primary key default gen_random_uuid(),
  source_key               text not null references public.dc_source(source_key),
  distribution_key         text not null default 'facilities',
  raw_payload              jsonb not null default '{}'::jsonb,
  source_native_name       text,
  source_native_status     text,
  source_native_operator   text,
  source_native_address    jsonb,
  source_native_lon        double precision,
  source_native_lat        double precision,
  source_native_precision  text,
  observed_at              timestamptz not null default now()
);

create table public.dc_canonical_entity (
  canonical_entity_id uuid primary key default gen_random_uuid(),
  classification      text not null,
  source_count        integer not null default 1,
  superseded_by       uuid references public.dc_canonical_entity(canonical_entity_id)
);

create table public.dc_entity_geography (
  canonical_entity_id      uuid primary key references public.dc_canonical_entity(canonical_entity_id),
  geography_status         text not null,
  geometry_type            text,
  geom                     geometry(Geometry, 4326),
  lat                      double precision,
  lng                      double precision,
  authority_observation_id uuid references public.dc_source_observation(home_signal_observation_id),
  publisher_precision      text,
  quality_flags            text[] not null default '{}',
  positional_uncertainty_m double precision
);

-- The reader's DESCRIPTOR (2026-09-24) is the entity's current observation that states a
-- lifecycle, found through the entity's links; every fixture observation is current.
create table public.dc_entity_observation (
  home_signal_observation_id uuid primary key
                             references public.dc_source_observation(home_signal_observation_id),
  canonical_entity_id        uuid not null references public.dc_canonical_entity(canonical_entity_id)
);
create view public.dc_current_observation as
  select o.* from public.dc_source_observation o;

alter table public.dc_source             enable row level security;
alter table public.dc_source_observation enable row level security;
alter table public.dc_canonical_entity   enable row level security;
alter table public.dc_entity_geography   enable row level security;
alter table public.dc_entity_observation enable row level security;
revoke all on public.dc_source, public.dc_source_observation, public.dc_canonical_entity,
              public.dc_entity_geography, public.dc_entity_observation, public.dc_current_observation,
              public.national_dc_records from anon, authenticated;
