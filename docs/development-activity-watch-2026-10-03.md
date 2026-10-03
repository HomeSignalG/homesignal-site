# Development Activity — build step 9: Watch (2026-10-03)

The founder's line, unchanged: **"Watch. Daily check of the property; email to the agent when a nearby project's official status changes."**

This is the written record of that step: what was built, who decides what, what the founder may change, and what was and was not proved.
The SQL of record is `docs/property-watch.sql` (the watches) and `docs/property-watch-schedule.sql` (the daily wake and its alarm). The
engine document (`docs/development-activity-report-engine-2026-09-30.md`, "Step 9") carries the same summary beside steps 5 to 8.

## 1. What an agent gets

- On a saved report (step 6), a **Watch** action. The agent asks HomeSignal to keep watching that report's property.
- **Once a day**, on the watch's own fixed slot, HomeSignal checks what is near the property.
- **When a nearby project's official status has changed since the report, the agent gets one email** listing those projects: each one's
  name and kind, the change in the publisher's own words (from, to), the date HomeSignal detected it, and the official source's link. The
  email says which report it is about (its number and date) and where to open it. It says nothing else about the property.
- The agent can see their own watches, when each was last checked and how, and stop any of them.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** publisher feeds → development change ledger (`dev_change_event`, read only through
  `dev_change_event_reportable`) → the report engine's own rule (`selectDetectedChanges`) → the Watch's check → one email.
  Who the agent is and whether their brokerage may use a stored report: `brokerage_membership_of` and `evaluation_report_open`, the same
  functions that let a member reopen or share a saved report. Where the property is: the private layer (`report_private_context`).
- **Decision owners, none duplicated:**
  - *what counts as a change* — `selectDetectedChanges` in `_shared/national-report.ts`, reached through
    `changesForProjects` in `_shared/changes-since-report.ts`. That function was **factored out of `changesSinceReport`** so both ask the
    same code; there is still exactly one call to `selectDetectedChanges`.
  - *which projects are near the property* — `_shared/report-run.ts` (`readReportInputs`) and `assemble`. This is the report's own assembly,
    extracted from the report function into a shared module. The report function and the Watch both call it; neither has a copy.
  - *whether the property is still kept* — the private layer's `need_open` / `need_close` and its own purge. A watch registers a `follow`
    need whose ref is the watch id.
  - *when a watch is checked* — `property_watch_period()` (1 day), written once, kept by the database.
- **Shortcut check:** the Watch has no list of projects, no copy of the change rule, no copy of the membership rule and no copy of the
  keep-the-address rule. `test/property-watch-structure.test.mjs` pins each of those absences.

## 3. How it works

### 3.1 The database (`docs/property-watch.sql`)
Two tables, `property_watch` (one row per agent and stored report: when due, how the last check went) and `property_watch_seen` (what the
agent has been told). Sixteen functions, three triggers. Nothing is readable or executable by `anon` or `authenticated`. It holds **no
address, label, client, coordinate or email address**.

1. A watch belongs to one agent: `(user, report)` is unique, start is idempotent, two members of a brokerage can each watch a report and
   neither can see or stop the other's.
2. Only a member of the brokerage that owns a stored report, with the standing that opens it, can start a watch. A report that is not the
   caller's, an unknown id and a never-stored report all give one answer: not found.
3. At most **25 watches per brokerage** (a bound on what a signed-in caller can write, not a product promise), counted under a lock so two
   callers cannot both take the last place.
4. A watch needs the property to be kept. A report with no private context, or one already purged, is refused and stores nothing. The watch
   and its `follow` need are written in one transaction.
5. **Every removal of a watch closes its `follow` need** — stop, end, a deleted user, a manual delete — because it is an AFTER DELETE
   trigger on the table, not a step each caller remembers. `TRUNCATE` is refused. When the last need closes, the private layer starts its
   own 90-day clock, so a watch never keeps an address longer than the time it is watched.
6. Stopping needs ownership only. A trial that has ended can never leave a watch that cannot be taken back.
7. **Daily, on a fixed slot.** After a check the next one is the first slot `first_due + k × 1 day` after now. A late run does not move the
   slot; a job that was down for three days checks once and moves on. No catch-up burst.
8. **A failed check backs off** (1 hour × consecutive failures, at most 24 hours) on a separate `retry_after`; it never moves the daily slot.
9. **A claim is a 10-minute lease**, taken with `for update skip locked`, oldest first. Two runs cannot take the same watch.
10. **`property_watch_seen` is exactly what an email told the agent.** A row exists only through a notified record. It holds a project id
    (a public record), an event type and the ledger's own instant. Rows older than 100 days (longer than the report's 90-day window) are
    deleted as part of recording a run.

