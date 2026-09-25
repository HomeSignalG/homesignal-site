#!/usr/bin/env python3
"""n5_publish.py - publish ONE prefix of a BUILDING N5 generation. Called by n5_orchestrate.py.

THE ONE CANONICAL WRITER of candidate serving-plane rows (boundary membership, membership,
markers, status). All of the rules live in the database, in geo.n5_gen_publish_prefix()
(docs/n5-generation-publish.sql). This file does only what the database cannot: read the
Census TIGER ZCTA boundaries for the prefix and hand them over.

  1. load the canonical ZIPs of the prefix that have a TIGER ZCTA into geo.n5_gen_zcta,
     tagged with the generation (a ZIP with no ZCTA is published as 'not_measured' by the
     function itself, never skipped);
  2. call geo.n5_gen_publish_prefix(generation, prefix, run_id, <how many were loaded>).
     That call is ONE transaction: it resolves boundaries against the generation's frozen
     expected set, writes membership + markers + status, proves every marker lies inside
     its ZIP and every membership has a marker, deletes the scratch boundaries, and writes
     the per-prefix receipt. It refuses unless the generation is BUILDING, every shard is
     done, and the resident boundary count equals the count declared here.

Nothing here can touch the serving generation: the database refuses writes to any generation
that is not BUILDING (geo.n5_generation_row_guard), whoever issues them.

Replaces, and retires, scripts/n5_boundary_first.py + n5_unit_a_shadow.py + n5_a3_markers.py
(build), which rewrote the SERVING rows in place, prefix by prefix, with no generation.

stdlib only.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from n3_pilot import sql, lit, read_shp_polygons, rings_to_multipolygon_wkt, CANON_SRID  # noqa: E402
from n5_shard import tiger_index, HEAVY_TIMEOUT_SQL  # noqa: E402

BATCH = 20


def load_boundaries(generation, prefix):
    """Canonical ZIPs of `prefix` that have a Census ZCTA polygon -> geo.n5_gen_zcta."""
    want = {r["zip"] for r in sql(
        f"select zip from public.canonical_zip_registry where left(zip,3)={lit(prefix)};", "canon")}
    t = tiger_index()
    idx = {g: i for g, i in t["geoid_to_idx"].items() if g in want}
    sql(f"delete from geo.n5_gen_zcta where generation_id={lit(generation)} and prefix={lit(prefix)};",
        "clear scratch")
    shapes, _ = read_shp_polygons(t["raw"], set(idx.values()))
    vals, loaded = [], 0
    head = "insert into geo.n5_gen_zcta (generation_id, prefix, zcta5, geom) values "
    for zc, i in sorted(idx.items()):
        rings = shapes.get(i)
        if not rings:
            continue
        wkt = rings_to_multipolygon_wkt(rings, zc)
        vals.append(f"({lit(generation)},{lit(prefix)},{lit(zc)},ST_GeomFromText($g${wkt}$g$,{CANON_SRID}))")
        loaded += 1
        if len(vals) >= BATCH:
            sql(head + ",".join(vals) + ";", "zcta ins")
            vals = []
    if vals:
        sql(head + ",".join(vals) + ";", "zcta ins")
    return len(want), loaded


def publish_prefix(generation, prefix, run_id):
    t0 = time.time()
    canon, loaded = load_boundaries(generation, prefix)
    out = sql(HEAVY_TIMEOUT_SQL
              + f"select geo.n5_gen_publish_prefix({lit(generation)}, {lit(prefix)}, {lit(run_id)}, {loaded}) r;",
              f"publish {prefix}")
    r = out[-1]["r"] if out else None
    print(f"{'published ' + prefix:38} canonical={canon} zcta={loaded} -> {r} "
          f"({time.time() - t0:.1f}s)", flush=True)
    return r


if __name__ == "__main__":
    gen = os.environ.get("GENERATION", "").strip()
    pfx = os.environ.get("PREFIX", "").strip()
    if not gen or not pfx:
        raise SystemExit("STOP: GENERATION and PREFIX are required.")
    publish_prefix(gen, pfx, os.environ.get("RUN_ID", "").strip() or f"pub-{int(time.time())}")
