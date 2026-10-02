# Agent Workspace + Brokerage Admin — Order K0: the account spine (2026-10-01)

Plan: `docs/development-activity-plan-2026-09-30.md`, Order K, Master Step 8 (Agent Workspace Visual Contract, Brokerage
Owner/Admin Visual Contract, Workspace Navigation Separation) and Hard Rules 30 and 38–41. Rulings:
`docs/development-activity-founder-rulings-2026-09-30.md`. Status: `docs/development-activity-status-2026-09-30.md`
(Order K stays **open**).

SQL of record: `docs/brokerage-account-spine.sql` — **PARKED, NOT APPLIED to production.** Applying new schema to production
needs its own founder go (CLAUDE.md §3 stop list; the earlier schema orders each recorded one). Nothing in this unit calls, reads or
writes the new tables.

## 1. What this is, in one paragraph

K0 is the one slice of Order K that can be built before the other orders exist: the answer to "who is this signed-in person,
in the commercial sense?". It adds two tables, `public.brokerage_account` and `public.brokerage_member`, and one resolver,
`public.brokerage_membership_of(user_id)`, which returns the user's active brokerage and role or nothing. Membership is
explicit, by Supabase Auth user id, never inferred from an email or its domain. The tables are empty, unreadable by `anon`,
`authenticated` and `service_role`, and reached only through the resolver. **A resident or customer sees nothing change**: no
page, edge function, grant or data row. The Enterprise page and its inert buttons are untouched, and the admin gate still
answers from `public.dashboard_admins`.

The names are fixed because Order L (invites, evaluation account, entitlement, quota) will hang its rows off
`brokerage_account` and call the resolver, instead of creating account tables of its own.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** identity is Supabase Auth (`auth.users`, email one-time code in `shell.js`) →
  `public.brokerage_account` + `public.brokerage_member` (a membership row keyed to `auth.users.id`; role `owner` or
  `agent`; status `active` or `deactivated`) → the ONE service-role-only resolver `public.brokerage_membership_of` → consumed,
  once Orders J and L exist, in exactly one place: `supabase/functions/_shared/admin-gate.ts`, where that file's own header
  says the entitlement check replaces `isAdmin`; the workspace and admin reads then follow. Until then `dashboard_admins`
  stays the gate. Report ownership (Order J) is a separate row keyed by `report_id`, never a column on the immutable
  `report_snapshot`; watching is the existing `follow` need on the private context plus an owner row; usage and "reports
  remaining" are derived on the server from ownership and ledger rows (Orders L and M own entitlement and quota; K only reads).
- **Decision owner:** for "who is this person commercially, and in which role" it is `public.brokerage_membership_of`; for "what a
  membership may be" it is the table's CHECK constraints, the partial unique index and the `brokerage_member_guard` trigger.
  Nothing else decides either, and no handler calls the resolver directly.
- **Shortcut check (commands run in this session, on `origin/main` at `ea0d1db48a6d7c068228ccf98d0be0a754fc2aad`):**
  - `git grep -n -i "brokerage_account\|brokerage_member\|brokerage_membership" -- . ':!docs/brokerage-account-spine.sql' ':!test/brokerage_account_pg'`
    returned **no line** (before the new files were added). Positive control, same shell: `git grep -il "dashboard_admins"` returns
    `CLAUDE.md`, `acquisition.html`, `docs/acquisition-dashboard-setup.sql`, `docs/acquisition-dashboard-spec.md`,
    `docs/acquisition-dashboard-v2-setup.sql` (first five lines), so the search can find a name that exists.
  - `git grep -c -i "brokerage" -- supabase/functions` returned **no line**: no edge function, shared module or handler mentions a
    brokerage at all, so there is no existing account concept to duplicate or contradict.
  - A second identity system is not added: the only foreign key out of the new tables, apart from the pair, is `auth.users`, as
    every resident table already does (`docs/phase1-app-schema.sql` lines 48, 53, 61, 68, 74 `references auth.users(id) on delete cascade`).
  - `test/brokerage-account-structure.test.mjs` pins all of this and fails if a file other than the SQL names the tables, or if
    the admin gate or the service reader names a brokerage, or stops reading `dashboard_admins` (pin 4, 4b, 5, 5b).
