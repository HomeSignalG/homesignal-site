#!/usr/bin/env python3
"""Prohibited mutations of the brokerage account spine (Development Activity plan, Order K0).

Each mutation MUST be caught. There are two families:

  MUTATIONS       edits of docs/brokerage-account-spine.sql. Each MUST fail the executable check that owns it
                  (test/brokerage_account_pg/run.sh applies the mutated file to a DISPOSABLE Postgres and runs the suite;
                  the one mutation only two sessions at once can see runs the owner race, the one only a poisoned state can
                  see runs the poisoned-apply check). Those that the structural pins can also see are ALSO run
                  against test/brokerage-account-structure.test.mjs by the offline mode below; the few only the database
                  can see are listed in PG_ONLY, and the offline mode reports them as skipped, never as passed.
  FILE_MUTATIONS  edits of the files AROUND the SQL (the admin gate, an edge function, a lib file, the status file, the
                  workflow ...). Each MUST fail the structural test (node test/brokerage-account-structure.test.mjs).

    python3 test/brokerage_account_mutants.py                  # offline: every mutation against the structural test
    python3 test/brokerage_account_mutants.py name [name ...]  # only the named ones
    python3 test/brokerage_account_mutants.py --list           # the SQL mutation names, one per line (for run.sh)
    python3 test/brokerage_account_mutants.py --kind NAME      # 'suite', 'race' or 'poison' (which executable check must catch it)
    python3 test/brokerage_account_mutants.py --sql NAME FILE  # the mutated SQL on stdout; exit 2 if an anchor is absent

An anchor must match EXACTLY the stated number of times and a mutation must change the text, so a mutation can never
silently fail to apply (a mutation that does not apply is indistinguishable from one that survives). The offline mode
edits files in place and ALWAYS restores the originals, even on error or ^C. Where the SQL protects a rule twice (a
function check AND the file's own post-condition), the mutation removes BOTH: a mutation that leaves the second guard
standing only proves the second guard works. Exit 1 if any mutation survives, 2 on a harness fault.
(Manual, like follow_report_mutants.py: CI runs the executable harness, run.sh, and the structural test.)
"""
import re
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL = 'docs/brokerage-account-spine.sql'
STRUCT = 'test/brokerage-account-structure.test.mjs'


def strip_post(text):
    """Remove the file's fail-closed post-condition block (a mutation of the lock-down must not trip it first)."""
    out, n = re.subn(r"-- ---- 6\. POST-CONDITION.*?end \$post\$;\n", '', text, flags=re.S)
    if n != 1:
        raise ValueError('post-condition block not found exactly once')
    return out


def lockdown(*ops):
    """A mutation of the lock-down: first strip the post-condition, then apply the edits."""
    return [strip_post, *ops]


# ---- anchors (verbatim from the SQL of record) ---------------------------------------------------------------------------
INDEX = "create unique index if not exists brokerage_member_one_active_per_user\n  on public.brokerage_member (user_id) where status = 'active';"
TRIGGER = ("create or replace trigger brokerage_member_guard_trg\n  before update on public.brokerage_member\n"
           "  for each row execute function public.brokerage_member_guard();")
IDENTITY = ("  if new.id <> old.id or new.brokerage_id <> old.brokerage_id or new.user_id <> old.user_id or new.joined_at <> old.joined_at then\n"
            "    raise exception 'brokerage_member: identity columns cannot change (a person who moves brokerage is a new membership)' using errcode = '55000';\n"
            "  end if;\n")
TERMINAL = ("  if old.status = 'deactivated' then\n"
            "    raise exception 'brokerage_member: a deactivated membership is terminal (re-joining is a new membership)' using errcode = '55000';\n"
            "  end if;\n")
STAMP = ("  if new.status = 'deactivated' then\n"
         "    new.deactivated_at := now();                 -- stamped here, never taken from the caller\n"
         "  end if;\n")
OWNER_COND = "  if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active') then"
LOCK = "    perform 1 from public.brokerage_account a where a.id = old.brokerage_id for no key update;\n"
ISOLATION = ("    if current_setting('transaction_isolation') <> 'read committed' then\n"
             "      raise exception 'brokerage_member: removing or demoting an owner needs READ COMMITTED (the last-owner check cannot be serialised at %)',\n"
             "        current_setting('transaction_isolation') using errcode = '55000';\n"
             "    end if;\n")
