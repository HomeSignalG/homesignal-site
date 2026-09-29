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

## 4. Storage and time — the ESTIMATE made before the pilot (measured values: §9)

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
- **Time:** the canary took 28–33 ms for ZIPs of 41–123 rows. **Measured since by the pilot: §9.**

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
   runs' counters. (On 2026-09-29 the "all `first_detected` and `is_baseline`" part did **not** hold: 959 events
   were cross-copy disagreements typed as changes — §10.)

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

## 9. Production receipt and pilot (2026-09-29)

**Applied 18:11Z** as migration `dev_change_baseline_d1_20260930` (ledger version `20260929181142`) from the
merged file (#1463, `a952139`; sha256 `4dd70d2f…`, 19,307 bytes, byte-identical to what CI tested).
Preflight: Order C intact, none of the new objects present, `dev_change_project` had no storage parameter,
registry and meta both 12,722 rows.

**Verified by fingerprint, not by eye.** The driver's `md5(prosrc)` `59ce03a97d78…` and length 5,599 equal the
values computed from the file before applying; the stored migration text has md5 `f365a441…` and 19,299
characters, equal to the file; all ten Order C functions are unchanged (`dev_change_observe_zip`
`17b45b9c4b93` / 8,074). Also read back: RLS on the cursor, `fillfactor=80` on the project table, the view has
`security_invoker=true` and exactly the 18 evidence columns, no privilege of any kind for anon /
authenticated / PUBLIC on the cursor, the view or any `dev_change_` function (11 functions), `service_role`
holds select/insert/update on the cursor (never delete/truncate) and select only on the view.

**Smoke test of the deployed driver.** A baseline run with no free-disk figure was refused (`CAPACITY GATE:
p_verified_free_disk_mb is unset, need >= 3048`), and so was a figure one MB short (3,047); both wrote nothing.
An ordinary run over the real registry and meta join ran in 0.04 s, observed nothing (no ZIP had been observed)
and reported all 12,722 ZIPs never observed. A fourth test, meant to show the ledger-budget stop, proved
nothing: the ledger was 512 KB, below the 1 MB minimum budget, so the stop never tripped. That behaviour is
verified only in the disposable suite (D08).

**Pilot: nine ZIPs, one baseline run, called through `dev_change_observe_zip` directly.** It could not go
through `dev_change_tick`, because a baseline tick correctly refuses to run without the operator's verified
free-disk figure, which nobody has yet supplied; the pilot wrote about 70 MB, the size Order C's canary
already established as acceptable. So the pilot measures the ledger writer, **not the driver's loop** — that
is proven only in the disposable suite.

| ZIP | dev rows read | new identities | events | time |
|---|---:|---:|---:|---:|
| 39217 | 0 | 0 | 0 | 19.5 ms |
| 01068 | 3 | 3 | 3 | 11.5 ms |
| 01252 | 15 | 6 | 3 | 11.3 ms |
| 01009 | 79 | 24 | 9 | 35.9 ms |
| 01013 | 414 | 81 | 18 | 163.3 ms |
| 02109 | 807 | 174 | 61 | 322.7 ms |
| 05401 | 3,209 | 3,200 | 3,195 | 1,344.7 ms |
| 28451 | 13,925 | 13,925 | 13,925 | 3,454.5 ms |
| 57105 | 19,793 | 17,894 | 17,511 | 5,759.3 ms |
| **total** | **38,245** | **35,307** | **34,725** | **11.1 s** |

**Correctness, each against an independent source.** Rows read (38,245) equals the independent count from
`app_projects` for those ZIPs; 184 facility rows sit in the same ZIPs and none were read (a positive control
for the facility exclusion); the run's counters equal the sums; all 34,725 events are `first_detected`,
baseline, not material; no identity has two events; none sits on a non-comparable record; the 35,307
identities split into 34,725 comparable and **582 `sibling_records`** (no event, 1.65%); every observation
count is 1, so **change-ready is 0**, as the cold-start rule requires; two identities appear on more than one
pilot ZIP and were kept as one. Database growth (69,492,736 bytes) equals the two ledger tables' growth exactly.

**Measured, and what it replaces**

- **Storage: 1,968 bytes per identity** (project 1,094 with its indexes; event 889 with its indexes;
  69.5 MB for 35,307 identities). With the national identity count still an estimate (about 0.9–1.1 M),
  that is **about 1.8–2.2 GB live**, in line with §4's estimate of ≈ 2 GB.
- **Time: about 0.29 ms per row** overall (0.25 ms on 28451, 0.42 ms on 05401). The two largest ZIPs took
  3.45 s and 5.76 s: under PostgREST's 8 s and far under the 120 s statement timeout, so no ZIP is a timing
  risk for one tick. At these rates 2.9 M rows is roughly 15–20 minutes of function time, **before** the cost
  of the copies path (below).
- **Not measured:** the update path — nationally a record averages about 2.9 ZIP copies, but the pilot's
  ZIPs are far apart and rewrote only 3 project rows, so neither the cost of the copies path nor the HOT
  ratio (2 of 3 updates) is measured. WAL: the log position advanced 83.2 MB while the pilot ran (34 s), but that
  counts every writer on the database, so it is an upper bound (≈ 1.2× the data), not the ledger's own.

**What the national baseline still needs** (nothing here has been started): the operator's verified free-disk
figure, and a ledger byte budget. From these measurements: a budget of **3,500 MB** (≈ 1.6× the upper live
estimate, covering dead tuples, which `pg_total_relation_size` counts) makes the gate ask for **≥ 5,548 MB**
(2,048 floor + 3,500). Because WAL is not in the budget and the pilot bounds it at ≈ 1.2× the data, plus the
copies path's rewrites, **I would want ≥ ~8.5 GB of verified free disk** before starting. That is a
recommendation; the gate itself enforces only the 5,548 MB.

**State left in production:** the ledger holds 35,455 identities and 34,862 events (the canary's 148 / 137 plus
this pilot's). They are real baseline rows and stay. The cursor is empty, because the pilot bypassed the
driver; when the national baseline reaches these nine ZIPs it will re-observe them, which is idempotent for
unchanged records and gives a record a second observation only if its ZIP was re-materialised in between.

## 10. The national baseline run (2026-09-29)

Run `c87c0d90-2231-4d47-a321-d82317d02737`, purpose "national baseline", **started 18:57:04Z, finished
19:34:45Z (37 min 41 s wall clock)**, driven by about 50 calls to `dev_change_tick(run, 500, 30–45 s, 3,500 MB,
free-disk figure)` from the Supabase SQL tool, then `dev_change_finish_run`. Every tick reported `zip_errors 0`.
Stop reasons seen: `max_zips`, `time`, and finally `none_due` with `baseline_complete = true`. `ledger_budget`
and `busy` were never reached in production (the budget stop is still proven only in the disposable suite).

**The free-disk figure passed to the gate was a derived lower bound, and a dashboard reading taken afterwards
bears it out.** When the run started, the only reading was the project home page's "Disk 51%" with no size.
With the measured `pg_database_size` (18,296,196,243 B) as a floor for used space and 51.5% as the ceiling for
the rounded 51%, free space is at least `used × 0.485 / 0.515 ≈ 17.2 GB`; **16,000 MB was passed to the gate,
and 15,000 MB once the ledger had grown by about 1 GB**.

*Read afterwards (Settings → Infrastructure, about 19:46Z, 12 minutes after the run finished):* **Disk 57%,
DATABASE 18.8 GB, WAL 1.1 GB, SYSTEM 207.1 MB.** The dashboard's "GB" are GiB (`pg_database_size` at that
moment, 20,163,071,123 B, is 18.78 GiB). Used is therefore about 20.1 GiB, so the volume is about **35 GiB**
(34.8–35.8 allowing for the rounded percentage) and about **15 GiB is free**. The provisioned size itself was
below the fold of the screenshot, so it is derived and not read. It replaces the 24 GB recorded on 2026-09-25.
Against what was passed: free space was about 17 GiB at the start (above 16,000) and about 15.2 GiB at the end
(above 15,000), so **the figures were true throughout, but the final margin was only about 0.5 GiB**, thinner
than intended: 1 GB was subtracted when the ledger had already grown by more than that and WAL was not counted.
The ledger budget was never close: the ledger peaked at 1.93 GB against 3,500 MB.

**Result, reconciled exactly.**

| | before | this run | after (counted) |
|---|---:|---:|---:|
| identities (`dev_change_project`) | 35,455 | +897,514 | **932,969** |
| events (`dev_change_event`) | 34,862 | +887,382 | **922,244** |
| ZIPs observed | 0 (cursor empty) | 12,722 | 12,722 |
| development rows read | 38,573 (canary + pilot) | 2,925,376 | 2,963,949 |

The run's counters equal the sums of the cursor (`rows_read` 2,925,376), and identities and events each equal
the earlier total plus the run's own. The run also recorded `observations_accepted` 1,331,306 and `rows_skipped`
0. On average a new identity was read from about 3.3 ZIP rows (2,925,376 ÷ 897,514).

**Checks from §6 step 4, each against production.**

- Every one of the **12,722** canonical ZIPs has a cursor row with `status = 'ok'` and a `first_ok_at`; **0**
  cursor rows are not ok, **0** sit outside the registry, **0** registry ZIPs lack an `app_community_meta` row.
  The run is finished and no run is open.
- 921,285 events are `first_detected` and baseline, **one per identity that has any event**. The other 11,684
  identities have no event at all, and they are exactly the non-comparable ones: 9,031 `sibling_records` and
  2,653 `non_durable_key_basis`, none change-ready (9,031 + 2,653 = 11,684).
- **Independent count, a sample and not the whole table.** For 60 registry ZIPs chosen by `md5(zip)` (48 with
  development rows, 12 empty; 25,483 rows), `app_projects` rows equal the cursor's `rows_read` in 60 of 60,
  and distinct `source_key` equals both the ledger's identities and the cursor's `identities_seen` in 60 of 60
  (24,924 keys). A whole-table `count(distinct source_key)` over `app_projects` was tried and timed out at the
  tool's 60 s limit, so the national identity total has **not** been checked against an independent full count.

**One check failed: 959 events are not baseline first detections.** §6 step 4 said all ledger events should be
`first_detected` and baseline. 959 are not: **563 `status_changed` and 396 `source_record_updated`, all written by
this run, all `is_baseline = false`.** Measured:

- They sit on **863 identities, every one of which has two or more ZIP copies** (0 single-ZIP). Their
  `observed_at` values run from 2026-08-25 to 2026-09-29 18:44Z, and **none is after the run started**, so they
  are disagreements between ZIP copies that were materialised at different times, not changes seen during the run.
- Which registries: Missoula addresses-with-permits (status progressing across copies, e.g. Approved →
  Operating, Proposed → Approved), Arlington issued-permits (address, name and submitted_at all differ, which
  reads like different records sharing one key rather than an update; an inference, not verified), Boone
  County KY planning-board actions, Pierce County PALS permits, MDOT STIP projects, Fort Worth development
  permits.
- **114 of the 959 sit on identities that are non-comparable**, which the Order C rule says should produce no
  change event. 102 identities are affected. Not diagnosed here.
- The stored project row is **never older than its latest event** (0 of 863), and for 358 of them a later copy
  agreed with the stored state, which is consistent with the copies path applying only newer materialisations;
  what looks wrong is the typing of a disagreement between copies as a change.
- **Nothing was deleted or rewritten.** The ledger is append-only (the event-immutability trigger), and deleting
  would be a destructive change. Two ways to handle it, for a decision (status file, decision 10): a reader
  rule that never counts an event whose run is a baseline run (no ledger change, reversible), or a reviewed
  change to `dev_change_observe_zip` so that copies which disagree inside a baseline run resolve to the newest
  materialisation without writing a change event. **The founder chose the first (2026-09-29); it is built in §11.**

**Measured, replacing the estimates.**

- **Storage: 2,071 bytes per identity** (1,932,328,960 B reported by the last tick ÷ 932,969), against the
  pilot's 1,968 and §4's estimate of about 2 GB. Database growth over the run was 1,866,874,880 B
  (18,296,196,243 → 20,163,071,123), which matches the ledger's growth (1.93 GB minus the roughly 70 MB already
  there) to within about 0.3%.
