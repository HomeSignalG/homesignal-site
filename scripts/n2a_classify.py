#!/usr/bin/env python3
"""N2A - national source-geometry classification and the POINT-fidelity gate.

N1 established that nothing we already hold can tell us which publishers serve
points, lines or polygons:

  * jurisdiction-registry.json has no geometry-type field on any of its 239 entries;
  * provenance.geo_precision is 'point' for 99.0% of development rows INCLUDING the
    B3-proven LINE and POLYGON publishers, so it classifies the stored coordinate,
    not the publisher.

Using either as a classifier would exempt line and polygon sources from geometry
recovery - reproducing, nationally, the exact defect Phase 2 exists to correct.
So N2A asks each publisher directly.

Nothing here writes to the database. Every mode is read-only: it reads the frozen
preservation snapshot and the live publisher metadata, and prints its findings.

Modes:
  n2a-zcta      Step 0. Downloads the authoritative TIGER ZCTA archive, records its
                sha256 and byte length, reads the ZCTA5 codes out of the .dbf ONLY
                (no polygon is parsed or stored), and reconciles them against the
                canonical HomeSignal ZIP universe read from the database.
  n2a-classify  Step 1. Reads each registry's own service metadata and records the
                publisher's verbatim geometry type. A failed probe is UNRESOLVED,
                never POINT.
  n2a-fidelity  Step 3. For registries the publisher reports as esriGeometryPoint,
                compares stored HomeSignal lat/lng against the publisher's own
                coordinates for the same feature identity, source by source.

stdlib only.
"""

import hashlib
import io
import json
import os
import ssl
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

UA = "HomeSignal-n2a/1.0 (+https://homesignal.net)"
PROJECT_REF = "qwnnmljucajnexpxdgxr"
SNAPSHOT = "phase1-2026-09-01"
REGISTRY = "supabase/functions/get-address-report/jurisdiction-registry.json"

TIGER_URL = "https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/tl_2025_us_zcta520.zip"

PROBE_TIMEOUT = 45
POLITE = 0.4
RETRIES = (0, 3, 9)

# Publisher geometry type -> our classification vocabulary. The publisher's own
# string is always preserved verbatim beside the class; this map only decides how we
# BUCKET it, never what we claim the publisher said.
ESRI_CLASS = {
    "esriGeometryPoint": "POINT",
    "esriGeometryMultipoint": "MULTIPOINT",
    "esriGeometryPolyline": "POLYLINE",
    "esriGeometryPolygon": "POLYGON",
    "esriGeometryEnvelope": "POLYGON",
}


def say(k, v):
    print(f"{k:<44} {v}", flush=True)


def sql(query, tag=""):
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": UA},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"STOP: SQL {tag} failed HTTP {e.code}\n{e.read().decode()[:3000]}")


def get(url, timeout=PROBE_TIMEOUT):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def get_json(url, timeout=PROBE_TIMEOUT):
    """Returns (json, None) or (None, reason). A reason is never turned into a
    geometry type by any caller."""
    last = ""
    for i, wait in enumerate(RETRIES):
        if wait:
            time.sleep(wait)
        try:
            raw = get(url, timeout)
            try:
                return json.loads(raw.decode("utf-8", "replace")), None
            except Exception as e:
                return None, f"MALFORMED_JSON {type(e).__name__} {len(raw)}B"
        except urllib.error.HTTPError as e:
            last = f"HTTP_{e.code}"
            if e.code in (401, 403):
                return None, f"AUTH_REQUIRED {last}"
            if e.code == 404:
                return None, f"NOT_FOUND {last}"
        except urllib.error.URLError as e:
            last = f"URLERROR {str(e.reason)[:60]}"
        except Exception as e:
            last = f"{type(e).__name__} {str(e)[:60]}"
    return None, last or "UNKNOWN"


def registry_index():
    reg = json.load(open(REGISTRY))
    out = {}
    for grp in ("socrata", "arcgis", "ckan", "csv", "carto", "opendatasoft"):
        for e in reg.get(grp, []):
            out[e["registry_id"]] = {
                "group": grp, "platform": e.get("platform", grp),
                "service_url": e.get("service_url"), "dataset_url": e.get("dataset_url"),
                "domain": e.get("domain"), "dataset_id": e.get("dataset_id"),
                "base_url": e.get("base_url"), "resource_id": e.get("resource_id"),
                "sql_url": e.get("sql_url"), "url": e.get("url"),
                "column_map": e.get("column_map") or {},
            }
    return out


