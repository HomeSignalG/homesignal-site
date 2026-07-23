# Canonical Backbone Review

_2026-07-23 · read-only audit · every conclusion tied to production evidence
(Supabase `qwnnmljucajnexpxdgxr`, `homesignal-ingest`, `homesignal-site`)._

## Verdict

**READY WITH REQUIRED CHANGES.**

The backbone is real and already reusable — two complementary halves both run in
production across ~25 county cohorts, not just Box Elder and Del Valle. But four
things must change before it is a clean *national* backbone (all P0 below):
the refresh contract does not scale to 12,722 (freshness gap, DB-verified), the
page state model is a 2-value bucket that cannot say *why* a page is empty
(explicitly disallowed by this task), the ingest config has two disagreeing
sources of truth (`feeds.csv` 196 vs `public.feeds` 246), and the two connector
ecosystems live in two repos with no shared connector contract.

## Proposition Tested

> "Box Elder and Del Valle contain reusable ingestion, normalization,
> materialization, refresh, and presentation patterns that can become the
> canonical HomeSignal backbone for additional counties and ZIPs."

**Confirming evidence would be:** the same code paths (not copies) already
serving other geographies from declarative config; a stable normalized record +
identity; coverage-gated geographic assignment with no leakage; both content
halves converging on one page contract. **Disconfirming evidence would be:**
Box-Elder/Del-Valle-specific constants in core paths; per-county forks; config
baked into code; a refresh/ state model that only works at pilot scale.

**Finding:** mostly confirmed. The core paths *are* shared and *are* driven by
config (registry entries, `feeds.csv` rows) and already serve 25 cohorts. The
disconfirming evidence that exists is bounded and enumerated (below) — it is
"required changes," not "not reusable."

## Sources of Truth Used

| Source | What it authoritatively measures | Used for |
|---|---|---|
| `public.communities` | the ZIP/city/county backbone + `government_topics` | Box Elder 18-ZIP tree, Del Valle chain |
| `public.alerts`, `public.meetings` | ingest output (government notices, meetings, news) per `community_id` | Box Elder civic content |
| `public.development_reports` | engine cache (`sites` jsonb) per ZIP | Del Valle + all Maps content, freshness |
| `public.app_projects`, `public.app_changes`, `public.app_community_meta` | materialized page data + page state | what actually renders |
| `public.property_reports` | per-address dossier | Del Valle property page |
| `public.feeds` | **the config ingest actually runs (DB-first)** | reconciled against `feeds.csv` |
| `cron.job` / `cron.job_run_details` | engine refresh execution | freshness/failure |
| `homesignal-ingest/feeds.csv` + `ingest.py` + `adapters/` | ingest connector family + dispatch | ingest backbone |
| `homesignal-site/.../get-address-report/` + `sources/*.ts` + `jurisdiction-registry.json` | engine connector family + declarative config | engine backbone |
| `app_refresh_zip` (prod function) | the bridge that unifies both halves into the page | materialization contract |

**Where sources disagreed — reconciled in-line:** `feeds.csv` (196 rows) vs
`public.feeds` (246 rows). `ingest.py` loads config **DB-first** (`load_config`
reads `public.feeds`), so the DB is what runs; the CSV is the human master and
lags by ~50 rows (government-content feeds inserted via
`insert-gov-feed-candidate.yml` straight into `public.feeds`). Box Elder is in
sync (78 = 78); the drift is in the later county cohorts. **Resolution: the DB is
authoritative for behavior; the CSV must be regenerated from it** (P0, below).

## Box Elder — 18 ZIP Inventory

**Tree:** 1 county root (`box-elder`, `community_id d67c558f…`, 18-ZIP array,
7 government topics) → 2 city rows (Brigham City, Tremonton) → 18 `level=zip`
pages. **Content anchors at the county root**: root carries **523 alerts + 83
meetings**; Brigham City and Tremonton rows carry **0/0**; every ZIP page carries
**0 own** alerts/meetings and inherits via the cascade materializer.

**The 18 ZIP pages** (each: inherited `app_changes` + own markers), DB-verified:

