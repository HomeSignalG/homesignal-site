# Phase 6 — observe-only geography health and operational readiness

Branch `claude/amazing-planck-k897il`, on top of the accepted Phase 5 baseline `ebc824a`.

**Phase 6 applied NOTHING to production.** No scheduler, no backfill, no Baltimore, no
orphan cleanup, no KCMO controls, no reconciliation dispatch — and, because the index
decision came back blocked, no structural mutation of any kind. Everything below is
written, tested and parked.

---

## 1. Ingest re-baseline — **DEGRADED (RECOVERING)**

`dev-reports-rolling-refresh` (jobid 14, `*/2`), 12-hour window to 19:15Z 2026-09-19:

| measure | value |
|---|---:|
| runs | 360 |
| failures | **8** |
| avg | 23.88 s |
| **median** | **7.42 s** |
| p95 | **105.52 s** |
| max | **120.26 s** (the 120 s `statement_timeout`) |
| min | 1.62 s |
| within the 5–8 s healthy band | 198 / 360 = **55.0 %** |

The distribution is **bimodal**, which is why the average is the least useful number
here: the median sits inside the healthy band while the p95 sits at fourteen times it.

**Hourly trend — one clean excursion with monotonic recovery, not oscillation:**

| hour UTC | runs | fails | avg | med | p95 | at timeout |
|---|---:|---:|---:|---:|---:|---:|
| 07–14 | 30/h | **0** | 4.4–8.2 | 3.8–7.6 | 6.4–13.9 | 0 |
| 15:00 | 30 | 0 | 30.4 | 16.0 | 91.7 | 0 |
| **16:00** | 30 | **6** | **82.3** | 93.7 | 120.0 | **6** |
| 17:00 | 30 | **2** | 88.9 | 90.0 | 119.4 | **2** |
| 18:00 | 30 | 0 | 32.8 | 43.8 | 61.7 | 0 |
| 19:00 (partial) | 8 | 0 | **2.7** | **2.0** | 5.3 | 0 |

15-minute resolution shows the recovery is real and recent: `18:30` avg 18.0 (3/8 in
band) → `18:45` avg 7.2 (5/7) → `19:00` avg 2.7, max 6.2, **8/8 in band**.

### The cause is unidentified, and two plausible ones are excluded with evidence

- **NOT database-wide contention, and not my own audit load.** Control: every other
  cron job in the same window. `app-content-refresh` (a ~100 s job) went 101.4 → 107.7
  → 101.2 s (+6 %); `epa-frs-probe` 0.1 → 0.1 → 0.1; `pipeline-health-monitor` 0.4 →
  0.7 → 0.4. A shared-resource squeeze stretches the 100 s neighbour first. It did not
  move. The excursion is **specific to jobid 14's own work.**
- **NOT EPA refusal.** The refusal rate is flat across the whole window: 20.6 %–37.6 %,
  **24.4 % during the worst hour (16:00)** and 37.5 % during a healthy one (14:00).
- **Throughput barely moved while duration went 10×** — 221–239 rows written per hour
  throughout. Same work, far longer. That points at per-request latency on a
  slow-but-succeeding upstream, which is a hypothesis and is recorded as one.

### Classification

**DEGRADED (RECOVERING).** Not `RECOVERED`: failures reaching zero is not the test, and
the brief says so explicitly. The recovery is ~45 minutes old, follows a 3.5-hour
excursion that hit the statement timeout 8 times, and has no identified cause, so
recurrence cannot be predicted. Not `UNSTABLE`: the shape is a single excursion with
clean monotonic recovery, not oscillation.

---

## 2. Index readiness — **INDEX CREATION: BLOCKED BY INGEST HEALTH**

The requirement is already proven (Phase 5 §7) and is **not** re-derived here. The only
question was whether production has recovered enough. Measured over the most recent
60 minutes, which is the window an index build would land in:

| measure | value | gate | verdict |
|---|---:|---|---|
| failures | 0 | 0 | ✅ |
| avg | 7.7 s | ≤ 8 s | ✅ |
| **p95** | **29.0 s** | ≤ 15 s | ❌ **3.6× the band ceiling** |
| **max** | **48.4 s** | < 60 s | ⚠️ |
| **within band** | **23/30 = 76.7 %** | ≥ 90 % | ❌ |

