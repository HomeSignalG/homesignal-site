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
detail_off, detail_far = [], []
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
            ST_Intersects(geo.zip_membership_boundary('{z}'), ST_SetSRID(ST_GeomFromText(v.w),4269)) line_hits_zip,
            ST_Distance(ST_GeogFromText('SRID=4326;'||v.w), ST_Transform(geo.zip_membership_boundary('{z}'),4326)::geography) line_to_zip_m,
            geo.zip_point_membership_in(geo.zip_membership_boundary('{z}'), v.y, v.x) = 'member' marker_in_zip,
            ST_Length(ST_GeogFromText('SRID=4326;'||v.w)) line_len_m, ST_NumGeometries(ST_GeomFromText(v.w)) line_parts
            from (values {",".join(vals)}) v(sk,seq,x,y,w)""")
        for r in res:
            if r["d_m"] > 5: off_line += 1; worst.append((z, r["sk"].split(":")[-1], r["seq"], round(r["d_m"], 1)))
            if not r["line_hits_zip"]:
                no_int += 1
                detail_off.append({"zip": z, "project": r["sk"].split(":")[-1], "seq": r["seq"], "line_to_zip_m": round(r["line_to_zip_m"], 1),
                                   "marker_in_zip": r["marker_in_zip"], "line_len_m": round(r["line_len_m"]), "line_parts": r["line_parts"]})
            if r["d_m"] > 5:
                detail_far.append({"zip": z, "project": r["sk"].split(":")[-1], "seq": r["seq"], "marker_to_line_m": round(r["d_m"], 1),
                                   "line_len_m": round(r["line_len_m"]), "line_parts": r["line_parts"], "marker_in_zip": r["marker_in_zip"]})
out["txdot_markers_more_than_5m_from_their_line"] = off_line
out["txdot_markers_whose_line_misses_the_zip_polygon"] = no_int
out["txdot_line_misses_zip_detail"] = detail_off
out["txdot_marker_far_from_line_detail"] = detail_far
# several markers on one project vs several projects: per-ZIP distribution of markers per project
from collections import Counter
per = Counter((m["zip"], m["source_key"]) for m in mk)
out["txdot_markers_per_project_distribution"] = dict(sorted(Counter(per.values()).items()))
out["txdot_projects_with_more_than_one_marker_in_a_zip"] = sum(1 for v in per.values() if v > 1)
out["txdot_worst"] = sorted(worst, key=lambda t: -t[3])[:15]

# ---- 3. the 76262 centroid marker
out["z76262_centroid"] = sql("""select k.source_key, k.marker_seq, k.marker_rule, k.lat, k.lng, p.registry_id, p.name, p.address, p.type, p.submitted_at::date filed
  from geo.n5_serving_marker k cross join lateral (select geo.zip_membership_boundary('76262') g) b
  left join lateral (select registry_id,name,address,type,submitted_at from public.app_projects a where a.source_key=k.source_key order by a.id limit 1) p on true
  where k.zcta5::text='76262' and ST_Distance(ST_Transform(ST_Centroid(b.g),4326)::geography, ST_SetSRID(ST_Point(k.lng,k.lat),4326)::geography) < 25""")
# ---- 4. ZIP 75033: which dots does the audit's identity lookup fail to find at the publisher, and why? (WSC-1)
# Replays the audit's lookup EXACTLY (all 32 audit ZIPs' ids per registry, sorted, chunks of 150, unquoted-then-quoted, one request per chunk,
# no paging) and then asks again the way n5_shard does (small chunks + exceededTransferLimit paging) and one id at a time.
AUDIT_ZIPS = ("75007 75010 75022 75027 75028 75029 75033 75036 75056 75057 75065 75067 75068 75077 76201 76202 76203 76204 76205 76206 76207 76208 76209 76210 "
              "76226 76227 76247 76249 76258 76259 76262 76266").split()
zl = ",".join(f"'{z}'" for z in AUDIT_ZIPS)
allmk = sql(f"select k.zcta5::text zip, k.source_key, k.marker_seq, k.lat, k.lng, k.marker_rule from geo.n5_serving_marker k where k.zcta5::text in ({zl})")
key_re = re.compile(r"^arcgis:([^:]+):(.+)$")
want = {}
for m in allmk:
    mm = key_re.match(m["source_key"] or "")
    if mm and mm.group(1) in REG: want.setdefault(mm.group(1), set()).add(mm.group(2))
def lits(ch, quote):
    return ",".join(i if (not quote and re.fullmatch(r"-?\d+", i)) else "'" + i.replace("'", "''") + "'" for i in ch)
def audit_lookup(reg, ids):
    e = REG[reg]; idcol = e["column_map"].get("case_number"); found = {}; det = []
    ids = sorted(ids)
    for i in range(0, len(ids), 150):
        ch = ids[i:i + 150]; j = None; used = None
        for quote in (False, True):
            j = q(e["service_url"] + "/query", {"f": "json", "where": f"{idcol} IN ({lits(ch, quote)})", "outFields": idcol, "returnGeometry": "true", "outSR": "4326"})
            used = quote
            if "_err" not in j: break
        fs = j.get("features", []) if "_err" not in j else []
        for f in fs:
            found[str(f["attributes"].get(idcol))] = found.get(str(f["attributes"].get(idcol)), 0) + 1
        det.append({"chunk": i // 150, "asked": len(ch), "features_returned": len(fs), "exceededTransferLimit": bool(j.get("exceededTransferLimit")),
                    "quoted": used, "err": j.get("_err"), "distinct_ids_returned": len({str(f['attributes'].get(idcol)) for f in fs}),
                    "response_chars": len(json.dumps(j))})
    return found, det
def paged_lookup(reg, ids, chunk=25):
    e = REG[reg]; idcol = e["column_map"].get("case_number"); found = {}
    ids = sorted(ids)
    for i in range(0, len(ids), chunk):
        ch = ids[i:i + chunk]
        for quote in (False, True):
            off = 0; ok = True; got = []
            while True:
                j = q(e["service_url"] + "/query", {"f": "json", "where": f"{idcol} IN ({lits(ch, quote)})", "outFields": idcol, "returnGeometry": "false",
                                                     "resultOffset": off, "resultRecordCount": 1000, "orderByFields": idcol})
                if "_err" in j: ok = False; break
                got += j.get("features", [])
                if not j.get("exceededTransferLimit"): break
                off += len(j.get("features", []))
            if ok: break
        for f in got:
            found[str(f["attributes"].get(idcol))] = found.get(str(f["attributes"].get(idcol)), 0) + 1
    return found
out["z75033_dots"] = [{"key": m["source_key"], "seq": m["marker_seq"], "lat": m["lat"], "lng": m["lng"], "rule": m["marker_rule"]} for m in allmk if m["zip"] == "75033"]
nf = {}
out["lookup_by_registry"] = {}
for reg, ids in want.items():
    meta = q(REG[reg]["service_url"], {"f": "json"})
    fld = {f["name"]: f.get("type") for f in meta.get("fields", [])}
    idcol = REG[reg]["column_map"].get("case_number")
    found, det = audit_lookup(reg, ids)
    miss = sorted(set(ids) - set(found))
    out["lookup_by_registry"][reg] = {"ids_asked": len(ids), "ids_found_by_audit_method": len(found), "not_found": len(miss), "idcol": idcol, "idcol_type": fld.get(idcol),
        "maxRecordCount": meta.get("maxRecordCount"), "geometryType": meta.get("geometryType"), "chunks": det[:40]}
    nf[reg] = miss
    if miss:
        pf = paged_lookup(reg, miss)
        out["lookup_by_registry"][reg]["not_found_ids_sample"] = miss[:20]
        out["lookup_by_registry"][reg]["recovered_by_small_chunk_paging"] = len([i for i in miss if i in pf])
out["z75033_not_found"] = []
for m in allmk:
    mm = key_re.match(m["source_key"] or "")
    if mm and mm.group(1) in REG and mm.group(2) in set(nf.get(mm.group(1), [])):
        reg, ident = mm.group(1), mm.group(2); idcol = REG[reg]["column_map"].get("case_number")
        single = {}
        for label, where in (("bare", f"{idcol} = {ident}" if re.fullmatch(r"-?\d+", ident) else None), ("quoted", f"{idcol} = '{ident}'"),
                             ("like", f"{idcol} LIKE '%{ident}%'"), ("trim_upper", f"UPPER(TRIM({idcol})) = '{ident.upper()}'")):
            if where is None: continue
            j = q(REG[reg]["service_url"] + "/query", {"f": "json", "where": where, "outFields": "*", "returnGeometry": "true", "outSR": "4326"})
            fs = j.get("features", []) if "_err" not in j else []
            single[label] = {"n": len(fs), "err": j.get("_err"), "ids": sorted({str(f['attributes'].get(idcol)) for f in fs})[:5],
                             "geomkeys": sorted({k for f in fs for k in (f.get('geometry') or {}).keys()})}
        out["z75033_not_found"].append({"zip": m["zip"], "key": m["source_key"], "reg": reg, "marker": [m["lat"], m["lng"]], "single_requery": single})
nk = sorted({x["key"] for x in out["z75033_not_found"]})
if nk:
    out["z75033_not_found_app_projects"] = sql("select source_key, registry_id, status, submitted_at::date filed, left(name,80) name, left(address,80) addr from public.app_projects where source_key in (" + ",".join("'" + k.replace("'", "''") + "'" for k in nk) + ") order by source_key limit 40")

print("----- BEGIN DENTON INVESTIGATE PART4 -----")
print(json.dumps({k: v for k, v in out.items() if k.startswith(("z75033", "lookup_by"))}, default=str))
print("----- END DENTON INVESTIGATE PART4 -----")
_sql_orig = sql
def sql(q):          # section 5 is diagnostic: a failed statement is reported in the output, it must not discard what was already measured
    try:
        return _sql_orig(q)
    except Exception as ex:
        return [{"sql_error": str(ex)[:400]}]
# ---- 5. ZIP 76207 / TxDOT 008113084: is the 16.7 m offset a misplacement, a CRS artifact or a stale/simplified stored line?
TXK = "arcgis:txdot-projects-info-all:008113084"
out["z76207_markers"] = sql(f"select zcta5::text zip, source_key, marker_seq, lat, lng, marker_rule, family, dim from geo.n5_serving_marker where source_key = '{TXK}'")
out["z76207_membership"] = sql(f"select zcta5::text zip, lat, lng, point_rule, clip_dim, feature_count, geom_family from geo.n5_serving_membership where source_key = '{TXK}'")
out["z76207_n5_geom"] = sql(f"""select to_jsonb(gg) - 'geom' meta, ST_SRID(gg.geom) srid, GeometryType(gg.geom) gtype, ST_NPoints(gg.geom) npts, ST_NumGeometries(gg.geom) ngeom,
    ST_Length(gg.geom::geography) len_m, md5(ST_AsText(gg.geom)) wkt_md5 from geo.n5_geom gg where gg.source_key = '{TXK}'""")
pubs = {}
for label, sr in (("outSR_4326", "4326"), ("outSR_4269", "4269"), ("native", None)):
    prm = {"f": "json", "where": "CONTROL_SECT_JOB = '008113084'", "outFields": "CONTROL_SECT_JOB,OBJECTID", "returnGeometry": "true"}
    if sr: prm["outSR"] = sr
    j = q(tx["service_url"] + "/query", prm)
    fs = j.get("features", []) if "_err" not in j else []
    paths = [(f.get("geometry") or {}).get("paths") or [] for f in fs]
    pubs[label] = {"n_features": len(fs), "spatialReference": j.get("spatialReference"), "oids": [f["attributes"].get("OBJECTID") for f in fs],
                   "n_paths": sum(len(p) for p in paths), "n_vertices": sum(len(pp) for p in paths for pp in p), "err": j.get("_err"), "paths": paths}
out["z76207_publisher"] = {k: {kk: vv for kk, vv in v.items() if kk != "paths"} for k, v in pubs.items()}
def mls(paths, srid):
    return "SRID=%s;MULTILINESTRING(" % srid + ",".join("(" + ",".join(f"{x} {y}" for x, y in pp) + ")" for p in paths for pp in p if len(pp) > 1) + ")"
mk76207 = [m for m in out["z76207_markers"] if m.get("zip") == "76207"]
def dist_sql(w):
    return ("select v.seq, ST_Distance(ST_Transform(ST_GeomFromEWKT('" + w + "'),4326)::geography, ST_SetSRID(ST_Point(v.x,v.y),4326)::geography) d_m from (values " +
            ",".join(f"({m['marker_seq']},{m['lng']},{m['lat']})" for m in mk76207) + ") v(seq,x,y)")
for label, srid in (("outSR_4326", 4326), ("outSR_4269", 4269)):
    if pubs[label]["paths"] and mk76207:
        out["z76207_dist_" + label] = sql(dist_sql(mls(pubs[label]["paths"], srid)))
nat = pubs["native"]
wk = (nat.get("spatialReference") or {}).get("latestWkid") or (nat.get("spatialReference") or {}).get("wkid")
if nat["paths"] and wk and mk76207:
    out["z76207_dist_native_wkid_%s" % wk] = sql(dist_sql(mls(nat["paths"], wk)))
out["z76207_stored_vs_marker_and_rederived"] = sql(f"""
with b as (select geo.zip_membership_boundary('76207') g),
 raw as (select gg.geom from geo.n5_geom gg where gg.source_key = '{TXK}' and gg.outcome = 1 and gg.geom is not null),
 clip as (select ST_Intersection(ST_MakeValid(ST_Union(raw.geom)), b.g) c, ST_Union(raw.geom) u from raw cross join b),
 comp as (select d.geom gm, ST_Length(d.geom::geography) len_m, ST_NPoints(d.geom) npts from clip, ST_Dump(ST_LineMerge(ST_CollectionExtract(clip.c, 2))) d),
 mk as (select marker_seq seq, lat, lng from geo.n5_serving_marker where source_key = '{TXK}' and zcta5::text = '76207')
select mk.seq, mk.lat, mk.lng,
  (select ST_Distance(clip.u::geography, ST_SetSRID(ST_Point(mk.lng, mk.lat), 4269)::geography) from clip) d_to_stored_n5_geom_m,
  (select ST_Distance(clip.c::geography, ST_SetSRID(ST_Point(mk.lng, mk.lat), 4269)::geography) from clip) d_to_clip_m,
  (select count(*) from comp) n_components, (select sum(len_m) from comp) comp_len_m, (select sum(npts) from comp) comp_npts,
  (select ST_Y(ST_LineInterpolatePoint(gm, 0.5)) from comp order by len_m desc limit 1) rederived_lat_half,
  (select ST_X(ST_LineInterpolatePoint(gm, 0.5)) from comp order by len_m desc limit 1) rederived_lng_half
from mk""")

print("----- BEGIN DENTON INVESTIGATE JSON -----")
print(json.dumps(out, default=str))
print("----- END DENTON INVESTIGATE JSON -----")
