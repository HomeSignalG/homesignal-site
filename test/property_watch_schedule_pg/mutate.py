#!/usr/bin/env python3
"""Prohibited mutations of docs/property-watch-schedule.sql. Each MUST fail >= 1 NAMED check of test/property_watch_schedule_pg (the suite or
the file-level checks in run.sh).

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply (a mutation that does not apply is
indistinguishable from one that survives).
"""
import sys

# ---- exact blocks of the file -------------------------------------------------------------------------------------
SCHED = "_sched constant text := '3,13,23,33,43,53 * * * *';"
CMD = "_cmd   constant text := 'select public.property_watch_run_scheduled()';"
LIMIT = "_limit constant integer := 5;"
URL = "/functions/v1/run-property-watch'"
SECRET_HEADER = "'x-signup-secret', _secret),"
APIKEY = "'apikey', _anon, 'Authorization', 'Bearer ' || _anon,"
BODY = "body    := jsonb_build_object('limit', _limit),"
TIMEOUT = "timeout_milliseconds := 150000"
SECRET_GUARD = "  if _secret is null or btrim(_secret) = '' then\n    raise exception 'no scheduler secret is stored (vault secret signup_hook_secret); the Watch cannot run' using errcode = '28000';\n  end if;\n"
REVOKE_RUN = "revoke all on function public.property_watch_run_scheduled() from public, anon, authenticated, service_role;"
WRAPPER_HEAD = "language plpgsql security definer set search_path = public, extensions, net, vault, pg_temp\nas $fn$\ndeclare\n  _url"
HEALTH_HEAD = "language plpgsql security definer set search_path = public, pg_temp\nas $fn$\ndeclare\n  _job"
OVERDUE = "max(i.violations) filter (where i.check_name = 'overdue_watches'),"
INVARIANTS = "coalesce(sum(i.violations) filter (where i.kind = 'invariant' and i.check_name <> 'overdue_watches'), 0),"
FAILING = "from public.property_watch w where w.failure_count >= 3 group by 1) o;"
CMD_REGEX = "                              and command ~ 'property_watch_run_scheduled\\(\\)') then 'ok'"
INACTIVE = "when exists (select 1 from cron.job where jobname = $1 and not active) then 'inactive'"
CRON_ALL3 = "select coalesce((select count(*) = 3 and bool_and(d.status = 'failed')"
CRON_LIMIT = "where j.jobname = $1 order by r.start_time desc limit 3) d), false) $q$"
ALERTABLE = "select 'property_watch_run', (q.problems = ''), true,"
CASE_JOB = ("        case when h.job_state <> 'ok'\n"
            "             then 'pg_cron job property-watch-run is ' || h.job_state\n"
            "                  || ' — watched properties are not being checked' end,\n")
CASE_CRON = ("        case when h.cron_failing\n"
             "             then 'the last 3 runs of property-watch-run failed to start' end,\n")
CASE_OVERDUE = ("        case when h.overdue_n > 0\n"
                "             then h.overdue_n || ' watch(es) are more than 6 hours overdue and nothing is holding them' end,\n")
CASE_FAILING = ("        case when h.failing_n > 0\n"
                "             then h.failing_n || ' watch(es) failed their last 3 or more checks (' || h.failing_outcomes || ')' end,\n")
CASE_INVARIANT = ("        case when h.invariant_breaks > 0\n"
                  "             then h.invariant_breaks || ' watch invariant violation(s): ' || h.broken_invariants end\n")
HANDLER = ("  exception when others then\n"
           "    insert into _eval values ('property_watch_run', false, true,\n"
           "      'the watch check could not run (SQLSTATE ' || sqlstate || ') — a check that cannot run is a failing check');\n"
           "  end;\n")
PRE_WATCH = ("  if to_regclass('public.property_watch') is null\n"
             "     or to_regprocedure('public.property_watch_claim(integer)') is null\n"
             "     or to_regprocedure('public.property_watch_integrity()') is null then\n"
             "    raise exception 'docs/property-watch.sql is not applied — refusing to schedule a check that does not exist';\n"
             "  end if;\n")
PRE_ANCHOR = ("  if position('-- >>> property_watch_run (begin)' in _d) = 0\n"
              "     and (length(_d) - length(replace(_d, _anchor, ''))) / length(_anchor) <> 1 then\n"
              "    raise exception 'public.pipeline_health_tick() has no single splice anchor — refusing: the daily check must not be armed without its alarm';\n"
              "  end if;\n")
PRE_VAULT = ("  if to_regnamespace('vault') is not null then\n"
             "    if not exists (select 1 from vault.decrypted_secrets where name = 'signup_hook_secret' and btrim(coalesce(decrypted_secret, '')) <> '') then\n"
             "      raise exception 'vault secret signup_hook_secret is missing or empty — refusing: the daily check could not authenticate to run-property-watch';\n"
             "    end if;\n"
             "  end if;\n")
ALREADY = ("  if position(_begin in _def) > 0 then\n"
           "    raise notice 'property_watch_run already present — nothing to do';\n"
           "    return;\n"
           "  end if;\n")
