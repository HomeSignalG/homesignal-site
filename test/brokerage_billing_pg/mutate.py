#!/usr/bin/env python3
"""Prohibited mutations of docs/brokerage-billing.sql. Each MUST fail >= 1 NAMED check of test/brokerage_billing_pg/suite.sql, or of the
real-session scenarios in run.sh, or (kind 'postcondition') must STOP the apply. A mutation that only crashes the suite is reported by run.sh
and fails the run: a crash names nothing.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py --kind NAME       -> suite | postcondition | splice | untouched
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply (a mutation that does not apply is
indistinguishable from one that survives).

Where the SQL protects a rule twice, the mutation removes BOTH. The post-condition block near the foot of the file refuses to apply a file whose
lock-down was weakened, so the mutations that weaken it either are 'postcondition' kind (the apply itself must fail) or are APPENDED after it
(the 'append' helper), which is exactly what a later migration could do.
"""
import sys

ROLLBACK_MARK = "-- ROLLBACK (this file only"


def append(text):
    """A statement added AFTER the post-condition (what a later migration could do)."""
    return [(ROLLBACK_MARK, text + "\n" + ROLLBACK_MARK, 1)]


PLAN_ORDER = "     order by s.livemode desc, s.bound_at desc, s.binding_id\n"
ORDINAL_CK = "  constraint brokerage_paid_credit_ordinal       check (ordinal between 1 and public.billing_report_limit()),\n"
PK = "  constraint brokerage_paid_credit_pkey          primary key (binding_id, period_index, ordinal),\n"
STAMP = "  new.period_index := public.billing_period_index(b.bound_at, now());\n"
LIVE_GUARD = "  if not found or b.livemode is not true or b.brokerage_id <> new.brokerage_id then\n"
TEST_LINE = "           when not b.livemode then 'test_only'\n"
SUSPENDED = "           when not exists (select 1 from public.brokerage_account a where a.id = p_brokerage and a.status = 'active') then 'suspended'\n"
CONFLICT = ("  if found and b.brokerage_id <> p_brokerage then\n"
            "    raise exception using errcode = 'EV011', message = 'BINDING_CONFLICT';\n"
            "  end if;\n")
LOCK_LINE = "  perform pg_advisory_xact_lock(hashtextextended('billing|' || v_proc || '|' || v_live::text || '|' || v_ref, 0));\n"
ISO = ("  if current_setting('transaction_isolation') <> 'read committed' then\n")
EV_LOCK = "  select e.* into ev from public.evaluation e where e.brokerage_id = m.brokerage_id for update;\n"
STANDING = "  if not found or ev.status = 'revoked' or (ev.expires_at is not null and ev.expires_at <= now()) then\n"
PAID_RETRY = "    from public.brokerage_paid_credit c where c.brokerage_id = m.brokerage_id and c.idempotency_key = p_idempotency_key;\n"
OTHER_LEDGER = "     or exists (select 1 from public.evaluation_credit c where c.evaluation_id = ev.evaluation_id and c.idempotency_key = p_idempotency_key) then\n"
KEY_REQ = ("  if p_idempotency_key is null then\n"
           "    raise exception using errcode = '22023', message = 'IDEMPOTENCY_KEY_REQUIRED';\n"
           "  end if;\n")
NUMBER = "  select public.evaluation_report_limit() + count(*)::integer + 1 into v_number from public.brokerage_paid_credit c where c.brokerage_id = p_brokerage;\n"
PERIOD_END = "$$ select ((p_bound_at at time zone 'UTC') + (p_index + 1) * interval '1 month') at time zone 'UTC' $$;"
MONTHS = "   where (p_bound_at at time zone 'UTC') + k * interval '1 month' <= (p_at at time zone 'UTC')\n"
USAGE_MONTH = "         and c.period_index = public.billing_period_index(pl.bound_at, now())) u\n"
USAGE_REMAINING = "         case when pl.state = 'paid' then greatest(public.billing_report_limit() - u.n, 0) else 0 end,\n"
WRONG_MONTH = "   where c.period_index <> public.billing_period_index(b.bound_at, c.issued_at)\n"
ALL_VIEW = ("  union all\n"
            "  select e.evaluation_id, p.number, p.idempotency_key, p.report_id, p.issued_at\n"
            "    from public.brokerage_paid_credit p\n"
            "    join public.evaluation e on e.brokerage_id = p.brokerage_id;\n")
