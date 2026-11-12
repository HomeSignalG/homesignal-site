"""Build the Tab 20 RENDER HANDOFF fixture from the prepared SQL itself, on a disposable database (never production).

It runs exactly the demonstration build_demo_fixture.py runs (its sql(), unchanged), with two additions:
  1. the visual_check run's claim (public.weekly_run_claim) is KEPT instead of discarded: that claim is what
     homesignal-ingest `python -m weekly_slice.render_bundle --claim` reads;
  2. a person (the TEST identity) approves version 3, the version carrying the document cue, through
     public.hs_weekly_version_approve, after its visual check is recorded, as the workbench's "Approve this exact version"
     does.
It then writes test/fixtures/weekly-render-handoff.json: {version_id, claim, overview}. Every value is TEST DATA. Ids and
hashes are the database's own (not tokens), so the render path can recompute the body hash; `--check` compares a fresh
build with ids, hashes and times replaced by tokens.

    PGHOST=... PGDATABASE=... python3 test/weekly_stage2_pg/build_render_handoff_fixture.py [--check]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_demo_fixture as demo  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, "test", "fixtures", "weekly-render-handoff.json")
RUBRIC = {"hook_conflict": 3, "human_stakes": 3, "emotional_force": 3, "argument_coherence": 3, "factual_discipline": 4,
          "spoken_clarity": 3, "closing": 3}
CLAIM_LINE = "select public.weekly_run_claim(:'vr') is not null as c \\gset"


def sql(e):
    s = demo.sql(e)
    if s.count(CLAIM_LINE) != 1:
        sys.exit("the demonstration no longer claims the visual_check run the way this builder expects")
    s = s.replace(CLAIM_LINE, "\\pset tuples_only on\n\\pset format unaligned\n"
                  "select 'CLAIM ' || public.weekly_run_claim(:'vr')::text;\n\\pset tuples_only off\n\\pset format aligned")
    approve = ("reset role;\nselect set_config('test.jwt', '%s', false);\nset role authenticated;\n"
               "select public.hs_weekly_version_approve(:'s3', null, %s, false, 'TEST DATA: approved in the local render harness');\n"
               "reset role;\n" % (demo.ADMIN, demo.lit(RUBRIC)))
    tail = "select set_config('test.jwt', %s, false);" % ("'" + demo.ADMIN + "'")
    i = s.rindex(tail)
    return s[:i] + approve + "\\echo VERSION :s3\n" + s[i:]


def build():
    e = json.load(open(demo.ENGINE, encoding="utf-8"))
    out = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=sql(e), capture_output=True, text=True,
                         check=True).stdout
    claim = json.loads([ln for ln in out.splitlines() if ln.startswith("CLAIM ")][-1][len("CLAIM "):])
    vid = [ln for ln in out.splitlines() if ln.startswith("VERSION ")][-1][len("VERSION "):].strip()
    overview = json.loads([ln for ln in out.splitlines() if ln.startswith("{")][-1])
    return {"_note": "TEST DATA only. The answers of public.weekly_run_claim (visual_check) and public.hs_weekly_overview"
                     " on a disposable database, from the prepared SQL (docs/weekly-1..7). Not production.",
            "version_id": vid, "claim": claim, "overview": overview}


def main():
    o = build()
    text = json.dumps(o, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        have = json.load(open(OUT, encoding="utf-8"))
        if demo.normalize(have) != demo.normalize(o):
            sys.exit("the render handoff fixture differs from what the prepared SQL produces; rebuild it")
        print("render handoff fixture matches the prepared SQL")
    else:
        open(OUT, "w", encoding="utf-8").write(text)
        print("wrote", OUT)


if __name__ == "__main__":
    main()
