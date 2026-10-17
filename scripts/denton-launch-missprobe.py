#!/usr/bin/env python3
"""READ ONLY (runner). For sampled 'eligible but missing from serving' Denton County permit ids (taken from the 2026-10-17 audit,
scripts/_missprobe_ids.json), ask the publisher for each record, then ask the database where it sits relative to its ZIP.
Answers: is the record inside the ZIP polygon, was it inside the 3 mi centre square the engine fetches, is it stored anywhere,
and what type/status/year is it. Every SQL is a SELECT in a read-only transaction. Identity is the layer's OBJECTID."""
import json, os, re, sys, time, urllib.parse, urllib.request, collections
REF = "qwnnmljucajnexpxdgxr"; TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]; UA = "Mozilla/5.0 (HomeSignal miss probe; read-only)"
SVC = "https://gis.dentoncounty.gov/arcgis/rest/services/DEV_Permits/FeatureServer/0/query"
IDS = json.load(open("scripts/_missprobe_ids.json"))

def sql(qs):
    assert re.match(r"^\s*(with|select)\b", qs, re.I) and not re.search(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", qs, re.I)
    body = json.dumps({"query": "begin read only;\n" + qs + ";\nrollback;"}).encode()
    for a in range(3):
        try:
            req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=body,
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=170) as r: out = json.load(r)
            if isinstance(out, list) and out and isinstance(out[-1], list): out = out[-1]
            return out
        except Exception as e:
            if a == 2: raise RuntimeError("SQL failed: " + str(e) + (e.read().decode()[:300] if hasattr(e, "read") else ""))
            time.sleep(4)

def q(params):
    for a in range(3):
        try:
            req = urllib.request.Request(SVC, data=urllib.parse.urlencode(params).encode(), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r: j = json.loads(r.read().decode("utf-8", "replace"))
            if "error" in j: raise RuntimeError(json.dumps(j["error"])[:200])
            return j
        except Exception as e:
            if a == 2: return {"_err": str(e)}
            time.sleep(3)

out = {}
for z, ids in IDS.items():
    feats = []
    for i in range(0, len(ids), 100):
        lit = ",".join("'" + x + "'" for x in ids[i:i + 100])
        j = q({"f": "json", "where": f"PermitID IN ({lit})", "outFields": "OBJECTID,PermitID,PermitType,PermitStat,DateReceiv",
               "returnGeometry": "true", "outSR": "4326"})
        if "_err" in j: out[z] = {"error": j["_err"]}; break
        feats += j.get("features", [])
    else:
        rows = []
        for f in feats:
            a = f["attributes"]; g = f.get("geometry") or {}
            if g.get("x") is None: continue
            yr = time.gmtime(a["DateReceiv"] / 1000).tm_year if a.get("DateReceiv") else None
            rows.append((a["OBJECTID"], str(a["PermitID"]), a.get("PermitType"), a.get("PermitStat"), yr, g["x"], g["y"]))
        vals = ",".join(f"({o},'{p}','{(t or '').replace(chr(39), '')}','{(s or '').replace(chr(39), '')}',{y if y else 'null'},{x},{yy})" for o, p, t, s, y, x, yy in rows)
        res = sql(f"""with c as (select home_lat la, home_lng ln, geo.zip_membership_boundary('{z}') g from public.development_reports where zip='{z}'),
          v(oid,pid,typ,st,yr,x,y) as (values {vals})
          select v.oid, v.pid, v.typ, v.st, v.yr,
            geo.zip_point_membership_in(c.g, v.y, v.x) verdict,
            (abs(v.y-c.la) <= 3/69.0 and abs(v.x-c.ln) <= 3/(69.17*cos(radians(c.la)))) in_3mi_square,
            (st_distance(st_setsrid(st_makepoint(c.ln,c.la),4269)::geography, st_setsrid(st_makepoint(v.x,v.y),4269)::geography)/1609.34)::numeric(6,1) mi_from_centre,
            exists(select 1 from public.app_projects p where p.registry_id='denton-county-dev-permits' and (p.source_key='arcgis:denton-county-dev-permits:'||v.pid or p.source_key like 'arcgis:denton-county-dev-permits:'||v.pid||'#%')) stored,
            exists(select 1 from geo.n5_serving_membership m where m.source_key='arcgis:denton-county-dev-permits:'||v.pid or m.source_key like 'arcgis:denton-county-dev-permits:'||v.pid||'#%') served_any
          from v cross join c""")
        n = len(res); inside = [r for r in res if r["verdict"] == "member"]
        out[z] = {"sampled": len(ids), "found_at_publisher": len(feats), "with_point": n, "inside_zip_polygon": len(inside),
                  "inside_polygon_and_in_3mi_square": sum(1 for r in inside if r["in_3mi_square"]),
                  "inside_polygon_and_outside_3mi_square": sum(1 for r in inside if not r["in_3mi_square"]),
                  "inside_polygon_stored_in_app_projects": sum(1 for r in inside if r["stored"]),
                  "inside_polygon_served_under_any_zip": sum(1 for r in inside if r["served_any"]),
                  "verdicts": dict(collections.Counter(r["verdict"] for r in res)),
                  "status": dict(collections.Counter(r["st"] for r in inside)),
                  "type": dict(collections.Counter(r["typ"] for r in inside)),
                  "year": dict(sorted(collections.Counter(r["yr"] for r in inside).items(), key=lambda t: str(t[0]))),
                  "mi_from_centre_inside_polygon_min_max": [min((float(r["mi_from_centre"]) for r in inside), default=None), max((float(r["mi_from_centre"]) for r in inside), default=None)],
                  "dup_permit_ids_in_sample": sum(1 for k, v in collections.Counter(p for _, p, *_ in rows).items() if v > 1)}
print("----- BEGIN DENTON MISSPROBE -----")
print(json.dumps(out, indent=1, default=str))
print("----- END DENTON MISSPROBE -----")
