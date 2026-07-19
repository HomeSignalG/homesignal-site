# Government feed onboarding — Phase 1A workflow

Operator runbook for county **Meetings** feeds via Granicus, Legistar, and CivicClerk.

**Repo ownership:** automation belongs in **`homesignal-ingest`** (see
`docs/gov-feeds-migration-to-ingest.md`). This site repo hosts the scripts
interim until migration; **`feeds.csv` is NOT duplicated here** — point
`FEEDS_CSV` at `homesignal-ingest/feeds.csv`.

---

## Architecture

```
homesignal-ingest/feeds.csv  ──sync──►  public.feeds  ──load_config──►  ingest  ──►  meetings
       ▲                                      │
       │         discover / probe / candidate   │
       └──────────────────────────────────────┘
```

### Production contract

Column **presence** on `public.feeds` was verified 2026-07-19 via PostgREST
(`select=<col>&limit=1` → 200). Types, defaults, nullability, and constraints
are **not** verified here — see `docs/gov-feeds-schema.sql` (illustrative DDL,
not an extracted production schema).

**feeds.csv:** canonical header (parsed by column name; order-independent).
Known columns: `feed_id`, `county`, `community_id`, `source`, `source_type`,
`category`, `pipeline_type`, `agency_name`, `geographic_reference`,
`impact_level`, `active`, `sort_order`, `target_table`, `filter`, `dedupe_on`,
`status / notes`. Authoritative file: `homesignal-ingest/feeds.csv`.

| Column | Notes |
|--------|-------|
| `feed_id` | Primary key (text slug) |
| `county` | Denormalized county label (operator metadata; ingest routes by `community_id`; DB nullability/default unverified) |
| `community_id` | County root UUID |
| `source` | Feed URL (**not** `source_url`) |
| `source_type` | `rss` \| `keyword` \| `html` \| `email` |
| `category` | `County Commission & county business` (canonical topic label — must match ingest/topics word-for-word) |
| `pipeline_type` | `government_notice` |
| `agency_name` | Board display name |
| `geographic_reference` | e.g. `Wake County, NC` |
| `impact_level` | Typical value `medium` (script default; DB default unverified) |
| `active` | Candidates use `false` until go-live (script default; DB default unverified) |
| `sort_order` | Typical value `0` (script default; DB default unverified) |
| `target_table` | `alerts` or `meetings` (engine routing; script default for candidates: `meetings`; DB default unverified) |
| `filter_expr` | Optional vendor/body filter (`filter` in CSV) |
| `dedupe_on` | Optional dedupe key (e.g. `guid\|link`) |
| `status / notes` | Operator notes in feeds.csv (maps to `status_notes` in DB) |
| `updated_at` | DB-managed (read-only) |

**feeds.csv column aliases:** `filter` → `filter_expr`; `status / notes` → `status_notes`. Unknown spreadsheet columns are warned and ignored.

**Vendor → production `source_type`:**

| Vendor | `source_type` | `source` pattern |
|--------|---------------|------------------|
| Granicus | `rss` | `*.granicus.com/ViewPublisherRSS.php?...&mode=agendas` |
| Legistar | `html` | `*.legistar.com/Calendar.aspx` |
| CivicClerk | `html` | `*.portal.civicclerk.com/` |

DDL (illustrative, not extracted from production): `docs/gov-feeds-schema.sql`

---

## Workflow: discover → dry run → verify → candidate → go live

### 1. Discover

```bash
node scripts/gov-feeds/discover-county-vendor.mjs \
  --county "Wake" --state NC \
  --community-id <county-root-uuid> \
  --hints scripts/gov-feeds/examples/wake-hints.json
```

### 2. Dry run

```bash
node scripts/gov-feeds/probe-candidate.mjs --candidate results/gov-feed-discovery.json
```

### 3. Verify (human)

Confirm sample titles are the county commission/council, not a sub-committee.

### 4. Candidate insert

Add row to **`homesignal-ingest/feeds.csv`** (`active=false`) and generate SQL:

```bash
node scripts/gov-feeds/build-candidate-sql.mjs \
  --in results/gov-feed-discovery.json \
  --out docs/candidates/wake-insert.sql
```

Candidate SQL uses `ON CONFLICT (feed_id) DO NOTHING` — **never overwrites or
deactivates** an existing production row.

Sync check:

```bash
FEEDS_CSV=../homesignal-ingest/feeds.csv \
  node scripts/gov-feeds/sync-feeds-config.mjs --live
```

Drift = CSV rows **missing from DB** or **field mismatch** for shared `feed_id`s.
DB-only production feeds are informational, not failures.

### 5. Go live

1. `build-candidate-sql.mjs --activate` → committed SQL
2. `golive-feed` in ingest with `ONLY_FEED=<feed_id>`
3. `verify-candidate-titles.mjs --community-id <uuid>`

---

## Safety rules

- Candidates: `active=false` only
- Insert SQL: `ON CONFLICT DO NOTHING` (no upsert that clobbers `active`)
- Activate SQL: separate `UPDATE … WHERE active=false`
- Sync: does not flag DB-only production feeds as drift

---

## Estimated time per county

**~30–60 minutes** after automation (discover 5–15m, verify 5–10m, insert 10–15m, golive 10–20m).
