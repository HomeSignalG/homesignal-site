-- Loaded AFTER test/maps_zip_order_subscribers_pg/fixture.sql and docs/maps-zip-order-subscriber-zips.sql
-- (so the subscriber rule and its two triggers are really installed). Adds what the check reads that
-- those do not carry: users.referral_source, social_posts, social_post_withdrawals (only the columns
-- the check reads; names and types as in production, read 2026-11-09), pipeline_health_check, and a
-- stand-in pipeline_health_tick() with production's header, the `_now` variable, `_eval` and the one
-- anchor. run.sh swaps the live body md5 in the migration for this stand-in's.
alter table public.users add column if not exists referral_source text;
create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  content_family text not null,
  status text not null,
  zip text,
  published_at timestamptz
);
create table if not exists public.social_post_withdrawals (
  social_post_id uuid not null,
  bluesky_deleted_at timestamptz
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
