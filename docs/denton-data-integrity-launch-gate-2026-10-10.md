# Denton — data integrity and launch gate (2026-10-10)

Dated record. Everything below was measured on 2026-10-10 against production (read-only: `execute_sql` selects, `pg_net` GETs to public
publisher endpoints, a rolled-back role test) and against the shipped code. Nothing was written to production, no function was deployed, no
permission was changed. Verdicts are at the end.

## 1. `denton-county-dev-permits` — stale, and nothing newer is being excluded

| question | evidence |
|---|---|
| Is the source still publishing? | **No.** Live `FeatureServer/0` (ArcGIS 11.5): `max(DateReceiv)` = 1686286800000 = **2023-06-09**, `count` = **56,500**. Same newest date on `MapServer/0` (rows ordered by `DateReceiv DESC` start at 2023-06-09). The July 2026 recon recorded the same 56,500 rows and the same date, so no row has been added in three months. |
| Did the endpoint or schema change? | No. Same host, same layer, same fields (`PermitID`, `DateReceiv`, `PermitStat`, `PermitType`, `PropertySi`, ...). The county's service list (`/arcgis/rest/services`) has no successor permit ledger: `Energov` is base layers (addresses, zoning, floodplain), `CityETJPermits_GC` / `ZoningPermits_GC` / `OSSFPermits_GC` / `UTILITY_Permits` were already classed as paperwork (source-registry.md "REJECTED — Denton County"). |
| Is our ingest excluding newer records? | **No.** Layer-wide newest is 2023-06-09, so there is nothing newer to exclude. Our table's newest Denton record is 2023-06-06 (the 06-09 record is outside every modeled ZIP's 3-mile disc or a non-whitelisted type). The fail-closed exclusions do not hide recency either: the 22,380 blank-status rows end at 2020-10-06, `Pending` at 2023-04-21, `Approved` (whitelisted types) at 2023-06-06. |
| Do published projects depend on it? | **Yes, almost entirely.** `app_projects` (development): Denton 26,558 rows / 20,298 keys. For the nine pilot ZIPs the only non-TxDOT content is this layer, except 75056 (Frisco): see section 5. |

Not done, deliberately: no lower-quality source was substituted, no timestamp was touched, no record was re-published.
**Unresolved gap:** no fresh authoritative development source is wired for Aubrey, Little Elm, Argyle, Justin, Ponder, Pilot Point, Sanger,
north-west Denton or The Colony. This session did not discover one; the county host has none. That is a source-discovery job, not a repair.

## 2. The 183 Withdrawn and 27 Denied records — already handled; nothing promoted

* Live source, whitelisted types: **Withdrawn 183** (newest 2023-03-14), **Denied 27** (newest 2022-01-28); 210 distinct `PermitID`, 210 with geometry.
* Our table: **180 of the 210 are present, all 180 as `status='Decided'`; 0 as Proposed/Approved/anything else;** 0 `Decided` rows that are not in the source.
* The other **30 lie 3.32 to 7.73 miles from every canonical ZIP centroid**, outside the registry's `spatial_zip_radius_mi: 3` scoping. That rule is
  status-agnostic. 180 + 30 = 210.
* Presentation: the shipped renderer (`lib/da-report-view.js`) labels a Decided record "Decided (denied or withdrawn) ... not open or under
  review" and counts it apart from open proposals. Verified on a real Decided Denton record ("HOUSE F56 INVESTMENTS, LLC", filed 2023-03-01) through the real
  handler and renderer: counted as decided, not in the open-proposal count.
* **What is still missing:** the *outcome* (Denied vs Withdrawn). `app_projects` carries only `Decided`; the parked
  `docs/decision-provenance-migration.sql` would carry the decision object. It is a production splice of `app_refresh_zip` and was not applied.
* A first attempt of mine excluded Decided records from the report. The same-day test `national-report-generation-points` (section 4) showed that
  duplicated an existing design, so it was reverted before any commit. No lifecycle code is changed here.

## 3. Monitoring

