# Universal development lifecycle classification: audit and plan (2026-11-01)

**Status: AUDIT ONLY. No production change, no registry edit, no deploy.** This document is the
deliverable the brief asks for before implementation. Everything below marked *measured* comes with
the query or file that produced it. Implementation waits for approval of section 4 and the decisions in
section 9.

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

### 4.1 Three facts per record, kept separate

1. **Record class**: what kind of government record it is. Declared once per registry entry, from the
   publisher's own dataset description: `preliminary_contact`, `land_use_application`, `zoning_change`,
   `subdivision_plat`, `special_use_permit`, `building_permit`, `demolition_permit`, `transport_project`,
   `environmental_review`, `facility_registration`. (Separate from Type; Type stays `lib/project-type.js`.)
2. **Record stage**: what the source establishes about this record. One national vocabulary:

   | stage | meaning |
   |---|---|
   | `preliminary` | consultation, neighborhood contact, pre-application, pre-screen |
   | `filed` | formal application submitted / intake accepted |
   | `under_review` | in review, hearing scheduled, notice sent, staff recommendation |
   | `programmed` | in a funded transportation or capital program, not yet let |
   | `entitled` | zoning / plat / SUP / land-use approval granted or recorded |
   | `permitted` | permit approved or issued, work not shown to have started |
   | `under_construction` | inspections under way, construction, awarded/advertised contract |
   | `completed` | final inspection, CO, construction complete (only on a construction record) |
   | `denied`, `withdrawn` | existing decision contract (§7.05) |
   | `cancelled`, `expired` | terminal, administrative |
   | `on_hold` | hold, suspended, stop work |
   | `closed_unspecified` | "Closed" with no stated reason |
   | `not_established` | blank, UNKNOWN, opaque code |

3. **Evidence**: the verbatim status (already stored as `app_projects.stage`), the rule that mapped it
   (`stage_basis`: `status_map` | `status_const` | `issued_promotes`), `stage_rule_version`, the record URL
   and its precision, and the publisher's own date. Never the fetch time (§7.05: a recent fetch is not a
   decision check).

### 4.2 Where each piece lives (one path, no new classifier)

- **Per-source adapter = interpretation only.** Each registry entry gains `record_class` and
  `status_to_stage` (verbatim status → national stage), replacing `status_to_bucket`. This is the only
  per-source knowledge, the same place it lives today. `status_const` names a stage, not a column.
- **National column rule = one table, in one module.** `STAGE_TO_COLUMN[class][stage]`, in
  `lib/project-type.js` (already loaded by every page and generated into
  `supabase/functions/_shared/project-type.generated.js` for the engine). The connector computes the
  bucket from it; nothing else maps a stage to a column. Proposed table:

  | stage | column | notes |
  |---|---|---|
  | preliminary | Proposed **or** Lifecycle unknown | decision D1; never counted as an active application |
  | filed, under_review | Proposed | |
  | programmed | Proposed | normalises the 3 DOT entries that say Approved |
  | entitled | Approved | card: "construction status not verified" |
  | permitted, under_construction | Approved | |
  | completed | Operating now | only when class is a construction class; for land-use classes → Approved |
  | denied, withdrawn | Proposed + decision notation | unchanged §7.05 |
  | cancelled, expired | kept, not active (D2) | today: dropped |
  | on_hold | Lifecycle unknown (D4) | today: dropped |
  | closed_unspecified, not_established | Lifecycle unknown | |

- **`lifecycleKey()` is unchanged.** Four keys, the same labels, the same stored `status` strings. No new
  column, no new chip.
- **C1, C2 and C3 become readers of the stage** instead of regexing `stage`. `claim-contract.mjs` maps
  stage → RECORD_STATUS by table; `national-report.ts` replaces `STAGE_EVIDENCE` with
  `stage in (permitted, under_construction)`; `STAGE_WORD` is retired for the card line (4.3).

### 4.3 Card descriptions and link labels

- One function, `HS.recordStageLine(class, stage, decision)` in `lib/project-type.js`, with a Python twin in
  `gen_zip_pages.py` pinned by a parity test (the `decision-vocabulary-parity` pattern). Examples:
  "Pre-application contact recorded — formal application not verified", "Development application
  submitted — decision pending", "Permit approved — construction status not verified", "Zoning amendment
  recorded — project construction status unknown", "Construction underway — completion not verified".
  It replaces `currentStatusLine`'s fixed "Application on file" for every non-application class.
