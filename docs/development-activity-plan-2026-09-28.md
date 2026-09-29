# HomeSignal — Development Activity Report Plan

**Updated: 2026-09-28**  
**Revision focus: Phase 1 development/change intelligence only + agent workflow + brokerage operating model + visual layout contract + autonomous evaluation + secure paid conversion**

**Customer-facing product name: HomeSignal Development Activity**

**Naming rule:** customer-facing copy should use **Development Activity**. Existing repository filenames, routes, and function slugs such as `future-surroundings-report.html` and `get-future-surroundings-report` are legacy technical identifiers and should not be renamed casually without a separate migration plan.


---

# Strategic Product Decision

## HomeSignal's competitive advantage

The Development Activity Report must lead with **WHAT IS CHANGING**.

The product should not compete primarily as another neighborhood, amenity, school-score, or property-facts report. Those categories are already widely available.

HomeSignal's differentiated job is:

> **Show a brokerage what is changing around a property, what has been approved and is coming, what is only proposed or under review, what is permitted or under construction, and the official evidence behind each item.**

The report should help an agent answer:

> **What changed around this property, what is already coming, what may be coming, and what should my client investigate before making a property decision?**

The long-term product progression is:

**WHAT CHANGED → WHAT'S APPROVED / COMING → WHAT'S PROPOSED / UNDER REVIEW → WHAT'S PERMITTED / UNDER CONSTRUCTION → WHAT SHOULD I REVIEW → KEEP WATCHING**

Change detection is the hero.

## Phase 1 scope decision — do not compete on existing surroundings yet

Phase 1 must **not** attempt to provide a complete inventory of what already exists around a property.

Do not include or imply comprehensive coverage of:

- existing schools
- existing parks
- hospitals / health facilities
- libraries
- stadiums / arenas
- zoos / cultural / recreation facilities
- restaurants
- retail
- offices
- existing apartment communities
- existing commercial buildings
- neighborhood amenities generally

The reason is product trust.

A real-estate agent often knows the existing neighborhood extremely well. If HomeSignal omits an obvious school, stadium, hospital, park, shopping center, or other established place, the agent may reasonably question the accuracy of the development intelligence as well.

Phase 1 should therefore make a narrower, defensible promise:

> **HomeSignal Development Activity shows planned, approved, permitted, under-construction, and changing development and infrastructure activity around a property. It is not a complete inventory of what already exists nearby.**

Phase 1 should focus on what agents are less likely to know already:

- new applications
- proposed projects
- projects under review
- approvals
- permits
- construction activity where supported
- status changes
- withdrawals / denials where supported
- infrastructure projects
- data-center development
- regulated-facility context where intentionally included
- official evidence
- ongoing monitoring

The Phase 1 product progression is:

**WHAT CHANGED → WHAT'S APPROVED / COMING → WHAT'S PROPOSED / UNDER REVIEW → WHAT'S PERMITTED / UNDER CONSTRUCTION → WHAT SHOULD I REVIEW → KEEP WATCHING**

Do not add a customer-facing **What Exists Today** section in Phase 1.

A future phase may add **Existing Surroundings** only after HomeSignal has dedicated, audited, commercially cleared, sufficiently complete feeds for those categories.

## Brokerage launch requirement

Do **not** begin mass brokerage outreach until all of these are production-ready:

1. the **Change Intelligence Contract**, including stable identity, project lineage, durable observations, and a warmed change baseline;
2. the **Autonomous 20-Report Brokerage Evaluation**, with server-side identity, quota, idempotency, abuse protection, and no client-side bypass;
3. the **commercial report delivery path**, with stored report snapshots and secure opaque sharing rather than address-bearing rebuild links; and
4. the **autonomous paid continuation path**, with a defined price/offer and a server-authoritative conversion/entitlement event.

The initial acquisition model is:

**Mass outreach → unique evaluation link → 20 free successful new property reports → evaluation complete → self-service paid brokerage pilot → ongoing brokerage relationship**

The 20-report evaluation proves usage and usefulness.

The paid pilot proves willingness to pay.

A free evaluation does not itself satisfy the paid-pilot proof requirement.

The acquisition funnel must not depend on manual founder counting, manual access removal, manual payment activation, or manual entitlement changes.

## Agent + brokerage operating model

HomeSignal has two distinct users with different jobs:

### Agent user

The agent uses HomeSignal to:

- prepare for buyer showings and offers
- prepare listing presentations and seller conversations
- compare candidate properties
- answer client questions with official evidence
- share a professional client-ready report
- monitor a property through diligence, contract, closing, listing, and ownership

### Brokerage customer

The brokerage owns the commercial relationship and should be able to:

- control brokerage branding
- invite/deactivate agents
- see brokerage-wide usage
- manage report/watch allocations
- manage billing and paid entitlement
- review the audit trail of generated/shared reports
- understand whether agents are actually using the product
- measure client-facing adoption and recurring value

The product should therefore be designed as:

**Brokerage account → agent users → client-facing reports**

Do not force the brokerage owner to operate each report. Do not make each agent a separate unmanaged commercial island.

## Git-verified implementation gap — 2026-09-28

The current NYC V1 Development Activity Report proves that a rights-cleared property-scoped report can be assembled, but it is still primarily a **current-state publisher-record report**, not yet a durable change-intelligence system.

Verified against `HomeSignalG/homesignal-site` `main` at:

`f71577980734b21140121a3675f80a19d6f4f599`

The current NYC V1 report object contains current nearby publisher records and fields such as source, publisher status, stage, date, coordinates, distance, coverage, attribution, and exclusions.

It does **not yet provide a universal persisted contract for**:

- stable cross-refresh project identity
- prior observation versus current observation
- `first_detected_at`
- `last_observed_at`
- `previous_status`
- `current_status`
- `change_event`
- `change_detected_at`
- durable source-version comparison
- server-side report-to-report delta history

Therefore the report UI must **not** claim "What Changed Recently" merely because a record has a recent filing, approval, or permit date.

A publisher event date and a HomeSignal-detected change are different facts.

The next engineering priority is to create the universal Change Intelligence Contract below before making change detection the customer-facing hero.

## Second competitor-CTO audit — Git-verified launch gaps

Verified against `HomeSignalG/homesignal-site` `main` at:

`f71577980734b21140121a3675f80a19d6f4f599`

The updated plan itself is **not yet in Git**. Searches for the plan filename and the phrase `Autonomous 20-Report Brokerage Evaluation` return no committed copy.

The current tree also establishes these implementation facts:

### 1. The 20-report quota is currently bypassable

`future-surroundings-report.html` still connects directly from the browser to `https://data.cityofnewyork.us`.

That means a server-side 20-report quota would be meaningless if the customer can still use a parallel browser-direct generator.

**Launch rule:** once the brokerage evaluation launches, every customer-facing **new report generation** must go through the canonical commercial server path. There may not be a second ungated browser-direct generation path.

### 2. The current share link is not commercially secure

The current share URL rebuilds from query parameters containing:

- buyer address
- ZIP
- radius

A brokerage client report should not require raw property details in a reusable URL, and opening a shared report must not regenerate the report or consume another evaluation credit.

**Launch rule:** commercial shares use an opaque stored-report/share identifier with server-side authorization, revocation, and optional expiry. Shared views are read-only report snapshots.

### 3. `report_id` is currently a content fingerprint, not a durable report issuance id

Git's `docs/corporate-output-report-id-guarantee-2026-09-28.md` proves that the current SHA-256 `report_id`:

- is not unique per issuance
- is not an order/purchase/delivery id
- cannot reproduce the report by rerunning the address later
- is not a signature
- depends on serialization order

The commercial system therefore needs two different concepts:

- a **durable report snapshot / issuance id**
- a **content/data-state hash**

Do not continue overloading one field with both meanings.

### 4. The canonical server API exists in the tree but is not the current page path

`supabase/functions/get-future-surroundings-report/` exists and `verify_jwt = true` is pinned in `supabase/config.toml`.

The Git checkpoint records that this function had **not been deployed** as of 2026-09-28. The static page continued to work by calling NYC Open Data directly.

Before evaluation launch:

- deploy and smoke-test the commercial server path
- keep its authenticated posture
- move customer generation onto it
- do not make the quota work by weakening the API into an unauthenticated public proxy

### 5. HomeSignal already has user identity infrastructure

The tree already contains Supabase Auth-backed user tables such as `app_profiles`, `app_properties`, `app_follows`, and `app_watchlist_items`.

The evaluation system should reuse the existing identity/session architecture rather than inventing a second user system.

