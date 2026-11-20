#!/usr/bin/env python3
"""Parity of the conservative prefilter against the SERVING converter (scripts/phase2_b1_zcta.py::rings_to_multipolygon_wkt).
Contract: whenever the serving rule (ST_Intersects(ST_MakeValid(holed multipolygon), ZIP polygon)) says member, the
prefilter MUST say member. The reverse may differ (the filled-ring superset). Needs PG* env on a disposable PostGIS."""
import json, os, random, subprocess, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "scripts"))
from phase2_b1_zcta import rings_to_multipolygon_wkt  # the real serving converter
random.seed(20261120)

def sq(cx, cy, r, cw):
    pts = [[cx-r, cy-r], [cx-r, cy+r], [cx+r, cy+r], [cx+r, cy-r], [cx-r, cy-r]]  # clockwise
    return pts if cw else pts[::-1]

def feature():
    rings = []
    for _ in range(random.randint(1, 3)):
        cx, cy, r = random.uniform(-1, 3), random.uniform(-1, 3), random.uniform(0.2, 2.5)
        rings.append(sq(cx, cy, r, True))
        if random.random() < 0.6:
            rings.append(sq(cx + random.uniform(-.3, .3), cy + random.uniform(-.3, .3), r * random.uniform(.1, .9), False))
    return rings

def psql(sql):
    return subprocess.run(["psql", "-X", "-qtA", "-c", sql], capture_output=True, text=True, check=True).stdout.strip()

bad = tot = serving_member = extra = 0
for i in range(400):
    rings = feature()
    wkt = rings_to_multipolygon_wkt(rings, "t")
    feat = json.dumps({"k": "rings", "c": rings}).replace("'", "''")
    for z in ("90001", "90002", "90003"):
        srv = psql(f"select geo.zip_geom_membership_in(geo.zip_membership_boundary('{z}'), ST_SetSRID(ST_GeomFromText('{wkt}'),4269))")
        new = psql(f"select verdict from public.zip_scope_members_geom('{z}', jsonb_build_array('{feat}'::jsonb))")
        tot += 1
        if srv == "member":
            serving_member += 1
            if new != "member":
                bad += 1; print("VIOLATION", z, rings)
        elif new == "member":
            extra += 1
print(f"parity: {tot} cases, serving-member {serving_member}, prefilter-only extra {extra} (allowed superset), violations {bad}")
sys.exit(1 if bad or serving_member < 50 else 0)
