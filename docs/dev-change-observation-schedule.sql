-- =====================================================================================
-- THE RECURRING OBSERVATION JOB, AND THE ALARM THAT WATCHES IT
-- (Development Activity plan, change ledger; status file decision 9; founder go 2026-09-30)
--
-- The change ledger (docs/dev-change-ledger.sql) records a change only when something observes the
-- records again. The national baseline (2026-09-29) observed every canonical ZIP once, and since then
-- nothing has: the ledger holds 922,244 baseline events, reads 0 reportable events, and detects
-- nothing new. This file schedules the observation, and watches it. It adds no observation logic:
-- the walk, the due rule, the capacity gate and the ledger writes are the Order C and Order D
-- functions, unchanged.
--
--   1. public.dev_change_observe_scheduled() — what pg_cron calls. ONE ordinary run per UTC day
--      (an ordinary run can only re-observe a ZIP the baseline already covered, so it can never write
--      a first sighting as news), and one dev_change_tick per call. It chooses four numbers and
--      nothing else (the "TICK" block below). It refuses, writing nothing, unless ledger option (b)
--      — the copy-conflict hold — is applied: without it an ordinary run would announce differences
--      between ZIP copies of one record as changes (status file decision 10).
--   2. public.dev_change_observation_health() — counts, timestamps and fixed words, never a
--      project, a name, an address or an error text.
--   3. the pg_cron job `dev-change-observe`.
--   4. the check `dev_change_observation`, spliced into the ONE existing alert path
--      (public.pipeline_health_tick -> notify-health), the way the purge schedule and the
--      address-check monitor were. No second monitor, no second mailer.
--
-- THE TICK NUMBERS (the only values this file chooses; each is a constant in the function so a
-- change is a reviewed edit of this file):
--   p_max_zips 200 · p_max_seconds 60 · ledger budget 3,500 MB · min interval 24 h.
--   Budget and interval are the Order D values (design doc: the budget is ~1.6x the measured live
--   size; the ledger peaked at 1.93 GB in the national baseline). The ZIP and second caps keep one
--   call far under the 120 s statement timeout.
--
-- WHERE THE CADENCE COMES FROM: A PRODUCTION PILOT OF THE UPDATE PATH (2026-10-01, run 063858f0-…,
-- docs/development-activity-change-baseline-2026-09-30.md §12), NOT FROM THE BASELINE. The baseline
-- measured INSERTS (about 340 ZIPs a minute); this job REWRITES every record of a re-observed ZIP, and
-- EVERY one of the 12,722 canonical ZIPs is due every day (the materialiser stamps each ZIP on every
-- sweep, so "materialised since the last look" is always true and only the 24-hour interval limits the
-- walk). Measured on 175 ZIPs through the real tick, plus six named ZIPs: about 14 ZIPs a second on
-- ZIPs of ~100 rows (70 ms each); 0.5 to 0.7 ms a row on larger ones (the 13,921-row ZIP took 5.0 s);
-- 1.1 to 1.5 KB of WAL per rewritten record (a ceiling: background WAL is inside the bracket); 39 % of
-- the updates HOT. Nationally that is about 2.9 million rows read and 933,000 records rewritten a day:
-- roughly 25 to 35 minutes of work and 1 to 3 GB of WAL (a projection, not a measurement: 1.0 to 1.4 GB
-- at the tightly bracketed rate, up to 3.1 GB at the loosest), spread over the window below.
--   A pass is 12,722 ZIPs = 64 calls of 200 IF every call fills. The window therefore needs at least 64
--   calls a day. `*/5 2-6` gave 60 (12,000) and could never reach "nothing due" in a day.
--   2026-10-07 MEASUREMENT: `*/5 2-7` (72 calls) was not enough either. Calls that hold large ZIPs stop
--   on the 60-second cap with fewer than 200 observed (about 19 of 72 calls a night; the night averages
--   about 171 ZIPs a call), so a night observed about 12,300 ZIPs, about 3 % short, and about 400 ZIPs
--   slipped to the next night. `*/5 2-8` gives 84 calls (about 14,300 ZIPs at 171 a call, 12 %
--   headroom). The structural test pins that capacity at the MEASURED rate, not the nominal 200.
--   The 48-hour alarm threshold is deliberately UNCHANGED (founder, 2026-10-07: "leave 48 hour"):
--   the alarm is correct, the window was short.
--
-- THE WINDOW. 02:00 to 08:59 UTC. It ends before the daily verify-communities walk can start (cron
-- 13:17 UTC, observed starting 17:10 to 20:07 UTC, lasting 22 to 47 minutes, and the cause of 190
-- statement timeouts on its own on 2026-09-29). NO UTC HOUR IS QUIET: over the last three days cron
-- runs of more than 20 seconds (the content refresh and the development refresh) occurred in every
-- hour, 16 to 38 per hour, so the window was chosen to stay clear of the one known heavy reader, not to
-- find silence. It does overlap the nightly development-SEO refresh (05:30 UTC, about 9 minutes, reads
-- app_projects through the API under an 8-second statement timeout); both are reads of app_projects
-- and this job's calls are bounded at 60 seconds, so the overlap is a shared-cache cost, not a lock.
--
-- WHAT THE ALARM MEASURES (check `dev_change_observation`, alertable; each threshold is stated with
-- where it comes from):
--   job         the pg_cron job is missing, inactive, or no longer calls the wrapper
--   stale       no tick has completed in 36 hours (a daily window plus 12 hours; pg_cron is punctual,
--               measured 0 s late on 8 of 8 fires of the monitor's own job)
--   no_pass     no daily pass has reached "nothing due" in 48 hours, once the first tick is 48
--               hours old. A pass that never completes means the window cannot cover the sweep.
--   budget      the newest tick stopped on the ledger byte budget (the ledger is full)
--   cron        the last 3 cron runs of the job all failed (the call raised: nothing was written)
--   errors      one or more ZIPs are in error in the cursor. The national baseline had 0 of 12,722,
--               so any positive count is outside what was measured. A ZIP in error is retried only
--               after the interval, so one transient error holds the alarm up to a day: that is the
--               accepted cost of an alarm that cannot hide a systemic failure (every ZIP erroring
--               quickly would otherwise finish a "pass" in seconds and read as complete).
--   UNKNOWN     if no tick has ever run and the cron job has no recorded run, the check reports
--               ok and NOT alertable ("armed, has not run yet"), the same rule as the credential
--               probe: absence of evidence is neither a pass nor a failure.
--   A check that cannot run is a FAILING check, not a dead monitor: the spliced block catches its
--   own failure and reports it as a failing row.
--
-- Service-role only. Idempotent: re-applying changes nothing (the job is altered in place, the
-- check is spliced once) and RE-ARMS a job someone deactivated (arming is this file's job).
-- Requires docs/dev-change-ledger.sql (with option (b)), docs/dev-change-baseline.sql and
-- docs/dev-change-reportable.sql, and fails closed if any is missing.
-- =====================================================================================

-- ── 0. preconditions: refuse, changing nothing, if what this schedules is not there ───────────────
do $pre$
declare
  _d      text;
  _anchor constant text := 'insert into public.pipeline_health_check as c (';
begin
  if to_regprocedure('public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer)') is null
     or to_regprocedure('public.dev_change_start_run(boolean, jsonb)') is null
     or to_regprocedure('public.dev_change_finish_run(uuid)') is null
     or to_regclass('public.dev_change_zip_cursor') is null then
    raise exception 'docs/dev-change-baseline.sql (Order D) is not applied — refusing to schedule a walk that does not exist';
  end if;
  if to_regclass('public.dev_change_copy_conflict') is null
     or to_regprocedure('public.dev_change_record_facts(jsonb)') is null then
    raise exception 'ledger option (b) (the copy-conflict hold) is not applied — refusing: an ordinary run would announce differences between ZIP copies as changes';
  end if;
  if to_regclass('public.dev_change_event_reportable') is null then
    raise exception 'docs/dev-change-reportable.sql is not applied — refusing: the observation job must have its one reader before it writes events';
  end if;
  if to_regclass('public.pipeline_health_check') is null
     or to_regprocedure('public.pipeline_health_tick()') is null then
    raise exception 'public.pipeline_health_tick() is not there — refusing: the job must not be armed without its alarm';
  end if;
  select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) into _d;
  if position('-- >>> dev_change_observation (begin)' in _d) = 0
     and (length(_d) - length(replace(_d, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the job must not be armed without its alarm';
  end if;
end
$pre$;

-- ── 1. the wrapper pg_cron calls ───────────────────────────────────────────────────────────────────
create or replace function public.dev_change_observe_scheduled()
returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  -- TICK: the four numbers this function chooses.
  _max_zips   constant integer := 200;
  _max_secs   constant integer := 60;
  _budget_mb  constant bigint  := 3500;
  _interval_h constant integer := 24;
  _day        text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD');
  _run        uuid;
  _res        jsonb;
  _old        record;
begin
  if to_regclass('public.dev_change_copy_conflict') is null
     or to_regprocedure('public.dev_change_record_facts(jsonb)') is null then
    raise exception 'dev_change_observe_scheduled: ledger option (b) (the copy-conflict hold) is not applied — an ordinary run would announce differences between ZIP copies as changes';
  end if;

  -- One ordinary run per UTC day. The first tick of a new day closes every earlier day's run.
  for _old in select r.id from public.dev_change_run r
               where not r.baseline and r.finished_at is null
                 and r.detail->>'purpose' = 'scheduled' and r.detail->>'day' <> _day loop
    perform public.dev_change_finish_run(_old.id);
  end loop;
  select r.id into _run from public.dev_change_run r
   where not r.baseline and r.finished_at is null
     and r.detail->>'purpose' = 'scheduled' and r.detail->>'day' = _day
   order by r.started_at desc limit 1;
  if _run is null then
    _run := public.dev_change_start_run(false,
              jsonb_build_object('purpose', 'scheduled', 'day', _day, 'ticks', 0));
  end if;

  _res := public.dev_change_tick(_run, _max_zips, _max_secs, _budget_mb, null, _interval_h);

  -- The tick's own receipt is kept on the run it belongs to: the alarm reads it from here.
  update public.dev_change_run r
     set detail = r.detail || jsonb_build_object(
           'ticks',        coalesce((r.detail->>'ticks')::integer, 0) + 1,
           'last_tick_at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'last_tick',    _res,
           'completed',    coalesce((r.detail->>'completed')::boolean, false) or (_res->>'stopped_reason' = 'none_due'),
           'completed_at', coalesce(r.detail->>'completed_at',
                             case when _res->>'stopped_reason' = 'none_due'
                                  then to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end))
   where r.id = _run;

  return _res || jsonb_build_object('run', _run);
end
$fn$;
revoke all on function public.dev_change_observe_scheduled() from public, anon, authenticated;
grant execute on function public.dev_change_observe_scheduled() to service_role;

comment on function public.dev_change_observe_scheduled() is
'Development change ledger: the recurring observation. One ordinary run per UTC day, one dev_change_tick per call
(200 ZIPs, 60 s, 3,500 MB ledger budget, 24 h interval). Refuses unless ledger option (b) is applied. Writes nothing
except through the Order C/D functions and the receipt on its own run row. Service-role only; called by pg_cron.';

-- ── 2. the health read: counts, timestamps and fixed words — never a record, never an error text ──────
create or replace function public.dev_change_observation_health()
returns table (job_state text, last_tick_at timestamptz, last_stop_reason text, first_run_at timestamptz,
               last_completed_at timestamptz, zips_in_error bigint, error_zips text,
               cron_runs bigint, cron_recent_failed integer)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  _job constant text := 'dev-change-observe';
begin
  select max((r.detail->>'last_tick_at')::timestamptz),
         min(r.started_at),
         max((r.detail->>'completed_at')::timestamptz)
    into last_tick_at, first_run_at, last_completed_at
    from public.dev_change_run r
   where not r.baseline and r.detail->>'purpose' = 'scheduled';

  select r.detail->'last_tick'->>'stopped_reason' into last_stop_reason
    from public.dev_change_run r
   where not r.baseline and r.detail->>'purpose' = 'scheduled' and r.detail ? 'last_tick_at'
   order by (r.detail->>'last_tick_at')::timestamptz desc limit 1;

  select count(*) into zips_in_error from public.dev_change_zip_cursor where status = 'error';
  select coalesce(string_agg(z.zip, ', ' order by z.zip collate "C"), '') into error_zips
    from (select c.zip from public.dev_change_zip_cursor c where c.status = 'error'
           order by c.zip collate "C" limit 5) z;

  cron_runs := 0; cron_recent_failed := 0;
  if to_regnamespace('cron') is null then
    job_state := 'no_pg_cron';
  else
    execute $q$
      select case
               when not exists (select 1 from cron.job where jobname = $1) then 'missing'
               when exists (select 1 from cron.job where jobname = $1 and active
                              and command ~ 'dev_change_observe_scheduled\(\)') then 'ok'
               when exists (select 1 from cron.job where jobname = $1 and not active) then 'inactive'
               else 'wrong_command'
             end $q$
      into job_state using _job;
    if to_regclass('cron.job_run_details') is not null then
      execute $q$ select count(*) from cron.job_run_details x join cron.job j on j.jobid = x.jobid
                   where j.jobname = $1 $q$ into cron_runs using _job;
      execute $q$
        select count(*) filter (where d.status = 'failed')
          from (select x.status from cron.job_run_details x join cron.job j on j.jobid = x.jobid
                 where j.jobname = $1 order by x.start_time desc limit 3) d $q$
        into cron_recent_failed using _job;
    end if;
  end if;
  return next;
end
$fn$;
revoke all on function public.dev_change_observation_health() from public, anon, authenticated;
grant execute on function public.dev_change_observation_health() to service_role;

comment on function public.dev_change_observation_health() is
'Development change ledger: the observation job''s health. Counts, timestamps, up to five ZIP codes and fixed words.
Returns no project, name, address or error text. Read by the dev_change_observation check of pipeline_health_tick.
Service-role only.';

-- ── 3. the schedule: ONE job, altered in place when it already exists ──────────────────────────────────
do $cron$
declare
  _name  constant text := 'dev-change-observe';
  _sched constant text := '*/5 2-8 * * *';
  _cmd   constant text := 'select public.dev_change_observe_scheduled()';
  _id    bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed here — observation job not scheduled';
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

-- ── 4. the check, spliced into the one monitor (live definition, one anchor, fail closed, re-read) ─────
do $mig$
declare
  _def    text;
  _anchor text := 'insert into public.pipeline_health_check as c (';
  _begin  text := '-- >>> dev_change_observation (begin)';
  _block  text := $blk$-- >>> dev_change_observation (begin)
  -- Development change ledger: the recurring observation. Reads only
  -- public.dev_change_observation_health(); see docs/dev-change-observation-schedule.sql for where every
  -- threshold comes from.
  begin
    insert into _eval
    select 'dev_change_observation',
           (q.problems = ''),
           not (h.last_tick_at is null and h.cron_runs = 0 and h.job_state = 'ok'),
           case when q.problems <> '' then q.problems
                when h.last_tick_at is null then 'job armed; it has not run yet'
                else 'job active; last tick ' || to_char(h.last_tick_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI')
                     || ' UTC (' || coalesce(h.last_stop_reason, '?') || '); no error ZIPs' end
      from public.dev_change_observation_health() h
      cross join lateral (select concat_ws('; ',
        case when h.job_state <> 'ok'
             then 'pg_cron job dev-change-observe is ' || h.job_state || ' — the ledger is not detecting changes' end,
        case when h.last_tick_at is not null and h.last_tick_at < now() - interval '36 hours'
             then 'no observation tick has completed since ' || to_char(h.last_tick_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC (36-hour limit)' end,
        case when h.last_tick_at is null and h.cron_runs > 0
             then 'the job has run ' || h.cron_runs || ' time(s) and no tick ever completed' end,
        case when h.first_run_at is not null and h.first_run_at < now() - interval '48 hours'
                  and (h.last_completed_at is null or h.last_completed_at < now() - interval '48 hours')
             then 'no daily pass has reached "nothing due" in 48 hours — the window does not cover the sweep' end,
        case when h.last_stop_reason = 'ledger_budget'
             then 'the newest tick stopped on the ledger byte budget — the ledger is full' end,
        case when h.cron_recent_failed >= 3
             then 'the last 3 cron runs of the job all failed' end,
        case when h.zips_in_error > 0
             then h.zips_in_error || ' ZIP(s) are in error in the cursor (first: ' || h.error_zips || ')' end
      ) as problems) q;
  exception when others then
    insert into _eval values ('dev_change_observation', false, true,
      'the observation check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');
  end;
  -- <<< dev_change_observation (end)
  $blk$;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if _def is null then
    raise exception 'public.pipeline_health_tick() not found — refusing to splice';
  end if;
  if position(_begin in _def) > 0 then
    raise notice 'dev_change_observation already present — nothing to do';
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
  raise notice 'dev_change_observation spliced into pipeline_health_tick()';
end
$mig$;

-- ROLLBACK (this file only; each line below is a statement once the leading "-- " is removed). It restores the monitor
-- byte for byte, unschedules the job and drops the two functions. Runs already written, and every ledger row, stay:
-- the ledger is append-only and the job only ever wrote through its own functions.
-- ROLLBACK-BEGIN
-- do $rb$
-- declare _def text; _b int; _e int;
--   _begin constant text := '-- >>> dev_change_observation (begin)';
--   _end   constant text := '-- <<< dev_change_observation (end)';
-- begin
--   select pg_get_functiondef(p.oid) into _def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
--   _b := position(_begin in _def);
--   _e := position(_end in _def);
--   if _b > 0 and _e > _b then
--     execute substr(_def, 1, _b - 1) || substr(_def, _e + length(_end) + 3);
--   end if;
--   if to_regnamespace('cron') is not null then
--     perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dev-change-observe';
--   end if;
-- end
-- $rb$;
-- drop function if exists public.dev_change_observation_health();
-- drop function if exists public.dev_change_observe_scheduled();
-- ROLLBACK-END
