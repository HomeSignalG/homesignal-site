# Maps launch-readiness audit — 2026-07-23 (post ZIP-backbone normalization)

Verification-only audit of the Maps page (`maps.html`: Street | Satellite | Focus)
across the full production ZIP universe. No product code changed. Every number
below is from production (Supabase project `qwnnmljucajnexpxdgxr`) or a live
CI browser walk of `https://homesignal.net` at deployed commit `f5131d2`
(Pages build for that commit: green). Full-population SQL — no sampling.

## Verdict: GO

All 11 launch gates pass. One non-gate data-quality defect found and logged
below (duplicated development records on ~5% of pages) — real, sourced,
correctly-placed records duplicated by the upstream refresh; not fabrication,
not a gate failure. Recommended fix scheduled work, not a launch block.

| Gate | Required | Actual | Status | Evidence |
|---|---:|---:|---|---|
| User-facing ZIP pages | 12,722 | 12,722 | PASS | `communities` `level='zip'`: 12,722 rows, each exactly 1 ZIP (`array_length(zip_codes,1)=1` for all), 12,722 distinct ZIPs, 0 ZIPs claimed by >1 zip-level row |
| Maps pages (`app_community_meta`) | 12,722 | 12,722 | PASS | 12,722 rows, 12,722 distinct ZIPs, 0 duplicates, 0 rows outside the universe |
| Missing Maps pages | 0 | 0 | PASS | anti-join universe→meta = 0 |
| Valid centroids | 12,722 | 12,722 | PASS | 0 null anchors, 0 outside US bounds (lat 17..72, lng −180..−60); `zip_centroids` 12,722/12,722 (incl. 84684/84685 Census place points); max anchor↔pinned-centroid offset **0.0 mi** |
| Street working | 12,722 | 12,722 | PASS | The only known Street/Satellite→Focus revert cause was a missing viewport anchor (#356); anchors exist for 12,722/12,722. Live walk: Street stays selected + OSM tiles visible, 0 reverts, on all 8 rep. classes (CI run 30045959567, 62/62 PASS) |
| Satellite working | 12,722 | 12,722 | PASS | Same anchor proof; live walk: Satellite stays selected + Esri tiles visible, 0 reverts, all classes |
| Focus working | 12,722 | 12,722 | PASS | Focus is the default mode; renders (schematic or honest empty) on all classes incl. `items=0` pages (35801, 84684) |
| Invalid plotted markers | 0 | 0 | PASS | 135,956 plotted: 0 null/half-null/zero coords, 0 outside US bounds, 0 beyond the 100-mi fence (max real distance 15.8 mi) |
| Unsourced plotted markers | 0 | 0 | PASS | all 135,957 `app_projects` rows carry `source_ref`; all 11,774 `app_changes` rows sourced (none plotted — area scope) |
| Runtime/load failures | 0 | 0 | PASS | zero page errors + zero console errors, desktop + mobile, both CI walks; Pages deploy green |
| Signed-out failures | 0 | 0 | PASS | both walks run signed-out: verify-maps-rollout 62/62, verify-maps-live 20/20 |

**The Maps page—Street, Satellite, and Focus—is production-ready across all
12,722 ZIP pages.**

## 1. Page coverage (full-population SQL)

- Universe: 12,722 distinct ZIPs on 12,722 `level='zip'` rows (1 ZIP per row; 0 multi-claims).
- `app_community_meta`: 12,722 rows / 12,722 distinct ZIPs / 0 dups / 0 missing / 0 extra.
- `zip_centroids`: 12,722 rows, 0 out-of-bounds; every universe ZIP covered.
- Data-quality split: **7,665 `pass` + 5,057 `coverage_coming` = 12,722**. Honesty holds
  both directions: 0 `coverage_coming` ZIPs with any project/change record; 0 `pass`
  ZIPs without at least one real record.
- Page-load: one static `maps.html` serves every ZIP; live boot verified per class
  (marker-rich, facility-rich, civic, honest-empty, hardest-centroid) with zero errors.

## 2–3. Street & Satellite

- Valid viewport anchor: 12,722/12,722, all sitting exactly on the pinned
  `zip_centroids` coordinate (max offset 0.0 mi) — no page can center outside its
  ZIP geography.
- Live walk (signed-out, desktop 1440×900): Street stays selected with tile map
  visible, Satellite stays selected with tile map visible, **zero silent reverts to
  Focus**, on 78666 / 11201 / 84101 / 89501 / 35801 / 84684 / 84302 / 84005.

## 4. Focus

- Renders on every walked class, including both zero-item pages (35801 Huntsville
  `coverage_coming`; 84684 West Mountain civic-only).
- 7,439 ZIPs have real plotted markers; 5,057 show the honest coverage-coming state;
  the remainder are `pass` via panel-only records (changes/meetings — listed, never plotted).
- Blank/broken/misleading Focus views observed: 0.

## 5. Marker integrity (all 135,957 rows)

- Plotted: 135,956 (47,474 development + 88,483 facility). Unsourced: 0. Invalid
  coords: 0. Outside US: 0. Beyond 100-mi fence: 0 (max 15.8 mi). Orphan rows with
  no page: 0.
- Intentionally retained without coordinates: **1** — ZIP 78666 "La Cima Phase 3C
  & 7E Zoning" (bad source geometry nulled by the fence; CI proves it is listed,
  never plotted). Plus 11,774 area-scope `app_changes` records: listed, never plotted,
  by design.
