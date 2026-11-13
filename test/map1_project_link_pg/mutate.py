#!/usr/bin/env python3
"""Prohibited mutations of docs/map1-project-link.sql. Each MUST fail the suite.
Usage: mutate.py --list | mutate.py NAME FILE   (exit 2 when an anchor is not found exactly once)"""
import sys

MUTATIONS = {
    # a data center counts as drawn without asking Map 1's own reader
    'skip_reader_check': ("     where exists (select 1 from public.map1_dc_zip_members(c.z) m where m.source_key = map_key);",
                          "     where true;"),
    # singleton record keys accepted as project keys
    'singleton_keys': ("where rk.record_key = body and rk.record_key_rank < 2", "where rk.record_key = body"),
    # merges not followed: the record key opens the superseded entity
    'no_merge_follow': ("     where e.superseded_by is null;\n    if cardinality(roots) = 0",
                        "     where true;\n    if cardinality(roots) = 0"),
    # the public reader returns every document, approved or not
    'reader_any_state': ("join cur c on c.document_id = d.document_id and c.decision = 'approved'",
                         "left join cur c on c.document_id = d.document_id"),
    # the state machine dropped
    'no_state_machine': ("  if not ((cur = 'pending'  and new.decision in ('approved', 'rejected'))",
                         "  if false and not ((cur = 'pending'  and new.decision in ('approved', 'rejected'))"),
    # a different document silently overwrites the stored one
    'overwrite_on_propose': ("      raise exception 'this document is already on file for this project with different details' using errcode = '23505';",
                             "      return d.document_id;"),
    # any signed-in user may decide
    'no_admin_check': ("declare who text := public._hs_is_admin();", "declare who text := 'anyone';"),
}

if sys.argv[1:] == ['--list']:
    print('\n'.join(MUTATIONS)); sys.exit(0)
name, path = sys.argv[1], sys.argv[2]
src = open(path).read()
old, new = MUTATIONS[name]
if src.count(old) != 1:
    sys.stderr.write(f'anchor for {name} found {src.count(old)} times\n'); sys.exit(2)
sys.stdout.write(src.replace(old, new))
