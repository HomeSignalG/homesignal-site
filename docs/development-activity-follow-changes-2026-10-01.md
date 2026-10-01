# Development Activity — Follow and Changes Since Report (2026-10-01)

Plan item: "Watch This Property". **What this delivers is the internal reader and the need registration behind it** (the Follow /
Changes Since Report function), not the customer-facing feature: no notification is sent, no new project near the property is
found, and no customer can reach it. It is also gate 4 of `docs/report-private-context-contract-2026-09-30.md` §6. This document is the design record, the proof, and the list of
what it does not do. It is a record of work in a pull request, not of a deployment: **nothing here is deployed or
applied until the receipt section (§9) says so.**

## 1. What it is

One internal edge function, `follow-development-report`, with three actions on a **stored** report, addressed by its
`report_id`:

| action | what it does | what it reads or writes |
|---|---|---|
| `changes` | What the change ledger has learned about the projects **in that report** since it was issued. | Reads the report's permanent body, the ledger, source health and the rights registry. Writes nothing. |
| `follow` | Registers a `follow` need on the report's private context, so the context is kept (the 90-day clock stops) while the property is being watched. The **caller names the `follow_id`**: a random (version 4) UUID it keeps; a name-based id (a hash of an address or a user) is refused. The function mints none. | Reads only the context handle (never the body). One write: the existing `report_private_context_need_open`, kind fixed to `follow`. |
| `unfollow` | Asks for that need to be closed, by the same `follow_id`. When it was the last open need, the 90-day clock starts. The answer is `UNFOLLOW_REQUESTED`, not "done": the database function returns nothing, so this function cannot tell whether a need was open (§7). | Reads only the context handle. One write: the existing `report_private_context_need_close`. |

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
  - the ledger SELECTs: `_shared/change-reads.ts`;
  - the source-health read: the view `dev_change_source_fetch_health` (failure counts, the one definition of the 24 h / 14 d
    windows and of which failure kinds count); the wide `dev_change_source_health` is built from it (§6b).
  The one thing this function owns is the boundary in time: which events count as "since" (§3).
- **Shortcut check.** The first draft of this work copied the gate, the PostgREST reads and the change rule into the new
  function. That was a second way to decide each of those facts, so it was undone: the gate, the reads and the rule are now
  shared by both functions, and the national report's own function was refactored onto them. Its two behavioural suites
  (117 + 85 checks) pass — the 85-check one with a single changed line, the name of the health view it expects (§6b); its
  structural suite (64) and its mutation harness (109) were **re-pointed** at the shared files, because they pinned text that
  moved, and all 109 mutants are still killed.
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
   `source_retrieved_before_report`, and the answer carries a `RECORDED_AFTER_REPORT` limitation **only when an entry's source was
   retrieved before the report AND the ledger recorded it after the report was issued** (`created_at > issued`). An event recorded
   inside the overlap, before the report, is not the case the limitation describes and does not raise it. The event is labelled,
   not dropped: dropping it would lose a change the report's own body may not carry in full.

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
feature. The capability read says it in two fields rather than one: `reads_private_values: false` (nothing in this function ever
holds an address, a point or a name) and `uses_private_context_handle: true` (follow and unfollow do pass the context's opaque id
to the two need functions). A single "no private context" flag would have been false.

Contract §8.5 said the reader reads "the body and `dev_change_event_reportable` only". That was an approximation; the full list is
the body, the reportable view, `dev_change_project` (for `change_ready`), `dev_change_source_health`, and the rights registry.
The contract is corrected in this change.

## 6. Proof

