# Universal development lifecycle classification: audit and plan (2026-11-01)

**Status: AUDIT ONLY. No production change, no registry edit, no deploy.** This document is the
deliverable the brief asks for before implementation. Everything below marked *measured* comes with
the query or file that produced it. Implementation waits for approval of section 4 and the decisions in
section 9.

**Revision 2, 2026-11-01: founder decision on inactive records incorporated** (new section 4.4; sections
4.1, 4.2, 5, 6, 7, 8 and 9 updated; D2 and D4 decided; D6–D8 added).

**Revision 3, 2026-11-01: architecture direction approved; D1, D3, D5–D8 and the national requirements
decided** (4.1 stages, 4.2 table, 4.4 items 2–8a, new 4.5, sections 7, 8 and 9 rewritten, new section 10
release gate). Status: **APPROVED DIRECTION, NOT ENABLED.**

Concurrency check (CLAUDE.md): `origin/main` on both repos since 2026-10-15 carries no lifecycle or
stage-classification work in flight; the only related commit is #2418 (dossier pages read Map 1's
lifecycle), which this plan keeps. Verdict: **GENUINE GAP**.

Canonical truth path today:
`publisher status field` → `jurisdiction-registry.json status_to_bucket` (per source, hand-written) →
connector (`sources/{arcgis,socrata,ckan,carto,csv}.ts`) emits `bucket` → `get-address-report` caches
the site in `development_reports.sites` → `public.app_refresh_zip` writes `app_projects.status`
(`Proposed|Approved|Operating|Decided|On file`) and the raw word in `app_projects.stage` → N5 markers →
`lib/project-type.js::lifecycleKey` → the four Map 1 columns.

**Decision owner: the registry's `status_to_bucket` map, read by the connectors, plus
`lifecycleKey()` for the four-key vocabulary.** The plan below extends these. It does not replace them
and adds no competing classifier. It *removes* three that exist today (section 1.3).

---

## 1. Inventory of every lifecycle classification code path

### 1.1 Engine (where the column is decided)

| # | Path | What it decides |
|---|---|---|
| E1 | `supabase/functions/get-address-report/jurisdiction-registry.json` → `status_to_bucket` | Every verbatim source status → `proposed`, `approved`, `operating`, `denied`, `withdrawn` or `exclude`. 255 entries; measured 730 / 453 / 294 / 63 / 42 / 419 values per bucket. |
| E2 | `status_const` (registry) | A whole dataset gets one status. 74 entries: 39 → proposed, 25 → approved, **5 → operating**, 5 socrata entries bypass the map entirely (`bucket = entry.status_const`, `sources/socrata.ts:517`). |
| E3 | `sources/issued-promotes.ts` | Promotes `proposed` → `approved` when the publisher's issue date is present (Phoenix). |
| E4 | `sources/decision.ts` | `denied` / `withdrawn` → decision object; `browsingBucketFor()` keeps it in Proposed. |
| E5 | `sources/tdlr-tabs.ts` and the FRS path | TABS filings, EPA facilities (lifecycle `unknown`, §7.13). |
| E6 | `exclude` handling in every connector | **Drops the record.** `if (bucket === "exclude") continue` (`arcgis.ts:510`). |

### 1.2 Materialiser and pages (where the column is read)

| # | Path | What it does |
|---|---|---|
| M1 | `public.app_refresh_zip` (DDL e.g. `docs/app-projects-stable-key-migration.sql:236-241`) | `decided` → `Decided`; bucket/type → `Active`/`Approved`/`Proposed`/`Operating`; else `On file`. Raw word kept in `stage`. |
| M2 | `lib/project-type.js::lifecycleKey` / `canonicalLifecycle` | Status string → one of four keys. The one vocabulary. |
| M3 | `lib/map.js::statusTier`, `trackerSiteItem`, `isActiveUndecided`, `currentStatusLine`, `decisionNotation` | Pin colour, column, active counts, the "Application on file" line. |
| M4 | `homesignalmap.html::STAGE_WORD` / `stageWord` / `kindLabel` | Popup stage words ("Proposed / hearing", "Approved / permitted", "Recorded / operating"). |
| M5 | `homesignalmap.html::recordKind` / `recordLink` | Map 1 source-link label, decided from the **URL host**. |
| M6 | `lib/templates.js::linkKind` / `linkNote`, `browsingStatusLabel` | ZIP-page link label, decided from stored `provenance.url_precision`. |
| M7 | `scripts/gen_zip_pages.py`, `scripts/development_pages.py`, `scripts/dossier-type.mjs` | Crawlable HTML, dossiers (read M2). |
| M8 | `scripts/gate2/lifecycle-buckets.mjs`, `scripts/lib/verify-dev-helpers.mjs` | Verifiers; an independent restatement of M2. |

### 1.3 Competing stage interpreters (outside the canonical path)

| # | Path | Problem |
|---|---|---|
| C1 | `homesignal-ingest/bluesky/lib/claim-contract.mjs::recordStatus` | A second record-stage classifier: regexes over raw `stage` (`/closed|finaled?|complete/` → CLOSED, `/active/` → ISSUED …). MAPS only. |
| C2 | `supabase/functions/_shared/national-report.ts::STAGE_EVIDENCE` / `presentationStage` | A third: a closed list of stage words → `permit_issued` / `under_construction`. Development Activity Report only. |
| C3 | `homesignalmap.html::STAGE_WORD` | A fourth: column → popup wording, with no access to the stage. |

The four do not agree. For example, C1 calls `ACTIVE` "issued" while E1 maps `Active` to `approved` in
some sources and C2 does not list it. C1's own header records a measured contradiction: **4,702
`app_projects` rows with `date_kind='issued'` and `status='Proposed'`** (dated measurement in that file,
not re-run here).

---

## 2. Root causes

