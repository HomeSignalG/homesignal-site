# Map + event identity backbone

Status: **site-side backbone shipped in this PR**; ingest/DB migration parked for follow-up.

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

### Upstream gaps

1. **`app_refresh_zip`** (`docs/app-maps-backbone-migration.sql` lines 138–145) inserts one `app_changes` row per `meetings` row but:
   - sets `occurred_at = current_date` on every refresh (not the meeting date)
   - carries no `meeting_id`, `canonical_event_id`, or `dedupe_key`
   - has no `(zip, source_ref)` uniqueness constraint

2. **`homesignal-ingest`** (not in this session — repo inaccessible):
   - must upsert `meetings` on `dedupe_key` / `source_url`
   - must not create duplicate `meetings` rows on re-ingest
   - CivicClerk/Legistar/Granicus adapters should stamp stable `dedupe_key`

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

## Migrations required

See `docs/map-event-identity-migration.sql`:

- Add identity columns to `app_changes`
- Unique index on `(zip, source_ref)` where non-empty
- Update `app_refresh_zip` meeting insert (fragment in migration file)
- Ingest: upsert `meetings` on `dedupe_key` (homesignal-ingest — separate PR)

## Tests

```bash
node --test test/map-events.test.mjs test/map-runtime.test.mjs test/recent-changes.test.mjs
node scripts/audit-map-identity.mjs
```

## PR #323 verdict

**Option B** — PR #323 commits are superseded by this backbone PR on the same branch. **Do not merge #323 as a page-only fix.**

Merge-blocking until:

1. Site backbone tests green (this PR)
2. `audit-map-identity.mjs` green on production
3. `map-event-identity-migration.sql` applied + `app_refresh_all` re-run
4. Ingest dedupe keys verified (homesignal-ingest PR)

## Rollback

- Site: revert `lib/map-runtime.js`, `lib/map-events.js`, `maps.html` controller wiring
- DB: see rollback stanza in `docs/map-event-identity-migration.sql`
