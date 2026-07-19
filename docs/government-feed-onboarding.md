# Government feed onboarding — Phase 1A workflow

This document describes the **repeatable county onboarding workflow** for government
**Meetings** content via the three supported vendor adapters (Granicus RSS, Legistar,
CivicClerk). It closes the operational gap between versioned `feeds.csv` authoring and
**DB-first** `public.feeds` (what `homesignal-ingest` `load_config` reads at runtime).

**Scope of Phase 1A:** automation + documentation + CI probes. **No new counties are
wired** and **no existing production feeds are changed** by this build.

---

## Architecture

```
┌─────────────────────┐     sync-feeds-config      ┌──────────────────┐
│ data/gov-feeds/     │ ─────────────────────────► │ public.feeds     │
│ feeds.csv (git)     │     (diff + insert SQL)    │ (Supabase, live) │
└─────────────────────┘                            └────────┬─────────┘
         ▲                                                  │
         │ discover / probe                                   │ load_config
         │                                                  ▼
┌─────────────────────┐                            ┌──────────────────┐
│ vendor discovery  │                            │ homesignal-ingest │
│ (Granicus/Legistar/│                            │ scheduled ingest  │
│  CivicClerk)       │                            └────────┬─────────┘
└─────────────────────┘                                     │
                                                            ▼
                                                   ┌──────────────────┐
                                                   │ public.meetings  │
                                                   └──────────────────┘
```

### Key design choices

1. **`feeds.csv` is the versioned authoring surface** in this repo (`data/gov-feeds/feeds.csv`).
   The ingest repo may keep its own copy; this automation diffs CSV ↔ DB and emits SQL for gaps.

2. **Candidates ship `active=false`.** Inserting a row does not schedule ingest until an operator
   runs go-live (`active=true` + `golive-feed` in ingest).

3. **Discovery is vendor-pattern based**, not state-portal based. One probe pipeline covers all
   50 states for counties on Granicus, Legistar, or CivicClerk.

4. **All scripts are read-only by default** against vendor hosts and production DB. Mutations
   require explicit workflow dispatch + committed SQL.

---

## `public.feeds` row shape

| Column | Required | Notes |
|--------|----------|-------|
| `feed_id` | yes | Stable kebab-case slug (`wake-county-nc-granicus-rss-meetings`) |
| `community_id` | yes | County **root** UUID (`level=county`) |
| `source_url` | yes | Vendor URL (see patterns below) |
| `source_type` | yes | `granicus_rss` \| `legistar` \| `civicclerk` |
| `category` | yes | `County Commission & county business` (verbatim) |
| `pipeline_type` | yes | `government_notice` (engine routing constant) |
| `destination` | yes | `meetings` for vendor adapters |
| `agency_name` | yes | Human board name for display |
| `geographic_reference` | yes | e.g. `Wake County, NC` |
| `impact_level` | no | Default `medium` |
| `active` | yes | `false` until go-live |
| `notes` | no | Discovery provenance |

DDL reference: `docs/gov-feeds-schema.sql`.

### Vendor URL patterns (verified live counties)

| Vendor | `source_type` | `source_url` pattern |
|--------|---------------|----------------------|
| Granicus | `granicus_rss` | `https://<entity>.granicus.com/ViewPublisherRSS.php?view_id=<N>&mode=agendas` |
| Legistar | `legistar` | `https://<client>.legistar.com/Calendar.aspx` |
| CivicClerk | `civicclerk` | `https://<sub>.portal.civicclerk.com/` (engine reads `<sub>.api.civicclerk.com/v1/Events`) |

Receipts: `docs/state-notice-portals.md` (13 live non-Utah counties, 2026-07).

---

## Workflow: discover → dry run → verify → insert → go live

### Step 0 — Preflight

- County root exists in `public.communities` (`level=county`) with the six canonical
  `government_topics` (or `[]` until content lands — meetings still work).
- Capture `community_id` and optional vendor hints (known entity/client/sub from the county website).

### Step 1 — Discover

**Local (runner with egress):**

```bash
node scripts/gov-feeds/discover-county-vendor.mjs \
  --county "Wake" --state NC \
  --community-id <county-root-uuid> \
  --hints scripts/gov-feeds/examples/wake-hints.json \
  --out results/wake-discovery.json
```

