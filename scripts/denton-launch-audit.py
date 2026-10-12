#!/usr/bin/env python3
"""Denton County launch audit — READ ONLY. Runs on a GitHub runner (the sandbox has no egress).

What it does, for the 32 Denton ZIPs:
  A. DB (Supabase Management API, every statement is a SELECT inside `begin read only`):
     boundary status, serving-membership vs marker counts, per-marker polygon membership,
     lat/lng reversal, centroid-sitting markers, duplicates, non-point (line/polygon) markers.
  B. Publisher (first-party ArcGIS endpoints named in jurisdiction-registry.json):
     newest actual source record, source IDs eligible for each ZIP polygon (point layers only),
     which of those are missing from serving membership, and marker-vs-publisher point distance.
Nothing is written anywhere. Output: JSON + markdown on stdout between BEGIN/END markers and,
if set, $GITHUB_STEP_SUMMARY. Anything it cannot establish is UNKNOWN, never PASS.
"""
import json, os, re, sys, time, urllib.parse, urllib.request

REF = "qwnnmljucajnexpxdgxr"
TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]
ZIPS = ("75007 75010 75022 75027 75028 75029 75033 75036 75056 75057 75065 75067 75068 75077 "
        "76201 76202 76203 76204 76205 76206 76207 76208 76209 76210 76226 76227 76247 76249 "
        "76258 76259 76262 76266").split()
assert len(ZIPS) == 32 and len(set(ZIPS)) == 32
REGISTRY = json.load(open("supabase/functions/get-address-report/jurisdiction-registry.json"))
ARC = {e["registry_id"]: e for e in REGISTRY["arcgis"]}
UA = "Mozilla/5.0 (HomeSignal launch audit; read-only)"
CENTROID_M = 25.0      # a marker this close to the ZIP centroid is suspicious
POINT_TOL_M = 30.0     # marker vs publisher point


