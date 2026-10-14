#!/usr/bin/env python3
"""Builds docs/denton-step6-zip-jurisdiction-matrix-2026-10-14.md and data/denton-step6-zip-jurisdiction-matrix.json from out/step6-raw.json
(written by denton-step6-matrix.py STEP=compute). No network, no database."""
import json, re, datetime, collections

raw = json.load(open("out/step6-raw.json"))
TODAY = datetime.date(2026, 10, 14)
DISC = ("General Texas framework, NOT verified against any city's ordinances, interlocal agreements or the county's rules: municipalities regulate "
        "(zoning, building permits) inside their limits; a city's subdivision/plat authority also reaches its ETJ (Local Gov't Code ch. 212); counties have "
        "no zoning power and only limited authority (plat approval in unincorporated areas under ch. 232, plus floodplain / on-site sewage / 911 addressing "
        "programs). Which office actually issues a given permit in a given spot must be confirmed with that jurisdiction.")

# registry source -> the authority that legitimately issues the records (from the registry entry names + docs/source-inventory.md)
SRC = {
    "frisco-active-building-permits": {"authority": "Frisco", "scope": "City of Frisco active building permits (all ISSUED). Registry coverage declares Collin+Denton because Frisco straddles the county line."},
    "denton-county-dev-permits": {"authority": "Denton County", "scope": "Denton County DEV_Permits (county-issued development permits). FROZEN: layer-wide newest 2023-06-09 (docs/denton-data-integrity-launch-gate-2026-10-10.md s1)."},
    "fort-worth-development-permits": {"authority": "Fort Worth", "scope": "City of Fort Worth development permits."},
    "dallas-specific-use-permits": {"authority": "Dallas", "scope": "City of Dallas specific-use (zoning) permits only."},
    "txdot-projects-info-all": {"authority": None, "scope": "TxDOT statewide road projects: state highway work, NOT a local land-development permit authority; shown for completeness, ignored for gap."},
}
CONNECTED = collections.OrderedDict()   # registry id -> {first-party authority}
nrm = lambda n: re.sub(r"\s+(city|town)$", "", str(n).strip(), flags=re.I).lower()
disp = lambda n: re.sub(r"\s+(city|town)$", "", str(n).strip(), flags=re.I).title().replace("Dish", "DISH")
age = lambda d: (TODAY - datetime.date.fromisoformat(d)).days


def jurisdictions(z):
    r = raw["zips"][z]
    out, by = [], {}
    for p in r["parts"]:
        if p["kind"] == "city":
            by.setdefault(nrm(p["name"]), {})[p["src"]] = p["share"]
    for k, v in by.items():
        pri = max(v.values())   # county layer covers only Denton County; Census adds the part in other counties
        j = {"name": disp(k), "type": "incorporated city", "area_share": pri,
             "boundary_source": "denton_county_gis" if "denton_county_gis" in v else "census_tigerweb (outside Denton County layer)"}
        if len(v) == 2 and abs(v["denton_county_gis"] - v["census_tigerweb"]) > 0.02:
            j["note"] = f"county layer {v['denton_county_gis']} (Denton County part) vs Census {v['census_tigerweb']} (whole city); larger used"
            j["boundary_source"] = "max(denton_county_gis, census_tigerweb)"
        out.append(j)
    etj = {}
    for p in r["parts"]:
        if p["kind"] != "etj":
            continue
        name, typ = p["name"], p["typ"]
        if "/" in name or name.lower().startswith("undetermined") or "undetermined" in name.lower():
            label, jt = f"Undetermined/overlapping ETJ ({name})", "ETJ-undetermined"
        elif typ == "DIV 2":
            label, jt = f"{disp(name)} 'DIV 2' polygon in county ETJ layer (meaning of DIV 2 unverified)", "ETJ-DIV2"
        else:
            label, jt = f"{disp(name)} ETJ", "ETJ"
        e = etj.setdefault(label, {"name": label, "type": jt, "area_share": 0.0, "boundary_source": "denton_county_gis ETJ_GC", "city": disp(name) if jt == "ETJ" else None})
        e["area_share"] = round(e["area_share"] + p["share"], 5)
    out += list(etj.values())
    if r.get("uninc_in_county") is not None:
        out.append({"name": "Unincorporated Denton County", "type": "unincorporated county", "area_share": r["uninc_in_county"], "boundary_source": "derived: ZIP ∩ county outline − city limits − ETJ"})
    if r.get("in_county") is not None and r.get("uninc_in_county") is not None:
        rest = round(1 - r["city_union"] - r["etj_union"] - r["uninc_in_county"], 5)
        if rest >= 0.005:
            out.append({"name": "Outside Denton County, not in a mapped city/ETJ", "type": "outside-county-unmapped", "area_share": rest, "boundary_source": "derived residual; authority UNKNOWN"})
    out.sort(key=lambda j: -(j["area_share"] or 0))
    return out


