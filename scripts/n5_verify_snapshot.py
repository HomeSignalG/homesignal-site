#!/usr/bin/env python3
"""N5 Part 1 - does the frozen snapshot REPRODUCE what the completed shards built?

The B2 question is whether PROVEN-class geometry can be materialised nationally from
preservation.app_project_identity @ the frozen snapshot at any shard count, or whether
it can only be produced as a side effect of shard execution (in which case a retrofit
costs a full re-run). The shards read `i.lat, i.lng` from the snapshot and stage them in
geo.n5_frozen, which is DISCARDED at shard cleanup - so no durable artifact records the
coordinates a completed shard actually intersected with. The only durable trace is the
association itself. This check therefore re-derives the associations from the snapshot
alone and compares them, exactly, against geo.n5_association.

Three legs, and the second and third exist so the first is interpretable:

  PROVEN    the leg B2 turns on. Points are rebuilt from the snapshot's own lat/lng as
            ST_SetSRID(ST_MakePoint(lng, lat), 4269) - the identical expression the
            shipped driver uses - and intersected with ST_Intersects. No centroid, no
            radius, no bbox, no buffer, no ST_MakeValid, no transform.
  RECOVERY  POSITIVE CONTROL. Same boundaries, same predicate, geometry taken from
            geo.n5_geom (which IS durable). If this leg reproduces and PROVEN does not,
            the fault is in the snapshot's coordinates, not in this harness. If BOTH
            fail, the harness is the suspect - a check defect, per the mismatch rule.
  SWAPPED   NEGATIVE CONTROL. The same PROVEN rows rebuilt as ST_MakePoint(lat, lng).
            This must produce ZERO intersections. Without it, "PROVEN reproduced" would
            also be consistent with a check that is insensitive to coordinate order.

Read-only against every durable N5 artifact: geo.n5_association, geo.n5_geom,
geo.n5_shard, geo.n5_accepted_source and preservation.* are never written. The one write
is a disposable scratch boundary table, created and dropped by this run, because the
per-shard ZCTA slices were correctly discarded at cleanup and must be reloaded from the
same sha256-pinned TIGER archive to re-run the intersection at all.

stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import lit, read_shp_polygons, rings_to_multipolygon_wkt, CANON_SRID  # noqa: E402
from n5_shard import (  # noqa: E402  - one implementation, imported not re-derived
    sql, say, one, tiger_index, SNAPSHOT,
)

SCRATCH = "geo.n5_verify_zcta"


def preflight():
    say("=" * 48, "")
    say("PREFLIGHT", "")
    r = sql(f"""select
      (select count(*) from geo.n5_shard where snapshot_id={lit(SNAPSHOT)} and state='running') running,
      (select count(*) from geo.n5_shard where snapshot_id={lit(SNAPSHOT)} and state='done') done,
      (select count(*) from geo.n5_zcta) zcta_left,
      (select count(*) from geo.n5_frozen) frozen_left,
      (select to_regclass('{SCRATCH}') is not null) scratch_exists,
      (select count(*) from geo.n5_association) assoc,
      (select count(*) from geo.n5_geom) geom;""", "preflight")[0]
    say("shards done / running", f"{r['done']} / {r['running']}")
    say("n5_zcta rows left / n5_frozen rows left", f"{r['zcta_left']} / {r['frozen_left']}")
    say("n5_association rows / n5_geom rows", f"{r['assoc']} / {r['geom']}")
    if int(r["running"]) != 0:
        raise SystemExit("STOP: a shard is in state 'running'; refusing to verify mid-build")
    if str(r["scratch_exists"]).lower() in ("true", "t"):
        raise SystemExit(f"STOP: {SCRATCH} already exists; refusing to reuse unknown state")
    return r


def done_shards():
    return [x["z3"] for x in sql(
        f"""select z3 from geo.n5_shard where snapshot_id={lit(SNAPSHOT)} and state='done'
             order by z3;""", "done shards")]


def zips_for(z3):
    # The driver loads boundaries for the zips of its FROZEN slice, which is joined to
    # geo.n5_accepted_source. Selecting the raw snapshot slice instead could load a
    # boundary the shard never had, and any extra association would then be a defect in
    # this check rather than a finding. Mirror the join.
    return [x["zip"] for x in sql(
        f"""select distinct i.zip from preservation.app_project_identity i
             join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
             where i.snapshot_id={lit(SNAPSHOT)} and i.record_kind='development'
               and left(i.zip,3)={lit(z3)} order by 1;""", "zips " + z3)]


def load_scratch(z3, zips):
    t = tiger_index()
    idx = t["geoid_to_idx"]
    wanted = {z: idx[z] for z in zips if z in idx}
    shapes, _ = read_shp_polygons(t["raw"], set(wanted.values()))
    vals, loaded = [], 0
    for zc, i in sorted(wanted.items()):
        rings = shapes.get(i)
        if not rings:
            continue
        wkt = rings_to_multipolygon_wkt(rings, zc)
        vals.append(f"({lit(z3)},{lit(zc)},ST_GeomFromText($g${wkt}$g$,{CANON_SRID}))")
        loaded += 1
        if len(vals) >= 25:
            sql(f"insert into {SCRATCH} (z3,zcta5,geom) values " + ",".join(vals)
                + " on conflict (z3,zcta5) do update set geom=excluded.geom;", "scratch ins")
            vals = []
    if vals:
        sql(f"insert into {SCRATCH} (z3,zcta5,geom) values " + ",".join(vals)
            + " on conflict (z3,zcta5) do update set geom=excluded.geom;", "scratch ins")
    return loaded, len(zips) - loaded


def compare_sql(z3):
    """Re-derivation from the SNAPSHOT ONLY, mirroring the shipped build_associations."""
    return f"""
