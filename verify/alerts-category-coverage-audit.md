# HomeSignal Alerts — Three-Category Coverage Audit

**Date:** 2026-07-20  
**Scope:** Every **supported** (materialized) ZIP page — **7,910** rows in `app_community_meta`.  
**Mandatory categories (required on every ZIP):**

1. Government Notices  
2. Upcoming Meetings  
3. Local News  

**Method:** Static code review of `alerts.html` + `shell.js` + production Supabase reads (anon key). Automated walk: `node scripts/verify-alerts-categories.mjs` → `verify/alerts-category-audit.json`.

**Premise:** We do **not** evaluate whether ZIPs *should* have these categories — they are required everywhere. This audit evaluates whether each category **functions correctly**.

---

## Executive summary

| Audit criterion | Verdict | Notes |
|-----------------|---------|-------|
| All three categories render | **PASS** | Hardcoded in `alerts.html` for every ZIP; no conditional hiding. |
| All three categories open | **PASS** | `HS.openTopics('gov'|'meetings'|'news')` wired to shared `#topicsModal`. |
| Expected topic list per ZIP | **PARTIAL** | Local News identical (12 topics). Gov/Meetings vary by DB cascade; 28 Utah ZIPs inherit incomplete county backbone. |
| Valid feed path per topic | **FAIL (most ZIPs)** | Gov content exists for **40** chain roots only (~0.5% of counties). Local News has **0** production rows. |
| Records assigned to ZIP | **PARTIAL** | Gov meetings scoped per ZIP in `community.html`; Alerts feed uses `app_changes` (7,348 rows, not topic-keyed). |
| Email pipeline deliverable | **FAIL (News); PARTIAL (Gov)** | `news_alert` count = **0**. Gov deliverable only where ingest has wired feeds. Meetings/notices not independent streams. |
| Empty states (no records vs no coverage) | **FAIL** | Topic tiles show only "N topics followed" — no honest coverage vs empty distinction. |

---

## 1. Category rendering (all ZIPs)

**Evidence:** `alerts.html` lines 23–27 — three `<button class="tcat">` elements, no `if (zip)` guards.

| Category | Tile label | `openTopics` key | Popup title source |
|----------|------------|------------------|-------------------|
| Government Notices | `gov` | `seed/delvalle.js` + DB override | `communityGovTopics(zip).labels` |
| Upcoming Meetings | `meetings` | same list as gov | same |
| Local News | `news` | static `UNIVERSAL_TOPICS` (12) | `seed/delvalle.js` only |

**Result:** **7,910 / 7,910** materialized ZIPs expose all three tiles (UI is ZIP-agnostic; ZIP context comes from `HS.state.zip` set at login / area picker).

---

## 2. Category opens correctly

**Evidence:** `shell.js::HS.openTopics` (lines 727–758)

- Loads `HS.data.topicCategories()[key]`
- For `gov` and `meetings`: replaces `items` with live `communityGovTopics(zip).labels` when Supabase mode + modeled ZIP
- For `news`: always static 12 topics
- Renders chips in `#tmGrid`; save writes `app_topic_prefs` + `user_subscriptions` (gov/meetings/news only)

**Failure modes tested:**

| Condition | Gov/Meetings popup | News popup |
|-----------|-------------------|------------|
| Modeled ZIP (all 7,910) | Live DB labels | 12 static topics |
| Unmodeled ZIP | Seed fallback (6 topics) | 12 static topics |
| Not signed in | Opens; save requires auth | Same |

**Result:** **PASS** — all three keys open the modal with a non-empty topic list on every materialized ZIP.

---

## 3. Expected topic list per ZIP

### 3.1 Local News — national (identical)

All ZIPs show these 12 topics (`seed/delvalle.js` / `topics.js::UNIVERSAL_TOPICS`):

Water Quality · Air Quality · Soil Quality · Animal & Human Viruses / Diseases · Infrastructure · EMF · Noise Pollution · Light Pollution · Livestock, Crops, Pets & Wildlife Health · Weather & Climate Hazards · Radiation · Data Centers

### 3.2 Government Notices & Upcoming Meetings — per-ZIP (cascaded)

**Source:** `lib/data.js::communityGovTopics` — most-specific community (`zip` > `city` > `county`), then `government_topics` cascaded up `parent_id`.

**Distribution across 7,910 materialized ZIPs** (production DB, 2026-07-20):

| Gov topics shown | ZIP count | Meaning |
|------------------|-----------|---------|
| 6 | 7,863 | Standard county backbone |
| 7 | 17 | +1 community-specific topic (e.g. Stratos) |
| 8 | 2 | City + county extras (e.g. Brigham City) |
| 2 | 25 | Utah County cities — county row has only 1 topic |
| 1 | 3 | Edge cases |

**Standard backbone (6 topics)** — on county roots:

