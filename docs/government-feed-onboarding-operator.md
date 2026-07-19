# Government feed onboarding — Operator Runbook (Phase 1A)

Step-by-step guide for onboarding **one** county **Meetings** feed (Granicus,
Legistar, or CivicClerk). Candidates stay `active=false` until title verification
passes; activation is a **separate** manual step.

**Suggested first county:** Wake County, NC (`slug = wake-county-nc`).

> **Pilot A supersession notice.** For **Phase 1B** county onboarding (the
> governed `feed_candidates` state machine — Wake County Pilot A onward), this
> Phase 1A runbook is superseded as the execution authority by the **Pilot A
> documentation set** — start at `docs/government-feed-phase1b-pilot-a-plan.md`.
> The steps below remain the reference for the underlying tools
> (discover / probe / insert / sync / verify), which Pilot A reuses.

**Companion docs:**

- Workflow summary: `docs/government-feed-onboarding.md`
- Schema reference: `docs/gov-feeds-schema.sql`
- Ingest migration: `docs/gov-feeds-migration-to-ingest.md`
- Candidate SQL rules: `docs/candidates/README.md`
- **Phase 1B Pilot A (supersedes this doc for Phase 1B execution):** `docs/government-feed-phase1b-pilot-a-plan.md`

---

## Prerequisites

### Repositories

Check out **both** repos side by side:

| Repo | Purpose |
|------|---------|
| `homesignal-site` | Discovery, probe, SQL generation, sync check, title verify |
| `homesignal-ingest` | `feeds.csv` authoring, `golive-feed` ingest |

`feeds.csv` is **not** duplicated in the site repo. Point `FEEDS_CSV` at
`homesignal-ingest/feeds.csv` (or `../homesignal-ingest/feeds.csv` from the
site root).

For the **`sync-feeds-config`** GitHub Actions workflow, `homesignal-ingest`
must be present at `homesignal-ingest/feeds.csv` in the runner workspace
(checkout ingest into that path, or pass a valid `feeds_csv` input). See
`docs/gov-feeds-migration-to-ingest.md` for the two-repo CI checkout pattern.

### Secrets (GitHub Actions)

| Secret | Used by |
|--------|---------|
| `SUPABASE_ACCESS_TOKEN` | `insert-gov-feed-candidate` |
| `SUPABASE_SERVICE_ROLE_KEY` | `sync-feeds-config`, `verify-gov-feed-candidate` |
| `INGEST_REPO_TOKEN` | Optional — checkout `homesignal-ingest` in CI (see migration doc) |

Local CLI runs need `SUPABASE_URL` plus `SUPABASE_SERVICE_ROLE_KEY` for
`sync-feeds-config.mjs --live` and `verify-candidate-titles.mjs`.

### County root UUID

Resolve the county root before discovery:

```sql
select id, name, slug
from public.communities
where slug = 'wake-county-nc'
  and level = 'county';
```

Use the returned `id` as `<COUNTY_ROOT_UUID>` below.

---

## feed_id naming (read before you start)

`feed_id` is derived from the `--county` string passed to discovery. The slug
must match **everywhere**: discovery JSON, `feeds.csv`, INSERT SQL, golive, and
title verification.

| `--county` value | Example `feed_id` (Granicus) |
|----------------|------------------------------|
| `"Wake"` | `wake-nc-granicus-meetings` |
| `"Wake County"` | `wake-county-nc-granicus-meetings` |

**Standing rule:** pick one county label and use it for the whole run. This
runbook uses **`"Wake County"`** to align with the community DB `name` field
and test fixtures.

Discovery prints the top candidate `feed_id` when `--community-id` is supplied.
Record it before editing `feeds.csv`.

---

## Phase 1A workflows (homesignal-site)

| Workflow | Purpose |
|----------|---------|
| `discover-gov-feed` | Vendor discovery → JSON artifact |
| `dryrun-gov-feed` | Read-only probe of a candidate |
| `insert-gov-feed-candidate` | Apply committed INSERT SQL (`active=false` only) |
| `sync-feeds-config` | Diff `feeds.csv` vs `public.feeds` |
| `verify-gov-feed-candidate` | Post-ingest title verification |

**Ingest repo only (not in homesignal-site):**

| Workflow | Purpose |
|----------|---------|
| `golive-feed` | Single-feed live ingest (`ONLY_FEED=<feed_id>`) |
| `dryrun-feed` | Ingest-side dry run (distinct from `dryrun-gov-feed`) |

---

## Step 1 — Discover

**CLI:**

