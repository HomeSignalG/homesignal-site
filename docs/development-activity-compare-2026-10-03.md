# Development Activity — build step 10: Compare (2026-10-03)

The founder's line, unchanged: **"Compare. Two to five addresses side by side, same report rules."**

This is the written record of that step: what was built, who decides what, what the founder may change, and what was and was not proved.
There is **no SQL and no edge function in this step**: it is a page card and one browser module, built on the saved-report calls that
already exist (step 6). Nothing is applied to the database and nothing is deployed to the edge; it ships with the site (Pages).

## 1. What an agent gets

- Under **Saved reports**, a **Compare properties** card. It lists the brokerage's saved reports with a checkbox each.
- The agent ticks **2 to 5** and presses **Compare selected reports**. The page opens exactly those reports (the same `open` call that reopens a
  saved report: the same standing check, the same stored body) and sets them side by side:
  - **What changed:** records with a change HomeSignal detected; records with a recent official event.
  - **By stage:** Permitted / Under Construction, Approved / Coming, Proposed / Under Review.
  - **By type:** each project Type any of the reports carries.
  - **Timeline:** the most recent change HomeSignal detected; the most recent official record.
  - **Coverage and freshness:** the day each report is as of, what "recent" meant for it, and the limits it states in the engine's own words.
- On a saved report, the report's own **Compare property** button (until now "Available soon") ticks that report and moves to the card.
- It **does not use a free report.** Opening saved reports never has.
- To compare a new address, **make its report first** (a report, charged by the one rule, like any other), then come back.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** publisher feeds → ledger → the report engine (`assemble`) → the stored report (`report_snapshot`) → the report
  function's `open` (standing check, stored body) → the report view's own derivation, `HS.daReportView.read()` → the comparison.