def frozen_inventory():
    rows = sql(f"""
      select coalesce(registry_id,'(null)') as registry_id,
             count(distinct source_key) as projects,
             count(*) as rows_n,
             count(distinct source_key||'|'||zip) as pairs
        from preservation.app_project_identity
       where snapshot_id='{SNAPSHOT}' and record_kind='development'
       group by 1 order by 2 desc;""", "inventory")
    return rows


# ------------------------------------------------------------------ step 0

def dbf_field_values(dbf_bytes, field_name):
    """Read one character field out of a .dbf. Only the header and that column are
    decoded; no geometry is touched and nothing is stored."""
    n_rec, hdr_len, rec_len = struct.unpack("<IHH", dbf_bytes[4:12])
    fields, off = [], 32
    while dbf_bytes[off] != 0x0D:
        raw = dbf_bytes[off:off + 32]
        nm = raw[:11].split(b"\0")[0].decode("ascii", "replace")
        fields.append((nm, raw[16]))
        off += 32
    pos, target = 1, None
    for nm, ln in fields:
        if nm.upper() == field_name.upper():
            target = (pos, ln)
        pos += ln
    if not target:
        raise SystemExit(f"STOP: .dbf has no field {field_name}; found {[f[0] for f in fields]}")
    start, ln = target
    out = []
    for i in range(n_rec):
        base = hdr_len + i * rec_len
        if dbf_bytes[base:base + 1] == b"*":
            continue
        out.append(dbf_bytes[base + start:base + start + ln].decode("ascii", "replace").strip())
    return out, n_rec, [f[0] for f in fields]


def step0_zcta():
    say("mode", "n2a-zcta (step 0, read-only)")
    say("artifact", TIGER_URL)
    t0 = time.time()
    blob = get(TIGER_URL, timeout=1800)
    sha = hashlib.sha256(blob).hexdigest()
    say("bytes", f"{len(blob):,}")
    say("sha256", sha)
    say("download seconds", round(time.time() - t0, 1))

    zf = zipfile.ZipFile(io.BytesIO(blob))
    names = zf.namelist()
    say("archive members", ", ".join(sorted(names)))
    dbf = [n for n in names if n.lower().endswith(".dbf")][0]
    codes, n_rec, fieldnames = dbf_field_values(zf.read(dbf), "ZCTA5CE20")
    say(".dbf fields", ", ".join(fieldnames))
    say("dbf record count", f"{n_rec:,}")

    zcta = sorted(set(codes))
    say("NATIONAL ZCTA COUNT (distinct)", f"{len(zcta):,}")
    if len(zcta) != len(codes):
        say("  duplicate codes in dbf", len(codes) - len(zcta))

    rows = sql("select zip from public.development_reports order by zip;", "canonical zips")
    canon = sorted({r["zip"] for r in rows})
    say("CANONICAL HOMESIGNAL ZIPs", f"{len(canon):,}")

    zset = set(zcta)
    matched = [z for z in canon if z in zset]
    unmatched = [z for z in canon if z not in zset]
    say("EXACT ZIP<->ZCTA MATCHES", f"{len(matched):,}")
    say("UNMATCHED CANONICAL ZIPs", f"{len(unmatched):,}")
    say("control: matched+unmatched", f"{len(matched)+len(unmatched):,} (must equal canonical)")

    for probe in ("84684", "84685"):
        say(f"  exception {probe}",
            ("in canonical" if probe in set(canon) else "NOT in canonical")
            + " / " + ("in ZCTA" if probe in zset else "NOT in ZCTA"))
    say("unmatched list (first 60)", ", ".join(unmatched[:60]))
    if len(unmatched) > 60:
        say("  ...", f"{len(unmatched)-60} more")
    print("\nSTEP 0 COMPLETE - nothing written, no polygon parsed or stored.")


# ------------------------------------------------------------------ step 1

