#!/usr/bin/env python3
"""Prohibited mutations of docs/report-rate-limit.sql. Each MUST fail >= 1 NAMED check of test/report_rate_limit_pg/suite.sql, or of the real-session
scenarios in run.sh, or (kind 'postcondition') must STOP the apply. A mutation that only crashes the suite is reported by the loop in
test/report-rate-limit-structure.test.mjs's companion (mutate_all.sh) and fails the run: a crash names nothing.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py --kind NAME       -> suite | postcondition
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent or matches the wrong number of times
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply (a mutation that does not apply is
indistinguishable from one that survives).

The post-condition block near the foot of the file refuses to apply a file whose lock-down was weakened or whose limits or founder numbers moved, so the
mutations that weaken those are either 'postcondition' kind (the apply itself must fail) or are APPENDED after it (the 'append' helper), which is exactly
what a later migration could do.
"""
import sys

ROLLBACK_MARK = "-- ROLLBACK (this file only"
POST_MARK = "-- ---- 7. POST-CONDITION"


def append(text):
    """A statement added AFTER the post-condition (what a later migration could do)."""
    return [(ROLLBACK_MARK, text + "\n" + ROLLBACK_MARK, 1)]


def before_post(text):
    """A statement added BEFORE the post-condition (the post-condition must then refuse the apply)."""
    return [(POST_MARK, text + "\n" + POST_MARK, 1)]


SUBJECT = "v_subject := case l.bucket when 'user' then p_user else v_brokerage end;"
LOCKS = ("  perform pg_advisory_xact_lock(hashtextextended('report_rate|user|' || p_user::text, 0));\n"
         "  if v_brokerage is not null then\n"
         "    perform pg_advisory_xact_lock(hashtextextended('report_rate|brokerage|' || v_brokerage::text, 0));\n"
         "  end if;\n")
ISO = ("  if current_setting('transaction_isolation') <> 'read committed' then\n"
       "    raise exception using errcode = '55000', message = 'RATE_CLAIM_NEEDS_READ_COMMITTED';\n"
       "  end if;\n")
NULLS = ("  if p_user is null or p_at is null then\n"
         "    raise exception using errcode = '22023', message = 'RATE_CLAIM_NEEDS_USER_AND_TIME';\n"
         "  end if;\n")
EARLY_RETURN = ("    return query select false, v_worst, v_scope, v_win;\n"
                "    return;\n")
WAIT = "v_wait := greatest(1, ceil(extract(epoch from (v_start + l.window_secs * interval '1 second' - p_at)))::integer);"
UPSERT = "      set used         = case when w.window_start >= excluded.window_start then w.used + 1 else 1 end,"
CLAIM_AT_SECDEF = "language plpgsql security definer set search_path = public, pg_temp"