**CI:** Actions → `discover-gov-feed` → provide county, state, community_id, optional hints file.

Output: `results/gov-feed-discovery.json` with ranked hits + a top `candidates[]` row (`active=false`).

### Step 2 — Dry run (read-only probe)

```bash
node scripts/gov-feeds/probe-candidate.mjs \
  --candidate results/wake-discovery.json
```

**CI:** `dryrun-gov-feed` workflow (manual dispatch, candidate artifact path).

Pass criteria:
- **Granicus:** HTTP 200, ≥1 RSS `<item>`, title mentions commission/council/board
- **Legistar:** HTTP 200, calendar page markers
- **CivicClerk:** OData API returns ≥1 event

### Step 3 — Verify (human + title check)

1. Confirm the probe's sample titles are the **county commission/council**, not a sub-committee.
2. Add the candidate row to `data/gov-feeds/feeds.csv` (still `active=false`) and open a PR.
3. Run sync diff (Step 4) to confirm the row is absent from `public.feeds` until insert.

### Step 4 — Insert (DB row, still inactive)

```bash
node scripts/gov-feeds/build-candidate-sql.mjs \
  --in results/wake-discovery.json \
  --out docs/candidates/wake-county-nc-insert.sql
```

Apply via **db-sql** workflow (committed SQL only) OR ingest-repo insert script.

Then sync-check:

```bash
node scripts/gov-feeds/sync-feeds-config.mjs \
  --csv data/gov-feeds/feeds.csv --live
```

**CI:** `sync-feeds-config` (scheduled + manual) — fails when CSV and DB diverge.

### Step 5 — Go live

1. Set `active=true` on the row (committed SQL: `build-candidate-sql.mjs --activate`).
2. Run **`golive-feed`** in `homesignal-ingest` with `ONLY_FEED=<feed_id>` (single-feed ingest).
3. Title-verify meetings landed:

```bash
node scripts/gov-feeds/verify-candidate-titles.mjs \
  --community-id <county-root-uuid> \
  --pattern "Commission|Council|Court"
```

**CI:** `verify-gov-feed-candidate` after go-live (manual, requires service role).

---

## Scripts reference

| Script | Purpose |
|--------|---------|
| `scripts/gov-feeds/discover-county-vendor.mjs` | Vendor discovery for one county |
| `scripts/gov-feeds/probe-candidate.mjs` | Read-only dry-run probe |
| `scripts/gov-feeds/build-candidate-sql.mjs` | Render idempotent INSERT/activate SQL |
| `scripts/gov-feeds/sync-feeds-config.mjs` | CSV ↔ DB diff (+ optional insert SQL) |
| `scripts/gov-feeds/verify-candidate-titles.mjs` | Post-ingest board title verification |

Libraries live under `scripts/gov-feeds/lib/` (`schema`, `vendors`, `candidates`, `sync`, `csv-io`).

---

## Tests

Offline regression: `node test/gov-feeds.test.mjs` (also run via `scripts/run-unit-tests.mjs`).

Fixtures: `fixtures/gov-feeds/` (Granicus RSS, Legistar HTML, CivicClerk JSON).

---

## Estimated onboarding time per county (after automation)

| Phase | Operator time | Notes |
|-------|---------------|-------|
| Discover + dry run | **5–15 min** | Automated probe; hints reduce false tries |
| Human title/board verify | **5–10 min** | Confirm correct governing body |
| Insert + sync PR | **10–15 min** | Committed SQL + CSV row, CI sync green |
| Go live + title verify | **10–20 min** | `golive-feed` + meetings spot-check |
| **Total per county** | **~30–60 min** | Assumes vendor hit on first discovery pass |

Counties with no Granicus/Legistar/CivicClerk hit remain **out of scope** for this pipeline
(bespoke portal work — see `docs/state-notice-portals.md`).

Batch throughput: discovery workflows can run in parallel per county; sync CI catches drift
across the full feed set nightly.

---

## What Phase 1A explicitly does NOT do

- Wire new counties to production (candidates only, `active=false`)
- Modify existing production feed rows
- Change site UI (`community.html` untouched)
- Replace ingest adapters (they already exist in `homesignal-ingest`)

Phase 1B (separate build): wire the first batch of counties using this workflow end-to-end.