- **Concurrency check (CLAUDE.md, before editing): GENUINE GAP.**
  - `origin/main` was fetched at the start of this build and is `ea0d1db48a6d7c068228ccf98d0be0a754fc2aad`
    ("A decided application browses as Proposed in every rule that maps a stored status to a lifecycle (#1526)"). The prior audit
    saw `2f03e1f`; `main` has since moved by #1523 and #1526, neither of which touches an account concept (`git diff --stat 2f03e1f ea0d1db`
    lists 32 files; filtering their names for `brokerage|account|workspace|agent` gives 0, and the same filter gives 1 on a planted
    path `docs/x-agent-workspace.md`, so the zero is a read, not a blind filter).
  - The 14 newest remote branches other than `main` were each searched for the three names and for changed files named brokerage,
    workspace or agent: **0 of 14** (a scan over `git grep -il` and `git diff --name-only origin/main...<branch>`; control, the same
    `git grep` finds `dashboard_admins` in 4 files under `supabase/` on `origin/main`).
  - **UNVERIFIED: open and recently merged pull requests were not searched on GitHub.** This build was offline by instruction (no
    network or GitHub tool), so the verdict rests on `main` and on the remote branches already fetched. Search open PRs for
    "brokerage", "workspace" and "account spine" before opening this one.

## 3. What the audit found, and how far this build re-checked it

The prior read-only audit (`audit-K.json`, scoped to this unit) read production through the database tools. **This offline build
could not repeat any production read, so every production figure below is the audit's, marked UNVERIFIED here.** What this build did
re-check, from the repository, is stated.

