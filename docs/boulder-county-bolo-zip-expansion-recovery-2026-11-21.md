# ZIP expansion recovery (BOLO REALTORS) — NOT APPLIED, review only

Recovery for `docs/boulder-county-bolo-zip-expansion-2026-11-19.sql` (#3051 head `27ca30c78e42`, blob `b8be7a685b8bef99bd34e71d7407775b5415f8ab`, sha256 `ba99d136184b25bed1aa46b92650e39576c99bf7e573cb92960f2e6df8a095fc`, unchanged). A release prerequisite for the expansion, not authorization to run anything. Veronica readiness remains NOT READY. Run it only through `db-sql.yml` from `main` after separate founder approval, and read the receipt (workflow success alone is not the result).

## Files (this PR)
- `docs/boulder-county-bolo-zip-expansion-recovery-2026-11-21.sql` — the recovery (blob `e21e16a4cf67250aa5b2f6991d7580515ea605f3`, sha256 `b1bce431a11c1bd36be4d2948560f78db931bc80fb00897ac04256cf5d86f8cc`).
- `docs/boulder-county-bolo-zip-expansion-recovery-rehearsal-fixtures.sql` — stand-in tables, no production data (blob `5f8ad4e92321e6b4b98051f0a2cc9fc67911241b`, sha256 `0c14e0410ca1d6cc828f7c6e4678e5eb5da1af4101b031540892ee82f81e4756`).
- `docs/boulder-county-bolo-zip-expansion-recovery-rehearsal.sh` — harness (blob `1e83c4285806…`; this exact file passed 41/41).

## What the forward file changes, and how recovery treats each
1. `canonical_zip_registry`: 4 rows (version 2.4, workbook sha `6010b509…`). Verified, then deleted only rows matching all three fields.
2. `communities`: 4 ZIP pages. Every column the forward file sets is compared first.
3. `communities.zip_codes` of the Boulder and Jefferson roots. Only the added values are removed, order of the rest kept.
4. `canonical_zip_guard_selftest()` 12746 -> 12750. Reverted, and the result must hash to the pinned baseline body `8d6bee1c736996ab9c1a6ff64247ab95`.
5. Trigger side effects (catalog absorb writes nothing for empty topics; the canonical-ZIP row trigger checks only): nothing to undo.

## Gap 1 — county-array baseline: RESOLVED (evidence, not an assumption)
The forward file appends a ZIP only if missing, so by value a pre-existing membership would be indistinguishable after expansion. Evidence it did not exist, and the checks that now enforce the consequences:
- **Production, read-only, 2026-11-22:** Boulder `80301,80302,80303,80304,80305,80501,80503`; Jefferson `80001,80002,80004,80005,80007,80123,80127,80401,80403,80439`; communities claiming any of the four ZIPs: **0**; registry rows for the four ZIPs: **0**. So the expansion adds all four memberships.
- **Existing guard:** `trg_communities_canonical_zip` (before insert/update of `zip_codes`) refuses any value not in the registry, and the registry lacked all four. Rehearsal G1 shows the refusal.
- **Recovery checks (new):** the pinned baseline arrays are constants and must lack all four ZIPs; every pinned baseline ZIP must still be in the current array (else refuse as ambiguous); each added ZIP must appear exactly once and sit **after** every pinned baseline ZIP (where the forward file appends); registry rows must be exactly the expansion output, which a pre-existing row would not be (rehearsal P2: a ZIP pre-seeded in registry and array is refused).
- **Residual, stated:** a change to either array between the pin (2026-11-22) and the forward run would not be visible to recovery. Closing it: re-read the two arrays and the four-ZIP registry/communities counts immediately before running the forward file, and re-pin if they differ.

## Gap 2 — references outside `public`: RESOLVED by specific checks
Catalog, read-only: **no declared foreign key outside `public` references `communities` or `canonical_zip_registry`; nothing references the registry at all.** Declared FKs to `communities` are all in `public` (alerts, meetings, projects, user_subscriptions, self_reports, users, email_events, social_posts, local_news_holds, and communities.parent_id) and are scanned.
Non-FK ZIP/page references outside `public`, assessed individually:
- **Checked (indexed or small):** `geo.maps_zip_geography_status`, `geo.maps_zip_export`, `geo.n5_generation_unresolved`, `geo.zip_authoritative_membership`, `geo.zip_authoritative_marker`, `geo.n5_boundary_membership` (the last three via the generation-led index across all 56 generations), `preservation.community_meta`, `preservation.development_report`. Before expansion all are 0 for the four ZIPs.
- **Enforced precondition instead of scanning:** no N5 generation opened at or after the expansion (registry `loaded_at`) and none still building. A generation is what writes serving, association and identity rows for registry ZIPs, so this covers `geo.n5_association` (8.4M rows, zip is not an index prefix), `preservation.app_project_identity` (10M rows, same) and the historical `n5_*` baseline/cutover tables. **Operational consequence:** N5 opens a generation daily (~00:40 UTC; newest 2026-11-22 00:44Z), so the recovery window ends at the next open; after that this script refuses and a different reconciliation is needed.
- **Deliberately not checked:** `geo.zcta_boundary` (4 rows) and `geo.zcta_place_overlap` (11 rows) already hold these ZCTAs before expansion (Census reference data); checking them would always refuse. Rehearsal S2 proves they do not block.
- **Cascade:** only `self_reports` cascades from `communities`; any other cascading/null-on-delete FK makes the script refuse. It takes `SHARE ROW EXCLUSIVE` on `self_reports` (lock_timeout 5s, held to commit) so no row can arrive between the check and the delete. This is a deliberate lock in the script, for founder review; it blocks writers to that one table for seconds and fails closed.

## Gap 3 — scan cost and failure behavior: RESOLVED with documented limits
Plain `EXPLAIN` on production (no ANALYZE, no locks):
- serving membership check across generations: index-only scan on `zip_authoritative_membership_pkey` (generation_id, zcta5), cost ~2.9k.
- `app_projects.zip`: index-only scan on `app_projects_zip_idx`, cost ~2.0k.
- `app_projects.community_id`: sequential scan, cost ~423k (3.1M rows, no index) — **excluded** with a stated reason (its rows are written only by `app_refresh_zip` for a ZIP page and carry the ZIP, which is checked via the index).
- `local_news_holds.community_id`: sequential scan, cost ~21.6k (250k rows) — kept.
Other unindexed public columns are 24k–396k rows (facility snapshot, commercial baseline, alerts.zip, etc.), assessed as bounded seq scans. Not measured: wall-clock time on production; no ANALYZE or rehearsal was run there.
**Timeout / lock / partial application:** the whole string is one transaction (probe run 44958496732) and the DO block is atomic, so any error, statement timeout, lock timeout or dropped connection rolls back everything — rehearsal R22 (lock held by another session, fails after 5s) and R23 (a failure after the first deletes) leave state byte-identical. The route's own statement timeout is not changed or known; hitting it aborts safely but would block recovery. A late error after the DO block (the final select) also rolls the transaction back; the repeat-run no-op distinguishes "recovered" from "not".

## Gap 4 — what "restored baseline" means
Restored (tested by assertion S3): the same registry rows/fingerprint, the same `communities` rows, county arrays (values and order), guard function body hash and attributes, catalog and stand-in dependents. **Not restored:** `loaded_at`, `created_at` and the uuid ids of the four deleted pages and registry rows (they are deleted, so a later re-expansion mints new ones); physical tuple versions and statistics. **Not erased:** the forward run, this recovery run, Management API query logs and Actions run records. Acceptable for a pre-activation rollback because the script refuses unless nothing downstream references those ids/ZIPs; it would not be acceptable after any downstream use, which is why it refuses then.

## Order, window, repeat run, receipt
Run the v2 city-community rollback first if those rows exist (this script refuses while they do). Window: after expansion, before enrollment, feed activation, ZIP refresh, report generation or the next N5 open. Repeat run: explicit no-op (`already_recovered_no_change`) when the pinned baseline is intact, otherwise refusal. Receipt: `ZIP_EXPANSION_RECOVERY_OK | recovered | 12746 | ad61d07cabc455edd9468e1ed0401a74 | 0 | 0 | 8d6bee1c736996ab9c1a6ff64247ab95`.

## Rehearsal: 41 of 41 pass (disposable PostgreSQL 17.6)
Baseline -> forward -> recovery restores the complete verified baseline; repeat is a no-op; refused with state unchanged: altered page, altered registry row, dependent rows (alerts FK, feeds text id, events zip, char(5) zip, zip request, cascading `self_reports`), duplicate/misplaced/missing array values, another community claiming a ZIP, altered guard body, v2 city row, extra registry ZIP, child of a page, partial state, generation opened after expansion, building generation, rows in each checked serving/preservation object, another cascading FK, lock contention, late failure (atomicity); independent array value, rename and unrelated row preserved.

## Reproduce locally (authorized reviewer; disposable server only)
1. PostgreSQL 17.6 on a throwaway local cluster (the run used the zonky embedded binaries from Maven Central; any 17.6 works).
2. Inputs in one directory `DIR`: `fixtures.sql` (this PR), `recovery.sql` (the PR's recovery file), `forward.sql` (`gh api repos/HomeSignalG/homesignal-site/contents/docs/boulder-county-bolo-zip-expansion-2026-11-19.sql?ref=27ca30c78e421b9addd6922f0db4d5fc9a0fb20e -H 'Accept: application/vnd.github.raw'`, check blob `b8be7a68…`), `zips.txt` (the 12,746 baseline ZIPs: `python3 -I -c "import json;print('\n'.join(sorted(json.load(open('local_news_registry.json'))['zip_map'])))"` over `adapters/local_news_registry.json` at homesignal-ingest `62f79adb371a5d39d08357012184c4f932ec3a0d`; its md5 of the comma-joined list must be `ad61d07cabc455edd9468e1ed0401a74`).
3. `functions.sql`: from a read-only catalog query on production, `select pg_get_functiondef(oid)||';' from pg_proc where pronamespace='public'::regnamespace and proname in ('canonical_zip_guard_selftest','enforce_canonical_zip','alert_catalog_absorb_offered_topics')`, followed by these local-only lines: a stub `public.dev_reports_enforce_dc_zip_membership()` returning `new`, and `create trigger` statements for `communities_absorb_offered_topics_ins/_upd` (statement-level, `referencing new table as newrows`, `alert_catalog_absorb_offered_topics()`), `trg_communities_canonical_zip` and the `app_community_meta` / `development_reports` `enforce_canonical_zip()` triggers (production definitions: `select pg_get_triggerdef(oid) from pg_trigger where not tgisinternal and tgrelid in ('public.communities'::regclass,'public.app_community_meta'::regclass,'public.development_reports'::regclass)`).
4. `rh-expected-md5.txt` containing one line: `ad61d07cabc455edd9468e1ed0401a74 921d24c9d094cedcb32ed37771eac635,8d6bee1c736996ab9c1a6ff64247ab95,cc7e8bb41fe1923589be309b4f0ab0c4`. The harness refuses to run if the local baseline hashes differ.
5. `PGHOST=<socket dir> PGPORT=<port> PGUSER=postgres DIR=<dir> bash rehearse.sh` (the harness `.sh` in this PR). No secrets or production rows are needed or committed; the two county root ids and arrays in the harness are pinned catalog facts.

## Reconstruction fidelity limits (not a production clone)
PostGIS stubbed; roles, RLS, ownership and grants omitted; only the two county roots exist in `communities`; dependents and the geo/preservation objects are empty stand-ins with production's column names/types and key shapes; `dev_reports_enforce_dc_zip_membership` is a stub; timings, locking against real traffic, and the Management API's statement timeout are not reproduced. The baseline function bodies and the registry set were verified equal to production by hash, not by copying production data.

## Still open
- Production timing of the dependency scan was not measured (plan-only).
- The pin-to-forward window for the arrays (see Gap 1) needs the pre-run re-read.
- `self_reports` lock design needs founder acceptance.
- Not run in production; needs founder review, then separate approval.