| ZIP | Place | app_changes | markers | quality |
|---|---|---:|---:|---|
| 84301 | Bear River City | 64 | 1 | pass |
| 84302 | Brigham City | 74 | 16 | pass |
| 84306 | Collinston | 64 | 1 | pass |
| 84307 | Corinne | 63 | 15 | pass |
| 84309 | Deweyville | 64 | 0 | pass |
| 84311 | Fielding | 64 | 6 | pass |
| 84312 | Garland | 64 | 1 | pass |
| 84313 | Grouse Creek | 64 | 0 | pass |
| 84314 | Honeyville | 63 | 1 | pass |
| 84316 | Howell | 64 | 1 | pass |
| 84324 | Mantua | 64 | 0 | pass |
| 84329 | Park Valley | 64 | 1 | pass |
| 84330 | Plymouth | 63 | 8 | pass |
| 84331 | Portage | 64 | 3 | pass |
| 84334 | Riverside | 64 | 6 | pass |
| 84336 | Snowville | 64 | 3 | pass |
| 84337 | Tremonton | 74 | 2 | pass |
| 84340 | Willard | 63 | 4 | pass |

**A. Source acquisition** — government notices (Utah PMN body 88; MIDA body 1077),
county-commission meetings, planning/zoning, property-tax/equalization, elections,
public-safety/emergency, water district (BRWCD), noise & light-pollution
(multi-source), Stratos data-center project (MIDA + water-rights + 8 news outlets),
emerging-tech topics (water/soil/air/infrastructure — grade-gated, `active=FALSE`),
global best practices, EPA facilities (national floor), local development permits
(sparse — 0–16 markers/ZIP).

**B. Source technology** — Box Elder = **78 feeds** (53 active): 56 rss, 15 html
(Utah PMN parser), 6 news_html, 1 email (DWR water-rights IMAP). Pipeline split:
29 `government_notice`, 49 `news`. All keyed to the **one** county `community_id`.
Vendor meeting adapters available to the cohort: Granicus RSS, Legistar, iQM2,
CivicClerk, CivicPlus AgendaCenter, plus `brigham_agenda.py`.

**C. Processing** — discovery manual (feed rows); fetch `ingest.py::fetch_items`
(rss/html-PMN/email/news_html dispatch); parse per-source (`parse_pmn_body/notice`,
`parse_feed`, `parse_granicus_rss`, `parse_email_message`); normalize to
`alerts`/`meetings`; identity = `UNIQUE(community_id, source_url)` +
`ON CONFLICT DO NOTHING`; dedup on link/guid (+ normalized-title for news);
geographic assignment by `community_id` (anchored at root); relevance by
`category` string-match against `digest.py` topic canon; cache = the `alerts`/
`meetings` tables; materialization = `app_refresh_zip` folds root meetings +
gov-notice/news alerts into each ZIP's `app_changes`; refresh = GitHub Actions
`ingest.yml` every 2h (idempotent); retry/recovery = idempotent upserts + a
daily `feed_health()` readout (ERROR/EMPTY/STALE, gov-lenient 90d vs news 14d).

**D. Product output** — `community.html` reads `alerts`/`meetings` directly
(Government Notices + Upcoming Meetings + Local News tiles, per-topic, cascade-
scoped); `maps.html` reads the materialized `app_projects` (markers: hover
`type · name`, click → right panel) + `app_changes` (area notices, panel-only);
email digest via `digest.py` (two-stream notices/meetings, 5 PM Central);
source attribution = `source_url`/`source_ref` on every row; freshness =
`development_reports.refreshed_at` → "Updated <date>". Empty state today = the
generic `coverage_coming` (see Missing Capabilities).

**E. Operational verification** — ingest cron live (newest alert `2026-07-23
23:15`); duplicate protection = the `UNIQUE` + title-dedup; cross-ZIP leakage
prevented by anchor-at-root + ancestor-topic scoping; cross-county leakage
prevented because every feed carries one `community_id`. **Gap found:** the
`be-tremonton-*` feeds (planning/water/public-safety/noise/light) are keyed to
the **county** `community_id` with generic categories, yet the Tremonton row
advertises a `City government (Tremonton)` topic that **no feed writes** — so
that subscribable topic renders empty. Same latent gap for Brigham City.

## Del Valle Inventory