* **401 on `public.app_zip_source_ids`:** root cause is `phase1_revoke_anon_internal_read_surface` (2026-09-26), a deliberate hardening. `anon` ACL
  is `awdDxtm` (no `r`); `dev_zip_source_ids` is SECURITY INVOKER. The nightly `source-monitor` job logs
  `live-scoreboard failed: dev_zip_source_ids failed: HTTP 401 {"code":"42501", ... "permission denied for table app_zip_source_ids"}` (run 38033807174,
  2026-10-10). Reproduced in a rolled-back transaction: as `anon` 42501, as `service_role` 1,000 rows from 01001.
* **Fix:** `scripts/live-scoreboard.mjs` reads that one RPC with `SUPABASE_SERVICE_ROLE_KEY` (an existing repository secret, already used by 7 workflows),
  from the environment only, never logged, never from `config.js`, scoped to the one workflow step. It fails closed with its own message if absent. `anon`
  is **not** re-granted; RLS and grants are unchanged. Test added (load-bearing: swapping the key back to anon fails it).
* **Not verified live:** the secret's presence/value in this repository's settings, and a green nightly run. Both need the merged workflow to run once.
* **Still red after this fix (separate, pre-existing):** the `Fail on status-domain drift` step of the same job.
* **Frisco `frisco-active-building-permits`: persistent on the retired host, healthy on the wired host.** `scripts/source-monitor-targets.json` still probed
  `geo.friscotexas.gov` (2026-07-13). Re-probed 2026-10-10: that host times out at 20 s. The registry's wired `service_url` is `maps.friscotexas.gov`, which
  answers HTTP 200 with 647 permits, all `ISSUED`. DB fetch health for the family: 0 failures in 24 h and 14 d; last failure 2026-09-03. The nightly
  "unreachable" row was a stale probe URL. The target now names the wired URL, so the monitor reports `already-wired`.
* **Frisco in 75033:** 29 records stored with `zip='75033'` (3-mile disc), of which 19 lie inside the 75033 polygon; 153 Frisco keys are polygon members in the
  serving membership. All `ISSUED`, issue dates 2023-10-10 to 2026-09-21, per-permit eTRAKiT links, refreshed 2026-10-10. Several permits share one address
  (e.g. 16750 Hollyhock Rd has 6): distinct permits, not duplicates by key. The "six" in the brief does not reproduce on any of these planes.

## 4. Address field: a defect found and fixed

The Denton registry entry mapped `address` to `PropertyAc` (alias *Property Account*, an account number). Reports printed `R87447` / `46031` as an address
(173 of 173 records in the dense test). The layer has `PropertySi` (*Property Situs Address*), populated on **43,242 of 48,161** whitelisted records
("1005 VALERIAN DR"). Fix: one registry value (`jurisdiction-registry.json`, 2 lines incl. the dated receipt). Takes effect when the engine is deployed and
each ZIP is refreshed. Not deployed. Coordinates already come from geometry, so geocoding does not change.

## 5. Real property reports, nine pilot ZIPs

Method: addresses were chosen as public-building addresses, each **verified by the Census geocoder** (the one `geocode-address` uses; an address was kept only if
the matched ZIP equalled the target). Of 51 candidates, 20 verified and 19 were used; the rest did not match or matched another ZIP (four 76207 guesses landed in
76201/76208/76210 and were discarded). For each: `n5_projects_within_radius` at 0.5 mi on production, hydration from `app_projects`, then the **shipped** handler,
`assemble()`, rights file and renderer. 21 reports run (19 real addresses, 2 coordinate-only cases labelled as such).

Across all 21: HTTP 200; every real address inside its target ZIP polygon (19 of 19 `member`); every row's `distance_mi` <= 0.5 (0 violations);
0 fabricated projects (every project id came from hydration); 0 without a source URL; 0 duplicate keys; the one Decided record labelled Decided, not open.

