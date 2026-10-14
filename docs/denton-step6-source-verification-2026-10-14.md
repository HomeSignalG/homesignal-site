# Denton Step 6: source verification (read-only), 2026-10-14

Branch `claude/step6-sources`. Read-only probes only: GET requests, honest User-Agent, 1.5 s delay, robots.txt read first,
no login, no CAPTCHA, no purchase or ingest of third-party data. Nothing merged; no production SQL or data touched.
Probe code: `scripts/denton-source-probe.mjs`, run through the `sources*` tasks of `.github/workflows/denton-launch-audit.yml`
(a new workflow file cannot be dispatched from a branch, so the existing one was extended).

Run receipts: `38592730673` (layer inventory, field/ID/date census, geometry bbox), `38594777168` (verbatim Status / Project_Type /
Project_LandUse vocabularies), `38595451531` (raw query responses used for the fixture). Counts below come from those logs;
"n365" is the probe's count of rows with that date inside the 365 days before the run.

## Why this exists

`denton-county-dev-permits` (Denton County ArcGIS `DEV_Permits`) is frozen at 2023-06-09 (re-confirmed in this pass), so Denton
County has no current development record from the county.

## Source table

| SOURCE | EXISTING/NEW | LATEST VERIFIED RECORD | 2025-2026 COUNT | ZIP COVERAGE | INGEST STATUS | BLOCKER |
|---|---|---|---|---|---|---|
| City of Denton `Planning/Projects` MapServer layer 15 "Approved/Closed Recently" (decided applications) | NEW (`denton-city-projects-decided`) | Status_Date 2026-10-13 | 180 rows, all with Status_Date 2026-04-21..2026-10-13 | Spatial 3 mi around each ZIP centroid; geometry bbox lat 33.12-33.35 / lng -97.29..-97.04. Per-ZIP page count NOT measured. | Registry entry + offline test on branch; not deployed, not run live | Rights list, see below |
| Layer 9 Subdivision (plats under review) | NEW (`denton-city-projects-subdivision`) | see run 38592730673 census | recency_days 1095 | as above | as above | as above |
| Layer 12 Zoning | NEW (`denton-city-projects-zoning`) | Status_Date 2026-09-11 | n365 (Status_Date) = 6 | as above | as above | as above |
| Layer 8 Specific Use Permit | NEW (`denton-city-projects-specific-use`) | Status_Date 2026-10-08 | n365 = 7 | as above | as above | as above |
| Layer 5 Planned Development | NEW (`denton-city-projects-planned-development`) | Status_Date 2026-09-17 | n365 = 2 | as above | as above | as above |
| Layer 13 Zoning Compliance Plan (site plans) | NEW (`denton-city-projects-site-plan`) | Status_Date 2026-10-13 | n365 = 7 | as above | as above | as above |
| Layer 0 Annexation | NEW (`denton-city-projects-annexation`) | Status_Date 2026-09-01 | n365 = 4 | as above | as above | as above |
| Layers 14 "Other", 6 "Pre-Application", 11 "Variance" | NOT WIRED | 14: 2026-10-12; 6: 2026-10-02; 11: 2026-06-11 | 14: 22; 6: 73; 11: 1 (Status_Date n365) | n/a | not wired (pre-application and "Other" are not development filings; variance is one row) | decision, not a blocker |
| City of Denton `Planning/DevelopmentProjects` MapServer (older sibling) | NOT USED | Site Plans, Plats, Approved/Denied (Past 90 Days) frozen at 2023-06 | 0 current | n/a | rejected: stale | stale |
| City of Denton hosted permit views (AGO) | NOT USED | static snapshots, newest ~2026-05-29 | n/a | n/a | rejected: not a live feed | stale snapshot |
| Frisco `frisco-active-building-permits` | EXISTING | 2026-10-13 (healthy) | see run log (Issued_Date strings M/D/YYYY, e.g. 04/06/2026 sample) | Collin + Denton Frisco ZIPs (75034, 75035, 75036, 75033, 75056, ...) | live in production per CLAUDE.md; health re-confirmed | none |
| Denton County `denton-county-dev-permits` | EXISTING | 2023-06-09 | 0 | Denton County | frozen | publisher stopped updating; needs county export |
| Denton County Civic Access / EnerGov (`dentoncountytx-energovweb.tylerhost.net/apps/SelfService`) | NOT INGESTED | n/a | n/a | Denton County | not ingestable | Publisher is Denton County (Tyler EnerGov). HTTP 200, JS single-page app with login/registration, no documented export or API found, `mentions_open_data:false`. robots.txt on the tenant returns HTTP 404. No auth bypass attempted. |
| City of Denton eTRAKiT | NOT INGESTED | n/a | n/a | City of Denton | not ingestable | HTTP 504 on probe; no export found |
| cityofdenton.com `/241`, `/1072` pages | POINTER ONLY | n/a | n/a | n/a | n/a | HTTP 403 to automated clients including robots.txt; not evaded. The backing layer was found through public ArcGIS Online web-map JSON (items d0480d15098a4b49837a5bab66338b41, dd40833bb0c3444f95a1b12fe84b9644, owner *@cityofdenton.com_dentontxgis). |
| denton.myopentexas.org/development | CROSS-CHECK ONLY | not ingested | n/a | n/a | n/a | third-party aggregator; not ingested |
| physical-layer.com/permits/texas/denton-county | POINTER ONLY | not ingested | n/a | n/a | n/a | HTTP 403; third party, never ingested |
| Pilot Point, Woodinville | REJECTED | n/a | n/a | n/a | n/a | web-search pointers resolved to the wrong organisation (Town of Pilot Point; Woodinville WA). Caught by reading `sharing/rest/portals/<orgId>` before attribution. |