ACL_CHECK = ("    if exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = t::regclass and a.grantee <> c.relowner) then\n"
             "      raise exception 'brokerage_account_spine: % is accessible to a role other than its owner', t;\n"
             "    end if;\n")
ACTIVE_BROKERAGE = ("    if exists (select 1 from public.brokerage_account a where a.id = old.brokerage_id and a.status = 'active')\n"
                    "       and not exists")
OTHER_OWNER = "where m.brokerage_id = old.brokerage_id and m.id <> old.id and m.role = 'owner' and m.status = 'active') then"
ROLE_CK = "  constraint brokerage_member_role         check (role in ('owner', 'agent')),\n"
MSTATUS_CK = "  constraint brokerage_member_status       check (status in ('active', 'deactivated')),\n"
DEACT_CK = "  constraint brokerage_member_deactivation check ((status = 'active') = (deactivated_at is null)),\n"
SPAN_CK = (",\n  constraint brokerage_member_span         check (deactivated_at is null or deactivated_at >= joined_at)\n);")
ASTATUS_CK = "  constraint brokerage_account_status check (status in ('active', 'suspended', 'closed'))\n);"
NAME_CK = "  constraint brokerage_account_name   check (btrim(name) <> ''),\n"
FK_USER = "references auth.users (id) on delete cascade,"
ACCOUNT_TAIL = "  created_at timestamptz not null default now(),\n  constraint brokerage_account_name"
MEMBER_TAIL = "  deactivated_at timestamptz,\n  constraint brokerage_member_role"
LOCK_HEAD = "-- ---- 5. LOCK-DOWN: system-only"
RLS_A = "alter table public.brokerage_account enable row level security;"
RLS_M = "alter table public.brokerage_member  enable row level security;"
REVOKE_A = "revoke all on public.brokerage_account from public, anon, authenticated, service_role;"
REVOKE_M = "revoke all on public.brokerage_member  from public, anon, authenticated, service_role;"
LOOP_REVOKE = "    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);\n"
LOOP_GRANT = ("    if not f.is_trigger then\n      execute format('grant execute on function %s to service_role', f.sig);\n    end if;\n")
RES_HEAD = "language sql stable security definer set search_path = public, pg_temp\nas $$\n  select m.brokerage_id, m.role"
RES_WHERE = "   where m.user_id = p_user_id and m.status = 'active' and a.status = 'active'\n$$;"
ROLLBACK = "\n-- ROLLBACK (this file only)."
POST = "do $post$"


def add_column(table_tail, column):
    return [(table_tail, "  " + column + ",\n" + table_tail, 1)]


