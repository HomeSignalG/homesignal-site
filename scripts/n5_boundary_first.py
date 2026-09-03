#!/usr/bin/env python3
"""S1 boundary-first pass, ONE prefix, bounded. Measures the membership row count.

THE POINT OF THE SHAPE: `scripts/n5_shard.py::build_associations` joins geo.n5_geom to
`proj` - the shard's frozen slice - so the national geometry corpus is narrowed to what
the legacy 3-mile method already placed in that prefix BEFORE any ST_Intersects runs.
That is why the association layer measures over-inclusion well and is nearly blind to
under-inclusion. Here the boundary drives and the candidate set is the ENTIRE resident
corpus; the only narrowing is the GiST `&&` prefilter from the boundary's own envelope
and the fail-closed eligibility allowlist.

The candidate-bounding invariant is not a convention here - the pass runs
scripts/n5_candidate_bounding.py over its OWN SQL and refuses to execute if it reports a
violation. A guard that only exists in a test file cannot stop the pass that matters.

BOUNDARIES ARE LOADED FOR THE WHOLE GEOID PREFIX, not for the ZIPs that happen to carry
a legacy pair. That second narrowing is real: 20 ZIP pages across the 13 completed
prefixes never had a boundary loaded at all, so they could not receive an addition for
any project, by construction.

Writes exactly one table, geo.n5_boundary_membership, at PROJECT grain. It does not
touch geo.n5_association, geo.n5_shard, or any production read path.

stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import lit, read_shp_polygons, rings_to_multipolygon_wkt, CANON_SRID  # noqa: E402
from n5_shard import sql, say, one, tiger_index, SNAPSHOT  # noqa: E402
from n5_candidate_bounding import check_candidate_bounding  # noqa: E402

PREFIX = os.environ.get("PREFIX", "").strip()
RUN_ID = os.environ.get("RUN_ID", "").strip() or f"bf-{PREFIX}-{int(time.time())}"
FLOOR_MB = float(os.environ.get("DISK_FLOOR_MB", "2048"))
TOTAL_MB = float(os.environ.get("DISK_TOTAL_MB", "11607"))
SCRATCH = "geo.n5_bf_zcta"

# The pass's own SQL, held as a constant so the guard checks the string that actually
# runs rather than a paraphrase of it.
PROBE_SQL = f"""
insert into geo.n5_boundary_membership (zcta5, source_key, provenance, run_id)
select distinct b.zcta5, g.source_key, g.provenance, {{RUN}}
  from {SCRATCH} b
  join geo.n5_geom g
    on g.outcome = 1 and g.geom is not null and ST_Intersects(g.geom, b.geom)
 where b.prefix = {{PFX}}
