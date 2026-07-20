# Map + event identity backbone

Status: **site-side backbone shipped**; **DB migration + Detroit source_ref fix** in `docs/candidates/map-event-identity-apply.sql`; ingest dedupe verified.

## Architecture findings

### Map surfaces (homesignal-site)

| Surface | Stack | Uses shared runtime? |
|---------|-------|----------------------|
| `maps.html` | MapLibre → Leaflet → schematic | Yes — `HS.createMapController` |
| `dashboard.html` | via `HS.buildLive` | Yes — thin wrapper over `createMapController` |
| `homesignalmap.html` | Leaflet 2D + Three.js + MapLibre terrain | **No** — separate tri-view stack (development tracker; documented follow-up) |

### Shared modules

| Module | Responsibility |
|--------|----------------|
| `lib/map-runtime.js` | ONE map lifecycle: init, resize, mode switch, markers, popups, selection, destroy |
| `lib/map-events.js` | Identity model + `normalizeMapItem` + `recentChanges` + honest count lines |
| `lib/map.js` | Pin shapes, schematic provider, facility slots, Leaflet loader (unchanged role) |

Pages configure the runtime; they do not implement `ensureGL`, `drawGL`, `ResizeObserver`, or marker sync.

## Root cause (both repos)

### What looked like "duplicate meetings" in 78617

Production audit (`scripts/audit-map-identity.mjs`):

- **7 `app_changes` rows**, **0 duplicate `source_ref`** — each is a distinct CivicClerk event URL with a different `window_closes_at`.
- Same title template ("Public meeting — Commissioners Court Voting Session") but **separate legitimate occurrences**.

PR #323 title-grouping was **wrong** — it would merge separate recurring meetings.

### 48226 Detroit permit collision (materializer + engine)

Production audit **FAIL** before fix: 5 `app_changes` rows shared one Hub landing-page `source_ref` (`data.detroitmi.gov/datasets/f77e9fd44b7e…`).

Evidence (live `development_reports` site JSON for 48226):

- `case_number`: `ELV2026-00027` (unique per row)
- `record_url_precision`: `dataset` (all trades rows pointed at the same Hub item)
- `source_id`: `arcgis:detroit-trades-permits:ELV2026-00027` (unique)

Fix layers:

1. **Engine** — Detroit BSEED trio now use verified Accela eLAPS record-number URLs (`record_url_template` + `record_url_precision: record` in `jurisdiction-registry.json`). Receipt: `https://aca-prod.accela.com/DETROIT/Cap/CapHome.aspx?module=Permits&TabName=Permits&RecordNumber=ELV2026-00027` returns 302 (official portal; record number preserved in redirect).
2. **DB** — `app_dev_site_source_ref(el)` helper + one-time backfill in `docs/candidates/map-event-identity-apply.sql`; materializer planning/civic inserts should call it (see migration doc).
3. **Re-cache** — after edge-function deploy, re-run `development_reports` refresh for Wayne County ZIPs so cached `record_url` values update.

## Ingest audit (homesignal-ingest)

Verified in `ingest.py` (no code change required):

| Concern | Status | Evidence |
|---------|--------|----------|
| Meetings re-run idempotency | **PASS** | `insert_rows('meetings', …)` upserts on `dedupe_key` with `resolution=merge-duplicates` (lines 1247–1256) |
| Dedupe key stability | **PASS** | `meetings_dedupe_key(community_id, meeting_date, title, location)` — `community_id \| denver_date \| normalize(title)` (+ location suffix for generic titles only) |
| Per-record `source_url` | **PASS** | `build_payload` sets `source_url: it["link"]`; CivicClerk adapter stamps `https://{sub}.portal.civicclerk.com/event/{id}/overview` (one URL per occurrence) |
| Alerts idempotency | **PASS** | `on_conflict: community_id,source_url` with `ignore-duplicates` |
| `canonical_event_id` at ingest | **N/A** | `meetings` table has no identity columns; materializer stamps them on `app_changes` (migration) |

Live DB sample (meetings, 2026-07-20):

```
dedupe_key: d4de538f-…|2027-06-08|county council meeting
source_url: https://saltlakecounty.portal.civicclerk.com/event/4159/overview
```

Each occurrence has a distinct `source_url` and `dedupe_key` — ingest is not the 78617 root cause.

### app_changes / change-generation idempotency

`app_changes` rows are **materialized** by `app_refresh_zip` (site DB), not written by ingest. Idempotency requires:

- unique `(zip, source_ref)` on `app_changes` (migration)
- meetings insert uses `ON CONFLICT (zip, source_ref) DO UPDATE` (migration fragment)
- planning notices use `app_dev_site_source_ref()` instead of bare dataset URLs

## Identity model (`lib/map-events.js`)

| Field | Meaning |
|-------|---------|
| `source_record_id` | Exact external row/document (`source_ref` / vendor id) |
| `canonical_event_id` | One real-world occurrence |
| `series_id` | Recurring body name (never merges occurrences) |
| `change_id` | `app_changes.id` (specific materialized change row) |

Deduplication in the presentation layer is **only** by `canonical_event_id` / `source_ref` — never by normalized title.

## Count semantics

`HS.recentChangesCountLine` reports:

- `displayCards` — distinct events shown
- `rawChangeRecords` — raw in-window `app_changes` rows
- Example: `7 upcoming items near Del Valle · last 30 days` (7 distinct events; not "2 cards")

## Migrations

| File | Purpose |
|------|---------|
| `docs/map-event-identity-migration.sql` | Parked DDL-of-record + rollback |
| `docs/candidates/map-event-identity-apply.sql` | Apply script (audit → schema → backfill → index → refresh) |

Apply:

```bash
gh workflow run db-sql.yml -R HomeSignalG/homesignal-site \
  -f sql_file=docs/candidates/map-event-identity-apply.sql
node scripts/audit-map-identity.mjs   # expect 8/8 PASS
```

## Tests

```bash
node --test test/map-events.test.mjs test/map-runtime.test.mjs test/recent-changes.test.mjs
node scripts/audit-map-identity.mjs
```

## PR #323 verdict

**Option B** — page-only title grouping superseded by this backbone PR. **Do not merge until audit + migration + ingest verification are complete.**

Merge-blocking checklist:

1. Site backbone tests green
2. `audit-map-identity.mjs` 8/8 PASS on production
3. `map-event-identity-apply.sql` applied + `app_refresh_zip` meetings insert patched in live function
4. Ingest dedupe verified (this doc — no ingest PR required)

## Rollback

- Site: revert `lib/map-runtime.js`, `lib/map-events.js`, `maps.html` controller wiring
- DB: see rollback stanza in `docs/map-event-identity-migration.sql`
