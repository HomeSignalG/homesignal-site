#!/usr/bin/env python3
"""N3 - the bounded project->ZIP association-build pilot. ZIP3 786 only.

N2C left one build-level unknown: the real association yield per project. This
pilot measures it on one prefix instead of discovering it at national cost.

Two network phases run here, because the sandbox has no egress:

  n3-zcta      acquire the authoritative TIGER ZCTA archive, extract ONLY the 37
               pilot ZCTA polygons by exact GEOID match, and load them into a
               disposable scratch table. The seven non-ZCTA pilot ZIPs get no
               polygon and no substitute - that is the point of Step 3.
  n3-recover   recover authoritative POLYLINE geometry for the 454 frozen TxDOT
               projects, preserving publisher feature multiplicity. The stored
               coordinate for these projects is a connector-DERIVED point, never
               the publisher's own geometry, so it is not used for membership.

The association build itself is pure SQL and is not run from here.

Nothing in this file touches public.app_projects, public.development_reports, the
Maps read path, cron, or the registry. Every write lands in `geo`.

stdlib only.
"""

import hashlib
import io
import json
import os
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

UA = "HomeSignal-n3/1.0 (+https://homesignal.net)"
PROJECT_REF = "qwnnmljucajnexpxdgxr"
SNAPSHOT = "phase1-2026-09-01"
BATCH_KEY = "786"
DERIVATION_VERSION = 1
CANON_SRID = 4269                    # the archive's own CRS, both sides. No transform.

TIGER_URL = ("https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/"
             "tl_2025_us_zcta520.zip")
TIGER_SHA256 = "e87129634eefe8719ef06ce4cfdf6588520be2e359360e590aaae90e4afb1911"
EXPECTED_NATIONAL_FEATURES = 33791

# The 37 ZCTA-matched pilot ZIPs, and the 7 that have no ZCTA. Both lists are
# ACCEPTED CONTROLS: the run stops rather than loading a different set.
PILOT_ZCTA = ("78602,78605,78608,78610,78611,78612,78613,78615,78616,78617,78619,"
              "78620,78621,78626,78628,78633,78634,78639,78640,78641,78642,78645,"
              "78650,78652,78653,78654,78657,78659,78660,78664,78665,78666,78669,"
              "78672,78674,78676,78681").split(",")
PILOT_NON_ZCTA = "78627,78630,78646,78667,78673,78682,78691".split(",")
EXPECT_ZCTA, EXPECT_NON_ZCTA, EXPECT_CANON = 37, 7, 44

TXDOT_RID = "txdot-projects-info-all"
TXDOT_URL = ("https://services.arcgis.com/KTcxiTD9dsQw4r7Z/arcgis/rest/services/"
             "TxDOT_Projects_Info_All/FeatureServer/0")
TXDOT_IDENT = "CONTROL_SECT_JOB"
EXPECT_TXDOT_PROJECTS = 454

IN_BATCH = 30
TIMEOUT = 120
POLITE = 0.3

STATS = {"requests": 0, "request_errors": 0, "retries": 0, "bytes_in": 0}


def say(k, v):
    print(f"{k:<46} {v}", flush=True)


def sql(query, tag=""):
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": UA}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"STOP: SQL {tag} failed HTTP {e.code}\n{e.read().decode()[:3000]}")


def http(url, params=None, method="GET", timeout=TIMEOUT):
    STATS["requests"] += 1
    try:
        if method == "POST":
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode(params or {}).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded",
                         "User-Agent": UA, "Accept": "application/json"}, method="POST")
        else:
            if params:
                url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
        STATS["bytes_in"] += len(raw)
        return json.loads(raw.decode("utf-8", "replace")), None
    except urllib.error.HTTPError as e:
        STATS["request_errors"] += 1
        return None, f"HTTP_{e.code}"
    except Exception as e:
        STATS["request_errors"] += 1
        return None, f"{type(e).__name__} {str(e)[:70]}"


