#!/usr/bin/env python3
"""Phase 2 / B1 — authoritative Box Elder ZCTA boundary acquisition and load.

Two modes, deliberately separated so external acquisition validation never shares a
failure surface with database mutation (founder ruling 2026-09-01, "transaction
correction"):

  validate  acquire the TIGER archive, checksum it, read its own .prj, count its
            features, derive the in-scope ZCTA set, size the payload, and print
            everything. WRITES NOTHING, ANYWHERE.

  load      re-acquire, re-derive, refuse unless every recorded pre-write value is
            reproduced byte for byte, then send ONE SQL request that is ONE
            transaction: create schema, create table, insert, index, assert, commit.
            Any assertion raises, which aborts the whole transaction.

Standing rules this file exists to obey:
  * the geometry stored is the publisher's own, complete and unsimplified. No
    centroid, no radius, no generalization, no clipping.
  * the CRS comes from the archive's own .prj, never from TIGERweb (which reports
    Web Mercator because it is a display service).
  * a selection envelope chooses which files to load. It NEVER decides membership.
  * fail closed: any discrepancy stops before the write.

stdlib only. The shapefile reader is written out rather than pulled from a package so
the parse is auditable and pinned to this file.
"""

import hashlib
import io
import json
import os
import struct
import sys
import urllib.request
import zipfile

# ---------------------------------------------------------------- pinned inputs

TIGER_URL = ("https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/"
             "tl_2025_us_zcta520.zip")
TIGER_VINTAGE = "TIGER/Line 2025 (2020 Census ZCTA delineation)"

# Box Elder County's OWN Census extent, TIGERweb layer 82, EPSG:4326.
# This is a SELECTION device: it decides which polygons are downloaded into the
# database. Membership is decided later, by exact predicates against these polygons.
EXT_XMIN, EXT_YMIN, EXT_XMAX, EXT_YMAX = (
    -114.042029, 40.999896, -111.873171, 42.001515)

# The 18 canonical Box Elder ZIPs (public.communities, fingerprint below). Every one
# must survive into the loaded set or B1 stops.
CANONICAL_18 = ("84301,84302,84306,84307,84309,84311,84312,84313,84314,84316,"
                "84324,84329,84330,84331,84334,84336,84337,84340").split(",")
CANONICAL_18_FP = "7d87c66ec88a258926ecea776d1b6f50"

EXPECTED_NATIONAL_FEATURES = 33791          # TIGERweb returnCountOnly, twice
EXPECTED_INSCOPE = 56                       # TIGERweb esriSpatialRelIntersects

UA = "HomeSignal-phase2-b1/1.0 (+https://homesignal.net)"
PROJECT_REF = "qwnnmljucajnexpxdgxr"


def say(k, v):
    print(f"{k:<34} {v}", flush=True)


# ---------------------------------------------------------------- acquisition

def acquire():
    """Download the archive to memory-backed disk and checksum it. No parsing yet."""
    say("source url", TIGER_URL)
    req = urllib.request.Request(TIGER_URL, headers={"User-Agent": UA})
    h = hashlib.sha256()
    buf = io.BytesIO()
    with urllib.request.urlopen(req, timeout=900) as r:
        say("http status", r.status)
        say("content-length", r.headers.get("Content-Length"))
        say("last-modified", r.headers.get("Last-Modified"))
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            h.update(chunk)
            buf.write(chunk)
    data = buf.getvalue()
    digest = h.hexdigest()
    say("archive bytes", f"{len(data):,}")
    say("archive sha256", digest)
    return data, digest


# ---------------------------------------------------------------- shapefile

def read_dbf(raw):
    """Minimal dBase III reader. Returns (n_records, [ {field: value} ])."""
    n_rec, hdr_len, rec_len = struct.unpack_from("<IHH", raw, 4)
    fields, off = [], 32
    while raw[off] != 0x0D:
        name = raw[off:off + 11].split(b"\0")[0].decode("latin-1")
        ftype = chr(raw[off + 11])
        flen = raw[off + 16]
        fields.append((name, ftype, flen))
        off += 32
    rows = []
    for i in range(n_rec):
        base = hdr_len + i * rec_len
        p = base + 1                       # skip the deletion flag
        row = {}
        for name, _t, flen in fields:
            row[name] = raw[p:p + flen].decode("latin-1").strip()
            p += flen
        rows.append(row)
    return n_rec, [f[0] for f in fields], rows


