# Phase 6B — activation readiness

**Outcome: `ACTIVATION READINESS: BLOCKED — INGEST NOT RECOVERED`.**

Phase 6B stopped at §1. **No index was created, no infrastructure was applied, no
trigger was installed, and nothing was written to production.** The only operations
performed were catalog reads and `EXPLAIN` without `ANALYZE`.

While the gate was held, the one item the brief requires *before* anything may be
applied was worked read-only: §3's question about the discovery blind spot. That
question turns out to have a larger answer than it was asked with, which is recorded
below in full — applying the Phase 5 mechanism as designed would have installed an
incomplete work-discovery layer.

---

## 1. Ingest re-entry gate — FAIL

Completed hourly windows only (`now = 2026-09-19 19:34:14Z`, so the 19:00 hour is
in progress and excluded). The gate is evaluated **inside the query**, not by eye:

| hour UTC | runs | fails | p95 | max | % in band | runs ≥60 s | passes |
|---|---:|---:|---:|---:|---:|---:|:--:|
| 12:00 | 30 | 0 | 6.40 | 12.53 | 96.7 % | 0 | ✅ |
| 13:00 | 30 | 0 | 9.83 | 10.36 | **63.3 %** | 0 | ❌ |
| 14:00 | 30 | 0 | 11.72 | 16.67 | **66.7 %** | 0 | ❌ |
| 15:00 | 30 | 0 | **91.69** | 94.37 | 36.7 % | **8** | ❌ |
| 16:00 | 30 | **6** | **120.03** | 120.26 | 0 % | **22** | ❌ |
| 17:00 | 30 | **2** | **119.36** | 120.01 | 0 % | **28** | ❌ |
| **18:00 — latest completed** | 30 | 0 | **61.66** | 66.37 | **26.7 %** | **2** | ❌ |

**The two most recent completed hours are 17:00 and 18:00. Both fail.** 18:00 fails
three of the four sub-criteria (p95 61.66 s vs ≤15 s; 26.7 % in band vs ≥90 %; 2 runs
≥60 s vs 0).

⚠️ **11:00+12:00 would look like a qualifying consecutive pair, and using it would be
cheating.** 11:00 is a truncated 12-run sample, and both hours *precede* the excursion.
The gate exists to establish that ingest can tolerate an index build **now**; reaching
back past a 3.5-hour degradation to find a green pair satisfies the letter of the
criterion while inverting its purpose. The criterion is not weakened, redefined, or
re-based — it is simply not met.

📌 **Worth flagging for the next attempt, without changing anything:** the
**≥90 %-in-band** sub-criterion is the binding one, and it is stricter than the band
this repo has historically called healthy. 13:00 and 14:00 have **zero failures, p95
under 12 s and no run near 60 s**, and still fail on 63.3 % / 66.7 %. In this entire
8-hour window only 12:00 clears it. That is a fact about the criterion, not an argument
against it — but if Phase 7 is to unblock, either ingest must get materially tighter
than its own historical norm, or the founder re-derives that sub-criterion deliberately.
It is not mine to relax.

---

## 2–6. Indexes: none created, none attempted

Gated on §1. Nothing to report for index validity, size, plan flips or ingest impact,
because no build was started. The three definitions remain exactly as proven in Phase 5
§7 and are unchanged.

---

## 7–9. Work discovery — the Phase 5 mechanism is INSUFFICIENT, and in three ways

The brief asked whether a statement-level trigger on `geo.n5_geom` can discover a
brand-new project that has never entered geography. **It cannot, and that is the least
of it.** Tracing the real arrival path found three distinct blind spots.

### The arrival path, traced

A project reaches production as a row in **`public.app_projects`** (`source_key`,
`registry_id`, `record_kind`, `lat`, `lng`, `created_at`, `last_seen_at`), written by
the materializer from `development_reports.sites`. It acquires geography only later,
when an acquisition writer inserts into `geo.n5_geom`. **`app_projects` is upstream of
`n5_geom`, so a trigger on `n5_geom` is downstream of the event it is supposed to
discover.**

### The three blind spots

