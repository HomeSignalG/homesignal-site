# N5 capacity remediation — measurement, safe reclamation, and a RED verdict

Measured 2026-09-03. No acquisition prefix, no boundary placement, no marker generation, no
production change. Two scratch relations were dropped under the Step 6 authorization.

## 1. Current state (measured fresh)

| | value |
|---|---|
| database | 7,441.3 MB (7,597.9 before cleanup) |
| WAL | **2,016.0 MB, 127 files** |
| free | **2,149.7 MB** (1,993.1 before cleanup — i.e. it was BELOW the floor) |
| acquisition_complete | 18 prefixes · pending 526 |
| production_geography_verified | 346 |
| canonical registry / development_reports | 12,722 / 12,722 |
| source-key index | VALID, 103 MB |
| the 346 in production | 5,842 projects / 13,218 markers, healthy |

Largest relations: `public.app_projects` 4,369.3 MB (heap 2,868.6 + idx 1,500.7, **498,375 dead
tuples**) · `public.development_reports` 557.2 (542.2 TOAST) · `geo.n5_geom` 538.4 ·
`geo.n5_proven_verdict` 188.2 · `geo.b4_candidate_zcta_measurement` 129.8 ·
`geo.n5_nat_pk` 115.1 · `geo.n5_a3_descriptive_pool` 41.5 · `geo.n5_a3_clip_component` 13.2 ·
authoritative marker 6.7 · n5_boundary_membership 4.4 · n5_association 3.7 · membership 2.3.

## 2. The ~1.1 GB drop, decomposed

Free 3,123.7 → 1,993.1 MB = **1,130.6 MB**.

| class | amount | share |
|---|---:|---:|
| **D. WAL** | **+976 MB** | **86.3%** |
| C. scratch that remained (`geo.n5_nat_pk`, created for the queue) | +115.1 MB | 10.2% |
| F. other (apparent `n5_geom` growth with ZERO new rows — index/vacuum churn) | ~+19 MB | 1.7% |
| A. persistent authoritative data (`n5_association` +1,504 rows) | **+0.18 MB** | **0.02%** |
| B. indexes | included in the per-relation figures above | — |
| E. dead tuples/bloat | 498,375 dead in `app_projects`; not created by this batch | — |

**The drop was overwhelmingly transient/operational, not authoritative data.**

## 3. WAL diagnosis

| probe | result |
|---|---|
| replication slots | **0** |
| replication clients | 0 |
| `wal_keep_size` | 0 |
| `max_wal_size` / `min_wal_size` | **4096 MB** / 1024 MB |
| `archive_mode` / archiver | on / **12,438 archived, 0 failed**, current through `…B700000032` |
| checkpoints | 877 timed, 5 requested |
| long transactions / idle-in-transaction | 0 / 0 |

**Nothing abnormal retains WAL.** The growth is expected transient WAL from a write-heavy
batch. But it is **not being returned**: measured 1,984 → 2,016 MB across ~25 minutes with no
batch running. Postgres recycles segments for reuse and retains toward recent peak demand,
shrinking toward `min_wal_size` only gradually. **`max_wal_size = 4096 MB` means a heavy batch
may claim up to ~2 GB more than is held today** — that is the transient headroom the plan must
budget for, and it is why "WAL will recycle" cannot be assumed.

## 4-6. Scratch inventory, classification, and what was dropped

| relation | MB | unit | production | preservation | needed to resume | reproducible | class |
|---|---:|---|---|---|---|---|---|
| `geo.n5_nat_pk` | 115.1 | N5 queue (this session) | no | no | no | yes, one SELECT | **SAFE_TO_DROP** |
| `geo.n5_a3_descriptive_pool` | 41.5 | A3 step 10 analysis | no | no | no | yes, one SELECT | **SAFE_TO_DROP** |
| `geo.n5_a3_clip_component` | 13.2 | A3 marker measurement | no | no | no | yes, runner + TIGER | KEEP (marker-rule evidence, cheap) |
| `geo.n5_a3_merged_component` | 3.0 | A3 LineMerge measurement | no | no | no | yes | KEEP (cheap) |
| `geo.n5_b_precutover_baseline` | <1 | Unit B rollback receipt | no | **yes** | — | no | **KEEP** |
| `geo.n5_proven_verdict` | 188.2 | N5 verdict provenance | no | yes | likely | costly | **KEEP** |
| `geo.b4_candidate_zcta_measurement` | 129.8 | B4 candidate measurement | no | unproven | unproven | costly | **UNCERTAIN — not dropped** |
| `geo.n5_a3_bench`, `n5_a4_contract_bench`, `n5_b_prod_bench`, `n5_a3_clip_stats` | <2 each | benchmarks | no | no | no | yes | KEEP (negligible) |
| `geo.n3_*`, `geo.project_*`, `geo.n5_point_reject*` | ≤20 | N3/N2 provenance | no | yes | yes | costly | **KEEP** |

Proof recorded before dropping (`geo.n5_reclaim_log`): for both dropped relations, **0**
referencing functions, views, matviews, constraints and triggers, and **0** references in any
repo driver (`scripts/`, `supabase/`, `lib/`, pages). Both are derived wholly from
`public.app_projects`; the reproducing SQL is stored in the log.

**Dropped: `geo.n5_nat_pk` + `geo.n5_a3_descriptive_pool`.** Nothing on the protected list was
touched.

## 7. Post-cleanup

database 7,597.8 → **7,441.3 MB** · **reclaimed 156.5 MB** · free 1,993.2 → **2,149.7 MB**
(above the 2,048 floor by **101.7 MB**) · WAL unchanged at 2,016 MB.

⚠️ The first post-drop reading showed only 0.1 MB reclaimed, because the size was measured in
the same transaction as the DROP, before the files were unlinked at commit. Re-measured in a
fresh statement.

