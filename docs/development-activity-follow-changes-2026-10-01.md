# Development Activity — Follow and Changes Since Report (2026-10-01)

Plan item: "Watch This Property" (the Follow / Changes Since Report surface), and gate 4 of
`docs/report-private-context-contract-2026-09-30.md` §6. This document is the design record, the proof, and the list of
what it does not do. It is a record of work in a pull request, not of a deployment: **nothing here is deployed or
applied until the receipt section (§9) says so.**

## 1. What it is

One internal edge function, `follow-development-report`, with three actions on a **stored** report, addressed by its
`report_id`:

| action | what it does | what it reads or writes |
|---|---|---|
| `changes` | What the change ledger has learned about the projects **in that report** since it was issued. | Reads the report's permanent body, the ledger, source health and the rights registry. Writes nothing. |
| `follow` | Registers a `follow` need on the report's private context, so the context is kept (the 90-day clock stops) while the property is being watched. The **caller names the `follow_id`** (a UUID it keeps); the function mints none. | Reads only the context handle (never the body). One write: the existing `report_private_context_need_open`, kind fixed to `follow`. |
| `unfollow` | Closes that need, by the same `follow_id`. When it was the last open need, the 90-day clock starts. | Reads only the context handle. One write: the existing `report_private_context_need_close`. |

It is **not a customer surface**. It is gated by the same gate as the national report (a signed-in user in
`public.dashboard_admins`; the gateway's JWT check stays on, and the anon key is a valid JWT, so the handler adds the
allow-list). Orders J and K replace the allow-list with an account entitlement, in that one place.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path.** Source record → `app_projects` → change ledger (`dev_change_run`, `dev_change_project`,
  `dev_change_event`) → `dev_change_event_reportable` → the report's detected changes (national report) and the changes
  since a report (this function).
- **Decision owners.**
  - what counts as a detected change, and whether a project is change-ready: `national-report.ts`
    (`selectDetectedChanges`, `materialEvents`, `isChangeReady`, `detectedChangeEntries`) — the same functions the report uses;
  - which events may be shown at all: the view `dev_change_event_reportable`;
  - which sources may be shown: `_shared/report-rights.json`, read **now**;
  - whether a source was readable: `national-report.ts` `sourcesNotFullyRead`;
  - who may ask: `_shared/admin-gate.ts` and `_shared/service-rest.ts`;
  - the ledger SELECTs: `_shared/change-reads.ts`.
  The one thing this function owns is the boundary in time: which events count as "since" (§3).
- **Shortcut check.** The first draft of this work copied the gate, the PostgREST reads and the change rule into the new
  function. That was a second way to decide each of those facts, so it was undone: the gate, the reads and the rule are now
  shared by both functions, and the national report's own function was refactored onto them. Its two behavioural suites
  (117 + 85 checks) are **unchanged** and pass; its structural suite (64) and its mutation harness (109) were **re-pointed** at
  the shared files, because they pinned text that moved, and all 109 mutants are still killed.
  `test/follow-development-report-structure.test.mjs` 1d, 3a–3d and 4j–4k fail if any of them is copied back.

## 3. The boundary in time: `created_at`, not `observed_at`

`dev_change_event` carries two instants (`docs/dev-change-ledger.sql`):

