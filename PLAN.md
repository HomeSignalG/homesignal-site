# HomeSignal Phase 1 — Build Plan (v4, vanilla stack)

> Status: **DRAFT — awaiting founder review before scaffolding** (per build prompt v4:
> "write PLAN.md and pause for my review before scaffolding").
> Source of truth for layout/design: `./homesignalphase1_13.html` (the approved mockup, now in-repo).
> Companion: `DECISIONS.md` (assumptions), `PROGRESS.md` (running log, created at scaffold time).

---

## 0. TL;DR

Build the Phase 1 HomeSignal app **inside `homesignal-site` as vanilla HTML/CSS/JS** (no
framework, no build step), reading/writing the existing Supabase project with the anon key +
RLS. The ingestion/scoring backbone lives in `homesignal-ingest` (Python), parameterized by
ZIP. Prove it end-to-end on **one real community: Del Valle, TX 78617 (Travis County)**, through
the exact code path all 12,000+ ZIPs use — no special-casing.

**This plan cannot be executed blindly because `homesignal-site` is a LIVE site.** Five mockup
pages already exist and serve real traffic, the live DB schema differs from the prompt's data
model, and the topic taxonomy differs. §2 and §7 lay out those collisions and propose
resolutions; the **Open Decisions (§9)** are what I need your call on at the review gate.

---

## 1. What the mockup actually is

A single-file SPA mock (`homesignalphase1_13.html`) with **one shared shell** (dark left sidebar
`#10231a`, 236px, + sticky top bar) and **13 views** switched client-side via `go(view)`:

| Mockup view id | Nav item | Target page (proposed) |
|---|---|---|
| `page-home` | (logo) | `index.html` *(collides — live)* |
| `page-mission` | Today's Priorities | `today.html` *(new)* |
| `page-dash` | Dashboard | `dashboard.html` *(collides — live)* |
| `page-alerts` | Alerts | `alerts.html` *(new)* |
| `page-dev` | Development | `development.html` *(new)* |
| `page-detail` | (Development detail) | `development.html?id=` *(new)* |
| `page-maps` | Maps | `maps.html` *(new)* |
| `page-props` | Properties | `properties.html` *(new)* |
| `page-propdetail` | (Property detail) | `property.html?id=` *(new)* |
| `page-comm` | Communities | `community.html?zip=` *(collides — live, extend)* |
| `page-reports` | Reports | `reports.html` *(new)* |
| `page-contact` | (footer) Contact | `contact.html` *(collides — live)* |
| `page-privacy` | (footer) Privacy | `privacy.html` *(collides — live)* |

Plus **5 modals** (shared, live on every page): location/request-community (`locModal`),
property switcher (`switcherModal`), topic picker (`topicsModal`), premium waitlist
(`premiumModal`), share (`shareModal`).

**Design tokens** are already in the mockup's `:root` (bg `#f4f6f4`, green `#157a49`, sidebar
`#10231a`, `--sidebar:236px`, the two `--shadow` values, system font). We ship that CSS as-is —
no restyle, no Tailwind.

**Component vocabulary** to turn into reusable vanilla template functions: story **card**
(left color bar + lens label + headline + "what it means for you" + impact **chips** + footer with
**window pill** + distance + action), **stat** tiles, **score ring** (conic-gradient), component
**score bars**, timeline **thread**, **map panel/legend**, **topic chips**, **modals**.

---

## 2. Where it lives + the live-site collision (READ FIRST)

`homesignal-site` is served live at homesignal.net (GitHub Pages). These mockup pages **already
exist and serve real users**, with different content/design from the mockup:

- `index.html` — current marketing homepage (not the sidebar-app homepage in the mockup).
- `dashboard.html` — exists.
- `community.html` — the **1,710-line live per-ZIP civic-alerts page** generated for 12,000+ ZIPs.
  The prompt says *keep/extend* this one.
- `contact.html`, `privacy.html` — exist (prompt says *update* these).

Overwriting live `index.html`/`dashboard.html`/`community.html` in place is a **visible,
hard-to-reverse production change**. Proposed safe path (pending your call — Decision A):

1. **New pages (no collision) — build directly:** `today.html`, `alerts.html`,
   `development.html`, `maps.html`, `properties.html`, `property.html`, `reports.html`.