```bash
node scripts/gov-feeds/discover-county-vendor.mjs \
  --county "Wake County" --state NC \
  --community-id "<COUNTY_ROOT_UUID>" \
  --hints scripts/gov-feeds/examples/wake-hints.json \
  --out results/gov-feed-discovery.json
```

**GitHub Actions:** run **`discover-gov-feed`** with `county`, `state`,
`community_id`, and optional `hints_file` =
`scripts/gov-feeds/examples/wake-hints.json`.

**Output:** `results/gov-feed-discovery.json` (artifact in CI).

**Exit:** non-zero only on usage errors (`exit 2`).

---

## Step 2 — Dry run

**CLI:**

```bash
node scripts/gov-feeds/probe-candidate.mjs \
  --candidate results/gov-feed-discovery.json
```

**GitHub Actions:** run **`dryrun-gov-feed`** with `candidate_json` =
`results/gov-feed-discovery.json` (or a committed fixture path).

**Pass criteria:** exit `0`. Exit `1` = probe failed; exit `2` = usage/validation
error.

Alternative (URL-only probe):

```bash
node scripts/gov-feeds/probe-candidate.mjs \
  --url "https://wake.granicus.com/ViewPublisherRSS.php?view_id=18&mode=agendas" \
  --vendor granicus
```

---

## Step 3 — Human verification

Review dry-run sample titles. Confirm they are the **county commission or
council**, not a sub-committee or unrelated board.

**Do not proceed** if titles look wrong — re-run discovery with better hints or
pick a different vendor hit.

---

## Step 4 — Generate INSERT SQL (no `--activate`)

**Do not pass `--activate`** when generating SQL for the insert workflow.
`--activate` appends `UPDATE … SET active = true` to the same file; the
**`insert-gov-feed-candidate`** workflow refuses files that contain activate SQL.

```bash
node scripts/gov-feeds/build-candidate-sql.mjs \
  --in results/gov-feed-discovery.json \
  --out docs/candidates/wake-county-nc-insert.sql
```

Commit the SQL under `docs/candidates/`. Requirements (enforced by the insert
workflow):

- Path: `docs/candidates/*.sql` only
- `active=false` in VALUES
- `ON CONFLICT (feed_id) DO NOTHING` — never upsert or deactivate production
- **No** `UPDATE … active = true` in insert files

---

## Step 5 — Apply INSERT to database

**GitHub Actions:** run **`insert-gov-feed-candidate`** with
`sql_file=docs/candidates/wake-county-nc-insert.sql`.

Requires `SUPABASE_ACCESS_TOKEN`. Row lands in `public.feeds` with
`active=false`.

---

## Step 6 — Author feeds.csv (homesignal-ingest)

In **`homesignal-ingest`**, add a matching row to `feeds.csv` with
`active=false`. Every field must match the INSERT SQL and discovery output —
especially `feed_id`, `community_id`, `source`, and `source_type`.

Commit and merge the ingest change on its normal branch workflow.

---

## Step 7 — Sync check

Confirm `feeds.csv` and `public.feeds` agree.

**CLI:**

```bash
FEEDS_CSV=../homesignal-ingest/feeds.csv \
SUPABASE_URL=https://qwnnmljucajnexpxdgxr.supabase.co \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
node scripts/gov-feeds/sync-feeds-config.mjs --live
```

**Pass criteria:** exit `0` (no drift). Exit `1` = CSV/DB mismatch.

**GitHub Actions:** run **`sync-feeds-config`**. Ensure `homesignal-ingest/feeds.csv`
exists on the runner (checkout ingest first, or set `feeds_csv` to a valid path).

Drift means: CSV rows missing from DB, or field mismatch for shared `feed_id`s.
DB-only production feeds are informational, not failures.

---

## Step 8 — Golive ingest (homesignal-ingest)

In the **`homesignal-ingest`** repo, run workflow **`golive-feed`** with
`ONLY_FEED=<feed_id>` (e.g. `wake-county-nc-granicus-meetings`).

This runs a scoped live ingest so `public.meetings` receives rows for review.
The feed may still be `active=false` in the database during this test — confirm
ingest behavior in the ingest repo if unsure.

---

## Step 9 — Title verification

**CLI:**

```bash
SUPABASE_URL=https://qwnnmljucajnexpxdgxr.supabase.co \
SUPABASE_SERVICE_ROLE_KEY="<service-role-key>" \
node scripts/gov-feeds/verify-candidate-titles.mjs \
  --community-id "<COUNTY_ROOT_UUID>" \
  --feed-id "<FEED_ID>"
```