| # | transition | can the `n5_geom` trigger see it? | why not |
|---|---|:--:|---|
| **1** | **NEW live key, zero geography** | ❌ | the key has no `n5_geom` row, so no write to `n5_geom` ever occurs — nothing fires |
| **2** | **coordinate change on a key that already has geometry** | ❌ | `app_projects.lat/lng` moves; `n5_geom`'s stored `pt:1` does not change by itself, so no write fires **and** a `not exists (n5_geom)` sweep cannot see it either, because the key *does* have geometry |
| **3** | **source disappearance** | ❌ | the app-level stale sweep deletes the `app_projects` row; `n5_geom` keeps its rows, so again nothing fires |

Blind spot 2 is the one that is easy to miss when only blind spot 1 has been pointed
out: it survives *both* the trigger and the obvious forward anti-join.

### The corrected architecture — bounded sweeps, plus the trigger, and no hot-path trigger

| mechanism | discovers | cost shape |
|---|---|---|
| **Sweep A — forward anti-join** `app_projects` ⟕ `n5_geom` | NEW live keys with zero geography | bounded keyset slice, proven below |
| **Sweep B — coordinate drift** compare `app_projects.lat/lng` against the stored `pt:1` | moved PROVEN keys | same slice, one extra index probe per key |
| **Sweep C — reverse anti-join** `n5_geom` ⟕ live `app_projects` | source disappearance | bounded keyset slice over `n5_geom` |
| **Sweep D — the Phase 5 audit sweep** | partial geography (in `n5_geom`, on neither plane) | already designed, bounded |
| **Trigger on `geo.n5_geom`** (Phase 5) | acquisition's own writes, incl. stage-1 replacement | statement-level, **off the hot path** — `n5_geom` currently takes **zero** writes |
| **Explicit enqueue** on registry disposition change | treatment change | an operator action, not a trigger |

**No trigger on `public.app_projects` is proposed.** The brief warned against it and the
measurement supports the warning: `app_projects` carries **48,366,569 recorded tuple
writes** (48,278,764 of them updates) against 3,213,331 live rows. A statement trigger
with a transition table there would materialise changed-row sets on the materializer's
hottest statement. The sweep achieves the same discovery off the write path.

### Sweep A is cheap and bounded — proven by plan, with the caveat stated

`EXPLAIN` (no `ANALYZE`) of the real sweep — 500 distinct keys per slice:

```
Nested Loop Anti Join  (cost=1.11..1542.67 rows=1)
  ->  Limit  (cost=0.56..1043.12 rows=500)
        ->  Unique
              ->  Index Only Scan using app_projects_source_key_kind_idx on app_projects
                    Index Cond: ((source_key > 'aaaa') AND (record_kind = 'development'))
  ->  Index Only Scan using n5_geom_sk_ix on n5_geom g
        Index Cond: (source_key = p.source_key)
```

**Zero sequential scans, total cost 1,542.67**, against the 841.8 ms / 18,003-buffer
`max(computed_at)` Phase 6 rejected.

⚠️ **"Index Only Scan" in a plan is not index-only in practice, and here the two sides
differ sharply.** Measured:

| relation | `relpages` | `relallvisible` | all-visible | dead tuples |
|---|---:|---:|---:|---:|
| `public.app_projects` | 370,997 | **424** | **0.11 %** | 497,507 |
| `geo.n5_geom` | 37,483 | **37,483** | **100 %** | 0 |

So the `n5_geom` probe **is** genuinely index-only. The `app_projects` side is not: at
~12.6 rows per distinct key (2,994,608 estimated rows / 237,406 estimated distinct
keys), a 500-key slice visits ~6,300 tuples and will pay a heap fetch for nearly all of
them. That is bounded and far cheaper than the rejected instruments, but it is **~6,300
random reads per slice, not zero**, and the next phase should size the tick against that
number rather than against the plan's shape.

`geo.n5_geom`'s perfect visibility map is itself a symptom: nothing has written that
table, which is the incident.

### 🔑 A further blocker, found while tracing: nothing materialises PROVEN geometry

Even with perfect discovery, a newly-discovered **PROVEN** key has no writer.

