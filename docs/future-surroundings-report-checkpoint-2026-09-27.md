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
| `nyc-dobnow-job-filings` (`w9ak-ipjd`), added 2026-09-28 | **CLEARED WITH ATTRIBUTION** | Work filed but not yet permitted, only when publisher lat/lng are present (`docs/corporate-output-nyc-dobnow-job-filings-2026-09-28.md`) |
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
| 5 `report_id` tied to data state | **Done** (SHA-256 over the object, minus `report_id` and `generated_at`). Not "durable": it is not unique per issuance, is not reproducible by re-running the address later, and is not a signature — see `docs/corporate-output-report-id-guarantee-2026-09-28.md` |
| 6 Share link and print/PDF | **Done** (query rebuild + browser print) |
| 7 Canonical commercial JSON | **Done** (download the assembled object) |
| 8 Minimal workspace | **Done** (session list of recent reports) |

The overall commercial verdict remains **NOT YET**: the report is not priced or sold.

## Steps 9–13 — coverage, use, listing, portfolio, API

Evidence: `docs/corporate-output-coverage-matrix-2026-09-27.md` and `docs/corporate-output-fsr-scale-2026-09-27.md`.

| Step | Status |
|---|---|
| 9 Coverage-quality matrix and additional markets | **Done for measurement**. NYC V1 is the only assemblable market. Seattle MAF `ctqe-m6xd` is a federated ArcGIS pointer and stays **HOLD**. Cambridge, MA was worked on 2026-09-28 and stays **HOLD** on an express commercial-use prohibition. Coverage inside NYC was deepened with `w9ak-ipjd`. |
| 10 Sign 3–5 paid pilots and instrument use | **Done for instrumentation**. `signed_paid_pilots` is **0**. Customers were not invented. |
| 11 Listing-level summary | **Done**. Derived only from an NYC V1 report object. |
| 12 Portfolio | **Done**. Browser store of NYC V1 reports. |
| 13 API / large-platform scale | **Done**. `get-future-surroundings-report` fetches only `data.cityofnewyork.us` views `uf93-f8nk`, `ipu4-2q9a`, `rbx6-tga4`, `w9ak-ipjd`. |

Steps 14 and 15 remain standing rules.

### Allowlisted is not the same as contributing

Evidence: `docs/corporate-output-nyc-bis-window-defect-2026-09-28.md`.

`ipu4-2q9a` was cleared, named in `data_state`, credited in `attribution`, and listing zero
rows. Its SODA window was unordered, so it returned the publisher's oldest rows — 1990 to
2022 for the ZIP group around 1 Centre Street — and the report's 365-day filter dropped all
200 of them. 161 permits existed inside the window in those ZIPs; the report showed none.

The window is now one named constant shared by the row filter and every record query, and
all three record views are floored and ordered newest first. Pinned by
`test/nyc-v1-report.test.mjs` 6a–6p.

**That fix stopped the silence but not the overstatement, and the page was corrected again
the same day.** Evidence: the `## The page was still claiming a window it did not have`
section of PR #1424. Disclosing `row_cap_per_dataset` and calling `nearby_matched` a floor
was not honest enough: the page still told the buyer it listed records "dated in the last
365 days" while the real coverage at 1 Centre Street was 53 days, with 1,233 in-radius
records never read. All three record queries are now scoped on the publisher's own
coordinates rather than on a ZIP field, the row cap is sized above the densest window
measured live, and the report carries `data_state.coverage`, `coverage_complete`, and
`silent_datasets` so the page states the reach it achieved instead of the window it asked
for. Pinned by `test/nyc-v1-report.test.mjs` §7.

No classification moved.

No classification moved. Checking that each cleared dataset actually reaches the artifact is
part of Step 14, not a separate step: a report that credits a source it never read is not an
artifact built from the allowlist.

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

Steps 2–13 are closed for the NYC V1 allowlist as recorded above. Remaining gates:

