"""Seed a disposable database (never production) for the edition-sequence suite (docs/weekly-8-edition-sequence.sql).

Two topics of TEST DATA, each through the real functions of files 1-7:
  Air Quality    build_render_handoff_fixture.sql(): the demonstration, its document cue, version 3 approved;
  Water Quality  the same demonstration's research and draft parts with the topic and finding keys renamed,
                 then its newest script version approved through hs_weekly_version_approve.
Prints nothing on success; the suite reads the state from the database.

    PGHOST=... PGDATABASE=... python3 test/weekly_stage2_pg/build_edition_sequence_state.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_demo_fixture as demo  # noqa: E402
import build_render_handoff_fixture as handoff  # noqa: E402


def water_sql(e):
    s = demo.sql(e, parts=("research", "draft"))
    s = s.replace("Air Quality", "Water Quality").replace("air-", "water-")
    tail = "select set_config('test.jwt', %s, false);" % ("'" + demo.ADMIN + "'")
    approve = ("reset role;\n"
               "select (v ->> 'id') as w2 from jsonb_array_elements(public.hs_weekly_overview('Water Quality') -> 'versions') v"
               " where v ->> 'stage' = 'script' and not (v -> 'status' ->> 'superseded')::boolean \\gset\n"
               "select set_config('test.jwt', '%s', false);\nset role authenticated;\n"
               "select public.hs_weekly_version_approve(:'w2', null, %s, false, 'TEST DATA: Water section approved for the sequence suite');\n"
               "reset role;\n" % (demo.ADMIN, demo.lit(handoff.RUBRIC)))
    i = s.rindex(tail)
    return s[:i] + approve + s[i:]


def main():
    e = json.load(open(demo.ENGINE, encoding="utf-8"))
    for script in (handoff.sql(e), water_sql(e)):
        subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=script, capture_output=True, text=True, check=True)


if __name__ == "__main__":
    main()