Three `CREATE INDEX CONCURRENTLY` builds over ~2.8M rows is real write and WAL I/O;
`concurrently` reduces locking, not I/O, and it needs two passes per index. Adding that
to a job that was timing out 45 minutes ago, for an unidentified reason, is the trade
this phase exists to refuse. **No index was created. None was attempted.**

**The re-entry criterion, stated as numbers so Phase 7 is not blocked on judgement** —
all four, measured over **two consecutive hours**:

1. **0** failures;
2. **p95 ≤ 15 s**;
3. **≥ 90 %** of runs within the 5–8 s band;
4. **no single run ≥ 60 s**.

Then create them **one at a time**, capturing before-health, validity (`indisvalid`
and `indisready`), the plan flip on the real reconciliation predicate, and after-health,
stopping at the first material degradation.

---

## 3–4. The health model, and the two instruments that were rejected

Health reflects the Phase 5 invariant — *actual authoritative geography should equal
expected* — without an unbounded national anti-join, which Phase 0 proved cannot run
inside the production query budget.

**Rejected instrument 1 — cumulative `pg_stat_user_tables` write counters.** Free, and
the delta between two observations is exactly "did this plane progress". It failed its
own control: **85 `geo` relations tracked, 0 of 85 carrying a single recorded write**,
while `geo.n5_geom` demonstrably holds 1,209,747 rows that were written by the N5
pipeline. 12 geo relations do show *reads*, so the schema is tracked;
`pg_stat_database.stats_reset` is NULL. The write history for these tables is simply
gone. **A zero here means "no record of writes", never "no writes"** — and a frozen
pipeline reading green off a counter this database has already lost once is the exact
failure being guarded against.

**Rejected instrument 2 — `max(computed_at)` over the planes.** Honest, crash-safe, and
too expensive: measured **841.8 ms and 18,003 cold buffer reads** as a parallel seq scan
of 901,465 rows, for *one* plane. Three per tick is ~2.5 s and ~54,000 buffer reads
against a health tick that completes in 0.4 s today. An index on the timestamp column
would fix it; index creation is blocked.

**Chosen — the writer stamps its own progress, O(1).** The reconciliation engine is the
only writer of these planes, so it records what it did in constant time and health reads
it in constant time. `geo.geography_progress` (≤4 rows) plus
`geo.geography_health_observation` (append-only; trend comes from comparing the last
**two** rows, so "is the queue growing?" costs two index lookups and no history scan).
The cost of the health tick does not grow with the corpus — the property the anti-join
model lacked.

**Work-ledger: the parked Phase 5 trigger was NOT applied, and it was not needed.** It
would have been safe (it sits on `geo.n5_geom`, which is not on the ingest hot path and
currently takes zero writes, so it could not amplify `app_projects` at all), but it is
not required to observe, and §11 permits indexes as the only structural mutation. More
importantly: with nothing draining it the queue would read "0 pending" forever, which is
**vacuously healthy** — so the model is built so health does not depend on the ledger
existing. That is why `NOT_ACTIVATED` is a state.

---

## 5. Historical backlog stays separate

`geo.geography_activation` carries the corrected Phase 0 baseline as a **constant** —
53,610 keys / 124,070 pairs / 141,612 rows / 3,152 ZIP pages / 147 registries — with its
own `backlog_state` lifecycle (`not_started` / `in_progress` / `complete`).

Those 53,610 keys are **never enqueued**. `test/geo-health-model.test.mjs` §6 pins that
the health model contains no `insert into geo.n5_reconcile_queue` at all, so it cannot
turn the scheduler into the backfill mechanism. Steady-state work is what arrives at or
after `activated_at`; the two populations are never summed, and the fixture asserts
exactly that (case 8c).

---

## 6. Registry health

`geo.v_geography_registry_health` reports per registry: treatment, processable, pending
keys, oldest pending age, claimed keys, and a state. It is bounded — it aggregates the
**work queue**, never the 2.8M-row planes.

From `docs/geo-registry-classification.json`, 240 registries: PROVEN 145, RECOVERY 78,
NOAUTH 7, IDENT_UNRESOLVED 2, HIST_UNRECOVERABLE 1, **PENDING_REVIEW 1**,
**BLOCKED_NO_RECORDS 6**.

