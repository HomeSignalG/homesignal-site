# Saved Reports: remove from my list, and restore (2026-10-12)

**Status: built, tested, NOT applied, NOT merged, NOT deployed.** SQL of record: `docs/saved-reports-archive.sql`. Founder approval is required for the production SQL, the merge and the function deploy.

## What an agent gets

- Each row in **Saved reports** still opens the report when clicked and still reads `Report N · address · date`.
- A small **three-dot button** at the right of each row (named "Actions for report N") opens a one-item menu: **Remove from Saved Reports**. Two clicks. No red trash icon, no modal.
- After the server confirms, the row leaves and the card says **"Removed from Saved Reports."** with **Undo**. Nothing is announced before the server answers (the row dims while the request runs).
- **Manage** (next to the heading) shows a checkbox on each row, **Select all shown**, a live "N selected", **Remove selected** and **Cancel**. Remove selected first asks, in the card, naming the exact number ("Remove 5 reports from Saved Reports? You can restore them from View archived. Nothing is refunded, and client links and property watches keep working."). There is no "delete all".
- **View archived** (a secondary link under the list) shows only archived reports, each with **Restore** (the original number and contents come back). The main list and its search never include archived reports.
- Empty states are explicit: nothing saved yet, every report archived (points to View archived), nothing archived.

## Archive versus permanent deletion