**R1. There is no record stage, only a column.** `status_to_bucket` collapses the publisher's word straight
into three columns in one hand-written step. What the record *is* (pre-application contact, zoning case,
issued permit, finished inspection) is never stored, so no surface can describe it. The only place the
stage survives is the raw `app_projects.stage` string, which each consumer re-interprets with its own
regexes (C1–C3).

**R2. "Closed" and "Complete" are read as "built".** 294 values map to `operating`. Most are genuine
completion evidence (Final, Certificate of Occupancy), but many are not:
- **Case closure on a land-use record:** `austin-zoning-cases: Closed`, `burlington-vt-zoning-permits: Closed`,
  `austin-subdivision-cases: Subdivision Recorded`, `harris-county-plats: Historical Plat`,
  `dallas-specific-use-permits: In force / Permanent`, `anaheim-land-use-cases: Exercised`,
  `champaign-il-special-use-permits: Conforming`, `madison-planning-projects: Approved, Demolished`.
  A closed zoning case, a recorded plat or an SUP in force is an entitlement. It says nothing about
  construction.
- **Ambiguous "Closed" on permits:** 25+ sources (`kcmo`, `dekalb`, `little-rock`, `canyon`, `boston`,
  `baltimore-county`, `gilbert`, `tempe`, `fairfax-active-site-construction`, `virginia-beach` …). An
  administrative close can be expiry, abandonment or completion.
- **Work in progress mapped to Operating:** `topeka-building-permits: INSPECT`.
- **Opaque codes:** `centre-county-pa-building-permits: C`, `ar-ardot-job-status-*: 03`, `kdot: COMPL`
  (CLAUDE.md requires self-describing values).

**R3. Whole datasets carry an asserted lifecycle.** `nvdot-project-boundaries`, `loudoun-county-residential-permits`,
`charleston-county-permits` and `sheridan-county-building-permits` set `status_const: operating`, so every
record is "Operating now" with no evidence on the record. §7.12a moved 11 issuance ledgers to Approved
and named these four as left alone. They are the same defect.

**R4. Construction underway mapped to Proposed.** `arlington-issued-permits: Pending Inspection`,
`harris-county-permits: Assigned/UnAssigned: Pending Inspection`, `new-orleans-permits: Inspection - Pending /
Inspection Required`, `hartford-building-permits: Inspections In Progress / Inspection Phase`,
`tacoma-accela-permits: Awaiting PW Inspection / NPDES Inspection Required`. An inspection means a permit
was issued and work started. These are in the Proposed column.

**R5. The same word lands in different columns by source.**
- `Approved` → **proposed** in Cincinnati, Missoula, Columbia MO, Bentonville, but → approved in Austin and Fort Worth.
- `Inspections Completed` → approved (Seattle); `Inspections Complete` → operating (Tucson).
- `Final Inspection` → approved (Butler KS), `Final` → operating elsewhere.
- `Programmed` (STIP) → proposed in 20+ DOT entries but → **approved** in `mndot-stip-roadway-projects`;
  `adot-tip` "Adopted in the TIP" and `cook-county` "In the construction program" → approved.
- `Recommended for Approval` (staff recommendation) → approved in `austin-zoning-cases`.