MUTATIONS = {
    # ---- one ACTIVE membership per user ------------------------------------------------------------------------------
    'no_one_active_membership_index': [(INDEX, "select 1;", 1)],
    'one_active_per_brokerage_not_user': [(INDEX, INDEX.replace("(user_id)", "(brokerage_id, user_id)"), 1)],
    'active_index_not_partial': [(INDEX, INDEX.replace(" where status = 'active'", ""), 1)],
    # ---- the last active owner of an active brokerage ----------------------------------------------------------------
    'no_guard_trigger': [(TRIGGER, "select 1;", 1)],
    'guard_ignores_demotion': [(OWNER_COND, "  if old.role = 'owner' and (new.status <> 'active') then", 1)],
    'guard_ignores_deactivation': [(OWNER_COND, "  if old.role = 'owner' and (new.role <> 'owner') then", 1)],
    'guard_counts_deactivated_owner': [(OTHER_OWNER, "where m.brokerage_id = old.brokerage_id and m.id <> old.id and m.role = 'owner') then", 1)],
    'guard_counts_the_row_itself': [(OTHER_OWNER, "where m.brokerage_id = old.brokerage_id and m.role = 'owner' and m.status = 'active') then", 1)],
    'guard_ignores_the_brokerage': [(OTHER_OWNER, "where m.id <> old.id and m.role = 'owner' and m.status = 'active') then", 1)],
    'guard_counts_agents_as_owners': [(OTHER_OWNER, "where m.brokerage_id = old.brokerage_id and m.id <> old.id and m.status = 'active') then", 1)],
    'guard_applies_to_inactive_brokerages': [(ACTIVE_BROKERAGE, "    if true\n       and not exists", 1)],
    'guard_without_lock': [(LOCK, "", 1)],
    'guard_ignores_isolation_level': [(ISOLATION, "", 1)],
    'guard_isolation_check_refuses_everything': [(ISOLATION, ISOLATION.replace("<> 'read committed'", "is not null"), 1)],
    'post_condition_reads_only_typed_roles': [(ACL_CHECK, "", 1)],
    # ---- identity, history, the clock ---------------------------------------------------------------------------------
    'identity_columns_can_change': [(IDENTITY, "", 1)],
    'deactivation_not_terminal': [(TERMINAL, "", 1)],
    'deactivation_time_from_caller': [(STAMP, "", 1)],
    'deactivation_time_is_the_join_time': [(STAMP, "  if new.status = 'deactivated' then\n    new.deactivated_at := old.joined_at;\n  end if;\n", 1)],
    # ---- the closed vocabularies and the shape of a row ---------------------------------------------------------------
    'role_vocab_widened': [(ROLE_CK, ROLE_CK.replace("'agent')", "'agent', 'admin')"), 1)],
    'role_check_dropped': [(ROLE_CK, "", 1)],
    'member_status_vocab_widened': [(MSTATUS_CK, MSTATUS_CK.replace("'deactivated')", "'deactivated', 'pending')"), 1)],
    'brokerage_status_vocab_widened': [(ASTATUS_CK, ASTATUS_CK.replace("'closed')", "'closed', 'paused')"), 1)],
    'deactivation_coupling_dropped': [(DEACT_CK, "", 1)],
    'span_check_dropped': [(SPAN_CK, "\n);", 1)],
    'brokerage_name_check_dropped': [(NAME_CK, "", 1)],
    'fk_not_cascade': [(FK_USER, "references auth.users (id),", 1)],
    'user_fk_dropped': [(FK_USER, ",", 1)],
    # ---- the lock-down ----------------------------------------------------------------------------------------------------
    'no_rls_on_account': lockdown((RLS_A, "select 1;", 1)),
    'no_rls_on_member': lockdown((RLS_M, "select 1;", 1)),
    'account_default_grants': lockdown((REVOKE_A, "select 1;", 1)),
    'member_default_grants': lockdown((REVOKE_M, "select 1;", 1)),
    'authenticated_can_read_member': lockdown((REVOKE_M, REVOKE_M + "\ngrant select on public.brokerage_member to authenticated;", 1)),
    'anon_can_read_account': lockdown((REVOKE_A, REVOKE_A + "\ngrant select on public.brokerage_account to anon;", 1)),
    'service_role_can_read_member': lockdown((REVOKE_M, REVOKE_M + "\ngrant select on public.brokerage_member to service_role;", 1)),
    'service_role_can_write_account': lockdown((REVOKE_A, REVOKE_A + "\ngrant insert, update on public.brokerage_account to service_role;", 1)),
    'policy_for_authenticated': lockdown((RLS_M, RLS_M + "\ncreate policy brokerage_member_read on public.brokerage_member for select to authenticated using (true);", 1)),
    'functions_unlocked': lockdown((LOOP_REVOKE, "    execute 'select 1';\n", 1)),
    'function_revoke_skips_public': lockdown((LOOP_REVOKE, LOOP_REVOKE.replace("from public, anon, authenticated, service_role", "from anon, authenticated, service_role"), 1)),
    'resolver_granted_to_authenticated': lockdown((LOOP_GRANT, LOOP_GRANT.replace("to service_role'", "to service_role, authenticated'"), 1)),
    'trigger_function_granted_to_service_role': lockdown((LOOP_GRANT, "    execute format('grant execute on function %s to service_role', f.sig);\n", 1)),
    'lock_loop_removed': lockdown((LOOP_REVOKE, "", 1), (LOOP_GRANT, "", 1)),
    # ---- the resolver -------------------------------------------------------------------------------------------------------
    'resolver_ignores_member_status': [(RES_WHERE, "   where m.user_id = p_user_id and a.status = 'active'\n$$;", 1)],
    'resolver_ignores_brokerage_status': [(RES_WHERE, "   where m.user_id = p_user_id and m.status = 'active'\n$$;", 1)],
    'resolver_security_invoker': [(RES_HEAD, RES_HEAD.replace(" security definer", ""), 1)],
    'resolver_search_path_unpinned': [(RES_HEAD, RES_HEAD.replace(" set search_path = public, pg_temp", ""), 1)],
    'resolver_not_stable': [(RES_HEAD, RES_HEAD.replace(" stable", ""), 1)],
    'resolver_overload_by_email': [(LOCK_HEAD, (
        "create or replace function public.brokerage_membership_of(p_email text)\n"
        "returns table (brokerage_id uuid, role text)\n"
        "language sql stable security definer set search_path = public, pg_temp\n"
        "as $$\n"
        "  select m.brokerage_id, m.role from public.brokerage_member m\n"
        "   where m.status = 'active' and m.user_id in (select u.id from auth.users u where u.email = p_email)\n"
        "$$;\n\n" + LOCK_HEAD), 1)],
    'resolver_matches_the_email_domain': [(RES_WHERE, "   where m.user_id in (select u.id from auth.users u where split_part(u.email, '@', 2) in\n"
                                                     "           (select split_part(e.email, '@', 2) from auth.users e where e.id = p_user_id))\n"
                                                     "     and m.status = 'active' and a.status = 'active'\n$$;", 1)],
    # ---- what the tables must never hold -------------------------------------------------------------------------------------
    'account_has_email_domain_column': add_column(ACCOUNT_TAIL, "email_domain text"),
    'member_has_email_column': add_column(MEMBER_TAIL, "email text"),
    'account_has_address_column': add_column(ACCOUNT_TAIL, "address text"),
    'member_has_label_column': add_column(MEMBER_TAIL, "label text"),
    'account_has_credits_column': add_column(ACCOUNT_TAIL, "credits integer not null default 20"),
    'account_has_quota_column': add_column(ACCOUNT_TAIL, "quota integer"),
    'account_has_price_column': add_column(ACCOUNT_TAIL, "price_cents integer"),
    'member_has_invite_token_column': add_column(MEMBER_TAIL, "invite_token text"),
    'member_has_client_column': add_column(MEMBER_TAIL, "client_name text"),
    # ---- additive, empty, and complete -----------------------------------------------------------------------------------------
    'file_seeds_a_row': [(LOCK_HEAD, "insert into public.brokerage_account (name) values ('Seed Realty');\n\n" + LOCK_HEAD, 1)],
    'second_table_added': [(LOCK_HEAD, "create table if not exists public.brokerage_invite (id uuid primary key default gen_random_uuid());\n\n" + LOCK_HEAD, 1)],
    'extra_function_added': [(LOCK_HEAD, "create or replace function public.brokerage_member_credits() returns integer language sql as $$ select 20 $$;\n\n" + LOCK_HEAD, 1)],
    'post_condition_removed': [strip_post],
}

