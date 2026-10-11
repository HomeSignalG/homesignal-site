# Development Activity report: when a record is asked to be verified (2026-10-11)

**Principle (founder):** the age of an original filing is not, by itself, evidence that an active development is stale.

## What it was
`recordDate()` (`supabase/functions/_shared/national-report.ts`) flagged `older_than_a_year` from ONE stored date, `app_projects.submitted_at`, labelled by `date_kind`
(filed / issued / decided / awarded / completed / hearing). The view printed "Verify: Filed Aug 26, 2024, over a year old. Confirm it is still active." on every record
with such a date, whatever its stage and whatever happened since.

Measured on production (2% block sample, 59,497 development rows, 53,083 with a usable date; ZIP copies, not unique projects; operating records are in the report only when they
have a recent event, so they are left out):

| stage | dated rows | flagged | issued / filed / other |
|---|---:|---:|---|
| Permitted / Under Construction | 16,155 | 4,400 (27.2%) | 3,475 / 731 / 194 |
| Approved / Coming | 6,585 | 1,996 (30.3%) | 141 / 1,662 / 193 |
| Proposed / Under Review | 4,483 | 2,380 (53.1%) | 278 / 2,093 / 9 |

`start_date` / `end_date` exist on `app_projects` but are empty on 4,376 of 4,376 flagged permitted rows in the sample, and the engine does not read them, so there is no stored
second date to use. HomeSignal's own observation times (`last_seen_at`, ledger `last_observed_at`) are retrieval clocks, not project activity, and are never used.

## The rule (`verification()`, rule `freshness-1`)
- **Latest official date** = the newest of the record's own date and any LATER date the source stated for a ledger-proven (change-ready, material) event, or a recent publisher event.
  Sentinels (before 1990-01-01), future dates, blanks and unparseable values never count.
- Latest official date within 365 days (unchanged window): **no warning**. This is the change: a later official date refreshes a record in any stage.
- Older, **Permitted / Under Construction, only date is a filing, nothing later**: reason `filing_only`. The view says "Filed <date>. No later official date is on record. Confirm it
  is still active." It does not call the project old.
- Older, anything else (an old issue/decision/award date, any Proposed or Approved record, an unstaged record): reason `old_date`, the same warning as before.
- No usable date: no `record_date`, no warning, no invented date (unchanged).
- Nothing is removed from a permitted record: an old permit with no later official date still warns.

Output: `record_date.verify` is `null` or `{ rule, reason, latest_official_date }`. `older_than_a_year` is unchanged. The stored-report input fingerprint (`engineInputs`) is unchanged.
A report saved before this rule has no `verify` and the view keeps judging it by `older_than_a_year`; a malformed `verify` falls back to that flag, so it can never silence a warning.

## Limits and risks (read before relying on it)
- **Ledger history is short.** The ledger began observing on 2026-09-25, and the engine reads ledger events only inside the 90-day window, so "later official activity" is thin today and grows with time.
  Until then most `filing_only` records will keep a warning; that is the honest answer, not a defect.
- A permitted record flagged `filing_only` is still asked to be verified. Whether to stop asking after N years of silence is a founder call; no such threshold is in this rule.
- The threshold (365 days) is the existing one. No stage-specific threshold was added: the evidence supports changing WHICH date is judged, not inventing new ages.
- The sample counts above are ZIP copies from a 2% block sample and replicate the engine's stage rule in SQL; they size the issue, they are not a count of projects.
- Deploying the engine change is an edge-function deploy of `get-development-activity-report` (`deploy-edge-functions.yml`); new reports carry `verify`, saved ones do not.

## Tests
`test/national-report.test.mjs` section 13 (unit and through the real assembly: Brigham shape, recent later activity, genuinely stale, old issue date, boundary, missing/sentinel/future dates,
retrieval time ignored, non-change-ready and non-material events ignored), the report view's behaviour suite, checks 3d2 (the wording, saved reports, malformed values),
11 engine and 5 view mutants (`freshness_*`, `verify_*`), all killed.