LATEST = "    left join public.payment_event e on e.event_id = public.payment_event_latest_id(b.processor, b.livemode, b.subscription_ref)\n"
PAID_WHEN = "           when e.mapped_status = 'active' then 'paid'\n"
UNKNOWN_ELSE = "           else 'unknown'\n"
PASTDUE = "           when e.mapped_status in ('paused', 'past_due', 'unpaid') then 'past_due'\n"
APPEND_ONLY_PAID = ("drop trigger if exists brokerage_paid_credit_append_only on public.brokerage_paid_credit;\n"
                    "create trigger brokerage_paid_credit_append_only before update or delete on public.brokerage_paid_credit\n"
                    "  for each row execute function public.billing_append_only();\n")
FREE_FIRST = "  if not found or pl.state is distinct from 'paid'\n"
REVOKE_SUB = "revoke all on public.brokerage_subscription from public, anon, authenticated, service_role;\n"
RLS_PAID = "alter table public.brokerage_paid_credit  enable row level security;\n"
DEFINER_PLAN = ("language sql stable security definer set search_path = public, pg_temp\n"
                "as $$\n"
                "  with b as (")
SPLICE_ONE = "    if n <> 1 then\n"
SPLICE_SAME = "    if after_ is distinct from before_ then\n"
LIMIT = "language sql immutable as $$ select 100 $$;"
EXEC_NEWDEF = "    execute newdef;\n"
POST_LIMIT = "  if public.billing_report_limit() <> 100 then\n"

