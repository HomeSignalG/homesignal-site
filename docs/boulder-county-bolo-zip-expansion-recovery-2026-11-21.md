# ZIP expansion recovery (BOLO REALTORS) — NOT APPLIED, review only

Recovery for `docs/boulder-county-bolo-zip-expansion-2026-11-19.sql`. It is a release prerequisite for applying the expansion, not authorization to apply or run anything. Veronica readiness remains NOT READY.

## Files and hashes
| file | git blob | sha256 |
|---|---|---|
| forward (#3051 head `27ca30c78e42`, unchanged) | `b8be7a685b8bef99bd34e71d7407775b5415f8ab` | `ba99d136184b25bed1aa46b92650e39576c99bf7e573cb92960f2e6df8a095fc` |
| `docs/boulder-county-bolo-zip-expansion-recovery-2026-11-21.sql` | `0f6acdebfb13e168ba87b1a513196f54a7d1b619` | `9c45d673160ce56b16ca753ff338a647bb215a680f48963c48972223df8bcb13` |

The forward file was not changed to make recovery pass.

## State the forward file changed (from reading it) and how recovery handles each
1. `canonical_zip_registry`: 4 rows (80026, 80027, 80310, 80021; version 2.4; workbook sha `6010b509…`). Checked, then deleted only rows matching all three.
2. `communities`: 4 ZIP rows (`lafayette-80026`, `louisville-80027`, `boulder-80310`, `broomfield-80021`). Every column the forward file set is compared before deletion.
3. `communities.zip_codes` of `boulder-county-co` (+80026, 80027, 80310) and `jefferson-county-co` (+80021). Only those values are removed; other values and their order are kept.
4. `canonical_zip_guard_selftest()` body `12746 -> 12750` (two literals). Restored; the restored body must hash to the pinned baseline `8d6bee1c736996ab9c1a6ff64247ab95`, which proves no one changed it after expansion.
5. Side effects the forward file triggers: the `alert_catalog_absorb_offered_topics` statement triggers (the new rows carry no topics, so no catalog row is written) and the canonical-ZIP row trigger (checks, writes nothing). Neither leaves state to undo.

## Intended recovery window
After the expansion commits and before enrollment, feed activation, ZIP refresh, report generation, or any other write that depends on the four ZIPs. The script checks only the conditions listed below and claims no safety beyond them. Assumption it cannot check: before the expansion, the four ZIPs were not already in either county array (the forward file only appended missing ones; the registry check proves the ZIPs were not in the registry).

## Order if city-community v2 rows exist
v2 rollback first, then this recovery. The script refuses while any of `boulder-co`, `lafayette-co`, `louisville-co`, `superior-co` exists.

## Refuses, before changing anything, when
- the registry outside the four ZIPs is not the 12,746 baseline (md5 `ad61d07c…`), is not exactly 12,750 rows, or the four rows differ from the expansion output;
- any ZIP page differs from the forward output, another community claims one of the four ZIPs, or a community is parented to a ZIP page;
- the v2 city rows exist;
- either county array is not in the expanded shape (each added ZIP exactly once, in its own county root);
- the guard self-test body, attributes, or result differ from the expected expanded form;
- any `public` base table references the four ZIPs or the four page ids. The scan is by column (`community_id`, `zip`, `zip_code`, `zcta5`, `zip_codes`) and by foreign key to `communities`, so a table added later is still covered. Other schemas (e.g. `geo`) are not scanned;
- the state is partial or mixed (some but not all of the expansion present).

Nothing is cascaded, and no trigger or constraint is disabled. Everything is one transaction, using the implicit transaction proven for the db-sql route (probe run 44958496732).

## Repeat run
After a successful recovery (or if never expanded), the script verifies the pinned baseline and exits as a no-op with `mode = already_recovered_no_change`. If the baseline is not intact it refuses.

## Receipt
`ZIP_EXPANSION_RECOVERY_OK | recovered | 12746 | ad61d07cabc455edd9468e1ed0401a74 | 0 | 0 | 8d6bee1c736996ab9c1a6ff64247ab95` (columns: receipt, mode, registry_rows, registry_md5, target_registry_rows, communities_claiming_targets, selftest_md5). A refusal raises, so the receipt row never appears. As with the probe, workflow success alone is not the result; read the receipt.

## Local rehearsal (disposable PostgreSQL 17.6, harness `docs/boulder-county-bolo-zip-expansion-recovery-rehearsal.sh`)
24 of 24 checks pass:
- Baseline equals the pinned baseline; forward applies; expanded registry is 12,750.
- **Baseline -> forward -> recovery restores the complete pinned baseline** (registry, communities, county arrays, guard body, catalog, stand-in dependents all equal).
- Repeat run is an explicit no-op and leaves the baseline unchanged.
- Refused with the database byte-identical before and after: altered page name; altered registry row; a row in `alerts` (FK) / `feeds` (text `community_id`) / `events` (`zip_code`) / `app_zip_geography_cutover` (char(5) `zip`) / `zip_request_builds` referencing the pages or ZIPs; duplicate ZIP in Boulder array; Boulder ZIP in Jefferson array; another community claiming a ZIP; altered guard body; v2 city row present; independently added registry ZIP; child parented to a page; one page missing (partial state).
- Preserved: an independently added array value, a renamed county root, and an unrelated community row after recovery.
- The rehearsal found and fixed one defect in the first draft of the array check (a malformed `= any((select ...))`); the file above is the fixed version.

## Reconstruction and limits (not a production clone)
Rebuilt from read-only catalog queries, with the baseline verified to equal production: registry 12,746 rows / md5 `ad61d07c…` (ZIP set from the committed registry at ingest `62f79ad`), guard self-test body md5 `8d6bee1c…`, `enforce_canonical_zip` `cc7e8bb4…`, `alert_catalog_absorb_offered_topics` `921d24c9…`; production's county root ids and arrays.
Not reproduced: PostGIS (stubbed; the self-test never reaches geometry here), roles/RLS/ownership, the full `communities` table (only the two roots), production's real ~100 dependent tables (a few empty stand-ins), the real `dev_reports_enforce_dc_zip_membership` body (stubbed), any other trigger or extension.

## Unresolved safety gaps
- The dependency scan was not timed against production-size tables; an unindexed large table could hit a statement timeout. That fails closed (whole transaction aborts) but would block recovery.
- `loaded_at`, `created_at` and ids of the removed rows are not restored; API/audit logs of the forward run remain.
- Pre-expansion absence of the ZIPs from the county arrays is an assumption (see window).
- Not run against production. Needs founder review, then a separately approved apply.
