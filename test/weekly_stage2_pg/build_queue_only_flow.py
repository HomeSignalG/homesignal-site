#!/usr/bin/env python3
"""Build the QUEUE-ONLY flow fixture (test/fixtures/weekly-queue-only-flow.json) from the prepared SQL itself.

Run by run_queue_only.sh on a DISPOSABLE Postgres holding only the queue-only release (docs/weekly-1-base.sql and
docs/weekly-2-topic-queue.sql). It makes, one by one, the calls the Tab 20 page makes, and after each call records what
the database answered and what hs_weekly_topic_queue then returns (for no edition and for every edition). The real-page
browser test (test/weekly-tab20.browser.test.mjs) replays it: the page must make exactly these calls, and every screen it
shows is what this SQL produced.

The two founder leads come from test/fixtures/weekly-topic-leads.json: UNVERIFIED, no addresses, no commitment.
Everything marked TEST is made up. This is test data, NOT a durable live queue.

  python3 build_queue_only_flow.py            write the fixture
  python3 build_queue_only_flow.py --check    fail if the committed fixture differs
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from build_demo_fixture import ADMIN, normalize, q  # noqa: E402

LEADS = os.path.join(ROOT, "test", "fixtures", "weekly-topic-leads.json")
OUT = os.path.join(ROOT, "test", "fixtures", "weekly-queue-only-flow.json")
JSONB = {"p_fields"}


def answer_format():
    """The exact text the page sends: lib/acq-weekly-slice.js answerFormatText(), read from the shipped file."""
    js = ("const vm=require('vm'),fs=require('fs');const c={window:{}};c.window.window=c.window;vm.createContext(c);"
          "vm.runInContext(fs.readFileSync(process.argv[1],'utf8'),c);process.stdout.write(c.window.HS.acqWeeklySlice.answerFormatText());")
    return subprocess.run(["node", "-e", js, os.path.join(ROOT, "lib", "acq-weekly-slice.js")], capture_output=True, text=True, check=True).stdout


def psql(statement):
    pre = "select set_config('test.jwt', %s, false) is not null;\nset role authenticated;\n" % q(ADMIN)
    out = subprocess.run(["psql", "-X", "-q", "-tA"], input=pre + statement + ";\n", capture_output=True, text=True)
    rows = [l for l in out.stdout.splitlines() if l.startswith(("{", "["))]
    if rows:
        return json.loads(rows[-1]), None
    err = [l for l in out.stderr.splitlines() if "ERROR:" in l]
    if not err:
        sys.exit("no answer and no error for: " + statement + "\n" + out.stderr)
    return None, err[0].split("ERROR:", 1)[1].strip()


def call(rpc, args):
    parts = []
    for k, v in args.items():
        if v is None:
            parts.append("%s => null" % k)
        elif k in JSONB:
            parts.append("%s => %s::jsonb" % (k, q(json.dumps(v, ensure_ascii=False))))
        else:
            parts.append("%s => %s" % (k, q(v)))
    return psql("select public.%s(%s)::text" % (rpc, ", ".join(parts)))


def queues(editions):
    out = {}
    for key in [""] + editions:
        o, err = psql("select public.hs_weekly_topic_queue(%s)::text" % (q(key) if key else "null"))
        if err:
            sys.exit(err)
        out[key] = o
    return out


def main():
    leads = json.load(open(LEADS, encoding="utf-8"))["leads"]
    fmt = answer_format()
    ids, editions, steps = {}, [], []

    def step(label, rpc, args, keep=None, expect_error=False):
        args = {k: (ids[v[1:]] if isinstance(v, str) and v.startswith("$") else v) for k, v in args.items()}
        res, err = call(rpc, args)
        if bool(err) != expect_error:
            sys.exit("step %r: %s" % (label, err or "was expected to be refused and was not"))
        if keep and res:
            ids[keep] = res.get("lead_id") or res.get("id")
            if rpc == "hs_weekly_edition_create":
                editions.append(ids[keep])
        steps.append({"label": label, "rpc": rpc, "args": args, "result": res, "error": err, "queues": queues(editions)})

    initial = queues([])
    step("capture a lead with a title and its category", "hs_weekly_lead_save", {"p_lead": None, "p_fields": {"title": "TEST: a lead with a title and its category", "topic": "Data Centers"}}, "lq")
    step("capture the Water lead (unverified fixture)", "hs_weekly_lead_save", {"p_lead": None, "p_fields": leads[1]}, "l2")
    step("capture the Data Centers lead (unverified fixture)", "hs_weekly_lead_save", {"p_lead": None, "p_fields": leads[0]}, "l1")
    ed = lambda topic, start: {"p_topic": topic, "p_period_start": start, "p_period_end": None, "p_series": None, "p_key": None}
    step("create a Water edition", "hs_weekly_edition_create", ed("Water Quality", "2026-11-09"), "ew")
    step("create a Data Centers edition", "hs_weekly_edition_create", ed("Data Centers", "2026-11-09"), "ec")
    step("prepare the Data Centers lead's research request", "hs_weekly_lead_send_to_research", {"p_lead": "$l1", "p_edition": "$ec", "p_answer_format": fmt})
    step("capture a publicly promised Water lead", "hs_weekly_lead_save", {"p_lead": None, "p_fields": {
        "title": "TEST: a promised Water topic", "topic": "Water Quality", "commitment_wording": "TEST: we will cover this next week.",
        "commitment_post_url": "https://social.example.test/post/7"}}, "lp")
    step("prepare the promised lead's research request", "hs_weekly_lead_send_to_research", {"p_lead": "$lp", "p_edition": "$ew", "p_answer_format": fmt})
    step("defer the promised lead with no reason (refused)", "hs_weekly_lead_disposition",
         {"p_lead": "$lp", "p_edition": "$ew", "p_disposition": "deferred", "p_reason": None}, expect_error=True)
    step("defer the promised lead with a reason", "hs_weekly_lead_disposition",
         {"p_lead": "$lp", "p_edition": "$ew", "p_disposition": "deferred", "p_reason": "TEST: the record is not public yet"})
    step("assign the Water lead without research", "hs_weekly_lead_assign", {"p_lead": "$l2", "p_edition": "$ew"})
    step("include the Water lead", "hs_weekly_lead_disposition", {"p_lead": "$l2", "p_edition": "$ew", "p_disposition": "included", "p_reason": None})
    step("record publication with no date (refused)", "hs_weekly_edition_publish",
         {"p_edition": "$ew", "p_video_url": "https://video.example.test/watch?v=TEST", "p_published_on": None}, expect_error=True)
    step("record publication with our video's address and date", "hs_weekly_edition_publish",
         {"p_edition": "$ew", "p_video_url": "https://video.example.test/watch?v=TEST", "p_published_on": "2026-11-10"})
    step("create the next Water edition", "hs_weekly_edition_create", ed("Water Quality", "2026-11-16"), "ew2")
    step("carry the deferred promise into the next edition", "hs_weekly_lead_send_to_research", {"p_lead": "$lp", "p_edition": "$ew2", "p_answer_format": fmt})

    # read as the database owner: no admin function exposes these tables
    raw = subprocess.run(["psql", "-X", "-q", "-tA", "-c",
                          "select jsonb_build_object('runs', (select count(*) from public.weekly_runs), 'answers', "
                          "(select count(*) from public.weekly_research_answers), 'requests', (select count(*) from public.weekly_research_requests), "
                          "'outbound_calls', (select count(*) from net.calls))::text"], capture_output=True, text=True, check=True).stdout
    counts = json.loads(raw)
    o = normalize({"initial": initial, "steps": steps, "ids": ids, "after": counts})
    o["_note"] = ("TEST DATA built by test/weekly_stage2_pg/build_queue_only_flow.py from the queue-only release "
                  "(docs/weekly-1-base.sql + docs/weekly-2-topic-queue.sql) on a disposable database. The two founder leads are "
                  "UNVERIFIED and carry no address and no commitment. This is not a durable live queue.")
    text = json.dumps(o, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    # every timestamp becomes one fixed value: the shared normalizer numbers them, and that numbering varies between runs
    text = re.sub(r"2026-11-10T12:\d\d:00Z", "2026-11-10T12:00:00Z", text)
    if "--check" in sys.argv:
        if not os.path.exists(OUT) or open(OUT, encoding="utf-8").read() != text:
            sys.exit("the queue-only flow fixture differs from what the prepared SQL produces; rebuild it")
        print("queue-only flow fixture matches the prepared SQL")
    else:
        open(OUT, "w", encoding="utf-8").write(text)
        print("wrote", OUT)


if __name__ == "__main__":
    main()
