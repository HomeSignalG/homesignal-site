"""UNIT A3 - authoritative MARKER grain: component primitives, then the marker relation.

Membership answers "does this project belong on this ZIP page" at (ZIP, source_key) and that
grain does NOT change here. A MARKER answers "where inside this ZIP is it represented", and a
membership may legitimately carry several. This driver never lets marker multiplicity touch the
membership relation.

Two modes, deliberately separate so the rule is chosen from evidence rather than alongside it:

  measure  clip authoritative geometry to the ZIP and record ONE ROW PER CLIPPED COMPONENT -
           dimension, length, area and a representative point. Primitives only; no marker rule
           is applied, so every candidate strategy can be evaluated afterwards in SQL without
           re-clipping. Writes geo.n5_a3_clip_component.

  build    apply the chosen deterministic rule and populate geo.zip_authoritative_marker, then
           prove every marker lies ON the authoritative geometry and INSIDE the ZIP while the
           boundaries are still loaded. Writes geo.zip_authoritative_marker.

Both modes re-load the TIGER boundaries into a scratch table and drop it again, because the
per-shard ZCTA slices are correctly discarded at cleanup and no ZCTA geometry is resident.

Neither mode touches public.app_projects_for_zip, public.app_projects, its indexes,
geo.zip_authoritative_membership, geo.n5_association, geo.n5_boundary_membership, geo.n5_geom,
any page, the sitemap, indexability or the workbook.

stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import lit, read_shp_polygons, rings_to_multipolygon_wkt, CANON_SRID  # noqa: E402
from n5_shard import sql, say, tiger_index  # noqa: E402

RUN_ID = os.environ.get("RUN_ID", "").strip() or f"a3m-{int(time.time())}"
MODE = os.environ.get("MARKER_MODE", "measure").strip()
FLOOR_MB = float(os.environ.get("DISK_FLOOR_MB", "2048"))
TOTAL_MB = float(os.environ.get("DISK_TOTAL_MB", "11607"))

# Marker rule parameters. Chosen from the measure pass; see UNIT-A3 evidence doc.
D_M = float(os.environ.get("MARKER_D_M", "1000"))          # max gap along a line component
MIN_LINE_M = float(os.environ.get("MARKER_MIN_LINE_M", "250"))   # sliver floor, lines
MIN_AREA_M2 = float(os.environ.get("MARKER_MIN_AREA_M2", "1000"))  # sliver floor, polygons

SCRATCH = "geo.n5_a3m_zcta"
COMP = "geo.n5_a3_clip_component"
MARK = "geo.zip_authoritative_marker"


def disk():
    r = sql("select (pg_database_size(current_database())/1048576.0) db, "
            "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;", "disk")[0]
    return TOTAL_MB - (float(r["db"]) + float(r["wal"]))


def load_boundaries(pfx):
    want = {r["zip"] for r in sql(
        "select distinct zcta5::text zip from geo.zip_authoritative_membership "
        f"where left(zcta5,3)={lit(pfx)};", "memb zips")}
    if not want:
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
        vals.append(f"({lit(pfx)},{lit(zc)},"
                    f"ST_GeomFromText($g${rings_to_multipolygon_wkt(rings, zc)}$g$,{CANON_SRID}))")
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


# One row per clipped component. The representative point is ON/IN that component by
# construction: PointOnSurface for areas, the arc-length midpoint for lines.
MEASURE = f"""
delete from {COMP} where left(zcta5,3) = {{PFX}};
insert into {COMP} (zcta5, source_key, comp_ord, family, dim, len_m, area_m2, pt_lat, pt_lng, run_id)
select b.zcta5, m.source_key,
       row_number() over (partition by b.zcta5, m.source_key
                          order by ST_Dimension(d.geom) desc,
                                   coalesce(ST_Area(d.geom::geography),0) desc,
                                   coalesce(ST_Length(d.geom::geography),0) desc,
                                   ST_AsBinary(d.geom) asc)::int,
       x.family, ST_Dimension(d.geom)::smallint,
       case when ST_Dimension(d.geom)=1 then ST_Length(d.geom::geography) end,
       case when ST_Dimension(d.geom)=2 then ST_Area(d.geom::geography) end,
       ST_Y(rp.p), ST_X(rp.p), {{RUN}}
  from {SCRATCH} b
  join geo.zip_authoritative_membership m on m.zcta5 = b.zcta5
  cross join lateral (
      select ST_Intersection(ST_MakeValid(ST_Union(g.geom)), b.geom) clip,
             min(ST_GeometryType(g.geom)) family
        from geo.n5_geom g
       where g.source_key = m.source_key and g.outcome = 1 and g.geom is not null
         and ST_Intersects(ST_MakeValid(g.geom), b.geom)) x
  cross join lateral ST_Dump(x.clip) d
  cross join lateral (
      select case when ST_Dimension(d.geom) = 2 then ST_PointOnSurface(d.geom)
                  when ST_Dimension(d.geom) = 1 then ST_LineInterpolatePoint(d.geom, 0.5)
                  else ST_PointOnSurface(d.geom) end p) rp
 where b.prefix = {{PFX}} and not ST_IsEmpty(d.geom);
