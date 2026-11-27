# Report accuracy: review and release gates (2026-11-20) — LOCAL; nothing pushed, merged, deployed or applied

Two different questions. Gate A asks whether the branch can be pushed for PR review. Gate B asks whether it can be released to production. Passing A says nothing about B, and Node tests alone can never complete B.

## Gate A — ready for branch push and PR review
- [x] Local changes and provenance documented (`docs/report-accuracy-universal-2026-11-19.md`, this file, commit messages).
- [x] Applicable local checks pass on the exact candidate (see the test matrix in the review packet): full offline suite, 181-case mutation harness (attributed to 1ddc8e22; no covered file changed since), generator and audit checks, migration apply/rollback/refusal tests on a disposable Postgres, the new path/compat/coexistence/content-hash/connector/audit suites, the guard suite.
- [x] No claim of production verification. The only production contact was read-only SQL on definitions and grants plus ONE live-source request (see "Production access" below).
- [ ] Unrun integration checks, listed and open: the real `get-address-report` function and engine under a Deno/Edge runtime; the migration against the COMPLETE live function definition; any end-to-end report, follow or watch on real data; the rolling-refresh effect on row size and rewrite load.
- [ ] Separate PR ordering: the weekly guard change (branch `guard/weekly-topics-scope-20261120`, commit 476bc7aa) is its own change and must land BEFORE this one; against main without it the guard (correctly, by its old rule) rejects any branch that mixes weekly files with other work.
- [ ] The tooling discrepancy "10 unpushed commits" (hook) is unexplained locally and non-blocking.

## Gate B — ready for production release (NONE of these is complete)
1. The exact candidate validated in a supported Deno/Edge runtime, locally or through an explicitly authorized non-production workflow. Not done: this sandbox has no Deno.
2. The migration reviewed against the COMPLETE authoritative `app_refresh_zip` definition, not only the extracted provenance expression. Not done: the proposed file was written from the provenance block, an md5 guard and an anchor count; a full-body review is outstanding. Its test ran on a stand-in.
3. A recoverable pre-release baseline for all five functions AND the page (see "Rollback prerequisite"). Not done.
4. The migration, refresh, smoke-test and rollback procedures reviewed (sequence in the main doc). Not done.
5. Any production test or migration separately authorized. Not requested.

## Rollback prerequisite (pending, needs separate approval)
A Supabase function "version" number is a deployment counter. It is not a reproducible artifact, and nothing readable here maps a live version to a git commit. Read-only listing on 2026-11-20 gives, per function, only: version, `updated_at`, `entrypoint_path` (a CI runner path, not a commit) and `ezbr_sha256` (a hash of the deployed bundle).
Live now: `get-address-report` v320 (3b0ca165…), `get-development-activity-report` v43 (2541064b…), `follow-development-report` v32 (c3004c37…), `run-property-watch` v29 (7106750c…), `manage-property-watch` v19 (3fea5f7d…). These are identifiers to compare against, not a recovery plan.
No git mapping is asserted. To recover the actual artifacts, a baseline must be CAPTURED before any release, by a procedure someone approves first, for example:
1. Record per function: version, `ezbr_sha256`, `updated_at`, and the deploy workflow run (and its head SHA) whose time matches.
2. Where that SHA is found, rebuild it in a supported, authorized non-production workflow and compare the bundle hash; equality is NOT assumed (a rebuild may differ).
3. Independently capture the deployed bundle itself into an archive outside the project (the Supabase CLI has a function download command; availability and fidelity here are UNVERIFIED).
4. Record the page baseline: the `main` commit and the Pages deployment that is live.
Until a baseline exists, "redeploy the previous version" is a goal, not a procedure. This is left PENDING.
What rollback does NOT do: reverting `app_refresh_zip` (the rollback SQL) or any function does not remove `source_dates` already persisted in `app_projects.provenance` and `development_reports.sites`. Those keys stay until each ZIP's next refresh rewrites the row without them, and are inert meanwhile (the current engine ignores them: tested). Stored report snapshots are immutable.

## Production access (accurate record)
- Read-only SQL on `pg_get_functiondef`, grants and function listings: reads.
- pg_net requests used to read the live UDOT source (the earlier investigation's ids 22217, 22218 and 22248-22250, and request 23328 in this pass): these are NOT purely read-only. Each creates transient bookkeeping rows in pg_net's own request and response tables in the production database. They are not customer report, watch, follow, credit or notification data, and nothing application-level was written.
- No further pg_net calls are made. No live check is needed for this closeout.
