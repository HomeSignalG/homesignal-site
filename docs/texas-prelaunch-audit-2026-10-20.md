# Texas pre-launch audit — 2026-10-20

Scope: the **668 existing Texas ZIP pages** in `public.communities` (`state='TX'`, `level='zip'`,
22 counties). No page was created, removed or re-parented. Every number below was read from
production the same day; each table names its control.

## 1. Inventory and freshness (control: 668 pages, 668 `development_reports` rows)

| check | result |
|---|---|
| pages with a development report | 668 / 668 |
| development refresh older than 7 d | **6** (all Williamson, all Round Rock; §3) |
| …of which, by the Fix 4 classification (`docs/maps-coverage/fix4/`) | PO box 212 · single-organization 50 · flagged decommissioned in the third-party dataset 27 · standard ZIP with no Census area 7 (= 296; `geo.n5_serving_status` independently reads 296 `not_measured`). These pages correctly show no ZIP map (rulings 2026-10-01 / 10-03); 44% of TX pages, 42% of the national 706. |
| EPA facility layer older than 7 d | 49: Dallas 41, Williamson 6, El Paso 1, Travis 1 |
| pages with no Census ZIP boundary (Fix 4 class, not failed) | 296 (El Paso 114, Dallas 90, Travis 38, Tarrant 32, Denton 5, Williamson 5, Collin 4, Fort Bend 3, Comal 2, Montgomery 1, Hays 1, Harris 1) |

The Dallas EPA pages all carry `facilities_unavailable = true`, so the page shows "—", not a
false count. This is the documented residual for dense ZIPs stored below the 40-facility cap
(they walk the full EPA ladder and get refused). Honest on the page; not changed here.

## 2. Map 1 dots: source currency and labels

Per source, over each county's pages (`app_projects`, `record_kind='development'`; rows are ZIP
copies). Control: the Fort Worth sample read directly beforehand.

| source | rows | pages | newest filing | finding |
|---|---:|---:|---|---|
| **denton-county-dev-permits** | 26,718 | 28 | **2023-06-06** | **FROZEN; 26,483 drawn as Approved** → fixed (§3) |
| **round-rock-large-development-projects** | 45 | 6 | 2025-09-15 | **layer now private (`Token Required`)** → retired (§3) |
| dallas-specific-use-permits | 30,975 | 164 | n/a (no filing date) | all "Operating now": in-force/permanent SUPs; documented mapping, kept |
| data.austintexas.gov (3 datasets) | 82,779 | 84 | 2026-10-16 | current; 39,081 "Other project" are zoning cases (no building type stated; honest) |
| arlington-issued-permits | 72,223 | 30 | 2026-10-19 | "Operating" = `Finaled` (final inspection), correct |
| arlington-planning-cases | 1,042 | 26 | 2026-10-06 | all "Other project": zoning requests, honest |
| fort-worth-development-permits | 13,862 | 38 | 2026-10-19 | current |
| fort-worth-zoning-cases | 441 | 70 | 2026-07-08 | current enough (zoning cadence) |
| txdot-projects-info-all | 27,110 | 666 | 2026-09-24 | 40–70% undated: lets not yet awarded have no award date (honest absence) |
| el-paso-new-residential-permits | 4,239 | 138 | 2026-09-30 | current within the publisher's ~7-week batch lag |
| frisco / denton-city / irving / san-marcos / san-antonio | — | — | 2026-08..10 | current |

Future-dated filings: **0** in every TX source (the 2026-10-20 date-sanity guard is live).
Records without coordinates: 7 (San Marcos), all listed not pinned.

### Not changed, proposed for a decision

- **Austin issued construction permits (`3syk-w9eu`) are excluded from ZIP pages by a recorded
  2026-08-11 decision** (`zip_mode: false`) whose premise was "~85% of rows carry no native
  coordinates". Measured today over the last 365 days: **42,722 rows, 26,658 (62%) with
  latitude**, newest issue 2026-10-20. The premise no longer holds, but enabling it adds hundreds
  of permits per Travis page and reopens a recorded decision, so it is a founder call. If yes:
  keep only `work_class` New / Addition / Demolition (repairs and change-outs are most rows) and
  only rows with native coordinates.
- **Round Rock replacement layer** (`Current_Developments_View/2`, 130 rows) has no date column;
  see `docs/source-registry.md` "TEXAS PRE-LAUNCH".

## 3. Fixes applied (this PR)

1. `denton-county-dev-permits`: `recency_days: 365` (same rule as SLC, #2089). Emits 0 until the
   county publishes again. The 28 pages keep Denton-city, Frisco and TxDOT records, so CORE GUARD 2
   (refuses a fresh page dropping to zero development) is not triggered.
2. `round-rock-large-development-projects`: retired. Its `Token Required` failure was blocking
   **every** source on 6 Williamson pages via CORE GUARD 1 since 2026-09-29/30
   (`dev_refresh_source_failures`, `blocked_update: true`). After the edge function deploys, the
   collector's retired-source path accepts the reduction and those pages refresh.

Readiness check 14 (added in #2089) flags a source whose newest filing is older than 365 days;
it would have caught Denton County. Run `scripts/audits/county-launch-readiness.sql` with
`st='TX'` before launch.

## 4. Government notices, meetings, local news (per county, chain + overlap cities)

| county | pages | notices (rows / newest write) | meetings (upcoming) | local news 14 d |
|---|---:|---|---|---:|
| Dallas | 174 | 33 / 10-13 | 33 (0 upcoming) | 15 |
| El Paso | 145 | **4 / 09-01** | **3, none since 09-07** | 53 |
| Tarrant | 99 | **none wired** | none | 121 |
| Travis | 86 | 25 / 10-01 | 32 (2 upcoming) | 51 |
| Denton | 32 | 132 / 10-15 | 136 | 107 |
| Collin | 28 | 26 / 10-20 | 26 (2 upcoming) | 128 |
| Williamson | 25 | 41 / 10-20 | **none wired** | 50 |
| Montgomery | 22 | **none (city tenant deactivated)** | none | 44 |
| Fort Bend | 21 | **none wired** | none | 70 (0 topic-tagged) |
| Hays · Bastrop · Burnet | 8 · 5 · 4 | none wired | none | 37 · 21 · 33 |
| Comal · Bexar · Harris · Brazoria | 7 · 2 · 1 · 1 | current | current | current |
| Llano · Caldwell · Walker · Lampasas · Liberty · Hudspeth | 1–3 each | none wired (Llano meetings only) | | small |

- **El Paso is broken, not quiet:** `dryrun-feed` on its wired calendar (`Calendar.aspx?CID=24`,
  run 39467270460) returns **0 items** today. 145 pages.
- **Travis meetings are healthy:** dry run (39467275837) reads through 2026-10-27, same as stored.
  It exposed a labelling defect, fixed in homesignal-ingest: "Commissioners Court Voting Session"
  (Travis's regular business meeting) was filed under Elections & voting — 20 stored rows.
- **Local news is policy-locked, not broken**, on the six small/Houston-suburb counties that render
  none: their stored rows carry no topic from the 12 (Fort Bend: 2 of 130 in 30 days).
- Texas has no Board of Supervisors or LAFCO; the county fallback for unincorporated pages is the
  Commissioners Court feed the ZIP→county cascade already reads.
