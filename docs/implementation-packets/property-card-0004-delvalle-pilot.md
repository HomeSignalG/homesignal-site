# PROPERTY CARD 0004 — Del Valle / 78617 pilot build brief

**Pilot subject (founder, 2026-08-11): `2200 CALDWELL LN, DEL VALLE, TX 78617` — this address, live at
`homesignalmap.html?addr=2200%20CALDWELL%20LN%2C%20DEL%20VALLE%2C%20TX%2078617`.** Single subject.
See §4 for exactly what it can and cannot support, because the answer constrains two modules.

**Status:** ready to hand to a build session **now**. The four founder decisions in §1 each have a
stated safe default, so an unanswered one changes what the card *says* but never blocks the build.
Only two things halt it, both in §14.
**Supersedes** the first draft of this brief. Every premise below was measured against the live
database on **2026-08-11**, not inferred from documentation — the queries and their results are
inline, because six premises in the draft were false and one of them would have stopped the build.

---

## 0.0 THE GOVERNING PRINCIPLE — the screenshot is a design target, not a data target

**Build the card to look like Property Card 0004. Build every module and every slot in it, now.
Then render the correct coverage state in any slot the data does not support.**

The mockup's numbers, parent company, violations, penalties, hazards and notices are **presentation
placeholders**. They are what the card will look like *when the feeds land*. They are not a
description of what exists today, and none of them may be reproduced as a measured value. Where the
mockup shows a figure and the data does not support one, the slot renders `not_checked` / `partial` /
`unavailable` — never the mockup's number, never a substitute drawn from a different source, never a
zero standing in for "fine".

Both halves of that sentence are load-bearing, and the second is the one most likely to be dropped:

- **Do not fabricate to match the design.** An empty module is the correct output.
- **Do not delete a module because it is empty.** The feeds are coming. Every unsupported slot is a
  labelled gap that a resident can see we know about, and a place a future feed drops into as a
  **data change, not a UI change** — which is exactly the property the read model is designed to have
  (architecture doc Part 25 and Part 26: *"UI: **No change.** `property_card` gains a field"*).

Consequences to hold onto while building:

1. **Every module in 0004 ships in this build**, including the ones that will be entirely
   "not checked" for the pilot: Natural Hazards, Public Meetings & Notices, Sustainability, Recorded
   Instruments, Parent Company Track Record, and the parcel half of Property & Ownership.
2. **Every slot inside a module ships too** — the four hazard perils, the three sustainability rows,
   the five agency rows, the parcel identifier fields. A slot that is absent today cannot be
   distinguished by a resident from a slot we never intend to fill.
3. **Data Completeness enumerates the full intended source set**, not just the wired ones. A coverage
   view that omits what it has not checked is not a coverage view.
4. **Add a regression that the slots survive emptiness.** A future cleanup pass that removes a module
   "because it renders nothing" would silently destroy the coverage claim. Assert every declared
   section and every agency row is present on the pilot address *even though most are `not_checked`*.
5. When a feed lands, the acceptance test is that **only the state and the values changed** — no new
   section, no new tab, no layout edit.

### 0.0.1 The full feed inventory — every slot, and what will fill it

Built from the draft brief's §7/§11/§13/§15/§16/§17/§20/§22 lists **plus** the architecture doc's
Part 30 source inventory and `CLAUDE.md` §8 counts buckets, because the draft's list was not complete
either. **Every row is a slot in the card.** Status is measured, 2026-08-11.

| Feed | Slot it fills | Status today |
|---|---|---|
| **County appraisal district (TCAD)** | Property & Ownership: owner of record, acreage, Property ID, Geographic ID, classification, legal description | none — Part 29 Q3 |
| **County recorder / clerk** | Recorded Instruments: deeds, liens, easements | none |
| **County tax office** | Property & Ownership: tax account, exemptions — a *different* office from the appraisal district | none |
| **County GIS / cadastral** | parcel geometry — the thing that would finally permit a facility-on-parcel or entity-on-parcel claim (`parcel_id` is null on all 66 role rows) | none |
| **State business registry** | entity identity: `companies.legal_name`, `entity_type`, `jurisdiction` — **all NULL today** | none |
| **TDLR / TABS** | Development / Project Activity | **LIVE** — the pilot's 5 filings |
| **County permit portals · planning · zoning** | Development; zoning cases feed Meetings & Notices | partly live via `jurisdiction-registry.json` |
| **EPA FRS** | Facilities & Regulatory Connections | **LIVE** |
| **EPA ECHO** | Entity Track Record → EPA row; Regulatory Records | facility-level via engine v19; **not at entity level** |
| **EPA TRI** | Regulatory Records: toxic releases | none |
| **EPA RCRAInfo** | Regulatory Records: hazardous-waste handler | none |
| **EPA NPDES · GHGRP · SEMS** | Regulatory Records | none |
| **APHIS · FAA · NRC** | Facilities: federally licensed sites | none |
| **TCEQ Central Registry** | Facilities; entity presence | **LIVE** — company-level checks exist, and are empty for the pilot |
| **TCEQ Notices of Violation / Notices of Enforcement** | Entity Track Record → TCEQ row; Regulatory Records | facility-level rows exist, **none for the pilot entities — this is the `partial` in §3** |
| **Other state regulators · CARB · AQMDs** | Entity Track Record → State/Local row | none |
| **OSHA** | Entity Track Record → OSHA row (violations, inspections, penalties) | none — `docs/source-registry.md` says RESEARCH |
| **SEC enforcement + administrative proceedings** | Entity Track Record → SEC row | none |
| **SEC investigation disclosures** (Wells notices, subpoenas, open investigations) | Entity Track Record → SEC row, **kept a separate component** — draft §22 lists it separately and §26 forbids calling any of it a "violation" | none |
| **SEC EX-21 subsidiary exhibits** | Parent Company Track Record — this is the *verification* source, distinct from SEC enforcement | **manual only** — 1 verified edge, read by hand |
| **FRS org affiliations · TCEQ RN↔CN affiliations** | Facility/company relationships — the graph every track-record join depends on | **LIVE** — 33 `project_facility_refs`, 66 `property_company_roles` |
| **State / local enforcement records** | Entity Track Record → State/Local row | none |
| **FEMA NFHL** | Natural Hazards → **Flood only** | none |
| **Wildfire hazard source** | Natural Hazards → Wildfire | none, **and no source has been chosen** |
| **Extreme-heat source** | Natural Hazards → Extreme Heat | none, **no source chosen** |
| **Severe-weather source** (NOAA/NWS the obvious candidate) | Natural Hazards → Severe Weather | none, **no source chosen** |
| **Property-linked meetings & notices** — planning-commission hearings · zoning cases · public-comment periods · environmental notices · permit hearings · annexation notices · road/utility proceedings · tax/incentive hearings | Public Meetings & Notices | **area-level only** (community pages, PMN/Granicus/Legistar/CivicClerk/iQM2/CivicPlus adapters). **No property linkage exists** |
| **WikiRate · company-reported metrics · ESG filings** | Sustainability Disclosures | `company_esg_matches` 55 rows, **none resolved to a pilot company** |
| **Census** | draft §20 lists it under Sources & Verification but **never says what it is for** | none — **ask before building a slot for it** (§0.0.2) |

