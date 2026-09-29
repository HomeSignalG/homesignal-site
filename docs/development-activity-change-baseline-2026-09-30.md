# Development Activity — Order D: the national change baseline (2026-09-30)

Plan reference: `docs/development-activity-plan-2026-09-30.md`, Immediate Product Execution
Order **D** ("Establish the national change-baseline mechanism"). SQL of record:
`docs/dev-change-baseline.sql`, built on the Order C ledger (`docs/dev-change-ledger.sql`,
design in `docs/development-activity-change-layer-2026-09-30.md`). Executable proof:
`test/dev_change_baseline_pg/` (40 checks, 29 prohibited mutations) and
`test/dev-change-baseline-structure.test.mjs` (39 pins, 13 breakages checked).

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
  | source health labels | the founder's Maps workbook (Instructions, MEASUREMENT CONTRACT) | **not computed here** — see §5a and §8 |
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
  evidence — ledger coverage (identities, comparable, change-ready, siblings, non-durable), the newest
  retrieval instant the source's records carry, the newest **filing** date (never a future placeholder),
  and the refresh's own failure record over the two windows the workbook itself uses: 24 hours and
  14 days (fetch failures, blocked cache updates, truncations, affected ZIPs, last failure, ever retired).
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
| 7 | Source health is evidence, not a label. | The workbook defines the labels at (ZIP × feed family) grain and its CHANGE CONTROL forbids an agent redefining them. For the development family it records **no approved freshness SLA** and **no freshness source field**, and the refresh logs failures, not successes (§8). Computing a label here would invent what the workbook says is undefined. |

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

a. **Health labels.** Not computed, on the workbook's own terms: §8 shows that for the development family
   only ERROR (positive proof of a failed stage) and UNKNOWN could be assigned today. STALE needs an
   approved SLA and a source-controlled freshness field, and HEALTHY needs per-source success evidence;
   none of the three exists yet.
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

## 8. What the Maps workbook says about this view (read 2026-09-29)

Read from the uploaded copy of the Maps workbook (`0092`, audit dated 2026-09-25/26): `Instructions`
rows 509–580 ("Feed health workbook extension", "MEASUREMENT CONTRACT"), the `Feed Registry` row
`development-permits`, and `Feed Endpoint Health`. **It was used to read rules only.** The file is not
committed and not adopted as a repository artifact (a workbook produced from an upload is not the repo's
canonical copy), and the workbook's own rule 528 applies: historical audit results are leads, current state
must be re-verified.

**The contract, in the words that bind this unit**

- Health is defined per **(ZIP × feed family)**, from *required pipeline stages*
  (SOURCE, FETCH, INGEST, NORMALIZE, GEO, ZIP_ASSIGN, PUBLISH), kept distinct; "job success does not prove
  data success"; missing evidence is UNKNOWN, never a guess.
- **HEALTHY** needs every health-critical stage *positively verified*, authoritative delivery verified and no
  approved freshness requirement violated. **STALE** needs "an existing explicitly defined HomeSignal freshness
  SLA/rule — never invent an SLA". **ERROR** needs "evidence positively proves failure of a required
  pipeline stage". **VERIFIED ZERO** needs positive applicability and sufficient pipeline verification.
- "Expected Cadence is not Freshness SLA. Never derive or invent an SLA from cadence." **Freshness Days** is
  computed only from a verified *Freshness Source Field*, and "never falls back to Last Refresh or Last
  Publication". CHANGE CONTROL: agents "may populate evidence and identify gaps/conflicts but may not silently
  redefine these metrics".
- Grains are distinct and never substituted: SOURCE RECORD, OBSERVATION, CANONICAL ENTITY, PROJECT, ZIP
  MEMBERSHIP, DELIVERY UNIT, PUBLIC/MAP OUTPUT.

**The development family as the workbook records it** (`Feed Registry`, `development-permits`, criticality
CRITICAL): *Freshness SLA* = `SLA_UNDEFINED` (no approved SLA found) · *Freshness Source Field* =
"UNDEFINED — no source-controlled freshness field approved (`submitted_at` is a filing date, not source
freshness)" · *Delivery Unit* = "Development project (one per ZIP × `source_key` membership)" ·
*Authoritative Delivery Contract* = `public.app_projects_for_zip(zip,'development')` (Map 1:
`app_zip_projects_markers`).

**What the workbook's own audit did with it** (`Feed Endpoint Health`, checked 2026-09-26): of 241
development endpoints, **224 UNKNOWN and 17 ERROR**; none HEALTHY, none STALE. The diagnostic for each is the
refresh failure record ("`dev_refresh_source_failures` 14d: N events (fetch_failed), N blocked cache updates,
N ZIPs, N in last 24h"), and for 123 of them "0 failure events in 14d … **successes are not logged**", which is
why they are UNKNOWN with evidence status INSUFFICIENT_EVIDENCE. Cross-tabulating the diagnostics gives five
groups that sum to 241: **17 ERROR** — `fetch_failed` events with blocked cache updates and at least one failure
in the last 24 hours (17 of 17 such endpoints); and **224 UNKNOWN** — no failure-log diagnostic (125, of which
123 are "successes are not logged"), blocked updates but none in the last 24 hours (81), fetch failures with no
blocked update and none in 24 hours (16), and truncation only (2). That is an observation about how the audit
applied the contract on that date, **not a rule this repository adopts**.

**What follows for this view**

1. **The evidence columns match the workbook's diagnostic.** The view exposes the same counts over the same
   windows (24 hours and 14 days), including affected ZIPs. An earlier draft used a 7-day window of its own; that
   was a second, invented window and is now 14 days.
2. **`submitted_at` is not freshness.** The column that carried it is now `newest_filing_date`, and a pin fails if
   any view column is named for freshness. `last_observed_at` is the newest retrieval instant the source's records
   carry; it is **not** proof the source was fetched successfully (the refresh preserves cached records when a
   fetch fails), so it must not be read as the workbook's *Last Success*.
3. **`identities` is not a Record Count.** The ledger's identity is one per `source_key` across ZIPs; the workbook's
   Delivery Unit is one per ZIP × `source_key`. Different grains; never substitute one count for the other.
4. **What can be labelled today:** ERROR and UNKNOWN only. STALE needs an approved SLA and a freshness source
   field (a product decision). HEALTHY needs per-source *success* logging, which the refresh does not do (an
   engineering change to `dev_refresh_collect`, in the refresh's owner's lane, not this ledger's).