**GitHub Actions:** run **`verify-gov-feed-candidate`** with `community_id`
and `feed_id`. Optional: `title_pattern`, `min_match_ratio` (default `0.8`).

**Pass criteria:** exit `0`, match ratio ≥ `min_match`. Exit `1` if no
meetings found (run golive first) or titles fail the pattern.

---

## Step 10 — Activate (separate manual step)

**Only after Step 9 passes.** Activation is **not** part of the insert workflow
and must not be bundled into insert SQL files.

Run in Supabase SQL editor or via the site **`db-sql`** workflow:

```sql
UPDATE public.feeds
SET active = true,
    updated_at = now()
WHERE feed_id = '<FEED_ID>'
  AND active = false;
```

Then set `active=true` for the same `feed_id` in `homesignal-ingest/feeds.csv`
and re-run the sync check (Step 7) to confirm exit `0`.

---

## Go / No-Go checklist (before Step 10)

- [ ] Dry run exit `0`
- [ ] Human title review passed (Step 3)
- [ ] INSERT applied; row exists with `active=false`
- [ ] `feeds.csv` row matches DB (sync exit `0`)
- [ ] `golive-feed` produced meetings in `public.meetings`
- [ ] `verify-candidate-titles` exit `0` (ratio ≥ 0.8)

**No-Go:** any failed check above — do **not** activate.

---

## Rollback

If something is wrong after insert but before or after activation:

1. Deactivate in DB:

   ```sql
   UPDATE public.feeds
   SET active = false, updated_at = now()
   WHERE feed_id = '<FEED_ID>';
   ```

2. Set `active=false` (or remove the row) in `homesignal-ingest/feeds.csv`.

3. Re-run sync to confirm alignment.

4. If bad meetings were ingested, coordinate cleanup in the ingest repo
   (out of scope for this runbook).

Candidate INSERT uses `ON CONFLICT DO NOTHING` — re-running insert SQL is safe
and will not overwrite an existing row.

---

## Script reference

| Script | Path |
|--------|------|
| Discover | `scripts/gov-feeds/discover-county-vendor.mjs` |
| Dry run | `scripts/gov-feeds/probe-candidate.mjs` |
| SQL builder | `scripts/gov-feeds/build-candidate-sql.mjs` |
| Sync | `scripts/gov-feeds/sync-feeds-config.mjs` |
| Title verify | `scripts/gov-feeds/verify-candidate-titles.mjs` |

---

## Phase 1B P0 + Pilot A staging

Phase 1B adds a `feed_candidates` registry, state machine, and activation gates.
**P0 artifacts are in-repo only** — SQL in `docs/gov-feeds-phase1b-p0-*.sql` is
**not auto-applied**. See `docs/gov-feeds-phase1b-p0-README.md`.

**Pilot A documentation set (execution authority for Phase 1B onboarding):**

- `docs/government-feed-phase1b-pilot-a-plan.md` — plan + canonical execution order (start here)
- `docs/government-feed-phase1b-pilot-a-staging-execution-plan.md`
- `docs/government-feed-phase1b-pilot-a-operator-runbook.md`
- `docs/government-feed-phase1b-pilot-a-go-no-go-checklist.md`
- `docs/government-feed-phase1b-pilot-a-rollback-checklist.md`
- `docs/government-feed-phase1b-pilot-a-completion-checklist.md`

> **Pilot A coexistence exception (Plan §8).** The Wake County pilot runs
> **alongside** the intentional pre-Phase-1B legacy feed
> `wake-nc-granicus-agendas` (same Granicus source URL, 2026-07-05 vendor
> batch). The legacy feed stays `active=true` for the whole pilot, rollback
> verifies it was not touched, and pilot evidence comes from workflow logs /
> L2 title verification / feed-specific execution — never total meeting
> counts. Superseding the legacy feed is a post-Pilot **founder** decision,
> taken only after the governed feed is permanently adopted.

| P0 script | Path |
|-----------|------|
| Transition validate | `scripts/gov-feeds/transition-candidate.mjs` |
| Activation gates | `scripts/gov-feeds/activate-feed-candidate.mjs` |
| Rollback validate | `scripts/gov-feeds/rollback-feed-candidate.mjs` |
| Spec generator | `scripts/gov-feeds/gen/generate-transition-artifacts.mjs` |

Title verification now defaults to **feed-scoped** L2 (`view_id` / Legistar client /
CivicClerk sub). Use `--legacy-host-scope` only for Phase 1A comparison.

---

## Estimated time per county

**~30–60 minutes** after automation (discover 5–15m, human verify 5–10m,
insert + sync 10–15m, golive + title verify 10–20m, activate 5m).
