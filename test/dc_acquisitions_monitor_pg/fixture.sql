-- A disposable stand-in for what the dc_acquisitions splice touches (see homesignal-ingest tests/health_monitor_pg
-- for the reasoning: the live function cannot be rebuilt from committed files, so this carries
-- its header, the `_now` variable, the `_eval` table and the one anchor, and run.sh swaps the
-- live body fingerprint in the migration for this stand-in's).
--
-- public.dc_source and public.dc_acquisition_run carry only the columns the check reads (names and
-- types as in production, read 2026-10-23): source_key, active_state, distributions;
-- source_key, distribution_key, started_at, completed_at, completeness_state.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create table if not exists public.dc_source (
  source_key    text primary key,
  active_state  text not null,
  distributions text[] not null
);
create table if not exists public.dc_acquisition_run (
  id                 bigserial primary key,
  source_key         text not null,
  distribution_key   text not null,
  started_at         timestamptz not null,
  completed_at       timestamptz,
  completeness_state text
);

create table if not exists public.pipeline_health_check (
  check_name       text primary key,
  ok               boolean,
  alertable        boolean,
  detail           text,
  since            timestamptz,
  updated_at       timestamptz,
  last_notified_at timestamptz
);

create or replace function public.pipeline_health_tick()
 returns table(result_check text, result_ok boolean, result_detail text)
 language plpgsql
 security definer
 set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp'
as $function$
declare
  _now        timestamptz := now();
begin
  create temp table _eval (c_name text, c_ok boolean, c_alertable boolean, c_detail text) on commit drop;

  insert into _eval values ('stand_in', true, true, 'stands for the checks that run before the anchor');

  insert into public.pipeline_health_check as c (check_name, ok, alertable, detail, since, updated_at)
  select e.c_name, e.c_ok, e.c_alertable, e.c_detail, _now, _now from _eval e
  on conflict (check_name) do update
    set ok         = excluded.ok,
        alertable  = excluded.alertable,
        detail     = excluded.detail,
        since      = case when c.ok is distinct from excluded.ok then _now else c.since end,
        updated_at = _now;

  return query select e.c_name, e.c_ok, e.c_detail from _eval e order by e.c_ok, e.c_name;
end $function$;

revoke all on function public.pipeline_health_tick() from public;
grant execute on function public.pipeline_health_tick() to service_role;