def src_for(j, recs):
    """registered sources that legitimately cover this jurisdiction, with ZIP-level stored stats."""
    t = j["type"]
    if t == "incorporated city":
        auth = j["name"]
    elif t == "ETJ":
        auth = j["city"]
    elif t == "unincorporated county":
        auth = "Denton County"
    else:
        auth = None
    res = []
    for rid, s in SRC.items():
        if s["authority"] and auth and nrm(s["authority"]) == nrm(auth):
            rec = next((x for x in recs if x["registry_id"] == rid), None)
            res.append({"registry_id": rid, "stored_in_zip": rec and {"n_all": rec["n_all"], "n_365d": rec["n_365d"], "newest": rec["newest"]}})
    return res


def status(srcs):
    if not srcs:
        return "NO_SOURCE_REGISTERED"
    best = None
    for s in srcs:
        st = s["stored_in_zip"]
        if st and st["n_365d"] > 0:
            return "CURRENT"
        if st:
            best = "STALE"
        elif best is None:
            best = "REGISTERED_NO_RECORDS_IN_ZIP"
    return best


def auth_share(js, auth):
    if not auth:
        return None
    if auth == "Denton County":
        return round(sum(j["area_share"] for j in js if j["type"] in ("unincorporated county", "ETJ", "ETJ-undetermined", "ETJ-DIV2")), 5)
    return round(sum(j["area_share"] for j in js if j["type"] == "incorporated city" and nrm(j["name"]) == nrm(auth)), 5)


def authority(js):
    cities = [j for j in js if j["type"] == "incorporated city" and j["area_share"] >= 0.005]
    etjs = [j for j in js if j["type"] == "ETJ" and j["area_share"] >= 0.005]
    und = [j for j in js if j["type"] in ("ETJ-undetermined", "ETJ-DIV2") and j["area_share"] >= 0.005]
    unc = next((j for j in js if j["type"] == "unincorporated county"), None)
    return {
        "building_permits_and_zoning": [{"authority": f"City of {c['name']}", "where": "within city limits", "area_share": c["area_share"]} for c in cities],
        "plat_subdivision": ([{"authority": f"City of {c['name']}", "where": "within city limits", "area_share": c["area_share"]} for c in cities]
                             + [{"authority": f"City of {e['city']}", "where": "ETJ (statutory general rule; confirm)", "area_share": e["area_share"]} for e in etjs]
                             + [{"authority": "UNDETERMINED (overlapping/unassigned ETJ per county GIS)", "where": u["name"], "area_share": u["area_share"]} for u in und]
                             + ([{"authority": "Denton County (limited; plat approval outside city limits/ETJ)", "where": "unincorporated", "area_share": unc["area_share"]}] if unc and unc["area_share"] >= 0.005 else [])),
        "etj_building_permit_note": "No municipal building-permit or zoning authority is asserted inside an ETJ (general TX rule); verify per city." if etjs or und else None,
        "unincorporated": ({"area_share": unc["area_share"], "note": "No county zoning or general building-permit program asserted; county GIS publishes DEV_Permits, OSSF, 911-address and floodplain-permit layers, scope unverified."} if unc else "UNKNOWN: county outline unavailable"),
        "basis": DISC,
    }


