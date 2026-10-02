#!/usr/bin/env python3
"""Prohibited mutations of docs/payment-event-ledger.sql. Each MUST fail the suite (or, for the prefixes below, the
stage that owns it).

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, and a mutation must change the text, so a mutation can never
silently fail to apply (a mutation that does not apply is indistinguishable from one that survives).
Mutations named rollback_* break the ROLLBACK block and are judged by run.sh's rollback stage; mutations named race_*
break the concurrency control and are judged by its two-session stage; every other mutation is judged by the suite.

The nine the Order M audit named are: no_unique_idempotency_key (1), no_append_only_trigger (2),
authenticated_can_execute (3), ordering_by_arrival (4), email_column_added (5), allowlist_widened_to_email and
whole_payload_stored (6), recorder_search_path_unpinned (7), recorder_writes_subscriptions (8),
unknown_status_mapped_to_active (9).
"""
import sys

IDEMPOTENT_CONSTRAINT = "  constraint payment_event_idempotency      unique (processor, idempotency_key),\n"
ON_CONFLICT = "  on conflict (processor, idempotency_key) do nothing\n"
LIVEMODE_COL = "  variant_ref      text,\n  livemode         boolean     not null,\n"
INSERT = ("  insert into public.payment_event as e\n"
          "    (processor, idempotency_key, subscription_ref, event_name, processor_status, occurred_at, product_ref, variant_ref, livemode)\n"
          "  values (v_proc, v_key, v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live)\n")
ORDER_BY = "   order by e.occurred_at desc, e.event_id desc\n"
RECORDER_HEAD = "language plpgsql\nsecurity definer\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_bad     text;"
LOCK = "  perform pg_advisory_xact_lock(hashtextextended('payment_event|' || v_proc || '|' || v_live::text || '|' || v_sub, 0));\n"
UPD_DEL_TRIGGER = ("create or replace trigger payment_event_no_update_delete\n  before update or delete on public.payment_event\n"
                   "  for each row execute function public.payment_event_immutable();")
TRUNC_TRIGGER = ("create or replace trigger payment_event_no_truncate\n  before truncate on public.payment_event\n"
                 "  for each statement execute function public.payment_event_immutable();")
GRANT_FN = "execute format('grant execute on function %s to service_role', f.sig);"
REVOKE_FN = "execute format('revoke all on function %s from public, anon, authenticated', f.sig);"
GRANT_TABLE = "grant select on public.payment_event to service_role;"
MAP_EXPIRED = "        when 'expired'   then 'canceled'\n        else 'unknown'\n"
KEY_CHARSET = "'^[A-Za-z0-9._:|=+/-]{1,200}$'"
RB_TABLE = "-- drop table if exists public.payment_event;\n"
RB_LAST = "-- drop function if exists public.payment_event_immutable();\n-- ROLLBACK-END"
OPAQUE_MSG = ("    raise exception 'payment_event: \"%\" must be an opaque token (1 to 200 characters of letters, digits and . _ : | = + / -)', p_key using errcode = '22023';")
LATEST_WHERE = "   where e.processor = p_processor and e.livemode = p_livemode and e.subscription_ref = p_subscription_ref\n"
OFFSET_RE = "(Z|[+-][0-9]{2}:[0-9]{2})$'"

