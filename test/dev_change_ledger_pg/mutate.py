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
        "facts = case when o.observed_at > p.last_observed_at and k.identity_key is null then o.facts else p.facts end,",
        "facts = o.facts,", 1)],
    # an older copy is judged as a change
    'stale_emits_event': [(
        "and o.observed_at > o.old_last_observed_at\n     and o.old_facts_version = _fv",
        "and o.observed_at <> o.old_last_observed_at\n     and o.old_facts_version = _fv", 1)],
    # a retried fetch counts as another observation (would make a record change-ready by repetition)
    'count_every_call': [(
        "observation_count = p.observation_count\n                             + case when o.observed_at > p.last_observed_at and k.identity_key is null then 1 else 0 end,",
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
        "revoke all on public.dev_change_run, public.dev_change_project, public.dev_change_event, public.dev_change_copy_conflict\n  from public, anon, authenticated, service_role;",
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

    # ---- option (b): copy conflicts are held, never announced -------------------------------------------------------
    # the conflict check never fires: contradicting copies are announced as changes again
    'conflict_check_removed': [("     and exists (select 1 from public.app_projects c\n                  where c.source_key = o.identity_key and c.record_kind = 'development' and c.zip <> p_zip\n                    and public.dev_change_record_facts(public.dev_change_facts(c))\n                        is distinct from public.dev_change_record_facts(o.facts));", "     and false;", 1)],
    # NOT a mutation, on purpose: `<>` instead of `IS DISTINCT FROM` is an EQUIVALENT mutant here. The identity fields
    # are compared as ONE jsonb object (dev_change_record_facts), which is never SQL NULL; a missing name is a JSON null
    # inside it, so the two operators agree on every input. C40 pins the behaviour (a copy with no name is a conflict).
    # a facility row under the same key counts as a copy
    'conflict_counts_facility_rows': [("where c.source_key = o.identity_key and c.record_kind = 'development' and c.zip <> p_zip",
                                       "where c.source_key = o.identity_key and c.zip <> p_zip", 1)],
    # the identity fields shrink or grow
    'record_facts_without_address': [("'name', facts->'name', 'address', facts->'address', 'submitted_at', facts->'submitted_at')",
                                      "'name', facts->'name', 'submitted_at', facts->'submitted_at')", 1)],
    'record_facts_without_name': [("'name', facts->'name', 'address', facts->'address', 'submitted_at', facts->'submitted_at')",
                                   "'address', facts->'address', 'submitted_at', facts->'submitted_at')", 1)],
    'record_facts_without_filing_date': [("'name', facts->'name', 'address', facts->'address', 'submitted_at', facts->'submitted_at')",
                                          "'name', facts->'name', 'address', facts->'address')", 1)],
    'record_facts_include_stage': [("'name', facts->'name', 'address', facts->'address', 'submitted_at', facts->'submitted_at')",
                                    "'name', facts->'name', 'address', facts->'address', 'submitted_at', facts->'submitted_at', 'stage', facts->'stage')", 1)],
    # a held change is written anyway
    'held_change_still_written': [("     and o.old_fp <> o.fp\n     and not exists (select 1 from _dc_conflict k where k.identity_key = o.identity_key)\n  on conflict",
                                   "     and o.old_fp <> o.fp\n  on conflict", 1)],
    # a held observation still moves the ledger's state
    'held_still_advances_facts': [("facts = case when o.observed_at > p.last_observed_at and k.identity_key is null then o.facts else p.facts end,",
                                   "facts = case when o.observed_at > p.last_observed_at then o.facts else p.facts end,", 1)],
    'held_still_counts_an_observation': [("+ case when o.observed_at > p.last_observed_at and k.identity_key is null then 1 else 0 end,",
                                          "+ case when o.observed_at > p.last_observed_at then 1 else 0 end,", 1)],
    'held_moves_last_observed_at': [("last_observed_at = case when k.identity_key is null then greatest(p.last_observed_at, o.observed_at) else p.last_observed_at end,",
                                     "last_observed_at = greatest(p.last_observed_at, o.observed_at),", 1)],
    # the run counters count a held observation as accepted
    'accepted_counts_held': [("where not o.is_new and o.observed_at > o.old_last_observed_at and k.identity_key is null;",
                              "where not o.is_new and o.observed_at > o.old_last_observed_at;", 1)],
    # a hold inside a baseline run is skipped (the 959-event shape returns)
    'baseline_changes_not_held': [("or (not o.is_new and o.old_comparable and o.old_facts_version = _fv",
                                   "or (not _baseline and not o.is_new and o.old_comparable and o.old_facts_version = _fv", 1)],
    # a NEW record with contradicting copies is not looked at
    'new_identity_conflict_not_checked': [("and ((o.is_new and not _baseline)", "and ((false)", 1)],
    'new_conflicted_identity_announced': [("   where o.is_new and o.here_comparable\n     and not exists (select 1 from _dc_conflict k where k.identity_key = o.identity_key)\n",
                                           "   where o.is_new and o.here_comparable\n", 1)],
    'new_conflicted_identity_stays_comparable': [("(o.here_comparable and k.identity_key is null),", "o.here_comparable,", 1)],
    'new_conflicted_identity_no_reason': [("case when k.identity_key is not null and o.here_reason is null then 'copies_disagree' else o.here_reason end,",
                                           "o.here_reason,", 1)],
    # the hold is silent: nothing is written down
    'held_not_audited': [("  insert into public.dev_change_copy_conflict as c\n    (identity_key, kind, last_held_observed_at, last_zip, last_run_id)\n  select o.identity_key, case when o.is_new then 'new_identity' else 'change_held' end, o.observed_at, p_zip, p_run\n    from _dc_obs o join _dc_conflict k on k.identity_key = o.identity_key\n  on conflict (identity_key) do update\n     set last_held_at = now(),\n         times_held = c.times_held + case when excluded.last_held_observed_at > c.last_held_observed_at then 1 else 0 end,\n         last_held_observed_at = greatest(c.last_held_observed_at, excluded.last_held_observed_at),\n         last_zip = excluded.last_zip,\n         last_run_id = excluded.last_run_id;\n", "", 1)],
    'audit_counts_every_pass': [("times_held = c.times_held + case when excluded.last_held_observed_at > c.last_held_observed_at then 1 else 0 end,",
                                 "times_held = c.times_held + 1,", 1)],
    # a hold becomes permanent: the identity can never be reported again, even after the copies agree
    'hold_makes_identity_non_comparable': [("comparable = p.comparable and o.here_comparable,",
                                            "comparable = p.comparable and o.here_comparable and k.identity_key is null,", 1),
                                           ("non_comparable_reason = coalesce(p.non_comparable_reason, o.here_reason),",
                                            "non_comparable_reason = coalesce(p.non_comparable_reason, o.here_reason, case when k.identity_key is not null then 'copies_disagree' end),", 1)],
    'result_hides_the_holds': [("'copy_conflicts_held', _held, 'identities_new_conflicted', _newconf);",
                                "'copy_conflicts_held', 0, 'identities_new_conflicted', 0);", 1)],
    # the fourth table is not locked down
    'conflict_table_no_rls': [("alter table public.dev_change_copy_conflict enable row level security;", "select 1;", 1)],
    'conflict_table_default_grants': [("public.dev_change_event, public.dev_change_copy_conflict\n  from public, anon, authenticated, service_role;",
                                       "public.dev_change_event\n  from public, anon, authenticated, service_role;", 1)],
    'conflict_table_service_role_can_delete': [("grant select, insert, update on public.dev_change_copy_conflict to service_role;",
                                                "grant select, insert, update, delete on public.dev_change_copy_conflict to service_role;", 1)],
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
