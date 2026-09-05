# N5 national Development geography — execution log

Execution unit, 2026-09-03. Production geography advanced from **346 → 420 verified ZIPs**.
Every stage measured; the hard 2 GB floor was never breached.

## Pre-flight

free **2,148.1 MB** (above the 2,048 floor by 100.1) · index VALID · shards 18/526/544 ·
membership `ff09ed6d…` · marker `e3a0efeb…` 13,221 · n5_association 21,674 ·
n5_boundary_membership 18,184 · n5_geom 741,562 · registry 12,722 · reports 12,722 ·
verified 346 serving 5,842/13,218. All match the brief's stated controls exactly.

## Queue correction 941/952 — NOT APPLIED, and why

The brief expected an additive shard insert giving 546 prefixes. **The evidence refuses that.**

`geo.n5_shard` manifests are frozen from `preservation.app_project_identity` and each shard's
freeze is checksum-verified against the manifest. Measured:

- `preservation.app_project_identity` for prefixes 941/952 contains **only `record_kind='facility'`
  rows (35)** — 20 in 941, 15 in 952. Control: the same query shape returns 918 rows / 219
  projects for prefix 102, so the query works; and there is exactly **one** snapshot.
- The 34 Caltrans SB1 **development** rows exist only in `public.app_projects`, created
  **2026-09-01 20:30 → 2026-09-02 03:15 — after the `phase1-2026-09-01` baseline was frozen.**

So a shard row derived from `app_projects` would fail the driver's freeze checksum
(`FREEZE_DRIFT`, 0 frozen projects vs a manifest of 32), and one derived from the snapshot would
claim zero development projects. **Adding 941/952 is a preservation-snapshot extension, not a
queue insert.** Nothing was mutated; the 34 projects are untouched. Tracked universe remains
**544** until that decision is made.

The five prefix-786 projects with NULL `registry_id` remain **explicit IDENTITY_UNRESOLVED** —
they map to no N2 treatment and identity is not deterministically provable from retained
evidence. Not reclassified to NOAUTH.

## Batch 01 — full pipeline, 5 prefixes

`102, 707, 808, 488, 485` — 708 projects, 1,381 legacy pairs.

| stage | result |
|---|---|
| shard (association) | 5/5 done in 92.5 s (~18.5 s/prefix), +1,504 association rows |
| boundary-first | `n5_boundary_membership` 18,184 → **18,684** (+500), ZIPs 402 → 423 |
| Unit A shadow | membership 5,845 → **6,344** (+499), status 428 → 484, `boundary_complete` 364 → **420**, `not_measured` **64 unchanged** |
| markers (A3 algorithm, unchanged) | 13,221 → **13,720** (+499), ZIPs 337 → 357 |

Marker quality: **0 memberships without a marker · 0 duplicate coordinates · 0 `marker_seq`
violations.** The 499 new memberships produced exactly 499 markers — 1:1, consistent with the
point-dominant national profile (724,301 of 734,728 geometry keys are points).

## Production cutover — group 2

74 eligible ZIPs (56 newly boundary-complete + the 18 previously excluded), all canonical, all
`boundary_complete`, carrying 502 memberships / 502 markers, **53 of them measured-zero**.

Shadow reconciliation before cutover: 502 projects = 502 memberships · 502 markers = 502
relation markers · 0 duplicates · 0 orphans · 0 coordinate differences.

Staged disabled first (420 rows: 346 enabled + 74 disabled), then enabled.

**Production reconciliation, all 420, through the production path:**

| check | value |
|---|---:|
| production projects | **6,344** (= memberships) |
| production markers | **13,720** (= relation markers) |
| duplicate projects · orphan markers | 0 · 0 |
| marker coordinate differences | **0** |
| relation markers missing from production | **0** |
| memberships missing · projects outside membership | 0 · 0 |
| markerless projects | 0 |
| facility row-count changes | **0** |

Performance: **p50 15.1 ms · p95 46.0 ms · p99 55.5 ms · max 67.4 ms · 0 over 500 ms · 0 over
2 s**, max payload 203 kB. Gate passed.

**420 ZIPs marked `production_geography_verified`** (346 → 420).

## Storage — the earlier pessimism did not hold

| | before batch 01 | after full pipeline + cutover |
|---|---:|---:|
| free | 2,148.1 MB | **2,147.4 MB** |
| WAL | 2,016.0 MB | **2,016.0 MB** |

**The entire 5-prefix pipeline cost 0.7 MB of free space and zero WAL growth.** The ~976 MB WAL
expansion seen in the previous unit was a one-time pool expansion from 1,040 MB; with the pool
at 2,016 MB it absorbed these writes without growing. My prior "national build needs ~2.3 GB"
model stands for the *persistent* total, but the per-batch transient fear was wrong and is
withdrawn.

Measured persistent cost, anchored on a full pipeline: **0.7 MB per 708 projects ≈ 0.99 KB per
project**, implying roughly **890 MB** for the ~900,197 remaining acquirable projects.

## Batch 02 — dispatched

40 prefixes (`055,108,118,120,121,123,124,125,126,128,140,141,144,145,153,156,160,179,216,217,
350,351,352,354,355,360,361,365,366,368,484,492,493,581,588,687,870,996,997,999`):
881 projects · 1,311 legacy pairs · 339 shard ZIPs · 0 RECOVERY needed · 0 terminal.
Selected from 101 candidate prefixes that require no publisher fetch (197,054 projects /
413,534 pairs / 1,815 ZIPs available on the same terms).

## Preservation

The 346 pre-existing verified ZIPs were re-checked at every stage and never moved: 5,842
projects / 13,218 markers, facility row counts unchanged. `not_measured` stayed at 64
throughout — no non-ZCTA ZIP was fabricated, mapped to a neighbour, or called zero.