**Tree:** `Del Valle (78617)` `level=zip` → `Travis County` root. **Report
(engine cache):** 454 sites, counts `{facilities 29, development 425 (approved
324 / proposed 33 / operating 68), civic 0}`, refreshed `2026-07-23 09:08`.
**Materialized:** 16 facility + 48 development markers (48-cap applied), **5
"Government & civic" `app_changes`** (Travis meetings via CivicClerk), **1
`property_reports`** row (the 2200 Caldwell Ln dossier). **No government-notice
alerts** (`gov_alerts = 0`; the civic content is meetings only).

**A. Source acquisition** — development permits + subdivision/zoning cases (City
of Austin Socrata + Travis ArcGIS), TX TDLR/TABS filings (registry-pinned),
regulated facilities (EPA FRS national floor), environmental records (EPA ECHO +
TX TCEQ Central Registry, geo-matched), county meetings (Travis via CivicClerk).
No local-news/global/emerging feeds wired for Travis.

**B. Source technology** — engine connector families: **socrata** (16 registry
entries), **arcgis** (28), **ckan** (2), **csv** (1), **carto** (1), plus code
adapters **tdlr-tabs**, **tceq-cr**, and EPA **FRS/ECHO** baked into `index.ts`.
Del Valle activates Austin-Socrata + Travis-ArcGIS + TABS(Travis pins) + FRS/ECHO
+ TCEQ (TX-gated). Meetings come from the **ingest** side (CivicClerk → `meetings`).

**C. Processing** — discovery via `jurisdiction-registry.json` entries;
fetch/paginate per connector (`resultOffset`/`$offset`); parse via declarative
`column_map`; normalize to the engine site shape; **identity/dedup = v22
`dedupeExactPermits`** (title|label|case_number|record_url|url|file_date|
decision_date|lat|lng|bucket|scope|relevance|registry_id|source_registry_id|
source_id); geographic assignment = coverage-gate (`coverage:[{state,county}]`)
+ per-record point, area items anchored at report centroid (v18), geocode geofence
25 mi (v20) + 100 mi sanity fence; relevance via `classifyRelevance` (v15,
`rel_rule` auditable); cache = `development_reports.sites`; materialization =
`app_refresh_zip` (dev ≤48, facilities ≤16, `dev_sites_deduped` safeguard);
refresh = pg_cron `dev-reports-refresh-fire/collect` daily 09:00/09:08 UTC;
retry = transient-safe upsert (never blanks a good row).

**D. Product output** — `maps.html` (markers + hover + right panel + the three
Street/Satellite/Focus modes), `homesignalmap.html?zip=` (SEO page),
`homesignalmap.html?addr=` (property dossier from `property_reports`), env badges
(EPA/TCEQ), freshness "Updated <date>". Meetings surface as `app_changes`.

**E. Operational verification** — engine cron `succeeded 4/4` last 4 days; dedup
safeguard verified 0 cache-wide; coverage gate proven (a UT spot-check fetches 0
Travis sources); property normalizer `canonicalAddr` collapses "Ln"/"Lane"
variants to 1 row; **freshness gap present** (see below).

## Capability Comparison