The invite token is a **bootstrap credential**, not the permanent identity or entitlement authority.

### 6. No trial, entitlement, checkout, subscription, or Stripe implementation exists for this product

Git searches show no Development Activity Report trial/entitlement implementation and the checkpoint explicitly records no price, checkout, or payment path.

Therefore a paid-pilot CTA by itself would not satisfy the requirement that the mass-outbound funnel operate autonomously.

### 7. Current usage instrumentation is local-only

`lib/fsr-scale.js` records usage in browser storage.

That is useful for a prototype but cannot be the acquisition system of record for:

- report credits
- evaluation completion
- brokerage conversion
- cross-device usage
- paid entitlement
- funnel analytics

Commercial funnel events must be stored server-side.

---

# Brokerage Value Proposition

The Development Activity Report should help a brokerage do five things that are difficult to assemble manually:

1. **See what changed recently**
   - new application filed
   - project approved
   - permit issued
   - construction started
   - project advanced in status
   - project withdrawn or cancelled

2. **Separate certainty levels**
   - what is approved / funded / permitted / under construction
   - what is only proposed / filed / under review
   - what has materially changed in status

3. **Understand what kind of change it is**
   - Data Center
   - Industrial
   - Residential
   - Roads & Infrastructure
   - Commercial
   - Civic & Public
   - Regulated Facility where appropriate
   - Other Project only as a fallback

4. **See the evidence**
   - distance
   - exact geography where available
   - publisher status
   - timeline
   - first detected
   - latest change
   - official source
   - confidence / coverage limitation

5. **Keep watching after the initial report**
   - monitor a property during showing, offer, diligence, contract, closing, and ownership
   - notify the agent when a nearby project's official status materially changes

The commercial value is not merely answering:

> "What is near this property?"

It is answering:

> **"What is different from yesterday, what is now more likely to happen, and what should my client know before committing?"**

---

# Customer-Facing Report Architecture

The first screen of the report must not be a long permit ledger.

The report should open with a concise **Change Intelligence Summary**.

## 1. What Changed Recently — HERO SECTION

This is the first and most prominent section.

Examples of factual summary metrics, when supported by cleared data:

- 2 new applications filed
- 1 project newly approved
- 1 construction project started
- 3 projects changed status in the last 90 days
- 1 application withdrawn

Every change must be traceable to publisher evidence.

The hero must also show enough freshness context to prevent false certainty, such as:

- report generated time
- last successful source observation
- coverage/freshness limitation when material

Do not market "real-time" or "continuous" freshness unless the measured source/ingest cadence supports that statement.

Do not invent significance scores or predicted effects.

## 2. Approved / Coming

Projects that publisher evidence shows are:

- approved
- permitted
- funded
- awarded
- under construction
- otherwise officially committed

Use "coming" only when the publisher status supports that strength of statement.

## 3. Proposed / Under Review

Projects that are:

- proposed
- filed
- pending
- in planning review
- rezoning applications
- site-plan applications
- permit applications
- other early-stage official records

These are **potential future changes**, not guaranteed outcomes.

Never turn an application into a stronger "coming" claim.

## 4. Permitted / Under Construction

Show projects in this section only when the covered official source supports a permitted or construction-stage lifecycle.

Examples may include:

- permit issued
- construction permit active
- construction started
- active construction project
- other publisher-supported construction-stage status

Do not infer "under construction" merely because an application or approval exists.

If the source supports only approval, keep the project in **Approved / Coming**.

Phase 1 does not use this section to inventory existing buildings or amenities.

## 5. Development Activity Map + Evidence

The property-centered map and evidence table support the summary.

The map must not introduce a new uncleared data/basemap dependency merely for presentation.

If a commercial basemap/provider has not been separately cleared, use the cleared property/project coordinates in a neutral schematic/evidence plot rather than adding OSM, Google, Mapbox, ArcGIS, or another provider by assumption.

Each item should show, where cleared and available:

- Project
- HomeSignal Type
- subtype where supported
- Location
- Distance
- Project Boundary
- Lifecycle / Status
- Timeline
- First Detected
- Latest Change
- Change Event
- Source
- Confidence / coverage limitation

---

# Customer-Facing Visual Layout Contract

The report's visual hierarchy is part of the product contract.

The implementation may improve spacing, responsive behavior, accessibility, typography, and component quality, but it must **not change the information hierarchy without explicit product approval**.

The report must not drift back into:

- a permit ledger
- an engineering/admin screen
- a generic analytics dashboard
- a source-first presentation
- a map-first presentation that buries the change summary
- a technical audit document

The brokerage/customer should understand the product's value within approximately five seconds.

## Desktop Report Layout

The intended hierarchy is:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ HomeSignal                                  ABC REALTY · Agent Name  │
│ FUTURE SURROUNDINGS REPORT                                          │
│                                                                      │
│ 123 MAIN STREET, NEW YORK, NY                                       │
│ Optional client/transaction label                 Generated Sep 28  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ WHAT CHANGED AROUND THIS PROPERTY                                    │
│                                                                      │
│   3                 1                  2                1             │
│ NEW ACTIVITY      NEWLY APPROVED     APPLICATIONS     WITHDRAWN       │
│                                                                      │
│ Most recent: Residential project approved 0.3 mi away · Sep 24      │
│                                              View change details →   │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ MAP / PROPERTY-CENTERED EVIDENCE VIEW                               │
│                      ● PROPERTY                                      │
│        △ Proposed             ◆ Approved                             │
│                 □ Exists today                                      │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ THINGS TO REVIEW WITH YOUR CLIENT                                   │
│                                                                      │
│ 0.2 mi  Residential · APPROVED / COMING                             │
│ 186-unit project approved                                           │
│ Review published project details and construction timing.           │
│ Official source →                                                    │
│                                                                      │
│ 0.4 mi  Roads & Infrastructure · PROPOSED                           │
│ Planning application under review                                   │
│ Review application and agency schedule.                              │
│ Official source →                                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│ APPROVED / COMING                                      View all →   │
│ [cards grouped/labeled by HomeSignal Type]                           │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│ PROPOSED / APPLICATIONS                                View all →   │
│ [cards grouped/labeled by HomeSignal Type]                           │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
├──────────────────────────────────────────────────────────────────────┤
│ CHANGE HISTORY                                                      │
│ May 4     Application detected                                      │
│ Aug 16    Approved                                                   │
│ Sep 22    Permit issued                                             │
├──────────────────────────────────────────────────────────────────────┤
│ OFFICIAL EVIDENCE & COVERAGE                                        │
│ Sources · freshness · limitations · official links                  │
├──────────────────────────────────────────────────────────────────────┤
│ Compare property   Watch property   Share report   Download PDF      │
└──────────────────────────────────────────────────────────────────────┘
```

The exact visual styling may evolve. The hierarchy may not.

## Above-the-Fold Requirement

On a normal desktop/laptop viewport, the customer should see:

1. property/address identity
2. brokerage/agent identity
3. **What Changed Around This Property**
4. the beginning of the property-centered visual context

Do not put these ahead of the change hero:

- report id/hash
- coverage diagnostics
- source-rights classifications
- technical tabs
- audit verdict
- internal pilot counts
- raw permit tables
- implementation details

## Change Hero Rules

The hero section is the most important visual element.

Use concise factual metrics only when the underlying data is valid and deduplicated.

Examples:

- 2 new applications
- 1 newly approved project
- 1 construction start
- 1 withdrawn application

Do not fill the hero with vanity metrics.

Do not count source rows as separate projects when project lineage proves they are one project.

If a market is not yet change-ready, replace **What Changed Recently** with the narrower:

**Recent Official Activity**

until comparable observation history supports actual HomeSignal-detected change.

## Lifecycle vs Type Visual Hierarchy

Every project card must make two concepts visually distinct:

**HomeSignal Type**
- Residential
- Commercial
- Industrial
- Roads & Infrastructure
- Civic & Public
- Data Center
- etc.

**Lifecycle / certainty**
- Exists Today
- Approved / Coming
- Proposed / Application

Lifecycle must be visually clearer than a secondary metadata field because it communicates certainty.

A Proposed/Application item must not visually look equally certain as Approved/Coming.

Do not rely on color alone; use text labels and accessible visual treatment.

## Project Card Contract

A normal project/change card should prioritize:

1. project/title
2. lifecycle/status
3. HomeSignal Type
4. distance
5. most relevant factual event/timeline
6. concise review prompt where applicable
7. official source link

Secondary evidence/details may expand beneath the card.

Do not make users parse raw publisher column names to understand the card.

## Things to Review With Your Client — Visual Priority

This section should appear near the top of the report, after the change summary/map area and before long project lists.

Its purpose is to convert evidence into a useful client conversation without making unsupported impact claims.

Example:

```text
0.2 mi · Residential · APPROVED / COMING

