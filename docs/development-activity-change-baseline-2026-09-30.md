# Development Activity — Order D: the national change baseline (2026-09-30)

Plan reference: `docs/development-activity-plan-2026-09-30.md`, Immediate Product Execution
Order **D** ("Establish the national change-baseline mechanism"). SQL of record:
`docs/dev-change-baseline.sql`, built on the Order C ledger (`docs/dev-change-ledger.sql`,
design in `docs/development-activity-change-layer-2026-09-30.md`). Executable proof:
`test/dev_change_baseline_pg/` (40 checks, 27 prohibited mutations) and
`test/dev-change-baseline-structure.test.mjs` (37 pins, 11 breakages checked).

Founder rulings in force: `docs/development-activity-founder-rulings-2026-09-30.md`. The plan's own
words for D: capture comparable observations and source-health / freshness state for the existing
source families; no city-level flag; where a record or source is not yet change-ready the report
falls back to **Recent Official Activity**.

## 1. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** publisher connectors → `dev_sites_deduped` → `app_refresh_zip` →
  `public.app_projects` (+ `app_community_meta.updated_at`, the materialisation clock) →
  **`dev_change_tick` (this unit: decides which ZIP)** → `dev_change_observe_zip` (Order C, the
  ledger's only writer) → the ledger. Source failures: `dev_refresh_collect` →
  `dev_refresh_source_failures` → **`dev_change_source_health` (a view over both)**.
- **Decision owners — none duplicated:**

  | question | owner | how this unit uses it |
  |---|---|---|
  | which ZIPs exist? | `public.canonical_zip_registry` (12,722) | the driver's only universe; it never creates a ZIP |
  | did a ZIP change? | `public.app_community_meta.updated_at`, written by `app_refresh_zip` | compared with the cursor's stored copy |
  | what is written to the ledger? | `dev_change_observe_zip` (Order C) | the driver calls it once; this file writes no project, event or run |
  | did a source fail? | `dev_refresh_source_failures`, written by `dev_refresh_collect` | read by the view; no second failure table |
  | is there room on the disk? | the operator, from the provider's disk metrics (the N5 convention, 2,048 MB floor) | required as an argument; the database cannot verify it |
  | source health labels | the founder's workbook | **not defined here** — see §5 |
- **Shortcut check:** searched `origin/main`, open PRs and recent branches for a baseline driver, a
  cursor, or a source-health state for development records: none. Two things that *looked* like
  candidates were rejected as the wrong owner: `source_status_vocabulary` / `source_registry` belong
  to the government-source archive (§7.2 of `CLAUDE.md`), and `scripts/source-monitor.mjs` is a
  wiring-time probe that writes a report file, not a runtime state.

## 2. What was built

One table, one function, one view, one storage parameter — all additive:

- **`dev_change_zip_cursor`** (12,722 rows at most): per ZIP, the last attempt (`ok` or `error`), the
  instant of the first success, the materialisation it saw, rows and identities read, and the error
  text. RLS on, nothing for anon/authenticated/PUBLIC, `service_role` limited to select/insert/update.
- **`dev_change_tick(run, max_zips, max_seconds, ledger_budget_mb, verified_free_disk_mb, min_interval_hours)`**:
  picks the next due ZIP, calls `dev_change_observe_zip`, records the cursor, repeats until a bound is
  reached. Returns the counts, why it stopped, and whether the baseline is complete.
- **`dev_change_source_health`** (view, `security_invoker`): one row per source family with the
  evidence — ledger coverage (identities, comparable, change-ready, siblings, non-durable), retrieval
  freshness, newest publisher date (never a future placeholder), and the refresh's own failure record
  (fetch failures and blocked updates in 24 h, truncations, 7-day failures, last failure, ever retired).
- **`fillfactor = 80`** on `dev_change_project`, so the ledger's frequent in-place rewrites can be HOT
  updates. This alters an Order C table's storage parameter only (148 rows at the time).

## 3. The rules, and the measurement behind each

| # | rule | why |
|---|---|---|
| 1 | A ZIP is **first** observed only inside a baseline run. | An ordinary run seeing a ZIP for the first time would write every record on it as material `first_detected` news. Pinned by D04. |
| 2 | A ZIP is due if never observed, or its last attempt failed before any success, or it was re-materialised **and** its last observation is at least `min_interval_hours` old (default 24). | Measured 2026-09-29 17:31Z: every one of the 12,722 `app_community_meta` rows had been updated within the previous 5.3 hours (oldest 12:15Z, newest 17:31Z), so the materialiser cycle is at most about that long. Re-observing on every visit would rewrite ~1 M ledger rows several times a day for no new information; the interval is a **write-volume bound, not a freshness promise**. |
| 3 | One bad ZIP never blocks the walk: rolled back, recorded with its error, queued behind the rest, retried once per tick. | Otherwise a single poison ZIP (always first in the order) would stop the national baseline forever. D05. |
| 4 | Capacity fails closed: a baseline run needs the operator's verified free-disk figure ≥ 2,048 MB + the ledger budget; every run needs a ledger budget and **stops** (not errors) when the ledger tables reach it. | The database is 17 GB (`pg_database_size`, 2026-09-29) and the largest table (`app_projects`) is 5 GB; the founder-read provisioned disk was raised to 24 GB on 2026-09-25 and is **not** re-verified here. |
| 5 | A tick is bounded by ZIP count (≤ 500) and by seconds (≤ 100, under the 120 s `statement_timeout`), always observing at least one ZIP. | Call it from a direct connection or `pg_cron`; PostgREST's 8 s limit would cut the largest ZIPs. |
| 6 | No schedule is armed by this file. | Arming a recurring job is a separate reviewed act. |
| 7 | Source health is evidence, not a label. | R5: the workbook defines HEALTHY / STALE / ERROR / VERIFIED ZERO / UNKNOWN / N/A / PAUSED, but its thresholds are not in this repository. Inventing them would decide, silently, which sources a customer report calls healthy. |

The view reads only the failure kinds that belong to a source (`fetch_failed`, `truncated`,
`retired`). The refresh also records whole-report `fire_*` failures under a pseudo source
(`(whole-report fire)`, 84,664 of 159,018 rows on 2026-09-29): those are pipeline faults, not any
source's health, and are excluded (D13f). The `retired` kind is how the gap stays visible when the
refresh drops a source's cached records but the ledger — by design — keeps them.

## 4. Storage and time — an ESTIMATE until the pilot measures it

Inputs, each measured 2026-09-29: ledger rows average **685 B** (project) and **641 B** (event) in
`pg_column_size` terms; `app_projects` holds 2,925,014 development rows; a 1/32 sample of source keys
gave 33,643 identities, so **roughly 1.0–1.1 million identities** nationally (all kinds, an upper bound
for development). About 92 % are comparable (audit B), and only comparable records get a baseline event.

- **Live size:** ≈ 1.0 M × (≈ 710 B project + ≈ 665 B event + ≈ 200 B indexes) ≈ **1.5–1.7 GB**, plus the
  25 % page headroom from `fillfactor = 80` on the project table: **≈ 2 GB**.
- **Churn:** each ZIP copy of a record after the first rewrites its project row (≈ 2.9 rows per
  identity), so a baseline rewrites roughly 1.5 M × 0.7 KB ≈ **1 GB of tuple versions**, reclaimed by
  autovacuum; and each daily re-observation rewrites every observed record once. WAL for the baseline is
  therefore several GB in total, recycled as checkpoints complete. **The ledger byte budget does not
  count WAL**; the pilot reports it.
- **Time:** the canary took 28–33 ms for ZIPs of 41–123 rows; the largest ZIP (28451, 14,664 rows) has
  not been timed. The pilot times ZIPs across the size range including that one.

The suggested ledger budget for the national baseline is ≈ 1.5× the live-size estimate; the operator
figure it must be paired with is `2,048 MB + budget`. **Both numbers are settled by the pilot, not
here.**

## 5. Deliberately NOT in Order D

a. **Health labels.** HEALTHY / STALE / ERROR / VERIFIED ZERO / UNKNOWN / N/A / PAUSED need the
   workbook's thresholds. The view carries the numbers they are computed from. Needed from the founder
   before any report can say a source is healthy or stale.
b. **A recurring schedule.** The ledger only detects changes if ticks keep running after the baseline.
   The rule for it is written (rule 2) and tested; arming a `pg_cron` job is the next reviewed step.
c. **Per-ZIP source applicability** ("which sources cover this ZIP, and are they healthy") — a reader
   concern for the report API (Order G), composed from `dev_refresh_source_failures.zip` and this view.
d. **Stronger events, cross-record lineage, the reader and customer copy** — as in Order C §5.
e. **The `Decided` lifecycle mismatch** — still flagged, still changes what residents see.

## 6. How the baseline is run (procedure, once applied)

1. `dev_change_start_run(true, '{"purpose":"national baseline"}')` → the baseline run.
2. Repeat `dev_change_tick(run, max_zips, max_seconds, ledger_budget_mb, verified_free_disk_mb)` from a
   direct connection until it reports `baseline_complete = true`. Read `zip_errors` after every tick; a
   stopped tick (`ledger_budget`, `busy`) is not an error and not complete.
3. `dev_change_finish_run(run)`. From then on only ordinary runs (`start_run(false)`) may tick, and they
   can only re-observe ZIPs the baseline already covered.
4. Verify against production before calling it done: every canonical ZIP has a cursor row with
   `status = 'ok'`; ledger events are all `first_detected` and `is_baseline`; row counts reconcile to the
   runs' counters.

## 7. Apply and rollback

Additive only. Apply `docs/dev-change-baseline.sql` as one migration
(`dev_change_baseline_d1_20260930`); it refuses unless Order C is present. Rollback: the `ROLLBACK`
block at the foot of the file drops only its own objects and resets the storage parameter. Verified in
Postgres 16 (local); the CI workflow runs it on Postgres 17. Idempotent (applied twice in the harness).
