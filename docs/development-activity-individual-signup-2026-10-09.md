# Development Activity: individual-agent signup (Order L2) — 2026-10-09

Founder model (confirmed 2026-10-09): **individual agents** get 10 free Development Activity reports, then $79/month for 100.
**Brokerages, teams and enterprise** are custom-quoted. An individual registers and gets their own account **automatically**, with no
HomeSignal step. Reuse the existing account, entitlement, report and billing architecture; no parallel system.

## Canonical truth path and decision owners
| Question | Owner (unchanged unless stated) |
|---|---|
| Who is this person commercially? | `public.brokerage_membership_of` (the one resolver) |
| How many free reports, and are they used? | `public.evaluation_report_limit()` (10) + the append-only `evaluation_credit` ledger |
| May this report be made and charged? | `public.brokerage_report_issue` → `evaluation_report_issue` |
| What does the plan cost / allow? | `public.billing_report_limit()` (100), `billing_usage`, `manage-billing` |
| **Is this account an individual or a brokerage? (new)** | `brokerage_account.account_type`, one column, never changes after creation |
| **May a second person join an individual account? (new)** | trigger `brokerage_member_individual_guard`; no invites: `evaluation_invite_individual_guard` |
| **How does an individual get an account? (new)** | `public.individual_signup(user, name)`, one transaction, called only by the trial function's `signup` action |

Shortcut check: no new table, no second membership/credit/billing system, no changed price, limit or payment setting. `grep` of the new file's code
for price / checkout / processor / payment words returns nothing (pinned by `test/individual-agent-signup-structure.test.mjs`).

## Is an account-type distinction needed? Yes, and only this much
Without it, "individual plan" and "brokerage plan" are indistinguishable, so a team could be built inside a $79 account (the owner invites agents; billing
only looks at the owner). `account_type in ('brokerage','individual')`, default `'brokerage'` (so every existing account is unchanged), plus three
database guards: the type never changes; an individual account holds one active member and it is the owner; an individual account can have no invites.
Seat limit 0 on its evaluation is belt and braces (the redeem function already enforces seats).

## Files
- `docs/individual-agent-signup.sql` — the SQL of record. **PARKED, NOT APPLIED.** Idempotent, additive, with a rollback footer.
- `supabase/functions/development-activity-trial` + `_shared/evaluation-reads.ts` — new `signup` action; `status` also reports `account_type` (degrades to null if unreadable).
- `development-activity-reports.html` — a signup card (name → "Create my account") shown only to a signed-in person who has no account; individual wording; no invite card for an individual.
- `development-activity.html` — copy from PR #1750 (unchanged by this work).
- Tests: `test/individual_signup_pg` (SQL suite, 22 checks, real concurrency, apply-twice, rollback, 12 prohibited mutations; real-handler round trip, 23 checks),
  `test/development-activity-trial-function.test.mjs` (179), `test/development-activity-reports.test.mjs` (88), `.browser` (343), the existing `trial_report_pg` (95) and `launch_gate_pg` (87) re-run with the new read.
- CI: `.github/workflows/individual-signup-suite.yml`.

## Production state read 2026-10-09 (read-only)
`evaluation_report_limit()` = 10 (already); `brokerage_account.account_type` absent; `individual_signup` / `brokerage_account_type_of` absent;
2 accounts, 2 active members, 2 evaluations, 3 free credits, 1 subscription row. Nothing was written to production.

## To go live (each step needs the founder's go; none has been taken)
1. Merge the PR (draft until then).
2. Apply `docs/individual-agent-signup.sql` through the approved runner (`db-sql.yml`, never a rolled-back dry run, CLAUDE.md §7.11). Read back: the column exists, the 2 existing accounts read `brokerage`, the audit `public.individual_account_check()` has zero violations.
3. Deploy `development-activity-trial` (`deploy-edge-function.yml`). Deploy order is safe either way: `status` degrades if the type cannot be read, and `signup` answers a clean error until the SQL exists.
4. Real signup-to-report check on production with a real confirmed email (a test address), then remove it by the existing privacy path. Until then, "verified" means the disposable-database round trip above, through the real handlers.
5. Payment stays exactly as it is: `manage-billing` reports `not_set_up` until the provider is configured, and the page says "Subscribing is not open yet." This work does not enable checkout.

## Known risks and things deliberately not done
- **One human, many email addresses, many free pools.** Signup needs a confirmed email and is once per user id, but cannot stop a person from using several addresses. The invite-only evaluation could. Watch `evaluation` creation rate with the existing audit; a cap or a rate limit is a product decision.
- **`terms.html` line 29** still says paid accounts "are set up by HomeSignal and managed by the brokerage owner". That is legal text and a consent-adjacent change, so it was not edited. It should be reviewed before launch.
- The landing page's "Start free — 10 reports" buttons remain hidden/inert (founder, 2026-10-02: they stay hidden until launch). The working path today is Join → sign in → signup card.
- Moving an account between types is intentionally impossible by UPDATE (a team in a $79 account, or a quoted brokerage downgraded). If a brokerage needs to be created from an individual, that is a deliberate migration with its own review.
