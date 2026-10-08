#!/usr/bin/env python3
"""Prohibited mutations of docs/report-service-monitor.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply
(a mutation that does not apply is indistinguishable from one that survives).
"""
import sys

M = {
    # ---- the probe ---------------------------------------------------------------------------------------------
    'probe_one_function_missing': [("array['get-development-activity-report', 'manage-billing', 'development-activity-billing-webhook'] loop\n    begin",
                                    "array['get-development-activity-report', 'manage-billing'] loop\n    begin", 1)],
    'probe_timeout_is_5_seconds': [("timeout_milliseconds := 15000", "timeout_milliseconds := 5000", 1)],
    'probe_sends_no_key': [("headers := jsonb_build_object('apikey', _anon, 'Authorization', 'Bearer ' || _anon),", "headers := '{}'::jsonb,", 1)],
    'probe_never_trims_its_log': [("  delete from public.report_service_probe where fired_at < now() - interval '3 days';\n", "", 1)],
    'probe_fire_open_to_the_api_roles': [("revoke all on function public.report_service_probe_fire() from public, anon, authenticated;\n", "", 1)],
    'health_read_open_to_the_api_roles': [("revoke all on function public.report_service_health() from public, anon, authenticated;\n", "", 1)],
    'probe_log_readable_by_the_api_roles': [("revoke all on public.report_service_probe from public, anon, authenticated;\n", "", 1)],
    'probe_log_without_row_security': [("alter table public.report_service_probe enable row level security;\n", "", 1)],
    # ---- the health read -----------------------------------------------------------------------------------------
    'one_bad_answer_pages': [("elsif _n >= 2 and _bad = 2 then", "elsif _bad >= 1 then", 1)],
    'needs_three_bad_answers': [("limit 2)", "limit 3)", 1), ("elsif _n >= 2 and _bad = 2 then", "elsif _n >= 3 and _bad = 3 then", 1)],
    'status_404_is_fine': [("j.status_code is distinct from 200\n", "j.status_code is distinct from 404\n", 1)],
    'timeout_is_not_a_failure': [("count(*) filter (where j.timed_out is true or j.status_code is distinct from 200", "count(*) filter (where j.status_code is distinct from 200", 1)],
    'webhook_not_set_up_reads_ok': [("or (_fn = 'development-activity-billing-webhook' and j.configured is distinct from 'true'))", ")", 1)],
    'webhook_configured_false_reads_true': [("then 'true' else 'false' end", "then 'true' else 'true' end", 1)],
    'probe_job_stopped_is_never_noticed': [("elsif _newest < now() - interval '40 minutes' then", "elsif false then", 1)],
    'stale_after_two_hours': [("elsif _newest < now() - interval '40 minutes' then", "elsif _newest < now() - interval '2 hours' then", 1)],
    'unanswered_probe_counts_as_a_failure': [("join net._http_response r on r.id = p.request_id", "left join net._http_response r on r.id = p.request_id", 1)],
    'unripe_probes_are_judged': [("p.fired_at < now() - interval '2 minutes'", "p.fired_at < now()", 1)],
    'oldest_probes_are_judged_not_newest': [("order by p.fired_at desc\n       limit 2)", "order by p.fired_at asc\n       limit 2)", 1)],
    'detail_leaks_the_response_body': [("detail := 'answered (status ' || coalesce(_last::text, 'none') || ')';", "detail := 'answered (status ' || coalesce(_last::text, 'none') || ') ' || (select r2.content from net._http_response r2 order by r2.id desc limit 1);", 1)],
    'down_detail_leaks_the_response_body': [("else 'no good answer to the last two probes (newest status ' || coalesce(_last::text, 'none') || ')' end;", "else 'no good answer: ' || (select r2.content from net._http_response r2 order by r2.id desc limit 1) end;", 1)],
    'unknown_state_pages': [("state := 'unknown'; detail := 'no answered probe yet';", "state := 'down'; detail := 'no answered probe yet';", 1)],
    # ---- the schedule -----------------------------------------------------------------------------------------------
    'schedule_is_daily': [("_sched constant text := '*/10 * * * *';", "_sched constant text := '5 3 * * *';", 1)],
    'job_runs_the_wrong_command': [("_cmd   constant text := 'select public.report_service_probe_fire()';", "_cmd   constant text := 'select 1';", 1)],
    'job_not_reactivated_on_reapply': [("perform cron.alter_job(_id, schedule := _sched, command := _cmd, active := true);", "perform cron.alter_job(_id, schedule := _sched, command := _cmd);", 1)],
    # ---- the monitor check --------------------------------------------------------------------------------------------
    'check_cannot_page': [("(count(*) filter (where h.state <> 'unknown') > 0),\n           case when", "false,\n           case when", 1)],
    'check_pages_while_unknown': [("(count(*) filter (where h.state <> 'unknown') > 0),\n           case when", "true,\n           case when", 1)],
    'check_ignores_stale': [("(count(*) filter (where h.state in ('down', 'stale')) = 0),", "(count(*) filter (where h.state in ('down')) = 0),", 1)],
    'check_ignores_down': [("(count(*) filter (where h.state in ('down', 'stale')) = 0),", "(count(*) filter (where h.state in ('stale')) = 0),", 1)],
    'check_has_no_failure_handler': [("  exception when others then\n    insert into _eval values ('report_service', false, true,\n      'the report-service check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');\n  end;\n", "  end;\n", 1)],
    'failure_handler_passes': [("insert into _eval values ('report_service', false, true,", "insert into _eval values ('report_service', true, true,", 1)],
    # ---- failing closed ----------------------------------------------------------------------------------------------------
    'arms_without_pg_net': [("    raise exception 'pg_net is not installed — refusing: the probe could not be sent';", "    null;", 1)],
    'arms_without_a_splice_anchor': [("    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the alarm could not be added';", "    null;", 1)],
    'splice_is_not_idempotent': [("  if position(_begin in _def) > 0 then\n    raise notice 'report_service already present — nothing to do';\n    return;\n  end if;\n", "", 1)],
    # ---- the rollback ----------------------------------------------------------------------------------------------------------
    'rollback_leaves_the_check': [("--     execute substr(_def, 1, _b - 1) || substr(_def, _e + length(_end) + 3);", "--     null;", 1)],
    'rollback_leaves_the_job': [("--     perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'report-service-probe';", "--     null;", 1)],
    'rollback_leaves_the_functions': [("-- drop function if exists public.report_service_health();", "-- select 1;", 1)],
    'rollback_leaves_the_log': [("-- drop table if exists public.report_service_probe;", "-- select 1;", 1)],
}


def main():
    if len(sys.argv) == 2 and sys.argv[1] == '--list':
        print('\n'.join(M)); return 0
    if len(sys.argv) != 3 or sys.argv[1] not in M:
        sys.stderr.write('usage: mutate.py --list | NAME FILE\n'); return 2
    text = open(sys.argv[2]).read()
    for old, new, count in M[sys.argv[1]]:
        if text.count(old) != count:
            sys.stderr.write('anchor for %s matched %d time(s), expected %d\n' % (sys.argv[1], text.count(old), count)); return 2
        if old == new:
            sys.stderr.write('mutation %s changes nothing\n' % sys.argv[1]); return 2
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