**⚠ FEMA covers flood, and nothing else.** FEMA publishes the National Flood Hazard Layer; it does
not publish wildfire, extreme-heat or severe-weather layers. Anything in this repo labelling the
hazard module "FEMA flood, wildfire & heat" is a misattribution — the only FEMA reference in the
codebase is `msc.fema.gov`, attached to flood. Wildfire, heat and severe weather each need their own
source **chosen**, and until one is, naming an agency for them would be fabricated provenance.

### 0.0.2 Two feeds that need a definition before they need a slot

- **Census.** The draft lists it as a source but assigns it no field. Without a stated purpose a slot
  for it cannot be honest about what it would contain. **Ask what it is for** (parcel demographics?
  ZCTA geography? the ZIP↔county crosswalk already pinned to `zipcodes` v3.0.0?) before rendering it.
- **"Regulated customer / entity"** (draft §13). This appears to mean the TCEQ customer number (CN)
  as distinct from the regulated-entity number (RN) — the RN↔CN affiliation is what
  `property_company_roles` Operator rows are built from. Confirm the reading before labelling it for
  residents; "customer" is agency jargon that will not survive contact with a homeowner.

---

## 0. Read this first — how this brief differs from the draft

The draft was right about *judgement* and wrong about *inventory*. Its rules on attribution, parent
verification, "not checked ≠ zero", SEC record types, and no-scoring are correct and are preserved
here almost verbatim. What is corrected:

| Draft claimed | Measured reality |
|---|---|
| "evidence architecture already created in Phases 1–9" | Part 31 phases 0–9 are a **proposal**. Phase 0 (stable `app_projects` key) is **not merged and not deployed** (`docs/source-key-productionization-status.md`) |
| inspect `evidence-card.js` | **No such file** in either repo |
| "Phase 9A SEC enforcement work" | **No SEC/EDGAR adapter, table, or read model anywhere** |
| existing "property-card RPC / read model" | **No `property_card` table or RPC.** Not in repo, not in the DB |
| feature-flag mechanism to gate a pilot | **None.** `app_flags` exists but is Local-News-specific and all-off |
| display TCAD owner of record, Property ID 292354, Geographic ID 0315600221, acreage 36.474, class E1 | **None of it exists as data.** `tx_parcels` = 0 rows. Those values appear only as prose in `docs/multi-source-evidence-architecture.md`, each marked `[NOT IN SYSTEM]`. "E1" appears nowhere at all |
| "Phase 7 found no defensible facility-on-parcel claim" | The **conclusion is correct** (`parcel_id` is null on all 66 `property_company_roles` rows), but it is not from a "Phase 7" — Part 31 Phase 7 is the unstarted TCAD/Clerk adapter work |

**Counts in the documentation have drifted, and the docs disagree with each other.** Measured today:
`identity_conflicts` is **0**, where the audit's Part 19 row says 4. `echo_violation_counts` is **0**,
which matches Part 19 but contradicts `CLAUDE.md`, which says *"near-empty (3 rows, 0 with
violations)"*. **Re-measure every count before relying on it, and cite the measurement, not the
document.** (Two numbers in an earlier revision of this brief were themselves wrong — 39 is
`frs_affiliation_role_map`, not `identity_conflicts` — which is the hazard, first-hand.)

---

## 1. FOUNDER DECISIONS — with a safe default for each, so none of them blocks you

These change what the card *says*, so they need a real answer eventually. **None of them stops the
build.** Each has a default below that is honest and reversible; take it, flag it in the report, and
keep moving. Do not resolve one by *inference* (guessing what the founder would want and acting as if
it were decided) — that is different from taking the stated default, which is explicitly authorised.

| | Decision | **Default if unanswered** |
|---|---|---|
| **Q1** | The five `role='Property Owner'` rows | Do not use them for owner-of-record. Render owner-of-record `not_checked`; show them only under "Owner as filed". |
| **Q2** | Ship Property & Ownership with no owner of record? | **Already answered by §0.0** — ship it, with every slot rendering its coverage state. Never defer a module for being empty. |
| **Q3** | Legal sign-off for aggregated enforcement totals | Build the module; the pilot has zero events so no total ships. Flag as outstanding. |
| **Q4** | Named individuals and phone numbers | Show neither. Describe connections without printing the value (§6.2). |

### Q1 — The five "Property Owner" rows

`property_company_roles` contains 5 rows with `role = 'Property Owner'` for the Caldwell filings:

```
role="Property Owner" company_key="river bottoms ranch llc" verification="HIGH_CONFIDENCE"
evidence_tier="authoritative_filing" parcel_id=null
notes="Building owner as stated by the filer to TDLR. Not corroborated against a county deed record."
```

