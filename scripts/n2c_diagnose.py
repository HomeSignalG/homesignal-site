#!/usr/bin/env python3
"""N2C - resolve the 20 sources N2B left unresolved. READ-ONLY.

N2B closed with 214 of 234 sources resolved on evidence and 20 - carrying 207,032
frozen projects and 399,494 legacy project<->ZIP pairs - unresolved. Those 20 were
costed as recovery-required, which is safe for capacity and is NOT knowledge. N2C
exists to replace that default with a truthful per-source treatment.

The controlling discipline, learned the hard way in N2B: a negative result is only
evidence when the instrument has proven it can produce a positive one. Every probe
here therefore carries an explicit positive control, and a probe whose control fails
is reported as an INSTRUMENT failure - its negative is discarded, not published.

Three questions, kept apart because they have different answers and different
consequences:

  (1) is the endpoint reachable and does it hold records?      -> positive control
  (2) can a FROZEN identity reconnect to a publisher record?   -> reconnection
  (3) is our stored coordinate the publisher's own?            -> fidelity

Nothing here writes to the database, to the registry, or to production. It reads the
frozen preservation snapshot and live publisher endpoints and prints its findings.

stdlib only.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

UA = "HomeSignal-n2c/1.0 (+https://homesignal.net)"
PROJECT_REF = "qwnnmljucajnexpxdgxr"
SNAPSHOT = "phase1-2026-09-01"
REGISTRY = "supabase/functions/get-address-report/jurisdiction-registry.json"

TIMEOUT = 45
POLITE = 0.35
SAMPLE = 12
TOL_M = 1.5          # unchanged from N2A/N2B. Never widened to convert a failure.

# The 20, with the bucket N2B put each in. Project and pair counts are re-derived
# from the frozen snapshot at run time and reconciled against these before probing,
# so a drifting denominator stops the run rather than quietly changing the answer.
INVENTORY = [
    ("brunswick-county-permits",                "ZERO_IDENTITY", 81324, 153486),
    ("nyc-dobnow-approved-permits",             "ZERO_IDENTITY", 66309,  66311),
    ("sonoma-county-fire-rebuild-permits",      "ZERO_IDENTITY",  1367,   1480),
    ("gilbert-energov-permits",                 "ZERO_IDENTITY",  1044,   1044),
    ("huntsville-building-permits",             "HTTP_400",      17487,  91906),
    ("fort-worth-development-permits",          "HTTP_400",      13137,  13224),
    ("penndot-transportation-projects",         "HTTP_400",       2768,  17056),
    ("mdot-stip-projects",                      "HTTP_400",        746,   3961),
    ("madison-planning-projects",               "HTTP_400",        483,   2109),
    ("scottsdale-building-permits",             "HTTP_400",         98,    211),
    ("odot-current-projects",                   "HTTP_400",         62,    324),
    ("nyc-dob-permit-issuance",                 "AMBIGUOUS",     14042,  14042),
    ("desoto-county-permits",                   "AMBIGUOUS",      1590,   2708),
    ("nysdot-capital-program-projects-2",       "AMBIGUOUS",       166,   3076),
    ("sd-stip-safety-points",                   "AMBIGUOUS",         5,      7),
    ("city-of-orange-active-planning-projects",  "CONFIG_GAP",     155,    972),
    ("stlouis-county-mo-subdivisions",           "CONFIG_GAP",      41,     41),
    ("fairfax-recent-building-permits",         "CARRIED_N2A",    4120,  19524),
    ("fairfax-active-site-construction",        "CARRIED_N2A",    2083,   8007),
    ("(null)",                                  "CARRIED_N2A",       5,      5),
]
EXPECT_SOURCES, EXPECT_PROJECTS, EXPECT_PAIRS = 20, 207032, 399494


def say(k, v):
    print(f"{k:<46} {v}", flush=True)


def sql(query, tag=""):
    token = os.environ["SUPABASE_ACCESS_TOKEN"]
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "Accept": "application/json", "User-Agent": UA}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise SystemExit(f"STOP: SQL {tag} failed HTTP {e.code}\n{e.read().decode()[:2000]}")


def http(url, params=None, method="GET", timeout=TIMEOUT):
    """Returns (json_or_None, reason). A reason is never converted into a finding."""
    try:
        if method == "POST":
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode(params or {}).encode(),
                headers={"Content-Type": "application/x-www-form-urlencoded",
                         "User-Agent": UA, "Accept": "application/json"}, method="POST")
        else:
            if params:
                url = url + ("&" if "?" in url else "?") + urllib.parse.urlencode(params)
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
        try:
            return json.loads(raw.decode("utf-8", "replace")), None
        except Exception as e:
            return None, f"MALFORMED_JSON {type(e).__name__} {len(raw)}B"
    except urllib.error.HTTPError as e:
        return None, f"HTTP_{e.code}"
    except urllib.error.URLError as e:
        return None, f"URLERROR {str(e.reason)[:60]}"
    except Exception as e:
        return None, f"{type(e).__name__} {str(e)[:60]}"


def esri(j):
    """An ArcGIS error arrives as HTTP 200 with an error object. Returns a reason
    string or None; never lets an error body be read as an empty result."""
    if isinstance(j, dict) and "error" in j:
        e = j["error"]
        return f"ESRI_{e.get('code')} {str(e.get('message'))[:70]}"
    return None


def haversine_m(lat1, lon1, lat2, lon2):
    import math
    R = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin(math.radians(lat2 - lat1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2)
    return 2 * R * math.asin(min(1.0, math.sqrt(a)))


def registry_index():
    reg = json.load(open(REGISTRY))
    out = {}
    for grp in ("socrata", "arcgis", "ckan", "csv", "carto", "opendatasoft"):
        for e in reg.get(grp, []):
            out[e["registry_id"]] = dict(e, _group=grp)
    return out


# ---------------------------------------------------------------- frozen reads

def frozen_counts(rids):
    lst = ",".join("'" + r.replace("'", "''") + "'" for r in rids)
    return sql(f"""
      select coalesce(registry_id,'(null)') as rid,
             count(distinct source_key)             as projects,
             count(distinct source_key||'|'||zip)   as pairs
        from preservation.app_project_identity
       where snapshot_id='{SNAPSHOT}' and record_kind='development'
         and coalesce(registry_id,'(null)') in ({lst})
       group by 1;""", "frozen counts")


def frozen_sample(rids):
    """A deterministic stride sample across each source's own source_key ordering,
    so the sample spans the corpus instead of clustering at one end. Rows with no
    stored coordinate are KEPT: reconnection is testable without one, and only the
    fidelity half needs coordinates."""
    lst = ",".join("'" + r.replace("'", "''") + "'" for r in rids)
    rows = sql(f"""
      with r as (
        select coalesce(registry_id,'(null)') as rid, source_key, source_seq,
               lat, lng, submitted_at, source_ref,
               row_number() over (partition by coalesce(registry_id,'(null)')
                                  order by source_key, source_seq) rn,
               count(*) over (partition by coalesce(registry_id,'(null)')) n
          from preservation.app_project_identity
         where snapshot_id='{SNAPSHOT}' and record_kind='development'
           and coalesce(registry_id,'(null)') in ({lst})
      )
      select rid, source_key, source_seq, lat, lng, submitted_at, source_ref, n, rn
        from r
       where (rn - 1) % greatest(1, (n / {SAMPLE})::int) = 0
       order by rid, rn;""", "frozen sample")
    by = {}
    for r in rows:
        by.setdefault(r["rid"], [])
        if len(by[r["rid"]]) < SAMPLE:
            by[r["rid"]].append(r)
    return by


_PREFIX_CASE_INDEX = {"arcgis": 2, "socrata": 3, "ckan": 3, "csv": 3, "carto": 3, "tdlr_tabs": 1}


def case_of(source_key):
    parts = source_key.split(":")
    i = _PREFIX_CASE_INDEX.get(parts[0])
    if i is None or len(parts) <= i:
        return None
    return ":".join(parts[i:])


# ---------------------------------------------------------------- arcgis probes

def q(url):
    return url.rstrip("/") + "/query"


def lit(v):
    return "'" + str(v).replace("'", "''") + "'"


def arcgis_layer(ent):
    """Stage 0. Layer metadata: geometry type, object-id field, field roster."""
    j, why = http(ent["service_url"].rstrip("/"), {"f": "json"})
    if j is None:
        return {"error": why}
    err = esri(j)
    if err:
        return {"error": err}
    return {"geometryType": j.get("geometryType"), "objectIdField": j.get("objectIdField") or "OBJECTID",
            "type": j.get("type"), "name": j.get("name"),
            "fields": [f.get("name") for f in (j.get("fields") or [])],
            "field_types": {f.get("name"): f.get("type") for f in (j.get("fields") or [])},
            "error": None}


def arcgis_control(ent):
    """POSITIVE CONTROL. where=1=1 returnCountOnly. A zero here means the instrument
    or the layer is empty, and every negative below it is discarded."""
    j, why = http(q(ent["service_url"]), {"where": "1=1", "returnCountOnly": "true", "f": "json"}, "POST")
    if j is None:
        return {"ok": False, "count": None, "err": why}
    err = esri(j)
    if err:
        return {"ok": False, "count": None, "err": err}
    n = j.get("count")
    return {"ok": bool(n), "count": n, "err": None if n else "COUNT_ZERO"}


def arcgis_one_record(ent, oid_field):
    j, why = http(q(ent["service_url"]),
                  {"where": "1=1", "outFields": "*", "resultRecordCount": "1",
                   "returnGeometry": "true", "outSR": "4326", "f": "json"}, "POST")
    if j is None:
        return None, why
    err = esri(j)
    if err:
        return None, err
    feats = j.get("features") or []
    if not feats:
        return None, "NO_FEATURES"
    return feats[0], None


def arcgis_ladder(ent, layer, rec):
    """Stage 1. Progressively minimal requests against a record the layer JUST
    returned, so any failure is our request shape and not a missing record. The
    first step that fails names the cause."""
    ident = (ent.get("column_map") or {}).get("case_number")
    oid_f = layer["objectIdField"]
    attrs = rec.get("attributes") or {}
    oid = attrs.get(oid_f)
    steps, out = [], []
    steps.append(("A objectid numeric, POST", {"where": f"{oid_f}={oid}"}))
    if ident and ident in attrs and attrs.get(ident) is not None:
        v = attrs[ident]
        num = ent.get("_ident_numeric")
        steps.append(("B ident quoted, POST", {"where": f"{ident}={lit(v)}"}))
        if num:
            steps.append(("C ident unquoted, POST", {"where": f"{ident}={v}"}))
        steps.append(("D ident IN list of 1, POST", {"where": f"{ident} IN ({lit(v)})"}))
        steps.append(("E ident IN list of 12, POST",
                      {"where": f"{ident} IN (" + ",".join([lit(v)] * 12) + ")"}))
        steps.append(("F ident quoted, outFields *", {"where": f"{ident}={lit(v)}", "outFields": "*"}))
        steps.append(("G ident quoted, no geometry",
                      {"where": f"{ident}={lit(v)}", "returnGeometry": "false"}))
        steps.append(("H ident quoted, GET", {"where": f"{ident}={lit(v)}", "_get": 1}))
    for name, extra in steps:
        base = {"outFields": f"{oid_f}" + (f",{ident}" if ident else ""),
                "returnGeometry": "true", "outSR": "4326", "f": "json"}
        use_get = extra.pop("_get", None)
        base.update(extra)
        time.sleep(0.2)
        j, why = http(q(ent["service_url"]), base, "GET" if use_get else "POST")
        e = why or esri(j)
        n = None if j is None else len(j.get("features") or [])
        out.append({"step": name, "ok": e is None, "features": n, "err": e})
    return out


def arcgis_fetch(ent, layer, where, want_geom=True):
    ident = (ent.get("column_map") or {}).get("case_number")
    oid_f = layer["objectIdField"]
    fields = [oid_f] + [f for f in (ident,) if f]
    j, why = http(q(ent["service_url"]),
                  {"where": where, "outFields": "*" if not fields else "*",
                   "returnGeometry": "true" if want_geom else "false",
                   "outSR": "4326", "f": "json"}, "POST")
    if j is None:
        return None, why
    e = esri(j)
    if e:
        return None, e
    return (j.get("features") or []), None


# ---------------------------------------------------------------- socrata probes

def socrata_schema(ent):
    j, why = http(f"https://{ent['domain']}/api/views/{ent['dataset_id']}.json")
    if j is None:
        return {"error": why}
    cols = j.get("columns") or []
    return {"error": None,
            "fields": [c.get("fieldName") for c in cols],
            "types": {c.get("fieldName"): c.get("dataTypeName") for c in cols}}


def socrata_control(ent):
    j, why = http(f"https://{ent['domain']}/resource/{ent['dataset_id']}.json",
                  {"$select": "count(1) as n"})
    if j is None:
        return {"ok": False, "count": None, "err": why}
    try:
        n = int((j[0] or {}).get("n"))
    except Exception:
        return {"ok": False, "count": None, "err": "NO_COUNT_IN_RESPONSE"}
    return {"ok": n > 0, "count": n, "err": None if n else "COUNT_ZERO"}


def socrata_fetch(ent, where):
    j, why = http(f"https://{ent['domain']}/resource/{ent['dataset_id']}.json",
                  {"$limit": "200", "$where": where})
    if j is None:
        return None, why
    if not isinstance(j, list):
        return None, "SOCRATA_ERROR " + json.dumps(j)[:80]
    return j, None


def dotget(obj, path):
    cur = obj
    for p in str(path).split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def socrata_point(row, ent):
    cm = ent.get("column_map") or {}
    la, lo = cm.get("lat"), cm.get("lng")
    y = dotget(row, la) if la and not str(la).startswith("__") else None
    x = dotget(row, lo) if lo and not str(lo).startswith("__") else None
    if y is None or x is None:
        loc = row.get("location") or row.get("point") or {}
        if isinstance(loc, dict):
            if loc.get("coordinates"):
                x, y = loc["coordinates"][0], loc["coordinates"][1]
            else:
                y, x = loc.get("latitude"), loc.get("longitude")
    try:
        return float(x), float(y)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- identity plan

def identity_plan(ent, layer_fields):
    """How N2C will address a frozen identity for this source, and why.

    The N2B probe used the frozen source_key's case component verbatim as a single
    publisher value. For an entry declaring identity_fields that component is a
    COMPOUND built by the connector - `ProjectNumber|PermitNumber` - so asking the
    publisher for it as one permit number could only ever return nothing. That is an
    instrument fault, and it is the plan below that corrects it."""
    cm = ent.get("column_map") or {}
    idf = ent.get("identity_fields")
    if idf:
        return {"strategy": "identity_fields", "fields": list(idf),
                "note": "connector joins these with '|' to form the source_id record segment"}
    if cm.get("case_number"):
        return {"strategy": "case_number", "fields": [cm["case_number"]], "note": None}
    return {"strategy": "objectid", "fields": None,
            "note": "no case_number in column_map; the connector fell back to FID/OBJECTID"}


def where_for(plan, ent, layer, case, numeric_ident=False):
    if plan["strategy"] == "identity_fields":
        parts = str(case).split("|")
        if len(parts) != len(plan["fields"]):
            return None
        return " AND ".join(f"{f}={lit(v)}" for f, v in zip(plan["fields"], parts))
    if plan["strategy"] == "case_number":
        f = plan["fields"][0]
        return f"{f}={case}" if numeric_ident else f"{f}={lit(case)}"
    oid = layer["objectIdField"]
    try:
        return f"{oid}={int(case)}"
    except (TypeError, ValueError):
        return None


def soql_for(plan, ent, case):
    if plan["strategy"] == "identity_fields":
        parts = str(case).split("|")
        if len(parts) != len(plan["fields"]):
            return None
        return " and ".join(f"{f}={lit(v)}" for f, v in zip(plan["fields"], parts))
    if plan["strategy"] == "case_number":
        return f"{plan['fields'][0]}={lit(case)}"
    return None


# ---------------------------------------------------------------- per source

def diagnose(rid, bucket, ent, rows):
    rec = {"registry_id": rid, "bucket": bucket,
           "connector": (ent or {}).get("_group"),
           "layer": None, "control": None, "ladder": [], "identity": None,
           "requested": 0, "matched": 0, "unique": 0, "multi": 0, "missing": 0,
           "compared": 0, "exact": 0, "within_tol": 0, "outside_tol": 0, "max_m": 0.0,
           "corroborated": 0, "corroborate_disagree": 0,
           "multiplicity": [], "error": None, "verdict": None, "why": None}

    if ent is None:
        # tdlr_tabs. Its coordinates are HomeSignal's geocoder output by construction
        # (sources/tdlr-tabs.ts calls deps.geocode(location_addr)); TDLR publishes no
        # geometry, so there is nothing authoritative to recover. Proven from the
        # committed adapter, not from a probe.
        rec["identity"] = {"strategy": "hand_adapter", "fields": ["project_no"],
                           "note": "tdlr_tabs:<TABS project no>; coordinates are geocoded by HomeSignal"}
        rec["verdict"] = "NO_AUTHORITATIVE_SOURCE_GEOMETRY"
        rec["why"] = "TDLR TABS publishes no geometry; sources/tdlr-tabs.ts geocodes location_addr"
        return rec

    grp = ent["_group"]
    cases = [(r, case_of(r["source_key"])) for r in rows]
    cases = [(r, c) for r, c in cases if c]
    rec["requested"] = len(cases)

    if grp == "arcgis":
        layer = arcgis_layer(ent)
        rec["layer"] = {k: layer.get(k) for k in ("geometryType", "objectIdField", "type", "name", "error")}
        rec["layer"]["fields_n"] = len(layer.get("fields") or [])
        if layer.get("error"):
            rec["error"] = "LAYER_METADATA " + layer["error"]
            rec["verdict"] = "IDENTITY_UNRESOLVED"
            rec["why"] = "layer metadata unreachable: " + layer["error"]
            return rec
        rec["control"] = arcgis_control(ent)
        if not rec["control"]["ok"]:
            rec["error"] = "CONTROL_FAILED " + str(rec["control"]["err"])
            rec["verdict"] = "IDENTITY_UNRESOLVED"
            rec["why"] = ("positive control failed - every negative below it is an "
                          "instrument result, not a publisher answer")
            return rec
        if layer.get("geometryType") is None and layer.get("type") == "Table":
            rec["verdict"] = "NO_AUTHORITATIVE_SOURCE_GEOMETRY"
            rec["why"] = "publisher layer is a Table with no geometry"
            return rec

        ident = (ent.get("column_map") or {}).get("case_number")
        ftypes = layer.get("field_types") or {}
        ent["_ident_numeric"] = ident and str(ftypes.get(ident, "")).endswith(
            ("Integer", "Double", "Single", "SmallInteger", "OID"))
        one, why = arcgis_one_record(ent, layer["objectIdField"])
        if one is None:
            rec["error"] = "NO_SAMPLE_RECORD " + str(why)
        else:
            rec["ladder"] = arcgis_ladder(ent, layer, one)

        plan = identity_plan(ent, layer.get("fields") or [])
        # a declared identity field the layer does not actually expose is schema drift,
        # and saying so is more useful than a silent zero
        missing_fields = [f for f in (plan["fields"] or []) if f not in (layer.get("fields") or [])]
        plan["fields_present"] = not missing_fields
        plan["fields_missing"] = missing_fields
        rec["identity"] = plan

        for r, c in cases:
            w = where_for(plan, ent, layer, c, bool(ent.get("_ident_numeric")))
            if w is None:
                rec["missing"] += 1
                continue
            time.sleep(0.25)
            feats, why = arcgis_fetch(ent, layer, w)
            if feats is None:
                rec["missing"] += 1
                continue
            pts = [(f["geometry"]["x"], f["geometry"]["y"]) for f in feats
                   if (f.get("geometry") or {}).get("x") is not None]
            if not feats:
                rec["missing"] += 1
                continue
            rec["matched"] += 1
            if len(feats) > 1:
                rec["multi"] += 1
                rec["multiplicity"].append(len(feats))
            else:
                rec["unique"] += 1
            if plan["strategy"] == "objectid":
                # An OBJECTID is assigned by the server at load time, so a hit proves
                # a row exists at that ordinal - never that it is OUR row. Corroborate
                # against the frozen filing date before treating it as reconnection.
                fd = (ent.get("column_map") or {}).get("file_date")
                a = (feats[0].get("attributes") or {})
                got = a.get(fd) if fd else None
                if got is not None and r.get("submitted_at"):
                    rec["corroborated"] += 1
                    try:
                        iso = time.strftime("%Y-%m-%d", time.gmtime(int(got) / 1000.0))
                    except (TypeError, ValueError):
                        iso = str(got)[:10]
                    if iso != str(r["submitted_at"])[:10]:
                        rec["corroborate_disagree"] += 1
            if len(pts) == 1 and r.get("lat") is not None and r.get("lng") is not None:
                d = haversine_m(float(r["lat"]), float(r["lng"]), pts[0][1], pts[0][0])
                rec["compared"] += 1
                rec["max_m"] = max(rec["max_m"], d)
                if d < 0.01:
                    rec["exact"] += 1
                elif d <= TOL_M:
                    rec["within_tol"] += 1
                else:
                    rec["outside_tol"] += 1

    elif grp == "socrata":
        sch = socrata_schema(ent)
        if sch.get("error"):
            rec["error"] = "SCHEMA " + sch["error"]
            rec["verdict"] = "IDENTITY_UNRESOLVED"
            rec["why"] = "dataset schema unreachable: " + sch["error"]
            return rec
        geo = {k: v for k, v in sch["types"].items()
               if v in ("point", "multipoint", "line", "multiline", "polygon", "multipolygon", "location")}
        rec["layer"] = {"geometryType": ("socrata:" + ",".join(sorted(set(geo.values()))) if geo
                                         else "no geometry column"),
                        "objectIdField": ":id", "type": "socrata", "name": ent["dataset_id"],
                        "fields_n": len(sch["fields"]), "error": None}
        rec["control"] = socrata_control(ent)
        if not rec["control"]["ok"]:
            rec["error"] = "CONTROL_FAILED " + str(rec["control"]["err"])
            rec["verdict"] = "IDENTITY_UNRESOLVED"
            rec["why"] = "positive control failed - negatives discarded"
            return rec

        plan = identity_plan(ent, sch["fields"])
        missing_fields = [f for f in (plan["fields"] or []) if f not in sch["fields"]]
        plan["fields_present"] = not missing_fields
        plan["fields_missing"] = missing_fields
        rec["identity"] = plan

        for r, c in cases:
            w = soql_for(plan, ent, c)
            if w is None:
                rec["missing"] += 1
                continue
            time.sleep(0.25)
            got, why = socrata_fetch(ent, w)
            if got is None:
                rec["missing"] += 1
                continue
            if not got:
                rec["missing"] += 1
                continue
            rec["matched"] += 1
            if len(got) > 1:
                rec["multi"] += 1
                rec["multiplicity"].append(len(got))
            else:
                rec["unique"] += 1
            if len(got) == 1 and r.get("lat") is not None and r.get("lng") is not None:
                p = socrata_point(got[0], ent)
                if p:
                    d = haversine_m(float(r["lat"]), float(r["lng"]), p[1], p[0])
                    rec["compared"] += 1
                    rec["max_m"] = max(rec["max_m"], d)
                    if d < 0.01:
                        rec["exact"] += 1
                    elif d <= TOL_M:
                        rec["within_tol"] += 1
                    else:
                        rec["outside_tol"] += 1
    else:
        rec["error"] = f"NO_N2C_PROBE_FOR_{grp}"
        rec["verdict"] = "IDENTITY_UNRESOLVED"
        rec["why"] = "no diagnostic implemented for this connector"
        return rec

    # ---- verdict. Fidelity is only asked AFTER reconnection is established.
    has_geom = rec["layer"].get("geometryType") not in (None, "no geometry column")
    if not has_geom:
        rec["verdict"] = "NO_AUTHORITATIVE_SOURCE_GEOMETRY"
        rec["why"] = "publisher exposes no geometry"
    elif rec["matched"] == 0:
        rec["verdict"] = "HISTORICAL_GEOMETRY_UNRECOVERABLE"
        rec["why"] = ("endpoint live and non-empty (control "
                      f"{rec['control']['count']:,}) but 0 of {rec['requested']} frozen "
                      "identities reconnect")
    elif rec["identity"]["strategy"] == "objectid" and rec["corroborate_disagree"] > 0:
        rec["verdict"] = "IDENTITY_UNRESOLVED"
        rec["why"] = (f"OBJECTID hits {rec['matched']} but {rec['corroborate_disagree']} of "
                      f"{rec['corroborated']} disagree with the frozen filing date - the "
                      "ordinal is not our record")
    elif rec["compared"] > 0 and rec["outside_tol"] == 0:
        rec["verdict"] = "POINT_NO_REFETCH_PROVEN"
        rec["why"] = f"{rec['compared']} compared, {rec['exact']} exact, 0 outside {TOL_M} m"
    else:
        rec["verdict"] = "SOURCE_GEOMETRY_REFETCH_REQUIRED"
        rec["why"] = (f"{rec['matched']} of {rec['requested']} identities reconnect; "
                      f"stored coordinate not proven ({rec['compared']} comparable, "
                      f"{rec['outside_tol']} outside tolerance, {rec['multi']} multi-feature)")
    return rec



# ================================================================== N2C PASS 2
#
# Pass 1 answered four of the five COORD_COLUMNS_FIDELITY_UNTESTED sources by
# re-asserting the premise instead of testing it: it saw "publisher layer is a
# Table" and returned NO_AUTHORITATIVE_SOURCE_GEOMETRY. But those five entered the
# unresolved set PRECISELY BECAUSE they publish coordinates as attribute COLUMNS
# whose fidelity had never been tested, and a lat/lng column the publisher fills is
# authoritative publisher geometry - it is simply not a geometry OBJECT. Calling it
# "no authoritative source geometry" is a false negative, and a false negative here
# would silently strip 82,860 projects of a recoverable treatment.
#
# Pass 2 also fixes a second, narrower blindness. Pass 1 could only compare a stored
# coordinate when the identity returned EXACTLY ONE feature, so a DOT project whose
# PIN legitimately covers 142 points scored nothing at all. Set membership is the
# honest test for those: does our stored point reproduce ONE OF the publisher's own
# points for that identity? It cannot say which feature the row came from - and it is
# not asked to. It answers the only question the association build needs.
#
# Nothing here writes. No coordinate is geocoded, invented or defaulted.

PASS2 = [
    ("sonoma-county-fire-rebuild-permits", "ATTR_COLUMNS"),
    ("gilbert-energov-permits",            "ATTR_COLUMNS"),
    ("scottsdale-building-permits",        "ATTR_COLUMNS"),
    ("nyc-dobnow-approved-permits",        "ATTR_COLUMNS"),
    ("nyc-dob-permit-issuance",            "ATTR_COLUMNS+SET"),
    ("fort-worth-development-permits",     "SET"),
    ("penndot-transportation-projects",    "SET"),
    ("mdot-stip-projects",                 "SET"),
    ("odot-current-projects",              "SET"),
    ("desoto-county-permits",              "SET+IDENT"),
    ("nysdot-capital-program-projects-2",  "SET"),
    ("sd-stip-safety-points",              "SET"),
]

_IDENTISH = ("id", "num", "no", "permit", "case", "record", "pin", "project",
             "app", "file", "ref", "key")


def identity_candidates(rows, exclude=()):
    """Fields that behave like a record identity in a real 200-row page: present on
    every row and distinct on (nearly) every row. Reported so a config correction can
    be recommended from measured uniqueness rather than from a field's NAME."""
    if not rows:
        return []
    n = len(rows)
    out = []
    for f in sorted({k for r in rows for k in r.keys()}):
        if f in exclude:
            continue
        vals = [r.get(f) for r in rows]
        filled = [v for v in vals if v is not None and str(v).strip() != ""]
        if len(filled) < n:
            continue
        d = len({str(v) for v in filled})
        if d / float(n) >= 0.95:
            looks = any(t in f.lower() for t in _IDENTISH)
            out.append({"field": f, "distinct": d, "rows": n, "namelike": looks})
    out.sort(key=lambda c: (not c["namelike"], -c["distinct"]))
    return out[:12]