# Mutations the structural pins cannot see (their effect is only in what the database does); the offline mode skips and names them.
# Measured empty: every mutation below is also caught by the structural pins, and run.sh kills every one of them in the database.
PG_ONLY = set()

# The mutations whose executable check is the poisoned-apply check, not the suite (the post-condition is invisible to a suite that
# runs against a state the apply already left good).
POISON = {'post_condition_removed', 'post_condition_reads_only_typed_roles'}
# ... and the one only two sessions at once can see: with the lock gone each owner removal sees the other owner still active.
RACE = {'guard_without_lock', 'guard_ignores_isolation_level', 'guard_isolation_check_refuses_everything'}


def _rep(text, old, new, count, name):
    if text.count(old) != count:
        raise ValueError('anchor for %s matched %d time(s), expected %d' % (name, text.count(old), count))
    if old == new:
        raise ValueError('mutation %s changes nothing' % name)
    return text.replace(old, new)


def mutate_sql(name, text):
    out = text
    for op in MUTATIONS[name]:
        out = op(out) if callable(op) else _rep(out, op[0], op[1], op[2], name)
    if out == text:
        raise ValueError('mutation %s changes nothing' % name)
    return out


# ---- the files around the SQL ------------------------------------------------------------------------------------------------
GATE = 'supabase/functions/_shared/admin-gate.ts'
REST = 'supabase/functions/_shared/service-rest.ts'
HAN = 'supabase/functions/follow-development-report/handler.ts'
LIBF = 'lib/impact.js'
STATUS = 'docs/development-activity-status-2026-09-30.md'
WF = '.github/workflows/brokerage-account-suite.yml'
DOC = 'docs/development-activity-agent-workspace-2026-10-01.md'
RUN = 'test/brokerage_account_pg/run.sh'
SUITE = 'test/brokerage_account_pg/suite.sql'
FIXTURE = 'test/brokerage_account_pg/fixture.sql'