| Capability | Box Elder (civic backbone) | Del Valle (dev backbone) | Reading |
|---|---|---|---|
| Source discovery | manual feed rows (`feeds.csv`) | manual registry entries | tie — both manual/declarative; discovery is the shared weak spot |
| Government notices | **strong** (PMN html + MIDA, 523 alerts) | **absent** (0 gov alerts) | missing feature on Del Valle (no TX PMN-equivalent wired) |
| Meetings | strong (83, county-commission + MIDA) | present (19 Travis via CivicClerk) | both work; different vendor |
| Local news | **strong** (49 news feeds, multi-outlet) | **absent** | missing feature on Del Valle |
| Permits/zoning | weak (0–16 markers, EPA-only mostly) | **strong** (425 dev records) | missing feature on Box Elder (few permit connectors) |
| Environmental facilities | national floor only | **strong** (EPA ECHO + TCEQ) | Del Valle stronger → canonical |
| Geographic assignment | anchor-at-root cascade | coverage-gate + point + fences | both canonical; different layers |
| Deduplication | UNIQUE(url)+title | **v22 exact-identity key** | Del Valle stronger → canonical for records |
| Normalization | to `alerts`/`meetings` | to engine site shape (`column_map`) | Del Valle's declarative map is stronger → canonical |
| Cache | tables | `development_reports.sites` jsonb | different roles; keep both |
| Materialization | `app_refresh_zip` (shared) | `app_refresh_zip` (shared) | **already canonical — one function** |
| Email alerts | **strong** (`digest.py` two-stream) | none wired | missing feature on Del Valle |
| Scheduling | GitHub Actions 2h (ingest) | pg_cron daily (engine) | **inconsistent — two schedulers** |
| Retries | idempotent + `feed_health` | transient-safe upsert | both adequate |
| Freshness surface | `refreshed_at` "Updated" | same | canonical |
| Failure reporting | `feed_health` ERROR/EMPTY/STALE | cron status only | Box Elder's `feed_health` stronger → canonical |
| Maps rendering | shared `maps.html` | shared `maps.html` | **already canonical** |
| Mobile behavior | shared (bottom sheet) | shared | **already canonical** |
| Source attribution | `source_url` every row | `record_url` every site | canonical (anti-fabrication) |

**Interpretation:** every "absent" is a *missing feature in that geography's
config*, not a code gap — the code to do it exists and runs elsewhere. The two
genuine *inconsistencies* are two schedulers and two dedup strengths. The clear
*stronger-should-be-canonical* winners: v22 dedup identity, declarative
`column_map` normalization, `feed_health` failure reporting, EPA/TCEQ enrichment.

## Canonical Core

Reusable, geography-independent, already shared in production — **keep as core:**

- **`app_refresh_zip` + `dev_sites_deduped`** — the one materializer that folds
  *both* halves (engine sites + ingest meetings/alerts) into `app_projects`/
  `app_changes`, anchored at the chain root. Evidence: identical function serves
  all 12,722 ZIPs; Del Valle's 5 meetings and Box Elder's 64 changes both come
  through it.
- **`get-address-report` engine core** — FRS floor, geometry/geocode fences
  (v13/v18/v20), relevance (v15), v22 dedup, counts-one-predicate-per-number.
- **The page contract** — `maps.html` (Street/Satellite/Focus, hover `type·name`,
  one right panel, mobile sheet) + `community.html` cascade resolution. Verified
  green across 12,722 in the prior audit.
- **Anti-fabrication invariant** — every marker carries `record_url`/`source_ref`;
  absent fields stay absent; area items anchor at centroid. 0 unsourced in prod.
- **`digest.py` two-stream email** — canonical alert delivery.
- **`feed_health()`** — the canonical failure/staleness readout.

## Connector Families

Reusable platform adapters (the code is the family; the entry is config):

- **Engine (site repo, `sources/*.ts`):** socrata, arcgis, ckan, csv, carto —
  each a declarative `column_map` + `status_to_bucket` + `coverage[]` adapter;
  plus code adapters tdlr-tabs, tceq-cr, and FRS/ECHO. Registry: 48 entries
  (16 socrata, 28 arcgis, 2 ckan, 1 csv, 1 carto).
- **Ingest (ingest repo, `adapters/` + `ingest.py`):** Utah-PMN (html),
  granicus-rss, legistar, iqm2, civicclerk, civicplus AgendaCenter, news_html,
  email(IMAP), plus per-topic filter configs (14 `*_filter.json` + yaml).

**These are two parallel connector ecosystems in two repos.** A canonical
backbone should give them **one connector interface shape**:
`{registry_id, platform, endpoint, jurisdiction, coverage[], column_map,
type_map, status_to_bucket}` — the engine already has exactly this; the ingest
side should adopt the same declarative shape (today it is half code-dispatched by
URL substring in `fetch_items`).

## Configuration Layer

Everything that must be declarative, not code:

- **Engine:** `jurisdiction-registry.json` — `registry_id`, `platform`,
  `domain`/`service_url`, `dataset_id`, `jurisdiction`, `coverage[]`,
  `column_map`, `type_map`, `status_to_bucket`, spatial options. Already fully
  declarative. Example verified: `austin-subdivision-cases` (Socrata, Travis),
  `slc-planning-petitions` (ArcGIS, Salt Lake).