## 8. Batch 01's real persistent cost

**`geo.n5_geom` row count is unchanged at 741,562 — the batch acquired ZERO new geometry rows**
(all 659 geometry rows for its prefixes already existed). Persistent growth is the association
rows alone: `n5_association` 3.528 → 3.711 MB = **+0.183 MB** for +1,504 rows.

| measure | value |
|---|---:|
| bytes per project (708) | **0.26 KB** |
| bytes per legacy pair (1,381) | **0.136 KB** |
| bytes per new association (1,504) | **0.125 KB** |
| geometry growth | **0 rows, 0 MB** |
| shard/status growth | 0.195 MB total table |

**The association stage is essentially free.** The ~1.1 GB free-space loss was NOT persistent
growth. But batch 01 exercised only acquisition/association — boundary membership, authoritative
membership and markers, the expensive stages, were not run and are not measured by it.

## 9. Revised national capacity model

Using current measured densities (association 0.175 KB/row all-in; boundary membership
0.248 KB/row; membership 0.401; marker 0.522; geometry 0.743 + payload) and the frozen N2
counts (2,733,889 pending shard pairs; 177,566 projects still needing geometry):

| component | expected | conservative | worst credible |
|---|---:|---:|---:|
| associations | 521 MB | 677 | 782 |
| boundary memberships | 619 MB | 805 | 929 |
| authoritative memberships | 380 MB | 494 | 570 |
| markers | 578 MB | 751 | 867 |
| geometry acquisition | 201 MB | 262 | 603 |
| **persistent total** | **2,299 MB** | **2,989 MB** | **3,751 MB** |

Projected minimum free space from today's 2,149.7 MB:

| case | projected free | vs 2,048 floor |
|---|---:|---|
| expected | **−149 MB** | **BREACH** |
| conservative | −839 MB | BREACH |
| worst credible | −1,601 MB | BREACH |

Transient/WAL headroom required per batch: **~1,000 MB observed** on a 5-prefix batch, and up to
~2,080 MB more than currently held if WAL reaches `max_wal_size`.

## 10. Classification: **RED**

The expected case breaches the 2,048 MB floor before any WAL headroom is counted.

## 11. Options, ranked (NOT executed)

1. **Increase provisioned database storage.** Preservation risk none; implementation risk
   lowest; gain as provisioned; complexity low. To reach GREEN (conservative case + 512 MB
   safety + ~1 GB WAL headroom) needs roughly **+4.5 GB**. This is the only option that closes
   a ~2.3 GB gap.
2. **Change batch/transient strategy** — smaller prefix batches with checkpoint pacing. Gain:
   caps the ~1 GB per-batch WAL peak. Does not reduce the persistent requirement.
3. **Prove and drop UNCERTAIN scratch** (`b4_candidate_zcta_measurement` 129.8 MB, and
   `n5_proven_verdict` 188.2 MB only if provably redundant). Gain ≤ 318 MB; medium preservation
   risk; does not close the gap.
4. **Reclaim `app_projects` bloat** — 498,375 dead tuples over a 2,868.6 MB heap plus
   1,500.7 MB of indexes. `VACUUM FULL`/`REINDEX` could return several hundred MB, but needs
   roughly 2.9 GB of temporary free space (only 2.15 GB exists) and takes an ACCESS EXCLUSIVE
   lock on the live production table. **Currently impossible and high risk.**
5. **Lower `max_wal_size`** — caps transient peak. Excluded here: the brief forbids altering
   WAL configuration.
6. **Persistence redesign** (e.g. do not persist national boundary membership; derive markers
   on demand). Largest gain, highest risk. Last resort.

## 12. Queue discrepancies — investigation only, nothing mutated

**Prefixes 941 and 952** — registry `caltrans-sb1-projects`, treatment **RECOVERY**, no
geometry yet, **no `geo.n5_shard` row**:

| prefix | projects | ZIPs | canonical ZIPs in prefix | geometry available |
|---|---:|---:|---:|---:|
| 941 | 32 | 1 | 1 | 0 |
| 952 | 2 | 1 | 1 | 0 |

**Exact later correction:** insert two `geo.n5_shard` rows (`snapshot_id` = the current
manifest, `z3` 941 and 952, `state='pending'`, projects/pairs/zips 32/32/1 and 2/2/1). This is
purely additive — the 34 projects already exist in `public.app_projects` and are untouched; the
insert only makes them visible to the queue. Universe becomes **546**. Both are RECOVERY, so
they need geometry acquisition before any boundary work.

**5 projects with NULL `registry_id`** — all in prefix **786** (which has a shard row and is
pending), 1 ZIP, no geometry. They map to no N2 treatment, and source eligibility must not be
derived by parsing `source_key`. Correct classification: **explicit identity unresolved**. The
later correction is either a `registry_id` backfill from the source system, or recording them
explicitly as identity-unresolved so prefix 786 can reach acquisition_complete honestly. They
must not be silently folded into NOAUTH or dropped.

## 13. Preservation

346 cutover ZIPs serving **5,842 projects / 13,218 markers** · facilities **346 checked, 0
row-count changes, 7,029 rows both sides**, one raw md5 difference (06390) proven to be
`last_seen_at` only, same 2 rows, same names, same coordinates · membership
`ff09ed6d59b3a436bf0a8c9ca6f5eaa9` · marker `e3a0efeb826befc77a4ec57762cf4a1f` ·
n5_association 21,674 · n5_boundary_membership 18,184 · n5_geom 741,562 · shards 18 done ·
production_geography_verified 346 · canonical registry 12,722 · development_reports 12,722 ·
source-key index VALID. No SEO/indexability/sitemap/workbook work.