186-unit project approved.

Review:
Published project details and construction timing.

Official source →
```

The word **Review** should mean "this is worth investigating," not "HomeSignal predicts a negative effect."

## Development Activity Map / Evidence View

The map or evidence plot is supporting context, not the hero.

In Phase 1, the visual must be explicitly labeled as a **Development Activity Map** or **Planned & Changing Development**.

It must not be labeled simply as:

- Surroundings Map
- Nearby Places
- What's Around This Property
- Neighborhood Map

Those labels imply completeness for existing places that Phase 1 does not provide.

Add a concise scope cue such as:

> **Only tracked development/project activity is shown.**

It should distinguish:

- subject property
- Approved / Coming
- Proposed / Under Review
- Permitted / Under Construction, where supported
- selected project
- distance where useful

Do not overload the map with every record if that makes the visual unreadable.

Prefer:

- clear property center
- readable nearby project markers
- consistent Type/lifecycle legend
- selection linked to the corresponding project card

If an external basemap has not been cleared for commercial use, use a neutral evidence plot or other cleared representation rather than adding a new rights dependency.

## Evidence and Coverage Presentation

Official evidence must be easy to reach, but it should not dominate the first screen.

Customer-facing evidence details should include, where available:

- official source
- publisher status
- publisher date
- HomeSignal detected date
- lifecycle
- source freshness
- coverage limitation
- official link

Coverage limitations must be visible and plain-language, but visually quieter than the main intelligence.

## Internal Information Must Not Render on Client Reports

Never render customer-facing:

- `Signed paid pilots: 0`
- `Verdict: NOT YET`
- source-rights audit classifications
- raw hashes unless placed in an advanced evidence/details area for a defined customer purpose
- debug information
- implementation notes
- internal data-quality test language
- engineering terminology

## Desktop Action Bar

Primary actions should remain easy to find:

- Compare
- Watch
- Share
- Download / Print PDF

These actions should not displace the report intelligence itself.

## Mobile Report Layout

Mobile is a launch requirement.

The intended order is:

```text
PROPERTY / ADDRESS
↓
WHAT CHANGED
↓
THINGS TO REVIEW
↓
MAP / EVIDENCE VIEW
↓
APPROVED / COMING
↓
PROPOSED / UNDER REVIEW
↓
PERMITTED / UNDER CONSTRUCTION
↓
CHANGE HISTORY
↓
EVIDENCE / COVERAGE
↓
COMPARE · WATCH · SHARE · PDF
```

Mobile requirements:

- no horizontal scrolling for report content
- project cards stack vertically
- lifecycle/status remains visible without opening details
- source links remain tappable
- sticky or compact primary actions are acceptable
- large tables must collapse into cards/rows rather than shrink unreadably
- the report must remain usable in a showing/field context

## Visual Accessibility Rules

The report must:

- meet accessible text contrast
- not use color as the only lifecycle/status signal
- preserve keyboard navigation
- provide visible focus states
- use meaningful headings
- provide accessible labels for buttons and map/evidence controls
- maintain readable type sizes on mobile
- avoid hover-only critical information

## Client-Ready Tone

The visual product should feel:

- credible
- clean
- factual
- calm
- professional
- brokerage-ready

It should not feel:

- alarmist
- legalistic
- municipal
- developer/debug-oriented
- overly technical
- consumer-gamified

The UI should communicate confidence through evidence and clarity, not through exaggerated warnings, red-alert styling, or unsupported scoring.

---

# Phase 1 Non-Goals

The following are intentionally **not** Phase 1 requirements:

- comprehensive school inventory
- comprehensive park inventory
- comprehensive hospital inventory
- comprehensive library inventory
- comprehensive stadium/arena inventory
- comprehensive recreation/cultural inventory
- complete restaurant/retail/business inventory
- complete existing-building inventory
- complete apartment-community inventory
- amenity scoring
- neighborhood quality scoring
- school quality scoring
- walkability scoring
- complete POI coverage

Do not add a new feed family merely to fill one of these sections during Phase 1.

If an existing development/permit feed contains a school project, hospital project, stadium project, civic project, etc., it may appear **as a development project** if it meets the normal evidence, type, lifecycle, rights, and coverage rules.

That does **not** mean HomeSignal claims to inventory all existing schools, hospitals, stadiums, or civic places.

---

# Two-Dimensional Classification

Every customer-visible project should have two separate dimensions.

## Dimension A — HomeSignal Type

Use the existing canonical HomeSignal classifier. Do not create a second product-only classifier.

Customer-facing Types:

- Data Center
- Industrial
- Residential
- Roads & Infrastructure
- Commercial
- Civic & Public
- Regulated Facility where applicable
- Other Project only as fallback

### Civic & Public subtypes

Where publisher evidence supports the subtype, show labels such as:

- School
- Park & Green Space
- Hospital / Health
- Fire / EMS
- Library
- Stadium / Arena
- Zoo / Cultural / Recreation
- Other Civic/Public

Do not guess a subtype.

## Dimension B — Lifecycle / Certainty

### EXISTS TODAY
Already built, operating, open, or otherwise a current recorded condition.

### APPROVED / COMING
Approved, permitted, funded, awarded, under construction, or otherwise officially committed.

### PROPOSED / APPLICATION
Filed, proposed, pending review, rezoning, site plan, planning case, or similar.

### RECENTLY CHANGED
This is a **change flag / event**, not a replacement lifecycle.

Examples:
- newly filed
- newly approved
- permit issued
- construction started
- status advanced
- withdrawn
- cancelled

A record may therefore be:

**Residential + Approved / Coming + Recently Changed**

or:

**Commercial + Proposed / Application**

or:

**Civic & Public / School + Exists Today**

---

# Change History

HomeSignal should preserve the official lifecycle history when evidence exists.

Example:

**May 4** — Application first detected  
**August 16** — Approved  
**September 22** — Permit issued  
**October 8** — Construction status detected

This is a core HomeSignal capability.

The report should distinguish:

- publisher status
- HomeSignal normalized lifecycle
- first detected by HomeSignal
- latest detected change
- exact publisher/source evidence

Do not imply HomeSignal witnessed a real-world event merely because a database row changed.

---

# Brokerage-Specific Capabilities

These capabilities should be considered part of the product roadmap because they extend the same change-intelligence engine rather than creating unrelated products.

## Buyer Workflow

The buyer-side workflow should help an agent prepare for:

- showings
- property comparisons
- offers
- diligence
- contract
- closing
- post-closing monitoring

The agent should be able to generate a report quickly, share it with the client, and explain:

- what changed recently
- what is approved / coming
- what is only proposed / under review
- what official records should be reviewed

## Seller / Listing Workflow

HomeSignal must also support listing-side use.

Before listing, the agent should be able to identify:

- nearby official changes a buyer may discover
- approved / under-construction projects
- proposed applications that may trigger buyer questions
- positive public/infrastructure investment on the record
- factual items the seller/agent should be prepared to discuss

The seller/listing workflow must remain factual and evidence-backed.

Do not generate claims about:

- future appreciation
- buyer demand
- property-value impact
- desirability
- traffic impact
- school quality

## Agent Speed + Mobile Requirement

The customer-facing report must be usable by an agent immediately before or during a client interaction.

Launch requirements:

- mobile-responsive report and workspace
- address entry with minimal steps
- clear loading/progress state
- useful first result in seconds where source/API performance permits
- no enterprise-style setup before the first report
- saved recent reports available across authenticated devices

Measure:

- median report-generation time
- p95 report-generation time
- first-use completion rate
- mobile completion rate

Performance problems must be surfaced as product defects, not hidden behind indefinite loading.

## Coverage Preflight Before Credit Consumption

Before an evaluation credit is consumed, HomeSignal should run a lightweight coverage check.

Show the agent, where determinable:

- development/application coverage
- approved/permit coverage
- change-history readiness
- current-surroundings coverage
- material source/freshness limitations

Example:

**Coverage available**
- Approved / permits: available
- Proposed / applications: available
- Change history: available
- Current surroundings: partial

The agent then chooses:

**Generate Report — uses 1 credit**

If the address does not meet the minimum report-quality threshold for the marketed product, do **not** consume an evaluation credit.

The minimum quality threshold must be deterministic and versioned.

## Client / Transaction Labels

Allow an optional agent-entered label for organization, such as:

- `123 Main Street — Smith buyers`
- `42 Oak Avenue — Listing presentation`

Do not require client names or other personal information.

Client/transaction labels are organizational metadata only and must not affect report evidence, identity, lifecycle, or scoring.

## Property Comparison

Allow an agent to compare multiple candidate properties using the same radius and evidence rules.

Compare factual items such as:

- recent changes
- approved / coming projects
- proposed / application projects
- current significant surroundings
- project Types
- distance
- published timelines

Do not turn the comparison into a subjective neighborhood score.

## Closing / Move-In Timeline

Allow the report to organize publisher-backed project timelines relative to a customer's expected:

- offer
- contract
- closing
- move-in
- first 6 / 12 / 24 months

This is a timeline view, not a prediction.

## Watch This Property

After a report is generated, allow the brokerage to monitor that address from the same server-side change-intelligence contract.

A watch must compare new observations with the last comparable stored state; it must not infer change from page refreshes or current rows alone.

Notify on meaningful publisher-backed changes such as:

- new application
- approval
- permit issuance
- construction status
- withdrawal
- cancellation
- material timeline/status change

This turns the report from a one-time PDF into an ongoing brokerage service.

## Autonomous Brokerage Evaluation

The product must support a self-service brokerage evaluation suitable for mass outbound email.

Each invited brokerage/contact receives a unique secure evaluation link.

### Evaluation ownership rule

The default V1 commercial evaluation unit is:

> **One brokerage evaluation account = 20 shared free report credits**

The 20 credits belong to the evaluation account, not independently to every employee email at the same company.

An invited brokerage owner/team lead may add a limited number of agent users to the same evaluation account.

Do not infer that two contacts belong to the same legal/customer account from email domain alone. Account membership must be established by invite/redemption/admin action.

Do not unintentionally create 20 free reports for every agent at one brokerage when the commercial offer was intended to give the brokerage 20 total reports.

Individual-agent evaluations may be offered later as a separately defined campaign/product rule.

The evaluation includes:

- **20 free successful new property reports**
- server-side report-credit enforcement
- visible reports remaining
- an evaluation-complete state after report 20
- a paid-pilot continuation CTA
- no manual founder tracking required

### Credit rules

A credit is consumed only when a **new valid property report is successfully generated**.

The following do **not** consume another credit:

- reopening an existing report
- sharing an existing report
- printing an existing report
- downloading/PDF export of an existing report
- reloading the page
- technical failures
- an address miss or unresolved/ambiguous address
- opening an already generated report for the same durable report object

The quota must be enforced **server-side**.

A browser counter, `sessionStorage`, `localStorage`, hidden URL, or JavaScript-only gate is not an entitlement system.

### Trial identity / entitlement

The V1 evaluation entitlement is **server-side and tied to one evaluation account/invite**, not to a browser or device.

Do not automatically merge different invited contacts into one brokerage merely because they share an email domain. Brokerage/account consolidation can be added later with explicit evidence and account controls.

Reuse HomeSignal's existing Supabase Auth/session architecture where practical.

The secure invite link should be treated as a bootstrap credential:

- generate a high-entropy token
- store only a server-side hash of the token
- allow revocation
- do not log or persist the raw token in analytics
- do not expose the raw token in report share URLs
- bind the redeemed evaluation to the authenticated/scoped evaluation identity
- rate-limit redemption and report generation
- reject replay/abuse outside the entitlement contract

Do not disable the commercial API's JWT requirement merely to make invite links convenient.

The system should persist, at minimum:

- trial/evaluation id
- invited email/contact
- brokerage/company
- secure token hash or authenticated account identity
- report limit
- successful new reports used
- reports remaining
- created/activated date
- optional expiration date
- status
- conversion state

### Trial report ledger

Each consumed report credit should be tied to a durable stored report record containing, at minimum:

- trial/evaluation id
- report id
- property identity / address identity
- buyer-supplied address
- radius / report parameters
- generated timestamp
- report snapshot/version
- entitlement event

Quota decrement and report creation must be atomic so retries do not double-charge credits.

### Conversion state

When the 20th successful report is used, the experience should transition automatically to:

**Your HomeSignal evaluation is complete.**

Then present the paid brokerage pilot path.

Do not require the founder to manually disable access, count reports, or send a second access mechanism.

---

## Investigation Questions

HomeSignal may identify factual items that warrant review.

Examples:

- official construction timeline is scheduled during the buyer's expected move-in period
- a nearby application remains under review
- a road project has an official published construction window
- a planned school or park project has a publisher-posted status change

Use language such as:

**"Review the official record and investigate."**

Do not make unsupported claims about:

- property value
- traffic increase
- utility capacity
- insurance impact
- desirability
- school quality
- future appreciation
- whether a neighborhood is "good" or "bad"

## Things to Review With Your Client

This should be a prominent agent-facing section, derived only from factual evidence already in the report.

For each relevant item, show:

- what the official record says
- distance
- lifecycle/status
- timing where published
- why the record may merit review
- official source

Example structure:

**0.2 mi — Residential project approved**  
Official record indicates 186 units.  
**Review:** published project details and construction timing.

The review prompt is not an impact prediction.

## Client Engagement Signals

For reports shared with clients, provide lightweight agent-facing engagement signals where legally/technically appropriate, such as:

- report opened
- official source opened
- report reopened
- property watch activated

Do not expose invasive behavioral detail.

The purpose is to help the agent know when a client has engaged with the material and may need follow-up.

Client engagement events must be stored server-side and governed by the product's privacy/disclosure rules.

---

# Product Positioning

## Customer promise

**HomeSignal Development Activity**

### Know what's changing around a property before your client makes a decision.

Understand:

- what changed recently
- what is approved and coming
- what is proposed or under review
- what is permitted or under construction
- what the official records say
- what should be reviewed with the client
- what changes after the report is generated

This positioning must work for both:

- **buyer-side decisions** — showing, offer, diligence, contract, closing
- **seller/listing decisions** — listing preparation, buyer-question readiness, surrounding-change context, seller updates

Customer-facing scope language should state:

> **Planned, approved, permitted and changing development found in HomeSignal's covered official sources.**

And, in quieter supporting copy:

> **This report focuses on development activity and change. It is not an inventory of existing schools, parks, businesses, buildings, or neighborhood amenities.**

Suggested supporting line:

**Source-backed. Status-aware. Continuously monitored.**

---

# Master Step Plan

## Step 1 — Freeze the B2B product

The initial commercial product remains:

**HomeSignal Development Activity**

Core customer question:

> **What changed around this property, what is already coming, what may be coming, and what should the customer investigate before acquiring, financing, designing, developing, insuring, or otherwise committing capital?**

The product should not fragment into unrelated enterprise tools.

**Status: COMPLETE**

---

## Step 2 — Complete corporate data-rights clearance

Required classifications:

- **CLEARED FOR PAID REPORT**
- **CLEARED WITH ATTRIBUTION**
- **DERIVED FACTS ONLY**
- **HOLD — TERMS/RIGHTS NOT ESTABLISHED**
- **EXCLUDE**

Do not treat any of these as commercial permission by themselves:

- public availability
- government ownership
- API access
- downloadable data
- robots.txt access
- current HomeSignal ingestion
- absence of an explicit prohibition

For each pilot market, clear enough publisher data and geography to populate a useful report without leaking HOLD or EXCLUDE data.

Do not broaden a report just to fill empty sections.

If a desired customer category such as schools, parks, stadiums, civic facilities, data centers, or infrastructure lacks a cleared source, mark it as a **coverage gap**.

For any source used by the change-intelligence system, rights review must also consider whether HomeSignal may:

- retain prior publisher observations
- store source-record versions/hashes
- compare current and prior observations
- derive and display change events
- redistribute historical state where necessary
- deliver alerts derived from retained observations

Do not assume that permission to display the current row automatically establishes every historical-retention or derived-delta right.

---

## Step 3 — Remove unsupported prediction claims

Before corporate report production, separate:

- observed facts
- detected changes
- publisher status
- normalized lifecycle
- project timeline
- evidence-backed investigation considerations
- unsupported predictions

HomeSignal may tell the customer **what changed** and **what the official status is**.

HomeSignal must not convert those facts into unsupported conclusions about:

- engineering
- traffic
- utility capacity
- insurance loss
- property value
- future project impacts
- neighborhood desirability

The following remain outside Corporate V1 unless separately proven and approved:

- scores
- outlooks
- Quality of Life scoring
- predictive `sowhat` prose
- `Effect at this address`

---

## Step 3A — Build the Change Intelligence Contract

This is a **mandatory architecture gate** before "What Changed Recently" becomes the hero of the customer report.

The report cannot claim change merely from a recent publisher date. HomeSignal must be able to prove either:

1. an explicit publisher event, or
2. a difference between two comparable observations of the same stable project/source record.

### Required record identity

Every change-capable record must have a stable identity sufficient to compare it across refreshes.

Prefer, in order:

- publisher-native stable record/project/case identifier
- a documented deterministic HomeSignal source-record key
- a separately evidenced entity-resolution relationship

Do not use an address alone as the identity key.

Do not silently merge two records because their names or coordinates are similar.

### Project lineage and duplicate prevention

A source record and a customer-visible project are not always the same thing.

One real project may generate:

- an application record
- an approval record
- one or more permits
- amendments
- construction records
- later completion/withdrawal/decision records

HomeSignal must not inflate one project into several projects merely because several official rows exist.

Where official identifiers prove lineage, preserve:

- canonical project identity
- every contributing source record
- the relationship between filing / approval / permit / construction events
- the exact basis used to link them

Where lineage cannot be proven, keep records separate and disclose the uncertainty.

Summary metrics must distinguish, where relevant:

- **projects**
- **source records**
- **change events**

Do not say "3 projects changed" when the evidence is actually three rows belonging to one project.

### Change readiness and cold-start rule

A market is not automatically **change-ready** merely because current rows are available.

For each source/market record:

- `baseline_observation_at`
- `comparable_observation_count`
- `last_successful_observation_at`
- `expected_refresh_cadence`
- `stale_after`
- `change_ready`
- `source_health_state`

must be available or derivable.

A HomeSignal-detected change requires either:

- an explicit publisher event, or
- at least two comparable successful observations of the same stable record/project.

Until a source/record is change-ready, customer copy must use **Recent Official Activity** or equivalent rather than implying HomeSignal detected a transition.

### Material change contract

Store factual source changes needed for auditability, but do not turn every changed field into a brokerage alert or hero metric.

Customer-visible material changes should be a controlled vocabulary such as:

- first project/application detected
- application filed
- approved
- permit issued
- construction started
- meaningful construction-stage change
- withdrawn
- denied
- cancelled when explicitly publisher-supported
- completed when explicitly publisher-supported

Examples of changes that should normally remain technical/audit events rather than hero alerts:

- punctuation/casing correction
- parser-only normalization difference
- source row reorder
- non-substantive metadata edit
- retrieval timestamp change

A materiality rule must be deterministic and versioned. Do not introduce a subjective "impact score" to solve noise.

### Required change-intelligence fields

Where supported, the canonical commercial record should carry:

- `stable_project_id` and/or `source_record_id`
- `source_id`
- `source_record_key`
- `publisher_status_raw`
- `normalized_type`
- `normalized_lifecycle`
- `publisher_event_type`
- `publisher_event_date`
- `observed_at`
- `first_detected_at`
- `last_observed_at`
- `previous_status`
- `current_status`
- `change_event`
- `change_detected_at`
- `official_source_url`
- `source_version` and/or source-record hash
- `coverage_state`
- `source_health_state`

### Change-event rules

**A new fetch is not a change.**

**A recent publisher date is not automatically a HomeSignal-detected change.**

**A filing date is not the same fact as `first_detected_at`.**

**A record disappearing from a publisher feed is not automatically withdrawn, cancelled, demolished, or completed.**

**A change claim requires before/after evidence unless the publisher itself explicitly publishes the event.**

**A status transition must preserve both the prior and current evidence.**

**A parser or classifier change must not be presented as a real-world project change.**

**A source outage must never become "no project" or "project removed."**

### Change-event vocabulary

Use a small, auditable vocabulary. Examples:

- `first_detected`
- `application_filed`
- `status_changed`
- `approved`
- `permit_issued`
- `construction_started`
- `construction_status_changed`
- `withdrawn`
- `denied`
- `cancelled` only when the publisher explicitly establishes cancellation
- `completed` only when the publisher explicitly establishes completion
- `source_record_updated`
- `coverage_changed`

Do not infer stronger events from weaker evidence.

### History preservation

HomeSignal must retain enough evidence to reconstruct why a change was shown.

For each change event preserve:

- stable identity
- prior value
- new value
- source
- source record/version
- observed timestamps
- publisher event date where available
- derivation method/version when HomeSignal normalized the event
- attribution / rights classification

The durable history should be server-side. Browser `sessionStorage` or `localStorage` may cache customer state but must not be the authoritative change-history system.

### Existing decision-history authority

The existing `supabase/functions/get-address-report/sources/decision.ts` decision-history logic remains authoritative for the decision classes it already governs, including its safeguards around denied/withdrawn records and unsupported current-status claims.

Do not duplicate or weaken it inside the Development Activity Report.

However, that decision authority is **not** the universal change ledger. Step 3A must extend the broader commercial data contract without creating a conflicting second truth path.

### Existing evidence-architecture work

`docs/multi-source-evidence-architecture.md` already proposes stable source records, claims, source versions, first/last-seen concepts, and evidence retention.

That document is still a proposal, not an implemented dependency.

Use its principles where appropriate, but do not claim its proposed schema already exists.

### Step 3A close condition

Step 3A is complete for a pilot market only when HomeSignal can produce a deterministic, testable answer to:

> **What changed since the prior comparable observation of this same project/source record, and what exact evidence proves it?**

Until then:

- the report may show publisher event dates
- the report may show current lifecycle/status
- the report may show "recently filed" or "recently issued" when that is directly supported by the publisher date
- the report must **not** present those facts as HomeSignal-detected status changes

---

## Step 4 — Build the real Development Activity Report

For a market where Step 3A is closed, the report must answer:

> **What changed around this property since the prior comparable observation?**

For a market or record without durable prior-state evidence, use the narrower statement:

> **What recent official events are on the record around this property?**

Never label a recent publisher event as a HomeSignal-detected change unless Step 3A proves the delta.

Then:

> **What is approved / coming?**

Then:

> **What is proposed / under review?**

Then:

> **What exists today?**

The report should not open with a raw permit table.

Customer-facing output must not expose internal commercial-audit text such as:

- `Signed paid pilots: 0`
- `Verdict: NOT YET`
- internal rights-gate language
- raw implementation/debug explanations

Those facts may remain in internal/admin evidence, not in the brokerage/client report.

### Required report hierarchy

1. What Changed Recently
2. Approved / Coming
3. Proposed / Under Review
4. Permitted / Under Construction
5. Things to Review With Your Client
6. Property-centered map / evidence view
7. Full evidence / source records

The first four sections must be organized using the same canonical HomeSignal Types.

---

## Step 5 — Standardize development/change report content and lifecycle

Phase 1 standardizes development and infrastructure project records only.

Do not create a generalized existing-place inventory in this step.

Where cleared and available, every Project / Development Activity record should support:

- Project
- Type
- Subtype, where publisher-supported
- Location
- Distance
- Project Boundary
- Publisher Status
- Normalized Lifecycle
- Publisher Event Type
- Publisher Event Date
- Timeline
- First Detected
- Last Observed
- Previous Status, where known
- Current Status
- Latest Change
- Change Event
- Change Detected At
- Source
- Source Record / Version
- Confidence
- Coverage limitation, where applicable

Clearly distinguish:

- publisher-reported fact
- HomeSignal classification
- detected database/source change
- lifecycle normalization
- investigation consideration
- unsupported prediction

The normalized lifecycle must never strengthen the publisher evidence.

---

## Step 6 — Create a durable report snapshot contract

The current shipped SHA-256 `report_id` is a content fingerprint, not a durable issuance identity. Preserve that distinction in the commercial design.

Create:

- `report_id` — durable server-generated identifier for one stored report snapshot/issuance
- `content_hash` — deterministic hash of the canonical report content/data state
- `report_version` — schema/render contract version
- `generated_at`
- `generated_for_evaluation_id` / paid account id where applicable
- `property_key`
- report inputs
- immutable stored report snapshot

A generated commercial report must be tied back to the exact source/data state used to create it.

The report object should be capable of preserving:

- stable source/project identity
- current lifecycle state
- prior lifecycle/status where known
- publisher event
- change event
- first detected
- last observed
- latest change
- source record/version/hash
- attribution
- exclusions
- data/coverage state

`content_hash` may be used for integrity/deduplication.

`report_id` is used for:

- entitlement ledger
- sharing
- reopening
- portfolio/history
- audit trail
- paid delivery

A report snapshot is not a substitute for the change ledger.

Do not make a browser-only report, browser portfolio, `sessionStorage`, or `localStorage` the commercial system of record or the authority for report history or change history.

---

## Step 7 — Add secure share + client-ready print/PDF delivery

Provide:

- secure customer share link
- printable report
- PDF/export delivery
- lightweight brokerage/agent branding

Commercial share links must use an **opaque share/report token**, not raw address/ZIP/radius query parameters.

A shared client view must:

- open the stored report snapshot
- not regenerate the report
- not consume another trial credit
- be read-only by default
- support revocation
- support optional expiry
- avoid exposing internal audit/admin controls

Brokerage branding should be minimal and useful:

- brokerage name
- agent name
- optional logo
- contact information
- optional client/transaction label

Do not build a full white-label platform before paid usage proves demand.

### Standard client disclosure

Every client-facing report/share/PDF should carry a concise standardized disclosure substantially equivalent to:

> HomeSignal summarizes selected official public records available to its covered sources. It may not include every project or change and is not a substitute for independent property, municipal, title, zoning, legal, inspection, or other professional due diligence.

The disclosure must be readable and client-facing, not buried as internal audit language.

### Brokerage report audit trail

Preserve, server-side:

- brokerage/account
- agent/user
- report id
- property/report label
- generated timestamp
- report version
- data/source versions
- share created
- share revoked/expired
- PDF/download event where appropriate
- client-view event where appropriate
- disclaimer version

This audit trail is a brokerage record of what HomeSignal generated and what report version was shared.

It must not become a surveillance product.

All formats must inherit the same:

- source-rights rules
- attribution
- lifecycle wording
- change history
- exclusions
- provenance
- uncertainty / coverage limitations

Do not create separate business logic for PDF versus web.

---

## Step 8 — Build the minimal Agent Workspace + Brokerage Admin

### Agent Workspace

An agent should be able to:

- generate reports
- run coverage preflight
- add optional client/transaction labels
- find previous reports
- open/share reports
- compare candidate properties
- watch a property
- understand coverage
- understand current lifecycle/status
- see newly detected changes across watched properties
- see simple client engagement signals
- activate/access an evaluation
- see **reports used / reports remaining**
- see evaluation status

### Brokerage Admin

A brokerage owner/admin should be able to:

- manage brokerage name/logo/contact information
- invite agents
- deactivate agents
- see active agent count
- see reports generated by agent
- see brokerage-wide report usage
- see watched-property usage
- see client-share activity at an aggregate/useful level
- see brokerage-wide reports remaining / paid allocation
- manage billing and paid entitlement
- view the brokerage report audit trail
- reach plan/billing controls

## Agent Workspace Visual Contract

The Agent Workspace is not the client report.

It should prioritize the agent's next actions:

```text
HOMESIGNAL · ABC REALTY

