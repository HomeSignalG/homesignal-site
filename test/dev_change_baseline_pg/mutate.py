#!/usr/bin/env python3
"""Prohibited mutations of docs/dev-change-baseline.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).
"""
import sys

MUTATIONS = {
    # ---- capacity ---------------------------------------------------------------------------
    # the capacity gate is switched off
    'no_capacity_gate': [(
        "  if _baseline or p_verified_free_disk_mb is not null then", "  if false then", 1)],
    # a baseline run no longer needs the operator's free-disk figure
    'baseline_needs_no_figure': [(
        "  if _baseline or p_verified_free_disk_mb is not null then",
        "  if p_verified_free_disk_mb is not null then", 1)],
    # the safety floor is dropped from the requirement (budget only)
    'floor_ignored': [(
        "p_verified_free_disk_mb < _floor_mb + p_ledger_budget_mb then",
        "p_verified_free_disk_mb < p_ledger_budget_mb then", 1)],
    # the ledger byte budget never stops a tick
    'budget_ignored': [(
        "if _ledger >= p_ledger_budget_mb * 1048576 then _reason := 'ledger_budget'; exit; end if;",
        "if false then _reason := 'ledger_budget'; exit; end if;", 1)],
    # a tick can run with no budget at all
    'budget_not_required': [(
        "  if p_ledger_budget_mb is null or p_ledger_budget_mb < 1 then", "  if false then", 1)],
    # ---- bounds -------------------------------------------------------------------------------
    'max_zips_ignored': [(
        "if _done + _errs >= p_max_zips then _reason := 'max_zips'; exit; end if;",
        "if false then _reason := 'max_zips'; exit; end if;", 1)],
    'time_budget_ignored': [(
        "if _done + _errs >= 1 and clock_timestamp() - _t0 >= make_interval(secs => p_max_seconds) then",
        "if false then", 1)],
    # a tick can run against a run that is closed (or does not exist)
    'run_state_ignored': [(
        "  if not found then raise exception 'dev_change_tick: run % is not open', p_run; end if;",
        "  if false then raise exception 'dev_change_tick: run % is not open', p_run; end if;", 1)],
    # ---- which ZIP is due --------------------------------------------------------------------------
    # an ordinary run may FIRST observe a ZIP (its whole content becomes material news)
    'first_sighting_in_ordinary_run': [(
        "       and (_baseline or c.first_ok_at is not null)\n", "", 1)],
    # the interval no longer bounds re-observation
    'interval_ignored': [(
        "                and c.observed_at < clock_timestamp() - make_interval(hours => p_min_interval_hours)))",
        "                ))", 1)],
    # every ZIP is re-read whether or not it was re-materialised
    'ignores_rematerialisation': [(
        "            or (m.updated_at > c.materialized_at", "            or (true", 1)],
    # the universe stops being 'registered AND materialised' (an unmaterialised ZIP is observed)
    'universe_not_materialised': [(
        "      join public.app_community_meta m on m.zip = r.zip\n      left join public.dev_change_zip_cursor c on c.zip = r.zip",
        "      left join public.app_community_meta m on m.zip = r.zip\n      left join public.dev_change_zip_cursor c on c.zip = r.zip", 1)],
    # ---- failure isolation ---------------------------------------------------------------------------
    # one bad ZIP aborts the whole tick
    'errors_not_isolated': [(
        "    exception when others then", "    exception when no_data_found then", 1)],
    # a failing ZIP is retried inside the same tick (a poison ZIP consumes the whole budget)
    'error_retried_in_tick': [(
        "     where not (r.zip = any (_tried))\n       and (c.zip is null", "     where true\n       and (c.zip is null", 1)],
    # a busy ledger is treated as a normal observation (a cursor is advanced over nothing)
    'busy_ignored': [(
        "      if _res->>'status' = 'busy' then _reason := 'busy'; exit; end if;\n", "", 1)],
    # the first-success instant is overwritten on every observation
    'first_ok_not_sticky': [(
        "first_ok_at = coalesce(c.first_ok_at, excluded.first_ok_at),", "first_ok_at = excluded.first_ok_at,", 1)],
    # ---- source health ----------------------------------------------------------------------------------
    # the pipeline-level fire failures are counted as a source's failures
    'view_all_kinds': [(
        "   where f.kind in ('fetch_failed', 'truncated', 'retired')\n", "", 1)],
    # the 24 hour window is a 7 day window
    'view_window_widened': [(
        "interval '24 hours'", "interval '7 days'", 3)],
    # the 14 day window is really 7 days (a second, invented window instead of the workbook's)
    'view_14d_is_7d': [(
        "interval '14 days'", "interval '7 days'", 4)],
    # the affected-ZIP count ignores the window (a ZIP that failed 20 days ago is still counted)
    'zips_ignore_window': [(
        "count(distinct f.zip) filter (where f.kind in ('fetch_failed', 'truncated') and f.seen_at > now() - interval '14 days')",
        "count(distinct f.zip) filter (where f.kind in ('fetch_failed', 'truncated'))", 1)],
    # the affected-ZIP count includes retirements (not a fetch failure)
    'zips_count_retired': [(
        "count(distinct f.zip) filter (where f.kind in ('fetch_failed', 'truncated') and f.seen_at > now() - interval '14 days')",
        "count(distinct f.zip) filter (where f.seen_at > now() - interval '14 days')", 1)],
    # a future placeholder date counts as the source's newest filing date
    'view_future_dates': [(
        "                   and (p.facts->>'submitted_at')::date <= current_date\n", "", 1)],
    # ---- lock-down -------------------------------------------------------------------------------------------
    'cursor_default_grants': [(
        "revoke all on public.dev_change_zip_cursor from public, anon, authenticated, service_role;", "select 1;", 1)],
    'service_role_cursor_all': [(
        "grant select, insert, update on public.dev_change_zip_cursor to service_role;",
        "grant all on public.dev_change_zip_cursor to service_role;", 1)],
    'cursor_no_rls': [(
        "alter table public.dev_change_zip_cursor enable row level security;", "select 1;", 1)],
    'view_default_grants': [(
        "revoke all on public.dev_change_source_health from public, anon, authenticated, service_role;", "select 1;", 1)],
    'view_not_invoker': [(
        "create or replace view public.dev_change_source_health with (security_invoker = true) as",
        "create or replace view public.dev_change_source_health as", 1)],
    'functions_unlocked': [(
        "execute format('revoke all on function %s from public, anon, authenticated', f.sig);",
        "execute format('select 1 /* %s */', f.sig);", 1)],
    'no_fillfactor': [(
        "alter table public.dev_change_project set (fillfactor = 80);", "select 1;", 1)],
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
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