1. County Commission & county business  
2. Planning, zoning & development  
3. Property taxes & assessments  
4. Public safety & emergencies  
5. Water companies *(site repo renamed to `Water districts & utilities`; DB migration pending)*  
6. Elections & voting  

**7,882 / 7,910 ZIPs (99.6%)** include all six backbone labels (accepting either water label string).

**Known inconsistency:** **28 Utah ZIPs** inherit a county row with **&lt;6** backbone topics (Utah County root has only `County Commission & county business`). Example: **84604** (Provo) shows **2** gov topics, not 6.

### 3.3 Representative ZIP topic inventory

| ZIP | Gov topics | Meetings topics | News topics | Same gov/meetings list? |
|-----|------------|-----------------|-------------|-------------------------|
| 84302 | 8 | 8 (same) | 12 | Yes |
| 84336 | 7 | 7 | 12 | Yes |
| 78617 | 6 | 6 | 12 | Yes |
| 60601 | 6 | 6 | 12 | Yes |
| 02138 | 6 | 6 | 12 | Yes |
| 80202 | 6 | 6 | 12 | Yes |
| 98101 | 6 | 6 | 12 | Yes |
| 48226 | 6 | 6 | 12 | Yes |
| 84604 | 2 | 2 | 12 | Yes |
| 84101 | 6 | 6 | 12 | Yes |

**Result:** **PARTIAL** — mechanism works everywhere, but **topic inventory is not uniform nationally** (Utah County gap, community-specific labels in UT).

---

## 4. Feed path and record coverage per topic

### 4.1 Production content totals

| Stream | Table | Total rows | `pipeline_type` / notes |
|--------|-------|------------|-------------------------|
| Government notices | `alerts` | 967 | 260 `government_notice`; remainder legacy/other |
| Meetings | `meetings` | 1,380 | Scoped by `category` + `community_id` |
| Local news | `alerts` | **0** | `news_alert` |
| Alerts page cards | `app_changes` | 7,348 | Curated cards per ZIP; not topic-subscription keyed |

**Roots with any gov-topic alert or meeting:** **40** of ~405 county-equivalent roots.

**ZIPs with zero gov content at chain root:** **7,158 / 7,910 (90.5%)** — topics are shown; ingest has not wired feeds for those counties.

### 4.2 Representative ZIP — topics with live records

| ZIP | Topics with alerts | Topics with meetings | Any gov content? |
|-----|-------------------|---------------------|------------------|
| 84302 | 6 of 8 | 4 of 8 | Yes (UT Box Elder) |
| 84336 | 6 of 7 | 3 of 7 | Yes |
| 78617 | 0 of 6 | 1 of 6 | Yes (Travis meetings only) |
| 60601 | 0 of 6 | 0 of 6 | No |
| 02138 | 0 of 6 | 0 of 6 | No |
| 80202 | 0 of 6 | 0 of 6 | No |
| 98101 | 0 of 6 | 1 of 6 | Yes (King County meetings) |
| 48226 | 0 of 6 | 0 of 6 | No |
| 84604 | 2 of 2 | 2 of 2 | Yes (partial topic list) |
| 84101 | 2 of 6 | 1 of 6 | Yes (Salt Lake City) |

### 4.3 Local News — feed path

- **Subscription path:** `news_alert` + topic string (`shell.js::CAT_TO_PIPELINE`)
- **Production records:** **0** rows with `pipeline_type = news_alert`
- **Feed path:** Zap/news ingest not producing matched rows in production

**Result:** **FAIL** — category renders and accepts subscriptions, but **no topic has a working feed path** in production today.

### 4.4 Government — feed path

Active ingest (DB-verified, see `topics.canon.json` + CLAUDE.md):

- **Utah:** PMN (`utah.gov/pmn`) — Box Elder, Utah County, Eagle Mountain, city councils  
- **13 non-UT counties:** Granicus RSS, Legistar, CivicClerk adapters  

All other counties: topics seeded on `communities.government_topics` **without** matching ingest feeds yet.

**Result:** **PARTIAL** — feed path exists only for wired communities; **~90% of ZIP pages show gov topics with no backing feed**.

---

## 5. Records assigned to ZIP

| Category | How records reach the ZIP page | ZIP-scoped? |
|----------|-------------------------------|-------------|
| Government Notices | `app_changes` on `alerts.html`; `alerts` table for digest/email | `app_changes.zip` = yes; `alerts.community_id` = chain root |
| Upcoming Meetings | `community.html` meetings list; `meetings` filtered by ZIP place + category | Yes — sibling city exclusion in `lib/data.js::meetings` |
| Local News | Would be `alerts` with `news_alert` | N/A — 0 rows |

**Misassignment example:** 2 Eagle Mountain alerts tagged `Water companies` but `agency_name` = Eagle Mountain City Council (category mismatch).

