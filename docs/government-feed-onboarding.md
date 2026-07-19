# Government feed onboarding — Phase 1A workflow

Operator runbook for county **Meetings** feeds via Granicus, Legistar, and CivicClerk.

**Full operator runbook:** `docs/government-feed-onboarding-operator.md` (step-by-step,
Go/No-Go, rollback, secrets, and ingest checkout).

> **Pilot A supersession notice.** This document describes the **Phase 1A**
> manual workflow. For **Phase 1B** county onboarding (registry-tracked state
> machine, activation gates — Wake County Pilot A onward), the execution
> authority is the **Pilot A documentation set**: start at
> `docs/government-feed-phase1b-pilot-a-plan.md` (plan + canonical execution
> order), alongside the staging execution plan, operator runbook, Go/No-Go,
> rollback, and completion checklists
> (`docs/government-feed-phase1b-pilot-a-*.md`). Phase 1A remains the
> reference for the underlying tools.

**Repo ownership:** automation belongs in **`homesignal-ingest`** (see
`docs/gov-feeds-migration-to-ingest.md`). This site repo hosts the scripts
interim until migration; **`feeds.csv` is NOT duplicated here** — point
`FEEDS_CSV` at `homesignal-ingest/feeds.csv`.

---

## Prerequisites

### Checkout homesignal-ingest

Sync and authoring require the ingest repo. Clone it beside this repo (or into
`homesignal-ingest/` for CI) so `FEEDS_CSV` resolves to a real `feeds.csv`.
The **`sync-feeds-config`** workflow defaults to `homesignal-ingest/feeds.csv`
and fails if that path is missing — see `docs/gov-feeds-migration-to-ingest.md`
for the two-repo checkout pattern (`INGEST_REPO_TOKEN` optional).

### Secrets

| Secret | Workflow / script |
|--------|-------------------|
| `SUPABASE_ACCESS_TOKEN` | `insert-gov-feed-candidate` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sync-feeds-config`, `verify-gov-feed-candidate` |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` | Local `sync-feeds-config.mjs --live`, `verify-candidate-titles.mjs` |

### feed_id naming

`feed_id` is derived from the `--county` string at discovery time. Use the
**same** label everywhere (discovery, `feeds.csv`, SQL, golive, verify).

| `--county` | Example `feed_id` (Granicus) |
|------------|------------------------------|
| `"Wake"` | `wake-nc-granicus-meetings` |
| `"Wake County"` | `wake-county-nc-granicus-meetings` |

Discovery prints the candidate `feed_id` when `--community-id` is set. Record
it before editing `feeds.csv`.

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

## GitHub Actions workflows (homesignal-site)

| Workflow | Purpose |
|----------|---------|
| `discover-gov-feed` | Vendor discovery |
| `dryrun-gov-feed` | Read-only candidate probe |
| `insert-gov-feed-candidate` | Apply INSERT SQL (`active=false` only) |
| `sync-feeds-config` | Diff `feeds.csv` vs `public.feeds` |
| `verify-gov-feed-candidate` | Post-ingest title verification |

Go-live ingest: **`golive-feed`** in **`homesignal-ingest`** (not this repo).

---

## Workflow: discover → dry run → verify → candidate → go live

### 1. Discover

```bash
node scripts/gov-feeds/discover-county-vendor.mjs \
  --county "Wake County" --state NC \
  --community-id <county-root-uuid> \
  --hints scripts/gov-feeds/examples/wake-hints.json
```

Workflow: **`discover-gov-feed`**

### 2. Dry run

```bash
node scripts/gov-feeds/probe-candidate.mjs --candidate results/gov-feed-discovery.json
```

Workflow: **`dryrun-gov-feed`**

### 3. Verify (human)

Confirm sample titles are the county commission/council, not a sub-committee.

### 4. Candidate insert

Generate INSERT SQL **without** `--activate` (the insert workflow rejects files
that contain activate SQL):

```bash
node scripts/gov-feeds/build-candidate-sql.mjs \
  --in results/gov-feed-discovery.json \
  --out docs/candidates/wake-county-nc-insert.sql
```

Apply via workflow **`insert-gov-feed-candidate`** (`sql_file` under
`docs/candidates/*.sql`).

Add a matching row to **`homesignal-ingest/feeds.csv`** (`active=false`).

Candidate SQL uses `ON CONFLICT (feed_id) DO NOTHING` — **never overwrites or
deactivates** an existing production row.

Sync check:

```bash
FEEDS_CSV=../homesignal-ingest/feeds.csv \
SUPABASE_URL=https://qwnnmljucajnexpxdgxr.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
node scripts/gov-feeds/sync-feeds-config.mjs --live
```

Workflow: **`sync-feeds-config`** (requires `homesignal-ingest/feeds.csv` on the runner).

Drift = CSV rows **missing from DB** or **field mismatch** for shared `feed_id`s.
DB-only production feeds are informational, not failures.

### 5. Go live

1. **`golive-feed`** in **`homesignal-ingest`** with `ONLY_FEED=<feed_id>`
2. Title verify:

   ```bash
   node scripts/gov-feeds/verify-candidate-titles.mjs \
     --community-id <county-root-uuid> \
     --feed-id <feed_id>
   ```

   Workflow: **`verify-gov-feed-candidate`**

3. **Activate separately** (manual — only after title verify passes):

   ```sql
   UPDATE public.feeds
   SET active = true, updated_at = now()
   WHERE feed_id = '<feed_id>' AND active = false;
   ```

   Then set `active=true` in `feeds.csv` and re-run sync.

Do **not** use `build-candidate-sql.mjs --activate` for files submitted to
**`insert-gov-feed-candidate`** — activation must stay in a separate step.

---

## Safety rules

- Candidates: `active=false` only
- Insert SQL: `ON CONFLICT DO NOTHING` (no upsert that clobbers `active`)
- Activate SQL: separate `UPDATE … WHERE active=false` (not in insert files)
- Sync: does not flag DB-only production feeds as drift

---

## Estimated time per county

**~30–60 minutes** after automation (discover 5–15m, verify 5–10m, insert 10–15m, golive 10–20m).

See **`docs/government-feed-onboarding-operator.md`** for the full checklist and rollback steps.
