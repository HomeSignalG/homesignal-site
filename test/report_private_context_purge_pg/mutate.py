#!/usr/bin/env python3
"""Prohibited mutations of docs/report-private-context-purge-schedule.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply
(a mutation that does not apply is indistinguishable from one that survives).
"""
import sys

SCHED = "  _sched constant text := '5,20,35,50 * * * *';"
CMD = "  _cmd   constant text := 'select public.report_private_context_purge_due()';"
GRACE_CALL = "from public.report_private_context_purge_health(interval '1 hour') h"
OVERDUE_FILTER = "count(*) filter (where c.state = 'active' and c.purge_due_at is not null and c.purge_due_at <= now() - p_grace),"
INVARIANT_WHERE = "   where r.kind = 'invariant';"
JOB_MISSING = "when not exists (select 1 from cron.job where jobname = $1) then 'missing'"
JOB_ACTIVE = "when exists (select 1 from cron.job where jobname = $1 and active\n                              and command ~ 'report_private_context_purge_due\\(\\)') then 'ok'"
ALERTABLE = "select 'report_private_context_retention', (q.problems = ''), true,"
WRAPPER = ("  exception when others then\n"
           "    insert into _eval values ('report_private_context_retention', false, true,\n"
           "      'the retention check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');\n"
           "  end;\n")
OK_DETAIL = "|| ' ever created); none more than 1 hour past its purge date; no retention invariant broken' end"
REVOKE = "revoke all on function public.report_private_context_purge_health(interval) from public, anon, authenticated;\n"
# NOT a mutation, on purpose: removing the explicit `grant execute ... to service_role` is an EQUIVALENT mutant here.
# Supabase's default privileges already grant execute on every new public function to service_role (the fixture
# reproduces them), and the F2 lock-down loop only revokes anon/authenticated. The grant is belt and braces; a suite
# that "killed" its removal would be asserting the fixture, not the file.
DEFINER = "language plpgsql security definer set search_path = public, pg_temp\nas $fn$"
PRE_F2 = "    raise exception 'docs/report-private-context.sql is not applied — refusing to schedule a purge that does not exist';"
PRE_ANCHOR = "    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the purge must not be armed without its alarm';"
RB_RESTORE = "--     execute substr(_def, 1, _b - 1) || substr(_def, _e + length(_end) + 3);"
RB_UNSCHEDULE = "--     perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'report-private-context-purge';"
RB_DROP = "-- drop function if exists public.report_private_context_purge_health(interval);"
ACTIVE_RESET = "    perform cron.alter_job(_id, schedule := _sched, command := _cmd, active := true);"
SPLICE_ONCE = "  if position(_begin in _def) > 0 then\n    raise notice 'report_private_context_retention already present — nothing to do';\n    return;\n  end if;\n"

MUTATIONS = {
    # ---- the schedule -----------------------------------------------------------------------------------
    'schedule_is_daily': [(SCHED, "  _sched constant text := '5 3 * * *';", 1)],
    'schedule_every_30_minutes': [(SCHED, "  _sched constant text := '5,35 * * * *';", 1)],
    'job_runs_the_wrong_command': [(CMD, "  _cmd   constant text := 'select 1';", 1)],
    'job_does_its_own_purge': [(CMD, "  _cmd   constant text := $c$update public.report_private_context set address = null where purge_due_at <= now()$c$;", 1)],
    'job_not_reactivated_on_reapply': [(ACTIVE_RESET, "    perform cron.alter_job(_id, schedule := _sched, command := _cmd);", 1)],
    # ---- the health read ----------------------------------------------------------------------------------
    'overdue_counts_contexts_not_yet_due': [(OVERDUE_FILTER, "count(*) filter (where c.state = 'active' and c.purge_due_at is not null and c.purge_due_at <= now() + interval '100 years'),", 1)],
    'invariants_ignored': [(INVARIANT_WHERE, "   where false;", 1)],
    'missing_job_reads_ok': [(JOB_MISSING, "when not exists (select 1 from cron.job where jobname = $1) then 'ok'", 1)],
    'inactive_job_reads_ok': [(JOB_ACTIVE, "when exists (select 1 from cron.job where jobname = $1\n                              and command ~ 'report_private_context_purge_due\\(\\)') then 'ok'", 1)],
    'wrong_command_reads_ok': [(JOB_ACTIVE, "when exists (select 1 from cron.job where jobname = $1 and active) then 'ok'", 1)],
    # ---- the monitor check ------------------------------------------------------------------------------------
    'grace_is_zero': [(GRACE_CALL, "from public.report_private_context_purge_health(interval '0 hours') h", 1)],
    'grace_is_100_days': [(GRACE_CALL, "from public.report_private_context_purge_health(interval '100 days') h", 1)],
    'check_cannot_page': [(ALERTABLE, "select 'report_private_context_retention', (q.problems = ''), false,", 1)],
    'check_has_no_failure_handler': [(WRAPPER, "  end;\n", 1)],
    'detail_leaks_an_address': [(OK_DETAIL, "|| ' ever created); none more than 1 hour past its purge date; no retention invariant broken '\n                     || coalesce((select c2.address from public.report_private_context c2 where c2.state = 'active' limit 1), '') end", 1)],
    # ---- who may call it ---------------------------------------------------------------------------------------------
    'health_read_open_to_the_api_roles': [(REVOKE, "", 1)],
    'health_read_not_security_definer': [(DEFINER, "language plpgsql set search_path = public, pg_temp\nas $fn$", 1)],
    # ---- failing closed -------------------------------------------------------------------------------------------------
    'arms_the_purge_without_the_private_layer': [(PRE_F2, "    null;", 1)],
    'arms_the_purge_without_a_splice_anchor': [(PRE_ANCHOR, "    null;", 1)],
    'splice_is_not_idempotent': [(SPLICE_ONCE, "", 1)],
    # ---- the rollback ---------------------------------------------------------------------------------------------------------
    'rollback_leaves_the_check': [(RB_RESTORE, "--     null;", 1)],
    'rollback_leaves_the_job': [(RB_UNSCHEDULE, "--     null;", 1)],
    'rollback_leaves_the_function': [(RB_DROP, "-- select 1;", 1)],
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
