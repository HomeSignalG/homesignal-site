# "Last updated" audit, Kansas City reconciliation and surface inventory (2026-11-26)

Status: **the universal standard is NOT complete.** The display code and its tests are in place, but no
record has a verified date yet, so no date is shown. Every claim below carries its query or file.

## 1. What `last_seen_at` is for national projects: NOT a verification

| value | evidence (read from production 2026-11-26) |
|---|---|
| `map1_dc_zip_members.last_seen_at` (canonical rows) | `o.observed_at` (`docs/map1-dc-publication.sql:168`). `dc_source_observation.observed_at` is `timestamptz not null default now()` (`docs/dc-step2a-foundation.sql:431`): the time the row was inserted. 161,505 rows, 113 distinct minutes, newest 2026-11-26 19:32:41, equal to the completion time of the run that wrote them. |
| `map1_dc_zip_members.last_seen_at` (OpenStreetMap rows) | `national_dc_records.last_seen_at`, `default now()`. All 1,824 rows hold one value, 2026-09-15 18:46:03 = `imported_at`. A one-time load. |
| What a successful run proves | Compute Atlas / Epoch are third-party aggregators, not the official source of any project. Compute Atlas: 47 SUCCESS_COMPLETE runs, last 2026-11-06, then 20 FETCH_FAILED (2026-11-07 to 2026-11-26). |

**Verdict: the fallback was removed** (`lib/templates.js` `lastUpdatedLine` reads only `p.last_updated`). The Map 1
project panel's separate line "Source last observed" (`lib/map1-project-panel.js:152`) is a different label for
the same insert time. It is not "Last updated"; it should be reviewed in the same change as the data work below.

## 2. The plane's `as_of` is NOT a verification either (found during this audit)

`homesignal-ingest/bluesky/lib/development-seo-plane.mjs:698-699`: `if (rec.tracked) { if (today) rec.as_of = today; }`.
`today` is the plane run day. A project is `tracked` when it is still in `app_projects` at build time. `app_projects`
keeps a failed source's records (`dev_with_carried_sources`), so a record whose source could not be read still gets
`as_of = today`. Example: the legacy Kansas City feed answered "Token Required" 384 times between 2026-10-27 and
2026-11-05 (`dev_refresh_source_failures`) while its permits stayed tracked.

My first commits displayed `as_of` as "Last updated". That was wrong. The generator now displays only a new
plane field, `verified_on` (`scripts/gen_zip_pages.py`): absent means no date, and `as_of` is never shown. Tests pin both.

## 3. Kansas City building permits

### What is established (queries, no assumption)
* Legacy ArcGIS ids: `arcgis:kcmo-building-permits:<permit>`; new Socrata ids:
  `socrata:data.kcmo.org:w8jz-wjgn:<permit>`. Same permit numbers, different keys. `dev_change_project`: 3,716 legacy
  and 3,475 Socrata identities; only 346 permit numbers appear under both. Reconcile on the permit number.
* Legacy-only and issued on or after 2025-11-05, in the building/demolition prefixes (CPBR, CPBC, CPDR, CPDC): **85**.
  Each was read from the official dataset (`data.kcmo.org` `w8jz-wjgn`, 85 of 85 found, via pg_net):

| class | count | meaning |
|---|---:|---|
| A. status the new feed excludes on purpose (Cancelled 6, Voided-City 2, Hold 2, Suspended 1) | 11 | intentional status rule |
| B. issued before 2025-11-27, aged out of the sliding 365-day window | 35 | expected |
| **C. status eligible, inside the window, official record exists, NOT in `app_projects` or the new ledger** | **39** | **ingestion gap** |

Class C ids: CPBC-2025-00270, 01050, 01052, 01053, 01060, 01082, 01085, 01086, 01089, 01090, 01094, 01096, 01098,
01104, 01105, 01106, 01109, 01114, 01115; CPBR-2025-02162, 02163, 02171, 02544, 02545, 02781, 02792, 02820, 02821,
02849, 02877, 02889, 02910, 02914, 02925, 02934, 02935; CPDC-2025-00195; CPDR-2025-00251, 00252.

**I could not reproduce "nine eligible" and "16 excluded".** My independent count of eligible, in-window, missing
permits is 39. If the nine come from a specific ZIP, page or date, send the permit numbers and I will classify
them the same way. Nothing below depends on that.

### Why they are missing: ingestion failure, not a tracking decision
* Official dataset, eligible statuses, issued 2025-11-27 to 2026-11-27: **4,027** permits. Loaded
  (`app_projects`, same filter): **3,288**. **739 missing (18%)**, in all 23 ZIPs with a larger gap, worst in 64156
  (186 vs 72), 64155 (307 vs 209), 64154 (177 vs 80).