They are **owner as filed**, not owner of record — the notes column says so and `parcel_id` is null.
This is Part 29 **Q2** ("re-predicate the 5 TDLR 'Property Owner' rows to `project_owner_as_filed`?
This *changes what a future card would say* about Del Valle"), still open.

**Until it is answered, the card must not populate "Owner of record" from these rows.** The trap is
real and will be tempting: a row literally labelled "Property Owner" naming River Bottoms Ranch LLC
sits one query away from the Owner-of-record slot, and wiring it there is the exact Part 25 defect.

**Decide:** (a) re-predicate the rows and render them only under "Owner as filed", or (b) leave the
data and have the UI ignore `role='Property Owner'` for the ownership module. Either is defensible.
Doing neither means the module is built on an unresolved semantic.

### Q2 — Ship a Property & Ownership module with no owner of record?

No appraisal-district adapter exists, so **every parcel field renders "Not checked"**: owner of
record, acreage, Property ID, Geographic ID, classification. The module is honest but empty.

**Answered by §0.0: ship it.** Every module and slot in 0004 is built now and renders its coverage
state. Deferring a module because it is empty destroys the coverage claim and turns a future feed into
a UI change. The only open part is whether to *say* an appraisal-district connection is planned —
say it only if there is a written commitment, per §6.1 row 4.

Note for sequencing, not for blocking: `docs/source-key-productionization-status.md` line 225 says
*"Do not start TCAD / the evidence architecture until `6a92a41` is merged and deployed."* That commit
is still unmerged — which affects when the TCAD **adapter** can be built, not whether the card renders
its slots today.

### Q3 — Legal sign-off for aggregated enforcement against named companies

`CLAUDE.md` §7 records that the development tracker's legal framing was **founder-signed-off once**,
for rendering "the public fact + link, never editorialize a named operator into wrongdoing," and
requires the "factual count… not a verdict on any operator" copy on every page.

An Entity Track Record that **aggregates 157 violations and penalty totals against a named company
and its verified parent** is a materially larger legal surface than a facility count. The draft's
word-ban (§8) is necessary but is not the same thing as sign-off.

**Decide:** does the existing one-time sign-off cover aggregated, entity-attributed enforcement
totals, or is a new review required?

**This does not block the pilot build.** The pilot entities have zero events, so there is no
aggregated total to ship — build the module, render its empty state, and flag Q3 as outstanding. It
becomes a stop only at the moment a real total would be displayed (see §14).

### Q4 — Named individuals and phone numbers (found live, 2026-08-11)

The pilot row carries **personal data on every filing**, and **the live dossier is rendering it
today**. Measured from `property_reports.sites[]`:

```
owner_phone       (813) 758-6679 · (813) 758-9100 · (707) 803-1177
contact_name      Scott Padilla · Kristin Lorentzen
filed_by          Jeff Gutknecht · Brian Conklin · Kristin Lorentzen
design_firm_phone / design_firm_addr / owner_addr   — all populated
```

The live page's entity graph is built out of exactly these fields — the screenshots show connection
labels reading *"same phone (813) 758-6679"*, *"same contact: Gutknecht"*, *"same contact: Padilla"*,
with the individuals named again in the evidence list beneath.

This is Part 29 **Q6**: *"Are named individual filers (`filed_by`, `Contact`) shown on the consumer
card? **Recommend: no by default** — public record, but a privacy/product call, not an engineering
one."* Still open. The draft brief's §23 says do not expose phone numbers or contacts — which means
**the new card must not do what the live dossier already does.**

**Decide:** (a) card shows neither individuals nor phone numbers, and connections are described
without naming the shared attribute's value ("two filings share a contact" rather than "same
contact: Gutknecht"); (b) it matches the existing dossier; or (c) the value is masked
(`(813) 758-••••`) or held behind a disclosure, which still lets a reader confirm two records match
without publishing a reachable number.

**Default if unanswered: (a).** Build it that way, flag it, do not wait — §6.2's Connected Entities
copy is already written for it.

Whichever is chosen, **the inconsistency between the two surfaces is itself a bug to file** — one
page cannot treat a phone number as consumer-safe while the other treats it as private.

---

## 2. What already exists — DO NOT REBUILD IT

`property-card.html`, `lib/property-card.js`, and `docs/property-card-redesign.md` already ship (added
in **PR #666**, `cursor/property-card-redesign-80bc`). **Read `docs/property-card-redesign.md` in full
before writing anything.** Already built and tested:

- The full-card layout: header, meta chips, the eight-tab strip, the two-column body with the
  ownership/development rail, the completeness ring, the footer disclaimer.
- The **twelve declared sections** (`HS.card.SECTIONS`) and the tab registry (`HS.card.TABS`).
- The **state vocabulary** (`HS.card.STATES`) and the **metric gate** (`HS.card.metricText`) — the
  only function permitted to print a number on any surface.
- The Maps quick-view → card link, as the first element of the slide-in panel.
- Section rollup, the inline-SVG donut, `keyOf`, `href`, `ctaHTML`.
- Offline suites: `test/property-card.test.mjs`, `test/property-card-page.test.mjs`.
- A localhost-gated render-test hook, `window.__HS_CARD_OVERRIDE`.

**This build's job is to replace the card's data layer with the real evidence graph** (§5), populate
the modules the graph can support, and add what §8 lists as missing. It is **not** to re-do the
layout, re-invent the state names, or create a second card surface.

---

## 3. THE MEASURED PILOT DATA — what the card can truthfully show

All counts below are live reads from 2026-08-11. Reproduce them before building; if they have moved,
trust the new numbers, not this table.

### The property row

```
property_reports  -> exactly 1 row, site-wide
  address        "2200 CALDWELL LN, DEL VALLE, TX 78617"
  zip/county     78617 / Travis / TX
  counts         {"federal": 0, "filings": 5}
  sources_checked[{"src":"EPA FRS","result":"no facility at this address among this ZIP's query results"}]
  source_vintage "get-address-report v17 ZIP mode"
  refreshed_at   2026-08-11T21:44:15Z      ← the daily cron is running
```

### The entity / track-record layer (real, working, and unread by any UI today)

| Table | Rows | Contents |
|---|---|---|
| `company_track_events` | 61 | **100% TCEQ.** `notice_of_enforcement` 35, `notice_of_violation` 24, `administrative_order` 2. `attribution`: direct_company 49, parent_company 12. `evidence_level`: VERIFIED 59, HIGH_CONFIDENCE 2. **`penalty_amount` present on only 2 rows.** `violation_count` sums to 157. Three companies only: `txi operations lp` 26, `martin marietta materials southwest llc` 23, `martin marietta materials inc` 12 |
| `track_record_checks` | 17 | The abstention layer, with `query_basis`, `result_count`, `checked_at`, `source_url`. TCEQ Central Registry (company) 9 · TCEQ Notices of Violation (facility) 4 · TCEQ Notices of Enforcement (facility) 2 · EPA ECHO facility summary 2 |
| `company_parents` | 8 | One `verified` — Martin Marietta Southwest → Martin Marietta Inc, via **SEC Exhibit 21.01, accession 0001193125-26-059193**, read by hand. `txi operations lp` is `unverified_candidate`, `method=sec_full_text_search`, notes begin **"HOLD."** |
| `property_company_roles` | 66 | `Operator` 61, `Property Owner` 5. 15 ZIPs; **78617 has 13**. **`parcel_id` is null on all 66** |
| `project_facility_refs` | 33 | `EPA_FRS` + `TCEQ_RN` refs with a prose `basis`, e.g. *"TCEQ regulated entity matched on exact facility name AND exact address (3901 NORWOOD LN STE 1)"* |
| `companies` | 45 | Keeps `neuralink` and `neuralink corporation` as **separate rows**, noting *"NOT merged … no source states the equivalence"* |
| `tx_parcels` · `app_environmental_risk` · `echo_violation_counts` · `identity_conflicts` | 0 · 0 · 0 · 0 | empty |

### The pilot row's five filings, in full

Read from `property_reports.sites[]` on 2026-08-11. **This is the entire dataset for the pilot
address** — build against these values, do not re-derive them.

| Project | Filed | Label | Owner **as filed** | Status **as filed** |
|---|---|---|---|---|
| `TABS2023006483` | 2022-12-27 | Histology Lab | River Bottoms Ranch | Project Closed |
| `TABS2023006449` | 2023-01-09 | River Bottoms Ranch Barn 2 | River Bottoms Ranch LLC | Inspection Complete |
| `TABS2024016698` | 2024-04-30 | Barn 2 ACT Office | RIVER BOTTOMS RANCH LLC | Inspection Complete |
| `TABS2024022676` | 2024-07-15 | ATX1 New Construction | Neuralink | Review Complete |
| `TABS2026011928` | 2026-03-02 | ATX1 — Third Floor Tenant Improvement | Neuralink Corporation | Review Complete |

Derived totals, which the live dossier already displays and the card may reuse: **5 filings ·
$27,900,000 total filed cost · 174,717 sq ft filed · 4 distinct owner strings** (`River Bottoms Ranch
LLC` / `River Bottoms Ranch` / `Neuralink` / `Neuralink Corporation`; the fifth filing's
`RIVER BOTTOMS RANCH LLC` collapses case-insensitively). Every filing carries a `record_url` to
`tdlr.texas.gov/TABS/Projects/<project_no>`.

**`sites[]` holds 5 records and zero of them are federal/registry records** (`counts.federal = 0`, no
`registry_id`, no `env` payload on any site). That is decisive for the track-record modules: there is
no facility at this address for EPA ECHO or the TCEQ Central Registry to key on, so those rows are
`not_checked` at the property level.

**Fields in `sites[]` that must never reach the screen** (§23): `owner_phone`, `owner_phone_norm`,
`owner_addr`, `contact_name`, `filed_by`, `design_firm_phone`, `design_firm_addr`, plus the internal
`needs_review`, `match_type`, `matched_address`, `geocode_source`, `rel_rule`, `layer`, `e`, `n`.

### Track record for the pilot entities specifically

```
company_track_events WHERE company_key ~ neuralink|river   ->  []          (zero events)
track_record_checks  WHERE subject ~ neuralink|river        ->  4 rows,
    all agency=TCEQ, dataset="Central Registry", subject_kind="company", result_count=0
```

### ⚠ Read the dataset, not just the agency — the TCEQ row is `partial`, not `checked_empty`

The four TCEQ check rows are all `dataset = "Central Registry"`. That is a **registry-presence**
query: *does this company have regulated entities on file?* Answer: none.

TCEQ's **enforcement** datasets are checked in the same table — `Notices of Violation` (4 rows) and
`Notices of Enforcement` (2 rows) — but every one of those has `subject_kind = 'facility'` and belongs
to a TXI facility. **TCEQ enforcement has never been checked for the pilot companies.**

So a single row reading "TCEQ — Checked, no records found" would assert an enforcement check that did
not happen. The honest rendering is either:

- **`partial`** on the TCEQ row, with the sub-detail naming which dataset was checked and which was
  not, or
- two rows: *TCEQ Central Registry — checked, no records found* and *TCEQ enforcement — not checked*.

**This is the pilot's one live example of `partial`**, and it is the case that proves the state earns
its place in the vocabulary. Derive per-agency state from **(agency, dataset)**, never from agency
alone — an agency with several datasets is `partial` when only some were queried.

**So the honest Caldwell card is:** TCEQ = ***Partial*** (Central Registry checked and empty on
2026-08-09 with `query_basis` and `source_url`; enforcement not checked) · EPA FRS = *Checked — no
records found* at the address · EPA ECHO, OSHA, SEC, State/Local = *Not checked* · 5 real TDLR
filings · everything else *Not checked*.

**Ten of twelve modules will read "Not checked," and the flagship Entity Track Record will contain
zero measured events.** That is the correct output, and the draft's illustrative "14 violations /
$163,750" is unobtainable. Do not treat this as a build failure.

---

## 4. THE PILOT SUBJECT — 2200 Caldwell Ln, and what it constrains

**Decided (founder, 2026-08-11): 2200 Caldwell Ln is the pilot subject.** Build the card for this
address. The consequences below are not objections — they are the scope the build has to be honest
about, and they belong in the final report.

### What Caldwell proves

Everything about the *state machinery*, which is the hard and novel part:

- a **receipted `checked_empty`** — TCEQ Central Registry, checked 2026-08-09, `result_count = 0`,
  with `query_basis` and `source_url` to show for it
- a **real `partial`** — the same agency's enforcement datasets were never queried, so the TCEQ row
  cannot claim a clean enforcement check (§3)
- a **`not_checked` that never renders a zero** — EPA ECHO, OSHA, SEC, State/Local
- an **absent parent** rendering as "No verified parent company established"
- an **unresolved parcel** — every TCAD field "Not checked", with owner-of-record never borrowing an
  owner-as-filed value
- **five real filings** with correct owner-as-filed, status-as-filed and per-record links
- a genuinely rich **connected-entities** graph (§4.2)

### What Caldwell cannot prove, and what to do about it

`company_track_events` returns **zero rows** for these entities, so **Entity Track Record and Parent
Company Track Record ship with no measured events**. Their count/summary/intelligence-sentence paths
will be exercised only in their empty and not-checked branches. The modules are correct but untested
in the state that matters commercially.

Two ways to close that, both cheap, neither expanding the pilot:

1. **Preferred — fixture-test the populated path.** Drive the same code with the real Martin Marietta
   / TXI rows through the localhost-gated `window.__HS_CARD_OVERRIDE` hook, and assert in
   `test/property-card*.test.mjs` that 49 direct events, 12 parent-attributed events, 157 summed
   violations and a `penalty_amount` present on only 2 of 61 rows render correctly. No new pilot
   surface, no new route, real data shapes.
2. **Optional — a second validation subject, not a second pilot.** `TXI - GARFIELD SAND & GRAVEL`
   (EPA FRS `110070182593`) is already a facility pin on the Del Valle map, with TCEQ `RN106540172`
   at 3901 Norwood Ln, `Operator` roles for `txi operations lp` and
   `martin marietta materials southwest llc` (both `VERIFIED` / `identifier_backed`), and a verified
   parent edge to `martin marietta materials inc` sourced to SEC Exhibit 21.01. It has **no
   `property_reports` row**, so reaching it needs facility-identity entry or a generated row — which
   is why it is optional and explicitly out of scope unless the founder asks for it.

**Do not** populate Caldwell's track record from Martin Marietta / TXI data to make the module look
alive. Those entities have no relationship to this property, and asserting one would be the exact
false-join the whole card exists to prevent.

### 4.2 Connected entities — the module with real content

The live dossier already computes this client-side from `sites[]`, and it is the richest thing the
pilot has after the filings. The gate it uses is good and must be preserved: a connection is drawn
only when a shared attribute appears on **≥2 distinct records AND ≥2 distinct entity names**.

Measured for the pilot: **4 owner strings, 3 of which participate in connections**, linked by a
shared owner phone across `TABS2023006449` / `TABS2024016698` / `TABS2024022676`, and by a shared
filer/contact across `TABS2023006449` / `TABS2023006483` / `TABS2024016698` and
`TABS2023006483` / `TABS2024022676`.

Two constraints:

- **Q4 applies here.** The card must not label a connection with the personal value that produced it.
  "Two filings share an owner phone number" carries the same evidentiary weight as printing the
  number, without publishing it.
- **Keep the existing caveat verbatim** — the live page's *"These are facts from the filings — a
  connection means two records share a detail, not a verdict on any operator"* is exactly right and
  should not be reworded.

### 4.3 A live copy defect to fix while you are here

The production dossier's header currently reads **"4 owners of record"** for what are four
TDLR-filed owner strings. That is the precise conflation this card is built to prevent, live today.
`companies` in the database is more careful than the page — it keeps `neuralink` and
`neuralink corporation` as separate rows, noting *"NOT merged … no source states the equivalence."*

Fix the header copy to **"4 owners as filed"** (or similar) in the same change, and note it in the
report. It is a two-word fix to a factual claim.

---

## 5. THE EXACT JOIN PATH — verified, and fragile

Use this. Do not derive states from `property_reports.sources_checked` alone (that is what the
current card does, and it is why every agency reads "Not checked").

```
                      ┌── property/parcel modules ──────────────────────────────┐
  canonical address ──┤  property_reports (sites[], sources_checked, counts)    │
                      └─────────────────────────────────────────────────────────┘

                      ┌── track-record modules ─────────────────────────────────┐
  app_projects.id ────┤ property_company_roles (role, verification,             │
   (facility or       │                         evidence_tier, notes)           │
    development row)  │        └─> company_key                                  │
                      │              ├─> company_track_events   (the events)    │
                      │              ├─> track_record_checks    (the abstentions)│
                      │              └─> company_parents        (verified only)  │
                      │ project_facility_refs (EPA_FRS / TCEQ_RN + basis)        │
                      └─────────────────────────────────────────────────────────┘
```

State is derived from `track_record_checks` joined on `subject_key`/`subject_kind`, **per (agency,
dataset)** — not per agency, for the reason in §3:

- a check row with `result_count > 0` → **records found**
- a check row with `result_count = 0` → **checked, no records found**
- **no check row at all** → **not checked** (Part 12's definition: row absent *is* the state)
- some of an agency's datasets checked and others not → **partial** (this is what Caldwell's TCEQ row
  is, and it is why the agency-level rollup must be computed from dataset-level states)

Counts come from `company_track_events`, split by `attribution` (`direct_company` vs
`parent_company`) so the two modules never mix. **`penalty_amount` is null on 59 of 61 rows** — the
penalty metric must render an em-dash for those, not `$0`.

### ⚠ The fragility that will silently empty the flagship module

`property_company_roles.project_id` and `project_facility_refs.project_id` are **`app_projects.id`**,
which `app_refresh_zip` regenerates by delete-and-insert. The stable-key fix is Part 31 Phase 0 and
is **not merged**. All 5 Property Owner rows and the 3 facility refs sampled resolve **today**
(2026-08-11):

```
487a359b… -> TXI - GARFIELD SAND & GRAVEL        (78617)
1faf7b33… -> TXI - GARFIELD SAND & GRAVEL PLANT  (78617)
d0e48fdd… -> BFI RECYCLING CENTER MANOR          (78617)
<5 roles>  -> River Bottoms Ranch Barn 2 / Barn 2 ACT Office / ATX1 Third Floor TI /
              ATX1 New Construction / Histology Lab   (all 78617)
```

Sampled, not exhaustive — 3 of 33 `project_facility_refs` were checked. The preflight below must
cover every row the pilot actually reads.

They can break on the **next ZIP refresh**. Requirements:

1. Add a **preflight assertion** that every pilot `project_id` resolves, and **fail loudly** if not.
2. Never render a silently-empty track record that is really a broken join — a join that returns
   nothing must be distinguishable from a source that returned nothing. **An orphaned join is
   `unavailable`, never `checked_empty`.**
3. Report whether this build should wait for `6a92a41`.

---

## 6. ONE state vocabulary — not three

The draft invented three different lists (§15, §17, §21), none matching, and introduced
"Not applicable" and "checked — no condition identified" once each. **Use `HS.card.STATES` and
nothing else:**

`verified` · `reported` · `checked_empty` · `conflicting` · `unresolved` · `partial` ·
`in_progress` · `not_checked` · `unavailable` · `access_restricted`

Adding a state is a deliberate change to `lib/property-card.js` plus its test — not an ad-hoc label
in one module. If `not_applicable` is genuinely needed, add it there with a written justification for
why no existing state fits.

**Also drop "during the period reviewed"** from every intelligence sentence, or source it. Nothing
records a per-source review period today, so the phrase is a provenance claim we cannot back. Where a
real window exists, use it (ECHO's `FacQtrsWithNC` is 12 quarters; `track_record_checks.checked_at`
is a real timestamp; TABS filings carry dates). Otherwise say nothing about the period.

---

## 6.1 THE DECISION TABLE — what to render when you cannot populate something

**Use this for every empty slot.** Work down the questions in order and take the first that applies.
`<X>` is the source name as a resident would recognise it.

| # | Ask | Then the state is | Metric renders | Sentence pattern |
|---|---|---|---|---|
| 1 | Did a read we performed **fail** (HTTP error, timeout, parse failure)? | `unavailable` | `—` | "The `<X>` source was unavailable during the latest check, so its records are unknown." |
| 2 | Does the source **exist but refuse** automated access (403, login wall, robots restriction)? | `access_restricted` | `—` | "`<X>` does not permit automated access, so its records cannot be read." |
| 3 | Is the **join broken** — a `project_id` or `company_key` that no longer resolves (§5)? | `unavailable` | `—` | "This property's link to `<X>` could not be resolved, so its records are unknown." **Never `checked_empty`.** |
| 4 | Is the source **being built** and genuinely not queryable yet, on the record? | `in_progress` | `—` | "`<X>` is being connected and is not queryable yet. No result is implied." Only if a **written** commitment exists — otherwise use row 6. |
| 5 | Were **some of the source's datasets** checked and others not (§3)? | `partial` | `—` at agency level; real values per checked dataset | "`<X>` records are partially available: `<dataset A>` was checked, `<dataset B>` was not. Coverage is incomplete." |
| 6 | **No check exists at all** for this source and subject? | `not_checked` | `—` | "`<X>` records have not been checked for this property. This is a gap in our research, not a finding." |
| 7 | Was it checked and did it return **nothing**? | `checked_empty` | **real `0`** | "No `<X>` records were identified for this property in the source checked." Show the receipt: `checked_at`, `query_basis`, `source_url`. |
| 8 | Did it return records, from a **register of record**? | `verified` | real values | "`<X>` records show `<n>` `<thing>` associated with `<subject>`." |
| 9 | Did it return records that are **as-filed assertions** (a permit, an application)? | `reported` | real values | "`<n>` `<thing>` as filed with `<X>`. Values are as stated by the filer." |
| 10 | Do **two sources contradict** each other? | `conflicting` | both values, both attributed | "`<X>` and `<Y>` disagree on `<field>`. Both are shown with their sources." Never silently pick one. |
| 11 | Do records exist but **resolve to no single answer**? | `unresolved` | `—` | "`<X>` records exist but do not resolve to one answer, so none is presented as the answer." |

### The two cases the state vocabulary does NOT cover

These are a **different axis** from coverage, and conflating them with `not_checked` is a factual
error — it claims we failed to look at something we did in fact read.

**(a) A field the record does not state.** We have the record; the record is silent on this field.
`CLAUDE.md` §8 is explicit: *"A field the source page doesn't state is not on the site object. Never
default, never infer, never interpolate."*

- Render **"Not stated on the record"** (or omit the row entirely), **never "Not checked"**.
- **Exclude it from Data Completeness.** A field a source chose not to publish is not a gap in our
  research, and counting it as one would misstate our coverage in the pessimistic direction.
- **The pilot has exactly one instance**, measured: `contact_name` is absent on `TABS2023006449` and
  `TABS2024016698` and present on the other three. Every other field is populated on all five
  filings — so the pilot is a *weak* test of this rule, and the one gap it does have is in a field
  **Q4 excludes from the card anyway**.
- That makes the rule forward-looking rather than pilot-proven: it will bite the moment a source with
  patchy fields lands (a TCAD parcel with no classification, a recorder instrument with no date).
  Cover it by fixture rather than pretending the pilot exercises it.

**(b) A metric that is not derivable from records we do have.** The source returned records, but this
particular number is not among them.

- The gate already handles the value: `HS.card.metricText('verified', NaN)` → `—`.
- **But an em-dash beside "Penalties" reads as zero to a careless reader**, so it needs words:
  "`<X>` returned records but no penalty figure." The pilot's live case is exactly this —
  `penalty_amount` is null on 59 of 61 `company_track_events` rows.

---

## 6.2 THE COPY LIBRARY — what the resident actually reads

**Missing data is never a blocker.** Pick the state from §6.1, then pick a sentence from below.
Alternatives are interchangeable in meaning — choose by length and context, do not stop to ask.

**These are USER-FACING, so they are written for a homeowner, not for an auditor.** Two registers,
both required:

- **Plain line** — what shows in the module. Short, human, second person where it helps. The
  resident's real question is *"what does this mean for me?"*, and for an unchecked source the honest
  answer is **"we haven't looked here yet, so we can't tell you either way."** Say that.
- **Receipt** — the precise version, behind the disclosure / in Sources & Verification, carrying the
  date, the dataset and the link. This is where the auditor's language belongs.

Words to keep out of the plain line: *entity · dataset · coverage · attribution · records identified ·
absence · queried · verified parent · regulatory event · not applicable.* Say **"the companies named
on filings here"**, not "the entities connected to this property".

### The page-level explainer — write this once, near the top

On the pilot card most sections are blank, and twelve separate apologies read worse than one honest
sentence. Lead with it:

1. "Blank sections mean we haven't checked that source yet — not that there's nothing to find. We'd
   rather show you the gap than guess."
2. "Where we haven't looked, we say so. An empty section is a gap in our research, not an all-clear."

### Entity Track Record — agency row

| State | Plain line (pick one) | Receipt |
|---|---|---|
| **Not checked** | (1) "We haven't checked `<X>` yet for the companies named on filings here — so we can't tell you either way." · (2) "Not checked yet. This isn't a clean record or a bad one; we just haven't looked here." · (3) "We don't have `<X>` records for this property yet." | "`<X>` has not been queried for `<company>`. No `source_check` row exists." |
| **Checked, nothing found** | (1) "We searched `<X>` on `<date>` and found nothing for the companies named here." · (2) "We looked, and `<X>` had no records for these companies." | "`<X>` `<dataset>` queried `<date>`, `result_count` 0. Basis: `<query_basis>`. Source: `<url>`." |
| **Partly checked** | (1) "We've searched part of `<X>` — one of its lists came back empty. We haven't searched its `<other>` records yet, so this isn't the full picture." · (2) "Partly checked. One `<X>` list was empty; another we haven't searched." | "`<X>`: `<dataset A>` queried `<date>`, 0 results; `<dataset B>` not queried." |
| **Couldn't reach it** | (1) "We tried to check `<X>` and couldn't reach it. For now this is unknown, not empty — we'll try again." · (2) "`<X>` didn't respond last time we checked." | "`<X>` read failed `<date>`: `<error>`. Not recorded as empty." |
| **Blocked** | (1) "`<X>` is public, but it blocks automated searches — so we can't read it for you." · (2) "This source won't let software search it, so we can't show what's in it." | "`<X>` returned `<status>` to automated retrieval. Access restricted, not empty." |
| **Being connected** | "We're connecting `<X>` now. It isn't searchable yet." | "`<X>` ingestion in progress. No result implied." |
| **Link broken** | "We couldn't match this property to its record in `<X>`, so we can't tell you what's there." | "Join unresolved: `<key>` did not resolve. Rendered unavailable, not empty." |
| **Records found** | (1) "`<X>` shows `<n>` `<thing>` for companies named on filings here." · (2) "`<n>` `<thing>` on record with `<X>`." | "`<n>` `<thing>`, `<X>` `<dataset>`, retrieved `<date>`. Per-event detail below." |
| **As filed** | "`<n>` `<thing>`, as the applicant described them. We show what was filed, not our own assessment." | "`<n>` records, evidence tier: authoritative filing. Values as filed, not corroborated." |

**Attribution line, always shown with this module:** "These records may involve other locations these
companies are connected to — not necessarily anything that happened at this address."

### Parent Company

- **None confirmed** — (1) "We haven't confirmed a parent company for the companies here. A similar
  name or a shared address isn't enough for us to link them." · (2) "No confirmed parent company. We
  only show one when a public document proves the link."
- **A possibility on file, unconfirmed** — "We've seen a possible parent company but haven't confirmed
  it, so we're not showing its history here."
- *Receipt:* "No `company_parents` row with `verification='verified'`. Candidate rows are held and not
  promoted."

### Property & Ownership

- **County records not read** — (1) "We haven't read the county's property records for this address
  yet, so the owner on record, the acreage and the parcel numbers aren't here." · (2) "The owner on
  record comes from the county appraisal district. We haven't connected to it yet."
- **The filing is silent** — (1) "The filing doesn't say." · (2) "Not on the record."
- **Owner-as-filed caveat, always** — "This is the owner the applicant wrote on the permit. It's often
  a different company from whoever owns the land, and we never use one to fill in the other."

### Development / Project Activity

- **Records found** — "`<n>` permits have been filed at this address. Each one links to the official
  record."
- **Empty** — "No permits have been filed at this address in the records we searched."

### Facilities & Regulatory Connections

- **Nothing at this address** — "There's no regulated facility at this address in the records we
  searched. The facilities on the map are nearby ones — they aren't part of this property."
- **Connections, but nothing tied to the parcel** — "We found regulatory connections to companies
  linked to this property. We haven't tied any facility to this parcel itself."

### Natural Hazards — per peril

- **Flood, not read** — "We haven't checked flood maps for this parcel. That doesn't mean it's outside
  a flood zone — we just haven't looked yet."
- **No source chosen for this peril** — (1) "We don't have a `<peril>` source yet, so this hasn't been
  checked." · (2) "`<peril>` isn't covered by anything we read yet."

### Public Meetings & Notices

- **Not linked to addresses yet** — (1) "We track meetings and notices for this ZIP and county, but we
  can't tie them to a single address yet." · (2) "Nothing here is matched to this address specifically.
  Notices for the area are on your community page."

### Sustainability Disclosures

- **Nothing matched** — "We haven't matched any sustainability reporting to the companies here."
- **Caveat, always** — "These are figures companies publish about themselves — not regulators'
  findings."

### Recorded Instruments

- **Can't search it** — (1) "We can't search this county's deed records automatically yet, so deeds,
  liens and easements aren't here." · (2) "County recorder records are not currently available through
  HomeSignal's automated sources for this property." *(the draft brief's §18 wording — the more formal
  of the two; either is acceptable)*
- **If appraisal-district references land** — "Instrument references as reported by the county
  appraisal district. These aren't verified deed records."

### Regulatory Records

- **Empty** — "We don't have individual records to show for the companies named on filings here."

### Connected Entities

- **Links found** — "`<n>` companies named on filings here share a detail with one another. Sharing a
  detail means two records match — it doesn't mean the companies are the same, and it isn't a finding
  about any of them."
- **None** — "No filing here shares a detail with another."

### A number we don't have

- "We have records, but no `<metric>` figures in them." *(the pilot's live case: `penalty_amount` is
  null on 59 of 61 events)*

### Copy that is forbidden in every empty state

Never render, for anything that was not actually checked and found empty: **"No violations"** ·
**"None"** · **"Clean"** · **"0"** · **"No known issues"** · **"Compliant"** · **"No risk"** ·
**"Up to date"** · a green tick · a reassuring colour.

The rule behind all of them: **absence of evidence renders as absence of evidence.** A resident must
never be able to read "we have not looked" as "there is nothing to find" — and every phrase above
invites exactly that read.

---

## 7. Layout — decide before building, do not discover during

The draft prescribed a persistent map at 25–30% beside a card at 70–75%. **That conflicts with a
verified launch invariant.** `maps.html` is a full-bleed map stage with an absolutely-positioned
`.sidepanel` inside `#mapWrap`, and `docs/maps-launch-readiness-audit-2026-07-23.md` records
"marker click opens the right slide-over with **no navigation**, one panel only (`openCount=1`)" as a
founder launch spec, asserted **on production** by `scripts/verify-maps-live.mjs`.

Two options. Pick one, in the report, with the trade-off stated:

- **(a) Separate page** (what ships today). Preserves the one-panel invariant and every live
  assertion; the map is reached by "← Back to the map" rather than being persistently visible.
- **(b) In-map takeover panel.** Matches the mock's left rail, but changes the verified layout and
  requires updating `verify-maps-live.mjs` in the same change.

Do not half-build (b) and leave the verifier asserting (a).

---

## 8. Modules — corrections to the draft, module by module

Keep the draft's §9, §10, §12, §13, §14, §19, §21, §26, §29 **as written** — they are correct. Apply
these corrections:

- **Entity Track Record.** Read the join path in §5, not `sources_checked`. State is per **(agency,
  dataset)** and the agency row is a rollup of those (§3) — the pilot's TCEQ row is `partial`, not a
  clean empty. Split direct from parent by `attribution`. Render the receipt behind a disclosure:
  `query_basis`, `checked_at`, `source_url` from `track_record_checks` — that receipt is what makes
  "checked, no records found" believable, and it is also what shows *which dataset* was checked.
- **Parent Company.** Only `company_parents.verification = 'verified'`. The `unverified_candidate`
  row is marked "HOLD" in the data; honour it. For Caldwell the answer is
  **"No verified parent company established."**
- **Property & Ownership.** Gated on Q1 and Q2. Every parcel field is `not_checked` today. Do not
  borrow `role='Property Owner'` into owner-of-record.
- **Development.** The one genuinely rich module: 5 TABS filings, owner **as filed**, status as
  filed, dates, per-record links. No role collapsing.
- **Facilities & Regulatory.** `parcel_id` is null on all 66 role rows, so there is no
  entity-on-parcel claim either — the draft's §13 gap is broader than it says. Wording:
  "Regulatory connections identified". Rename the map card to
  **"Nearby regulated facility · 1.3 mi"** (it currently reads "Regulated facility · 1.3 mi").
- **Natural Hazards.** `app_environmental_risk` is 0 rows. All four slots `not_checked`.
- **Meetings & Notices.** No property linkage exists. `not_checked`, with a link to the ZIP's
  community page for area-level notices. Never "no meetings".
- **Sustainability.** `company_esg_matches` has 55 rows but none resolved to a pilot company.
  `not_checked`. Never enters enforcement counts.
- **Recorded Instruments.** No recorder adapter, and **no TCAD instrument references exist as data**
  (deed `2021024697` is prose-only). The draft's "display the TCAD-reported instrument references"
  is unbuildable — render `not_checked` with the source limitation.
- **Connected entities.** Real content for the pilot — see §4.2 for the ≥2-records/≥2-names gate,
  the Q4 constraint on labelling connections with personal values, and the caveat copy to preserve.
- **Regulatory Records.** The event list from `company_track_events`. **Empty for the pilot address**
  — render the empty state, do not borrow another entity's events. Exercise the populated path by
  fixture (§4). Do not duplicate the event list inside Entity Track Record.
- **Sources & Verification.** Add `source_vintage` and `retrieved_at`/`checked_at` where the row
  carries them. Never expose internal enum strings.
- **Data Completeness.** Already built, no percentage. Keep the disclaimer exactly as shipped.

---

## 9. Performance — the real budget

There is no property-card RPC and one cannot be built without the claim layer. The honest budget:

- 1 read of `property_reports` (single row).
- 1 batched read per track-record table, scoped to the pilot company keys — **not per agency, per
  company** (that is the N+1 to avoid).
- The address-resolution fallback currently reads a whole `development_reports` row (heaviest
  site-wide is Cleveland 44127 at ~6 MB). Prefer carrying `canonical_addr` onto `app_projects` in
  `app_refresh_zip` instead — and note it depends on the same unmerged stable-key work.
- Event detail lazy-loads behind disclosures.

Report measured numbers: call count, payload size, initial render, mobile render.

---

## 10. Render proof — and a correction about egress

**`CLAUDE.md` repeatedly says the sandbox has no egress to Supabase. That is no longer true** — every
query in this brief was run directly from the build environment on 2026-08-11. Verify it yourself
before planning around either assumption.

So real render proof is achievable three ways, in preference order: drive the live data directly;
use the localhost-gated `window.__HS_CARD_OVERRIDE` for states the pilot rows cannot produce; or a
CI verifier on a runner. Do not hand-mock. The page exposes `window.__HS_CARD` (with every painted
metric and its state) for assertions.

---

## 11. Feature flag — probably unnecessary

The draft asks for server-side pilot eligibility. There is no flag mechanism to reuse, and the card
is **already self-gating**: it can only render what is cached, and `property_reports` has exactly one
row — the pilot address. Prefer that over building a flag. Gate on "a cached property record
resolves", never on a hard-coded address or ZIP, so the card widens by cache population rather than
by a code change.

---

## 12. Tests — keep the draft's list, add these

The draft's §33 list is good. Add:

- an orphaned `project_id` renders `unavailable`, **never** `checked_empty`
- **an agency with one dataset checked and another unchecked renders `partial`, never
  `checked_empty`** — assert this on the pilot's real TCEQ rows (Central Registry empty, enforcement
  absent), because the naive agency-level rollup produces a clean-looking "no records found" that
  claims an enforcement check nobody ran
