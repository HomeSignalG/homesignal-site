#!/usr/bin/env python3
"""Prohibited mutations of docs/report-share-delivery.sql. Each MUST fail >= 1 NAMED check of test/report_share_delivery_pg/suite.sql or
of the real-session scenarios in run.sh (a mutation that only crashes the suite is reported by run.sh and fails the run).

Usage: mutate.py --list            -> one mutation name per line
       mutate.py NAME FILE         -> the mutated SQL on stdout; exit 2 if an anchor is absent
Every anchor must match EXACTLY the stated number of times, so a mutation can never silently fail to apply (a mutation that does not
apply is indistinguishable from one that survives).

Where the SQL protects a rule twice, the mutation removes BOTH. The post-condition block at the foot of the file would refuse to apply a
file whose lock-down or lifetime had been weakened, so the mutations that weaken those either neutralise it too or add the weakening
AFTER it (the 'append' kind), which is exactly what a later migration could do.
"""
import sys

# ---- exact blocks of the file -----------------------------------------------------------------------------------
LIFETIME = "select interval '6 months' $$"
POST_LIFETIME = "  if public.report_share_lifetime() <> interval '6 months' then\n"
LIMIT = "select 25 $$"

OPEN_CHECK = "  if not exists (select 1 from public.evaluation_report_open(p_user_id, p_report_id)) then\n"
OWN_ONLY = ("  if not exists (select 1 from public.brokerage_membership_of(p_user_id) m\n"
            "                   join public.evaluation e on e.brokerage_id = m.brokerage_id\n"
            "                   join public.evaluation_credit c on c.evaluation_id = e.evaluation_id\n"
            "                  where c.report_id = p_report_id) then\n")
RC_BLOCK = ("  if current_setting('transaction_isolation') <> 'read committed' then\n"
            "    raise exception 'evaluation_report_share_create: needs READ COMMITTED (the per-report limit is counted after a lock that refreshes what the count sees only there; this transaction is %)',\n"
            "      current_setting('transaction_isolation') using errcode = '55000';\n"
            "  end if;\n")
LOCK = "  perform pg_advisory_xact_lock(hashtextextended('report_share:' || p_report_id::text, 0));\n"
CAP_BLOCK = ("  if (select count(*) from public.report_share s where s.report_id = p_report_id) >= public.report_share_limit() then\n"
             "    raise exception using errcode = 'EV007', message = 'SHARE_LIMIT_REACHED';\n"
             "  end if;\n")
CAP_CMP = ">= public.report_share_limit() then"
CAP_COUNT = "(select count(*) from public.report_share s where s.report_id = p_report_id) >="
CREATE_CALL = "  v_id := public.report_share_create(p_report_id, p_token_sha256, v_expires);\n"

LIST_JOINS = ("    join public.evaluation e on e.brokerage_id = m.brokerage_id\n"
              "    join public.evaluation_credit c on c.evaluation_id = e.evaluation_id\n"
              "    join public.report_share s on s.report_id = c.report_id\n"
              "    cross join lateral")
LIST_SELECT = "  select s.share_id, s.created_at, s.expires_at, s.revoked_at, r.status\n"
LIST_WHERE = "   where c.report_id = p_report_id\n   order by s.created_at desc, s.share_id\n"
LIST_HEAD = ("returns table (share_id uuid, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, status text)\n"
             "language sql stable security definer set search_path = public, pg_temp\n")

REVOKE_CHECK = ("  if not exists (\n"
                "    select 1\n"
                "      from public.brokerage_membership_of(p_user_id) m\n"
                "      join public.evaluation e on e.brokerage_id = m.brokerage_id\n"
                "      join public.evaluation_credit c on c.evaluation_id = e.evaluation_id\n"
                "      join public.report_share s on s.report_id = c.report_id\n"
                "     where s.share_id = p_share_id) then\n")
REVOKE_TAIL = "     where s.share_id = p_share_id) then\n"

OPEN_HEAD = ("returns table (report_id uuid, generated_at timestamptz, body text, private_context_id uuid, brokerage_name text)\n"
             "language sql stable security definer set search_path = public, pg_temp\n")
OPEN_JOINS = ("    join public.evaluation_credit c on c.report_id = s.report_id\n"
              "    join public.evaluation e on e.evaluation_id = c.evaluation_id\n"
              "    join public.brokerage_account a on a.id = e.brokerage_id\n"
              "   where r.status = 'ACTIVE' and e.status <> 'revoked' and a.status = 'active'\n")
OPEN_WHERE = "   where r.status = 'ACTIVE' and e.status <> 'revoked' and a.status = 'active'\n"

POST_STABLE = "                and p.proname in ('evaluation_report_shares_of', 'report_share_open', 'report_share_resolve') loop\n"
POST_DEFINER = "                and p.proname in ('evaluation_report_share_create', 'evaluation_report_shares_of', 'evaluation_report_share_revoke', 'report_share_open') loop\n"
ROLLBACK_MARK = "-- ROLLBACK (this file only"


def append(text):
    """A statement added AFTER the post-condition (what a later migration could do)."""
    return [(ROLLBACK_MARK, text + ROLLBACK_MARK, 1)]


