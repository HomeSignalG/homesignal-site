# Development source remediation backlog (2026-11-19)

Ledger: `docs/source-ledger/source-integration-ledger.json` (259 rows: 257 registry families plus 2 unregistered sources with data). Snapshot: `docs/source-ledger/audit-snapshot-2026-11-19.csv`, read-only grouped queries, rows md5 `a776c7e25895577585ece226473c7b30`. Rebuild with `python3 scripts/build-source-ledger.py`. **No ingestion, geocoding, source acquisition, spatial-generation rebuild or production refresh is part of this workstream.**

## Reconciled counts (stored development records 2,925,395)
| Class | Sources | Meaning |
|---|---:|---|
| spatially_connected | 220 | the active spatial generation returns the source. **Not** proof of end-to-end report integration: hydration and report eligibility are UNVERIFIED for every real source |
| partially_connected | 14 | served, but with coordinate-less records or rejected keys |
| disconnected | 8 | 73,580 stored records, none served |
| stalled | 2 | upstream stopped updating (documented); not retired |
| unloaded | 14 | no stored development rows (6 also have no serving rows) |
| retired | 1 | documented decision (`retired-sources.json`) |
| fully verified | 0 | no real source has an end-to-end hydration + eligibility demonstration |

The earlier figure of 233 "verified integrations" was spatial service only: it is the 257 registered families minus 24 not served (8 disconnected, 2 stalled, 1 retired, 13 unloaded) = 219 spatially connected + 14 partially connected. The table above also counts the two unregistered sources (tdlr-tabs spatially connected, round-rock-large-development-projects unloaded), so it totals 259. The ledger `counts` are the count of record.

## Priority 1: the eight disconnected families (73,580 stored records)
| Family | Records | Verified cause | Correction | Acceptance |
|---|---:|---|---|---|
| fairfax-recent-building-permits | 45,442 | UNKNOWN (no row in either serving table; rows created 2026-08-15..11-19) | find why the generation never read it (accepted-source class, cutoff, fetch) | active generation returns >0 keys; 0.5-mile report near a known Fairfax permit lists it |
| caltrans-sb1-projects | 15,094 | 4,217 keys `NO_GEOMETRY`; the rest have no geometry row | publish geometry or fix the layer read | served keys > 0; rejected NO_GEOMETRY keys explained |
| desoto-county-permits | 7,279 | UNKNOWN | as Fairfax | as Fairfax |
| fairfax-active-site-construction | 4,403 | UNKNOWN | as Fairfax | as Fairfax |
| maine-dot-public-projects | 307 | 255 keys `NO_GEOMETRY` (the `-lines` family is served) | repair point geometry | served keys > 0 |
| ncdot-stip-projects-points | 516 | 197 keys `NO_GEOMETRY` (the `-lines` family is served) | repair point geometry | served keys > 0 |
| cook-county-il-highway-construction-program | 459 | UNKNOWN | as Fairfax | as Fairfax |
| lake-county-il-construction-program | 80 | UNKNOWN | as Fairfax | as Fairfax |

## Priority 2: partially connected (14)
bellevue-permits (4 coordinate-less), bozeman-building-permits (1,065 of 1,065 coordinate-less), clark-county-active-projects, dallas-specific-use-permits, kcmo-development-cases, kdot-wincpms-project-locations, little-rock-permits (49,444 of 49,515 coordinate-less), massdot-highway-projects, mndot-stip-roadway-projects, new-hanover-county-building-permits, san-marcos-planning-cases (8), scdot-project-viewer-lines, vdot-syip-approved-projects-lines (105), wydot-stip-projects-lines. Cause where `NO_GEOMETRY`: UNKNOWN beyond the rejected-key counts. Correction: geocode at ingest (separate workstream) or repair layer geometry. Acceptance: coordinate-less share < 1% and rejected keys 0, or each remaining case documented.

## Priority 3: coordinate-less development records
Overland Park 535 of 166,997 and the families above. Needs ingest-side geocoding; none is done here. Acceptance: ledger `stored_without_coordinates` per family under 1% of stored.

## Priority 4: stalled and unloaded
- **Stalled (documented):** cabarrus-county-plan-reviews (newest 2025-04-03), spokane-county-building-planning-permits (Avista copy, 2025-05-22). Their stale serving keys now count as not loaded in a report; the correction is a spatial-generation rebuild that drops them, or a retirement decision added to `retired-sources.json`.
- **Unloaded, cause UNKNOWN:** anne-arundel x2, topeka-building-permits, sd-stip-railroad-crossings / safety-points / structures, slc-planning-petitions, san-antonio-prelim-plan-review, shelby-county-building-permits, round-rock-large-development-projects (unregistered). Documented: harris-county-permits / -plats and houston-plat-applications have no modeled ZIP surface; tillamook-county-land-use-cases is new with no rows yet.
- Acceptance: each either stores rows and is served, or gets a cited retirement decision.

## Priority 5: unverified integrations
- **End-to-end hydration and report eligibility** are UNVERIFIED for all real families. Acceptance: a bounded sample per family (not a nationwide scan) shows served key -> hydrated row -> report entry.
- **Transportation capital-program evidence:** 48 families are documented by their registry text; 20 DOT/highway families have no registry evidence and so no longer qualify by publisher identity: aldot-rebuild-alabama-grant-projects, ar-ardot-job-status-lines/-points, ctdot-project-work-areas, fdot-active-construction-projects, hdot-active-design-projects, indot-spms-active-projects, iowa-dot-bid-projects-lines, kdot-wincpms-project-locations, maine-dot-public-projects(-lines), massdot-highway-projects, mdot-sha-project-portal, nvdot-project-boundaries, odot-current-projects(-lines), penndot-transportation-projects, ridot-rhode-restore-projects, txdot-projects-info-all, wvdoh-active-projects. Acceptance: add dated documentation of each dataset's nature to the registry (then regenerate `capital-program-sources.generated.json`), or leave excluded.
- **EPA development activity:** EPA FRS rows are the regulatory plane and are not listed as development activity (tested). Eligible EPA-linked development reaches reports only through development sources. Acceptance: UNVERIFIED until a documented EPA-linked source family is enumerated.
- **Colorado source acquisition** (Boulder County/city planning cases, CDOT program) is owned by the BOLO coverage workstream.

## Referred, not changed here
Relevance classification gaps "construct new 200,000 sq ft warehouse" and "construct new public library" are referred to PR #3048.
