#!/usr/bin/env python3
"""Prohibited mutations of docs/report-private-context.sql. Each MUST fail the suite.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently
fail to apply (a mutation that does not apply is indistinguishable from one that survives).

Where the SQL protects a rule twice (a function check AND a table constraint), the mutation removes
BOTH: a mutation that leaves the second guard standing only proves the second guard works.
"""
import sys

GRACE = "language sql immutable as $$ select interval '90 days' $$;"
CEILING = (",\n  constraint report_private_context_grace_ceiling check (purge_due_at is null or purge_due_at <= last_needed_at + public.report_private_context_grace())\n);")
CLOCK_SET = "set last_needed_at = now(), purge_due_at = now() + public.report_private_context_grace()"
CLOSE_IF = "  if not exists (select 1 from public.report_private_context_need where context_id = p_context and closed_at is null) then"
OPEN_CLEARS = "update public.report_private_context set last_needed_at = now(), purge_due_at = null where context_id = p_context;"
NOOP_CLOSE = ("  if v_closed = 0 then\n    return;                                  -- not open: idempotent, and it never starts a clock by itself\n  end if;\n")
OPEN_IDEMPOTENT = ("  if exists (select 1 from public.report_private_context_need where context_id = p_context and kind = p_kind and ref = p_ref and closed_at is null) then\n"
                   "    return;                                  -- already open: idempotent\n  end if;\n")
OPEN_ON_PURGED = ("  if c.state = 'purged' then\n    raise exception 'report_private_context: the context was purged and cannot be reopened' using errcode = '55000';\n  end if;\n")
PURGE_SET1 = "     set state = 'purged', address = null, normalized_address = null, latitude = null, longitude = null,\n"
PURGE_SET2 = "         property_keys = null, label = null, purge_due_at = null, purged_at = now(), purge_reason = p_reason\n"
EMPTY_CHECK = ("    address is null and normalized_address is null and latitude is null and longitude is null\n"
               "    and property_keys is null and label is null and purge_due_at is null\n")
CLOSE_CTE = ("  with closed as (\n    update public.report_private_context_need set closed_at = now()\n"
             "     where context_id = p_context and closed_at is null returning kind, opened_at)\n"
             "  insert into public.report_private_context_event (context_id, kind, need_kind)\n"
             "    select p_context, 'need_closed', kind from closed order by opened_at, kind;\n")
EXPIRY_GUARD = ("  if p_reason = 'retention_expired'\n"
                "     and (c.purge_due_at is null or c.purge_due_at > now()\n"
                "          or exists (select 1 from public.report_private_context_need where context_id = p_context and closed_at is null)) then\n"
                "    raise exception 'report_private_context: the retention period has not expired' using errcode = '55000';\n  end if;\n")
REASON_GUARD = ("  if p_reason is null or p_reason not in ('retention_expired', 'verified_privacy_request', 'legal_requirement') then\n"
                "    raise exception 'report_private_context: unknown purge reason' using errcode = '22023';\n  end if;\n")
ALREADY_PURGED = ("  if c.state = 'purged' then\n    return false;                            -- already purged: idempotent, and it writes nothing more\n  end if;\n")
PURGE_EVENT = "  insert into public.report_private_context_event (context_id, kind, reason) values (p_context, 'purged', p_reason);\n"
DUE_SCAN = "where state = 'active' and purge_due_at is not null and purge_due_at <= now() order by purge_due_at loop"
TRG_CTX = ("create or replace trigger report_private_context_no_delete_or_reopen\n  before update or delete on public.report_private_context\n"
           "  for each row execute function public.report_private_context_guard();")
TRG_EVT = ("create or replace trigger report_private_context_event_no_change\n  before update or delete on public.report_private_context_event\n"
           "  for each row execute function public.report_private_context_event_immutable();")
TRG_EVT_TRUNC = ("create or replace trigger report_private_context_event_no_truncate\n  before truncate on public.report_private_context_event\n"
                 "  for each statement execute function public.report_private_context_event_immutable();")
TRG_NEED = ("create or replace trigger report_private_context_need_only_close\n  before update or delete on public.report_private_context_need\n"
            "  for each row execute function public.report_private_context_need_guard();")
TRG_NEED_TRUNC = ("create or replace trigger report_private_context_need_no_truncate\n  before truncate on public.report_private_context_need\n"
                  "  for each statement execute function public.report_private_context_need_guard();")
UNKNOWN_KEYS = ("  select k into v_bad from jsonb_object_keys(p_private) k\n"
                "   where k not in ('address', 'normalized_address', 'latitude', 'longitude', 'property_keys', 'label') limit 1;\n"
                "  if v_bad is not null then\n"
                "    raise exception 'report_private_context: unknown field \"%\" (allowed: address, normalized_address, latitude, longitude, property_keys, label)', v_bad using errcode = '22023';\n"
                "  end if;\n")