def classify_arcgis(url):
    j, why = get_json(url.rstrip("/") + "?f=json")
    if j is None:
        return "UNRESOLVED", None, why
    if isinstance(j, dict) and "error" in j:
        e = j["error"]
        return "UNRESOLVED", None, f"SERVICE_ERROR {e.get('code')} {str(e.get('message'))[:60]}"
    gt = j.get("geometryType")
    if gt:
        return ESRI_CLASS.get(gt, "UNRESOLVED"), gt, None
    if j.get("type") == "Table" or (j.get("fields") and not j.get("extent")):
        return "TABLE_NO_GEOMETRY", j.get("type") or "(no geometryType)", None
    return "UNRESOLVED", None, "NO_GEOMETRYTYPE_IN_METADATA"


def classify_socrata(domain, dataset_id, colmap):
    if not (domain and dataset_id):
        return "UNRESOLVED", None, "NO_DOMAIN_OR_DATASET_ID"
    j, why = get_json(f"https://{domain}/api/views/{dataset_id}.json")
    if j is None:
        return "UNRESOLVED", None, why
    cols = j.get("columns") or []
    types = {c.get("fieldName"): c.get("dataTypeName") for c in cols}
    geo = {k: v for k, v in types.items()
           if v in ("point", "multipoint", "line", "multiline",
                    "polygon", "multipolygon", "location")}
    if not geo:
        return "TABLE_NO_GEOMETRY", "no geometry column in schema", None
    kinds = set(geo.values())
    if kinds <= {"point", "location"}:
        return "POINT", "socrata:" + ",".join(sorted(kinds)), None
    if kinds & {"multipolygon", "polygon"}:
        return "POLYGON", "socrata:" + ",".join(sorted(kinds)), None
    if kinds & {"line", "multiline"}:
        return "POLYLINE", "socrata:" + ",".join(sorted(kinds)), None
    if "multipoint" in kinds:
        return "MULTIPOINT", "socrata:" + ",".join(sorted(kinds)), None
    return "UNRESOLVED", "socrata:" + ",".join(sorted(kinds)), "UNMAPPED_SOCRATA_TYPE"


def step1_classify():
    say("mode", "n2a-classify (step 1, read-only)")
    idx = registry_index()
    inv = frozen_inventory()
    say("frozen registries", len(inv))
    say("committed registry entries", len(idx))

    results = []
    for i, row in enumerate(sorted(inv, key=lambda r: -r["projects"]), 1):
        rid = row["registry_id"]
        ent = idx.get(rid)
        time.sleep(POLITE)
        if ent is None:
            cls, verbatim, why = "UNRESOLVED", None, "NOT_IN_COMMITTED_REGISTRY"
        elif ent["group"] == "arcgis" and ent.get("service_url"):
            cls, verbatim, why = classify_arcgis(ent["service_url"])
        elif ent["group"] == "socrata":
            cls, verbatim, why = classify_socrata(ent.get("domain"), ent.get("dataset_id"),
                                                  ent.get("column_map"))
        elif ent["group"] in ("ckan", "csv", "carto", "opendatasoft"):
            cls, verbatim, why = "NON_SPATIAL_CONNECTOR", ent["group"], "NO_LAYER_GEOMETRY_METADATA"
        else:
            cls, verbatim, why = "UNRESOLVED", None, "NO_SERVICE_URL"
        results.append({"registry_id": rid, "group": (ent or {}).get("group"),
                        "projects": row["projects"], "rows": row["rows_n"], "pairs": row["pairs"],
                        "class": cls, "publisher_verbatim": verbatim, "reason": why})
        print(f"[{i:3d}/{len(inv)}] {rid:52s} {cls:22s} {verbatim or ''} {why or ''}", flush=True)

    print("\n===== CLASSIFICATION RESULT (json) =====")
    print(json.dumps(results, separators=(",", ":")))
    agg = {}
    for r in results:
        a = agg.setdefault(r["class"], {"sources": 0, "projects": 0, "pairs": 0})
        a["sources"] += 1
        a["projects"] += r["projects"]
        a["pairs"] += r["pairs"]
    print("\n===== TOTALS BY CLASS =====")
    for k in sorted(agg):
        v = agg[k]
        print(f"{k:24s} sources {v['sources']:4d}   projects {v['projects']:8,}   pairs {v['pairs']:9,}")
    tot_p = sum(v["projects"] for v in agg.values())
    tot_pr = sum(v["pairs"] for v in agg.values())
    print(f"\nRECONCILIATION  projects {tot_p:,} (frozen 925,463)   pairs {tot_pr:,} (frozen 2,753,802)")
    print("\nSTEP 1 COMPLETE - nothing written.")


