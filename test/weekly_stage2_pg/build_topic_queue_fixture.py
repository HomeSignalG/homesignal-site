#!/usr/bin/env python3
"""Build the topic-queue screen fixture (test/fixtures/weekly-topic-queue.json) from the prepared SQL itself, so the
browser test shows exactly what docs/weekly-topic-queue.sql produces.

Run by run_topic_queue.sh on a DISPOSABLE Postgres that already holds the fixture, both SQL files and the demonstration
seed (build_demo_fixture.py --seed). It plays one small story through the real functions and prints the read model:

  the founder's two leads (from test/fixtures/weekly-topic-leads.json: UNVERIFIED, no addresses, no commitment),
  one sent to research; a TEST promised lead deferred with a reason in a closed edition and carried into the next one;
  a TEST lead with a draft commitment; a TEST lead included in an edition that records a published video.

Everything marked TEST is made up. This file and its output are test data, NOT a durable live queue.

  python3 build_topic_queue_fixture.py            write the fixture
  python3 build_topic_queue_fixture.py --check    fail if the committed fixture differs
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
from build_demo_fixture import ADMIN, normalize, q  # noqa: E402

LEADS = os.path.join(ROOT, "test", "fixtures", "weekly-topic-leads.json")
OUT = os.path.join(ROOT, "test", "fixtures", "weekly-topic-queue.json")
FMT = "TEST ANSWER FORMAT: answer only in the WEEKLY-ANSWER v1 format."


def lit(o):
    return q(json.dumps(o, ensure_ascii=False)) + "::jsonb"


def sql():
    leads = json.load(open(LEADS, encoding="utf-8"))["leads"]
    admin = "select set_config('test.jwt', %s, false);" % q(ADMIN)
    return "\n".join([
        "\\set ON_ERROR_STOP 1", admin, "set role authenticated;",
        "select (public.hs_weekly_lead_save(null, %s) ->> 'lead_id') as l1 \\gset" % lit(leads[0]),
        "select (public.hs_weekly_lead_save(null, %s) ->> 'lead_id') as l2 \\gset" % lit(leads[1]),
        "select (public.hs_weekly_lead_save(null, %s) ->> 'lead_id') as lq \\gset" % lit({"title": "TEST: a topic saved with a title only"}),
        "select (public.hs_weekly_lead_save(null, %s) ->> 'lead_id') as ld \\gset" % lit({
            "title": "TEST: a topic with a draft commitment", "topic": "Air Quality",
            "commitment_wording": "TEST: we may cover this soon."}),
        "select (public.hs_weekly_lead_save(null, %s) ->> 'lead_id') as lp \\gset" % lit({
            "title": "TEST: a publicly promised topic", "topic": "Air Quality", "location": "TEST County",
            "why_it_matters": "TEST: residents asked about the air near a plant.",
            "questions": ["TEST: what does the permit allow?", "TEST: what was measured?"],
            "source_urls": ["https://news.example.test/a-story"], "social_post_url": "https://social.example.test/post/42",
            "commitment_wording": "TEST: we will look into this next week.", "commitment_post_url": "https://social.example.test/post/42"}),
        "select (public.hs_weekly_lead_save(null, %s) ->> 'lead_id') as lx \\gset" % lit({
            "title": "TEST: a topic that reached a published report", "topic": "Water Quality",
            "questions": ["TEST: what did the utility report?"]}),
        "select (public.hs_weekly_edition_create('Data Centers', '2026-11-09') ->> 'id') as ec \\gset",
        "select (public.hs_weekly_edition_create('Air Quality', '2026-11-02') ->> 'id') as ea \\gset",
        "select (public.hs_weekly_edition_create('Air Quality', '2026-11-09') ->> 'id') as ea2 \\gset",
        "select (public.hs_weekly_edition_create('Water Quality', '2026-11-02') ->> 'id') as ew \\gset",
        "select public.hs_weekly_lead_send_to_research(:'l1', :'ec', %s) is not null as c \\gset" % q(FMT),
        # the promised topic: deferred with a reason in the first Air edition (then closed), carried into the next one
        "select public.hs_weekly_lead_send_to_research(:'lp', :'ea', %s) is not null as c \\gset" % q(FMT),
        "select public.hs_weekly_lead_disposition(:'lp', :'ea', 'deferred', 'TEST: the permit record is not public yet; carry it to next week') is not null as c \\gset",
        # a second topic deferred in that edition and still waiting: it stays in carry forward after the edition closes
        "select (public.hs_weekly_lead_save(null, %s) ->> 'lead_id') as lf \\gset" % lit({
            "title": "TEST: a topic deferred and waiting for a later edition", "topic": "Air Quality"}),
        "select public.hs_weekly_lead_assign(:'lf', :'ea') is not null as c \\gset",
        "select public.hs_weekly_lead_disposition(:'lf', :'ea', 'deferred', 'TEST: waiting for the next hearing') is not null as c \\gset",
        "select public.hs_weekly_edition_close(:'ea', 'TEST: no video this week; both topics were deferred') is not null as c \\gset",
        "select public.hs_weekly_lead_send_to_research(:'lp', :'ea2', %s) is not null as c \\gset" % q(FMT),
        # the Water topic: researched, included, and its edition records OUR video
        "select (public.hs_weekly_lead_send_to_research(:'lx', :'ew', %s) ->> 'request_id') as rqx \\gset" % q(FMT),
        "select (public.hs_weekly_paste_answer(:'rqx', 'TEST DATA pasted answer') ->> 'run_id') as rx \\gset",
        "reset role; set role service_role;",
        "select public.weekly_run_claim(:'rx') is not null as c \\gset",
        "select public.weekly_research_record(:'rx', %s) is not null as c \\gset" % lit({
            "runner_seconds": 5,
            "sources": [{"ref": "s1", "url": "https://example.test/utility-report", "publisher": "TEST Utility", "title": "TEST report",
                         "quote": "TEST quoted sentence from the report", "retrieved_at": "2026-11-05T12:00:00Z",
                         "quote_match": "not_found", "date_extraction": "not_stated"}],
            "findings": [{"finding_key": "water-test-finding", "statement": "TEST: the utility reported a result.", "source_refs": ["s1"]}]}),
        "reset role; set role authenticated;",
        "select public.hs_weekly_lead_disposition(:'lx', :'ew', 'included') is not null as c \\gset",
        "select public.hs_weekly_edition_publish(:'ew', 'https://video.example.test/watch?v=TEST', '2026-11-08') is not null as c \\gset",
        "reset role;",
        # the Air draft in the demonstration is linked to the open Air edition, so its approval waits for the promised topic
        "select id as root from public.weekly_scripts where stage = 'angles' and topic = 'Air Quality' order by created_at limit 1 \\gset",
        admin, "set role authenticated;",
        "select public.hs_weekly_edition_link_version(:'ea2', :'root') is not null as c \\gset",
        "\\pset tuples_only on", "\\pset format unaligned",
        "select public.hs_weekly_topic_queue(:'ea2')::text;"])


def main():
    out = subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=sql(), capture_output=True, text=True)
    if out.returncode:
        sys.exit(out.stderr)
    line = [l for l in out.stdout.splitlines() if l.startswith("{")][-1]
    o = normalize(json.loads(line))
    o["_note"] = ("TEST DATA built by test/weekly_stage2_pg/build_topic_queue_fixture.py from docs/weekly-topic-queue.sql on a "
                  "disposable database. The two founder leads are UNVERIFIED and carry no address and no commitment. "
                  "This is not a durable live queue.")
    text = json.dumps(o, indent=1, sort_keys=True, ensure_ascii=False) + "\n"
    if "--check" in sys.argv:
        if not os.path.exists(OUT) or open(OUT, encoding="utf-8").read() != text:
            sys.exit("the topic-queue screen fixture differs from what the prepared SQL produces; rebuild it")
        print("topic-queue screen fixture matches the prepared SQL")
    else:
        open(OUT, "w", encoding="utf-8").write(text)
        print("wrote", OUT)


if __name__ == "__main__":
    main()
