#!/usr/bin/env python3
"""Prohibited mutations of docs/dev-change-observation-schedule.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply
(a mutation that does not apply is indistinguishable from one that survives).

NOT mutations, on purpose (each is pinned by test/dev-change-observation-structure.test.mjs instead, because
no disposable-database scenario can observe it):
  * the tick numbers _max_secs = 60 / _budget_mb = 3500: the suite proves the cap is exactly 200 ZIPs (W15) and the
    interval is 24 h (W14), but not that the time limit is not 600 s, nor that the budget is not 1 MB
    (the ledger in a disposable database is below the 1 MB minimum, so the stop could never trip -- the same
    finding as the Order D baseline suite);
  * removing `security definer` from the wrapper: the cron job runs as the owner either way, and the suite's
    role checks go through has_function_privilege, so the change is invisible to it;
  * removing the explicit `grant execute ... to service_role`: an EQUIVALENT mutant, because Supabase's default
    privileges already grant execute on every new public function to service_role (the fixture reproduces them).
"""
import sys

PRE_B = ("    raise exception 'ledger option (b) (the copy-conflict hold) is not applied — refusing: an ordinary run would "
         "announce differences between ZIP copies as changes';")
PRE_D = "    raise exception 'docs/dev-change-baseline.sql (Order D) is not applied — refusing to schedule a walk that does not exist';"
PRE_R = "    raise exception 'docs/dev-change-reportable.sql is not applied — refusing: the observation job must have its one reader before it writes events';"
PRE_A = "    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the job must not be armed without its alarm';"
WRAP_B = ("    raise exception 'dev_change_observe_scheduled: ledger option (b) (the copy-conflict hold) is not applied — an ordinary "
          "run would announce differences between ZIP copies as changes';")
START_RUN = "    _run := public.dev_change_start_run(false,"
REUSE = "     and r.detail->>'purpose' = 'scheduled' and r.detail->>'day' = _day\n"
CLOSE_OLD = "    perform public.dev_change_finish_run(_old.id);"
STICKY = "           'completed',    coalesce((r.detail->>'completed')::boolean, false) or (_res->>'stopped_reason' = 'none_due'),"
COMPLETED_AT = "           'completed_at', coalesce(r.detail->>'completed_at',"
COMPLETED_AT_CASE = ("           'completed_at', coalesce(r.detail->>'completed_at',\n"
                     "                             case when _res->>'stopped_reason' = 'none_due'")
TICKS = "           'ticks',        coalesce((r.detail->>'ticks')::integer, 0) + 1,"
LAST_TICK = "           'last_tick',    _res,"
MAX_ZIPS = "  _max_zips   constant integer := 200;"
INTERVAL = "  _interval_h constant integer := 24;"
SCHED = "  _sched constant text := '*/5 2-8 * * *';"
CMD = "  _cmd   constant text := 'select public.dev_change_observe_scheduled()';"
ALTER = "    perform cron.alter_job(_id, schedule := _sched, command := _cmd, active := true);"
JOB_MISSING = "when not exists (select 1 from cron.job where jobname = $1) then 'missing'"
JOB_ACTIVE = ("when exists (select 1 from cron.job where jobname = $1 and active\n"
              "                              and command ~ 'dev_change_observe_scheduled\\(\\)') then 'ok'")
STALE = "case when h.last_tick_at is not null and h.last_tick_at < now() - interval '36 hours'"
PASS_FIRST = "case when h.first_run_at is not null and h.first_run_at < now() - interval '48 hours'"
PASS_DONE = "and (h.last_completed_at is null or h.last_completed_at < now() - interval '48 hours')"
BUDGET = "case when h.last_stop_reason = 'ledger_budget'"
CRON_FAIL = "case when h.cron_recent_failed >= 3"
ERRORS = "case when h.zips_in_error > 0"
ALERTABLE = "           not (h.last_tick_at is null and h.cron_runs = 0 and h.job_state = 'ok'),"
NEVER_TICKED = "case when h.last_tick_at is null and h.cron_runs > 0"
HANDLER = ("  exception when others then\n"
           "    insert into _eval values ('dev_change_observation', false, true,\n"
           "      'the observation check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');\n"
           "  end;\n")