Reports     Compare     Watching     Account

20-report evaluation
██████████████░░░░░░
13 used · 7 remaining

Generate report
[ Property address __________________ ] [ Check coverage ]

RECENT REPORTS
123 Main St       Smith Buyers      Shared     2 changes
87 Park Ave       Listing           Watching   1 change
44 Broadway       Jones Buyers      Draft      —

WHAT CHANGED ACROSS WATCHED PROPERTIES
3 newly approved
5 new applications
1 withdrawn
```

Agent workspace priorities:

1. generate a report
2. find a previous report
3. compare properties
4. see watched-property changes
5. share/client actions
6. see remaining evaluation/paid allocation

Do not make the agent navigate through brokerage administration to generate a report.

## Brokerage Owner/Admin Visual Contract

The brokerage-owner dashboard is a different product surface.

It should prioritize adoption, governance, allocation, and billing:

```text
HOMESIGNAL · ABC REALTY

Overview     Team     Reports     Watching     Billing

BROKERAGE USAGE
18 active agents
143 reports generated
92 shared with clients
37 watched properties

CURRENT ALLOCATION
312 / 500 reports used

RECENT CHANGE INTELLIGENCE
21 meaningful changes surfaced across watched properties

TEAM
Agent           Reports     Shared     Watching
Cheryl             28          19          6
John               17          11          4
Maria              12           9          3

