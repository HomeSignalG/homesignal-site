# Unit A3 — authoritative marker grain + one-pass shadow read benchmark

Measured 2026-09-03. Every number below was produced by the query shown beside it in the
session transcript; nothing here is extrapolated. Production was not modified.

Preservation control, re-verified at the start and end of this unit:
`public.app_projects_for_zip` md5 = `ec1b01ae4485ad2c59b9f946c9d565b6` — MATCHES the baseline.
No index was created on `public.app_projects`. Unit B was not reattempted.

---

## 1. The shadow read

`geo.n5_a3_projects_one_pass(p_zip text)` — SECURITY INVOKER, STABLE,
`proacl = {postgres=X/postgres}` (PUBLIC EXECUTE revoked; `geo` has no anon/authenticated
USAGE, so there is no web-reachable path to it).

Descriptive-row selection is `distinct on (p.source_key) … order by p.source_key, p.id asc`
— deterministic min(id). `last_seen_at` is absent from the selection, as required.

## 2. Plan shape — NOT one sequential scan

The proposed set-based read does **not** plan as one sequential scan + hash join. The planner
chooses a **Memoized nested loop over an index scan** on `app_projects_zip_source_key_uidx`.

The reason is structural, and it is the whole finding:

| fact | value |
|---|---|
| only index containing `source_key` | `app_projects_zip_source_key_uidx (zip, source_key, source_seq)` |
| position of `source_key` in it | **2nd — non-leading** |
| index size | 431 MB |
| `app_projects` heap size | 2,870 MB |
| `shared_buffers` | 1,024 MB |

Because `source_key` is non-leading, every distinct key costs a **full 431 MB index scan**
(~54,300 buffers per loop, all cache hits when warm). Because the heap (2,870 MB) exceeds
`shared_buffers` (1,024 MB), the sequential-scan alternative can never be cached.

Forcing the set-based plan (`enable_indexscan/bitmapscan/memoize = off`, in a rolled-back
transaction) measured the alternative directly on ZIP 06390:

- index nested loop: **1,788 ms** (`shared hit=381,350 read=2`)
- forced seq scan + hash join: **31,740 ms** (`hit=14,004 read=353,376 dirtied=106,749 written=58,113`)

The set-based plan is **17.8x slower**, and it additionally **evicts the 431 MB index from the
buffer pool** — measured side effect: the next call, which costs 286 ms warm, was still paying
cache-refill cost afterwards.

## 3. Benchmark — measured, one call per statement, warm index

Timing came from `EXPLAIN (ANALYZE) select geo.n5_a3_projects_one_pass('<zip>')`.

| ZIP | pick | distinct source_keys | Execution Time | ms per key |
|---|---|---:|---:|---:|
| 01009 | measured-zero, boundary_complete | 0 | ~1 ms | — |
| 01003 | min nonzero | 1 | 286 ms | 286 |
| 06390 | named | 7 | 1,788 ms | 255 |
| 01026 | p50 | 9 | 2,211 ms | 246 |
| 06242 | p95 | 54 | 15,543 ms | 288 |
| 06360 | max | 86 | 21,288 ms | 248 |

Cost is linear at ~245-290 ms per distinct source_key. A ZIP with zero authoritative
memberships never touches `app_projects` at all (~1 ms) — the honest-empty case is free.

Membership distribution over the 364 `boundary_complete` ZIPs (5,845 memberships):
min 0 · **p50 9** · **p95 54** · p99 73 · **max 86** distinct source_keys; 27 ZIPs at zero.

### INSTRUMENT FAULT, disclosed
An earlier attempt timed three calls inside one statement using `clock_timestamp()` in the
target list. PostgreSQL does not guarantee target-list evaluation order, so the per-call split
it produced (14.0 / 32562.4 / 4723.8 ms) was **not trustworthy attribution** and is discarded.
The same call it charged 32,562 ms measures **286 ms** warm. All numbers in the table above
were re-measured one call per statement.

## 4. The bounded strategy was tested and REJECTED on evidence

`geo.n5_association (source_key, zip, evidence)` would supply the index's leading column and
turn each probe into a seek. It cannot be used: it does not completely mirror legacy membership.

Measured over the 1,875 distinct source_keys in `geo.zip_authoritative_membership`
(one sequential scan, `record_kind='development'`):

| quantity | value |
|---|---:|
| `(source_key, zip)` pairs present in `app_projects` | 17,125 |
| of those, **absent** from `n5_association` | **4,983 (29.1%)** |
| `app_projects` rows for those keys | 48,032 |
| rows reachable via `n5_association` pairs | 41,555 |
| **rows that would be silently dropped** | **6,477 (13.5%)** |
| keys seen (control) | 1,875 of 1,875 |

Bounding the index by `n5_association` is **fail-open** — it loses 13.5% of descriptive rows
with no error. Rejected.

## 5. Marker grain — polygon half is UNMEASURED, and that is a hard blocker

Lines were measured in the previous pass. The polygon multi-component spread (659 memberships,
`family='ST_MultiPolygon'`, `n_components > 1`, max 106 components) **could not be measured**:

**No ZCTA boundary geometry for these ZIPs is resident in the database.**
`geo.n5_zcta` = 0 rows · `geo.n3_zcta_scratch` = 90 rows, 0 matching · `geo.zcta_boundary` =
56 rows, 0 matching (all 65 target ZCTAs absent). The A3 clip pass computed its clips on the
GitHub runner against the pinned TIGER file and wrote back statistics only. Measuring the
spread therefore requires a runner job, not a query.

A first attempt returned a **wrong-filter zero** (`family='polygon'`; the stored literal is
`'ST_MultiPolygon'`). The control that caught it: 3,312 polygon rows / 659 multi-component /
max 106, matching the prior pass exactly. Recorded because a zero that reads as "clean" is the
most dangerous result shape.

Because the polygon rule is unmeasured, **`geo.zip_authoritative_marker` was NOT built**.
Step 9 is gated on the measurement supporting a deterministic rule; half of it does not exist yet.

## 6. Frontend contract blocker — CONFIRMED

`maps.html:1121-1141` pushes each RPC row into `plotted` and indexes card clicks by that
array position; `maps.html:686` maps items to cards 1:1; `lib/map.js::HS.geojson(items)` emits
exactly one Point feature per item. **One RPC row = one card = one marker.**

Multiple authoritative markers per `(ZIP, source_key)` membership therefore cannot be delivered
without a frontend change, which A3 forbids. No frontend code was modified.

## 7. Self-caught correction

`geo.maps_zip_geography_status` carried `cutover = true` on 346 rows — left by the rolled-back
Unit B, asserting a cutover that does not exist. Production is provably still on the preserved
read path (md5 above), so the flag was false. Cleared: 346 rows set `cutover = false` with a
note recording why; verified in a separate statement (0 true / 428 false / 346 noted).
This is bookkeeping in a Unit A shadow table — no membership row was touched.

## 8. Decisions

- **C (marker grain):** UNDETERMINED. Line half measured; polygon half unmeasurable in-database.
  Blocked independently by §6 regardless of the measurement.
- **D (is the one-pass read fast enough without a new index?):** **NO.** p50 2.2 s, p95 15.5 s,
  max 21.3 s for a browser-facing RPC.
- **E (is a new `source_key` index actually required?):** **YES** — and the reason is structural
  (§2), not tuning. The index was **not** created; that remains the founder's call.
