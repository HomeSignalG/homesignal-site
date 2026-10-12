#!/usr/bin/env python3
"""Which governments actually cover each Denton ZIP? READ ONLY (runner).
Source of place boundaries: US Census TIGERweb (first-party). Overlap is computed in the database against the canonical ZIP
polygon (geo.zip_membership_boundary). Approximate: place geometry is generalised (~50 m) and SRID 4269/4326 differences are ignored.
Output per ZIP: share of the ZIP polygon's area inside each incorporated place / CDP, and the unincorporated remainder."""
import json, os, re, sys, time, urllib.parse, urllib.request
REF = "qwnnmljucajnexpxdgxr"; TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]; UA = "Mozilla/5.0 (HomeSignal jurisdictions; read-only)"
ZIPS = ("75007 75010 75022 75028 75033 75036 75056 75057 75065 75067 75068 75077 76201 76203 76205 76207 76208 76209 76210 "
        "76226 76227 76247 76249 76258 76259 76262 76266").split()
def sql(q):
    assert re.match(r"^\s*(with|select)\b", q, re.I) and not re.search(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", q, re.I)
    body = json.dumps({"query": "begin read only;\n" + q + ";\nrollback;"}).encode()
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
def get(url, params=None):
    for a in range(3):
        try:
            data = urllib.parse.urlencode(params).encode() if params is not None else None
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read().decode())
        except Exception as e:
            if a == 2: return {"_err": str(e)}
            time.sleep(3)
ext = sql("select min(ST_XMin(g)) x0,min(ST_YMin(g)) y0,max(ST_XMax(g)) x1,max(ST_YMax(g)) y1 from (select geo.zip_membership_boundary(z) g from unnest(array[" + ",".join(f"'{z}'" for z in ZIPS) + "]) z) s")[0]
svc = "https://tigerweb.ecm.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer"
meta = get(svc + "?f=json"); layers = [l for l in meta.get("layers", []) if re.search(r"incorporated places|census designated places", l["name"], re.I)]
out = {"extent": ext, "layers": [l["name"] for l in layers], "meta_err": meta.get("_err")}
places = []
for l in layers:
    j = get(f"{svc}/{l['id']}/query", {"f": "json", "where": "STATE='48'", "geometry": f"{ext['x0']},{ext['y0']},{ext['x1']},{ext['y1']}",
        "geometryType": "esriGeometryEnvelope", "inSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": "NAME,BASENAME,GEOID,FUNCSTAT",
        "returnGeometry": "true", "outSR": "4326", "maxAllowableOffset": "0.0005", "geometryPrecision": "5"})
    for f in j.get("features", []):
        rings = (f.get("geometry") or {}).get("rings") or []
        if not rings: continue
        polys = "(" + ",".join("(" + ",".join(f"{x} {y}" for x, y in r) + ")" for r in rings) + ")"
        places.append({"name": f["attributes"]["NAME"], "kind": l["name"], "wkt": "MULTIPOLYGON(" + ",".join([polys]) + ")" if False else None, "rings": rings})
    out["layer_err_" + str(l["id"])] = j.get("_err")
out["places_found"] = len(places)
rows = []
for p in places:
    # each ring becomes its own polygon (rings of one place are treated as separate parts; holes are rare for place boundaries)
    polys = ",".join("((" + ",".join(f"{x} {y}" for x, y in r) + "))" for r in p["rings"])
    wkt = "MULTIPOLYGON(" + polys + ")"
    res = sql(f"""with pl as (select ST_MakeValid(ST_SetSRID(ST_GeomFromText('{wkt}'),4269)) g)
      select z.zip, ST_Area(geo.zip_membership_boundary(z.zip)::geography) zip_m2,
             ST_Area(ST_Intersection(geo.zip_membership_boundary(z.zip), pl.g)::geography) in_m2
      from unnest(array[{",".join(f"'{z}'" for z in ZIPS)}]) z(zip), pl
      where ST_Intersects(geo.zip_membership_boundary(z.zip), pl.g)""")
    for r in res:
        sh = r["in_m2"] / r["zip_m2"] if r["zip_m2"] else 0
        if sh > 0.0005: rows.append({"zip": r["zip"], "place": p["name"], "kind": p["kind"], "share": round(sh, 4), "km2": round(r["in_m2"] / 1e6, 2)})
by = {}
for r in rows: by.setdefault(r["zip"], []).append(r)
out["zips"] = {z: {"places": sorted(v, key=lambda r: -r["share"]), "unincorporated_or_other_share": round(max(0, 1 - sum(r["share"] for r in v)), 4)} for z, v in by.items()}
for z in ZIPS: out["zips"].setdefault(z, {"places": [], "unincorporated_or_other_share": 1.0})
print("----- BEGIN DENTON JURISDICTIONS JSON -----"); print(json.dumps(out)); print("----- END DENTON JURISDICTIONS JSON -----")