def esri(j):
    if isinstance(j, dict) and "error" in j:
        e = j["error"]
        return f"ESRI_{e.get('code')} {str(e.get('message'))[:70]}"
    return None


def lit(v):
    return "'" + str(v).replace("'", "''") + "'"


# ------------------------------------------------------------------ shapefile

def read_dbf(raw):
    n_rec, hdr_len, rec_len = struct.unpack("<IHH", raw[4:12])
    fields, off = [], 32
    while raw[off] != 0x0D:
        f = raw[off:off + 32]
        fields.append((f[:11].split(b"\0")[0].decode("ascii", "replace"), f[16]))
        off += 32
    out = []
    for i in range(n_rec):
        base = hdr_len + i * rec_len
        if raw[base:base + 1] == b"*":
            out.append(None)
            continue
        pos, row = 1, {}
        for nm, ln in fields:
            row[nm] = raw[base + pos:base + pos + ln].decode("latin-1").strip()
            pos += ln
        out.append(row)
    return n_rec, [f[0] for f in fields], out


def read_shp_polygons(raw, wanted_idx):
    """Yield (record_index, rings) for the wanted record indices only. Polygon
    records (type 5) only; anything else stops rather than being reinterpreted."""
    off, idx, out = 100, 0, {}
    n = len(raw)
    while off < n:
        _, clen = struct.unpack_from(">ii", raw, off)
        rec = off + 8
        if idx in wanted_idx:
            st = struct.unpack_from("<i", raw, rec)[0]
            if st == 0:
                out[idx] = None
            elif st != 5:
                raise SystemExit(f"STOP: shape type {st} at record {idx}, expected polygon")
            else:
                nparts, npts = struct.unpack_from("<ii", raw, rec + 36)
                parts = list(struct.unpack_from("<%di" % nparts, raw, rec + 44))
                pbase = rec + 44 + 4 * nparts
                pts = struct.unpack_from("<%dd" % (2 * npts), raw, pbase)
                rings = []
                for k in range(nparts):
                    a = parts[k]
                    b = parts[k + 1] if k + 1 < nparts else npts
                    rings.append([(pts[2 * j], pts[2 * j + 1]) for j in range(a, b)])
                out[idx] = rings
        off = rec + clen * 2
        idx += 1
    return out, idx


# ONE definition of the shapefile ring convention, imported from the B1 loader
# rather than re-derived here.
#
# WHY: the first version of this file re-derived it and INVERTED it - it treated a
# negative (clockwise) signed area as a HOLE, when the shapefile spec makes clockwise
# the OUTER ring. On single-ring ZCTAs that is invisible; on the two multi-ring ones
# in this prefix it attached a second outer part to the previous polygon as a hole and
# produced invalid geometry. The load guard caught it (35 valid of 37) and stopped
# before anything downstream read it, but the real fix is not to have two definitions
# of the same convention. B1's has been correct across 56 loaded polygons.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from phase2_b1_zcta import rings_to_multipolygon_wkt as _b1_rings_to_wkt   # noqa: E402


def rings_to_multipolygon_wkt(rings, geoid):
    return _b1_rings_to_wkt(rings, geoid)


# ------------------------------------------------------------------ DDL