"""

# THE CHOSEN RULE, expressed once, derived from the measure passes (see the A3 evidence doc).
#
#   LINE     ST_LineMerge first - the raw clip is publisher segmentation, p50 component 20.6 m,
#            and merging is lossless (6,581.0 km before and after). Keep merged components at or
#            above MIN_LINE_M, or the longest one if none qualifies, so every membership keeps a
#            marker. On each kept component place ceil(len/D) evenly spaced interior points, so
#            the gap ALONG that component never exceeds D and every point lies ON the line.
#   POLYGON  one ST_PointOnSurface per component at or above MIN_AREA_M2 (largest if none
#            qualifies). Measured: 584 of 659 multi-component memberships have parts more than
#            1 km apart, so one marker per membership would hide separate project areas.
#   POINT    the authoritative point itself.
BUILD = f"""
delete from {MARK} where left(zcta5,3) = {{PFX}};
insert into {MARK} (zcta5, source_key, marker_seq, lat, lng, marker_rule, family, dim, run_id)
with base as (
  select b.zcta5, m.source_key, x.family, x.clip
    from {SCRATCH} b
    join geo.zip_authoritative_membership m on m.zcta5 = b.zcta5
    cross join lateral (
        select ST_Intersection(ST_MakeValid(ST_Union(g.geom)), b.geom) clip,
               min(ST_GeometryType(g.geom)) family
          from geo.n5_geom g
         where g.source_key = m.source_key and g.outcome = 1 and g.geom is not null
           and ST_Intersects(ST_MakeValid(g.geom), b.geom)) x
   where b.prefix = {{PFX}}),
comp as (
  select z.zcta5, z.source_key, z.family, 1 as dim, d.geom g,
         ST_Length(d.geom::geography) measure
    from base z
    cross join lateral ST_Dump(ST_LineMerge(ST_CollectionExtract(z.clip, 2))) d
   where not ST_IsEmpty(d.geom)
  union all
  select z.zcta5, z.source_key, z.family, 2, d.geom, ST_Area(d.geom::geography)
    from base z cross join lateral ST_Dump(ST_CollectionExtract(z.clip, 3)) d
   where not ST_IsEmpty(d.geom)
  union all
  select z.zcta5, z.source_key, z.family, 0, d.geom, 0
    from base z cross join lateral ST_Dump(ST_CollectionExtract(z.clip, 1)) d
   where not ST_IsEmpty(d.geom)),
keep as (
  select c.*,
         (c.dim = 0
          or (c.dim = 1 and (c.measure >= {MIN_LINE_M}
                             or c.measure = max(case when c.dim=1 then c.measure end)
                                              over (partition by c.zcta5, c.source_key)))
          or (c.dim = 2 and (c.measure >= {MIN_AREA_M2}
                             or c.measure = max(case when c.dim=2 then c.measure end)
                                              over (partition by c.zcta5, c.source_key)))) as keep_it
    from comp c),
placed as (
  select k.zcta5, k.source_key, k.family, k.dim, k.measure, k.g, gs.i,
         greatest(1, ceil(k.measure / {D_M})::int) as n_on_comp
    from keep k
    cross join lateral generate_series(
        0, case when k.dim = 1 then greatest(1, ceil(k.measure / {D_M})::int) - 1 else 0 end) gs(i)
   where k.keep_it),