def main():
    mode = os.environ.get("MODE", "").strip()
    if mode == "n2a-zcta":
        step0_zcta()
    elif mode == "n2a-classify":
        step1_classify()
    elif mode == "n2a-fidelity":
        step3_fidelity()
    else:
        raise SystemExit("MODE must be n2a-zcta, n2a-classify or n2a-fidelity")
    return 0




# ------------------------------------------------------------------ step 3
#
# POINT fidelity. The question is NOT "is the stored point near itself" but
# "does the stored point reproduce the publisher's OWN coordinate for the same
# feature identity". So every comparison is against a freshly fetched publisher
# coordinate, matched by the case number the identity was built from.
#
# Sampling design, stated before any result is read:
#   * every POINT source is covered - breadth over depth, so a failing source
#     cannot hide inside a national average;
#   * a source with <= SAMPLE_N testable identities is compared EXHAUSTIVELY;
#   * a larger source is sampled deterministically at a fixed stride across the
#     source_key ordering, so the sample is reproducible and spans the corpus
#     rather than clustering at one end;
#   * only cases the publisher returns with EXACTLY ONE feature are scored, since
#     a multi-feature case has no unambiguous counterpart for one stored row.
#     Multi-feature and not-found cases are reported separately, never as passes.

SAMPLE_N = 20
FID_TIMEOUT = 45


def fidelity_sample(point_regs):
    lst = ",".join("'" + r.replace("'", "''") + "'" for r in point_regs)
    rows = sql(f"""
      with r as (
        select registry_id, source_key, source_seq, lat, lng,
               row_number() over (partition by registry_id order by source_key, source_seq) rn,
               count(*)     over (partition by registry_id) n
          from preservation.app_project_identity
         where snapshot_id='{SNAPSHOT}' and record_kind='development'
           and registry_id in ({lst}) and lat is not null and lng is not null
      )
      select registry_id, source_key, source_seq, lat, lng, n, rn
        from r
       where (rn - 1) %% greatest(1, (n / {SAMPLE_N})::int) = 0
       order by registry_id, rn;""", "fidelity sample")
    by = {}
    for r in rows:
        by.setdefault(r["registry_id"], [])
        if len(by[r["registry_id"]]) < SAMPLE_N:
            by[r["registry_id"]].append(r)
    return by


def case_of(source_key):
    parts = source_key.split(":")
    return parts[2] if len(parts) >= 3 else None


def fetch_points(layer_url, case_field, oid_field, cases):
    """Publisher coordinates for these case numbers, in EPSG:4326. Returns
    {case: [(x, y), ...]} or raises."""
    lits = ",".join("'" + str(c).replace("'", "''") + "'" for c in cases)
    j = post(qurl_n2a(layer_url), {
        "where": f"{case_field} IN ({lits})",
        "outFields": f"{oid_field},{case_field}",
        "returnGeometry": "true", "outSR": "4326", "f": "json"}, timeout=FID_TIMEOUT)
    if "error" in j:
        raise RuntimeError("SERVICE_ERROR " + json.dumps(j["error"])[:120])
    out = {}
    for f in (j.get("features") or []):
        g = f.get("geometry") or {}
        a = f.get("attributes") or {}
        c = str(a.get(case_field))
        if g.get("x") is not None and g.get("y") is not None:
            out.setdefault(c, []).append((float(g["x"]), float(g["y"])))
    return out


def qurl_n2a(u):
    return u.rstrip("/") + "/query"


