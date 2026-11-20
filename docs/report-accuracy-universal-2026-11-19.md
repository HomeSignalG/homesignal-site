# Report accuracy: source dates, status attribution, coverage disclosure (2026-11-19) — LOCAL, NOT MERGED, NOT DEPLOYED, NOT RELEASE-APPROVED

One shared contract for every source. Nothing in the shared rules names a source, place or agency; a source differs only through registry METADATA.

## Contract
- **Record date** (`submitted_at`) keeps its meaning from the registry's `file_date_basis`: `filing` or `record_created`. Absent = unstated: the legacy label stays and no basis is invented.
  A creation date is labelled "Record created", never "Filed". `date_kind` is unchanged on purpose (changing it is a material ledger change).
- **Source dates** (`provenance.source_dates` = {created, updated, status_updated, milestones[]}, `_shared/record-dates.ts`): sentinels and future days dropped (planned milestones may be future); our fetch time is never one.
  Name along the path: `source_dates` (connector record, site object, `development_reports.sites`, `app_projects.provenance`) becomes `record_dates` only in the report's project entry.
- **Freshness** (`freshness-2`): only a mapped status-update date or a real later milestone counts as a later official date. A modification is shown beside the warning and never clears it (`creation_only` is a new verify reason).
- **Status attribution**: every stage is `source_reported`, `verified_by_jody: false`, with a `status_date` only when the source states one.
- **Coverage categories** (`coverage-categories-2`): three separate facts. (1) geographic scope (statewide or county, source-applicability.ts); (2) subject category (what the source holds: registry `coverage_categories`);
  (3) completeness (registry `coverage_complete_for`, absent = `not_established`). A statewide source that declares local categories IS connected for them (scope statewide); it never implies comprehensive local coverage.
  Known coverage is never erased because another applicable source lacks metadata; a category nobody declares is "not connected" only when geography is verified AND every applicable source declares its categories, else "not established".
  Separate from `SOURCE_NOT_FULLY_READ`, the outcome, `coverage_state`, limitations and credit.

## Source-date plumbing, traced
| hop | where | carries `source_dates`? |
|---|---|---|
| connector | `sources/source-dates.ts` via arcgis `...sourceDatesField` (only arcgis emits it; socrata types only) | yes, when `column_map` maps source_created/updated/status_updated/milestone_dates |
| site object | `get-address-report/index.ts` maps `{...s, url, e, n, lat, lng}` | yes (spread) |
| exact-identity dedupe | `dedupeExactPermits` key | NOT in the key (identity unchanged; test) |
| `development_reports.sites` | jsonb | yes (stored whole) |
| `app_refresh_zip` -> `app_projects.provenance` | fixed `jsonb_build_object` | **NO today: dropped.** Needs `docs/app-refresh-zip-source-dates.sql` (proposed, not applied) |
| `hydrate` | `report-reads.ts` selects `provenance` whole | yes, once stored |
| `assemble` | `sourceDatesOf(p.provenance)` | emitted as `record_dates` |
| view | the report view module | renders the modification note |
Dropped or renamed: `source_dates` is dropped at app_refresh_zip until the migration; renamed `record_dates` at the report. The ledger (`dev_change_facts`, live md5 4ddb04fd...) reads 14 named columns and not provenance.