- `observed_at` — the **retrieval instant of the source record** (the materialiser's refresh time for it);
- `created_at` — `default now()`, which Postgres evaluates at **transaction start**: an event is stamped with the instant the
  transaction that recorded it began, not the instant of the write or the commit.

The observation job reaches each ZIP up to a day after its records were retrieved. So an event can have an `observed_at`
hours **before** a report was issued and be **recorded after** it. The report could not have shown it. A rule of
`observed_at > issued_at` would lose that event permanently. What the report could not have known is what the ledger recorded
after the report read it, so **"since" is `created_at`**.

Three consequences, all handled and all tested:

1. **Overlap.** The report reads the ledger a moment before it is issued, and an observation tick is one transaction (a soft
   60-second budget checked between ZIPs, a hard 120-second statement timeout). An event can have a `created_at` slightly before
   `issued_at` and still not have been visible to the report. The boundary therefore reaches back
   `SINCE_REPORT_OVERLAP_MS` = 10 minutes. A structural pin reads the observation job's `_max_secs` and the 120-second
   statement timeout from the SQL of record and fails if the overlap is ever less than twice the longer one.
2. **No double reporting.** Anything the report already showed (the same project, instant and event type are in its body) is
   removed from the answer. The overlap cannot repeat a change **because** of that removal; without the removal it would.
3. **An answer can look as if it contradicts the report, and it says why.** The report reads a project's current state when it
   is issued; an event can be recorded after that from a source record retrieved *before* it, so the event's new facts may be
   exactly what the report already states (the report says Approved; the ledger says Proposed → Approved). Each entry therefore
   carries `recorded_at` (the ledger's `created_at`) beside `detected_at` (the source retrieval instant) and
   `source_retrieved_before_report`, and the answer carries a `RECORDED_AFTER_REPORT` limitation whenever one is present. The
   event is labelled, not dropped: dropping it would lose a change the report's own body may not carry in full.

Events are also bounded above: nothing with a `created_at` or an `observed_at` after the instant the question was asked is
shown. That instant is taken **once, before the reads**, and is both the bound and the answer's `through`. It is this
function's clock, not the database's snapshot: an event whose transaction started before `through` but committed after the
read is not in this answer and is in the next.

One assumption is **not enforced**: that the report's ledger read and its store were less than (overlap − longest tick) apart.
The body records `as_of` (a day), not the instant of the ledger read, so the reader cannot check it. Stamping the read instant
into the body is a report-engine change (Order I); until then it is a stated limit (§7).

## 4. What it says it does not cover

Every answer carries `NEW_PROJECTS_NOT_COVERED`: *a project that appeared near the property after the report is not part of
it.* Finding one needs the subject's point, which is the private context; this reader never touches it. That is a different
feature (a watch that keeps the context alive precisely so the point can be used) and is not claimed here.

An answer also carries `SOURCES_NOT_INCLUDED` when a customer view leaves out projects from uncleared sources,
`SOURCE_NOT_FULLY_READ` when a source's recent fetches failed, were blocked or truncated, and `RECORDED_AFTER_REPORT` when an
event was recorded after the report from a source record retrieved before it (§3).
**Projects** withheld are counted (`excluded.not_change_ready`, `excluded.no_rights`), never silently dropped. An event whose time
cannot be read, and a stored report whose detected changes cannot be read, are **refused** (502 / 422), not skipped.

## 5. The boundary with the private context (contract §8.5)

The reader has **no handle on the private context.** It is given the report's permanent body (project identities, no address),
the ledger rows and events for those projects, source health and the rights registry — and nothing else. So, with the same clock
and the same ledger state, the answer is the same while a Follow keeps the context alive and after the context is purged, byte
for byte (the round trip holds the clock fixed and the ledger unchanged between the three asks).

The separation is **structural, not only behavioural.** The data layer reads `report_snapshot` in two separate selects: the
`changes` read names the body and identity columns and **no private column**; the follow / unfollow read names only the context
handle and **no body**. The handler's `changes` branch therefore never holds the handle, and follow never downloads a report to
learn one id. The handler passes the handle only to the two need functions and never puts it in a response.
`report_private_context_read` — the one database function that returns the customer's address — is called nowhere in this
feature.

Contract §8.5 said the reader reads "the body and `dev_change_event_reportable` only". That was an approximation; the full list is
the body, the reportable view, `dev_change_project` (for `change_ready`), `dev_change_source_health`, and the rights registry.
The contract is corrected in this change.

## 6. Proof

| layer | where | result |
|---|---|---|
| the reader, pure | `test/changes-since-report.test.mjs` | 69 checks. Reports come from the **real engine**, so the reader is proven against the body the engine really writes. |
| the function (handler + data layer) | `test/follow-development-report.test.mjs` | 92 checks: the gate is byte-identical to the national report's across 7 sign-in scenarios; every field list; every refusal; ids with hex letters sent in upper case and checked in lower case at every lookup and write; the clock read once before the reads; the exact request each read and the one write would send. |
| structure | `test/follow-development-report-structure.test.mjs` | 84 pins. Most absences carry a positive control (the same search finds the thing it forbids elsewhere): no handle on the private context, one gate, one rule, one set of reads, a fixed kind on the only two writes, no raw event table anywhere in the edge functions, and the overlap tied to the observation job's own timing. |
| **end to end on a real Postgres** | `test/changes_since_report_pg` (run in CI by `report-snapshot-suite.yml`) | 43 checks, below. Its first run on a fresh database (CI) found a fault the developer machine hid: the stand-in `service_role` lacked Supabase's BYPASSRLS, so the RLS-protected ledger read as empty; the stand-in now sets it and a pin keeps it. `run.sh` now prints which setup file failed to apply and why. |
| prohibited mutations | `test/follow_report_mutants.py` | 120 of 120 killed by the offline suites (8 aim at the older guards: two this work had to narrow, the private layer's and the snapshot table's, and a third, the raw event table's, that it must not trip; each is shown to refuse a second consumer on its own). The national report's own harness: 109 of 109. |

### The end-to-end run (gate 4)

On a disposable Postgres, the shipped SQL of record is applied (the ledger, its reportable view, the private layer, the
snapshot). The real engine assembles a report from events read through the real shared reads; the real writer stores it. The real
handler and data layer then run against the database as role `service_role`. **What is not the shipped thing, stated:**
(1) the transport: a small PostgREST translator turns each request into SQL run as `service_role` (a request shape it does not
know fails the run, and a grant production would refuse is refused here); (2) `test/dev_change_ledger_pg/fixture.sql`, which
creates the roles, the default privileges and the `app_projects` table the ledger SQL expects; (3) `standins.sql`, which gives the
stand-in `service_role` Supabase's BYPASSRLS attribute and defines **one** relation, `dev_change_source_health` (it reads
ingest-side failure tables this repo does not own; the real view is proven by the Order D suite). Events are written with
SQL-relative times and the answer is read:

- **Changes since:** k1's four later changes, newest source retrieval first — one retrieved 10 minutes after the report (recorded
  20 minutes after it), one retrieved 2 minutes *before* it and recorded 3 minutes before it, which the report could not yet see
  (the overlap), one retrieved 30 minutes before and recorded 40 minutes after whose new fact (Approved) is what the report's own
  card already says, and one **retrieved an hour before the report but recorded 30 minutes after it** (the case `observed_at`
  would have lost). Each says when the database recorded it and whether its source predates the report, and the answer carries
  the `RECORDED_AFTER_REPORT` limitation. Not shown: a change recorded by a baseline run (the reportable view's rule), a
  non-material update, an event recorded after "now", and the event inside the overlap that the report already showed.
  A project the ledger has seen once is **counted** as withheld, not dropped.
- **Follow keeps the context.** `follow` (sent with the caller's id in upper case) opens exactly one `follow` need whose
  reference is the lower-case id, idempotently; a `follow` with no id is refused. The report's own need is closed (the
  brokerage archives it); the context stays `active` and the 90-day clock has **not** started, because the follow holds it. The
  answer, asked in that state, is **identical byte for byte** to the earlier one.
- **Unfollow starts the clock.** Closing the last need puts `purge_due_at` exactly 90 days out; following again stops it. The
  audit log tells the story with need kinds and no references.
- **Purge changes nothing the reader says.** After a verified-privacy-request purge (address and coordinates gone, in place),
  `changes` returns the **same bytes**; `follow` says `CONTEXT_PURGED` (the database's own refusal, translated), `unfollow` is a
  harmless no-op, the snapshot still resolves, and the other customer's context and report are untouched.
- **Nothing private came out.** Six private values and their address fragments were scanned across every response of the run: no
  hit, no context id, no coordinate. The data layer's whole footprint, as measured from the requests it sent, is the snapshot (read
  two ways: body and identity with no private column; the handle alone with no body), the ledger's projects, its reportable view
  (always with `material=eq.true`), its source health, the allow-list, the user lookup and the two need functions; the private
  table cannot be read by `service_role` directly, and the one function that returns the address does work for it, so the absence
  is a choice the code makes.

## 7. Limits, stated

- It covers the projects **in the report**. New projects near the property are not found (§4).
- A Follow is an **opaque, owner-less** need row. Who follows, notification preferences and billing are Order K; delivering a
  notification when something changes is not built.
- The gate is the admin allow-list until Orders J and K.
- **The overlap rests on an unenforced assumption** (§3): the report's ledger read and its store were less than
  (10 minutes − the longest observation transaction) apart. The longest transaction is pinned against the SQL of record; the
  read-to-store gap is not recorded in the body, so it cannot be checked. The report engine should stamp the ledger read instant
  into the body (Order I); anchoring the lower bound to that instant would replace the assumption with a fact.
- **A very busy, very long-held Follow can answer 502.** The ledger read is chunked 25 projects at a time and a page that reaches
  PostgREST's 1,000-row cap is refused by design (a cut-short page is never an answer). Only material events are asked for, which
  removes the high-volume refreshes, but a long enough hold on busy projects can still reach the cap. Keyset paging is the follow-up
  if it ever happens; it fails closed in the meantime.
- **A follow id is the caller's, and there is no cap on how many one context may hold.** An allow-listed admin (or a stolen admin
  token) could open many needs on one context, hold it open past its 90 days until each is closed, and grow the append-only need
  and audit tables. The function mints no id, so a lost response cannot orphan a need, but a cap per context belongs in
  `report_private_context_need_open` — a change to the locked private layer, left to its own SQL change.
- **`report_private_context_need_open` does not check `purge_due_at`.** A follow on a context whose 90-day clock has run out but
  which the purge cron has not yet purged (normally under 15 minutes; unbounded if the cron fails) clears the clock and keeps
  the customer's address. This predates the Follow function and is reachable by it. The fix (treat a due context as expired:
  raise the same 55000, or purge it) is a change to the locked private layer, left to its own SQL change with a suite case that
  ages a context past its clock and then opens a need on it.