2. **Colliding pages — build behind a namespace for review, swap at sign-off:** build the new
   app homepage/dashboard as `app/index.html` + `app/dashboard.html` (or `index.app.html`) so the
   live homepage is untouched until you approve; then promote at the review gate.
3. **`community.html` — extend in place, additively.** It already resolves `?zip=` from Supabase
   and is the "12,000×" page. Add the mockup's Communities-view chrome (the app shell + the
   locked Phase-2 demographic/market cards + "Invite your neighbors") **without breaking** the
   existing civic-alerts rendering. This is the one page the prompt explicitly says to reuse.
4. **`contact.html` / `privacy.html` — update in place** to the mockup's shell + copy (privacy
   copy is preserved verbatim; the Terms section stays).

The alternative (Decision A option 2) is to treat this as a deliberate full replacement of the
live front-end and overwrite in place. **That is a founder call, not mine.**

---

## 3. The shared shell (hard rule: byte-identical menu everywhere)

The left sidebar + top bar + all 5 modals must be **identical on every page**. With no build step,
the DRY approach:

- **`partials/shell.html`** — the sidebar `<aside class="side">`, the top bar `<div class="top">`,
  and all five modal overlays, exactly as in the mockup.
- **`app.css`** — the mockup's `<style>` block lifted verbatim into one shared stylesheet,
  `<link>`-ed by every page (keeps tokens/components in one place).
- **`shell.js`** — an ES module that: `fetch()`es `partials/shell.html` and injects it into a
  `<div id="hs-shell"></div>` mount at the top of each page's `<body>`; wires nav active-state
  from the page's `data-nav` attribute; wires the mobile off-canvas drawer (`☰` + backdrop, the
  `@media(max-width:900px)` behavior already in the mockup); wires modal open/close + Escape +
  focus-trap + `aria-modal`; boots the Supabase client and the session/property context.
- Each page is a thin `<body data-nav="alerts">` + its own `<main>` content + `<script
  type="module" src="shell.js">` + a page module. **Zero menu markup is duplicated** in page files.

> Fallback if `fetch()` of a partial is undesirable (e.g. `file://`): a tiny `gen-shell.mjs`
> build-free generator that inlines `partials/shell.html` into each page on commit. Prompt allows
> "a `partials/shell.html` fetched-and-injected, **or** an identical generated include." Decision B.

---

## 4. Data layer — Supabase (anon key + RLS is load-bearing)

- One shared client from CDN ESM: `import { createClient } from
  'https://esm.sh/@supabase/supabase-js'` in `shell.js`. Anon key + project URL come from a small
  runtime config (`config.js` / `window.HS_CONFIG`), never hardcoded per page. (The existing site
  already uses this anon-key pattern — reuse its client bootstrap, `hs-resolve.js`.)
- **Auth: reuse the existing homesignal.net Supabase session.** No new login UI. Browsing is
  public; only *persisting* actions (follow/watch, save topics, add property) require a session —
  a signed-out user taking one is routed to the existing sign-in, then the action completes. Local
  dev: a stubbed demo session flag so authed screens render (documented in README).
- **PostGIS distances are computed, never stored.** Distance shown on every card = distance from
  each item's `lat/lng` to the **active property's** `lat/lng`, computed at query time
  (`ST_Distance`/`earthdistance` RPC), re-derived when the property switcher changes the active home.

### Reconciling the prompt's data model with the LIVE schema (Decision C)
The prompt's model is keyed by `community_zip`; the live schema is keyed by `community_id uuid`
with `zip_codes text[]`, and several prompt tables overlap existing ones with different shapes:

