# Backbone P0 → Implementation Roadmap

_2026-07-23 · re-audit of the canonical-backbone review's P0 findings against
current production, then the smallest production-change set required before
national scaling. **Roadmap only — nothing implemented.**_

## Re-audit result (each P0 verified independently, not from the report)

| Review P0 | Re-audit verdict | Classification | Decisive production evidence |
|---|---|---|---|
| State model = 2-value bucket | **Confirmed** — data correct, label lossy | **P0 (blocker)** | `data_quality ∈ {pass, coverage_coming}` only; `pass` = 11,656 but decomposes to **9,868 facilities-only baseline** + 1,132 local-dev + 977 with-changes; `coverage_coming`=1,066 all verified 0-record (`cc_but_has_records=0`). `community.html:53` shows a single generic "Coverage coming"; a facilities-only ZIP is `pass`, so its empty government tiles render as *covered*, not "coverage coming." |
| Engine refresh doesn't scale | **Confirmed** — strongest blocker | **P0 (blocker)** | `development_reports`: **6,536 stale >2d, 3,314 stale >7d** (0 >14d only because of today's manual backfill). Nightly `collect` landed 418/19/12/112 over 4 days. `dev-reports-refresh-fire/collect` fire all reports at once; collect upserts only 200s inside a 20-min window → throughput ≈ hundreds/night vs 12,722 universe. |
| Config split-brain (`feeds.csv` vs `public.feeds`) | **Downgraded** — DR safety-net staleness, no live impact | **P1 (debt)** | `ingest.py:1653 load_config()` = **DB-first** (`public.feeds` is source of truth; `feeds.csv` is fallback "seed + safety net"). DB complete: `feeds_with_unresolved_cid=0`, `feeds_null_cid=0`. `be-` namespace **perfectly in sync (78=78)**. Drift is DB-ahead by 50 (govt-content feeds); only harms a DB-outage fallback. |
| City-topic wiring broken (Tremonton/Brigham) | **FALSE ALARM** — works | **Not a bug** | `be-tremonton-meetings` exists, category `City government (Tremonton)`, anchored at county root; ZIP 84337 renders **14 Tremonton-specific + 20 civic** `app_changes`. The review's "unwired" claim was wrong (it read the city *row's* 0/0, but content lives at the root by design). |
| (systemic) 491/534 county roots advertise the 6 canonical topics with **zero** ingest feeds | **Confirmed but = facet of the state-model gap** | folded into **P0 state model + P2 subscription surface** | `roots_with_zero_feeds=491`, `roots_with_meetings=42`, `roots_with_alerts=32`; 2,972/3,227 advertised (community,topic) pairs unbacked. Honestly-absent (page already says "coverage coming" at page level); the refinement is per-topic signalling, not a data blocker. |

**Net:** only **two** true launch blockers — the cache-refresh throughput and the
coverage-state model. Everything else is P1/P2. The two are **independent** and
must not be bundled.

## Pipeline map (verified, for context)

```
ingest (GH Actions ingest.yml, every 2h)  → public.alerts / public.meetings
get-address-report (edge fn, v22)         → development_reports.sites   [pg_cron: fire 09:00 → collect 09:08]
app_refresh_all() / app_refresh_zip()     → app_projects / app_changes / app_community_meta   [pg_cron app-content-refresh 09:20]
digest.py (dispatched by pg_cron 17:00 CT)→ email
maps.html / community.html / homesignalmap.html  ← read app_* / alerts / meetings
```

Cron inventory (verified `cron.job`): `dev-reports-refresh-fire` (0 9 * * *),
`dev-reports-refresh-collect` (8 9 * * *), `app-content-refresh` (20 9 * * *,
`app_refresh_all()`), `homesignal-digest-5pm-et` (hourly gate → 17:00 CT).

---

## PHASE 1 — Batched cache refresh (P0, do FIRST)

**Why first:** highest user-facing value (currency of every Maps page), fully
isolated to Postgres (no site/ingest code, no page redeploy), independently
verifiable, and it unblocks nothing downstream so it can ship alone.

- **Objective.** Every `development_reports` row is re-fired on a rolling cursor
  so the whole 12,722 universe refreshes within a bounded window (target: every
  ZIP ≤7 days, goal ≤48 h), replacing the fire-everything-at-once design that
  only drains a few hundred/night.
- **Files affected.** `docs/development-reports-refresh-cron.sql` (repo SQL of
  record — update to match). No site or ingest code.
