# `app_refresh_sweep` churn — investigation, 2026-08-19

**PROPOSE-ONLY. Nothing in the sweep was changed.** Founder instruction: *"Do NOT change the sweep
in this pass. It works, the backfill proved it, and I'd rather understand the cost than trade a
known-good mechanism for an untested one."*

All measurements were taken live against `qwnnmljucajnexpxdgxr` on 2026-08-19 between 16:50 and
17:20 UTC. Every number below is paired with the instrument that produced it. Where an instrument
could not run, the line says so rather than estimating.

---

## 0. The mechanism — why no row is ever "unchanged"

`public.app_refresh_sweep(_budget_secs integer default 100)` — pg_cron jobid 13, `*/15 * * * *`,
called with no argument so the budget is **100 s**. It walks the union of ZIPs from `communities`,
`development_reports` and `app_community_meta`, ordered
`coalesce(f.escalated,false) asc, m.updated_at asc nulls first, cand.zip` — an oldest-page-first
rotation — calling `app_refresh_zip(zip)` and committing per ZIP until the budget expires.

`app_refresh_zip`'s `app_projects` upsert ends:

```sql
on conflict (zip, source_key, source_seq) do update set
  ... last_seen_at=excluded.last_seen_at;
```

`_run` is a fresh timestamp per call, so **`last_seen_at` differs on every pass by construction**.
There is no "unchanged row" case at the row level, and this is not incidental: the stale-row reaper
immediately below it is

```sql
delete from public.app_projects p
 where p.zip=_zip and (p.last_seen_at is null or p.last_seen_at < _run) and not exists (...)
```

so the heartbeat stamp *is* the mechanism that removes records the upstream dropped. Any proposal
that stops writing it has to replace the reaper too.

---

## 1. What the churn costs — measured, not inferred

### The attribution is direct, from `pg_stat_statements`

| statement | calls | WAL | % of all WAL | exec | % of all exec time |
|---|---|---|---|---|---|
| **`call public.app_refresh_sweep()`** | 79 | **44 GB** | **94.5%** | **7,968 s** | **62.6%** |
| `select public.dev_refresh_tick()` | 79 | 568 MB | 1.2% | 1,118 s | 8.8% |
| everything else combined | — | ~2 GB | 4.3% | — | 28.6% |

**570 MB of WAL and 101 s of execution per tick.** The 101 s against a 100 s budget is the finding
hiding in plain sight: **the sweep spends its entire budget on every single tick.** It is
budget-limited, never work-limited — it has never once finished early.

### Rotation period and per-ZIP cost

`app_community_meta.updated_at`, all 12,722 rows, grouped by hour:

```
13:00  4453      oldest row 2026-08-19 13:01:36
14:00  1761      newest row 2026-08-19 17:01:39
15:00  1967      -> a FULL PASS IS ~4 HOURS, i.e. ~6 passes/day
16:00  3443
17:00  1098
```

~1,098 ZIPs per tick / 100 s = **~11 ZIPs/s, ~91 ms per ZIP**.

### The table, and why the updates are expensive

| | value | instrument |
|---|---|---|
| rows | 3,079,005 | `pg_class.reltuples` |
| total size | 4,209 MB (heap 2,869 MB + 1,340 MB indexes) | `pg_total_relation_size` |
| `n_tup_upd` | 17,580,429 | `pg_stat_user_tables` |
| `n_tup_hot_upd` | 5,185,678 (29.5%) | ” |
| **`n_tup_newpage_upd`** | **12,394,463 (70.5%)** | ” |
| `n_tup_ins` / `n_tup_del` | 27,458 / 30,610 | ” |
| fillfactor | **default 100** (`reloptions` is NULL) | `pg_class` |
| row width | ~975 B, 8.4 rows/page | `relpages`/`reltuples` |

**70.5% of updates are non-HOT** — the row cannot stay on its page, so every one of the four
indexes gets a new entry. That is the multiplier turning a heartbeat column into 44 GB of WAL.

Two independent derivations of the write rate agree: 3,079,005 rows × 6 passes/day = **18.5M
row-updates/day**; and 17.58M `n_tup_upd` over the 19.67 h since the stats reset = **21.4M/day**.

### Everything else that pays for it