- The only production inserts into `geo.n5_geom` are `scripts/n5_shard.py:494` and
  `:500`, and **both hard-code `provenance='recovered_authoritative'`**.
- The only occurrences of `proven_stored_point` in shipped code are **test fixtures and
  read-path assertions** — no writer.
- The 718,278 `proven_stored_point` rows came from a one-time migration off the frozen
  snapshot, which is exactly why they are 718,278 rows at a single constant
  `feature_id`.

**So PROVEN acquisition does not exist as a running component.** Discovery would enqueue
new PROVEN keys that nothing could then process — the queue would grow and the health
model would correctly go CRITICAL, but the cause would be a missing writer, not a
missing index. This must be resolved before Phase 7, and it is not in any current phase
plan.

---

## 10–15. Applied: nothing

| item | state |
|---|---|
| work/progress schema | **not applied** — the mechanism was proven incomplete above |
| trigger / sweep infrastructure | **not applied**; 0 triggers on `app_projects` |
| write-path cost introduced | **zero** |
| health model | **not applied** — §4 forbids installing a check over an unpopulated progress structure, and its inputs do not exist |
| `pipeline_health_tick` integration | **not applied**; md5 unchanged at `258df595490b81c3dfcc7086cf9f8c39` |
| applied `NOT_ACTIVATED` behaviour | **not observable** — nothing installed |

---

## 16–18. Detector / hold / backlog tests

The Phase 6 fixture proof (29 assertions, 3 load-bearing mutations, negative control)
stands unchanged at `6043ffd` and covers cases A–D, holds and backlog isolation. It was
**not re-run**, because nothing it tests has changed and re-running it would add DB load
during a degraded window for no new information. Cases E–H asked for here map onto
already-proven fixture cases: E → PENDING_REVIEW `HOLD`, F → BLOCKED_NO_RECORDS `HOLD`,
G → the four backlog-isolation cases, H → the two `NOT_ACTIVATED` cases.

---

## 19–21. Production invariants — unchanged

| invariant | value |
|---|---|
| `zip_authoritative_membership` | **901,465** |
| `zip_authoritative_marker` | **1,004,080** |
| `n5_geom` | **1,209,747** |
| `n5_boundary_membership` | **907,297** |
| `preservation.app_project_identity` | **3,172,292** |
| `n5_accepted_source` | **234** |
| ZIP 19475 | **34** / **40** |
| KCMO control ZIP 64165 | **29** — unprocessed |
| Baltimore treatment rows | **0** — still held |
| six BLOCKED_NO_RECORDS treatment rows | **0** — still blocked |
| new indexes created | **0** |
| Phase 5/6 objects applied | **0** |
| geography / reconciliation cron jobs | **0 — scheduler OFF** |
| reconciliation executions | **0** |
| historical backlog processed | **0** |
| orphan cleanup runs | **0** |
| triggers on `public.app_projects` | **0** |
| fixture schemas remaining | **0** |
| `geography_progression` health check | **absent** (not applied) |

The single non-internal trigger in the `geo` schema is `zz_shadow_complete_status` on
`geo.maps_zip_geography_status` — the Phase-1 Unit A invariant trigger, pre-existing and
not created here. It was identified rather than assumed.

---

## 22. Remaining blockers before Phase 7

1. **Ingest has not met the re-entry criterion.** Binding sub-criterion is ≥90 % in
   band; see the note in §1 about whether that bar is the right one.
2. **Three `source_key` indexes still do not exist.**
3. **Work discovery needs four bounded sweeps, not one trigger** — designed above, not
   applied, and the design is new since Phase 5.
4. 🆕 **Nothing materialises PROVEN geometry.** No shipped writer emits
   `proven_stored_point`. Discovery without it enqueues work nothing can process.
5. Health model and `pipeline_health_tick` integration remain unapplied, correctly,
   until their inputs exist.
6. Thresholds remain **PROVISIONAL**; the scheduler interval is still unchosen because
   performance benchmarking is still blocked.
7. The cause of the 15:00–18:00 excursion is still unidentified.

## 23. PASS / BLOCKED / FAIL — **BLOCKED**

Blocked at §1 as the brief directs, with the added finding that §3 could not have been
applied as designed even had §1 passed.