- **Database changes** (via `mcp__Supabase__apply_migration`, one migration
  `dev_refresh_batched`):
  - Rewrite `public.dev_refresh_fire()` to select a **batch** ordered by
    `refreshed_at ASC NULLS FIRST` with `LIMIT :batch` (start `batch=550`,
    hourly → full sweep ≈ 23 h; tune with the observed collect ratio). Keep the
    pinned-centroid body and 90 s pg_net timeout.
  - Keep `public.dev_refresh_collect()` as-is (already transient-safe: never
    blanks a good row; JSON-guard `left(ltrim(content),1)='{'`).
  - Reschedule crons: `dev-reports-refresh-fire` → `0 * * * *` (hourly, anchored),
    `dev-reports-refresh-collect` → `8 * * * *`. Leave `app-content-refresh`
    daily for now (Phase 3 covers its scaling).
  - Optional (belt-and-suspenders): a `dev_refresh_cursor` marker table if
    `refreshed_at`-ordering proves insufficient under write contention; not
    required if the ORDER BY holds.
- **Production impact.** Reads only (fires `net.http_post`); no writes to page
  tables in this phase. More edge-function invocations/day (≈550/h vs ~7,761 in
  one burst) — *lower* peak load, not higher. No downtime, no page change.
- **Rollback.** `cron.schedule(...)` re-point both jobs to `0 9 * * *` / `8 9 * * *`
  and `create or replace` the previous `dev_refresh_fire` body (preserved in
  `docs/development-reports-refresh-cron.sql` git history). Zero data risk —
  functions are idempotent and the collect guard prevents blanking.
- **Tests required.** (1) Unit: `dev_refresh_fire()` returns exactly `:batch` and
  selects the oldest-`refreshed_at` rows (assert via a dry `select ... limit`
  mirror). (2) Idempotency: two consecutive fires advance the cursor (oldest set
  moves forward). (3) Guard: a synthetic empty 200 does not blank a populated row.
- **Verification steps.** After 24–48 h of the new cadence:
  `select count(*) filter (where refreshed_at < now()-interval '48 hours') from development_reports;`
  trends to ~0; per-hour `refreshed_at::date`/hour histogram shows steady ~550/h,
  not a nightly spike; `cron.job_run_details` shows both jobs succeeding hourly.
- **Exit criteria.** `stale >7d = 0` sustained without manual intervention; a
  documented full-sweep period ≤48 h; `docs/development-reports-refresh-cron.sql`
  updated; no increase in edge-function error rate (`get_logs`).

---

## PHASE 2 — Explicit coverage-state model (P0, do SECOND)

**Why second, why separate:** touches page rendering (higher blast radius) and
must not ride with Phase 1's Postgres-only change. Depends on nothing in Phase 1.

- **Objective.** Replace the 2-value `data_quality` with an explicit, computed
  state so the product never labels a known condition "coverage coming." Minimum
  enum: `populated` (has local dev/gov content), `baseline_only` (national EPA
  floor only), `honestly_empty` (all checks ran, 0 records), plus reserved
  `failed_ingest` / `stale` for Phase 4/observability. Data is already correct
  (`cc_but_has_records=0`); this is **labeling what is already true**.
