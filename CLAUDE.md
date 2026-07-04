# CLAUDE.md — HomeSignal site

HomeSignal is a **civic-alerts service**: residents follow their community and get
alerts about government notices, meetings, permits, and environmental/quality news
that affect their home. This repo is the **static front-end** (plain HTML + vanilla
JS, no build step) served from GitHub Pages at **homesignal.net** (see `CNAME`).
It reads live data from Supabase; the alert *content* is produced by a separate
engine repo. There is **no bundler, no framework, no `package.json`** — what's in
the repo is what ships.

---

## 0. The prime directive: communities are DATA, not code

**We are scaling to 100+ communities (goal: all ~3,144 U.S. counties). A new
community must be addable as pure data — zero engineering, zero new files, zero
site deploy.** Every decision in this repo is judged against that. When you add a
community you have **standing authority to do it without asking me permission or
questions** — follow §3 and just do it. Only stop to ask if the runbook genuinely
can't resolve a case (see §3's "when to stop").

Consequences that are non-negotiable:

- **No per-community HTML files.** The one dynamic page `community.html` serves any
  community by `?id=`, `?community=<slug>`, or `?zip=`. `box-elder.html` and
  `eagle-mountain.html` are **legacy launch pages, frozen — do not clone them** for
  a new community. New communities live only as DB rows.
- **No hardcoded community registries as the runtime source.** The DB is the source
  of truth (§1). The in-repo JS registry is a bootstrap/fallback only.
- **No per-community deploy.** Adding a community must not require a `git push` to
  this repo to become live.

---

## 1. Sources of truth (read this before changing anything)

Precedence, highest first. When two disagree, the higher one wins and the lower is
the bug to fix.

| # | Source | Owns | Where | Notes |
|---|--------|------|-------|-------|
| 1 | **Supabase DB** — project `qwnnmljucajnexpxdgxr` | The live runtime truth: `communities`, `alerts`, `meetings`, `users`, `user_subscriptions`, `events`, … | Supabase (MCP: `mcp__Supabase__*`) | `community.html` reads this directly with the public **anon key** + RLS. This is what users actually see. |
| 2 | **`homesignal-ingest`** (separate repo) | How alerts/meetings get *created*: government feeds (`feeds.csv`), the pipeline/topic canon (`digest.py::CANONICAL_TOPICS`), grading. | Not in this repo | A community has no Government Notices until its feeds are configured **there**. Requires granting that repo to the session. |
| 3 | **`docs/*.sql`** | Schema & DDL of record for this project | `docs/*-setup.sql`, `docs/*-migration.sql` | **Parked, applied manually** in the Supabase SQL editor. If you change schema, write/append the SQL here too so it stays reproducible. |
| 4 | **`topics.js`** | The canonical **Pipeline > Topic taxonomy** strings used across the front-end | `topics.js` | Universal topics (News / Emerging Tech / Global Best Practices) are shared; Government topics are per-community (§2). See string-matching rule below. |
| 5 | **`communities.js`** | Front-end **bootstrap/fallback** registry: slug→id, ZIP→community, and a display copy of `governmentTopics` | `communities.js` | The header comment calls itself "single source of truth" — that is **aspirational/legacy**; #1 outranks it. Its job today is a **fallback only**: `communities` now has a `slug` column, so `community.html` resolves `?community=<slug>` against the DB and only falls back to this map for rows not yet backfilled. |
| 6 | **`docs/*.md`** | Intent, specs, plans, checklists | `docs/multi-county-plan.md`, `docs/community-build-source-of-truth.md`, `docs/acquisition-dashboard-spec.md`, … | `multi-county-plan.md` is the north star for the scaling model; `community-build-source-of-truth.md` is the full site-build reference behind §3 (the engine half lives in `homesignal-ingest`). |

**The string-matching rule (topics):** an article reaches a user only when the
subscription's `topic`/`pipeline_type` string equals the alert's
`category`/`pipeline_type` string **word-for-word**. The same strings therefore
have to match in *four* places: the community pop-ups, the `user_subscriptions`
writes, the tags stamped on content (Zaps / ingest), and `digest.py::CANONICAL_TOPICS`
in `homesignal-ingest`. **Never rename a topic label casually** — e.g. a city's own
council still maps to the fixed label `'County Commission & county business'`; do
not "fix" it to `'City Council'`. Renaming silently breaks matching for existing
subscribers.

