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

## Evidence-backed rollout sequence (nothing executed)
Functions that transitively import a changed file (computed from the import graph): `get-development-activity-report`, `follow-development-report`, `run-property-watch`, `manage-property-watch` (shared engine), and `get-address-report` (connector, registry).
1. **Review** this packet, the migration and the rollback. 2. **Merge**; pages deploy the new view (`?v=` content key). 3. **Deploy the four report functions** (they bundle the changed shared code; the follow and watch functions must move with the engine so a stored report and a fresh one are read by the same code).
4. **Deploy `get-address-report`** only after step 3: it is the only producer of `source_dates`, from the next ZIP refresh onward. Until then `sites` has no `source_dates`.
5. **Apply the migration** only after 4 and its own review; before 4 it is a no-op (`el->'source_dates'` is null). 6. **Data refresh**: stored `development_reports.sites` gain dates as the rolling refresh revisits each ZIP (about 240 ZIPs/hour; a full sweep ~53 h); `app_projects` rows rewrite once as they refresh. Stored report snapshots are immutable and unchanged.
Coexistence: new functions + old data = new labels and notes, no modification date (tested). Old functions + new data = unknown provenance key ignored (the engine reads only `case_number`; `hydrate` selects the column whole). New view + old response and old view + new response both render (tested for the first; the second only changes label text and a verify reason the old view already handles as "old date").
Rollback: redeploy the previous versions of the five functions (recorded: report 42, follow 31, run-watch 28, manage 18 before this change); run the rollback SQL; revert the registry and generated files; stored rows keep a harmless `provenance.source_dates` key until their next refresh.
Cost: `sites` rows grow by ~100 bytes per record that maps dates (two UDOT families today); dense-ZIP rows near the 3.5 MB working ceiling are not affected by two small families, but any bulk mapping must re-measure.

## What is delivered now vs. still unverified
Delivered: the contract, connector/registry plumbing, view and engine changes, category semantics, audit script, migration + rollback, tests.
Unverified: the arcgis `current_mod_date` column against the live UDOT service (no egress here); the migration against the REAL function (only a stand-in); `get-address-report` end to end (no Deno runtime in this sandbox); only 2 of 211 mappings declare a date basis (`docs/date-basis-audit-2026-11-19.md`: 7 candidates for review, 63 name-suggests-filing but unproven).
