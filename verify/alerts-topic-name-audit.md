# HomeSignal Alerts — Topic Name Audit

**Date:** 2026-07-20  
**Scope:** Production Alerts page (`alerts.html`) topic tiles, popups, and cross-ZIP topic inventory.  
**Method:** Live Supabase reads (anon key, same as production pages) + static code review. Representative ZIPs tested in browser-equivalent resolution (`communityGovTopics` cascade logic from `lib/data.js`).

**Out of scope (not changed in this pass):** topic renames, merges, feed config, subscriptions, email delivery, schemas, RLS, production data.

---

## 1. Development tile removal — safe to remove

**Verdict: YES — safe.** Removing the Development alert tile does **not** delete or corrupt subscription data and does **not** change email delivery.

| Concern | Finding |
|---------|---------|
| Email delivery | The `dev` category is **explicitly excluded** from `CAT_TO_PIPELINE` and `persistSignup()` in `shell.js`. Development picks were never written to `user_subscriptions`. |
| Saved preferences | `dev` picks may exist in `hs:topicPrefs` (localStorage) and `app_topic_prefs` (category=`dev`). Removal hides the UI only; **existing rows are preserved** (no migration). |
| Subscriptions | Production query `user_subscriptions WHERE topic IN (Development subtopics)` returns **0 rows** — none of the eight Development subtopics were ever subscription keys. |
| Tests | No test asserts the Development tile (`cc-dev`, `openTopics('dev')`). |
| Duplicate product surface | Development project tracking lives on **Development & Impact** (`development.html`, `homesignalmap.html`) — the Alerts tile duplicated that experience with non-deliverable topics. |

**Implemented in this branch:** tile removed from `alerts.html`; `dev` entry removed from `seed/delvalle.js::topicCategories`; tile grid updated from 4→3 columns in `app.css`.

---

## 2. Files / components involved in Development tile removal

| Layer | File | Role |
|-------|------|------|
| **Tile UI** | `alerts.html` | Rendered the green Development `<button class="tcat">` and `cc-dev` count; called `HS.openTopics('dev')`. |
| **Topic config** | `seed/delvalle.js` → `topicCategories.dev` | Defined popup title, 8 subtopics, default `on` indices. Exposed via `HS.data.topicCategories()`. |
| **Popup modal** | `partials/shell.html` → `#topicsModal` | Shared modal for all categories (not Development-specific). |
| **Popup logic** | `shell.js` → `HS.openTopics`, `HS.saveTopics`, `persistTopics` | Opens modal; saves to localStorage + `app_topic_prefs`. **`dev` excluded from `persistSignup()`** (lines 721–723, 798–806). |
| **Styles** | `app.css` → `.tcats` | `grid-template-columns: repeat(4,1fr)` → now `repeat(3,1fr)`. |
| **Saved keys** | `hs:topicPrefs` (localStorage), `app_topic_prefs.category = 'dev'` | App-only prefs; not digest subscriptions. |
| **Legacy mockup** | `homesignalphase1_13.html` | Frozen prototype; still has Development tile — **not production**. |
| **Nav (separate)** | `partials/shell.html` → "Development & Impact" | Correct home for development content; unchanged. |

---

## 3. Complete inventory of popup groups and topic names

### 3.1 Alerts page tiles (after Development removal)

| Tile | Popup key | Pipeline (`user_subscriptions`) | Topic source |
|------|-----------|--------------------------------|--------------|
| Government Notices | `gov` | `government_notice` | Live DB cascade (`communities.government_topics`) or seed fallback |
| Upcoming Meetings | `meetings` | `government_notice` *(same pipeline today)* | Same list as Government Notices |
| Local News | `news` | `news_alert` | Static list in `seed/delvalle.js` (matches `topics.js::UNIVERSAL_TOPICS`) |

### 3.2 Government Notices & Upcoming Meetings — shared topic list