Some differences may be correct (Cincinnati's "Approved" may mean plan review passed, permit not issued),
but nothing records *why*, so the same semantics cannot be shown to give the same column.

**R6. Preliminary activity is filed as a proposal.** `portland-neighborhood-contact-applications` (const
"Neighborhood contact filed before a land-use or building application") → Proposed; likewise
`arlington-permit-applications: Pre-Application`, `tacoma: Consultation Meeting Required`,
`peoria-az: Applicant Contacted`, `bend-or: Intake Pre-Screen`, `san-antonio-prelim-plan-review`. Then
`currentStatusLine()` prints **"Application on file"** under each, which is false for a pre-application
contact and for a programmed road project.

**R7. The exclude bucket silently drops records, terminal or not.** 419 values. Terminal states are
dropped (Expired 53 sources, Void 33, Cancelled 25+8, Revoked 16), so history disappears. Non-terminal
states are dropped too: **On Hold / Hold / Suspended / Stop Work** (~60 values), and some outright
decisions: `tigard-or-active-planning-cases: Decision Issued`, `austin-subdivision-cases: Review Completed`,
`anaheim-land-use-cases: Complete`, `georgia-dot: UNKNOWN`, `boone-county-ky: UNKNOWN`. An unknown
status should be "Lifecycle unknown", not invisible. These are not presented as active proposals today,
but they are not preserved either.

**R8. Two source-link decisions.** The ZIP page (M6) labels from the engine's stored `url_precision`
("Source data" for a dataset). Map 1 (M5) labels from the URL host and falls back to **"Official record ▸"
or "Permit filing ▸" for 182 dataset-precision entries** (measured: `record_url_precision` = dataset on
182 of 255 entries). Map 1 therefore calls a dataset endpoint an individual filing. There is also no
"general agency page" precision value at all.

---

## 3. Production examples, several states (measured 2026-11-01)

Read-only query, `public.app_projects`, `record_kind='development'`, ZIPs 78701 78702 (Austin TX),
97214 97232 (Portland OR), 75201 (Dallas TX), 76010 (Arlington TX), 06103 (Hartford CT), 05401
(Burlington VT), 89101 (Las Vegas NV), 53703 (Madison WI), 92805 (Anaheim CA), counted as distinct
`source_key`. (Control: every queried registry id returned rows except Topeka and Harris County, whose
ZIPs were not in the sample. Those two are cited from the registry only.)

| State | Source | Publisher stage | Shown in column | Distinct records | Verdict |
|---|---|---|---|---:|---|
| TX | austin-zoning-cases | Closed | **Operating now** | 1,655 | Wrong: case closed, construction unknown |
| TX | austin-zoning-cases | Recommended for Approval | Approved | 46 | Wrong: a recommendation |
| TX | austin-subdivision-cases | Subdivision Recorded | **Operating now** | 124 | Wrong: plat recorded, not built |
| TX | dallas-specific-use-permits | In force / Permanent | **Operating now** | 338 | Wrong: entitlement in force |
| TX | txdot-projects-info-all | Construction | Approved | 52 | Column right, card must say "construction underway" |
| TX | arlington-issued-permits | Finaled | Operating now | 2,671 | Right |
| VT | burlington-vt-zoning-permits | Closed | **Operating now** | 614 | Wrong: zoning permit closed |
| NV | nvdot-project-boundaries | (constant) operating | **Operating now** | 51 | Wrong: no lifecycle on the record |
| OR | portland-neighborhood-contact-applications | Neighborhood contact filed… | Proposed | 58 | Card wrong ("Application on file"); column a decision (D1) |
| OR | portland-building-permits | Under Inspection | Approved | 352 | Column right; card should say construction underway |
| CT | hartford-building-permits | Closed | Operating now | 46 | Unverified: ambiguous close |
| WI | madison-planning-projects | Approved, Demolished | **Operating now** | 1 | Wrong: demolition |
| CA | anaheim-land-use-cases | Exercised | **Operating now** | 2 | Wrong: entitlement used |

In this 13-ZIP sample alone, **about 2,840 records sit in "Operating now" on entitlement or closure
evidence, not construction evidence.** That is not a national count; section 7 measures that.

---

## 4. Proposed national classification architecture

### 4.1 Four facts per record, kept separate

1. **Record class**: what kind of government record it is. Declared once per registry entry, from the
   publisher's own dataset description: `preliminary_contact`, `land_use_application`, `zoning_change`,
   `subdivision_plat`, `special_use_permit`, `building_permit`, `demolition_permit`, `transport_project`,
   `environmental_review`, `facility_registration`. (Separate from Type; Type stays `lib/project-type.js`.)
2. **Record stage**: what the source establishes about this record. One national vocabulary:

   | stage | meaning |
   |---|---|
   | `preliminary_identified` | consultation, neighborhood contact, pre-application, where the official record identifies a contemplated development (D1, below) |
   | `preliminary_unidentified` | the same activity without an identifiable contemplated development |
   | `filed` | formal application submitted / intake accepted |
   | `under_review` | in review, hearing scheduled, notice sent, staff recommendation |
   | `programmed` | in a funded transportation or capital program, not yet let |
   | `entitled` | zoning / plat / SUP / land-use approval granted or recorded |
   | `permitted` | permit approved or issued, work not shown to have started |
   | `under_construction` | inspections under way, construction, awarded/advertised contract |
   | `operation_established` | evidence that the facility or development itself operates: a certificate of occupancy or final inspection on a permit to build or add to that structure; "In Service" / "Operationally Complete" on a project that builds a new facility (D3) |
   | `work_completed` | completed work that does not establish operation: demolition, abatement, resurfacing, repair or maintenance, and a final inspection on such a permit (D3) |
   | `closed_unspecified` | "Closed" whose meaning the publisher does not define for this record class (D5) |
   | `not_established` | blank, UNKNOWN, opaque code |
   | `invalid_record` | not a development at all, per the publisher's documented term: issued in error, duplicate, test, template, deleted, not required, exempt, out of jurisdiction, never-submitted draft. Not shown; counted in the run report. |

   Denied, withdrawn, cancelled, expired and on-hold are **not stages**. Under the founder decision of
   2026-11-01 they are an activity status (fact 3), so they never overwrite the stage.
3. **Activity status** (founder decisions 2026-11-01, section 4.4): `active` | `paused` | `inactive` |
   `undetermined`, with the government's exact term, a reason category for `inactive` (cancelled /
   withdrawn / denied / expired) and a verified effective date or none. `undetermined` (D8) is a source
   term whose meaning the agency does not document ("Aborted", "Void" or "Revoked" without documented
   semantics). It is fail-closed: never shown as inactive and never counted as active.
4. **Evidence**: the verbatim status (already stored as `app_projects.stage`), the rule that mapped it
   (`stage_basis`: `status_map` | `status_const` | `issued_promotes`; for an inactive or paused record,
   `observed` | `term` | `class_entry`, section 4.4), `stage_rule_version`, the record URL and its
   precision, and the publisher's own dates. Never the fetch time (§7.05: a recent fetch is not a
   decision check).

### 4.2 Where each piece lives (one path, no new classifier)

- **Per-source adapter = interpretation only.** Each registry entry gains `record_class`, `entry_stage`
  (the stage a record must have reached to exist in this dataset, from the publisher's own dataset
  description), `status_to_stage` (verbatim status → national stage) and `status_to_activity` (verbatim
  status → `paused` or `inactive:<cancelled|withdrawn|denied|expired>`), replacing `status_to_bucket`. It may
  also name `inactive_date` columns (the publisher's own expiration, withdrawal, cancellation or decision
  date). This is the only per-source knowledge, in the same place it lives today. `status_const` names a
  stage, not a column.
- **National column rule = one table, in one module.** `STAGE_TO_COLUMN[class][stage]`, in
  `lib/project-type.js` (already loaded by every page and generated into
  `supabase/functions/_shared/project-type.generated.js` for the engine). The connector computes the
  bucket from it; nothing else maps a stage to a column. Proposed table:

  | stage | column | notes |
  |---|---|---|
  | preliminary_identified | Proposed | D1; card "Pre-application — formal application not verified."; never counted as a formal active application |
  | preliminary_unidentified | Lifecycle unknown | D1 |
  | filed, under_review | Proposed | |
  | programmed | Proposed | normalises the 3 DOT entries that say Approved |
  | entitled | Approved | card: "construction status not verified" |
  | permitted, under_construction | Approved | |
  | operation_established | Operating now | the only stage that reaches Operating now; never from a land-use class |
  | work_completed | previously verified column, else Lifecycle unknown | D3; card names the completed work in the publisher's words |
  | closed_unspecified, not_established | Lifecycle unknown | D5: Closed is not completed, operating, cancelled or inactive |
  | invalid_record | not shown | today: mostly dropped already; now counted by name |

  The column is decided by the stage alone. An inactive or paused record takes the column of its
  historical stage (section 4.4); activity never moves a record to another column.