- **Time: at most 0.77 ms per row** (2,261 s of wall clock ÷ 2,925,376 rows, gaps between my calls included),
  against the pilot's 0.29: the copies path, which is most of the rows, costs more than a first sighting. The
  longest single ZIP overshot a tick's time cap by about 11 s (a tick checks its clock between ZIPs), which is
  why the caps were lowered from 45 s to 30–35 s to stay under the tool's 60 s limit.
- **Not measured:** WAL attributable to the ledger (the dashboard shows 1.1 GB of WAL for the whole database
  afterwards) and the HOT-update ratio.

**Load on the database while it ran (Supabase logs, 10-minute buckets, UTC).** Read afterwards, because it was
not checked beforehand, and it shows the run **overlapped the tail of another heavy workload that I did not
look for before starting.**

- **The daily `verify-communities` workflow** (event `schedule`, run `18:38:11Z` to `19:01:54Z`, success) is the
  likely source: a Linux browser client (user agent `Mozilla/5.0 (X11; Linux x86_64)`) made about **232,000
  `/rest/v1` requests between 18:30 and 19:07** (the match to the workflow is by time and shape, not proven).
  Over 18:40–19:00 that is 101,936 and 104,083 requests per bucket, against 300–400 in the buckets before it.
- **That load caused the API timeouts, and it started before my run.** From 18:44 to 19:00 the `authenticator`
  role hit the 8 s statement timeout **190 times** (up to 54 in one minute), with 178 API responses of 5xx across
  18:40–19:10. This is the saturation this file already warns about for full-corpus verifiers.
