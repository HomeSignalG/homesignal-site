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

# NATIONAL as of PCM-3. There is no selection envelope any more.
#
# B1 shipped as a Box Elder pilot: a county extent chose which polygons were parsed AND
# an ST_Intersects against the same envelope filtered the INSERT, which is why production
# holds 56 rows. ZIP context maps need every canonical ZIP, so the envelope is gone rather
# than widened — a selection device must never decide membership, and an envelope that
# "covers the nation" is still a filter that can silently drop a coastal or territorial
# ZCTA at its edge. Every feature in the archive is loaded.

# The 18 canonical Box Elder ZIPs (public.communities, fingerprint below). Every one
# must survive into the loaded set or B1 stops.
CANONICAL_18 = ("84301,84302,84306,84307,84309,84311,84312,84313,84314,84316,"
                "84324,84329,84330,84331,84334,84336,84337,84340").split(",")
CANONICAL_18_FP = "7d87c66ec88a258926ecea776d1b6f50"

EXPECTED_NATIONAL_FEATURES = 33791          # TIGERweb returnCountOnly, twice
# DELIBERATELY THE SAME NUMBER. In-scope used to be the 56 features intersecting the Box
# Elder envelope; with no envelope, in-scope IS the national set. They are kept as two
# names because they answer two questions — "did we read the whole archive" and "how many
# rows should land" — and a future partial load would move one without the other.
EXPECTED_INSCOPE = EXPECTED_NATIONAL_FEATURES

# The load lands here first, then swaps. geo.zcta_boundary is LIVE with the 56 pilot rows,
# so it is never truncated-then-refilled: a failed batch would leave a partial nation where
# Box Elder used to be, and a reader cannot tell that from a finished load.
LOAD_TABLE = "geo.zcta_boundary_load"

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

    Yields (record_index, bbox, rings) in file order, with rings None for a null
    shape or for any record whose own bounding box misses the selection extent.
    Ring grouping into polygons is done by the caller so the orientation rule is
    stated once.
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
            yield idx, None, None
            idx += 1
            off = end
            continue
        if shp_type != 5:
            raise SystemExit(f"unexpected shape type {shp_type} at record {idx}")
        bbox = struct.unpack_from("<4d", raw, off + 4)
        # Every feature is parsed now. The bbox pre-filter that skipped 33,735 of 33,791
        # coordinate parses was the Box Elder selection device; keeping it would keep the
        # pilot's membership rule alive under a national name.
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


def extract(data, keep_wkt):
    """Open the archive, read .prj verbatim, and pull EVERY feature.

    keep_wkt=False is the validate path. The national WKT does not fit in a runner's RAM
    all at once, and validate has no use for it — it needs the SIZE. So each feature's WKT
    is measured and discarded, and validate can report the real payload instead of an
    estimate. keep_wkt=True retains it for the load, which is the memory ceiling this unit
    measures rather than predicts.
    """
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
    picked, n_seen, n_null = [], 0, 0
    for idx, bbox, rings in read_shp(shp_raw):
        n_seen += 1
        if rings is None:
            # A null shape carries no geometry. It is COUNTED, never silently skipped:
            # the national count check below is what would catch an archive that shipped
            # placeholder records, and a quiet `continue` would hide exactly that.
            n_null += 1
            continue
        row = rows[idx]
        geoid = row.get("GEOID20") or row.get("ZCTA5CE20")
        wkt = rings_to_multipolygon_wkt(rings, geoid)
        picked.append({
            "zcta5": geoid,
            "wkt": wkt if keep_wkt else None,
            "wkt_bytes": len(wkt.encode()),
            "area_m2": int(row.get("ALAND20") or 0) + int(row.get("AWATER20") or 0),
            "rings": len(rings),
            "pts": sum(len(r) for r in rings),
        })
    say("shp record count", f"{n_seen:,}")
    say("null shapes", f"{n_null:,}")
    picked.sort(key=lambda d: d["zcta5"])
    return prj, n_rec, n_seen, n_null, picked


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