- **`lifecycleKey()` is unchanged.** Four keys, the same labels, the same stored `status` strings. No new
  column, no new chip.
- **C1, C2 and C3 become readers of the stage** instead of regexing `stage`. `claim-contract.mjs` maps
  stage → RECORD_STATUS by table; `national-report.ts` replaces `STAGE_EVIDENCE` with
  `stage in (permitted, under_construction)`; `STAGE_WORD` is retired for the card line (4.3).

### 4.3 Card descriptions and link labels

- One function, `HS.recordStageLine(class, stage, decision)` in `lib/project-type.js`, with a Python twin in
  `gen_zip_pages.py` pinned by a parity test (the `decision-vocabulary-parity` pattern). Examples:
  "Pre-application — formal application not verified." (founder wording, D1, exact), "Development application
  submitted — decision pending", "Permit approved — construction status not verified", "Zoning amendment
  recorded — project construction status unknown", "Construction underway — completion not verified".
  It replaces `currentStatusLine`'s fixed "Application on file" for every non-application class.
- One link-label decision, `HS.recordLinkLabel(precision)`, used by Map 1 and the ZIP page:
  `record` → "View official government record", `dataset` → "Official government dataset",
  `agency` → "Government agency information". Precision comes only from the engine's
  `record_url_precision` (a new value `agency` for entries whose `dataset_url` is an agency landing page),
  carried through to Map 1 sites. `recordKind()`'s URL-host guessing is removed.

### 4.4 Inactive and paused records ⚖️ FOUNDER DECISION (2026-11-01)

**The ruling, as given.** A development that was genuinely Proposed stays in the Proposed column after it
is cancelled, withdrawn, denied or expired, with a record-level status "INACTIVE AS OF [verified date]"
and the reason in the government's own words. A record that was historically Approved keeps Approved.
On Hold is "Paused", not inactive, and keeps its previously verified classification. Inactive records
are excluded from active counts, active-development alerts and new MAPS posts, and keep their official
link and history. The rule applies to every state and record type. The four columns are unchanged.

**How each requirement is met:**

1. **Lifecycle and activity are separate fields** (4.1 facts 2 and 3). The column comes only from the
   historical stage; activity only adds the status line and the exclusions.

2. **The historical stage is taken from evidence, strongest first.** A source usually publishes only the
   current status, so an "Expired" record does not say what it was before. The ladder:
   - `observed`: the last active stage JODY itself recorded for this record. `public.dev_change_event`
     already stores every publisher-status change with before and after values (append-only, comparable
     records only). **JODY's history begins 2026-09-30 and is incomplete before it** (founder rule): the
     rung reports only stages actually observed, and no earlier lifecycle event, date or stage is ever
     created to fill the gap.
   - `term`: the government's own term names the earlier stage **in its words, with documented
     semantics** (D8). "Application Expired" or "Application Withdrawn" names an application (`filed`).
     "Permit Expired" names a permit that existed, which establishes `permitted` only where the agency's
     documentation says its permits are recorded at issuance. "Approval(s) Expired" names an approval
     (`entitled`). An ambiguous term establishes nothing.
   - `class_entry`: the registry entry's `entry_stage`, used **only when the publisher's own dataset
     definition guarantees that stage for every record in it** (for example a dataset documented as
     "issued permits" only, or a record carrying the publisher's own issue date, the §7.12a rule). **Generic
     dataset membership never establishes an earlier approval or construction stage** (founder rule): a
     mixed "permits" dataset establishes at most `filed`, and only when the dataset is documented as
     applications. Each `entry_stage` carries its documentation reference in the registry's `_receipts`.
   - None of these: Lifecycle unknown, with the activity status still shown. No title, type or date is
     ever used to guess a stage.

   An inactive or paused record never moves to an earlier column than its last observed one: Approved
   stays Approved. A record with established operation keeps Operating (for example a revoked certificate
   of occupancy).

3. **"Genuinely Proposed" is enforced.** Rows that were never a development are `invalid_record`, but only
   where the agency's documented term says so (issued in error, duplicate, test, template, deleted, not
   required, exempt, out of jurisdiction, a saved or never-submitted draft). They are not shown, as today,
   but counted by term in the run report.

3a. **Terms are read with documented agency semantics (D8).** "Aborted", "Void", "Voided", "Revoked",
   "Terminated", "Abandoned", "Lapsed" and similar map to an inactive category only where that agency's
   own documentation (glossary, data dictionary, status definitions, ordinance) defines them. The
   documentation is cited in the registry's `_receipts`. Without it, the activity is `undetermined`:
   - the record keeps its evidenced stage and column;
   - it shows the source's exact term ("Status on the record: Aborted — meaning not stated by the agency");
   - it is never labelled inactive or cancelled;
   - it is excluded from active counts and MAPS posts, like a paused record.

   The source's exact terminology is always preserved and shown.

3b. **"Closed" (D5).** Lifecycle unknown, unless the publisher defines Closed and the record class
   supports that reading (for example a building-permit agency whose documentation says Closed = final
   inspection passed, which gives `operation_established` for a permit to build). Closed is never
   automatically completed, operating, cancelled or inactive; with no definition its activity is
   `undetermined`.

3c. **Completed work (D3).** Completed demolition, abatement, resurfacing, repair or maintenance is
   `work_completed`. It keeps a previously verified column (`observed` rung only), otherwise Lifecycle
   unknown. The card names the completed work in the publisher's words ("Demolition permit finaled").
   Operating now appears only with `operation_established` evidence for the facility or development
   itself.

