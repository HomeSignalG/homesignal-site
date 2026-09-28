#!/usr/bin/env python3
"""ONE TIGER/Line ZCTA archive identity — URL, sha256, vintage, feature count.

PARKED as the checksum authority (health-plan Step 4, 2026-09-28). This file does
not download the archive, does not load polygons, does not apply DDL, and does not
activate an N5 generation. Production `geo.zcta_boundary` already carries this pin
(measured 2026-09-28, project qwnnmljucajnexpxdgxr):

    n=33791  distinct source_checksum=1  distinct source_url=1  distinct vintage=1
    source_checksum = e87129634eefe8719ef06ce4cfdf6588520be2e359360e590aaae90e4afb1911
    source_url      = https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/tl_2025_us_zcta520.zip
    source_vintage  = TIGER/Line 2025 (2020 Census ZCTA delineation)

Every acquirer compares against THIS module. A Census republish that keeps the same
filename is a vintage change (Step 5 / Step 6), not a silent load.

Founder lock 2026-09-27: Do not unlist ~1,005 map pages just because they have plants
and no new construction. 'Nothing is being built' is a valid answer. Those pages stay
listed. This was the old Unit 1 idea; it is rejected.

This module does not touch `indexable`, `_nfc`, or Unit 1.

stdlib only. No I/O, no network, no database.
"""

TIGER_URL = ("https://www2.census.gov/geo/tiger/TIGER2025/ZCTA520/"
             "tl_2025_us_zcta520.zip")
TIGER_SHA256 = "e87129634eefe8719ef06ce4cfdf6588520be2e359360e590aaae90e4afb1911"
TIGER_VINTAGE = "TIGER/Line 2025 (2020 Census ZCTA delineation)"
EXPECTED_NATIONAL_FEATURES = 33791


def refuse_unless_pinned(sha):
    """Fail closed unless `sha` is this archive's sha256. One comparison, every caller."""
    got = (sha or "").strip().lower()
    if got != TIGER_SHA256:
        raise SystemExit(
            "STOP: TIGER sha256 %s != authority %s. "
            "Do not adopt a new archive silently. Vintage change is a separate, gated step."
            % (got, TIGER_SHA256)
        )
    return got
