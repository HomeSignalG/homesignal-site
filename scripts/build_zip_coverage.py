#!/usr/bin/env python3
"""Build the ZIP COVERAGE MODEL: an INTERNAL record and the PUBLIC file the browser receives.

  docs/maps-coverage/fix4/zip-coverage-internal.json   the full record, with provenance and review
                                                       notes. Auditable, never deployed (docs/ is
                                                       outside the Pages artifact).
  lib/zip-coverage.json                                the PUBLIC model: only what the browser needs
                                                       to choose a page (zip_code, zip_type,
                                                       map_coverage, page_mode) plus the approved copy.
                                                       Derived from the internal record; carries no
                                                       provenance, no notes and no vendor detail.

WHAT IT RECORDS. For a ZIP whose page cannot be a normal "standard" page, the model says what
we know and where we learned it: its postal status and the SOURCE of that status, its ZIP type,
whether the Census drew a ZCTA for it in 2010 and 2020, what map coverage it has, and which page
the visitor gets. A ZIP with no entry here is `standard` (a ZCTA boundary, the normal page).

THE DISTINCTION THIS FILE EXISTS TO KEEP (founder, 2026-10-03):
  * a ZIP with no Census ZCTA is NOT proven inactive - Census draws no area for PO-box and
    single-organization ZIPs that receive mail every day;
  * the `decommissioned` flag came from a THIRD-PARTY dataset (zipcodes 3.0.0, data from
    unitedstateszipcodes.org). It is not a USPS determination.
So every entry written from that flag is `postal_status = unverified`,
`postal_status_source = third_party_flag`, and nothing here ever sets `active` or `retired`.
`retired` is accepted ONLY with `postal_status_source = usps_verified` (see validate()).

COMPUTED, NEVER TYPED (CLAUDE.md claims rules 7-9). The 47 records come from
docs/maps-coverage/fix4/no-boundary-zip-classification.csv, class DECOMMISSIONED_IN_DATASET;
page_mode follows zipcodes_type: PO BOX and UNIQUE (single-organization) -> specialized_zip,
anything else -> verification_pending. `--check` re-derives the file and fails on any difference,
so a hand edit cannot survive CI.

Usage:  python3 scripts/build_zip_coverage.py            # write both files
        python3 scripts/build_zip_coverage.py --check    # exit 1 if either file differs
"""
import csv
import hashlib
import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
CSV_REL = "docs/maps-coverage/fix4/no-boundary-zip-classification.csv"
OUT_REL = "lib/zip-coverage.json"                       # PUBLIC, shipped to browsers
INTERNAL_REL = "docs/maps-coverage/fix4/zip-coverage-internal.json"   # INTERNAL, never deployed
SOURCE_CLASS = "DECOMMISSIONED_IN_DATASET"

POSTAL_STATUS = ("unverified", "active", "retired")
POSTAL_SOURCE = ("third_party_flag", "usps_verified", "manual_review")
MAP_COVERAGE = ("zcta", "address_only", "none")
PAGE_MODE = ("standard", "specialized_zip", "verification_pending", "retired")
# The ONLY per-ZIP fields the browser receives, and the only top-level keys of the public file.
PUBLIC_FIELDS = ("zip_code", "zip_type", "map_coverage", "page_mode")
PUBLIC_TOP_KEYS = ("_doc", "copy", "zips")
# Text that must never appear anywhere in the public file. CI fails on any of it (validate_public).
FORBIDDEN_PUBLIC = re.compile(
    r"third[_ -]?party|decommission|verification_notes|postal_status|source_md5|source_class|"
    r"usps_verified|manual_review|unitedstateszipcodes|zipcodes[ _-]?3|vendor|"
    r"zcta_20(10|20)_status", re.I)
ZIP_TYPE = {"STANDARD": "standard", "UNIQUE": "unique", "PO BOX": "po_box", "MILITARY": "military"}

