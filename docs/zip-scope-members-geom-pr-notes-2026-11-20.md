# Whole-geometry membership for widened line/polygon features — review notes (2026-11-20)

Nothing here is applied, merged, deployed or enabled. `ZIP_SCOPE_BOUNDS_MODE` / the allowlist, the Denton 365-day window and both new registry entries (`phoenix-proposed-zoning`, `kcmo-capital-projects`) are untouched.

## 1. Geometry contract (conservative prefilter)
`public.zip_scope_members_geom(zip, features)` answers, per feature, whether the feature's WHOLE geometry intersects the ZIP polygon (`ST_Intersects(ST_MakeValid(part), boundary)`, boundary-inclusive, SRID 4269, from `geo.zip_membership_boundary`). Rings are treated as FILLED polygons, paths as lines, points as points, each part validated and tested on its own. It is a **prefilter**: it may keep extra candidates but must never discard one the serving rule (N5, `ST_Intersects` of the holed geometry) would include. N5 stays authoritative for what is served.
Tested (`test/zip_scope_members_geom_pg`, 36 checks): crossing line with pin outside, line with no vertex inside, line in the L-notch (bbox-only, outside), boundary-inclusive touches, shared edges, multipart lines and polygons, polygon containing the ZIP, bow-tie rings, unclosed rings, partial holes, malformed/degenerate elements, ordering/count, bounds (200 features / 250,000 vertices, checked before building), privileges (service_role only), performance (200x100 vertices ~50 ms). Parity script runs 1,200 random holed/multipart features through the **real serving converter** (`scripts/phase2_b1_zcta.py::rings_to_multipolygon_wkt`): 683 serving-members, 0 missed, 7 extra (allowed superset). 8 mutations (pin-only, vertex-only, bbox-only, exclusive edges, whole-collection MakeValid, open to anon, unbounded, unordered) are all killed.

## 2. Reuse vs difference
Reused: the boundary function, the intersects predicate and SRID, the verdict vocabulary, the call contract of `zip_scope_members`. Different, and only this: the serving converter reads ring winding to cut holes; the prefilter deliberately does not (filled rings = superset). The one disagreement it can produce is "member here, outside in serving" (e.g. a ZIP wholly inside a polygon hole; test G17). It can never produce the reverse. No second membership rule: the point path is unchanged and byte-identical.

## 3. Fallback when the function is missing or fails
A widened non-point feature with no geometry function, an RPC error (function missing), a wrong-length/unknown answer, or an out-of-order row throws `ScopeMembershipError`; the source re-runs on the LEGACY scope, `scope_fallback=legacy_after_membership_error`, receipt `scope: fallback, complete: false`, reason `geometry_unavailable`. Undecidable geometry (no usable coordinates / no boundary) is KEPT and counted `geometry_unresolved_kept`; a feature over 50,000 vertices is not sent, KEPT and counted `geometry_untested_kept`; either makes the receipt incomplete. Nothing is discarded because a check did not run, and the pin is never used to exclude. (`test/scope-nonpoint-membership.test.mjs`, 14 checks.)

## 4. Rollback and preservation
- Code rollback (revert the engine) returns widened non-point features to pin testing; it removes nothing already stored.
- What removes recovered rows is the NEXT legacy-scope refresh of a ZIP (`app_refresh_zip` deletes rows absent from the refresh's expected set), not a code rollback. Switching mode off is therefore NOT a preserving rollback.
- An export is evidence, not preservation: the append-only change ledger and recovery rows keep history, but a stored `app_projects` row is only kept while refreshes keep returning it.
- Legitimate age-window expiry (e.g. Denton's 365-day `recency_days`) is separate from regression: records older than the window lapse by design. Of the 125 canary-recovered Denton keys, 124 are no longer stored; the timing/cause (window vs legacy refresh) is **unverified**.
- To avoid losing currently eligible recovered records: verification compares per-ZIP identity sets before/after on a replica, and no canary ZIP is refreshed legacy-only. Any real rollback needs its own approved plan.
- The SQL rollback is dropping the three functions (engine then reports `fallback`).

## 5. Recovery protection (v2 -> v3)
`SCOPE_RULE_VERSION` v2 -> v3, so each ZIP x source re-baselines. `test/dev_change_recovery_pg` V03-V06: on the first v3 generation, old (2010, 2023) geometry-discovered records become recovery rows (`coverage_recovered`), zero reportable events (V04, so none can reach digest, watch or social), the baseline moves to v3 (V05), and a later genuine arrival is news (V06). Suite: 118 required ids, all pass.

## 6. Evidence still open
Radius-source geometry inventory (191 ArcGIS + 7 Socrata + 1 CSV + 1 county_cases radius entries now in the registry): Socrata/CSV are point-by-column. For ArcGIS only a **partial** inventory exists: stored N5 geometries for a 30-source sample are POINT 50,390 (9 sources) / MULTILINESTRING 24,797 (9) / MULTIPOLYGON 12,515 (8) / null 36. The remaining ~160 ArcGIS entries are **unverified** (needs per-layer metadata reads from a runner).

Canary gates (docs/zip-scope-bounds-runbook.md):
| gate | status |
|---|---|
| honest accounting, 9 expanded sources | passed |
| identity uniqueness (TxDOT 25/25) | passed |
| zero reportable events for 125 recovered keys | passed |
| zero social posts since canary | passed |
| denton-county-dev-permits widened fetch | FAILED (timeout 2026-10-17 18:16Z, one occurrence) |
| recovered Denton records still stored | FAILED (124 of 125 not stored; cause unverified) |
| elapsed time, payload size, error rates, served ⊆ polygon, N5 pre-activation, hot-path cache safety | UNVERIFIED |
Nine of ten sources complete is not an overall pass; the canary is **not** a pass.

## Remaining blockers
Geometry SQL not applied (and must be applied before the engine deploys, or sources report `fallback`); inventory of ~160 layers; Denton timeout and lapse cause; unverified gates; founder approvals for apply, deploy, allowlist and refreshes.