- One link-label decision, `HS.recordLinkLabel(precision)`, used by Map 1 and the ZIP page:
  `record` → "View official government record", `dataset` → "Official government dataset",
  `agency` → "Government agency information". Precision comes only from the engine's
  `record_url_precision` (a new value `agency` for entries whose `dataset_url` is an agency landing page),
  carried through to Map 1 sites. `recordKind()`'s URL-host guessing is removed.

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
- **Previously excluded records reappear** (terminal and on-hold states). That raises row counts and
  `development_reports` row sizes. It must be measured per ZIP against the cache size ceiling before the
  bucket is enabled, and can be enabled per stage.
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
7. **Excluded states (D2, D4)** last, after their size measurement.

## 7. Nationwide regression test plan

- **Semantic parity test:** a fixture of (class, verbatim status) pairs drawn from every registry entry,
  grouped by meaning ("closed zoning case", "issued permit", "final inspection", "programmed STIP",
  "pre-application", "withdrawn", "expired", "hold"). Same meaning ⇒ same stage and same column in every
  state, or the test names the source that disagrees.
- **Negative pins:** no land-use class may reach Operating; no `status_const` may name a column; no
  `exclude`; `closed_unspecified` never reaches Operating; a pre-application never prints "Application on
  file"; a dataset link never reads "official government record".
- **No-inflation check:** per ZIP, total development records before = after, except the explicitly
  re-admitted terminal/hold stages, which are counted separately. No unknown record moves to Proposed.
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
| Map 1 counts / columns | Large visible moves (thousands Operating → Approved/Unknown). | Per-class enablement; national moved-count report before each step. |
| ZIP pages, `indexable`, Rule F/D | Rule D counts publishable development; status moves do not change membership, but re-admitted terminal records could. | Terminal states excluded from Rule D and indexability counts. |
| MAPS eligibility (`ELIGIBLE_STATUS = {Proposed, Approved}`) | Records leaving Operating become postable; **`mapsDedupeKey` folds status**, so a moved record can mint a new social draft. | Add stage to eligibility (preliminary and terminal not postable); exclude reclassification from the dedupe key or freeze drafts during rollout. |
| Project pages (`development-seo-projects`) | `status` is a page fact, so `changed_on` and sitemap lastmod move for every moved project ⇒ IndexNow mass-change hold. | Treat reclassification as a rule-version change, not a fact change; or release with `allow_mass_change`. |
| Development Activity Report snapshots | Immutable; old reports keep old wording. | Correct by design; new reports carry `stage_rule_version`. |
| Change ledger | None: `status` is derived (rule 3). | Pinned by existing test. |
| N5 generations | Markers carry status from the snapshot; change appears only on the next generation. | Sequence after a generation; pre-activation proof unchanged. |
| Cache size | Re-admitted records grow rows. | Measure; enable per stage. |
| Founder rulings | §7.05 vocabulary (denied/withdrawn only), §7.12a issued-is-approved. | Unchanged; D2 is the only conflict and is a founder decision. |

## 9. Decisions needed before implementation

- **D1. Preliminary activity column.** Proposed (with "formal application not verified", never counted as
  active) or Lifecycle unknown. Recommendation: **Proposed**, because a neighborhood contact is
  first-party evidence that a development is planned, and the card says what is not known.
- **D2. Cancelled and expired records.** The brief says preserve terminal states; the 2026-09-20 ruling
  limited the decision vocabulary to denied/withdrawn and today these are dropped. Options: keep dropping;
  or keep them in Proposed with an "Expired / Cancelled on the record" notation, excluded from every
  active count. Recommendation: keep, notated, not counted.
- **D3. Completed demolition / abatement / resurfacing.** "Operating now" reads oddly for a finished
  demolition. Options: Operating now, or Lifecycle unknown for non-building work. Recommendation:
  Lifecycle unknown with "Demolition completed".
- **D4. On hold / stop work.** Recommendation: Lifecycle unknown with "On hold on the record", instead of
  dropped.
- **D5. Ambiguous "Closed" on permits.** Recommendation: Lifecycle unknown unless the publisher's own
  vocabulary documents Closed as completion (recorded per source with the evidence).

Nothing in production has been changed.