- `penalty_amount = null` renders an em-dash, never `$0`
- a `checked_empty` from `track_record_checks` renders a real `0` **and** exposes its receipt
- `attribution='parent_company'` events never appear in the direct-entity counts, and vice versa
- `company_parents.verification='unverified_candidate'` never activates the parent module
- `role='Property Owner'` never populates owner-of-record
- `neuralink` and `neuralink corporation` are not merged into one entity
- the state vocabulary has no module-local additions
- no intelligence sentence claims a review period the data does not carry
- **no personal field from `sites[]` reaches the rendered card** — assert on the literal pilot values
  (`(813) 758-6679`, `(813) 758-9100`, `(707) 803-1177`, `Gutknecht`, `Padilla`, `Conklin`,
  `Lorentzen`, `owner_addr`, `design_firm_addr`). A test that asserts the *absence* of these exact
  strings cannot be satisfied by a refactor that reintroduces them under a new label
- **no internal field leaks**: `needs_review`, `match_type`, `matched_address`, `geocode_source`,
  `rel_rule`, `layer`, `e`, `n`
- a connection is described without printing the personal value that produced it (§4.2)
- **a field absent from a record we DO have renders "Not stated on the record", not "Not checked"**,
  and does not count toward Data Completeness (§6.1 case a). The pilot's only real instance is a field
  Q4 excludes, so **assert this by fixture**, not against the pilot row