- **My run began at 18:57:04Z, inside the last four minutes of that.** Two `authenticator` timeouts at 18:58 and
  eleven at 19:00 fall in the overlap, and **I cannot separate what my ticks added from what the verifier was
  already doing** (it produced 7–54 per active minute from 18:44). I should have checked for a running verifier
  before starting.
- **After the verifier ended (19:07) and while my ticks continued to 19:34:** 0 responses of 5xx, average origin
  time 62–97 ms and p95 184–261 ms against 60–89 ms and 175–328 ms before the storm, and no `authenticator`
  timeouts. Traffic in those buckets was low (283–846 requests per 10 minutes), so this is weak evidence that
  the run itself did not degrade the API, not strong evidence.
- Two `postgres`-role timeouts: one at 19:01, inside the run and not attributed; one at 19:38, which is my own
  full-table `count(distinct source_key)` that the SQL tool gave up on at 60 s and the database cancelled at 120 s.
- The dashboard's compute chart showed CPU at 100% across this window (current CPU 21% at 19:46Z). It cannot be
  split between the verifier and the run either.

**State left in production.** The ledger is baselined for all 12,722 ZIPs. **Nothing detects a change from here**:
no job is scheduled (status file, decision 9). An ordinary run may now re-observe only ZIPs re-materialised
since their last observation.

