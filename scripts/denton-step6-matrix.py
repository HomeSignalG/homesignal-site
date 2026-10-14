#!/usr/bin/env python3
"""Denton Step 6 item 2: ZIP -> actual permitting jurisdictions, by GEOGRAPHY. READ ONLY (runner; the sandbox has no egress).
STEP=discover : search for ETJ / city-limit layers (prints candidates, computes nothing).
STEP=compute  : area shares per ZIP polygon (geo.zip_membership_boundary) by incorporated city (Census TIGERweb or a city-published
                layer), ETJ per city (layers listed in data/denton-step6-etj-sources.json) and the remainder; stored record counts.
No radius logic. Anything unobtainable is UNKNOWN. Every SQL statement is a SELECT inside `begin read only`."""
import json, os, re, sys, time, urllib.parse, urllib.request
REF = "qwnnmljucajnexpxdgxr"; TOKEN = os.environ["SUPABASE_ACCESS_TOKEN"]; UA = "Mozilla/5.0 (HomeSignal step6 jurisdictions; read-only)"
STEP = os.environ.get("STEP", "discover")
ZIPS = ("75007 75010 75022 75028 75033 75036 75056 75057 75065 75067 75068 75077 76201 76203 76205 76207 76208 76209 76210 "
        "76226 76227 76247 76249 76258 76259 76262 76266").split()
assert len(ZIPS) == 27


def sql(q):
    assert re.match(r"^\s*(with|select)\b", q, re.I) and not re.search(r"\b(insert|update|delete|drop|alter|create|truncate|grant)\b", q, re.I)
    body = json.dumps({"query": "begin read only;\n" + q + ";\nrollback;"}).encode()
    for a in range(3):
        try:
            req = urllib.request.Request(f"https://api.supabase.com/v1/projects/{REF}/database/query", data=body,
                headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "Accept": "application/json", "User-Agent": UA})
            with urllib.request.urlopen(req, timeout=170) as r:
                out = json.load(r)
            if isinstance(out, list) and out and isinstance(out[-1], list):
                out = out[-1]
            return out
        except Exception as e:
            if a == 2:
                raise RuntimeError("SQL failed: " + str(e) + (e.read().decode()[:400] if hasattr(e, "read") else ""))
            time.sleep(4)


def get(url, params=None, timeout=90):
    for a in range(3):
        try:
            data = urllib.parse.urlencode(params).encode() if params is not None else None
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            if a == 2:
                return {"_err": f"{type(e).__name__}: {e}"}
            time.sleep(3)


def emit(tag, obj):
    print(f"----- BEGIN {tag} -----")
    print(json.dumps(obj, separators=(",", ":")))
    print(f"----- END {tag} -----", flush=True)


def discover():
    out = {"search": {}, "dirs": {}}
    qs = ["extraterritorial jurisdiction Denton County", "ETJ Texas city extraterritorial", "city limits Denton County Texas",
          "NCTCOG city limits ETJ", "Denton County municipal boundaries", "ETJ Frisco Prosper Little Elm Denton Lewisville Argyle"]
    for q in qs:
        j = get("https://www.arcgis.com/sharing/rest/search", {"q": q, "f": "json", "num": "25"})
        out["search"][q] = j if "_err" in j else [{"t": r.get("title"), "o": r.get("owner"), "ty": r.get("type"), "u": r.get("url"), "m": r.get("modified")}
                                                 for r in j.get("results", [])]
    hosts = ["https://gis.dentoncounty.gov/arcgis/rest/services", "https://geoservices.nctcog.org/arcgis/rest/services",
             "https://maps.nctcog.org/arcgis/rest/services", "https://gis.cityofdenton.com/arcgis/rest/services"]
    for h in hosts:
        j = get(h + "?f=json")
        entry = {"top": j if "_err" in j else {"folders": j.get("folders"), "services": [s["name"] + ":" + s["type"] for s in j.get("services", [])]}}
        if "_err" not in j:
            for f in (j.get("folders") or [])[:40]:
                jj = get(f"{h}/{f}?f=json")
                entry[f] = jj if "_err" in jj else [s["name"] + ":" + s["type"] for s in jj.get("services", [])]
        out["dirs"][h] = entry
    emit("STEP6 DISCOVER", out)


