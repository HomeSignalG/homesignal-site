-- Map 1 step (a): give the daily pick refresh the 15-minute limit its function already asks for.
--
-- WHY. public.app_project_pick_refresh() declares `set statement_timeout = '15min'`, but that
-- setting does not apply to the statement that CALLS it: the 120 s limit of the calling session is
-- armed when `select public.app_project_pick_refresh()` starts, and a function-level SET changes
-- only the statements that begin after it. So the daily run (pg_cron job 83, 04:50 UTC) has been
-- cancelled at exactly 120.0 s whenever it ran slow: 2026-10-05 and 2026-10-06
-- (cron.job_run_details: "canceling statement due to statement timeout"). Its normal runs took
-- 95-107 s. A cancelled run rolls back, so Map 1 kept the previous picks for another day.
--
-- WHAT. One edit: the job's command becomes
--     set statement_timeout = '15min'; select public.app_project_pick_refresh()
-- pg_cron sends the command as one simple query, and each statement in it takes the limit in force
-- when it starts, so the select runs under 15 minutes. Nothing else changes: same schedule, same
-- function, same advisory lock. This is a background job with no resident waiting on it; it is NOT
-- the PostgREST path (the Rule D reader keeps its 8 s limit and the rule "shrink the call, never
-- raise the limit" for that path).
--
-- NOT A FIX THAT WORKS BY SPLITTING THE JOB. Tried and measured 2026-10-08: the function's first
-- step hashes every one of the ~3.2 M app_projects rows whatever p_part is, so a quarter costs
-- nearly the whole scan (quarter 0: 40.9 s; quarter 1: cancelled at 120 s on a cold read). Four
-- quarters would pay that scan four times. Parts remain useful only for a first fill.
--
-- APPLIED 2026-10-08 14:58Z (execute_sql, the DO block below byte for byte). Proven first on a
-- throwaway job with the same prefix: `set statement_timeout = '15min'; select pg_sleep(135)`
-- succeeded in 135 s (14:55:00 -> 14:57:15), past the 120 s cap. The first test was cancelled
-- because the job was unscheduled while it ran; unscheduling a running pg_cron job cancels it.
-- The first real run under the new command is 2026-10-09 04:50 UTC.
--
-- SAFETY. One transaction. Refuses unless job 83 carries exactly the original command and the
-- function is the applied body (md5 e36b0263e217ab8a36fcb357c4fe027e). Idempotent. Undo:
-- docs/map1-representative-pick-timeout.rollback.sql.

do $$
declare
  v_job bigint;
  v_cmd text;
  v_new constant text := 'set statement_timeout = ''15min''; select public.app_project_pick_refresh()';
begin
  if md5((select prosrc from pg_proc where oid = 'public.app_project_pick_refresh(integer,integer)'::regprocedure))
       <> 'e36b0263e217ab8a36fcb357c4fe027e' then
    raise exception 'map1 pick timeout: public.app_project_pick_refresh is not the applied body (md5 e36b0263...). Not changed.';
  end if;

  select jobid, command into v_job, v_cmd from cron.job where jobname = 'app-project-pick-refresh';
  if v_job is null then
    raise exception 'map1 pick timeout: cron job app-project-pick-refresh does not exist. Not changed.';
  end if;

  if v_cmd = 'select public.app_project_pick_refresh()' then
    perform cron.alter_job(job_id := v_job, command := v_new);
    raise notice 'map1 pick timeout: job % now runs under a 15 minute limit', v_job;
  elsif v_cmd = v_new then
    raise notice 'map1 pick timeout: job % already carries the 15 minute limit, left alone', v_job;
  else
    raise exception 'map1 pick timeout: job % carries another command (%). Not changed.', v_job, v_cmd;
  end if;

  if (select count(*) from cron.job where command like '%app_project_pick_refresh%') <> 1
     or (select command from cron.job where jobid = v_job) <> v_new
     or (select schedule from cron.job where jobid = v_job) <> '50 4 * * *'
     or not (select active from cron.job where jobid = v_job) then
    raise exception 'map1 pick timeout: post-condition failed. Rolled back.';
  end if;
end
$$;