with fr as (
  select i.source_key, i.zip::text zip, i.lat, i.lng, a.treatment
    from preservation.app_project_identity i
    join geo.n5_accepted_source a on a.registry_id = coalesce(i.registry_id,'(null)')
   where i.snapshot_id={lit(SNAPSHOT)} and i.record_kind='development'
     and left(i.zip,3)={lit(z3)}),
proj as (select source_key, max(treatment) treatment from fr group by source_key),
bnd as (select zcta5, geom from {SCRATCH} where z3={lit(z3)}),
pt as (select distinct fr.source_key, ST_SetSRID(ST_MakePoint(fr.lng, fr.lat), {CANON_SRID}) g
         from fr join proj p using (source_key)
        where p.treatment='PROVEN' and fr.lat is not null and fr.lng is not null),
sw as (select distinct fr.source_key, ST_SetSRID(ST_MakePoint(fr.lat, fr.lng), {CANON_SRID}) g
         from fr join proj p using (source_key)
        where p.treatment='PROVEN' and fr.lat is not null and fr.lng is not null),
rec as (select g.source_key, g.geom g
          from geo.n5_geom g join proj p on p.source_key=g.source_key
         where p.treatment='RECOVERY' and g.geom is not null),
ver_pt  as (select distinct a.source_key, b.zcta5::text zip from pt  a join bnd b on ST_Intersects(a.g,b.geom)),
ver_sw  as (select distinct a.source_key, b.zcta5::text zip from sw  a join bnd b on ST_Intersects(a.g,b.geom)),
ver_rec as (select distinct a.source_key, b.zcta5::text zip from rec a join bnd b on ST_Intersects(a.g,b.geom)),
stored as (select s.source_key, s.zip::text zip, p.treatment
             from geo.n5_association s join proj p using (source_key)
            where s.evidence=1 and left(s.zip,3)={lit(z3)})
"""


def compare(z3):
    q = (compare_sql(z3) + """
select
 (select count(*) from pt)      pt_projects,
 (select count(*) from rec)     rec_features,
 (select count(*) from bnd)     boundaries,
 (select count(*) from ver_pt)  pt_derived,
 (select count(*) from ver_rec) rec_derived,
 (select count(*) from ver_sw)  swap_derived,
 (select count(*) from stored where treatment='PROVEN')   pt_stored,
 (select count(*) from stored where treatment='RECOVERY') rec_stored,
 (select count(*) from stored where treatment not in ('PROVEN','RECOVERY')) other_stored,
 (select count(*) from geo.n5_association s where s.evidence=1 and left(s.zip,3)={z3lit}
    and not exists (select 1 from proj p where p.source_key=s.source_key)) unjoined_stored,
 (select count(*) from bnd where not ST_IsValid(geom)) invalid_boundaries,
 (select count(*) from bnd where ST_SRID(geom) <> {srid}) wrong_srid,
 (select count(*) from ver_pt v where not exists
    (select 1 from stored s where s.source_key=v.source_key and s.zip=v.zip)) pt_derived_only,
 (select count(*) from stored s where s.treatment='PROVEN' and not exists
    (select 1 from ver_pt v where v.source_key=s.source_key and v.zip=s.zip)) pt_stored_only,
 (select count(*) from ver_rec v where not exists
    (select 1 from stored s where s.source_key=v.source_key and s.zip=v.zip)) rec_derived_only,
 (select count(*) from stored s where s.treatment='RECOVERY' and not exists
    (select 1 from ver_rec v where v.source_key=s.source_key and v.zip=s.zip)) rec_stored_only;"""
         ).replace("{z3lit}", lit(z3)).replace("{srid}", str(CANON_SRID))
    return sql(q, "compare " + z3)[0]


def examples(z3, leg):
    ver = "ver_pt" if leg == "PROVEN" else "ver_rec"
    q = compare_sql(z3) + f"""
select 'DERIVED_NOT_STORED' side, v.source_key, v.zip from {ver} v
 where not exists (select 1 from stored s where s.source_key=v.source_key and s.zip=v.zip)
union all
select 'STORED_NOT_DERIVED', s.source_key, s.zip from stored s
 where s.treatment={lit(leg)} and not exists
   (select 1 from {ver} v where v.source_key=s.source_key and v.zip=s.zip)
