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

Step 2 remains **OPEN** for every other market. AddressPoint is fetched live from the Socrata view for this report. It is not loaded into `national_address_points`. `get-address-report` is not the allowlist.

## Step 3 — Unsupported prediction claims

Step 3 closes when unsupported prediction claims cannot enter a report that would be sold.

That condition is met. Evidence: `docs/corporate-output-unsupported-predictions-2026-09-27.md`.

Scores, outlooks, Quality of Life scoring, `HS.projectImpact`, stored `sowhat`, "Effect at this address", and engineering / traffic / utility / insurance-loss / property-value forecasts are **EXCLUDE** from any sold Future Surroundings Report, including NYC V1. They stay on the consumer site. `reports.html` still generates nothing.

## Step 4–8 — NYC V1 report

The report exists at `future-surroundings-report.html`. Evidence: `docs/corporate-output-nyc-v1-report-2026-09-27.md`.

It answers what Department of Buildings activity is on the record around a matching AddressPoint. It does not predict effects. It does not call `get-address-report`.

| Step | Status |
|---|---|
| 4 Build the report from the NYC V1 allowlist | **Done** |
| 5 Durable `report_id` tied to data state | **Done** (SHA-256 of the canonical object) |
| 6 Share link and print/PDF | **Done** (query rebuild + browser print) |
| 7 Canonical commercial JSON | **Done** (download the assembled object) |
| 8 Minimal workspace | **Done** (session list of recent reports) |

The overall commercial verdict remains **NOT YET**: the report is not priced or sold. Step 9 (additional markets) and Step 10 (paid pilots) have not started.

## Audit §12 status against the first report

The first report is the NYC V1 allowlist. Later evidence files sit beside the audit. The audit blob is unchanged.

1. `"Not for resale"`: resolved as HomeSignal product copy (`docs/corporate-output-not-for-resale-2026-09-27.md`, #1417). The `get-address-report` payload stays out of the allowlist.
2. Per-publisher terms for every source a first report would show: closed for the three NYC V1 inputs (#1410 and the AddressPoint assembly). The other 238 registry entries stay **HOLD**.
3. OpenStreetMap / Atlas: still **HOLD**. Excluded from NYC V1.
4. ODbL and CC BY in one response: still **HOLD**. Excluded from NYC V1.
5. Census geocoder, OpenAddresses, ZCTA proximity: still **HOLD** as those inputs (`docs/corporate-output-property-location-stack-2026-09-27.md`, #1418). NYC V1 does not use them. Property placement is AddressPoint.
6. Local News, meetings, notices: still **HOLD**. Excluded from NYC V1. NWS alert text remains attributed text, not a property-proximity grant.
7. Scores, outlooks, Quality of Life scoring, and predictive prose: **EXCLUDE** from any sold report (`docs/corporate-output-unsupported-predictions-2026-09-27.md`). They stay on the consumer site. `future-surroundings-report.html` does not emit them.

Classifications in force are only: **CLEARED FOR PAID REPORT**, **CLEARED WITH ATTRIBUTION**, **DERIVED FACTS ONLY**, **HOLD — TERMS/RIGHTS NOT ESTABLISHED**, **EXCLUDE**. No family is **CLEARED FOR PAID REPORT**.

## Execution order

The next gates after this NYC V1 report:

1. Measure a coverage-quality matrix and choose additional pilot markets from cleared, useful coverage (Step 9). NYC V1 coverage is already counted in the assembly file.
2. Sign 3–5 paid single-property pilots and instrument actual report use before batch, portfolio, or large-platform scale (Step 10).
3. Listing-level summary from the same contract (Step 11).
4. Portfolio reuse of the same geography, provenance, rights, and report logic (Step 12).
5. API / large-platform scale (Step 13).

A later listing-level summary has to derive from that same commercial contract. Portfolio and API scale reuse the same geography, provenance, change detection, source-rights, and report logic.

## Hard rule

The audit verdict is **NOT YET**. A paid Future Surroundings Report does not use **HOLD** or **EXCLUDE** sources. A blocker is not routed around with a second implementation. A source is not commercially cleared by assumption. The resolution of a §12 blocker is an evidence record in Git, in or beside the canonical audit.
