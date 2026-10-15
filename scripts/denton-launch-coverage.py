#!/usr/bin/env python3
"""Is the 32-ZIP Denton list complete? READ ONLY (runner). Takes Denton County's polygon from Census TIGERweb (first-party),
and asks the database which canonical-registry ZIP polygons intersect it and by how much. Reports ZIPs NOT in the launch list."""
import json, os, re, sys, time, urllib.parse, urllib.request
REF = "qwnnmljucajnexpxdgxr"; TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]; UA = "Mozilla/5.0 (HomeSignal coverage; read-only)"
NONGEO = {"75027","75029","76202","76204","76206"}
LIST = set(("75007 75010 75022 75027 75028 75029 75033 75036 75056 75057 75065 75067 75068 75077 76201 76202 76203 76204 76205 76206 76207 "
            "76208 76209 76210 76226 76227 76247 76249 76258 76259 76262 76266").split())
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
base = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer"
meta = json.load(urllib.request.urlopen(urllib.request.Request(base + "?f=json", headers={"User-Agent": UA}), timeout=60))
lid = next(l["id"] for l in meta["layers"] if l["name"] == "Counties")
def county(offset):
    q = {"f": "geojson", "where": "STATE='48' AND COUNTY='121'", "outFields": "NAME,GEOID", "returnGeometry": "true", "outSR": "4269"}
    if offset: q["maxAllowableOffset"] = offset
    gj = json.load(urllib.request.urlopen(urllib.request.Request(f"{base}/{lid}/query?{urllib.parse.urlencode(q)}", headers={"User-Agent": UA}), timeout=180))
    return gj["features"][0]
f = county(None)                      # full published resolution
geo = json.dumps(f["geometry"]).replace("'", "''")
ncoords = len(json.dumps(f["geometry"]))
rows = sql(f"""with c as (select st_setsrid(st_geomfromgeojson('{geo}'),4269) g),
 z as (select r.zip, b.g zg from public.canonical_zip_registry r join lateral (select geo.zip_membership_boundary(r.zip::text) g) b on true where b.g is not null)
 select z.zip::text zip, st_area(st_intersection(z.zg,c.g)::geography) > 0 positive_area, round((st_area(st_intersection(z.zg,c.g)::geography)/nullif(st_area(z.zg::geography),0))::numeric,4) share_in_denton,
        round((st_area(st_intersection(z.zg,c.g)::geography)/1e6)::numeric,2) km2_in_denton
 from z, c where st_intersects(z.zg,c.g) order by 1""")
touch_only = [r['zip'] for r in rows if not r['positive_area']]
rows = [r for r in rows if r['positive_area']]
# Is every part of the county inside SOME ZIP polygon? (uncovered = county area no canonical ZIP polygon contains)
gap = sql(f"""with c as (select st_setsrid(st_geomfromgeojson('{geo}'),4269) g),
 u as (select st_union(b.g) g from public.canonical_zip_registry r join lateral (select geo.zip_membership_boundary(r.zip::text) g) b on true, c where b.g is not null and st_intersects(b.g,c.g))
 select round((st_area(c.g::geography)/1e6)::numeric,2) county_km2,
        round((st_area(st_difference(c.g,u.g)::geography)/1e6)::numeric,3) uncovered_km2 from c,u""")
out = {"county": f["properties"], "territory_gap": gap, "county_geometry_json_chars": ncoords, "boundary_only_touches": touch_only, "below_0_05_km2": [r for r in rows if float(r["km2_in_denton"]) <= 0.05], "intersecting_zips": len(rows), "in_list": sorted(r["zip"] for r in rows if r["zip"] in LIST),
       "list_zips_not_intersecting_denton": sorted(LIST - {r["zip"] for r in rows}),
       "not_in_list": [r for r in rows if r["zip"] not in LIST],
       "nongeographic_have_boundary": [z for z in sorted(NONGEO) if any(r["zip"]==z for r in rows)], "all": rows}
print("----- BEGIN DENTON COVERAGE JSON -----"); print(json.dumps(out)); print("----- END DENTON COVERAGE JSON -----")