- **a non-derivable metric carries words, not just an em-dash** (§6.1 case b) — assert that a
  `penalty_amount` of null produces a sentence saying records were returned but no penalty figure
- none of the forbidden empty-state phrases (§6.1) appears anywhere in the rendered card: no
  "No violations", "None", "Clean", "No known issues", "Compliant", "No risk"
- **no internal vocabulary reaches the resident-facing copy** (§6.2) — assert the rendered card
  contains none of: "entity", "dataset", "coverage", "attribution", "queried", "result_count",
  "not applicable", "regulatory event". Those belong in the receipt, not the module
- **the page-level explainer is present** — a card where most sections are blank must say once, near
  the top, that blank means unchecked rather than clear

Then run `node scripts/run-unit-tests.mjs --offline --min-files=75`. **Use Node ≥ 22.18** — on 22.14
fifteen suites fail on TypeScript type-stripping alone and it looks like your change broke them.

---

## 13. Backward compatibility — the verifiers that will bite

Do not break, and name each in the report: `verify-maps-live` (the panel's four why-questions, the
full-project-page button, `openCount=1`), `verify-maps-rollout`, `verify-maps-uncap`,
`verify-facility-entity`, `verify-development` (§4.5 covers **`homesignalmap.html?addr=`**, which is
already a live property dossier for this exact address).

