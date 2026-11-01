-- Stand-ins for what docs/source-freshness.sql reads, shaped like production (columns it uses only).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
-- Supabase-style default privileges: new functions are executable by anon/authenticated DIRECTLY.
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as
  $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
create or replace function cron.unschedule(id bigint) returns boolean language sql as
  $$ delete from cron.job where jobid = id returning true $$;

drop table if exists public.dev_source_continuity cascade;
create table public.dev_source_continuity (
  zip text not null, registry_id text not null, scope text not null, complete boolean not null,
  last_tick_at timestamptz, impaired_since timestamptz, primary key (zip, registry_id));
drop table if exists public.dev_change_project cascade;
create table public.dev_change_project (identity_key text primary key, registry_id text, facts jsonb);
drop table if exists public.dev_source_freshness cascade;
drop function if exists public.dev_source_freshness_refresh();
drop function if exists public.source_freshness_for_zip(text, text[]);

insert into public.dev_source_continuity values
  -- src-a: complete in 11111 (newest), failed in 22222 (newer tick, but failed), complete in 33333 older
  ('11111','src-a','legacy',true,'2026-11-01 05:32+00',null),
  ('22222','src-a','failed',false,'2026-11-01 07:00+00','2026-10-31 17:00+00'),
  ('33333','src-a','expanded',true,'2026-10-30 01:00+00',null),
  -- src-b: only ever failed; 11111 legacy complete but impaired (an earlier break not healed)
  ('11111','src-b','failed',false,'2026-10-31 17:08+00','2026-10-31 17:08+00'),
  ('22222','src-b','legacy',true,'2026-10-29 00:00+00','2026-10-28 00:00+00'),
  ('33333','src-b','absent',false,'2026-10-30 00:00+00',null),
  ('44444','src-b','retired',false,'2026-10-30 00:00+00',null);

insert into public.dev_change_project values
  ('a1','src-a','{"date_kind":"issued","submitted_at":"2026-10-01"}'),
  ('a2','src-a','{"date_kind":"filed","submitted_at":"2026-09-15"}'),
  ('a3','src-a','{"date_kind":"scheduled","submitted_at":"2026-10-20"}'),
  ('a4','src-a','{"date_kind":"issued","submitted_at":"2099-01-01"}'),
  ('a5','src-a','{"submitted_at":"2026-10-25"}'),
  ('a6','src-a','{"date_kind":"issued","submitted_at":"2026-10"}'),
  ('b1','src-b','{"date_kind":"estimated","submitted_at":"2026-08-01"}'),
  ('c1','src-c','{"date_kind":"decided","submitted_at":"2026-07-04"}'),
  ('n1',null,'{"date_kind":"issued","submitted_at":"2026-10-30"}');