These two popups render the **same labels** per ZIP. In supabase mode, labels come from the cascaded `government_topics` chain (`lib/data.js::communityGovTopics`).

**Standard county backbone** (seeded on ~405 county roots nationally):

1. County Commission & county business
2. Planning, zoning & development
3. Property taxes & assessments
4. Public safety & emergencies
5. Water companies
6. Elections & voting

**Additional labels found in production** (community-specific, appended via cascade):

| Label | Where it appears |
|-------|------------------|
| City government (Brigham City) | 84302 and other Brigham City ZIPs |
| City government (Tremonton) | 84337 |
| City government (Provo) | Utah County city ZIPs (e.g. 84604) |
| City government (Lehi) | Lehi ZIPs (e.g. 84043) |
| City government (Alpine, American Fork, …) | In `topics.canon.json::government_topics_pending` — **in feeds but not yet delivered as alerts** |
| Stratos data center project | Box Elder County cascade only |
| Eagle Mountain data center project | Eagle Mountain community (canon; verify live rows separately) |

**Utah County anomaly:** the Utah County root row carries only `County Commission & county business` (not the full six-topic backbone). City ZIPs like 84604 therefore show **two** government topics (city + commission), not eight.

### 3.3 Local News — static universal list

From `seed/delvalle.js` / `topics.js::UNIVERSAL_TOPICS`:

1. Water Quality
2. Air Quality
3. Soil Quality
4. Animal & Human Viruses / Diseases
5. Infrastructure
6. EMF
7. Noise Pollution
8. Light Pollution
9. Livestock, Crops, Pets & Wildlife Health
10. Weather & Climate Hazards
11. Radiation
12. Data Centers

**Not on Alerts page** (defined in `topics.js` but no tile/popup):

- `emerging_technology` pipeline
- `global_best_practices` pipeline

### 3.4 Removed — Development tile (no longer on Alerts page)

Was `topicCategories.dev` with 8 UI-only topics (never in canonical ingest):

1. Data Centers *(also appears under Local News)*
2. Residential
3. Commercial
4. Industrial
5. Roads & Infrastructure
6. Schools
7. Utilities
8. Parks & Green space

### 3.5 Other surfaces (not Alerts popups)

| Surface | Topics |
|---------|--------|
| `community.html` | No topic picker; "Follow" uses `ensureAreaSubscribed` floor (`Planning, zoning & development` + `County Commission & county business` only). |
| Frozen legacy pages | `box-elder.html`, `eagle-mountain.html` — separate gov tiles; not audited here. |

---

## 4. Why "Water companies" exists

"Water companies" is a **canonical government topic** in the ingest taxonomy (`topics.canon.json::government_topics_active`, position 5 of 6 backbone topics). It was seeded on every county root during the national community build (six standard topics copied from the original Utah/Box Elder model).

**Original intent (inferred from production records, not from a separate product spec):** capture **water-district and special-district government notices** published through the **Utah Public Notice Marketplace (PMN)** — board meetings, public hearings, rate/property-related hearings, and meeting schedules for entities like water conservancy districts.

It is **not** meant to cover:

- Environmental water-quality news (that's **Water Quality** under Local News)
- Municipal water utility service outages as consumer alerts
- Permit/planning filings (that's **Planning, zoning & development** or Development & Impact)

---

## 5. Evidence — records and feeds for "Water companies"

### 5.1 Production alert records

Query: `alerts WHERE category = 'Water companies'`  
**Count: 11** (all `pipeline_type = government_notice`)

| agency_name | community | count | source |
|-------------|-----------|-------|--------|
| Bear River Water Conservancy District | Box Elder County | 9 | `https://www.utah.gov/pmn/sitemap/notice/*.html` |
| Eagle Mountain City Council | Eagle Mountain | 2 | Same PMN host — **likely miscategorized** (agency is city council, not a water body) |

Sample titles: "Public Meeting", "PUBLIC HEARING", "Annual Public Meeting", "Public Notice - 2026 Board Meeting Schedule", "MEETING CANCELLED".

### 5.2 Production meeting records

Query: `meetings WHERE category = 'Water companies'`  
**Count: 0** — no meeting rows use this category, despite the topic appearing in the **Upcoming Meetings** popup.

### 5.3 Feeds

The public `feeds` table is **not readable** via the anon key (0 rows returned). Feed wiring lives in `homesignal-ingest` (`feeds.csv`). From PMN notice URLs and `agency_name`, the active source is **Utah PMN** body postings for water conservancy / special districts in Box Elder County.

### 5.4 Geographic coverage

| ZIP tested | Water companies in popup? | Alerts at county root | Meetings at county root |
|------------|----------------------------|----------------------|--------------------------|
| 84302 (UT) | Yes | 9 | 0 |
| 84336 (UT) | Yes | 9 | 0 |
| 78617 (TX) | Yes | 0 | 0 |
| 60601 (IL) | Yes | 0 | 0 |
| 02138 (MA) | Yes | 0 | 0 |
| 80202 (CO) | Yes | 0 | 0 |
| 98101 (WA) | Yes | 0 | 0 |
| 48226 (MI) | Yes | 0 | 0 |

**Conclusion:** Feed-supported **only in Utah** (PMN). The label is shown nationally because it is part of the standard county `government_topics` seed, not because non-Utah feeds exist.

### 5.5 Subscriptions

`user_subscriptions WHERE topic = 'Water companies'` → **0 rows** (anon-visible).

### 5.6 Canonical mapping

- **Internal key = display label** (word-for-word): `Water companies`
- Listed in `topics.canon.json::government_topics_active`
- `pipeline_type` on matching alerts: `government_notice`

---

## 6. Recommendation for "Water companies"

**Recommend: RENAME** (pending approval — do not implement in this pass)

**Proposed name:** `Water districts & utilities`

| Criterion | Assessment |
|-----------|------------|
| Homeowner clarity | "Water companies" is vague; most residents think of a **district**, **authority**, or **city utility** — not a "company." |
| Actual content | Bear River **Water Conservancy District** board notices — not corporate "company news." |
| Geographic validity | "Company" excludes municipal utilities, cooperatives, authorities, and special districts — the entities PMN actually posts. |
| Overlap | Partial overlap with **Water Quality** (news) and **Utilities** (removed Development tile); government hearings are distinct from quality news. |
| Meetings popup | Topic appears under Meetings but **0 meeting rows** — misleading split. |
| National display | Shown in 8/8 test ZIPs but **delivers only in Utah** — empty subscription elsewhere. |

**Not recommend REMOVE:** Utah has real, sourced notices today.  
**Not recommend MERGE** with Planning or Public safety: content is water-governance-specific.  
**Not recommend KEEP as-is:** label is inaccurate for the entities delivered and for non-corporate utilities nationwide.

---

## 7. Cross-ZIP comparison (representative ZIPs)

**Resolution rule:** most-specific community wins (`zip` > `city` > `county`), then `government_topics` cascade up the parent chain.

### 7.1 Government topics shown per ZIP

| ZIP | Resolved page | Gov topics shown (count) | Notable extras beyond standard 6 |
|-----|---------------|--------------------------|----------------------------------|
| 84302 | Brigham City (city) | 8 | City government (Brigham City); Stratos data center project |
| 84336 | Snowville (zip) | 7 | Stratos data center project |
| 78617 | Del Valle (zip) | 6 | Standard backbone only |
| 60601 | Chicago (zip) | 6 | Standard backbone only |
| 02138 | Cambridge (zip) | 6 | Standard backbone only |
| 80202 | Denver (zip) | 6 | Standard backbone only |
| 98101 | Seattle (zip) | 6 | Standard backbone only |
| 48226 | Detroit (zip) | 6 | Standard backbone only |

**Contrast (not in test set):** 84604 Provo shows **2** topics (City government (Provo) + County Commission only) because Utah County's DB row was never seeded with the full six-topic backbone.

### 7.2 Local News topics

**Identical in all ZIPs** — static `UNIVERSAL_TOPICS` list (12 topics). Not overridden by DB.

### 7.3 Master cross-ZIP table (abbreviated — full backbone rows)

*Internal key = display string for all topics below (word-for-word matching rule).*

| ZIP | Popup group | Displayed topic | Internal key | Feed-supported | Has records | Email-deliverable | Same label nationally? | Issue |
|-----|-------------|-----------------|--------------|----------------|-------------|-------------------|--------------------------|-------|
| 84302 | Gov Notices / Meetings | County Commission & county business | same | UT+13 counties | Yes (alerts+meetings) | Yes* | Yes | *Meetings/notices not independent streams yet |
| 84302 | Gov Notices / Meetings | Planning, zoning & development | same | UT+some | Yes | Yes* | Yes | |
| 84302 | Gov Notices / Meetings | Water companies | same | UT PMN only | Yes (9 alerts) | Yes* | Yes | 0 meetings; 2 EM miscategorized alerts in canon |
| 84302 | Gov Notices / Meetings | Stratos data center project | same | Box Elder only | Yes | Yes* | **No** | UT-specific project label on popup |
| 84302 | Gov Notices / Meetings | City government (Brigham City) | same | UT | Yes (meetings) | Yes* | **No** | City-specific |
| 78617 | Gov Notices / Meetings | Water companies | same | **No** | **No** | No content | Yes | Empty topic nationally displayed |
| 78617 | Gov Notices / Meetings | County Commission & county business | same | Yes (Granicus) | Yes (meetings) | Yes* | Yes | |
| 98101 | Gov Notices / Meetings | Water companies | same | **No** | **No** | No content | Yes | Empty |
| ALL | Local News | Water Quality … Data Centers (×12) | same | Zap/news ingest | **No** (`news_alert` count=0) | **No** | Yes | Entire tile has no production content |
| ALL | ~~Development~~ | ~~Residential … Parks~~ (×8) | N/A | **Never wired** | **No** | **No** | N/A | **Removed** — UI-only stub |

---

## 8. Topics that appear without feed support

| Topic | Shown where | Feed reality |
|-------|-------------|--------------|
| Water companies | All county-backbone ZIPs | Records only in Utah (PMN water districts) |
| Property taxes & assessments | Standard backbone | 0 records in all 8 test ZIPs |
| Public safety & emergencies | Standard backbone | 0 records in 6/8 test ZIPs; sparse in UT |
| Elections & voting | Standard backbone | 0 records in 6/8 test ZIPs |
| Planning, zoning & development | Standard backbone | Content in UT; 0 in IL/MA/CO/MI test ZIPs |
| All 12 Local News topics | Every ZIP | **`news_alert` pipeline has 0 production rows** |
| City government (X) | UT city ZIPs | Meetings exist for wired cities; notices often pending per canon |
| Stratos data center project | Box Elder cascade | Box Elder-specific |

---

## 9. Topics that cannot result in an email

| Category | Why |
|----------|-----|
| **Development tile subtopics** (removed) | Never in `CAT_TO_PIPELINE`; `persistSignup` skips `dev`. |
| **Local News (all 12)** | `news_alert` subscriptions can be saved, but **0 `alerts` rows** with `pipeline_type=news_alert` in production — nothing to match. |
| **Government topics with 0 content** | Subscription row can exist, but digest has nothing to send (e.g. Water companies in TX/IL/MA/CO/MI/WA). |
| **Meetings selections (partial)** | Even when meetings exist, `meetings` and `notices` popups both write `government_notice` today — independent meeting-only email not implemented (`docs/notices-vs-meetings-delivery-handoff.md`). |

---

## 10. Duplication and overlap audit

| Pair | Relationship | Verdict |
|------|--------------|---------|
| **Government Notices ↔ Upcoming Meetings** | Identical topic lists; both map to `government_notice`; de-duped in `persistSignup` | **Intentional UI split, but poorly delivered** — user cannot subscribe to meetings-only vs notices-only |
| **Planning, zoning & development** (gov) ↔ **Infrastructure** (news) | Gov = hearings/notices; News = quality/environment news | **Intentional but confusing** — similar words, different pipelines |
| **Planning, zoning & development** ↔ Development tile subtopics | Tile was UI-only; real permits live on Development & Impact | **Accidental duplication (resolved)** — tile removed |
| **Data Centers** | In Local News AND was in Development tile | **Same label, different dead ends** — news has no content; dev tile was non-deliverable |
| **Water Quality** ↔ **Water companies** | News environmental quality vs government water-district hearings | **Intentional but poorly labeled** — "water" appears twice; companies ≠ quality |
| **Infrastructure** (news) ↔ **Roads & Infrastructure** (removed dev) | News vs dev permit types | **Accidental** — dev removed |
| **Public safety & emergencies** ↔ **Weather & Climate Hazards** | Gov emergencies vs news hazards | **Partial overlap** — storms could fit both; boundaries unclear |
| **Animal & Human Viruses / Diseases** ↔ **Livestock, Crops, Pets & Wildlife Health** | Human/public health vs agricultural health | **Intentional split but awkward** — long labels, unclear boundary |
| **Utilities** (removed dev) ↔ **Water companies** | Dev tile utility permits vs gov water districts | **Different concepts, similar user mental model** |

---

## 11. Proposed user-facing names (NOT implemented — approval required)

| Current name | Proposed name | Rationale |
|--------------|---------------|-----------|
| Water companies | Water districts & utilities | Matches conservancy districts, authorities, co-ops |
| County Commission & county business | County government | Clearer for non-commission states (boroughs, parishes) — **high impact, needs ingest sync** |
| Planning, zoning & development | Planning & land use | Shorter; "development" overload |
| Animal & Human Viruses / Diseases | Illness & disease outbreaks | Homeowner language |
| Livestock, Crops, Pets & Wildlife Health | Farm & animal health | Shorter |
| EMF | EMF & wireless radiation | Spell out acronym |
| Infrastructure | Roads, bridges & infrastructure | Narrower to match likely news tagging |

---

## 12. Full topic table

| Current name | Internal key | Actual content | Coverage | Problem | Recommended action | Proposed name |
|--------------|--------------|----------------|----------|---------|-------------------|---------------|
| County Commission & county business | same | Commission/council meetings & notices | 13+ non-UT counties + UT | "Commission" odd in strong-mayor cities | P2 — consider rename | County government |
| Planning, zoning & development | same | Planning hearings, zoning notices, PMN planning | UT + wired counties | Overlaps "development" colloquially | P2 | Planning & land use |
| Property taxes & assessments | same | Tax assessor notices | Canon only; sparse records | Empty in most test ZIPs | P1 — no feed in most places | (keep or rename to Property taxes) |
| Public safety & emergencies | same | Emergency gov notices | Sparse | Vague vs news hazards | P2 | Public safety alerts |
| Water companies | same | Water **district** board notices (PMN) | **Utah only** (9 real + 2 miscategorized) | Wrong entity type; 0 meetings; national empty label | **P1 rename** | Water districts & utilities |
| Elections & voting | same | Election notices | Sparse | | P2 | (keep) |
| City government (X) | same | City council meetings | UT wired cities | Pending cities in canon not delivered | P1 for pending | (keep pattern) |
| Stratos data center project | same | Project-specific notices | Box Elder | State-specific on national popup pattern | P2 | (keep until project ends) |
| Water Quality | same | Environmental news | **No production rows** | Undeliverable | P0 | (keep) |
| Air Quality | same | Environmental news | **No production rows** | Undeliverable | P0 | (keep) |
| Soil Quality | same | Environmental news | **No production rows** | Undeliverable | P0 | (keep) |
| Infrastructure | same | Environmental/infra news | **No production rows** | Overlaps planning | P0/P2 | Roads, bridges & infrastructure |
| EMF | same | EMF news | **No production rows** | Opaque acronym | P0/P3 | EMF & wireless radiation |
| Data Centers | same | News + was dev tile | **No news rows** | Duplicated concept | P2 | (keep one surface) |
| ~~Development tile topics~~ | N/A | None | Never wired | Fake subscription surface | **Removed** | N/A |

---

## 13. Prioritized findings

### P0 — User selects a topic but cannot receive email

1. **All 12 Local News topics** — `news_alert` has **0** production alerts; subscriptions are effectively void.
2. **Development tile (removed)** — eight subtopics saved to `app_topic_prefs` only; never reached `user_subscriptions`.
3. **Meetings vs Notices independence** — selecting a topic in only one popup cannot control delivery separately; both collapse to one `government_notice` subscription (`shell.js::persistSignup` de-dupe).

### P1 — Topic has no working feed or maps incorrectly

1. **Water companies** outside Utah — shown on every county-backbone ZIP, **0 records** in 6/8 test ZIPs.
2. **Water companies** — 2 Eagle Mountain City Council notices miscategorized as `Water companies` (agency_name contradicts category).
3. **Property taxes, Public safety, Elections** — in popup for all test ZIPs, **0 records** in most.
4. **Utah County backbone** — county row missing 5 of 6 standard topics; Provo ZIP shows 2 topics instead of 7+.
5. **City government (X)** — 17 cities in `government_topics_pending` in canon; not delivered as alerts yet.

### P2 — Misleading, duplicated, or inconsistent

1. **Water companies** label — inaccurate for conservancy districts and municipal utilities.
2. **Water companies under Upcoming Meetings** — 0 meeting rows; hearings appear as **notices** only.
3. **Data Centers** — appears under Local News; was also on removed Development tile.
4. **Stratos data center project** — UT-specific label on Box Elder ZIPs only; pattern doesn't generalize.
5. **County Commission & county business** — commission-centric wording on Denver/Detroit/Seattle pages.

### P3 — Minor wording / presentation

1. **EMF** — acronym unexplained.
2. **Animal & Human Viruses / Diseases** — long, clinical phrasing.
3. **Tile grid** — was 4-column with one non-deliverable tile; now 3-column after removal.

---

## Audit instructions (revised for future runs)

When re-running this audit:

1. **Read popup labels from the live page logic** — `HS.openTopics` + `communityGovTopics(zip)` for gov/meetings; `seed/delvalle.js` for news. Do not assume `topics.js` drives the Alerts UI (it does not load on `alerts.html`).
2. **Test the ZIP list** — at minimum: 84302, 84336, 78617, 60601, 02138, 80202, 98101, 48226; add 84604 for Utah County backbone gap.
3. **Evidence queries** (Supabase REST, anon key from `config.js`):
   - `alerts?category=eq.<Topic>&community_id=eq.<rootId>`
   - `meetings?category=eq.<Topic>&community_id=eq.<rootId>`
   - `user_subscriptions?topic=eq.<Topic>`
   - `alerts?pipeline_type=eq.news_alert` (news pipeline health)
4. **Do not add categories or rename topics** without explicit approval.
5. **Development belongs on Development & Impact** — never re-add an Alerts Development tile.
6. **Claims discipline** — attach query + count to every production assertion.
7. **Feeds table** may be empty via anon; cite PMN URLs / `agency_name` on alerts when feeds aren't readable.

---

## Change log (this session)

| File | Change |
|------|--------|
| `alerts.html` | Removed Development tile and `dev` from topic count loop |
| `seed/delvalle.js` | Removed `topicCategories.dev` |
| `app.css` | `.tcats` grid 4 → 3 columns |
| `verify/alerts-topic-name-audit.md` | Created (this document) |
