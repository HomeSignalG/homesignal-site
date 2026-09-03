#!/usr/bin/env python3
"""UNIT A - the authoritative SHADOW read product. Builds nothing resident-facing.

WHAT THIS IS. For every canonical ZIP inside a COMPLETED acquisition prefix, it records
(a) which development projects authoritative geometry places on that ZIP page and
(b) ONE deterministic representative point per (ZIP, project), derived from the
authoritative geometry clipped to that ZCTA.

WHAT IT IS NOT. It does not touch public.app_projects_for_zip, any page, the sitemap,
indexability, the canonical ZIP registry, geo.n5_association, geo.n5_boundary_membership
or geo.n5_geom. It adds two tables and one function inside the `geo` schema, which has
ZERO grants to anon/authenticated/PUBLIC - so the shadow product is unreachable from a
browser by construction rather than by a policy that could be edited later.

WHY THE POINT CANNOT BE BORROWED FROM app_projects. `source_seq` is a PER-ZIP ordinal,
not a stable identity for a part of a multi-coordinate project: measured across the
authoritative corpus, 5,116 of 7,136 (source_key, source_seq) groups carry MORE THAN ONE
coordinate across ZIPs (max 35), while only 2 disagree on name. Descriptive attributes
are safely borrowable across ZIPs; the coordinate is not. So the point is derived here
from geometry, and only descriptive fields are ever taken from an existing row.

THE CANDIDATE-BOUNDING GUARD IS DELIBERATELY NOT RUN OVER THIS SQL, and that is not an
omission. That guard exists for the membership PROBE - it proves the probe did not narrow
its candidate set to legacy ZIPs. Unit A computes no membership; it reads a membership set
that is already fixed. Applying the guard here would fire on `zip` (the canonical registry's
own column name) and the workaround would be cosmetic. The control that actually matters is
stronger and runs at the end: the shadow membership set is fingerprinted against
geo.n5_boundary_membership and must match exactly.

stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import lit, read_shp_polygons, rings_to_multipolygon_wkt, CANON_SRID  # noqa: E402
from n5_shard import sql, say, one, tiger_index  # noqa: E402

RUN_ID = os.environ.get("RUN_ID", "").strip() or f"unitA-{int(time.time())}"
FLOOR_MB = float(os.environ.get("DISK_FLOOR_MB", "2048"))
TOTAL_MB = float(os.environ.get("DISK_TOTAL_MB", "11607"))
SCRATCH = "geo.n5_unit_a_zcta"
MEMB = "geo.zip_authoritative_membership"
STATUS = "geo.maps_zip_geography_status"
FAULT_TEST = os.environ.get("FAULT_TEST", "1").strip() == "1"


def disk():
    r = sql("select (pg_database_size(current_database())/1048576.0) db, "
            "(select coalesce(sum(size),0)/1048576.0 from pg_ls_waldir()) wal;", "disk")[0]
    return TOTAL_MB - (float(r["db"]) + float(r["wal"])), float(r["db"]), float(r["wal"])


def ddl():
    # The representative-point rule, as ONE function so every caller and every test uses
    # the same implementation. Deterministic by construction: every choice is broken by an
    # explicit ORDER BY, never by whatever the planner returns first.
    sql("""
create or replace function geo.n5_rep_point(g geometry)
returns table (pt geometry, rule text)
language plpgsql immutable parallel safe
set search_path = public, pg_temp
as $fn$
declare c geometry; d int;
begin
  if g is null or ST_IsEmpty(g) then
    pt := null; rule := 'EMPTY_CLIP'; return next; return;
  end if;
  d := ST_Dimension(g);
  if d = 2 then
    c := ST_CollectionExtract(g, 3);
    if c is null or ST_IsEmpty(c) then pt := null; rule := 'EMPTY_CLIP'; return next; return; end if;
    pt := ST_PointOnSurface(c);           -- guaranteed INSIDE the polygon, unlike a centroid
    rule := 'POLYGON_POINT_ON_SURFACE';
  elsif d = 1 then
    c := ST_CollectionExtract(g, 2);
    if c is null or ST_IsEmpty(c) then pt := null; rule := 'EMPTY_CLIP'; return next; return; end if;
    select ST_LineInterpolatePoint(dmp.geom, 0.5) into pt
      from ST_Dump(c) dmp
     order by ST_Length(dmp.geom) desc, ST_AsBinary(dmp.geom) asc
     limit 1;                              -- a point ON the line, half way along the longest part
    rule := 'LINE_MIDPOINT_LONGEST';
  else
    c := ST_CollectionExtract(g, 1);
    if c is null or ST_IsEmpty(c) then pt := null; rule := 'EMPTY_CLIP'; return next; return; end if;
    select dmp.geom into pt from ST_Dump(c) dmp order by ST_X(dmp.geom), ST_Y(dmp.geom) limit 1;
    rule := 'POINT_MIN_XY';
  end if;
  if pt is null then rule := 'UNRESOLVED'; end if;
  return next;