- **Ingest:** `feeds.csv` / `public.feeds` — `feed_id, active, county,
  community_id, target_table, source_type, source, filter, category,
  pipeline_type, …`. Declarative, but **split-brained** (CSV 196 vs DB 246).
- **Should be externalized:** the URL-substring dispatch in `ingest.py::
  fetch_items` (granicus/legistar/iqm2/civicclerk/civicplus) → a `platform`
  column, matching the engine registry.

## County-Specific Logic (legitimately isolated — keep)

- Box Elder **Stratos** program (`@adapter:stratos_data_center_project`,
  water-rights area-code `29-` + alias geography) — genuinely unique civic story.
- `brigham_agenda.py`, `brigham_local_sources.json`, `box_elder_local_geo.yaml`,
  `box_elder_weather` — pilot-specific local sources.
- TABS **Travis pins** (`pins/tdlr-tabs-projects.travis.json`) — a reviewed pin
  set; legitimately per-county.
- Eagle Mountain / Utah County local-geo yaml.

These are correctly config/data-isolated already; do **not** propagate them.

## Historical Artifacts (do not propagate)

- **`ZCTA_CENTROICS`/`ZIP_RADIUS_MI`/Brigham hardcode in `index.ts`** — a single
  `84302` centroid literal survives from the pilot; superseded by
  `zip_centroids` (12,722 rows). Dead pilot constant.
- **`source_type=keyword`** (Google News builder) — barred by wiring Rule #0; no
  live feed uses it; the code path should be removed, not copied.
- **`be-*` retired feeds** (`active=FALSE`: stratos-county-page, calendar-meetings,
  redevelopment, stratos-water-filings, emerging topics) — kept for provenance;
  do not treat as a template.
- **Two disagreeing config stores** (`feeds.csv` vs `public.feeds`) — the CSV is a
  legacy master that now lags; reconcile, don't perpetuate.
- **URL-substring platform dispatch** in `fetch_items` — should be a `platform`
  field.

## Missing Capabilities (required by the backbone, absent in one/both)

1. **A rich page-state model.** Today `app_community_meta.data_quality ∈
   {pass, coverage_coming}` — a 2-value bucket. It **cannot distinguish**
   honestly-empty vs missing-connector vs failed-ingest vs stale vs
   unsupported-source. This task explicitly forbids using "coverage coming" as a
   generic bucket. **This is the single most important missing capability.**
2. **One scheduler / one refresh contract.** Ingest runs GitHub-Actions-2h; the
   engine runs pg_cron-daily; they never coordinate. And the engine refresh
   **does not scale**: nightly `collect` lands only ~hundreds/night (418, 19, 12,
   112 over the last 4 days) because it fires all reports at once and captures
   only 200s in a 20-min window → **6,536 reports >2 days stale**. A national
   backbone needs a batched/paginated refresh (N ZIPs per tick) or a work queue.
3. **A unified connector interface** across the two repos (above).
4. **City-topic wiring** — the Tremonton/Brigham `City government (X)` topics are
   advertised but unwired; the backbone needs an explicit "topic has ≥1 feed"
   invariant so a subscribable topic is never empty by construction.
5. **Config single-source-of-truth** — regenerate `feeds.csv` from `public.feeds`
   (or make the CSV the sole writer) so the master of record is unambiguous.
6. **Cross-repo failure observability** — `feed_health` (ingest) and cron status
   (engine) are separate; there is no one place that says "county X, class Y,
   last good refresh Z, state S."

## Proposed Backbone Specification

1. **Canonical data contracts** — `communities` (backbone), `alerts`/`meetings`
   (ingest output), `development_reports.sites` (engine cache), `app_projects`/
   `app_changes`/`app_community_meta` (page), `property_reports`. Unchanged; these
   already carry every geography.
2. **Required source metadata** — every source (ingest *or* engine) declares:
   `registry_id, platform, endpoint, jurisdiction, coverage:[{state,county}],
   record_class, column_map|category, dedupe_key, freshness_window`.