- Only **PROVEN** and **RECOVERY** are processable.
- The **7 governance holds** — `baltimore-city-housing-permits` plus the six zero-record
  registries — report **`HOLD`**, are excluded from every national roll-up, and are
  never counted as pipeline failures. A monitor that pages on a founder's decision is a
  monitor that gets muted.
- **NOAUTH / IDENT_UNRESOLVED / HIST_UNRECOVERABLE** report **`NOT_PROCESSABLE`**: they
  are recorded treatments carried in the catalogue and matched by neither association
  branch — Phase 3's second exclusion mechanism, not a failure either.

A hold is modelled by **absence of a catalogue row**, because that is what a hold
actually looks like in the database, rather than by a list retyped into the view.

---

## 7. HEALTHY / WARNING / CRITICAL

`geo.geography_health_state` is a **pure function of scalars** — it reads no table, so
every branch is testable without touching a plane.

| state | when |
|---|---|
| **NOT_ACTIVATED** | the engine has never run. Reported, **never green**, never paged. |
| **CRITICAL** | ≥3 consecutive failures · oldest pending > SLA · queue grew ≥6 consecutive windows · ingest active while reconciliation last succeeded >8 intervals ago |
| **WARNING** | oldest pending > 4 intervals · queue grew ≥3 windows · any consecutive failure · ingest active while last success >3 intervals ago |
| **HEALTHY** | work is not aging, the queue is not growing, nothing is failing, and — if ingest is active — geography is progressing |

**Thresholds are PROVISIONAL and marked as such in the SQL.** Performance benchmarking
is still blocked, so the Phase 7 scheduler interval is unchosen; they are derived from a
provisional 15-minute bounded drain (WARNING at 4×, CRITICAL via an SLA of 24 h) and
must be re-derived when that interval is settled. They are deliberately **not** the old
thresholds: the old model measured row arrival, which is what reported green throughout
the incident.

🔑 **The rule the whole phase exists for.** State is driven by the **age of eligible
work**, never by the existence of a recent successful run. A drain that succeeds while
claiming nothing is indistinguishable from a working one if you only read
`last_success_at`. Fixture case: 12 keys pending, oldest 26 h, last success 1 minute ago
→ **CRITICAL**.

---

## 8. Integration with the existing health system — traced, not assumed

Live as of 2026-09-19 19:10Z:

- `public.pipeline_health_tick()` — 11,290 chars, md5 `258df595490b81c3dfcc7086cf9f8c39`
- `public.pipeline_health_check` — `(check_name, ok, alertable, detail, since, last_notified_at, updated_at)`
- `public.pipeline_health_probe`
- pg_cron `pipeline-health-monitor`, `10 * * * *`, last run 19:10:00Z
- **10 checks live**; 8 alertable, 2 NOT-ALERTABLE by measurement

⚠️ **And the gap is exactly this: no check reports on geography at all, while
`dev_reports_refresh` reads `ok=true`.** It asks whether `development_reports` was
written recently — which stayed true *throughout the entire frozen-pipeline incident*,
because ingest never stopped. Only geography did. Row arrival on a neighbouring table is
not progression of the thing that froze.

The integration is **one more component on the existing surface**, not a second
monitoring system: a `pipeline_health_check` row named `geography_progression`, written
by a block spliced into the existing tick, so the existing Resend transport,
transition-only notify and 24 h dedup all apply unchanged.

- `ok` is **false for WARNING as well as CRITICAL** — the existing surface is boolean,
  and mapping WARNING to `ok=true` would hide the state whose purpose is to be seen
  before CRITICAL. The full state name rides in `detail`.
- `geography_progression` reads no other check and no other check reads it, so **a green
  global result cannot mask it**.
- The splice must be applied against live `pg_get_functiondef`, **never** by replaying a
  dated `CREATE OR REPLACE` from this repo: that function lives in the ingest repo and
  has been amended there (it went 9 → 10 checks with `local_news_heartbeat`).

---

## 9. Frozen-pipeline regression detector

Not a single job-success timestamp. Four signals: eligible-work arrival, completion
progression, oldest-work age, queue trend. Proven:

| case | scenario | required | measured |
|---|---|---|---|
| **A** | ingest active + geography active | healthy | **HEALTHY** |
| **B** | ingest active + geography stopped (8× interval) | warning/critical | **CRITICAL** |
| **B2** | ingest active + geography slipping (3× interval) | warning | **WARNING** |
| **C** | ingest quiet + geography quiet | **not** falsely critical | **HEALTHY** |
| **C2** | ingest quiet but work past the SLA | still critical | **CRITICAL** |
| **D** | one registry stuck while others progress | registry-specific visible | stuck **CRITICAL**, good **WORKING**, idle **IDLE** |