MUTATIONS = {
    # ---- the counting rule
    "refusal_still_counts": ("suite", [(EARLY_RETURN, "    return query select false, v_worst, v_scope, v_win;\n", 1)]),
    "off_by_one_allows_one_extra": ("suite", [("if coalesce(v_used, 0) >= l.max_requests then", "if coalesce(v_used, 0) > l.max_requests then", 1)]),
    "brokerage_keyed_on_the_person": ("suite", [(SUBJECT, "v_subject := case l.bucket when 'user' then p_user else p_user end;", 2)]),
    "person_keyed_on_the_brokerage": ("suite", [(SUBJECT, "v_subject := case l.bucket when 'user' then coalesce(v_brokerage, p_user) else v_brokerage end;", 2)]),
    "membership_ignored": ("suite", [("  select m.brokerage_id into v_brokerage from public.brokerage_membership_of(p_user) m limit 1;", "  v_brokerage := null;", 1)]),
    "window_never_rolls_over": ("suite", [(UPSERT, "      set used         = w.used + 1,", 1)]),
    "window_always_resets": ("suite", [(UPSERT, "      set used         = 1,", 1)]),
    "old_clock_reopens_a_window": ("suite", [("and w.window_start >= v_start;", "and w.window_start = v_start;", 1)]),
    "shortest_wait_reported": ("suite", [("if v_wait > v_worst then", "if v_worst = 0 or v_wait < v_worst then", 1)]),
    "wait_can_be_zero": ("suite", [(WAIT, "v_wait := greatest(0, floor(extract(epoch from (v_start + l.window_secs * interval '1 second' - p_at)))::integer);", 1)]),
    # ---- the numbers
    "person_minute_limit_changed": ("suite", [("('user', 60, 10)", "('user', 60, 11)", 1)]),
    "hour_window_dropped": ("postcondition", [("('user', 3600, 60), ", "", 1), ("('brokerage', 3600, 200), ", "", 1)]),
    # ---- concurrency and input
    "no_advisory_locks": ("suite", [(LOCKS, "", 1)]),
    "no_isolation_guard": ("suite", [(ISO, "", 1)]),
    "null_person_not_refused": ("suite", [(NULLS, "", 1)]),
    "wrapper_uses_a_fixed_clock": ("suite", [("select * from public.report_rate_claim_at(p_user, now())", "select * from public.report_rate_claim_at(p_user, '2000-01-01 00:00:00+00'::timestamptz)", 1)]),
    # ---- what it stores
    "table_keeps_an_email": ("suite", [("  used          integer     not null,\n", "  used          integer     not null,\n  email         text,\n", 1)]),
    # ---- access
    "claim_not_security_definer": ("suite", [(CLAIM_AT_SECDEF, "language plpgsql set search_path = public, pg_temp", 1)]),
    "claim_granted_to_authenticated": ("suite", append("grant execute on function public.report_rate_claim(uuid) to authenticated;")),
    "clocked_claim_granted_to_anon": ("suite", append("grant execute on function public.report_rate_claim_at(uuid, timestamptz) to anon;")),
    "table_readable_by_authenticated": ("suite", append("grant select on public.report_rate_window to authenticated;")),
    "rls_turned_off_later": ("suite", append("alter table public.report_rate_window disable row level security;")),
    "rls_never_enabled": ("postcondition", [("alter table public.report_rate_window enable row level security;\n", "", 1)]),
    "claim_open_to_a_resident_role_at_apply": ("postcondition", [("grant execute on function public.report_rate_check()                     to service_role;\n",
                                                                    "grant execute on function public.report_rate_check()                     to service_role;\ngrant execute on function public.report_rate_claim(uuid) to authenticated;\n", 1)]),
    # ---- the founder's numbers and the credit path
    "free_limit_moved_before_the_postcondition": ("postcondition", before_post("create or replace function public.evaluation_report_limit() returns integer language sql immutable as $$ select 21 $$;")),
    "free_limit_moved_after": ("suite", append("create or replace function public.evaluation_report_limit() returns integer language sql immutable as $$ select 21 $$;")),
    "paid_limit_moved_after": ("suite", append("create or replace function public.billing_report_limit() returns integer language sql immutable as $$ select 101 $$;")),
    "credit_path_calls_the_limiter": ("suite", append("create or replace function public.billing_credit_hook() returns integer language sql as $$ select count(*)::integer from public.report_rate_window /* report_rate */ $$;")),
    # ---- the audit
    "audit_blind_to_a_breach": ("suite", [("   where w.used > l.max_requests\n", "   where w.used > l.max_requests + 100000\n", 1)]),
}


def apply(name, text):
    kind, edits = MUTATIONS[name]
    for old, new, count in edits:
        found = text.count(old)
        if found != count:
            sys.stderr.write("ANCHOR MISMATCH in %s: expected %d, found %d: %r\n" % (name, count, found, old[:80]))
            sys.exit(2)
        text = text.replace(old, new)
    return text


if __name__ == "__main__":
    a = sys.argv[1:]
    if a == ["--list"]:
        print("\n".join(MUTATIONS))
    elif len(a) == 2 and a[0] == "--kind":
        print(MUTATIONS[a[1]][0])
    elif len(a) == 2 and a[0] in MUTATIONS:
        sys.stdout.write(apply(a[0], open(a[1]).read()))
    else:
        sys.stderr.write(__doc__)
        sys.exit(64)