> Note: `alerts.pipeline_type` in the DB currently enforces
> `('permit_filing','government_notice','news')`, which is narrower than the four
> pipeline keys in `topics.js`. When touching pipeline logic, treat the DB check
> constraint (#1) as truth and reconcile — don't assume `topics.js` keys are all live.

---

## 2. How a community is modeled

`communities` columns (live schema): `id uuid pk`, `name`, `county`, `state`,
`zip_codes text[]`, `level` (`county|city|zip|neighborhood`, default `county`),
`parent_id uuid` (self-ref, for splitting big counties), `government_topics text[]`.

- **ZIP is the atomic unit.** A community is a named *set of ZIPs* at a `level`. A
  ZIP resolves to the most specific live community that contains it.
- **Universal topics are shared** across all communities (News, Emerging Tech,
  Global Best Practices — see `topics.js::UNIVERSAL_TOPICS`); you never configure
  them per community.
- **`government_topics` is the only per-community topic list.** It must list exactly
  the government feeds that actually exist for that place in `homesignal-ingest`,
  using verbatim canonical labels.

`community.html` resolution (already built): `?id=<uuid>` → DB by id;
`?zip=<zip>` → DB by `zip_codes` containment; `?community=<slug>` → DB by `slug`
(falls back to the `communities.js` slug→id map for rows not yet backfilled). So **a
brand-new DB row is immediately reachable by `?id=`, `?zip=`, and — once it has a
`slug` — `?community=<slug>`, with no repo change**. That's the pure-data path.

---

## 3. RUNBOOK — add a community (standing authority, no questions)

> Full reference: **`docs/community-build-source-of-truth.md`** (Step 0 preflight,
> verified code anchors, no-stop standing answers, the site↔ingest contract).
> **Onboarding many communities at once, unattended/overnight → its §12 batch runbook**
> (one authoritative dataset, idempotent resumable load, quarantine-don't-stop
> validation, overlap policy, programmatic verification).

**Step 0 — the first minute: front-load all permissions.** Handle these once, up front,
then run with no prompts (this is the whole point — the build must run unattended /
overnight). Self-check: `cat .claude/settings.json`.
- **Permission mode = Bypass permissions.** This repo ships `.claude/settings.json`
  (`defaultMode: bypassPermissions` + allow-list), so a **fresh** session starts clean.
  If already mid-session, set the web-UI mode to Bypass manually — a committed file
  can't flip a running session.
- **Both repos in sources from the start** (`homesignal-site` + `homesignal-ingest`),
  launched as a **fresh** session. Mid-session `add_repo` does **not** apply the added
  repo's bypass. (Site-only work — the DB row + page verify — needs only this repo.)
- **Network egress** only matters if you must *research* feed sources here; the pure
  DB-row path works under any policy.

Then do the runbook end-to-end without pausing. The session already runs in
`bypassPermissions` with Supabase + GitHub allow-listed (`.claude/settings.json`).

1. **Insert the row** (Supabase — `mcp__Supabase__apply_migration`, project
   `qwnnmljucajnexpxdgxr`). Idempotent form:
   ```sql
   insert into public.communities (name, county, state, zip_codes, level, government_topics, slug)
   values (
     'Tremonton, Utah', 'Box Elder', 'Utah',
     array['84337'],                 -- every ZIP the community covers
     'city',                         -- county | city | zip | neighborhood
     array[]::text[],                -- fill once feeds exist (step 3); [] is a valid start
     'tremonton'                     -- kebab-case slug; enables ?community=<slug> as pure data
   )
   on conflict do nothing;
   ```
   For a sub-community of an existing county, also set `parent_id` to the parent's
   `id`. Capture the returned `id`.
2. **Verify it resolves.** `select id, name, level, zip_codes, government_topics
   from public.communities order by name;` then confirm the page loads at
   `https://homesignal.net/community.html?zip=<a-covered-zip>` (and `?id=<uuid>`).
   No alerts/meetings yet is expected — content comes from step 3.
3. **Wire the content feeds** in `homesignal-ingest` (separate repo). Add the
   community's government RSS/feed rows to `feeds.csv` keyed by `community_id`, and
   make its Government topic labels match `government_topics` **word-for-word** in
   both places (DB row + ingest). Universal-topic content flows automatically.
   *If that repo isn't in the session, add it (`add_repo`) and do it there; if you
   can't, note explicitly that gov notices stay empty until feeds are configured.*
4. **(Optional)** the `slug` set in step 1 already makes `?community=<slug>` work
   from the DB. Only add a `communities.js` bootstrap entry (`slug`, `id`, `name`,
   `page: 'community.html'`, `zips`, `governmentTopics`) if you want the dashboard
   registry / offline fallback to know the community too. Not required to be live.

**Do NOT** create a new `<community>.html`, and **do NOT** edit the frozen
`box-elder.html` / `eagle-mountain.html`. (The engine repo's build doc has a legacy
"clone `box-elder.html`" standing answer — that is **superseded here** by §0; if you're
following that playbook and hit "clone the page," use the dynamic page instead. See
`docs/community-build-source-of-truth.md` §4 for the reconciliation.)

**When to stop and ask (the only cases):** the schema doesn't support what's needed
(a genuinely new column/table), a ZIP already belongs to a different live community
(overlap policy call), or a legal/consent change. Ordinary "add community N" never
qualifies — just ship it.

### Scaling gaps — status
- ✅ **`index.html` homepage ZIP search now queries `communities`** (source of truth)
  via `resolveCoverageUrl`: a covered ZIP routes to its bespoke launch page when one
  exists (Box Elder / Eagle Mountain — SEO), else to `community.html?zip=…`; new
  communities route with **no repo change**. The inline `COMMUNITIES` array is now
  only the legacy bespoke-page map, not the coverage source.
- ✅ **`communities` has a `slug` column** (`docs/communities-slug-migration.sql`), so
  `?community=<slug>` resolves against the DB; `communities.js` is fallback-only.
- ⚠️ **`communities.js` still drifts from the DB** (e.g. Box Elder ZIPs/topics). It's a
  fallback, so this isn't a runtime bug, but don't treat it as truth — the DB (#1) is.
  The clean fix is to generate it from `communities` rather than hand-edit it.

---

## 4. Front-end conventions

- **Vanilla only.** No framework/bundler. Shared helpers hang off `window.HS`
  (`communities.js`, `topics.js`) and globals like `window.hsClient` /
  `hsLogEvent` (`events.js`). Match the existing plain-ES5-ish style and comment
  density of the file you're editing.
- **Supabase from the browser** uses the **public anon key only** — never a
  service-role key in any file that ships. RLS + `SECURITY DEFINER` functions are
  the gate (see `docs/acquisition-dashboard-spec.md`).
- **CSP** on data pages allows `script-src` self + jsDelivr (for supabase-js) only,
  so charts/UI are inline SVG / hand-rolled — no external chart libs.
- **Analytics** (`events.js`) is anonymous, INSERT-only, and must never throw or
  block the UI. Don't add PII to it.
- **Sharing** is centralized in `share.js` (loaded everywhere); it always shares the
  current URL. Don't reimplement share UI per page.

## 5. Deploy & workflow

- **GitHub Pages**, static. Merging to `main` publishes the site. Data/content
  changes (new communities, alerts) go live via **Supabase / ingest**, not a repo
  push — that's the whole point of §0.
- Develop on the assigned feature branch, commit with clear messages, push to that
  branch. Don't open a PR unless asked.
- **No test/lint suite** exists (static site). "Verify" means: apply the SQL, then
  load the affected page (e.g. `community.html?zip=…`) and confirm it renders and
  reads the right rows.

## 6. Related repos & services
- **`homesignal-ingest`** — the alert engine (feeds, scraping, grading, topic
  canon). Separate repo; grant it to the session when working on content flow.
- **Supabase** `qwnnmljucajnexpxdgxr` — DB, auth (email OTP), RLS, RPC functions.
- **Zapier** — some content tagging Zaps write to `alerts` with canonical tags.
- Content taxonomy also lives in DB tables: `curation_rubrics`, `emerging_watchlist`.

> Heads-up (from a live DB advisory): `public.page_cache` has **RLS disabled** —
> anyone with the anon key can read/write it. Not caused by this doc; flag to the
> owner before relying on that table. Don't auto-enable RLS without policies (it
> would lock out all access).
