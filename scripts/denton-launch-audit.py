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
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import subprocess
if subprocess.run([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "denton_verdict_selftest.py")]).returncode:
    sys.exit("acceptance-logic self-test failed: refusing to audit with logic that can mis-grade")
from denton_verdict import verdict as accept
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
      geo.zip_point_membership_in(b.g, k.lat, k.lng) = 'member' inside,
      geo.zip_point_membership_in(b.g, k.lng, k.lat) = 'member' swapped_inside,
      ST_Distance(ST_Transform(ST_Centroid(b.g),4326)::geography, ST_SetSRID(ST_Point(k.lng,k.lat),4326)::geography) d_centroid_m,
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
    # a marker on a LINE/polygon project can lie anywhere along it, including on the ZIP centroid by coincidence (76262's TxDOT marker is within
    # 5 m of its official line): the centroid-shortcut test applies to point-geometry records only.
    iss["at_centroid"] = sum(1 for r in d if r["d_centroid_m"] is not None and r["d_centroid_m"] < CENTROID_M
                             and not any(w in str(r["geom_family"] or "").upper() for w in ("LINE", "POLYGON")))
    iss["duplicate_marker_rows"] = dup
    fam = {}
    for r in d:
        fam[str(r["geom_family"])] = fam.get(str(r["geom_family"]), 0) + 1
    BY[z]["geom_families"] = fam
    iss["non_point_geometry"] = sum(n for k, n in fam.items() if k.lower() not in ("point", "pt", "none"))
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
    fld = {f["name"]: f.get("type") for f in meta.get("fields", [])}
    if datecol and fld.get(datecol) == "esriFieldTypeString":
        mx = ""
        j = http_json(url, {"f": "json", "where": where, "outFields": datecol, "returnGeometry": "false", "resultRecordCount": 5000})
        for ft in j.get("features", []):
            v = str(ft["attributes"].get(datecol) or "")
            m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", v)
            iso = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}" if m else v[:10]
            mx = max(mx, iso)
        info["newest_source_record"] = mx or None
    elif datecol:
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