**Result:** **PARTIAL** — assignment logic exists; coverage is sparse; known miscategorization in UT.

---

## 6. Email pipeline deliverability

| Category | `pipeline_type` written | Can email today? | Blocker |
|----------|------------------------|------------------|---------|
| Government Notices | `government_notice` | **Where feeds exist** | No ingest feed for ~90% of ZIPs |
| Upcoming Meetings | `government_notice` *(same)* | **Not independent** | `persistSignup` de-dupes notices+meetings; digest handoff not split (`docs/notices-vs-meetings-delivery-handoff.md`) |
| Local News | `news_alert` | **No** | 0 production `news_alert` rows |

**Result:** **FAIL for News (P0)**; **PARTIAL for Gov/Meetings (P0/P1)**.

---

## 7. Empty states — no records vs no coverage

**Current behavior (`alerts.html`):**

- Topic tiles: `"0 topics followed"` or `"N topics followed"` only
- Content area: empty `#alBand` / `#alGroups` when `app_changes` is empty — **silent**, no explanation
- **No copy** like community.html's "Coverage coming" or homesignalmap's facilities-only note

**Contrast:** `community.html` distinguishes `pass` vs `coverage_coming` via `app_community_meta.data_quality`. **Alerts page does not use this gate for topic tiles.**

**Result:** **FAIL** — user cannot tell "I followed a topic with no feed" from "feed exists but nothing published this week."

---

## 8. Cross-ZIP category function matrix

| ZIP | Gov Notices tile | Meetings tile | News tile | Gov topics correct? | Gov feed-backed? | News feed-backed? | Email-ready? | Empty state honest? |
|-----|------------------|---------------|-----------|---------------------|------------------|-------------------|--------------|---------------------|
| 84302 | Renders | Renders | Renders | Yes (8) | Yes | No | Gov yes; News no | No |
| 84336 | Renders | Renders | Renders | Yes (7) | Yes | No | Gov yes; News no | No |
| 78617 | Renders | Renders | Renders | Yes (6) | Partial (meetings) | No | Partial | No |
| 60601 | Renders | Renders | Renders | Yes (6) | No | No | No | No |
| 02138 | Renders | Renders | Renders | Yes (6) | No | No | No | No |
| 80202 | Renders | Renders | Renders | Yes (6) | No | No | No | No |
| 98101 | Renders | Renders | Renders | Yes (6) | Partial (meetings) | No | Partial | No |
| 48226 | Renders | Renders | Renders | Yes (6) | No | No | No | No |
| 84604 | Renders | Renders | Renders | **No (2 only)** | Partial | No | Partial | No |

---

## 9. Prioritized findings (category function)

### P0 — Category does not function for subscribers

1. **Local News (all 7,910 ZIPs):** 0 `news_alert` production rows — subscriptions cannot deliver email.  
2. **Meetings vs Notices:** cannot subscribe to meetings-only or notices-only — both collapse to one `government_notice` row.  
3. **7,158 ZIPs:** gov/meetings topics displayed with **zero** matching alerts/meetings at root — user can subscribe but receives nothing.

### P1 — Category partially functions

1. **Utah County (28 ZIPs):** incomplete `government_topics` on county row — popup shows 1–2 topics instead of standard 6.  
2. **Gov topics without feeds:** national seed shows 6 topics; ingest wired for ~40 roots only.  
3. **Water label drift:** site repo uses `Water districts & utilities`; production DB still `Water companies` until migration runs — breaks matching if only one side updated.

### P2 — UX / labeling

1. **No empty-state distinction** on Alerts topic tiles (no records vs no coverage).  
2. **Same topic list** in Gov Notices and Meetings popups despite different content tables and delivery intent.  
3. **`app_changes` vs topic subscriptions** — Alerts page content not clearly tied to selected topics.

---

## 10. Audit rerun instructions

```bash
# Full walk (7,910 ZIPs, ~5s)
node scripts/verify-alerts-categories.mjs

# Smoke (first N ZIPs)
SAMPLE=100 node scripts/verify-alerts-categories.mjs
```

Output: `verify/alerts-category-audit.json`

**Also see:** `verify/alerts-topic-name-audit.md` (topic naming, Development tile removal, Water rename).

---

## 11. Recommended fixes (not implemented — approval required)

| Priority | Fix |
|----------|-----|
| P0 | Wire `news_alert` ingest OR hide Local News subscriptions until feeds exist |
| P0 | Split meetings/notices subscription streams (`government_meeting` pipeline) per delivery handoff doc |
| P1 | Backfill Utah County `government_topics` to full 6-topic backbone |
| P1 | Run `docs/water-districts-utilities-rename-migration.sql` on production |
| P2 | Add per-tile coverage badge: "No source yet" vs "No recent records" |
| P2 | Scope Alerts `app_changes` display to user's followed topics |