# (file, old, new[, count]): old '' means "append new at the end of the file". The anchor must match exactly `count` times
# (default 1; None = every occurrence, at least one).
FILE_MUTATIONS = {
    'admin_gate_names_the_resolver': (GATE, '', "\nconst _resolver = 'brokerage_membership_of';\n"),
    'admin_gate_mentions_a_brokerage': (GATE, '', "\nconst _tenant = 'brokerage';\n"),
    'handler_names_the_table': (HAN, '', "\nconst _t = 'brokerage_member';\n"),
    'lib_file_names_the_account_table': (LIBF, '', "\nconst _t = 'brokerage_account';\n"),
    'service_rest_stops_reading_the_allow_list': (REST, "dashboard_admins?select=email&limit=1&email=eq.", "dashboard_admins_v2?select=email&limit=1&email=eq."),
    'gate_stops_asking_is_admin': (GATE, "deps.isAdmin(user.email)", "true"),
    'sql_names_a_resident_table': (SQL, "\n-- ROLLBACK (this file only).", "\nselect 1 from public.app_follows;\n-- ROLLBACK (this file only)."),
    'sql_names_a_report_table': (SQL, "\n-- ROLLBACK (this file only).", "\nselect 1 from public.report_snapshot;\n-- ROLLBACK (this file only)."),
    'sql_points_at_another_table': (SQL, "references public.brokerage_account (id),", "references public.communities (id),"),
    'sql_arms_a_schedule': (SQL, "\n-- ROLLBACK (this file only).", "\nselect cron.schedule('x', '* * * * *', 'select 1');\n-- ROLLBACK (this file only)."),
    'sql_deletes_a_row': (SQL, "\n-- ROLLBACK (this file only).", "\ndelete from public.brokerage_member;\n-- ROLLBACK (this file only)."),
    'sql_drops_a_table': (SQL, "\n-- ROLLBACK (this file only).", "\ndrop table public.brokerage_account;\n-- ROLLBACK (this file only)."),
    'sql_rollback_removed': (SQL, "-- ROLLBACK (this file only).", "-- NOTE (this file only)."),
    'sql_says_applied': (SQL, "SQL OF RECORD. PARKED: NOT APPLIED to production.", "SQL OF RECORD."),
    'status_strikes_order_k': (STATUS, "- K. Agent Workspace + Brokerage Admin — open", "- ~~K. Agent Workspace + Brokerage Admin~~ — done"),
    'status_strikes_master_step_8': (STATUS, "8. Agent Workspace + Brokerage Admin — **open.**", "8. ~~Agent Workspace + Brokerage Admin~~ — **done.**"),
    'status_drops_the_k_entry': (STATUS, "account spine built, not applied", "account spine"),
    'doc_drops_the_decision_owner': (DOC, "Decision owner", "Owner"),
    'doc_drops_the_unverified_marker': (DOC, "UNVERIFIED", "checked", None),
    'workflow_holds_a_secret': (WF, "permissions:\n  contents: read", "permissions:\n  contents: read\nenv:\n  SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}"),
    'workflow_not_triggered_by_the_sql': (WF, "      - 'docs/brokerage-account-spine.sql'\n", "", None),
    'workflow_gains_a_schedule': (WF, "  workflow_dispatch: {}", "  workflow_dispatch: {}\n  schedule:\n    - cron: '0 5 * * *'"),
    'harness_loses_the_race': (RUN, "pg_sleep", "pg_nosleep", None),
    'harness_loses_the_disposable_guard': (RUN, "*disposable*", "*anything*"),
    'suite_loses_the_crash_proofing': (SUITE, "create function pg_temp._do(", "create function pg_temp._doo("),
    'fixture_loses_default_privileges': (FIXTURE, "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;", "select 1;"),
}


