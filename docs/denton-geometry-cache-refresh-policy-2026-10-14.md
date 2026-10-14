# Policy proposal: refreshing stored (recovered) publisher geometry in `geo.n5_geom` (DESIGN ONLY, 2026-10-14)

**Nothing here is applied.** No SQL is supplied to run, no workflow is added, no table exists yet. Founder/N5-owner decision.

## 1. The problem, measured

`geo.n5_geom` holds the publisher geometry that membership and markers are derived from (`docs/n5-generation-publish.sql`: `ST_Union` of every
`outcome = 1` feature of a `source_key`, clipped to the ZIP, markers by `LINE_MERGED_COMPONENT_INTERVAL_1000M`). `scripts/n5_shard.py` treats a
`source_key` already present with `outcome = 1` as a cache hit and does not ask the publisher again.

Case 76207 / TxDOT `008113084` (linecheck run 38588571516, 2026-10-14):

| | stored (`feature_id 008113084#62`, `recovered_authoritative`, recovered 2026-09-04 06:45Z) | publisher now |
|---|---|---|
| parts / points | 2 / 12 | 1 path / 11 vertices |
| length | 2,243.6 m | 2,240.2 m |
| marker distance | 6e-6 m (on the stored line) | 17.7 m (16.7 m at outSR 4326) |
| vertex-to-line gap | up to 23.4 m (stored to publisher), 25.7 m (publisher to stored) | |

The marker rule is correct; the stored line is 40 days older than the publisher's edit. A cache with no expiry makes every publisher edit after the
first recovery invisible, in both directions (a moved line, a corrected point, a record that gained or lost parts).

## 2. Goals and non-goals

* Detect that a stored geometry no longer equals the publisher's, and replace it for the NEXT generation only.
* Never delete or overwrite a geometry that an ACTIVE or retained generation derived from (CLAUDE.md "Permanent historical intelligence": the prior
  geometry, the new one, the observation time and the rule version are all kept).
* Not a re-fetch of the whole corpus; not a change to marker or membership rules.

## 3. Trigger (cheapest first; each level only runs if the previous one cannot exclude the registry)

1. **Layer edit clock.** ArcGIS FeatureServer layer metadata exposes `editingInfo.dataLastEditDate` (MapServer layers often do not). Per registry,
   record the value at each verification. If it is not newer than the registry's newest `recovered_at`/last-verified time, the registry is CURRENT and
   nothing else is requested (one metadata call per registry).
2. **Per-key fingerprint probe**, for registries whose edit clock is newer or unavailable. Re-request only the identities already stored (chunked by
   `maxRecordCount/4`, honouring `exceededTransferLimit`, exactly as `fetch_features` does) with `outSR` = the canonical SRID, and compare fingerprints.
3. **Event trigger.** The Denton audit (or any audit) reporting `nonpoint_off_geometry > 0` or `mismatch > 0` for a key queues that key for step 2
   immediately, regardless of cadence.

## 4. Cadence

* Step 1: every N5 generation build (daily) — one metadata call per registry in the generation's expected set, no geometry.
* Step 2: when step 1 says "newer" or "unknown": at most once per registry per 7 days, so a publisher that edits constantly costs a bounded amount.
  Registries with a record-level "active only" life (Frisco) re-verify only the keys currently served.
* A key whose verification FAILED (error, truncated page, timeout) keeps its stored geometry and is marked `unverified`; it is retried on the next
  build and is never treated as changed or as deleted (failed read = UNKNOWN, as in the audit).
* First rollout scope: the 32 Denton ZIPs' source keys (about 20,000 keys, almost all `denton-county-dev-permits`; 271 TxDOT; 171 Frisco; 29 Fort Worth;
  1 Dallas), then widen by registry after a clean cycle.

## 5. Comparison key and equality test

* Key: `(source_key, feature_id)` — the same primary key `n5_geom` already uses (`on conflict (source_key, feature_id) do nothing`). Multiple features
  per source key are compared as a set; a feature present on one side only counts as a change.
* Fingerprint: md5 of `ST_AsEWKT(ST_SnapToGrid(ST_Normalize(ST_MakeValid(geom)), 1e-7))` in the canonical SRID (about 1 cm) on both sides, computed in the
  database from the publisher WKT the probe sends (so the same PostGIS decides both).