- **WAL, cluster-wide:** 62 GB in 19.67 h = **76 GB/day**; 127,120,069 records, 19,977,310 full-page
  images (`pg_stat_wal`). The sweep is 94.5% of it.
- **Checkpointer:** 59 GB of buffers written in 19.67 h ≈ **72 GB/day** (`pg_stat_checkpointer`).
  235 timed vs **2** requested checkpoints, with `max_wal_size=4GB` — so this is steady write
  bandwidth, *not* checkpoint thrash. Nothing is falling over.
- **Autovacuum:** 23 autovacuums + 39 autoanalyzes on `app_projects` in 19.67 h (~28 and ~48 per
  day). `autovacuum_vacuum_scale_factor=0.2` puts the threshold at ~616k dead tuples; at 18.5M
  updates/day that needs ~30 cycles/day just to break even, and it is achieving that —
  `n_dead_tup` sampled at 290,635, below the threshold. **Autovacuum is keeping up, not falling
  behind.** Each cycle still scans a 2.87 GB heap and 1.34 GB of indexes.
- **Replication: NOT a cost today. 0 replication slots, 0 `pg_stat_replication` connections.**
  But `wal_level=logical`, so the WAL already carries logical-decoding overhead, and the day a slot
  appears — Realtime, a read replica, any CDC pipeline — it inherits **76 GB/day to decode**. Latent,
  not current.
- **Index bloat: NOT MEASURED.** `pgstattuple` is not installed, so only sizes are available
  (`zip_kind_date` 559 MB · `zip_source_key` uidx 419 MB · `zip` 184 MB · pkey 178 MB). Any bloat
  figure here would be arithmetic dressed as a measurement.
- **Plan stability: NOT MEASURED**, and no symptom was observed. 39 autoanalyzes in 19.67 h keep
  `app_projects` statistics fresh; I found no evidence of plan drift and did not probe for it.

---

## 2. (a) Does it NEED to rewrite unchanged rows? — three signals, not one

### Signal 1 — `development_reports.refreshed_at` (cheap and available)

Reading it does **not** touch the multi-MB `sites` jsonb: `development_reports` is 507 MB total but
its heap is only **15 MB** — the jsonb is TOASTed out of line. A skip predicate can read this
column for all 12,722 ZIPs almost free.

⚠️ **THE OBVIOUS NUMBER HERE IS THE WRONG ONE.** A snapshot says **11,965 of 12,722 (94.1%)** have a
cache row not newer than their page. Quoting that as "94% of the work is redundant" would be a Rule
13 error — it answers *"at this instant, how many pages are ahead of their cache"*, not *"per pass,
how many refreshes find nothing new"*. Pages refresh 6×/day and caches change less often, so most
pages are ahead at any instant almost by definition.

The rate is the honest measure: `development_reports.n_tup_upd` = 28,265 over 12,722 rows in
19.67 h = **2.7 cache changes per ZIP per day**, against the sweep's **6 materializations per ZIP
per day**.

> **Cache-driven skipping would remove ~55% of materializations, not ~94%.**

### Signal 2 — `alerts` and `meetings` are a SEPARATE upstream

`app_refresh_zip` also reads `public.meetings` and `public.alerts` to build `app_changes`. Signal 1
says nothing about them. A skip keyed on the cache alone would freeze government-notice and meeting
propagation onto pages while every instrument reported success.

### Signal 3 — TIME ITSELF, and this is what breaks a content hash

Two of the queries are relative to `now()`:

```sql
where m.community_id = ... and m.meeting_date >= now()                    -- meetings
where ... and a.created_at >= now() - interval '14 days'                  -- alerts, x2
```

**The correct output changes with the clock even when every upstream byte is identical.** Measured:
**53 meetings fall out of "upcoming" in the next 24 h**, and **526 alerts leave the 14-day window in
the next 24 h**. A content-hash skip would leave a finished meeting rendered as upcoming on a
resident's page.

So a skip predicate is a three-way OR — cache watermark, upstream-write watermark, and elapsed time
— not a hash.

### ⚠️ CONFOUND — do not size the saving from this window