zips = {}
for z in raw["zips"]:
    r = raw["zips"][z]
    if "parts" not in r:
        zips[z] = {"zip": z, "status": r.get("status", "UNKNOWN"), "jurisdictions": "UNKNOWN", "permit_authority": "UNKNOWN", "connected_sources": [], "newest_record_date": None, "gap": "UNKNOWN: no ZIP boundary"}
        continue
    js = jurisdictions(z)
    recs = r["records"]
    for j in js:
        j["registered_sources"] = src_for(j, recs)
        j["source_status"] = status(j["registered_sources"]) if j["type"] in ("incorporated city", "ETJ", "unincorporated county") else "UNKNOWN_AUTHORITY"
    conn = []
    for x in recs:
        s = SRC.get(x["registry_id"])
        conn.append({"registry_id": x["registry_id"], "authority": s["authority"] if s else "UNMAPPED", "stored_records": x["n_all"], "records_last_365d": x["n_365d"], "newest_record_date": x["newest"], "local_permit_authority_source": bool(s and s["authority"]),
                     "authority_area_share_in_zip": auth_share(js, s["authority"]) if s else None,
                     "coverage_basis": ("not a local permit authority" if not (s and s["authority"]) else
                                        "legitimate (authority area share >=5%; for the county = unincorporated + ETJ + undetermined area, a generous reading)" if auth_share(js, s["authority"]) >= 0.05 else
                                        "disc-scoping spill only (authority covers <5% of ZIP area; stored rows are inside the registry's 3-mile disc, not the authority's limits)")})
    newest_all = max((c["newest_record_date"] for c in conn), default=None)
    newest_local = max((c["newest_record_date"] for c in conn if c["local_permit_authority_source"]), default=None)
    gaps = [{"jurisdiction": j["name"], "type": j["type"], "area_share": j["area_share"], "status": j["source_status"]} for j in js if j["source_status"] != "CURRENT" and (j["area_share"] or 0) >= 0.05]
    unc_share = round(sum(j["area_share"] for j in js if j["source_status"] != "CURRENT"), 4)
    zips[z] = {
        "zip": z, "zip_km2": r["zip_km2"],
        "jurisdictions": [{k: v for k, v in j.items() if k not in ("city", "registered_sources", "source_status")} | {"registered_sources": j["registered_sources"], "source_status": j["source_status"]} for j in js],
        "permit_authority": authority(js),
        "connected_sources": conn,
        "newest_record_date": newest_all, "newest_local_permit_record_date": newest_local,
        "gap": {"jurisdictions_without_current_source_ge_5pct": gaps, "area_share_without_current_source": unc_share,
                "current_local_source_records_365d": sum(c["records_last_365d"] for c in conn if c["local_permit_authority_source"])},
        "county_outline": "ok" if r["in_county"] is not None else "UNKNOWN", "in_denton_county_share": r["in_county"],
    }

meta = {"generated": "2026-10-14", "method": "ZIP polygon = geo.zip_membership_boundary (canonical); city limits = Denton County GIS City_Limit/0 (+ Census TIGERweb incorporated places for parts outside the county layer); ETJ = Denton County GIS ETJ_GC/1; area shares are geodesic ST_Area ratios; no radius logic. SRID 4269/4326 differences (~1 m) ignored.",
        "limitations": ["ETJ outside Denton County is UNKNOWN (county layer does not cover it); ZIPs extending into Dallas/Collin/Tarrant/Cooke counties show that share as city or 'outside county'.",
                        "Census place boundaries lag annexations; the county layer's last-edit dates are 2025-2026.",
                        "Stored-record attribution is ZIP-level (serving membership), not jurisdiction-level: a stored record is not geolocated to a city here.",
                        "Texas permit-authority text is a statutory generalization, not verified per jurisdiction.",
                        "PO Box ZIPs 75027, 75029, 76202, 76204, 76206 are out of scope (no geographic area)."],
        "sources_registered": SRC, "disclaimer": DISC}
json.dump({"meta": meta, "zips": list(zips.values())}, open("data/denton-step6-zip-jurisdiction-matrix.json", "w"), indent=1)

# ---- markdown
pct = lambda x: f"{100 * x:.1f}%" if isinstance(x, (int, float)) else "UNKNOWN"
L = ["# Denton Step 6 — ZIP → jurisdiction matrix (2026-10-14)", "",
     "Read-only, geography-based (no radius logic). Generated by `scripts/denton-step6-matrix.py` + `scripts/denton-step6-build.py` (runner, task `step6-compute`);",
     "machine-readable twin: `data/denton-step6-zip-jurisdiction-matrix.json`. Reuses the evidence in `docs/denton-data-integrity-launch-gate-2026-10-10.md` and the registry.", "",
     "## Method and limits", ""] + [f"- {m}" for m in [meta["method"]] + meta["limitations"]] + ["", "**Permit-authority caveat.** " + DISC, "",
     "## Registered sources and who they legitimately cover", "", "| registry id | authority | covers | notes |", "|---|---|---|---|"]
for rid, s in SRC.items():
    L.append(f"| `{rid}` | {s['authority'] or 'state (not local)'} | {s['scope']} | |")
L += ["", "No other registry source covers any Denton-County jurisdiction (checked against `jurisdiction-registry.json`: TX entries are Austin, Round Rock, San Marcos, San Antonio, Fort Worth, Irving, Arlington, Houston/Harris, El Paso, Dallas SUP, Frisco, Denton County, TxDOT).", "",
      "## Per-ZIP matrix (27 geographic ZIPs)", "", "| ZIP | jurisdictions by area share | connected sources (stored / last 365d / newest) | newest local-permit record | gap |", "|---|---|---|---|---|"]
