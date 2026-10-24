# Database migrations without a response deadline (2026-10-24)

**Why this exists.** The Supabase MCP `apply_migration` tool asks the person to approve each write and gives up after 60 seconds.
A timeout is not an approval and not a refusal, so migrations stalled and the founder was asked to race a clock. Migrations now
go through `.github/workflows/db-migrate.yml`. Its human gate is a GitHub environment reviewer, which waits as long as it takes.

## The flow
1. The migration is a **committed file** (`docs/*.sql` or `supabase/migrations/*.sql`) on a reviewed branch.
2. Dispatch **db-migrate** with `sql_file` and its `sha256` (`sha256sum <file>`); optionally a committed select-only `verify_sql_file` + `verify_sha256`.
3. **preflight** (environment `prod-db-read`, no reviewers) runs read-only queries and posts a summary: path, sha256, creates/replaces, risky statements, ledger state, earlier runs of this exact file.
4. **apply** (environment `prod-db-write`) waits for a required reviewer. Approve or reject whenever you choose. Cancelling or timing out after 30 days is a rejection.
5. After approval the script writes a `started` row in `public.migration_runs`, runs the file once, then records `applied`, `failed` or `unknown`.
6. **verify** (read-only) runs the optional verify file and prints its rows.

## Guarantees
- The approver approves a sha256; any other content is refused. Paths outside the allowlist are refused.
- A file already recorded `applied` is refused. A `started`/`unknown` earlier run is flagged in the summary.
- A client timeout is recorded `unknown`: not success, not failure. Settle it with preflight + the verify file.
- Nothing is wrapped in begin/rollback (a rolled-back DDL still holds locks). Files carry their own transaction.
- The token is read from the environment secret only and is never printed.
- Dispatch-only: branch code never gets the secret from a pull request or push.

## Recovery
- Every run is in `public.migration_runs` (RLS on, no visitor grants) and in the Actions log.
- A migration's reversal is its own committed file, run through the same flow.
- Anything left `started` means the runner died mid-run: run preflight and the verify file before deciding.

## One-time setup (founder)
1. Replace the repo secret `SUPABASE_ACCESS_TOKEN` (the current one answers `Invalid access token`): a Supabase access token for the project's organisation.
2. Settings > Environments: create **prod-db-read** (no reviewers) and **prod-db-write** (Required reviewers: you; restrict deployment branches if you wish). Put the token in **both** as the secret `SUPABASE_ACCESS_TOKEN`.

## Not covered here
Reads for investigation still use `execute_sql`, which has never prompted. Deployment of edge functions, merging and publishing keep their own authorizations.