**The ingest engine wrote nothing during the measurement window.** Newest `alerts.created_at` is
`2026-08-18 20:04:00`; newest `meetings.created_at` is `2026-08-18 18:12:07`. Both tables show
`n_tup_ins = 0` since the stats reset — consistent, so the instrument is honest, not broken.

Daily counts for context:

```
2026-08-12  alerts 4741  meetings   62
2026-08-13         1412            3243
2026-08-14          456               3
2026-08-15          528             701
2026-08-16          270             180
2026-08-17          408              42
2026-08-18          446             210
2026-08-19            0               0     <- nothing, for 21 hours
```

Signal 2 therefore looks free right now and would not be under normal ingest. **Any saving
estimated from this window is an overestimate.**

> 📌 **Separate observation, worth its own look:** 21 hours with zero ingest writes is longer than
> the 4 h / 6 h cadence the 2026-08-16 Actions-budget cut set. That is the `homesignal-ingest` repo
> and out of scope for this pass, but it is not obviously normal.

---

## 3. (c) What a stale skip looks like, and how it would be caught

Failure modes, worst first:

1. **Time-window staleness.** A concluded meeting keeps rendering as upcoming; an alert past 14 days
   keeps showing. Silent, resident-visible, and the *most likely* mode because it needs no upstream
   change at all.
2. **A missed upstream write.** An alert lands for a community, that ZIP's cache did not move, the
   page never picks it up.
3. **Reaper starvation.** The stale-row delete runs only inside `app_refresh_zip`. Skip a ZIP
   indefinitely and records the upstream dropped survive on the page indefinitely.
4. **A predicate bug that says "nothing changed" for everything.** The whole site freezes while every
   instrument reports success — the wrong-zero class. This is the one that would go longest unnoticed,
   because a skipped ZIP produces no error, no row, and no log line.

**Detection must exist before any skipping ships, not after.** Three pieces, cheapest first:

- **A max-age floor.** Never skip a ZIP whose page is older than N (24 h is the natural first value).
  This alone bounds all four modes and keeps the reaper running on every ZIP daily. It is also the
  only one of the three that is a *guarantee* rather than a detector.
- **A shadow audit.** Each tick, force-refresh a small random sample (~25) of ZIPs the predicate said
  to skip and fingerprint their row set before and after. A non-zero diff rate is the alarm. This is
  what makes the skip's silence mean something — without it, "skipped" and "broken" are
  indistinguishable, which is the failure this codebase has hit repeatedly.
- **Skip rate as a first-class metric with a floor AND a ceiling.** 0% means the predicate is inert;
  ~100% means it is broken. Alarm on both ends, not just the high one.

---

## 4. Cheaper levers that do not require a skip decision

Listed with honest sizing. **Not recommended, not done** — the founder asked for understanding, not
a trade.

- **`fillfactor` on `app_projects`.** At ~975 B/row and 8.4 rows/page, `fillfactor=90` reserves
  ~819 B ≈ **0.84 rows of HOT headroom per page** and grows the heap ~11% (2.87 → ~3.2 GB). It would
  lift the 29.5% HOT ratio but cannot fix it: rows this wide make HOT structurally hard. A partial
  win, with a real cost, on the largest table.
- **Split `last_seen_at` into a narrow side table** keyed by `(zip, source_key, source_seq)`. The
  per-pass heartbeat would dirty a ~30-byte tuple instead of a ~975-byte one, and would not touch the
  four wide indexes. **This is the change that would actually collapse the churn**, because it removes
  the reason every row is dirtied rather than reducing how often. It is also a schema change to a
  3.08M-row / 4.2 GB table plus a rewrite of the reaper — far larger than a skip predicate, and it
  should not be started on the strength of this document alone.

---

## 5. Recommendation, for a founder call

**If anything is done, do the instrumentation first and the skipping second.**

Ship the **max-age floor + shadow audit + skip-rate metric with the predicate evaluated but NOT
acted on**. That is a pure-observation change: the sweep behaves exactly as it does today, and after
one full day it yields a *measured* skip rate and a *measured* would-have-been-wrong rate, against
real ingest rather than the quiet window this investigation happened to land in. Then the decision
to actually skip is made on evidence.

The alternative ordering — skip first, instrument after — is the one where a stale page is
discovered by a resident.

**Current state: unchanged. The sweep works; nothing here was traded for it.**