LAST_TICK_MAX = "  select max((r.detail->>'last_tick_at')::timestamptz),"
DONE_MAX = "         max((r.detail->>'completed_at')::timestamptz)"
STOP_ORDER = "   order by (r.detail->>'last_tick_at')::timestamptz desc limit 1;"
PURPOSE_FILTER = "   where not r.baseline and r.detail->>'purpose' = 'scheduled';"
ERR_SELECT = ("  select coalesce(string_agg(z.zip, ', ' order by z.zip collate \"C\"), '') into error_zips\n"
              "    from (select c.zip from public.dev_change_zip_cursor c where c.status = 'error'")
REVOKE_WRAP = "revoke all on function public.dev_change_observe_scheduled() from public, anon, authenticated;\n"
REVOKE_HEALTH = "revoke all on function public.dev_change_observation_health() from public, anon, authenticated;\n"
SPLICE_ONCE = ("  if position(_begin in _def) > 0 then\n"
               "    raise notice 'dev_change_observation already present — nothing to do';\n"
               "    return;\n  end if;\n")
RB_RESTORE = "--     execute substr(_def, 1, _b - 1) || substr(_def, _e + length(_end) + 3);"
RB_UNSCHEDULE = "--     perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'dev-change-observe';"
RB_DROP_H = "-- drop function if exists public.dev_change_observation_health();"
RB_DROP_W = "-- drop function if exists public.dev_change_observe_scheduled();"