DDL = """
create schema if not exists geo;

create table if not exists geo.n3_batch (
  derivation_version smallint    not null,
  batch_key          text        not null,
  phase              text        not null,
  detail             jsonb,
  updated_at         timestamptz not null default now(),
  primary key (derivation_version, batch_key, phase)
);

create table if not exists geo.n3_zcta_scratch (
  zcta5 char(5) primary key,
  geom  geometry(MultiPolygon, 4269) not null,
  rings int not null,
  pts   int not null
);

create table if not exists geo.n3_source_geometry (
  source_key     text     not null,
  registry_id    text     not null,
  feature_id     bigint   not null,
  outcome        smallint not null,
  geom           geometry(MultiLineString, 4269),
  requested_srid int      not null,
  returned_srid  int,
  invalid_reason text,
  primary key (source_key, feature_id),
  constraint n3_geom_outcome_semantics check (
    (outcome = 1 and geom is not null and invalid_reason is null) or
    (outcome = 2 and geom is null) or
    (outcome = 3 and invalid_reason is not null))
);

-- P1: the optimised association row. Three columns, one index (the primary key),
-- coded evidence. Nothing else: everything explanatory lives in n3_provenance,
-- one row per (registry, treatment), not per association.
create table if not exists geo.n3_association (
  source_key text     not null,
  zip        char(5)  not null,
  evidence   smallint not null,
  primary key (source_key, zip, evidence),
  constraint n3_evidence_vocab check (evidence in (1,2,3,4))
);

create table if not exists geo.n3_provenance (
  batch_key      text  not null,
  registry_id    text  not null,
  treatment      text  not null,
  evidence_basis text  not null,
  detail         jsonb not null,
  primary key (batch_key, registry_id, treatment, evidence_basis)
);

alter table geo.n3_batch           enable row level security;
alter table geo.n3_zcta_scratch    enable row level security;
alter table geo.n3_source_geometry enable row level security;
alter table geo.n3_association     enable row level security;
alter table geo.n3_provenance      enable row level security;

revoke all on geo.n3_batch, geo.n3_zcta_scratch, geo.n3_source_geometry,
              geo.n3_association, geo.n3_provenance
  from public, anon, authenticated, service_role;
"""


