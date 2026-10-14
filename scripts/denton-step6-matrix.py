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


def norm(n):
    return re.sub(r"\s+(city|town)$", "", str(n).strip(), flags=re.I).lower()


def compute():
    cfg = json.load(open("data/denton-step6-etj-sources.json"))
    CENSUS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer"
    meta = get(CENSUS + "?f=json")
    lay = [l for l in meta.get("layers", []) if re.search(r"incorporated places", l["name"], re.I)]
    res = {"config": cfg, "census_layer_ids": [l["id"] for l in lay], "census_err": meta.get("_err"), "zips": {}}
    for z in ZIPS:
        bb = sql(f"select ST_XMin(g) x0,ST_YMin(g) y0,ST_XMax(g) x1,ST_YMax(g) y1,ST_SRID(g) srid, ST_Area(g::geography) m2 from (select geo.zip_membership_boundary('{z}') g) s")
        if not bb or bb[0]["x0"] is None:
            res["zips"][z] = {"status": "UNKNOWN: no ZIP boundary"}
            continue
        b = bb[0]
        box = [b["x0"], b["y0"], b["x1"], b["y1"]]
        rec = {"zip_km2": round(b["m2"] / 1e6, 2), "srid": b["srid"], "errors": [], "status": {}}
        parts = []   # (kind, src, name, type, outers, holes)
        def add(kind, src, fs, namef, typef=None, fixed=None):
            for f in fs:
                o, h = wkt((f.get("geometry") or {}).get("rings") or [])
                a_ = f["attributes"]
                parts.append((kind, src, str(fixed or a_.get(namef)), str(a_.get(typef)) if typef else "", o, h))
        c = cfg["city_limits"]
        fs, err = fetch_layer(c["url"], "1=1", c["name_field"], box)
        rec["status"]["city_county_layer"] = "ok" if fs is not None else "UNKNOWN: " + str(err)
        if fs is not None: add("city", "denton_county_gis", fs, c["name_field"])
        for lid in [l["id"] for l in lay[:1]]:
            fs, err = fetch_layer(f"{CENSUS}/{lid}", "STATE='48'", "NAME", box)
            rec["status"]["city_census"] = "ok" if fs is not None else "UNKNOWN: " + str(err)
            if fs is not None: add("city", "census_tigerweb", fs, "NAME")
        for e in cfg["etj"]:
            fs, err = fetch_layer(e["url"], "1=1", ",".join([e["name_field"], e.get("type_field", e["name_field"])]), box)
            rec["status"]["etj"] = "ok" if fs is not None else "UNKNOWN: " + str(err)
            if fs is not None: add("etj", "denton_county_gis", fs, e["name_field"], e.get("type_field"))
        k = cfg["county"]
        fs, err = fetch_layer(k["url"], k.get("where", "1=1"), "*", box)
        rec["status"]["county"] = "ok" if fs else "UNKNOWN: " + str(err or "no features")
        if fs: add("county", "denton_county_gis", fs, "OBJECTID", fixed="Denton County")
        parts = [p for p in parts if not p[4].endswith("EMPTY")]
        q1 = chr(39)
        vals = ",".join(f"('{k_}','{s_}','{n.replace(q1, q1 * 2)}','{t.replace(q1, q1 * 2)}','{o}','{h}')" for k_, s_, n, t, o, h in parts) or "('none','','','','MULTIPOLYGON EMPTY','MULTIPOLYGON EMPTY')"
        q = f"""with z as (select geo.zip_membership_boundary('{z}') g), srid as (select ST_SRID(g) s from z),
        raw(kind,src,name,typ,o,h) as (values {vals}),
        p as (select kind,src,name,typ, ST_MakeValid(ST_Difference(ST_SetSRID(ST_GeomFromText(o),(select s from srid)),
              ST_SetSRID(ST_GeomFromText(h),(select s from srid)))) g from raw where kind<>'none'),
        cu as (select ST_Union(g) g from p where kind='city'),
        eu as (select ST_Union(g) g from p where kind='etj'),
        ku as (select ST_Union(g) g from p where kind='county'),
        eo as (select case when (select g from cu) is null then (select g from eu) else ST_Difference((select g from eu),(select g from cu)) end g),
        zin as (select case when (select g from ku) is null then null else ST_Intersection(z.g,(select g from ku)) end g from z),
        unc as (select case when (select g from zin) is null then null else
                 ST_Difference(ST_Difference((select g from zin), coalesce((select g from cu),ST_GeomFromText('POLYGON EMPTY',(select s from srid)))),
                               coalesce((select g from eo),ST_GeomFromText('POLYGON EMPTY',(select s from srid)))) end g)
        select 'city' k, p.src, p.name, p.typ, ST_Area(ST_Intersection(z.g,p.g)::geography)/ST_Area(z.g::geography) a from p,z where p.kind='city' and ST_Intersects(z.g,p.g)
        union all select 'etj', p.src, p.name, p.typ, ST_Area(ST_Intersection(z.g,case when (select g from cu) is null then p.g else ST_Difference(p.g,(select g from cu)) end)::geography)/ST_Area(z.g::geography)
              from p,z where p.kind='etj' and ST_Intersects(z.g,p.g)
        union all select 'city_union','','','', coalesce(ST_Area(ST_Intersection(z.g,(select g from cu))::geography)/ST_Area(z.g::geography),0) from z
        union all select 'etj_union','','','', coalesce(ST_Area(ST_Intersection(z.g,(select g from eo))::geography)/ST_Area(z.g::geography),0) from z
        union all select 'in_county','','','', coalesce(ST_Area((select g from zin)::geography)/ST_Area(z.g::geography),-1) from z
        union all select 'uninc_in_county','','','', coalesce(ST_Area((select g from unc)::geography)/ST_Area(z.g::geography),-1) from z"""
        rows = sql(q)
        one = lambda kk: next(r["a"] for r in rows if r["k"] == kk)
        rec["parts"] = [{"kind": r["k"], "src": r["src"], "name": r["name"], "typ": r["typ"], "share": round(r["a"], 5)} for r in rows if r["k"] in ("city", "etj") and r["a"] > 0.0005]
        rec["city_union"] = round(one("city_union"), 5)
        rec["etj_union"] = round(one("etj_union"), 5)
        rec["in_county"] = None if one("in_county") < 0 else round(one("in_county"), 5)
        rec["uninc_in_county"] = None if one("uninc_in_county") < 0 else round(one("uninc_in_county"), 5)
        rec["records"] = sql(f"""select p.registry_id, count(distinct m.source_key) n_all,
            count(distinct m.source_key) filter (where p.submitted_at >= now() - interval '365 days') n_365d, max(p.submitted_at)::date newest
          from geo.n5_serving_membership m
          join lateral (select registry_id, submitted_at from public.app_projects a where a.source_key=m.source_key order by a.id limit 1) p on true
          where m.zcta5::text='{z}' group by 1 order by 2 desc""")
        res["zips"][z] = rec
        print(f"[{z}] in_county={rec['in_county']} city={rec['city_union']} etj={rec['etj_union']} uninc={rec['uninc_in_county']} status={rec['status']}", file=sys.stderr, flush=True)
    os.makedirs("out", exist_ok=True)
    json.dump(res, open("out/step6-raw.json", "w"))
    reg = json.load(open("supabase/functions/get-address-report/jurisdiction-registry.json"))
    res["registry"] = {e["registry_id"]: {"coverage": e.get("coverage")} for k in ("arcgis", "socrata", "ckan", "csv", "carto", "opendatasoft") for e in reg.get(k, [])}
    json.dump(res, open("out/step6-raw.json", "w"))
    print("raw written", file=sys.stderr)


