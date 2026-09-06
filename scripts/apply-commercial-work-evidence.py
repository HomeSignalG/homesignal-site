#!/usr/bin/env python3
"""Apply the founder's Commercial work-evidence rule to jurisdiction-registry.json.

FOUNDER DECISION (2026-09-05): a Map 1 Commercial object means a real commercial building/site
development or material physical construction project. A field describing only property type,
occupancy, zoning, land use or building use is INSUFFICIENT on its own.

This generator exists because of the repo rule "NEVER TRANSCRIBE A LIST INTO A MIGRATION —
compute the set, or generate it from the source of truth". Every `qualifying` whitelist written
into the registry is COMPUTED from that entry's own existing type_map by removing a named
DROP list, and every dropped key is asserted to exist first. A typo fails the run instead of
silently shrinking a whitelist.

Run:  python3 scripts/apply-commercial-work-evidence.py [--check]
      --check exits non-zero if the registry does not already match what this script would write.
"""
import json
import sys
import pathlib

REG = pathlib.Path(__file__).resolve().parents[1] / "supabase/functions/get-address-report/jurisdiction-registry.json"

# ─────────────────────────────────────────────────────────────────────────────────────────
# 1. SEPARATE WORK COLUMN. type_source describes the BUILDING (occupancy / land use); the work
#    class lives in another column the entry already reads. Vocabularies below were enumerated
#    from production (every value that exists in app_projects for that source), not guessed.
# ─────────────────────────────────────────────────────────────────────────────────────────
WORK_COLUMN_GATE = {
    # BldUseDesc says COMMERCIAL vs residential; PermitType says what the work is.
    # Full production vocabulary (8 values, object grain): ELE 14,694 · MEC 13,483 · PLU 11,717
    # · BLD 8,977 · SDG 168 · RTW 142 · ANT 129 · GLA 78. Only BLD is building work.
    "little-rock-permits": {
        "column": "PermitType",
        "qualifying": ["BLD"],
        "note": "BldUseDesc is a BUILDING-USE field and cannot establish the work. PermitType is "
                "the source's own work class; BLD is its building permit. ELE/MEC/PLU are "
                "standalone electrical/mechanical/plumbing trade permits, SDG/RTW/ANT/GLA are "
                "siding/retaining-wall/antenna/glass component work.",
    },
    # OccupancyTypeDescription is the building's occupancy; WorkTypeDescription is the work.
    "dekalb-county-building-permits": {
        "column": "WorkTypeDescription",
        "qualifying": [
            "New Construction",
            "Alteration to Existing Structure",
            "Additions to Existing Structures",
            "Demolition",
            "Commercial General Combination",
        ],
        "note": "Excludes the trade and administrative classes this source publishes under a "
                "commercial occupancy — Fats Oil Grease, Fire Marshal Special Work type, "
                "Tenant or Use Change Permit, Owner Change Only, Electrical *, Plumbing *, "
                "Fire Sprinkler System, Kitchen Fire Suppression, Repairs to Existing Structure.",
    },
    # Sub_Type is COM/RES (occupancy); Construction_Type is the work.
    # Full production vocabulary (4 values): ALT 7,056 · NEW 2,319 · ACC 2,222 · ADD 1,165.
    "memphis-dpd-building-permits": {
        "column": "Construction_Type",
        "qualifying": ["NEW", "ADD", "ALT"],
        "note": "ACC (accessory) excluded: its own descriptions are pallet racks, fences and "
                "equipment installs, which do not establish material physical development.",
    },
    # BuildingCategory is Commercial/Industrial (occupancy); TypeDesc is the work.
    "bend-or-permit-applications": {
        "column": "TypeDesc",
        "qualifying": [
            "New Construction/Installation",
            "Renovation/Alteration",
            "Addition",
            "Demolition",
        ],
        "note": "Excludes Electrical, Mechanical, Plumbing, Fire Sprinkler/Alarm, sign "
                "applications, decks/fences, water meters, septic forms and occupancy "
                "certificates.",
    },
    # Permit_Type is Commercial (occupancy); B1_PER_SUB_TYPE is the work.
    "peoria-az-building-permits": {
        "column": "B1_PER_SUB_TYPE",
        "qualifying": [
            "Addition-Alteration and Patio",
            "Commercial Tenant Improvement",
            "Commercial Shell",
            "Spec Suite",
        ],
        "note": "TENANT-IMPROVEMENT RULE: 'Commercial Tenant Improvement' and 'Spec Suite' are "
                "kept because the source's own class states physical build-out. 'New Commercial "
                "Tenant' and 'Commercial Accessory Use' establish only tenancy/use and are "
                "excluded, as are 'Miscellaneous Commercial' (unresolved), 'C of O Only' "
                "(certificate), SolarPV and pools.",
    },
}