on conflict (zcta5, source_key) do nothing;"""


def disk():
    r = sql("select (pg_database_size(current_database())/1048576.0) db, "
            "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;", "disk")[0]
    return TOTAL_MB - (float(r["db"]) + float(r["wal"])), float(r["db"]), float(r["wal"])


def snap(tag):
    r = sql("""select pg_total_relation_size('geo.n5_geom') geom,
                      coalesce(pg_total_relation_size('geo.n5_boundary_membership'),0) memb,
                      (select count(*) from geo.n5_boundary_membership) rows;""", "snap")[0]
    free, db, wal = disk()
    say(f"{tag} n5_geom / membership bytes / membership rows",
        f"{r['geom']} / {r['memb']} / {r['rows']}")
    say(f"{tag} free disk MB", round(free, 1))
    return int(r["memb"]), int(r["rows"]), free


def main():
    t0 = time.time()
    say("N5 S1 BOUNDARY-FIRST - ONE PREFIX", "")
    say("prefix / run_id / snapshot", f"{PREFIX} / {RUN_ID} / {SNAPSHOT}")
    if not PREFIX or len(PREFIX) != 3 or not PREFIX.isdigit():
        raise SystemExit("STOP: PREFIX must be a 3-digit ZIP3")

    # ---- the guard runs BEFORE anything is written, over the SQL that will run.
    probe = PROBE_SQL.replace("{RUN}", lit(RUN_ID)).replace("{PFX}", lit(PREFIX))
    violations = check_candidate_bounding(probe)
    say("candidate-bounding guard", "CLEAN" if not violations else f"FIRED {violations}")
    if violations:
        raise SystemExit(f"STOP: candidate-bounding violation {violations}")

    sql("""create table if not exists geo.n5_boundary_membership (
             zcta5      char(5) not null,
             source_key text    not null,
             provenance text    not null,
             run_id     text    not null,
             found_at   timestamptz not null default now(),
             primary key (zcta5, source_key));
           alter table geo.n5_boundary_membership enable row level security;""", "create memb")
    sql(f"""create table if not exists {SCRATCH} (
              prefix char(3) not null, zcta5 char(5) not null,
              geom geometry(MultiPolygon,{CANON_SRID}) not null,
              primary key (prefix, zcta5));
            create index if not exists n5_bf_zcta_gix on {SCRATCH} using gist (geom);
            alter table {SCRATCH} enable row level security;""", "create scratch")

    memb0, rows0, free0 = snap("BEFORE")
    if free0 < FLOOR_MB:
        raise SystemExit(f"STOP: free {free0:.1f} MB is already below the {FLOOR_MB} floor")

    # ---- boundaries: EVERY ZCTA whose GEOID carries the prefix, not only those with a
    # legacy pair. Loading only legacy-bearing ZIPs is narrowing #2 of the measured defect.
    t = tiger_index()
    wanted = {g: i for g, i in t["geoid_to_idx"].items() if g.startswith(PREFIX)}
    say("ZCTAs in the national file with this prefix", len(wanted))
    legacy_zips = int(one(sql(f"""select count(distinct zip) n from preservation.app_project_identity
                                   where snapshot_id={lit(SNAPSHOT)} and record_kind='development'
                                     and left(zip,3)={lit(PREFIX)};""", "legacy zips"), "n"))
    say("ZIPs carrying a legacy pair (what a shard would load)", legacy_zips)
    # SET DIFFERENCE, not a difference of set SIZES. The first version of this line
    # subtracted the two counts and printed -4 for prefix 021 (53 ZCTAs, 57 legacy ZIPs),
    # which is not a count of anything: the two sets overlap partially, because some
    # legacy ZIPs have no ZCTA at all. Only the difference answers "which boundaries
    # would a shard-first build never have loaded".
    have = {r["zip"] for r in sql(f"""select distinct zip from preservation.app_project_identity
                                       where snapshot_id={lit(SNAPSHOT)} and record_kind='development'
                                         and left(zip,3)={lit(PREFIX)};""", "legacy zip set")}
    never = sorted(set(wanted) - have)
    say("boundaries a shard-first build would NEVER have loaded", len(never))
    if never:
        say("  (first 12)", ",".join(never[:12]))
    say("legacy ZIPs with no ZCTA in the national file", len(have - set(wanted)))

    sql(f"delete from {SCRATCH} where prefix={lit(PREFIX)};", "clear scratch")
    shapes, _ = read_shp_polygons(t["raw"], set(wanted.values()))
    vals, loaded = [], 0
    for zc, i in sorted(wanted.items()):
        rings = shapes.get(i)
        if not rings:
            continue
        wkt = rings_to_multipolygon_wkt(rings, zc)
        vals.append(f"({lit(PREFIX)},{lit(zc)},ST_GeomFromText($g${wkt}$g$,{CANON_SRID}))")
        loaded += 1
        if len(vals) >= 20:
            sql(f"insert into {SCRATCH} (prefix,zcta5,geom) values " + ",".join(vals)
                + " on conflict (prefix,zcta5) do update set geom=excluded.geom;", "zcta ins")
            vals = []
    if vals:
        sql(f"insert into {SCRATCH} (prefix,zcta5,geom) values " + ",".join(vals)
            + " on conflict (prefix,zcta5) do update set geom=excluded.geom;", "zcta ins")
    chk = sql(f"""select count(*) n, count(*) filter (where not ST_IsValid(geom)) bad,
                         count(*) filter (where ST_SRID(geom)<>{CANON_SRID}) wrong_srid,
                         coalesce(sum(ST_NPoints(geom)),0) pts
                    from {SCRATCH} where prefix={lit(PREFIX)};""", "zcta chk")[0]
    say("boundaries loaded / invalid / wrong SRID / vertices",
        f"{chk['n']} / {chk['bad']} / {chk['wrong_srid']} / {chk['pts']}")
    if int(chk["bad"]) or int(chk["wrong_srid"]):
        raise SystemExit("STOP: boundary validity/SRID check failed")

    corpus = sql("""select count(*) feats, count(distinct source_key) projects
                      from geo.n5_geom where outcome=1 and geom is not null;""", "corpus")[0]
    say("resident corpus probed (features / projects)",
        f"{corpus['feats']} / {corpus['projects']}")

    # ---- the probe. Boundaries drive; the candidate set is the whole corpus.
    t1 = time.time()
    sql(probe, "boundary-first probe")
    say("probe seconds", round(time.time() - t1, 1))

    memb1, rows1, free1 = snap("AFTER")
    added = rows1 - rows0
    say("", "")
    say("MEMBERSHIP ROWS for this prefix", added)
    if added:
        say("bytes per membership row, all-in", round((memb1 - memb0) / added, 1))
    if free1 < FLOOR_MB:
        say("DISK FLOOR", f"HALT - free {free1:.1f} MB below {FLOOR_MB}")
        raise SystemExit("STOP: free disk fell below the floor")

    d = sql(f"""
