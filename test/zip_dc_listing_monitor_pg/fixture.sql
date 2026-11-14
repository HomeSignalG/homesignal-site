-- A disposable stand-in for what the zip_dc_listings splice touches (see homesignal-ingest tests/health_monitor_pg
-- for the reasoning: the live function cannot be rebuilt from committed files, so this carries
-- its header, the `_now` variable, the `_eval` table and the one anchor, and run.sh swaps the
-- live body fingerprint in the migration for this stand-in's).
--
-- public.canonical_zip_registry and public.zip_dc_listing carry the columns the check reads (as in
-- production and docs/zip-dc-listing.sql, 2026-11-14).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;

create table if not exists public.canonical_zip_registry (zip text primary key);
create table if not exists public.zip_dc_listing (
  zip           text primary key,
  listings      jsonb       not null default '[]'::jsonb,
  member_count  integer     not null default 0,
  truncated     boolean     not null default false,
  checked_at    timestamptz not null default now(),
  changed_at    timestamptz not null default now(),
  last_error    text
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