* Material change (replace) if fingerprints differ AND (`ST_HausdorffDistance` > 1 m OR vertex/part count differs OR length differs by > 0.5 %). A
  sub-metre difference, datum label or float noise is recorded as `equivalent` and does not trigger a rebuild. 1 m sits well above the measured
  CRS/datum difference (0.9 m between the 4326 and 4269 labels) and well below the 5 m audit tolerance and the 16.7 m case.

## 6. Safety

1. **Additive tables only** (proposed, not created): `geo.n5_geom_verification` (source_key, feature_id, verified_at, publisher_edit_clock, stored_fingerprint,
   publisher_fingerprint, hausdorff_m, verdict `equivalent|changed|unverified|gone`, run_id) and `geo.n5_geom_history` (full prior row incl. geometry,
   archived before any replacement, with the reason).
2. **Replacement happens only through the generation lifecycle.** A changed key is written as the candidate geometry of the generation currently
   BUILDING. The serving generation and its rows are untouched; residents see the change only at activation. The existing row guard
   (`geo.n5_generation_row_guard`) already forbids writes to non-BUILDING generations.
3. **The existing pre-activation proof gates it.** Every (ZIP, project) that leaves or enters is already diffed and must be explained; add a
   reason class `GEOMETRY_REFRESHED` so refreshed keys are explained rather than flagged.
4. **`gone` is not deletion.** A publisher that no longer returns a stored id yields `verdict = gone`, the stored geometry is kept with its last-seen
   time, and the key is reported (this is the 75033 Frisco case). Removal from display follows the existing materializer reaping, not this policy.
5. **Rate limits.** Same politeness as `fetch_features` (batching by publisher cap, backoff, no parallel hammering of one host); a 429/403 stops that
   registry for the run and records `unverified`.
6. **Identity interplay.** Keys with reused ids (docs/denton-permit-identity-design-2026-10-14.md) must be verified per `feature_id`, never per
   `source_key` alone, or the two unrelated features would be compared as one.

## 7. Blast radius

* Per verification run: reads only (publisher GETs, SELECTs). Writes limited to the two additive tables.
* Per refresh: only keys with `verdict = changed`. Denton first-cycle estimate: unknown until measured; the 76207 case is 1 of 271 TxDOT keys in the
  audit cohort. The audit already gives a per-ZIP count (`nonpoint_off_geometry`, `mismatch`), which is the leading indicator.
* Downstream effect of a changed key: its membership set and markers change in the next generation for every ZIP the old or new line touches; the
  proof's explained-exit list will show them. No effect on `app_projects`, posts, captures, or MAPS drafts until a draft is recomposed or recaptured
  (capture keys include the record, not the geometry; a pin that moved by tens of metres does not invalidate a stored screenshot by itself, but
  a pin that left the ZIP does and is already caught by the map gate).
* Worst case: an incorrect `changed` verdict removes a correct geometry from the candidate generation. Bounded by the proof, the 1 m threshold, and
  the next rollback below.

## 8. Rollback

* Before activation: delete the candidate generation's refreshed rows and re-run the shard (cached geometry is still in `n5_geom_history`/serving).
* After activation: `rollback` already restores the superseded generation by state alone; the previous geometry for refreshed keys is the
  generation's own rows plus `n5_geom_history`. Disabling the policy is one switch (the verification job reads a committed flag, as `apply_enabled`
  does for Local News), after which behaviour is exactly today's cache-forever.
* Nothing in this policy deletes an observation; "rollback" never loses the publisher's newer geometry, it only stops using it.

## 9. Open decisions for the owner

1. Is `editingInfo.dataLastEditDate` trustworthy on the target publishers (measure on Denton, TxDOT, Frisco, Fort Worth, Dallas before relying on it)?
2. Who owns `n5_shard.py` changes (concurrent-session rule): the cache-hit test must become "hit AND verified within window".
3. Whether a `changed` key should force a ZIP re-materialization outside the daily build (recommended: no, wait for the build).
4. Threshold: 1 m / 0.5 % proposed; confirm after measuring the equivalent/changed split on one registry.