| ZIP | verified addresses | records within 0.5 mi | sources | newest non-TxDOT record | freshness / coverage |
|---|---|---|---|---|---|
| 76227 | 107 S Main St, 200 S Main St (Aubrey) | 12, 12 | TxDOT only | none | **FAIL** |
| 75068 | 100 W Eldorado Pkwy, 100 Lobo Ln (Little Elm) | 1, 1 | TxDOT only | none | **FAIL** |
| 76226 | 308 E Denton St, 800 Eagle Dr (Argyle) | 3, 3 | TxDOT only | none | **FAIL** |
| 75056 | 6800 Main St, 5151 N Colony Blvd (The Colony) | 2, 0 | TxDOT (both > 1 yr); second address "No data ingested" (honest) | none | **FAIL** (see below) |
| 76247 | 415 N College Ave, 206 S College St (Justin) | 4, 3 | TxDOT only | none | **FAIL** |
| 76259 | 102 Bailey St, 200 Bailey St (Ponder) | 7, 7 | 1 Denton County (2017-09-13) + 6 TxDOT | 2017-09-13 | **FAIL** |
| 76258 | 102 N Washington St, 300 S Washington St (Pilot Point) | 3, 3 | TxDOT only | none | **FAIL** |
| 76266 | 502 Elm St, 600 Elm St (Sanger) | 9, 9 | TxDOT only | none | **FAIL** |
| 76207 | 5000 Airport Rd, 3100 S Bonnie Brae St, 1400 Hercules Ln (Denton) | 2, 4, 2 | TxDOT only | none | **FAIL** |

Stored-page view of the same nine (production, `app_community_meta`, all `indexable=true`, `data_quality='pass'`, updated 2026-10-10): non-TxDOT records dated within
the last 365 days: **75056 = 49; every other ZIP = 0**; newest non-TxDOT record 2022-12-20 (76207) to 2023-06-06 (76247).

Two extra cases: a **coordinate-only** point in a Denton-dense area of 75068 returned 173 records, all Denton County, all older than a year (newest 2023-05-04),
172 "Approved" and 1 Decided. A **coordinate-only** point beside Frisco permits in 75056 returned 11 Frisco records (newest 2026-08-12), but that point is *outside*
the 75056 polygon: the stored `zip` of Frisco rows comes from the 3-mile disc, not the polygon.

**Criterion used for FAIL.** The product has no per-source freshness SLA (report-engine doc: "open decision 8"; `activityOutcome` says SLA_UNDEFINED). For this gate I used the
report's own existing 365-day flag (`older_than_a_year`): a ZIP passes only if the tested addresses draw a development source with records inside 365 days. That is a gate
criterion for this decision, not a new product rule.

Observations that are not defects, recorded so they are not re-derived: (a) TxDOT corridor projects count as "within 0.5 mi" by *nearest point of the line*; their display
marker can be up to 6.2 mi away, and their "address" is a corridor description ("US 377 FM 428"). (b) Names on Denton rows are permit type plus the property owner's name
(including private individuals). That is existing behaviour, left as is. (c) R7 clears all 240 sources as a founder risk acceptance, not a publisher grant.

**Not verified:** (1) the reverse completeness check (a record within 0.5 mi that the radius read omits): an independent scan over 3M unindexed rows timed out and was
dropped; (2) the 33 browser-test files (no Playwright here); (3) live ZIP-page rendering (no egress to homesignal.net, no verifier run).

## 6. Verdicts

* **DENTON_ZIP_PAGES: AMBER.** All nine pages are indexable, `data_quality='pass'`, refreshed today; every record is sourced and dated; denied/withdrawn are not promoted. No page
  claims more than the data shows. But 8 of 9 pages show only county permits last dated 2022-12 to 2023-06 and nothing on the page discloses a source freeze. I did not render the pages.
* **DENTON_AGENT_PILOT: RED (no-go).** 0 of 9 ZIPs pass freshness/coverage; accuracy checks (geocode, radius, provenance, duplicates, lifecycle) pass but are not sufficient.
* **DENTON_FULL_MARKET: RED.** Same cause, wider: no fresh municipal development source for the Denton-county cities; the one county source is frozen.

## 7. What unblocks it (decisions and work that are not mine to take)

1. A founder ruling on a per-source freshness rule (open decision 8). Until then "fresh enough" is a judgement per gate.
2. Source discovery for the cities above (first-party only, probed on a runner, each admitted through the existing gates).
3. Apply `docs/decision-provenance-migration.sql` (separately gated) if the report should name Denied vs Withdrawn.
4. Merge and deploy this change (registry mapping needs the engine deploy; the monitoring fix needs one workflow run to confirm).
