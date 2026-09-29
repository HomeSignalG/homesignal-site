#!/usr/bin/env python3
"""Prohibited mutations of docs/dev-change-ledger.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).
"""
import sys

CLASSIFY_MATERIAL = "ch.f && array['stage', 'date_kind']"

MUTATIONS = {
    # a re-collection of a ZIP becomes a change: the retrieval time is treated as a fact
    'retrieval_in_facts': [(
        "'source_ref', r.source_ref)",
        "'source_ref', r.source_ref, 'retrieved', r.provenance->>'refreshed_at')", 1)],
    # an OLDER copy of a record overwrites the newer facts (timing skew moves a project backwards)
    'stale_moves_backwards': [(
        "facts = case when o.observed_at > p.last_observed_at then o.facts else p.facts end,",
        "facts = o.facts,", 1)],
    # an older copy is judged as a change
    'stale_emits_event': [(
        "and o.observed_at > o.old_last_observed_at\n     and o.old_facts_version = _fv",
        "and o.observed_at <> o.old_last_observed_at\n     and o.old_facts_version = _fv", 1)],
    # a retried fetch counts as another observation (would make a record change-ready by repetition)
    'count_every_call': [(
        "observation_count = p.observation_count + case when o.observed_at > p.last_observed_at then 1 else 0 end,",
        "observation_count = p.observation_count + 1,", 1)],
    # a derived-field-only change is treated as a real-world change (a classifier change reads as news)
    'derived_is_material': [(CLASSIFY_MATERIAL, "ch.f && array['stage', 'date_kind', 'status']", 2)],
    # a punctuation/casing edit to the name becomes a hero event
    'name_is_material': [(CLASSIFY_MATERIAL, "ch.f && array['stage', 'date_kind', 'name']", 2)],
    # a stronger event is inferred from weaker evidence (the event vocabulary must refuse it)
    'stronger_vocab': [(
        "select case when ch.f && array['stage', 'date_kind'] then 'status_changed'",
        "select case when new->>'stage' ~* 'withdrawn' then 'withdrawn' when ch.f && array['stage', 'date_kind'] then 'status_changed'", 1)],
    # sibling records under one key are diffed as if they were one record
    'siblings_comparable': [(
        "(public.dev_change_key_is_durable(g.key_basis) and g.n_rows = 1 and g.max_seq = 1),",
        "(public.dev_change_key_is_durable(g.key_basis)),", 1)],
    # comparability is no longer sticky: a record that once had siblings is trusted again
    'not_sticky': [(
        "comparable = p.comparable and o.here_comparable,", "comparable = o.here_comparable,", 1)],
    # mutable / row-number keys are diffed as if they were stable identities
    'mutable_comparable': [(
        "select coalesce(basis, '') <> '' and basis !~* '(^|:)row_id$|MUTABLE'", "select true", 1)],
    # a future-stamped retrieval time is accepted (and would lock the record out of later observations)
    'no_future_guard': [(
        "where observed_at is not null and observed_at <= now() + interval '5 minutes'",
        "where observed_at is not null", 1)],
    # a change to the fact definition itself is reported as a real-world change
    'no_version_rebaseline': [(
        "     and o.old_facts_version = _fv\n     and o.old_comparable", "     and o.old_comparable", 1)],
    # the event log can be edited
    'mutable_events': [(
        "create or replace trigger dev_change_event_no_update_delete\n  before update or delete on public.dev_change_event\n  for each row execute function public.dev_change_event_immutable();",
        "select 1;", 1)],
    # anon and authenticated keep Supabase's default table grants
    'anon_table_grants': [(
        "revoke all on public.dev_change_run, public.dev_change_project, public.dev_change_event\n  from public, anon, authenticated, service_role;",
        "select 1;", 1)],
    # service_role keeps Supabase's default ALL on the tables (DELETE / TRUNCATE on an append-only log)
    'service_role_default_grants': [(
        "  from public, anon, authenticated, service_role;",
        "  from public, anon, authenticated;", 1)],
    # row level security left off the event table
    'no_rls': [(
        "alter table public.dev_change_event   enable row level security;", "select 1;", 1)],
    # anon may call the ledger functions
    'anon_function_grants': [(
        "execute format('revoke all on function %s from public, anon, authenticated', f.sig);",
        "execute format('select 1 /* %s */', f.sig);", 1)],
    # EPA-style facility rows enter the change layer
    'facility_rows_included': [(
        "a.record_kind = 'development'", "a.record_kind is not null", 2)],
    # a baseline first sighting is reported as news
    'baseline_flag_ignored': [(
        "select o.identity_key, 'first_detected', not _baseline, _baseline,",
        "select o.identity_key, 'first_detected', true, false,", 1)],
    # the ZIP becomes part of identity (one project turns into one per ZIP page)
    'identity_includes_zip': [(
        "select u.source_key as identity_key,", "select p_zip || ':' || u.source_key as identity_key,", 1)],
    # the ZIP list is not maintained
    'no_zip_union': [(
        "zips = case when p_zip = any(p.zips) then p.zips else p.zips || p_zip end,", "zips = p.zips,", 1)],
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