order by 1,2,3 limit 12;"""
    return sql(q, "examples " + z3 + " " + leg)


def main():
    t0 = time.time()
    say("N5 PART 1 - SNAPSHOT REPRODUCTION CHECK", "")
    say("snapshot", SNAPSHOT)
    pre = preflight()
    shards = done_shards()
    say("done shards", ",".join(shards))

    sql(f"""create table {SCRATCH} (
              z3 char(3) not null, zcta5 char(5) not null,
              geom geometry(MultiPolygon,{CANON_SRID}) not null,
              primary key (z3,zcta5));
            create index n5_verify_zcta_gix on {SCRATCH} using gist (geom);
            alter table {SCRATCH} enable row level security;""", "create scratch")
    say("scratch boundary table", f"{SCRATCH} created (RLS on, dropped at end)")

    tot = {k: 0 for k in ("pt_derived", "pt_stored", "pt_derived_only", "pt_stored_only",
                          "rec_derived", "rec_stored", "rec_derived_only", "rec_stored_only",
                          "swap_derived", "other_stored", "boundaries",
                          "unjoined_stored", "invalid_boundaries", "wrong_srid")}
    per, bad = [], []
    try:
        for z3 in shards:
            zips = zips_for(z3)
            loaded, no_zcta = load_scratch(z3, zips)
            c = compare(z3)
            for k in tot:
                tot[k] += int(c[k] or 0)
            per.append((z3, len(zips), loaded, no_zcta, c))
            say("", "")
            say(f"SHARD {z3}  zips / with ZCTA / no ZCTA",
                f"{len(zips)} / {loaded} / {no_zcta}")
            say("  PROVEN   derived / stored / d-only / s-only",
                f"{c['pt_derived']} / {c['pt_stored']} / "
                f"{c['pt_derived_only']} / {c['pt_stored_only']}")
            say("  RECOVERY derived / stored / d-only / s-only",
                f"{c['rec_derived']} / {c['rec_stored']} / "
                f"{c['rec_derived_only']} / {c['rec_stored_only']}")
            say("  SWAPPED (must be 0)", c["swap_derived"])
            for leg, d, s in (("PROVEN", c["pt_derived_only"], c["pt_stored_only"]),
                              ("RECOVERY", c["rec_derived_only"], c["rec_stored_only"])):
                if int(d or 0) or int(s or 0):
                    for e in examples(z3, leg):
                        bad.append((z3, leg, e["side"], e["source_key"], e["zip"]))
                        say(f"  MISMATCH {leg} {e['side']}", f"{e['source_key']} {e['zip']}")
            if int(c["swap_derived"] or 0):
                bad.append((z3, "SWAPPED", "NEGATIVE_CONTROL_FIRED", "", ""))
    finally:
        sql(f"drop table if exists {SCRATCH};", "drop scratch")
        gone = one(sql(f"select (to_regclass('{SCRATCH}') is null) g;", "scratch gone"), "g")
        say("", "")
        say("scratch dropped", gone)

    say("=" * 48, "")
    say("TOTALS across done shards", len(shards))
    say("boundaries loaded", tot["boundaries"])
    say("PROVEN   denominator (stored ev=1 on PROVEN sources)", tot["pt_stored"])
    say("PROVEN   derived / derived-only / stored-only",
        f"{tot['pt_derived']} / {tot['pt_derived_only']} / {tot['pt_stored_only']}")
    say("RECOVERY denominator (stored ev=1 on RECOVERY sources)", tot["rec_stored"])
    say("RECOVERY derived / derived-only / stored-only",
        f"{tot['rec_derived']} / {tot['rec_derived_only']} / {tot['rec_stored_only']}")
    say("stored ev=1 on neither class (must be 0)", tot["other_stored"])
    say("stored ev=1 whose source_key is not in the slice (must be 0)", tot["unjoined_stored"])
    say("invalid boundaries / wrong SRID (must be 0 / 0)",
        f"{tot['invalid_boundaries']} / {tot['wrong_srid']}")
    say("SWAPPED negative control (must be 0)", tot["swap_derived"])

    ok_pt = tot["pt_derived_only"] == 0 and tot["pt_stored_only"] == 0
    ok_rec = tot["rec_derived_only"] == 0 and tot["rec_stored_only"] == 0
    ok_sw = tot["swap_derived"] == 0
    ok_other = (tot["other_stored"] == 0 and tot["unjoined_stored"] == 0
                and tot["invalid_boundaries"] == 0 and tot["wrong_srid"] == 0)
    say("PROVEN leg exact", "yes" if ok_pt else "NO")
    say("RECOVERY positive control exact", "yes" if ok_rec else "NO")
    say("SWAPPED negative control clean", "yes" if ok_sw else "NO")
    say("seconds", round(time.time() - t0, 1))
    if not (ok_pt and ok_rec and ok_sw and ok_other):
        say("RESULT", "MISMATCH - classify per the mismatch rule; do not explain away")
        raise SystemExit(1)
    say("RESULT", f"EXACT on both legs. PROVEN denominator = {tot['pt_stored']}")


if __name__ == "__main__":
    main()