pt as (
  select p.*,
         case when p.dim = 1 then ST_LineInterpolatePoint(p.g, (p.i + 0.5) / p.n_on_comp::float8)
              when p.dim = 2 then ST_PointOnSurface(p.g)
              else p.g end as mp
    from placed p)
select zcta5, source_key,
       row_number() over (partition by zcta5, source_key
                          order by dim desc, measure desc, ST_AsBinary(g) asc, i asc)::int,
       ST_Y(mp), ST_X(mp),
       case when dim = 1 then 'LINE_MERGED_COMPONENT_INTERVAL_{{DTAG}}M'
            when dim = 2 then 'POLYGON_COMPONENT_POINT_ON_SURFACE'
            else 'POINT_AUTHORITATIVE' end,
       family, dim::smallint, {{RUN}}
  from pt;
"""


# Are the 51,219 line "components" real disconnected corridors, or just publisher
# segmentation? ST_LineMerge stitches contiguous segments into maximal connected LineStrings.
# The answer decides whether a per-component marker rule is meaningful at all.
MERGED = """
delete from geo.n5_a3_merged_component where left(zcta5,3) = {PFX};
insert into geo.n5_a3_merged_component (zcta5, source_key, comp_ord, dim, len_m, pt_lat, pt_lng, run_id)
select b.zcta5, m.source_key,
       row_number() over (partition by b.zcta5, m.source_key
                          order by ST_Length(d.geom::geography) desc, ST_AsBinary(d.geom) asc)::int,
       ST_Dimension(d.geom)::smallint, ST_Length(d.geom::geography),
       ST_Y(ST_LineInterpolatePoint(d.geom,0.5)), ST_X(ST_LineInterpolatePoint(d.geom,0.5)), {RUN}
  from geo.n5_a3m_zcta b
  join geo.zip_authoritative_membership m on m.zcta5 = b.zcta5
  cross join lateral (
      select ST_LineMerge(ST_CollectionExtract(
               ST_Intersection(ST_MakeValid(ST_Union(g.geom)), b.geom), 2)) clip
        from geo.n5_geom g
       where g.source_key = m.source_key and g.outcome = 1 and g.geom is not null
         and ST_Intersects(ST_MakeValid(g.geom), b.geom)) x
  cross join lateral ST_Dump(x.clip) d
 where b.prefix = {PFX} and not ST_IsEmpty(d.geom) and ST_Dimension(d.geom) = 1;
"""


# Benchmark. Timed SERVER-SIDE so network latency is excluded, one row per (ZIP, pass).
# The project half and the marker half are timed separately, then together, because they are
# different questions: only the project half has to touch public.app_projects.
BENCH_FN = """
create table if not exists geo.n5_a3_bench (
  zip char(5) not null, pass_no int not null, n_keys int,
  ms_project double precision, rows_project int,
  ms_marker double precision, rows_marker int,
  ms_combined double precision, run_id text not null,
  measured_at timestamptz not null default now(),
  primary key (zip, pass_no));
alter table geo.n5_a3_bench enable row level security;
revoke all on geo.n5_a3_bench from public;

create or replace function geo.n5_a3_bench_one(p_zip text, p_pass int, p_run text)
returns void language plpgsql as $fn$
declare t0 timestamptz; t1 timestamptz; t2 timestamptz; t3 timestamptz;
        rp int; rm int; nk int;
begin
  select count(*) into nk from geo.zip_authoritative_membership where zcta5 = p_zip;
  t0 := clock_timestamp();
  select jsonb_array_length(geo.n5_a3_projects_one_pass(p_zip)) into rp;
  t1 := clock_timestamp();
  select count(*) into rm from geo.zip_authoritative_marker where zcta5 = p_zip;
  t2 := clock_timestamp();
  perform geo.n5_a3_projects_one_pass(p_zip);
  perform count(*) from geo.zip_authoritative_marker where zcta5 = p_zip;
  t3 := clock_timestamp();
  insert into geo.n5_a3_bench (zip, pass_no, n_keys, ms_project, rows_project,
                               ms_marker, rows_marker, ms_combined, run_id)
  values (p_zip, p_pass, nk,
          extract(epoch from (t1-t0))*1000, rp,
          extract(epoch from (t2-t1))*1000, rm,
          extract(epoch from (t3-t2))*1000, p_run)
  on conflict (zip, pass_no) do update set
    n_keys=excluded.n_keys, ms_project=excluded.ms_project, rows_project=excluded.rows_project,
    ms_marker=excluded.ms_marker, rows_marker=excluded.rows_marker,
    ms_combined=excluded.ms_combined, run_id=excluded.run_id, measured_at=now();
