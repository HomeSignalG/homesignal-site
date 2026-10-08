-- Undo docs/map1-representative-pick-timeout.sql: the daily pick refresh goes back to
-- `select public.app_project_pick_refresh()` under the calling session's 120 s limit.
-- NOT APPLIED. Changes the one job's command and nothing else.

do $$
declare
  v_job bigint;
  v_cmd text;
begin
  select jobid, command into v_job, v_cmd from cron.job where jobname = 'app-project-pick-refresh';
  if v_job is null then
    raise exception 'map1 pick timeout rollback: job app-project-pick-refresh does not exist. Not changed.';
  end if;
  if v_cmd not in ('select public.app_project_pick_refresh()',
                   'set statement_timeout = ''15min''; select public.app_project_pick_refresh()') then
    raise exception 'map1 pick timeout rollback: job % carries another command (%). Not changed.', v_job, v_cmd;
  end if;
  perform cron.alter_job(job_id := v_job, command := 'select public.app_project_pick_refresh()');
  if (select command from cron.job where jobid = v_job) <> 'select public.app_project_pick_refresh()' then
    raise exception 'map1 pick timeout rollback: post-condition failed. Rolled back.';
  end if;
end
$$;