**That last one is an unresolved duplication:** two surfaces now render the same `property_reports`
row for different purposes. Decide whether the card links to the dossier, supersedes it, or they
diverge deliberately — and say which.

---

## 14. Stop conditions

### MISSING DATA IS NOT A STOP. Ever.

Most of this card has no data, and that is the expected result — ten of twelve modules will read
"not checked" for the pilot. **If you are about to stop because a source is empty, unwired, failed,
or refuses access, you have misread this brief.** Choose the state from §6.1, choose a sentence from
§6.2, log it in the report, and keep going. This is the repo's existing posture, stated in
`CLAUDE.md` §8: *"Quarantine, don't stop. … A run with quarantined records is a success; the
quarantine log is the only human follow-up."*

**Never a stop — handle it and continue:**

no TCAD · no recorder · no OSHA · no SEC · no hazard source · no property-linked notices · no
sustainability match · no verified parent · zero events for the pilot entities · a source that failed
or 403s · a field a record does not state · a metric that is not derivable · a broken join · a module
that ends up entirely empty · the mockup showing a number the data cannot support.

A **broken join** in particular is not a stop: render `unavailable`, log it in the preflight, carry on.

### The three things that ARE a stop

Each is a case where continuing means **asserting something the evidence does not support**, which no
amount of careful copy can fix.