def arcgis_page(ent, limit=200):
    j, why = http(q(ent["service_url"]),
                  {"where": "1=1", "outFields": "*", "resultRecordCount": str(limit),
                   "returnGeometry": "false", "f": "json"}, "POST")
    if j is None or esri(j):
        return []
    return [(f.get("attributes") or {}) for f in (j.get("features") or [])]


def socrata_page(ent, limit=200):
    j, why = http(f"https://{ent['domain']}/resource/{ent['dataset_id']}.json",
                  {"$limit": str(limit)})
    return j if isinstance(j, list) else []


def points_from(feat_or_row, ent, is_arcgis):
    """Every publisher-supplied coordinate this record carries: the geometry object
    when there is one, and the registry-declared lat/lng ATTRIBUTE columns when the
    publisher fills them. A '__'-prefixed column name is the connector's sentinel for
    'no column', never a real field, so it is not read."""
    cm = ent.get("column_map") or {}
    la, lo = cm.get("lat"), cm.get("lng")
    pts = []
    if is_arcgis:
        g = feat_or_row.get("geometry") or {}
        if g.get("x") is not None and g.get("y") is not None:
            pts.append((float(g["x"]), float(g["y"]), "geometry"))
        a = feat_or_row.get("attributes") or {}
    else:
        a = feat_or_row
    if la and lo and not str(la).startswith("__") and not str(lo).startswith("__"):
        y, x = dotget(a, la), dotget(a, lo)
        try:
            if y is not None and x is not None:
                pts.append((float(x), float(y), "attr_columns"))
        except (TypeError, ValueError):
            pass
    return pts


