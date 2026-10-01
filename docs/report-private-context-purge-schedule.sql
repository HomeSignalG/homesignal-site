-- =====================================================================================
-- ORDER F2, GATE 5: ARM THE PRIVATE-CONTEXT PURGE, AND WATCH IT
-- (docs/report-private-context-contract-2026-09-30.md §6 gate 5; founder go 2026-09-30)
--
-- The deletable layer (docs/report-private-context.sql) keeps a customer-entered street address for
-- as long as something needs it and for no more than 90 days after the last need ends. The rule
-- was written, tested and live — and nothing ran it. This file does two things and nothing else:
--
--   1. SCHEDULES the one purge decision that already exists. pg_cron job
--      `report-private-context-purge` calls public.report_private_context_purge_due() at minutes
--      5, 20, 35 and 50 of every hour. It adds no purge logic: the batch, the per-context purge,
--      the in-place blanking, the audit log and the refusal to purge a context that something
--      still needs are all the F2 functions, unchanged.
--
--      CADENCE (the one number this file chooses, stated so it can be changed): every 15 minutes.
--      The founder's value is "no more than 90 days after the last need ends". A context's clock
--      is set to exactly 90 days (purge_due_at, enforced as a CHECK), so the job's period is the
--      only slack between "due" and "blanked" — 15 minutes, not the 24 hours a daily job would
--      add to a rule that says "no more than". The batch is a scan of the contexts whose clock
--      has run out; with the table at 0 rows it costs nothing, and at any realistic size it is
--      still one small indexed-or-sequential read per run.
--
--   2. WATCHES it, on the ONE existing alert path (public.pipeline_health_tick, pg_cron hourly at
--      :10 -> notify-health), the same way docs/dc-address-check-monitor.sql did. No second
--      monitor, no second mailer. The new check `report_private_context_retention` is ALERTABLE
--      and FAILS when any of these holds:
--        job        the pg_cron job is missing, inactive, or no longer calls the purge batch
--        overdue    a private context is more than 1 hour past its purge date and still holds its
--                   values. 1 hour is four missed runs of a job that fires every 15 minutes; pg_cron
--                   is punctual (the monitor's own job, measured 0 s late on 8 of 8 fires), so a
--                   context stuck for an hour means the job is not purging, not that it is late.
--                   This measures the HARM directly (a private value held past its ceiling), so a
--                   job that runs and fails is caught exactly as one that does not run.
--        invariant  any invariant of public.report_private_context_retention_check() is non-zero
--                   (a purged context still holding a value, a clock beyond 90 days, ...). Those
--                   are the F2 audit's own definitions: this reads them, it does not re-derive them.
--      and it NEVER carries a private value: the function below returns counts, one timestamp and
--      fixed words, and selects no private column.
--
--      A check that cannot run is a FAILING check, not a dead monitor: the spliced block catches
--      its own failure and reports it as a failing row, so rolling back or breaking this one
--      function can never stop the other 19 checks from running.
--
-- THE OVERDUE DEFINITION IS NOT A SECOND ONE. retention_check()'s `clock_expired_but_not_yet_purged`
-- lag row is "state = 'active' and purge_due_at <= now()". purge_health() uses the same predicate
-- with a grace interval so the monitor can tolerate the job's own period; with grace = 0 the two
-- are identical, and test/report_private_context_purge_pg pins that on a mixed state.
--
-- Service-role only. Idempotent: re-applying changes nothing (the job is altered in place, the check
-- is spliced once). Requires docs/report-private-context.sql to be applied first, and fails closed
-- if it is not.
-- =====================================================================================

-- ── 0. preconditions: refuse, changing nothing, if the layer this schedules is not there ─────────
do $pre$
declare
  _d      text;
  _anchor constant text := 'insert into public.pipeline_health_check as c (';
begin
  if to_regclass('public.report_private_context') is null
     or to_regprocedure('public.report_private_context_purge_due()') is null
     or to_regprocedure('public.report_private_context_purge(uuid, text)') is null
     or to_regprocedure('public.report_private_context_retention_check()') is null then
    raise exception 'docs/report-private-context.sql is not applied — refusing to schedule a purge that does not exist';
  end if;
  if to_regclass('public.pipeline_health_check') is null
     or to_regprocedure('public.pipeline_health_tick()') is null then
    raise exception 'public.pipeline_health_tick() is not there — refusing: the purge must not be armed without its alarm';
  end if;
  -- The alarm has to be spliceable BEFORE the job is armed: the whole file is one transaction in a migration, but
  -- refusing here (with nothing yet written) is the same guarantee without depending on how the file is run.
  select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) into _d;
  if position('-- >>> report_private_context_retention (begin)' in _d) = 0
     and (length(_d) - length(replace(_d, _anchor, ''))) / length(_anchor) <> 1 then
    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the purge must not be armed without its alarm';
  end if;
end
$pre$;

-- ── 1. the health read: counts, one timestamp, fixed words — never a private value ────────────────
create or replace function public.report_private_context_purge_health(p_grace interval default interval '1 hour')
returns table (contexts_total bigint, active_n bigint, overdue_n bigint, oldest_overdue_at timestamptz,
               invariant_breaks bigint, broken_invariants text, job_state text)
language plpgsql security definer set search_path = public, pg_temp
as $fn$
declare
  _job   constant text := 'report-private-context-purge';
  _state text;
