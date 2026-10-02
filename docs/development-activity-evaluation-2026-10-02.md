# Brokerage evaluation entitlement — Order L1: the 20-report credit ledger, built dark (2026-10-02)

Plan: `docs/development-activity-plan-2026-09-30.md`, Order L, Master Step 11 (launch rules, Hard Rules 28 and 38–41). Rulings:
`docs/development-activity-founder-rulings-2026-09-30.md`. Status: `docs/development-activity-status-2026-09-30.md` (Order L stays
**open**). Builds on Order K0 (`docs/development-activity-agent-workspace-2026-10-01.md`, PR #1534) and on the snapshot and
private-context layers (`docs/report-snapshot-contract-2026-09-30.md`, `docs/report-private-context-contract-2026-09-30.md`).

SQL of record: `docs/evaluation-entitlement.sql` — **PARKED, NOT APPLIED to production.** New schema in production needs its own
founder go (the F and F2 orders each recorded one; no ruling covers Order L), and **K0's `docs/brokerage-account-spine.sql` must be
merged and applied first**: this file hangs off its two tables and its resolver and refuses to apply without them. Nothing calls the new
functions: no edge function, page, gate, handler or schedule changed.

## 1. What this is, in one paragraph

L1 is the database half of the free 20-report evaluation for a brokerage, and nothing else. It adds four tables hung off K0's
`public.brokerage_account` (so there is **one** account table and **one** member table, not a second pair): `evaluation` (one per
account), `evaluation_invite` (a hashed, one-time, expiring invite), `evaluation_credit` (an append-only ledger, one row per report,
linking the `report_id`) and `evaluation_event` (an append-only lifecycle log). Thirteen system-only functions mint, redeem and revoke an
invite, create an account with its evaluation and first owner invite in one transaction, and **issue a report against the pool**:
`evaluation_report_issue` locks the evaluation, answers a retried key with the stored report at no charge, refuses report 21 with
`EVALUATION_COMPLETE`, calls the existing `report_snapshot_issue` **in the same transaction**, and appends the ledger row, so a refusal by
the snapshot layer rolls everything back and costs no credit. Used credits are the **count of ledger rows**; there is no counter. The
20-report cap holds **by constraint** at every isolation level and for every writer, not by a lock and a count. **A resident or customer
sees nothing change.**

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** identity is Supabase Auth (`auth.users`, the existing email one-time code) → K0's `public.brokerage_member`
  (a membership of one user in one brokerage, written by **this layer's redeem function**) → the ONE resolver
  `public.brokerage_membership_of(user_id)` → `public.evaluation_report_issue` → the existing `public.report_snapshot_issue` (the one
  snapshot and private-context writer, unchanged) → `public.report_snapshot`, with one `public.evaluation_credit` row linking the
  `report_id`. Whether a person may ask is answered by the resolver; the future entitlement check replaces `isAdmin` in the one shared
  gate `supabase/functions/_shared/admin-gate.ts` (its header says so) and is not built here. The address never enters this layer: it
  stays in `report_private_context`, reached only through `report_snapshot_issue`.
- **Decision owner** (nothing else decides any of these, and no handler decides them):

  | Question | Owner |
  |---|---|
  | Who is this person, commercially, and in which role | `brokerage_membership_of` (K0). Read, never re-derived; never matched by email or domain. |
  | Whether a report may be stored, and what the permanent snapshot may contain | `report_snapshot_issue` and the private-context containment trigger (Orders F, F2). Passed through untouched. |
  | Whether a credit is consumed | `evaluation_report_issue`: one credit per **successful** call. Whether a limited-coverage report should call it at all is open decision R5 and sits in the future handler, not here. |
  | How many credits exist | `evaluation_report_limit()`, the one definition of the number 20. |
  | Whether the 21st report is possible | The ledger's primary key `(evaluation_id, ordinal)` and CHECK `ordinal between 1 and evaluation_report_limit()`. A trigger flips the status; the function only reports. |
  | Paid state | Order M writes `evaluation.status`. `public.subscriptions` is the map-paywall product and is **not read or written here**. |

- **Shortcut check (commands run in this session; HEAD `b28d69f2fb321e13e2c40761c1312b0a52243c62`, K0's tip, before the new files):**
  - `git grep -n -i -E "evaluation_(credit|invite|event|report_issue|create|usage|check|revoke|report_limit)|evaluation_entitlement|public\.evaluation\b" HEAD -- .`
    returned **no line**. Positive control, same shell: `git grep -n -i -E "credit_ledger|credits_remaining|report_credit|entitlement" HEAD -- supabase lib scripts partials '*.html' '*.js'`
    returned 12 lines in 7 files — the inert landing page's "entitlement does not exist yet" notes, the three function headers saying the
    entitlement check will replace `isAdmin`, and three unrelated uses of the word (land-use entitlements in a residential qualifier, an evidence
    script and the jurisdiction registry) — so the search can find the word. None is a table, a function or a ledger.
  - `git grep -n -i -E "token_hash|redeem|idempotency|invite" HEAD -- supabase lib scripts partials shell.js '*.html' ':!*.md'` returned nine
    lines, none of them an invite, redeem or idempotency mechanism (a "◍ Invite your neighbors" share button, comments, and the snapshot
    module's note that "retry idempotency belongs with the credit ledger"). There is no second invite or credit mechanism to duplicate.
  - `git grep -l -i -E "brokerage_member|brokerage_membership_of" HEAD` returned exactly K0's SQL, tests, workflow and docs, so the one place
    that already names the account tables is the spine itself.
  - No second identity or account system is added: the only foreign keys out of the new tables are `auth.users` (the redeemer, cleared with the
    account), `brokerage_account`, `report_snapshot` and the layer's own tables.
  - `test/evaluation-entitlement-structure.test.mjs` pins all of this (pins 1, 3, 4) and fails if any file other than the SQL names an
    evaluation table or function, if the snapshot writer gains a caller, or if the SQL names `public.subscriptions`.
- **Concurrency check (CLAUDE.md, before editing): GENUINE GAP.**
  - `origin/main` was `7a637bc` when this branch was rebased onto it (K0 #1534, J1 #1536, M0 #1537 and I1 #1539 are all merged there; K0 was
    an identical tree to the base this unit was built on, so the rebase changed no K0 file). `git grep -l -i -E
    "evaluation_(credit|invite|event|report_issue|create|usage)|evaluation_entitlement"` over `origin/main`, the four sibling work branches
    (`wip-order-j1`, `wip-order-h`, `wip-order-i1`, `wip-order-m0`) and the three newest remote `claude/*` branches returned **no file**
    (control: `git grep -l -i dashboard_admins origin/main -- supabase` returns three files).
  - **UNVERIFIED: open and recently merged pull requests were not searched on GitHub.** This build was offline by instruction. The audit
    searched open PRs and found none touching an evaluation, entitlement, invite or quota; that is the audit's claim, from before this build.
    Search open PRs for "evaluation", "entitlement" and "credit" before opening this one.
  - **Overlap to expect at merge, not duplicate work:** `wip-order-j1` also edits the status file, the snapshot contract and
    `test/report-snapshot-structure.test.mjs` (the same two pins this unit widens); `wip-order-m0` edits the K0 workflow, the status file and
    K0's structural test (pin 4). Each is a textual conflict that keeps both edits; the merge order is the founder's.

## 3. What the audit found, and how far this build re-checked it

The prior read-only audit (`audit-L.json`, scoped to this unit) read production through the database tools. **This offline build could not
repeat any production read, so every production figure below is the audit's, marked UNVERIFIED here.**

| Claim | Source | Status in this build |
|---|---|---|
| Nothing for Order L exists in production: no entitlement, quota, invite, evaluation or credit table; `report_snapshot` and `report_private_context` hold 0 rows; `report_snapshot_issue` is executable by `service_role` only | audit, read-only SQL 2026-10-01 | **UNVERIFIED here** (not repeated). The repository half re-checked: nothing in the tree names an evaluation table (§2). |
| Open signup means an account proves only an email, so account existence cannot be an entitlement (Hard Rule 40) | audit, `shell.js` | not re-read; **UNVERIFIED here**. The design does not depend on it: an account is never an entitlement, only an invite-bound membership. |
| `public.subscriptions` is the map-paywall product (per user, plan `map_yearly`, 0 rows) and is read only behind `PAYWALL_ENABLED` | audit | **UNVERIFIED here**. This build does not touch it (pinned). |
| The snapshot writer is not idempotent and has no owner column; retry idempotency and ownership were deferred to Order L | `report-snapshot.ts`, the contract | re-read, true. **Refined here:** ownership lives in the ledger, not as a snapshot column; the contract carries a pointer. |
| The only report engine is an internal admin surface that stores nothing | `get-development-activity-report/handler.ts` | re-read, true (`stores_reports: false`); pinned unchanged. |
| The existing rate limiter is count-then-insert, so it cannot guard credits | audit | **UNVERIFIED here**. Attempt-based rate limiting is **not built** (§8). |
| Production Postgres version and whether `pgcrypto` is available | audit: pgcrypto 1.3 installed | **UNVERIFIED here.** This file does not need it: `gen_random_uuid()` is in core from PostgreSQL 13 and `sha256(bytea)` from 11, and the file refuses to apply if either is missing. |

## 4. What was built

### 4.1 The tables (all RLS on with no policy, every privilege revoked from `public`, `anon`, `authenticated` **and `service_role`**)

| `public.evaluation` | | |
|---|---|---|
| `evaluation_id` | uuid, primary key | |
| `brokerage_id` | uuid → `brokerage_account(id)`, **unique** | one evaluation per account; no cascade |
| `status` | text, `active` \| `complete` \| `revoked` | a state machine, never deleted |
| `seat_limit` | integer, null = no limit | D-L2 |
| `expires_at` | timestamptz, null = none | D-L3 |
| `created_at`, `revoked_at` | timestamptz | `revoked_at` stamped by the database |

| `public.evaluation_invite` | | |
|---|---|---|
| `invite_id` | uuid, primary key | |
| `evaluation_id` | uuid → `evaluation` | |
| `role` | text, `owner` \| `agent` | the role the membership will get |
| `token_hash` | text, unique, exactly 64 lowercase hex | **only the SHA-256 of the token** |
| `status` | text, `open` \| `redeemed` \| `revoked` | terminal once left |
| `expires_at` | timestamptz | at most 90 days after creation |
| `redeemed_by` | uuid → `auth.users` **on delete set null** | the one user id kept; cleared with the account |
| `created_at`, `redeemed_at`, `revoked_at` | timestamptz | stamped by the database |

| `public.evaluation_credit` | | |
|---|---|---|
| `evaluation_id`, `ordinal` | uuid, integer — **primary key**; `ordinal` CHECK `between 1 and evaluation_report_limit()` | the cap |
| `idempotency_key` | uuid — unique with `evaluation_id` | a retried key is one credit |
| `report_id` | uuid → `report_snapshot`, **unique**, not null | every credit links a stored report |
| `issued_at` | timestamptz | |

| `public.evaluation_event` | | |
|---|---|---|
| `event_id` (identity), `evaluation_id`, `kind`, `role`, `invite_id`, `at` | | `kind` is one of six lifecycle words; no free text, no token, no address, no user id, no ip |

### 4.2 The cap is a constraint

A row lock serialises concurrent writers only at READ COMMITTED. At REPEATABLE READ the waiter keeps its old snapshot and a count taken
from it is stale — measured on K0's owner guard, where two sessions both passed the check and left zero owners. So the 20-report cap does
not rest on a lock and a count. The ledger's primary key is `(evaluation_id, ordinal)` and the ordinal is CHECKed between 1 and the
limit: at most twenty distinct ordinals exist per evaluation, so a 21st row cannot be inserted by **any** writer, in any transaction, at
any isolation level, including one that bypasses the functions. `unique(evaluation_id, idempotency_key)` and `unique(report_id)` make a
retry and a report each one credit. The status flips to `complete` in an AFTER INSERT trigger on the 20th row, so the flip cannot be
skipped, and the evaluation guard refuses `complete` unless the ledger is full.

What remains lock-based is only the **friendly** behaviour: a retried key returns the stored report, the 21st call says
`EVALUATION_COMPLETE` rather than a constraint violation, the next ordinal is contiguous, and agent seats are counted. Those answers are
only right if the lock refreshes what the check sees, which it does at READ COMMITTED alone, so `evaluation_report_issue`,
`evaluation_invite_redeem`, `evaluation_invite_mint` and `evaluation_invite_revoke` **refuse any transaction that is not READ COMMITTED**
(errcode 55000, "needs READ COMMITTED") instead of relying on a lock whose effect depends on the level. (`evaluation_create` reaches mint
and so is covered.) The mint and revoke guards were added after the independent review measured that an owner removed after a REPEATABLE
READ snapshot could still mint an invite, or revoke one; no caller exists, and PostgREST cannot ask for that level, but the refusal costs
nothing. READ COMMITTED is the default for PostgREST and the migration role.

### 4.3 The functions (system-only; `service_role` alone may execute; trigger functions nobody)

| Function | What it does | Refusals |
|---|---|---|
| `evaluation_create(name, seat_limit, expires_at, invite_ttl)` | the account, the evaluation, a `created` event and the first **owner** invite, in one transaction (K0 asked for the account and its first owner to be created together). Returns the token once. | any CHECK refuses the whole call: nothing is left behind |
| `evaluation_invite_mint(evaluation, role, actor, ttl)` | a new invite; the token is returned **once**, only its SHA-256 is stored. `actor` null is the admin/system path (any role); an actor must be an active **owner of that very brokerage** and may invite agents only (D-L8). | `NOT_ENTITLED` |
| `evaluation_invite_redeem(token, user_id)` | binds the invite to a Supabase Auth user and **inserts the membership row** in `public.brokerage_member` (K0 left it with no writer; this is the writer). One-time. The same user presenting it again is idempotent (`replayed = true`, no second membership, no second event); anyone else is refused. | `INVITE_UNUSABLE` (one generic message for unknown, malformed, expired, revoked, redeemed-by-someone-else, ended evaluation, unknown user), `ALREADY_A_MEMBER`, `SEAT_LIMIT_REACHED` |
| `evaluation_invite_revoke(invite, actor)` / `evaluation_revoke(evaluation)` | end an open invite / the whole evaluation. Idempotent: false when there was nothing to revoke. | `NOT_ENTITLED` |
| `evaluation_report_issue(user, key, body, hash, version, engine inputs, private)` | THE credit. Locks the evaluation, asks the entitlement again once it holds the lock, answers a retried key from the ledger (no charge), refuses the 21st with `EVALUATION_COMPLETE`, calls `report_snapshot_issue` (the existing writer, arguments passed straight through), appends the ledger row. Returns the report, the ordinal, credits used and remaining, and the status. | `NOT_ENTITLED`, `EVALUATION_COMPLETE`, `IDEMPOTENCY_KEY_REQUIRED`, and the snapshot layer's own refusals (which roll the credit back) |
| `evaluation_usage(user)` | the one reader: status, limit, used and remaining (**derived**: the count of ledger rows), expiry, for a signed-in member of an active brokerage | nothing for a non-member |
| `evaluation_check()` | every invariant as a count that must be zero, beside two controls that must not be | |

**K0's invariants hold.** The redeem function respects one ACTIVE membership per user (it refuses with `ALREADY_A_MEMBER`, and K0's partial
unique index is the backstop the race `race_redeem_person` exercises), the `owner`/`agent` vocabulary, and the owner-removal rule: it only
**inserts** a membership and never updates, deactivates, demotes or deletes one, so it cannot reach K0's owner guard, whose isolation-level
refusal therefore never applies to it (pinned: no `update` or `delete` of `public.brokerage_member` anywhere in the file). Lock order is
always the evaluation row, then the invite row.

### 4.4 Errors the handler maps on (message, SQLSTATE)

`INVITE_UNUSABLE` EV001 · `EVALUATION_COMPLETE` EV002 · `NOT_ENTITLED` EV003 · `ALREADY_A_MEMBER` EV004 · `SEAT_LIMIT_REACHED` EV005 ·
`IDEMPOTENCY_KEY_REQUIRED` 22023 · `needs READ COMMITTED` 55000. Every entitlement refusal is identical (an outsider, a removed member, a
member of an account with no evaluation, a revoked, expired or suspended evaluation all get `NOT_ENTITLED`), so a refusal says nothing about why.

### 4.5 What it deliberately holds nothing of

No street address, address hash, property key, coordinate, report label, client name, email, domain, ip or free text in any of the four
tables — and **no user id in the append-only ledger or log.** **CLAUDE.md "Permanent historical intelligence" and the founder decision of
2026-09-29 govern:** customer-entered private context is customer context, not historical intelligence, and lives only in the deletable
`report_private_context` layer, reached through `report_snapshot_issue`. This file never names that table. The ledger records which report
a credit paid for and when, which is project intelligence and a commercial fact; who in the brokerage made it is Order J's ownership row
(deletable with the account); retaining an agent's identity in a permanent trail is an open founder question (audit K, decision 4), so the
conservative default is to store none. The one user id kept is `evaluation_invite.redeemed_by`, which is **not** append-only and is
cleared when the account is deleted, so an account deletion or a privacy request is never blocked by this layer (K0, D-K4).

Used credits are the count of ledger rows; a mutable counter would be a second copy that can drift, and no such column exists (pinned).

## 5. Concurrency verdict

- **The cap and the one-time rules hold by constraint** at READ COMMITTED, REPEATABLE READ and SERIALIZABLE. `run.sh` proves it with real
  sessions: at REPEATABLE READ and SERIALIZABLE one session holds a 20th-ordinal insert open, a second session that read the ledger
  before it tries the same ordinal and gets `23505` (or a serialisation failure), and a third tries a 21st and gets `23514`; the ledger ends at
  exactly 1..20 and `complete`.
- **The friendly answers hold at READ COMMITTED** and are refused elsewhere: two issues serialise and take ordinals 1 and 2; the last
  credit goes to exactly one of two callers and the other is told `EVALUATION_COMPLETE`; the same key from two callers is one credit and one
  report; **thirty concurrent callers for twenty credits give exactly twenty winners, ten `EVALUATION_COMPLETE` refusals, a ledger of exactly
  1..20, twenty new snapshots and no snapshot stored by a refused call**; one token and two people seat exactly the first; one seat and two
  agents seat one; one person and two invites to two brokerages hold one membership; a member removed while their call waits for the lock
  is refused once the lock is held; a mint during a revocation waits and is then refused.
- **What holding the lock costs:** the evaluation row is locked for the duration of one call, through the real snapshot writer. Measured
  on this machine: see §9 (`LOCK-HOLD`). A single evaluation has at most twenty issuing calls in its life, so contention is bounded by
  design.

## 6. Defaults taken (the founder may change any of them; nothing here hard-codes an open decision)

- **D-L1. Invite-only.** No self-serve signup path exists. Open signup means an account proves only an email, so an account is never an
  entitlement. An individual (non-brokerage) evaluation is not built.
- **D-L2. Seat limit is `evaluation.seat_limit`, null = no limit.** No number is chosen (the plan gives none). Enforced at redeem, for
  **active agents** only: an owner is not a seat, and a removed agent frees theirs.
- **D-L3. Evaluation expiry is `evaluation.expires_at`, null = none.** Set only at creation; the reader reports `expired`.
- **D-L4. An invite lives 14 days by default (a parameter, at most 90 days).** A bearer credential should not live forever.
- **D-L5. One credit per successful `evaluation_report_issue` call.** Unsupported ZIP, unresolved address and failed generation never reach
  it, so they cost nothing. R5 (does a limited-coverage report cost a credit, and at what threshold) is open: the future handler decides when
  to call; nothing here hard-codes it.
- **D-L6. The idempotency key is a caller-chosen random UUID bound to the evaluation only, never to the request content.** Hashing an address
  into the ledger would store an identifier that resolves to one address. The cost, stated: a retry with the same key and a **different**
  address returns the **first** report and stores nothing new; the handler must detect the mismatch from the private context while it is
  still active.
- **D-L7. An evaluation is a state: `active` → `complete` (the 20th credit) | `revoked`; `complete` → `revoked`; `revoked` is terminal.**
  Order M adds the paid transition deliberately by amending the guard; a paid continuation is not decided here.
- **D-L8. An owner may mint agent invites only.** Another owner is minted by the admin/system path. (One person, one active membership, is
  K0's D-K1.)

## 7. Open founder decisions (this unit does not take them; the audit default is taken and nothing is hard-coded)

1. **Go to APPLY the evaluation tables and functions to production** (new schema), after K0's spine. Not given; this PR is parked SQL only. **UPDATE 2026-10-02: the go was given
   and K0, then this layer, were applied (status file, "Applied to production"; L1 run `37016093353`, 13-function body fingerprint `a192907348a6601223f3d0ae653df2e5` equal to the file).
   The sentence before this one is the dated text from before the apply.**
2. **R5** — whether a limited-coverage or materially insufficient report consumes a credit, and the deterministic versioned threshold.
   It gates only the serving handler, not this layer.
3. **Self-serve versus invite-only** — default invite-only (D-L1); no signup path is built. If an individual evaluation is in V1, what stops
   multiple accounts per person?
4. **Seat cap** — the plan says "a limited number of agent users" and gives no number. A parameter (`seat_limit`); none chosen.
5. **Evaluation expiry** — optional in the plan, no value recorded. Default none (D-L3).
6. **Whether a free report counts as paid redistribution** for the source-rights audit, and which source families are cleared for it. Without
   it every customer report is limited coverage today. Not an L1 concern; it decides whether report 1 is worth a credit.
   **Related founder ruling, 2026-10-02 (verbatim: "free report does not count toward a pid subrsciption"):** the free evaluation reports do not count toward a paid subscription, read as
   "the 20 free credits are never counted against or deducted from a paid allotment". It matches this layer (the credit ledger is the evaluation's own; D-L7 leaves the paid transition to
   Order M, which must keep paid usage in its own ledger). **It is not read as answering this item**: whether a free report counts as paid redistribution for the source-rights audit stays open.
7. **Confirm that the evaluation account, not `public.subscriptions`, is the single entitlement authority for Development Activity,** so the
   map-paywall product and the brokerage evaluation do not become two truth paths. Engineering default stated and built that way; confirm
   because Order M changes the ingest-repo webhook (a cross-repo change this unit does not make).
8. **Retention of an agent's identity in the permanent audit trail** after an account deletion (carried from K): this layer stores none.

## 8. What this does NOT do (stated, not hidden)

- It builds no handler, edge function, page, workspace read, admin gate change or schedule, and does not touch `public.subscriptions`.
  `_shared/admin-gate.ts`, `_shared/service-rest.ts`, the shared snapshot module and both report handlers are unchanged and pinned so.
- **`report_snapshot_issue` stays directly executable by `service_role`.** A future function could still store a report without a credit.
  L1 pins structurally that nothing but its own issue function (and the existing shared module, which stores nothing today) calls it.
  Revoking that execute grant is the real hardening; it changes a locked, applied layer and belongs to the next unit, with its own proof.
- **No attempt-based rate limiting.** Free misses and failures are by rule uncharged, so an attacker with one valid evaluation could probe the
  geocoder and spatial read without limit. It needs the handler and an atomic limiter (the existing one is count-then-insert); deferred, and it
  must be named in the N gate.
- **No report ownership, share, reopen, print or download** (Order J), no agent invite UI, usage page or admin surface (Order K1), no paid
  continuation (Order M).
- A privileged writer (the table owner, i.e. the migration role) can clear `redeemed_by` on a redeemed invite: that is indistinguishable from
  the foreign key's own action when an account is deleted. It changes no entitlement (the membership row is the authority), only makes a
  later replay by that person impossible. A direct update that clears it **and** changes anything else is refused.
- A person with an active membership anywhere cannot be invited into a second brokerage (K0's one-active-membership rule; `ALREADY_A_MEMBER`).
  A consultant who works for two brokerages is a founder question (D-K1).
- A brokerage whose last owner deletes their account is left active with no owner (K0, D-K4); the evaluation, its ledger and its other
  members are untouched.
- **UNVERIFIED — a raw token passed as a function argument may be captured by production logging.** If the project's `log_statement` or
  `pg_stat_statements` settings record statement text or parameters, the token given to `evaluation_invite_redeem` (and the token returned
  to an admin) could appear in a log. Mitigations built in: the token is single-use, expires (14 days by default, 90 at most), and only its
  hash is stored. Production logging settings were not read in this offline build; read them before the apply.
- The advisor (`get_advisors`) was **not run** (no database tool was used in this build).

## 9. Proof

Every command below was run in this build, in the worktree on branch `wip-order-l1` off K0's tip `b28d69f`, against a throwaway PostgreSQL
16.13 started for the purpose (the harness is also wired for PostgreSQL 17 in CI by `.github/workflows/brokerage-account-suite.yml`,
job `evaluation`; **that CI run has not happened**).

| # | Command (from the worktree) | Decisive output |
|---|---|---|
| 1 | `PGHOST=<socket> PGUSER=postgres PGDATABASE=l1_disposable bash test/evaluation_entitlement_pg/run.sh` | `SHIPPED: 89 checks, 0 failed` · `CONCURRENT: two issues serialise (ordinals 1 and 2); the last credit goes to one caller; one key is one credit; 30 callers win exactly 20 credits; one token and one seat go to one person; a member removed while waiting is refused; a mint during a revocation waits and is refused` · `ISOLATION: at REPEATABLE READ and SERIALIZABLE a writer that bypasses the functions still cannot add a 21st ledger row or repeat an ordinal (the cap is a constraint)` · `LOCK-HOLD max_ms=5.18 avg_ms=0.64` · `TOKEN HASH: the hash stored for a minted token equals what sha256sum computes from it` · `APPLIED TWICE with an identical definition` · `POISONED: ...` · `ROLLED BACK: the footer removes every evaluation* object and nothing else ...` · then 192 lines `KILLED`, 0 `SURVIVED`, 0 `HARNESS`, exit 0 (counted from the saved log; 257 s on this machine) |
| 2 | `node test/evaluation-entitlement-structure.test.mjs` | `74 passed, 0 failed of 74` |
| 3 | `python3 test/evaluation_entitlement_mutants.py` | `197 killed, 0 survived, 50 skipped (database only), 0 harness fault(s), of 247` (192 edits of the SQL, 19 edits only the structural test can see, 36 edits of the files around it; every file is restored byte for byte after each). The 50 skipped are the ones the structural pins cannot see (a wrong branch, a missing event, a dropped CHECK); each of them is among the 192 that item 1 kills in the database. |
| 4 | `node test/brokerage-account-structure.test.mjs` and `python3 test/brokerage_account_mutants.py` (K0, after widening its pin 4 to allow this unit's one SQL file) | `57 passed, 0 failed of 57`; `88 killed, 0 survived, 0 skipped, 0 harness fault(s), of 88` |
| 5 | `node test/report-snapshot-structure.test.mjs` (pins 3 and 3c widened for this unit's foreign key and its one call of the writer) | `46 passed, 0 failed of 46` |
| 6 | `node scripts/run-unit-tests.mjs --offline` (the mode the required CI check runs) | `All 291 unit test file(s) passed (mode=offline).` (K0 recorded 290; this unit adds one structure test) |

What the 89 database checks cover, each against a hard-coded expectation (the suite never asks the code under test for its own answer): **Z01–Z09**
the apply leaves four empty tables, the exact columns, constraints **and their definitions** (Z03b), seven triggers, indexes, thirteen functions and
one sequence, and `evaluation_create` made eleven evaluations each with its own account, one owner invite and no member; **L01** the token is 69
characters, its stored hash is the SHA-256, it appears in no row of any new table, and no function returns a hash; **L02** redeem: one-time and
bound to a user, replay idempotent, a different user refused, every refusal the one generic message, expired and revoked invites, an existing
member, a user not in `auth.users`, seat limits, roles, the terminal invite (and that clearing the redeemer together with another change is
refused), the closed vocabularies, atomic creation, a peer presenting another person's token; **L03** one shared pool: a fourth member and three
invites change nothing, two brokerages never share; **L04** twenty keys succeed, the 21st is `EVALUATION_COMPLETE` and costs nothing, the status
flips at the 20th with one event, the cap by constraint for a writer that bypasses the function, the evaluation state machine; **L05**
idempotency (the same key is one report, on a complete evaluation too, per evaluation, the stated D-L6 limit, a ledger row with no report or no
evaluation refused); **L06** a refusal by the snapshot costs no credit and the key is not burned; **L08** every non-member, removed member, revoked,
expired, suspended or closed case is refused identically, minting and revoking are authorised in the database, REPEATABLE READ and SERIALIZABLE
are refused and READ COMMITTED works, a removed member's replay and an expired evaluation's invite are refused, a freed seat is reusable;
**L09** privacy: nothing an agent typed reaches any new table; **L10** the lock-down asked AS each role (48 table, 18 function and 3 sequence
refusals), RLS on, no policy, one security-definer set with pinned search paths; **L11** remaining is derived and the audit function finds
nothing, beside controls that must find something; **L12** deleting an account is never blocked and the credit history survives it; **S01** no
setup step raised.

**Weak spots found while building, each fixed before the numbers above (they are why the suite reads as it does):**

- **A refusal check that could not see the absence of a refusal.** Five prohibited mutations (the redeem isolation refusal removed, and three
  mint authorisation rules removed) survived the first full run because the suite asked `bool_and(err like ...)` over rows whose `err` was NULL
  when no refusal happened, and `bool_and` ignores NULLs. Every such check now goes through a null-safe aggregate (`pg_temp.all_t`), which the
  mutations then killed.
- **A vocabulary widened by one word survived because the constraint NAME did not change.** Z03 compared names only; Z03b now compares the
  definition text of the closed vocabularies, the key and the cap.
- **Five behaviours had no check** and now have one: a removed member replaying their invite, redeem against an expired evaluation, a freed
  seat (and an off-by-one at the limit), a ledger row with no report, and clearing the redeemer while changing the redemption time.
- **A mint taken without the evaluation lock was invisible** to every single-session check; `race_mint_while_revoking` is the real-session
  scenario that sees it. A second sequence behind the tables was not exercised by the poisoned-state check; it is now.
- **One mutation was a no-op** (seeding an evaluation against an empty account table inserts nothing) and was rewritten to seed both rows, so a
  survivor could not be read as a pass.

**Equivalent mutants, not claimed killed** (they cannot change any observable outcome; listed in the harness): redeem without only the invite
row lock (every redeemer takes the evaluation lock first); the ordinal taken as count + 1 instead of max + 1 (the same number while the ledger is
contiguous); the post-condition's row-level-security check and its "at least 13 functions" (the statements above it make them unreachable); and the
post-condition's trigger-function limb (the lock loop revokes it first; the same grant through a mutated loop is killed by L10).

Environment: PostgreSQL 16.13 (the Ubuntu package) in a throwaway cluster started as the `postgres` OS user under `/var/tmp`, `trust`
authentication over a unix socket, database `l1_disposable`; Node 22. The stand-ins are `test/evaluation_entitlement_pg/fixture.sql`: the three
Supabase roles, Supabase's default privileges on tables, sequences and functions, and an `auth.users` table of two columns. The suite stands on the
**real** account spine, private-context layer and snapshot writer, applied unmutated by `run.sh`.

**Not exercised, stated plainly:** production (nothing was applied, read or written there; the file is parked); PostgreSQL 17 (the CI container) —
only 16.13 ran, and Z03b compares `pg_get_constraintdef` text, which is the one place a version could render differently (UNVERIFIED on 17); the
workflow itself on GitHub; any signed-in call, edge function or handler (none exists); the browser-backed suites (`--browser`; K0 recorded that they
fail in this sandbox identically on `main`, which this build did not re-check, and this unit adds no HTML, script or lib file); the Supabase advisor;
production logging settings; and the production claims in §3 marked UNVERIFIED. The race scenarios depend on timing (a two-and-a-half-second hold) and
were run on a local machine, not on a shared runner.

## 10. Applying it, and rolling back

Apply `docs/evaluation-entitlement.sql` only after a founder go, **after** `docs/brokerage-account-spine.sql` (K0, #1534), and after
`docs/report-snapshot.sql` and `docs/report-private-context.sql`, which are already applied: it is idempotent, fails closed on any missing
dependency, and ends in a post-condition that reads the whole ACL and stops the apply on a policy or a grant to any role but the owner. It
creates four tables, one explicit index beside the keys, one sequence (the event identity), seven triggers and thirteen functions, alters
nothing that exists, writes no row and arms no schedule. Rollback is the commented block at the foot of the file; anything a later order
hung off these tables (Order J's ownership rows keyed by `report_id`, Order M's paid state) must be rolled back **first**, and the
rollback leaves the snapshots it linked without an owner, so it is only appropriate before the first real report is issued. Memberships the
redeem function created stay in `public.brokerage_member`.