## The proposed migration (NOT applied; written from a read-only `pg_get_functiondef`, 2026-11-19)
`docs/app-refresh-zip-source-dates.sql` (+ `.rollback.sql`): one inserted line in the development statement's provenance object; md5-guarded on the live body (`50d925795f2c4d11804551a54947e4e6`), anchor must occur once, cutting the line back out must reproduce the reviewed md5.
Live evidence: the "write only changed rows" compare includes `app_projects.provenance`, so a row that gains `source_dates` is rewritten ONCE on its ZIP's next refresh (`last_seen_at` moves for that row only). The facility statement has no provenance block.
Proof so far: `test/app_refresh_zip_source_dates_pg/run.sh` runs the migration and rollback on a disposable Postgres against a STAND-IN whose provenance expression is the live text; it is NOT the live function (the md5 guard is substituted for the stand-in's).
The real guard is what protects production: if the live body differs from the reviewed one, the migration refuses.

## Rollout and rollback (revised 2026-11-20; nothing executed)
**What deploys automatically and what does not (read from the workflows).** Merging to `main` deploys the static site (pages workflow, push to main): the new view and its `?v=` keys go live at merge, before any backend step. Edge functions deploy ONLY by manual dispatch (`deploy-edge-functions.yml`; its push trigger is commented out). The migration is applied by a person.
**Required vs preferred.**
- REQUIRED: (a) none of the backend steps may be assumed done at merge; the view must tolerate old responses (TESTED: `test/report-accuracy-coexistence.test.mjs`, new view + response without the new fields, and + a pre-change response).
  (b) the migration may run only after review, and is harmless before `get-address-report` emits dates (`el->'source_dates'` is null). So the migration/`get-address-report` order is not required for safety; it is required only for dates to appear.
- PREFERRED: the four report functions (engine) before `get-address-report`, so that every producer of `source_dates` has a consumer, and a stored report and a fresh one are read by the same code (follow/watch compare a stored report with a fresh assembly).
**Sequence.** 1 review; 2 merge (view live); 3 dispatch the four report functions; 4 dispatch `get-address-report`; 5 apply the migration; 6 wait for the rolling refresh (about 240 ZIPs/hour) for sites and `app_projects` to carry dates.
**Why each function.** The four report functions bundle `national-report.ts`, `record-dates.ts`, `coverage-categories.ts`, `source-applicability.ts` and the generated JSON (import graph computed 2026-11-19). `get-address-report` bundles the arcgis/socrata connectors, `source-dates.ts` and the registry.
**Coexistence.**
- TESTED: new view + old response; PRIOR view (pinned commit 10cb1951) + new response (renders, label "Record created" shown as given, the new notes absent); new engine + stored pre-change report (follow/watch/changes-since); OLD engine (origin/main) + provenance that carries `source_dates` (response identical with and without it; run ad hoc, not committed).
- REASONING ONLY: old `get-address-report` + new engine (the engine reads provenance when present and tolerates its absence); migration applied while old `get-address-report` runs (no-op).
**Rollback.**
- Functions: redeploy the previous source of each. Live now (read-only, 2026-11-20): `get-address-report` v320 (ezbr 3b0ca165…), `get-development-activity-report` v43 (2541064b…), `follow-development-report` v32 (c3004c37…), `run-property-watch` v29 (7106750c…), `manage-property-watch` v19 (3fea5f7d…). These numbers moved since the earlier note (42/31/28/18), so the prior version must be re-read immediately before any deploy. The MAP from a live version to a git commit is NOT recorded anywhere I can read: it is an UNRESOLVED PREREQUISITE (record the `main` commit of each deploy run, or redeploy from the last main commit before this merge).
- Migration: `docs/app-refresh-zip-source-dates.rollback.sql` removes the one line from the function. IT DOES NOT REMOVE DATA ALREADY WRITTEN: `app_projects.provenance.source_dates` and `development_reports.sites[].source_dates` stay until each ZIP's next refresh. After the function rollback that refresh builds provenance without the key, the row differs from the stored one, and the "write only changed rows" compare rewrites it once. Until then the key is inert (the old engine ignores it: tested). A deliberate cleanup of stored keys would be a separate, reviewed data operation and is not proposed.
- Page: revert the merge. Stored report snapshots are immutable and never rewritten by any rollback.
**content_hash.** It is sha256 of the stored body (database CHECK); it is an integrity value, never a key. Every reader and SQL constraint was traced (`test/report-content-hash-downstream.test.mjs`): no dedupe, uniqueness, idempotency, billing, follow or watch decision uses it. A new report whose project carries source dates has a different body and so a different hash, by definition; stored reports are unchanged.

## What is delivered now vs. still unverified
Delivered: the contract, connector/registry plumbing, view and engine changes, category semantics, audit script, migration + rollback, tests.
Live-field evidence (2026-11-20, read-only request): the UDOT layer declares `created_dt` and `current_mod_date` as esriFieldTypeTimestampOffset and returns ISO strings with an offset (`2026-11-19T00:00:00+00:00`); the connector reads that encoding (`test/report-source-dates-connector.test.mjs`, live-captured values). Still not exercised: the real `get-address-report` function against the live service (no Deno here; the engine's own fetch path was not run); the migration against the REAL function (only a stand-in); only 2 of 211 mappings declare a date basis (`docs/date-basis-audit-2026-11-19.md`: 7 candidates for review, 63 name-suggests-filing but unproven).