def inspect():
    base = "https://gis.dentoncounty.gov/arcgis/rest/services/"
    out = {}
    for s in ["City_Limit", "ETJ_GC", "PoliticalBoundaries_GC", "CityETJPermits_GC", "CitiesGrey", "Special_DistrictsGC"]:
        m = get(f"{base}{s}/MapServer?f=json")
        e = {"desc": (m.get("serviceDescription") or "")[:200], "err": m.get("_err"), "layers": {}}
        for l in (m.get("layers") or []):
            lj = get(f"{base}{s}/MapServer/{l['id']}?f=json")
            cnt = get(f"{base}{s}/MapServer/{l['id']}/query", {"f": "json", "where": "1=1", "returnCountOnly": "true"})
            smp = get(f"{base}{s}/MapServer/{l['id']}/query", {"f": "json", "where": "1=1", "outFields": "*", "returnGeometry": "false", "resultRecordCount": "60"})
            e["layers"][l["id"]] = {"name": l["name"], "type": lj.get("geometryType"), "fields": [f["name"] for f in (lj.get("fields") or [])],
                                    "count": cnt.get("count"), "sample": [x["attributes"] for x in (smp.get("features") or [])][:60], "err": lj.get("_err")}
        out[s] = e
    emit("STEP6 INSPECT", out)


{"discover": discover, "inspect": inspect}.get(STEP, compute)()
