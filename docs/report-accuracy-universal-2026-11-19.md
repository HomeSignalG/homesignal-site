# Report accuracy: source dates, status attribution, coverage disclosure (2026-11-19) — LOCAL, NOT MERGED, NOT DEPLOYED

One shared contract for every source. Nothing here names a source, place or agency; a source differs only through registry metadata.

## Contract
- **Record date** (`submitted_at`) keeps its meaning from the registry's `file_date_basis`: `filing` or `record_created` (absent = unstated, legacy label kept).
  A creation date is labelled "Record created", never "Filed". `date_kind` is unchanged on purpose: changing it is a material ledger change.
- **Source dates** ride in `provenance.source_dates` {created, updated, status_updated, milestones[]} (`_shared/record-dates.ts`). Sentinels and future days are dropped
  (planned milestones may be future). Our own fetch time is never one of them. They are not a ledger fingerprint input.
- **Freshness** (`freshness-2`): only a mapped status-update date or a real later milestone counts as a later official date. A modification date is shown beside the
  warning ("a modification is not a project milestone") and never clears it. `creation_only` is a new verify reason.
- **Status attribution**: every stage is `source_reported`, `verified_by_jody: false`, with `status_date` only when the source states one.
- **Coverage categories** (`_shared/coverage-categories.ts`, `coverage.categories`, rule `coverage-categories-1`): connected / statewide_only / not_connected / not_established,
  from registry `coverage_categories` and declared geography. Missing metadata or unverified geography gives "not established", never "not connected". A statewide source never
  establishes a local category. It is separate from `SOURCE_NOT_FULLY_READ`, the outcome, `coverage_state` and limitations, so no credit decision moves.

## What takes effect without a migration
The "Record created" label and basis (registry only), the freshness wording, the status note, the category disclosure.

## What needs a migration (NOT written, NOT applied)
`app_projects.provenance` is built by `app_refresh_zip` from a fixed `jsonb_build_object`, so `source_dates` reach reports only after a splice migration of that function
(from the live body, fail-closed on its anchor, md5-fingerprinted; never a retyped replay). Until then `record_dates` is absent and the view says nothing about modification.
Also: arcgis connector emits `source_dates` only where `column_map` maps them; an `out_fields` projection must include those columns. After the splice, rows rewrite on each ZIP's
next refresh; the ledger ignores `source_dates`, so no change events (pinned by test 4).

## Rollout order
1. Merge this change (engine, connector, registry, generated files, view). 2. Deploy the four report functions. 3. Separately approved: the provenance splice migration, then the
`get-address-report` deploy so connectors emit `source_dates`.

## Follow-ups (mapping unconfirmed, deliberately not guessed)
Only the two confirmed UDOT mappings declare a basis. Every other source's date column keeps the legacy label until audited (`file_date_basis`). Unmapped UDOT milestone columns
(`commit_for_advertise_date`, `submit_for_advertise_date`, `scoping_status_dt`) are not added. Only the two UDOT families declare `coverage_categories`; until others do, an applicable
source without them makes missing categories "not established" for that place.
