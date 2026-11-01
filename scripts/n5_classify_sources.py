#!/usr/bin/env python3
"""Map 1 treatment for every source, derived from the publisher's own layer. No hand-kept list.

NATIONAL SOURCE POLICY (founder, 2026-11-01): adding a source is its registry entry. Until now a
source with no row in geo.n5_accepted_source froze as UNCLASSIFIED and Map 1 drew none of its
records, so every onboarding also needed a hand-written classification migration. Measured
2026-11-01: 7 sources had no row (baltimore-city-housing-permits held 2,824 stored records on 38
ZIPs; tdlr-tabs 5 on 78617).

THE TREATMENT IS A TECHNICAL FACT, NOT AN APPROVAL, and this module only decides it from facts:
  * a non-ArcGIS connector (socrata, ckan, csv, carto, opendatasoft) stores the publisher's own
    lat/lng column or a geocode that passed the fence (sources/geo-fence.ts, CLAUDE.md 7.12b), and
    the build's geometry re-read (n5_shard.recover_shard) reads ArcGIS only            -> PROVEN
  * an ArcGIS layer whose metadata says it has NO geometry (a Table): the stored point is a fenced
    geocode of the record's own address, and there is no geometry to re-read            -> PROVEN
  * an ArcGIS layer WITH geometry (point, multipoint, line, polygon, envelope)          -> RECOVERY
      The build re-reads the publisher's own geometry for each record. For a polygon or line that
      is required. For a point layer it is the safe default: PROVEN for a point layer was granted
      only after the stored point was compared with the publisher's (scripts/n2a_classify.py
      n2a-fidelity; 7 point layers failed it and are RECOVERY), and re-reading needs no such check.
  * an ArcGIS layer whose metadata cannot be read                                       -> no row
      Left UNCLASSIFIED for this generation (recorded per record as REGISTRY_UNCLASSIFIED, never
      silent) and asked again at the next open. A guess would be a decision without evidence.
  * an engine adapter family that is not a registry entry (ADAPTER_FAMILIES)            -> declared
      tdlr-tabs geocodes every filing's own address through the same fence -> PROVEN.

EXISTING ROWS ALWAYS WIN. A row is never changed here (insert ... on conflict do nothing), so
nothing already drawn moves, and the record-quality rows (NOAUTH, HIST_UNRECOVERABLE,
IDENT_UNRESOLVED) stay exactly as they are.

WHEN IT RUNS: n5_orchestrate.open_generation calls classify_unrowed() BEFORE the capture, so the
generation it opens freezes with every row in place. It refuses to write while any generation is
BUILDING, because shards already frozen would disagree with shards frozen after the write.

stdlib only.
"""

NON_ARCGIS = ("socrata", "ckan", "csv", "carto", "opendatasoft")

# Engine adapters whose records carry a source family but have no registry entry. Each value is
# the treatment its stored point earns, with the reason. test/n5-classify-sources.test.mjs pins
# every key to the adapter constant that stamps it, so the two cannot drift.
ADAPTER_FAMILIES = {
    "tdlr-tabs": ("PROVEN", "TDLR TABS filings are placed by a fenced geocode of their own "
                            "address (get-address-report/sources/tdlr-tabs.ts)"),
}

GEOMETRY_TYPES = {
    "esriGeometryPoint", "esriGeometryMultipoint", "esriGeometryPolyline",
    "esriGeometryPolygon", "esriGeometryEnvelope",
}


def derive(platform, entry, http):
    """(treatment | None, basis). Pure apart from `http`, which reads one metadata document.

    `http(url, params)` returns (json | None, reason) - n3_pilot.http's contract."""
    if platform in NON_ARCGIS:
        return "PROVEN", f"{platform} connector: stored point is the publisher's lat/lng or a fenced geocode"
    if platform != "arcgis":
        return None, f"unknown platform {platform!r}"
    url = (entry or {}).get("service_url")
    if not url:
        return None, "no service_url"
    meta, why = http(url, {"f": "json"})
    if not isinstance(meta, dict):
        return None, f"metadata unreadable: {why}"
    if isinstance(meta.get("error"), dict):
        e = meta["error"]
        return None, f"metadata error {e.get('code')} {str(e.get('message'))[:60]}"
    gt = meta.get("geometryType")
    if gt in GEOMETRY_TYPES:
        return "RECOVERY", f"publisher layer geometryType {gt}: the build re-reads it"
    if gt:
        return None, f"unrecognised geometryType {gt!r}"
    if meta.get("type") == "Table":
        return "PROVEN", "publisher layer is a Table (no geometry): stored point is a fenced geocode"
    return None, "metadata names no geometryType and is not a Table"


def classify_unrowed(sql, lit, registry, http, say=print, dry=False):
    """Give every registry source and adapter family with no geo.n5_accepted_source row one.

    Returns {"written": [...], "unresolved": [...], "skipped": reason | None}."""
    out = {"written": [], "unresolved": [], "skipped": None}
    rows = sql("select registry_id from geo.n5_accepted_source;", "accepted rows", read_only=True)
    have = {r["registry_id"] for r in rows}
    # Positive control: production carries 252 rows (2026-11-01). An empty read is a broken read,
    # and treating it as "nothing classified yet" would classify everything at once.
    if not have:
        out["skipped"] = "geo.n5_accepted_source read returned no rows"
        say("classify sources", f"SKIPPED: {out['skipped']}")
        return out
    building = sql("select count(*) n from geo.n5_generation where state = 'BUILDING';",
                   "building", read_only=True)
    if int(building[0]["n"]):
        out["skipped"] = "a generation is BUILDING"
        say("classify sources", f"SKIPPED: {out['skipped']}")
        return out

    todo = [(rid, plat, ent) for rid, (plat, ent) in sorted(registry.items()) if rid not in have]
    todo += [(rid, "adapter", None) for rid in sorted(ADAPTER_FAMILIES) if rid not in have and rid not in registry]
    say("sources with no Map 1 treatment", f"{len(todo)} (of {len(registry) + len(ADAPTER_FAMILIES)})")
    for rid, plat, ent in todo:
        if plat == "adapter":
            treatment, basis = ADAPTER_FAMILIES[rid]
        else:
            treatment, basis = derive(plat, ent, http)
        if treatment is None:
            out["unresolved"].append({"registry_id": rid, "reason": basis})
            say(f"  {rid}", f"UNRESOLVED ({basis}); stays UNCLASSIFIED this generation")
            continue
        say(f"  {rid}", f"{treatment} ({basis})" + (" [dry run]" if dry else ""))
        if not dry:
            sql(f"insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs) "
                f"values ({lit(rid)}, {lit(treatment)}, 0, 0) on conflict (registry_id) do nothing;",
                f"classify {rid}")
        out["written"].append({"registry_id": rid, "treatment": treatment, "basis": basis})
    if out["written"] and not dry:
        got = {r["registry_id"] for r in sql(
            "select registry_id from geo.n5_accepted_source;", "accepted read-back", read_only=True)}
        missing = [w["registry_id"] for w in out["written"] if w["registry_id"] not in got]
        if missing:
            raise SystemExit(f"STOP: classification rows did not persist: {', '.join(missing)}")
    return out
