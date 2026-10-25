# Database migrations: a durable approval, no deadline, no credential in the ungated step (2026-10-24)

**Problem.** The Supabase MCP `apply_migration` tool asks for approval and gives up after 60 seconds. A timeout is neither an
approval nor a refusal, so migrations stalled and the founder was asked to race a clock. A first replacement made a GitHub
*environment reviewer* the gate, which still has a clock (a waiting job is cancelled after 30 days) and reused one full-write token
in an "ungated" read environment. This design removes both.

## The flow

```
dispatch  db-migrate-request  (file, full commit sha)         NO credential, writes nothing
   -> GitHub issue "Migration request: <file>"                 the durable request; it never expires; nothing waits on it
founder comments on the issue, whenever they choose:
   /approve <sha256> <commit> <6-digit authenticator code>     (add `unmerged` if the commit is not on main)
   /reject <reason>
   -> db-migrate-decide  (runs only on that comment)           verifies, THEN executes once, records, comments, closes
```

Closing, ignoring or never answering the issue changes nothing in production. There is no job to time out.

## Why each piece exists

| Requirement | Mechanism |
|---|---|
| The ungated step cannot write, even if compromised | `db-migrate-request` holds **no secret and no environment**. It reads production only through the public function `public.migration_state(sha)` with the public anon key (already shipped in `config.js`). There is nothing in that job that can write. Pinned by test. |
| A request waits for the founder indefinitely | The request is an issue, not a waiting job. |
| Execution happens only after the decision | The write token exists only in environment `prod-db-write`, used only by `db-migrate-decide`, which runs on the *comment*. |
| The session cannot approve for the founder | This session and the founder share one GitHub login, so a comment proves nothing. `/approve` also needs a one-time code (RFC 6238, 6 digits) from a seed (`MIGRATION_TOTP_SECRET`) the session never sees. Each code is **single use** (`public.migration_totp_used`). |
| The founder approves exactly what they read | `/approve` carries the file's **sha256 and the full commit**. The issue shows both. The job recomputes the hash from git at that commit and refuses any difference. Unmerged commits need the explicit word `unmerged`. |
| Branch code cannot change what runs | `issue_comment` workflows execute the **default branch's** copy of the workflow and script. The SQL is read as data from the pinned commit. The request must have been created by `github-actions[bot]`, carry the `migration-request` label and be open. |
| Auditable and recoverable | Migrations are committed files. Every run is a row in `public.migration_runs` (`started` -> `applied` / `failed` / `unknown`) with the approving issue URL, plus the issue thread and the Actions log. A reversal is another committed file through the same flow. |
| A timeout never decides anything | A client timeout while applying is recorded `unknown` (neither success nor failure) and blocks a re-run until settled by a read-only check. An already `applied` / `started` / `unknown` file is never run again. |
| No lock-holding dry runs | Nothing is wrapped in begin/rollback (a rolled-back DDL still holds locks, CLAUDE.md 7.11). Files carry their own transaction. |

## What is bootstrapped on first use

The first approved run also creates, idempotently, `public.migration_runs`, `public.migration_totp_used` (RLS on, no visitor
grants) and `public.migration_state(text)` (read-only, returns only status and time). Its fingerprint is printed in every request.
Until then a request says "ledger installed in production: false".

## Honest limits

- The one-time code defends against *this session* (and anyone with the founder's GitHub login) approving a migration. It does not
  defend against someone who holds both the login **and** the authenticator.
- A time-based code is valid about 90 seconds. That is the only clock, and it is on the code, not on the request: post a fresh code
  whenever you decide.
- The migration file itself runs with full database rights once approved. The approval is the control; the preflight summary lists
  creates and risky statements (drops, deletes, grants) so you can see them first.

## One-time setup (founder)

1. Environment **prod-db-write** (Settings > Environments), deployment branches: `main` only. Secrets in it:
   `SUPABASE_ACCESS_TOKEN` (replace the expired one) and `MIGRATION_TOTP_SECRET`.
2. Generate the authenticator seed on your own machine: `python3 scripts/db_migrate.py totp-seed`, add the printed URI to your
   authenticator app, and store only the `seed` value as `MIGRATION_TOTP_SECRET`. Do not paste it anywhere else.
3. Optional: repository variable `MIGRATION_APPROVERS` (comma-separated GitHub logins besides the repo owner).

## Use

1. Actions > **db-migrate-request**: `sql_file`, `commit` (full 40-character sha).
2. Read the issue it opens. Comment `/approve …` or `/reject …` when you decide.
