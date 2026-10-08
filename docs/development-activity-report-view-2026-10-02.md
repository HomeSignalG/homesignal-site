# The Development Activity report view — Order I, step 1, then build step 3 (2026-10-02)

> **Updated the same day for build step 3** (`docs/development-activity-build-steps-100526.md`): the view now draws the whole
> layout of the 100526 plan (`docs/development-activity-plan-100526.md`, Visual Layout Contract), on top of build step 2's engine
> (#1569: 0.5 mile, `sections.by_stage`, `render.bearings_deg`, `render.review`). §3, §4, §5 and §6 describe the view as it is now;
> the Order I text they replace is kept where it explains a decision that still holds. **Its one caller is the private review page**
> (`development-activity-review.html`, build step 4): admin-only, noindex, robots-disallowed, linked from nowhere.

Plan: `docs/development-activity-plan-2026-09-30.md`, Order I ("Redesign the customer report only after the data contract is proven",
lines 2404-2424; Customer-Facing Visual Layout Contract, lines 525-780). Rulings: `docs/development-activity-founder-rulings-2026-09-30.md`
(R1 regulatory is an overlay, R2 four lifecycle keys, R3 no "What Exists Today", R4 a HOLD is not cleared, R6 the eyebrow).
Code: `lib/da-report-view.js`. Proof: `test/da-report-view.test.mjs`, `test/da-report-view-structure.test.mjs`,
`test/da-report-view.browser.test.mjs`, `test/da_report_view_mutants.py`, with the shared fixture driver `test/lib/da-report-view-world.mjs`.

## 1. What this is, in one paragraph

A pure presentation module. It takes the national engine's own response (`get-development-activity-report`) and returns escaped
HTML for the customer report, in the approved section order, showing only the sections that have data. It adds **no data**, makes
**no network or storage call**. *(Order I: it had no caller. Since build step 4 one admin-only page loads it; see the note at the top.)* The landing-page sample is not edited.
Today the engine is admin-only and its rights clearance list is empty, so a customer report has zero records; this module exists so
the layout can be proven against the engine's real output **before** any customer path (Orders H, J, L) exists.

## 2. Pre-implementation statement (CLAUDE.md "one canonical truth path")

- **Canonical truth path:** property address → `geocode-address` (the one geocoder) → `public.canonical_zip_registry` (12,722) →
  `public.n5_projects_within_radius` (which projects are near) → `public.app_projects`, by `source_key` → `lib/project-type.js`
  through its generated copy (Type, and the four lifecycle keys) → `public.dev_change_project` + `public.dev_change_event_reportable`
  (what changed) → `supabase/functions/_shared/report-rights.json` (may this source appear) → `_shared/national-report.ts` `assemble()`
  → the function's response `{ report (permanent), render (this response only) }` → **`lib/da-report-view.js` (new, presentation only)**.
- **Decision owner:** for *what* is in the report and *which section* a record is in, `assemble()` in `_shared/national-report.ts`.
  The view decides only *how* it is shown. It makes no decision about a fact: no Type rule, no lifecycle rule, no change rule, no
  rights rule, no geocode, no distance. It reads `lifecycle.key`, `lifecycle.label`, `type.label`, `sections.*`, `by_lifecycle.*`,
  `homesignal_detected_changes`, `publisher_event`, `render.distances_mi` and `coverage.limitations[].text` **as given**.
- **Shortcut check**, run **before** the module was written (2026-10-02, on `origin/main` `5131232`) and **repeated after** it (§8):

  | question | command | before the module |
  |---|---|---|
  | does any page or lib already read the engine's section keys? | `grep -rIl -E "what_changed_recently\|recent_official_activity\|by_lifecycle\|homesignal_detected_changes" --include=*.html --include=*.js .` minus `node_modules`, `supabase/`, `test/` | no file (exit 1) |
  | control: does the same pattern match where it should? | the same grep over `supabase test` | `supabase/functions/_shared/national-report.ts`, `test/national-report.test.mjs` |
  | does any page or lib call the engine? | `grep -rIl -E "get-development-activity-report\|national-report\|follow-development-report" --include=*.html --include=*.js .` minus the same three | no file (exit 1) |
  | which libs use the Type / lifecycle authority? | `grep -ln "canonicalLifecycle\|canonicalProjectType" lib/*.js` | `lib/community-page.js`, `lib/data.js`, `lib/project-type.js` (none is a report view) |
  | how many report engines are in the function tree? | `ls supabase/functions \| grep -i -E "report\|activity"` | `follow-development-report`, `get-address-report`, `get-development-activity-report`, `get-future-surroundings-report` (the last is the legacy NYC engine, R6, not extended here) |

  There is no existing report view to duplicate and no second engine to build one on. The landing page's sample report is a separate,
  static, illustrative layout on a noindex page (§5).
- **Concurrency check (2026-10-02, local refs only):** `main` at `513123284d3c0de805c2cfdd4a5eddb01f7dea71` (#1530). Listing the files
  of `origin/main` for `da-report`, `report-view` or `report_view` finds nothing, and the only `main` commit whose message mentions a report
  view or "Order I" is `513deae` (an unrelated identity-key fix). Five recently pushed `claude/*` branches were compared with `main` by file
  name: three differ from it in nothing, one (`claude/homepage-report-asset`) adds an image and a doc, and one (`claude/vibrant-allen-cykccl`)
  edits navigation across the pages, including `development-activity.html`. None builds a report view.
  **Open pull requests were not searched on GitHub (no network tool was used): UNVERIFIED.** Verdict: **GENUINE GAP.**
  *The audit that scoped this unit said the `Decided` lifecycle fix was not on `main`. It is now: #1526 (`ea0d1db`), and the redeploy receipt #1527.
  `lib/project-type.js` maps `Decided` to `proposed`, so the fixtures below, built by the real engine at this commit, put a decided record in
  Proposed / Under Review.*

## 3. What it renders

In the 100526 plan's order (Visual Layout Contract). A section with nothing to say is left out, except the three stage sections,
which are always drawn when the report has any record, so a reader sees that a stage is empty rather than missing:

| # | section | what the engine supplies | what the view shows |
|---|---|---|---|
| 0 | **header** | the caller's address, label, brokerage and agent strings; `report.radius_mi`, `zip`, `as_of` | the ruled eyebrow (R6), the address as **text** (or "Address unavailable"), an optional client label, "Within 0.5 miles · ZIP 84302 · As of Oct 2, 2026", and on the right the brokerage · agent and "Generated <as_of>" when supplied |
| 0a | **The outcome** (empty report only, founder ruling R5) | `report.activity.outcome` | for `NO_DATA_INGESTED`: "No data ingested" and "HomeSignal cannot yet confirm it receives official development records for this address, so this report cannot say whether there is development nearby. It is not a finding that there is no development." For `NO_DEVELOPMENT_ACTIVITY` (unreachable until the proof exists): "No development activity" and that the records show no development within the radius. Words keyed by the outcome CODE, never its label; shown only when the report has no projects; nothing when the field is absent or unknown |
| 1 | **What Changed Around This Property** | `sections.what_changed_recently`, `homesignal_detected_changes` | the hero, **only** for a record that carries a detected change: counts of official records by the ledger's event type, "Most recent: …", then "On the record within 0.5 miles: N permitted / under construction · N approved / coming · N proposed / under review." |
| 2 | **Recent Official Activity** | `sections.recent_official_activity`, `publisher_event` | the hero when nothing was detected, otherwise the second section; a publisher date is never called a HomeSignal change. When neither has data, a measured zero: "0 New official records in the last 90 days", "Among the official records in this report." Never a claim about the area |
| 3 | **Type and stage** | each staged record's `type.key` and `stage.key` | two chip rows, **Type** (All, then the canonical Type labels from `lib/project-type.js` when it is loaded, in the plan's order) and **Stage** (All, the three stages), with counts. They show and hide cards and map markers only, through the `hidden` attribute; the report itself does not change |
| 4 | **Things to Review With Your Client** | `render.review` (up to 3, nearest first; response-only) | for each: distance · Type · STAGE, the name, the publisher's own stage (or official event), one neutral prompt per stage ("Review: The published construction timing and project details."), the official link, and "It is not a prediction of any effect on the property." |
| 5 | **Development Activity Map** | `render.distances_mi`, `render.bearings_deg` (response-only) | a plain diagram, no street map (no basemap is cleared): the property in the centre, rings at 0.5 and 0.25 mile, each staged record at its distance (to scale) and direction, shaped by stage and numbered like its card. Left out when the response carries no positions (a reopened report) |
| 6 | **Approved / Coming** | `sections.by_stage.approved` | one card per record |
| 7 | **Proposed / Under Review** | `sections.by_stage.proposed` | one card per record; never the word "coming" |
| 8 | **Permitted / Under Construction** | `sections.by_stage.permitted` (the publisher's stage says a permit was issued or construction is under way, step 2) | one card per record |
| 9 | **Change History** | detected changes and publisher events | two labelled lanes per record, **Official record** and **HomeSignal detected**. When empty: "HomeSignal recorded no status change …" only once the ledger is change-ready, otherwise "Change history begins once HomeSignal has observed these records at least twice." |
| 10 | **Official evidence & coverage** | `coverage.limitations[].text`, `recent_days`, `as_of` | the engine's limitation text verbatim, what "recent" means, the plan's scope lines and the standard disclosure |
| 11 | **Report actions** | none yet | Compare property, Watch property, Share report, Download PDF, as inert buttons (`aria-disabled`) with "Available soon" (build steps 8–10). Not "coming soon": the word "coming" is kept for the Approved / Coming stage |

A **stage card** is: title; the stage as **text and a shape** (solid circle approved, dashed hollow circle proposed, solid square permitted);
the Type; the distance and "Map N" when this response carries them; then labelled lines — **HomeSignal lifecycle** (the engine's own label),
**Publisher stage**, **Publisher status**, **Why it is in this section** (only for a permitted record, quoting the engine's stage evidence),
**First detected by HomeSignal** (the ledger's first observation), the official event and the detected change under separate labels; the
official link. A **hero row** (a record the hero names that no stage section carries, such as an operating record with a recent event) keeps
the Order I card, with its lifecycle shape.

**What it never shows** (plan lines 685-696): it does not read `storage_blockers`, `storable`, `rights` / HOLD, `INTERNAL_VIEW`,
`source_family` or any registry id, `change_ready` as a label, `observation_count`, the coverage state, a limitation `code`, `report_id`, or a
hash, and it never PRINTS `project_id` (it reads it only to look records up). The structural suite fails if the module reads a key outside
its closed set of nineteen snake_case keys (2a-2b), and the behaviour suite scans five outputs for 50 internal strings (4b).

## 4. Decisions taken by default (the founder may change any of them)

From the audit (`founder_decisions_needed`); none is invented here:

1. **What "the data contract is proven" means** is not defined in any doc. Default: build the data-independent view now and hold any customer
   exposure until a signed-in production call has succeeded and at least one source family is rights-cleared. This unit exposes nothing.
2. ~~**Things to Review** is not built.~~ **Built in step 3** from the engine's `render.review` (step 2: up to 3 staged records, nearest
   first, a tie going to the stronger stage). The view ranks nothing; the prompt wording per stage is the plan's, made neutral.
3. **Operating and unknown records** appear in What Changed / Recent Official Activity and in Change History, never in a stage section, and
   an unknown one is labelled "Lifecycle unknown" **only when the record carries a recent publisher event or a detected change.** An unknown-lifecycle
   record with neither is included by the engine (`by_lifecycle.unknown`) and is **not shown anywhere in step 1**, with no sentence saying it was left
   out (reproduced through the real handler by the independent review; pinned by behaviour check 3p). **Open decision for the founder:** show it,
   count it, or leave it.
4. ~~**Permitted / Under Construction** is omitted.~~ **Built in step 3** on step 2's rule (`stage-evidence-1`, a closed list of the
   publisher's own stage words).
5. **Which source families to clear** is not an Order I decision; until it is made a customer sees only the limitation text.

Taken while building (the audit left them open; each is a small change to reverse):

6. **A response with no report renders nothing.** `ADDRESS_NOT_RESOLVED` and `OUTSIDE_COVERAGE` give `''` (`renderable()` says so): the caller
   owns those messages and the credit rule (R5, open).
7. **A zero-record report with no limitation says nothing about absence.** The engine judges coverage on records returned (D-G7), so it cannot
   support "no activity", and plan hard rule 66 allows a zero-activity report only with healthy applicable feeds. Wording for that case is a founder call.
8. **Cards follow the engine's order**, which in a stage section is by project id. The view sorts and ranks nothing. The map numbers the
   staged records in that same order (approved, proposed, permitted), and each card shows its number.
9. **Hero counts** use the unit "official records" (a source record is not a proven real-world project, audit B 2.7) and count each record once
   under its newest change. The plain-language labels for the ledger's three event types ("Status changed", "First detected by HomeSignal",
   "Source record updated"; anything else reads "Change detected") and for its 14 fact fields are mine; the vocabulary they label is the ledger's.
10. **Not rendered in step 1**: the publisher's stage, developer, size, investment and the record's own address (the audit's card list omits
    them), and the engine's per-event publisher kind (raw vocabulary).
11. **No address supplied** (a stored report reopened after its private context was purged, contract §5) reads "Address unavailable".
12. **The internal view's response renders like any other**, with no internal label: `INTERNAL_VIEW` and HOLD must never print, so any "internal"
    framing belongs to the caller. A caller must never pass an internal-view response to a customer; the view cannot tell them apart and decides no rights.
13. **Two files not in the audit's list were added**: this document, and `test/lib/da-report-view-world.mjs`, the fixture driver the behaviour and
    browser suites share.

## 5. What this does NOT do

- **Nothing a resident or customer sees changes.** Only the admin-only review page loads the module, the engine stays admin-only with an empty rights list, and the
  landing page's sample report (`development-activity.html`) is not edited. Two copies of the hierarchy now exist (that sample's inline script and
  this module); the shared stage labels are pinned equal (structural 5a-5c), and unifying them is a later, visible change to a deployed page.
- **No entitlement, and the four actions do nothing yet.** The map, Things to Review, Permitted / Under Construction, the filters and the
  brokerage header are built (step 3); the header fills only from what a caller passes (build step 7 fills it from the account).
- **No network, storage, location, clock or private-context call**, and no Type, lifecycle, change, rights or ranking rule (pinned: structural 1-3).
- **Not exercised in production.** The engine's signed-in path has never been called there; the response shape for a real address has only been
  produced offline, by the real handler. What is near a real address was not seen.
- **Cache key (since build step 4).** The review page loads it as `lib/da-report-view.js?v=<content hash>`, and it is in
  `test/lib-cache-keys.test.mjs` `CONTENT_KEYED`, so a changed view always reaches the browser (structural 6c-6d2).

## 6. Proof

All offline; nothing here touches production.

| suite | what | result (final run) |
|---|---|---|
| `test/da-report-view.test.mjs` | the view over the **real handler's** output: the 100526 order, hero and stage summary, stage and lifecycle shapes, the Permitted rule as shown, filters, Things to Review, the map (to scale, north up, numbered like the cards, no basemap, left out without positions), header and action bar, internal strings, coverage, escaping, links, address, engine order, history lanes, non-reports, plan quotes | 148 checks, 0 failed |
| `test/da-report-view-structure.test.mjs` | pure; closed read set; no authority, change, rights or ranking rule; escape and link validators; address read in one place; stage labels equal the landing page's; one caller, the internal review page | 60 checks, 0 failed |
| `test/da-report-view.browser.test.mjs` | Chromium: no overflow at 390 and 1280, sections stacked in the mobile order, one-column cards, stage text and shape visible, tappable links, keyboard focus (links and filter chips), 4.5:1 contrast on every element measured, hostile text runs nothing, no network request; the filters show and hide cards and markers together, combine, restore, work from the keyboard, and still hide on a host page whose CSS sets `display` | 47 checks, 0 failed (headless Chromium) |
| `test/da_report_view_mutants.py` | prohibited mutations, each verified to apply and each killed on exit code by a named check (manual, like the other module loops: CI runs the tests, not the loop) | 144 mutations: 144 killed, 0 survived, 0 harness faults; 127 first killed by the two offline suites and 17 by the browser suite |

**Step 3's first mutation run killed 133 of 144.** The 11 survivors were gaps in the tests, not in the view, and each now has a named
check: a hostile name on a hero row (6c2); no action bar on an empty report (10v2); the stage summary's counts (10w); the filter note (10x);
the map's marker shapes (10y); a record whose own stage contradicts the list it is in (10z); a record named twice in an older response
(10aa); a review list naming an unstaged record (10ab); four distinct lifecycle shapes (10ac); and a host stylesheet that sets `display`
on `article` and `g`, which would otherwise show a filtered-out card (browser 7h). One mutation could never change the output (a direction
defaulted where the distance was also missing) and was replaced by one that can (`map_bearing_defaulted`, killed by 10r).

The behaviour suite builds every response with the real request handler, and test 0b proves the wire report equals `assemble()` called directly on
the same inputs, byte for byte, so the view is tested against the engine's true output and not a hand-made shape. Two defects were found in the proof
itself while building it, and fixed: a check that expects an absence could pass on a view that threw (a throw is now returned as a marker and counted,
test Z, and the mutation that exposed it is killed by 2h), and a Type chip nothing asserted (3c2).

## 7. Rollback

Delete `lib/da-report-view.js`, its three test files and the mutation harness, `test/lib/da-report-view-world.mjs` and this file, and revert the one
status-file line. Nothing else depends on them (structural 6b).

## 8. Shortcut check, repeated after the code (2026-10-02)

| question | result |
|---|---|
| which file outside `supabase/`, `test/` and `node_modules` reads the engine's section keys? | exactly one: `lib/da-report-view.js`, the new view, which is meant to (control: before the module, none) |
| which file outside those three names the engine's function? | the same one, and **only in comments**: the comment-stripped code contains none of `get-development-activity-report`, `national-report`, `follow-development-report`, `geocode`, `n5_projects`, `canonical_zip_registry`, `report-rights`, `dev_change` (control: the same pattern matches a string that has one) |
| which files name the view? | this doc, the status doc, the module, its three suites, the mutation harness and the fixture driver: **no page, no lib, no script, no workflow, no edge function** (structural 6b, 6c, 6e) |
| does the module call or copy the Type / lifecycle authority? | no: 0 matches for `canonicalLifecycle`, `canonicalProjectType`, `classifyProjectType`, `lifecycleKey`, `CATEGORY_REGISTRY`; the three libs that use the authority are the same three as before |
| report engines in the function tree | unchanged: four, none touched |

One canonical path: `assemble()` decides what is in a report and where; the view decides only how it is shown.