MUTATIONS = {
    # ---- the cap and the month -----------------------------------------------------------------------------------
    'cap_not_a_constraint': [(ORDINAL_CK, "", 1)],
    'limit_is_101': [(LIMIT, "language sql immutable as $$ select 101 $$;", 1), (POST_LIMIT, "  if false then\n", 1)],
    'month_not_in_the_key': [(PK, "  constraint brokerage_paid_credit_pkey          primary key (binding_id, ordinal),\n", 1)],
    'month_chosen_by_the_writer': [(STAMP, "", 1)],
    'month_is_30_days': [(MONTHS, "   where (p_bound_at at time zone 'UTC') + k * interval '30 days' <= (p_at at time zone 'UTC')\n", 1)],
    'month_end_one_early': [(PERIOD_END, "$$ select ((p_bound_at at time zone 'UTC') + p_index * interval '1 month') at time zone 'UTC' $$;", 1)],
    'usage_counts_every_month': [(USAGE_MONTH, "         and true) u\n", 1)],
    'numbers_restart_at_one': [(NUMBER, "  select count(*)::integer + 1 into v_number from public.brokerage_paid_credit c where c.brokerage_id = p_brokerage;\n", 1)],
    # ---- which states pay ----------------------------------------------------------------------------------------
    'test_mode_pays': [(TEST_LINE, "", 1)],
    'trialing_pays': [(PAID_WHEN, "           when e.mapped_status in ('active', 'trialing') then 'paid'\n", 1)],
    'unknown_pays': [(UNKNOWN_ELSE, "           else 'paid'\n", 1)],
    'past_due_pays': [(PASTDUE, "           when e.mapped_status in ('paused', 'past_due', 'unpaid') then 'paid'\n", 1)],
    'suspended_still_pays': [(SUSPENDED, "", 1)],
    'oldest_binding_wins': [(PLAN_ORDER, "     order by s.livemode desc, s.bound_at asc, s.binding_id\n", 1)],
    'test_binding_outranks_live': [(PLAN_ORDER, "     order by s.livemode asc, s.bound_at desc, s.binding_id\n", 1)],
    'latest_by_arrival_order': [(LATEST, "    left join public.payment_event e on e.event_id = (select max(x.event_id) from public.payment_event x where x.processor = b.processor and x.livemode = b.livemode and x.subscription_ref = b.subscription_ref)\n", 1)],
    'usage_shows_a_balance_when_not_paid': [(USAGE_REMAINING, "         greatest(public.billing_report_limit() - u.n, 0),\n", 1)],
    # ---- binding -------------------------------------------------------------------------------------------------
    'rebinding_allowed': [(CONFLICT, "", 1)],
    'binding_not_serialised': [(LOCK_LINE, "", 1)],
    # ---- the one entry -------------------------------------------------------------------------------------------
    'no_isolation_guard': [(ISO, "  if false then\n", 1)],
    'no_row_lock': [(EV_LOCK, "  select e.* into ev from public.evaluation e where e.brokerage_id = m.brokerage_id;\n", 1)],
    'revoked_evaluation_still_pays': [(STANDING, "  if not found then\n", 1)],
    'paid_retry_not_answered': [(PAID_RETRY, "    from public.brokerage_paid_credit c where c.brokerage_id = m.brokerage_id and c.idempotency_key = p_idempotency_key and false;\n", 1)],
    'free_key_retried_into_the_paid_month': [(OTHER_LEDGER, "     or false then\n", 1)],
    'free_reports_used_first': [(FREE_FIRST, "  if not found or pl.state is distinct from 'paid' or (select count(*) from public.evaluation_credit c where c.evaluation_id = ev.evaluation_id) < public.evaluation_report_limit()\n", 1)],
    'key_not_required': [(KEY_REQ, "", 1)],
    # ---- the ledgers and the view --------------------------------------------------------------------------------
    'paid_credit_on_a_test_binding': [(LIVE_GUARD, "  if not found or b.brokerage_id <> new.brokerage_id then\n", 1)],
    'paid_ledger_can_be_changed': [(APPEND_ONLY_PAID, "", 1)],
    'view_ignores_paid_reports': [(ALL_VIEW, ";\n", 1)],
    'audit_blind_to_wrong_month': [(WRONG_MONTH, "   where false\n", 1)],
    # ---- lock-down: the post-condition itself must stop these --------------------------------------------------------
    'post:subscription_open_to_anon': [(REVOKE_SUB, "revoke all on public.brokerage_subscription from public;\n", 1)],
    'post:no_row_level_security': [(RLS_PAID, "", 1)],
    'post:plan_not_a_definer': [(DEFINER_PLAN, "language sql stable set search_path = public, pg_temp\nas $$\n  with b as (", 1)],
    # ---- what a later migration could do AFTER the post-condition -------------------------------------------------
    'append:ledger_readable_by_authenticated': append("grant select on public.brokerage_paid_credit to authenticated;\n"),
    'append:charging_helper_executable': append("grant execute on function public.billing_paid_issue(uuid, uuid, timestamptz, uuid, text, text, text, jsonb, jsonb) to service_role;\n"),
    'append:usage_executable_by_anon': append("grant execute on function public.billing_usage(uuid) to anon;\n"),
    # ---- the splice ------------------------------------------------------------------------------------------------------
    'splice:without_the_anchor_count': [(SPLICE_ONE, "    if false then\n", 1)],
    'untouched:splice_leaves_a_grant': [(SPLICE_SAME, "    if false then\n", 1),
                                         (EXEC_NEWDEF, "    execute newdef;\n    execute 'grant execute on function ' || f || ' to anon';\n", 1)],
}

KIND_PREFIX = {'post:': 'postcondition', 'append:': 'suite', 'splice:': 'splice', 'untouched:': 'untouched'}


def kind_of(name):
    for p, k in KIND_PREFIX.items():
        if name.startswith(p):
            return k
    return 'suite'


def main(argv):
    if argv[1:] == ['--list']:
        print("\n".join(MUTATIONS))
        return 0
    if len(argv) == 3 and argv[1] == '--kind' and argv[2] in MUTATIONS:
        print(kind_of(argv[2]))
        return 0
    if len(argv) != 3 or argv[1] not in MUTATIONS:
        print("usage: mutate.py --list | --kind NAME | NAME FILE", file=sys.stderr)
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