def mode_zcta():
    say("mode", "n3-zcta (pilot boundary acquisition)")
    say("batch key", BATCH_KEY)
    if len(PILOT_ZCTA) != EXPECT_ZCTA or len(PILOT_NON_ZCTA) != EXPECT_NON_ZCTA:
        raise SystemExit("STOP: pilot ZIP control lists do not match the accepted counts")
    say("pilot ZCTA-matched ZIPs", f"{len(PILOT_ZCTA)} (expect {EXPECT_ZCTA})")
    say("pilot non-ZCTA ZIPs", f"{len(PILOT_NON_ZCTA)} (expect {EXPECT_NON_ZCTA}) "
                              + ",".join(PILOT_NON_ZCTA))

    t0 = time.time()
    req = urllib.request.Request(TIGER_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=1800) as r:
        blob = r.read()
    sha = hashlib.sha256(blob).hexdigest()
    say("archive bytes", f"{len(blob):,}")
    say("archive sha256", sha)
    if sha != TIGER_SHA256:
        raise SystemExit(f"STOP: TIGER sha256 changed. expected {TIGER_SHA256}")
    say("sha256 matches the B1/N2A pin", "yes")
    say("download seconds", round(time.time() - t0, 1))

    zf = zipfile.ZipFile(io.BytesIO(blob))
    base = next(n for n in zf.namelist() if n.endswith(".shp"))[:-4]
    prj = zf.read(base + ".prj").decode("latin-1").strip()
    flat = " ".join(prj.split()).upper()
    if "NORTH_AMERICAN_1983" not in flat and "NAD83" not in flat:
        raise SystemExit("STOP: unexpected .prj; refusing to guess a CRS")
    say("archive CRS", f"NAD83 -> EPSG:{CANON_SRID} (from the archive's own .prj)")

    n_rec, fields, rows = read_dbf(zf.read(base + ".dbf"))
    say("dbf records", f"{n_rec:,} (expect {EXPECTED_NATIONAL_FEATURES:,})")
    if n_rec != EXPECTED_NATIONAL_FEATURES:
        raise SystemExit("STOP: national feature count moved")

    want = {}
    for i, row in enumerate(rows):
        if row is None:
            continue
        g = row.get("GEOID20") or row.get("ZCTA5CE20")
        if g in PILOT_ZCTA:
            want[i] = g
    say("pilot polygons located in the .dbf", f"{len(want)} (expect {EXPECT_ZCTA})")
    if len(want) != EXPECT_ZCTA:
        missing = sorted(set(PILOT_ZCTA) - set(want.values()))
        raise SystemExit(f"STOP: {len(missing)} pilot ZCTAs absent from TIGER: {missing}")
    for z in PILOT_NON_ZCTA:
        if z in {r.get("GEOID20") for r in rows if r}:
            raise SystemExit(f"STOP: {z} was classed non-ZCTA but TIGER carries it")
    say("non-ZCTA control", "0 of 7 appear in TIGER - no polygon exists to load")

    geoms, n_seen = read_shp_polygons(zf.read(base + ".shp"), set(want))
    say("shp records scanned", f"{n_seen:,}")
    picked = []
    for i, g in sorted(want.items(), key=lambda kv: kv[1]):
        rings = geoms.get(i)
        if not rings:
            raise SystemExit(f"STOP: {g} has no polygon geometry in the .shp")
        picked.append({"zcta5": g, "wkt": rings_to_multipolygon_wkt(rings, g),
                       "rings": len(rings), "pts": sum(len(r) for r in rings)})
    say("polygons extracted", len(picked))
    say("total vertices", f"{sum(p['pts'] for p in picked):,}")
    fp = hashlib.md5(",".join(p["zcta5"] for p in picked).encode()).hexdigest()
    say("pilot ZCTA set md5", fp)

    say("ddl", "creating geo.n3_* if absent (RLS on, 0 grants)")
    sql(DDL, "n3 ddl")
    # The scratch table is a P3 disposable and this mode is the only writer, so a
    # reload replaces it wholesale. ON CONFLICT DO NOTHING would silently keep a
    # previous run's rows, which is exactly how a bad geometry survives a fix.
    sql("delete from geo.n3_zcta_scratch;", "zcta reset")

    # tranched: network is already finished, and no single statement is huge
    total = 0
    for k in range(0, len(picked), 6):
        chunk = picked[k:k + 6]
        vals = ",".join(
            "('{z}', ST_GeomFromText($w{i}${wkt}$w{i}$, {s}), {r}, {p})".format(
                z=c["zcta5"], i=k + j, wkt=c["wkt"], s=CANON_SRID, r=c["rings"], p=c["pts"])
            for j, c in enumerate(chunk))
        sql(f"""insert into geo.n3_zcta_scratch (zcta5, geom, rings, pts)
                values {vals}
                on conflict (zcta5) do nothing;""", f"zcta load {k}")
        total += len(chunk)
        say("  loaded", f"{total}/{len(picked)}")

    r = sql("""select count(*) n, count(*) filter (where ST_IsValid(geom)) v,
                      md5(string_agg(zcta5, ',' order by zcta5 collate "C")) fp,
                      pg_size_pretty(pg_total_relation_size('geo.n3_zcta_scratch')) sz
                 from geo.n3_zcta_scratch;""", "zcta verify")[0]
    say("loaded polygons", r["n"])
    say("valid polygons", r["v"])
    say("loaded set md5", r["fp"] + ("  MATCH" if r["fp"] == fp else "  MISMATCH"))
    say("scratch size", r["sz"])
    if r["n"] != EXPECT_ZCTA or r["v"] != EXPECT_ZCTA or r["fp"] != fp:
        raise SystemExit("STOP: loaded ZCTA set does not reproduce the extracted set")
    sql(f"""insert into geo.n3_batch (derivation_version, batch_key, phase, detail)
            values ({DERIVATION_VERSION}, '{BATCH_KEY}', 'zcta_loaded',
                    '{{"polygons":{EXPECT_ZCTA},"sha256":"{sha}","set_md5":"{fp}"}}'::jsonb)
            on conflict (derivation_version, batch_key, phase)
            do update set detail = excluded.detail, updated_at = now();""", "batch state")
    print("\nN3 ZCTA PHASE COMPLETE - 37 polygons loaded, 7 non-ZCTA ZIPs left without one.")


# ------------------------------------------------------------------ recovery