end $fn$;
revoke all on function geo.n5_a3_bench_one(text,int,text) from public;
"""


def bench():
    """All 346 cutover candidates, two passes. No extrapolation: every ZIP is executed."""
    sql(BENCH_FN, "bench harness")
    zips = [r["zip"].strip() for r in sql(
        "select zip::text zip from geo.maps_zip_geography_status "
        "where note like '%cutover flag cleared 2026-09-03%' order by zip;", "346 zips")]
    say("ZIPs to benchmark", len(zips))
    if len(zips) != 346:
        raise SystemExit(f"STOP: expected 346 cutover candidates, found {len(zips)}")
    for p in (1, 2):
        say("PASS", f"{p} ({'cold-ish' if p == 1 else 'warm/repeat'})")
        t0 = time.time()
        for i in range(0, len(zips), 2):
            chunk = zips[i:i + 2]
            sql(";".join(f"select geo.n5_a3_bench_one({lit(z)},{p},{lit(RUN_ID)})" for z in chunk) + ";",
                f"bench p{p} {chunk[0]}")
            if (i // 2) % 25 == 0:
                say("  progress", f"{min(i+2, len(zips))}/{len(zips)}  {time.time()-t0:.0f}s")
        say(f"PASS {p} wall seconds", round(time.time() - t0, 1))
    for row in sql("""select pass_no, count(*) n, round((sum(ms_project)/1000.0)::numeric,1) total_s,
                 round(percentile_disc(0.5) within group (order by ms_project)::numeric,1) p50,
                 round(percentile_disc(0.95) within group (order by ms_project)::numeric,1) p95,
                 round(percentile_disc(0.99) within group (order by ms_project)::numeric,1) p99,
                 round(max(ms_project)::numeric,1) mx,
                 round(max(ms_marker)::numeric,2) marker_mx
               from geo.n5_a3_bench group by pass_no order by pass_no;""", "summary"):
        say(f"pass {row['pass_no']}: n / total_s / p50 / p95 / p99 / max / marker_max",
            f"{row['n']} / {row['total_s']} / {row['p50']} / {row['p95']} / "
            f"{row['p99']} / {row['mx']} / {row['marker_mx']}")


def prefixes():
    """Prefixes to (re)build, honouring an optional explicit PREFIXES restriction.

    WHY the restriction exists, and it is a production-safety property rather than a
    convenience: build mode is `delete ... where left(zcta5,3)=PFX` followed by an
    insert, so while a prefix is being rebuilt its ZIPs momentarily carry ZERO markers.
    public.app_authoritative_projects_for_zip raises on "marker count != relation count"
    and never falls back to legacy - correctly, that is the fail-closed contract - so
    rebuilding a prefix that is already production_geography_verified would make those
    live ZIP pages ERROR for the width of the rebuild.

    Passing PREFIXES keeps a batch off ZIPs that are already serving. Unset it and the
    behaviour is exactly as before (every membership prefix), so nothing existing moves.

    A named prefix carrying no membership rows is a HARD ERROR, not a silent skip: a
    restriction that selects nothing looks exactly like one that worked.
    """
    live = [r["z3"].strip() for r in sql(
        "select distinct left(zcta5,3) z3 from geo.zip_authoritative_membership order by 1;", "prefixes")]
    want = [p.strip() for p in os.environ.get("PREFIXES", "").split(",") if p.strip()]
    if not want:
        return live
    missing = [p for p in want if p not in live]
    if missing:
        raise SystemExit(
            "STOP: PREFIXES names prefixes with no zip_authoritative_membership rows: "
            + ",".join(missing))
    say("PREFIXES restriction", f"{len(want)} of {len(live)} membership prefixes")
    return [p for p in live if p in want]


def ensure_scratch():
    sql(f"""create table if not exists {SCRATCH} (
              prefix char(3) not null, zcta5 char(5) not null,
              geom geometry(MultiPolygon,{CANON_SRID}) not null,
              primary key (prefix, zcta5));
            create index if not exists n5_a3m_zcta_gix on {SCRATCH} using gist (geom);
            alter table {SCRATCH} enable row level security;""", "scratch")


def main():
    say("UNIT A3 - MARKER GRAIN", MODE)
    say("run id", RUN_ID)
    free0 = disk()
    say("BEFORE free disk MB", round(free0, 1))
    if free0 < FLOOR_MB:
        raise SystemExit(f"STOP: free {free0:.1f} MB already below the {FLOOR_MB} floor")

    if MODE == "measure":
        sql(f"""create table if not exists {COMP} (
                  zcta5 char(5) not null, source_key text not null, comp_ord int not null,
                  family text, dim smallint,
                  len_m double precision, area_m2 double precision,
                  pt_lat double precision not null, pt_lng double precision not null,
                  run_id text not null, computed_at timestamptz not null default now(),
                  primary key (zcta5, source_key, comp_ord));
                alter table {COMP} enable row level security;
                revoke all on {COMP} from public;""", "component table")
        stmt, tbl = MEASURE, COMP
    elif MODE == "build":
        sql(f"""create table if not exists {MARK} (
                  zcta5 char(5) not null, source_key text not null, marker_seq int not null,
                  lat double precision not null, lng double precision not null,
                  marker_rule text not null, family text, dim smallint,
                  run_id text not null, computed_at timestamptz not null default now(),
                  primary key (zcta5, source_key, marker_seq));
                alter table {MARK} enable row level security;
                revoke all on {MARK} from public;""", "marker table")
        stmt, tbl = BUILD, MARK
        say("rule parameters D_M / MIN_LINE_M / MIN_AREA_M2", f"{D_M} / {MIN_LINE_M} / {MIN_AREA_M2}")
    elif MODE == "measure-merged":
        sql("""create table if not exists geo.n5_a3_merged_component (
                 zcta5 char(5) not null, source_key text not null, comp_ord int not null,
                 dim smallint, len_m double precision,
                 pt_lat double precision, pt_lng double precision,
                 run_id text not null, computed_at timestamptz not null default now(),
                 primary key (zcta5, source_key, comp_ord));
               alter table geo.n5_a3_merged_component enable row level security;
               revoke all on geo.n5_a3_merged_component from public;""", "merged table")
        stmt, tbl = MERGED, "geo.n5_a3_merged_component"
    elif MODE == "bench":
        bench()
        say("AFTER free disk MB", round(disk(), 1))
        return
    elif MODE == "bench":
        bench()
        say("AFTER free disk MB", round(disk(), 1))
        return
    else:
        raise SystemExit(f"STOP: unknown MARKER_MODE {MODE!r}")

    ensure_scratch()
    total = 0
    for pfx in prefixes():
        say("PREFIX", pfx)
        t0 = time.time()
        if not load_boundaries(pfx):
            continue
        sql(stmt.replace("{PFX}", lit(pfx)).replace("{RUN}", lit(RUN_ID))
                .replace("{DTAG}", str(int(D_M))), f"{MODE} {pfx}")
        n = int(sql(f"select count(*) n from {tbl} where left(zcta5,3)={lit(pfx)};", "n")[0]["n"])
        total += n
        free = disk()
        say("rows / seconds / free MB", f"{n} / {time.time()-t0:.1f} / {free:.1f}")
        if free < FLOOR_MB:
            raise SystemExit(f"STOP: free {free:.1f} MB below the {FLOOR_MB} floor")

    if MODE == "build":
        # Prove it while the boundaries are still loaded: every marker inside its ZIP.
        r = sql(f"""select count(*) n,
                      count(*) filter (where not ST_Intersects(
                        ST_SetSRID(ST_MakePoint(k.lng,k.lat),{CANON_SRID}), b.geom)) outside
                      from {MARK} k join {SCRATCH} b on b.zcta5 = k.zcta5;""", "containment")[0]
        say("markers checked / OUTSIDE their ZIP", f"{r['n']} / {r['outside']}")
        if int(r["outside"]) != 0:
            raise SystemExit("STOP: markers outside their ZIP")

    sql(f"drop table if exists {SCRATCH};", "drop scratch")
    say("scratch dropped", "yes")
    say("TOTAL rows", total)
    say("AFTER free disk MB", round(disk(), 1))


if __name__ == "__main__":
    main()