## What was implemented (config only, no connector change)

Seven additive `arcgis` entries in `supabase/functions/get-address-report/jurisdiction-registry.json`, 0 deletions:
`denton-city-projects-{decided,subdivision,zoning,specific-use,planned-development,site-plan,annexation}`.

- Backing service: `https://maps.cityofdenton.com/server/rest/services/Planning/Projects/MapServer/<layer>`.
- `coverage` is `TX / Denton` only. Geometry is parcel polygons; the connector derives the centroid.
- Full verbatim Status vocabularies enumerated (run 38594777168) and bucketed; `FILED` and the APPROVED family are approved,
  `CLOSED` and `TRANSFERRED` are excluded, `DENIED` and `WITHDRAWN` use the decision buckets, `INACTIVE` is excluded.
- Layer 15 holds several project types, so `include_types` whitelists plats, zoning, SUP, PD, ZCP, site plans and annexations.
- `use_type` is the constant `Development`: `Project_LandUse` is empty on 180/180 decided rows.
- `out_fields` never requests applicant or contact columns (`Applicant_Name`, `Project_Manager`, `Contact_*`).
- `record_url` is the city's Active Projects map (dataset precision); the layer has no per-record URL.
- Fixture: real features captured in run 38595451531 (`fixtures/denton/city-planning-projects-sample.json`), including the
  duplicate OBJECTIDs 126 and 132 for FP26-0014 that the engine's exact-identity dedupe must handle.
- Test: `test/denton-city-projects.test.mjs`, 138 checks, 0 failures; 7 deliberate mutations all detected.
- `lib/generated/county-sources.json` regenerated (`node scripts/gen-county-sources.mjs`), as the repo's own check requires.

## Full unit suite status (honest)

`node scripts/run-unit-tests.mjs` exits 1 for two reasons, neither is a defect in the Denton work:

1. Browser tests fail with `ERR_MODULE_NOT_FOUND: playwright` (this sandbox has no Playwright). Environmental.
2. `test/report-rights-r7.test.mjs` fails 7 of 18 because the new registry ids are not in
   `supabase/functions/_shared/report-rights.json` and the ruling's generated block, and check 2c pins a fingerprint computed
   in the database on 2026-10-04 ("a new registry source fails this until a new ruling changes it").
   I did NOT run `node scripts/build-report-rights.mjs --write`: widening the list of sources a customer report may draw on
   is a founder rights decision, not a side effect of a config PR. The test reports 240 listed against 247 in the registry and names five of the
   seven new ids as missing (the printed list did not name the other two; not investigated). **This must be resolved (ruling plus `--write`) in the
   same PR before merge.**

## Government export request text (sources that cannot be ingested)

To Denton County (Development Services / Permitting, Tyler EnerGov Civic Access):

> HomeSignal requests a periodic public-records export (CSV or ArcGIS-hosted layer) of building, site-development and plat/planning
> applications in unincorporated Denton County, 2024 to present, with: permit or case number, application type, status, application
> date, issue/decision date, site address or parcel, and latitude/longitude or parcel ID. We do not need applicant or contact
> information. The county's `DEV_Permits` layer has not been updated since 2023-06-09. Please tell us whether a recurring export,
> an API, or an updated public layer exists.

To the City of Denton (Development Services): the Planning/Projects layers above are used as published. For building permits
(issued, with dates and addresses) please advise whether eTRAKiT or the city's GIS can publish a public layer or CSV; applicant
data is not requested.

## Not claimed

- Per-ZIP coverage counts for the seven new entries were not measured; the 3-mile spatial scope is the connector's normal ZIP approximation.
- Layer 9 (subdivision) and layer-wide 2025-2026 totals are available in the run 38592730673 log and were not re-tallied here.
- The new entries have never run against the live service from the deployed edge function; only the offline test (real captured features) exercised them.
