#!/usr/bin/env python3
"""Denton launch investigation — READ ONLY (runner). Answers three open questions from the audit:
  1. Are PermitIDs unique in the Denton County layer? What are the two 'misplaced' dots (20062248, 20110001)?
  2. TxDOT road markers: is every displayed marker ON its official line, and does the line intersect the ZIP polygon?
  3. What is the 76262 'centroid' marker?
Identity used throughout is the layer's own OBJECTID, never PermitID alone. Every SQL is a SELECT in a read-only txn."""
import json, os, re, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.dirname(__file__))
REF = "qwnnmljucajnexpxdgxr"; TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]; UA = "Mozilla/5.0 (HomeSignal launch investigation; read-only)"
REG = {e["registry_id"]: e for e in json.load(open("supabase/functions/get-address-report/jurisdiction-registry.json"))["arcgis"]}
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

def q(url, params):
    for a in range(3):
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode(params).encode(), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r: j = json.loads(r.read().decode("utf-8", "replace"))
            if "error" in j: raise RuntimeError(json.dumps(j["error"])[:200])
            return j
        except Exception as e:
            if a == 2: return {"_err": str(e)}
            time.sleep(3)

def hav(x1, y1, x2, y2):
    import math
    p1, p2 = math.radians(y1), math.radians(y2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(x2 - x1) / 2) ** 2
    return 2 * 6371000.0 * math.asin(math.sqrt(a))

out = {}
# ---- 1. Denton County: every feature, identified by OBJECTID
e = REG["denton-county-dev-permits"]; url = e["service_url"] + "/query"
feats, off = [], 0
while True:
    j = q(url, {"f": "json", "where": "1=1", "outFields": "OBJECTID,PermitID,PermitType,PermitStat,DateReceiv,PropertySi,PropertyOw", "returnGeometry": "true",
                "outSR": "4326", "resultOffset": off, "resultRecordCount": 2000, "orderByFields": "OBJECTID"})
    if "_err" in j: out["layer_error"] = j["_err"]; break
    fs = j.get("features", []); feats += fs
    if len(fs) < 2000 and not j.get("exceededTransferLimit"): break
    off += len(fs)
out["layer_features"] = len(feats)
by = {}
for f in feats:
    a = f["attributes"]; g = f.get("geometry") or {}
    by.setdefault(str(a.get("PermitID")), []).append({"oid": a.get("OBJECTID"), "type": a.get("PermitType"), "status": a.get("PermitStat"),
        "addr": a.get("PropertySi"), "owner": a.get("PropertyOw"), "x": g.get("x"), "y": g.get("y")})
dups = {k: v for k, v in by.items() if len(v) > 1}
out["distinct_permit_ids"] = len(by); out["duplicated_permit_ids"] = len(dups)
far = []
for k, v in dups.items():
    pts = [(float(r["x"]), float(r["y"])) for r in v if r["x"] is not None and r["y"] is not None]
    d = max((hav(a[0], a[1], b[0], b[1]) for a in pts for b in pts), default=0)
    if d > 30: far.append((k, round(d)))
out["duplicated_ids_with_features_>30m_apart"] = len(far)
out["dup_by_farthest_m_top"] = sorted(far, key=lambda t: -t[1])[:15]
for pid in ("20062248", "20110001"):
    out["permit_" + pid] = by.get(pid)
# which duplicate groups have a stored key (displayed) in the 32-ZIP cohort
keys = [f"arcgis:denton-county-dev-permits:{k}" for k in dups]
inz = {}
for i in range(0, len(keys), 400):
    lst = ",".join("'" + k + "'" for k in keys[i:i + 400])
    for r in sql(f"select zcta5::text zip, source_key, lat, lng from geo.n5_serving_membership where source_key in ({lst})"):
        inz.setdefault(r["source_key"], []).append(r)
