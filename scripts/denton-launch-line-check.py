#!/usr/bin/env python3
"""READ ONLY. TxDOT project 008113084 (ZIP 76207): is the marker ON the line the pipeline STORED, and does the stored line equal the publisher's current line?
Separates 'marker rule wrong' from 'stored geometry is older than the publisher's'. Every SQL is a SELECT in a read-only transaction."""
import json, os, re, sys, time, urllib.parse, urllib.request
REF = "qwnnmljucajnexpxdgxr"; TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]; UA = "Mozilla/5.0 (HomeSignal line check; read-only)"
TX = [e for e in json.load(open("supabase/functions/get-address-report/jurisdiction-registry.json"))["arcgis"] if e["registry_id"] == "txdot-projects-info-all"][0]
KEY = "arcgis:txdot-projects-info-all:008113084"

def sql(q):
    assert re.match(r"^\s*(with|select)\b", q, re.I) and not re.search(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", q, re.I)
    body = json.dumps({"query": "begin read only;\n" + q + ";\nrollback;"}).encode()
    for a in range(3):
        try:
            req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=body,
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=170) as r:
                out = json.load(r)
            return out[-1] if isinstance(out, list) and out and isinstance(out[-1], list) else out
        except Exception as e:
            if a == 2:
                return [{"sql_error": str(e)[:200] + (e.read().decode()[:400] if hasattr(e, "read") else "")}]
            time.sleep(3)

def pub(sr):
    p = {"f": "json", "where": "CONTROL_SECT_JOB = '008113084'", "outFields": "OBJECTID", "returnGeometry": "true", "outSR": sr}
    req = urllib.request.Request(TX["service_url"] + "/query", data=urllib.parse.urlencode(p).encode(), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read().decode())

out = {}
j = pub("4269")
paths = [p for f in j.get("features", []) for p in (f.get("geometry") or {}).get("paths", [])]
w = "SRID=4269;MULTILINESTRING(" + ",".join("(" + ",".join(f"{x} {y}" for x, y in p) + ")" for p in paths) + ")"
out["publisher_now"] = {"features": len(j.get("features", [])), "paths": len(paths), "vertices": sum(len(p) for p in paths)}
out["stored_vs_marker"] = sql(f"""
with g as (select gg.geom, gg.feature_id, gg.recovered_at from geo.n5_geom gg where gg.source_key = '{KEY}' and gg.outcome = 1 and gg.geom is not null),
 mk as (select zcta5::text zip, marker_seq seq, lat, lng from geo.n5_serving_marker where source_key = '{KEY}')
select mk.zip, mk.seq, mk.lat, mk.lng, g.feature_id, g.recovered_at,
  ST_Distance(g.geom::geography, ST_SetSRID(ST_Point(mk.lng, mk.lat), 4269)::geography) marker_to_stored_line_m,
  ST_Distance(ST_GeomFromEWKT('{w}')::geography, ST_SetSRID(ST_Point(mk.lng, mk.lat), 4269)::geography) marker_to_publisher_line_m,
  ST_HausdorffDistance(g.geom::geography::geometry, ST_GeomFromEWKT('{w}')) hausdorff_deg_stored_vs_publisher,
  ST_Length(g.geom::geography) stored_len_m, ST_Length(ST_GeomFromEWKT('{w}')::geography) publisher_len_m,
  ST_NPoints(g.geom) stored_pts, ST_NumGeometries(g.geom) stored_parts,
  ST_Equals(g.geom, ST_GeomFromEWKT('{w}')) identical
from mk cross join g where mk.zip = '76207'""")
out["stored_to_publisher_max_gap_m"] = sql(f"""
with g as (select ST_Union(gg.geom) u from geo.n5_geom gg where gg.source_key = '{KEY}' and gg.outcome = 1),
 pl as (select ST_GeomFromEWKT('{w}') p),
 pts as (select (ST_DumpPoints(g.u)).geom pt from g)
select 'stored_vertices_to_publisher_line' k, round(max(ST_Distance(pts.pt::geography, pl.p::geography))::numeric,1) max_m, round(min(ST_Distance(pts.pt::geography, pl.p::geography))::numeric,1) min_m from pts, pl
union all
select 'publisher_vertices_to_stored_line', round(max(ST_Distance((d).geom::geography, g.u::geography))::numeric,1), round(min(ST_Distance((d).geom::geography, g.u::geography))::numeric,1)
  from (select ST_DumpPoints(pl.p) d from pl) q, g, pl""")
print("----- BEGIN DENTON LINECHECK JSON -----")
print(json.dumps(out, default=str))
print("----- END DENTON LINECHECK JSON -----")
