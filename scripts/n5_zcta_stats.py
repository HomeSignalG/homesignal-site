#!/usr/bin/env python3
"""PART 2 - measure the national ZCTA geometry distribution. Read-only, nothing persisted.

The ~1.18 GB national boundary estimate rested on 56 rural UT/ID polygons; a second
sample of 90 Austin-metro TX + suburban MD differed by 1.43x, and neither covers dense
north-eastern urban ZCTAs or Alaska. Two samples that disagree do not bracket a
population - they only prove the population is not uniform. This measures the whole
pinned TIGER file instead.

It parses the shapefile as a STREAM and counts vertices without materialising a single
coordinate: 33,791 polygons at ~2,000 points each is ~67M points, which as Python floats
would cost gigabytes and measure nothing extra. The record header carries numParts and
numPoints, so the count is exact and the coordinates are skipped.

NOTHING IS WRITTEN. No database connection is opened, no boundary is loaded, no table is
touched - the whole point is to size the cost of loading boundaries before deciding
whether to load any.

stdlib only.
"""
import hashlib
import io
import os
import struct
import sys
import time
import urllib.request
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import TIGER_URL, TIGER_SHA256, UA  # noqa: E402

EXPECTED_FEATURES = 33791
# Measured bytes-per-vertex, from three independent live samples of real stored geometry
# (2026-09-02): zcta_boundary UT/ID 16.022 - n3_zcta_scratch TX/MD 16.038 - ctdot
# polygons 16.490. PostGIS stores geometry uncompressed (pg_column_size 34,936 vs
# ST_MemSize 34,939 on the same rows), so this is on-disk cost, not an in-memory figure.
BPV_LOW, BPV_HIGH = 16.022, 16.490
GIST_BYTES_PER_ROW = 42.0     # measured on geo.n5_geom_gix at 732,927 rows
HEAP_BYTES_PER_ROW = 195.8    # measured on geo.n5_geom heap at 732,927 rows


def say(k, v):
    print(f"{k:<52} {v}", flush=True)


def pct(sorted_vals, p):
    if not sorted_vals:
        return 0
    i = min(len(sorted_vals) - 1, int(round((p / 100.0) * (len(sorted_vals) - 1))))
    return sorted_vals[i]


def main():
    t0 = time.time()
    say("N5 PART 2 - NATIONAL ZCTA GEOMETRY MEASUREMENT", "")
    req = urllib.request.Request(TIGER_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=1800) as r:
        blob = r.read()
    sha = hashlib.sha256(blob).hexdigest()
    if sha != TIGER_SHA256:
        raise SystemExit(f"STOP: TIGER sha256 changed; expected {TIGER_SHA256} got {sha}")
    say("archive bytes", f"{len(blob):,}")
    say("sha256 matches the B1/N2A/N3/N4/N5 pin", "yes")

    zf = zipfile.ZipFile(io.BytesIO(blob))
    base = next(n for n in zf.namelist() if n.endswith(".shp"))[:-4]
    shp = zf.read(base + ".shp")
    dbf_n = struct.unpack("<I", zf.read(base + ".dbf")[4:8])[0]
    say("shapefile .shp bytes (in archive, uncompressed)", f"{len(shp):,}")
    say("dbf record count", f"{dbf_n:,}")

    # ---- stream the .shp: read each record's header, take numParts/numPoints, skip on.
    off, feats = 100, []
    parts_total = 0
    content_bytes = 0
    shape_types = {}
    while off + 8 <= len(shp):
        _rec_no, clen_words = struct.unpack(">II", shp[off:off + 8])
        clen = clen_words * 2
        body = off + 8
        stype = struct.unpack("<i", shp[body:body + 4])[0]
        shape_types[stype] = shape_types.get(stype, 0) + 1
        if stype == 5:                       # Polygon: box(32) numParts(4) numPoints(4)
            nparts, npts = struct.unpack("<ii", shp[body + 36:body + 44])
        elif stype == 0:                     # Null shape
            nparts, npts = 0, 0
        else:
            raise SystemExit(f"STOP: unexpected shape type {stype} at record offset {off}")
        feats.append(npts)
        parts_total += nparts
        content_bytes += clen
        off = body + clen

    n = len(feats)
    say("features parsed", f"{n:,}")
    if n != EXPECTED_FEATURES or dbf_n != EXPECTED_FEATURES:
        raise SystemExit(f"STOP: feature count moved: shp {n}, dbf {dbf_n}")
    say("shape types seen", shape_types)
    say("rings (parts) total", f"{parts_total:,}")
    say("source .shp geometry content bytes", f"{content_bytes:,}")

    tot = sum(feats)
    s = sorted(feats)
    say("", "")
    say("TOTAL VERTICES", f"{tot:,}")
    say("mean vertices/feature", round(tot / n, 1))
    for label, p in (("median (p50)", 50), ("p75", 75), ("p90", 90), ("p95", 95), ("p99", 99)):
        say(f"{label} vertices/feature", f"{pct(s, p):,}")
    say("max vertices/feature", f"{max(s):,}")
    say("min vertices/feature", f"{min(s):,}")
    say("mean rings/feature", round(parts_total / n, 2))

    say("", "")
    say("--- DERIVED STORAGE (estimates, from measured quantities) ---", "")
    geo_lo, geo_hi = tot * BPV_LOW, tot * BPV_HIGH
    say("geometry bytes @16.022-16.490 B/vertex",
        f"{geo_lo/1048576:,.0f} - {geo_hi/1048576:,.0f} MB")
    heap = n * HEAP_BYTES_PER_ROW
    gist = n * GIST_BYTES_PER_ROW
    say("heap @195.8 B/row (measured)", f"{heap/1048576:,.1f} MB")
    say("GiST @42.0 B/row (measured, vertex-independent)", f"{gist/1048576:,.1f} MB")
    say("TOTAL national ZCTA table",
        f"{(geo_lo+heap+gist)/1048576:,.0f} - {(geo_hi+heap+gist)/1048576:,.0f} MB")
    say("", "")
    say("prior estimate from the 56/90-row samples", "0.9 - 1.3 GB")
    say("seconds", round(time.time() - t0, 1))
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
