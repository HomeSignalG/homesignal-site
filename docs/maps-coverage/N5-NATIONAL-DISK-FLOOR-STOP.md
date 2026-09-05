# N5 national Development geography — acquisition halted on the disk floor

**Date:** 2026-09-04 · **Snapshot:** `phase1-2026-09-01` · **Runs:** ACQ16 `33848329434`,
ACQ17 `33849389288`, ACQ18 `33859396424`, ACQ19 `33861710122`

## 1. What stopped, and why it is not a defect

Shard 571 reported **VERIFIED CLEAN** — evidence closing on 95,182 legacy pairs, 100,969
associations written, 0 phantom projects, 0 second-run inserts, identical fingerprint
`a28c41c21e70eb6b8116bdc043fa8a9c` — and was then refused advance:

```
db / WAL MB          8,144 / 1,424
free MB (floor 2048) 2,039
disk above floor     NO
SHARD RESULT         HALTED - DISK_FLOOR
RUN HALTED           advance requires VERIFIED CLEAN **and** disk above floor
```

The gate did exactly what it exists for. The shard is reset to `pending`; re-running it is
idempotent (its own second-run insert count was already 0).

## 2. The remaining work does not fit, and the shortfall is not close

Sized from the MEASURED per-row cost of the tables the work writes, not from a capacity
model — `pg_total_relation_size / count(*)` on each target table.

| remaining work | unit | projected |
|---|---|---|
| 5 acquisition shards — associations | 729,392 pairs @ 0.209 KB | **153 MB** |
| 5 acquisition shards — proven verdicts | 199,098 projects @ 0.266 KB | **52 MB** |
| acquisition subtotal (geometry excluded — unknown, so understated) | | **≥205 MB** |
| downstream membership | ~795,000 rows @ 0.293 KB | **~233 MB** |
| downstream markers | ~1,575,000 rows @ 0.323 KB | **~509 MB** |
| **total** | | **~950 MB** |

**Headroom above the founder floor: 10 MB** (free 2,058, floor 2,048).

WAL cannot close this. It stands at 1,424 MB against `min_wal_size` 1 GB, so even a full
recycle returns ~400 MB of a ~950 MB gap, and it did NOT recycle across 11 idle minutes
(1,424 MB / 90 segments at both 10:24 and 10:35).

⚠️ **The one input that is not measured:** free is computed as `11,607 - (database + WAL)`,
and 11,607 is a CONSTANT in the driver, not a reading of provisioned capacity. The
Management API exposes no disk-size field, so it cannot be verified from here. If the
instance was resized operationally, true headroom is larger and this stop is an artefact of
a stale constant — which is precisely why the number is named rather than asserted.

## 3. Bucket F is mislabelled and the difference is 21x

`F_pending_acquisition` is the ELSE branch of the classification, so it conflates two states
that need different work:

| | ZIPs | prefixes |
|---|---:|---:|
| shard **done**, awaiting the downstream pipeline | **3,284** | 98 |
| shard genuinely **pending acquisition** | **151** | 5 |
| bucket F total | 3,435 | 103 |

Only 151 ZIPs are waiting on acquisition. The label overstates it by 21x, and the two halves
have opposite cost profiles.

## 4. The backlog is 10x denser than everything already cut over

The per-ZIP average that would have been the obvious estimate is wrong by an order of
magnitude, because ACQ17-19 acquired the mega-metros:

| | ZIPs | evidence=1 associations |
|---|---:|---:|
| already cut over | 8,379 | **61,733** |
| downstream backlog | 3,284 | **639,759** |

That 10.4x ratio is why the downstream pipeline (~742 MB) is more expensive than finishing
acquisition (~205 MB), which is the opposite of the intuition.

## 5. State at the stop

| | |
|---|---|
| shards done / pending | **539 / 5** |
| projects acquired | **610,897+** |
| associations | 2,172,054 |
| geometry rows | 1,166,901 |
| ZIP pages `production_geography_verified` | **8,379 / 12,722** |
| held on frozen-vs-live drift | **126** (1,574 source_keys removed from live; **missing_not_in_freeze = 0**) |
| per-ZIP export | 12,722 rows, refreshed 2026-09-04 10:26:24Z |

Buckets close exactly on 12,722: A 5,117 · B 3,262 · C 126 · D 337 · E 445 · F 3,435.

## 6. Defects found and fixed in this series

Each was found only because the previous fix moved the bottleneck.

1. **Cloudflare 524 on `shard_counts`** (shard 934). Raising the Postgres statement timeout
   moved the failure onto the 120 s proxy read timeout. No write had occurred. The statement
   re-runs in **930 ms** (`EXPLAIN ANALYZE`, all `shared hit`), so the cause is UNPROVEN.
   Fixed by retrying transport 5xx under a CHECKED `read_only` flag — writes stay fatal on
   the first lost response — plus `ANALYZE` after the working set is replaced.
2. **Recovery fetch at a fixed IN-list of 10** (shard 722, 47,223 projects = ~2,850 POSTs,
   1h44m and counting). Batch size now comes from the publisher's `maxRecordCount`.
3. **Presence read as completeness.** The interrupted fetch left 105,175 committed geometry
   rows with no marker; the next run's cache probe would have called those keys done
   forever. `geo.n5_recovery_attempt.complete` now records it.
4. **`feature_id` was a function of the FETCH, not the feature** — `<ident>#<global counter>`
   — so a re-fetch could not match `ON CONFLICT` and inserted second copies. Measured: **467
   keys with rows from both runs, 1,961 old against 1,929 new.** Now per-identity, ordered by
   geometry. Duplicates cost storage and inflate the `features` statistic; they do NOT reach
   membership or markers, both of which read through `select distinct source_key`.
5. **`insert_batched` opened at 25 rows** — sized for the worst row in the corpus (an 11 MB
   polygon) and charging that to every load. Now sized from the mean length of the rows in
   hand, against a 2 MB target and a 1,000-row cap.

A correction to my own first reading of #4, recorded because the wrong version was the more
convincing one: `88 rows / 88 feature_ids / 1 distinct geometry` is NOT evidence of
duplication. Shard 720 ran once, cleanly, and its heaviest key holds 80 rows with one
distinct geometry straight from the publisher. Only the two-run query proves duplication.

## 7. Sections 7 and 8 — unchanged, re-verified

| | measured |
|---|---|
| 941/952 Caltrans | **34 projects, 0 of them in the frozen baseline** — post-baseline, isolated, not silently omitted |
| prefix-786 NULL `registry_id` | **5 projects, all 5 in the frozen baseline** — identity-unresolved, not guessed |
