# N5 national geography build — batch 01, and the capacity blocker

Measured 2026-09-03. One bounded batch of 5 prefixes was executed. **The unit then STOPPED on
the hard capacity gate: free disk fell below the 2 GB floor.** No boundary membership, no
marker generation and no production cutover were performed after that point.

## 1. Pre-state (reproduced exactly)

544 prefixes · 13 done · 531 pending. Completed list:
`010,011,012,013,014,015,016,017,018,019,062,063,520`; pending-set md5 `93f3c736…`.
membership 5,845 `ff09ed6d59b3a436bf0a8c9ca6f5eaa9` · marker 13,221
`e3a0efeb826befc77a4ec57762cf4a1f` · n5_association 20,170 · n5_boundary_membership 18,184 ·
n5_geom 741,562 · source-key index VALID · cutover 346 · production_geography_verified 346 ·
canonical registry 12,722 · development_reports 12,722 · **free disk 3,123.7 MB**.
The 346 verified healthy read-only: 5,842 projects / 13,218 markers, facilities unchanged.

## 2. National queue (computed, not extrapolated)

`geo.n5_nat_pk` — 1,046,604 distinct (prefix, project) pairs, 939,839 projects, 233 registries.

Pending prefixes, joined to the frozen N2 registry treatment:

| treatment | projects | legacy pairs | with geometry | without geometry | prefixes |
|---|---:|---:|---:|---:|---:|
| PROVEN | 736,526 | 815,019 | 707,828 | 28,698 | 327 |
| RECOVERY | 163,666 | 186,264 | 14,798 | 148,868 | 429 |
| NOAUTH | 22,554 | 22,554 | 0 | 22,554 | 8 |
| IDENT_UNRESOLVED | 6,203 | 10,988 | 0 | 6,203 | 5 |
| HIST_UNRECOVERABLE | 1,604 | 1,604 | 0 | 1,604 | 1 |
| (unmapped registry) | 5 | 5 | 0 | 5 | 1 |

Control: projects sum to 930,558, and the N2 treatment pair total (2,753,802) equals the
n5_shard pair total exactly.

- **Terminal, no acquisition possible: 30,361 projects** (NOAUTH + IDENT_UNRESOLVED +
  HIST_UNRECOVERABLE).
- **Acquisition still required: 177,566 projects** (PROVEN-without-geometry 28,698 +
  RECOVERY-without-geometry 148,868).
- **Prefixes blocked by missing ZCTA geometry:** none newly identified; the known non-ZCTA
  canonical ZIPs remain `not_measured` (64 status rows) and were not touched.

### Two discrepancies, reported rather than absorbed

1. **The 544-prefix universe is short by 2.** Prefixes **941** (32 projects) and **952** (2),
   both `arcgis:caltrans-sb1-projects`, exist in `public.app_projects` but have **no row in
   `geo.n5_shard`**, so 34 projects are outside the national work queue entirely.
2. **5 projects carry `registry_id` NULL** (prefix 786) and therefore map to no N2 treatment.

## 3. Capacity

Measured densities: n5_geom 0.724 KB per source_key all-in; membership 0.401 KB/row; marker
0.522 KB/row. Geometry payload itself is small — point **0.028 KB/key** (724,301 of 734,728
keys), polygon 0.468, line 3.164; all stored geometry is 29 MB. The 519 MB is row overhead
and indexes.

Yields measured on the 13 done prefixes: point 1.000 memberships/project and 1.000
markers/membership; polygon 7.631 and 1.348; line 1.758 and 3.457.

⚠️ **The polygon yield of 7.631 is NOT national.** Nationally polygon projects are parcels:
p50 **0.0004 km²**, p95 0.024 km², **8,845 of 8,922 under 1 km²**, only 43 over 100 km². A
400 m² parcel lies in exactly one ZCTA. The 7.631 comes from the 43 statewide CTDOT work-area
polygons dominating the Connecticut sample. Using it nationally would have overstated storage
by roughly 1 GB.

Corrected national projection: ~946,000 memberships (380 MB) + ~1,106,000 markers (578 MB) +
228 MB geometry ≈ **1,186 MB persistent**, against 1,075.7 MB of headroom above the floor at
pre-state plus ~175 MB of reclaimable working tables. **It fits by roughly 65 MB (~5%) on an
estimate with ±30% uncertainty, and only with reclamation.** That was flagged before executing.

## 4. Batch executed