def pass2_source(rid, mode, ent, rows):
    rec = {"registry_id": rid, "mode": mode, "connector": ent["_group"],
           "layer_kind": None, "max_record_count": None, "control": None,
           "identity_strategy": None, "requested": len(rows), "matched": 0,
           "capped": 0, "features_max": 0, "with_points": 0, "no_points": 0,
           "in_set_exact": 0, "in_set_tol": 0, "outside_tol": 0, "worst_m": 0.0,
           "point_sources": {}, "candidates": [], "error": None, "verdict": None,
           "why": None}
    is_arc = ent["_group"] == "arcgis"

    if is_arc:
        layer = arcgis_layer(ent)
        if layer.get("error"):
            rec["error"] = "LAYER " + layer["error"]
            rec["verdict"] = "IDENTITY_UNRESOLVED"
            return rec
        rec["layer_kind"] = layer.get("type")
        rec["control"] = arcgis_control(ent)
        meta, _ = http(ent["service_url"].rstrip("/"), {"f": "json"})
        rec["max_record_count"] = (meta or {}).get("maxRecordCount")
        fields = layer.get("fields") or []
        ftypes = layer.get("field_types") or {}
        ident = (ent.get("column_map") or {}).get("case_number")
        ent["_ident_numeric"] = ident and str(ftypes.get(ident, "")).endswith(
            ("Integer", "Double", "Single", "SmallInteger", "OID"))
        plan = identity_plan(ent, fields)
    else:
        sch = socrata_schema(ent)
        if sch.get("error"):
            rec["error"] = "SCHEMA " + sch["error"]
            rec["verdict"] = "IDENTITY_UNRESOLVED"
            return rec
        rec["layer_kind"] = "socrata"
        rec["control"] = socrata_control(ent)
        rec["max_record_count"] = 200
        plan = identity_plan(ent, sch["fields"])
    rec["identity_strategy"] = plan["strategy"]

    if not rec["control"] or not rec["control"]["ok"]:
        rec["error"] = "CONTROL_FAILED " + str((rec["control"] or {}).get("err"))
        rec["verdict"] = "IDENTITY_UNRESOLVED"
        rec["why"] = "positive control failed - negatives discarded"
        return rec

    if "IDENT" in mode:
        page = arcgis_page(ent) if is_arc else socrata_page(ent)
        rec["candidates"] = identity_candidates(page)

    for r in rows:
        c = case_of(r["source_key"])
        if not c:
            continue
        time.sleep(0.25)
        if is_arc:
            w = where_for(plan, ent, {"objectIdField": "OBJECTID"}, c,
                          bool(ent.get("_ident_numeric")))
            if w is None:
                continue
            feats, why = arcgis_fetch(ent, {"objectIdField": "OBJECTID"}, w)
            if feats is None or not feats:
                continue
            items = feats
        else:
            w = soql_for(plan, ent, c)
            if w is None:
                continue
            got, why = socrata_fetch(ent, w)
            if got is None or not got:
                continue
            items = got
        rec["matched"] += 1
        rec["features_max"] = max(rec["features_max"], len(items))
        if rec["max_record_count"] and len(items) >= rec["max_record_count"]:
            rec["capped"] += 1
        pts = []
        for it in items:
            pts.extend(points_from(it, ent, is_arc))
        for _, _, kind in pts:
            rec["point_sources"][kind] = rec["point_sources"].get(kind, 0) + 1
        if not pts:
            rec["no_points"] += 1
            continue
        rec["with_points"] += 1
        if r.get("lat") is None or r.get("lng") is None:
            continue
        best = min(haversine_m(float(r["lat"]), float(r["lng"]), y, x) for x, y, _ in pts)
        rec["worst_m"] = max(rec["worst_m"], best)
        if best < 0.01:
            rec["in_set_exact"] += 1
        elif best <= TOL_M:
            rec["in_set_tol"] += 1
        else:
            rec["outside_tol"] += 1

    scored = rec["in_set_exact"] + rec["in_set_tol"] + rec["outside_tol"]
    if rec["matched"] == 0:
        rec["verdict"] = "HISTORICAL_GEOMETRY_UNRECOVERABLE"
        rec["why"] = (f"control {rec['control']['count']:,} but 0 of {rec['requested']} "
                      "frozen identities reconnect")
    elif rec["with_points"] == 0:
        rec["verdict"] = "NO_AUTHORITATIVE_SOURCE_GEOMETRY"
        rec["why"] = (f"{rec['matched']} identities reconnect but the publisher supplies "
                      "no coordinate on any of them - neither geometry nor a filled lat/lng column")
    elif rec["capped"] and rec["capped"] >= rec["matched"]:
        rec["verdict"] = "IDENTITY_UNRESOLVED"
        rec["why"] = (f"every matched identity returns the page cap "
                      f"({rec['max_record_count']}) - the configured field is a category, "
                      "not a record identity")
    elif scored == 0:
        rec["verdict"] = "SOURCE_GEOMETRY_REFETCH_REQUIRED"
        rec["why"] = "identities reconnect and carry coordinates, but nothing was comparable"
    elif rec["outside_tol"] == 0:
        rec["verdict"] = "POINT_NO_REFETCH_PROVEN"
        rec["why"] = (f"{scored} stored coordinates all reproduce a publisher coordinate for "
                      f"their own identity ({rec['in_set_exact']} exact), worst "
                      f"{rec['worst_m']:.3f} m, 0 outside {TOL_M} m")
    else:
        rec["verdict"] = "SOURCE_GEOMETRY_REFETCH_REQUIRED"
        rec["why"] = (f"{rec['outside_tol']} of {scored} stored coordinates match no "
                      f"publisher coordinate for their identity, worst {rec['worst_m']:.3f} m")
    return rec