- **Files affected.**
  - `lib/data.js` — `coverageStatus(zip)` (lines 103–106) return the new
    `coverage_state` (keep `data_quality` passthrough for back-compat).
  - `community.html` (~line 32/53) — render honest per-state copy (`baseline_only`
    → "Local government feeds for <county> are coming; environmental facilities
    shown below"; `honestly_empty` → the existing "we never show made-up
    activity" copy; `populated` → no banner).
  - `homesignalmap.html` (~line 1044) — same state-aware empty text.
  - Production function `app_refresh_zip` (and therefore `app_refresh_all`).
- **Database changes** (migration `app_coverage_state_enum`):
  - `alter table public.app_community_meta add column coverage_state text;`
    (nullable; **keep `data_quality`** in parallel — do not drop).
  - In `app_refresh_zip`, after the counts are known, compute:
    `populated` if `_nd>0 or _nc>0`; else `baseline_only` if `_nf>0`; else
    `honestly_empty`. Write both `data_quality` (unchanged formula) and
    `coverage_state`. Idempotent; recomputed every materialization.
  - One-time backfill: `select app_refresh_all();` (or a set-based
    `update app_community_meta set coverage_state = …` computed from existing
    counts, cheaper than re-materializing).
- **Production impact.** Additive column; `data_quality` untouched, so any reader
  not yet migrated keeps working. Page copy changes for the 9,868 `baseline_only`
  ZIPs (now honestly labeled) and 1,066 `honestly_empty`. No marker/data change.
- **Rollback.** Site: revert `lib/data.js`/HTML to read `data_quality`. DB: leave
  the column (inert) or `drop column coverage_state`. No data loss — `data_quality`
  is the untouched source of truth throughout.
- **Tests required.** (1) `scripts/` unit for the state computation (counts →
  state truth table, incl. the 3 boundaries). (2) Extend `verify-communities.mjs`
  / `verify-maps-rollout.mjs` to assert every ZIP has a non-null `coverage_state`
  and that `honestly_empty` ⇒ 0 records, `baseline_only` ⇒ facilities>0 ∧ 0 dev/gov.
- **Verification steps.** `select coverage_state, count(*) from app_community_meta
  group by 1;` returns the expected split (~2,109 populated / ~9,868 baseline_only
  / ~1,066 honestly_empty, ± as content shifts). Load a `baseline_only` ZIP
  (`community.html?zip=35801`) and an `honestly_empty` ZIP and confirm honest copy.
- **Exit criteria.** 0 ZIPs with null `coverage_state`; no ZIP labeled
  "coverage coming" whose true state is known; CI green; `data_quality` retained.

---

## PHASE 3 — (P1) Materialization full-sweep hardening

- **Objective.** Ensure `app_refresh_all()` (12,722 `app_refresh_zip` calls in
  one cron statement, 09:20 daily) completes within `statement_timeout`; if not,
  batch it on a cursor like Phase 1 so no tail ZIP is skipped.
- **Files.** `docs/maps-full-rollout-migration.sql`. **DB:** verify runtime of
  `app_refresh_all()` (instrument with `cron.job_run_details.return_message`); if
  it exceeds the window, convert to a batched `app_refresh_batch(:n)` on hourly
  cadence. **Impact:** none if it already completes; else fixes silent tail-skip.
  **Rollback:** re-point cron. **Tests:** timed run + row-count parity.
  **Exit:** every ZIP re-materialized ≤24 h, proven by `updated_at` histogram.

## PHASE 4 — (P1) Config reproducibility + drift guard

- **Objective.** Make `feeds.csv` a faithful export of `public.feeds` (the DB is
  authoritative per `load_config`), so the DR fallback can't silently drop the 50
  govt-content feeds. **Files:** `homesignal-ingest/feeds.csv`, a new
  `.github/workflows` drift check (or extend `sync-feeds-config.yml`). **DB:** none
  (read-only export). **Impact:** none live (DR-only). **Rollback:** trivial (doc).
  **Tests:** CI asserts `feeds.csv` feed_id set == `public.feeds` feed_id set.
  **Exit:** 196↔246 reconciled to equal; CI drift check green.

## PHASE 5 — (P1) Cross-repo freshness/failure observability

- **Objective.** One view: `(state, county, record_class, last_good_refresh,
  source_state, item_count)` fed by `feed_health()` (ingest) + `cron.job_run_details`
  + `development_reports.refreshed_at` + the Phase-2 `coverage_state`. **Files:**
  a Postgres view + a small dashboard read. **DB:** additive view. **Impact:** none.
  **Rollback:** drop view. **Exit:** a single query answers "which counties are
  stale/failed and why."

---

## Ranking

**P0 — required before national scaling**
1. **Phase 1 — batched cache refresh.** Blocker: cache currency is unbounded at
   scale (6,536 >2d / 3,314 >7d today). Postgres-only, lowest risk.
2. **Phase 2 — explicit coverage-state model.** Blocker: the stated launch
   criterion forbids a generic "coverage coming" bucket; 9,868 baseline_only ZIPs
   are currently mislabeled `pass`. Additive, `data_quality` retained.

**P1 — operational excellence**
3. Phase 3 — materialization full-sweep hardening.
4. Phase 4 — config reproducibility + drift guard (DR safety net).
5. Phase 5 — cross-repo observability view.

**P2 — future improvements**
6. Per-topic coverage signalling on `community.html` for the 491 feed-less roots
   (extends Phase 2's state model to the subscription popup; not a data blocker —
   content is honestly absent today).
7. Unified declarative connector interface across both repos (add a `platform`
   column to `public.feeds`; retire the URL-substring dispatch in
   `ingest.py::fetch_items`).
8. Retire historical artifacts: the `84302` centroid literal in the engine
   `index.ts`, the barred `source_type=keyword` Google path.

## Sequencing rationale (risk-minimizing, unbundled)

- Phase 1 and Phase 2 are **independent** and touch **disjoint** surfaces
  (Postgres cron vs page rendering) — ship separately, verify separately.
- Phase 1 first: it is the pure-infra, zero-page-change fix and it improves the
  data Phase 2 will label, so labeling lands on fresher data.
- No phase depends on another's schema except Phase 5 (reads Phase 2's
  `coverage_state`) and P2-6 (extends Phase 2) — both later.
- Every phase keeps its predecessor's source-of-truth column/behavior intact
  (`data_quality` retained through Phase 2; `feeds.csv` fallback retained through
  Phase 4), so each rollback is independent.

## Production risk summary

| Phase | Risk | Blast radius | Reversible |
|---|---|---|---|
| 1 batched refresh | Low | cache freshness only | yes (re-point cron) |
| 2 state model | Low–Med | page empty-state copy | yes (`data_quality` retained) |
| 3 mat. hardening | Low | materialization tail | yes |
| 4 config export | Very low | DR only | yes |
| 5 observability | Very low | additive view | yes |

## Unresolved / watch items (not blockers)

- Whether `app_refresh_all()` completes fully in one 09:20 statement at 12,722
  scale is **unverified** (Phase 3 confirms; instrument before trusting).
- The 50-feed DB-ahead drift is safe only while the DB is healthy; Phase 4 closes
  the DR hole.
