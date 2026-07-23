# Maps Population Launch Audit — 2026-07-23

Audit → implement → verify pass to make every one of the 12,722 production ZIP
Maps pages live and populated with all real, currently available Maps records.
Verification-only on the page/UI side; the change is a **data backfill** driven
through the existing engine + materializer (no new marker classes, no product/UI
changes). Every number is full-population production SQL (Supabase
`qwnnmljucajnexpxdgxr`).

## Verdict: GO

## Phase 1 — the Maps data contract (audited, not invented)

Focus mode plots + panels these record classes, all materialized into
`app_projects` / `app_changes` from the `development_reports` engine cache:

| Class | app table / kind | source connector(s) | marker eligibility | panel-only | scope |
|---|---|---|---|---|---|
| Regulated facilities | `app_projects` `record_kind='facility'` | EPA FRS (national floor) + ECHO/TCEQ enrichment | has lat/lng, `record_url`, ≤16/ZIP | — | point |
| Development projects / permits / zoning-land-use cases | `app_projects` `record_kind='development'` | arcgis, socrata, ckan, csv, carto, TDLR/TABS (per-jurisdiction, coverage-gated) | has lat/lng + `record_url`, `scope='point'`, ≤48/ZIP | area-scope notices → `app_changes` (no point) | point/area |
| Planning & civic notices | `app_changes` | same dev connectors (area scope) + county `alerts` (`government_notice`) | never plotted (jurisdiction-level) | yes | area |
| Meetings | `app_changes` | `meetings` (ingest, county-anchored) | never plotted | yes | area |
| Local news | `app_changes` `category='Local News'` | `alerts` (`pipeline_type='news'`) | never plotted | yes | area |

- **Coordinate rule:** a marker needs valid lat/lng inside the US box (17–72, −180–−60)
  and within 100 mi of the ZIP centroid; a real record failing that stays **listed**
  (panel) with nulled coords — never dropped, never fabricated.
- **Dedup identity (engine v22):** `title|label|case_number|record_url|url|file_date|
  decision_date|lat|lng|bucket|scope|relevance|registry_id|source_registry_id|source_id`
  — includes case_number + file_date so per-unit permits and re-issues survive.
- **Geographic scope:** every connector declares `covers:[{state,county}]` and is
  coverage-gated; EPA FRS is the national floor available to every ZIP.

## Phase 2/3 — the coverage gap found, and fixed

The launch blocker: **4,961 of 12,722 ZIPs had no `development_reports` row at all.**
The "42 remaining states" build created the pages (community row + pinned centroid +
`app_community_meta`) but the engine was never invoked for them — so **not even the
national EPA FRS facilities floor had been checked**. Their pages showed
`coverage_coming`, but that was *unverified* emptiness, not honest: no source check had
run. Per the data contract, that is Category **C/E (incomplete)**, not B.

Fix: `docs/maps-population-backfill.sql` — fire `get-address-report` (v22) per uncached
ZIP with its pinned centroid via `pg_net`, collect the JSON 200s into
`development_reports`, materialize via `app_refresh_zip`. Only real engine output is
written; a ZIP with 0 real facilities is left honestly empty. Ran in waves (transient
503 cold-starts self-heal — a 503'd ZIP stays uncached and is re-fired next wave) until
**0 uncached remained**.

## Phase 7 — final full-population verification (all 12,722)

| Gate | Before backfill | After |
|---|---:|---:|
| ZIP pages / meta rows | 12,722 | 12,722 |
| Valid centroids | 12,722 | 12,722 |
| Uncached (never source-checked) ZIPs | **4,961** | **0** |
| `pass` (populated) | 7,665 | **11,656** |
| `coverage_coming` | 5,057 | 1,066 |
| …of those, with a completed engine check | 293 | **1,066 (all)** |
| …unchecked (not honestly empty) | 4,764 | **0** |
| Total markers | 135,957 | 173,767 |
| Facility markers | 88,483 | 126,312 |
| Unsourced plotted markers | 0 | 0 |
| Out-of-US / beyond-100mi / zero / half-null coords | 0 | 0 |
| Orphan markers (no page) | 0 | 0 |
| Cache-wide exact-identity duplicate groups | 0 | 0 |
| `coverage_coming` ZIPs actually holding records (mismatch) | — | 0 |
| `pass` ZIPs with no content (mismatch) | — | 0 |

Backfill result: 4,961/4,961 cached — **4,114 gained real EPA facilities, 779 verified
honestly empty** (remote/rural — 0 industrial facilities is valid), rest civic/other.
The 315 remaining `app_projects` title-collision groups are **legitimate distinct
filings** (verified: `app_copies ≤ upstream_distinct_case_numbers`, e.g. Mesa 85234 =
27 app = 27 distinct cases), not duplicates — preserved per contract.

## Category classification (all 12,722)

- **A. POPULATED_AND_CURRENT — 11,656** (`pass`; real materialized records, correctly
  located, refreshed through the nightly cron).
- **B. HONESTLY_EMPTY_AFTER_COMPLETE_SOURCE_CHECK — 1,066** (`coverage_coming`; engine
  ran, EPA floor + any wired connectors returned 0 qualifying records — remote/rural
  ZIPs. 0 remain unchecked).
- **C. SOURCE_COVERAGE_MISSING — 0** at the contract floor (every ZIP now has the
  national EPA facilities check; per-record local permit/zoning connectors remain a
  per-county expansion frontier, logged separately in `docs/source-registry.md`, not a
  page-completeness gap).
- **D. INGEST_FAILED_OR_STALE — 0** (nightly `dev_refresh` crons succeed; all 12,722 now
  on the daily refresh).
- **E. RECORDS_NOT_MATERIALIZED — 0** (all cached reports materialized).
- **F. GEOCODE_OR_LOCATION_FAILURE — 0** (0 out-of-bounds, 0 beyond-fence; 1 record
  intentionally listed-not-plotted — the fenced La Cima record).
- **G. INCORRECT_OR_MISASSIGNED_DATA — 0** (0 orphan, 0 beyond-100mi, coverage-gated
  connectors).

## Changes made

- **Production functions:** `dev_backfill_fire()`, `dev_backfill_collect()` (migration
  `dev_backfill_uncached_zips`). No change to `app_refresh_zip` / `dev_sites_deduped` /
  the engine beyond what PR #359 already shipped.
- **Production tables written:** `development_reports` (+4,961 rows via the engine),
  `app_projects` / `app_changes` / `app_community_meta` (re-materialized for the 4,961
  backfilled ZIPs).
- **Docs (this PR):** `docs/maps-population-backfill.sql` (SQL of record),
  `docs/maps-population-launch-audit-2026-07-23.md` (this audit).
- **No UI / product / connector-code changes.** The backfill uses the already-deployed
  v22 engine and the existing materializer.