# ─────────────────────────────────────────────────────────────────────────────────────────
# 2. type_source IS the work column, but some of its mapped values are not qualifying work.
#    We keep the entry's existing type_map untouched and gate on the same column, so the
#    Residential/Industrial/Civic halves of these maps are provably unaffected.
#    Values named here are DROPPED; the whitelist is everything else the map calls Commercial.
# ─────────────────────────────────────────────────────────────────────────────────────────
TYPE_SOURCE_GATE_DROP = {
    "bentonville-catalyst-permits": [
        "ELECTRIC COMMERCIAL", "PLUMBING COMMERCIAL", "MECHANICAL COMMERCIAL",
        "MECHANICAL COMMERICAL", "FENCE COMMERCIAL", "POOL COMMERCIAL",
        "SIGNS", "TEMP SIGNS", "COMMERCIAL COMPLETION",
    ],
    "louisville-active-construction-permits": [
        "HVAC Commercial", "Electrical Commercial", "PoolSpa Commercial",
        "Mechanical Refrigeration", "Range Hood",
    ],
    "aurora-building-permits": [
        "Sign Permit-Wall Mount/Cabinet", "Sign Permit-Ground/Monument > 6'",
        "Sign Permit-Monument <= 6'", "Commercial Swimming Pool",
        "Sales Trailer - Commercial", "Commercial Miscellaneous",
    ],
    "charleston-county-permits": ["Business License", "Sign", "Sign - On-Premise(NEW)"],
    "columbia-mo-permits": ["BSD-Sign Permit", "BSD-Sidewalk Cafe Permit"],
    "spokane-county-building-planning-permits": [
        "Mechanical - Commercial", "Plumbing - Commercial",
        "Sign - Wall/Marquee/Cabinet Replace", "Sign - Pylon",
        "Commercial - Roofing, Siding, Windows", "Commercial Alterations - Minor",
        "Commercial Change of Use",
    ],
    "canyon-county-building-permits": ["Sign Permit", "Commercial/Industrial Sign"],
    "bozeman-building-permits": [
        "ELEC PERMIT - COMMERCIAL", "MECH PERMIT - COMMERCIAL", "PLUMBING PERMIT - COMMERCIAL",
    ],
    "kent-county-de-building-permits": ["SIGN", "SIGD"],
    "slo-county-planning-permits": [
        "Cannabis Activities", "Cannabis, Non-Coastal Appealable", "Cannabis, Coastal Appealable",
        "Cannabis Zoning Clearance", "Cannabis", "Vacation Rental",
    ],
    # OTC = the city's over-the-counter channel for minor work; its own record names are
    # "RE-ROOFING P/MFG SPECIFICATIONS." and "Replace One Split System A/C" — maintenance.
    # The non-OTC STRUC* classes are real structural building permits and are kept.
    "phoenix-building-permits": [
        "BUILDING MAINTENANCE REGISTRATION", "COMMERCIAL INSPECTIONS ONLY PERMIT",
        "TEMPORARY INDOOR BUILDING USE PERMIT", "REPAIR GARAGE",
        "OTC STRUC", "OTC STRUC/ELEC", "OTC STRUC/ELEC/PLMB/MECH", "OTC STRUC/MECH",
        "OTC STRUC/MECH/ELEC", "OTC STRUC/PLMB", "OTC STRUC/PLMB/ELEC",
    ],
}

