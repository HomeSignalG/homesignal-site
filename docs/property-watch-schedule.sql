-- =====================================================================================
-- DEVELOPMENT ACTIVITY BUILD STEP 9, PART 2: ARM THE DAILY WATCH, AND WATCH IT
-- (docs/development-activity-watch-2026-10-03.md; the founder's step: "Watch. Daily check of the property;
-- email to the agent when a nearby project's official status changes.")
--
-- docs/property-watch.sql made the watches and decided WHEN each one is due (a fixed daily slot per watch, kept
-- by the database). The edge function run-property-watch does the check. Nothing yet CALLS that function. This
-- file does three things and nothing else; it adds no rule about what a watch is, who may have one, when one is
-- due, or what a check says:
--
--   1. public.property_watch_run_scheduled() — what pg_cron calls. It POSTs to run-property-watch with the
--      scheduler's secret (vault `signup_hook_secret`, the secret notify-health already takes) and the project's
--      PUBLIC key (the gateway's JWT check stays on; the public key is in every page of the site and is the only
--      thing it lets through, so it is not a credential). It chooses ONE number: how many watches one call may
--      claim (5).
--
--   2. the pg_cron job `property-watch-run`, every 10 minutes (minutes 3, 13, 23, 33, 43, 53).
--      THE FOUNDER'S CADENCE IS NOT THIS NUMBER. Each watch is checked once a day, on its own fixed slot, and the
--      database refuses to hand a watch out earlier (public.property_watch_claim). This job only has to WAKE often
--      enough that a watch is checked soon after its slot, and that a crashed run's lease (10 minutes) is retried
--      soon. An idle wake claims nothing and costs one small request. Capacity is 5 watches per wake, 6 wakes an
--      hour: 720 checks a day, against a limit of 25 watches per brokerage.
--
--   3. the alarm: public.property_watch_job_health() (counts and fixed words, never a property, an address, an
--      agent or an error text) and the check `property_watch_run`, spliced into the ONE existing alert path
--      (public.pipeline_health_tick -> notify-health) exactly as the purge schedule was. No second monitor.
--      It is ALERTABLE and FAILS when any of these holds:
--        job        the pg_cron job is missing, inactive, or no longer calls the wrapper
--        cron       the last 3 runs of the job all failed to START (the wrapper raised: e.g. the secret is gone)
--        overdue    a watch was due more than 6 hours ago, is not leased and is not backing off. That is the harm
--                   itself — a watched property nobody is checking — so a job that runs but fails (the function is
--                   not deployed, the secret does not match, the mail key is missing) is caught exactly as one that
--                   does not run. Six hours is 36 wakes.
--        failing    a watch has failed its last 3 or more checks in a row (outcomes by name). Three failures is
--                   about three hours of back-off; a transient outage clears by itself and never reaches it.
--        invariant  any other invariant of public.property_watch_integrity() is non-zero (a watch whose property
--                   is no longer kept, a told-about row kept past its time).
--      A check that cannot run is a FAILING check, not a dead monitor: the spliced block catches its own failure.
--
-- ORDER OF OPERATIONS (this file ARMS; do not apply it before the rest is live):
--   docs/property-watch.sql applied -> manage-property-watch and run-property-watch deployed -> a dry run of
--   run-property-watch answered OK with the secret -> THIS FILE. Applying it earlier would alert on a job that
--   calls a function that is not there.
--
-- Service-role only. Idempotent: re-applying changes nothing (the job is altered in place, the check is spliced
-- once) and RE-ARMS a job someone deactivated (arming is this file's job). Requires docs/property-watch.sql and
-- the pipeline health monitor, and fails closed if either is missing.
-- =====================================================================================

-- ── 0. preconditions: refuse, changing nothing, if what this schedules or reports to is not there ──────────────
do $pre$
declare
  _d      text;
  _anchor constant text := 'insert into public.pipeline_health_check as c (';
begin
  if to_regclass('public.property_watch') is null
     or to_regprocedure('public.property_watch_claim(integer)') is null
     or to_regprocedure('public.property_watch_integrity()') is null then
    raise exception 'docs/property-watch.sql is not applied — refusing to schedule a check that does not exist';
  end if;
  if to_regclass('public.pipeline_health_check') is null
     or to_regprocedure('public.pipeline_health_tick()') is null then
    raise exception 'public.pipeline_health_tick() is not there — refusing: the daily check must not be armed without its alarm';
  end if;
  select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) into _d;
  if position('-- >>> property_watch_run (begin)' in _d) = 0
     and (length(_d) - length(replace(_d, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the daily check must not be armed without its alarm';
  end if;
  -- where the vault exists, the secret the wrapper needs must be in it: a job that cannot authenticate is not armed
  if to_regnamespace('vault') is not null then
    if not exists (select 1 from vault.decrypted_secrets where name = 'signup_hook_secret' and btrim(coalesce(decrypted_secret, '')) <> '') then
      raise exception 'vault secret signup_hook_secret is missing or empty — refusing: the daily check could not authenticate to run-property-watch';
    end if;
  end if;
end
$pre$;

-- ── 1. the wrapper pg_cron calls: one POST, the secret from the vault, nothing else ────────────────────────────────
create or replace function public.property_watch_run_scheduled()
returns bigint
language plpgsql security definer set search_path = public, extensions, net, vault, pg_temp
as $fn$
declare
  _url   constant text := 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/run-property-watch';
  -- the project's PUBLIC (anon) key, the same one every page of the site carries: it only gets the request past the gateway's JWT check
  _anon  constant text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U';
  _limit constant integer := 5;
  _secret text;
  _req    bigint;
begin
  select decrypted_secret into _secret from vault.decrypted_secrets where name = 'signup_hook_secret';
  if _secret is null or btrim(_secret) = '' then
    raise exception 'no scheduler secret is stored (vault secret signup_hook_secret); the Watch cannot run' using errcode = '28000';
  end if;
  select net.http_post(
    url     := _url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', _anon, 'Authorization', 'Bearer ' || _anon,
                                  'x-signup-secret', _secret),
    body    := jsonb_build_object('limit', _limit),
    timeout_milliseconds := 150000
  ) into _req;
  return _req;
end
$fn$;
revoke all on function public.property_watch_run_scheduled() from public, anon, authenticated, service_role;

comment on function public.property_watch_run_scheduled() is
'Development Activity step 9. Called by pg_cron job property-watch-run. Posts to run-property-watch with the scheduler secret from the vault
and the project''s public key, asking it to claim at most 5 watches. Returns the pg_net request id. Owner only: nobody else may call it.';

-- ── 2. the health read: counts and fixed words — never a property, an address, an agent or an error text ─────────────
create or replace function public.property_watch_job_health()
returns table (watches bigint, overdue_n bigint, failing_n bigint, failing_outcomes text,
               invariant_breaks bigint, broken_invariants text, job_state text, cron_failing boolean)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  _job    constant text := 'property-watch-run';
  _state  text;
  _failed boolean := false;
begin
  select max(i.violations) filter (where i.check_name = 'watches'),
         max(i.violations) filter (where i.check_name = 'overdue_watches'),
         coalesce(sum(i.violations) filter (where i.kind = 'invariant' and i.check_name <> 'overdue_watches'), 0),
         coalesce(string_agg(i.check_name, ', ' order by i.check_name collate "C")
                    filter (where i.kind = 'invariant' and i.check_name <> 'overdue_watches' and i.violations > 0), '')
    into watches, overdue_n, invariant_breaks, broken_invariants
    from public.property_watch_integrity() i;

  select coalesce(sum(o.n), 0), coalesce(string_agg(o.outcome || ' x' || o.n, ', ' order by o.outcome collate "C"), '')
    into failing_n, failing_outcomes
    from (select coalesce(w.last_outcome, 'UNKNOWN') as outcome, count(*) as n
            from public.property_watch w where w.failure_count >= 3 group by 1) o;

  if to_regnamespace('cron') is null then
    _state := 'no_pg_cron';
  else
    execute $q$
      select case
               when not exists (select 1 from cron.job where jobname = $1) then 'missing'
               when exists (select 1 from cron.job where jobname = $1 and active
                              and command ~ 'property_watch_run_scheduled\(\)') then 'ok'
               when exists (select 1 from cron.job where jobname = $1 and not active) then 'inactive'
               else 'wrong_command'
             end $q$
      into _state using _job;
    if to_regclass('cron.job_run_details') is not null then
      -- the newest three runs, all failed (fewer than three runs is not "failing")
      execute $q$
        select coalesce((select count(*) = 3 and bool_and(d.status = 'failed')
                           from (select r.status from cron.job_run_details r join cron.job j on j.jobid = r.jobid
                                  where j.jobname = $1 order by r.start_time desc limit 3) d), false) $q$
        into _failed using _job;
    end if;
  end if;
  job_state := _state;
  cron_failing := _failed;
  return next;
end
$fn$;
revoke all on function public.property_watch_job_health() from public, anon, authenticated;
grant execute on function public.property_watch_job_health() to service_role;

comment on function public.property_watch_job_health() is
'Development Activity step 9. Counts and fixed words only: how many watches exist, how many are more than 6 hours overdue, how many have failed
their last 3 or more checks (by outcome name), which watch invariants are broken (by name), the state of the pg_cron job property-watch-run,
and whether its last 3 runs failed to start. Returns no property, address, agent, email or error text. Read by the property_watch_run check of
pipeline_health_tick. Service-role only.';

-- ── 3. the schedule: ONE job, altered in place when it already exists ───────────────────────────────────────────────
do $cron$
declare
  _name  constant text := 'property-watch-run';
  _sched constant text := '3,13,23,33,43,53 * * * *';
  _cmd   constant text := 'select public.property_watch_run_scheduled()';
  _id    bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed here — the watch job is not scheduled';
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

-- ── 4. the check, spliced into the one monitor (live definition, one anchor, fail closed, re-read) ───────────────────
do $mig$
declare
  _def    text;
  _anchor text := 'insert into public.pipeline_health_check as c (';
  _begin  text := '-- >>> property_watch_run (begin)';
  _block  text := $blk$-- >>> property_watch_run (begin)
  -- Development Activity step 9. Reads only public.property_watch_job_health(); see
  -- docs/property-watch-schedule.sql for where every threshold comes from.
  begin
    insert into _eval
    select 'property_watch_run', (q.problems = ''), true,
           case when q.problems <> '' then q.problems
                else 'check job active; ' || h.watches || ' watch(es); none more than 6 hours overdue; none failing; no watch invariant broken' end
      from public.property_watch_job_health() h
      cross join lateral (select concat_ws('; ',
        case when h.job_state <> 'ok'
             then 'pg_cron job property-watch-run is ' || h.job_state
                  || ' — watched properties are not being checked' end,
        case when h.cron_failing
             then 'the last 3 runs of property-watch-run failed to start' end,
        case when h.overdue_n > 0
             then h.overdue_n || ' watch(es) are more than 6 hours overdue and nothing is holding them' end,
        case when h.failing_n > 0
             then h.failing_n || ' watch(es) failed their last 3 or more checks (' || h.failing_outcomes || ')' end,
        case when h.invariant_breaks > 0
             then h.invariant_breaks || ' watch invariant violation(s): ' || h.broken_invariants end
      ) as problems) q;
  exception when others then
    insert into _eval values ('property_watch_run', false, true,
      'the watch check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');
  end;
  -- <<< property_watch_run (end)
  $blk$;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if _def is null then
    raise exception 'public.pipeline_health_tick() not found — refusing to splice';
  end if;
  if position(_begin in _def) > 0 then
    raise notice 'property_watch_run already present — nothing to do';
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
  raise notice 'property_watch_run spliced into pipeline_health_tick()';
end
$mig$;

-- ROLLBACK (this file only; each line below is a statement once the leading "-- " is removed). It restores the monitor
-- byte for byte, unschedules the job and drops the two functions. It does NOT touch the watches: they stay, are simply
-- not checked until the job is armed again, and can still be listed and stopped by their agents.
-- ROLLBACK-BEGIN
-- do $rb$
-- declare _def text; _b int; _e int;
--   _begin constant text := '-- >>> property_watch_run (begin)';
--   _end   constant text := '-- <<< property_watch_run (end)';
-- begin
--   select pg_get_functiondef(p.oid) into _def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
--   _b := position(_begin in _def);
--   _e := position(_end in _def);
--   if _b > 0 and _e > _b then
--     execute substr(_def, 1, _b - 1) || substr(_def, _e + length(_end) + 3);
--   end if;
--   if to_regnamespace('cron') is not null then
--     perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'property-watch-run';
--   end if;
-- end
-- $rb$;
-- drop function if exists public.property_watch_job_health();
-- drop function if exists public.property_watch_run_scheduled();
-- ROLLBACK-END