def _signed_area(pts):
    a = 0.0
    for i in range(len(pts) - 1):
        x1, y1 = pts[i]
        x2, y2 = pts[i + 1]
        a += x1 * y2 - x2 * y1
    return a / 2.0


def read_shp(raw):
    """Minimal shapefile reader for polygon (5) and null (0) records.

    Yields (record_index, bbox, rings) in file order. Ring grouping into
    polygons is done by the caller so the orientation rule is stated once.
    """
    n = len(raw)
    off = 100                               # 100-byte file header
    idx = 0
    while off < n:
        _num, clen = struct.unpack_from(">ii", raw, off)
        off += 8
        end = off + clen * 2
        shp_type = struct.unpack_from("<i", raw, off)[0]
        if shp_type == 0:                   # null shape
            yield idx, None, []
            idx += 1
            off = end
            continue
        if shp_type != 5:
            raise SystemExit(f"unexpected shape type {shp_type} at record {idx}")
        bbox = struct.unpack_from("<4d", raw, off + 4)
        n_parts, n_pts = struct.unpack_from("<ii", raw, off + 36)
        parts = struct.unpack_from(f"<{n_parts}i", raw, off + 44)
        pbase = off + 44 + 4 * n_parts
        coords = struct.unpack_from(f"<{2 * n_pts}d", raw, pbase)
        rings = []
        for i, start in enumerate(parts):
            stop = parts[i + 1] if i + 1 < n_parts else n_pts
            rings.append([(coords[2 * j], coords[2 * j + 1])
                          for j in range(start, stop)])
        yield idx, bbox, rings
        idx += 1
        off = end


def rings_to_multipolygon_wkt(rings, geoid):
    """Group shapefile rings into polygons and emit MULTIPOLYGON WKT.

    Shapefile spec: an outer ring is clockwise (negative signed area under the
    standard convention); a ring that follows an outer ring counter-clockwise is a
    hole in it. A leading counter-clockwise ring would mean the file does not follow
    its own spec, so it stops rather than guessing.
    """
    polys = []
    for ring in rings:
        if len(ring) < 4:
            raise SystemExit(f"{geoid}: ring with {len(ring)} points")
        if ring[0] != ring[-1]:
            ring = ring + [ring[0]]
        if _signed_area(ring) < 0:          # clockwise -> outer
            polys.append([ring])
        else:                               # counter-clockwise -> hole
            if not polys:
                raise SystemExit(f"{geoid}: leading counter-clockwise ring")
            polys[-1].append(ring)
    def ring_wkt(r):
        return "(" + ",".join(f"{repr(x)} {repr(y)}" for x, y in r) + ")"
    return ("MULTIPOLYGON(" +
            ",".join("(" + ",".join(ring_wkt(r) for r in p) + ")" for p in polys) +
            ")")


def bbox_hits(bbox):
    if bbox is None:
        return False
    xmin, ymin, xmax, ymax = bbox
    return not (xmax < EXT_XMIN or xmin > EXT_XMAX or
                ymax < EXT_YMIN or ymin > EXT_YMAX)


def _seg_hits_rect(x1, y1, x2, y2):
    """Cohen-Sutherland: does the segment overlap the selection rectangle?

    An endpoint inside the rectangle counts, so this covers both a vertex inside
    the box and an edge crossing it.
    """
    def code(x, y):
        c = 0
        if x < EXT_XMIN: c |= 1
        elif x > EXT_XMAX: c |= 2
        if y < EXT_YMIN: c |= 4
        elif y > EXT_YMAX: c |= 8
        return c
    c1, c2 = code(x1, y1), code(x2, y2)
    while True:
        if not (c1 | c2):
            return True
        if c1 & c2:
            return False
        c = c1 or c2
        if c & 8:
            x = x1 + (x2 - x1) * (EXT_YMAX - y1) / (y2 - y1); y = EXT_YMAX
        elif c & 4:
            x = x1 + (x2 - x1) * (EXT_YMIN - y1) / (y2 - y1); y = EXT_YMIN
        elif c & 2:
            y = y1 + (y2 - y1) * (EXT_XMAX - x1) / (x2 - x1); x = EXT_XMAX
        else:
            y = y1 + (y2 - y1) * (EXT_XMIN - x1) / (x2 - x1); x = EXT_XMIN
        if c == c1:
            x1, y1, c1 = x, y, code(x, y)
        else:
            x2, y2, c2 = x, y, code(x, y)


