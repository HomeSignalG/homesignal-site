# PROPERTY CARD 0004 — Del Valle / 78617 pilot build brief

**Pilot subject (founder, 2026-08-11): `2200 CALDWELL LN, DEL VALLE, TX 78617` — this address, live at
`homesignalmap.html?addr=2200%20CALDWELL%20LN%2C%20DEL%20VALLE%2C%20TX%2078617`.** Single subject.
See §4 for exactly what it can and cannot support, because the answer constrains two modules.

**Status:** ready to hand to a build session, **after** the four founder decisions in §1 are answered.
**Supersedes** the first draft of this brief. Every premise below was measured against the live
database on **2026-08-11**, not inferred from documentation — the queries and their results are
inline, because six premises in the draft were false and one of them would have stopped the build.

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

**Table counts have also drifted from the architecture audit.** `identity_conflicts` is 0 today (audit
said 39); `echo_violation_counts` is 0 (audit said 3). **Re-measure before relying on any count in
that document.**

---

## 1. FOUNDER DECISIONS — answer these before writing code

These are gates, not preferences. Two of them change what the card *says*, and one changes what it
*is*. Do not resolve them by inference.

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

**Decide:** ship it empty (proves the honest-state rendering, which is the product thesis), or defer
the module until the TCAD adapter lands (Part 29 Q3 recommends TCAD first). Note that
`docs/source-key-productionization-status.md` line 225 says plainly: *"Do not start TCAD / the
evidence architecture until `6a92a41` is merged and deployed."* That commit is still unmerged.

### Q3 — Legal sign-off for aggregated enforcement against named companies

`CLAUDE.md` §7 records that the development tracker's legal framing was **founder-signed-off once**,
for rendering "the public fact + link, never editorialize a named operator into wrongdoing," and
requires the "factual count… not a verdict on any operator" copy on every page.

An Entity Track Record that **aggregates 157 violations and penalty totals against a named company
and its verified parent** is a materially larger legal surface than a facility count. The draft's
word-ban (§8) is necessary but is not the same thing as sign-off.

**Decide:** does the existing one-time sign-off cover aggregated, entity-attributed enforcement
totals, or is a new review required? **Treat "unclear" as a stop.**

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
contact: Gutknecht"); or (b) it matches the existing dossier. Recommend (a).

Whichever is chosen, **the inconsistency between the two surfaces is itself a bug to file** — one
page cannot treat a phone number as consumer-safe while the other treats it as private.

---

## 2. What already exists — DO NOT REBUILD IT

`property-card.html`, `lib/property-card.js`, and `docs/property-card-redesign.md` already ship (see
the branch/PR that added them). **Read `docs/property-card-redesign.md` in full before writing
anything.** Already built and tested:

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

**So the honest Caldwell card is:** TCEQ = *Checked — no records found* (a receipted zero, checked
2026-08-09, with `query_basis` and `source_url`) · EPA FRS = *Checked — no records found* at the
address · EPA ECHO, OSHA, SEC, State/Local = *Not checked* · 5 real TDLR filings · everything else
*Not checked*.

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

Per-agency state is derived from `track_record_checks` joined on `subject_key`/`subject_kind`:

- a check row with `result_count > 0` → **records found**
- a check row with `result_count = 0` → **checked, no records found** (this is what Caldwell has)
- **no check row at all** → **not checked** (Part 12's definition: row absent *is* the state)

Counts come from `company_track_events`, split by `attribution` (`direct_company` vs
`parent_company`) so the two modules never mix. **`penalty_amount` is null on 59 of 61 rows** — the
penalty metric must render an em-dash for those, not `$0`.

### ⚠ The fragility that will silently empty the flagship module

`property_company_roles.project_id` and `project_facility_refs.project_id` are **`app_projects.id`**,
which `app_refresh_zip` regenerates by delete-and-insert. The stable-key fix is Part 31 Phase 0 and
is **not merged**. I verified all 5 Property Owner rows and 3 facility refs resolve **today**:

```
487a359b… -> TXI - GARFIELD SAND & GRAVEL        (78617)
1faf7b33… -> TXI - GARFIELD SAND & GRAVEL PLANT  (78617)
<5 roles>  -> River Bottoms Ranch Barn 2 / Barn 2 ACT Office / ATX1 Third Floor TI /
              ATX1 New Construction / Histology Lab   (all 78617)
```

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

- **Entity Track Record.** Read the join path in §5, not `sources_checked`. Split direct from parent
  by `attribution`. Render the receipt behind a disclosure: `query_basis`, `checked_at`, `source_url`
  from `track_record_checks` — that receipt is what makes "checked, no records found" believable.
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

Stop and report rather than infer if: a parent relationship is not verified · a pilot `project_id`
does not resolve · TCAD data is required to fill a module · SEC or OSHA data is required · a hazard
source is required · a notice cannot be property-linked · a facility or entity cannot be tied to the
parcel · **a module can only be filled by rendering a personal field** (Q4 unanswered, or the only
way to describe a connection is to publish the phone number or filer's name) · internal-sounding
fields would have to be surfaced (`property_company_roles.notes`,
`company_track_events.attribution_note`) · legal sign-off for aggregated enforcement is unclear ·
performance needs the unbuilt claim layer.

**Do not fabricate content to complete a screenshot.**

---

## 15. Required final report

Answer the draft's §1–§29 report sections, plus:

- **Which founder decisions (§1) were answered, and by whom.** An unanswered gate is a stop.
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