Prefixes **102, 707, 808, 488, 485** — chosen because all have 0 RECOVERY-treatment and 0
terminal projects, giving a clean measurement. 708 projects · 1,381 legacy pairs (the shard
manifest's `(source_key, zip)` pairs; my planning table counted 708 distinct (prefix, project)
pairs and that column was mislabelled "legacy pairs") · 45 shard ZIPs / 66 canonical ZIPs ·
49 PROVEN-treatment projects lacking geometry.

| prefix | projects | pairs | ZIPs | seconds | association rows written |
|---|---:|---:|---:|---:|---:|
| 102 | 219 | 409 | 9 | 25.1 | 491 |
| 707 | 185 | 185 | 6 | 17.3 | 186 |
| 808 | 115 | 115 | 3 | 13.7 | 115 |
| 488 | 101 | 165 | 15 | 19.3 | 204 |
| 485 | 88 | 507 | 12 | 17.1 | 508 |
| **total** | **708** | **1,381** | **45** | **92.5** | **1,504** |

All five reached `state='done'`. `n5_association` 20,170 → 21,674 (+1,504).

**Sustained throughput: ~18.5 s per prefix.** At that rate the remaining 526 prefixes are
roughly 2.7 hours of shard runtime — runtime is NOT the national constraint. Storage is.

## 5. What this batch did and did NOT advance

`n5-shard` builds the **association** only. `geo.n5_boundary_membership` is unchanged at
18,184 and no marker was generated, so:

- **acquisition_complete: 13 → 18 prefixes**
- **boundary_complete: unchanged** (the 364 ZIPs from the original 13 prefixes)
- **marker_complete: unchanged**
- **production_geography_verified: 346, unchanged** — correctly not advanced by this unit

Boundary-first membership and marker generation for the 5 new prefixes were NOT run, because
the capacity gate tripped first.

## 6. THE CAPACITY BLOCKER

| | pre-state | after batch |
|---|---:|---:|
| free disk | 3,123.7 MB | **2,025.2 MB** |
| database | 7,100.7 MB | 7,597.8 MB |
| WAL | 1,040.0 MB | **1,984.0 MB** |

**Free disk is below the 2,048 MB hard floor.** The unit STOPPED there.

The drop is **dominated by WAL**, which grew 944 MB while the database itself grew ~497 MB
(the per-prefix ZCTA boundary scratch, which the driver drops at cleanup). WAL is normally
recycled at checkpoint; it had not been recycled at the second reading taken minutes later.

**No destructive cleanup was improvised.** Reclaimable-but-untouched working data, for the
founder to decide on: `geo.n5_nat_pk` 115 MB (this unit's queue table), `geo.n5_a3_descriptive_pool`
41 MB (A3 analysis scaffolding), `geo.n5_a3_clip_component` 13 MB, plus `n5_a3_merged_component`,
`n5_a3_bench`, `n5_a4_contract_bench`, `n5_b_prod_bench` and `n5_b_precutover_baseline` (the
last is the Unit B rollback receipt and should be kept until the cutover is settled).

## 7. Preservation

Unchanged: membership 5,845 `ff09ed6d…` · marker 13,221 `e3a0efeb…` · n5_geom 741,562 ·
n5_boundary_membership 18,184 · canonical registry 12,722 · development_reports 12,722 ·
source-key index VALID · read path `4591b67f08db6c76b7445295bca0eae8` · cutover 346 ·
production 5,842 projects / 13,218 markers. No SEO/indexability/sitemap/workbook work.

**Ordinary ingestion movement, reported separately:** ZIP 06390's facility payload md5 moved
because `last_seen_at` was updated on both its rows after the baseline capture. Substance is
identical — 2 rows before and after, same names (FISHERS ISLAND ELECTRIC CORP, FISHERS ISLAND
UTILITY COMPANY PROPERTY), same coordinates. The cutover cannot cause a facility change:
`p_kind='facility'` never reaches the authoritative branch. (Development rows likewise moved
38,497 → 38,499 earlier.)

## 8. National progress

| | value |
|---|---:|
| total prefixes | 544 (+2 known missing: 941, 952) |
| completed before | 13 |
| completed this batch | **5** |
| completed cumulative | **18** |
| pending remaining | **526** |
| canonical ZIPs acquisition_complete | prefixes 18 of 544 |
| canonical ZIPs boundary_complete | 364 (unchanged) |
| canonical ZIPs marker_complete | 364 (unchanged) |
| canonical ZIPs production_geography_verified | **346 (unchanged)** |
