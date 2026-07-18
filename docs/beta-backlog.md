# Beta Backlog — living triage document

> **Status: Beta Observation Mode.** The Maps + Project Intelligence MVP went to
> public beta on **2026-07-18** (PR #289, deploy `7ce2bf1`). We are learning
> before we build: **no new features, no redesigns, no refactors** until real
> homeowner feedback drives them. Every future change must land in exactly one
> of the four priority buckets below before any code is written.

---

## How to use this document

1. **Every incoming item gets a row** — date, source, one-line description,
   priority. An item with no row does not get built.
2. **Sources are tagged honestly** (claims discipline — this repo's rule):
   - `homeowner` — a real beta user said or did this (quote or event evidence).
   - `signal` — an instrumented metric moved (events table, CI, signups).
   - `audit` — engineering-observed during the launch process, **not** user
     feedback. Audit items can seed the backlog but can never be promoted to
     "requested by users" without a real report behind them.
3. **Never fabricate demand.** "Users will probably want…" is not a source.
   An empty homeowner section stays empty until a homeowner fills it.
4. **Triage cadence:** review new intake weekly; re-sort priorities as
   frequency data accumulates. A P1 reported by three separate homeowners
   outranks any audit-seeded P2.
5. **Next sprint selection:** all open P0s first, always. Then P1s ordered by
   how many distinct homeowners hit them. P2 requires **multiple independent
   requests**. P3 waits.

### Intake channels (already live — no new instrumentation needed)
- **Contact form** (`contact.html`) and the founder inbox.
- **Request-my-community flow** (ZIP not covered → email capture) — both a
  coverage signal and a feature request in one.
- **Premium waitlist** signups (interest signal for paid features).
- **Anonymous events analytics** (`events.js` → `events` table): page views,
  follows, ZIP searches, signups. INSERT-only, no PII.
- **Daily CI**: `verify-maps` (13:41 UTC cron) + `verify-communities` +
  `verify-development` — automated P0 detectors for broken loading, broken
  pages, and the facility-slot mechanism on live data.

---

## P0 — Broken
*Prevents a homeowner from using the product. Data integrity, broken
navigation, failed loading, broken official-record links. Fix immediately.*

### Homeowner-reported
*(none yet — beta opened 2026-07-18)*

### Signals / audit
*(none open)*

| Date | Source | Item | Status |
|---|---|---|---|
| — | — | No open P0s at beta start. Launch verification: Pages deploy green, `verify-maps` green post-deploy (16 pins, 4/4 facility floor on live 78617 data), 65-check launch suite green. | — |

**Standing P0 watch items** (auto-detected, not currently failing):
- `verify-maps` daily cron red → treat as P0 until diagnosed.
- Any official-record link (`source_ref`) 404ing for a homeowner → P0 (the
  anti-fabrication contract rests on those links working).
- Supabase/jsDelivr outage → pages now show the honest "couldn't load / Try
  again" state; recurring reports of it = P0 investigation.

---

## P1 — Confusing
*Users don't understand something. Poor wording, navigation friction,
first-time confusion.*

### Homeowner-reported
*(none yet — waiting for real reports; do not pre-fill)*

### Audit-seeded candidates (engineering-observed at launch, 2026-07-18 — promote/demote on real feedback)

| Date | Source | Item | Notes |
|---|---|---|---|
| 2026-07-18 | audit | **Sample-community disclosure is subtle on deep links.** Signed-out users who land directly on Alerts/Development see Del Valle sample content; the disclosure lives on the dashboard subline + map chip only. Candidate fix: persistent dismissible sample banner. | The #3 pick from the final pre-launch review. Watch for "why am I seeing Texas?" reports. |
| 2026-07-18 | audit | **"0 topics followed" reads stark for new users** on Alerts (strict opt-in is correct behavior; the wording may read as broken). | Watch for confusion reports before rewording. |
| 2026-07-18 | audit | **Project stage appears in up to four panel sections** (specs, Q3, What-we-know, Timeline). Judged reinforcement, not noise, at launch. | Only act if homeowners call it repetitive. |
| 2026-07-18 | audit | **Q4 "Can I still participate?" vs the Public Participation section** could read as duplicated on records with no hearing. | Watch. |

---

## P2 — Requested
*Features requested by multiple beta users; workflow and quality-of-life
improvements. Requires ≥2 independent homeowner requests to schedule.*

### Homeowner-reported
*(none yet — this section is the whole point of the beta; keep it honest)*

### Audit-seeded candidates (zero user demand recorded — do not build without requests)

| Date | Source | Item | Notes |
|---|---|---|---|
| 2026-07-18 | audit | **User-editable watchlist.** "Worth watching nearby" is currently derived from the closest real records; letting homeowners pin/unpin would need a real UI + the existing `watchlist_items` concept. | Deferred at launch. |
| 2026-07-18 | audit | **Quality-of-Life data population** (ingest-side, cross-repo): live `app_projects` rows mostly carry empty `impact_dimensions`, so the QoL filter/cells are honestly empty. Filling them is engine work in `homesignal-ingest`. | The single highest-leverage data improvement for the Maps panel. |
| 2026-07-18 | audit | **"Compare to nearby homes"** — the dead button was removed at launch; rebuild only if homeowners ask for comparisons. | |
| 2026-07-18 | audit | **Reports page rebuild** (hidden from nav at launch): make the report list real, drop the "impact model" claim, generate honest shareable documents. | Re-enable nav only when production-ready. |

---

## P3 — Future
*Nice ideas, experiments, long-term roadmap. No commitment implied.*

| Date | Source | Item | Notes |
|---|---|---|---|
| 2026-07-18 | audit | Dark mode (single light theme today, consistent by design). | |
| 2026-07-18 | audit | Flood-zone / school map layers (the disabled toggles were removed at launch; return only when the data is actually ingested for a community). | |
| 2026-07-18 | audit | Project lifecycle identity — track "proposed → approved → built" as one entity instead of independent notices (known engine residual, see `homesignal-ingest` docs). | Cross-repo. |
| 2026-07-18 | audit | Opportunity Center / Financial Intelligence / Document Vault (the removed roadmap block) — revisit when their data sources exist. | |

---

## Change log
- **2026-07-18** — Document created at beta start. Zero homeowner reports;
  all seeded entries are audit-observed launch leftovers, labeled as such.