# The approved public copy. Founder-written; pinned WHOLE by test/zip-coverage.test.mjs.
# {zip} is the only placeholder. `retired` is not founder copy: it is the neutral state a
# USPS-verified retired ZIP would get, and no ZIP uses it today.
COPY = {
    "specialized_zip": {
        "title": "HomeSignal coverage for ZIP {zip}",
        "body": [
            "This ZIP code does not have a Census-defined geographic area for mapping. Some ZIP codes are used for PO Boxes, a single organization, a government office, campus, or another specialized mail-delivery purpose.",
            "HomeSignal cannot show a ZIP-wide map or ZIP-wide development records for this location.",
        ],
        "primary_cta": "Search an address near this ZIP",
        "secondary_cta": "Search nearby ZIPs",
        "page_title": "{zip} ZIP Code Information | HomeSignal",
        "meta_description": "Information for ZIP code {zip}. This is a specialized mailing ZIP without a Census-defined map area. Search an address to see development activity nearby.",
    },
    "verification_pending": {
        "title": "ZIP coverage is being verified",
        "body": [
            "This ZIP code does not currently have a Census-defined geographic area for mapping. HomeSignal is verifying its current postal and geographic coverage.",
            "HomeSignal cannot yet show a ZIP-wide map or ZIP-wide development records for this location. Enter a street address to see projects near a specific location.",
        ],
        "primary_cta": "Search an address",
        "secondary_cta": "Search nearby ZIPs",
        "page_title": "{zip} ZIP Code Coverage | HomeSignal",
        "meta_description": "Coverage information for ZIP code {zip}. This ZIP does not currently have a Census-defined map area. Search an address to see development activity nearby.",
    },
    "retired": {
        "title": "This ZIP code is no longer in use",
        "body": [
            "The U.S. Postal Service has retired ZIP code {zip}.",
            "Enter a street address to see development activity near a specific location.",
        ],
        "primary_cta": "Search an address",
        "secondary_cta": "Search nearby ZIPs",
        "page_title": "ZIP {zip} is not available | HomeSignal",
        "meta_description": "ZIP code {zip} is no longer in use. Search an address to see development activity nearby.",
    },
}


def _census(flag):
    return "present" if flag == "true" else "absent"


def entry_from_row(r):
    """One coverage record from one classification row. The ONLY place page_mode is decided."""
    ztype = ZIP_TYPE.get(r["zipcodes_type"], "other")
    mode = "specialized_zip" if ztype in ("po_box", "unique") else "verification_pending"
    return {
        "zip_code": r["zip"],
        "city": r["zipcodes_city"],
        "state": r["state"],
        "county": r["county"],
        "postal_status": "unverified",
        "postal_status_source": "third_party_flag",
        "postal_status_verified_at": None,
        "zip_type": ztype,
        "zcta_2010_status": _census(r["census_zcta_2010"]),
        "zcta_2020_status": _census(r["census_zcta_2020"]),
        "map_coverage": "address_only",
        "page_mode": mode,
        "verification_notes": (
            f"Flagged decommissioned by the pinned ZIP dataset (zipcodes 3.0.0, data from "
            f"unitedstateszipcodes.org); NOT confirmed with USPS. Dataset type {r['zipcodes_type']}; "
            f"Census ZCTA 2010 {_census(r['census_zcta_2010'])}, 2020 {_census(r['census_zcta_2020'])}. "
            f"Source: {CSV_REL}."
        ),
    }


def validate(doc):
    """The INTERNAL record's invariants. Raises ValueError naming the offence."""
    zips = doc["zips"]
    for z, e in zips.items():
        if not re.fullmatch(r"\d{5}", z) or e.get("zip_code") != z:
            raise ValueError(f"{z}: key and zip_code must be the same 5 digits")
        for field, allowed in (("postal_status", POSTAL_STATUS), ("postal_status_source", POSTAL_SOURCE),
                               ("map_coverage", MAP_COVERAGE), ("page_mode", PAGE_MODE)):
            if e.get(field) not in allowed:
                raise ValueError(f"{z}: {field}={e.get(field)!r} is not one of {allowed}")
        # THE RULE THIS FILE EXISTS FOR: a third-party flag can never retire or activate a ZIP.
        if e["postal_status"] in ("active", "retired") and e["postal_status_source"] == "third_party_flag":
            raise ValueError(f"{z}: postal_status {e['postal_status']} cannot rest on a third-party flag")
        if e["postal_status"] == "retired" and e["postal_status_source"] != "usps_verified":
            raise ValueError(f"{z}: retired requires postal_status_source=usps_verified")
        if e["postal_status"] == "retired" and not e.get("postal_status_verified_at"):
            raise ValueError(f"{z}: retired requires postal_status_verified_at")
        if (e["postal_status"] == "retired") != (e["page_mode"] == "retired"):
            raise ValueError(f"{z}: page_mode retired and postal_status retired must go together")
        if e["page_mode"] == "standard" and e["map_coverage"] != "zcta":
            raise ValueError(f"{z}: a standard page needs map_coverage zcta")
    return True