* Live engine read for ZIP 64156 (`get-address-report`, response not persisted): fetched 188, emitted 186,
  **`geocode_failures` 114**, plus about 16 "geocode geofence: matched ZIP 6xxxx != filed 64156, coords nulled".
  Failing addresses are new-construction streets (NE 86th Ter / Pl, NE 87th St, N Brighton Ave, N Corrington Ave).
  The feed has no coordinates (`geocode_assemble`), a failed geocode drops the pin, and `app_projects` holds
  `lat is null` for 0 of 3,311 kcmo rows, which is consistent with unpinned permits not reaching it (inferred,
  not shown by a per-permit trace).
* So the loss is the Census geocoder failing on new streets, not an exclusion. Neither the status map nor
  `extra_where` removed these permits.

### The excluded trade permits
Legacy-only, issued on or after 2025-11-05, trade prefixes: CPER 645, CPMR 388, CPPR 364, CPEC 134, CPPC 81,
CPMC 57, CPFC 55, CPVP 18 = **1,742**. The new feed's `extra_where` keeps only `CPPU - Building` and
`CPPU - Demolition`. That matches this repo's rule for permit sources (trade permits dropped at source: Seattle,
WA/MN/IL). It is a scope change from the old ArcGIS entry, whose trades carried a work class of "NEW CONSTRUCTION"
(e.g. CPPR-2025-02974, plumbing for a new home). I did not isolate "16".

### Duplicate pages and URLs
Project URLs hash the key (`project_path`), so a legacy and a new key for one permit would make two pages.
The legacy keys have no `app_projects` row now. Whether the published plane still carries legacy pages cannot be
read from here (the object is in Storage). Check `email-assets/seo/development-seo-projects.json` for keys starting
`arcgis:kcmo-building-permits:` before any fix. Do not delete or merge pages: they are kept by rule.

### Proposed fix (not applied)
1. Keep a permit whose geocode fails as an area-scope record that ZIP pages list, instead of dropping it;
   or geocode against KCMO's own address-point dataset for new streets. Both change the connector: a decision.
2. Map legacy to new keys by permit number in the plane so one project keeps one page and its history.
3. Page when `geocode_failures` exceeds a share of `fetched` (114 of 188 here).

## 4. Every remaining surface: what is shown and what data is missing

| surface | shows today | blocker | data change needed |
|---|---|---|---|
| Project pages, ZIP and city cards, project lists, related lists | `verified_on` if the plane carries it, else nothing | plane has no `verified_on` | ingest producer sets `verified_on` |
| Map 1 pop-ups and rows | day from `/community/<zip>/projects/pages.json` `updated` (from `verified_on`) | same; only records with a project page | same |
| Dynamic ZIP cards | same index | same | same |
| Records without a project page | nothing | `app_projects` has no verified date | add `app_projects.verified_on` |
| National data-center listings | nothing | no official source; aggregator inserts | none: stay undated, or a separately worded "Listing source read" from a SUCCESS_COMPLETE run |
| Development Activity Reports | report-level "as of" (`national-report.ts` `as_of: today`), no per-record date | report run day only | per-record `verified_on` into the report record |
| Search results | not in this repo (only the Google-indexed pages above) | none here | none |

### Data contract that makes it real, without inventing a date
`verified_on(record) = latest successful, complete read of the record's registry source for its ZIP at which the
record was present`. Inputs already exist: `dev_refresh_generation` (zip, outcome, tick_at, not_complete),
`dev_refresh_source_failures` (zip, registry_id, seen_at). Implementation order: (1) add `app_projects.verified_on`
and have `app_refresh_zip` / `dev_refresh_collect` advance it only for registry ids whose source read completed in
that response and was not carried forward; (2) the plane copies it to `verified_on` and freezes it when
untracked; (3) the report engine copies it; (4) backfill nothing: a record has no date until its next verified read.
A failed source leaves the date where it was. Test: a carried-forward record keeps its old `verified_on`.

## 5. Test results (this branch)
Unit and browser tests added or extended: `last-updated-standard`, `project-pages` (125), `indexnow-delta` (50),
`last-updated-static.browser` (static ZIP and city cards: verified, paused, no page, no tracking wording),
`community-card-links.browser` (dynamic ZIP cards: verified, paused, no page, `last_seen_at` never shown),
`map1-project-page-link.browser` (pop-ups and list rows: verified, paused, no date, malformed date, late-filled slot,
data-center pin with `last_seen_at`). Four deliberate breaks (fallback restored, date dropped from the Map 1 link,
dynamic lookup disabled, static card date removed) each fail the matching test. Playwright ran from
`/opt/node-tools` with Leaflet 1.9.4 installed locally; desktop width only (1280x900 for Map 1). No mobile-width run.