def paths_to_multilinestring_wkt(paths):
    parts = [p for p in paths if p and len(p) >= 2]
    if not parts:
        return None
    return ("MULTILINESTRING(" + ",".join(
        "(" + ",".join(f"{repr(pt[0])} {repr(pt[1])}" for pt in p) + ")"
        for p in parts) + ")")


def mode_recover():
    say("mode", "n3-recover (TxDOT authoritative POLYLINE recovery)")
    say("registry", TXDOT_RID)
    say("identity field", TXDOT_IDENT)
    say("requested outSR", CANON_SRID)

    rows = sql(f"""select distinct source_key
                     from preservation.app_project_identity
                    where snapshot_id='{SNAPSHOT}' and record_kind='development'
                      and registry_id='{TXDOT_RID}' and zip like '{BATCH_KEY}%'
                    order by source_key;""", "txdot frozen")
    keys = [r["source_key"] for r in rows]
    csj = [k.split(":", 2)[2] for k in keys]
    say("frozen TxDOT projects", f"{len(keys)} (expect {EXPECT_TXDOT_PROJECTS})")
    if len(keys) != EXPECT_TXDOT_PROJECTS:
        raise SystemExit("STOP: frozen TxDOT project count moved")

    meta, why = http(TXDOT_URL, {"f": "json"})
    if meta is None or esri(meta):
        raise SystemExit(f"STOP: TxDOT layer metadata unreachable: {why or esri(meta)}")
    say("publisher geometryType", meta.get("geometryType"))
    say("publisher maxRecordCount", meta.get("maxRecordCount"))
    if meta.get("geometryType") != "esriGeometryPolyline":
        raise SystemExit("STOP: publisher is not a polyline layer; refusing to proceed")
    ftype = {f.get("name"): f.get("type") for f in (meta.get("fields") or [])}
    if TXDOT_IDENT not in ftype:
        raise SystemExit(f"STOP: {TXDOT_IDENT} absent from the live layer")
    numeric = str(ftype[TXDOT_IDENT]).endswith(("Integer", "Double", "Single", "OID"))
    say("identity field type", f"{ftype[TXDOT_IDENT]} -> {'unquoted' if numeric else 'quoted'}")

    ctl, why = http(TXDOT_URL + "/query",
                    {"where": "1=1", "returnCountOnly": "true", "f": "json"}, "POST")
    e = why or esri(ctl)
    if e or not (ctl or {}).get("count"):
        raise SystemExit(f"STOP: positive control failed ({e or 'count 0'}) - "
                         "a zero below would be the instrument, not the publisher")
    say("POSITIVE CONTROL where=1=1", f"{ctl['count']:,} features")

    oid_f = meta.get("objectIdField") or "OBJECTID"
    got = {}                       # source_key -> [(feature_id, wkt_or_None, srid)]
    errors = []
    feats_total = 0
    for i in range(0, len(csj), IN_BATCH):
        chunk = csj[i:i + IN_BATCH]
        vals = ",".join(c if numeric else lit(c) for c in chunk)
        time.sleep(POLITE)
        j, why = http(TXDOT_URL + "/query", {
            "where": f"{TXDOT_IDENT} IN ({vals})",
            "outFields": f"{oid_f},{TXDOT_IDENT}",
            "returnGeometry": "true", "outSR": str(CANON_SRID), "f": "json"}, "POST")
        e = why or esri(j)
        if e:
            errors.append(f"batch {i//IN_BATCH}: {e}")
            say(f"  batch {i//IN_BATCH:2d}", f"ERROR {e}")
            continue
        srid = ((j.get("spatialReference") or {}).get("wkid")
                or (j.get("spatialReference") or {}).get("latestWkid"))
        feats = j.get("features") or []
        feats_total += len(feats)
        for f in feats:
            a = f.get("attributes") or {}
            c = str(a.get(TXDOT_IDENT))
            fid = a.get(oid_f)
            g = f.get("geometry") or {}
            wkt = paths_to_multilinestring_wkt(g.get("paths") or [])
            got.setdefault(f"arcgis:{TXDOT_RID}:{c}", []).append((fid, wkt, srid))
        say(f"  batch {i//IN_BATCH:2d}", f"{len(chunk)} ids -> {len(feats)} features, srid {srid}")

    say("publisher requests", STATS["requests"])
    say("features returned", feats_total)
    say("projects reconnected", f"{len(got)} of {len(keys)}")
    say("batch errors", len(errors))
    for e in errors:
        say("  error", e)

    # SRID discipline: validate in the SR the server ACTUALLY returned.
    srids = {s for v in got.values() for (_, _, s) in v}
    say("returned SRIDs", sorted(x for x in srids if x is not None))
    if srids - {CANON_SRID, None}:
        raise SystemExit(f"STOP: publisher returned a SR we did not request: {srids}")

    sql(DDL, "n3 ddl")
    loaded = with_geom = no_geom = 0
    batch = []
    def flush(b):
        if not b:
            return
        vals = ",".join(b)
        sql(f"""insert into geo.n3_source_geometry
                  (source_key, registry_id, feature_id, outcome, geom,
                   requested_srid, returned_srid, invalid_reason)
                values {vals}
                on conflict (source_key, feature_id) do nothing;""", "geom load")
    for sk, feats in sorted(got.items()):
        for fid, wkt, srid in feats:
            if wkt is None:
                no_geom += 1
                batch.append("('{sk}','{r}',{f},2,NULL,{q},{s},NULL)".format(
                    sk=sk.replace("'", "''"), r=TXDOT_RID, f=int(fid),
                    q=CANON_SRID, s=srid if srid else "NULL"))
            else:
                with_geom += 1
                batch.append(
                    "('{sk}','{r}',{f},1,ST_GeomFromText($g${wkt}$g$,{q})::geometry(MultiLineString,{q}),{q},{s},NULL)".format(
                        sk=sk.replace("'", "''"), r=TXDOT_RID, f=int(fid), wkt=wkt,
                        q=CANON_SRID, s=srid if srid else "NULL"))
            loaded += 1
            if len(batch) >= 40:
                flush(batch); batch = []
                say("  loaded features", loaded)
    flush(batch)

    r = sql("""select count(*) n,
                      count(*) filter (where outcome=1) g,
                      count(*) filter (where outcome=2) ng,
                      count(distinct source_key) proj,
                      coalesce(sum(ST_NPoints(geom)),0) pts,
                      count(*) filter (where geom is not null and not ST_IsValid(geom)) invalid,
                      pg_size_pretty(pg_total_relation_size('geo.n3_source_geometry')) sz
                 from geo.n3_source_geometry where registry_id='%s';""" % TXDOT_RID,
            "geom verify")[0]
    say("stored features", r["n"])
    say("  with geometry", r["g"])
    say("  no geometry", r["ng"])
    say("  invalid geometry", r["invalid"])
    say("distinct projects with geometry", r["proj"])
    say("total vertices", f"{int(r['pts']):,}")
    say("source-geometry table size", r["sz"])
    say("bytes downloaded", f"{STATS['bytes_in']:,}")

    sql(f"""insert into geo.n3_batch (derivation_version, batch_key, phase, detail)
            values ({DERIVATION_VERSION}, '{BATCH_KEY}', 'geometry_recovered',
              '{{"requests":{STATS['requests']},"features":{feats_total},
                 "projects":{len(got)},"errors":{len(errors)}}}'::jsonb)
            on conflict (derivation_version, batch_key, phase)
            do update set detail = excluded.detail, updated_at = now();""", "batch state")
    print("\nN3 RECOVERY PHASE COMPLETE - publisher multiplicity preserved, "
          "no representative point used.")


def main():
    m = os.environ.get("MODE", "").strip()
    if m == "n3-zcta":
        return mode_zcta()
    if m == "n3-recover":
        return mode_recover()
    raise SystemExit("MODE must be n3-zcta or n3-recover")


if __name__ == "__main__":
    sys.exit(main() or 0)