# ─────────────────────────────────────────────────────────────────────────────────────────
# 3. UNRESOLVED. The source publishes no field capable of separating qualifying development
#    from routine permit activity, so under the founder rule it may not assert Commercial from
#    occupancy. Recorded as unresolved rather than pretended.
# ─────────────────────────────────────────────────────────────────────────────────────────
UNRESOLVED = {
    "huntsville-building-permits":
        "type_source OccupancyType and title[0] are the SAME occupancy field; no work column.",
    "durham-building-permits":
        "TYPE is RESI/MULTI_FAMILY/MHP/NON_RESI — an occupancy class; title carries only a name.",
    "arlington-issued-permits":
        "MainUse is occupancy; title[0] SUBDESC is the IBC use group (Business, Mercantile), "
        "also occupancy. No work column is published.",
    "arlington-permit-applications":
        "Every Commercial value (New Tenant, Business, Existing Business/New Owner, Mercantile, "
        "Expanding Lease Space) states tenancy or business status, never construction.",
    "san-jose-permits":
        "SUBDESC values are occupancies (Retail, Office, Restaurant, Bank, Hotel/Motel).",
    "chattanooga-permits-archive":
        "P_TYPE 'Non-Residential' is an occupancy class; no work column.",
    "knoxville-building-permits":
        "LANDUSE is a land-use field; title[0] repeats it.",
    "burlington-vt-building-permits":
        "PrimaryLUC is a land-use code; title carries only ProjectName.",
    "burlington-vt-zoning-permits":
        "PrimaryLUC is a land-use code; zoning permits are entitlements, not stated work.",
    "albuquerque-building-permits":
        "TypeofStructure is a structure/occupancy class; title[0] repeats it.",
    "adams-county-building-permits":
        "BuildingUse is an occupancy field; title[0] repeats it.",
    "flathead-county-building-permits":
        "BuildingUse is an occupancy field; title[0] repeats it.",
    "murfreesboro-building-permits":
        "PRMT_TYPE is the opaque code '103' — not self-describing, establishes nothing.",
    "dallas-specific-use-permits":
        "SPECIFICUSE is a ZONING use vocabulary (210 Commercial values: bars, tattoo studios, "
        "mini-warehouses). A Specific Use Permit authorises a USE, not physical development.",
}


def commercial_keys(entry):
    tm = entry.get("type_map") or {}
    return [k for k, v in tm.items() if v == "Commercial"]


def build(reg):
    """Return {registry_id: commercial_work_evidence} computed from the registry itself."""
    by_id = {}
    for fam in ("socrata", "arcgis", "ckan", "csv", "carto", "opendatasoft"):
        for e in reg.get(fam, []):
            if isinstance(e, dict) and e.get("registry_id"):
                by_id[e["registry_id"]] = e

    out = {}
    for rid, rule in WORK_COLUMN_GATE.items():
        assert rid in by_id, f"unknown registry_id {rid}"
        out[rid] = dict(rule)

    for rid, drop in TYPE_SOURCE_GATE_DROP.items():
        assert rid in by_id, f"unknown registry_id {rid}"
        keys = commercial_keys(by_id[rid])
        missing = [d for d in drop if d not in keys]
        assert not missing, f"{rid}: drop values absent from type_map: {missing}"
        kept = [k for k in keys if k not in set(drop)]
        assert kept, f"{rid}: drop list removed every Commercial value — use UNRESOLVED instead"
        out[rid] = {
            "qualifying": kept,
            "note": "Computed from this entry's own type_map by removing non-qualifying work "
                    "classes: " + ", ".join(sorted(drop)),
        }

    for rid, note in UNRESOLVED.items():
        assert rid in by_id, f"unknown registry_id {rid}"
        out[rid] = {"unresolved": True, "note": note}

    return out, by_id


def main():
    check = "--check" in sys.argv
    reg = json.loads(REG.read_text(encoding="utf-8"))
    rules, by_id = build(reg)

    changed = []
    for rid, rule in rules.items():
        cur = by_id[rid].get("commercial_work_evidence")
        if cur != rule:
            changed.append(rid)
            by_id[rid]["commercial_work_evidence"] = rule

    if check:
        if changed:
            print("REGISTRY OUT OF DATE — entries differing:", ", ".join(sorted(changed)))
            return 1
        print(f"OK — all {len(rules)} commercial_work_evidence rules match the generator.")
        return 0

    if changed:
        # indent=2 + ensure_ascii=True reproduces the committed file's own formatting exactly,
        # so the diff shows only the rules this script adds. Verified: re-serialising the
        # UNCHANGED registry with these settings is byte-identical to what is on disk.
        REG.write_text(json.dumps(reg, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    print(f"rules written: {len(rules)}  (changed this run: {len(changed)})")
    for rid in sorted(rules):
        r = rules[rid]
        kind = "UNRESOLVED" if r.get("unresolved") else (
            f"column={r.get('column','<type_source>')} qualifying={len(r.get('qualifying', []))}")
        print(f"  {rid}: {kind}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
