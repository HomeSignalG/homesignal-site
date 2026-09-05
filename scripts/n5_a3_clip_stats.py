"""UNIT A3 MEASUREMENT PASS - clipped-geometry primitives for the marker-grain decision.

Unit A2 proved multiple markers can be meaningful for line projects, but the number that
sizes the fix was missing: how long is the AUTHORITATIVE geometry once clipped to the ZIP,
and how is it shaped. Unit A stored clip_dim and dropped the boundary scratch, so this pass
re-loads the boundaries and records the PRIMITIVES a marker rule is chosen from - never the
rule itself, so the strategies can be evaluated afterwards without re-running the clip.

Per (ZIP, project) it records: geometry family, clip dimension, component count, clipped
length (lines) and area (polygons), the longest single component, and - for comparison with
what production renders today - how many legacy publisher points that pair carries, how many
of them lie ON the clip, and the largest nearest-neighbour spacing among them.

MEASUREMENT ONLY. It writes one new table, geo.n5_a3_clip_stats, and nothing else. It does
not touch public.app_projects_for_zip, geo.zip_authoritative_membership, geo.n5_association,
geo.n5_boundary_membership, geo.n5_geom, any page, the sitemap or indexability.

stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import lit, read_shp_polygons, rings_to_multipolygon_wkt, CANON_SRID  # noqa: E402
from n5_shard import sql, say, one, tiger_index  # noqa: E402

RUN_ID = os.environ.get("RUN_ID", "").strip() or f"a3-{int(time.time())}"
FLOOR_MB = float(os.environ.get("DISK_FLOOR_MB", "2048"))
TOTAL_MB = float(os.environ.get("DISK_TOTAL_MB", "11607"))
SCRATCH = "geo.n5_a3_zcta"
STATS = "geo.n5_a3_clip_stats"


def disk():
    r = sql("select (pg_database_size(current_database())/1048576.0) db, "
            "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;", "disk")[0]
    return TOTAL_MB - (float(r["db"]) + float(r["wal"])), float(r["db"]), float(r["wal"])


def ddl():
    sql(f"""create table if not exists {STATS} (
      zcta5          char(5) not null,
      source_key     text    not null,
      family         text,
      clip_dim       smallint,
      n_components   integer,
      clip_len_m     double precision,
      clip_area_m2   double precision,
      comp_max_len_m double precision,
      legacy_points  integer,
      legacy_on_clip integer,
      legacy_max_nn_m double precision,
      run_id         text not null,
      computed_at    timestamptz not null default now(),
      primary key (zcta5, source_key));
    alter table {STATS} enable row level security;""", "stats table")
    say("stats table", "ensured (geo schema, RLS on, no grants)")


def load_boundaries(pfx):
    want = {r["zip"] for r in sql(
        f"select distinct zcta5::text zip from geo.zip_authoritative_membership where left(zcta5,3)={lit(pfx)};",
        "memb zips")}
    if not want:
        say("memberships in prefix", 0)
        return 0
    t = tiger_index()
    idx = {g: i for g, i in t["geoid_to_idx"].items() if g in want}
    say("ZIPs with membership / with a TIGER boundary", f"{len(want)} / {len(idx)}")
    sql(f"delete from {SCRATCH} where prefix={lit(pfx)};", "clear scratch")
    shapes, _ = read_shp_polygons(t["raw"], set(idx.values()))
    vals, loaded = [], 0
    for zc, i in sorted(idx.items()):
        rings = shapes.get(i)
        if not rings:
            continue
        vals.append(f"({lit(pfx)},{lit(zc)},ST_GeomFromText($g${rings_to_multipolygon_wkt(rings, zc)}$g$,{CANON_SRID}))")
        loaded += 1
        if len(vals) >= 20:
            sql(f"insert into {SCRATCH} (prefix,zcta5,geom) values " + ",".join(vals)
                + " on conflict (prefix,zcta5) do update set geom=excluded.geom;", "zcta ins")
            vals = []
    if vals:
        sql(f"insert into {SCRATCH} (prefix,zcta5,geom) values " + ",".join(vals)
            + " on conflict (prefix,zcta5) do update set geom=excluded.geom;", "zcta ins")
    say("boundaries loaded", loaded)
    return loaded


MEASURE = f"""
delete from {STATS} where left(zcta5,3) = {{PFX}};
insert into {STATS} (zcta5, source_key, family, clip_dim, n_components, clip_len_m,
                     clip_area_m2, comp_max_len_m, legacy_points, legacy_on_clip,
                     legacy_max_nn_m, run_id)
