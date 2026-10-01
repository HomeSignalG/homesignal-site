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
| `follow` | Registers a `follow` need on the report's private context, so the context is kept (the 90-day clock stops) while the property is being watched. | One write: the existing `report_private_context_need_open`, kind fixed to `follow`. |
| `unfollow` | Closes that need. When it was the last open need, the 90-day clock starts. | One write: the existing `report_private_context_need_close`. |

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
  shared by both functions, and the national report's own function was refactored onto them (its behaviour is unchanged; its
  suites, 117 + 85 + 64 checks, pass). `test/follow-development-report-structure.test.mjs` 1d, 3a–3d and 4j–4k fail if any of
  them is copied back.

## 3. The boundary in time: `created_at`, not `observed_at`

`dev_change_event` carries two instants (`docs/dev-change-ledger.sql`):

- `observed_at` — the **retrieval instant of the source record** (the materialiser's refresh time for it);
- `created_at` — when the **ledger wrote the event** (`default now()`).

The observation job reaches each ZIP up to a day after its records were retrieved. So an event can have an `observed_at`
hours **before** a report was issued and be **written after** it. The report could not have shown it. A rule of
`observed_at > issued_at` would lose that event permanently. What the report could not have known is what the ledger wrote
after the report read it, so **"since" is `created_at`**.

Two consequences, both handled and both tested:

1. **Overlap.** The report reads the ledger a moment before it is issued, and an observation tick is one transaction of up to a
   minute. An event can have a `created_at` slightly before `issued_at` and still not have been visible to the report. The
   boundary therefore reaches back `SINCE_REPORT_OVERLAP_MS` = 10 minutes.
2. **No double reporting.** Anything the report already showed (the same project, instant and event type are in its body) is
   removed from the answer. The overlap cannot repeat a change **because** of that removal; without the removal it would.

Events are also bounded above: nothing with a `created_at` or an `observed_at` after "now" is shown.

## 4. What it says it does not cover

Every answer carries `NEW_PROJECTS_NOT_COVERED`: *a project that appeared near the property after the report is not part of
it.* Finding one needs the subject's point, which is the private context; this reader never touches it. That is a different
feature (a watch that keeps the context alive precisely so the point can be used) and is not claimed here.

An answer also carries `SOURCES_NOT_INCLUDED` when a customer view leaves out projects from uncleared sources, and
`SOURCE_NOT_FULLY_READ` when a source's recent fetches failed, were blocked or truncated.
Withheld events are **counted** (`excluded.not_change_ready`, `excluded.no_rights`), never silently dropped.

## 5. The boundary with the private context (contract §8.5)

The reader has **no handle on the private context.** It is given the report's permanent body (project identities, no address),
the ledger rows and events for those projects, source health and the rights registry — and nothing else. So the answer is the
same while a Follow keeps the context alive and after the context is purged, byte for byte. The handler passes the context's id
only to the two need functions and never puts it in a response. `report_private_context_read` — the one database function that
returns the customer's address — is called nowhere in this feature.

Contract §8.5 said the reader reads "the body and `dev_change_event_reportable` only". That was an approximation; the full list is
the body, the reportable view, `dev_change_project` (for `change_ready`), `dev_change_source_health`, and the rights registry.
The contract is corrected in this change.

## 6. Proof

| layer | where | result |
|---|---|---|
| the reader, pure | `test/changes-since-report.test.mjs` | 52 checks. Reports come from the **real engine**, so the reader is proven against the body the engine really writes. |
| the function (handler + data layer) | `test/follow-development-report.test.mjs` | 76 checks: the gate is byte-identical to the national report's across 7 sign-in scenarios; every field list; every refusal; the exact request each read and the one write would send. |
| structure | `test/follow-development-report-structure.test.mjs` | 72 pins, each absence with a positive control: no handle on the private context, one gate, one rule, one set of reads, a fixed kind on the only two writes, no raw event table anywhere in the edge functions. |
| **end to end on a real Postgres** | `test/changes_since_report_pg` (run in CI by `report-snapshot-suite.yml`) | 38 checks, below. Its first run on a fresh database (CI) found a fault the developer machine hid: the stand-in `service_role` lacked Supabase's BYPASSRLS, so the RLS-protected ledger read as empty; the stand-in now sets it and a pin keeps it. |
| prohibited mutations | `test/follow_report_mutants.py` | 90 of 90 killed by the offline suites (8 of them aim at the three older guards this work had to narrow, and each of those guards is shown to refuse a second consumer on its own). The round trip alone, run against 15 database-facing mutants, catches 13; the two it does not (`no_context_follows_anyway`, `written_since_reads_rights_class`) are caught offline. The national report's own harness: 109 of 109, with one anchor re-pointed because the workflow it edits gained paths. |

### The end-to-end run (gate 4)

On a disposable Postgres, the shipped SQL of record is applied (the ledger, its reportable view, the private layer, the
snapshot). The real engine assembles a report from events read through the real shared reads; the real writer stores it. The real
handler and data layer then run against the database as role `service_role` (a PostgREST translator is the only stand-in for
transport; a request shape it does not know fails the run, and a grant production would refuse is refused here). Events are
written with SQL-relative times and the answer is read:

- **Changes since:** k1's three later changes, newest first — one written 10 minutes after the report, one written 2 minutes
  *before* it that the report could not yet see (the overlap), one **retrieved an hour before the report but written after it**
  (the case `observed_at` would have lost). Not shown: a change written by a baseline run (the reportable view's rule), a
  non-material update, an event the ledger wrote after "now", and the event inside the overlap that the report already showed.
  A project the ledger has seen once is **counted** as withheld, not dropped.
- **Follow keeps the context.** `follow` opens exactly one `follow` need, idempotently. The report's own need is closed (the
  brokerage archives it); the context stays `active` and the 90-day clock has **not** started, because the follow holds it. The
  answer, asked in that state, is **identical byte for byte** to the earlier one.
- **Unfollow starts the clock.** Closing the last need puts `purge_due_at` exactly 90 days out; following again stops it. The
  audit log tells the story with need kinds and no references.
- **Purge changes nothing the reader says.** After a verified-privacy-request purge (address and coordinates gone, in place),
  `changes` returns the **same bytes**; `follow` says `CONTEXT_PURGED` (the database's own refusal, translated), `unfollow` is a
  harmless no-op, the snapshot still resolves, and the other customer's context and report are untouched.
- **Nothing private came out.** Six private values and their address fragments were scanned across every response of the run: no
  hit, no context id, no coordinate. The data layer's whole footprint is the ledger, the view, the snapshot, the allow-list and
  the two need functions; the private table cannot be read by `service_role` directly, and the one function that returns the
  address does work for it, so the absence is a choice the code makes.

## 7. Limits, stated

- It covers the projects **in the report**. New projects near the property are not found (§4).
- A Follow is an **opaque, owner-less** need row. Who follows, notification preferences and billing are Order K; delivering a
  notification when something changes is not built.
- The gate is the admin allow-list until Orders J and K.
- The 10-minute overlap assumes an observation transaction shorter than 10 minutes. The tick is capped at 60 seconds; if that
  cap is ever raised, the overlap must be too (`SINCE_REPORT_OVERLAP_MS`, one definition, pinned at ten minutes).
- The end-to-end run uses a stand-in for **one** relation, `dev_change_source_health`, because the real view reads ingest-side
  failure tables this repo does not own; the real view is proven by the Order D suite.
- It is not deployed and not smoked in production (§9).
- Real customer reports stay unstored: the other gates of the contract §6 are unchanged by this work.

## 8. Defaults taken here that the founder may change

- **D-F1.** The function is internal-only (admin allow-list) until accounts exist.
- **D-F2.** A Follow is a bare need with a random id; the function never learns who is following.
- **D-F3.** The overlap is ten minutes.
- **D-F4.** A purged report cannot be followed again (a purge is terminal in the database); the function reports it rather than
  hiding it.

## 9. Receipt

Not yet deployed. When it is: the dispatch of `deploy-edge-functions.yml` for `follow-development-report` and for the refactored
`get-development-activity-report`, the version numbers, and the production smoke (the anon key refused with 401, the capability
read) are recorded here.