def _point_in_rings(px, py, rings):
    """Even-odd ray cast across every ring, so holes subtract correctly."""
    inside = False
    for ring in rings:
        for i in range(len(ring) - 1):
            x1, y1 = ring[i]
            x2, y2 = ring[i + 1]
            if (y1 > py) != (y2 > py):
                xx = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
                if px < xx:
                    inside = not inside
    return inside


def exact_hits(rings):
    """Exact polygon-vs-rectangle intersection, in Python, so the in-scope set is
    established BEFORE the write rather than discovered by the database."""
    for ring in rings:
        r = ring if ring[0] == ring[-1] else ring + [ring[0]]
        for i in range(len(r) - 1):
            if _seg_hits_rect(r[i][0], r[i][1], r[i + 1][0], r[i + 1][1]):
                return True
    # no edge touches the box: either wholly outside, or the box is inside the polygon
    closed = [(ring if ring[0] == ring[-1] else ring + [ring[0]]) for ring in rings]
    return _point_in_rings(EXT_XMIN, EXT_YMIN, closed)


def extract(data):
    """Open the archive, read .prj verbatim, and pull the bbox-superset features."""
    zf = zipfile.ZipFile(io.BytesIO(data))
    names = zf.namelist()
    say("archive members", ", ".join(sorted(names)))
    base = next(n for n in names if n.endswith(".shp"))[:-4]

    prj = zf.read(base + ".prj").decode("latin-1").strip()
    print("----- BEGIN .prj -----")
    print(prj)
    print("----- END .prj -----", flush=True)

    dbf_raw = zf.read(base + ".dbf")
    n_rec, field_names, rows = read_dbf(dbf_raw)
    say("dbf field names", ", ".join(field_names))
    say("dbf record count", f"{n_rec:,}")

    shp_raw = zf.read(base + ".shp")
    picked, n_seen, n_bbox = [], 0, 0
    for idx, bbox, rings in read_shp(shp_raw):
        n_seen += 1
        if not bbox_hits(bbox):
            continue
        n_bbox += 1
        if not exact_hits(rings):
            continue
        row = rows[idx]
        geoid = row.get("GEOID20") or row.get("ZCTA5CE20")
        picked.append({
            "zcta5": geoid,
            "wkt": rings_to_multipolygon_wkt(rings, geoid),
            "area_m2": int(row.get("ALAND20") or 0) + int(row.get("AWATER20") or 0),
            "rings": len(rings),
            "pts": sum(len(r) for r in rings),
        })
    say("shp record count", f"{n_seen:,}")
    say("bbox candidates", f"{n_bbox:,}")
    picked.sort(key=lambda d: d["zcta5"])
    return prj, n_rec, n_seen, n_bbox, picked


# ---------------------------------------------------------------- crs

def crs_from_prj(prj):
    """Resolve the archive's own CRS. Recognises exactly the two forms TIGER ships;
    anything else stops rather than guessing a transform."""
    flat = " ".join(prj.split()).upper()
    if "GCS_NORTH_AMERICAN_1983" in flat and "D_NORTH_AMERICAN_1983" in flat:
        return 4269
    if '"NAD83"' in flat or "GCS_NAD83" in flat:
        return 4269
    return None


# ---------------------------------------------------------------- sql

