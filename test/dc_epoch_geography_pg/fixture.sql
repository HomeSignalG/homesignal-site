-- Evidence-plane fixture for the Epoch canonical-geography suite. Applied AFTER
-- test/zip_membership_pg/fixture_schema.sql + docs/zip-membership-canonical.sql (geo.*, roles,
-- national_dc_records), and BEFORE the four SHIPPED files under test, in production order:
--   docs/dc-step3d-derived-location.sql   (derived location evidence)
--   docs/dc-step3a-canonical-identity.sql (identity, review, candidates, resolver)
--   docs/dc-step3b-canonical-geography.sql (geography)
--   docs/map1-dc-publication.sql          (the ONE Map 1 reader)
-- Only the Step-2A columns those files read are reproduced, with production's names and types
-- (information_schema, 2026-09-24). dc_current_observation is created here with production's
-- definition because Step 3D's view needs it before Step 3A re-creates it identically.
-- pg_cron is stubbed: the DDL schedules itself.

create extension if not exists postgis;
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create schema if not exists cron;
drop table if exists cron.job cascade;
create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(p_name text, p_sched text, p_cmd text) returns bigint
language sql as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_sched, p_cmd) returning jobid::bigint $$;
create or replace function cron.unschedule(p_jobid bigint) returns boolean
language sql as $$ delete from cron.job where jobid = p_jobid returning true $$;

-- another suite in the same disposable database may have left a stand-in adjudicator behind
drop function if exists public.dc_adjudicate_pair(uuid, uuid, text) cascade;
drop view  if exists public.dc_record_identity cascade;
drop view  if exists public.dc_entity_identity_open cascade;
drop view  if exists public.dc_observation_site_address cascade;
drop view  if exists public.dc_geocode_queue cascade;
drop view  if exists public.dc_observation_derived_point cascade;
drop view  if exists public.dc_identity_candidate cascade;
drop view  if exists public.dc_observation_record_key cascade;
drop view  if exists public.dc_current_observation cascade;
drop table if exists public.dc_address_geocode cascade;
drop table if exists public.dc_identity_review cascade;
drop table if exists public.dc_identity_decision cascade;
drop table if exists public.dc_entity_geography cascade;
drop table if exists public.dc_entity_observation cascade;
drop table if exists public.dc_canonical_entity cascade;
drop table if exists public.dc_source_observation cascade;
drop table if exists public.dc_acquisition_run cascade;
drop table if exists public.dc_source cascade;

create table public.dc_source (
  source_key                   text primary key,
  publisher                    text not null,
  licence                      text not null,
  supplies_publisher_record_id boolean not null
);
create table public.dc_acquisition_run (
  id                    uuid primary key default gen_random_uuid(),
  source_key            text not null references public.dc_source(source_key),
  distribution_key      text not null,
  run_seq               bigint not null,
  completeness_state    text not null default 'SUCCESS_COMPLETE',
  advanced_observations boolean not null default true,
  source_release_key    text,
  content_release_key   text
);
create table public.dc_source_observation (
  home_signal_observation_id uuid primary key default gen_random_uuid(),
  acquisition_run_id       uuid not null references public.dc_acquisition_run(id),
  source_key               text not null,
  distribution_key         text not null,
  publisher_record_id      text,
  source_row_ordinal       integer not null default 0,
  raw_payload              jsonb not null default '{}'::jsonb,
  source_native_name       text,
  source_native_type       text,
  source_native_status     text,
  source_native_operator   text,
  source_native_address    jsonb,
  source_native_lon        double precision,
  source_native_lat        double precision,
  source_native_precision  text,
  observed_at              timestamptz not null default now()
);

create or replace view public.dc_current_observation as
select o.home_signal_observation_id, o.acquisition_run_id, o.source_key, o.distribution_key,
       o.publisher_record_id, o.source_row_ordinal, o.source_native_name, o.source_native_type,
       o.source_native_status, o.source_native_operator, o.source_native_lat, o.source_native_lon,
       o.source_native_precision, o.raw_payload, r.run_seq, r.source_release_key, r.content_release_key
  from public.dc_source_observation o
  join public.dc_acquisition_run r on r.id = o.acquisition_run_id
 where r.id in (
    select distinct on (a.source_key, a.distribution_key) a.id
      from public.dc_acquisition_run a
     where a.completeness_state = 'SUCCESS_COMPLETE' and a.advanced_observations
     order by a.source_key, a.distribution_key, a.run_seq desc);

insert into public.dc_source values
  ('compute_atlas', 'Compute Atlas', 'CC BY 4.0', true),
  ('epoch_ai',      'Epoch AI',      'CC BY 4.0', false);
