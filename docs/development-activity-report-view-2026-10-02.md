# The Development Activity report view — Order I, step 1 (2026-10-02)

Plan: `docs/development-activity-plan-2026-09-30.md`, Order I ("Redesign the customer report only after the data contract is proven",
lines 2404-2424; Customer-Facing Visual Layout Contract, lines 525-780). Rulings: `docs/development-activity-founder-rulings-2026-09-30.md`
(R1 regulatory is an overlay, R2 four lifecycle keys, R3 no "What Exists Today", R4 a HOLD is not cleared, R6 the eyebrow).
Code: `lib/da-report-view.js`. Proof: `test/da-report-view.test.mjs`, `test/da-report-view-structure.test.mjs`,
`test/da-report-view.browser.test.mjs`, `test/da_report_view_mutants.py`, with the shared fixture driver `test/lib/da-report-view-world.mjs`.

## 1. What this is, in one paragraph

A pure presentation module. It takes the national engine's own response (`get-development-activity-report`) and returns escaped
HTML for the customer report, in the approved section order, showing only the sections that have data. It adds **no data**, makes
**no network or storage call**, and has **no caller**: no page loads it, nothing links to it, the landing-page sample is not edited.
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

In this order, and **only the sections that have data** (plan lines 2410-2418; the mobile order in lines 713-735 is the same for the sections built):

| # | section | what the engine supplies | what the view shows |
|---|---|---|---|
| 0 | property / address | the caller's display string; `report.radius_mi`, `zip`, `as_of` | the ruled eyebrow (R6), the address as **text** (or "Address unavailable"), "Within 1 mile · ZIP 97477 · As of Sep 29, 2026" |
| 1 | **What Changed Recently** | `sections.what_changed_recently`, and `homesignal_detected_changes` on the project | the hero, **only** for a project that carries a detected change: counts of **official records** by the ledger's own event type (each record once, by its newest change), "Most recent: <Type> — <name> · <distance> · <change, detected date> · Official record: <publisher event>" |
| 2 | **Recent Official Activity** | `sections.recent_official_activity`, `publisher_event` | the hero when there is no detected change, otherwise the second section: counts by the publisher's own event label, "Most recent". A publisher date is never called a HomeSignal change |
| – | Things to Review With Your Client | nothing: no rules exist | **not built** |
| – | Development Activity Map | no plot coordinate is emitted | **not built** |
| 5 | **Approved / Coming** | `by_lifecycle.approved` | one card per record |
| 6 | **Proposed / Under Review** | `by_lifecycle.proposed` (a decided application is proposed) | one card per record; never the word "coming" |
| – | Permitted / Under Construction | no lifecycle key, no source rule (R2) | **not built** |
| 8 | **Change History** | detected-change entries and the publisher event | per record, two labelled lanes, **Official record** and **HomeSignal detected** (from → to, in plain field names); hidden when there is neither |
| 9 | **Official evidence & coverage** | `coverage.limitations[].text`, `recent_days`, `as_of` | the engine's limitation text **verbatim**, what "recent" means, the plan's scope lines (1261, 1265) and standard disclosure (1763), quoted from the plan and checked against it (behaviour test 9a-9c) |
| – | Compare · Watch · Share · PDF, brokerage identity | Orders J and K | **not built** |

A **card** (plan lines 592-606) is: title; lifecycle as **text and a shape** (solid circle approved, dashed hollow circle proposed, solid square
operating, hollow diamond unknown, so it reads in greyscale); HomeSignal Type; distance **only if this response carries it**; the publisher's own
status word under its own label; the official record and the detected change under **separate** labels; an "Official source" link **only for an
http(s) URL**, carrying the cleared source's attribution when there is one.