| Prompt table | Live reality | Plan |
|---|---|---|
| `communities` (zip, community_score, growth_pressure, value_trend, component_scores json) | Live `communities` (id, name, county, state, zip_codes[], level, parent_id, government_topics[], slug) — **no score columns** | **Additive migration:** add `community_score int`, `growth_pressure text`, `value_trend numeric`, `component_scores jsonb` to the live table. Resolve a ZIP → community via existing `zip_codes @>` logic (do NOT re-key to zip). |
| `projects` | none | **New table**, FK to `communities.id` (+ a `zip` convenience column). |
| `changes`/`alerts` | Live `alerts` exists (pipeline_type check: permit_filing/government_notice/news) | The mockup's "alerts" are impact stories. **New table `changes`** (impact stories) rather than overloading live `alerts`; keep live `alerts` untouched. Decision C. |
| `meetings` | Live `meetings` exists | Reuse; add columns only if needed (`agenda jsonb`, `related_project_id`). |
| `environmental_risk` | Live `development_reports`/`property_reports` caches carry EPA/flood | **New table `environmental_risk`** (flood/wildfire/heat per zip/parcel) OR derive from existing caches. Decision C. |
| `properties`, `topic_prefs`, `follows`, `watchlist_items` | Live has `user_subscriptions` (topic follows) | **New tables** for properties/follows/watchlist; **map `topic_prefs` onto the existing `user_subscriptions`** model where possible so email delivery keeps working. Decision C. |
| `community_requests`, `premium_waitlist` | none | **New tables** (anon INSERT, SELECT denied to anon/authenticated). |
| `contact_messages` | Live `contact_messages` exists (`docs/contact-messages-setup.sql`) | **Reuse as-is.** |