def validate_public(doc):
    """The PUBLIC file's invariants: exactly the allowed keys, allowed vocabularies, and none of the
    forbidden provenance text anywhere in it. Raises ValueError naming the offence."""
    if sorted(doc) != sorted(PUBLIC_TOP_KEYS):
        raise ValueError(f"public model keys must be exactly {PUBLIC_TOP_KEYS}, got {sorted(doc)}")
    for z, e in doc["zips"].items():
        if not re.fullmatch(r"\d{5}", z) or e.get("zip_code") != z:
            raise ValueError(f"{z}: key and zip_code must be the same 5 digits")
        if sorted(e) != sorted(PUBLIC_FIELDS):
            raise ValueError(f"{z}: public fields must be exactly {PUBLIC_FIELDS}, got {sorted(e)}")
        for field, allowed in (("map_coverage", MAP_COVERAGE), ("page_mode", PAGE_MODE),
                               ("zip_type", tuple(ZIP_TYPE.values()) + ("other",))):
            if e[field] not in allowed:
                raise ValueError(f"{z}: {field}={e[field]!r} is not one of {allowed}")
        if e["page_mode"] == "standard" and e["map_coverage"] != "zcta":
            raise ValueError(f"{z}: a standard page needs map_coverage zcta")
    m = FORBIDDEN_PUBLIC.search(json.dumps(doc, ensure_ascii=False))
    if m:
        raise ValueError(f"the public model carries forbidden internal text: {m.group(0)!r}")
    return True


def public_from_internal(internal):
    """The browser's file, DERIVED from the validated internal record (never edited by hand)."""
    doc = {
        "_doc": ("ZIP coverage model read by shell.js and scripts/gen_zip_pages.py. Generated by "
                 "scripts/build_zip_coverage.py; do not hand-edit. A ZIP with no entry is a standard page."),
        "copy": internal["copy"],
        "zips": {z: {k: e[k] for k in PUBLIC_FIELDS} for z, e in internal["zips"].items()},
    }
    validate_public(doc)
    return doc


def build():
    with open(os.path.join(ROOT, CSV_REL), "rb") as f:
        raw = f.read()
    rows = [r for r in csv.DictReader(raw.decode("utf-8").splitlines()) if r["class"] == SOURCE_CLASS]
    zips = {r["zip"]: entry_from_row(r) for r in sorted(rows, key=lambda r: r["zip"])}
    doc = {
        "_doc": ("INTERNAL ZIP coverage record (founder, 2026-10-03). Never deployed: docs/ is outside the "
                 "Pages artifact. Computed by scripts/build_zip_coverage.py from the Fix 4 classification "
                 "record; do not hand-edit. The browser's file, lib/zip-coverage.json, is derived from this "
                 "one and carries none of the provenance below. A third-party 'decommissioned' flag never "
                 "makes a ZIP retired: retired needs postal_status_source usps_verified."),
        "decided": "2026-10-03",
        "source": CSV_REL,
        "source_class": SOURCE_CLASS,
        "source_md5": hashlib.md5(raw).hexdigest(),
        "copy": COPY,
        "zips": zips,
    }
    validate(doc)
    return doc


def render(doc):
    return json.dumps(doc, indent=1, ensure_ascii=False, sort_keys=False) + "\n"


def main(argv):
    out = os.path.join(ROOT, OUT_REL)
    internal_path = os.path.join(ROOT, INTERNAL_REL)
    internal = build()
    texts = {internal_path: render(internal), out: render(public_from_internal(internal))}
    if "--check" in argv:
        bad = False
        for path, text in texts.items():
            have = open(path, encoding="utf-8").read() if os.path.exists(path) else None
            if have != text:
                print(f"DRIFT: {os.path.relpath(path, ROOT)} does not equal what {CSV_REL} derives; "
                      f"run scripts/build_zip_coverage.py")
                bad = True
        if bad:
            return 1
        print(f"OK: {OUT_REL} and {INTERNAL_REL} equal their derivation ({len(internal['zips'])} ZIPs)")
        return 0
    for path, text in texts.items():
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)
    modes = {}
    for e in internal["zips"].values():
        modes[e["page_mode"]] = modes.get(e["page_mode"], 0) + 1
    print(f"wrote {OUT_REL} (public) and {INTERNAL_REL} (internal): {len(internal['zips'])} ZIPs {modes}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