- **The request body is read whole before its size is checked when the request has no `Content-Length`** (chunked). That is the
  shared gate's behaviour, moved unchanged from the national report's function; it runs after the admin check, and the platform
  caps request sizes. Streaming the bound belongs in `_shared/admin-gate.ts`, for both functions at once.
- The stored report's `report_version` is not checked by the reader; a body of another shape is refused by its `product` and
  project-list checks, and a version that kept those shapes but changed what a detected change means would not be noticed.
- It is not deployed and not smoked in production (§9).
- Real customer reports stay unstored: the other gates of the contract §6 are unchanged by this work.

## 8. Defaults taken here that the founder may change

- **D-F1.** The function is internal-only (admin allow-list) until accounts exist.
- **D-F2.** A Follow is a bare need whose id the **caller** chooses and keeps (required on follow and unfollow); the function
  mints none and never learns who is following. A server-minted id returned only in a response is lost with the response and
  leaves an open need nobody can close.
- **D-F3.** The overlap is ten minutes, pinned to at least twice the observation job's longest transaction.
- **D-F4.** A purged report cannot be followed again (a purge is terminal in the database); the function reports it rather than
  hiding it.

## 9. Receipt

Not yet deployed. When it is: the dispatch of `deploy-edge-functions.yml` for `follow-development-report` and for the refactored
`get-development-activity-report`, the version numbers, and the production smoke are recorded here. The smoke covers **both**
functions: the anon key refused with 401 and the capability read on each, and one signed-in call to the refactored national
report (it was refactored onto the shared modules, so its own behaviour in production is part of this change).