3d. **Pre-application (D1).** `preliminary_identified` requires the official record to identify a
   contemplated development: its site (address or parcel) and what is proposed (a stated use, project
   type or description), as the record itself states. A contact or meeting record without both is
   `preliminary_unidentified` (Lifecycle unknown). Identified pre-applications sit in Proposed with
   "Pre-application — formal application not verified." and are counted separately from formal active
   applications (item 7). Portland's neighborhood-contact layer is judged per record by this rule, not
   as a dataset.

4. **The date.** "INACTIVE AS OF [date]" uses only a date the publisher states for the inactivity: the
   registry's `inactive_date` columns (expiration date, withdrawal date, cancellation date, decision
   date). The date must be a real past day: not after today + 1, not before the record's own filing date,
   not a sentinel. Any other case shows **"Inactive — date not verified."** Never used: the filing or
   issue date, the refresh time, or the time JODY first saw the record inactive (that is when we noticed,
   not when it happened). An expiration-date column never makes a record inactive by itself. Only the
   publisher's status does; the date only dates it.

5. **The reason.** The status shows the government's verbatim term ("Withdrawn", "Revoked", "Permit
   Expired due to inactivity", "Denied"). The four-way category (cancelled, withdrawn, denied, expired) is
   stored for logic and filtering. Revoked, Void, Terminated, Abandoned and Lapsed fall in "cancelled" or
   "expired" by the source's adjudicated mapping, never by guess. Denied and withdrawn keep the §7.05
   decision notation; `sources/decision.ts` becomes the producer for those two categories, so there is
   one source of the inactive record. The 2026-09-20 decision vocabulary is not widened: cancelled and
   expired are activity statuses, not decision outcomes.

6. **Paused.** On Hold, Hold, Suspended, Stop Work, Reviews Paused and similar map to `paused`. A paused
   record keeps its historical stage by the same ladder and shows **"PAUSED AS OF [verified date]"** with
   the government's term, or "Paused — date not verified". It is not permanent: the next active
   observation clears it.

7. **One active predicate, two count kinds.** `HS.isActive(item)` (replaces `HS.isActiveUndecided`, same
   field-precedence care) is true only when activity is `active`, no decision is present, and the stage is
   not `preliminary_*`. Paused (D6), undetermined (D8) and inactive records are all false. It is the only
   test used by:
   - active counts (`counts.proposed_active`, a new `counts.approved_active`, the "New projects proposed"
     tile);
   - MAPS eligibility (`homesignal-ingest/bluesky/lib/maps-eligibility.mjs`);
   - active-development alerts (Bluesky MAPS posts and their email copies);
   - the Development Activity Report's current-project sections (C2).

   Identified pre-applications get their own count (`counts.preliminary`), never added to active
   applications.

   **Active and historical counts are distinguishable everywhere a count is shown.** A column states its
   total and its active part ("Proposed · 42 records, 17 active"). A counter tile that says "active" counts
   only `HS.isActive`. A count never mixes the two without saying so.

8. **Presentation within a column.** Active first, then paused, then undetermined, then inactive (newest
   verified inactive date first, undated last). The existing "Includes historical proposals" rail note
   becomes "Includes inactive records" on any column that holds one. The marker keeps its column colour.
   Paused shows "PAUSED", with the verified reason and date where available (D6).

8a. **Property-follow notifications (D7).** One notification per (record, publisher-status transition),
   only when all of these hold:
   - a genuine new government record establishes that the filing became inactive or paused: a material
     `status_changed` event in `dev_change_event`, whose `prev_facts.stage` and `new_facts.stage` are both
     publisher words and whose new stage maps to inactive or paused;
   - the event was observed after the feature went live;
   - the event is not a baseline or `first_detected` event.

   Deduplicated on `(identity_key, prev stage → new stage)`. Never sent for a historical backfill (a record
   first seen already inactive), a rule change, or a reclassification (`source_record_updated`, a derived
   field). Uses the existing property-watch path (`_shared/property-watch.ts`, which already lists only
   material ledger events and records what each follower was told, exactly once); no second notifier.

9. **Link and history.** The `record_url`, its precision label (4.3), the verbatim publisher status and
   the ledger history are unchanged. An inactive record is never deleted.

### 4.5 A reclassification is not a project change (founder rule, 2026-11-01)

A rule change moves the derived `status` and the new provenance fields, never a publisher fact. Every
consumer that reacts to change must see it as a rule-version change:

| Consumer | Today | Required |
|---|---|---|
| Change ledger (`dev_change_event`) | `status` is derived; a change with `stage` unchanged is `source_record_updated`, non-material (rule 3) | Unchanged. The new provenance fields join the non-fact list. |
| Property-follow emails | Material events only | Unchanged (8a). |
| Project pages `changed_on` / sitemap `lastmod` | `status` is in `PAGE_FACTS` (ingest `bluesky/lib/development-seo-plane.mjs`) | `changed_on` moves only on a publisher-fact change. A derived status or stage line is versioned by `stage_rule_version`, so a rule release refreshes no project date. |
| IndexNow (`page_semantics.py`) | A changed page text changes the fingerprint | A rule release is released deliberately past the mass-change hold, never as a stream of "changed" pages; dated `lastmod` stays on publisher facts. |
| MAPS drafts | `mapsDedupeKey` (ingest `bluesky/lib/maps-eligibility.mjs`) folds `status` + `submitted_at`, so a moved status can mint a new draft | The dedupe identity stops folding the derived status; it folds the publisher's verbatim `stage` instead. Changing the key is itself a duplicate hazard (every existing post's old key stops matching), so during the change a candidate counts as already posted if it matches on the old key OR the new key, and the switch is proven with a dry run that mints 0 drafts for unchanged records. |
| Development Activity Report snapshots | Immutable | Unchanged; new reports carry `stage_rule_version`. |
| N5 generations | Status from the snapshot | Unchanged; the change appears on the next generation's pre-activation proof. |

