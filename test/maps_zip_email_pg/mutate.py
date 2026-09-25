#!/usr/bin/env python3
"""Emit a MUTATED copy of a shipped migration on stdout, for run.sh.

Each mutation is a prohibited change the suite must kill. A mutation whose anchor is
not found exits 2: a mutation that does not apply is a HARNESS failure, never a pass
(a no-op mutation "survives" by construction and would read as a weak suite).

    mutate.py NAME FILE        # one mutation
    mutate.py --pg16 FILE      # the PostgreSQL 16 shim only (see below)
"""
import re
import sys

A12 = "a12"
DELIVERY = "delivery"

# name -> (which file, anchor regex, replacement). Anchors are exact enough to match once.
MUTATIONS = {
    # a12 -----------------------------------------------------------------------
    "subscriptions-forget-maps": (A12,
        r"(add constraint user_subscriptions_stream_ck\s*\n\s*check \(stream = any \(array\['notices','meetings','news','global','emerging'),'maps'\]",
        r"\1]"),
    "zip-scope-guard-not-installed": (A12,
        r"create trigger user_subscriptions_maps_zip_scoped\n(?:.*\n){2}", ""),
    "pipeline-type-null-for-maps": (A12,
        r"\n\s*when 'maps'\s+then 'maps'", ""),
    "maps-tap-grants-marketing": (A12,
        r"v_marketing boolean := coalesce\(p_marketing_consent, true\);",
        "v_marketing boolean := true;"),
    "false-tap-revokes-marketing": (A12,
        r"marketing_consent\s+= coalesce\(public\.users\.marketing_consent, false\) or v_marketing,",
        "marketing_consent = v_marketing,"),
    "writer-becomes-delete-to-match": (A12,
        r"(  -- ADDITIVE: promote the floor)",
        "  delete from public.user_subscriptions s where s.user_id = v_user_id\n"
        "     and s.community_id = p_community_id and s.origin = 'explicit'\n"
        "     and not exists (select 1 from public.expand_alert_topics(p_topics) d\n"
        "                      where d.stream = s.stream and d.topic = s.topic);\n\\1"),
    "old-overload-kept": (A12,
        r"drop function if exists public\.enable_area_email_alerts\(text, uuid, text, jsonb, text, text\);\n",
        ""),
    "referral-last-touch-wins": (A12,
        r"referral_source\s+= coalesce\(public\.users\.referral_source, excluded\.referral_source\),",
        "referral_source = excluded.referral_source,"),
    "integrity-view-not-appended": (A12,
        r"if position\('maps_zip_scope_trigger' in v_def\) > 0 then",
        "if true then"),
    # delivery ------------------------------------------------------------------
    "ledger-forgets-social-post": (DELIVERY,
        r"array\['alert','meeting','social_post'\]", "array['alert','meeting']"),
    "claim-streams-not-scoped-to-identity": (DELIVERY,
        r"where s\.user_id = v_user\.id\n\s*and s\.community_id = v_user\.community_id",
        "where true"),
    "claim-opened-to-public": (DELIVERY,
        r"revoke all on function public\.alert_confirmation_claim\(uuid\) from public, anon, authenticated;\n",
        ""),
}

SET_EXPRESSION = re.compile(
    r"alter table public\.user_subscriptions alter column pipeline_type set expression as \((.*?)\);",
    re.S)


def pg16_shim(sql):
    """PostgreSQL 16 has no ALTER COLUMN ... SET EXPRESSION (added in 17; production is
    17.6). For a LOCAL run on 16 only, rewrite that one statement into the equivalent
    drop + re-add of the generated column, keeping the expression byte for byte. CI runs
    the suite on postgres:17, where the shipped statement runs unmodified."""
    m = SET_EXPRESSION.search(sql)
    if not m:
        return sql
    expr = m.group(1)
    repl = ("alter table public.user_subscriptions drop column pipeline_type;\n"
            "alter table public.user_subscriptions add column pipeline_type text "
            f"generated always as ({expr}) stored;")
    return sql[:m.start()] + repl + sql[m.end():]


def main(argv):
    if len(argv) == 3 and argv[1] == "--pg16":
        sys.stdout.write(pg16_shim(open(argv[2], encoding="utf-8").read()))
        return 0
    if len(argv) != 3 or argv[1] not in MUTATIONS:
        sys.stderr.write("usage: mutate.py NAME FILE | --pg16 FILE\n")
        return 2
    _, anchor, repl = MUTATIONS[argv[1]]
    src = open(argv[2], encoding="utf-8").read()
    out, n = re.subn(anchor, repl, src, count=1)
    if n != 1 or out == src:
        sys.stderr.write(f"anchor not found for {argv[1]}\n")
        return 2
    sys.stdout.write(out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
