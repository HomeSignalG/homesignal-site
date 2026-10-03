#!/usr/bin/env python3
"""Prohibited mutations of docs/property-watch.sql. Each MUST fail >= 1 NAMED check of test/property_watch_pg/suite.sql or of the
real-session scenarios in run.sh (a mutation that only crashes the suite is reported by run.sh and fails the run).

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply (a mutation that does not
apply is indistinguishable from one that survives).

Where the SQL protects a rule twice, the mutation removes BOTH. The post-condition block at the foot of the file would refuse to apply a file
whose lock-down, period or retention had been weakened, so the mutations that weaken those either neutralise it too or add the weakening AFTER
it (the 'append' kind), which is exactly what a later migration could do.
"""
import sys

ROLLBACK_MARK = "-- ROLLBACK (this file only"


def append(text):
    """A statement added AFTER the post-condition (what a later migration could do)."""
    return [(ROLLBACK_MARK, text + ROLLBACK_MARK, 1)]


# ---- exact blocks of the file -------------------------------------------------------------------------------------
PERIOD = "select interval '1 day' $$"
POST_PERIOD = "  if public.property_watch_period() <> interval '1 day' then\n"
LIMIT = "select 25 $$"
LEASE = "select interval '10 minutes' $$"
KEEP = "select interval '100 days' $$"
RETRY = "select interval '1 hour' $$"

RC_BLOCK = ("  if current_setting('transaction_isolation') <> 'read committed' then\n"
            "    raise exception 'evaluation_property_watch_start: needs READ COMMITTED (the per-brokerage limit is counted after a lock that refreshes what the count sees only there; this transaction is %)',\n"
            "      current_setting('transaction_isolation') using errcode = '55000';\n"
            "  end if;\n")
OPEN_CHECK = ("  select o.private_context_id into v_ctx from public.evaluation_report_open(p_user_id, p_report_id) o;\n"
              "  if not found then\n"
              "    raise exception using errcode = 'EV006', message = 'NOT_FOUND';\n"
              "  end if;\n")
OWN_ONLY = ("  select c.private_context_id into v_ctx from (select s.private_context_id from public.brokerage_membership_of(p_user_id) m\n"
            "    join public.evaluation e on e.brokerage_id = m.brokerage_id\n"
            "    join public.evaluation_credit c2 on c2.evaluation_id = e.evaluation_id\n"
            "    join public.report_snapshot s on s.report_id = c2.report_id where s.report_id = p_report_id) c;\n"
            "  if not found then\n"
            "    raise exception using errcode = 'EV006', message = 'NOT_FOUND';\n"
            "  end if;\n")
NOT_FOUND_START = ("    raise exception using errcode = 'EV006', message = 'NOT_FOUND';\n"
                   "  end if;\n"
                   "  select m.brokerage_id into v_brokerage")
LOCK = "  perform pg_advisory_xact_lock(hashtextextended('property_watch:' || v_brokerage::text, 0));\n"
EXISTING = ("  select w.watch_id, w.created_at into v_id, v_created from public.property_watch w where w.user_id = p_user_id and w.report_id = p_report_id;\n"
            "  if found then\n")
EXISTING_OFF = ("  select w.watch_id, w.created_at into v_id, v_created from public.property_watch w where w.user_id = p_user_id and w.report_id = p_report_id;\n"
                "  if false then\n")
STARTED_FALSE = "    return query select v_id, v_created, false;\n"
CTX_NULL = ("  if v_ctx is null then\n"
            "    raise exception using errcode = 'EV009', message = 'PROPERTY_NOT_KEPT';\n"
            "  end if;\n")
COUNT = ("  select count(*) into v_n from public.property_watch w\n"
         "   where exists (select 1 from public.brokerage_membership_of(w.user_id) m where m.brokerage_id = v_brokerage);\n")
COUNT_ALL = "  select count(*) into v_n from public.property_watch w;\n"
COUNT_ANY_MEMBER = ("  select count(*) into v_n from public.property_watch w\n"
                    "   where exists (select 1 from public.brokerage_member m where m.user_id = w.user_id and m.brokerage_id = v_brokerage);\n")
LIMIT_CMP = "  if v_n >= public.property_watch_limit() then\n"
NEED_OPEN_NEW = ("    insert into public.property_watch (report_id, user_id) values (p_report_id, p_user_id)\n"
                 "      returning property_watch.watch_id, property_watch.created_at into v_id, v_created;\n"
                 "    perform public.report_private_context_need_open(v_ctx, 'follow', v_id::text);\n"
                 "  exception when sqlstate '55000' or sqlstate '23503' then\n"
                 "    raise exception using errcode = 'EV009', message = 'PROPERTY_NOT_KEPT';\n"
                 "  end;\n")