3. **Connector interface** — `fetch(entry, zip|community) → NormalizedRecord[]`
   + `run_report{fetched, kept, unmapped_status[], excluded[], quarantined[]}`.
   The engine's `SocrataDeps`/`SocrataRunReport` is the reference; ingest adopts it.
4. **Configuration schema** — one declarative registry per side, `platform`-keyed
   (no URL-substring dispatch), `coverage[]` mandatory.
5. **Normalized record schema** — engine `NormalizedRecord`
   (title/status_raw/type/file_date/decision_date/lat/lng/case_number/zip/
   record_url/scope/relevance) is canonical; ingest `alerts`/`meetings` map onto
   the same identity fields.
6. **Identity & dedup** — the v22 exact-identity key is canonical for records;
   `UNIQUE(community_id, source_url)` for notices; both keep `case_number` +
   `file_date` so re-issues and per-unit filings survive.
7. **Geographic assignment** — coverage-gate first; per-record point when present;
   area items anchor at report centroid; geocode geofence 25 mi; sanity fence
   100 mi; content anchored at chain root, page-scoped by ancestor topic set.
8. **Cache contract** — `development_reports` (engine, per ZIP, `sites` + `counts`
   + `refreshed_at`); alerts/meetings are their own cache; both keyed to survive
   idempotent re-runs.
9. **Materialization contract** — `app_refresh_zip` is the sole writer of
   `app_*`; caps (dev 48, fac 16, changes per-class) are explicit and **must
   `log()` what they drop** (no silent truncation); `dev_sites_deduped` safeguard
   always on.
10. **Refresh & retry** — one scheduler abstraction; **batched** (N per tick,
    sized so a full sweep completes in ≤24 h at 12,722); transient-safe upsert
    (never blank a good row); idempotent; per-source retry with backoff.
11. **Freshness & failure states** — replace the 2-value bucket with an explicit
    enum (below).
12. **Page rendering contract** — `maps.html` (3 modes, hover, one panel, mobile)
    + `community.html` cascade; unchanged, already canonical.
13. **Email-alert contract** — `digest.py` two-stream (notices/meetings, news
    rides with notices), one send window, per-`community_id` topic match.
14. **Observability & audit receipts** — one cross-repo health view:
    `(state, county, record_class, last_good_refresh, source_state, item_count)`;
    `feed_health` + cron status feed it; connector run-reports persisted.
15. **Launch-readiness for a new county** — national baseline present (EPA floor
    materialized) **and** at least the local-government meeting feed wired and
    title-verified **and** every advertised `government_topic` has ≥1 feed **and**
    resolution probe + `verify-*` CI green.

**Required explicit state enum** (replaces `coverage_coming`):

| State | Meaning |
|---|---|
| `populated` | ≥1 real qualifying record materialized |
| `honestly_empty` | all required+available source checks ran, returned 0 |
| `baseline_only` | national floor present, no local-gov connector yet |
| `unsupported_source` | the county's platform has no adapter yet |
| `temporarily_unavailable` | a configured source failed this cycle |
| `failed_ingest` | a configured source is erroring persistently |
| `stale` | last good refresh older than the class freshness window |

## Scale Test Against Other Geographies

Chosen to exercise **three different government platforms** already in production
(not implemented further — evaluation only):

1. **Clark County, NV — Granicus RSS (110 meetings).** Backbone fit: ✓ ingest
   `parse_granicus_rss` is platform-generic (URL-matched, not NV-specific); writes
   `meetings` on the county root; materializes to `app_changes`. **Reveals:** no
   Box-Elder assumption — but exposes the *state-model* gap (Clark ZIPs with only
   meetings + EPA floor read `coverage_coming` on the marker page even though
   meetings exist, because `data_quality` keys on markers/changes count, not
   record class). Needs the enum.
2. **Mecklenburg County, NC — Legistar (25 meetings).** Backbone fit: ✓
   `adapters/legistar.py` via `legistar.com` dispatch. **Reveals:** the
   URL-substring dispatch works but is not declarative; a `platform:"legistar"`
   field would be cleaner. No geographic leakage (own `community_id`).
3. **Travis County, TX — CivicClerk (Del Valle itself) + Austin Socrata/ArcGIS
   permits.** Backbone fit: ✓ both halves on one chain. **Reveals:** the two
   *schedulers* problem most sharply — permits refresh on pg_cron-daily (and are
   in the 6,536 stale set), meetings on GitHub-2h; a resident sees fresh meetings
   and stale permits with no signal distinguishing them.