| layer | where | result |
|---|---|---|
| the reader, pure | `test/changes-since-report.test.mjs` | 73 checks. Reports come from the **real engine**, so the reader is proven against the body the engine really writes. |
| the function (handler + data layer) | `test/follow-development-report.test.mjs` | 107 checks: the gate is byte-identical to the national report's across 7 sign-in scenarios; every field list; every refusal; ids with hex letters sent in upper case and checked in lower case at every lookup and write; name-based ids refused; the clock read once before the reads; the exact request each read and the one write would send; the failure log carries a reason and nothing from the request. |
| structure | `test/follow-development-report-structure.test.mjs` | 92 pins. Most absences carry a positive control (the same search finds the thing it forbids elsewhere): no handle on the private context, one gate, one rule, one set of reads, a fixed kind on the only two writes, no raw event table anywhere in the edge functions, the overlap tied to the observation job's own timing, the one failure log line, and the workflow's pull-request and push path lists being the same set. |
| the health views, on a real Postgres | `test/dev_change_baseline_pg` (Order D's suite) | 47 checks, 34 of 34 prohibited mutations killed. D15a–g are new: the narrow view returns the same failure counts as the wide one in both directions, the wide view is built from it, the reader's query plan touches no ledger table, and the grants are system-only. |
| **end to end on a real Postgres** | `test/changes_since_report_pg` (run in CI by `report-snapshot-suite.yml`) | 52 checks, below. Its first run on a fresh database (CI) found a fault the developer machine hid: the stand-in `service_role` lacked Supabase's BYPASSRLS, so the RLS-protected ledger read as empty; the stand-in now sets it and a pin keeps it. `run.sh` now prints which setup file failed to apply and why. |
| prohibited mutations | `test/follow_report_mutants.py` | 136 of 136 killed by the offline suites (8 aim at the older guards: two this work had to narrow, the private layer's and the snapshot table's, and a third, the raw event table's, that it must not trip; each is shown to refuse a second consumer on its own). The national report's own harness: 109 of 109. Both harnesses are run by hand, not in CI, so these counts are point-in-time. |

### The end-to-end run (gate 4)

On a disposable Postgres, the shipped SQL of record is applied (the ledger, its reportable view, the private layer, the
snapshot). The real engine assembles a report from events read through the real shared reads; the real writer stores it. The real
handler and data layer then run against the database as role `service_role`. **What is not the shipped thing, stated:**
(1) the transport: a small PostgREST translator turns each request into SQL run as `service_role` (a request shape it does not
know fails the run, and a grant production would refuse is refused here); (2) `test/dev_change_ledger_pg/fixture.sql`, which
creates the roles, the default privileges and the `app_projects` table the ledger SQL expects; (3) `standins.sql`, which gives the
stand-in `service_role` Supabase's BYPASSRLS attribute and defines **one** relation, the ingest-side failure TABLE
`dev_refresh_source_failures` (this repo does not own it). **No view is typed here:** `run.sh` slices the real
`dev_change_source_fetch_health`, its revoke and its grant out of `docs/dev-change-baseline.sql` by pattern (and stops if a
pattern stops matching) and applies them, so the view the reader queries is production's own. Events are written with
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
- **A source that failed to read says so, through the real view.** A real failure row in `dev_refresh_source_failures` for a
  family in the report makes the answer carry `SOURCE_NOT_FULLY_READ`; the same row aged three days (outside the 24-hour window)
  clears it. (3k–3m. This is the path that was timing out in production before §6b.)
- **Unfollow starts the clock.** Closing the last need puts `purge_due_at` exactly 90 days out; following again stops it. The
  audit log tells the story with need kinds and no references. It answers `UNFOLLOW_REQUESTED`.
- **Several follows, replays and a never-opened id (4j1–4j6), pinned as they behave:** two follow ids on one context keep it alive
  until **both** are closed; closing one starts no clock; a replayed `follow` is idempotent; an `unfollow` of an id that was
  never opened changes nothing and gets the same answer as a real one (it cannot tell); and a `follow` replayed **after** its
  `unfollow` opens the need again (the database treats each open as a fresh need; a retried request that arrives late can undo
  an unfollow).
- **Purge changes nothing the reader says.** After a verified-privacy-request purge (address and coordinates gone, in place),
  `changes` returns the **same bytes**; `follow` says `CONTEXT_PURGED` (the database's own refusal, translated), `unfollow` is a
  harmless no-op, the snapshot still resolves, and the other customer's context and report are untouched.
- **Nothing private came out.** Six private values and their address fragments were scanned across every response of the run: no
  hit, no context id, no coordinate. The data layer's whole footprint, as measured from the requests it sent, is the snapshot (read
  two ways: body and identity with no private column; the handle alone with no body), the ledger's projects, its reportable view
  (always with `material=eq.true`), its source health, the allow-list, the user lookup and the two need functions; the private
  table cannot be read by `service_role` directly, and the one function that returns the address does work for it, so the absence
  is a choice the code makes.

## 6b. The source-health read, and the one production change it needed (2026-10-01)

An adversarial review of this pull request claimed the source-health read takes 7–11 seconds. It was checked against production
rather than argued: reading `dev_change_source_health` for a handful of families took **6.1–6.2 s** (a different number from the
reviewer's, and no better in kind). PostgREST runs under the `authenticator` role's 8 s `statement_timeout`, so the read had under
two seconds of headroom, and the cause is structural: the wide view joined its failure counts to an aggregate over the **whole
ledger** (`dev_change_project`, 933,013 rows), and a filter on a column of a full join's `coalesce(...)` cannot be pushed below
that aggregate. The reader needs only the failure counts. So:

- **`public.dev_change_source_fetch_health`** (new) holds the failure evidence on its own: counts of `fetch_failed`, blocked
  and `truncated` rows in the last 24 hours and 14 days, the distinct ZIPs affected, the newest fetch failure and whether the
  source was ever retired. It is a `GROUP BY registry_id` over `dev_refresh_source_failures`, so a filter on `registry_id` reaches
  the table's index. `security_invoker = true`; `service_role` only (revoke all, grant select).
- **`public.dev_change_source_health`** (the wide view, columns and order unchanged) is now built **from** the narrow one:
  ledger coverage full-joined to it. The windows and the failure kinds are therefore defined **once**, not in two views that
  could drift.
- **The reader reads the narrow view** (`_shared/change-reads.ts::health`) and asks it for four columns. A family with no
  failure row is simply absent, which is the same answer as an all-zero row: `sourcesNotFullyRead` fires only on a positive
  count of failures, blocked or truncated fetches in the last 24 hours.

**Applied to production 2026-10-01**, additive (one new view, one `create or replace` of the wide view, both with their grants
restated). Migration `dev_change_source_fetch_health_narrow_view`, ledger version `20261001220554`; the stored statements are the
generated file byte for byte (md5 `54792bddc6af041cb2148abb832699b0`, 7,519 characters, re-read from
`supabase_migrations.schema_migrations` and compared). It was generated **from `docs/dev-change-baseline.sql` by pattern, never
retyped**, and it refuses to commit unless, inside the same transaction: the wide view's output is **row-for-row identical**
before and after (a copy of the old output is taken first, compared in both directions with `EXCEPT`), the wide view's column list
is unchanged, the grants are system-only on both views, both views are still `security_invoker`, and the reader's query plan reaches
the failure table and **not** the ledger. Read back afterwards: both views `security_invoker=true`, `service_role` can select and
`anon` / `authenticated` cannot.
Measured after: the narrow read for three families took **101 ms** when applied and **166 ms** cold on a re-read, its plan touching
only `dev_refresh_source_failures` (a bitmap scan on the registry index); against 6.1–6.2 s for the wide view. The 8 s budget now has
a factor of about fifty of headroom.

**Rollback:** `create or replace` the wide view from the previous text of `docs/dev-change-baseline.sql` (it is the git
history of that file), then drop the narrow view. The wide view must be restored first: it depends on the narrow one.

**What is and is not live.** The view is applied. The deployed `get-development-activity-report` still reads the **wide** view until
it is redeployed with this change; that works, with the headroom described above, and nothing changes for it by the view's arrival.
`follow-development-report` is not deployed yet (§9).

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
  `report_private_context_need_open` — a change to the locked private layer, left to its own SQL change. **It also means the
  contract's "no more than 90 days after the last need ends" is bypassable through a Follow**: a caller that keeps a follow open keeps
  the address indefinitely. That is the intended meaning of "while the property is being watched", but it is only as safe as who
  may follow, which is the admin allow-list today and an account entitlement (Orders J and K) later. A lost `follow_id` cannot be
  listed or closed by this function: there is no "list the follows on this report" and no "close everything for this report".
  Both are for the Order K surface that knows who owns a follow.
- **Replays and ordering.** A `follow` that arrives **after** its own `unfollow` (a retry that was delayed) opens the need again;
  there is no sequence number. An `unfollow` cannot tell whether anything was open, so it answers `UNFOLLOW_REQUESTED`, never
  "unfollowed". Both are pinned in the round trip (4j) so a later change is a deliberate one.
- **The reads are not one snapshot.** The report, the ledger, the events and source health are separate requests; a change recorded
  between two of them can appear in one and not another. The answer's `through` is this function's clock, not a database snapshot.
  It says so (§3).
- **No timeout on the shared REST layer's fetches** other than the platform's own, so a hanging database read holds the request until
  the platform ends it. It is the national report's behaviour, moved unchanged.
- **The rights registry is read at answer time from the deployed JSON bundle.** A withdrawal of a source's clearance therefore takes
  effect when the function is next redeployed, not instantly.
- **"Byte for byte" is conditional.** The answer is the same while a Follow keeps the context and after a purge **for the same body,
  the same ledger state, the same rights, the same clock, the same source health and the same view**. The round trip holds each of
  those fixed.
- **No type-check in CI for these functions.** Deno is not installed in this sandbox and `verify-edge-function` is known not to
  catch type errors (CLAUDE.md §7.1, Phase 2 Unit 4); the functions are covered by Node's type-stripping in the suites, not by `deno
  check`. Extending the verifier is a separate change.
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
- **D-F2.** A Follow is a bare need whose id the **caller** chooses and keeps (required on follow and unfollow, and a random
  version-4 UUID: a name-based id is refused); the function mints none and never learns who is following. A server-minted id returned only in a response is lost with the response and
  leaves an open need nobody can close.
- **D-F3.** The overlap is ten minutes, pinned to at least twice the observation job's longest transaction.
- **D-F4.** A purged report cannot be followed again (a purge is terminal in the database); the function reports it rather than
  hiding it.
- **D-F5.** `unfollow` answers `UNFOLLOW_REQUESTED`, not "unfollowed", because the database's close function returns nothing and
  the function cannot tell whether a need was open.

## 9. Receipt

Not yet deployed. **Applied already:** the narrow health view (§6b), migration `20261001220554`. When the functions are deployed: the
dispatch of `deploy-edge-functions.yml` for `follow-development-report` and for the refactored
`get-development-activity-report` (one function per dispatch), the version numbers, and the production smoke are recorded here.
The smoke also exercises the narrow view in production for the first time from a function. The smoke covers **both**
functions: the anon key refused with 401 and the capability read on each, and one signed-in call to the refactored national
report (it was refactored onto the shared modules, so its own behaviour in production is part of this change).