HANDLER_NEW = "  exception when sqlstate '55000' or sqlstate '23503' then\n    raise exception using errcode = 'EV009', message = 'PROPERTY_NOT_KEPT';\n  end;\n  return query select v_id, v_created, true;\n"

LIST_WHERE = "   where w.user_id = p_user_id\n   order by w.created_at desc, w.watch_id\n"
STOP_DELETE = "  delete from public.property_watch w where w.watch_id = p_watch_id and w.user_id = p_user_id;\n"
STOP_NOT_FOUND = ("  if not found then\n"
                  "    raise exception using errcode = 'EV006', message = 'NOT_FOUND';\n"
                  "  end if;\n"
                  "  return true;\n")
POST_DEFINER_LIST = "'property_watch_integrity', 'property_watch_close_need') loop\n"
CLOSE_CALL = "    perform public.report_private_context_need_close(v_ctx, 'follow', old.watch_id::text);\n"
CLOSE_HEAD = ("create or replace function public.property_watch_close_need() returns trigger\n"
              "language plpgsql security definer set search_path = public, pg_temp\n")
GUARD_TRIGGER = ("create or replace trigger property_watch_identity_guard\n"
                 "  before update on public.property_watch\n"
                 "  for each row execute function public.property_watch_guard();\n")
TRUNC_TRIGGER = ("create or replace trigger property_watch_no_truncate\n"
                 "  before truncate on public.property_watch\n"
                 "  for each statement execute function public.property_watch_no_truncate();\n")

CLAIM_WHERE = ("       where w.next_due_at <= now() and (w.retry_after is null or w.retry_after <= now())\n"
               "         and (w.lease_until is null or w.lease_until <= now())\n"
               "       order by w.next_due_at, w.watch_id\n"
               "       limit p_limit\n"
               "       for update skip locked),\n")
CLAIM_LEASE = "         and (w.lease_until is null or w.lease_until <= now())\n"
CLAIM_RETRY = "       where w.next_due_at <= now() and (w.retry_after is null or w.retry_after <= now())\n"
CLAIM_ORDER = "       order by w.next_due_at, w.watch_id\n       limit p_limit\n"
CLAIM_LOCK = "       for update skip locked),\n"
CLAIM_BOUND = "  if p_limit is null or p_limit < 1 or p_limit > 100 then\n"
CLAIM_SET = "      update public.property_watch w set lease_until = now() + public.property_watch_lease()\n"

CONSISTENT = ("  if (p_outcome = 'NOTIFIED') <> (jsonb_array_length(v_seen) > 0) then\n"
              "    raise exception 'property_watch_record_run: a NOTIFIED check records what it told, and any other records nothing' using errcode = '22023';\n"
              "  end if;\n")
SEEN_SHAPE = "  if jsonb_typeof(v_seen) <> 'array' or jsonb_array_length(v_seen) > 200 then\n"
OUTCOME_CHECK = "  if p_outcome is null or p_outcome not in ('CHECKED', 'CHECKED_PARTIAL', 'NOTIFIED') then\n"
CONFLICT = "    on conflict do nothing;\n"
PRUNE = "  delete from public.property_watch_seen s where s.watch_id = p_watch and s.observed_at < now() - public.property_watch_seen_keep();\n"
SLOT = "  v_k := greatest(1, floor(extract(epoch from (now() - w.next_due_at)) / extract(epoch from public.property_watch_period()))::integer + 1);\n"
SLOT_SET = "         next_due_at = w.next_due_at + v_k * public.property_watch_period()\n"
RUN_SET = "     set last_run_at = now(), last_outcome = p_outcome, failure_count = 0, lease_until = null, retry_after = null,\n"
RUN_MISSING = ("  select * into w from public.property_watch where watch_id = p_watch for update;\n"
               "  if not found then\n"
               "    return false;\n"
               "  end if;\n")
FAIL_SET = "     set failure_count = failure_count + 1, last_outcome = p_outcome, lease_until = null\n"
FAIL_BACKOFF = "     set retry_after = now() + public.property_watch_retry() * least(v_fail, 24)\n"
FAIL_MISSING = ("  if not found then\n"
                "    return false;\n"
                "  end if;\n"
                "  update public.property_watch\n"
                "     set retry_after")
END_REASON = "  if p_reason is null or p_reason not in ('STANDING_LOST', 'PROPERTY_NOT_KEPT') then\n"