def sql(q):
    assert re.match(r"^\s*(with|select)\b", q, re.I) and not re.search(
        r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", q, re.I), "read-only guard"
    body = json.dumps({"query": "begin read only;\n" + q + ";\nrollback;"}).encode()
    for attempt in range(3):
        req = urllib.request.Request(
            f"https://api.supabase.com/v1/projects/{REF}/database/query", data=body,
            headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json",
                     "Accept": "application/json", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=170) as r:
                out = json.load(r)
            return out
        except Exception as e:  # noqa
            err = f"{type(e).__name__}: {e}"
            if hasattr(e, "read"):
                err += " " + e.read().decode()[:400]
            if attempt == 2:
                raise RuntimeError("SQL failed: " + err)
            time.sleep(4)


def rows(q):
    out = sql(q)
    if isinstance(out, list) and out and isinstance(out[-1], list):
        out = out[-1]
    return out if isinstance(out, list) else []


def http_json(url, params, timeout=90):
    data = urllib.parse.urlencode(params).encode()
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                j = json.loads(r.read().decode("utf-8", "replace"))
            if "error" in j:
                raise RuntimeError(json.dumps(j["error"])[:300])
            return j
        except Exception as e:  # noqa
            if attempt == 2:
                return {"_fetch_error": f"{type(e).__name__}: {e}"}
            time.sleep(3)


# ---------------------------------------------------------------- A. database
zl = ",".join(f"'{z}'" for z in ZIPS)
base = rows(f"""
select z.zip,
  (select count(*) from public.canonical_zip_registry r where r.zip::text=z.zip) in_registry,
  geo.zip_membership_boundary(z.zip) is not null has_boundary,
  (select count(*) from geo.n5_serving_membership m where m.zcta5::text=z.zip) members,
  (select count(*) from geo.n5_serving_marker k where k.zcta5::text=z.zip) markers,
  (select status from geo.n5_serving_status s where s.zip::text=z.zip limit 1) geo_status
from unnest(array[{zl}]) as z(zip) order by 1""")
BY = {r["zip"]: dict(r, dots=[], issues={}) for r in base}
assert set(BY) == set(ZIPS), "ZIP dropped from audit"

for z in ZIPS:
    d = rows(f"""
    select k.source_key, k.marker_seq, k.lat, k.lng, k.marker_rule, k.family, k.dim,
      (select m.geom_family from geo.n5_serving_membership m where m.zcta5::text=k.zcta5::text and m.source_key=k.source_key limit 1) geom_family,
      ST_Covers(b.g, ST_SetSRID(ST_Point(k.lng,k.lat),4326)) inside,
      ST_Covers(b.g, ST_SetSRID(ST_Point(k.lat,k.lng),4326)) swapped_inside,
      ST_Distance(ST_Centroid(b.g)::geography, ST_SetSRID(ST_Point(k.lng,k.lat),4326)::geography) d_centroid_m,
      p.registry_id, p.status, p.submitted_at::date filed, left(p.name,70) name
    from geo.n5_serving_marker k
    cross join lateral (select geo.zip_membership_boundary('{z}') g) b
    left join lateral (select registry_id,status,submitted_at,name from public.app_projects a
                       where a.source_key=k.source_key order by a.id limit 1) p on true
    where k.zcta5::text='{z}'""")
    BY[z]["dots"] = d
    miss = rows(f"""select count(*) n from geo.n5_serving_membership m where m.zcta5::text='{z}'
      and not exists (select 1 from geo.n5_serving_marker k where k.zcta5=m.zcta5 and k.source_key=m.source_key)""")
    BY[z]["members_without_marker"] = int(miss[0]["n"]) if miss else None
    seen, dup = {}, 0
    for r in d:
        seen[(r["source_key"], r["marker_seq"])] = seen.get((r["source_key"], r["marker_seq"]), 0) + 1
    dup = sum(v - 1 for v in seen.values() if v > 1)
    iss = BY[z]["issues"]
    iss["outside_polygon"] = sum(1 for r in d if r["inside"] is False)
    iss["lnglat_reversed"] = sum(1 for r in d if r["inside"] is False and r["swapped_inside"])
    iss["at_centroid"] = sum(1 for r in d if r["d_centroid_m"] is not None and r["d_centroid_m"] < CENTROID_M)
    iss["duplicate_marker_rows"] = dup
    iss["non_point_geometry"] = sum(1 for r in d if (r["geom_family"] or "point") not in ("point", "POINT", None))
    iss["no_app_projects_row"] = sum(1 for r in d if r["registry_id"] is None)
    print(f"[db] {z}: markers={len(d)} members={BY[z]['members']} issues={iss}", file=sys.stderr)

# ---------------------------------------------------------------- B. publishers
REGS = sorted({r["registry_id"] for z in ZIPS for r in BY[z]["dots"] if r["registry_id"] in ARC})
PUB = {}
for reg in REGS:
    e = ARC[reg]
    url = e["service_url"] + "/query"
    cm = e["column_map"]
    idcol = cm.get("case_number")
    datecol = cm.get("file_date")
    where = e.get("extra_where") or "1=1"
    info = {"registry_id": reg, "service_url": e["service_url"], "id_col": idcol, "date_col": datecol}
    meta = http_json(e["service_url"], {"f": "json"})
    info["geometryType"] = meta.get("geometryType")
    info["meta_error"] = meta.get("_fetch_error")
    if datecol:
        st = http_json(url, {"f": "json", "where": where, "outStatistics": json.dumps(
            [{"statisticType": "max", "onStatisticField": datecol, "outStatisticFieldName": "m"}])})
        try:
            v = st["features"][0]["attributes"]["m"]
            info["newest_source_record"] = (time.strftime("%Y-%m-%d", time.gmtime(v / 1000))
                                            if isinstance(v, (int, float)) else str(v))
        except Exception:  # noqa
            info["newest_source_record"] = None
            info["stat_error"] = st.get("_fetch_error") or "unparseable"
    PUB[reg] = info

# publisher point per source_key, for marker comparison + eligibility (point layers only)
key_re = re.compile(r"^arcgis:([^:]+):(.+)$")
want = {}
for z in ZIPS:
    for r in BY[z]["dots"]:
        m = key_re.match(r["source_key"] or "")
        if m and m.group(1) in ARC:
            want.setdefault(m.group(1), set()).add(m.group(2))


def chunks(seq, n):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


PUBPT = {}  # (reg,id) -> (x,y) or None
for reg, ids in want.items():
    e = ARC[reg]
    idcol = e["column_map"].get("case_number")
    if not idcol:
        PUB[reg]["compare"] = "UNVERIFIED: registry has no case_number column"
        continue
    got = 0
    for ch in chunks(sorted(ids), 150):
        lit = ",".join(i if re.fullmatch(r"-?\d+", i) else "'" + i.replace("'", "''") + "'" for i in ch)
        j = http_json(e["service_url"] + "/query", {
            "f": "json", "where": f"{idcol} IN ({lit})", "outFields": idcol,
            "returnGeometry": "true", "outSR": "4326"})
        if "_fetch_error" in j:
            PUB[reg]["compare"] = "UNVERIFIED: fetch error " + j["_fetch_error"]
            break
        for ft in j.get("features", []):
            g, a = ft.get("geometry") or {}, ft["attributes"]
            k = (reg, str(a.get(idcol)))
            PUBPT[k] = (g["x"], g["y"]) if "x" in g and "y" in g else "NONPOINT"
            got += 1
    PUB[reg].setdefault("compare", "ok")
    PUB[reg]["ids_requested"], PUB[reg]["ids_returned"] = len(ids), got

import math
def hav(x1, y1, x2, y2):
    R = 6371000.0
    p1, p2 = math.radians(y1), math.radians(y2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(x2 - x1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

for z in ZIPS:
    cmp_ = {"match": 0, "mismatch": 0, "publisher_not_found": 0, "nonpoint_unverified": 0, "not_arcgis_unverified": 0}
    bad = []
    for r in BY[z]["dots"]:
        m = key_re.match(r["source_key"] or "")
        if not m or m.group(1) not in ARC:
            cmp_["not_arcgis_unverified"] += 1
            continue
        pt = PUBPT.get((m.group(1), m.group(2)))
        if pt is None:
            cmp_["publisher_not_found"] += 1
        elif pt == "NONPOINT":
            cmp_["nonpoint_unverified"] += 1
        else:
            dm = hav(pt[0], pt[1], r["lng"], r["lat"])
            if dm <= POINT_TOL_M:
                cmp_["match"] += 1
            else:
                cmp_["mismatch"] += 1
                bad.append({"source_key": r["source_key"], "dist_m": round(dm, 1)})
    BY[z]["publisher_compare"] = cmp_
    BY[z]["publisher_mismatches"] = bad[:20]

# eligibility / missing IDs: point layers, publisher point inside ZIP polygon vs serving membership
ELIG = {}  # zip -> {reg: (eligible, missing_list)}
for reg, e in ARC.items():
    if reg not in want and reg not in ("denton-county-dev-permits", "frisco-active-building-permits",
                                         "fort-worth-development-permits"):
        continue
    if reg not in PUB:
        PUB[reg] = {"registry_id": reg, "service_url": e["service_url"],
                    "geometryType": http_json(e["service_url"], {"f": "json"}).get("geometryType")}
    if PUB[reg].get("geometryType") != "esriGeometryPoint":
        PUB[reg]["eligibility"] = "UNVERIFIED: layer geometry is not point (line/polygon intersection not tested here)"
        continue
    idcol = e["column_map"].get("case_number")
    if not idcol:
        PUB[reg]["eligibility"] = "UNVERIFIED: no case_number column in registry"
        continue
    if e.get("geocode_assemble"):
        PUB[reg]["eligibility"] = "UNVERIFIED: coordinates are geocoded by the engine, publisher has no point"
        continue
    where = e.get("extra_where") or "1=1"
    allrows, off, trunc = [], 0, False
    while True:
        j = http_json(e["service_url"] + "/query", {
            "f": "json", "where": where, "outFields": idcol, "returnGeometry": "true", "outSR": "4326",
            "resultOffset": off, "resultRecordCount": 2000, "orderByFields": idcol})
        if "_fetch_error" in j:
            PUB[reg]["eligibility"] = "UNVERIFIED: fetch error " + j["_fetch_error"]
            allrows = None
            break
        fs = j.get("features", [])
        allrows += [(str(f["attributes"][idcol]), f["geometry"]["x"], f["geometry"]["y"])
                    for f in fs if f.get("geometry") and "x" in f["geometry"]]
        if not j.get("exceededTransferLimit") and len(fs) < 2000:
            break
        off += len(fs)
        if off > 400000:
            trunc = True
            break
    if allrows is None:
        continue
    PUB[reg]["eligibility"] = "ok" if not trunc else "TRUNCATED"
    PUB[reg]["source_rows_with_point"] = len(allrows)
    inzip = {}
    for ch in chunks(allrows, 1500):
        vals = ",".join(f"('{i.replace(chr(39), chr(39)*2)}',{x},{y})" for i, x, y in ch)
        res = rows(f"""select v.id, b.zip from (values {vals}) v(id,x,y)
          join lateral (select z.zip from unnest(array[{zl}]) z(zip)
            where geo.zip_membership_boundary(z.zip) is not null
              and ST_Covers(geo.zip_membership_boundary(z.zip), ST_SetSRID(ST_Point(v.x,v.y),4326)) limit 1) b on true""")
        for r in res:
            inzip.setdefault(r["zip"], set()).add(r["id"])
    for z in ZIPS:
        have = {m.group(2) for r in BY[z]["dots"] for m in [key_re.match(r["source_key"] or "")]
                if m and m.group(1) == reg}
        mem = rows(f"select source_key from geo.n5_serving_membership where zcta5::text='{z}' and source_key like 'arcgis:{reg}:%'")
        have |= {key_re.match(r["source_key"]).group(2) for r in mem}
        el = inzip.get(z, set())
        ELIG.setdefault(z, {})[reg] = (len(el), sorted(el - have))
    print(f"[pub] {reg}: {len(allrows)} point rows", file=sys.stderr)

# ---------------------------------------------------------------- report
def verdict(z):
    d = BY[z]
    if not d["has_boundary"]:
        return "UNKNOWN", "no canonical boundary: classify (non-ZCTA vs gap); no map dots possible"
    why = []
    i = d["issues"]
    if i["outside_polygon"]:
        why.append(f"{i['outside_polygon']} dots outside polygon")
    if i["at_centroid"]:
        why.append(f"{i['at_centroid']} dots at centroid")
    if i["duplicate_marker_rows"]:
        why.append("duplicate markers")
    if d.get("members_without_marker"):
        why.append(f"{d['members_without_marker']} members without marker")
    miss = sum(len(v[1]) for v in ELIG.get(z, {}).values())
    if miss:
        why.append(f"{miss} eligible source IDs missing")
    unver = d["publisher_compare"]["not_arcgis_unverified"] + d["publisher_compare"]["nonpoint_unverified"]
    if unver:
        why.append(f"{unver} dots not verifiable against publisher geometry here")
    regs = {r["registry_id"] for r in d["dots"]}
    fresh = [PUB[r].get("newest_source_record") for r in regs if r in PUB and r != "txdot-projects-info-all"]
    cur = [f for f in fresh if f and f >= time.strftime("%Y-%m-%d", time.gmtime(time.time() - 365 * 86400))]
    if not cur:
        why.append("no municipal/county source with a record in the last 365 days")
    return ("FAIL" if why else "UNKNOWN"), "; ".join(why) or "page/report tests pending"

out = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "publishers": PUB, "zips": {}}
md = ["| ZIP | Boundary | Members | Dots | Out-of-polygon | At centroid | Reversed | Dup | Pub match/mismatch/unverified | Eligible IDs missing | Verdict | Blocker |",
      "|---|---|---:|---:|---:|---:|---:|---:|---|---:|---|---|"]
for z in ZIPS:
    d = BY[z]
    v, why = verdict(z)
    pc = d["publisher_compare"]
    missn = sum(len(x[1]) for x in ELIG.get(z, {}).values())
    out["zips"][z] = {k: d[k] for k in ("in_registry", "has_boundary", "members", "markers", "geo_status",
                                          "members_without_marker", "issues", "publisher_compare", "publisher_mismatches")}
    out["zips"][z]["eligible_missing"] = {r: {"eligible": a, "missing": m[:200], "missing_n": len(m)} for r, (a, m) in ELIG.get(z, {}).items()}
    out["zips"][z]["verdict"] = [v, why]
    i = d["issues"]
    md.append(f"| {z} | {'yes' if d['has_boundary'] else 'NO'} | {d['members']} | {len(d['dots'])} | {i['outside_polygon']} | {i['at_centroid']} | {i['lnglat_reversed']} | {i['duplicate_marker_rows']} | "
              f"{pc['match']}/{pc['mismatch']}/{pc['not_arcgis_unverified']+pc['nonpoint_unverified']+pc['publisher_not_found']} | {missn} | {v} | {why} |")
text = "\n".join(md)
print("----- BEGIN DENTON AUDIT JSON -----")
print(json.dumps(out, default=str))
print("----- END DENTON AUDIT JSON -----")
print("----- BEGIN DENTON AUDIT TABLE -----")
print(text)
print("----- END DENTON AUDIT TABLE -----")
if os.environ.get("GITHUB_STEP_SUMMARY"):
    open(os.environ["GITHUB_STEP_SUMMARY"], "a").write("## Denton launch audit\n\n" + text + "\n")