C2 matters: a quiet night must not be an outage, but it must not become an excuse for
aging work either.

---

## 10. Fixture results — 29 assertions, 0 failures, nothing dispatched

Isolated `geo_fx6` schema (RLS on every relation, no grants, dropped afterwards and the
teardown verified: `information_schema.schemata` → 0). The state machine is pure, so no
plane, queue or registry in production was read for mutation and reconciliation could
not be invoked.

- **17** state-machine cases (the table above, plus the required empty-queue,
  fresh-key, overdue-key, growing-queue, shrinking-queue and failed-reconciliation
  cases, and both `NOT_ACTIVATED` cases)
- **8** registry cases — stuck registry CRITICAL, healthy WORKING, idle IDLE,
  PENDING_REVIEW HOLD, BLOCKED_NO_RECORDS HOLD, NOAUTH NOT_PROCESSABLE, roll-up excludes
  holds, holds counted separately
- **4** historical-backlog separation cases

**Negative control:** asserting `WORKING` on the stuck registry raised
`HEALTH FAIL [negcontrol registry]: got CRITICAL, want WORKING`, and the pass log did
not advance — a failing check logs nothing.

### Mutations — the model is load-bearing

| mutation | mutated verdict | shipped verdict |
|---|---|---|
| **M1** SLA branch deleted (on: 12 pending, oldest 26 h, success 1 min ago) | **WARNING** | **CRITICAL** |
| **M2** `NOT_ACTIVATED` mapped to healthy | **HEALTHY** | **NOT_ACTIVATED** |
| **M3** `_ingest_active` gate removed, on case C | **CRITICAL** (false positive) | **HEALTHY** — and case B still **CRITICAL** |

M3 is the over-flagging direction: without the gate a quiet night reads as an outage,
and the shipped path is shown to keep case B detection while refusing case C.

### Offline pins — 43 checks, proven load-bearing

`test/geo-health-model.test.mjs`. Deleting the SLA branch from the parked SQL turns
**two** pins red by name; reclassifying a `HOLD` as a failure turns one red.

⚠️ **One pin was itself defective and the mutation is what exposed it.**
`a.indexOf(x) < a.indexOf(y)` is **true when `x` is absent** (`indexOf` returns −1), so
the first SLA-ordering pin passed over a branch that had just been deleted — only one of
the two pins went red. An ordering assertion must assert **presence** first. Same family
as "a pin that names the string it forbids cannot also search the whole file for it".
Fixed; the mutation now turns both red.

---

## 11. Production invariants — before and after

| invariant | value |
|---|---|
| `zip_authoritative_membership` | **901,465** unchanged |
| `zip_authoritative_marker` | **1,004,080** unchanged |
| `n5_geom` | **1,209,747** unchanged |
| `n5_boundary_membership` | **907,297** unchanged |
| `preservation.app_project_identity` | **3,172,292** unchanged |
| `n5_accepted_source` | **234** unchanged |
| ZIP 19475 | **34** membership / **40** markers unchanged |
| Baltimore treatment rows | **0** — still held |
| six zero-record registries, treatment rows | **0** — still blocked |
| Phase 6 objects applied to production | **0** |
| geography/reconciliation cron jobs | **0** — scheduler disabled |
| fixture schemas remaining | **0** |

---

## Remaining blockers before Phase 7

1. **Ingest must reach the §2 re-entry criterion** (2 consecutive hours: 0 failures,
   p95 ≤ 15 s, ≥ 90 % in band, no run ≥ 60 s).
2. **The three `source_key` indexes must exist and be valid.**
3. **The work-ledger (`docs/geo-reconcile-discovery.sql`) and this health model must be
   applied**, and the `geography_progression` splice made against live
   `pg_get_functiondef`.
4. **Thresholds must be re-derived** from the actual Phase 7 scheduler interval; they
   are provisional today because performance benchmarking is still blocked.
5. **Performance benchmarking** of a bounded reconcile batch — still deferred.
6. The cause of the 15:00–18:00 excursion is **unidentified**. Two candidates are
   excluded with evidence; a third (slow-but-succeeding upstream) is a hypothesis.