| Claim | Source | Status in this build |
|---|---|---|
| Order K is open; Follow ownership "not built (Order K)" | `docs/development-activity-status-2026-09-30.md` | re-read, true on `ea0d1db` |
| The only login is Supabase Auth email one-time code; `HS.requireAuth(label, afterAuth)` resumes a pending action | `shell.js` lines 863, 924, 957 | re-read, true |
| The internal-function gate is `public.dashboard_admins` by exact email; its header says the entitlement check replaces `isAdmin` | `supabase/functions/_shared/admin-gate.ts` header, `_shared/service-rest.ts` line 70 | re-read, true |
| No brokerage, organization, seat, entitlement, invite, credit, workspace or report-ownership table or function exists in production | audit, `information_schema` and `pg_proc` reads with a positive control | **UNVERIFIED here** (not repeated) |
| Production counts: `auth.users` 28, `public.users` 15, `app_follows` 18, `app_properties` 8, `public.subscriptions` 0 | audit | **UNVERIFIED here** |
| `report_snapshot` has no owner column and 0 rows; the F-order SQL says the owner column arrives with the unit that creates the account tables (**superseded by this design:** K0 adds no owner column; ownership will be Order J's own row keyed by `report_id`, so `docs/report-snapshot.sql` lines 70-73 no longer describe the plan) | `docs/report-snapshot.sql`; audit for the row count | the SQL half re-read; the count **UNVERIFIED here** |
| `public.users` (alert-subscription system) has no foreign key to `auth.users` and is not a membership candidate | audit read of `pg_constraint`; `CLAUDE.md` §6.5 | **UNVERIFIED here** |
| The Enterprise nav item links to the marketing landing, which is not an Agent Workspace | `partials/shell.html`, `development-activity.html` (audit) | not re-read; **UNVERIFIED here** |

## 4. What was built

### 4.1 The tables

| `public.brokerage_account` | | |
|---|---|---|
| `id` | uuid, primary key, `gen_random_uuid()` | |
| `name` | text, not null, not blank | the commercial customer's name |
| `status` | text, `active` \| `suspended` \| `closed` | default `active` |
| `created_at` | timestamptz | |

| `public.brokerage_member` | | |
|---|---|---|
| `id` | uuid, primary key | |
| `brokerage_id` | uuid → `brokerage_account(id)` | no cascade: an account is closed, not deleted |
| `user_id` | uuid → `auth.users(id)` **on delete cascade** | the one identity system |
| `role` | text, `owner` \| `agent` | |
| `status` | text, `active` \| `deactivated` | |
| `joined_at`, `deactivated_at` | timestamptz | active exactly when `deactivated_at` is null; stamped by the database |

### 4.2 The invariants, by constraint and trigger

1. **One active membership per user** — partial unique index on `user_id where status = 'active'`. An invite cannot mint a second
   20-report pool for the same person (plan Hard Rules 38–39). A deactivated row blocks nothing, here or in another brokerage.
2. **Closed vocabularies** — role, membership status and brokerage status are CHECKs.
3. **The last active owner of an active brokerage cannot be deactivated or demoted.** Two sessions removing two owners at once
   are serialised on the brokerage row (`for no key update`), so both cannot pass the check and leave none. The guard protects an
   active brokerage only: a suspended or closed one can be wound down.
4. **Identity and history do not change.** `id`, `brokerage_id`, `user_id` and `joined_at` never change; a deactivated membership
   is terminal and a returning person is a new row; the deactivation time is stamped by the database, never taken from the caller.
5. **Membership is by user id only.** The resolver takes a user id; it never reads an email or a domain.

### 4.3 The resolver and the lock-down

`brokerage_membership_of(p_user_id uuid)` returns `(brokerage_id, role)` for an active member of an **active** brokerage, or no
row; `STABLE`, `SECURITY DEFINER`, `search_path = public, pg_temp`. RLS is on with **no policy**; every privilege on both tables is
revoked from `public`, `anon`, `authenticated` **and `service_role`**; the resolver is executable by `service_role` alone, and
the trigger function by nobody. The function lock is a computed loop over this file's own prefix (`brokerage_member%`), not a typed
list and not a wider prefix, so a later order's `brokerage_*` functions are not re-locked when this file is applied again. The file ends
with a fail-closed post-condition (RLS on, no policy, no API-role privilege on either table), so a half-applied or poisoned state
stops the apply.

### 4.4 What it deliberately holds nothing of

No street address, normalized address, coordinate, property key, report label, client name, email, email domain, credit, quota,
price, invite token, seat limit or billing state. **CLAUDE.md "Permanent historical intelligence" and the founder decision of
2026-09-29 govern:** customer-entered private context (an address a brokerage typed, anything derived from it, a client-identifying
detail) is customer context, not historical intelligence, and lives only in the deletable `report_private_context` layer. Nothing in
this unit names that layer, a report, a Follow or any resident table; the structural pin refuses a column named for any of them.
Whose report is whose is Order J's row keyed by `report_id`; what a brokerage may use is Orders L's and M's. The audit trail and
the team table (Order J and the Step 8 contract) must carry `report_id`, dates and counts, never an address or a label.

## 5. Defaults taken (the founder may change any of them)

- **D-K1. One active membership per user.** The plan says agents are users inside the account, not whether a person may belong to
  two brokerages. Default: no. Changing it means dropping the partial index and deciding which brokerage's pool a report draws from.
- **D-K2. Roles are exactly `owner` and `agent`.** No viewer, billing contact or other role until a surface needs one.
- **D-K3. No writers.** Nothing in the repository creates a brokerage or a member: no function, no edge function, no page. The
  invite flow of Order L is the first writer, and it creates rows through the migration role or its own locked functions.
- **D-K4. Deleting an auth user is never blocked.** An account deletion or a privacy request deletes the person's memberships (the
  foreign key cascades). If they were the last active owner of an active brokerage, the brokerage is left active with no active owner:
  stated, not hidden, and detectable by one query (the suite's B04k runs it and finds exactly the planted case beside a control).
  **This spine invents no suspension or reassignment rule**; the resolver still answers for the agents of an ownerless brokerage
  (B05f). What to do — suspend, reassign, close — belongs to Order L with the founder. The prior audit asked for a stated outcome
  here and gave no default; this is the one that blocks no privacy request and writes nothing on its own.
- **D-K5. Deactivation is terminal.** `joined_at` and `deactivated_at` describe one episode; reactivating would erase when it ended.
  A returning person is a new row with a new `joined_at`. The plan says "invites/deactivation" and never mentions reactivation.
- **D-K6. A brokerage is `active`, `suspended` or `closed`.** The audit named suspended and closed; the guard and the resolver treat
  anything but `active` as "no membership resolves". No transition rules are imposed. A person who is an active member of a closed or
  suspended brokerage keeps their one active membership (resolving to nothing) until it is deactivated; the guard allows that wind-down.

## 6. What this does NOT do (stated, not hidden)

- It builds no page, no Agent Workspace and no Brokerage Admin, and no edge function. The Enterprise nav item still links to the
  inert landing page.
- No invite, evaluation account, 20-report pool, seat limit, credit, quota, price, plan control or billing state (Orders L and M).
- No report ownership, share, audit trail, "recent reports across devices", usage counts or client-engagement signals (Order J).
- No Follow ownership: today any allow-listed admin can attach a Follow to any `report_id`; a member being allowed to follow only reports
  their brokerage owns needs the Order J ownership row first.
- It does not change `_shared/admin-gate.ts`, `_shared/service-rest.ts`, any edge function or any browser file. The gate stays
  `dashboard_admins`; when Orders J and L land, the resolver is read **in the gate**, never called from a handler (a second gate).
- It creates no row and runs no schedule. The tables are empty.
- Supabase's advisor reports a table with row level security on and no policy as informational; here that is the intended posture
  (stricter than the `dashboard_admins` posture, which revokes anon and authenticated only and leaves `service_role` reading it
  directly; here `service_role` is revoked too, so every future writer must be a SECURITY DEFINER function or a migration). The advisor
  was **not run** (no database tool was used in this build).
- A brokerage with no active owner can exist (D-K4), and between creating a brokerage and inserting its first owner there is a moment
  with none; Order L's creation function should do both in one transaction.
- Serialisation of two owner removals holds only at READ COMMITTED (the default for PostgREST and the migration role). An independent
  review reproduced the failure above it on PostgreSQL 16: two sessions each removing a different owner at REPEATABLE READ both
  committed and left **zero** owners (READ COMMITTED left one; SERIALIZABLE left one through a serialisation failure), because waiting
  on the row lock does not refresh a REPEATABLE READ snapshot. The guard therefore REFUSES an owner removal or demotion at any level
  but READ COMMITTED (errcode 55000, message "needs READ COMMITTED"), before it takes the lock. `run.sh` proves both halves: the refusal
  at REPEATABLE READ and SERIALIZABLE, and the same removal succeeding at READ COMMITTED (so a blanket refusal cannot pass); three
  mutations (check removed, check refusing everything, lock removed) are each killed by the race or isolation step. Every writer
  Order L adds must remove owners at READ COMMITTED.
- The ACL post-condition reads the table's whole ACL (no grantee but the owner) instead of a typed role list, so a grant to an
  unnamed role, to PUBLIC, or a privilege a newer PostgreSQL adds (MAINTAIN) stops the apply; the function lock names each function by
  its schema-qualified identity so a same-named function in an earlier schema cannot be re-targeted.

## 7. What K1 and later need from J and L

- **From J:** a report-ownership row keyed by `report_id` (not a column on `report_snapshot`, which is immutable), share and client-view
  events, the brokerage audit trail, and the closing of the `report` need (`report-private-context-contract` D-4).
- **From L:** invites (a token-hash bootstrap credential, not an identity), the evaluation account and 20-report pool hung off
  `brokerage_account`, seat limits, entitlement and quota; and the answer to D-K4.
- **From M:** price, checkout and brokerage-level entitlement. K's "Manage plan" can only show status until then.
- **For K1:** a server list of a member's follows and a per-follow "changes" fan-out (the Follow function answers one report at a time),
  coverage preflight classification, comparison of candidate properties (no code exists), and whether notifications are in scope.

## 8. Founder decisions this unit does not take (from the audit)

1. **Go to APPLY the account tables to production** (new schema). Not given; this PR is parked SQL only.
2. **Seat limit** — how many agents may a brokerage evaluation account add? No number in the plan or rulings.
3. **May an owner open an agent's report content and address/label, or only counts, report ids and dates?** Default for the later
   surfaces: counts and ids only, with the address visible to the creating agent.
4. **Retention of agent identity in the permanent audit trail** after an account deletion or privacy request (plan lines 1767–1786 versus
   `report-private-context-contract` D-3). Likely needs a legal view; it decides what the Team table may show.
5. **Notification scope for Watch This Property** — in-workspace "what changed" only for K, or outbound email too (a consent basis
   separate from resident alert consent).

## 9. Proof

Every command below was run in this build, in the worktree on branch `wip-order-k0` off `ea0d1db`, against a throwaway PostgreSQL 16.13
started for the purpose (the pg harness is also wired for PostgreSQL 17 in CI by `.github/workflows/brokerage-account-suite.yml`;
**that CI run has not happened**).

| # | Command (from the worktree) | Decisive output |
|---|---|---|
| 1 | `PGHOST=<socket> PGUSER=postgres PGDATABASE=brokerage_disposable bash test/brokerage_account_pg/run.sh` | `SHIPPED: 48 checks, 0 failed` · `CONCURRENT: two sessions removing the two owners of one brokerage at once leave exactly one` · `ISOLATION: removing an owner at REPEATABLE READ or SERIALIZABLE is refused; at READ COMMITTED it goes through` · `APPLIED TWICE with an identical definition` · `POISONED: a pre-existing policy stops the apply, and a stray grant is revoked by it` · then 62 lines `KILLED`, 0 `SURVIVED`, 0 `HARNESS`, exit 0 (counted from the saved log) |
| 2 | `node test/brokerage-account-structure.test.mjs` | `57 passed, 0 failed of 57` |
| 3 | `python3 test/brokerage_account_mutants.py` | `88 killed, 0 survived, 0 skipped (database only), 0 harness fault(s), of 88` (62 edits of the SQL and 26 of the files around it; every file is restored byte for byte after each, and the working tree then holds only this unit's files) |
| 4 | `node scripts/run-unit-tests.mjs --offline` (the mode the required CI check runs) | `All 289 unit test file(s) passed (mode=offline).` |
| 5 | `node scripts/run-unit-tests.mjs --browser` (the 46 browser-backed suites; they need Playwright and exercise pages, none of which this unit touches) | 46 suites ran: 31 passed and `15 test file(s) failed`. **All 15 fail identically on a pristine export of `origin/main` at `ea0d1db`** (`git archive` into a scratch directory with the same `node_modules`; this worktree was not touched): the same FAIL and PASS counts where a suite prints them (`map1-dc-type-lifecycle` 18 and 18, `map1-national-plane-failure` 21 and 70, `map1-dual-identity` 14 and 10, `map1-stage-filter-chips` 11 and 40, `map1-type-filter-chips` 8 and 52, `maps-datacenter-capture-state` 16 and 3, `user-journey` 6 and 103, `map1-all-types-off` 9 and 23, `map1-regulatory-toggle` 3 and 19, `place-context-map-fits-frame` 3 and 4, `acquisition-video-producer-workflow` 1 and 31), and exit 1 on both for the four that crash before printing counts. This unit adds no HTML, JS or lib file. **The cause was not investigated**; the Map 1 suites draw 0 markers here, and a sandbox with no network egress is a guess, UNVERIFIED. So "the full suite finishes with `All N unit test file(s) passed`" is true of the required offline mode (item 4) and **not** of the browser mode in this environment, on `main` or on this branch. |

What the 48 database checks cover, each against a hard-coded expectation: **Z01–Z06** the apply leaves both tables empty, the exact columns,
constraints, one trigger and one partial unique index (and the setup landed); **B02a–B02h** one active membership per user, a deactivated row
blocks nothing, a returning person is a new row, deactivation is terminal, and the whole-table zero has a control; **B03a–B03e** every closed
vocabulary and the shape of a row, each asked so that only that rule can refuse it; **B04a–B04l** the last active owner (deactivate, demote,
both at once, per brokerage, a deactivated owner does not count, closed and suspended brokerages are not guarded), identity columns, the
database-stamped deactivation time against a back-dated one, and deleting an auth user (including the last owner of an active brokerage,
D-K4); **B05a–B05h** the resolver (owner and agent, deactivated, suspended and closed, unknown, deleted and NULL users, two accounts sharing
one email, at most one row per person, signature and volatility); **L01–L07** RLS on with no policy, no privilege on either table for any
API role or PUBLIC, 24 refused reads and writes asked AS each role, the resolver executable by `service_role` alone and nobody able to
execute the guard, one security-definer function with a pinned search path, and nothing else in the spine; **S01** no setup step raised.

The prohibited mutations (62 of the SQL; the audit's eleven and 51 more) include: dropping the one-active index, making it non-partial or
per brokerage; dropping the last-owner trigger; ignoring its demotion arm or its deactivation arm; counting a deactivated owner, the row
itself, an owner of another brokerage or an agent as "another owner"; applying the guard to inactive brokerages; **removing its lock (killed
only by the two-session race)**; **removing the isolation-level refusal, or making it refuse at READ COMMITTED too (both killed only by the race and
isolation steps, added after the independent review)**; widening any vocabulary; dropping a CHECK or the cascade; widening grants to `authenticated`, `anon` or
`service_role`; adding a policy; skipping the revoke from PUBLIC; granting the trigger function; the resolver ignoring member status or
brokerage status, going SECURITY INVOKER, unpinning its search path, taking an email, or matching an email domain; any of nine forbidden
columns (email, email domain, address, label, credits, quota, price, invite token, client name); seeding a row; adding an invite table or a
credits function; **removing the post-condition, or its whole-ACL read (each killed only by the poisoned-state check)**. The 26 file mutations include a gate, a
handler or a lib file naming the tables or the resolver, the service reader no longer reading `dashboard_admins`, the gate no longer asking
`isAdmin`, the SQL naming a resident or report table, arming a schedule, deleting or dropping, losing its rollback or its NOT APPLIED
marker, the status file striking Order K or Master Step 8, the workflow holding a secret, gaining a schedule or ceasing to run on the SQL.
**Two pins were weak on the first run and were tightened before the numbers above:** the column scan matched only three column types, so a
planted `credits integer` survived; and the workflow pin matched the SQL path in a comment, so removing it from both trigger lists survived.
Both now fail on exactly those mutations (items 2 and 3 were re-run after).

Environment: PostgreSQL 16.13 (the Ubuntu package) in a throwaway cluster started as the `postgres` OS user under `/var/tmp`, `trust`
authentication over a unix socket, database `brokerage_disposable`; Node 22. The stand-ins are `test/brokerage_account_pg/fixture.sql`:
the three Supabase roles, Supabase's default privileges, and an `auth.users` table of two columns.

**Not exercised, stated plainly:** production (nothing was applied, read or written there; the file is parked); PostgreSQL 17 (the
CI container) — only 16.13 ran; the workflow itself on GitHub; a signed-in call to anything; and the production claims in §3 marked
UNVERIFIED. The race test depends on timing (one second and a half of delay against a five-second hold) and was run on a local
machine, not on a shared runner.

## 10. Applying it, and rolling back

Apply `docs/brokerage-account-spine.sql` only after a founder go, through a migration (it is idempotent and ends in a fail-closed
post-condition; it needs `auth.users` and `gen_random_uuid()`, and refuses without them). It creates two tables, two indexes beside
the primary keys, one trigger and two functions, alters nothing that exists, and writes no row. Rollback is the commented block at the
foot of the file; anything a later order hung off these tables must be rolled back first.
