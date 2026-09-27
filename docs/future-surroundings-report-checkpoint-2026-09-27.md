# Future Surroundings Report — checkpoint 2026-09-27

The commercial product is frozen as one product: the HomeSignal Future Surroundings Report. This file records execution order. It does not itself clear a source, and it does not change product or runtime behavior. Source classifications live in the companion evidence files named below.

## Canonical audit

| Item | Record |
|---|---|
| Audit | `docs/corporate-output-source-rights-audit-2026-09-27.md` |
| Blob | `c2cc94524ee2d21af47520254703d4a222344c66` |
| Merged | HomeSignalG/homesignal-site PR #1397, commit `d71f25365f1bf609fad9f751517e1e26d321fcb6` |
| Verdict | **NOT YET** — blocking rights issues must be resolved before a property-scoped paid report can contain the held source families |

The audit remains the governing source matrix. Public availability, government ownership, API accessibility, robots.txt access, and current HomeSignal ingestion are not commercial redistribution permission.

## Product

HomeSignal Future Surroundings Report.

The product question is: what is changing around this property, what is coming next, and what should the customer investigate before acquiring, financing, designing, developing, insuring, or otherwise committing capital?

The first commercial launch stays this single-property report. Scores, outlooks, Quality of Life scoring, predictive `sowhat` prose, and "Effect at this address" stay outside Corporate V1 unless a later record proves and approves them. HomeSignal may identify conditions that warrant investigation. Unsupported engineering, traffic, utility-capacity, insurance-loss, and property-value predictions stay out.

## Step 2 — Corporate data-rights clearance

Step 2 closes when one useful pilot market can be assembled entirely from cleared publisher data and cleared geography, with attribution defined and no HOLD or EXCLUDE leakage.

That condition is met for **New York City V1**. Evidence: `docs/corporate-output-nyc-pilot-assembly-2026-09-27.md`.

| NYC V1 input | Classification | Role |
|---|---|---|
| NYC AddressPoint `uf93-f8nk` | **CLEARED WITH ATTRIBUTION** | Property coordinate when the buyer-supplied address matches a published point |
| `nyc-dob-permit-issuance` (`ipu4-2q9a`) | **CLEARED WITH ATTRIBUTION** | Nearby work, only when publisher lat/lng are present |
| `nyc-dobnow-approved-permits` (`rbx6-tga4`) | **CLEARED WITH ATTRIBUTION** | Nearby work, only when publisher lat/lng are present |
| Distance, pin, "near this property" | HomeSignal arithmetic over those two NYC Open Data coordinates | **APPROVED** inside this allowlist only |

Census geocoder, OpenAddresses, ZCTA-as-proximity, Geoclient, the ArcGIS AddressPoint FeatureServer, Atlas, OSM, Local News, meetings, scores, and every other registry entry stay **HOLD** or **EXCLUDE** and are not in the allowlist.

Step 2 remains **OPEN** for every other market. The overall commercial verdict remains **NOT YET**: Step 3 (unsupported prediction claims) and Step 4 (build the report from this allowlist) have not started. AddressPoint is not loaded. `get-address-report` is not the allowlist.

## Audit §12 status against the first report

The first report is the NYC V1 allowlist. Later evidence files sit beside the audit. The audit blob is unchanged.

1. `"Not for resale"`: resolved as HomeSignal product copy (`docs/corporate-output-not-for-resale-2026-09-27.md`, #1417). The `get-address-report` payload stays out of the allowlist.
2. Per-publisher terms for every source a first report would show: closed for the three NYC V1 inputs (#1410 and the AddressPoint assembly). The other 238 registry entries stay **HOLD**.
3. OpenStreetMap / Atlas: still **HOLD**. Excluded from NYC V1.
4. ODbL and CC BY in one response: still **HOLD**. Excluded from NYC V1.
5. Census geocoder, OpenAddresses, ZCTA proximity: still **HOLD** as those inputs (`docs/corporate-output-property-location-stack-2026-09-27.md`, #1418). NYC V1 does not use them. Property placement is AddressPoint.
6. Local News, meetings, notices: still **HOLD**. Excluded from NYC V1. NWS alert text remains attributed text, not a property-proximity grant.
7. Scores, outlooks, Quality of Life scoring, and predictive prose stay **EXCLUDE**.

Classifications in force are only: **CLEARED FOR PAID REPORT**, **CLEARED WITH ATTRIBUTION**, **DERIVED FACTS ONLY**, **HOLD — TERMS/RIGHTS NOT ESTABLISHED**, **EXCLUDE**. No family is **CLEARED FOR PAID REPORT**.

## Execution order

The next gates after this Step 2 close for NYC V1:

1. Remove unsupported prediction claims from any report that would be sold (Step 3).
2. Build the real Future Surroundings Report that answers what is happening and changing around the property, using only the NYC V1 allowlist (Step 4).
3. Add a durable `report_id` and a reproducible report object tied to the data state that created it.
4. Add a secure share link and print/PDF delivery that use the same rights and attribution rules as the canonical report.
5. Expose one canonical commercial JSON response that enforces the Corporate Output Source Allowlist.
6. Add a minimal brokerage workspace for generating, finding, opening, and sharing reports.
7. Measure a coverage-quality matrix and choose additional pilot markets from cleared, useful coverage.
8. Sign 3–5 paid single-property pilots and instrument actual report use before batch, portfolio, or large-platform scale.

A later listing-level summary has to derive from that same commercial contract. Portfolio and API scale reuse the same geography, provenance, change detection, source-rights, and report logic.

## Hard rule

The audit verdict is **NOT YET**. A paid Future Surroundings Report does not use **HOLD** or **EXCLUDE** sources. A blocker is not routed around with a second implementation. A source is not commercially cleared by assumption. The resolution of a §12 blocker is an evidence record in Git, in or beside the canonical audit.