1. **A false join.** Anything that would tie a fact to this property without evidence: wiring
   `role='Property Owner'` into owner-of-record (Q1), tying a facility or entity to the parcel when
   `parcel_id` is null, or populating the pilot's track record from Martin Marietta / TXI events.
   Stop, because the output would be a fabrication rather than a gap.
2. **Personal data with Q4 unanswered**, where the only way to render a module is to publish a phone
   number or a named individual. If Q4 is answered, follow it and do not stop. If it is not, render
   the module *without* the personal value (§6.2 gives the wording) and flag it — only stop if that is
   genuinely impossible.
3. **Legal sign-off unclear (Q3) at the moment you would ship an aggregated enforcement total against
   a named company.** For the pilot this almost certainly never triggers — there are zero events — so
   it should not block the build. It bites when the fixture work or a real feed produces totals.

Everything else: **decide, document, continue.** A build that finishes with a long list of honest gaps
is the intended outcome. A build that stalls on module one is not.

**Do not fabricate content to complete a screenshot** — and do not treat an empty module as a reason
to stop, delete the module, or wait.

---

## 15. Required final report

Answer the draft's §1–§29 report sections, plus:

- **Which founder decisions (§1) were answered, and by whom** — and for any left open, what you did
  instead. An unanswered gate is something to **flag and route around** (§14), not to stop on; only
  Q4-with-no-alternative and Q3-at-the-point-of-shipping-a-total actually halt the build.