with disc as (select zcta5::text zip, source_key, provenance from geo.n5_boundary_membership
              where run_id={lit(RUN_ID)}),
leg as (select distinct i.zip::text zip, i.source_key
          from preservation.app_project_identity i
         where i.snapshot_id={lit(SNAPSHOT)} and i.record_kind='development'
           and left(i.zip,3)={lit(PREFIX)})
select (select count(*) from disc) discovered,
       (select count(*) from leg) legacy,
       (select count(distinct source_key) from disc) disc_projects,
       (select count(distinct source_key) from leg) leg_projects,
       (select count(*) from disc d where not exists
          (select 1 from leg l where l.zip=d.zip and l.source_key=d.source_key)) under_inclusion,
       (select count(*) from leg l where not exists
          (select 1 from disc d where d.zip=l.zip and d.source_key=l.source_key)) over_inclusion,
       (select count(*) from disc where provenance='proven_stored_point') from_proven,
       (select count(*) from disc where provenance='recovered_authoritative') from_recovery,
       (select count(distinct zcta5) from geo.n5_boundary_membership where run_id={lit(RUN_ID)}) zctas_hit;""",
            "diff")[0]
    say("", "")
    say("discovered rows / legacy pairs", f"{d['discovered']} / {d['legacy']}")
    say("discovered projects / legacy projects", f"{d['disc_projects']} / {d['leg_projects']}")
    say("UNDER-INCLUSION discovered \\ legacy", d["under_inclusion"])
    say("over-inclusion legacy \\ discovered", d["over_inclusion"])
    say("rows from PROVEN / from RECOVERY", f"{d['from_proven']} / {d['from_recovery']}")
    say("ZCTAs with at least one member", f"{d['zctas_hit']} of {chk['n']}")
    if int(d["disc_projects"] or 0):
        say("rows per discovered project",
            round(int(d["discovered"]) / int(d["disc_projects"]), 3))

    sql(f"delete from {SCRATCH} where prefix={lit(PREFIX)};", "drop scratch rows")
    sql(f"drop table if exists {SCRATCH};", "drop scratch")
    say("scratch boundary table dropped",
        one(sql(f"select (to_regclass('{SCRATCH}') is null) g;", "gone"), "g"))
    say("seconds", round(time.time() - t0, 1))
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
