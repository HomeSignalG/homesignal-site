"""Build test/fixtures/weekly-edition-render-export.json on a DISPOSABLE database (never production). TEST DATA.

Files 1-9 must already be applied to an empty database. Runs the edition-sequence seed (Air with its document cue,
Water), keeps Air's visual_check claim, creates an Air edition that also covers Water (9) and links both approved versions
to it (7), sets the sequence Air segment 0 -> Water segments 0-1 -> Air segment 1, approves
it with the digest the database computed, and writes {claims, export}: export is public.weekly_edition_render_export, the
service read a render job uses. homesignal-ingest's edition bundle reads this file.

    PGHOST=... PGDATABASE=... python3 test/weekly_stage2_pg/build_edition_export_fixture.py
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_demo_fixture as demo  # noqa: E402
import build_edition_sequence_state as state  # noqa: E402
import build_render_handoff_fixture as handoff  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.dirname(HERE)), "test", "fixtures", "weekly-edition-render-export.json")


def psql(script):
    return subprocess.run(["psql", "-X", "-q", "-v", "ON_ERROR_STOP=1"], input=script, capture_output=True, text=True, check=True).stdout


def main():
    e = json.load(open(demo.ENGINE, encoding="utf-8"))
    out = psql(handoff.sql(e))
    claim = json.loads([ln for ln in out.splitlines() if ln.startswith("CLAIM ")][-1][len("CLAIM "):])
    psql(state.water_sql(e))
    script = r"""
select id as air from public.weekly_scripts where stage = 'script' and topic = 'Air Quality' and (public.weekly_version_status(id) ->> 'current')::boolean \gset
select id as water from public.weekly_scripts where stage = 'script' and topic = 'Water Quality' and (public.weekly_version_status(id) ->> 'current')::boolean \gset
select set_config('test.jwt', '%s', false);
set role authenticated;
select (public.hs_weekly_edition_create('Air Quality', '2026-11-09') ->> 'id') as ed \gset
select public.hs_weekly_edition_add_topic(:'ed', 'Water Quality') \gset
select public.hs_weekly_edition_link_version(:'ed', :'air') \gset
select public.hs_weekly_edition_link_version(:'ed', :'water') \gset
\set seq '[{"version_id": "' :air '", "from": 0, "to": 0}, {"version_id": "' :water '", "from": 0, "to": 1}, {"version_id": "' :air '", "from": 1, "to": 1}]'
select (public.hs_weekly_edition_sequence_set(:'ed', :'seq'::jsonb) ->> 'digest') as dg \gset
select public.hs_weekly_edition_sequence_approve(:'ed', :'dg') is not null as ok \gset
reset role;
set role service_role;
\pset tuples_only on
\pset format unaligned
select 'EXPORT ' || public.weekly_edition_render_export(:'ed')::text;
""" % demo.ADMIN
    out = psql(script)
    export = json.loads([ln for ln in out.splitlines() if ln.startswith("EXPORT ")][-1][len("EXPORT "):])
    doc = {"_note": "TEST DATA. public.weekly_edition_render_export and one visual_check claim from a disposable database"
                    " (docs/weekly-1..9). Not production. TECHNICAL FIXTURE: the Water Quality script is the Air Quality demonstration with its topic label renamed. Its text is about the EPA methane proposal, not water; it has no water sources and is not a Water Quality report.", "claims": [claim], "export": export}
    open(OUT, "w", encoding="utf-8").write(json.dumps(doc, indent=1, sort_keys=True, ensure_ascii=False) + "\n")
    print("wrote", OUT, "approved:", export["approved"], "topics:", export["topics"])


if __name__ == "__main__":
    main()
