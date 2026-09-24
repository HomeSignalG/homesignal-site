-- Minimal, self-contained Step-3A/3B schema for exercising the SHIPPED
-- docs/dc-step3b-canonical-geography.sql against a DISPOSABLE PostGIS (never production).
-- Only the columns the geography resolver and the location-basis rule read are reproduced,
-- with production's names and types. dc_current_observation is a view, as in production,
-- over a flag table the suite controls. pg_cron is stubbed: the DDL schedules itself.

create extension if not exists postgis;
create extension if not exists pgcrypto;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;

create schema if not exists cron;
drop table if exists cron.job cascade;
create table cron.job (jobid serial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(p_name text, p_sched text, p_cmd text) returns bigint
language sql as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_sched, p_cmd) returning jobid::bigint $$;
create or replace function cron.unschedule(p_jobid bigint) returns boolean
language sql as $$ delete from cron.job where jobid = p_jobid returning true $$;

drop view  if exists public.dc_current_observation cascade;
drop table if exists public.dc_entity_geography cascade;
drop table if exists public.dc_entity_observation cascade;
drop table if exists public.dc_current_flag cascade;
drop table if exists public.dc_canonical_entity cascade;
drop table if exists public.dc_source_observation cascade;

create table public.dc_source_observation (
  home_signal_observation_id uuid primary key default gen_random_uuid(),
  source_key               text not null,
  distribution_key         text not null,
  raw_payload              jsonb not null default '{}'::jsonb,
  source_native_name       text,
  source_native_lon        double precision,
  source_native_lat        double precision,
  source_native_precision  text,
  observed_at              timestamptz not null default now()
);
create table public.dc_canonical_entity (
  canonical_entity_id uuid primary key default gen_random_uuid(),
  entity_grain        text not null default 'SITE',
  classification      text not null default 'CONFIRMED_DC',
  superseded_by       uuid references public.dc_canonical_entity(canonical_entity_id)
);
create table public.dc_entity_observation (
  home_signal_observation_id uuid primary key
                             references public.dc_source_observation(home_signal_observation_id),
  canonical_entity_id        uuid not null references public.dc_canonical_entity(canonical_entity_id)
);
create table public.dc_current_flag (
  home_signal_observation_id uuid primary key
                             references public.dc_source_observation(home_signal_observation_id)
);
create view public.dc_current_observation as
  select o.* from public.dc_source_observation o
    join public.dc_current_flag f using (home_signal_observation_id);