1. Do not sell a report that uses **HOLD** or **EXCLUDE** inputs (Step 14 — standing rule).
2. Keep the audit verdict **NOT YET** until a customer is actually sold an allowlisted artifact (Step 15 — standing rule).
3. Signed paid pilots remain **0**. A later sale, not this file, can move that count.
4. Additional markets remain **OPEN**. A later evidence file has to clear both publisher data and geography before a second market is assemblable.

## What is between here and a launch

No plan step is outstanding. What remains is not engineering work that was skipped — it is
the set of deliberate acts that turn a built artifact into a sold one. Measured against the
tree on 2026-09-28:

| Gate | State | Whose act |
|---|---|---|
| Merge to `main` | **Done.** PR #1424 merged at `478e002`; `pages / deploy` green on `main`. | — |
| Deploy the page | **Done.** `https://homesignal.net/future-surroundings-report.html` returns 200, and `lib/nyc-v1-report.js`, `lib/nyc-v1-soda.js`, and `lib/fsr-scale.js` are byte-identical to the repo. The page reads the City's views from the browser, so the report works without the edge function. *(Annotation, 2026-10-01, Development Activity Order H first step: the page is retired from the production artifact, so after that change deploys the URL is a plain 404 and the page is not served. It stays in the repository, untouched (ruling R6). The text above is the state on 2026-09-28. `docs/order-h-retire-legacy-generator-2026-10-01.md`.)* | — |
| Deploy the edge function | **Not deployed.** `POST /functions/v1/get-future-surroundings-report` returns `404 NOT_FOUND`. `.github/workflows/deploy-edge-functions.yml` is `workflow_dispatch` only and has never been dispatched for this slug, so the JSON API of Step 13 does not exist in production. It needs `gh workflow run deploy-edge-functions.yml -f function=get-future-surroundings-report`. *(Annotation, 2026-10-01: **do not dispatch that for this function.** Its handler answers CORS `*` and has no authentication check of its own (`supabase/functions/get-future-surroundings-report/index.ts`), and the only protection is `verify_jwt = true`, which the public anon key passes because it is a validly signed token (measured for the sibling national function, `docs/development-activity-report-engine-2026-09-30.md` §11). A deployed copy would be an open proxy for anyone holding the anon key, and it would be a second report generator beside the one canonical path (Hard Rule 24). Closing that, by an admin gate on the function or by the deploy workflow refusing the slug, touches a function ruling R6 says to leave alone and a workflow, so it is a separate decision. That the slug is still not deployed is taken from the 2026-10-01 audit's `list_edge_functions` read and was not re-read when this note was written.)* | Founder |
| A way in | **Not done, and a decision rather than an oversight.** The page is published, but no page links to it and it is not in `sitemap.xml`. A buyer cannot find it without the URL. | Founder |
| A price | There is none. No Stripe, no checkout, no payment path anywhere in the tree. Nothing can be charged for. | Founder |
| A customer | `signed_paid_pilots` is **0** and the count is shipped on the page. Step 15 holds the verdict at **NOT YET** until one real sale happens. | Founder |

Deploying the page did not move the verdict and was never going to. A published artifact
nobody can find, at no price, is not a sale. The last row is the one the audit gates on:
the verdict moves when a customer is sold an artifact built only from the allowlist, and
not before. Nothing in this repository may raise the pilot count or change the verdict in
anticipation of that.

Two recorded items are open and unauthorised, and neither blocks a launch of this report:
the `get-address-report` recency over-inclusion filed in `QUEUE.md`, which is a consumer
surface outside the sold path, and whether to sort keys before hashing `report_id`
(`docs/corporate-output-report-id-guarantee-2026-09-28.md`).

Listing, portfolio, and API reuse the same NYC V1 geography, provenance, rights, and report logic. They do not call `get-address-report`.

## Hard rule

The audit verdict is **NOT YET**. A paid Future Surroundings Report does not use **HOLD** or **EXCLUDE** sources. A blocker is not routed around with a second implementation. A source is not commercially cleared by assumption. The resolution of a §12 blocker is an evidence record in Git, in or beside the canonical audit.