out["duplicate_ids_currently_displayed"] = len(inz)
out["duplicate_ids_displayed_detail"] = {k.split(":")[-1]: {"served": v, "features": dups[k.split(":")[-1]]} for k, v in list(inz.items())[:40]}

# ---- 2. TxDOT: official lines vs displayed markers
tx = REG["txdot-projects-info-all"]
mk = sql("select k.zcta5::text zip, k.source_key, k.marker_seq, k.lat, k.lng from geo.n5_serving_marker k where k.source_key like 'arcgis:txdot-projects-info-all:%' and k.zcta5::text in (" + ",".join("'" + z + "'" for z in ZIPS) + ")")
out["txdot_markers"] = len(mk)
ids = sorted({m["source_key"].split(":")[-1] for m in mk})
lines = {}
for i in range(0, len(ids), 100):
    lit = ",".join("'" + x.replace("'", "''") + "'" for x in ids[i:i + 100])
    j = q(tx["service_url"] + "/query", {"f": "json", "where": f"CONTROL_SECT_JOB IN ({lit})", "outFields": "CONTROL_SECT_JOB,OBJECTID", "returnGeometry": "true", "outSR": "4326"})
    for f in j.get("features", []):
        paths = (f.get("geometry") or {}).get("paths") or []
        lines.setdefault(str(f["attributes"]["CONTROL_SECT_JOB"]), []).append(paths)
out["txdot_projects_with_markers"] = len(ids); out["txdot_projects_found_at_publisher"] = len(lines)
def wkt(parts):
    return "MULTILINESTRING(" + ",".join("(" + ",".join(f"{x} {y}" for x, y in p) + ")" for part in parts for p in part if len(p) > 1) + ")"
worst, off_line, no_int = [], 0, 0
for z in ZIPS:
    mz = [m for m in mk if m["zip"] == z]
    for i in range(0, len(mz), 60):
        vals = []
        for m in mz[i:i + 60]:
            pid = m["source_key"].split(":")[-1]
            if pid in lines and any(lines[pid]):
                vals.append(f"('{m['source_key']}',{m['marker_seq']},{m['lng']},{m['lat']},'{wkt(lines[pid])}')")
        if not vals: continue
        res = sql(f"""select v.sk, v.seq, ST_Distance(ST_GeogFromText('SRID=4326;'||v.w), ST_SetSRID(ST_Point(v.x,v.y),4326)::geography) d_m,
            ST_Intersects(geo.zip_membership_boundary('{z}'), ST_SetSRID(ST_GeomFromText(v.w),4269)) line_hits_zip
            from (values {",".join(vals)}) v(sk,seq,x,y,w)""")
        for r in res:
            if r["d_m"] > 5: off_line += 1; worst.append((z, r["sk"].split(":")[-1], r["seq"], round(r["d_m"], 1)))
            if not r["line_hits_zip"]: no_int += 1
out["txdot_markers_more_than_5m_from_their_line"] = off_line
out["txdot_markers_whose_line_misses_the_zip_polygon"] = no_int
out["txdot_worst"] = sorted(worst, key=lambda t: -t[3])[:15]

# ---- 3. the 76262 centroid marker
out["z76262_centroid"] = sql("""select k.source_key, k.marker_seq, k.marker_rule, k.lat, k.lng, p.registry_id, p.name, p.address, p.type, p.submitted_at::date filed
  from geo.n5_serving_marker k cross join lateral (select geo.zip_membership_boundary('76262') g) b
  left join lateral (select registry_id,name,address,type,submitted_at from public.app_projects a where a.source_key=k.source_key order by a.id limit 1) p on true
  where k.zcta5::text='76262' and ST_Distance(ST_Transform(ST_Centroid(b.g),4326)::geography, ST_SetSRID(ST_Point(k.lng,k.lat),4326)::geography) < 25""")
print("----- BEGIN DENTON INVESTIGATE JSON -----")
print(json.dumps(out, default=str))
print("----- END DENTON INVESTIGATE JSON -----")