MUTATIONS = {
    # ---- the wrapper ---------------------------------------------------------------------------------------
    'wrapper_starts_a_baseline_run': [(START_RUN, "    _run := public.dev_change_start_run(true,", 1)],
    'wrapper_without_option_b_refusal': [(WRAP_B, "    null;", 1)],
    'wrapper_opens_a_run_per_tick': [(REUSE, "     and false\n", 1)],
    'wrapper_never_closes_an_old_day': [(CLOSE_OLD, "    null;", 1)],
    'completed_is_not_sticky': [(STICKY, "           'completed',    (_res->>'stopped_reason' = 'none_due'),", 1)],
    'completed_at_is_overwritten': [(COMPLETED_AT, "           'completed_at', coalesce(null::text,", 1)],
    'ticks_not_counted': [(TICKS, "           'ticks',        coalesce((r.detail->>'ticks')::integer, 0) + 0,", 1)],
    'last_tick_not_recorded': [(LAST_TICK, "           'last_tick',    '{}'::jsonb,", 1)],
    'tick_cap_of_one_zip': [(MAX_ZIPS, "  _max_zips   constant integer := 1;", 1)],
    'tick_cap_of_500_zips': [(MAX_ZIPS, "  _max_zips   constant integer := 500;", 1)],
    'completion_declared_on_any_tick': [(STICKY, "           'completed',    true,", 1)],
    'completed_at_set_on_any_tick': [(COMPLETED_AT_CASE, "           'completed_at', coalesce(r.detail->>'completed_at',\n                             case when true", 1)],
    'interval_of_one_hour': [(INTERVAL, "  _interval_h constant integer := 1;", 1)],
    'interval_of_72_hours': [(INTERVAL, "  _interval_h constant integer := 72;", 1)],
    # ---- the job -----------------------------------------------------------------------------------------------
    'schedule_every_minute': [(SCHED, "  _sched constant text := '* * * * *';", 1)],
    'schedule_all_day': [(SCHED, "  _sched constant text := '*/5 * * * *';", 1)],
    'schedule_window_cannot_cover_the_sweep': [(SCHED, "  _sched constant text := '*/5 2-6 * * *';", 1)],
    'job_runs_the_wrong_command': [(CMD, "  _cmd   constant text := 'select 1';", 1)],
    'job_not_reactivated_on_reapply': [(ALTER, "    perform cron.alter_job(_id, schedule := _sched, command := _cmd);", 1)],
    'job_tamper_not_corrected_on_reapply': [(ALTER, "    perform cron.alter_job(_id, active := true);", 1)],
    # ---- the health read ------------------------------------------------------------------------------------------
    'missing_job_reads_ok': [(JOB_MISSING, "when not exists (select 1 from cron.job where jobname = $1) then 'ok'", 1)],
    'inactive_job_reads_ok': [(JOB_ACTIVE, "when exists (select 1 from cron.job where jobname = $1\n"
                                            "                              and command ~ 'dev_change_observe_scheduled\\(\\)') then 'ok'", 1)],
    'wrong_command_reads_ok': [(JOB_ACTIVE, "when exists (select 1 from cron.job where jobname = $1 and active) then 'ok'", 1)],
    'last_tick_is_the_oldest': [(LAST_TICK_MAX, "  select min((r.detail->>'last_tick_at')::timestamptz),", 1)],
    'last_completed_is_the_oldest': [(DONE_MAX, "         min((r.detail->>'completed_at')::timestamptz)", 1)],
    'stop_reason_from_the_oldest_run': [(STOP_ORDER, "   order by (r.detail->>'last_tick_at')::timestamptz asc limit 1;", 1)],
    'retired_runs_are_counted': [(PURPOSE_FILTER, "   where not r.baseline;", 1)],
    'health_leaks_an_error_text': [(ERR_SELECT, "  select coalesce(string_agg(z.zip || ' ' || z.error, ', ' order by z.zip collate \"C\"), '') into error_zips\n"
                                                 "    from (select c.zip, c.error from public.dev_change_zip_cursor c where c.status = 'error'", 1)],
    # ---- the monitor check: each threshold, on both sides of its boundary ------------------------------------------------
    'stale_limit_is_48_hours': [(STALE, STALE.replace('36', '48'), 1)],
    'stale_limit_is_24_hours': [(STALE, STALE.replace('36', '24'), 1)],
    'no_pass_limit_is_72_hours': [(PASS_FIRST, PASS_FIRST.replace('48', '72'), 1), (PASS_DONE, PASS_DONE.replace('48', '72'), 1)],
    'no_pass_limit_is_24_hours': [(PASS_FIRST, PASS_FIRST.replace('48', '24'), 1), (PASS_DONE, PASS_DONE.replace('48', '24'), 1)],
    'no_pass_ignores_the_warming_up_period': [(PASS_FIRST, "case when true", 1)],
    'ledger_budget_stop_ignored': [(BUDGET, "case when false", 1)],
    'three_failed_cron_runs_become_two': [(CRON_FAIL, "case when h.cron_recent_failed >= 2", 1)],
    'three_failed_cron_runs_become_four': [(CRON_FAIL, "case when h.cron_recent_failed >= 4", 1)],
    'zips_in_error_ignored': [(ERRORS, "case when false", 1)],
    'zips_in_error_needs_ten': [(ERRORS, "case when h.zips_in_error > 10", 1)],
    'unknown_state_is_alertable': [(ALERTABLE, "           true,", 1)],
    'check_cannot_page': [(ALERTABLE, "           false,", 1)],
    'never_ticked_but_ran_is_ok': [(NEVER_TICKED, "case when false", 1)],
    'check_has_no_failure_handler': [(HANDLER, "  end;\n", 1)],
    # ---- who may call it --------------------------------------------------------------------------------------------------
    'wrapper_open_to_the_api_roles': [(REVOKE_WRAP, "", 1)],
    'health_read_open_to_the_api_roles': [(REVOKE_HEALTH, "", 1)],
    # ---- failing closed ---------------------------------------------------------------------------------------------------------
    'arms_without_option_b': [(PRE_B, "    null;", 1)],
    'arms_without_the_driver': [(PRE_D, "    null;", 1)],
    'arms_without_the_reader': [(PRE_R, "    null;", 1)],
    'arms_without_a_splice_anchor': [(PRE_A, "    null;", 1)],
    'splice_is_not_idempotent': [(SPLICE_ONCE, "", 1)],
    # ---- the rollback ---------------------------------------------------------------------------------------------------------------
    'rollback_leaves_the_check': [(RB_RESTORE, "--     null;", 1)],
    'rollback_leaves_the_job': [(RB_UNSCHEDULE, "--     null;", 1)],
    'rollback_leaves_the_health_function': [(RB_DROP_H, "-- select 1;", 1)],
    'rollback_leaves_the_wrapper': [(RB_DROP_W, "-- select 1;", 1)],
}


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--list':
        print('\n'.join(MUTATIONS))
        return 0
    if len(sys.argv) != 3 or sys.argv[1] not in MUTATIONS:
        sys.stderr.write('usage: mutate.py --list | NAME FILE\n')
        return 2
    text = open(sys.argv[2]).read()
    for old, new, count in MUTATIONS[sys.argv[1]]:
        if text.count(old) != count:
            sys.stderr.write('anchor for %s matched %d time(s), expected %d\n' % (sys.argv[1], text.count(old), count))
            return 2
        if old == new:
            sys.stderr.write('mutation %s changes nothing\n' % sys.argv[1])
            return 2
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