### 3.2 The edge (`manage-property-watch`, `run-property-watch`)
- `manage-property-watch` (signed-in; JWT verification stays on): `start { report_id }`, `list`, `stop { watch_id }`. Any signed-in person is
  let in and the database answers only for that person's own brokerage. Fixed answers: `not_found` 404, `watch_limit_reached` 409,
  `property_not_kept` 409, `data_unavailable` 502, `internal` 500. It returns the address of the agent's own report (the saved-report
  window) while the private layer keeps it; never the label, a coordinate, a context id or another agent's watch.
- `run-property-watch` (system only): `POST { limit?, dry_run? }` with the project's private secret in `x-signup-secret`, compared by digest
  XOR; with no secret configured **every** request is refused (503). The gateway's JWT check stays on in front of it and is not the gate.
  `dry_run` proves the secret, the wiring and the configuration, counts what is due, and leases, checks and sends nothing.

### 3.3 One check (`processWatch`)
1. **Standing.** `evaluation_report_open` — the same check that lets a member reopen the report. Lost → the watch ends (`STANDING_LOST`).
   A trial that ends, a revoked account or a member who leaves is therefore stopped by the one rule.
2. **The point.** `pointOf` in `_shared/private-subject.ts`, a third window onto the one reader of the private layer. It returns the point and
   nothing else; it is never written, logged, sent or returned. Purged → the watch ends (`PROPERTY_NOT_KEPT`).
3. **Nearby.** The report's own reads and `assemble` give what a new report for the point would show a customer. The stored report's own
   radius is used (`REPORT_RADIUS_MI` if none is stored); a malformed rights registry fails the check, never "everything is cleared".
4. **Changes.** `checkWatch` asks `changesForProjects` for what the ledger recorded after the stored report, and removes what the agent
   was already told. The baseline is **the stored report**, so nothing falls between the report and the watch: the first check reports
   everything the ledger recorded after the report was made.
5. **Email.** Nothing new → record the check and stop. Something new → read the agent's email address from the auth service (never stored),
   send **one** email through Resend, and **only after the provider accepts it** record exactly what the email listed. The idempotency key is
   `watch-<sha256(watch_id + the sorted list told)>`, so a retry of a run that died between sending and recording does not send twice.
6. **Failure.** Any failure is recorded against the watch with a class (`READ_FAILED`, `EMAIL_FAILED`, `NO_RECIPIENT`); the log line carries
   a class and a fixed-string reason and nothing from the report, the point or the agent.

An email lists at most 10 projects and 5 entries each. **What does not fit is not marked as told**, so it rolls into the next email: the cap
cannot lose a change.

### 3.4 The schedule and its alarm (`docs/property-watch-schedule.sql`)
- `public.property_watch_run_scheduled()` makes one request: a POST to `run-property-watch` claiming 5 watches, with the project's public
  key at the gateway and the vault secret `signup_hook_secret` (the secret `notify-health` already takes) in the header.
- pg_cron job `property-watch-run` at minutes 3, 13, 23, 33, 43, 53. **That is not the founder's cadence**: each watch is checked once a day
  on its own slot and the database refuses to hand it out earlier. The job only wakes often enough that a watch is checked soon after its
  slot and a crashed run's lease is retried soon. An idle wake claims nothing. Capacity is 720 checks a day.
- A check `property_watch_run` spliced into the ONE existing alert path (`pipeline_health_tick` → `notify-health`). It is alertable and fails
  when the job is missing, inactive or wrong; when the last three runs failed to start; when a watch was due more than 6 hours ago and nothing
  is holding it; when a watch has failed its last three checks (reported by outcome name); or when a watch invariant breaks. A job that runs
  but fails (function not deployed, wrong secret, mail key missing) is caught the same as one that does not run.

### 3.5 The agent's page (`development-activity-reports.html`)
- A saved report (one with a permanent id) shows a **"Watch this property"** card beside the share card; a report that was not saved (a "No data
  ingested" report uses nothing and is stored nowhere) gets no card. The report's own **Watch property** button (live since this step, because the page now
  asks the shared report view to make it live) takes the agent to the card.
- The card says in plain words: once a day; the email goes to the address you signed in with; the email does not include the property's
  address. It starts, shows and stops the one watch for the report on screen (`manage-property-watch`: `list`, `start`, `stop`) and tells the
  agent how the last check went, in fixed words for each of the six outcomes the database can record. It never shows or sends the address or
  the client label; the browser keeps nothing about a watch.
- Another report, another person and signing out never inherit a watch (the card is cleared and an answer for a different report or person
  that arrives late is ignored). A list that cannot be read is said so, claims nothing about whether the agent is watching, and still offers
  to start (starting twice does nothing twice).
- **Plain-words refusals:** a brokerage at its limit ("already watching the most properties it can"), a property whose address HomeSignal no
  longer keeps ("make a new report for it"), an unreachable service ("try again in a minute").

## 4. Decisions taken by default (the founder may change any of them)