---

## 5. Database and migration impact

- **No new database column is required for the column fix.** `app_projects.status` keeps its values, and
  `app_projects.stage` already holds the verbatim status. Reclassification changes `status` on affected rows
  only (`docs/app-refresh-zip-write-only-changed.sql`: unchanged rows are not rewritten).
- **The record stage and class ride in `app_projects.provenance`** (jsonb, already written by
  `app_refresh_zip`): `{record_class, record_stage, stage_basis, stage_rule_version}`. This needs one
  splice of `app_refresh_zip` (fail-closed anchor, reversal-proven, as every prior splice), not a table
  change. N5 marker payloads need the same three fields plus `url_precision` (one change to the marker
  builder in the next generation).
- **Registry migration is generated, never transcribed** (claims rule 7): a script converts every
  `status_to_bucket` value to a proposed `status_to_stage` value. Each conversion is either mechanical
  (bucket and wording agree) or listed for adjudication. A fingerprint proves no status value is lost or
  invented (rule 8, `collate "C"`).
- **Inactive and paused fields also ride in `provenance`:** `{activity_status, inactive_category,
  inactive_term, inactive_effective_date, inactive_date_basis, historical_stage, historical_stage_basis}`.
  `app_projects.status` then carries the column of the historical stage. **`app_refresh_zip` stops writing
  `Decided`** only after every reader of `Decided` (`maps-eligibility.mjs`, `HS.isActiveUndecided`,
  `claim-contract.mjs`, `lifecycleKey`) reads `activity_status` instead. `lifecycleKey` keeps accepting
  `Decided` permanently, for stored rows and immutable report snapshots.
- **The `observed` rung reads the change ledger inside `app_refresh_zip`,** only for rows whose new
  status is inactive or paused. It looks up the newest `dev_change_event` for that `source_key` whose
  `new_facts.stage` mapped to an active stage. This adds a cost to the materialiser, so it must be
  measured against the 25 s / statement_timeout budget on the densest ZIPs before it is enabled. Fallback
  if it is too slow: the engine carries the last active stage forward through the cache.
- **Previously excluded records reappear** (inactive and paused states). That raises row counts and
  `development_reports` row sizes. The size comes first from what the connectors already report, with no
  new query: each run report's `excluded_by_status` gives counts per source and status. Then measure per
  ZIP against the cache size ceiling, and enable per category (paused, withdrawn, denied, cancelled,
  expired). Existing recency windows still bound what is fetched.
