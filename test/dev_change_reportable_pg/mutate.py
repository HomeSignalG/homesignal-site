#!/usr/bin/env python3
"""Prohibited mutations of docs/dev-change-reportable.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).
"""
import sys

JOIN = "  join public.dev_change_run r on r.id = e.run_id\n where not r.baseline;"
COLS = ("select e.id, e.identity_key, e.event_type, e.material, e.is_baseline, e.observed_at,\n"
        "       e.prev_facts, e.new_facts, e.prev_fp, e.new_fp, e.changed_fields,\n"
        "       e.publisher_event_type, e.publisher_event_date, e.source_id,\n"
        "       e.derivation_version, e.facts_version, e.rights_class, e.run_id, e.created_at\n")
GRANT = "grant select on public.dev_change_event_reportable to service_role;"

MUTATIONS = {
    # ---- which events are reportable ------------------------------------------------------------
    # nothing is excluded: a baseline run's events are shown as changes
    'no_baseline_filter': [(" where not r.baseline;", " where true;", 1)],
    # the rule is inverted: ONLY a baseline run's events
    'only_baseline_events': [(" where not r.baseline;", " where r.baseline;", 1)],
    # the tempting shortcut: trust the event's own is_baseline flag. The 959 cross-copy events carry
    # is_baseline = false inside a baseline run, so they would be shown as changes.
    'flag_instead_of_run': [(JOIN, " where not e.is_baseline;", 1)],
    # an event that names no run is shown (left join, then "not a baseline" read as "not true")
    'run_less_included': [(JOIN, "  left join public.dev_change_run r on r.id = e.run_id\n where r.baseline is not true;", 1)],
    # the run is judged by the identity's FIRST run, not the event's own run
    'judged_by_first_run': [(
        "  join public.dev_change_run r on r.id = e.run_id\n",
        "  join public.dev_change_project p on p.identity_key = e.identity_key\n"
        "  join public.dev_change_run r on r.id = p.first_run_id\n", 1)],
    # the run is judged by the identity's LAST run, not the event's own run
    'judged_by_last_run': [(
        "  join public.dev_change_run r on r.id = e.run_id\n",
        "  join public.dev_change_project p on p.identity_key = e.identity_key\n"
        "  join public.dev_change_run r on r.id = p.last_run_id\n", 1)],
    # ---- what the view carries ------------------------------------------------------------------
    # the view stops being the event's own columns and adds a fact of its own
    'select_star_plus_run': [(COLS, "select e.*, r.baseline as run_baseline\n", 1)],
    # a column of the event is dropped (one the suite's queries never name, so only R09 can see it)
    'drops_a_column': [("e.facts_version, e.rights_class, ", "e.facts_version, ", 1)],
    # ---- lock-down ------------------------------------------------------------------------------
    'view_default_grants': [(
        "revoke all on public.dev_change_event_reportable from public, anon, authenticated, service_role;", "select 1;", 1)],
    'anon_can_read': [(GRANT, "grant select on public.dev_change_event_reportable to service_role, anon;", 1)],
    'authenticated_can_read': [(GRANT, "grant select on public.dev_change_event_reportable to service_role, authenticated;", 1)],
    'service_role_all': [(GRANT, "grant all on public.dev_change_event_reportable to service_role;", 1)],
    'service_role_locked_out': [(GRANT, "select 1;", 1)],
    'view_not_invoker': [(" with (security_invoker = true) as", " as", 1)],
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