def post(url, params, timeout=45):
    body = urllib.parse.urlencode(params).encode()
    req = urllib.request.Request(url, data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": UA, "Accept": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def haversine_m(lat1, lon1, lat2, lon2):
    import math
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def step3_fidelity():
    say("mode", "n2a-fidelity (step 3, read-only)")
    cls = json.load(open("data/n2a_classes.json"))
    idx = registry_index()
    point = [d["registry_id"] for d in cls if d["class"] == "POINT"]
    say("POINT sources to test", len(point))
    say("sampling", f"every source covered; exhaustive if <= {SAMPLE_N}, else stride sample of {SAMPLE_N}")

    samples = fidelity_sample(point)
    say("sources with sampled identities", len(samples))

    results = []
    for i, rid in enumerate(sorted(samples), 1):
        ent = idx.get(rid) or {}
        rows = samples[rid]
        cm = ent.get("column_map") or {}
        case_field = cm.get("case_number")
        rec = {"registry_id": rid, "sampled": len(rows), "exhaustive": rows[0]["n"] <= SAMPLE_N,
               "population": rows[0]["n"], "scored": 0, "match": 0, "rounded": 0,
               "swapped": 0, "moved": 0, "not_found": 0, "multi_feature": 0,
               "max_delta_m": 0.0, "error": None, "verdict": None}
        if ent.get("group") != "arcgis" or not ent.get("service_url") or not case_field:
            rec["error"] = ("NO_ARCGIS_SERVICE_URL" if ent.get("group") != "arcgis"
                            else "NO_CASE_FIELD")
            rec["verdict"] = "POINT_FIDELITY_UNRESOLVED"
            results.append(rec)
            print(f"[{i:3d}/{len(samples)}] {rid:46s} {rec['verdict']} ({rec['error']})", flush=True)
            continue
        time.sleep(POLITE)
        try:
            meta, why = get_json(ent["service_url"].rstrip("/") + "?f=json")
            oid = (meta or {}).get("objectIdField") or "OBJECTID"
            cases = [case_of(r["source_key"]) for r in rows]
            cases = [c for c in cases if c]
            pub = fetch_points(ent["service_url"], case_field, oid, cases)
        except Exception as e:
            rec["error"] = f"{type(e).__name__} {str(e)[:90]}"
            rec["verdict"] = "POINT_FIDELITY_UNRESOLVED"
            results.append(rec)
            print(f"[{i:3d}/{len(samples)}] {rid:46s} {rec['verdict']} ({rec['error']})", flush=True)
            continue

        for r in rows:
            c = case_of(r["source_key"])
            pts = pub.get(str(c)) or []
            if not pts:
                rec["not_found"] += 1
                continue
            if len(pts) > 1:
                rec["multi_feature"] += 1
                continue
            px, py = pts[0]
            slat, slng = float(r["lat"]), float(r["lng"])
            d = haversine_m(slat, slng, py, px)
            dswap = haversine_m(slat, slng, px, py)
            rec["scored"] += 1
            rec["max_delta_m"] = max(rec["max_delta_m"], d)
            if d < 0.01:
                rec["match"] += 1
            elif d <= 1.5:
                rec["rounded"] += 1
            elif dswap < d and dswap < 1.5:
                rec["swapped"] += 1
            else:
                rec["moved"] += 1

        if rec["scored"] == 0:
            rec["verdict"] = "POINT_FIDELITY_UNRESOLVED"
        elif rec["moved"] == 0 and rec["swapped"] == 0:
            rec["verdict"] = "POINT_STORED_COORDINATE_FIDELITY_PROVEN"
        else:
            rec["verdict"] = "POINT_REFETCH_REQUIRED"
        results.append(rec)
        print(f"[{i:3d}/{len(samples)}] {rid:46s} pop {rec['population']:7,} "
              f"scored {rec['scored']:3d} exact {rec['match']:3d} rnd {rec['rounded']:3d} "
              f"swap {rec['swapped']:3d} moved {rec['moved']:3d} nf {rec['not_found']:3d} "
              f"multi {rec['multi_feature']:3d} maxd {rec['max_delta_m']:.3f}m -> {rec['verdict']}",
              flush=True)

    print("\n===== FIDELITY RESULT (json) =====")
    print(json.dumps(results, separators=(",", ":")))
    agg = {}
    for r in results:
        agg[r["verdict"]] = agg.get(r["verdict"], 0) + 1
    print("\n===== VERDICT TOTALS =====")
    for k in sorted(agg):
        print(f"{k:44s} {agg[k]} sources")
    print("\nSTEP 3 COMPLETE - nothing written.")

if __name__ == "__main__":
    sys.exit(main())