NPG = {}    # (reg,id) -> publisher line/polygon parts, for the line/polygon geometry check
PUBPT = {}  # (reg,id) -> (x,y) | "NONPOINT" | "AMBIGUOUS" (several official features share the id)
for reg, ids in want.items():
    e = ARC[reg]
    idcol = e["column_map"].get("case_number")
    if not idcol:
        PUB[reg]["compare"] = "UNVERIFIED: registry has no case_number column"
        continue
    got = 0
    # chunk size follows the publisher's own record cap (n5_shard does the same): a big chunk against a layer whose features are many long parts
    # overruns the cap, the server answers exceededTransferLimit and omits the rest -> a false "publisher_not_found".
    mrc = http_json(e["service_url"], {"f": "json"}).get("maxRecordCount")
    try:
        step = max(10, min(150, int(mrc) // 8)) if mrc else 25
    except (TypeError, ValueError):
        step = 25
    for ch in chunks(sorted(ids), step):
        def lits(quote):
            return ",".join(i if (not quote and re.fullmatch(r"-?\d+", i)) else "'" + i.replace("'", "''") + "'" for i in ch)
        feats_ch, j = [], None
        for quote in (False, True):  # a string-typed id column rejects bare numerics (HTTP 400)
            feats_ch, off_ = [], 0
            while True:
                j = http_json(e["service_url"] + "/query", {
                    "f": "json", "where": f"{idcol} IN ({lits(quote)})", "outFields": idcol,
                    "returnGeometry": "true", "outSR": "4326", "resultOffset": off_, "resultRecordCount": 500, "orderByFields": idcol})
                if "_fetch_error" in j and off_ == 0:    # a layer without pagination support: ask once, unpaged, and refuse a truncated answer
                    j = http_json(e["service_url"] + "/query", {
                        "f": "json", "where": f"{idcol} IN ({lits(quote)})", "outFields": idcol, "returnGeometry": "true", "outSR": "4326"})
                    if "_fetch_error" not in j and j.get("exceededTransferLimit"):
                        j = {"_fetch_error": "truncated response (exceededTransferLimit) and the layer does not page"}
                if "_fetch_error" in j:
                    break
                feats_ch += j.get("features", [])
                if not j.get("exceededTransferLimit"):
                    break                      # a page that says it is not the last one is paged, never read as the whole answer
                off_ += len(j.get("features", []))
                if off_ > 20000:
                    j = {"_fetch_error": "paging did not terminate"}
                    break
            if "_fetch_error" not in j:
                break
        if "_fetch_error" in j:
            PUB[reg]["compare"] = "UNVERIFIED: fetch error " + j["_fetch_error"]
            break
        j = {"features": feats_ch}
        for ft in j.get("features", []):
            g, a = ft.get("geometry") or {}, ft["attributes"]
            k = (reg, str(a.get(idcol)))
            new = (g["x"], g["y"]) if "x" in g and "y" in g else "NONPOINT"
            if new == "NONPOINT":
                # a line/polygon project may legitimately be several features (parts); they are ONE project, so keep every part
                # (the marker rule is defined on the merged geometry) instead of calling the id ambiguous
                parts = g.get("paths") or g.get("rings") or []
                NPG.setdefault(k, {"kind": "paths" if g.get("paths") else "rings", "parts": []})["parts"].append(parts)
                if PUBPT.get(k) not in (None, "NONPOINT"):
                    PUBPT[k] = "AMBIGUOUS"
                else:
                    PUBPT[k] = "NONPOINT"
            else:
                PUBPT[k] = "AMBIGUOUS" if k in PUBPT else new
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
    cmp_ = {"match": 0, "mismatch": 0, "publisher_not_found": 0, "nonpoint_unverified": 0, "not_arcgis_unverified": 0,
            "ambiguous_identity": 0, "comparison_unavailable": 0}
    bad, nf_keys = [], []
    for r in BY[z]["dots"]:
        m = key_re.match(r["source_key"] or "")
        if not m or m.group(1) not in ARC:
            cmp_["not_arcgis_unverified"] += 1
            continue
        pt = PUBPT.get((m.group(1), m.group(2)))
        if str(PUB.get(m.group(1), {}).get("compare", "")).startswith("UNVERIFIED"):
            cmp_["comparison_unavailable"] += 1          # a failed comparison is never "not found" and never a match
        elif pt == "AMBIGUOUS":
            cmp_["ambiguous_identity"] += 1
        elif pt is None:
            cmp_["publisher_not_found"] += 1
            nf_keys.append(r["source_key"])
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
    # every "not found" is asked again, one id at a time, by exact equality: an id the publisher DOES return would be an instrument fault
    # (a truncated or mis-quoted batch), an id it does not return is a stored record the publisher no longer lists.
    confirmed = {}
    for k_ in nf_keys:
        reg_, id_ = key_re.match(k_).groups()
        idc_ = ARC[reg_]["column_map"].get("case_number")
        n_ = None
        for lit_ in ([id_] if re.fullmatch(r"-?\d+", id_) else []) + ["'" + id_.replace("'", "''") + "'"]:
            j_ = http_json(ARC[reg_]["service_url"] + "/query", {"f": "json", "where": f"{idc_} = {lit_}", "outFields": idc_, "returnGeometry": "false"})
            if "_fetch_error" not in j_:
                n_ = len(j_.get("features", []))
                break
        confirmed[k_] = n_      # 0 = absent at the publisher, >0 = the batch lookup missed a record that exists, None = could not ask
    BY[z]["publisher_not_found_requery"] = confirmed

# line/polygon dots: the dot must lie ON the publisher's own geometry (measured distance, SRID-safe, geography metres).
# Membership of the dot in the ZIP polygon is the polygon_membership check; this proves the dot is where the publisher's line is.
NONPOINT_TOL_M = 5.0
def _wkt(info):
    if info["kind"] == "paths":
        return "MULTILINESTRING(" + ",".join("(" + ",".join(f"{x} {y}" for x, y in p) + ")" for part in info["parts"] for p in part if len(p) > 1) + ")"
    return "MULTIPOLYGON(" + ",".join("((" + ",".join(f"{x} {y}" for x, y in r) + "))" for part in info["parts"] for r in part if len(r) > 3) + ")"
def _usable(w):
    return w not in ("MULTILINESTRING()", "MULTIPOLYGON()")
for z in ZIPS:
    cmp_ = BY[z]["publisher_compare"]
    cmp_["nonpoint_off_geometry"] = 0
    cmp_["nonpoint_verified"] = 0
    off, vals = [], []
    for r in BY[z]["dots"]:
        m = key_re.match(r["source_key"] or "")
        if not m or m.group(1) not in ARC:
            continue
        k = (m.group(1), m.group(2))
        if PUBPT.get(k) == "NONPOINT" and k in NPG and _usable(_wkt(NPG[k])):
            vals.append((r["source_key"], r.get("marker_seq"), r["lng"], r["lat"], _wkt(NPG[k])))
    for i in range(0, len(vals), 40):
        part = vals[i:i + 40]
        lit = ",".join(f"('{sk}',{sq if sq is not None else 'null'},{x},{y},'{w}')" for sk, sq, x, y, w in part)
        res = rows(f"""select v.sk, v.seq, ST_Distance(ST_GeogFromText('SRID=4326;'||v.w), ST_SetSRID(ST_Point(v.x,v.y),4326)::geography) d_m
                       from (values {lit}) v(sk,seq,x,y,w)""")
        for rr in res:
            if rr["d_m"] is None:
                continue                      # no distance computed: stays unverified, never counted as on-geometry
            cmp_["nonpoint_verified"] += 1
            if rr["d_m"] > NONPOINT_TOL_M:
                cmp_["nonpoint_off_geometry"] += 1
                off.append({"source_key": rr["sk"], "marker_seq": rr["seq"], "dist_m": round(rr["d_m"], 1)})
    # only dots whose distance to the publisher's own geometry was actually computed leave the "unverified" count
    cmp_["nonpoint_unverified"] = max(0, cmp_["nonpoint_unverified"] - cmp_["nonpoint_verified"])
    BY[z]["nonpoint_off_detail"] = off[:20]

# eligibility / missing IDs: point layers, publisher point inside ZIP polygon vs serving membership
ELIG = {}  # zip -> {reg: (eligible, missing_list)}
DUPIDS = {}  # reg -> eligible ids carried by more than one official feature
for reg, e in ARC.items():
    if reg not in want and reg not in ("denton-county-dev-permits", "frisco-active-building-permits",
                                         "fort-worth-development-permits"):
        continue
    if reg not in PUB:
        PUB[reg] = {"registry_id": reg, "service_url": e["service_url"],
                    "geometryType": http_json(e["service_url"], {"f": "json"}).get("geometryType")}
    idcol = e["column_map"].get("case_number")
    if not idcol:
        PUB[reg]["eligibility"] = "UNVERIFIED: no case_number column in registry"
        continue
    where = e.get("extra_where") or "1=1"
    stcol = e["column_map"].get("status_raw")
    stmap = {}
    for bucket, vals in (e.get("status_to_bucket") or {}).items():
        for v in vals or []:
            stmap[str(v).strip().lower()] = bucket
    gtype = PUB[reg].get("geometryType")
    if e.get("geocode_assemble"):
        # The engine places these records by geocoding the ADDRESS; the publisher has no coordinate to put in a polygon, so the
        # polygon-membership test cannot be run against the publisher. State the measured reason (and the one thing that CAN be
        # measured, the publisher's own ZIP column when it has one) instead of leaving the registry silently "incomplete".
        zc = e["column_map"].get("zip")
        info = {"geometryType": gtype, "layer_has_geometry": gtype is not None, "registry_coordinates": [e["column_map"].get("lat"), e["column_map"].get("lng")],
                "publisher_zip_column": zc}
        if zc:
            rows_, off_, ok_ = {}, 0, True
            zin = ",".join(f"'{z}'" for z in ZIPS)
            while True:
                j = http_json(e["service_url"] + "/query", {"f": "json", "where": f"({where}) AND {zc} IN ({zin})",
                                                            "outFields": ",".join(x for x in (idcol, zc, stcol) if x), "returnGeometry": "false",
                                                            "resultOffset": off_, "resultRecordCount": 1000, "orderByFields": idcol})
                if "_fetch_error" in j:
                    ok_ = False
                    info["zip_column_error"] = j["_fetch_error"]
                    break
                fs_ = j.get("features", [])
                for f in fs_:
                    a_ = f["attributes"]
                    b_ = stmap.get(str(a_.get(stcol) or "").strip().lower()) if stmap else "x"
                    if b_ is None or b_ == "exclude":
                        continue
                    rows_.setdefault(str(a_.get(zc))[:5], set()).add(str(a_.get(idcol)))
                if not j.get("exceededTransferLimit"):
                    break
                off_ += len(fs_)
                if off_ > 200000:
                    ok_ = False
                    info["zip_column_error"] = "truncated"
                    break
            if ok_:
                per = {}
                for z in ZIPS:
                    srv = {r["source_key"].split(":", 2)[2] for r in rows(f"select source_key from geo.n5_serving_membership where zcta5::text='{z}' and source_key like 'arcgis:{reg}:%'")}
                    el = rows_.get(z, set())
                    per[z] = {"publisher_rows_stating_this_zip": len(el), "of_them_served_here": len(el & srv), "served_here_total": len(srv)}
                info["by_audit_zip"] = {z: v for z, v in per.items() if v["publisher_rows_stating_this_zip"] or v["served_here_total"]}
        PUB[reg]["eligibility_measurement"] = info
        PUB[reg]["eligibility"] = ("UNRECONCILABLE: coordinates are geocoded by the engine from the address (registry lat/lng=__lat/__lng); layer geometryType=%s, so the publisher "
                                   "has no point to test against the ZIP polygon%s" % (gtype, "; its own ZIP column (%s) is reported in eligibility_measurement but is not a membership test" % zc if zc else ""))
        continue
    if gtype in ("esriGeometryPolyline", "esriGeometryPolygon"):
        # Serving membership of a line/polygon project = its geometry INTERSECTS the ZIP boundary (docs/n5-generation-publish.sql,
        # step (1): ST_Intersects(c.geom, b.geom)); markers are derived afterwards (LINE_MERGED_COMPONENT_INTERVAL_1000M). So the eligible set
        # for a ZIP is: publisher features passing the registry's own extra_where + status rule whose geometry intersects the ZIP polygon.
        ext = rows(f"select min(ST_XMin(g)) x0, min(ST_YMin(g)) y0, max(ST_XMax(g)) x1, max(ST_YMax(g)) y1 from "
                   f"(select ST_Transform(geo.zip_membership_boundary(z.zip),4326) g from unnest(array[{zl}]) z(zip) where geo.zip_membership_boundary(z.zip) is not null) t")
        x0, y0, x1, y1 = [float(ext[0][k]) for k in ("x0", "y0", "x1", "y1")]
        feats, off, trunc, st_excluded, err = {}, 0, False, 0, None
        ofields = idcol + ("," + stcol if stcol and stcol != idcol else "")
        while True:
            j = http_json(e["service_url"] + "/query", {
                "f": "json", "where": where, "outFields": ofields, "returnGeometry": "true", "outSR": "4326",
                "geometry": json.dumps({"xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1, "spatialReference": {"wkid": 4326}}),
                "geometryType": "esriGeometryEnvelope", "inSR": "4326", "spatialRel": "esriSpatialRelIntersects",
                "resultOffset": off, "resultRecordCount": 500, "orderByFields": idcol})
            if "_fetch_error" in j:
                err = j["_fetch_error"]
                break
            fs = j.get("features", [])
            for f in fs:
                g = f.get("geometry") or {}
                parts = g.get("paths") or g.get("rings") or []
                if not parts:
                    continue
                if stmap:
                    b = stmap.get(str(f["attributes"].get(stcol) or "").strip().lower())
                    if b is None or b == "exclude":
                        st_excluded += 1
                        continue
                feats.setdefault(str(f["attributes"][idcol]), {"kind": "paths" if g.get("paths") else "rings", "parts": []})["parts"].append(parts)
            if not j.get("exceededTransferLimit") and len(fs) < 500:
                break
            off += len(fs)
            if off > 200000:
                trunc = True
                break
        if err:
            PUB[reg]["eligibility"] = "UNVERIFIED: fetch error " + err
            continue
        PUB[reg]["eligibility"] = "ok" if not trunc else "TRUNCATED"
        PUB[reg]["eligibility_method"] = "nonpoint: ST_Intersects(publisher geometry, ZIP boundary), same predicate as serving membership"
        PUB[reg]["source_projects_in_audit_bbox"] = len(feats)
        PUB[reg]["excluded_by_status"] = st_excluded
        DUPIDS[reg] = set()      # several features under one id are parts of ONE line/polygon project, not an identity clash
        inzip = {}
        ids_ = sorted(feats)
        for ch in chunks(ids_, 25):
            vals = ",".join("('" + i.replace("'", "''") + "','" + _wkt(feats[i]) + "')" for i in ch if _usable(_wkt(feats[i])))
            if not vals:
                continue
            res = rows(f"""select v.id, b.zip from (values {vals}) v(id,w)
              join lateral (select z.zip from unnest(array[{zl}]) z(zip)
                where geo.zip_membership_boundary(z.zip) is not null
                  and ST_Intersects(geo.zip_membership_boundary(z.zip), ST_SetSRID(ST_GeomFromText(v.w),4269))) b on true""")
            for r in res:
                inzip.setdefault(r["zip"], set()).add(r["id"])
        causes = {}
        for z in ZIPS:
            mem = rows(f"select source_key from geo.n5_serving_membership where zcta5::text='{z}' and source_key like 'arcgis:{reg}:%'")
            have = {r["source_key"].split(":", 2)[2] for r in mem}
            have |= {m.group(2) for r in BY[z]["dots"] for m in [key_re.match(r["source_key"] or "")] if m and m.group(1) == reg}
            el = inzip.get(z, set())
            ELIG.setdefault(z, {})[reg] = (len(el), sorted(el - have))
            for i in sorted(el - have):
                causes.setdefault(i, []).append(z)
        # WHY an eligible project is not served (informational; the verdict input is the missing count itself)
        if causes:
            kl = ",".join("'arcgis:%s:%s'" % (reg, i.replace("'", "''")) for i in sorted(causes))
            cr = rows(f"""select k.sk,
                 exists (select 1 from public.app_projects a where a.source_key = k.sk) in_app_projects,
                 exists (select 1 from geo.n5_geom g where g.source_key = k.sk and g.outcome = 1 and g.geom is not null) has_candidate_geom,
                 (select string_agg(distinct g.outcome::text, ',') from geo.n5_geom g where g.source_key = k.sk) geom_outcomes,
                 (select count(*) from geo.n5_serving_membership m where m.source_key = k.sk) memberships_anywhere
               from unnest(array[{kl}]) k(sk)""")
            tally = {}
            for r in cr:
                key = ("not_in_app_projects" if not r["in_app_projects"] else
                       "no_candidate_geometry(outcomes=%s)" % r["geom_outcomes"] if not r["has_candidate_geom"] else
                       "candidate_geometry_but_no_membership_in_this_zip")
                tally[key] = tally.get(key, 0) + 1
            PUB[reg]["missing_causes"] = tally
            PUB[reg]["missing_examples"] = [{"id": i, "zips": zs} for i, zs in list(causes.items())[:15]]
        print(f"[pub] {reg}: {len(feats)} nonpoint projects (bbox) reconciled", file=sys.stderr)
        continue
    if gtype != "esriGeometryPoint":
        PUB[reg]["eligibility"] = "UNVERIFIED: layer geometryType=%s is not point/polyline/polygon" % gtype
        continue
    allrows, off, trunc, st_excluded = [], 0, False, 0
    idcount = {}
    ofields = idcol + ("," + stcol if stcol and stcol != idcol else "")
    while True:
        j = http_json(e["service_url"] + "/query", {
            "f": "json", "where": where, "outFields": ofields, "returnGeometry": "true", "outSR": "4326",
            "resultOffset": off, "resultRecordCount": 2000, "orderByFields": idcol})
        if "_fetch_error" in j:
            PUB[reg]["eligibility"] = "UNVERIFIED: fetch error " + j["_fetch_error"]
            allrows = None
            break
        fs = j.get("features", [])
        for f in fs:
            if not (f.get("geometry") and "x" in f["geometry"]):
                continue
            if stmap:  # same rule as the engine: unmapped/blank/excluded status is not an eligible record
                b = stmap.get(str(f["attributes"].get(stcol) or "").strip().lower())
                if b is None or b == "exclude":
                    st_excluded += 1
                    continue
            allrows.append((str(f["attributes"][idcol]), f["geometry"]["x"], f["geometry"]["y"]))
            idcount[str(f["attributes"][idcol])] = idcount.get(str(f["attributes"][idcol]), 0) + 1
        if not j.get("exceededTransferLimit") and len(fs) < 2000:
            break
        off += len(fs)
        if off > 400000:
            trunc = True
            break
    if allrows is None:
        continue
    PUB[reg]["eligibility"] = "ok" if not trunc else "TRUNCATED"
    DUPIDS[reg] = {i for i, n in idcount.items() if n > 1}
    PUB[reg]["source_rows_with_point"] = len(allrows)
    PUB[reg]["excluded_by_status"] = st_excluded
    inzip = {}
    for ch in chunks(allrows, 1500):
        vals = ",".join(f"('{i.replace(chr(39), chr(39)*2)}',{x},{y})" for i, x, y in ch)
        res = rows(f"""select v.id, b.zip from (values {vals}) v(id,x,y)
          join lateral (select z.zip from unnest(array[{zl}]) z(zip)
            where geo.zip_membership_boundary(z.zip) is not null
              and geo.zip_point_membership_in(geo.zip_membership_boundary(z.zip), v.y, v.x) = 'member') b on true""")   # every valid ZIP, no LIMIT 1
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
def covering_registries():
    """Registered sources that claim Denton County (or all of Texas). Their reconciliation must have RUN, whether or not they display a dot."""
    def covers(e):
        return any(isinstance(c, dict) and c.get("state") == "TX" and c.get("county") in (None, "Denton") for c in (e.get("coverage") or []))
    arc = {e["registry_id"] for e in REGISTRY["arcgis"] if covers(e)}
    other = sorted(e["registry_id"] for k in ("socrata", "ckan", "csv", "carto", "opendatasoft")
                   for e in (REGISTRY.get(k) or []) if isinstance(e, dict) and covers(e))
    return arc, other
COVER_ARC, UNAUDITED_FAMILIES = covering_registries()   # non-ArcGIS families have no reconciliation here: reported, never assumed empty

def facts(z):
    """Facts for the acceptance logic. Checks the browser / attestation / classification / evidence evidence are added by denton-launch-accept.py."""
    d = BY[z]
    cut = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 365 * 86400))   # REPORTED as a fact only; never a verdict input
    d["current_non_txdot_dots"] = len([r for r in d["dots"] if r["registry_id"] not in (None, "txdot-projects-info-all")
                                       and r["filed"] and str(r["filed"]) >= cut])
    shown = {r["registry_id"] for r in d["dots"] if r["registry_id"]}
    incomplete, unrec = [], []
    if d["has_boundary"]:
        for reg in sorted((shown | COVER_ARC) & set(ARC)):
            st_ = str(PUB.get(reg, {}).get("eligibility", "NOT RUN")) if reg in PUB else "NOT RUN"
            if st_ == "ok":
                continue
            if st_.startswith("UNRECONCILABLE: "):
                unrec.append(f"{reg}: {st_[len('UNRECONCILABLE: '):]}")     # measured reason: nothing in the publisher can be tested against the polygon
            else:
                incomplete.append(reg)
    elig_reg = ELIG.get(z, {})
    missing = sum(len(v[1]) for v in elig_reg.values())
    amb = 0
    for reg in elig_reg:
        amb += len(DUPIDS.get(reg, set()) & {m.group(2) for r in d["dots"] for m in [key_re.match(r["source_key"] or "")] if m and m.group(1) == reg})
    cmp_ = d.get("publisher_compare")
    iss = d.get("issues") or {}
    nonpoint_dots = sum(1 for r in d["dots"] if any(w in str(r.get("geom_family") or "").upper() for w in ("LINE", "POLYGON")))
    geom_known = all(r.get("geom_family") for r in d["dots"])
    checks = {
        "polygon_membership": "complete" if d["has_boundary"] and all(isinstance(iss.get(k), int) for k in ("outside_polygon", "lnglat_reversed", "duplicate_marker_rows", "at_centroid")) else "not_run",
        "unique_identity": "complete" if cmp_ and not cmp_["not_arcgis_unverified"] and not cmp_["comparison_unavailable"] else "incomplete",
        "publisher_geometry": "complete" if cmp_ and not cmp_["not_arcgis_unverified"] and not cmp_["comparison_unavailable"] and not cmp_["nonpoint_unverified"] else "incomplete",
        "eligibility_reconciliation": "complete" if not incomplete and not unrec and not UNAUDITED_FAMILIES else "incomplete",
        # applicable only to line/polygon dots; vacuously complete ONLY when every dot's geometry family is known and none is a line/polygon
        "nonpoint_geometry": ("complete" if (geom_known and (nonpoint_dots == 0 or (cmp_ and cmp_.get("nonpoint_unverified") == 0 and cmp_.get("nonpoint_verified") == nonpoint_dots))) else ("incomplete" if geom_known else "not_run")),
    }
    return {"has_boundary": d["has_boundary"], "issues": iss, "members_without_marker": d.get("members_without_marker"),
            "compare": cmp_, "eligibility": {"missing": missing, "incomplete": incomplete, "unreconcilable": unrec, "ambiguous_ids": amb},
            "unaudited_source_families": list(UNAUDITED_FAMILIES), "checks": checks}

def verdict(z):
    v, why, warn = accept(facts(z))
    return v, "; ".join(why) or "all checks complete"

def freshness(z):
    """Reported as a FACT, never a verdict input: newest record each admitted source has published."""
    regs = {r["registry_id"] for r in BY[z]["dots"]}
    return {r: PUB[r].get("newest_source_record") for r in sorted(regs) if r in PUB}

out = {"generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "publishers": PUB, "zips": {}}
md = ["| ZIP | Boundary | Members | Dots | Out-of-polygon | At centroid | Reversed | Dup | Pub match/mismatch/unverified | Eligible IDs missing | Verdict | Blocker |",
      "|---|---|---:|---:|---:|---:|---:|---:|---|---:|---|---|"]
for z in ZIPS:
    d = BY[z]
    v, why = verdict(z)
    pc = d["publisher_compare"]
    missn = sum(len(x[1]) for x in ELIG.get(z, {}).values())
    out["zips"][z] = {k: d.get(k) for k in ("in_registry", "has_boundary", "members", "markers", "geo_status",
                                          "members_without_marker", "issues", "publisher_compare", "publisher_mismatches", "publisher_not_found_requery", "geom_families", "current_non_txdot_dots")}
    out["zips"][z]["eligible_missing"] = {r: {"eligible": a, "missing": m[:200], "missing_n": len(m)} for r, (a, m) in ELIG.get(z, {}).items()}
    out["zips"][z]["verdict"] = [v, why]
    out["zips"][z]["freshness_newest_record_by_source"] = freshness(z)
    out["zips"][z]["facts"] = facts(z)
    i = d["issues"]
    md.append(f"| {z} | {'yes' if d['has_boundary'] else 'NO'} | {d['members']} | {len(d['dots'])} | {i['outside_polygon']} | {i['at_centroid']} | {i['lnglat_reversed']} | {i['duplicate_marker_rows']} | "
              f"{pc['match']}/{pc['mismatch']}/{pc['not_arcgis_unverified']+pc['nonpoint_unverified']+pc['publisher_not_found']} | {missn} | {v} | {why} |")
text = "\n".join(md)
if os.environ.get("OUT_AUDIT"):
    open(os.environ["OUT_AUDIT"], "w").write(json.dumps(out, default=str))
print("----- BEGIN DENTON AUDIT JSON -----")
print(json.dumps(out, default=str))
print("----- END DENTON AUDIT JSON -----")
print("----- BEGIN DENTON AUDIT TABLE -----")
print(text)
print("----- END DENTON AUDIT TABLE -----")
if os.environ.get("GITHUB_STEP_SUMMARY"):
    open(os.environ["GITHUB_STEP_SUMMARY"], "a").write("## Denton launch audit\n\n" + text + "\n")