[ Invite agent ]      [ Manage plan ]
```

Do not show invented sales/revenue outcomes.

The brokerage dashboard reports HomeSignal usage and engagement only.

## Workspace Navigation Separation

Keep these conceptual surfaces separate:

**Client report**
- one property
- evidence
- shareable with client

**Agent workspace**
- agent workflow
- reports
- comparisons
- watched properties
- client engagement

**Brokerage admin**
- team
- allocations
- branding
- usage
- billing
- audit trail

Do not collapse these into one dense screen.

The workspace must read identity, entitlement, report history, and usage from the server.

Do not use browser storage as the authority for evaluation limits, report history, brokerage usage, or billing state.

Do not build a large enterprise admin platform before paid usage proves the need. V1 brokerage admin should be deliberately small.

---

## Step 9 — Create the canonical commercial property-intelligence API

The web report, PDF, workspace, comparison view, alerts, evaluation flow, and future integrations should consume one canonical commercial response.

Do not expose consumer-only fields merely because they already exist.

The commercial response must enforce:

- the Corporate Output Source Allowlist
- the normalized lifecycle contract
- the Change Intelligence Contract where applicable
- server-side evaluation entitlement
- atomic report-credit consumption

For an evaluation request, the server must:

1. validate the invite/account entitlement
2. determine whether this is a new report or an existing stored report
3. refuse report #21 unless the brokerage has converted
4. generate/store the report only from allowed sources
5. decrement quota only after successful new-report creation
6. return reports used / reports remaining
7. avoid double-decrement on retries/idempotent requests

The browser must not be the authority for quota enforcement.

### One canonical generation path

Once the evaluation launches, customer-facing new report generation must not bypass this server contract.

The existing browser-direct NYC Open Data path must either:

- be retired from the customer evaluation surface, or
- be restricted to an internal/non-entitled diagnostic surface that cannot function as an unlimited customer generator.

There must not be two commercial report engines.

### Authentication and abuse controls

Keep the authenticated server posture.

Add:

- scoped evaluation/account authorization
- rate limiting
- bounded request size
- explicit allowed origins rather than an unnecessarily broad commercial CORS posture
- server-side idempotency
- token replay protection
- audit logging without raw invite tokens or sensitive URLs

A mass-email invitation must not turn the API into a public anonymous report proxy.

### Idempotency / credit semantics

A deliberate successful generation creates one report snapshot and consumes one credit.

A retry of the **same generation request** must return the same result without another credit.

Use a server-side idempotency key / request id with a uniqueness constraint per evaluation/account.

Reopening a stored `report_id` is not a new generation.

Refreshing the same property later is a new report only when the user explicitly requests a new current snapshot; it must receive a new durable `report_id`.

---

## Step 10 — Build a coverage-quality matrix

Do not sell nationally just because HomeSignal has 12,722 ZIP pages.

Measure where the **Phase 1 development/change report** has enough:

- cleared data
- reliable data
- useful data
- geographic coverage
- lifecycle coverage
- stable-identity coverage
- project-lineage coverage
- comparable-observation coverage
- change-readiness coverage
- source freshness / staleness
- change-history coverage
- Type coverage
- current-condition coverage

Coverage quality determines the first pilot markets.

A market should not be considered strong simply because it has many permit rows. It should be judged by whether the report can meaningfully answer:

- what changed
- what is approved / coming
- what is proposed
- what exists
- what official evidence supports those statements
- whether the relevant sources are fresh enough for a "what changed" claim
- whether summary counts are projects, source records, or events

Do not mark a Phase 1 market incomplete merely because HomeSignal does not carry existing schools, parks, stadiums, hospitals, retail, or other general POI inventories. Those are outside the Phase 1 product promise.

A market may be **report-ready** but not yet **change-ready**.

Define a third commercial state:

- **report-ready** — a useful current report can be assembled
- **change-ready** — HomeSignal can truthfully detect/describe change
- **sales-ready** — coverage, product wording, performance, secure delivery, evaluation, and paid conversion are production-ready for outbound acquisition

Mass brokerage outreach may target only **sales-ready** markets.

Campaign geography must be aligned to coverage. Do not mass-email brokerages whose normal property activity is materially outside the supported market and then reveal the coverage limitation after activation.

Mass brokerage outreach should use a market only when the customer-facing promise matches the measured readiness state.

---

## Step 11 — Launch the Autonomous 20-Report Brokerage Evaluation

After the report is production-ready for a pilot market, use mass outreach to drive invited brokerages into a self-service evaluation.

The evaluation offer is:

**20 free successful new property reports**

The purpose is to test the report on real brokerage addresses at meaningful volume before asking for payment.

### Required autonomous flow

**Outbound email → unique secure evaluation link → activation → report generation → server-side credit count → 20/20 complete → paid-pilot CTA**

No manual founder intervention should be required.

### Required behavior

- each invite is uniquely attributable
- evaluation identity is server-side
- report credits are server-side
- successful new reports consume one credit
- reopen/share/print/download do not consume another credit
- failures and address misses do not consume credit
- duplicate/retried requests do not double-consume credit
- reports remaining are visible to the brokerage
- evaluation completion is automatic
- the paid-pilot CTA appears automatically when the free allocation is exhausted

An optional time limit may be added, but the primary entitlement is the 20-report cap.

### Evaluation success questions

Measure:

- Did the brokerage activate?
- Did it generate a first report?
- How many of the 20 reports were used?
- How quickly were the 20 reports used?
- Did the reports reveal changes the agent/client did not already know?
- Which change categories mattered?
- Did agents open official source records?
- Did agents compare candidate properties?
- Did agents activate Watch This Property?
- Did they return after a detected change?
- Did they reach the 20-report limit?
- Did more than one agent inside the brokerage use the evaluation?
- How concentrated was usage by agent?
- Did the brokerage admin invite additional agents?
- Did they proceed to the paid-pilot offer?

A free evaluation proves **usage and usefulness**.

It does **not** prove willingness to pay and does not count as a paid pilot.

### Autonomous evaluation feedback

Because the outbound model is not founder-managed, capture structured feedback inside the product.

At minimum, collect lightweight optional signals such as:

- Did this report reveal something you did not already know?
- Would you share this report with a client?
- What information was missing?
- Was the lifecycle/status clear?
- Did you open an official source record?

Do not block report use on survey completion.

Use behavioral evidence first; survey answers supplement it.

---

## Step 12 — Convert evaluations autonomously into 3–5 paid brokerage pilots

Set the paid-pilot price and terms before mass evaluation outreach so the free evaluation has a defined continuation path.

Because the acquisition model must operate autonomously, the end-of-evaluation CTA must lead to a real self-service continuation path, not merely "contact us."

Before mass outreach, define:

- paid-pilot price
- billing unit
- whether the plan is brokerage-level, seat-based, report-based, watch-based, or a defined combination
- included agent seats
- included report/watch limits
- paid entitlement state
- payment provider / checkout path
- authoritative payment-success webhook/event
- failed/cancelled payment behavior
- evaluation → paid account transition
- invoice/receipt delivery as appropriate

The billing provider is not the entitlement authority by itself.

A successful server-verified payment event must cause the HomeSignal entitlement state to change atomically and idempotently.

Do not grant paid access from a client-side "success" URL alone.

Convert qualifying evaluation users into 3–5 paid brokerage pilots.

The paid pilot should specifically test whether **change intelligence** is the reason the brokerage will pay.

Learn:

- Did the report reveal a nearby change the agent/client did not already know?
- Did it affect a showing, offer, diligence question, or client conversation?
- Which change categories mattered?
- Did agents use Approved / Coming differently from Proposed / Application?
- Did agents compare multiple properties?
- Did agents activate Watch This Property?
- Which sections were shared with clients?
- How often did an alert bring the agent/customer back?
- What would the brokerage pay per report, agent, office, or monitored property?
- Which evaluation behaviors best predicted paid conversion?

The paid pilot — not the free evaluation — is the commercial proof point.

---

## Step 13 — Instrument acquisition-grade product proof

Measure the full acquisition and product funnel, including:

- outbound invite created
- evaluation link opened
- evaluation activated
- first report generated
- report credit consumed
- reports used
- reports remaining
- evaluation completion / 20 of 20 used
- paid-pilot CTA shown
- paid-pilot CTA clicked
- paid conversion
- report reopened
- report shared
- PDF printed/downloaded
- source/project opened
- property revisited
- comparison created
- property watch activated
- new-development change viewed
- alert opened
- customer returns after a status change
- Proposed → Approved transition viewed
- Approved → Construction transition viewed

The commercial acquisition events above must be persisted server-side. The current browser-local usage log is not sufficient for funnel measurement.

### Brokerage ROI / renewal metrics

The brokerage owner should be able to see a concise operational summary such as:

- active agents
- reports generated
- reports shared with clients
- candidate-property comparisons created
- watched properties
- meaningful change events surfaced
- client report opens/reopens
- official-source opens
- evaluation/paid allocation used

Do not present these as proof of closed transactions or revenue unless HomeSignal actually has that data.

The purpose is to show the brokerage whether agents are using the product and delivering it to clients.

For outbound campaigns, also preserve:

- campaign id/source
- invite id
- delivery/bounce state where available
- opt-out/suppression state
- evaluation account created from the invite
- paid conversion attribution

Sales-outreach suppression must remain separate from resident/community alert subscriptions unless a later design explicitly unifies them.

The goal is evidence that HomeSignal change intelligence creates recurring commercial value.

---

## Step 14 — Test a reusable listing-level summary

After the paid report is proven, test a smaller evidence-backed HomeSignal summary beside or inside a property/listing workflow.

The listing workflow should support the agent preparing both:

- a seller/listing presentation
- a buyer-facing listing/property discussion

The listing summary should lead with **change**, not generic neighborhood facts.

Example structure:

**Nearby change summary**
- 1 project newly approved
- 2 active applications
- 1 construction start detected
- nearest approved project: 0.3 mi

Then link to the full Development Activity Report.

It must derive from the same canonical commercial data contract.

Do not create a second incompatible intelligence product.

---

## Step 15 — Add batch / portfolio / API scale

Only after single-address sales are proven.

Extend the same engine from one property to:

- hundreds or thousands of properties
- brokerage listings
- buyer watchlists
- projects
- assets
- corridors
- sites

Portfolio intelligence should answer:

- Which properties had meaningful changes this week?
- Which watched properties gained a new application?
- Which proposed projects became approved?
- Which projects moved into construction?
- Which applications were withdrawn or cancelled?

---

## Step 16 — Protect the long-term platform thesis

Every feature should pass this test:

> **Does this strengthen HomeSignal as the evidence-backed change-intelligence layer for property and development decisions?**

The long-term moat is not a generic property database and it is not the report UI itself.

It is the underlying evidence-backed change-intelligence asset:

**Stable Project Identity × Type × Lifecycle × Change History × Exact Proximity × Official Evidence × Continuous Monitoring**

For brokerages, the commercial moat is strengthened further by:

**Change Intelligence × Agent Workflow × Client Delivery × Brokerage Governance**

A later product phase may add **Existing Surroundings**, but only after dedicated feeds are accurate and complete enough that knowledgeable local agents will not immediately find obvious omissions.

Phase 1 should win trust by being narrow and accurate rather than broad and visibly incomplete.

That same intelligence can support brokerages, CRE, infrastructure, utilities, AEC, insurance, and large property platforms.

Do not add features that make HomeSignal broader while weakening this core.

---

# Immediate Product Execution Order

**A. Freeze this updated plan in Git.**

Commit it as a new dated product-architecture record beside the existing historical checkpoint. Do not silently rewrite historical evidence files.

**B. Audit the current NYC V1 records for stable identity and project lineage.**

Measure:

- publisher-native identifiers
- which filing/permit rows can be linked to the same real project
- which records cannot be safely merged
- duplicate inflation in current summary counts

**C. Build the smallest universal durable observation/delta layer.**

Reuse:

- canonical HomeSignal Type authority
- canonical lifecycle vocabulary
- existing decision-history authority
- source-rights allowlist
- existing evidence/provenance concepts

Do not create an FSR-only truth path.

**D. Establish and warm the NYC change baseline.**

Capture comparable observations and source-health/freshness state.

Do not call NYC "change-ready" until the defined baseline/readiness gate is satisfied.

**E. Prove change detection, lineage, and outage behavior with tests.**

At minimum test:

- same record, no change → no change event
- same project represented by multiple linked source rows → one project, multiple evidence records/events
- same record, publisher status changed → one preserved before/after event
- new record → first detected, not "approved" unless publisher says approved
- source outage → no deletion/cancellation event
- successful fetch missing a prior row → no cancellation unless publisher proves it
- parser/classifier change → no fake real-world change
- withdrawn/denied → existing decision authority
- source reappears after outage → no fake first detection
- duplicate/retried fetch → no duplicate event
- technical metadata edit → no brokerage hero alert

**F. Replace the overloaded report identifier.**

Create a durable server-side `report_id` for each stored snapshot and retain the current deterministic concept as `content_hash` / data-state hash.

**G. Deploy and production-smoke the canonical commercial API.**

Keep JWT/authenticated posture.

Do not weaken it into a public anonymous generator.

**H. Remove the customer quota bypass.**

Move brokerage/trial new-report generation off the browser-direct NYC Open Data path and onto the canonical commercial server path.

There must be one commercial generation authority.

**I. Redesign the customer report only after the data contract is proven.**

Implement the **Customer-Facing Visual Layout Contract** in this plan.

Use:

1. What Changed Recently — only where the delta is proven
2. Recent Official Activity — fallback for cold-start/non-delta records
3. Things to Review With Your Client
4. Development Activity Map / evidence view
5. Approved / Coming
6. Proposed / Under Review
7. Permitted / Under Construction
8. Change History
9. Full official evidence / coverage

Do not build a Phase 1 **What Exists Today** section.

Remove internal audit/debug language.

Do not change the approved hierarchy merely because another layout is easier to code.

**J. Build secure stored-report delivery.**

Add:

- durable report snapshots
- opaque revocable share links
- read-only client view
- print/PDF
- lightweight brokerage/agent branding
- optional client/transaction labels
- standardized client disclosure
- brokerage report audit trail
- no raw address rebuild URLs

**K. Build the Agent Workspace + minimal Brokerage Admin.**

Implement the separate **Agent Workspace Visual Contract** and **Brokerage Owner/Admin Visual Contract** in this plan.

Agent requirements:

- mobile
- coverage preflight
- fast report generation
- recent reports across devices
- comparison
- Watch This Property
- client engagement signals

Brokerage requirements:

- admin
- agent invites/deactivation
- brokerage branding
- shared usage/allocation
- billing/entitlement
- usage/ROI summary
- report/share audit trail

**L. Build and security-test the Autonomous 20-Report Brokerage Evaluation.**

Required:

- unique secure invite
- existing identity/session reuse
- server-side entitlement
- 20-report quota
- idempotent atomic counting
- reports remaining
- rate limiting / replay protection
- no charge for reopen/share/print/download
- no credit loss on technical failure/address miss
- automatic evaluation-complete state
- server-side acquisition analytics
- optional in-product feedback

**M. Build the autonomous paid continuation path.**

Before mass outreach:

- set price and paid-pilot terms
- provide self-service checkout/payment
- process authoritative server-side payment events
- switch entitlement atomically/idempotently
- define failure/cancellation behavior

A CTA without a working paid continuation path is not autonomous conversion.

**N. Run an end-to-end launch gate.**

Prove:

**invite → redeem → authenticated/scoped session → report 1 → share/reopen free → report 20 → report 21 blocked → checkout → paid entitlement → report generation continues**

Also prove:

- cross-user/cross-evaluation isolation
- one brokerage evaluation shares one 20-report pool as configured
- agent invites do not mint unintended extra credits
- no public/direct path bypasses the quota
- poor/unsupported coverage does not consume a credit
- shared-report opening does not consume a credit
- desktop report follows the approved visual hierarchy
- mobile report follows the approved mobile hierarchy
- Agent Workspace and Brokerage Admin remain distinct surfaces
- Proposed/Application is visually distinguishable from Approved/Coming
- internal audit/debug information does not render on client-facing surfaces

**O. Start mass brokerage outreach.**

Do not start before the change-readiness, entitlement, secure delivery, agent/brokerage workspace, and paid-conversion gates are green.

Target only sales-ready markets and brokerage prospects whose operating geography matches supported coverage.

**P. Convert evaluation users into 3–5 paid brokerage pilots and measure whether change intelligence is what they pay for.**

---

# Hard Rules

1. **What changed is the HomeSignal competitive advantage. Keep it upfront once the delta is provable.**
2. A new fetch is not a change.
3. A recent publisher event is not automatically a HomeSignal-detected change.
4. A filing date is not `first_detected_at`.
5. A disappearing record is not automatically cancelled, withdrawn, completed, or removed.
6. A source outage is never evidence that a project disappeared.
7. Preserve before-and-after evidence for every HomeSignal-detected status transition.
8. Do not count multiple source rows as multiple projects when official lineage proves they are one project.
9. Do not silently merge source rows when lineage is unproven.
10. Do not hide lifecycle certainty.
11. Do not call an application "coming."
12. Do not make unsupported impact predictions.
13. Do not use HOLD or EXCLUDE sources to make the report look fuller.
14. Do not introduce an uncleared basemap/data provider merely to improve presentation.
15. Use one canonical HomeSignal Type system.
16. Use the existing lifecycle and decision authorities; do not create a conflicting FSR-only truth path.
17. Preserve source attribution, source versions, change history, and source-health state.
18. Every change claim must be traceable to an explicit publisher event or comparable stored observations.
19. A market may be report-ready without being change-ready; customer wording must reflect that.
20. Browser storage is not the authoritative report, history, entitlement, or funnel system.
21. Separate durable `report_id` from deterministic `content_hash`.
22. Commercial share links do not expose raw address/ZIP/radius as the report authority.
23. Evaluation quota is enforced server-side.
24. There is one customer-facing commercial generation path; no browser-direct quota bypass.
25. Only a successful new report consumes a free-report credit.
26. Reopen/share/print/download do not consume another credit.
27. Technical failure or address miss does not consume credit.
28. Retries are idempotent and do not double-consume credit.
29. Invite tokens are bootstrap credentials, not permanent identity or entitlement authorities.
30. Reuse existing authentication/session infrastructure rather than creating a second identity system.
31. Evaluation completion must transition automatically to a working paid-pilot path.
32. Paid entitlement changes only from an authoritative server-verified payment/conversion event.
33. Do not start mass brokerage outreach until change readiness, secure delivery, autonomous evaluation, and autonomous paid conversion are production-ready.
34. A free evaluation proves usefulness; only a paid pilot proves willingness to pay.
35. The report must support both buyer-side and seller/listing workflows without making unsupported outcome claims.
36. Coverage preflight occurs before evaluation-credit consumption.
37. A poor/unsupported coverage result does not consume an evaluation credit.
38. The default brokerage evaluation is one shared 20-report pool per evaluation account unless a campaign explicitly defines otherwise.
39. Do not mint 20 separate free-report pools merely because multiple employees at one brokerage were emailed.
40. Brokerage account membership must be explicit; do not infer customer-account identity from email domain alone.
41. The brokerage owns the commercial account; agents are users within that account unless a separately defined individual plan applies.
42. Client-facing reports carry a standardized limitations/due-diligence disclosure.
43. Preserve a server-side audit trail of which report version was generated/shared by which brokerage agent.
44. Mobile usability and report-generation performance are launch requirements for the agent workflow.
45. Do not mass-market into markets that are not sales-ready.
46. Brokerage ROI metrics describe observed HomeSignal usage; do not invent transaction, revenue, or client outcomes.
47. The Customer-Facing Visual Layout Contract is part of the product contract.
48. Cursor/implementation may improve spacing, responsiveness, accessibility, and component quality but may not reorder the approved information hierarchy without explicit product approval.
49. What Changed / Recent Official Activity must remain the report hero; maps, evidence tables, and technical metadata are supporting layers.
50. Proposed/Application must be visually distinguishable from Approved/Coming and not rely on color alone.
51. Client Report, Agent Workspace, and Brokerage Admin are separate surfaces with separate jobs.
52. Internal audit, pilot-verdict, rights-gate, debug, and engineering copy does not render on client-facing reports.
53. Mobile layout is a launch requirement, not a post-launch enhancement.
54. Phase 1 does not promise or render a complete existing-surroundings inventory.
55. Do not add new school, park, hospital, stadium, library, retail, restaurant, or general POI feeds merely to fill the Phase 1 report.
56. Existing places may appear only when they are themselves the subject of a covered development/change record; that does not imply complete inventory coverage for that place type.
57. The Phase 1 map must be labeled as development/change activity, not as a complete surroundings/neighborhood map.
58. Avoid wording such as "everything nearby", "complete surroundings", "all nearby buildings", or equivalent completeness claims.
59. The customer-facing scope statement must explain that the report focuses on development activity and change and is not an inventory of existing amenities/buildings.
60. Future Existing Surroundings expansion requires its own feed-completeness, rights, coverage, and accuracy gate before it enters the client report.
61. No shortcuts and no duplicate commercial logic.