- **Decision owners, none duplicated:**
  - *what is in a report, its stage, Type, lifecycle, outcome and limits* — the engine. The view reads them; it decides none.
  - *which records a report lists in each stage and which carry a change* — `HS.daReportView.read()`. That derivation was **factored out of
    `html()`** so the report and the comparison ask the same function; `html()` is now `read()` plus drawing. A number in a comparison is the
    number on the report it came from.
  - *a Type's label, an outcome's words, a report's limits, a record's one-line description, and whether HomeSignal has observed long enough
    to say it saw no change* — `typeCounts`, `outcomeText`, `limitationsOf`, `describe` and `changeReady` in the view, each factored out of
    the section that used to hold it, each still read in exactly one place (the view's structure pins were updated to say so).
  - *who may open which saved report* — the report function and the database's membership check. Compare adds no function and no call
    shape: it calls `open` once per chosen report.
- **Shortcut check:** `by_stage`, `what_changed_recently`, `recent_official_activity`, `homesignal_detected_changes` and `change_ready` are read
  by the engine, by `lib/da-report-view.js` (and, for the unrelated New York pilot, by `lib/fsr-scale.js`). The comparison module reads none of
  them (a pin fails if it does); it reads the view's functions. No second derivation of a count, a Type label or an outcome was added.

## 3. How it works

- `lib/da-report-view.js` gains exports and no behaviour: `read(response)` (the report's lists, once), `typeCounts`, `outcomeText`,
  `limitationsOf`, `outcomeKeyOf`, `describe`, `changeReady`, `CHANGE_NOT_READY`, `TYPE_ORDER` and a small `util`. The report it draws is
  byte-for-byte what it drew before (the view's 158 behaviour checks pass unchanged).
- `lib/da-report-compare.js` (new, pure: no network, no storage, no clock) takes `[{ number, address, label, generated_at, response }]`, 2 to 5,
  and returns the table. `build()` says why it cannot (`count`, `duplicate`, `unreadable`, `radius`, `view`); `html()` draws; `mount()` writes
  it once. It reads exactly four response keys (`radius_mi`, `as_of`, `recent_days`, and the entry's `generated_at`) and everything else through
  the view.
- The page (`development-activity-reports.html`) adds the card, keeps the choice in step with the boxes (2 to 5; a sixth waits), and on
  Compare opens the chosen reports **in the saved list's order** (never the order they were ticked), hands them over, and says what happened.
  It clears the card on sign-out, when another person signs in, and when the choice changes; an answer that arrives after the person has
  gone is dropped.
- **A column never reads as a zero when the report cannot say.**
  - A report whose engine outcome is **"No data ingested"** says so in every count cell (and the engine's own sentence appears under the table).
    Only a report the engine calls **"No development activity"** shows measured zeros.
  - A report with no records and no recognised outcome is **"Not stated"**: the comparison infers nothing the engine did not say.
  - A count of HomeSignal-detected changes of zero, **before** the engine says HomeSignal has observed the records long enough, is **"Not yet
    measured"** with the view's own sentence ("Change history begins once HomeSignal has observed these records at least twice."), never "0".
  - A report from before the Permitted stage existed says "Not in this report's version" for Permitted and for the Type breakdown.
- **It ranks nothing.** Columns are in the order given; no cell is marked, sorted, totalled or averaged; no word of ranking or scoring appears
  except the one fixed sentence that says HomeSignal does none of it ("This sets facts from official records side by side. It is not a score or a
  recommendation, and HomeSignal does not rank properties.").
- **It refuses what cannot be compared** (fewer than 2 or more than 5, the same report twice, a report that cannot be shown, reports made over
  different distances) in plain words, and draws nothing partial. With the report view not loaded it fails closed.
- **The address and the client label** appear as text in one place, the "Reports compared" list, escaped, never in an attribute, an id, a link
  or a column heading (the headings are "Report 3"). On a phone the table stacks, each cell starting with its report number, so nothing
  scrolls sideways.

## 4. Decisions taken by default (the founder may change any of them)

- **D-10-1. Compare works on the agent's saved reports, not on typed addresses.** The founder's line says "two to five addresses". A typed
  address is a report to make, and a report is charged by the one rule; a comparison that made two to five reports at once would be a surprise
  charge, and one that did not would need a second way to assemble a report. So an address is added by making its report first. If you want a
  single "type 3 addresses" form, it can sit on top of this (it would make three reports, each charged and saved as usual), and it is a decision
  about price, not about code.
- **D-10-2. Distance is not compared.** The plan lists distance among the factual items. A saved report does not keep how far each record is from
  the property: that is measured from the property's location, which lives only in the private layer and is never stored with a report. The page
  says so in one sentence. Showing distance would mean measuring it again at comparison time from the private layer (a new read of the property's
  location for every comparison); that is not taken here.
- **D-10-3. Columns are in the saved list's order (newest first).** Neutral and deterministic; the agent's own tick order could read as a
  preference. Nothing is ranked.
- **D-10-4. Reports must share a distance.** Every report is 0.5 mile today, so this never fires; it is there so an older or different report is
  refused rather than compared unlike-for-like (the plan: "the same radius and evidence rules").
- **D-10-5. The comparison is not printed or shared.** "Download PDF" still prints the report on screen; the Compare card is left off the paper
  like every other card. A comparison is not stored: it is rebuilt from the saved reports each time.
- **D-10-6. "Published timelines" is the publisher's latest event.** A report carries each record's latest publisher event (label and date) and
  the newest change HomeSignal detected. It does not carry start and end dates as a timeline, so the Timeline rows are those two facts. The
  "Closing / Move-In Timeline" in the plan is a different section and is not this step.
- **D-10-7. "Counted as official records."** A count is of source records in each report, not of proven separate projects: the same wording the
  report itself uses.

## 5. What it does NOT do (stated, not hidden)

- It does not compare an address that has no saved report, and it makes no report.
- It does not score, rank, recommend, mark a "best" column or total anything.
- It does not compare distances, and it shows no map.
- It does not compare reports from two different brokerages (the saved list is the brokerage's own, and `open` enforces it).
- It does not print, share or store a comparison.
- It does not read the property's location, the private layer, or any coordinate.

## 6. Proof

- `test/da-report-compare.test.mjs` — 73 checks on the engine's real responses (the real request handler, `assemble()`): every number in a
  column equals what that report prints for itself (parsed from the report's own rendered HTML: the stage line, the Type chips, the What
  Changed and Recent Official Activity totals); "No data ingested" is never a zero; "Not yet measured" before the engine's readiness flag; the
  engine's own words under the table; no ranking word anywhere outside the one fixed sentence; columns keep the order given; refusals; the
  address and label once, escaped, in no attribute; no distance; deep-frozen input unchanged; mount.
- `test/da-report-compare-structure.test.mjs` — 50 pins: pure; the closed set of keys it reads; one canonical path (it names none of the
  report's lists and holds no Type, lifecycle, stage or change rule); the address written in one place; the page adds no function and no
  endpoint (the same four functions) and makes comparing one `open` call per report with nothing else in the request; the saved list's order;
  the late answer dropped; the card cleared on sign-out; nothing server-side mentions it.
- `test/da-report-view.test.mjs` (158) and `test/da-report-view-structure.test.mjs` (63) — the view the comparison reads; the three pins that
  said "one place" now name the new single place.
- `test/development-activity-reports.browser.test.mjs` — 36 new checks in Chromium against the real report handler: the card with 0, 1 and 3
  saved reports; two to five; the sixth waits; exactly the chosen reports are opened, with the person's token and only the action and the
  report id; **no report made and no free report used** (the count stays 17); each column's stage counts equal what that report shows when
  opened on its own; "No data ingested" in every count cell; a report that cannot be found, and reports made over different distances,
  refused with nothing drawn; the report's own Compare button; sign-out, another person, and a late answer after sign-out; a 390 px screen
  stacks and does not scroll sideways; a wide screen is a real table.
- `test/da_report_compare_mutants.py` — MUTATION_SUMMARY.

## 7. Shipping it

Pages only. After the merge the `pages` workflow deploys the site; read back from homesignal.net, by md5 and size, that
`development-activity-reports.html`, `lib/da-report-view.js`, `lib/da-report-compare.js`, `development-activity-review.html` and
`shared-report.html` equal `main`. The signed-in path (make three reports, compare them) needs a brokerage member with saved reports; none
exists in production today, so it is **not exercised live** and the record says so.

## 8. Rollback

Revert the merge. Nothing server-side changed, so nothing else needs undoing.

## 9. Still open (carried to step 13)

- The signed-in Compare path is proved against the real handlers in a browser, not against production (no brokerage member and no stored report
  exist there yet).
- A single "type up to five addresses" form (D-10-1) and printing a comparison (D-10-5) are choices, not defects.
- Several older mutation harnesses have stale anchors that predate step 7; none guards step 10.