begin
  select count(*),
         count(*) filter (where c.state = 'active'),
         count(*) filter (where c.state = 'active' and c.purge_due_at is not null and c.purge_due_at <= now() - p_grace),
         min(c.purge_due_at) filter (where c.state = 'active' and c.purge_due_at is not null and c.purge_due_at <= now() - p_grace)
    into contexts_total, active_n, overdue_n, oldest_overdue_at
    from public.report_private_context c;

  select coalesce(sum(r.violations), 0),
         coalesce(string_agg(r.check_name, ', ' order by r.check_name collate "C") filter (where r.violations > 0), '')
    into invariant_breaks, broken_invariants
    from public.report_private_context_retention_check() r
   where r.kind = 'invariant';

  if to_regnamespace('cron') is null then
    _state := 'no_pg_cron';
  else
    execute $q$
      select case
               when not exists (select 1 from cron.job where jobname = $1) then 'missing'
               when exists (select 1 from cron.job where jobname = $1 and active
                              and command ~ 'report_private_context_purge_due\(\)') then 'ok'
               when exists (select 1 from cron.job where jobname = $1 and not active) then 'inactive'
               else 'wrong_command'
             end $q$
      into _state using _job;
  end if;
  job_state := _state;
  return next;
end
$fn$;
revoke all on function public.report_private_context_purge_health(interval) from public, anon, authenticated;
grant execute on function public.report_private_context_purge_health(interval) to service_role;

comment on function public.report_private_context_purge_health(interval) is
'ORDER F2 gate 5. Counts only: private contexts held, how many are past their purge date by more than the grace,
the oldest such date, the F2 retention invariants that are broken (by name), and the state of the pg_cron job
report-private-context-purge. Returns no private value. Read by the report_private_context_retention check of
pipeline_health_tick. Service-role only.';

-- ── 2. the schedule: ONE job, altered in place when it already exists ─────────────────────────────
do $cron$
declare
  _name  constant text := 'report-private-context-purge';
  _sched constant text := '5,20,35,50 * * * *';
  _cmd   constant text := 'select public.report_private_context_purge_due()';
  _id    bigint;
begin
  if to_regnamespace('cron') is null then
    raise notice 'pg_cron not installed here — purge job not scheduled';
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

-- ── 3. the check, spliced into the one monitor (live definition, one anchor, fail closed, re-read) ──
do $mig$
declare
  _def    text;
  _anchor text := 'insert into public.pipeline_health_check as c (';
  _begin  text := '-- >>> report_private_context_retention (begin)';
  _block  text := $blk$-- >>> report_private_context_retention (begin)
  -- ORDER F2 gate 5. Reads only public.report_private_context_purge_health(); see
  -- docs/report-private-context-purge-schedule.sql for where every threshold comes from.
  begin
    insert into _eval
    select 'report_private_context_retention', (q.problems = ''), true,
           case when q.problems <> '' then q.problems
                else 'purge job active; ' || h.active_n || ' private context(s) held (' || h.contexts_total
                     || ' ever created); none more than 1 hour past its purge date; no retention invariant broken' end
      from public.report_private_context_purge_health(interval '1 hour') h
      cross join lateral (select concat_ws('; ',
        case when h.job_state <> 'ok'
             then 'pg_cron job report-private-context-purge is ' || h.job_state
                  || ' — private contexts are not being purged' end,
        case when h.overdue_n > 0
             then h.overdue_n || ' private context(s) are more than 1 hour past their purge date and still hold their values'
                  || ' (oldest due ' || to_char(h.oldest_overdue_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)' end,
        case when h.invariant_breaks > 0
             then h.invariant_breaks || ' retention invariant violation(s): ' || h.broken_invariants end
      ) as problems) q;
  exception when others then
    insert into _eval values ('report_private_context_retention', false, true,
      'the retention check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');
  end;
  -- <<< report_private_context_retention (end)
  $blk$;
begin
  select pg_get_functiondef(p.oid) into _def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
  if _def is null then
    raise exception 'public.pipeline_health_tick() not found — refusing to splice';
  end if;
  if position(_begin in _def) > 0 then
    raise notice 'report_private_context_retention already present — nothing to do';
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
  raise notice 'report_private_context_retention spliced into pipeline_health_tick()';
end
$mig$;

-- ROLLBACK (this file only; each line below is a statement once the leading "-- " is removed). It restores the monitor
-- byte for byte, unschedules the job and drops the health function. It does NOT touch the private layer: contexts
-- already held stay, and the batch stays callable by hand. test/report_private_context_purge_pg proves the round trip.
-- ROLLBACK-BEGIN
-- do $rb$
-- declare _def text; _b int; _e int;
--   _begin constant text := '-- >>> report_private_context_retention (begin)';
--   _end   constant text := '-- <<< report_private_context_retention (end)';
-- begin
--   select pg_get_functiondef(p.oid) into _def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname = 'pipeline_health_tick';
--   _b := position(_begin in _def);
--   _e := position(_end in _def);
--   if _b > 0 and _e > _b then
--     execute substr(_def, 1, _b - 1) || substr(_def, _e + length(_end) + 3);
--   end if;
--   if to_regnamespace('cron') is not null then
--     perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'report-private-context-purge';
--   end if;
-- end
-- $rb$;
-- drop function if exists public.report_private_context_purge_health(interval);
-- ROLLBACK-END
