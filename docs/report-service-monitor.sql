-- =====================================================================================
-- THE EMAIL ALARM FOR THE REPORT AND BILLING FUNCTIONS (audit item C, founder go 2026-10-08: "c. add email alarm")
--
-- WHY. The report function, the billing function and the payment webhook can stop answering and nobody is told: the
-- first sign is a customer. The monitor already emails hello@homesignal.net when one of its alertable checks fails
-- (public.pipeline_health_tick, pg_cron hourly at :10 -> notify-health). This adds ONE check to it. No second monitor,
-- no second mailer.
--
-- HOW IT KNOWS, WITHOUT CUSTOMER TRAFFIC. Row-arrival checks cannot tell "quiet" from "broken" (the file's own
-- lesson for notices and meetings). So this does not wait for a customer: pg_cron job `report-service-probe` makes
-- one harmless GET to each of the three functions every 10 minutes. A GET on each of them returns its public
-- capability sheet and does nothing else (no sign-in, no database read, no write, no charge):
--     get-development-activity-report            200 + its capability sheet
--     manage-billing                             200 + its capability sheet
--     development-activity-billing-webhook       200 + {"configured": true|false}
-- The webhook's `configured` flag matters most: it is false when its signing secret or variant id is missing, and a
-- webhook in that state REFUSES every payment event (503), so a paying customer would never be marked paid.
--
-- THE CHECK `report_service` is ALERTABLE and FAILS when, for any one function:
--     down     the TWO newest answered probes both failed (no answer in 15 s, or any status but 200, or for the
--              webhook configured <> true). Two in a row, so one slow answer never pages; a real outage is
--              caught inside ~20 minutes.
--     stale    the newest probe is older than 40 minutes: the probe job itself has stopped.
--     It is NOT alertable (UNKNOWN, neither pass nor fail) while no probe has an answer yet, exactly as the
--     monitor treats its GitHub-credential probe: no evidence is not a failure and not a pass.
-- It carries counts, status numbers and fixed words only. It never carries a response body, an address, a name,
-- an email, a token or a key.
--
-- NOT HERE, ON PURPOSE. A kill switch (turn reports off at once) was not asked for; this is the alarm only.
--
-- The probe sends only the PUBLIC anon key, which is in every page of the site. Service-role only; idempotent;
-- the ROLLBACK block at the end restores the monitor byte for byte.
-- =====================================================================================

-- 0. preconditions: refuse, changing nothing, if there is no monitor to carry the check or no pg_net to probe with
do $pre$
declare
  _d      text;
  _anchor constant text := 'insert into public.pipeline_health_check as c (';