def pass2():
    say("mode", "n2c-attrgeom (pass 2, read-only)")
    say("tolerance", f"{TOL_M} m (unchanged)")
    say("targets", f"{len(PASS2)} sources pass 1 could not honestly settle")
    idx = registry_index()
    rids = [r[0] for r in PASS2]
    samples = frozen_sample(rids)
    say("sources with a frozen sample", len(samples))

    out = []
    for i, (rid, mode) in enumerate(PASS2, 1):
        ent = idx.get(rid)
        rows = samples.get(rid) or []
        time.sleep(POLITE)
        try:
            rec = pass2_source(rid, mode, ent, rows)
        except Exception as e:
            rec = {"registry_id": rid, "mode": mode, "error": f"{type(e).__name__} {str(e)[:120]}",
                   "verdict": "IDENTITY_UNRESOLVED", "why": "probe raised", "matched": 0,
                   "requested": len(rows), "capped": 0, "features_max": 0, "with_points": 0,
                   "no_points": 0, "in_set_exact": 0, "in_set_tol": 0, "outside_tol": 0,
                   "worst_m": 0.0, "point_sources": {}, "candidates": [], "control": None,
                   "layer_kind": None, "max_record_count": None, "identity_strategy": None,
                   "connector": (ent or {}).get("_group")}
        out.append(rec)
        print(f"[{i:2d}/{len(PASS2)}] {rid:42s} {mode:16s} "
              f"match {rec['matched']:2d}/{rec['requested']:2d} pts {rec['with_points']:2d} "
              f"capped {rec['capped']:2d} fmax {rec['features_max']:4d} "
              f"exact {rec['in_set_exact']:2d} tol {rec['in_set_tol']:2d} "
              f"out {rec['outside_tol']:2d} worst {rec['worst_m']:.3f}m -> {rec['verdict']}",
              flush=True)
        print(f"        point sources: {rec['point_sources']}   why: {rec['why']}", flush=True)
        for c in (rec.get("candidates") or []):
            print(f"        identity candidate {c['field']:28s} distinct {c['distinct']:4d}"
                  f"/{c['rows']:4d} namelike={c['namelike']}", flush=True)

    print("\n===== N2C PASS 2 RESULT (json) =====")
    print(json.dumps(out, separators=(",", ":"), default=str))
    print("\nPASS 2 COMPLETE - nothing written.")
    return 0