ADDR_GUARD = ("  if v_addr is null then\n    raise exception 'report_private_context: an address is required' using errcode = '23514';\n  end if;\n")
FIRST_NEED = "  insert into public.report_private_context_need (context_id, kind, ref) values (v_id, p_need_kind, p_need_ref);\n"
CREATED_EVENT = "  insert into public.report_private_context_event (context_id, kind) values (v_id, 'created');\n"
EVENT_REASON_CK = (",\n  constraint report_private_context_event_reason check (reason is null or reason in ('retention_expired', 'verified_privacy_request', 'legal_requirement'))\n);")
POINT_CK = ("  constraint report_private_context_point check ((latitude is null) = (longitude is null)\n"
            "    and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))),\n")
NEED_KIND_CK = "  constraint report_private_context_need_kind check (kind in ('report', 'follow', 'account')),\n"
ADDR_CK = "  constraint report_private_context_active_has_address check (state <> 'active' or (address is not null and btrim(address) <> '')),\n"
GRANT_EVT = "grant select on public.report_private_context_event to service_role;"
CREATE_HEAD = "language plpgsql security definer set search_path = public, pg_temp\nas $$\ndeclare\n  v_id   uuid;"
READ_HEAD = "language sql security definer set search_path = public, pg_temp\nas $$\n  select c.state, c.address"
LOCK_REVOKE = "execute format('revoke all on function %s from public, anon, authenticated', f.sig);"
NEED_GUARD_IF = "  if tg_op = 'UPDATE' and old.closed_at is null and new.closed_at is not null"
IDENTITY_GUARD = ("    if new.context_id <> old.context_id or new.created_at <> old.created_at then\n"
                  "      raise exception 'report_private_context: identity columns cannot change';\n    end if;\n")
DELETE_RAISE = "  raise exception 'report_private_context rows are purged in place, never deleted (% refused)', tg_op;"