begin
  if to_regclass('public.pipeline_health_check') is null
     or to_regprocedure('public.pipeline_health_tick()') is null then
    raise exception 'public.pipeline_health_tick() is not there — refusing: there is nowhere to send the alarm';
  end if;
  if to_regnamespace('net') is null or to_regclass('net._http_response') is null then
    raise exception 'pg_net is not installed — refusing: the probe could not be sent';
  end if;
  select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) into _d;
  if position('-- >>> report_service (begin)' in _d) = 0
     and (length(_d) - length(replace(_d, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the alarm could not be added';
  end if;
end
$pre$;

-- 1. the probe log: which request went to which function, and when. Counts and ids only; RLS on, no API grant.
create table if not exists public.report_service_probe (
  id          bigserial primary key,
  fn          text        not null check (fn in ('get-development-activity-report', 'manage-billing', 'development-activity-billing-webhook')),
  request_id  bigint      not null,
  fired_at    timestamptz not null default now()
);
create index if not exists report_service_probe_fn_fired_idx on public.report_service_probe (fn, fired_at desc);
alter table public.report_service_probe enable row level security;
revoke all on public.report_service_probe from public, anon, authenticated;

-- 2. fire one GET at each function (fire-and-forget through pg_net; the answers are read by the health read below)
create or replace function public.report_service_probe_fire()
returns integer
language plpgsql security definer set search_path = public, net, pg_temp
as $fn$
declare
  _base constant text := 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/';
  _anon constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U';
  _fn   text;
  _id   bigint;
  _n    integer := 0;
begin
  foreach _fn in array array['get-development-activity-report', 'manage-billing', 'development-activity-billing-webhook'] loop
    begin
      select net.http_get(url := _base || _fn,
                          headers := jsonb_build_object('apikey', _anon, 'Authorization', 'Bearer ' || _anon),
                          timeout_milliseconds := 15000) into _id;
      insert into public.report_service_probe (fn, request_id) values (_fn, _id);
      _n := _n + 1;
    exception when others then
      null; -- a probe that could not be sent shows up as a stale probe, never as a crash of the job
    end;
  end loop;
  delete from public.report_service_probe where fired_at < now() - interval '3 days';
  return _n;
end
$fn$;
revoke all on function public.report_service_probe_fire() from public, anon, authenticated;
grant execute on function public.report_service_probe_fire() to service_role;

-- 3. the health read: one row per function with a state and a fixed-word detail. No body, no header, no secret.
create or replace function public.report_service_health()
returns table (fn text, state text, detail text)
language plpgsql security definer set search_path = public, net, pg_temp
as $fn$
declare
  _fn text;
  _newest timestamptz;
  _n int;
  _bad int;
  _last int;
  _conf text;
begin
  foreach _fn in array array['get-development-activity-report', 'manage-billing', 'development-activity-billing-webhook'] loop
    fn := _fn;
    select max(p.fired_at) into _newest from public.report_service_probe p where p.fn = _fn;
    -- the two newest probes that have had time to answer (2 minutes) and whose answer is still on record
    with j as (
      select p.fired_at, r.status_code, r.timed_out,
             case when _fn = 'development-activity-billing-webhook'
                  then case when coalesce(r.content, '') ~ '"configured"[[:space:]]*:[[:space:]]*true' then 'true' else 'false' end
             end as configured
        from public.report_service_probe p
        join net._http_response r on r.id = p.request_id
       where p.fn = _fn and p.fired_at < now() - interval '2 minutes'
       order by p.fired_at desc
       limit 2)
    select count(*),
           count(*) filter (where j.timed_out is true or j.status_code is distinct from 200
                              or (_fn = 'development-activity-billing-webhook' and j.configured is distinct from 'true')),
           (array_agg(j.status_code order by j.fired_at desc))[1],
           (array_agg(j.configured order by j.fired_at desc))[1]
      into _n, _bad, _last, _conf
      from j;

    if _newest is null or _n = 0 then
      state := 'unknown'; detail := 'no answered probe yet';
    elsif _newest < now() - interval '40 minutes' then
      state := 'stale'; detail := 'the probe job has not fired for over 40 minutes';
    elsif _n >= 2 and _bad = 2 then
      state := 'down';
      detail := case when _fn = 'development-activity-billing-webhook' and _last = 200 and _conf is distinct from 'true'
                     then 'answers but is NOT set up (signing secret or variant id missing): every payment event would be refused'
                     else 'no good answer to the last two probes (newest status ' || coalesce(_last::text, 'none') || ')' end;
    else
      state := 'ok'; detail := 'answered (status ' || coalesce(_last::text, 'none') || ')';
    end if;
    return next;
  end loop;
end
$fn$;
revoke all on function public.report_service_health() from public, anon, authenticated;
grant execute on function public.report_service_health() to service_role;

comment on function public.report_service_health() is
'Audit item C. One row per report/billing function: ok, down (the two newest answered probes both failed), stale (the probe job stopped) or unknown (no answer yet). Fixed words and status numbers only. Read by the report_service check of pipeline_health_tick. Service-role only.';

-- 4. the schedule: ONE job every 10 minutes, altered in place when it already exists
do $cron$
declare
  _name  constant text := 'report-service-probe';
  _sched constant text := '*/10 * * * *';
  _cmd   constant text := 'select public.report_service_probe_fire()';
  _id    bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed here — probe job not scheduled';
    return;
  end if;
  select jobid into _id from cron.job where jobname = _name order by jobid limit 1;
  if _id is null then
    perform cron.schedule(_name, _sched, _cmd);
  else
    perform cron.alter_job(_id, schedule := _sched, command := _cmd, active := true);
  end if;
end
$cron$;

-- 5. the check, spliced into the one monitor (live definition, one anchor, fail closed, re-read)
do $mig$
declare
  _def    text;
  _anchor text := 'insert into public.pipeline_health_check as c (';
  _begin  text := '-- >>> report_service (begin)';
  _block  text := $blk$-- >>> report_service (begin)
  -- Audit item C. Reads only public.report_service_health(); see docs/report-service-monitor.sql for every threshold.
  begin
    insert into _eval
    select 'report_service',
           (count(*) filter (where h.state in ('down', 'stale')) = 0),
           (count(*) filter (where h.state <> 'unknown') > 0),
           case when count(*) filter (where h.state <> 'unknown') = 0
                  then 'UNKNOWN — no probe answer yet. Not alertable until a real response exists.'
                when count(*) filter (where h.state in ('down', 'stale')) > 0
                  then (select string_agg(x.fn || ': ' || x.state || ' — ' || x.detail, '; ' order by x.fn collate "C")
                          from public.report_service_health() x where x.state in ('down', 'stale'))
                else 'the report function, billing function and payment webhook all answered their last probes' end
      from public.report_service_health() h;
  exception when others then
    insert into _eval values ('report_service', false, true,
      'the report-service check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');
  end;
  -- <<< report_service (end)
  $blk$;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if _def is null then
    raise exception 'public.pipeline_health_tick() not found — refusing to splice';
  end if;
  if position(_begin in _def) > 0 then
    raise notice 'report_service already present — nothing to do';
    return;
  end if;
  if (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'anchor % appears % time(s), expected exactly 1 — refusing to splice',
      _anchor, (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor);
  end if;

  execute replace(_def, _anchor, _block || _anchor);

  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if (length(_def) - length(replace(_def, _begin, ''))) / length(_begin) <> 1
     or (length(_def) - length(replace(_def, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'splice did not take — the check must appear once and the anchor once';
  end if;
  raise notice 'report_service spliced into pipeline_health_tick()';
end
$mig$;

-- ROLLBACK (this file only; each line below is a statement once the leading "-- " is removed). It restores the monitor
-- byte for byte, unschedules the probe and drops the two functions and the probe log. It touches nothing else.
-- ROLLBACK-BEGIN
-- do $rb$
-- declare _def text; _b int; _e int;
--   _begin constant text := '-- >>> report_service (begin)';
--   _end   constant text := '-- <<< report_service (end)';
-- begin
--   select pg_get_functiondef(p.oid) into _def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
--   _b := position(_begin in _def);
--   _e := position(_end in _def);
--   if _b > 0 and _e > _b then
--     execute substr(_def, 1, _b - 1) || substr(_def, _e + length(_end) + 3);
--   end if;
--   if to_regnamespace('cron') is not null then
--     perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'report-service-probe';
--   end if;
-- end
-- $rb$;
-- drop function if exists public.report_service_health();
-- drop function if exists public.report_service_probe_fire();
-- drop table if exists public.report_service_probe;
-- ROLLBACK-END