**Conclusion:** the backbone is genuinely reusable — the same code serves all
three unchanged from config. The residual Box-Elder/Del-Valle assumptions are
*not* in the connectors; they are in (a) the coarse state model, (b) the
split refresh/scheduler, (c) the config split-brain. All three are P0 below.

## P0 / P1 / P2 Implementation Plan

**P0 — required before national scaling**
- Replace `data_quality` 2-value bucket with the explicit state enum (migration
  on `app_community_meta`; `app_refresh_zip` computes it per record class). Risk:
  touches the page's empty-state copy; rollback = keep `data_quality` column in
  parallel until verified.
- Batch the engine refresh: rewrite `dev_refresh_fire/collect` to sweep N ZIPs
  per hourly tick (full sweep ≤24 h) with a cursor; keep transient-safe upsert.
  Risk: none to data (idempotent); rollback = revert cron body. **Fixes the 6,536
  stale.**
- Reconcile config source of truth: regenerate `feeds.csv` from `public.feeds`
  (or make one the writer); add a CI check that they match. Risk: low (read-only
  compare first).
- Add the "every advertised `government_topic` has ≥1 feed" invariant as a
  `verify-communities` assertion; wire or unadvertise Tremonton/Brigham city
  topics. Risk: low.
- Extract a shared connector-run-report + one cross-repo health view. Risk: low
  (additive/observability).

**P1 — required for the first expansion cohort**
- Externalize ingest platform dispatch: add a `platform` column to
  `public.feeds`, replace the `fetch_items` URL-substring branch. Risk: medium
  (behavioral); rollback = keep URL fallback.
- Make caps non-silent: `app_refresh_zip` logs dropped-over-cap counts into the
  run report. Risk: none.
- One scheduler abstraction (or at least a shared freshness contract + a single
  "last good refresh" surface both pipelines write).
- **Recommended first expansion cohort:** the 3 scale-test counties (Clark NV /
  Mecklenburg NC / Travis TX) — they already have live meeting feeds and exercise
  all three platforms, so they validate the enum + batched refresh on real data
  before widening.

**P2 — later enrichment**
- Retire historical artifacts: the `84302` centroid literal, the `keyword`/Google
  path, the retired `be-*` rows as templates.
- Add local-news/global/emerging config to development-first counties (Del Valle
  has none) where first-party sources exist.
- Broaden permit connectors to civic-first counties (Box Elder has few) where a
  county permit portal exists.
- Property-dossier (`property_reports`) beyond TX where an address source exists.

## Unresolved Conflicts

1. **`feeds.csv` (196) vs `public.feeds` (246).** Reconciled *for behavior* (DB is
   authoritative, ingest is DB-first) but **not repaired**: the CSV master of
   record is stale by ~50 government-content feeds. Must be regenerated (P0). This
   is a real source-of-truth conflict, surfaced not hidden.
2. **`data_quality` semantics vs record class.** A ZIP with meetings but no
   markers can read `coverage_coming` on the Maps meta even though civic content
   exists — the state field measures marker/change presence, not "was every
   supported source checked." Not a data bug; a modeling gap (P0 enum).
3. **Freshness truth vs cron "succeeded."** `cron.job_run_details` says the engine
   refresh `succeeded 4/4`, yet 6,536 reports are >2 days stale — the job succeeds
   but does little work per run. "Succeeded" and "current" disagree; the enum's
   `stale` state + batched refresh reconcile it.

_No conflict was left silent; each is either reconciled above or filed as P0._

## Recommended Next Action

Do **not** widen counties yet. Land the P0 set on the 3 scale-test counties first:
ship the state enum + batched refresh + config reconciliation + topic-coverage
invariant, verify freshness recovers (6,536 → ~0 stale) and the enum renders
honest states on Clark/Mecklenburg/Travis, then adopt those four changes as the
canonical backbone and open the first expansion cohort. Every claim above is tied
to the production evidence cited; the two operational conflicts (config split,
freshness gap) are the gating items and are both P0.