MUTATIONS = {
    # ---- the 90 days, and the clock ----------------------------------------------------------
    'grace_is_91_days': [(GRACE, "language sql immutable as $$ select interval '91 days' $$;", 1)],
    'grace_is_89_days': [(GRACE, "language sql immutable as $$ select interval '89 days' $$;", 1)],
    'no_ceiling_constraint': [(CEILING, "\n);", 1)],
    'clock_never_starts': [(CLOCK_SET, "set last_needed_at = now(), purge_due_at = null", 1)],
    'clock_starts_while_still_needed': [(CLOSE_IF, "  if true then", 1)],
    'clock_runs_from_creation': [(CLOCK_SET, "set purge_due_at = created_at + public.report_private_context_grace()", 1)],
    'reopening_keeps_the_clock': [(OPEN_CLEARS, "update public.report_private_context set last_needed_at = now() where context_id = p_context;", 1)],
    'noop_close_restarts_the_clock': [(NOOP_CLOSE, "", 1)],
    'open_is_not_idempotent': [(OPEN_IDEMPOTENT, "", 1)],
    # ---- what a purge removes and records ------------------------------------------------------
    'purge_keeps_the_address': [(PURGE_SET1, "     set state = 'purged', normalized_address = null, latitude = null, longitude = null,\n", 1),
                                (EMPTY_CHECK, EMPTY_CHECK.replace("address is null and normalized_address is null", "normalized_address is null", 1), 1)],
    'purge_keeps_the_coordinates': [(PURGE_SET1, "     set state = 'purged', address = null, normalized_address = null,\n", 1),
                                    (EMPTY_CHECK, EMPTY_CHECK.replace(" and latitude is null and longitude is null", "", 1), 1)],
    'purge_keeps_label_and_keys': [(PURGE_SET2, "         purge_due_at = null, purged_at = now(), purge_reason = p_reason\n", 1),
                                   (EMPTY_CHECK, EMPTY_CHECK.replace("    and property_keys is null and label is null and purge_due_at is null\n", "    and purge_due_at is null\n", 1), 1)],
    'purge_records_the_wrong_reason': [("purged_at = now(), purge_reason = p_reason", "purged_at = now(), purge_reason = 'retention_expired'", 1)],
    'purge_is_not_logged': [(PURGE_EVENT, "", 1)],
    'purge_leaves_needs_open': [(CLOSE_CTE, "", 1)],
    'purge_not_idempotent': [(ALREADY_PURGED, "", 1)],
    # ---- when a purge is allowed ---------------------------------------------------------------------
    'no_expiry_guard': [(EXPIRY_GUARD, "", 1)],
    'purge_due_early_without_a_guard': [(EXPIRY_GUARD, "", 1),
                                        (DUE_SCAN, "where state = 'active' and purge_due_at is not null and purge_due_at <= now() + interval '100 days' order by purge_due_at loop", 1)],
    'privacy_request_waits_for_the_clock': [("  if p_reason = 'retention_expired'\n     and (", "  if p_reason in ('retention_expired', 'verified_privacy_request')\n     and (", 1)],
    'any_reason_accepted': [(REASON_GUARD, "", 1),
                            ("  constraint report_private_context_reason check (purge_reason is null or purge_reason in ('retention_expired', 'verified_privacy_request', 'legal_requirement')),\n", "", 1)],
    'purged_is_not_terminal': [(TRG_CTX, "select 1;", 1)],
    'need_opens_on_a_purged_context': [(OPEN_ON_PURGED, "", 1)],
    # ---- history is never rewritten --------------------------------------------------------------------
    'context_row_can_be_deleted': [(DELETE_RAISE, "  return old;", 1)],
    'context_identity_can_change': [(IDENTITY_GUARD, "", 1)],
    'events_can_be_edited': [(TRG_EVT, "select 1;", 1)],
    'events_can_be_truncated': [(TRG_EVT_TRUNC, "select 1;", 1)],
    'needs_can_be_edited': [(TRG_NEED, "select 1;", 1)],
    'needs_can_be_truncated': [(TRG_NEED_TRUNC, "select 1;", 1)],
    'a_closed_need_can_reopen': [(NEED_GUARD_IF, "  if tg_op = 'UPDATE' and new.closed_at is distinct from old.closed_at", 1)],
    # ---- what may be stored ------------------------------------------------------------------------------
    'unknown_fields_are_stored': [(UNKNOWN_KEYS, "", 1)],
    'no_address_required': [(ADDR_GUARD, "", 1), (ADDR_CK, "", 1)],
    'coordinates_unchecked': [(POINT_CK, "", 1)],
    'need_kind_unchecked': [(NEED_KIND_CK, "", 1)],
    'create_opens_no_need': [(FIRST_NEED, "", 1)],
    'audit_log_holds_the_address': [(CREATED_EVENT, "  insert into public.report_private_context_event (context_id, kind, reason) values (v_id, 'created', v_addr);\n", 1),
                                    (EVENT_REASON_CK, "\n);", 1)],
    # ---- the audit check ----------------------------------------------------------------------------------
    'check_blind_to_a_clock_beside_a_need': [("    where c.purge_due_at is not null\n      and exists", "    where false\n      and exists", 1)],
    'check_blind_to_an_unneeded_context': [("    where c.state = 'active' and c.purge_due_at is null\n      and not exists", "    where false and c.purge_due_at is null\n      and not exists", 1)],
    'check_blind_to_a_missing_purge_event': [("    where c.state = 'purged' and not exists (select 1 from public.report_private_context_event e", "    where false and not exists (select 1 from public.report_private_context_event e", 1)],
    'check_blind_to_overdue': [("    where c.state = 'active' and c.purge_due_at is not null and c.purge_due_at <= now()", "    where false", 1)],
    'check_has_no_control': [("select 'contexts_total'::text, 'control'::text, count(*) from public.report_private_context", "select 'contexts_total'::text, 'control'::text, 0::bigint", 1)],
    # ---- lock-down -------------------------------------------------------------------------------------------
    'no_rls_on_the_private_table': [("alter table public.report_private_context       enable row level security;", "select 1;", 1)],
    'no_rls_on_the_log': [("alter table public.report_private_context_event enable row level security;", "select 1;", 1)],
    'private_table_default_grants': [("revoke all on public.report_private_context        from public, anon, authenticated, service_role;", "select 1;", 1)],
    'need_table_default_grants': [("revoke all on public.report_private_context_need   from public, anon, authenticated, service_role;", "select 1;", 1)],
    'anon_can_read_the_log': [(GRANT_EVT, GRANT_EVT + "\ngrant select on public.report_private_context_event to anon;", 1)],
    'authenticated_can_read_the_log': [(GRANT_EVT, GRANT_EVT + "\ngrant select on public.report_private_context_event to authenticated;", 1)],
    'service_role_can_read_the_private_table': [(GRANT_EVT, GRANT_EVT + "\ngrant select on public.report_private_context to service_role;", 1)],
    'service_role_can_write_the_log': [(GRANT_EVT, "grant select, insert on public.report_private_context_event to service_role;", 1)],
    'functions_unlocked': [(LOCK_REVOKE, "execute format('select 1 /* %s */', f.sig);", 1)],
    'create_not_security_definer': [(CREATE_HEAD, "language plpgsql set search_path = public, pg_temp\nas $$\ndeclare\n  v_id   uuid;", 1)],
    'read_search_path_unpinned': [(READ_HEAD, "language sql security definer\nas $$\n  select c.state, c.address", 1)],
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