select b.zcta5, m.source_key, x.family,
       ST_Dimension(x.clip)::smallint,
       ST_NumGeometries(x.clip),
       case when ST_Dimension(x.clip) = 1 then ST_Length(x.clip::geography) end,
       case when ST_Dimension(x.clip) = 2 then ST_Area(x.clip::geography) end,
       comp.max_len_m, lg.legacy_points, lg.legacy_on_clip, lg.max_nn_m, {{RUN}}
  from {SCRATCH} b
  join geo.zip_authoritative_membership m on m.zcta5 = b.zcta5
  cross join lateral (
      select ST_Intersection(ST_MakeValid(ST_Union(g.geom)), b.geom) clip,
             min(ST_GeometryType(g.geom)) family
        from geo.n5_geom g
       where g.source_key = m.source_key and g.outcome = 1 and g.geom is not null
         and ST_Intersects(ST_MakeValid(g.geom), b.geom)) x
  cross join lateral (
      select max(ST_Length(d.geom::geography)) max_len_m from ST_Dump(x.clip) d) comp
  cross join lateral (
      select count(*)::int legacy_points,
             count(*) filter (where ST_DWithin(z.pt::geography, x.clip::geography, 1))::int legacy_on_clip,
             max(z.nn) max_nn_m
        from (select ST_SetSRID(ST_MakePoint(p.lng, p.lat), {CANON_SRID}) pt,
                     (select min(ST_Distance(ST_SetSRID(ST_MakePoint(p.lng,p.lat),{CANON_SRID})::geography,
                                             ST_SetSRID(ST_MakePoint(q.lng,q.lat),{CANON_SRID})::geography))
                        from public.app_projects q
                       where q.zip = b.zcta5 and q.source_key = m.source_key
                         and q.record_kind = 'development' and q.id <> p.id and q.lat is not null) nn
                from public.app_projects p
               where p.zip = b.zcta5 and p.source_key = m.source_key
                 and p.record_kind = 'development' and p.lat is not null) z) lg
 where b.prefix = {{PFX}};
"""


def main():
    prefixes = [r["z3"].strip() for r in sql(
        "select distinct left(zcta5,3) z3 from geo.zip_authoritative_membership order by 1;", "prefixes")]
    say("UNIT A3 - CLIP MEASUREMENT (no marker rule applied)", "")
    say("run id / prefixes", f"{RUN_ID} / {','.join(prefixes)}")
    free0, db0, wal0 = disk()
    say("BEFORE free disk MB", round(free0, 1))
    if free0 < FLOOR_MB:
        raise SystemExit(f"STOP: free {free0:.1f} MB already below the {FLOOR_MB} floor")
    ddl()
    sql(f"""create table if not exists {SCRATCH} (
              prefix char(3) not null, zcta5 char(5) not null,
              geom geometry(MultiPolygon,{CANON_SRID}) not null,
              primary key (prefix, zcta5));
            create index if not exists n5_a3_zcta_gix on {SCRATCH} using gist (geom);
            alter table {SCRATCH} enable row level security;""", "scratch")

    total = 0
    for pfx in prefixes:
        say("", "")
        say("=" * 56, "")
        say("PREFIX", pfx)
        t0 = time.time()
        if not load_boundaries(pfx):
            continue
        sql(MEASURE.replace("{PFX}", lit(pfx)).replace("{RUN}", lit(RUN_ID)), f"measure {pfx}")
        r = sql(f"""select count(*) n, count(*) filter (where clip_dim=1) lines,
                           count(*) filter (where clip_dim=2) polys,
                           count(*) filter (where clip_dim=0) points,
                           count(*) filter (where clip_dim is null) nullclip
                      from {STATS} where left(zcta5,3)={lit(pfx)};""", "prefix stats")[0]
        say("rows / line / polygon / point / null-clip",
            f"{r['n']} / {r['lines']} / {r['polys']} / {r['points']} / {r['nullclip']}")
        total += int(r["n"])
        free, _, _ = disk()
        say("prefix seconds / free disk MB", f"{time.time()-t0:.1f} / {free:.1f}")
        if free < FLOOR_MB:
            raise SystemExit(f"STOP: free {free:.1f} MB below the {FLOOR_MB} floor")

    sql(f"drop table if exists {SCRATCH};", "drop scratch")
    say("", "")
    say("scratch dropped", "yes")
    say("TOTAL stats rows", total)
    free1, _, _ = disk()
    say("AFTER free disk MB", round(free1, 1))


if __name__ == "__main__":
    main()