MUTATIONS = {
    # ---- the lifetime ----------------------------------------------------------------------------------------
    'lifetime_twelve_months': [(LIFETIME, "select interval '12 months' $$", 1), (POST_LIFETIME, "  if false then\n", 1)],
    'lifetime_one_month': [(LIFETIME, "select interval '1 month' $$", 1), (POST_LIFETIME, "  if false then\n", 1)],
    'link_never_expires': [(CREATE_CALL, "  v_id := public.report_share_create(p_report_id, p_token_sha256, null);\n", 1)],
    'caller_chosen_expiry_ignored_lifetime': [(CREATE_CALL, "  v_id := public.report_share_create(p_report_id, p_token_sha256, now() + interval '10 years');\n", 1)],
    # ---- who may make a link ----------------------------------------------------------------------------------
    'create_no_ownership': [(OPEN_CHECK, "  if false then\n", 1)],
    'create_ownership_without_standing': [(OPEN_CHECK, OWN_ONLY, 1)],
    # ---- the cap ----------------------------------------------------------------------------------------------
    'no_cap': [(CAP_BLOCK, "", 1)],
    'cap_off_by_one': [(CAP_CMP, "> public.report_share_limit() then", 1)],
    'cap_ignores_revoked_links': [(CAP_COUNT, "(select count(*) from public.report_share s where s.report_id = p_report_id and s.revoked_at is null) >=", 1)],
    'cap_is_twenty_six': [(LIMIT, "select 26 $$", 1)],
    'cap_counts_every_report': [(CAP_COUNT, "(select count(*) from public.report_share s) >=", 1)],
    'no_lock_before_count': [(LOCK, "", 1)],
    'no_read_committed_guard': [(RC_BLOCK, "", 1)],
    # ---- the list ---------------------------------------------------------------------------------------------
    'list_not_owned': [(LIST_JOINS, "    join public.evaluation e on true\n"
                        "    join public.evaluation_credit c on c.evaluation_id = e.evaluation_id\n"
                        "    join public.report_share s on s.report_id = c.report_id\n    cross join lateral", 1)],
    'list_status_decided_here': [(LIST_SELECT, "  select s.share_id, s.created_at, s.expires_at, s.revoked_at,\n"
                                  "         case when s.revoked_at is not null then 'REVOKED' else 'ACTIVE' end\n", 1)],
    'list_returns_the_hash': [(LIST_HEAD, "returns table (share_id uuid, created_at timestamptz, expires_at timestamptz, revoked_at timestamptz, status text, token_sha256 text)\n"
                               "language sql stable security definer set search_path = public, pg_temp\n", 1),
                              (LIST_SELECT, "  select s.share_id, s.created_at, s.expires_at, s.revoked_at, r.status, s.token_sha256\n", 1)],
    'list_every_report': [(LIST_WHERE, "   order by s.created_at desc, s.share_id\n", 1)],
    'list_is_volatile': [(LIST_HEAD, LIST_HEAD.replace("language sql stable", "language sql"), 1),
                         (POST_STABLE, POST_STABLE.replace("'evaluation_report_shares_of', ", ""), 1)],
    # ---- the revoke -------------------------------------------------------------------------------------------
    'revoke_no_ownership': [(REVOKE_CHECK, "  if false then\n", 1)],
    'revoke_requires_standing': [(REVOKE_TAIL, "     where s.share_id = p_share_id and e.status = 'active' and (e.expires_at is null or e.expires_at > now())) then\n", 1)],
    # ---- the client read ----------------------------------------------------------------------------------------
    'open_survives_revoked_evaluation': [(OPEN_WHERE, "   where r.status = 'ACTIVE' and a.status = 'active'\n", 1)],
    'open_survives_suspended_account': [(OPEN_WHERE, "   where r.status = 'ACTIVE' and e.status <> 'revoked'\n", 1)],
    'open_requires_standing': [(OPEN_WHERE, "   where r.status = 'ACTIVE' and a.status = 'active'\n"
                                "     and (e.status = 'complete' or (e.status = 'active' and (e.expires_at is null or e.expires_at > now())))\n", 1)],
    'open_without_ledger': [(OPEN_JOINS, "    left join public.evaluation_credit c on c.report_id = s.report_id\n"
                             "    left join public.evaluation e on e.evaluation_id = c.evaluation_id\n"
                             "    left join public.brokerage_account a on a.id = e.brokerage_id\n"
                             "   where r.status = 'ACTIVE' and coalesce(e.status, '') <> 'revoked' and coalesce(a.status, 'active') = 'active'\n", 1)],
    'open_is_volatile': [(OPEN_HEAD, OPEN_HEAD.replace("language sql stable", "language sql"), 1),
                         (POST_STABLE, POST_STABLE.replace("'report_share_open', ", ""), 1)],
    'open_not_security_definer': [(OPEN_HEAD, OPEN_HEAD.replace(" security definer", ""), 1),
                                  (POST_DEFINER, POST_DEFINER.replace(", 'report_share_open'", ""), 1)],
    'open_names_the_context': [("  select s.report_id, s.generated_at, s.body, s.private_context_id, a.name\n",
                                "  select s.report_id, s.generated_at, s.body, s.private_context_id, a.name || ' ' || coalesce((select x.label from public.report_private_context x where x.context_id = s.private_context_id), '')\n", 1)],
    # ---- lock-down (added AFTER the post-condition, as a later migration could) ------------------------------------
    'grant_anon_open': append("grant execute on function public.report_share_open(text) to anon;\n"),
    'grant_authenticated_create': append("grant execute on function public.evaluation_report_share_create(uuid, uuid, text) to authenticated;\n"),
    'grant_public_lifetime': append("grant execute on function public.report_share_lifetime() to public;\n"),
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
