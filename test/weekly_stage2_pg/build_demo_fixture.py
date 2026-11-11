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


def q(t):
    return "'" + str(t).replace("'", "''") + "'"


def sql(e, parts=("research", "copy", "draft", "cue", "title")):
    """The demonstration as psql input. `parts` lets homesignal-ingest's Level A test seed only the research and draft parts
    here and then run the copy and the cue through the real engine commands instead of these recorded stand-ins."""
    dc = e["doc_cue"]
    f = e["findings"]
    findings = [{"finding_key": x["claim_id"].split("@")[0], "statement": x["statement"], "qualifiers": x["qualifiers"],
                 "uncertainty": x["uncertainty"], "scope": x["scope"], "source_refs": ["s%d" % i] if x["quotes"] else []}
                for i, x in enumerate(f)]
    sources = [{"ref": "s%d" % i, "url": "https://example.test/source-%d" % i, "publisher": "TEST Publisher", "title": "TEST page",
                "quote": x["quotes"][0], "retrieved_at": "2026-11-10T12:00:00Z", "content_sha256": "ab", "quote_match": "exact",
                "date_extraction": "not_stated"} for i, x in enumerate(f) if x["quotes"]]
    # the source behind the cue's finding is the real EPA proposed rule; it gets its stored copy the way production would:
    # a person's grant, a source_copy run, the object in (stand-in) private storage, then the database's record step
    for src, x in zip(sources, [x for x in f if x["quotes"]]):
        if x["claim_id"] == dc["cue"]["claim_id"]:
            src.update(url=dc["document"]["url"], title=dc["document"]["label"], publisher="U.S. EPA (Federal Register)")
    dsha, dsize = dc["document"]["sha256"], dc["document"].get("size") or 1
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
    lines = [
        "\\set ON_ERROR_STOP 1",
        "-- PART research",
        "select set_config('test.jwt', %s, false);" % ("'" + ADMIN + "'"),
        "set role authenticated;",
        "select public.hs_weekly_request_research('Air Quality', 'TEST DATA: research the October 2026 EPA proposal (fixture)') as req \\gset",
        "select (public.hs_weekly_paste_answer(:'req', 'TEST DATA pasted answer') ->> 'run_id') as r1 \\gset",
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'r1') is not null as c \\gset",
        "select public.weekly_research_record(:'r1', %s);" % lit({"sources": sources, "findings": findings}),
        "-- PART copy",
        "reset role;",
        "select id as dsrc from public.weekly_sources where url = %s \\gset" % q(dc["document"]["url"]),
        "set role authenticated;",
        "select (public.hs_weekly_source_copy_grant(:'dsrc', 'pdf', 'TEST DATA: a U.S. government record, kept as a full copy') ->> 'run_id') as rc \\gset",
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'rc') is not null as c \\gset",
        "reset role;",
        "insert into storage.objects (bucket_id, name, metadata) values ('weekly-sources', :'dsrc' || '/' || %s || '.pdf', %s);"
        % (q(dsha), q(json.dumps({"size": dsize}))),
        "set role service_role;",
        "select public.weekly_source_copy_record(:'rc', jsonb_build_object('source_id', :'dsrc', 'document_sha256', %s, 'document_kind', 'pdf', 'size', %d,"
        " 'document_path', 'weekly-sources/' || :'dsrc' || '/' || %s || '.pdf', 'quote_match', 'found')) is not null as c \\gset" % (q(dsha), dsize, q(dsha)),
        "-- PART draft",
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
        "-- PART cue",
        # A document cue on segment 0 of version 2: a person sets the cue on the stored source of air-proposal-status@1, and
        # the visual_check run records the engine's own result (homesignal-ingest weekly_slice/doc_cue.py on that PDF).
        "select fs.source_id as src0 from public.weekly_finding_sources fs join public.weekly_findings f on f.id = fs.finding_id"
        " where f.finding_key || '@' || f.version = %s \\gset" % q(dc["cue"]["claim_id"]),
        "select (v ->> 'id') as s2 from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'versions') v"
        " where v ->> 'stage' = 'script' and not (v -> 'status' ->> 'superseded')::boolean \\gset",
        "set role authenticated;",
        "select public.hs_weekly_doc_cue_set(:'s2', %d, jsonb_build_object('type', 'doc', 'claim_id', %s, 'source_id', :'src0', 'page', %d,"
        " 'quote', %s, 'highlight', 'yellow')) as cue \\gset" % (dc["segment_index"], q(dc["cue"]["claim_id"]), dc["cue"]["page"], q(dc["cue"]["quote"])),
        "reset role;",
        "select (:'cue'::jsonb ->> 'run_id') as vr, (:'cue'::jsonb ->> 'script_version') as s3 \\gset",
        "select body_sha256 as s3sha from public.weekly_scripts where id = :'s3' \\gset",
        "set role service_role;",
        "select public.weekly_run_claim(:'vr') is not null as c \\gset",
        "select public.weekly_visual_check_record(:'vr', :'s3sha', replace(replace(%s, 'SOURCE_ID', :'src0'), 'VERSION_ID', :'s3')::jsonb);"
        % q(json.dumps(dc["checks"], ensure_ascii=False)),
        "reset role;",
        "-- PART title",
        # the Air title: wording approved IN A CONVERSATION, recorded here by the test identity as fixture data only;
        # its mechanical checks are recorded; the evidence review and publication are left undone.
        "select (v ->> 'id') as s2 from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'versions') v"
        " where v ->> 'stage' = 'script' and not (v -> 'status' ->> 'superseded')::boolean \\gset",
        "set role authenticated;",
        "select public.hs_weekly_profile_create(%s, 'title') as tpf \\gset" % lit(e["title"]["profile"]),
        "select (public.hs_weekly_title_propose(:'s2', %s, :'tpf') ->> 'run_id') as tcr \\gset" % lit(e["title"]["candidates"]),
        "select (v ->> 'id') as t1 from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'versions') v where v ->> 'stage' = 'title' \\gset",
        "select public.hs_weekly_title_decide(:'t1', 0, 'approved', 'FIXTURE: approved by the founder in a conversation on 2026-11-10; not a dashboard action');",
        "reset role;",
        "select body_sha256 as tsha from public.weekly_scripts where id = :'t1' \\gset",
        "set role service_role;",
        "select public.weekly_run_claim(:'tcr') is not null as c \\gset",
        "select public.weekly_title_check_record(:'tcr', :'tsha', %s);" % lit(e["title"]["checks"]),
        "-- PART tail",
        "reset role;",
        "select set_config('test.jwt', %s, false);" % ("'" + ADMIN + "'"),
        "\\pset tuples_only on", "\\pset format unaligned",
        "select public.hs_weekly_overview('Air Quality')::text;"]
    out, part = [], "head"
    for ln in lines:
        if ln.startswith("-- PART "):
            part = ln[len("-- PART "):]
            continue
        if part in ("head", "tail") or part in parts:
            out.append(ln)
    return "\n".join(out)


UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
SHA = re.compile(r'("body_sha256": ")([0-9a-f]{64})"')
TS = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z)")


def normalize(o):
    toks, s = {}, json.dumps(o, sort_keys=True, ensure_ascii=False)
    s = UUID.sub(lambda m: toks.setdefault(m.group(0), "id-%02d" % (len(toks) + 1)), s)
    # a cue version's text holds a source id, so its hash differs on every build: hashes become stable tokens too
    # (equal hashes stay equal, so "approved on this exact text" is still visible in the fixture)
    s = SHA.sub(lambda m: m.group(1) + toks.setdefault(m.group(2), "sha-%02d" % (len(toks) + 1)) + '"', s)
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
