# Case Study — ZIP 78617 / 2200 Caldwell Ln (the "reporter workflow" gap analysis)

> Companion to `docs/development-tracker-source-of-truth.md`. This doc measures the
> current build against a real published investigation (The Drey Dossier, "Elon Musk's
> secret surgery center," Jul 2026) reconstructed entirely from public records at
> **2200 Caldwell Ln, Del Valle, TX 78617** (Travis County), and specifies the smallest
> set of changes that would let HomeSignal reproduce it *through the pipeline* — never
> around it. Everything here defers to the prime directive (§0): the engine returns
> records; the page renders them; nothing is hand-authored.

---

## 0. The case study in one table (what the pipeline must be able to hold)

Five TDLR/TABS filings at one address, 2022–2026. Every row has a stable public
`record_url` (`https://www.tdlr.texas.gov/TABS/Projects/<project_no>`).

| Project # | Name | Facility | Cost | Sqft | Scope (from filing) | Owner of record | Owner phone | Contact | Design firm | Dates |
|---|---|---|---|---|---|---|---|---|---|---|
| TABS2023006483 | Histology Lab | River Bottoms Ranch | $2M | 7,500 | 1-story lab, storage, office, mech & gas storage | River Bottoms Ranch | — | Jeff Gutknecht (filing) | Emersion Design (Cincinnati OH) | 12/2022–2/2023 |
| TABS2023006449 | River Bottoms Ranch Barn 2 | Building F | $2M | 14,200 | Fully sprinklered barn for animal holding + 740sf mezzanine | River Bottoms Ranch (2200 Caldwell Ln) | (813) 758-9100 | Scott Padilla | Emersion Design | 1/2023–4/2023 |
| TABS2024016698 | Barn 2 ACT Office | Bldg 8 Phase 2 | $1M | 3,410 | Interior fit-out of 3,410 sqft office | River Bottoms Ranch LLC (Fremont CA) | (813) 758-6679 | — | Emersion Design | 4/2024–7/2024 |
| TABS2024022676 | ATX1 New Construction | ATX1 | $14.7M | — | New construction | Neuralink (2200 Caldwell Lane) | (813) 758-6679 | Scott Padilla | Studio8 Architects (Austin TX) | 7/2024–5/2025 |
| TABS2026011928 | ATX1 Third Floor Tenant Improvement | ATX1 | — | — | Tenant improvement of shell space for office & manufacturing | Neuralink Corporation | (707) 803-1177 | Kristin Lorentzen | Neuralink (self) | 3/2026–5/2026 |

Adjacent federal record class used by the investigation: **USDA APHIS inspection
reports** for Neuralink (customer 507904, certificate 93-R-0586, multiple sites) —
species counts as recent as Feb 2026.

The investigation's three analytical moves, all record-level facts:
1. **Address history** — five filings at one address read as a timeline.
2. **Shared-attribute entity links** — the same phone `(813) 758-6679` on a "River
   Bottoms Ranch LLC" filing and a "Neuralink" filing; the same contact (Scott Padilla)
   across both entity names; the same design firm (Emersion) across the animal
   facilities.
3. **Anomaly context** — $1M for a 3,410 sqft office fit-out inside a barn.

---

## 1. Audit verdict — what the current build gets right (do not change)

- **The anti-fabrication gate is the correct foundation.** Every TABS record has a
  stable public URL; `sourced()` + verify-development §9 already express exactly the
  provenance model this investigation runs on.
- **The two-layer split holds.** TABS is an **engine** concern (§7.6 decoupled coverage
  job). The page batch never blocks on it. Nothing about the page batch contract changes.
- **The lifecycle buckets map cleanly** (built / approved / proposed; `decided`;
  open-comment). TABS `Current Status` ("Project Closed", "Inspection Complete", active)
  maps onto them.
- **The Utah PMN precedent is the template.** TDLR/TABS is to Texas what PMN is to
  Utah: a per-jurisdiction enrichment source over the national EPA floor. §2's
  precedence table needs no structural change — one new row at level 2.
- **§10's framing rule survives contact with a hostile-framing case study.** "Secret
  surgery center" / "shell company" is editorializing and stays out. "Phone X appears on
  filings A and B — view both records" is a renderable fact. See §5 below for the one
  sentence §10 needs.

## 2. Audit verdict — the gaps (in order of leverage)

1. **The `sites[]` shape discards the investigative payload.** Current contract (§3):
   `{label, scope, type, layer, lat, lng, url|record_url, violUrl, viol, src,
   meeting_date, owner, e, n}`. Every signal in §0's table beyond `label`/`owner` —
   phone, contact, design firm, cost, sqft, scope text, project number, dates — has no
   field and would be dropped at ingest. (`owner` is already in the contract but never
   rendered: the headroom exists, the habit doesn't.)
2. **No state permit source class in the engine.** Sources today: Census geocoder, EPA
   FRS/ECHO, Utah PMN + county notices. The entire case study payload is a source class
   (state licensing/permit registries) with zero adapters.
3. **No per-address history view.** Both page modes are radius/ZIP *snapshots*. The
   Caldwell story only exists as a *timeline at one address*. There is no address
   dossier surface and no canonical address key to join on.
4. **No entity layer.** Owners, contacts, phones, design firms are not records, so
   shared-attribute links (the core reporter move) cannot be computed or rendered.
5. **`facilityType()` classifies by name regex; permit records classify by scope text.**
   "Histology Lab" and "…Barn 2" fall through to "Industrial facility." The signal is in
   `scope_text` ("fully sprinklered barn for animal holding"), which isn't stored.
6. **No anomaly flags.** `viol` is the right pattern (factual count + link) but is
   EPA-specific. Cost/sqft outliers are computable at ingest once the fields exist.

## 3. The corrected path for 78617 (supersedes any "seed it by hand" idea)

**Hand-seeding the five records into `development_reports` is prohibited** by §0/§4
("Do NOT hand-edit a report row to add a record the engine didn't return") — and the
verifier would not catch it, since all five carry `record_url`s. The breach would be
silent. The only compliant path:

1. TABS adapter lands in the engine (`get-address-report` gains a TX source) — a §7.6
   decoupled engine job with its own pinned-source runbook.
2. A normal ZIP-mode refresh for 78617 caches the row.
3. The page renders it with zero page-batch changes (new fields render when present).

The case study then *is* the demo: a crawlable `/development/78617` page reproducing a
179K-subscriber investigation from records the pipeline pulled itself.

## 4. Specs (smallest compliant versions)

### 4.1 §3 contract extension — additive optional fields on `sites[]`
All optional; absent on EPA/PMN records; ride inside the existing `sites` jsonb (no new
cache columns → not a §12 schema stop):

```
project_no      text     -- registry key, e.g. "TABS2024022676"
owner           text     -- (already in contract) owner of record, verbatim
owner_addr      text
owner_phone     text     -- normalized E.164 for matching; render as filed
contact_name    text
filed_by        text     -- PERSON FILING FORM → Contact Name (Step-0 fixture-verified;
                         -- a distinct page role from the OWNER block's contact)
design_firm     text
design_firm_addr text
design_firm_phone text
est_cost        number   -- USD
sqft            number
scope_text      text     -- the filing's scope-of-work, verbatim
start_date      date
end_date        date
status_text     text     -- registry status, verbatim ("Project Closed")
```
Rendering rule: fields render verbatim-or-not-at-all (same anti-fabrication posture; no
inferred values). `facilityType()` may match on `scope_text` when present, before the
name fallback.

### 4.2 Engine source: TX TDLR/TABS (per-jurisdiction enrichment, level 2 in §2)
- **Pinned source:** TDLR TABS public project search; record URL template
  `https://www.tdlr.texas.gov/TABS/Projects/<project_no>`; pin the query interface +
  vintage at the adapter's Step 0 (same discipline as §7.1's ZIP dataset).
- **Scope mapping:** TABS records carry real street addresses → `scope:"point"`
  (geocode via the existing Census path). Never the synthetic area placement.
- **Lifecycle mapping:** active/registered → `approved`; completed/closed → `built`;
  (TABS has no "proposed" phase — planning-stage items stay the county-notice sources'
  job).
- **Quarantine, don't stop** (§7.2): a TABS record that fails geocoding or lacks a
  parseable status is quarantined and logged; the refresh continues.

### 4.3 Property page (address dossier) — page-layer, after 4.1/4.2 land

**Routing.** Every `record ▸` link in the ZIP page's Operating/Approved/Proposed lists
routes to the internal property page (`/property/<slug>` or `?addr=<canonical>`), NOT
directly to the external record. The external `record_url` moves onto the property page,
where each individual fact links to its own official source. Funnel:
ZIP page → property page → external record. Every property gets a page (single-record
addresses included) — each is its own crawlable, indexable surface, mirroring the
one-dynamic-page/many-cached-rows ZIP pattern, keyed by canonical address.

**Canonical address key** = the engine's geocoder-normalized address string. ONE
normalizer, engine-side, so page and cache always agree. Cache table mirrors
`development_reports` keyed by address (e.g. `property_reports`), so TABS/APHIS/EPA
records at the same address collapse into one row regardless of which refresh wrote them.
Same RLS posture: public select, no anon writes.

**Layout spec (multi-record address — the full page, top to bottom).** Match the
existing site visual language exactly (Inter, #1f5130 green, #E7ECEA borders, white
cards, the existing green/blue/orange lifecycle colors, the "record ▸" link pattern):

1. **Header row** — breadcrumb (ZIP <zip> › <street>), H1 address, and two actions:
   `Watch this address` (primary, green — subscribes to new-filing alerts at this
   address; reuses the existing alerts infrastructure, the conversion moment) and
   `Export` (secondary — the sanctioned evidence-snapshot artifact, self-contained
   HTML with provenance footer). Subline: county · N filings, N owners of record,
   date range · "view on ZIP map ▸" link back.
2. **Stat cards** (4-up): Filings · Total filed cost · Sq ft filed · Entity links
   (orange number when > 0). Sums are arithmetic on filed values only; absent values
   excluded, never estimated.
3. **Connected entities (the reporter's core object, first-class — as shipped).**
   Two cards, connections FIRST:
   - **"Connected entities" card** — a small SVG **connection map** rendered FROM the
     `entity_links` evidence (never hand-arranged): one node per entity in a connected
     cluster (white fill, green border, name bold with a role/filing-count subline),
     one labeled edge per shared-attribute connection, the label a small warm-tinted
     pill ("same phone (813) 758-6679", "same contact: Gutknecht"; #FEF8F3 fill,
     #F0D9C3 border, #8a5a2e text). The map renders only for clusters of 4 nodes or
     fewer; larger clusters show the evidence list alone. Directly beneath the map:
     **"The records behind each connection"** — one line per edge with the SAME label
     wording as its pill and every evidence filing linked to its `record_url`, closed
     by: "These are facts from the filings — a connection means two records share a
     detail, not a verdict on any operator." The matching stat card counts the
     distinct entities that appear in any connection ("Connected entities").
   - **"All entities on record"** — the full roster, demoted below as a plain
     three-column list (Owners / Contacts / Design firms) with filing counts and
     filed-address cross-signals in muted text, NO dots or badges, footer: "Names
     shown exactly as filed. Similar names (e.g. 'Neuralink' and 'Neuralink
     Corporation') are listed separately unless a public record connects them."
   §10: never "shell"/"front"/"connected to" — the shared attribute + the records.
4. **Filing history card** — one bordered list (existing row style), chronological.
   Each row: muted date column (left) · project name (+ orange dot if the filing
   participates in an entity link, matching the dot on its entity above) · status
   pill (BUILT green / APPROVED blue / PROPOSED orange — pills, not bare dots) ·
   one-line summary (owner · cost · sqft · scope) · the filing's `record_url` link.
   **Anomaly values render as arithmetic in muted text**, e.g. "(≈ $293/sqft as
   filed)" — computed from filed cost/sqft only, no adjectives, no judgment.
5. **Federal records at this address** — separate card (different data class from
   permits; never merged into the filing timeline). Each present record (APHIS, TRI,
   SEMS…) as a row with its official link. Then the **"Also checked" line** —
   negative-space transparency, one muted line listing every source checked with a
   null result ("EPA FRS — no registration · EPA TRI — no reports · …"). A negative
   only means something if the reader knows you looked; the line grows automatically
   as registry sources land.
6. **Footer** — existing disclaimer pattern extended: sources list · "every item
   links to its official public record" · "cost-per-sqft is arithmetic on filed
   values" · "shared-attribute links show filings that share a phone, contact, or
   address — not a verdict on any operator."

**Single-record address (the common case).** Collapse: header (+ Watch/Export) →
the one filing/facility card → "Also checked" line → footer. NO stat cards, NO
entities panel, NO timeline chrome. The page must not look padded when there is one
record; it grows into the full layout automatically as more sources populate the
same canonical address.

**Deferred to real build (not in mockups):** small location map in the header
(needs live tiles); "Federal records" section becomes a filterable list once
TRI/SEMS/RCRAInfo volume is real (v2).

### 4.3.1 Related activity (the join to the existing alerts/community system)

The community pages (`community.html?zip=<zip>`) already carry ZIP-keyed Government
Notices, Local News (topic-subscribed: Data Centers, Water Quality, Infrastructure,
etc.), and Upcoming Meetings with agendas. The property page JOINS that existing
data — no new ingest, no new alert infrastructure.

**The property identifier set** (computed from the cached property row, grows as
filings accumulate): the canonical address + street-number variants · every
`project_no` · every `facility_name` ("ATX1", "Building F") · every entity name on
record (owner, contact, design firm, filer — verbatim as filed). The day a new
filing lands, its names join the set; e.g. once TABS added Neuralink as an owner
here, every "Neuralink" item in the existing alert feeds became matchable to this
address.

**Two match tiers — relevance is a claim, so the evidence rides with it:**

- **Tier 1 — "Mentions this property."** The notice/agenda/news text contains a
  member of the identifier set (plain string match, case-insensitive, no semantic
  guessing). Rendered with the matched identifier shown ("matched: 'ATX1'") and the
  item's own link (official record link for notices/meetings; article link for
  news). NEVER infer relevance an item doesn't state — a zoning item that doesn't
  name the property or an entity is not Tier 1, full stop (§10).
- **Tier 2 — "In this area."** The ZIP/community feed for the property's ZIP —
  literally the existing community-page data. Labeled "Upcoming in <county>" /
  "In Del Valle (78617)", never "related to this property". Meetings keep the
  existing closes-in-N-days / agenda treatment; a "see all → community page" link
  hands off to community.html?zip=<zip> rather than duplicating that page.

**Presentation:** one "Activity around this property" section between Federal
records and the footer. Civic items (hearings, notices) and news items are visually
separated per the existing community-page distinction — a news mention must never
read as a public record. Tier 1 first (usually short or empty), Tier 2 as the
quieter jurisdiction list.

**Watch subscription (the "Watch this address" button's full meaning):** fires on
(a) new filings at this address, (b) new Tier-1 matches in notices/agendas,
(c) new Tier-1 matches in local news, (d) optional toggle: Tier-2 jurisdiction
items. Reuses the existing per-topic alert plumbing — a property watch is a saved
identifier set evaluated during the existing alert ingest, not a new pipeline.
News-topic suggestions (e.g. an animal-facility filing suggesting the "Animal &
Human Viruses / Diseases" topic) are OFFERED as user-controlled toggles at
subscribe time, never auto-asserted as relevant.

### 4.4 Entity layer (the one real new-DDL decision — a genuine §12 stop, decided once)
Three tables, RLS posture identical to `development_reports` (public select, no anon
writes, service-role batch writes):

```sql
create table entities (
  id            bigint generated always as identity primary key,
  kind          text not null check (kind in ('owner','contact','filer','design_firm')),
  name          text not null,
  phone_norm    text,          -- E.164; the primary match key
  address_norm  text,
  created_at    timestamptz not null default now()
);
create table entity_records (   -- entity ↔ filing (record_url is the filing key)
  entity_id  bigint not null references entities(id),
  record_url text   not null,
  role       text   not null,   -- 'owner' | 'contact' | 'filer' | 'design_firm'
  primary key (entity_id, record_url, role)
);
create table entity_links (     -- computed nightly; never hand-authored
  a_id         bigint not null references entities(id),
  b_id         bigint not null references entities(id),
  match_reason text   not null check (match_reason in
                 ('shared_phone','shared_contact','shared_address')),
  evidence     jsonb  not null,  -- the ≥2 record_urls that establish the link
  computed_at  timestamptz not null default now(),
  primary key (a_id, b_id, match_reason)
);
```
The naive v1 matcher (group by `phone_norm`) already finds River Bottoms Ranch LLC ↔
Neuralink. The `filer` kind (the PERSON FILING FORM contact, a Step-0-verified distinct
page role) is linkable alongside owners/contacts/design firms — filers state no phone,
so they link via `shared_contact` (name): Jeff Gutknecht filed all three River Bottoms
Ranch permits at 2200 Caldwell Ln. Rendering (popup/dossier): *"This owner's phone number also appears on
&lt;n&gt; other filing(s) — view records"* with every evidence `record_url` linked.

### 4.5 Verifier extension (verify-development.mjs)
New invariant alongside the site gate: **every rendered entity link carries ≥2
non-empty `record_url`s in its evidence.** A link with fewer than two sourced filings
fails the run — the machine-enforced version of "a connection is a fact about two
records, not an inference."

### 4.6 Coverage note granularity (small, page-side)
`updateCovNote()` becomes per-source once >1 enrichment source class exists:
*"TX state permits (TDLR): covered · Travis County planning notices: not yet."* Same
honest tone; the `communities`/coverage row gains a per-source flag (jsonb; no new
table).

## 5. §10 amendment for one-time founder sign-off (proposed text)

> **Entity links are shared-attribute facts, not characterizations.** Render only:
> the shared attribute (phone / contact name / address), the filings it appears on
> (every `record_url` linked), and nothing else. Never label an entity a "shell,"
> "front," "hidden," or "secret" operation; never assert intent. Link copy is templated
> from verified engine fields only — the same rule as the INTEL prose. Anomaly flags
> (e.g. cost-per-sqft outliers) render as arithmetic on filed values with the filing
> linked ("$1,000,000 filed for 3,410 sqft — see record"), never as a verdict.

## 6. Proposed §6 standing answers (add on the build that ships each piece)

- **A registry record whose owner name differs from other filings at the same address →
  render both verbatim; never merge or "correct" an owner name.** The difference IS the
  data. Entity links (4.4) express the relationship; the filings stay as filed.
- **A filing with no coordinates but a real street address → geocode via the existing
  Census path; if geocoding fails, quarantine (never synthetic-place a point-scope
  record).**
- **An address with many filings → the ZIP map still shows one dot per filing** (they
  share coordinates; use the existing marker behavior). The dossier view (4.3) is where
  the timeline lives; do not invent a "campus" aggregate record.
- **A state registry with no API, only a search UI → pin the query interface + vintage
  at adapter Step 0, same as §7.1.** If it cannot be pinned/verified, that adapter is a
  Step-0 stop for the *engine* job only — the page batch never blocks on it (§7.6).

## 7. Sequencing (each step ships alone; nothing blocks the existing batch)

1. **4.1** contract extension (engine emits, page renders-when-present) — no DDL, no stop.
2. **4.2** TABS adapter → normal refresh caches 78617 → the case-study page is live.
3. **5** §10 amendment signed off (one time) + **4.6** coverage note.
4. **4.4** entity DDL decided (§12 stop, this doc is the ask) → nightly matcher → links render.
5. **4.3** property page (address dossier). 6. **4.5** verifier extension. 7. **§6** answers appended as each lands.

---

### Provenance
Case-study facts (§0 table) transcribed from TDLR TABS project pages
TABS2023006483 / TABS2023006449 / TABS2024016698 / TABS2024022676 / TABS2026011928 and
USDA APHIS inspection records for customer 507904 as shown in the source video
(youtube.com/watch?v=Lh_0v3nuczE, The Drey Dossier, ~27 min). **Re-verify every field
against the live registry URLs before any engine work asserts it** — screenshots are a
LEAD, not a fact (claims-discipline rule, source-of-truth §"Claims discipline").
Current-build facts verified against `homesignalmap78617__1_.html`,
`development-tracker-source-of-truth.md`, `CLAUDE-development-tracker-section.md`,
`development-reports-cache.sql`, and `verify-development.mjs` as uploaded 2026-07-09.
