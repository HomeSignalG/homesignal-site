"""Build the workbench SCREEN fixture from the prepared SQL itself, on a disposable database (never production).

Reads test/fixtures/weekly-workbench-engine.json (the "Put the conflict first" demonstration exported by
homesignal-ingest `python -m tests.weekly_workbench_demo --json`), runs the real admin and service functions to reach the
state "version 2 written by the rewrite, not yet approved", and writes hs_weekly_overview's answer with ids and times
replaced by stable tokens to test/fixtures/weekly-workbench-overview.json. `--check` compares instead of writing.

    PGHOST=... PGDATABASE=... python3 test/weekly_stage2_pg/build_demo_fixture.py [--check]
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ENGINE = os.path.join(ROOT, "test", "fixtures", "weekly-workbench-engine.json")
OUT = os.path.join(ROOT, "test", "fixtures", "weekly-workbench-overview.json")
ADMIN = '{"email":"founder@test.invalid"}'


def lit(v):
    return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"


def sql(e):
    f = e["findings"]
    findings = [{"finding_key": x["claim_id"].split("@")[0], "statement": x["statement"], "qualifiers": x["qualifiers"],
                 "uncertainty": x["uncertainty"], "scope": x["scope"], "source_refs": ["s%d" % i] if x["quotes"] else []}
                for i, x in enumerate(f)]
    sources = [{"ref": "s%d" % i, "url": "https://example.test/source-%d" % i, "publisher": "TEST Publisher", "title": "TEST page",
                "quote": x["quotes"][0], "retrieved_at": "2026-11-10T12:00:00Z", "content_sha256": "ab", "quote_match": "exact",
                "date_extraction": "not_stated"} for i, x in enumerate(f) if x["quotes"]]
    ids = [x["claim_id"] for x in f]
    cards = [{"claim": "TEST DATA: EPA says the proposal keeps methane rules workable.", "category": c,
              "finding_ids": ids, "public_stakes": s, "editorial_position": p, "context": "TEST DATA: EPA's stated rationale; the change is proposed.",
              "evidence_limits": "TEST DATA: how often reports led to action is not established.", "opening": o, "why_different": w}
             for c, s, p, o, w in [
                 ("contradiction", "TEST DATA: residents near sites could lose an early warning.", "TEST DATA: the stated aim and the effect pull apart.",
                  "TEST DATA: A warning system for large leaks could go quiet.", "TEST DATA: leads with the residents' warning."),
                 ("public_interest", "TEST DATA: who reports a large release, and who hears about it.", "TEST DATA: explain the reporting chain plainly.",
                  "TEST DATA: Who tells EPA about a methane plume?", "TEST DATA: same evidence; opens on the mechanism, not the conflict."),
                 ("misleading_framing", "TEST DATA: what the $45 billion figure is and is not.", "TEST DATA: the headline number needs context.",
                  "TEST DATA: The figure is not a payment.", "TEST DATA: same evidence; the money framing comes first.")]]
    beats = [{"beat": b, "purpose": "TEST DATA: " + p, "finding_ids": i} for b, p, i in [
        ("collision", "the proposal and what residents could lose", [ids[0], ids[3]]),
        ("mechanism", "how third-party reports work today", [ids[2]]),
        ("landing", "proposed, not final", [ids[1]])]]
    ok = '{"ok": true, "label": "mechanical checks passed", "certifies_accuracy": false}'
    rv = e["review"]
    return "\n".join([
        "\\set ON_ERROR_STOP 1",
        "select set_config('test.jwt', %s, false);" % ("'" + ADMIN + "'"),
        "set role authenticated;",
        "select public.hs_weekly_request_research('Air Quality', 'TEST DATA: research the October 2026 EPA proposal (fixture)') as req \\gset",
        "select (public.hs_weekly_paste_answer(:'req', 'TEST DATA pasted answer') ->> 'run_id') as r1 \\gset",
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'r1') is not null as c \\gset",
        "select public.weekly_research_record(:'r1', %s);" % lit({"sources": sources, "findings": findings}),
        "reset role; set role authenticated;",
        "select public.hs_weekly_finding_decide((x ->> 'id')::uuid, 'approved') from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'findings') x;",
        "select (public.hs_weekly_library_seal('Air Quality') ->> 'library_version_id') as lv \\gset",
        "select public.hs_weekly_profile_create('[\"Keep qualifications and uncertainty.\", \"Attribute forecasts; distinguish proposed changes from final rules.\"]'::jsonb) as pf \\gset",
        "select public.hs_weekly_profile_approve(:'pf');",
        "select (public.hs_weekly_angles_request(:'lv', :'pf') ->> 'run_id') as ra \\gset",
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'ra') is not null as c \\gset",
        "select public.weekly_script_record(:'ra', jsonb_build_object('provider','claude-plan','prompt_sha256',repeat('3',64),'checks',%s::jsonb,'body',%s)) as ang \\gset"
        % ("'" + ok + "'", "jsonb_build_object('angles', " + lit(cards) + ")"),
        "reset role; set role authenticated;",
        "select public.hs_weekly_version_approve(:'ang', 0, null, false, 'TEST DATA: lead with the residents');",
        "select (public.hs_weekly_outline_request(:'ang') ->> 'run_id') as ro \\gset",
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'ro') is not null as c \\gset",
        "select public.weekly_script_record(:'ro', jsonb_build_object('provider','claude-plan','prompt_sha256',repeat('4',64),'checks',%s::jsonb,'body',%s)) as ol \\gset"
        % ("'" + ok + "'", "jsonb_build_object('beats', " + lit(beats) + ")"),
        "reset role; set role authenticated;",
        "select public.hs_weekly_version_approve(:'ol');",
        "select (public.hs_weekly_script_request(:'ol') ->> 'run_id') as rs \\gset",
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'rs') is not null as c \\gset",
        "select public.weekly_script_record(:'rs', jsonb_build_object('provider','claude-plan','prompt_sha256',repeat('5',64),'checks',%s,'body',%s)) as s1 \\gset"
        % (lit({k: v for k, v in e["before_checks"].items() if k != "lesson_assessments"}), lit(e["before_body"])),
        "reset role; set role authenticated;",
        "select (public.hs_weekly_passage_review(:'s1', %d, 'rewrite', %s, %s, %s, %s) ->> 'run_id') as rw \\gset" % (
            rv["segment_index"], "'" + rv["reason"].replace("'", "''") + "'", "'" + rv["action"] + "'",
            "array[" + ",".join("'%s'" % x for x in rv["finding_ids"]) + "]", "'" + rv["lesson_scope"] + "'"),
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'rw') is not null as c \\gset",
        "select public.weekly_script_record(:'rw', jsonb_build_object('provider','claude-plan','prompt_sha256',repeat('6',64),'checks',%s,'body',%s));"
        % (lit(e["after_checks"]), lit(e["after_body"])),
        "reset role;",
        "select set_config('test.jwt', %s, false);" % ("'" + ADMIN + "'"),
        "\\pset tuples_only on", "\\pset format unaligned",
        "select public.hs_weekly_overview('Air Quality')::text;"])


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TS = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)")


def normalize(o):
    toks, s = {}, json.dumps(o, sort_keys=True, ensure_ascii=False)
    s = UUID.sub(lambda m: toks.setdefault(m.group(0), "id-%02d" % (len(toks) + 1)), s)
    n = iter(range(10 ** 6))
    s = TS.sub(lambda m: "2026-11-10T12:%02d:00Z" % (next(n) % 60), s)
    return json.loads(s)


def main():
    e = json.load(open(ENGINE, encoding="utf-8"))
    out = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=sql(e), capture_output=True, text=True, check=True).stdout
    line = [l for l in out.splitlines() if l.startswith("{")][-1]
    o = normalize(json.loads(line))
    text = json.dumps(o, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        if open(OUT, encoding="utf-8").read() != text:
            sys.exit("the screen fixture differs from what the prepared SQL produces; rebuild it")
        print("screen fixture matches the prepared SQL")
    else:
        open(OUT, "w", encoding="utf-8").write(text)
        print("wrote", OUT)


if __name__ == "__main__":
    main()