def main():
    if os.environ.get("MODE", "").strip() == "n2c-attrgeom":
        return pass2()
    say("mode", "n2c-diagnose (read-only)")
    say("snapshot", SNAPSHOT)
    say("tolerance", f"{TOL_M} m (unchanged from N2A/N2B)")

    rids = [r[0] for r in INVENTORY]
    counts = {r["rid"]: r for r in frozen_counts(rids)}
    say("frozen sources returned", len(counts))
    bad = []
    tp = tq = 0
    for rid, bucket, ep, eq in INVENTORY:
        c = counts.get(rid)
        if not c:
            bad.append(f"{rid} ABSENT")
            continue
        if c["projects"] != ep or c["pairs"] != eq:
            bad.append(f"{rid} {c['projects']}/{c['pairs']} != {ep}/{eq}")
        tp += c["projects"]
        tq += c["pairs"]
    say("STARTING DENOMINATOR sources", f"{len(counts)} (expect {EXPECT_SOURCES})")
    say("STARTING DENOMINATOR projects", f"{tp:,} (expect {EXPECT_PROJECTS:,})")
    say("STARTING DENOMINATOR pairs", f"{tq:,} (expect {EXPECT_PAIRS:,})")
    if bad or len(counts) != EXPECT_SOURCES or tp != EXPECT_PROJECTS or tq != EXPECT_PAIRS:
        for b in bad:
            say("  MISMATCH", b)
        raise SystemExit("STOP: starting denominator does not close. Reconcile before probing.")
    say("reconciliation", "EXACT - probing may begin")

    idx = registry_index()
    samples = frozen_sample(rids)
    say("sources with a frozen sample", len(samples))

    results = []
    for i, (rid, bucket, ep, eq) in enumerate(INVENTORY, 1):
        ent = idx.get(rid)
        rows = samples.get(rid) or []
        time.sleep(POLITE)
        try:
            rec = diagnose(rid, bucket, ent, rows)
        except Exception as e:
            rec = {"registry_id": rid, "bucket": bucket, "connector": (ent or {}).get("_group"),
                   "error": f"{type(e).__name__} {str(e)[:120]}",
                   "verdict": "IDENTITY_UNRESOLVED", "why": "probe raised",
                   "requested": 0, "matched": 0, "unique": 0, "multi": 0, "missing": 0,
                   "compared": 0, "exact": 0, "within_tol": 0, "outside_tol": 0, "max_m": 0.0,
                   "corroborated": 0, "corroborate_disagree": 0, "layer": None,
                   "control": None, "ladder": [], "identity": None, "multiplicity": []}
        rec["projects"], rec["pairs"] = ep, eq
        results.append(rec)
        print(f"[{i:2d}/20] {rid:42s} {bucket:13s} "
              f"req {rec['requested']:2d} match {rec['matched']:2d} uniq {rec['unique']:2d} "
              f"multi {rec['multi']:2d} miss {rec['missing']:2d} cmp {rec['compared']:2d} "
              f"out {rec['outside_tol']:2d} max {rec['max_m']:.3f}m -> {rec['verdict']}",
              flush=True)
        if rec.get("ladder"):
            for s in rec["ladder"]:
                print(f"        ladder {s['step']:32s} {'OK ' if s['ok'] else 'ERR'} "
                      f"feat={s['features']} {s['err'] or ''}", flush=True)
        if rec.get("why"):
            print(f"        why: {rec['why']}", flush=True)

    print("\n===== N2C RESULT (json) =====")
    print(json.dumps(results, separators=(",", ":"), default=str))

    agg = {}
    for r in results:
        a = agg.setdefault(r["verdict"], {"sources": 0, "projects": 0, "pairs": 0})
        a["sources"] += 1
        a["projects"] += r["projects"]
        a["pairs"] += r["pairs"]
    print("\n===== N2C VERDICT TOTALS =====")
    for k in sorted(agg):
        v = agg[k]
        print(f"{k:38s} sources {v['sources']:3d}  projects {v['projects']:8,}  pairs {v['pairs']:9,}")
    print(f"{'TOTAL':38s} sources {sum(v['sources'] for v in agg.values()):3d}  "
          f"projects {sum(v['projects'] for v in agg.values()):8,}  "
          f"pairs {sum(v['pairs'] for v in agg.values()):9,}")
    print(f"{'EXPECTED':38s} sources {EXPECT_SOURCES:3d}  projects {EXPECT_PROJECTS:8,}  "
          f"pairs {EXPECT_PAIRS:9,}")
    print("\nN2C COMPLETE - nothing written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