for z, d in zips.items():
    if d["jurisdictions"] == "UNKNOWN":
        L.append(f"| {z} | UNKNOWN | | | UNKNOWN |"); continue
    js = "; ".join(f"{j['name']} {pct(j['area_share'])}" for j in d["jurisdictions"] if j["area_share"] >= 0.02)
    cs = "; ".join(f"`{c['registry_id'].replace('-projects-info-all','').replace('-active-building-permits','').replace('-development-permits','')}` {c['stored_records']}/{c['records_last_365d']}/{c['newest_record_date']}" for c in d["connected_sources"]) or "none stored"
    g = d["gap"]
    gs = ", ".join(f"{x['jurisdiction']} {pct(x['area_share'])} ({x['status'].lower()})" for x in g["jurisdictions_without_current_source_ge_5pct"]) or "none >=5%"
    L.append(f"| {z} | {js} | {cs} | {d['newest_local_permit_record_date'] or 'none'} | {pct(g['area_share_without_current_source'])} of area has no current source: {gs} |")
L += ["", "## Source × ZIP: does the source legitimately cover that ZIP's area?", "", "| source | ZIP | authority's share of ZIP area | stored / last 365d / newest | basis |", "|---|---|---|---|---|"]
for rid in [r for r in SRC if SRC[r]["authority"]]:
    for z, d in zips.items():
        if d["jurisdictions"] == "UNKNOWN": continue
        for c in d["connected_sources"]:
            if c["registry_id"] == rid:
                L.append(f"| `{rid}` | {z} | {pct(c['authority_area_share_in_zip'])} | {c['stored_records']}/{c['records_last_365d']}/{c['newest_record_date']} | {c['coverage_basis']} |")
# per-jurisdiction table
cj = collections.defaultdict(list)
for z, d in zips.items():
    if d["jurisdictions"] == "UNKNOWN": continue
    for j in d["jurisdictions"]:
        if j["area_share"] >= 0.01 and j["type"] in ("incorporated city",):
            cj[j["name"]].append((z, j))
L += ["", "## Per-city view (cities covering >=1% of at least one ZIP)", "", "| city | ZIPs (share of ZIP) | registered source | status in those ZIPs | newest stored record (in those ZIPs) |", "|---|---|---|---|---|"]
for c, lst in sorted(cj.items()):
    zl = ", ".join(f"{z} {pct(j['area_share'])}" for z, j in sorted(lst, key=lambda t: -t[1]["area_share"]))
    srcs = sorted({s["registry_id"] for _, j in lst for s in j["registered_sources"]})
    sts = sorted({j["source_status"] for _, j in lst})
    nw = max((s["stored_in_zip"]["newest"] for _, j in lst for s in j["registered_sources"] if s["stored_in_zip"]), default=None)
    L.append(f"| {c} | {zl} | {', '.join('`'+s+'`' for s in srcs) or 'none registered'} | {', '.join(sts)} | {nw or 'none'} |")
L += ["", "## Permit authority per ZIP (statutory generalization — see caveat)", ""]
for z, d in zips.items():
    if d["jurisdictions"] == "UNKNOWN": continue
    pa = d["permit_authority"]
    L.append(f"- **{z}** — building permits/zoning: " + ("; ".join(f"{a['authority']} {pct(a['area_share'])}" for a in pa["building_permits_and_zoning"]) or "none (no city >=0.5%)")
             + "; ETJ/unincorporated: " + ("; ".join(f"{a['authority']} [{a['where']}] {pct(a['area_share'])}" for a in pa["plat_subdivision"] if "ETJ" in a["where"] or "UNDET" in a["authority"]) or "none")
             + ("; unincorporated county " + pct(pa["unincorporated"]["area_share"]) if isinstance(pa["unincorporated"], dict) else "; unincorporated UNKNOWN"))
L += ["", "## UNKNOWN / unobtainable", "",
      "- ETJ outside Denton County (Dallas, Collin, Tarrant, Cooke portions of border ZIPs): no county-independent layer was obtained; those areas appear only as city limits (Census) or fall in the 'outside county' remainder.",
      "- Whether any city-issued permit source exists for Lewisville, Corinth, Little Elm, Aubrey, etc. was not rediscovered (per directive): see launch-gate doc s1 — none registered; first-party discovery not done here.",
      "- Which authority issues a given permit inside overlapping/undetermined ETJ polygons: UNDETERMINED per county GIS."]
open("docs/denton-step6-zip-jurisdiction-matrix-2026-10-14.md", "w").write("\n".join(L) + "\n")
print("built", len(zips))