INTEG_NEED = "and n.kind = 'follow' and n.ref = w.watch_id::text and n.closed_at is null))\n"
INTEG_OVERDUE = "     where greatest(w.next_due_at, coalesce(w.retry_after, w.next_due_at)) < now() - interval '6 hours'\n"
SEEN_TABLE_FK = "  watch_id    uuid        not null references public.property_watch (watch_id) on delete cascade,\n"
USER_FK = "  user_id       uuid        not null references auth.users (id) on delete cascade,\n"
UNIQUE = "  constraint property_watch_one_per_agent_and_report unique (user_id, report_id),\n"
NEED_REF = "perform public.report_private_context_need_open(v_ctx, 'follow', v_id::text);\n  exception when sqlstate '55000' or sqlstate '23503' then\n    raise exception using errcode = 'EV009', message = 'PROPERTY_NOT_KEPT';\n  end;\n  return query select v_id, v_created, true;"

MUTATIONS = {
    # ---- the numbers ----------------------------------------------------------------------------------------------
    'period_two_days': [(PERIOD, "select interval '2 days' $$", 1), (POST_PERIOD, "  if false then\n", 1)],
    'period_twelve_hours': [(PERIOD, "select interval '12 hours' $$", 1), (POST_PERIOD, "  if false then\n", 1)],
    'limit_twenty_six': [(LIMIT, "select 26 $$", 1)],
    'lease_one_minute': [(LEASE, "select interval '1 minute' $$", 1)],
    'seen_keep_longer': [(KEEP, "select interval '101 days' $$", 1)],
    'retry_unit_two_hours': [(RETRY, "select interval '2 hours' $$", 1)],
    # ---- who may start ----------------------------------------------------------------------------------------------
    'start_no_ownership': [(OPEN_CHECK, "  v_ctx := (select s.private_context_id from public.report_snapshot s where s.report_id = p_report_id);\n  if p_user_id is null then\n    raise exception using errcode = 'EV006', message = 'NOT_FOUND';\n  end if;\n", 1)],
    'start_ownership_without_standing': [(OPEN_CHECK, OWN_ONLY, 1)],
    'start_not_found_says_forbidden': [(NOT_FOUND_START, "    raise exception using errcode = 'EV006', message = 'NOT_YOURS';\n  end if;\n  select m.brokerage_id into v_brokerage", 1)],
    'start_not_idempotent': [(EXISTING, EXISTING_OFF, 1)],
    'start_says_started_when_not': [(STARTED_FALSE, "    return query select v_id, v_created, true;\n", 1)],
    'start_allows_no_context': [(CTX_NULL, "", 1)],
    'start_purged_not_translated': [(HANDLER_NEW, "  end;\n  return query select v_id, v_created, true;\n", 1)],
    'start_no_follow_need': [(NEED_OPEN_NEW, "    insert into public.property_watch (report_id, user_id) values (p_report_id, p_user_id)\n"
                              "      returning property_watch.watch_id, property_watch.created_at into v_id, v_created;\n  exception when sqlstate '55000' then\n    null;\n  end;\n", 1)],
    'start_need_ref_is_report': [(NEED_REF, NEED_REF.replace("v_id::text", "p_report_id::text"), 1)],
    # ---- the limit --------------------------------------------------------------------------------------------------------
    'limit_no_lock': [(LOCK, "", 1)],
    'limit_no_read_committed_guard': [(RC_BLOCK, "", 1)],
    'limit_off_by_one': [(LIMIT_CMP, "  if v_n > public.property_watch_limit() then\n", 1)],
    'limit_counts_every_brokerage': [(COUNT, COUNT_ALL, 1)],
    'limit_counts_departed_agents': [(COUNT, COUNT_ANY_MEMBER, 1)],
    'limit_removed': [(LIMIT_CMP, "  if false then\n", 1)],
    # ---- the list ---------------------------------------------------------------------------------------------------------
    'list_every_agent': [(LIST_WHERE, "   order by w.created_at desc, w.watch_id\n", 1)],
    'list_oldest_first': [(LIST_WHERE, "   where w.user_id = p_user_id\n   order by w.created_at, w.watch_id\n", 1)],
    # ---- stop and the trigger ---------------------------------------------------------------------------------------------------
    'stop_not_owner_only': [(STOP_DELETE, "  delete from public.property_watch w where w.watch_id = p_watch_id;\n", 1)],
    'stop_silent_when_missing': [(STOP_NOT_FOUND, "  return found;\n", 1)],
    'trigger_does_not_close_need': [(CLOSE_CALL, "    null;\n", 1)],
    # the post-condition would refuse to apply a non-definer trigger function, so its entry is taken out too (the weakening a later migration could make)
    'trigger_not_security_definer': [(CLOSE_HEAD, CLOSE_HEAD.replace(" security definer", ""), 1),
                                     (POST_DEFINER_LIST, "'property_watch_integrity') loop\n", 1)],
    'truncate_allowed': [(TRUNC_TRIGGER, "", 1)],
    'identity_can_change': [(GUARD_TRIGGER, "", 1)],
    'seen_not_removed_with_watch': [(SEEN_TABLE_FK, "  watch_id    uuid        not null references public.property_watch (watch_id),\n", 1)],
    'user_delete_leaves_watch': [(USER_FK, "  user_id       uuid        not null references auth.users (id),\n", 1)],
    'two_watches_per_agent_and_report': [(UNIQUE, "", 1)],
    # ---- the claim -----------------------------------------------------------------------------------------------------------------
    'claim_ignores_lease': [(CLAIM_LEASE, "", 1)],
    'claim_ignores_backoff': [(CLAIM_RETRY, "       where w.next_due_at <= now()\n", 1)],
    'claim_not_oldest_first': [(CLAIM_ORDER, "       limit p_limit\n", 1)],
    'claim_waits_for_locked_rows': [(CLAIM_LOCK, "       for update),\n", 1)],
    'claim_unbounded': [(CLAIM_BOUND, "  if p_limit is null then\n", 1)],
    'claim_takes_future_watches': [(CLAIM_RETRY, "       where (w.retry_after is null or w.retry_after <= now())\n", 1)],
    'claim_forgets_to_lease': [(CLAIM_SET, "      update public.property_watch w set lease_until = w.lease_until\n", 1)],
    # ---- recording a check ---------------------------------------------------------------------------------------------------------------
    'run_slot_drifts_from_now': [(SLOT_SET, "         next_due_at = now() + public.property_watch_period()\n", 1)],
    'run_slot_can_stand_still': [(SLOT, SLOT.replace("greatest(1, ", "greatest(0, "), 1)],
    'run_catches_up_one_day_at_a_time': [(SLOT, "  v_k := 1;\n", 1)],
    'run_keeps_backoff': [(RUN_SET, RUN_SET.replace(", retry_after = null", ""), 1)],
    'run_keeps_failures': [(RUN_SET, RUN_SET.replace("failure_count = 0, ", ""), 1)],
    'run_keeps_lease': [(RUN_SET, RUN_SET.replace("lease_until = null, ", ""), 1)],
    'run_notified_with_nothing': [(CONSISTENT, "", 1)],
    'run_unbounded_seen': [(SEEN_SHAPE, "  if jsonb_typeof(v_seen) <> 'array' then\n", 1)],
    'run_any_outcome': [(OUTCOME_CHECK, "  if p_outcome is null then\n", 1)],
    'run_repeats_a_told_change': [(CONFLICT, ";\n", 1)],
    'run_never_forgets': [(PRUNE, "", 1)],
    'run_missing_watch_reports_true': [(RUN_MISSING, RUN_MISSING.replace("return false", "return true"), 1)],
    # ---- failure ----------------------------------------------------------------------------------------------------------------------------
    'failure_moves_the_daily_slot': [(FAIL_BACKOFF, "     set retry_after = now() + public.property_watch_retry() * least(v_fail, 24), next_due_at = now() + public.property_watch_retry() * least(v_fail, 24)\n", 1)],
    'failure_backoff_uncapped': [(FAIL_BACKOFF, "     set retry_after = now() + public.property_watch_retry() * v_fail\n", 1)],
    'failure_backoff_flat': [(FAIL_BACKOFF, "     set retry_after = now() + public.property_watch_retry()\n", 1)],
    'failure_not_counted': [(FAIL_SET, "     set failure_count = failure_count, last_outcome = p_outcome, lease_until = null\n", 1)],
    'failure_keeps_lease': [(FAIL_SET, "     set failure_count = failure_count + 1, last_outcome = p_outcome\n", 1)],
    # ---- end -------------------------------------------------------------------------------------------------------------------------------------
    'end_any_reason': [(END_REASON, "  if p_reason is null then\n", 1)],
    # ---- the audit ---------------------------------------------------------------------------------------------------------------------------------
    'audit_blind_to_closed_need': [(INTEG_NEED, "and n.kind = 'follow' and n.ref = w.watch_id::text))\n", 1)],
    'audit_overdue_ignores_backoff': [(INTEG_OVERDUE, "     where w.next_due_at < now() - interval '6 hours'\n", 1)],
    # ---- lock-down (added AFTER the post-condition, as a later migration could) --------------------------------------------------------------
    'grant_authenticated_start': append("grant execute on function public.evaluation_property_watch_start(uuid, uuid) to authenticated;\n"),
    'grant_anon_claim': append("grant execute on function public.property_watch_claim(integer) to anon;\n"),
    'grant_public_period': append("grant execute on function public.property_watch_period() to public;\n"),
    'rls_off': append("alter table public.property_watch disable row level security;\n"),
    'table_select_to_authenticated': append("grant select on public.property_watch to authenticated;\n"),
    'service_role_writes_directly': append("grant insert, update, delete on public.property_watch to service_role;\n"),
    'seen_table_open_to_anon': append("grant select on public.property_watch_seen to anon;\n"),
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