- **D-9-1. Cadence is once a day per watch, on a fixed slot.** The check time is the time the watch was started, each day. The founder said
  "daily"; a time of day was not specified. (Rule #0: the daily value is the founder's and is encoded once, in `property_watch_period()`.)
- **D-9-2. 25 watches per brokerage at once.** A bound, not a price. Raise it by changing `property_watch_limit()` in one place.
- **D-9-3. "Changes" means what Changes Since Report means,** counted from the stored report. The first email can therefore list everything
  recorded since the report was made, up to the caps above.
- **D-9-4. The email omits the address and the client label.** An email goes to an outside provider. The agent opens the report in
  HomeSignal to see which property it is (the email gives the report's number and date). Putting the address in the email is a decision
  about what an outside service may see and is not taken here.
- **D-9-5. A watch ends, and says so in its record, when the agent loses standing or the property is no longer kept.** The agent is not
  emailed about the ending. (An ending email is a product decision.)
- **D-9-6. A watch is the agent's own,** not the brokerage's. A colleague can neither see nor stop it.
- **D-9-7. Failures are retried within the day, then reported by the alarm,** not emailed to the agent.
- **D-9-8. The recipient is the agent's sign-in email,** read from the auth service at send time and stored nowhere.

## 5. What it does NOT do (stated, not hidden)

- It does not email about a change that is not an official status change (the report's rule decides, not this step).
- It does not watch an address that was not first made into a stored report.
- It does not notify the agent when a watch ends, when it fails, or when the property's address is purged.
- A watch is not a permanent record: it is deleted when stopped or ended. Its `follow` need (append-only, random ref, no private value) is
  the only trace the private layer keeps, exactly as for the admin Follow function.
- It does not rate-limit `run-property-watch` beyond its secret and its per-call limit.

## 6. Proof

- `test/property_watch_pg` — 64 checks against a disposable Postgres on the real layers beneath it, and 66 prohibited mutations of the
  SQL, **all killed** (a crash in the suite counts as not killed; set-membership aggregates are NULL-safe and count-bound).
- `test/property_watch_schedule_pg` — 44 checks (29 on the wrapper, the health read and the monitor splice; 15 on applying twice, the
  rollback and the refusals) and 38 prohibited mutations, **all killed**.
- `test/property-watch-changes.test.mjs` (41), `test/property-watch-functions.test.mjs` (128), `test/property-watch-email.test.mjs` (35):
  the diff and the exactly-once rule, both handlers and data layers over a stand-in database, the email with a unique marker for the
  address, label, coordinate, distance and agent all proved absent.
- `test/property-watch-structure.test.mjs` — the shape of the SQL and edge, the JWT posture, the wiring, the absence of every second
  decision path.
- Closed-allow-list pins amended by hand, each with a reason: `report-private-context-structure` (5c5 the third window, 5c6 the Watch SQL's
  use of the layer), `report-share-delivery-structure` (2i the four users of the one reader, 2i2 which window each takes),
  `brokerage-account-structure`, `evaluation-entitlement-structure`, `report-snapshot-structure`.
- `test/development-activity-reports.browser.test.mjs` section 10 (26 checks in Chromium, against the REAL `manage-property-watch` handler):
  when the card is offered, the exact requests, each outcome's words, every refusal, print, a second report, signing out, a 390 px screen.
- `test/property_watch_mutants.py`: prohibited mutations of the edge, the private layer's point window, the wiring and the page, each of which
  must make one of the suites above fail. See the run recorded in the engine document.
- CI: `report-snapshot-suite.yml` runs both database harnesses and covers the Watch's SQL and functions in both path lists.

## 7. Applying it (in this order; each step is read back)

1. Apply `docs/property-watch.sql` (additive, idempotent; fails closed if the layers beneath it are missing).
2. Deploy `manage-property-watch` and `run-property-watch` (`deploy-edge-functions.yml`; JWT verification stays on for both).
3. Dry-run `run-property-watch` with the vault secret: expect `{status: OK, dry_run: true, email_configured: true}`.
4. Apply `docs/property-watch-schedule.sql`. **This arms the cron.** It refuses unless the watch layer and the vault secret exist.
5. Read back: the cron job, the `property_watch_run` check row, the function grants.

## 8. Rollback

Each file ends with a rollback. The schedule's removes the job, drops its two functions and restores the monitor byte for byte, leaving
every watch alone. The watch layer's **deletes every watch first** (the delete trigger closes each `follow` need, so the private layer's
clocks start), then drops the two tables and the sixteen functions. Dropping the table alone would leave the needs open, which is why the
delete comes first. Roll the schedule back before the watch layer.

## 9. Still open (carried to step 13)

- The signed-in paths (start, list, stop and a real email) are not exercised against production by this step's tests alone; step 9d's live
  read-back says exactly what was and was not exercised.
- `run-property-watch` has no rate limit of its own.
- An ending or a failing watch is visible to the operator (the alarm) and to the agent's list (last outcome) but is not emailed.
- PostgREST's mapping of the database's refusals to HTTP errors is unchecked against production.