MUTATIONS = {
    # ---- once: idempotency --------------------------------------------------------------------------------
    # the audit's mutation 1. The conflict target goes with the constraint, so a replay inserts a SECOND row instead of erroring.
    'no_unique_idempotency_key': [(IDEMPOTENT_CONSTRAINT, "", 1), (ON_CONFLICT, "  on conflict do nothing\n", 1)],
    'idempotency_key_scoped_globally': [(IDEMPOTENT_CONSTRAINT, "  constraint payment_event_idempotency      unique (idempotency_key),\n", 1),
                                        (ON_CONFLICT, "  on conflict (idempotency_key) do nothing\n", 1)],
    'duplicate_reported_as_recorded': [("    v_outcome := 'DUPLICATE';", "    v_outcome := 'RECORDED';", 1)],
    'key_reuse_not_detected': [("       is distinct from (v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live) then",
                                "       is distinct from (v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live) and false then", 1)],
    # ---- in order -----------------------------------------------------------------------------------------
    'ordering_by_arrival': [(ORDER_BY, "   order by e.event_id desc\n", 1)],                                   # the audit's mutation 4
    'tie_broken_by_the_oldest_arrival': [("e.occurred_at desc, e.event_id desc\n", "e.occurred_at desc, e.event_id asc\n", 1)],
    'latest_ignores_the_mode': [(LATEST_WHERE, "   where e.processor = p_processor and e.subscription_ref = p_subscription_ref\n", 1)],
    'latest_ignores_the_processor': [(LATEST_WHERE, "   where e.livemode = p_livemode and e.subscription_ref = p_subscription_ref\n", 1)],
    'race_no_subscription_lock': [(LOCK, "", 1)],
    # ---- the status mapping: closed ------------------------------------------------------------------------
    'unknown_status_mapped_to_active': [(MAP_EXPIRED, "        when 'expired'   then 'canceled'\n        else 'active'\n", 1)],   # the audit's mutation 9
    'expired_mapped_to_active': [("        when 'expired'   then 'canceled'", "        when 'expired'   then 'active'", 1)],
    'cancelled_not_mapped': [("        when 'cancelled' then 'canceled'\n", "", 1)],
    'map_ignores_the_processor': [("    when p_processor = 'lemonsqueezy' then", "    when true then", 1)],
    # ---- what can be stored -------------------------------------------------------------------------------
    'email_column_added': [(LIVEMODE_COL, "  variant_ref      text,\n  payer_email      text,\n  livemode         boolean     not null,\n", 1)],   # the audit's mutation 5
    'allowlist_widened_to_email': [("'occurred_at', 'product_ref', 'variant_ref', 'livemode']::text[]",
                                    "'occurred_at', 'product_ref', 'variant_ref', 'livemode', 'user_email', 'customer_email', 'payload']::text[]", 1)],   # the audit's mutation 6
    'whole_payload_stored': [(LIVEMODE_COL, "  variant_ref      text,\n  livemode         boolean     not null,\n  payload          jsonb,\n", 1),
                             ("    (processor, idempotency_key, subscription_ref, event_name, processor_status, occurred_at, product_ref, variant_ref, livemode)\n",
                              "    (processor, idempotency_key, subscription_ref, event_name, processor_status, occurred_at, product_ref, variant_ref, livemode, payload)\n", 1),
                             ("  values (v_proc, v_key, v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live)\n",
                              "  values (v_proc, v_key, v_sub, v_name, v_status, v_occ, v_prod, v_var, v_live, p_event)\n", 1)],            # the audit's mutation 6, the other half
    'unknown_key_ignored_not_refused': [("  if v_bad is not null then\n", "  if false then\n", 1)],
    'processor_not_checked_by_the_recorder': [(" or not public.payment_event_processor_ok(p_event ->> 'processor')", "", 1)],
    'opaque_allows_an_at_sign': [(KEY_CHARSET, "'^[A-Za-z0-9._:|=+/@-]{1,200}$'", 1)],
    'opaque_allows_a_space': [(KEY_CHARSET, "'^[A-Za-z0-9._:|=+/ -]{1,200}$'", 1)],
    'opaque_unbounded': [(KEY_CHARSET, "'^[A-Za-z0-9._:|=+/-]{1,}$'", 1)],
    'refusal_message_leaks_the_value': [(OPAQUE_MSG,
        "    raise exception 'payment_event: \"%\" must be an opaque token (%)', p_key, p_event ->> p_key using errcode = '22023';", 1)],
    'zoneless_time_accepted': [(OFFSET_RE, "(Z|[+-][0-9]{2}:[0-9]{2})?$'", 1)],
    'table_does_not_check_the_key': [("  constraint payment_event_key_opaque       check (public.payment_event_opaque_ok(idempotency_key)),\n", "", 1)],
    'foreign_key_to_subscriptions': [(LIVEMODE_COL, "  variant_ref      text,\n  livemode         boolean     not null,\n  subscription_row uuid        references public.subscriptions (id),\n", 1)],
    # ---- entitlement-free ---------------------------------------------------------------------------------
    'recorder_writes_subscriptions': [(INSERT, "  insert into public.subscriptions (user_id, status, processor_subscription_id) values (gen_random_uuid(), 'active', v_sub);\n" + INSERT, 1)],   # the audit's mutation 8
    # ---- append-only ---------------------------------------------------------------------------------------
    'no_append_only_trigger': [(UPD_DEL_TRIGGER, "select 1;", 1)],                                                # the audit's mutation 2
    'no_truncate_trigger': [(TRUNC_TRIGGER, "select 1;", 1)],
    # ---- lock-down -----------------------------------------------------------------------------------------
    'authenticated_can_execute': [(GRANT_FN, "execute format('grant execute on function %s to service_role, authenticated', f.sig);", 1)],   # the audit's mutation 3
    'functions_unlocked': [(REVOKE_FN, "execute format('select 1 /* %s */', f.sig);", 1)],
    'recorder_search_path_unpinned': [(RECORDER_HEAD, "language plpgsql\nsecurity definer\nas $$\ndeclare\n  v_bad     text;", 1)],     # the audit's mutation 7
    'recorder_not_security_definer': [(RECORDER_HEAD, "language plpgsql\nset search_path = public, pg_temp\nas $$\ndeclare\n  v_bad     text;", 1)],
    'no_rls': [("alter table public.payment_event enable row level security;", "select 1;", 1)],
    'table_default_grants': [("revoke all on public.payment_event from public, anon, authenticated, service_role;", "select 1;", 1)],
    'anon_can_read': [(GRANT_TABLE, "grant select on public.payment_event to service_role, anon;", 1)],
    'service_role_can_insert': [(GRANT_TABLE, "grant select, insert on public.payment_event to service_role;", 1)],
    'sequence_left_open': [("execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s);", "execute format('select 1 /* %s */', s);", 1)],
    # ---- the rollback block (judged by run.sh's rollback stage) ------------------------------------------------
    'rollback_leaves_the_table': [(RB_TABLE, "", 1)],
    'rollback_leaves_a_function': [("-- drop function if exists public.payment_event_latest_id(text, boolean, text);\n", "", 1)],
    'rollback_touches_subscriptions': [(RB_TABLE, RB_TABLE + "-- drop table if exists public.subscriptions;\n", 1)],
    'rollback_drops_the_functions_first': [(RB_TABLE, "", 1), (RB_LAST, "-- drop function if exists public.payment_event_immutable();\n" + RB_TABLE + "-- ROLLBACK-END", 1)],
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
        if old == new:
            sys.stderr.write('mutation %s changes nothing\n' % sys.argv[1])
            return 2
        text = text.replace(old, new)
    sys.stdout.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