- **Duplicates (the one real defect — see below):** 1,275 groups of identically-keyed
  plotted development rows (zip+name+source+coords), 2,092 excess copies, 627 ZIPs,
  worst 27 copies. NOTE: same-name groups are a mix — e.g. Mesa 85234's 27× "27 Unit
  Townhome Project" is 27 **distinct case numbers** (legitimate per-unit permits),
  while Minneapolis 55405's remodel is **1 case number cached 510×** (true duplication).

## 6–7. Interaction & browser verification (live production, signed-out)

CI receipts (both at deployed `f5131d2`):
- `verify-maps-rollout` run 30045959567 — **62/62 PASS**: hover = `type · name`
  (e.g. "Regulated facility · BARON WOOLEN MILLS INCORPORATED"), marker click opens
  the same right slide-over with **no navigation** (`openCount=1`, URL unchanged),
  fence proof on 78666, mobile 390×844 bottom sheet + no horizontal scroll, zero
  page errors everywhere. Screenshots: artifact `maps-rollout-shots`.
- `verify-maps-live` run 30045961738 — **20/20 PASS**: one-panel invariant, panel
  closed by default, official-record link liveness (200), full project page 200,
  honest empty states, mobile sheet, zero console errors. Screenshots: `ci-live-shots`.
- Toggle order Street | Satellite | Focus is static markup (`maps.html:200-202`)
  in the deployed commit.

## 8. The one defect found: duplicated development records (non-gate, non-blocking)

- **What:** the upstream `development_reports.sites` cache contains
  **12,013 exact-identity duplicate groups (21,839 excess copies, ~3.1% of 696,500
  elements) across 523 report rows** — identical title + case_number + record_url +
  file_date + coords (worst: 560 copies of one record; receipt: ZIP 55405, 1 case
  number × 510 copies). The Maps materializer inherited a subset: 2,092 excess
  `app_projects` rows across 627 ZIP pages.
- **Root cause:** source-fetch duplication in the engine's refresh (same record
  emitted repeatedly into one cached array — consistent with unstable pagination),
  with **no exact-identity dedup at cache-write** and none in the app materializer.
- **User impact:** on ~627 of 12,722 pages (~5%), repeated identical rows in the
  panel lists, inflated counts, and duplicate copies competing for the 16 lettered
  pin slots. Copies plot at identical coordinates — no wrong geography, every copy
  traces to a real official record. Not fabrication.
- **Precise fix:** (1) exact-identity dedup key
  `(case_number|record_url|title|file_date|lat|lng)` applied at
  `development_reports` cache-write and in the `app_projects` materializer;
  (2) re-cache the 523 affected report rows and re-materialize the 627 ZIPs;
  (3) keep distinct-case-number rows (they are real separate filings).
- **Blocks launch?** No — it fails none of the 11 gates and violates no
  anti-fabrication rule. Recommended as the next engine-side fix.

### RESOLVED — same day (2026-07-23), fix applied end to end

Root cause pinned to **cache generation**: the engine's arcgis/socrata
connectors page with resultOffset/$offset but no guaranteed-unique total order,
so one source row can be emitted on several pages of a single fetch; 100% of the
excess traced to those two connectors. **Corrected identity numbers** (the
audit key above omitted `file_date`, so its 21,839 figure over-counted by
including legitimate re-issues of the same case number — verified in
production): true duplication was **4,759 groups / 9,631 excess copies / 273
cached rows** (worst 560×). Fix shipped in three layers — engine v22
`dedupeExactPermits` at report assembly (identity includes case_number AND
file_date so per-unit permits and re-issued filings survive), materializer
`dev_sites_deduped()` defensive dedup (production migration
`dev_sites_exact_identity_dedup`), and a one-time order-preserving cleanup of
exactly the 273 rows (counts recomputed with the engine's own formulas)
followed by re-materializing exactly those 273 ZIPs. After: **0 duplicate
groups cache-wide**; cache total 696,500 → 686,869 (= −9,631 exactly, nothing
else lost); Mesa 85234's 27 distinct-case permits all retained; Minneapolis
55405's 510× remodel → 1. SQL of record: `docs/maps-dedup-migration.sql`.