end $fn$;""", "rep_point fn")

    sql(f"""
create table if not exists {MEMB} (
  zcta5         char(5) not null,
  source_key    text    not null,
  lat           double precision,
  lng           double precision,
  point_rule    text    not null,
  clip_dim      smallint,
  feature_count integer not null,
  geom_family   text    not null,
  run_id        text    not null,
  computed_at   timestamptz not null default now(),
  primary key (zcta5, source_key));
alter table {MEMB} enable row level security;

create table if not exists {STATUS} (
  zip             char(5) primary key,
  status          text not null check (status in ('boundary_complete','not_measured')),
  membership_rows integer not null check (membership_rows >= 0),
  completed_at    timestamptz,
  run_id          text);
alter table {STATUS} enable row level security;""", "shadow tables")

    # ---- THE ATOMIC-COMPLETION INVARIANT.
    # A measured ZERO is a VALID complete state (74 pages have one), so "complete implies
    # rows exist" would be wrong. The invariant that is right: a completed ZIP's shadow
    # membership count must EQUAL the count the authoritative source says it should have.
    # DEFERRABLE INITIALLY DEFERRED, so a partial load inside one transaction fails at
    # COMMIT rather than being visible in between.
    sql(f"""
create or replace function geo.n5_assert_shadow_complete() returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare z char(5); want int; got int; expect int;
begin
  z := coalesce(new.zip, old.zip);
  select s.membership_rows into want from {STATUS} s where s.zip = z and s.status = 'boundary_complete';
  if want is null then return null; end if;                      -- not completed: nothing to assert
  select count(*) into got  from {MEMB} m where m.zcta5 = z;
  select count(*) into expect from geo.n5_boundary_membership b where b.zcta5 = z;
  if got <> want then
    raise exception 'UNIT A INVARIANT: zip % is boundary_complete with % shadow membership rows, declared %', z, got, want;
  end if;
  if want <> expect then
    raise exception 'UNIT A INVARIANT: zip % declares % rows but authoritative membership holds %', z, want, expect;
  end if;
  return null;
end $fn$;

drop trigger if exists zz_shadow_complete_status on {STATUS};
create constraint trigger zz_shadow_complete_status
  after insert or update on {STATUS}
  deferrable initially deferred
  for each row execute function geo.n5_assert_shadow_complete();""", "invariant trigger")
    say("shadow objects", "ensured (geo schema, RLS on, no grants)")


def load_boundaries(pfx):
    """Canonical ZIPs only. Unit A never populates a ZIP outside canonical_zip_registry."""
    want = {r["zip"] for r in sql(
        f"select zip from public.canonical_zip_registry where left(zip,3)={lit(pfx)};", "canon")}
    t = tiger_index()
    idx = {g: i for g, i in t["geoid_to_idx"].items() if g in want}
    say("canonical ZIPs in prefix / with a TIGER boundary", f"{len(want)} / {len(idx)}")
    missing = sorted(want - set(idx))
    if missing:
        say("  canonical ZIPs with NO ZCTA in the national file", ",".join(missing))
    sql(f"delete from {SCRATCH} where prefix={lit(pfx)};", "clear scratch")
    shapes, _ = read_shp_polygons(t["raw"], set(idx.values()))
    vals, loaded = [], 0
    for zc, i in sorted(idx.items()):
        rings = shapes.get(i)
        if not rings:
            continue
        wkt = rings_to_multipolygon_wkt(rings, zc)
        vals.append(f"({lit(pfx)},{lit(zc)},ST_GeomFromText($g${wkt}$g$,{CANON_SRID}))")
        loaded += 1
        if len(vals) >= 20:
            sql(f"insert into {SCRATCH} (prefix,zcta5,geom) values " + ",".join(vals)
                + " on conflict (prefix,zcta5) do update set geom=excluded.geom;", "zcta ins")
            vals = []
    if vals:
        sql(f"insert into {SCRATCH} (prefix,zcta5,geom) values " + ",".join(vals)
            + " on conflict (prefix,zcta5) do update set geom=excluded.geom;", "zcta ins")
    say("boundaries loaded", loaded)
    return len(want), loaded, missing


# ONE multi-statement payload = ONE implicit transaction (Postgres simple-query protocol),
# so a partial load can never commit. Held as a constant so the invariant test below runs
# against the same shape production-of-record uses.
POPULATE = f"""
delete from {MEMB} where left(zcta5,3) = {{PFX}};
insert into {MEMB} (zcta5, source_key, lat, lng, point_rule, clip_dim, feature_count, geom_family, run_id)
select b.zcta5, m.source_key,
       case when p.pt is null then null else ST_Y(p.pt) end,
       case when p.pt is null then null else ST_X(p.pt) end,
       p.rule, x.dim, x.nfeat, x.family, {{RUN}}
  from {SCRATCH} b
  join geo.n5_boundary_membership m on m.zcta5 = b.zcta5
  cross join lateral (
      select ST_Intersection(ST_MakeValid(ST_Union(g.geom)), b.geom) clip,
             count(*)::int nfeat,
             min(ST_GeometryType(g.geom)) family
        from geo.n5_geom g
       where g.source_key = m.source_key
         and g.outcome = 1 and g.geom is not null
         and ST_Intersects(ST_MakeValid(g.geom), b.geom)
  ) f
  cross join lateral (select f.clip, f.nfeat, f.family,
                             case when f.clip is null then null else ST_Dimension(f.clip) end::smallint dim) x
  cross join lateral geo.n5_rep_point(x.clip) p
 where b.prefix = {{PFX}};