**What it never shows** (plan lines 685-696): it does not read `storage_blockers`, `storable`, `rights` / HOLD, `INTERNAL_VIEW`,
`source_family` or any registry id, `change_ready`, `homesignal_observation`, the coverage state, a limitation `code`, `report_id`, a hash, or
`project_id`. The structural suite fails if the module reads a key outside the closed set of thirteen snake_case keys it does (2a-2b), and the
behaviour suite scans five outputs (customer, cold start, the shipped empty state, the internal view, a truncated area) for 50 internal strings (4b).

## 4. Decisions taken by default (the founder may change any of them)

From the audit (`founder_decisions_needed`); none is invented here:

1. **What "the data contract is proven" means** is not defined in any doc. Default: build the data-independent view now and hold any customer
   exposure until a signed-in production call has succeeded and at least one source family is rights-cleared. This unit exposes nothing.
2. **Things to Review** is not built (no eligibility, ranking, cap or wording exists).
3. **Operating and unknown records** appear in What Changed / Recent Official Activity and in Change History, never in a stage section, and
   an unknown one is labelled "Lifecycle unknown".
4. **Permitted / Under Construction** is omitted until a per-source rule exists.
5. **Which source families to clear** is not an Order I decision; until it is made a customer sees only the limitation text.

Taken while building (the audit left them open; each is a small change to reverse):

6. **A response with no report renders nothing.** `ADDRESS_NOT_RESOLVED` and `OUTSIDE_COVERAGE` give `''` (`renderable()` says so): the caller
   owns those messages and the credit rule (R5, open).
7. **A zero-record report with no limitation says nothing about absence.** The engine judges coverage on records returned (D-G7), so it cannot
   support "no activity", and plan hard rule 66 allows a zero-activity report only with healthy applicable feeds. Wording for that case is a founder call.
8. **Cards follow the engine's order**, which in a stage section is by project id. The view sorts and ranks nothing (a nearest-first or newest-first
   order is a presentation choice, not made here).
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

- **Nothing a resident or customer sees changes.** No page loads the module, the engine stays admin-only with an empty rights list, and the
  landing page's sample report (`development-activity.html`) is not edited. Two copies of the hierarchy now exist (that sample's inline script and
  this module); the shared stage labels are pinned equal (structural 5a-5c), and unifying them is a later, visible change to a deployed page.
- **No map, no Things to Review, no Permitted / Under Construction, no action bar, no brokerage identity, no entitlement.**
- **No network, storage, location, clock or private-context call**, and no Type, lifecycle, change, rights or ranking rule (pinned: structural 1-3).
- **Not exercised in production.** The engine's signed-in path has never been called there; the response shape for a real address has only been
  produced offline, by the real handler. What is near a real address was not seen.
- **No cache key.** `test/lib-cache-keys.test.mjs` §1a requires a loading page for every content-keyed file, and none loads this. The first page that
  does must add `lib/da-report-view.js` to `CONTENT_KEYED` in the same change (structural 6c-6d pin that nothing loads it today).

## 6. Proof

All offline; nothing here touches production.

| suite | what | result (final run) |
|---|---|---|
| `test/da-report-view.test.mjs` | the view over the **real handler's** output: order, hero, lifecycle, internal strings, coverage, escaping, links, address, engine order, history lanes, non-reports, plan quotes | 110 checks, 0 failed |
| `test/da-report-view-structure.test.mjs` | pure; closed read set; no authority, change, rights or ranking rule; escape and link validators; address read in one place; stage labels equal the landing page's; no caller | 53 checks, 0 failed |
| `test/da-report-view.browser.test.mjs` | Chromium: no overflow at 390 and 1280, sections stacked in the mobile order, one-column cards, lifecycle text and shape visible, tappable links, keyboard focus, 4.5:1 contrast on every element measured, hostile text runs nothing, no network request | 36 checks, 0 failed (headless Chromium) |
| `test/da_report_view_mutants.py` | prohibited mutations, each verified to apply and each killed on exit code by a named check (manual, like the other module loops: CI runs the tests, not the loop) | 87 mutations: 87 killed, 0 survived, 0 harness faults; 77 first killed by the two offline suites and 10 by the browser suite (the presentation ones) |

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
