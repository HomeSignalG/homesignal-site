#!/usr/bin/env python3
"""Prohibited mutations of docs/da-owner-safeguards.sql. Each MUST fail >= 1 NAMED check of test/da_owner_safeguards_pg/suite.sql, or of the real-session
scenarios in run.sh, or (kind 'postcondition') must STOP the apply. A mutation that only crashes the suite is reported by mutate_all.sh and fails the run.

Usage: mutate.py --list            -> one mutation name per line
       mutate.py --kind NAME       -> suite | postcondition
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent or matches the wrong number of times
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply.
"""
import sys

ROLLBACK_MARK = "-- ROLLBACK (this file only"
POST_MARK = "-- ---- POST-CONDITION"


def append(text):
    """A statement added AFTER the post-condition (what a later migration could do)."""
    return [(ROLLBACK_MARK, text + "\n" + ROLLBACK_MARK, 1)]


def before_post(text):
    """A statement added BEFORE the post-condition (the post-condition must then refuse the apply)."""
    return [(POST_MARK, text + "\n" + POST_MARK, 1)]


MUTATIONS = {
    # ---- A. the team: the listing
    "team_lists_owners": ("suite", [("where m.brokerage_id = v_actor.brokerage_id and m.status = 'active' and m.role = 'agent'", "where m.brokerage_id = v_actor.brokerage_id and m.status = 'active'", 1)]),
    "team_lists_every_brokerage": ("suite", [("where m.brokerage_id = v_actor.brokerage_id and m.status = 'active' and m.role = 'agent'", "where m.status = 'active' and m.role = 'agent'", 1)]),
    "team_shows_the_whole_email": ("suite", [("else left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2) end", "else u.email end", 1)]),
    "team_lists_closed_invites": ("suite", [("and i.status = 'open' and i.expires_at > now() and i.role = 'agent'", "and i.expires_at > now() and i.role = 'agent'", 1)]),
    "team_lists_expired_invites": ("suite", [("and i.status = 'open' and i.expires_at > now() and i.role = 'agent'", "and i.status = 'open' and i.role = 'agent'", 1)]),
    "team_lists_owner_invites": ("suite", [("and i.status = 'open' and i.expires_at > now() and i.role = 'agent'", "and i.status = 'open' and i.expires_at > now()", 1)]),
    "team_lists_other_brokerages_invites": ("suite", [("where e.brokerage_id = v_actor.brokerage_id and i.status = 'open'", "where i.status = 'open'", 1)]),
    "team_open_to_agents": ("suite", [("  if not found or v_actor.role <> 'owner' then\n    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';\n  end if;\n  return query",
                                       "  if not found then\n    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';\n  end if;\n  return query", 1)]),
    "team_open_to_everyone": ("suite", [("  if not found or v_actor.role <> 'owner' then\n    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';\n  end if;\n  return query",
                                         "  return query", 1)]),
    # ---- A. the removal
    "remove_across_brokerages": ("suite", [("v_actor.brokerage_id <> mem.brokerage_id or ", "", 1)]),
    "remove_by_an_agent": ("suite", [("if not found or v_actor.role <> 'owner' or v_actor.brokerage_id", "if not found or v_actor.brokerage_id", 1)]),
    "remove_an_owner": ("suite", [(" or v_actor.brokerage_id <> mem.brokerage_id or mem.role <> 'agent' then", " or v_actor.brokerage_id <> mem.brokerage_id then", 1)]),
    "remove_unknown_is_quiet": ("suite", [("  select m.* into mem from public.brokerage_member m where m.id = p_member_id for update;\n  if not found then\n    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';\n  end if;",
                                           "  select m.* into mem from public.brokerage_member m where m.id = p_member_id for update;\n  if not found then\n    return false;\n  end if;", 1)]),
    "remove_twice_reports_true": ("suite", [("  if mem.status <> 'active' then\n    return false;\n  end if;\n", "", 1)]),
    "remove_deletes_the_row": ("suite", [("update public.brokerage_member set status = 'deactivated' where id = mem.id;", "delete from public.brokerage_member where id = mem.id;", 1)]),
    "remove_does_not_end_the_membership": ("suite", [("update public.brokerage_member set status = 'deactivated' where id = mem.id;", "null;", 1)]),
    "remove_without_a_row_lock": ("suite", [("from public.brokerage_member m where m.id = p_member_id for update;", "from public.brokerage_member m where m.id = p_member_id;", 1)]),
    "remove_no_isolation_guard": ("suite", [("  if current_setting('transaction_isolation') <> 'read committed' then\n    raise exception 'brokerage_member_remove: needs READ COMMITTED", "  if false then\n    raise exception 'brokerage_member_remove: needs READ COMMITTED", 1)]),
    # ---- B. the client link rate limit
    "client_minute_limit_changed": ("suite", [("values ('client', 60, 30)", "values ('client', 60, 31)", 1)]),
    "link_minute_limit_changed": ("suite", [("('link', 60, 120)", "('link', 60, 121)", 1)]),
    "hour_window_dropped": ("postcondition", [("('client', 3600, 300), ", "", 1)]),
    "share_refusal_still_counts": ("suite", [("    return query select false, v_worst, v_scope, v_win;\n    return;\n  end if;\n\n  -- 2. take one", "    return query select false, v_worst, v_scope, v_win;\n  end if;\n\n  -- 2. take one", 1)]),
    "share_off_by_one": ("suite", [("if coalesce(v_used, 0) >= l.max_requests then\n      v_wait := greatest(1, ceil(extract(epoch from (v_start + l.window_secs * interval '1 second' - p_at)))::integer);\n      if v_wait > v_worst then v_worst := v_wait; v_scope := l.bucket; v_win := l.window_secs; end if;\n    end if;\n  end loop;\n\n  -- a refusal consumes nothing",
                                    "if coalesce(v_used, 0) > l.max_requests then\n      v_wait := greatest(1, ceil(extract(epoch from (v_start + l.window_secs * interval '1 second' - p_at)))::integer);\n      if v_wait > v_worst then v_worst := v_wait; v_scope := l.bucket; v_win := l.window_secs; end if;\n    end if;\n  end loop;\n\n  -- a refusal consumes nothing", 1)]),
    "share_link_never_limited": ("suite", [("v_subject := case l.bucket when 'client' then p_client else p_link end;", "v_subject := case l.bucket when 'client' then p_client else null end;", 2)]),
    "share_client_keyed_on_the_link": ("suite", [("v_subject := case l.bucket when 'client' then p_client else p_link end;", "v_subject := case l.bucket when 'client' then coalesce(p_link, p_client) else p_link end;", 2)]),
    "share_window_never_rolls_over": ("suite", [("      set used         = case when w.window_start >= excluded.window_start then w.used + 1 else 1 end,\n          window_start = greatest(w.window_start, excluded.window_start);\n  end loop;\n\n  -- 3.", "      set used         = w.used + 1,\n          window_start = greatest(w.window_start, excluded.window_start);\n  end loop;\n\n  -- 3.", 1)]),
    "share_shortest_wait_reported": ("suite", [("if v_wait > v_worst then v_worst := v_wait; v_scope := l.bucket; v_win := l.window_secs; end if;", "if v_worst = 0 or v_wait < v_worst then v_worst := v_wait; v_scope := l.bucket; v_win := l.window_secs; end if;", 1)]),
    "share_no_housekeeping": ("suite", [("  delete from public.share_view_window d\n   where d.ctid in (select w.ctid from public.share_view_window w where w.window_start < p_at - interval '2 days' order by w.window_start limit 25);\n", "", 1)]),
    "share_housekeeping_eats_young_rows": ("suite", [("where w.window_start < p_at - interval '2 days' order by", "where w.window_start < p_at order by", 1)]),
    "share_no_advisory_locks": ("suite", [("  perform pg_advisory_xact_lock(hashtextextended('share_view|client|' || p_client, 0));\n  if p_link is not null then\n    perform pg_advisory_xact_lock(hashtextextended('share_view|link|' || p_link, 0));\n  end if;\n", "", 1)]),
    "share_no_isolation_guard": ("suite", [("  if current_setting('transaction_isolation') <> 'read committed' then\n    raise exception using errcode = '55000', message = 'SHARE_VIEW_CLAIM_NEEDS_READ_COMMITTED';", "  if false then\n    raise exception using errcode = '55000', message = 'SHARE_VIEW_CLAIM_NEEDS_READ_COMMITTED';", 1)]),
    "share_any_subject_accepted": ("suite", [("  if p_client is null or p_at is null or p_client !~ '^[0-9a-f]{32,64}$' or (p_link is not null and p_link !~ '^[0-9a-f]{32,64}$') then", "  if p_client is null or p_at is null then", 1)]),
    "share_table_takes_any_subject": ("suite", [("  constraint share_view_window_subject check (subject ~ '^[0-9a-f]{32,64}$'),\n", "", 1)]),
    "share_table_keeps_an_address": ("suite", [("  used          integer     not null,\n  constraint share_view_window_pkey", "  used          integer     not null,\n  address       text,\n  constraint share_view_window_pkey", 1)]),
    "share_wrapper_uses_a_fixed_clock": ("suite", [("select * from public.share_view_claim_at(p_client, p_link, now())", "select * from public.share_view_claim_at(p_client, p_link, '2000-01-01 00:00:00+00'::timestamptz)", 1)]),
    # ---- C. one open checkout
    "checkout_never_busy": ("suite", [("  if found and c.claimed_at > p_at - interval '10 minutes' then\n    return query select 'BUSY'::text;\n    return;\n  end if;\n", "", 1)]),
    "checkout_stores_an_address": ("suite", [("  claimed_at   timestamptz not null\n);", "  claimed_at   timestamptz not null,\n  url          text\n);", 1)]),
    "checkout_busy_for_longer": ("suite", [("c.claimed_at > p_at - interval '10 minutes'", "c.claimed_at > p_at - interval '11 minutes'", 1)]),
    "checkout_busy_forever": ("suite", [("c.claimed_at > p_at - interval '10 minutes'", "c.claimed_at > p_at - interval '2 years'", 1)]),
    "checkout_release_never_frees": ("suite", [("delete from public.billing_checkout_claim where brokerage_id = p_brokerage;", "delete from public.billing_checkout_claim where brokerage_id = p_brokerage and false;", 1)]),
    "checkout_no_advisory_lock": ("suite", [("  perform pg_advisory_xact_lock(hashtextextended('billing_checkout|' || p_brokerage::text, 0));\n", "", 1)]),
    "checkout_for_a_closed_brokerage": ("suite", [("  if not exists (select 1 from public.brokerage_account a where a.id = p_brokerage and a.status = 'active') then\n    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';\n  end if;\n", "", 1)]),
    "checkout_no_isolation_guard": ("suite", [("  if current_setting('transaction_isolation') <> 'read committed' then\n    raise exception using errcode = '55000', message = 'CHECKOUT_CLAIM_NEEDS_READ_COMMITTED';", "  if false then\n    raise exception using errcode = '55000', message = 'CHECKOUT_CLAIM_NEEDS_READ_COMMITTED';", 1)]),
    "checkout_wrapper_uses_a_fixed_clock": ("suite", [("select * from public.billing_checkout_claim_at(p_brokerage, now())", "select * from public.billing_checkout_claim_at(p_brokerage, '2000-01-01 00:00:00+00'::timestamptz)", 1)]),
    # ---- access
    "team_granted_to_authenticated": ("suite", append("grant execute on function public.brokerage_team_of(uuid) to authenticated;")),
    "remove_granted_to_anon": ("suite", append("grant execute on function public.brokerage_member_remove(uuid, uuid) to anon;")),
    "share_claim_granted_to_anon": ("suite", append("grant execute on function public.share_view_claim(text, text) to anon;")),
    "checkout_claim_granted_to_authenticated": ("suite", append("grant execute on function public.billing_checkout_claim(uuid) to authenticated;")),
    "share_table_readable": ("suite", append("grant select on public.share_view_window to authenticated;")),
    "checkout_table_readable": ("suite", append("grant select on public.billing_checkout_claim to anon;")),
    "rls_turned_off_later": ("suite", append("alter table public.billing_checkout_claim disable row level security;")),
    "rls_never_enabled": ("postcondition", [("alter table public.share_view_window     enable row level security;\n", "", 1)]),
    "claim_open_to_a_resident_role_at_apply": ("postcondition", [("grant execute on function public.da_owner_safeguards_check()                    to service_role;\n",
                                                                    "grant execute on function public.da_owner_safeguards_check()                    to service_role;\ngrant execute on function public.share_view_claim(text, text) to authenticated;\n", 1)]),
    "remove_not_security_definer": ("suite", [("create or replace function public.brokerage_member_remove(p_actor uuid, p_member_id uuid) returns boolean\nlanguage plpgsql security definer", "create or replace function public.brokerage_member_remove(p_actor uuid, p_member_id uuid) returns boolean\nlanguage plpgsql", 1)]),
    # ---- the founder's numbers
    "free_limit_moved_before_the_postcondition": ("postcondition", before_post("create or replace function public.evaluation_report_limit() returns integer language sql immutable as $$ select 11 $$;")),
    "paid_limit_moved_after": ("suite", append("create or replace function public.billing_report_limit() returns integer language sql immutable as $$ select 101 $$;")),
    "report_rate_numbers_moved_after": ("suite", append("create or replace function public.report_rate_limits() returns table (bucket text, window_secs integer, max_requests integer) language sql immutable as $$ values ('user', 60, 11), ('user', 3600, 60), ('user', 86400, 200), ('brokerage', 60, 30), ('brokerage', 3600, 200), ('brokerage', 86400, 1000) $$;")),
    # ---- the audit
    "audit_blind_to_a_breach": ("suite", [("    join public.share_view_limits() l on l.bucket = w.bucket and l.window_secs = w.window_secs where w.used > l.max_requests", "    join public.share_view_limits() l on l.bucket = w.bucket and l.window_secs = w.window_secs where w.used > l.max_requests + 100000", 1)]),
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