- **Change ledger:** `dev-change-ledger.sql` rule 3 already treats `status` as derived. A reclassification
  emits no `status_changed` event and fabricates no history. `stage` (the publisher's word) is untouched.

## 6. Implementation sequence and rollback

1. **Vocabulary module.** Add `record_class`, the stage list, `STAGE_TO_COLUMN`, `recordStageLine` and
   `recordLinkLabel` to `lib/project-type.js`, regenerate the engine copy. Pure functions, tests only.
   No surface reads them yet. *Rollback: revert.*
2. **Registry conversion, report-only.** Generator emits `status_to_stage` beside `status_to_bucket` and a
   diff: for every (source, status), the old column and the new column. The founder adjudicates the
   "changes column" list. *Nothing ships.*
3. **Connector computes the bucket from the stage** behind a per-entry switch (`stage_model: true`).
   Default off ⇒ byte-identical output (pinned by a test that runs every registry entry both ways).
   *Rollback: flip the switch.*
4. **Enable per record class, smallest blast radius first:** land-use closure (R2), then constants (R3),
   then inspection-under-way (R4), then the preliminary class (R6). Each step: dry-run on the replica
   (§7.11 pattern), measure moved records per column nationally, enable, deploy `get-address-report`,
   let the rolling refresh carry it. *Rollback: switch off; the next refresh restores the old status.*
5. **Card line and link labels** on the page (reads provenance; falls back to today's wording when the
   stage is absent, so pages never go blank during the ~53 h sweep).
6. **Replace C1 and C2** with stage readers, each with a parity test against its current output on the
   unchanged cases.
7. **Inactive and paused (section 4.4), in this order:**
   1. `HS.isActive` and the activity fields, used by every reader. Today's records all read `active` or
      decided, so output is unchanged (pinned).
   2. Switch MAPS eligibility, active counts, alerts and the report to `HS.isActive`.
   3. Denied and withdrawn move from the decision object onto the activity fields, with no visible
      change (parity test against today's notation).
   4. Paused, then withdrawn/denied records that are currently dropped, then cancelled, then expired.
      Each is behind its own per-category switch, after its size measurement and a replica dry run.
   5. `app_refresh_zip` stops writing `Decided`.

   *Rollback: each category switch off ⇒ the next refresh drops those records again, exactly as today.*

## 7. Nationwide regression test plan

- **Semantic parity test:** a fixture of (class, verbatim status) pairs drawn from every registry entry,
  grouped by meaning ("closed zoning case", "issued permit", "final inspection", "programmed STIP",
  "pre-application", "withdrawn", "expired", "hold"). Same meaning ⇒ same stage and same column in every
  state, or the test names the source that disagrees.
- **Negative pins:** no land-use class may reach Operating; no `status_const` may name a column; no
  `exclude`; `closed_unspecified` never reaches Operating; a pre-application never prints "Application on
  file"; a dataset link never reads "official government record".
- **No-inflation check:** per ZIP, total development records before = after, except the explicitly
  re-admitted inactive and paused records, which are counted separately. No unknown record moves to
  Proposed.
- **Inactive, paused and undetermined records (founder decisions 2026-11-01):**
  - *Column preserved:* a record observed Proposed then Withdrawn stays Proposed. Observed Approved then
    Expired stays Approved. Observed with established operation then Revoked stays Operating. Never an
    earlier column than the last observed one.
  - *Evidence ladder:* each rung (`observed`, `term`, `class_entry`, none) is tested on its own, with the
    rung recorded in `historical_stage_basis`. No title, type or date ever sets the stage (negative pin).
  - *No inference from ambiguity or generic membership:* an ambiguous term ("Closed", "Void", "Aborted"
    without documentation) never sets an earlier stage. A record in a mixed "permits" dataset with no
    per-record issue evidence never reaches Approved. An `entry_stage` with no documentation receipt fails
    the registry check.
  - *History boundary:* an `observed` stage is only ever one the ledger recorded on or after 2026-09-30. A
    record first seen already inactive gets no invented earlier event, date or stage (negative pin over
    the rung and the card text).
  - *Date:* the verified publisher date is shown. A future date, a date before filing, a sentinel, a
    missing column, the filing or issue date, `refreshed_at` and the ledger's observed time each produce
    "Inactive — date not verified" (one negative case per item). The same rules apply to "PAUSED AS OF".
  - *Reason:* the displayed reason is the government's exact term. The category is one of the four and is
    never shown in place of the term.
  - *Paused (D6):* On Hold, Suspended and Stop Work give "PAUSED", never "INACTIVE". The stage and column
    are kept. A later active observation clears it. Excluded from active counts and new MAPS posts.
  - *Undetermined (D8):* "Aborted", "Void" and "Revoked" with no documentation receipt give
    `undetermined`: shown with the exact term and "meaning not stated by the agency", never labelled
    inactive or cancelled, never counted active, never MAPS-eligible. The same term with a receipt maps to
    its documented category.
  - *Closed (D5):* "Closed" with no publisher definition gives Lifecycle unknown and `undetermined`. It is
    never completed, operating, cancelled or inactive. With a documented definition and a supporting class
    it gives that meaning only.
  - *Completed work (D3):* a finaled demolition, abatement or resurfacing record never reaches Operating
    now. It keeps an `observed` column, else Lifecycle unknown, and the card names the work in the
    publisher's words. Operating now requires `operation_established` (negative pin: no other stage
    reaches it).
  - *Pre-application (D1):* a record with both a site and a stated proposal gives Proposed, the exact text
    "Pre-application — formal application not verified.", and `counts.preliminary`, never
    `proposed_active`. A record missing either gives Lifecycle unknown. Tested per record on Portland's
    layer, plus one other state's pre-application source.
  - *Counts distinguishable:* every displayed count names whether it is total or active; total minus
    active equals paused + undetermined + inactive + preliminary, exactly, per column and per ZIP.
  - *Exclusions:* every non-active record is false under `HS.isActive`. It is absent from active counts,
    MAPS eligibility, active-development alerts and the report's current sections. Its column chip total
    still counts it.
  - *Genuinely proposed:* documented `invalid_record` terms never render; an undocumented void is
    `undetermined`, not invalid and not cancelled.
  - *Universal:* the same documented term on two sources of the same class gives the same stage, activity,
    category and column in every state. No test, rule or label names a state, county or source.
  - *History:* `record_url`, verbatim status and ledger rows are unchanged, and no inactive record is
    removed.
  - *Parity:* the page, the Python page generator and the engine agree on `isActive`, the stage line and
    the status line (the `decision-vocabulary-parity` pattern).
- **Notifications (D7):** a material publisher-status transition to inactive or paused observed after go-live
  sends exactly one property-follow notification per (record, transition). A retried job sends none extra.
  A record first seen inactive, a baseline run, a rule-version change, a derived-status change and a
  backfill send zero. Measured on a replica by running the watch job twice.
- **Reclassification is not a change (4.5):** applying the new rules to an unchanged publisher snapshot
  produces:
  - 0 material ledger events, 0 property-follow notifications;
  - 0 moved `changed_on` dates, 0 moved dated `lastmod` values;
  - 0 new MAPS drafts (old-key-or-new-key dedupe);
  - 0 new IndexNow submissions outside the deliberate release.
  Each is run on a replica against the current production snapshot.
- **Inactive examples per state** in fixtures: Austin zoning Withdrawn (TX), Anaheim Denied (CA), Hartford
  "Closed - Denied" (CT), a Phoenix EXPR permit (AZ), a Raleigh "On Hold" (NC), a Montgomery County "Stop
  Work" (MD), an Austin site plan "Aborted" (TX; `undetermined` unless a documentation receipt exists), a
  documented "Voided - Issued in Error" (excluded), an undocumented plain "Void" (`undetermined`), a
  Madison "Approved, Demolished" (WI; `work_completed`), and a Burlington zoning "Closed" (VT; Lifecycle
  unknown).
- **Preservation check:** source identity, `record_url`, coordinates and ZIP membership byte-identical
  before and after on every moved record.
- **Replica dry run** over all 12,744 ZIP pages: national before/after per column, per class, per state,
  with the moved list.
- **Real examples per state** in fixtures: Austin zoning Closed, Burlington zoning Closed, Dallas SUP,
  NVDOT, Portland contact and permits, Arlington Pending Inspection, Hartford Closed, Madison Demolished,
  TxDOT Construction, a STIP Programmed record, a Seattle withdrawn case, a Phoenix issued-promotes record.
- **Browser test:** Map 1 popup and ZIP card for each example show the stage line and the right link label.
- Mutation-check every new pin on exit code.

## 8. Risk assessment

| Consumer | Risk | Mitigation |
|---|---|---|
| Map 1 counts / columns | Large visible moves (thousands Operating → Approved/Unknown; D5 and D8 send more to Lifecycle unknown). | Per-class enablement; national before/after counts reviewed before each step (section 10). |
| Documentation coverage | D5/D8 need agency documentation; sources without it fall to Lifecycle unknown / `undetermined`, which may be many. | Measured in the generated mapping audit; receipts added source by source, never assumed. |
| ZIP pages, `indexable`, Rule F/D | Rule D counts publishable development; status moves do not change membership, but re-admitted terminal records could. | Terminal states excluded from Rule D and indexability counts. |
| MAPS eligibility (`ELIGIBLE_STATUS = {Proposed, Approved}`) | Records leaving Operating become postable; **`mapsDedupeKey` folds status**, so a moved record can mint a new draft, and changing the key can too. | Eligibility reads `HS.isActive` (preliminary, paused, undetermined and inactive not postable); dedupe on old key OR new key; 0-new-drafts dry run (4.5). |
| Project pages (`development-seo-projects`) | `status` is a page fact, so `changed_on` and sitemap lastmod would move for every moved project. | `changed_on` on publisher facts only; rule changes versioned; one deliberate IndexNow release (4.5). |
| Development Activity Report snapshots | Immutable; old reports keep old wording. | Correct by design; new reports carry `stage_rule_version`. |
| Change ledger | None: `status` is derived (rule 3). | Pinned by existing test. |
| N5 generations | Markers carry status from the snapshot; change appears only on the next generation. | Sequence after a generation; pre-activation proof unchanged. |
| Cache size | Re-admitted inactive and paused records grow rows. | Size from run-report `excluded_by_status`; enable per category. |
| Materialiser cost | The `observed` rung reads the ledger. | Inactive/paused rows only; measure on dense ZIPs; engine carry-forward fallback. |
| `Decided` readers | Stopping the `Decided` write before every reader switches would make denied records look active. | Readers switch first (step 7.2); `Decided` stops last (7.5). |
| Founder rulings | §7.05 (denied/withdrawn only as decisions), §7.12a issued-is-approved, 2026-11-01 inactive rule and D1–D8. | Reconciled: cancelled and expired are activity statuses, not decision outcomes, so the §7.05 vocabulary is unchanged. |

## 9. Founder decisions (all decided, 2026-11-01)

- **Architecture direction: approved**, subject to the release gate in section 10.
- **D1. Pre-application.** Proposed only when the official evidence identifies a contemplated development,
  labelled "Pre-application — formal application not verified."; otherwise Lifecycle unknown. Never
  counted as a formal active application. (4.4 item 3d.)
- **D2. Cancelled, withdrawn, denied, expired.** Kept in the historical column as "INACTIVE AS OF
  [verified date]" with the government's term; excluded from active counts, alerts and new MAPS posts.
  (4.4.)
- **D3. Completed demolition, abatement or resurfacing.** Does not establish operation. Keep a previously
  verified classification, else Lifecycle unknown with the completed-work description. Operating now only
  with evidence of operation of the facility or development. (4.4 item 3c.)
- **D4. On hold.** "Paused", distinct from inactive, keeping the previously verified classification.
  (4.4 item 6.)
- **D5. "Closed".** Lifecycle unknown unless the publisher defines it and the record class supports the
  reading; never automatically completed, operating, cancelled or inactive. (4.4 item 3b.)
- **D6. Paused.** Stays visible in its lifecycle column; excluded from active-development counts and new
  MAPS posts; shows PAUSED with the verified reason and date where available. (4.4 items 7–8.)
- **D7. Property-follow.** One notification per record and source-status transition, only for a genuine
  new government record of becoming inactive or paused; never for backfills, rule changes or
  reclassification. (4.4 item 8a.)
- **D8. Agency terms.** Interpreted only with documented agency semantics; exact terminology preserved;
  no assumed cancellation (activity `undetermined`). (4.4 item 3a.)

National requirements from the same ruling, and where each is met:

| Requirement | Section |
|---|---|
| Exactly the four existing Map 1 columns | 4.2 (`lifecycleKey` unchanged) |
| Lifecycle stage, activity status, official evidence and effective date kept separate | 4.1 |
| Historical records preserved, never presented as currently active | 4.4 items 1, 7, 8 |
| Active and historical counts distinguishable | 4.4 item 7 |
| No earlier approval or construction stage from an ambiguous status or generic dataset membership | 4.4 item 2 |
| Observation history incomplete before 2026-09-30; no fabricated earlier events | 4.4 item 2 |
| Reclassification causes no false change notifications, refreshed project dates or duplicate MAPS posts | 4.5 |
| One canonical shared engine, no state-specific presentation patches | 4.2; universal test in section 7 |

## 10. Release gate (founder, 2026-11-01)

**Building may proceed (sections 6 steps 1–3: vocabulary module, report-only generator, connector
switch defaulting off). Nothing is enabled nationwide until the founder has reviewed all four of these:**

1. **The generated status-mapping audit.** For every registry entry and every verbatim status:
   - old bucket, new stage, new activity, new column;
   - the documentation receipt behind each D5/D8 interpretation, or "none → undetermined";
   - the `entry_stage` and its receipt.

   It is generated from the registry (claims rule 7) and fingerprinted (rules 8–9).
2. **Before/after record counts.** From a replica run over all 12,744 ZIP pages against the current
   production snapshot: per column, per activity, per record class, per state and per source, with the
   moved records listed and total = active + paused + undetermined + inactive + preliminary checked
   exactly.
3. **Downstream impact tests.** The section 7 suite green, plus the replica proofs of section 4.5 (0 false
   changes, notifications, dates, MAPS drafts) and the cache-size and materialiser-cost measurements.
4. **The rollback plan, rehearsed.** Each per-category switch turned off on the replica restores the
   previous `status` on the next refresh, byte-identical on unchanged records. The `Decided` write is
   retired only after this.

Each enablement step in section 6 is then shown its own slice of items 2 and 3 before it is switched on.

Nothing in production has been changed.