def ring_area(r):
    return sum((r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1]) for i in range(len(r))) / 2


def wkt(rings):
    outers = [r for r in rings if ring_area(r) < 0]
    holes = [r for r in rings if ring_area(r) >= 0]
    f = lambda rs: ("MULTIPOLYGON(" + ",".join("((" + ",".join(f"{x} {y}" for x, y in r) + "))" for r in rs) + ")") if rs else "MULTIPOLYGON EMPTY"
    return f(outers), f(holes)


def fetch_layer(url, where, fields, bbox):
    feats, off = [], 0
    while True:
        j = get(url + "/query", {"f": "json", "where": where, "geometry": ",".join(map(str, bbox)), "geometryType": "esriGeometryEnvelope", "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects", "outFields": fields, "returnGeometry": "true", "outSR": "4326", "geometryPrecision": "6",
            "resultOffset": off, "resultRecordCount": 200})
        if "_err" in j or "error" in j:
            return None, j.get("_err") or json.dumps(j["error"])[:200]
        fs = j.get("features", [])
        feats += fs
        if not j.get("exceededTransferLimit") or not fs:
            return feats, None
        off += len(fs)


def compute():
    cfg = json.load(open("data/denton-step6-etj-sources.json")) if os.path.exists("data/denton-step6-etj-sources.json") else {"city_limits": None, "etj": []}
    CENSUS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer"
    meta = get(CENSUS + "?f=json")
    lay = [l for l in meta.get("layers", []) if re.search(r"incorporated places", l["name"], re.I)]
    res = {"census_layer": [l["name"] for l in lay], "census_err": meta.get("_err"), "etj_sources": cfg["etj"], "zips": {}}
    for z in ZIPS:
        bb = sql(f"select ST_XMin(g) x0,ST_YMin(g) y0,ST_XMax(g) x1,ST_YMax(g) y1,ST_SRID(g) srid, ST_Area(g::geography) m2 from (select geo.zip_membership_boundary('{z}') g) s")
        if not bb or bb[0]["x0"] is None:
            res["zips"][z] = {"status": "UNKNOWN: no ZIP boundary"}
            continue
        b = bb[0]
        box = [b["x0"], b["y0"], b["x1"], b["y1"]]
        rec = {"zip_km2": round(b["m2"] / 1e6, 2), "srid": b["srid"], "errors": []}
        parts = []
        if cfg.get("city_limits"):
            c = cfg["city_limits"]
            fs, err = fetch_layer(c["url"], c.get("where", "1=1"), c["name_field"], box)
        elif lay:
            c = {"name_field": "NAME"}
            fs, err = fetch_layer(f"{CENSUS}/{lay[0]['id']}", "STATE='48'", "NAME", box)
        else:
            fs, err = None, "no city layer"
        if fs is None:
            rec["errors"].append("city layer: " + str(err))
            rec["city_status"] = "UNKNOWN"
        else:
            rec["city_status"] = "ok"
            for f in fs:
                o, h = wkt((f.get("geometry") or {}).get("rings") or [])
                parts.append(("city", f["attributes"][c["name_field"]], o, h))
        rec["etj_status"] = "UNKNOWN: no ETJ layer configured" if not cfg["etj"] else "ok"
        for e in cfg["etj"]:
            fs, err = fetch_layer(e["url"], e.get("where", "1=1"), e["name_field"], box)
            if fs is None:
                rec["errors"].append(f"etj {e['url']}: {err}")
                rec["etj_status"] = "UNKNOWN: fetch failed"
                continue
            for f in fs:
                o, h = wkt((f.get("geometry") or {}).get("rings") or [])
                nm = e.get("fixed_city") or f["attributes"].get(e["name_field"])
                parts.append(("etj", str(nm), o, h))
        parts = [p for p in parts if not p[2].endswith("EMPTY")]
        q1 = chr(39)
        vals = ",".join(f"('{k}','{n.replace(q1, q1 * 2)}','{o}','{h}')" for k, n, o, h in parts) or "('none','','MULTIPOLYGON EMPTY','MULTIPOLYGON EMPTY')"
        q = f"""with z as (select geo.zip_membership_boundary('{z}') g),
        raw(kind,name,o,h) as (values {vals}),
        p as (select kind,name, ST_MakeValid(ST_Difference(ST_SetSRID(ST_GeomFromText(o),(select ST_SRID(g) from z)),
              ST_SetSRID(ST_GeomFromText(h),(select ST_SRID(g) from z)))) g from raw where kind<>'none'),
        cu as (select ST_Union(g) g from p where kind='city'),
        eu as (select ST_Union(g) g from p where kind='etj'),
        eo as (select case when (select g from cu) is null then (select g from eu) else ST_Difference((select g from eu),(select g from cu)) end g)
        select 'city' k, p.name, ST_Area(ST_Intersection(z.g,p.g)::geography)/ST_Area(z.g::geography) a from p,z where p.kind='city' and ST_Intersects(z.g,p.g)
        union all select 'etj', p.name, ST_Area(ST_Intersection(z.g,case when (select g from cu) is null then p.g else ST_Difference(p.g,(select g from cu)) end)::geography)/ST_Area(z.g::geography)
              from p,z where p.kind='etj' and ST_Intersects(z.g,p.g)
        union all select 'city_union','', coalesce(ST_Area(ST_Intersection(z.g,(select g from cu))::geography)/ST_Area(z.g::geography),0) from z
        union all select 'etj_union','', coalesce(ST_Area(ST_Intersection(z.g,(select g from eo))::geography)/ST_Area(z.g::geography),0) from z"""
        rows = sql(q)
        rec["cities"] = sorted([{"name": r["name"], "share": round(r["a"], 4)} for r in rows if r["k"] == "city" and r["a"] > 0.0005], key=lambda x: -x["share"])
        rec["etj"] = sorted([{"name": r["name"], "share": round(r["a"], 4)} for r in rows if r["k"] == "etj" and r["a"] > 0.0005], key=lambda x: -x["share"])
        cu = next(r["a"] for r in rows if r["k"] == "city_union")
        eu = next(r["a"] for r in rows if r["k"] == "etj_union")
        rec["city_union"] = round(cu, 4)
        rec["etj_union"] = round(eu, 4)
        rec["remainder"] = round(max(0, 1 - cu - eu), 4)
        # stored development records via the canonical serving membership (not app_projects.zip)
        rec["records"] = sql(f"""select p.registry_id, count(distinct m.source_key) n_all,
            count(distinct m.source_key) filter (where p.submitted_at >= now() - interval '365 days') n_365d, max(p.submitted_at)::date newest
          from geo.n5_serving_membership m
          join lateral (select registry_id, submitted_at from public.app_projects a where a.source_key=m.source_key order by a.id limit 1) p on true
          where m.zcta5::text='{z}' group by 1 order by 2 desc""")
        res["zips"][z] = rec
        print(f"[{z}] cities={rec['cities']} etj={rec['etj']} rem={rec['remainder']} err={rec['errors']}", file=sys.stderr, flush=True)
    reg = json.load(open("supabase/functions/get-address-report/jurisdiction-registry.json"))
    res["registry_denton_tx"] = [{"id": e["registry_id"], "coverage": e.get("coverage")} for k in ("socrata", "arcgis", "ckan", "csv", "carto", "opendatasoft")
        for e in reg.get(k, []) if any(c.get("state") == "TX" and c.get("county") in ("Denton", None) for c in e.get("coverage", []))]
    for z, r in res["zips"].items():
        emit("STEP6 ZIP " + z, r)
    emit("STEP6 META", {k: v for k, v in res.items() if k != "zips"})


discover() if STEP == "discover" else compute()