def _file_mut_apply(name):
    """Apply a file mutation in place; returns (path, original bytes)."""
    spec = FILE_MUTATIONS[name]
    rel, old, new = spec[0], spec[1], spec[2]
    count = spec[3] if len(spec) > 3 else 1
    path = ROOT / rel
    original = path.read_bytes()
    text = original.decode()
    if old == '':
        out = text + new
    else:
        found = text.count(old)
        if (count is None and found < 1) or (count is not None and found != count):
            raise ValueError('anchor for %s matched %d time(s) in %s, expected %s' % (name, found, rel, 'at least 1' if count is None else count))
        if old == new:
            raise ValueError('mutation %s changes nothing' % name)
        out = text.replace(old, new)
    if out == text:
        raise ValueError('mutation %s changes nothing' % name)
    path.write_bytes(out.encode())
    return path, original


def run_struct():
    r = subprocess.run(['node', str(ROOT / STRUCT)], cwd=ROOT, capture_output=True, text=True)
    fails = [l for l in r.stdout.splitlines() if l.startswith('FAIL')]
    return r.returncode, fails


def main():
    argv = sys.argv[1:]
    if argv == ['--list']:
        print('\n'.join(MUTATIONS))
        return 0
    if len(argv) == 2 and argv[0] == '--kind':
        if argv[1] not in MUTATIONS:
            sys.stderr.write('unknown mutation %s\n' % argv[1])
            return 2
        print('poison' if argv[1] in POISON else 'race' if argv[1] in RACE else 'suite')
        return 0
    if len(argv) == 3 and argv[0] == '--sql':
        if argv[1] not in MUTATIONS:
            sys.stderr.write('unknown mutation %s\n' % argv[1])
            return 2
        try:
            sys.stdout.write(mutate_sql(argv[1], Path(argv[2]).read_text()))
        except ValueError as e:
            sys.stderr.write(str(e) + '\n')
            return 2
        return 0

    names = argv or list(MUTATIONS) + list(FILE_MUTATIONS)
    unknown = [n for n in names if n not in MUTATIONS and n not in FILE_MUTATIONS]
    if unknown:
        sys.stderr.write('unknown mutation(s): %s\n' % ', '.join(unknown))
        return 2
    code, fails = run_struct()
    if code != 0:
        sys.stderr.write('HARNESS: the unmutated tree does not pass the structural test (%d failing pin(s)); a mutation harness over a red baseline proves nothing\n' % len(fails))
        for f in fails[:5]:
            sys.stderr.write('  ' + f[:200] + '\n')
        return 2

    originals = {}

    def restore(*_):
        for path, data in originals.items():
            path.write_bytes(data)

    signal.signal(signal.SIGINT, lambda *a: (restore(), sys.exit(130)))
    signal.signal(signal.SIGTERM, lambda *a: (restore(), sys.exit(143)))
    survivors, skipped, harness = [], [], []
    try:
        for name in names:
            if name in MUTATIONS and name in PG_ONLY:
                print('SKIPPED  %s — only the database can see this one (run.sh kills it)' % name)
                skipped.append(name)
                continue
            try:
                if name in MUTATIONS:
                    path = ROOT / SQL
                    original = path.read_bytes()
                    originals[path] = original
                    path.write_text(mutate_sql(name, original.decode()))
                else:
                    path, original = _file_mut_apply(name)
                    originals[path] = original
            except ValueError as e:
                print('HARNESS  %s — %s' % (name, e))
                harness.append(name)
                restore()
                originals.clear()
                continue
            code, fails = run_struct()
            restore()
            originals.clear()
            if code != 0:
                print('KILLED   %s — %d pin(s) failed: %s' % (name, len(fails), (fails[0] if fails else 'the test errored')[:150]))
            else:
                print('SURVIVED %s — the structural pins cannot see this regression' % name)
                survivors.append(name)
    finally:
        restore()
    killed = len(names) - len(survivors) - len(skipped) - len(harness)
    print('\n%d killed, %d survived, %d skipped (database only), %d harness fault(s), of %d' % (killed, len(survivors), len(skipped), len(harness), len(names)))
    if harness:
        return 2
    return 1 if survivors else 0


if __name__ == '__main__':
    sys.exit(main())