- **The state of every agency row for the pilot address**, with the receipt behind each.
- **How the populated track-record path was exercised** (§4) — by fixture, or not at all.
- **The join-path preflight result**, and whether this build should wait for `6a92a41`.
- **The layout option chosen** (§7) and what it cost.
- **The `homesignalmap.html?addr=` duplication decision** (§13), and whether the
  "4 owners of record" header copy was fixed (§4.3).
- **Measured counts re-run**, since the audit doc's numbers have already drifted.

Then answer explicitly:

**A.** Map → Quick View → View Full Property Card → Back to Map, cleanly?
**B.** Is Entity Track Record first and most prominent — and is its empty state honest rather than
reassuring?
**C.** Are direct and verified-parent histories completely separate, by `attribution`?
**D.** Is missing/unavailable/not-checked visibly distinct from a measured zero, **including for a
broken join**?
**E.** Are Hazards, Meetings and Sustainability represented without fabricating content?
**F.** Is Data Completeness transparent without a score?
**G.** Are property owner, project owner as filed, operator, and parent kept distinct?
**H.** Did non-pilot users retain the existing experience, with every named verifier still green?
**I.** Is every personal field absent from the rendered card — no phone number, no named filer or
contact, no mailing address — and no internal field (`needs_review`, `match_type`, `geocode_source`,
`rel_rule`) leaked?

Do not expand beyond Del Valle. Do not start scoring. **STOP FOR REVIEW.**