REARM = "    perform cron.alter_job(_id, schedule := _sched, command := _cmd, active := true);"

MUTATIONS = {
    # ---- the job ----
    'job_hourly_only': [(SCHED, "_sched constant text := '3 * * * *';", 1)],
    'job_every_minute': [(SCHED, "_sched constant text := '* * * * *';", 1)],
    'job_wrong_command': [(CMD, "_cmd   constant text := 'select 1';", 1)],
    'job_not_rearmed': [(REARM, "    null;", 1)],
    # ---- the wrapper ----
    'wrapper_limit_six': [(LIMIT, "_limit constant integer := 6;", 1)],
    'wrapper_limit_fifty': [(LIMIT, "_limit constant integer := 50;", 1)],
    'wrapper_wrong_function': [(URL, "/functions/v1/manage-property-watch'", 1)],
    'wrapper_no_secret_header': [(SECRET_HEADER, "'x-signup-secret', 'none'),", 1)],
    'wrapper_secret_in_body': [(BODY, "body    := jsonb_build_object('limit', _limit, 'secret', _secret),", 1)],
    'wrapper_no_gateway_key': [(APIKEY, "'apikey', 'none', 'Authorization', 'Bearer none',", 1)],
    'wrapper_short_timeout': [(TIMEOUT, "timeout_milliseconds := 1000", 1)],
    'wrapper_sends_without_secret': [(SECRET_GUARD, "", 1)],
    'wrapper_open_to_service_role': [(REVOKE_RUN, "revoke all on function public.property_watch_run_scheduled() from public, anon, authenticated;", 1)],
    'wrapper_open_to_anon': [(REVOKE_RUN, REVOKE_RUN + "\ngrant execute on function public.property_watch_run_scheduled() to anon;", 1)],
    'wrapper_unpinned_search_path': [(WRAPPER_HEAD, "language plpgsql security definer\nas $fn$\ndeclare\n  _url", 1)],
    'health_not_definer': [(HEALTH_HEAD, "language plpgsql set search_path = public, pg_temp\nas $fn$\ndeclare\n  _job", 1)],
    'health_open_to_anon': [("grant execute on function public.property_watch_job_health() to service_role;",
                             "grant execute on function public.property_watch_job_health() to service_role, anon;", 1)],
    # ---- the health read ----
    'health_overdue_never': [(OVERDUE, "max(0::bigint),", 1)],
    'health_failing_threshold_two': [(FAILING, "from public.property_watch w where w.failure_count >= 2 group by 1) o;", 1)],
    'health_failing_threshold_four': [(FAILING, "from public.property_watch w where w.failure_count >= 4 group by 1) o;", 1)],
    'health_ignores_invariants': [(INVARIANTS, "0::bigint,", 1)],
    'health_job_any_command_ok': [(CMD_REGEX, "                              ) then 'ok'", 1)],
    'health_inactive_reads_ok': [(INACTIVE, "when exists (select 1 from cron.job where jobname = $1 and not active) then 'ok'", 1)],
    'health_cron_needs_no_three': [(CRON_ALL3, "select coalesce((select bool_or(d.status = 'failed')", 1)],
    'health_cron_looks_at_two': [(CRON_LIMIT, "where j.jobname = $1 order by r.start_time desc limit 2) d), false) $q$", 1)],
    # ---- the check ----
    'check_not_alertable': [(ALERTABLE, "select 'property_watch_run', (q.problems = ''), false,", 1)],
    'check_always_ok': [(ALERTABLE, "select 'property_watch_run', true, true,", 1)],
    'check_ignores_job': [(CASE_JOB, "", 1)],
    'check_ignores_cron': [(CASE_CRON, "", 1)],
    'check_ignores_overdue': [(CASE_OVERDUE, "", 1)],
    'check_ignores_failing': [(CASE_FAILING, "", 1)],
    'check_ignores_invariants': [(CASE_INVARIANT, "        null\n", 1)],
    'check_error_swallowed': [(HANDLER, "  end;\n", 1)],
    'check_error_reads_ok': [(HANDLER, HANDLER.replace("'property_watch_run', false, true", "'property_watch_run', true, true"), 1)],
    # ---- the splice and the preconditions ----
    'splice_twice': [(ALREADY, "", 1)],
    'no_watch_layer_check': [(PRE_WATCH, "", 1)],
    'no_anchor_precheck': [(PRE_ANCHOR, "", 1)],
    'no_vault_secret_check': [(PRE_VAULT, "", 1)],
}


def main(argv):
    if argv[1:] == ['--list']:
        print("\n".join(MUTATIONS))
        return 0
    if len(argv) != 3 or argv[1] not in MUTATIONS:
        print("usage: mutate.py --list | NAME FILE", file=sys.stderr)
        return 1
    text = open(argv[2]).read()
    for old, new, count in MUTATIONS[argv[1]]:
        if text.count(old) != count:
            print("anchor for %s appears %d times, expected %d: %r" % (argv[1], text.count(old), count, old[:80]), file=sys.stderr)
            return 2
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