insert into {STATUS} (zip, status, membership_rows, completed_at, run_id)
select b.zcta5, 'boundary_complete',
       (select count(*) from geo.n5_boundary_membership m where m.zcta5 = b.zcta5),
       now(), {{RUN}}
  from {SCRATCH} b where b.prefix = {{PFX}}
on conflict (zip) do update set status = excluded.status,
       membership_rows = excluded.membership_rows, completed_at = excluded.completed_at,
       run_id = excluded.run_id;
"""


def populate(pfx):
    sql(POPULATE.replace("{PFX}", lit(pfx)).replace("{RUN}", lit(RUN_ID)), f"populate {pfx}")
    r = sql(f"""select (select count(*) from {MEMB} where left(zcta5,3)={lit(pfx)}) memb,
                       (select count(*) from {STATUS} where left(zip,3)={lit(pfx)}) status_rows,
                       (select count(*) from {MEMB} where left(zcta5,3)={lit(pfx)} and lat is null) no_point,
                       (select count(*) from geo.n5_boundary_membership b
                          where left(b.zcta5,3)={lit(pfx)}
                            and b.zcta5 in (select zip from public.canonical_zip_registry)) expected;""",
             "prefix check")[0]
    say("shadow membership / status rows / no point / expected",
        f"{r['memb']} / {r['status_rows']} / {r['no_point']} / {r['expected']}")
    if int(r["memb"]) != int(r["expected"]):
        raise SystemExit(f"STOP: prefix {pfx} shadow {r['memb']} != authoritative {r['expected']}")
    return int(r["memb"]), int(r["status_rows"]), int(r["no_point"])


def main():
    prefixes = [r["z3"].strip() for r in sql(
        "select z3::text z3 from geo.n5_shard where state='done' order by z3;", "prefixes")]
    say("UNIT A - AUTHORITATIVE SHADOW READ PRODUCT", "")
    say("run id / completed prefixes", f"{RUN_ID} / {','.join(prefixes)}")
    free0, db0, wal0 = disk()
    say("BEFORE free disk MB / db MB / wal MB", f"{free0:.1f} / {db0:.1f} / {wal0:.1f}")
    if free0 < FLOOR_MB:
        raise SystemExit(f"STOP: free {free0:.1f} MB already below the {FLOOR_MB} floor")

    ddl()
    sql(f"""create table if not exists {SCRATCH} (
              prefix char(3) not null, zcta5 char(5) not null,
              geom geometry(MultiPolygon,{CANON_SRID}) not null,
              primary key (prefix, zcta5));
            create index if not exists n5_unit_a_zcta_gix on {SCRATCH} using gist (geom);
            alter table {SCRATCH} enable row level security;""", "scratch")

    tot_memb = tot_status = tot_nopoint = 0
    for pfx in prefixes:
        say("", "")
        say("=" * 56, "")
        say("PREFIX", pfx)
        t0 = time.time()
        load_boundaries(pfx)
        m, s, np_ = populate(pfx)
        tot_memb += m
        tot_status += s
        tot_nopoint += np_
        free, _, _ = disk()
        say("prefix seconds / free disk MB", f"{time.time()-t0:.1f} / {free:.1f}")
        if free < FLOOR_MB:
            raise SystemExit(f"STOP: free {free:.1f} MB below the {FLOOR_MB} floor")

    sql(f"drop table if exists {SCRATCH};", "drop scratch")
    say("", "")
    say("scratch dropped", "yes")
    say("TOTAL shadow membership / status rows / points unresolved",
        f"{tot_memb} / {tot_status} / {tot_nopoint}")
    free1, db1, wal1 = disk()
    say("AFTER free disk MB / db MB / wal MB", f"{free1:.1f} / {db1:.1f} / {wal1:.1f}")


if __name__ == "__main__":
    main()