| | Remove from Saved Reports (this change) | Deleting account data (a separate workflow) |
|---|---|---|
| What changes | one row per (person, report) saying "this person's list hides this report" | the private layer (address, client label) is purged on its own retention clock; privacy requests are separate |
| The report | unchanged and still stored, byte for byte | the permanent snapshot is intelligence and is never deleted; only the customer-entered private context is |
| Credits, numbering, ledger | **untouched**: nothing refunded, nothing renumbered, the "10 of 10 used" figure does not move | not touched by this feature |
| Share links, property watches | keep working (both are keyed on the report, not on anyone's list) | per their own rules |
| Other agents in the brokerage | **unaffected**: lists are per person | n/a |
| Reversible | yes, from View archived at any time | no |

This feature never touches `report_private_context`, so it does not start, stop or extend the 90-day retention clock (`docs/report-private-context-contract-2026-09-30.md`).

## Audit of `main` (what exists, and what this builds on)

- **Report ownership and list visibility.** One reader decides it: `public.evaluation_reports_of(user)` (`docs/saved-reports.sql`), which goes through `public.brokerage_membership_of` and, since `docs/brokerage-billing.sql`, the one combined ledger view `public.evaluation_credit_all` (free + paid). Every active member of a brokerage sees all of its reports (D-6-2): the ledger holds no user id by design, so "whose report" is not recorded. Standing is an active unexpired evaluation or a complete one; a removed member or revoked/expired evaluation sees nothing.
- **Individual versus brokerage.** An individual agent is a one-member brokerage account (`docs/individual-agent-signup.sql`), so both use the same path with no branching.
- **Report numbering.** The ledger ordinal (`evaluation_credit.ordinal`, `brokerage_paid_credit.number`). Immutable (append-only triggers).
- **Credit consumption.** Only `brokerage_report_issue`, in one transaction with the snapshot: the free 10 (`evaluation_credit`) or the paid 100 a month (`brokerage_paid_credit`). The "10 of 10" figure is `evaluation_usage` over that ledger.
- **Sharing and watches.** `evaluation_report_share_*` and `evaluation_property_watch_*` check access through `evaluation_report_open` (not the list), so a person's list cannot affect them. A test proves a link and a watch on a removed report keep working.

## Design (the smallest thing that works)

```
report_snapshot (the report)  <-  ledger (which brokerage, which number)  <-  evaluation_reports_of (WHO MAY SEE IT)   [unchanged, the one decision owner]
                                                                                   ^
public.saved_report_archive (user_id, report_id, archived_at)  --- filters ---     |
saved_reports_listed(user, archived)       reads evaluation_reports_of, keeps this person's archived or not-archived ones
saved_reports_archive_set(user, ids, archived)   checks every id against evaluation_reports_of, then inserts / deletes this person's rows
```

- **One new table, two functions.** The table has two ids and a time. RLS is on and **no role has a grant**; the functions are `SECURITY DEFINER`, fixed search path, executable by `service_role` alone. Neither function names a ledger, membership, evaluation, snapshot or billing table (a structural test fails if one appears).
- **Edge function.** `get-development-activity-report` gains `archive` and `restore` (`{ action, report_ids }`, 1-100 UUIDs) and an optional `archived: true` on `list`. The user id is the verified sign-in's, never a request field (a request carrying `user_id` is refused). The archive branch never reaches the geocoder, the engine reads, the rate limit, the credit rule or the issue function.
- **Fails closed.** Another brokerage's id, an unknown id and an id of someone who has lost standing are all `NOT_FOUND` (404), the same answer; a set holding any such id changes nothing (all or nothing). A removed member or revoked evaluation is refused at the gate (403) before the archive is asked.
- **Idempotent and race-safe.** Archive is `INSERT ... ON CONFLICT DO NOTHING`; restore deletes the caller's own rows. Repeats and concurrent calls end in the same state without error; the answer says how many rows *this* call changed. Proven with real concurrent sessions.
- **Server-side filtering.** The default list excludes archived reports in the database; the page and its search can never show one.
- **Bounded.** 1-100 ids per call (the 4 KB request limit allows about 100); the page sends a larger Manage selection in turns, one at a time.

## Deployment prerequisites and order

1. **Apply `docs/saved-reports-archive.sql`** to production (`db-sql.yml`). Additive, idempotent, creates no data. It needs `docs/saved-reports.sql` and `docs/brokerage-billing.sql` (both applied). It refuses to apply, creating nothing, if the ownership reader is missing. *Nothing changes for anyone yet.*
2. **Merge** the PR (Pages deploys the page). The page asks for the normal list exactly as it does today (`{ action: "list" }`), so the function that is live now still answers it. Until step 3, Remove would say "That could not be done just now. Nothing was changed."
3. **Dispatch `deploy-edge-functions.yml`** for `get-development-activity-report` (it deploys whatever is on `main`; deploys are manual).

⚠️ **Do not deploy the function before step 1**: the function's list reads through `saved_reports_listed`, which exists only after the SQL is applied; deploying early would turn the *existing* Saved Reports list into a 502.

## Rollback

1. Redeploy the previous `get-development-activity-report` from `main`'s prior commit (the list returns to `evaluation_reports_of`).
2. Revert the page (a normal revert and Pages deploy).
3. Only then run the rollback at the foot of the SQL file (drops the two functions and the table). It removes nothing but archive rows: reports, ledgers, shares and watches are untouched. Tested with archive rows stored, repeatable, and re-applying gives the first apply.

Rolling back leaves every person's list as it was before the feature, with all reports visible again.

## Tests (all run; see the PR for results)

- `test/saved_reports_archive_pg` (disposable Postgres on the real SQL): independence of people, exact sets, all-or-nothing, fail-closed for foreign / unknown / removed / revoked, nothing it must not touch changes (credits, snapshots, usage), shares and watches keep working, grants, **real concurrent sessions**, rollback, refusal without the reader, and 20 prohibited mutations each killed by a named check.
- `test/trial_report_pg` sections 7x and 7y: the same flows through the **real handler, data layer and SQL** (single and bulk, persistence on a fresh request, two people in one brokerage, another brokerage, a removed member, rapid repeats, ledger fingerprints byte-identical).
- `test/saved-reports-archive-function.test.mjs`: the handler and data layer, offline.
- `test/saved-reports-archive.browser.test.mjs`: the page in Chromium (desktop, 390 px and 320 px, touch): two devices, two people, a removed member, an expired session, a failing server, a slow server, keyboard, menu not clipped by the scrolling list, touch targets, no horizontal overflow.
- `test/saved-reports-archive-structure.test.mjs`: the shape (one ownership path, one bound, nothing kept in the browser, the notice only after the server answers, wiring into the other harnesses and the workflow).
- `test/saved_reports_archive_mutants.py`: prohibited mutations of the TypeScript and page layers.

## Competitor review: honest answers

- **Two clicks to remove?** Yes: three-dot, then the item.
- **Recover an accidental removal?** Undo for 12 seconds, and View archived → Restore at any time.
- **Remove ten obsolete reports without ten operations?** Manage → Select all shown → Remove selected → one confirmation.
- **Obvious which reports remain active?** The main list *is* the active list; archived reports are only under View archived, and the empty state says when everything is archived.
- **Could a colleague disrupt another?** No: lists are per person in the database; the request cannot name another user.
- **Credit-refund confusion?** The confirmation says "Nothing is refunded", the heading tooltip is unchanged, and the "N of 10 free reports used" figure does not move (tested).
- **Unnecessary backend complexity?** One table (two ids and a time), two functions, no change to the ledger, snapshots, billing, sharing or watching.
- **Hundreds of paid reports?** Archiving itself is a primary-key insert/delete and the list filter is an indexed `exists`. **Two limits that already existed and are not changed here, and the founder should know about:** (1) the list function fails closed if a brokerage has more than 1,000 reports (`data.length > 1000`); at 100 paid reports a month that is about ten months of use, and archiving keeps the *active* list under the bound; (2) the list looks up each row's address with one private-layer call, so a list of hundreds is hundreds of calls. The page shows six rows and "View all" so the screen stays calm, but the request is the same size. Both deserve their own unit (paginate the list; read addresses in one call).
- **Remaining deliberate limits:** Undo lasts 12 seconds (View archived is the permanent route); a Manage selection over 100 is sent in turns, and if a later turn fails the page says exactly how many were changed and refreshes the list.