def build_load_sql(picked, sha, srid):
    values = ",\n".join(
        "  ('{z}', $w{i}${wkt}$w{i}$)".format(z=p["zcta5"], i=i, wkt=p["wkt"])
        for i, p in enumerate(picked))
    areas = ",".join("('%s',%d::numeric)" % (p["zcta5"], p["area_m2"])
                     for p in picked)
    return f"""begin;

-- PostGIS lives in public; every geo object below is fully qualified, so this only
-- guarantees the geometry type and the ST_* functions resolve. Reverts at commit.
set local search_path = public;

create schema geo;

comment on schema geo is
  'Phase 2 authoritative geographic layer. Shadow only: no production consumer '
  'reads it, and it is not exposed through PostgREST.';

create table geo.zcta_boundary (
  zcta5            text primary key,
  geom             geometry(MultiPolygon, {srid}) not null,
  source_vintage   text not null,
  source_url       text not null,
  source_checksum  text not null,
  loaded_at        timestamptz not null default now()
);

insert into geo.zcta_boundary (zcta5, geom, source_vintage, source_url, source_checksum)
select v.zcta5,
       ST_GeomFromText(v.wkt, {srid}),
       '{TIGER_VINTAGE}',
       '{TIGER_URL}',
       '{sha}'
  from (values
{values}
       ) as v(zcta5, wkt)
 where ST_Intersects(
         ST_GeomFromText(v.wkt, {srid}),
         ST_MakeEnvelope({EXT_XMIN}, {EXT_YMIN}, {EXT_XMAX}, {EXT_YMAX}, {srid}));

create index zcta_boundary_geom_gix on geo.zcta_boundary using gist (geom);

analyze geo.zcta_boundary;

do $assert$
declare
  v_n int; v_fp text; v_bad int; v_srid_bad int; v_prov int; v_missing text;
  v_outside int; v_area_bad int;
begin
  select count(*) into v_n from geo.zcta_boundary;
  if v_n <> {EXPECTED_INSCOPE} then
    raise exception 'B1: row count % <> {EXPECTED_INSCOPE}', v_n;
  end if;

  select md5(string_agg(zcta5, ',' order by zcta5 collate "C")) into v_fp
    from geo.zcta_boundary;
  raise notice 'B1 loaded GEOID fingerprint: %', v_fp;

  select count(*) into v_bad from geo.zcta_boundary where not ST_IsValid(geom);
  if v_bad <> 0 then raise exception 'B1: % invalid geometries', v_bad; end if;

  select count(*) into v_srid_bad from geo.zcta_boundary where ST_SRID(geom) <> {srid};
  if v_srid_bad <> 0 then raise exception 'B1: % rows with wrong SRID', v_srid_bad; end if;

  select count(*) into v_prov from geo.zcta_boundary
   where source_vintage is null or source_url is null or source_checksum is null
      or source_checksum <> '{sha}' or loaded_at is null;
  if v_prov <> 0 then raise exception 'B1: % rows with bad provenance', v_prov; end if;

  select string_agg(z, ',') into v_missing
    from unnest(array[{','.join("'" + z + "'" for z in CANONICAL_18)}]) z
   where not exists (select 1 from geo.zcta_boundary b where b.zcta5 = z);
  if v_missing is not null then
    raise exception 'B1: canonical Box Elder ZIPs missing from load: %', v_missing;
  end if;

  -- Census's own published land+water area reproduces the loaded geometry. This is
  -- the control on ring/hole grouping: a mis-assigned hole changes area, and nothing
  -- else in this transaction would notice.
  select count(*) into v_area_bad
    from geo.zcta_boundary b
    join (values {areas}) a(zcta5, area_m2) on a.zcta5 = b.zcta5
   where a.area_m2 > 0
     and abs(ST_Area(b.geom::geography) - a.area_m2) / a.area_m2 > 0.02;
  if v_area_bad <> 0 then
    raise exception 'B1: % rows whose geometry area disagrees with the Census '
                    'published area by more than 2%%', v_area_bad;
  end if;

  -- nothing was created outside geo
  select count(*) into v_outside
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname in ('zcta_boundary','zcta_boundary_pkey','zcta_boundary_geom_gix')
     and n.nspname <> 'geo';
  if v_outside <> 0 then raise exception 'B1: % objects created outside geo', v_outside; end if;

  -- the D2 preservation guard is intact and untouched
  select count(*) into v_n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'preservation' and not t.tgisinternal;
  if v_n <> 16 then raise exception 'B1: preservation guard trigger count % <> 16', v_n; end if;
  select count(*) into v_n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'preservation' and not t.tgisinternal and t.tgenabled = 'D';
  if v_n <> 0 then raise exception 'B1: % preservation triggers disabled', v_n; end if;

  -- the production read path is byte-identical
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_projects_for_zip'
     and md5(pg_get_functiondef(p.oid)) = 'ec1b01ae4485ad2c59b9f946c9d565b6';
  if v_n <> 1 then raise exception 'B1: app_projects_for_zip changed'; end if;
  select count(*) into v_n from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip'
     and md5(pg_get_functiondef(p.oid)) = 'dfd09ac72c5b6b65e61ad597665570a0';
  if v_n <> 1 then raise exception 'B1: app_refresh_zip changed'; end if;

  raise notice 'B1: all in-transaction assertions passed';
end
$assert$;

commit;
"""


