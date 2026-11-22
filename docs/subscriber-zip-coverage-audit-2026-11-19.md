# Subscriber ZIP coverage audit — validation batch (2026-11-19)

Working audit artifact for the "Subscriber ZIP coverage, verified completeness & continuous refresh" priority.
Scope done this session: shared infrastructure (verdict model, lifecycle SQL, tests) and a **database-evidence** audit of the five
validation ZIPs. Method: `public._hs_subscriber_zip_health_core()` read through `execute_sql` at 2026-11-19 ~21:00 UTC, plus
`communities`, `source_registry`, `cron.job`. Counts are database counts; **no official-source reconciliation was performed**
(the sandbox has no egress to government hosts, and the reconciliation workflows are runner jobs). Subscribers are counted, never named.

## Verified architecture (read, not assumed)
- Subscribers: `public.bsky_maps_priority_classification`, class `eligible` (ingest #1143; test/unsubscribed excluded there).
- Tab 2 reader: `docs/subscriber-zip-health.sql` (`hs_subscriber_zip_health`, admin-gated, read-only) + `lib/acq-subscriber-zip-health.js`.
- Priority order for drafts is ingest's `bsky_maps_subscribers_first()` (pg_cron 122, every 15 min). MAPS eligibility lives only in ingest `bluesky/lib/maps-eligibility.mjs`.
- Refresh: pg_cron 14 `dev-reports-rolling-refresh` `*/2`, 8 ZIPs/tick ≈ 53 h per full sweep. No per-subscriber-ZIP schedule exists.
- **`public.source_registry` has 6 rows and `refresh_cadence` is NULL on all of them; none is a source used by these ZIPs.** The authoritative
  classification registry is `jurisdiction-registry.json`. So Tab 2's "expected schedule" column can never be filled from that join: this is an
  instrument gap, shown as UNVERIFIED, not as a pass.
- Nothing in either generator path was run or modified that can publish, send email or deploy.

## What shipped (this PR)
1. `HS.subscriberZipFindings` (alias `subscriberZipVerdict`): ten states, **simultaneous findings**, deterministic rollup
   (BLOCKED_SOURCE_ACCESS > INGESTION_FAILURE > MISSING_COVERAGE > PAGE_REFRESH_FAILURE > RECORDS_MISSING_FROM_MAP > STALE_DATA >
   PARTIAL_COVERAGE > UNVERIFIED > VERIFIED_NO_NEW_ACTIVITY > VERIFIED_CURRENT). `VERIFIED_*` is unreachable without a current, complete,
   zero-missing reconciliation record; the database supplies none today, so no ZIP can read verified. 36 tests.
2. `docs/subscriber-zip-lifecycle.sql` (**not applied**): persistent one-row-per-ZIP lifecycle, history table, idempotent
   `subscriber_zip_lifecycle_sync()`, admin reader. Stage is a ceiling from evidence and stops at `reconciliation` until a reconciliation is recorded.
   Disposable-Postgres proof `test/subscriber_zip_lifecycle_pg/run.sh`: 13/13 (it caught a real plpgsql bug before apply).

## Per ZIP (database evidence only; reconciliation not performed for any)
| ZIP | Local governing bodies on file | Dev sources with stored records (records, newest filed) | Live records / on this Map 1 / in no Map 1 | Gov feeds active | ZIP report refreshed | Findings | Class |
|---|---|---|---|---|---|---|---|
| 07001 Avenel NJ | Middlesex County (no city row) | nj-stip-projects (2, 2015-01-21) | 0 / 0 / 0 | 8/8 | 2026-11-18 17:40Z, EPA layer unavailable | PARTIAL (state transport source only), UNVERIFIED | PARTIALLY_COMPLETE |
| 48854 Mason MI | Ingham County | mdot-stip-projects (5, 2027-07-09) | 5 / 2 / **3** | 2/3 | 2026-11-19 04:54Z | **RECORDS_MISSING_FROM_MAP (3)**, PARTIAL, UNVERIFIED | PARTIALLY_COMPLETE |
| 64166 Kansas City MO | Clay County (city row absent) | kcmo-development-cases (71, 2026-11-09), kcmo-capital-projects (14), kcmo-building-permits (2), modot-stip (5) | 10 / 2 / 0 | 8/9 | 2026-11-19 19:56Z, EPA unavailable | PARTIAL (1 gov feed inactive), UNVERIFIED | PARTIALLY_COMPLETE |
| 85083 Phoenix AZ | Maricopa County | phoenix-building-permits (2,048, 2026-11-17), adot-tip (1) | 631 / 4 / 0 (627 belong to neighbouring ZIP pages) | 8/9 | 2026-11-19 19:56Z, EPA unavailable | PARTIAL, UNVERIFIED | PARTIALLY_COMPLETE |
| 98684 Vancouver WA | Clark County | wsdot (3 sources), clark-county-active-dev-permits (1, 2025-09-26), wa-ecology-sepa (1, 2026-08-12) | 3 / 1 / 0 | 8/8 | 2026-11-17 20:16Z, EPA unavailable | UNVERIFIED | PARTIALLY_COMPLETE |

Posts/email: 85083 has 1 published MAPS post and 2 delivery rows (no duplicates), 3 skipped; 64166 has 1 skipped; 07001, 48854, 98684 have none.
Email readiness for the other four is "no published post", which is not an absence of development.

## Blockers and owners
1. Official-source reconciliation for every ZIP: needs runner egress (e.g. `recon-fetch` / the source's own probe workflow) per jurisdiction. Owner: OWNER_UNASSIGNED (next session; founder to authorize the runner minutes).
2. Missing local sources: no city/county permit or planning source for 07001 (Edison/Woodbridge area, Middlesex NJ) or 48854 (Mason / Ingham MI). Needs discovery, registry entry and a dry-run; not started. Owner: OWNER_UNASSIGNED.
3. 48854: 3 recent live records are in no serving Map 1 generation. Likely the next N5 generation (builds daily); re-check after the next ACTIVE switch before treating as a defect. Owner: Map 1 (ingest/N5).
4. Source schedule metadata: `source_registry.refresh_cadence` empty; decide whether Tab 2 should read the registry JSON or derive from cron job 14. Founder call.
5. EPA layer unavailable on four of five ZIPs (EPA 429/502 availability, known class).
6. Lifecycle SQL needs founder approval to apply; Tab 2 wiring of `hs_subscriber_zip_lifecycle` follows the apply.
7. No draft-only MAPS run was triggered this session: no ZIP has passed its verification gates.

## Next exact actions
1. Founder: approve applying `docs/subscriber-zip-lifecycle.sql` and a daily `subscriber_zip_lifecycle_sync()` pg_cron (this session did neither).
2. Next session: ZIP 85083 first (best-covered): official Phoenix permit read via runner, record-level comparison, write `reconciliation_*`.
3. Then 64166, 98684, then source discovery for 48854 and 07001.

---
# Second pass (2026-11-19, after founder review) — corrections and approval packages

## Cadence architecture (traced)
- **Canonical source identity/classification:** `supabase/functions/get-address-report/jurisdiction-registry.json` (261 entries, keyed by `registry_id`; coverage, status buckets, `recency_days`, date kinds). It has **no refresh-interval field**; `recency_days` is a lookback window, `incremental_field` is a paging aid.
- **`public.source_registry` is a different registry:** 6 rows of agency/program metadata for Entity cards (`agency_code`, `card_agency_id`, `refresh_cadence`). Its ids do not overlap the development connectors. Tab 2's join to it was a wrong-kind join; the empty cadence column was never going to fill. Do not feed it.
- **Actual ingestion:** no per-source schedule. Sources are read on demand, per ZIP, by `dev_refresh_tick` (pg_cron 14, `*/2`, 8 ZIPs/tick ≈ 53 h per sweep). Publisher-side cadence exists only as prose in each entry's `_receipts`.
- **Existing freshness instrument (use it, do not duplicate):** `docs/source-freshness.sql` (applied 2026-11-01, pg_cron 116 hourly `dev-source-freshness`) stores per `registry_id` the newest record date and last successful read, and per (ZIP, source) the read state (`dev_source_continuity`).
- **Reconciliation schedules:** none exist. **Map generation:** pg_cron 69 `n5-generation-dispatch` (`47 * * * *`); one generation per UTC day, cutoff ≈ 00:42Z, activated ≈ 10–12Z.
- **Smallest compatible change (recommended, not built):** (1) Tab 2 reads `source_freshness_for_zip` / `dev_source_continuity` for read time and read state instead of `source_registry`; (2) the "expected refresh" for a ZIP page is the sweep SLA derived from cron 14 (72 h window, already enforced by migration invariant in the coverage-state view), shown as the ZIP-level expectation only; (3) add an OPTIONAL `publisher_refresh: {interval_days, basis, verified_at}` to a registry entry only when its `_receipts` evidence states one; absent = "publisher cadence unrecorded", never inferred. No new registry, no cadence invented.

## Corrected five-ZIP evidence matrix
Legend: DB = database observation · BOUNDARY = ZCTA polygon in `geo.zcta_boundary` (TIGER/Line 2025) · AUTH = governing authorities verified · DISC = source discovery complete · CONN = connected and operationally verified · RECON = official record reconciliation · PAGE = public page + active Map 1 verified. Everything not stated as done is UNVERIFIED.
| ZIP | DB observations | BOUNDARY | AUTH | DISC | CONN | RECON | PAGE |
|---|---|---|---|---|---|---|---|
| 07001 | 1 source, 2 records (2015), 8/8 gov feeds | present (ZCTA row exists; overlap shares not measured) | UNVERIFIED (county row only; municipality not modelled) | UNVERIFIED; no local source found | state transport source only, read 2026-11-18 | UNVERIFIED | UNVERIFIED |
| 48854 | 1 source, 4 distinct keys; gov feeds 2/3 | present | UNVERIFIED (Ingham County row; Mason city/township not modelled) | UNVERIFIED | state transport source only | UNVERIFIED | UNVERIFIED |
| 64166 | 4 sources; gov feeds 8/9 | present | UNVERIFIED (Clay County row; city of Kansas City row absent) | partial: KCMO sources found; Clay County sources not assessed | KCMO cases/permits/capital read 2026-11-19 | UNVERIFIED | UNVERIFIED |
| 85083 | 2 sources; 82 Phoenix permit keys inside this ZIP's polygon (365 d) | present (bbox -112.20632,33.69834,-112.11456,33.78185) | UNVERIFIED (Maricopa County row; City of Phoenix not a modelled row for this ZIP) | partial: other Phoenix planning layers probed earlier (#1143 recon), not assessed here | Phoenix building permits read 2026-11-18 | UNVERIFIED (pilot prepared) | UNVERIFIED |
| 98684 | 5 sources; Clark permit source has 1 record (2025-09-26) | present | UNVERIFIED (Clark County row; City of Vancouver not modelled) | UNVERIFIED | 5 sources read 2026-11-17; the Clark permit source's tiny count is unexplained, not proof of adequacy | UNVERIFIED | UNVERIFIED |
Why PARTIALLY_COMPLETE (not COMPLETE, not BLOCKED): connected sources demonstrably read and store records for each ZIP, but no check beyond the database has been performed and, for 07001 and 48854, no local source exists at all. BLOCKED is not used because no access dependency has been shown to prevent the core path: the official-source read has simply not been run (it needs an approved runner path, below). Records present in the database are not treated as proof of adequate local coverage.

## Map findings (active generation `n5-national-2026-11-19`, cutoff 2026-11-19 00:42Z, activated 11:23Z, predecessor `n5-national-2026-11-18`)
- **Earlier "defect" labels were instrument errors; corrected in `docs/subscriber-zip-health.sql` (not applied):** counts were rows (a duplicated source row inflated 48854), the window treated scheduled future STIP dates as filing dates, and N5-withheld keys were lumped with unexplained absences.
- **48854:** 4 distinct keys. 2 are in the active membership for 48854. 2 (`arcgis:mdot-stip-projects:226633`, `…:215962`) are recorded in `geo.n5_generation_unresolved` as `POINT_REJECTED` / `MULTI_COORD_UNRESOLVED` (two distinct coordinates for one key, the Phase-1 proven-point rule): **withheld by design, 0 unexplained.** They were created 2026-08-15, long before the cutoff, so waiting for the next generation would not change them. Whether a STIP project with two coordinates should be drawn is a rule question owned by the N5 point rule, not a data fix; do not add them to the map.
- **85083:** 631 distinct recent live keys (Proposed/Approved, 120 d). 4 are inside 85083's polygon, **627 are members of neighbouring ZIP polygons only** (the source scope is a 3-mile radius; membership is point-in-polygon), 0 unresolved, **0 unexplained**. Over 365 d, all statuses: 82 Phoenix keys are members of 85083 (5 Proposed, 35 Approved, 42 Operating). Expected N5 behaviour, not a defect. The eligible denominator for "missing from the map" is the official records inside the polygon, which only the reconciliation can supply.
- **Post-switch verification procedure (exact):** after the next ACTIVE switch (pg_cron 69, ~10–12Z daily; read `geo.n5_generation` where `state='ACTIVE'`), re-run for the ZIP: (a) `select count(distinct source_key) from geo.n5_serving_membership where zcta5=<zip>`; (b) list live keys with no membership and not in `geo.n5_generation_unresolved` for that generation; (c) `app_zip_projects_markers(<zip>,'development',true)` row count and a Map 1 render check (`verify-map1-zip-states`). Only (b) non-empty is a defect to trace; created-after-cutoff keys are expected to appear one generation later (cutoff is the data boundary).

## Approval packages (separate; nothing applied, enabled or dispatched)
**A. Lifecycle SQL (+ reader revision).** Repo `HomeSignalG/homesignal-site`, branch `claude/eager-hopper-5wjvwy`, files `docs/subscriber-zip-lifecycle.sql` (new objects) and `docs/subscriber-zip-health.sql` (replaces the existing `_hs_subscriber_zip_health_core`; adds `withheld_by_n5_rule`, distinct keys, unresolved handling). Commit SHA is stated in the PR/response after this push. Objects: tables `subscriber_zip_lifecycle`, `subscriber_zip_lifecycle_history` (RLS on, all privileges revoked from public/anon/authenticated); functions `_hs_subscriber_zip_stage`, `subscriber_zip_lifecycle_sync` (SECURITY DEFINER, execute revoked from public/anon/authenticated), `hs_subscriber_zip_lifecycle` (admin-gated via `dashboard_admins`, granted to `authenticated`). No triggers. Existing data: none changed; the reader revision replaces one function body. Dependencies (all verified present 2026-11-19): `bsky_maps_priority_classification` (view), `communities.zip_codes text[]`, `geo.zcta_boundary.zcta5 text`, `geo.n5_generation`/`n5_generation_unresolved`/`n5_serving_membership`, `dashboard_admins`. Locking: `create table`/`create function` take brief catalog locks only; no existing table is altered. Idempotent: `create ... if not exists` / `create or replace`; sync is idempotent (T8). Rollback: `drop function`, `drop table` the new objects (they hold only derived bookkeeping, so dropping loses no source record), and restore the prior core body from the applied migration `subscriber-zip-health` text; limit: lifecycle history is lost on drop. Mechanism: `apply_migration` from the committed file (the repo's existing path; not `db-sql` default check mode, which wraps in rollback). Tests: disposable Postgres 16, 13/13, **stub-based**: fixture stands in for the views and Tab 2 core, so it proves logic and privileges, **not** production compatibility. Gaps: not run against the real views; pg_cron/`auth.jwt()` behaviour of the admin reader unproven; first production run must be a read-only `select` of `_hs_subscriber_zip_stage` for the five ZIPs before the sync is ever run.
**B. Daily sync (not requested for enablement until A is applied and proven).** Mechanism: pg_cron (already installed) job `subscriber-zip-lifecycle-sync`, command `select public.subscriber_zip_lifecycle_sync();`, proposed `23 10 * * *` UTC (before the daily N5 switch window and the 10:20 UTC meetings check). Writes production: only the two new bookkeeping tables. Overlap: a single statement per run; add `pg_try_advisory_lock` wrapper before enabling (not yet written). Retry: none (next day's run is the retry); failure visibility: `cron.job_run_details` plus the `last_checked_at` column on Tab 2; disable: `select cron.unschedule('subscriber-zip-lifecycle-sync')`. **It synchronizes subscriber registration/stage only. It performs no source ingestion, no official-source read and no reconciliation, and cannot change `reconciliation_*` fields.**
**C. Runner reconciliation pilot (read-only).** ZIP 85083, because it is the best-connected ZIP (a wired first-party per-record source, a verified polygon, an existing published post and delivery history), so the pilot tests the method rather than missing source discovery; 07001/48854 first need source discovery. Official endpoint: City of Phoenix `https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1` (the wired `phoenix-building-permits` scope only; Phoenix's other planning layers, already probed in #1143, are a later scope and are identified-but-unreconciled). Workflow: existing `homesignal-ingest/.github/workflows/recon-fetch.yml` with input `targets_file=scripts/recon/zip85083-phoenix-pilot.json` (committed on the branch; runs `scripts/recon-fetch.mjs`, Node 20, `ubuntu-latest`), 8 GET requests (1 layer metadata, 1 count, 6 pages of 1,000, `User-Agent: homesignal-recon/1.0`), 30 s per request, job `timeout-minutes: 15`, retry limit 1 manual re-dispatch. No secrets, `permissions: contents read`, no database or Supabase access, writes nothing to the repo or production, **cannot publish or send email** (no such step exists). Evidence: raw responses uploaded as artifact `recon-results` (7 days; unreadable from the sandbox, so the job log summary is the readable receipt); comparison logic `scripts/reconcile_zip_records.py` (pure, 6 tests) is run locally by Claude over the retrieved data and the committed result summary is kept in `docs/` with run id. Gap to resolve before the run: the log summary prints status and size, not record keys, so the pilot needs either a one-line `extract` option (as #1143's recon used) or a human download of the artifact; the JODY side (82 in-polygon Phoenix keys) is a read-only `execute_sql` export. Recurring execution is not requested.

## Red checks (evidence)
- **site#3062 `unit` → `county-sources-parity.test.mjs` stale `lib/generated/county-sources.json`.** Reproduces on `origin/main`. Bisected in worktrees: passes at `fdc63cd^`, fails at `fdc63cd` (#3052 "BOLO sources: Boulder County Accela + Longmont", author account HomeSignalG): the first commit that edited the registry without regenerating. Owner: the #3052 workstream; session owner unconfirmed, so OWNER_UNASSIGNED beyond that PR. Not fixed here.
- **ingest#1152 `step2a-isolation-db` → four unclassified live `dc_*` objects (`dc_entity_open_actions`, `dc_source_admission_gate`, `dc_source_map_admitted`, `dc_zip_open_actions`) and `dc_current_observation` without `security_invoker`.** The same workflow is red on `main`: runs 1907 (2026-11-18), 1908 (2026-11-19 09:22Z) and 1911 (2026-11-19 16:09Z, #1143 push). So it predates this PR. The owner is not established by evidence (an earlier comment on #1152 said "another workstream"; that attribution is unproven): OWNER_UNASSIGNED.
- Both PRs remain unmerged drafts.


## Audit history note (added 2026-11-19, after the second review)
- The first-pass map counts in this document (e.g. 48854 "3 absent", 85083 "627 not drawn") are PRESERVED as written and are SUPERSEDED. They counted rows rather than distinct keys, counted scheduled STIP dates as filing dates, and lumped keys the active N5 generation recorded as unresolved (`POINT_REJECTED` / `MULTI_COORD_UNRESOLVED`) with unexplained ones. The corrected reader is `docs/subscriber-zip-health.sql` (output keys `n5_unresolved` and `n5_unresolved_by_reason`; an earlier draft named it `withheld_by_n5_rule`, which overclaimed: most N5 reason codes are data-quality problems).
- Precision of the corrected finding: it is a DATABASE-BASED explanation of why records are not in a ZIP's `geo.n5_serving_membership` (they lie in a neighbouring ZIP polygon, or the N5 point rule withheld them and recorded it). It is NOT a verification of the public Map 1 page, and it does not establish that the underlying coordinates or boundaries are correct.

# ZIP 85083 read-only pilot: corrected receipt and key findings (2026-11-22)

**Coverage for ZIP 85083 remains NOT ESTABLISHED.** The pilot validates only the declared Phoenix building-permit scope (`phoenix-building-permits`, City of Phoenix Planning_Permit layer 1, `PER_ENT_DATE >= 2025-11-19`). It is a diagnostic. Nothing was recorded as source- or ZIP-level verification, and no other Phoenix layer or source was assessed.

## Corrected receipt (ingest run `44914623904`, commit `62f79adb371a5d39d08357012184c4f932ec3a0d`, one run, no rerun)
Figures below are as supplied by the founder from the full receipt. My earlier figures (53 matched, 1,174 outside polygon, 58 unplaced) came from a partial log read and are **withdrawn**; I did not read the full receipt myself.
- Retrieval complete: 1,728 of 1,728 rows, 5 of 8 requests.
- 114 qualifying official records: 112 MATCHED, 2 MISSING_FROM_JODY (`2605036`, `2605046`), 1 MISSING_TIMING_UNRESOLVED (`2605045`). None unplaced. 1,609 OUTSIDE_POLYGON.
- JODY-only: `T165773`, `T165906`, both NOT_FOUND_ON_SOURCE. 4 duplicate official keys, none conflicting.
- ARITHMETIC NOTE: 112 + 2 + 1 = 115, not 114. The frozen JODY member set is 114 (`member_n`), and 112 matched + 2 JODY-only = 114. So "114" reads as the JODY-side count; the official qualifying count looks like 115. Unresolved until the receipt is re-read.
- `2605045` stays unresolved by design (filed 2026-11-19, inside the 3-day timing window).

## Findings (JODY data and repo only; no new official request)
**2605036** (INSTALL 500GAL A/G LPG TANK, 28012 N 37TH AVE, Approved, JODY `submitted_at` 2026-11-13, point 0.62 mi from the 85083 centre).
- Not the radius: 0.62 mi inside the 3-mi scope. Not permit type or window: Industrial, filed inside the window, kept by the registry filter.
- Ingest timing explains the snapshot gap. The frozen set (as of 2026-11-19 21:36Z) predates every JODY copy. First copies: 85085 and 85310 at 2026-11-20 19:26Z; the 85083 copy at 2026-11-22 06:01Z (85083 report refreshed 2026-11-22 01:20Z). It is now present in JODY and in the cached 85083 report.
- Not explained: why it reached JODY 7 days after its filing date. Permits filed 11-12 to 11-14 in these five ZIPs first appeared on 11-14 (7 keys), 11-16 (1), 11-18 (2), 11-20 (1) and 11-22 (4), so the lag is not unique to this key. Whether the delay is source publication or refresh cadence needs the publisher's side, which this pass did not request.

**2605046** — **unexplained.** It has no row in `app_projects` in any ZIP and is not in the cached report of 85083, 85085, 85086, 85310 or 85383. Its filing date, type and location are not in repo or JODY data (the receipt carries outcome only), so radius, date and type cannot be tested. The pilot's rule classed it MISSING_FROM_JODY, meaning filed before 2026-11-16, yet its number follows 2605045 (filed 11-19).

**T165773** — in JODY, but no longer on 85083.
- 6.48 KW AC PV, 6512 W EAGLE TALON TRL, Proposed, filed 2026-11-06, Utility. Rows exist only for 85310 (first created 11-07 15:45Z, last seen 11-20 19:27Z) and 85383 (first created 11-07 15:45Z, last seen 11-20 23:01Z). No 85083 row; the 85083 report does not carry it.
- No other record at that address in 85383, so a renumbering is not supported by JODY data.
- The 85310/85383 copies have not refreshed since 11-20, so they are probably stale copies the next refresh will drop. This is inference, not tested.

**T165906** — still a member in `geo.n5_serving_membership` (85083, generation `n5-national-2026-11-22`) but has **no `app_projects` row in any ZIP** and is absent from the cached reports checked. First and last seen cannot be shown: the row is gone, and the one table that might hold it (`preservation.app_project_identity`) timed out at 12 s and was not probed again.

**Pattern with T969035 and T970655** (homesignal-site#3111, REPORT-round2 C1: both N5 radius keys with no `app_projects` row, not found at the publisher).
- All four vanished keys are T-prefixed Phoenix numbers, and none has a surviving sibling at the same address (checked for T165773 only).
- It is not "all T-keys vanish": 8 of the 10 T-prefixed member keys matched, and the 85083 membership holds 116 Phoenix keys, 115 with rows (105 numeric all with rows, 10 T-keys with rows, 1 T-key without). Numeric keys: 0 vanished.
- So: a possible pattern (T-keys withdrawn or replaced at the source), small sample, **not established**. No record was deleted or hidden.

## Proposed fixes (none made)
1. Confirm whether Phoenix withdraws or renumbers T-prefixed applications. This needs one bounded official lookup by key, which needs explicit approval.
2. Reconcile the membership/row gap: N5 membership can hold a key (T165906) whose `app_projects` row has been reaped. The next generation will drop it; an alarm on "membership keys without a row" would surface it.
3. Measure ingest lag per source (filing date to first JODY copy). 2605036's 7-day lag is the unexplained part.
4. Re-run the reconciliation only after 1 and 3, never as a coverage claim.