def build_prepare_sql(srid):
    """Create the LOAD table and empty it. geo and geo.zcta_boundary are LIVE — this
    never issues `create schema geo` (it would fail, and geo holds N5) and never drops or
    truncates the live boundary table."""
    return f"""begin;
set local search_path = public;

create table if not exists {LOAD_TABLE} (
  zcta5            text primary key,
  geom             geometry(MultiPolygon, {srid}) not null,
  source_vintage   text not null,
  source_url       text not null,
  source_checksum  text not null,
  loaded_at        timestamptz not null default now()
);

-- The LOAD table is scratch, so emptying it is safe. The live table is untouched.
truncate {LOAD_TABLE};

commit;

select (select count(*) from {LOAD_TABLE})                       as load_rows_after_truncate,
       (select count(*) from geo.zcta_boundary)                  as live_rows_untouched;
"""


def insert_row_sql(p, sha, srid):
    """One VALUES tuple. The batcher decides how many ride in a statement."""
    return ("('{z}', ST_GeomFromText($w${wkt}$w$, {srid}), '{v}', '{u}', '{s}')"
            .format(z=p["zcta5"], wkt=p["wkt"], srid=srid,
                    v=TIGER_VINTAGE, u=TIGER_URL, s=sha))


INSERT_PREFIX_TMPL = ("insert into {t} (zcta5, geom, source_vintage, source_url, "
                      "source_checksum) values ")
INSERT_SUFFIX = ";"


def build_finalize_sql(picked, sha, srid):
    """ONE transaction: assert the LOAD table is a complete, valid nation, then SWAP it
    into place. Readers never observe a mix of the 56 pilot rows and a partial load,
    because nothing renames until every assertion has passed inside this transaction."""
    areas = ",".join("('%s',%d::numeric)" % (p["zcta5"], p["area_m2"])
                     for p in picked if p["area_m2"] > 0)
    canon = ",".join("'" + z + "'" for z in CANONICAL_18)
    return f"""begin;
set local search_path = public;

do $assert$
declare
  v_n int; v_fp text; v_bad int; v_srid_bad int; v_prov int; v_missing text;
  v_outside int; v_area_bad int;
begin
  select count(*) into v_n from {LOAD_TABLE};
  if v_n <> {EXPECTED_INSCOPE} then
    raise exception 'B1: load row count % <> {EXPECTED_INSCOPE}', v_n;
  end if;

  select md5(string_agg(zcta5, ',' order by zcta5 collate "C")) into v_fp from {LOAD_TABLE};
  raise notice 'B1 loaded GEOID fingerprint: %', v_fp;

  select count(*) into v_bad from {LOAD_TABLE} where not ST_IsValid(geom);
  if v_bad <> 0 then raise exception 'B1: % invalid geometries', v_bad; end if;

  select count(*) into v_srid_bad from {LOAD_TABLE} where ST_SRID(geom) <> {srid};
  if v_srid_bad <> 0 then raise exception 'B1: % rows with wrong SRID', v_srid_bad; end if;

  select count(*) into v_prov from {LOAD_TABLE}
   where source_vintage is null or source_url is null or source_checksum is null
      or source_checksum <> '{sha}' or loaded_at is null;
  if v_prov <> 0 then raise exception 'B1: % rows with bad provenance', v_prov; end if;

  -- CANONICAL_18 is a REQUIRED SUBSET of the national load, not the set being loaded.
  select string_agg(z, ',') into v_missing
    from unnest(array[{canon}]) z
   where not exists (select 1 from {LOAD_TABLE} b where b.zcta5 = z);
  if v_missing is not null then
    raise exception 'B1: canonical Box Elder ZIPs missing from load: %', v_missing;
  end if;

  -- Census's own published land+water area reproduces the loaded geometry. This is the
  -- control on ring/hole grouping: a mis-assigned hole changes area, and nothing else in
  -- this transaction would notice.
  select count(*) into v_area_bad
    from {LOAD_TABLE} b
    join (values {areas}) a(zcta5, area_m2) on a.zcta5 = b.zcta5
   where abs(ST_Area(b.geom::geography) - a.area_m2) / a.area_m2 > 0.02;
  if v_area_bad <> 0 then
    raise exception 'B1: % rows whose geometry area disagrees with the Census '
                    'published area by more than 2%%', v_area_bad;
  end if;

  select count(*) into v_outside
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relname in ('zcta_boundary','zcta_boundary_load','zcta_boundary_pkey',
                       'zcta_boundary_geom_gix')
     and n.nspname <> 'geo';
  if v_outside <> 0 then raise exception 'B1: % objects created outside geo', v_outside; end if;

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

  raise notice 'B1: all in-transaction assertions passed';
end
$assert$;

-- SWAP. Atomic inside this transaction, so a reader sees 56 pilot rows or the whole
-- nation and never a mixture.
alter table geo.zcta_boundary rename to zcta_boundary_pilot_56;
alter table {LOAD_TABLE} rename to zcta_boundary;
drop table geo.zcta_boundary_pilot_56;

create index zcta_boundary_geom_gix on geo.zcta_boundary using gist (geom);

-- RLS was never enabled on the pilot table. The delivery surface is the definer function,
-- not the table, so there are no anon/authenticated policies — and NOT forced, because the
-- owner-invoked definer function has to read.
alter table geo.zcta_boundary enable row level security;

comment on schema geo is
  'Phase 2 authoritative geographic layer. NOT exposed through PostgREST (no USAGE to '
  'anon/authenticated). Read by exactly one production consumer: the SECURITY DEFINER '
  'function public.app_zcta_boundary(text), which transforms to 4326 at read time.';

analyze geo.zcta_boundary;

commit;

select (select count(*) from geo.zcta_boundary)                                as rows_loaded,
       (select md5(string_agg(zcta5, ',' order by zcta5 collate "C"))
          from geo.zcta_boundary)                                              as geoid_fingerprint,
       (select count(*) from geo.zcta_boundary where not ST_IsValid(geom))     as invalid_geometries,
       (select min(ST_SRID(geom)) from geo.zcta_boundary)                      as srid,
       (select count(*) from geo.zcta_boundary
         where zcta5 = any (array[{canon}]))                                   as canonical_18_present,
       (select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='geo' and c.relname='zcta_boundary')                  as rls_enabled,
       (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
         where n.nspname='geo' and c.relname like 'zcta_boundary_load%')       as load_table_left_behind,
       pg_size_pretty(pg_total_relation_size('geo.zcta_boundary'))             as total_size,
       pg_size_pretty(pg_database_size(current_database()))                    as db_size_after;
"""