def run_sql(sql):
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": sql}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json",
                 "Accept": "application/json",
                 "User-Agent": UA},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            print(f"HTTP {r.status}")
            print("----- BEGIN RESULT -----")
            print(r.read().decode()[:20000])
            print("----- END RESULT -----")
            return 0
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}")
        print(e.read().decode()[:8000])
        return 1


# ---------------------------------------------------------------- main

def main():
    mode = os.environ.get("MODE", "validate").strip()
    say("mode", mode)
    if mode not in ("validate", "load"):
        raise SystemExit("MODE must be validate or load")

    expect_sha = os.environ.get("EXPECT_SHA256", "").strip()
    expect_fp = os.environ.get("EXPECT_GEOID_FP", "").strip()
    if mode == "load" and not (expect_sha and expect_fp):
        raise SystemExit("load mode requires EXPECT_SHA256 and EXPECT_GEOID_FP "
                         "recorded by a prior validate run")

    data, sha = acquire()
    prj, n_dbf, n_shp, n_bbox, picked = extract(data)

    srid = crs_from_prj(prj)
    say("resolved srid from .prj", srid)
    if srid is None:
        raise SystemExit("STOP: .prj is not a CRS this loader will transform from "
                         "without guessing")

    if n_dbf != n_shp:
        raise SystemExit(f"STOP: dbf {n_dbf} != shp {n_shp}")
    say("national feature count", f"{n_dbf:,}")
    if n_dbf != EXPECTED_NATIONAL_FEATURES:
        raise SystemExit(f"STOP: national feature count {n_dbf} != "
                         f"{EXPECTED_NATIONAL_FEATURES}")

    geoids = [p["zcta5"] for p in picked]
    fp = hashlib.md5(",".join(sorted(geoids)).encode()).hexdigest()
    say("in-scope features (exact)", len(picked))
    say("in-scope GEOID fingerprint", fp)
    print("----- BEGIN in-scope GEOIDs -----")
    print(",".join(sorted(geoids)))
    print("----- END in-scope GEOIDs -----")
    say("total vertices", f"{sum(p['pts'] for p in picked):,}")
    say("largest feature vertices", f"{max(p['pts'] for p in picked):,}")

    if len(picked) != EXPECTED_INSCOPE:
        raise SystemExit(f"STOP: in-scope feature count {len(picked)} != "
                         f"{EXPECTED_INSCOPE} established from TIGERweb. The "
                         f"shapefile is authoritative; report the discrepancy, do "
                         f"not adopt it silently.")

    missing = [z for z in CANONICAL_18 if z not in set(geoids)]
    say("canonical 18 fingerprint", CANONICAL_18_FP)
    say("canonical 18 missing", missing or "none")
    if missing:
        raise SystemExit("STOP: canonical Box Elder ZIPs absent from the archive "
                         "selection")

    sql = build_load_sql(picked, sha, srid)
    say("load sql bytes", f"{len(sql.encode()):,}")
    say("load sql MB", f"{len(sql.encode()) / 1048576:.2f}")

    if mode == "validate":
        print("\nVALIDATE COMPLETE — nothing was written to any database.")
        print("Record these two values and pass them back to the load run:")
        say("  EXPECT_SHA256", sha)
        say("  EXPECT_GEOID_FP", fp)
        return 0

    # ---- load: every recorded pre-write value must reproduce exactly
    if sha != expect_sha:
        raise SystemExit(f"STOP: archive sha256 {sha} != recorded {expect_sha}")
    if fp != expect_fp:
        raise SystemExit(f"STOP: GEOID-set fingerprint {fp} != recorded {expect_fp}")
    say("pre-write gates", "sha256 and GEOID fingerprint both reproduced")
    print("\nExecuting ONE transaction: schema, table, insert, index, assertions.")
    return run_sql(sql)


if __name__ == "__main__":
    sys.exit(main())