All new/changed schema is written as `docs/*.sql` migrations (this repo's convention) AND applied
via Supabase MCP `apply_migration`, so it stays reproducible.

### RLS (mandatory — the browser holds the anon key)
- `properties`, `topic_prefs`(/`user_subscriptions`), `follows`, `watchlist_items`: owner-only
  read/write (`auth.uid() = user_id`).
- `community_requests`, `premium_waitlist`, `contact_messages`: **anon INSERT allowed; SELECT
  denied to anon AND authenticated** (service-role only) — they hold emails. This is an explicit
  E2E check: "premium waitlist inserts a row and the anon key cannot select it back."
- `communities`, `projects`, `changes`, `meetings`, `environmental_risk`: public read-only.

---

## 5. Ingestion + scoring backbone (`homesignal-ingest`, Python)

Parameterized by ZIP — running another community requires **zero code change**.

```
Connector (per source)  ->  normalize  ->  dedupe + geocode  ->  Scorer  ->  writer
   |                                                                            |
   SourceAdapter (seed  <->  real feed, swappable)              communities / projects / changes / meetings
```

- **`Connector` interface + `SourceAdapter` seam** for: building permits, planning/
  commissioners-court & council agendas+minutes, water-quality readings, environmental/flood
  layers, transportation projects, school-district items. Each ships a **stub adapter** that reads
  a seed file today and a **real adapter** later, with no call-site change. (Reuses the existing
  engine's adapter pattern — Granicus/Legistar/CivicClerk/Socrata/EPA already exist for real feeds;
  Travis County TX is already partially wired, and `del-valle-78617` has a development-reports seed.)
- **`Scorer`** (rule-based, testable): change → life-impact dimensions
  (traffic, water, air, safety, home value, cost) + a 0–100 impact/HomeSignal score with component
  sub-scores. Plain-language "what it means for you" text is **templated** in Phase 1 behind a clean
  seam to swap in an open/self-hostable LLM later — **no paid LLM key required to run**.
- **Writer** upserts `communities` (scores/component_scores), `projects`, `changes`, `meetings`
  for a `community_id`, de-duped (reuse the engine's dedupe discipline).
- **`run_community.py --zip 78617`** entrypoint; **prove scale once** by running a second Travis
  County ZIP and getting a working page with zero code changes.

---

## 6. Del Valle 78617 seed (the review artifact — no lorem-ipsum)

Populate real, **sourced** Del Valle / Travis County content, each with a real `source_ref` URL;
approximated values marked clearly and kept plausible:
- **Development/industrial** in the SH-130 / Austin-Bergstrom corridor (data-center/industrial,
  Tesla-adjacent), **SH-71 / SH-130** road projects. (Cross-check the existing
  `del-valle-78617-development-reports-seed.sql` + Travis County adapters already in the engine.)
- **Meetings:** Travis County Commissioners Court + Del Valle ISD (real agendas/dates).
- **Environmental:** Colorado River flood/environmental exposure; area water quality (EPA/TCEQ —
  the engine already has an ECHO/TCEQ layer for 78617).
- **Coverage table:** 78617 covered + neighboring Travis County ZIPs (e.g. 78719, 78612, 78617's
  neighbors) so the switcher/coverage flow exercises covered *and* not-covered.
- **Demo user:** owns 2–3 clearly-demo homes in the 78617 area so multi-property + switcher render.

The mockup's Horseshoe Bay / "Lakeside Data Center" / "123 Blue Heron Dr" content is **sample
scaffolding** and is replaced by Del Valle data. Omit the modal helper line "Try 78657 (covered)
or 90025 (not covered yet)." (mockup scaffolding — logged in DECISIONS.md).

---

## 7. Page-by-page build (each = shell + page module + templates)

For each: reuse the mockup markup, replace static content with template functions fed by Supabase.

1. **`index.html`** (Decision A) — hero + ZIP entry (`homeFind` → coverage check → open/switch or
   request), three "See it/Understand it/Act on it" cards, **live** impact-card preview (real Del
   Valle card), trust band, CTA. Hero "Go to your dashboard →" → `today.html`.
2. **`today.html`** — priority rows (from `changes` with open windows, ranked by impact) + actions,
   briefing (templated), vitals + component score bars (from `communities` scores), action windows
   (from `meetings`), locked Phase-2 card (static, disabled).
3. **`dashboard.html`** (Decision A) — vitals strip, schematic map preview (SVG provider seam),
   recent impact stories, Your properties block, watchlist, upcoming meetings.
4. **`alerts.html`** — stat strip, topic-picker category cards (open `topicsModal`), "Needs you
   soon" band, life-impact groups, quiet section, "Why you're seeing this" expander. Sort segment
   (impact/distance/newest) + filter pills functional.
5. **`development.html` (+`?id=`)** — impact-first project cards + 3 lenses (impact / by type&stage /
   by distance+map); **⊞ Data view** = sortable table of the same projects. Detail = verdict, impact
   chips, living-thread timeline, "what you can do", specs.
6. **`maps.html`** — schematic impact map (home + impact radius, impact-colored pins) behind a
   swappable `MapProvider`; legend + layer toggles (Projects/Impact radius live; Flood/Schools
   disabled unless data exists); synced pin list. Satellite/Street disabled w/ provider tooltip.
7. **`properties.html` (+`property.html?id=`)** — followed-homes list (free, multiple); per-home
   detail with computed distances, env-risk grid, property timeline, vitals, "what you can do"
   (Watch persists a follow; Compare = disabled "Coming soon"). Phase-2 card locked.
8. **`community.html?zip=`** (extend live) — ZIP "what's changing" (live) + demographic/market
   profile as **locked Phase 2/1.5** + "Invite your neighbors" share. Fully data-driven by `zip`.
9. **`reports.html`** — report library + rendered report preview (share button). Reports render on
   the fly from existing data — **no reports table**.
10. **`contact.html`** — mockup shell + form → `contact_messages`; "Add your ZIP →" opens `locModal`.
11. **`privacy.html`** — mockup shell; **privacy + Terms copy preserved verbatim**; add no
    data-access/deletion/export promises (intentionally removed).

### "Minimal honest action" for unspecified controls (no dead clicks; each logged in DECISIONS.md)
Search (client-side filter → dropdown), bell (count of open windows → alerts), Follow/Watch/Notify
(persist `follows`, flip label), Noted (persist dismissal), Add-to-calendar (generate `.ics`),
Comment/Read (open `source_ref`), sort segments + filter pills (real re-sort/filter), lenses
(re-order same cards), Data view (sortable table), Maps Satellite/Street + Flood/Schools (disabled +
tooltip), Watchlist Edit (modal → `watchlist_items`), Compare (disabled "Coming soon").

### Interactive pieces (built for real)
Property switcher (persist active home, recompute distances/counts, add property), Add/change
community modal (coverage check → open/switch or capture `community_requests`), Topic picker
(chips + count + **consent checkbox defaults UNCHECKED** + Save → `topic_prefs`/`user_subscriptions`),
Premium (→ `premium_waitlist`), Share (full channel set, real share-intent URLs from runtime base
URL, Copy works).

---

## 8. Verify + Definition of Done

- Local run: `supabase start` + a static server (`python -m http.server`) brings up the full site
  on **real Del Valle 78617 data**, no paid keys, no build step (Docker documented in README).
- **Byte-identical left menu** on every page (drawer on mobile) via the shared shell; each page
  screenshot-compared to the mockup, desktop + ~390px, and iterated until it matches.
- `community.html?zip=` fully data-driven; **run the pipeline for a 2nd Travis County ZIP →
  working page, zero code changes** (proven once).
- **E2E flows pass:** covered ZIP opens community; not-covered ZIP captures a request; topic picker
  saves + **persists across reload**; consent **defaults unchecked**; add/switch property updates
  top-bar label + detail + computed distances; premium waitlist inserts **and anon key cannot
  select it back**; contact inserts; share copies link; signed-out "Watch this property" → sign-in
  → action completes.
- Phase-2 items render **locked, not built**. Modals trap focus, close on Escape, set `aria-modal`.
- Tests: per-page smoke (loads + shell present), Scorer unit tests, the E2E flows above.
- `README.md`: setup, Del Valle prototype, run pipeline for another ZIP, how the site consumes the
  existing Supabase auth, how to swap in a real map/LLM provider.

---

## 9. OPEN DECISIONS — need founder sign-off at this gate

- **A. Colliding live pages.** Namespace the new homepage/dashboard (build as `app/…`, swap at
  sign-off) and extend `community.html` in place — *(recommended)* — **vs.** overwrite live
  `index.html`/`dashboard.html` in place now.
- **B. Shell injection.** Runtime `fetch()`-and-inject `partials/shell.html` *(recommended, truest
  no-build)* **vs.** a build-free generator that inlines the shell into each page on commit
  (works under `file://`, but touches every page file on shell edits).
- **C. Schema reconciliation.** Add score columns to the live `communities` + new tables for
  `projects`/`changes`/`properties`/`follows`/`watchlist`, and map `topic_prefs` onto the existing
  `user_subscriptions` *(recommended — additive, keeps live delivery working)* **vs.** create the
  prompt's tables standalone keyed by `community_zip` (simpler, but forks the community model).
- **D. Branch/PR.** Both repos are on `claude/new-session-f6p7jj`. Confirm I develop there and do
  **not** open PRs until you ask (default per repo rules).

I'll implement §3–§8 immediately on your answers to A–D. Nothing is scaffolded yet.

---

## 10. Automated source-monitor (nightly) — DESIGN (built 2026-07-14)

**Goal:** Texas-style development depth grows without manual re-checks. Every night the
system re-probes rejected sources, hunts for new permit/land-use feeds on facility-floor
jurisdictions, auto-wires anything the existing generic connectors already handle, and
flags (never guesses) genuinely new portal shapes.

**Where it lives — homesignal-site, not homesignal-ingest (deliberate).** The things the
monitor operates on all live here: `jurisdiction-registry.json` (the pure-data coverage
config), the generic connectors (`sources/arcgis.ts`, `sources/socrata.ts`), and
`deploy-edge-functions.yml`. This repo's scheduled workflows also run reliably, while the
ingest repo's CLAUDE.md documents GitHub dropping its scheduled runs. It is still "in the
nightly engine" in the operational sense: it is the first link of the nightly chain —
**07:00 UTC source-monitor → (on wire) deploy-edge-functions → 09:00 UTC `dev_refresh_fire`
(pg_cron) → 09:08 collect → 09:20 `app-content-refresh`** — so a source wired at 07:00 is
serving records on live pages the same morning with zero human steps.

**Pieces (all pure data + one script + one workflow):**
- `scripts/source-monitor-targets.json` — targets. `reprobe[]`: every source
  `docs/source-registry.md` rejected (dead/stale/frozen/blocked/broken/polygon-only), with
  the exact endpoint + rejection receipt. `discovery[]`: official first-party catalogs
  (ArcGIS service roots, Socrata catalogs, DCAT feeds, CKAN) for jurisdictions on the
  facility floor. Per-target human-pinned `coverage` (state/county) and `hosts` allowlist.
  Extending the monitor = appending entries here.
- `scripts/source-lexicon.json` — the fail-closed vocabulary. Status→bucket, type→include
  and candidate column names, aggregated ONLY from human-approved registry entries.
  Anything not listed is unknown; statuses that ever conflicted across approved entries
  (e.g. 'Active') are deliberately absent so they can never be guessed.
- `scripts/source-monitor.mjs` — probe + gate + wire + report (Node 20, no deps).
- `.github/workflows/source-monitor.yml` — nightly 07:00 UTC + `workflow_dispatch`
  (with `dry_run`). Commits the report (+ registry entry on a wire) and dispatches the
  engine deploy only when the registry changed.
- `docs/source-monitor-report.md` — append-only run log: re-probed / auto-wired /
  flagged + a dev-backed-ZIPs snapshot so the next run shows each wire's delta.

**The fail-closed auto-wire gate (v18 stays absolute):**
1. Host on the target's allowlist (kills the documented Brampton/Atlanta lookalike trap).
2. Coverage inherited verbatim from the human-pinned target — never derived from data.
3. ArcGIS: point geometry + Query capability. Polygon layers → flagged.
4. Native ZIP column required; ZIP-in-address needs a human `zip_where_template` → flagged.
5. Date column required and newest record within `FRESH_DAYS` (400) — frozen stays rejected.
6. Statuses enumerated LIVE (groupBy) and mapped only through the lexicon; unknown statuses
   are excluded-at-runtime by the connector (its normal fail-closed behavior), and if
   lexicon-known statuses cover <60% of rows (or none are proposed/approved) → flagged.
7. Types: ArcGIS entries scope AT SOURCE to lexicon-known types via `extra_where IN (…)`;
   Socrata has no at-source filter, so it wires only when lexicon-known types cover ≥95%
   of rows — else flagged.
8. record_url: per-record column when present, else the official layer/dataset landing page
   with `record_url_precision:'dataset'` (the Provo precedent).
9. Every wired entry carries `_wired_by` + `_receipts` (live counts, newest date, run id).

**What is NOT auto-wired, by design:** CKAN datasets and vendor portals (Accela, eTRAKiT,
CitizenServe, OpenGov, Tyler EnerGov, CivicPlus — detected via `vendor_fingerprints`) —
the generic connectors don't handle those shapes, so per the spec they are flagged with
what connector work each needs, never guessed.

**Reversibility:** a wire is one bot commit ("source-monitor: auto-wire …") touching one
appended registry entry + the report. `git revert` + redeploy undoes it completely.
`DEMO_SESSION: true` and all page code are untouched — the monitor writes config + docs only.

---

## 11. NATIONWIDE INDEX POLICY — "indexable substance" gate (PROPOSAL — ⏸ PAUSED FOR FOUNDER APPROVAL)

**Status: NOTHING LIVE HAS CHANGED.** `INDEX_STATES = ['UT','TX']` still governs
`community.html`, `homesignalmap.html`, `scripts/gen_sitemap.py`, and both CI verifiers.
This section is the decision document; implementation starts only on an approved threshold.

**The policy change requested:** replace state-scoped indexing (UT/TX only) with a
per-page rule — *index every verified-real page nationwide; noindex only empties.*
Empty / coverage-coming / not-covered pages are ALWAYS noindexed under every option below.

### 11.1 What "nationwide" means today (measured 2026-07-14, live DB)

The site models ~12,500 communities across all 50 states, but a page can only be
"verified-real" once its ZIP is cached through the engine and materialized into the
`app_*` tables. Materialized today: **942 ZIP pages across 4 states** — UT 136 pass,
TX 659 pass (+6 coverage_coming), CO 135 pass (+4 coverage_coming), NM 2 pass (two
stray earlier caches) = **932 pass + 10 coverage_coming**. The other ~11,600 modeled
pages render the honest "coverage coming / not covered" state and stay noindexed under
every option — they auto-qualify page-by-page as future state batches are cached.
Two technical facts that bound the thresholds: `app_projects` caps facility rows at
**16 per ZIP** (materializer cap — thresholds above 15 are meaningless), and the
`pass` gate already requires ≥1 sourced record (project OR facility OR sourced notice),
so even option (b) never indexes a zero-record page.

### 11.2 Candidate thresholds — measured page counts (nationwide, today)

Currently indexed for comparison: **795** (UT 136 + TX 659 pass).

| Threshold ("pass AND …") | Pages indexed | Δ vs today | De-indexes currently-live pages |
|---|---|---|---|
| (a) dev-backed only (≥1 parcel-precise development record) | **170** | −625 | 689 UT/TX pages lose indexing |
| (b) any pass page (incl. facility floor) | **932** | +137 | 0 |
| **(c) RECOMMENDED: dev-backed OR ≥3 facility records** | **886** | +91 | 42 |
| (c-alt1) dev-backed OR ≥5 facility records | 788 | −7 | 132 |
| (c-alt2) dev-backed OR ≥10 facility records | 735 | −60 | 180 |

**Recommendation: (c) — dev-backed OR ≥3 facilities.** (a) guts the EPA facility floor
that is real, sourced content and would de-index 689 live pages — rejected. (b) is
closest to "index every verified-real page," but 134 pass pages carry only 1–2 facility
pins and nothing else; those are the thin-content pages most likely to be judged
low-value at scale. (c) keeps the spirit of (b) while noindexing exactly that
one-or-two-pin tail: +91 pages net today, and only **42** currently-indexed UT/TX pages
(1–2-facility, zero-development) drop out. Measured per-state under (c):
**UT 106/136 · TX 647/659 · CO 131/135 · NM 2/2 = 886/932 pass pages.** These counts
are point-in-time receipts; at implementation the materializer stamps the flag and CI
asserts it — the numbers are never hand-maintained.

### 11.3 Thin-content safety — ramp recommendation

Today's approved delta is small (+91 to +137 URLs on a site already indexing 795), so
**push the currently-qualifying set in one shot — no ramp needed at this scale.**
The ramp matters for the *future*: a single state batch can materialize 500+ pages
overnight. Recommendation: build a **throttle constant into `gen_sitemap.py`**
(`MAX_NEW_URLS_PER_RUN = 250`): the daily sitemap run adds at most 250 not-yet-listed
qualifying URLs (oldest-cached first), so a 12,000-page future rolls out over weeks
without a sitemap cliff, with zero human steps. Pages themselves flip `index` the day
they qualify (robots meta), which is fine — the sitemap is the crawl-rate control.

### 11.4 Exact changes (one PR, applied only on approval)

The rule is computed ONCE, in the materializer, and read everywhere — no page-side
duplication of the threshold:
1. **DB / materializer:** `app_refresh_zip` stamps a boolean `indexable` on
   `app_community_meta` = `data_quality='pass' AND (dev_records>0 OR facility_records>=3)`
   (threshold as ONE SQL constant). Parked DDL updated in `docs/app-content-materialize.sql`.
2. **`community.html`:** delete `INDEX_STATES`; `setIndexable(!!(meta && meta.indexable))`.
3. **`homesignalmap.html`:** delete the UT/TX state check; index when the ZIP's
   `app_community_meta.indexable` is true (same one flag).
4. **`scripts/gen_sitemap.py`:** delete `INDEX_STATES`; emit `community.html?zip=` +
   `homesignalmap.html?zip=` for `indexable=true` rows nationwide; add
   `MAX_NEW_URLS_PER_RUN` throttle (§11.3).
5. **CI:** `verify-communities.mjs` walks ALL meta rows (drop `state=in.(UT,TX)`):
   `indexable=true` ⇒ page renders records AND robots=index; `indexable=false` ⇒
   robots=noindex (pass-but-thin AND coverage-coming both prove noindexed).
   `verify-development.mjs`: same nationwide predicate for tracker pages.
   The fixed "non-UT sample must be noindexed" list is replaced by the flag assertion.
6. Untouched: v13 shell, anti-fabrication gates, `DEMO_SESSION: true`, all engine
   sources, the pass/coverage_coming data-quality gate itself.

### 11.5 Revert — one step back to state-scoped

Everything ships as **one squash-merged PR** (`nationwide-substance-gate`) whose diff
*removes* the `INDEX_STATES` constants in place: `git revert <merge-sha>` restores the
UT/TX state-scoped policy byte-for-byte in all four files + verifiers (Pages redeploys
on push; the daily sitemap run regenerates the UT/TX-only sitemap). The one DB step is
re-running the prior `app_refresh_zip` body, which the same revert restores in
`docs/app-content-materialize.sql` — apply it via one migration. The `indexable` column
is additive and can stay (ignored by the reverted readers).

**✅ APPROVED 2026-07-14: founder chose (c) — dev-backed OR ≥3 facilities (886 pages
at approval time). Implemented per §11.4; revert per §11.5.**