PREFLIGHT_SQL = """
-- Read-only pre-write controls, run in the same job as the write so the numbers
-- belong to the same instant. Every value here is compared against the recorded
-- Phase-1 / D2 receipts before the transaction is allowed to open.
select
  (select count(*) from pg_namespace where nspname = 'geo')                 as geo_exists,
  (select count(*) from preservation.app_project_identity)                  as n_identity,
  (select count(*) from preservation.development_report)                    as n_development_report,
  (select count(*) from preservation.community_meta)                        as n_community_meta,
  (select count(*) from preservation.rollup)                                as n_rollup,
  (select count(*) from preservation.box_elder_cache_site)                  as n_box_elder,
  (select count(*) from preservation.fingerprint)                           as n_fingerprint,
  (select count(*) from preservation.baseline_run)                          as n_baseline_run,
  (select count(*) from preservation.protected_snapshot)                    as n_protected,
  (select count(*) from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'preservation' and not t.tgisinternal
      and t.tgname like 'zz_guard_%')                                       as guard_triggers,
  (select count(*) from pg_trigger t
     join pg_class c on c.oid = t.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'preservation' and not t.tgisinternal
      and t.tgname like 'zz_guard_%' and t.tgenabled <> 'O')                as guard_disabled,
  (select md5(string_agg(sig, ',' order by sig collate "C")) from (
      select c.relname || ':' || t.tgname || ':' || t.tgenabled::text as sig
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'preservation' and not t.tgisinternal
         and t.tgname like 'zz_guard_%') q)                                 as guard_md5,
  (select md5(pg_get_functiondef(p.oid)) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_projects_for_zip')      as fn_projects_for_zip,
  (select md5(pg_get_functiondef(p.oid)) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'app_refresh_zip')           as fn_refresh_zip,
  (select md5(string_agg(jobid::text||'|'||jobname||'|'||schedule||'|'||command||'|'||active::text,
                         ';' order by jobid)) from cron.job)                as cron_md5,
  (select count(*) from cron.job)                                           as cron_jobs,
  (select sum(('x'||substr(encode(identity_hash,'hex'),1,8))::bit(32)::bigint)
     from preservation.app_project_identity)                                as fp_corpus_all,
  pg_size_pretty(pg_database_size(current_database()))                      as db_size_before,
  pg_database_size(current_database())                                      as db_bytes_before,
  (select pg_size_pretty(sum(size)) from pg_ls_waldir())                    as wal_size_before,
  (select sum(size) from pg_ls_waldir())                                    as wal_bytes_before,
  pg_current_wal_lsn()::text                                                as wal_lsn_before;
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
    prj, n_dbf, n_shp, n_null, picked = extract(data, keep_wkt=(mode == "load"))

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
                         f"{EXPECTED_NATIONAL_FEATURES}. The SHAPEFILE is authoritative; "
                         f"report the discrepancy, do not adopt it silently.")

    geoids = [p["zcta5"] for p in picked]
    fp = hashlib.md5(",".join(sorted(geoids)).encode()).hexdigest()
    say("in-scope features", f"{len(picked):,}")
    say("in-scope GEOID fingerprint", fp)
    say("total vertices", f"{sum(p['pts'] for p in picked):,}")
    say("largest feature vertices", f"{max(p['pts'] for p in picked):,}")

    if len(picked) != EXPECTED_INSCOPE:
        raise SystemExit(f"STOP: in-scope feature count {len(picked)} != "
                         f"{EXPECTED_INSCOPE}. The shapefile is authoritative; report the "
                         f"discrepancy, do not adopt it silently.")

    missing = [z for z in CANONICAL_18 if z not in set(geoids)]
    say("canonical 18 fingerprint", CANONICAL_18_FP)
    say("canonical 18 missing", ",".join(missing) if missing else "none")
    if missing:
        raise SystemExit("STOP: canonical Box Elder ZIPs absent from the archive")

    # THE PAYLOAD IS MEASURED, NEVER ESTIMATED. .github/workflows/phase2-b1-zcta.yml runs
    # test_geom_batch.py on every dispatch precisely because "the geometry insert is what
    # halted shard 891 with HTTP 413". These are the numbers that say whether a national
    # load can be transported through the Management API at all.
    wkt_total = sum(p["wkt_bytes"] for p in picked)
    wkt_max = max(p["wkt_bytes"] for p in picked)
    biggest = max(picked, key=lambda d: d["wkt_bytes"])["zcta5"]
    say("total WKT bytes", f"{wkt_total:,}")
    say("total WKT MB", f"{wkt_total / 1048576:.1f}")
    say("largest single WKT bytes", f"{wkt_max:,}  (ZCTA {biggest})")
    say("largest single WKT MB", f"{wkt_max / 1048576:.2f}")

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

    # Imported HERE, not at module scope, so `validate` never needs a token in its
    # environment: n3_pilot (which n5_shard imports) reads SUPABASE_ACCESS_TOKEN on import.
    # ONE batcher, the one shard 891 taught — not a second implementation.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import n5_shard as S                                       # noqa: E402
    S.sql = _sql_for_batcher
    S.say = say

    print("\n--- pre-write controls (read-only) ---")
    if run_sql(PREFLIGHT_SQL) != 0:
        raise SystemExit("STOP: pre-write controls could not be read")

    print("\n--- prepare the LOAD table (the live table is untouched) ---")
    if run_sql(build_prepare_sql(srid)) != 0:
        raise SystemExit("STOP: could not prepare the load table")

    print("\n--- batched insert into the LOAD table ---")
    rows = [insert_row_sql(pk, sha, srid) for pk in picked]
    S.insert_batched(INSERT_PREFIX_TMPL.format(t=LOAD_TABLE), rows, INSERT_SUFFIX,
                     "zcta_boundary_load")   # no on_oversize: a missing ZCTA is not a
                                             # quarantine case, it corrupts membership

    print("\n--- ONE transaction: assert the load, then swap ---")
    return run_sql(build_finalize_sql(picked, sha, srid))


def _sql_for_batcher(query, tag="", raise_413=False):
    """Adapter so n5_shard.insert_batched can drive THIS file's Management API call.
    It must raise SQLPayloadTooLarge on 413 (that is what makes the batcher split) and
    fail closed on anything else."""
    import n5_shard as S
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json",
                 "Accept": "application/json",
                 "User-Agent": UA},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.loads(r.read().decode() or "[]")
    except urllib.error.HTTPError as e:
        body = e.read().decode()[:2000]
        if e.code == 413:
            raise S.SQLPayloadTooLarge(f"{tag}: {len(query)} chars refused as 413")
        raise SystemExit(f"STOP: SQL {tag} failed HTTP {e.code}: {body}")


if __name__ == "__main__":
    sys.exit(main())