## 11. Decision 10 option (a): the reportable-events view (2026-09-29)

The founder answered decision 10 with "follow your recommendation", which is option (a): **a reader rule on the
run, with no change to the ledger and none to the writer.** `dev_change_observe_zip` is untouched, nothing is
deleted or re-typed, and the 959 events stay in the ledger as the true observations they are.

**Pre-implementation statement.**

- *Canonical truth path:* `public.app_projects` → `dev_change_observe_zip` (the ledger's only writer) →
  `dev_change_event` → **`dev_change_event_reportable`** → the report reader (Order G, not built).
- *Decision owner for "may this event be shown as a change":* the view, in `docs/dev-change-reportable.sql`.
- *Shortcut check:* a scan of `lib/`, `scripts/`, `supabase/`, `partials/`, `bluesky/`, the root pages and every
  `docs/*.sql` finds `dev_change_event` named only by the ledger, this view and the baseline driver (which uses
  it once, to measure its size for the capacity gate). Nothing else reads it, and the structural test fails if
  anything does, so a reader cannot quietly re-derive the rule.
- *Concurrency check:* no open or recent PR or branch implements the same outcome.

**The rule and why it is on the run.** An event is reportable when the run named by **its own** `run_id` is not
a baseline run. Three tempting alternatives are each wrong, and each has a prohibited mutation that the suite
kills:

- *`where not is_baseline`.* The 959 events carry `is_baseline = false` even though they were written inside a
  baseline run, so this rule would show them. The suite reproduces that exact shape with the real writer (one
  record on two ZIPs, copies materialised at different times, met in one baseline run) and checks the writer
  typed it as `status_changed` first, so the control is real.
- *The record's first (or last) run.* A record first seen by an ordinary run and later met again inside a
  baseline run keeps its ordinary `first_detected` event; a record baselined once and changed in an ordinary run
  keeps that change. Judging by either run of the record gets one of those wrong.
- *A left join.* An event that names no run cannot be classified, so it is not shown.

The view carries the event's own 19 columns, in the ledger's order, and adds no fact of its own. It does not
filter on `event_type` or `material`: hero eligibility stays the reader's decision (Step 3A).

**Proof.** `test/dev_change_reportable_pg`: 22 checks against a disposable Postgres (baseline first sightings,
a new record, a publisher-status change, a derived-only change, the cross-copy shape, a run-less event, the
first-run/last-run trap, exact totals of 10 events and 4 reportable, the column list, no write path, and the
lock-down including real reads as `anon`, `authenticated` and `service_role`); the file applies twice with an
identical definition and refuses to apply without the Order C ledger; **14 prohibited mutations, all killed**.
`test/dev-change-reportable-structure.test.mjs`: 29 pins, and eight mutations of the pins themselves each turned
the test red. Local run on Postgres 16; the workflow `dev-change-reportable-suite.yml` runs it on 17 and holds
no Supabase credential.

**Two things the suite made me correct in my own harness.** The stand-in `service_role` needed BYPASSRLS (the
ledger tables have RLS on with no policy, as in Supabase), and a freshly created schema gives the API roles no
USAGE, so the first version refused `anon` at the *schema* and would have passed for the wrong reason. The suite
now grants USAGE to all three roles and checks it as a control before the refusal check.

**What this does not settle (stated, not hidden).**

- An **ordinary** run re-observes ZIP copies too, so the same cross-copy differences can appear there as change
  events, and this view would show them. Whether the writer should resolve copies that disagree to the newest
  materialisation without an event is option (b), a change to the Order C writer. **It must be settled before
  the recurring job is armed** (status file, decisions 9 and 10).
- 114 of the 959 sit on identities the ledger marks non-comparable. Those are excluded here only because they
  were written by the baseline run. An ordinary-run event on an identity that *later* becomes non-comparable
  would still be reportable. Not decided here.
- Applying it to production changes nothing anyone sees: it has no reader yet. Expected reading once applied:
  all four production runs so far are baseline runs except one ordinary smoke run that wrote **0** events, so
  **0 of the 922,244 events are reportable today** (137 + 34,725 + 887,382 = 922,244, all in baseline runs).

**Production receipt (2026-09-29).** Merged as #1470 (`93a6a1f`); applied 20:32:33Z by `apply_migration`, name
`dev_change_reportable_d2_20260930`, ledger version `20260929203233`. Measured after the apply, each beside its control:

- **The stored migration text is the file, byte for byte:** md5 `3c033912e17097e1e66fc42ac44f8a4e` on both sides
  (the file is 5,867 bytes, 5,864 characters).
- **Definition and lock-down:** 19 columns in the ledger's order; `reloptions` `{security_invoker=true}`; ACL
  `{postgres=arwdDxtm/postgres, service_role=r/postgres}`; `anon` and `authenticated` cannot select; `service_role`
  can select and cannot insert. The Order C tables and every other object are untouched (the migration creates one view).
- **Reading: 0 reportable events.** The control that makes the zero mean something: the same join with the
  opposite condition finds **922,244** events in baseline runs, of which exactly **959 carry `is_baseline = false`**
  (the cross-copy differences of §10), and **0** events name no run. The run counters agree: 922,244 events written
  by baseline runs, 0 by ordinary ones.
- Nothing reads the view yet, so no page, email or report changed.
