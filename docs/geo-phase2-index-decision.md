# Phase 2 — `app_projects(created_at)` index: NOT CREATED (decision, 2026-09-19)

**Verdict: the index is NOT required. Phase 2 passes with no index created.**

Phase 2 was authorised to add `app_projects(created_at)` *if proven necessary*. Live evidence
says it is not, and that creating it now would commit storage and write amplification to a
Phase 5 design that is not yet chosen. **Do not create this index mechanically in a later
session — re-read this file first.**

## Live index landscape (re-measured; prior repo documentation was stale)

`public.app_projects` — 3,210,768 rows, heap 2,899 MB, indexes 1,877 MB, total **4,777 MB**.
Six indexes, **all valid/ready/live; 0 invalid indexes database-wide**. **None contains
`created_at`.**

| index | size | definition |
|---|---:|---|
| `app_projects_zip_kind_date_idx` | 559 MB | `(zip, record_kind, submitted_at DESC NULLS LAST, id)` |
| `app_projects_zip_source_key_uidx` | 436 MB | UNIQUE `(zip, source_key, source_seq)` |
| `app_projects_skey_kind_id_idx` | 351 MB | `(source_key, record_kind, id)` |
| `app_projects_zip_idx` | 226 MB | `(zip)` |
| `app_projects_pkey` | 178 MB | UNIQUE `(id)` |
| `app_projects_source_key_kind_idx` | 127 MB | `(source_key, record_kind)` |

## Evidence

**1. The watermark query does need an index — it seq-scans today.**
`EXPLAIN` of the bounded candidate query (`created_at > watermark` + eligibility):
`Parallel Seq Scan on app_projects, cost 404,040.88`, estimated 12 rows returned. The full
2,899 MB heap, per tick, to find ~a dozen rows. So *if* Phase 5 uses a global `created_at`
watermark, the index is mandatory.

**2. But a per-ZIP candidate query already runs on existing indexes.** Measured
`EXPLAIN (ANALYZE, BUFFERS)`:

| ZIP | eligible rows | candidates | plan | time |
|---|---:|---:|---|---:|
| 64165 (sparse) | 114 | 2 | `Index Scan app_projects_zip_kind_date_idx` + `Index Only Scan n5_geom_sk_ix`, **Heap Fetches 0** | **88.6 ms** |
| 85034 (dense) | 3,327 | 100 | same | **1,898.9 ms** |

64165 returned exactly the **2 known post-freeze KCMO control records** — a correct positive
control, not just a fast plan. ~0.6 ms per eligible row ⇒ a full national sweep of 2,994,606
eligible development rows ≈ **30 minutes single-threaded, cold**. That is far inside any
sane SLA and far inside the 24h backlog-age gate. **Zero new indexes, zero new storage,
zero write amplification.**

**3. BRIN is ruled out — measured, not assumed.** `pg_stats.correlation` for `created_at` is
**−0.0232** (`last_seen_at` −0.0072). There is no physical clustering to exploit, because the
`*/2` upsert churn rewrites rows across the heap. A watermark would need a full btree
(~145–200 MB estimated by scaling the observed pkey bloat factor), not a ~100 KB BRIN.

**4. A partial index on `record_kind` is pointless.** `development` is **93.27%** of the table
(2,994,606 of 3,210,768). A partial index saves 6.7% — not material.

**5. Disk headroom is genuinely uncertain, and the repo disagrees with itself.**
`scripts/n5_shard.py:42` declares `DISK_TOTAL_MB = 11607`; `scripts/phase2_b3_geometry.py:386`
declares `12288`. Measured now: db 10,368.6 MB + WAL 1,024.0 MB = **11,392.6 MB used**, so free
is **either ~214 MB or ~895 MB** depending on which constant is believed. Neither is a measured
filesystem figure. Spending an estimated 145–200 MB on an unnecessary index against an unknown
ceiling is the wrong trade. **Resolve the real disk ceiling before any future index decision.**

**6. `app_projects` is the hottest table in the system.** `dev-reports-rolling-refresh` fires
`*/2`. A seventh index adds write cost to every insert and to every non-HOT update, permanently,
for no proven benefit.

## ⚠️ A Phase 5 blocker found while proving this — `n5_geom` is NOT a sufficient ledger

The per-ZIP query above uses `not exists (… geo.n5_geom …)` as its completion test. **That test
is incomplete.** Measured key counts down the chain:

| stage | distinct source keys |
|---|---:|
| `geo.n5_geom` | 878,460 |
| `geo.n5_boundary_membership` | 875,907 |
| `geo.zip_authoritative_membership` | 872,227 |

**6,233 keys have geometry but no authoritative membership** (2,026 `n5_geom` rows carry
`outcome <> 1`, i.e. no usable geometry, which explains part but not all of it). A candidate
test keyed only on `n5_geom` would report those as done when they are not.

Each of the three stages needs its own "has this key been processed" test, and **two of the
three ledgers have no `source_key`-leading index** — `n5_boundary_membership` and
`zip_authoritative_membership` are both PK `(zcta5, source_key)`. Per-ZIP those are efficient
(the leading column is bound); globally they are not. This is the Phase 0 constraint #2
resurfacing one level down.

## What Phase 5 must decide (not decided here)

1. **Global watermark** (needs this index, ~145–200 MB, minute-level latency, handles INSERT
   only — Phase 11 deletes need a separate mechanism), **or**
2. **Rolling per-ZIP sweep** (no new index, ~30 min/sweep, hour-level latency, re-evaluates a
   whole ZIP so it yields Phase 11's delete/reconciliation path for free, and mirrors the
   already-proven `app_refresh_sweep` / `dev_refresh_tick` pattern).
3. Either way, a **three-stage ledger test**, not a single `n5_geom` check.
4. If (1) is chosen, note `created_at` has only **7,361 distinct values** across 3.2M rows —
   ingest writes in batches, so a strict `>` watermark can skip rows sharing the boundary
   timestamp. It would need `>=` plus dedup, or `(created_at, id)` ordering.

The evidence favours (2). It is not chosen here because Phase 2 is index-only.

## Production state — nothing was changed

No index created. No index dropped. No schema, data, function, cron or workflow change.
Every statement run in Phase 2 was `SELECT` or `EXPLAIN`. The single `EXPLAIN (ANALYZE)` pair
executed read-only candidate queries against two ZIPs.
