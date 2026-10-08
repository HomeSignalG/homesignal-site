#!/usr/bin/env python3
"""Prohibited mutations of docs/report-private-context-sequence-lockdown.sql. Each MUST be caught by sequence_lockdown.sh.

Usage: sequence_lockdown_mutate.py --list           -> one mutation name per line
       sequence_lockdown_mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply (a mutation that does
not apply is indistinguishable from one that survives).

NOT mutated, on purpose, and why: the post-condition's "the owner kept USAGE" half. The disposable database applies the file as a
superuser, and a superuser holds every privilege whatever was revoked, so over-revoking the owner there changes no observable
result. That half is covered by reading it (and by the production read-back), not by a mutation that could not fail.
"""
import sys

REVOKE = "    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s.sq);\n"
ZERO_GUARD = ("  if n = 0 then\n"
              "    raise exception 'report_private_context_sequence_lockdown: found no sequence owned by a report_private_context table (the layer has an identity column, so this is a broken lookup, not a clean result)';\n"
              "  end if;\n")
PRE_MSG = "public.report_private_context_event does not exist (apply docs/report-private-context.sql first)"
SCOPE = "where ns.nspname = 'public' and sq.relkind = 'S' and t.relname like 'report\\_private\\_context%' loop"
POST_START = "-- ---- 2. POST-CONDITION (fail closed)"
POST_END = "-- ROLLBACK (this file only;"

# (anchor, replacement, expected_count) lists
M = {
    # the revoke does nothing: the post-condition must refuse to report success
    'no_revoke': [(REVOKE, "    null;\n", 1)],
    # only some roles are closed: the post-condition must refuse
    'only_anon': [(REVOKE, "    execute format('revoke all on sequence %s from anon', s.sq);\n", 1)],
    'skip_authenticated': [(REVOKE, "    execute format('revoke all on sequence %s from public, anon, service_role', s.sq);\n", 1)],
    'skip_service_role': [(REVOKE, "    execute format('revoke all on sequence %s from public, anon, authenticated', s.sq);\n", 1)],
    'skip_public': [(REVOKE, "    execute format('revoke all on sequence %s from anon, authenticated, service_role', s.sq);\n", 1)],
    # a lookup that finds nothing must not read as success
    'drop_zero_guard': [(ZERO_GUARD, "", 1)],
    # an absent table must be refused with the stated reason
    'drop_precondition': [(PRE_MSG, "is missing (apply the layer first)", 1)],
    # the lookup typed to one name instead of computed: a later sequence on the layer stays open
    'typed_name': [(SCOPE, "where ns.nspname = 'public' and sq.relkind = 'S' and sq.relname = 'report_private_context_event_event_id_seq' loop", 2)],
    # the scope widened to every table: an unrelated sequence is closed too (the post-condition keeps its own scope, so only the check sees it)
    'overwide_scope': [(SCOPE, "where ns.nspname = 'public' and sq.relkind = 'S' and t.relname like '%' loop", 2)],
}


def post_block_removed(s):
    a = s.find(POST_START)
    b = s.find(POST_END)
    if a < 0 or b < 0 or b <= a or s.count(POST_START) != 1 or s.count(POST_END) != 1:
        return None
    return s[:a] + s[b:]


def apply(name, s):
    if name == 'partial_revoke_and_no_post':
        # the post-condition removed AND only anon closed: the checks must see authenticated and service_role still open
        s2 = post_block_removed(s)
        if s2 is None or s2.count(REVOKE) != 1:
            return None
        return s2.replace(REVOKE, "    execute format('revoke all on sequence %s from anon', s.sq);\n")
    if name == 'overwide_scope':
        # replace the FIRST occurrence only (the revoke loop), leaving the post-condition's own scope intact
        if s.count(SCOPE) != 2:
            return None
        i = s.find(SCOPE)
        return s[:i] + "where ns.nspname = 'public' and sq.relkind = 'S' and t.relname like '%' loop" + s[i + len(SCOPE):]
    if name == 'typed_name':
        if s.count(SCOPE) != 2:
            return None
        i = s.find(SCOPE)
        return s[:i] + "where ns.nspname = 'public' and sq.relkind = 'S' and sq.relname = 'report_private_context_event_event_id_seq' loop" + s[i + len(SCOPE):]
    spec = M[name]
    out = s
    for anchor, repl, count in spec:
        if out.count(anchor) != count:
            return None
        out = out.replace(anchor, repl)
    return out


NAMES = list(M.keys()) + ['partial_revoke_and_no_post']
NAMES = [n for n in NAMES]  # order: dict order, then the composite

if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] == '--list':
        print('\n'.join(NAMES))
        sys.exit(0)
    name, path = sys.argv[1], sys.argv[2]
    src = open(path, encoding='utf-8').read()
    res = apply(name, src)
    if res is None or res == src:
        sys.exit(2)
    sys.stdout.write(res)
