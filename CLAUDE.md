# CLAUDE.md — HomeSignal site

HomeSignal is a **civic-alerts service**: residents follow their community and get
alerts about government notices, meetings, permits, and environmental/quality news
that affect their home. This repo is the **static front-end** (plain HTML + vanilla
JS, no build step) served from GitHub Pages at **homesignal.net** (see `CNAME`).
It reads live data from Supabase; the alert *content* is produced by a separate
engine repo. There is **no bundler, no framework, no `package.json`** — what's in
the repo is what ships.

---

## Claims discipline — verify the field, attach the evidence (read before asserting)

Most broken rules are just claims that weren't verified. Operational, not abstract:

1. **A count / grep is a LEAD, not a fact.** `grep -c "x"` proves a word *appears*, not
   what it *means* — parse the actual field and read the value before you assert.
   *(A real miss: "we have ~10 Google feeds" was shipped from a substring count; all 10
   were notes saying "NO Google." The real count was zero.)*
2. **Evidence rides WITH the claim, or the claim is marked UNVERIFIED.** State a fact about
   data/state only next to the query + result that proves it. No receipt → say "unverified"
   or go verify first. Never a naked assertion.
3. **Quote the source; don't recall it.** For a DB value / file line / doc, show the exact
   row or line — never from memory.
4. **"Rows match" ≠ "rows do X."** Matching a term isn't doing the thing; check the column
   that actually drives behavior (e.g. `source_type`/`source`, not `notes`).

If you can't produce the evidence in the same message, you don't yet know it — so don't say it.

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

- **The ZIP is the resident-facing PAGE; city/county are cascaded government layers.**
  Citizens think in ZIP codes, so the backbone is built **per ZIP**: each ZIP is a
  `level=zip` community (its own page), `parent_id` → its city (or county), and it
  **inherits** government by cascading UP the chain (city council + county + eventually
  state). A ZIP has no government of its own — it layers its parents' meetings on top.
  A ZIP resolves to the **most-specific** live community that contains it (`zip > city >
  county`). See `docs/community-build-source-of-truth.md` §13.
- **Each row holds ONLY its own level's `government_topics`.** County row = county
  topics; city row = that city's council; ZIP row = `[]` (inherits via cascade). Never
  jam a town's council onto the county row — that breaks sibling-exclusion scoping.
- **Content + subscriptions anchor at the chain ROOT** (the content-bearing community —
  the county today); the page scopes displayed content by the ancestor topic set, so a
  sibling town's meetings never leak onto another's page.
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
> **Handed a county + its ZIP codes and told to "run overnight without stopping" → §14**
> (the whole-county-from-a-ZIP-list runbook: settled per-ZIP model so nothing is re-asked,
> first-party-only feeds via the state PMN system, CI as the live feed-check because the
> sandbox has no egress, per-ZIP inventory output). Every pausable decision has a
> pre-settled answer there; the only stops are §10.

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
   both places (DB row + ingest). Universal topics (News/Emerging/Global) need **no
   per-community feed config** — but their content is still stored per `community_id`
   (no alert is community-agnostic), so those tiles are empty too until the ingest
   pipeline runs for this community. "Automatic" = zero config, not zero pipeline.
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

**Big-county / metro standing answers (no stop — see `docs/community-build-source-of-truth.md`
§9 & §13.9, the Salt Lake County pattern):**
- **Many ZIPs per city** → one `level=zip` page per ZIP named `"<place> (<ZIP>)"` (distinct
  name + slug); never one bare city slug for many ZIPs.
- **A ZIP spanning multiple cities** → still ONE ZIP page, `parent_id`→county, labeled with
  every place; don't split it or pick one city.
- **A cross-county border ZIP already on another county row** → build the ZIP page (it
  resolves most-specific), but keep it OFF your county-level `zip_codes` array (avoids the one
  real same-level county collision). Not a stop.
- **Incorporated city councils in a site-only session** → defer. Seed county + ZIP pages
  (`government_topics=[]`, inherit county via cascade); add a `City government (X)` topic only
  after that city's meeting feed is verified/wired on the ingest side.

**Definition of DONE — run to a GREEN DEPLOY, do NOT stop early (full contract:
`docs/community-build-source-of-truth.md` §15).** A build is *not* finished when the DB
rows exist — stopping there, or pausing to ask "should I deploy?", is the #1 failure mode.
Run this whole sequence **without asking** (every step is pre-authorized):
1. Apply the seed (rows) + resolution probe (most-specific resolves; no dup slugs).
2. Write + commit `docs/<place>-communities-seed.sql` to the assigned branch.
3. If a new question came up that §9 didn't answer, **add the standing answer to §9 +
   this file in the same build** (so #N+1 never re-asks).
4. **Open AND squash-merge the PR to `main`** — this is "deploy," and it is
   **pre-authorized for a community build** (the generic "PR only if asked" rule is for
   *other* work). The pages are already live via Supabase; the merge ships seed/docs + arms CI.
5. Confirm the **Pages deploy** for the merge commit is green (a transient "try again later"
   self-heals — re-check, don't stop).
6. Confirm the **`verify-communities` CI run** is green; if red, **fix + re-run until green**
   (bad assertion → fix script; real broken page → fix row). Only then report done, with
   numbers, noting any deferred ingest item **(logged, not blocking)**.

**When to stop and ask (the ONLY cases):** the schema doesn't support what's needed
(a genuinely new column/table), a *same-level* ZIP collision that is systematic/state-wide
(a single cross-county border ZIP is NOT this — handle per above), secrets/PII/subscriber
exposure, a destructive DB change, or a legal/consent change. Ordinary "add community N" —
including a whole metro county of ZIPs, **plus its deploy + CI-verify** — never qualifies;
just ship it. "Should I deploy?", "is it done?", "a feed isn't wired", "CI went red" are
**all answered above — do not stop for them.**

### Scaling gaps — status
- ✅ **`index.html` homepage ZIP search now queries `communities`** (source of truth)
  via `resolveCoverageUrl`: a covered ZIP routes to its bespoke launch page when one
  exists (Box Elder / Eagle Mountain — SEO), else to `community.html?zip=…`; new
  communities route with **no repo change**. The inline `COMMUNITIES` array is now
  only the legacy bespoke-page map, not the coverage source.
- ✅ **`communities` has a `slug` column** (`docs/communities-slug-migration.sql`), so
  `?community=<slug>` resolves against the DB; `communities.js` is fallback-only.
- ✅ **The per-ZIP page engine is BUILT** (shipped this session, `community.html`): the ZIP
  is the resident-facing page and city/county meetings **cascade down** onto it. Three
  once-and-done pieces are now live — **most-specific-live resolution** (`?zip=` ranks
  `zip>city>county`), the **parent-chain cascade query** (`community_id` up the chain,
  scoped by the ancestor topic set so sibling towns don't leak), and the **generated,
  level-grouped, ZIP-scoped government popup** — plus **separate Notices / Meetings tiles**.
  Subscriptions anchor to the chain **root**, so no subscriber is switched between communities.
- ✅ **Box Elder is modeled per-ZIP (pattern A)** — county row = 7 county topics; Brigham
  City / Tremonton = their own council; each covered ZIP = its own `level=zip` page
  inheriting the county. Full tree in `docs/box-elder-communities-seed.sql`.
- 🟢 **Box Elder per-ZIP pilot is LIVE — 18/18 pages, subscribable** (DB-verified). All 18
  ZIPs resolve to their own page (16 `level=zip` + Brigham City/Tremonton `city`) and a
  resident can pick topics + sign up on each: the **16 town ZIP pages** → Box Elder
  **County** government (7 topics) + universal (News/Emerging/Global); **Brigham City /
  Tremonton** → their **own council** + county + universal. Subscriptions anchor to the
  Box Elder County `community_id` (chain root), so they match and deliver.
  ⚠️ **Not eyeballed live** — the build sandbox can't reach Supabase/`homesignal.net`
  (egress blocked → `HTTP 000`); verified by data + deployed code + static render, **not**
  an end-to-end browser signup. Confirm on the real site (`?zip=84312` → pick a topic →
  sign up). Each small town's **own council** is the pending ingest follow-up.
- 🟢 **Salt Lake County per-ZIP build is LIVE — 37 rows (1 county + 36 ZIP pages)**
  (DB-verified). This is the **metro-county** reference (Box Elder is the rural one): dense
  ZIPs, many-ZIPs-per-city, multi-city and cross-county ZIPs — all handled by the same model,
  **no new fork**. County root = the 6 canonical topics (same six as Utah County); every ZIP
  is a `level=zip` page named `"<place> (<ZIP>)"` (`parent_id`→county, `government_topics=[]`)
  inheriting the county via cascade. Multi-city ZIPs (e.g. `Salt Lake City / Millcreek
  (84106)`) stay one page; the cross-county ZIP `84065` (already on the live Utah County row)
  is built as a ZIP page but kept **off** the county-level array to avoid a same-level
  collision. **City councils (Salt Lake City, Sandy, West Valley City, …) are intentionally
  deferred** to the ingest step (no subscribable `City government (X)` topic before its feed
  is verified). Full tree + standing answers: `docs/salt-lake-county-communities-seed.sql`,
  `docs/community-build-source-of-truth.md` §9 & §13.9. Same egress caveat — not eyeballed
  live; confirm on the real site (`?zip=84101` → pick a topic → sign up).
- 🟢 **Colorado Front Range per-ZIP build is LIVE — 148 rows (9 county roots + 139 ZIP
  pages)** (DB-verified). First **out-of-state** build (all prior were UT) and the widest
  yet: Douglas, El Paso, Larimer, Weld, Adams, Jefferson, Arapahoe, Boulder, Denver — same
  model, **no new fork**. Each county root = the 6 canonical topics; every requested ZIP is a
  `level=zip` page named `"<place> (<ZIP>)"` (`parent_id`→county, `government_topics=[]`)
  inheriting via cascade. 4 cross-county collision ZIPs in the source (`80003`, `80023`,
  `80516`, `80549`) each got **one** page parented to the first county + labeled with both
  places, and were kept **off** every other county-level array (§9/§12.4). County slugs carry
  a `-co` suffix (`douglas-county-co`, …) so common county names don't collide with future
  states. City councils (Denver, Colorado Springs, Aurora, Fort Collins, Boulder, …) are
  intentionally **deferred** to the ingest step. Full tree: `docs/colorado-communities-seed.sql`.
  Resolution probe passed (all 4 collision ZIPs + samples resolve most-specific; 0 dup slugs);
  same egress caveat — confirm on the real site (`?zip=80202` → pick a topic → sign up).
- 🟢 **Michigan (SE Michigan metro + Grand Rapids/Lansing/Flint) per-ZIP build is LIVE —
  371 rows (11 county roots + 360 ZIP pages)** (DB-verified). Second **out-of-state** build
  and the largest single batch yet: Wayne, Oakland, Macomb, Kent, Washtenaw, Ottawa, Genesee,
  Shiawassee, Ingham, Livingston, Monroe — same model, **no new fork**. Each county root = the
  6 canonical topics; every requested ZIP is a `level=zip` page named `"<place> (<ZIP>)"`
  (`parent_id`→county, `government_topics=[]`) inheriting via cascade. The ZIP→city→county
  crosswalk was generated from the **`zipcodes` PyPI package v3.0.0** (bundled offline USPS
  database — §12.0 "never guess a ZIP↔county mapping"), not hand-typed. **No cross-county
  collisions** — all 360 ZIPs mapped to exactly one MI county and none was pre-claimed by a
  live row. County slugs carry a `-mi` suffix (`wayne-county-mi`, …). City councils (Detroit,
  Grand Rapids, Ann Arbor, Lansing, Flint, Warren, Sterling Heights, Troy, Livonia, Dearborn,
  …) are intentionally **deferred** to the ingest step. Full tree: `docs/michigan-communities-seed.sql`.
  Resolution probe passed (20-ZIP sample all resolve most-specific `zip>county`; 0 dup slugs;
  0 orphan pages); same egress caveat — confirm on the real site (`?zip=48226` → pick a topic → sign up).
- 🟢 **Washington (Puget Sound metros + Spokane + Yakima Valley + Tri-Cities + NW counties)
  per-ZIP build is LIVE — 374 rows (13 county roots + 361 ZIP pages)** (DB-verified). Third
  **out-of-state** build: King, Pierce, Snohomish, Spokane, Yakima, Clark, Thurston, Whatcom,
  Skagit, Benton, plus single-ZIP roots Kittitas, Lewis, Stevens — same model, **no new fork**.
  Each county root = the 6 canonical topics; every requested ZIP is a `level=zip` page named
  `"<place> (<ZIP>)"` (`parent_id`→county, `government_topics=[]`) inheriting via cascade. The
  ZIP→city→county crosswalk was generated from the **`zipcodes` PyPI package v3.0.0** (bundled
  offline USPS database — §12.0), not hand-typed. **No cross-county collisions** — all 361 ZIPs
  mapped to exactly one WA county and WA had zero rows pre-seed (prior states are UT/CO/MI ZIP
  ranges). County slugs carry a `-wa` suffix (`king-county-wa`, …). Two crosswalk edge cases:
  `98082` (Mill Creek) had a blank county field in the package but its city sits wholly in
  Snohomish County, so it's parented there from the package's own city value; `99015` (Freeman)
  is **not in the crosswalk at all** and was **quarantined** (excluded, not guessed — §12.2).
  City councils (Seattle, Tacoma, Spokane, Bellevue, Everett, Vancouver, Yakima, Olympia,
  Bellingham, …) are intentionally **deferred** to the ingest step. Full tree:
  `docs/washington-communities-seed.sql`. Resolution probe passed (13-ZIP sample all resolve
  most-specific `zip>county`; 0 dup slugs; 0 orphan pages); same egress caveat — confirm on the
  real site (`?zip=98101` → pick a topic → sign up).
- 🟢 **Illinois (Chicago metro + collar counties + Rockford + Metro East + Champaign-Urbana)
  per-ZIP build is LIVE — 485 rows (11 county roots + 474 ZIP pages)** (DB-verified). Fourth
  **out-of-state** build (prior: UT/CO/MI/WA) and the densest metro yet (Cook County alone =
  216 ZIP pages): Cook, DuPage, Kane, Lake, McHenry, Will, Kendall, LaSalle, Winnebago,
  Madison, Champaign — same model, **no new fork**. Each county root = the 6 canonical topics;
  every requested ZIP is a `level=zip` page named `"<place> (<ZIP>)"` (`parent_id`→county,
  `government_topics=[]`) inheriting via cascade. The ZIP→city→county crosswalk was generated
  from the **`zipcodes` PyPI package v3.0.0** (bundled offline USPS database — §12.0), not
  hand-typed. **No cross-county collisions** — all 474 ZIPs mapped to exactly one IL county
  and IL had zero rows pre-seed. County-name casing was canonicalized where the package was
  inconsistent (DuPage/Dupage, McHenry/Mchenry) so each county has exactly one root. One
  crosswalk edge case: `60569` (Aurora) is a UNIQUE-type corporate ZIP with a blank county
  field and was **quarantined** (excluded, not guessed — §12.2). City councils (Chicago,
  Aurora, Rockford, Naperville, Joliet, Elgin, Evanston, Cicero, Champaign, Urbana, …) are
  intentionally **deferred** to the ingest step. Full tree: `docs/illinois-communities-seed.sql`.
  Resolution probe passed (9-ZIP sample all resolve most-specific `zip>county`; 0 dup slugs;
  0 orphan pages); same egress caveat — confirm on the real site (`?zip=60601` → pick a topic → sign up).
- 🟢 **Texas (Central Texas / Austin metro + DFW-north collar + Greater Houston collar +
  New Braunfels edge) per-ZIP build is LIVE — 267 rows (18 county roots + 249 ZIP pages)**
  (DB-verified). Fifth **out-of-state** build: Travis, Denton, Collin, Williamson, Montgomery,
  Fort Bend, Hays, Comal, Bastrop, Burnet, Llano, Bexar, plus single-ZIP roots Brazoria,
  Caldwell, Harris, Lampasas, Liberty, Walker — same model, **no new fork**. Each county root =
  the 6 canonical topics; every requested ZIP is a `level=zip` page named `"<place> (<ZIP>)"`
  (`parent_id`→county, `government_topics=[]`) inheriting via cascade. The ZIP→city→county
  crosswalk was generated from the **`zipcodes` PyPI package v3.0.0** (bundled offline USPS
  database — §12.0), not hand-typed; city names used verbatim from the package (e.g. "Mckinney",
  "Mc Dade"). **No collisions** — all 249 ZIPs mapped to exactly one TX county, 0 quarantined,
  and TX had zero rows pre-seed (prior states are UT/CO/MI/WA ZIP ranges). County slugs carry a
  `-tx` suffix (`travis-county-tx`, …) so common county names (Montgomery, Liberty, Walker, …)
  don't collide across states. City councils (Austin, Plano, McKinney, Frisco, Denton, Sugar
  Land, Conroe, Round Rock, Georgetown, San Antonio, …) intentionally **deferred** to the ingest
  step. Full tree: `docs/texas-communities-seed.sql`. Resolution probe passed (10-ZIP sample all
  resolve most-specific `zip>county`; 0 dup slugs; 0 orphan pages); same egress caveat — confirm
  on the real site (`?zip=78701` → pick a topic → sign up).
- 🟢 **Minnesota (Twin Cities metro + St. Cloud + Rochester + collar counties) per-ZIP build is
  LIVE — 190 rows (18 county roots + 172 ZIP pages)** (DB-verified). Sixth **out-of-state**
  build: Hennepin, Ramsey, Washington, Dakota, Stearns, Carver, Olmsted, Wright, Anoka, Scott,
  Sherburne, plus single-ZIP roots Benton, Chisago, Dodge, Isanti, Rice, Todd, Wabasha — same
  model, **no new fork**. Each county root = the 6 canonical topics; every requested ZIP is a
  `level=zip` page named `"<place> (<ZIP>)"` (`parent_id`→county, `government_topics=[]`)
  inheriting via cascade. The ZIP→city→county crosswalk was generated from the **`zipcodes`
  PyPI package v3.0.0** (§12.0), not hand-typed; USPS city names used verbatim (e.g. "Saint
  Paul" for the 551xx block). **No collisions** — all 172 ZIPs mapped to exactly one MN county,
  0 quarantined, and MN had zero rows pre-seed. County slugs carry a `-mn` suffix
  (`hennepin-county-mn`, `benton-county-mn` — Benton also exists in WA, so the suffix prevents a
  cross-state slug clash). Note St. Cloud's `56304` maps to Sherburne and `56367` (Rice) to
  Benton per the package's single authoritative assignment (St. Cloud physically spans
  Stearns/Benton/Sherburne). City councils (Minneapolis, Saint Paul, Bloomington, Rochester,
  Eden Prairie, Plymouth, St. Cloud, …) intentionally **deferred** to the ingest step. Full
  tree: `docs/minnesota-communities-seed.sql`. Resolution probe passed (11-ZIP sample all
  resolve most-specific `zip>county`; 0 dup slugs; 0 orphan pages); same egress caveat — confirm
  on the real site (`?zip=55401` → pick a topic → sign up).
- 🟢 **Massachusetts (statewide — Greater Boston + Cape Cod + Berkshires + Pioneer Valley +
  South Coast + Central MA) per-ZIP build is LIVE — 603 rows (11 county roots + 592 ZIP pages)**
  (DB-verified). Seventh **out-of-state** build and the first covering an entire state's
  requested ZIP set in one pass: Middlesex (110), Worcester (99), Plymouth (61), Essex (57),
  Barnstable (55), Hampden (53), Norfolk (45), Bristol (44), Berkshire (38), Hampshire (29),
  Suffolk (1) — same model, **no new fork**. Each county root = the 6 canonical topics; every
  requested ZIP is a `level=zip` page named `"<place> (<ZIP>)"` (`parent_id`→county,
  `government_topics=[]`) inheriting via cascade. The ZIP→city→county crosswalk was generated
  from the **`zipcodes` PyPI package v3.0.0** (§12.0), not hand-typed; USPS city names used
  verbatim. All 592 input ZIPs were entered as leading-zero MA ZIPs (zero-padded from the
  request list, e.g. `2138`→`02138`). **No collisions** — all 592 ZIPs mapped to exactly one MA
  county, **0 quarantined**, and MA had zero rows pre-seed (prior states are UT/CO/MI/WA/IL/TX/MN
  ZIP ranges). County slugs carry a `-ma` suffix (`middlesex-county-ma`, … — Bristol/Essex/
  Middlesex/Norfolk/Plymouth are all shared with other states, so the suffix prevents a
  cross-state slug clash). Two crosswalk notes: `05501`/`05544` (Andover IRS ZIPs) map to Essex;
  `02212` (a Boston P.O. block) is Suffolk County's only ZIP here while `02238` (a Cambridge P.O.
  block) maps to Middlesex. City councils / town meetings (Boston, Worcester, Springfield,
  Cambridge, Lowell, Brockton, Quincy, Newton, …) intentionally **deferred** to the ingest step.
  Full tree: `docs/massachusetts-communities-seed.sql`. Resolution probe passed (12-ZIP sample
  all resolve most-specific `zip>county`; 0 dup slugs; 0 orphan pages); same egress caveat —
  confirm on the real site (`?zip=02138` → pick a topic → sign up).
- 🟢 **The 42 REMAINING STATES per-ZIP build is LIVE — 9,729 rows (405 county roots + 9,324 ZIP
  pages)** (DB-verified). The largest batch by far and the one that **completes all 50 states**
  (the 8 prior builds — UT/CO/MI/WA/IL/TX/MN + MA — cover the rest). Top-10 counties per state
  across AL, AK, AZ, AR, CA, CT, DE, FL, GA, HI, ID, IN, IA, KS, KY, LA, ME, MD, MS, MO, MT, NE,
  NV, NH, NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI, SC, SD, TN, VT, VA, WV, WI, WY — **same model,
  no new fork**. Each county root = the 6 canonical topics; every ZIP is a `level=zip` page named
  `"<place> (<ZIP>)"` (`parent_id`→county, `government_topics=[]`) inheriting via cascade. The
  ZIP→county crosswalk came from the uploaded **U.S. Census 2020 ZCTA5→County Relationship File**
  (an authoritative §12.0 dataset), **not** hand-typed; county identity is keyed on **`county_fips`**
  with **`Census_County_Name`** for display. The dataset's free-text `County` column was
  **contaminated** (RI/CT/DE/HI planning regions like "Narragansett Bay Area"/"Blackstone Valley";
  AK boroughs/LA parishes/independent cities mislabeled "County") and was **ignored** — fips is the
  truth (new standing answer, §9 + community-build-source-of-truth §9). Consequently **independent
  cities and Alaska boroughs/census areas are distinct county-equivalent roots by fips** — Baltimore
  city vs Baltimore County, St. Louis city vs St. Louis County, Fairfax city vs Fairfax County,
  Virginia Beach city, Anchorage Municipality, Valdez-Cordova split into Chugach + Copper River —
  which is why AK/MD/MO/VA show 11 roots (not a bug). USPS city labels from the **`zipcodes` PyPI
  v3.0.0** package; 450 ZCTA-only ZIPs absent from that package fall back to the Census county-name
  label (authoritative, not guessed). Two cross-state border ZCTAs — `20135` (Bluemont) and `82701`
  (Newcastle) — were each listed under two states by the CSV's ZCTA overlap; each resolves to its
  authoritative USPS state (VA Loudoun, WY Campbell). **No collisions** with the 8 existing states
  (disjoint ZIP ranges — 0 ZIP overlap, 0 dup slugs). City councils intentionally **deferred** to
  the ingest step. Full tree: `docs/remaining-states-communities-seed.sql`. Resolution probe passed
  (most-specific `zip>county`; 0 dup slugs; 0 orphan pages); same egress caveat — confirm on the
  real site (`?zip=35801` → pick a topic → sign up).
- ⚠️ **Delivery split is the open cross-repo item.** Notices and Meetings are separate
  *tiles*, but making them independently *deliverable* — and the email structure (default:
  two emails, one 5 PM Central window, news rides with notices — a **founder** call) —
  lives in `homesignal-ingest` `digest.py`. Spec: `docs/notices-vs-meetings-delivery-handoff.md`.
- 🗺️ **Government CONTENT is the real frontier — mapped in `docs/state-notice-portals.md`.**
  Pages are pure data everywhere; government Notices/Meetings content exists for **only 3 Utah
  communities** (Utah County, Box Elder, Eagle Mountain — DB-verified). Standing answer for
  scaling it (so no session re-derives): **adding a state's government content is NOT pure data.**
  `ingest.py`'s `source_type=html` handler is **Utah-PMN-specific** (`is_pmn_body_url()` hard-checks
  `"utah.gov/pmn"`; `parse_pmn_body/notice/date` assume its exact HTML) — so each new portal format
  needs its own **parser adapter in `homesignal-ingest`** (CI-verified; sandbox has no egress).
  Of all 50 states, only ~4 besides Utah have a first-party statewide portal that carries **local**
  city/county bodies (NV, RI, ND, OH⚠️demoted); 21 are first-party but **state-agency-scoped**, 16
  are **aggregator-only (barred — press associations)**, 8 have **no statewide system**. The real
  unlock is therefore a **civic-agenda VENDOR adapter, not per-state portals**: **Granicus**
  (`<entity>.granicus.com/ViewPublisher.php?view_id=N`) hosts county/city agendas nationwide, so one
  adapter widens coverage across every state at once (then CivicPlus/Legistar/PrimeGov for the tail).
  Full registry + recommended wire order: `docs/state-notice-portals.md`.
- 🟢 **Government content is LIVE across 13 non-Utah counties / 8 states (675 meetings) + 4 Utah
  communities** (DB-verified). From Utah-only at the start of this build to: **Clark NV (104), Multnomah
  OR (101), Wake NC (102), Hennepin MN (100), Douglas NV (100), Genesee MI (25), Mecklenburg NC (25),
  Washoe NV (24), King WA (24), Ramsey MN (21), Pima AZ (19), Oakland MI (15), Travis TX (15)** — plus
  Salt Lake County UT (15, CivicClerk). All anchored to their county root under `County Commission &
  county business`, all first-party, all title-verified as the correct board, all correctly dated
  (adapters drop undated/unsourced items — no fabrication). Proven via **three vendor adapters**:
  state-agnostic **Granicus RSS** (`parse_granicus_rss` — Douglas/Clark/Wake/Hennepin/Multnomah), the
  existing **Legistar** (`adapters/legistar.py` — Genesee/Mecklenburg/Washoe/King/Pima/Ramsey), and the
  new **CivicClerk** (`adapters/civicclerk.py`, reads the `<sub>.api.civicclerk.com/v1/Events` OData API
  behind the portal SPA — Oakland/Travis/Salt Lake). **Widening is now pure data**: add a feed row per
  county — Granicus `rss → <entity>.granicus.com/ViewPublisherRSS.php?view_id=N&mode=agendas`, Legistar
  `html → <client>.legistar.com/Calendar.aspx`, or CivicClerk `html → <sub>.portal.civicclerk.com/` —
  keyed to its root; a wrong URL yields 0, never fake data.
- 🔑 **The frontier blocker is the `feeds.csv` → `public.feeds` sync, not the adapters** (learned this
  build). Config is **DB-first** (`load_config`), so a feed added only to `feeds.csv` never runs on the
  schedule (that's why Genesee sat at 0 despite a "LIVE" note). Wire pattern that works: dry-run
  (`dryrun-feed.yml`, read-only) → insert the row into `public.feeds` → `golive-feed.yml`
  (`ONLY_FEED` single-feed live ingest) OR a full ingest → verify meeting **titles** in the DB (confirm
  the right body, not a sub-committee). Adapters now exist for **Granicus RSS, Legistar, CivicClerk,
  iQM2, CivicPlus AgendaCenter** — the four dominant civic-agenda vendors, so most US counties are now
  reachable as pure data. Known gaps: bespoke county systems (Wayne MI = YouTube/PDF, Cuyahoga/Hamilton
  OH = own portals, Maricopa AZ AgendaCenter needs the right category CID). Full registry, wire order,
  and per-county receipts: `docs/state-notice-portals.md`.

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
- **Automated live verification (CI).** The build sandbox can't reach Supabase/`homesignal.net`
  (egress blocked), so `.github/workflows/verify-communities.yml` + `scripts/verify-communities.mjs`
  do the live check on a GitHub runner: they read the **live `communities` table** and, for
  every covered ZIP, assert `community.html?zip=<zip>` resolves to the most-specific community
  and renders a subscribable topic set. Runs daily, on `main` pushes touching the page/seeds,
  and on demand (optional `county` input). Zero-touch — new communities are covered with no
  code change. This is the automatic replacement for the "⚠️ not eyeballed live" caveat; the
  ingest-feeds half is a separate ingest-repo generator (see
  `docs/community-build-source-of-truth.md` §14).

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

---

## 7. Development tracker (`homesignalmap.html` + per-ZIP pages)

A second page type alongside the civic-alerts community pages: **"Development around your
home"** — what's built and what's proposed near an address/ZIP (EPA-registered facilities,
data-center activity, planning hearings, open comment windows), **every item linked to its
official public record.** Full runbook: **`docs/development-tracker-source-of-truth.md`**
(Step 0, the batch runbook, standing answers, the no-stop completion contract).

**Prime directive (stricter than the communities one, because this page makes factual
claims about named real facilities):** the page renders **only** what the
`get-address-report` edge function returns. The build **never** invents, infers, or
back-fills a development record. A source with no real feed yields an **empty** result,
never a plausible one. Every rendered marker traces to a `record_url`.

- **The Three.js `development-map-desktop*.html` is a FROZEN mock** (self-labeled
  "Illustrative sample data") — never copy its inline `sites`/`INTEL` arrays into a real
  page, seed, or the engine. The canonical page is the refined Leaflet page
  (`homesignalmap.html`).
- **Two layers, decoupled (same split as site ↔ ingest):** the **page** is a thin client
  (safe to batch-build overnight); the **`get-address-report` edge function** is the engine
  (coverage expansion is a separate ingest-style job — the page batch never blocks on it).
- **Two page modes, both kept:** ZIP mode = the crawlable SEO landing page (`?zip=`, cached
  aggregate, must stand alone as real content); the embedded **address box** = the live
  1-mile-around-my-home precision view (`{address, radius_mi}`, unchanged). A ZIP centroid
  is a page anchor, **not** a "your home" pin — no address marker until the resident searches.
- **Empty is valid; fabricated is a defect.** EPA FRS/ECHO (national, free) is the baseline
  floor — every ZIP ships at least a facilities view; planning notices are per-county
  enrichment and a county with no verified feed still ships (facilities-only). Never stop and
  never fabricate to fill a map.
- **Cache with RLS ON.** Pages read `development_reports` (per-ZIP cached engine output;
  `docs/development-reports-cache.sql`). Ship it with RLS **enabled** (public `select`,
  no anon writes) — **do not** model it on `page_cache`, which has RLS disabled (see the DB
  advisory above).
- **Legal framing is founder-signed-off ONCE** (§10 of the doc): render the public fact +
  link, never editorialize a named operator into wrongdoing; keep the "factual count… not a
  verdict on any operator" copy on every page.

**Standing authority / DONE / when-to-stop:** identical to the communities build — run to a
GREEN DEPLOY (reports cached → seed committed → PR squash-merged → Pages green →
`verify-development` CI green), no pausing for "should I deploy?", "is it done?", "this ZIP
has no records", or "a county has no feed." The only stops are: ZIP master dataset
unavailable/unverified; a schema need beyond the known cache columns (incl. anything ZIP-mode
needs beyond a query change); secrets/PII/subscriber-data or the cache RLS posture; or a
legal/framing change not covered by the one-time sign-off.

### New standing answers logged this build (so the mass build never re-asks — mirror in the doc §6)
- **ZIP mode is BUILT** as an additive branch in `get-address-report` (**v10**) — `{zip}` (or
  `{zip,lat,lng}`); address mode `{address,radius_mi}` is byte-for-byte unchanged (audited:
  address mode + all helpers identical to v8, incl. the `EPA FRS · registry` facility label).
  It filters to sourced sites only, so the cache is anti-fabrication-clean at the engine.
- **No ZIP polygon → approximate the ZIP as centroid + radius** (`ZIP_RADIUS_MI`, default 3 mi);
  polygon-precise clipping is a decoupled engine enrichment, not a page blocker. Not a stop.
- **ZIP centroid pinned to `zipcodes` PyPI v3.0.0** (bundled offline USPS dataset — same source
  the alerts builds pin). The batch passes `{zip,lat,lng}`; an unknown ZIP returns 422 (never a
  guessed point) → quarantine, not stop.
- **Canonical page absent from the repo → build it from the §3 data contract; not a stop.**
- **Sandbox has no egress → populate the cache server-side via `pg_net`** (`net.http_post` →
  upsert `net._http_response.content`); Postgres has egress even when the sandbox doesn't.
- **The engine is MULTI-COUNTY (v11).** `resolveCommunityIds(zip)` maps a ZIP to its own
  community chain (city + county) via `communities.zip_codes @> [zip]`, and `devSites` queries
  planning notices for THOSE ids — so each ZIP shows its OWN county's hearings, never a hardcoded
  one. A ZIP with no modeled community → `[]` → facilities-only (never another county's notices —
  that would be fabrication). Box Elder ZIPs resolve to `[Brigham City, Box Elder County]`; only
  the county carries content, so Box Elder output is byte-identical to v10 (regression-verified:
  84302 → facilities 23 · development 41). *(Superseded the earlier "hardcoded to Box Elder"
  note.)* **The coverage frontier is now which counties have planning FEEDS wired in ingest**
  (today: Box Elder + Utah County + Eagle Mountain); every other modeled ZIP is cacheable now as a
  facilities-only page (the national EPA floor). Address mode also resolves the county from the
  geocoded ZIP.
- **At batch scale the seed is a reproducible pg_net REFRESH SCRIPT, not a literal snapshot.**
  A one-ZIP literal is fine; a county/state is hundreds of KB of engine output, mostly repeated
  county notices — embedding it as hand-copied JSON is the "hand-authored site data" §0 warns
  against and no more reproducible. The seed pins the ZIP centroids (§7.1) and re-invokes the
  engine (fire via `pg_net` → upsert the 200s; retry any transient 503 cold-starts), so
  re-applying rebuilds from the source of truth.
- **Development ZIP pages are in the sitemap zero-touch** — `scripts/gen_sitemap.py` emits one
  `homesignalmap.html?zip=<zip>` per `development_reports` row (alongside the community pages), so
  newly-cached ZIPs are indexable with no edit; the daily `sitemap.yml` workflow republishes.
- **At batch scale the seed is a reproducible pg_net REFRESH SCRIPT, not a literal snapshot.**
  A one-ZIP literal is fine; a whole county (18 ZIPs × ~40-64 sites, mostly the same county
  notices repeated) is ~220 KB of engine output — embedding it as hand-copied JSON is the
  "hand-authored site data" §0 warns against and no more reproducible. The seed pins the ZIP
  centroids (§7.1) and re-invokes the engine, so re-applying rebuilds from the source of truth.
- **Development ZIP pages are in the sitemap zero-touch** — `scripts/gen_sitemap.py` emits one
  `homesignalmap.html?zip=<zip>` per `development_reports` row (alongside the community pages), so
  newly-cached ZIPs are indexable with no edit; the daily `sitemap.yml` workflow republishes.

### Status
- 🟢 **ALL 136 modeled Utah ZIPs are LIVE** (DB-verified) — statewide across Box Elder, Utah,
  Salt Lake, Davis, Weber, Tooele, and Cache counties, on the **multi-county engine (v11)**.
  Every modeled UT ZIP has a cached `development_reports` row: **local EPA facilities** (national
  floor) + its **own county's planning notices**. **0 unsourced across all 136, 0 count
  mismatches** (facilities == mapped point sites). **46 ZIPs carry planning content** (Box Elder +
  Utah County + Eagle Mountain — full pages, e.g. a Utah County ZIP shows its 91 hearings/notices);
  the rest are **facilities-only** (valid — the national floor). 84684/84685 were absent from the
  `zipcodes` dataset and **quarantined** (excluded, not guessed). Centroids pinned to `zipcodes`
  PyPI v3.0.0; each in the sitemap (zero-touch generator). Full tree (reproducible refresh script):
  `docs/utah-development-reports-seed.sql` (supersedes the Box Elder subset seed). Same egress
  caveat — `verify-development` CI does the live browser check on all 136. **The frontier is now
  ingest feeds, not code**: a county gets *full* pages once its planning feed is wired in
  `homesignal-ingest`; until then it ships facilities-only. Box Elder regression-verified identical
  to v10 (84302 → facilities 23 · development 41).
- 🟢 **EPA-facilities under-return FIXED — engine v13 (FRS radius back-off + transient retry)**
  (DB-verified). Found this build: the facilities query used a fixed 5-mile FRS `search_radius`;
  in dense/suburban areas that exceeds FRS's process limit, so FRS returns an **error object** the
  old code read through `?? []` as **0 facilities** — silently zeroing **90 of 136** cached UT ZIPs
  (not just downtown cores: Provo 84606, all of SLC/Ogden, Davis/Weber suburbs). A second latent bug:
  FRS emits invalid JSON (unescaped `\` in facility names) that made `r.json()` throw into the same
  `catch → []`. **Standing answer (so no session re-derives): NEVER treat an FRS non-200 / error /
  parse-fail as "0 facilities."** `frsFacilities()` now starts at the needed radius and (a) shrinks
  ONLY on the deterministic process-limit `Error` (floor 0.25 mi), (b) RETRIES the same radius on a
  transient 5xx/parse fail (shrinking there undercounts — a flaky FRS 502 made Box Elder read 23→18),
  (c) escapes FRS's invalid backslashes before `JSON.parse`. Re-cached the affected ZIPs with an
  **improvement guard** (only overwrite when new `facilities` > cached, so a transient 0 can never
  clobber a good row): **77 of 90 zero-fac ZIPs corrected** to real EPA counts (e.g. 84101 0→40,
  84606 0→40, 84010 0→40); the rest are genuinely-empty west-desert/mountain ZIPs (Dugway, Ibapah,
  Wendover, Grouse Creek — 0 industrial is valid). Parked ref: `supabase/functions/get-address-report/index.ts`
  (deploy via MCP, not commit). Anti-fabrication invariant still 0 (every rendered site keeps a `record_url`).
- 🟢 **Backbone geo-fabrication FIXED — engine v18 (deployed, get-address-report version 26)** (DB-verified).
  Root cause found on the first non-Utah page to get government CONTENT (Travis County TX, ZIP 78617): the
  `devSites()` placement of jurisdiction-level (scope=area) planning notices used a **Box-Elder-only place map**
  (`centroid()`/`PLACES`). At national scale it was wrong two ways — (1) it **DROPPED every non-Box-Elder
  ALERT** (`centroid()` → null → `continue`, so real out-of-state planning notices never rendered) and (2) it
  **stamped every non-Box-Elder MEETING with Box Elder County, UT coordinates** (`?? PLACES["box elder county"]`
  = 41.5105,-112.0155). Verified: the Travis County "Commissioners Court Employee Hearing" carried a Utah
  lat/lng. **Standing answer (so no session re-derives): area items have NO trustworthy point — the page
  positions them synthetically (all three map views use `placeAreaSites`/`siteLL`/`siteEN`), so the engine
  anchors every area item at the REPORT CENTROID (`homeLat`/`homeLng`), never a hardcoded place.** `centroid()`,
  `PLACES`, and the dead `BOX_ELDER_COMMUNITY_ID` were removed (they were the bug). The fix is
  **display-identical everywhere** (area coordinates are never rendered) while removing the fabricated
  coordinate and the dropped-record content loss. Blast radius before the fix was **1 live page** (78617 —
  the only non-Utah page with meeting content so far), but it was the landmine for the 12,000-page rollout as
  government content expands to the 13+ live non-Utah counties. Re-cached 78617 through the live v18 function
  (`net.http_post`, 200): the meeting now anchors at 30.1745,-97.6134 (the ZIP centroid), counts unchanged
  (facilities 29 · development 5 · civic 1). Cache-wide check: **0 area sites landing in Utah on any non-Utah
  page.** Deployed as ONE esbuild bundle (multi-file source is the parked reference; §MCP-deploy ceiling note).
- 🟢 **Staleness + status-accuracy hardened — engine v14 + auto-refresh + honest dating** (DB-verified).
  A tracker is worthless if it's a frozen snapshot with a hardcoded stage, so three fixes: **(1) it now
  updates** — `development_reports` was only ever refreshed by a MANUAL pg_net run (nothing re-ran it), so a
  new hearing never reached a ZIP page until a human re-cached. Added a **pg_cron daily auto-refresh**
  (`dev_refresh_fire` 09:00 UTC → `dev_refresh_collect` 09:08, both `SECURITY DEFINER`, self-contained via
  pg_net — no egress/secret needed) with a **transient-safe upsert** (never overwrite a row that has content
  with an all-empty response, so a flaky FRS night can't blank good pages). Parked:
  `docs/development-reports-refresh-cron.sql`. **(2) it's honestly dated** — the page reads `refreshed_at`
  and shows **"Updated <date>"** (ZIP snapshot) / **"Live results"** (address mode); previously it never read
  the field, so undated snapshots silently drifted. **(3) status is less of a guess** — v14 stamps
  `decided` (title matches approved OR denied/withdrawn/tabled/rescinded) so the page **never shows a resolved
  item as "open for public comment"** (a denied item with a future date used to count as open + show a
  "closes in N days" countdown); it now shows the plain date + a "decided" tag. v14 also **dedups** dev items
  (url|title+date — ingest can double-emit, which inflated counts) and **ages out concluded hearings** older
  than 90 days (`MEETING_LOOKBACK_DAYS`) so old items stop lingering as "Proposed" (Utah County 91→89 on
  re-cache — 2 stale items dropped). **Known residual (NOT fixed — needs ingest-side work):** there is still
  no project *identity/lifecycle* — each notice is classified independently, so "proposed→approved→built"
  isn't tracked as one entity. Also **EPA ECHO violations are effectively 0 everywhere** — the
  `echo_violation_counts` table is near-empty (3 rows, 0 with violations), so every facility shows "0 recorded
  violations" regardless of real history (fetched from a table, not live ECHO). Logged for a future build.
- 🟢 **ENVIRONMENTAL-RECORDS LAYER — engine v19 (real EPA ECHO + TCEQ Central Registry, geo-matched &
  cached)** (STEP-0 + dedup verified via pg_net; **deploy is the remaining operator step**). This is the
  "future build" the v14 note above logged: it replaces the near-empty `echo_violation_counts` table with a
  **live ECHO pull** and adds **TCEQ** state records. **Cached, not live** — the engine geo-matches during
  data generation and stamps `s.env = { link_type:"geo_matched", epa?, tceq? }`; the page renders the cached
  fact (the "client-side rendering of cached data" property is preserved). **ECHO** (federal): one
  `get_facilities → get_qid` pair per report joins each facility's real compliance summary onto the FRS
  facility by `registry_id` (the `frsRid()` hook) → `env.epa` = statutes currently in violation, SNC flag,
  quarters-in-non-compliance, last formal-action year, penalties. **TCEQ** (Texas state, coverage-gated):
  the Central Registry via the Texas Open Data Portal (Socrata, free, no key) → each RN's state programs
  (stormwater, petroleum tanks, leaking-tank cleanup, IHW/MSW, VCP, air, wastewater). **Dedup FRS↔RN**: a
  site with BOTH an FRS id and a TCEQ RN renders **once** with both badges — matched by `siteKey`
  (house# + street word + ZIP) **AND a shared name token** (precision over recall; verified against real
  78617 data — 28 confident industrial matches, same-address false positives like AutoZone↔parkade rejected).
  **No paid services** — ECHO/FRS coords are reused, TCEQ has no coords so it dedupes onto an existing FRS
  point (no geocoder). **Honest labeling**: every env record carries `link_type:"geo_matched"` (site-level,
  never parcel-keyed), one interpreted plain-language line ("1 open water violation (2024)", "enrolled in a
  state cleanup program", "petroleum storage tank on record"), and an honest absence line ("No regulated
  EPA/TCEQ facility at this parcel") — via **shared helpers wired into all four render paths**
  (`popupHTML`, `kind3`, `tip3`, `infoCard3`) + the list view + the property page. Engine:
  `supabase/functions/get-address-report/` (`index.ts` + new `sources/tceq-cr.ts`; parked bundle
  `dist/get-address-report.bundle.mjs`, deploy via MCP). No schema change — `env` rides inside the existing
  `sites` jsonb. Scope: ECHO + Central Registry only; program drill-downs (TPDES/PST/LUST/VCP detail) are a
  later build. **Deploy note:** the build sandbox has no egress to Supabase's deploy API and the ~30 KB
  inline-bundle MCP deploy could not be hand-transmitted this session — deploy the parked bundle via MCP
  (`deploy_edge_function`, one file) then re-cache a TX ZIP (78617) to populate `env`; `verify-development`
  CI does the live browser check.
- 🟢 **COLORADO IS POPULATED TO THE GO-LIVE STANDARD — 139/139 modeled CO ZIPs cached, 5
  first-party permit sources, NOINDEXED until the founder flips it** (DB-verified 2026-07-14).
  The Texas playbook, third state: every modeled Front Range ZIP has a cached
  `development_reports` row (zipcodes v3.0.0 centroids, 0 quarantined) and a materialized
  app page — **135 pass + 4 coverage_coming honest empties** (Sedalia/Bellvue/Calhan rural;
  Broomfield 80020 returns 0 consistently from the live engine — logged residual). **65 of
  139 ZIPs are development-backed (47%)** via 5 live-verified first-party sources
  (jurisdiction-registry.json + docs/source-registry.md "CO metro permit sources"): Denver
  commercial+residential construction permits, Boulder construction permits (BLDS table,
  native ZIP, geocoded addresses), Fort Collins current building permits (point + native ZIP
  + PER-RECORD Accela links), Colorado Springs Planning_Applications (the city's own
  Development Tracker backend). 0 unsourced sites, 0 rows missing source_ref/coords; UT
  136 / TX 654 pass unchanged. **New additive connector capability — `spatial_zip_radius_mi`**
  (sources/arcgis.ts): point layers with NO ZIP attribute anywhere query an envelope ±N mi
  around the ZIP centroid (the engine's standard ZIP approximation); records keep their OWN
  per-parcel points. **Standing answer:** ArcGIS groupBy statistics can CASE-FOLD values
  (Denver residential returned UPPERCASE from groupBy but stores mixed case) — always confirm
  value casing with `returnDistinctValues`, never groupBy alone; the fail-closed status lookup
  correctly published nothing until the entry was corrected. Rejections with receipts: Aurora
  DNS-dead, Douglas 500, Arapahoe/Larimer/Weld no first-party catalog, Adams/Jeffco polygon
  district layers only, data.colorado.gov aggregate-only. Reproducible seed:
  `docs/colorado-development-reports-seed.sql`. Index policy UNCHANGED (INDEX_STATES = UT+TX).
- 🟢 **GEOCODE GEOFENCE — engine v20 (arcgis connector)** (unit-tested offline; deployed via
  `deploy-edge-functions.yml`). The first full `verify-geocodes` run (after its pagination fix —
  the unbounded `development_reports` read hit the 57014 statement timeout at ~1,000 cached ZIPs,
  PR #221) surfaced **23 real out-of-polygon geocodes**: Census range-interpolation matched the
  same street name in another city/state, so Fort Worth permits rendered markers in **Michigan /
  South Carolina** and Boulder permits crossed adjacent-ZIP lines. **Standing answer (so no
  session re-derives): a GEOCODED point is trusted only when (a) the Census matched-address ZIP
  equals the record's filed ZIP and (b) it sits within `GEOCODE_FENCE_MI` (25) of the report ZIP
  centroid; a miss NULLS the coords (record stays listed, area scope — no content loss, no
  fabricated marker). Source-supplied geometry is NEVER fenced** (a real parcel can legitimately
  sit far from a big county's centroid). PR #222; affected FW/Boulder ZIPs re-cached through the
  live v20 engine.
- 🟢 **WASHINGTON IS LIVE UNDER THE SUBSTANCE GATE — 361/361 modeled WA ZIPs cached, 6
  first-party permit sources, 327 pages auto-indexable (no manual flip)** (DB + CI-verified
  2026-07-15). Fourth development state (UT/TX/CO playbook): every modeled WA ZIP has a cached
  `development_reports` row (zipcodes v3.0.0 centroids, 0 quarantined) and a materialized app
  page — **350 pass + 11 coverage_coming honest empties**; **0 unsourced sites**. **118 of 361
  ZIPs carry development records (33%); 76 ZIPs carry parcel-precise projects (2,239 records)**
  via 6 live-verified first-party sources (receipts in jurisdiction-registry `_receipts` +
  docs/source-registry.md "WASHINGTON WIRE PASS"): Seattle Building + Land Use Permits
  (Socrata, native ZIP, per-record links; noise dropped at source via the NEW additive
  **socrata `extra_where`**), Bellevue (native ZIPCODE, 35-code type whitelist), Tacoma Accela
  (native zip, per-record links), Pierce County PALS (53-type whitelist, spatial ZIP scoping),
  Clark County active cases (the recon "dead" was a wrong-URL guess — live at /arcgisfed/).
  **The substance gate did the index decision autonomously**: 327 pass+substance pages stamped
  indexable, 23 pass-but-thin + 11 empties stay noindexed; the throttled sitemap listed 250
  newcomers day one and deferred 77 to the next daily run. All three verifiers green on the
  full walk — which surfaced and fixed a latent class: **PostgREST caps un-paginated reads at
  1,000 rows** (bare `limit=100000` truncated silently once the meta table passed 1,000 rows) —
  every verifier read is now keyset-paginated. Standing answer: unscoped
  `sharing/rest/search` on ArcGIS Online returns cross-org lookalikes (a Calgary
  "Building_Permits" surfaced for three WA orgs) — always scope `q=… orgid:<orgId>`.
  Rejections with receipts: Snohomish polygon-only generalization, King County no permit
  layer, Spokane/Vancouver/Everett private or absent orgs, Bellingham no API. Reproducible
  seed: docs/washington-development-reports-seed.sql.
- 🟢 **MINNESOTA IS LIVE UNDER THE SUBSTANCE GATE — 172/172 modeled MN ZIPs cached, 1
  first-party permit source, 166 pages auto-indexable (no manual flip)** (DB + CI-verified
  2026-07-15). Fifth development state: every modeled MN ZIP has a cached row (zipcodes
  v3.0.0 centroids, 0 quarantined) and a materialized page — **170 pass + 2 coverage_coming
  honest empties; 0 unsourced sites**. **28 of 172 ZIPs dev-backed (16%), 1,344 parcel-precise
  records** via **minneapolis-ccs-permits** (fresh 2026-07-13, the Denver
  `spatial_zip_radius_mi` pattern — zero new code; trades dropped at source; 'Closed'
  EXCLUDED on purpose, conservative lifecycle). The corrected-URL retries found the REAL
  portals behind all four first-pass URL-guess rejections — none wireable: **St. Paul's org
  is live but its permits layer STALLED at 2025-06-30** (added to the nightly monitor's
  reprobe list; PAULIE is an address registry, not permits), Ramsey org has 0 permit
  services, Rochester/Olmsted have no public org, Dakota's layer is a year-granularity
  assessor extract through 2025. Receipts: docs/source-registry.md "MINNESOTA WIRE PASS".
  **New standing answer: verifier bulk reads are row-SIZE-dominated** — dense-metro rows
  reach 3.5 MB / 3,160 sites (Minneapolis 55407), so verify-development/geocodes now use
  ADAPTIVE page sizes (halve on failure, floor 1 = the live page's own single-row read
  path, verified servable). Reproducible seed: docs/minnesota-development-reports-seed.sql.
- 🟢 **ILLINOIS IS LIVE UNDER THE SUBSTANCE GATE — 474/474 modeled IL ZIPs cached, 1
  first-party permit source, 445 pages auto-indexable (no manual flip)** (DB-verified
  2026-07-15). Sixth development state: every modeled IL ZIP has a cached row (zipcodes
  v3.0.0 centroids) and a materialized page — **469 pass + 5 coverage_coming honest
  empties; 0 unsourced sites, 0 count mismatches, 0 sites missing coords**. **131 of 474
  ZIPs dev-backed (28%)** via **chicago-building-permits** (Socrata `ydr8-5enu`, the
  city's own permit ledger) — carried by a NEW additive **socrata spatial-scope option**
  (`spatial_zip_radius_mi` + `spatial_point_col` → SoQL `within_circle`, mirroring the
  arcgis pattern) because the dataset has per-record lat/lng but NO ZIP column; noise
  permit classes (signs, electrical, easy-permit, elevator, scaffolding) are dropped AT
  SOURCE via `extra_where` (only NEW CONSTRUCTION / RENOVATION-ALTERATION /
  WRECKING-DEMOLITION / PORCH count), 365-day recency, fail-closed status buckets.
  Dense-metro note: adjacent Chicago pages' 3-mi circles overlap, so the same permit
  legitimately appears on neighboring ZIP pages (per-page counts are honest; heaviest row
  618 KB — well under the MN 3.5 MB adaptive-loader ceiling). The corrected-URL retries
  closed all five first-pass rejections with FIRM receipts — none wireable: Rockford org
  live but 0 permit services, Champaign's "Building_Permit_Data" is a mislabeled 1-row
  subdivision polygon layer, Will County's real root (gis.willcogis.org) exposes 0 public
  permit services, Kane publishes only adopt-a-highway/bridge layers, DuPage's
  address-points is an address registry (not permits). Receipts: docs/source-registry.md
  "ILLINOIS WIRE PASS". Reproducible seed: docs/illinois-development-reports-seed.sql.
- 🟢 **MICHIGAN IS LIVE UNDER THE SUBSTANCE GATE — 360/360 modeled MI ZIPs cached, 5
  first-party permit sources, 331 pages auto-indexable (no manual flip)** (DB-verified
  2026-07-15). Seventh development state, and the first with a FRESHNESS-FIRST gate on
  the headline source: the Detroit BSEED trio was verified FRESH before wiring (max
  issued_date — building/trades 2026-07-14, demolition 2026-07-10; pg_net max-stat
  receipts). Every modeled MI ZIP has a cached row (zipcodes v3.0.0 centroids, 0
  quarantined) and a materialized page — **355 pass + 5 coverage_coming honest empties;
  0 unsourced sites, 0 count mismatches, 0 sites missing coords**. **50 of 360 ZIPs
  dev-backed (14%), 27,506 dev records** via 5 sources: **detroit-building/trades/
  demolition-permits** (native zip_code + own lat/lng; issuance ledgers with NO status
  column → NEW additive arcgis **`status_const`** option, guarded by `issued_date IS NOT
  NULL`; **Trades kept — FOUNDER-SPECIFIED trio**, unlike the trades-noise drop in
  WA/MN/IL; single-entry revert restores comparability), plus two corrected-URL retry
  captures: **ann-arbor-energov-permits** (Tyler EnerGov behind the city's Public Permit
  Map web map; fresh 2026-07-14; **per-record STREAMURL → stream.a2gov.org,
  record-precision**; Building kept / trades dropped; spatial ZIP scoping) and
  **independence-twp-construction-permits** (the "Oakland County" retry's real find —
  10,020 rows fresh 2026-07-09, extent = the township only, named honestly; public view
  NULLs addresses — rows place by their own points). **The recon "lexicon lacks
  issued_date" flag was a TYPE gap**: Detroit's dates are `esriFieldTypeDateOnly`
  (string-serialized) and the monitor recognized only `esriFieldTypeDate` — both now
  count (standing answer; the engine's `DATE '…'` recency literal was live-verified
  against DateOnly). Firm rejects with receipts: Grand Rapids (org-scoped: 0 permit
  layers; SESC service = base layers; EPA_* = aggregate counters), Macomb (live host, no
  public REST), Kent (no org; AGO hits are DE/RI Kent — cross-state trap), Lansing (both
  domains dead). Also: unknown `<guess>.maps.arcgis.com` subdomains return the GENERIC
  anonymous portal (a 200 there is NOT an org). Receipts: docs/source-registry.md
  "MICHIGAN WIRE PASS" + "MI checkpoint C". Reproducible seed:
  docs/michigan-development-reports-seed.sql.
- 🟢 **MASSACHUSETTS IS LIVE UNDER THE SUBSTANCE GATE — 627/627 modeled MA ZIPs cached
  (incl. the founder-approved SUFFOLK 35-ZIP EXPANSION), 4 first-party permit sources,
  587 pages auto-indexable (no manual flip)** (DB-verified 2026-07-15). Eighth
  development state, and the first with a **CKAN source**: the new ADDITIVE
  `sources/ckan.ts` connector (datastore_search_sql; same coverage-gate/fail-closed/
  anti-fabrication contract as socrata/arcgis; offline unit-tested incl. a bidirectional
  gate proof) carries **boston-approved-building-permits** — fresh same-day (issued_date
  2026-07-15T01:47), native `zip` + own lat/lng over 656,762 rows, statuses verbatim
  (Open+Issued→approved, Closed→operating, Stop Work→exclude), FOUNDER WHITELIST (keep
  Erect/New Construction, Long Form/Alteration, Amendment to a Long Form, Foundation,
  Use of Premises; DROP Short Form Bldg Permit — 189k minor jobs), founder-accepted
  dataset-precision record_url (no per-row URL column — templating one would be
  guessing). Boston pages exist because the **Suffolk expansion** modeled 35 standard
  ZIPs (Boston/Chelsea/Revere/Winthrop, migration `suffolk_boston_zip_expansion`) under
  the existing county root. Plus the **Cambridge Socrata trio** (new-construction /
  addition-alteration / demolition; fresh daily; Active/Complete verbatim; Socrata
  `point` column → the IL spatial within_circle option, zero new code). Every modeled
  MA ZIP has a cached row (zipcodes v3.0.0, 0 quarantined — 05501/05544 are Andover IRS
  ZIPs physically in MA) and a materialized page — **610 pass + 17 coverage_coming
  honest empties; 0 unsourced, 0 count mismatches, 0 sites missing coords**. **53 of
  627 ZIPs dev-backed (8%), 22,112 dev records.** The **bidirectional coverage-gate
  proof ran with live receipts**: 02128 carries ONLY boston-*, 02138 ONLY cambridge-*
  (the Suffolk entry stayed off the Middlesex page), 48226 ONLY detroit-* — plus the
  unit-level never-fetches assertions. Statewide/metro rejects with receipts: no MA
  statewide per-record permit source exists (MassGIS = MassDEP environmental permits +
  polygons; data.mass.gov is a Hub, not Socrata); **Worcester STALLED at 2025-09-09**
  (→ nightly reprobe list; NOTE: AGO hosted-table LIKE counts are unreliable — order-by-
  desc is the freshness probe); Springfield has no first-party source; Somerville
  ungeolocatable. Receipts: docs/source-registry.md "MASSACHUSETTS WIRE PASS".
  Reproducible seed: docs/massachusetts-development-reports-seed.sql.
- 🟢 **84302 (Brigham City) prototype detail** (DB-verified): facilities 23 · development 41 ·
  proposed 41 · approved 0 · 64 sites · 0 unsourced; the page surfaces upcoming hearings as
  "comment windows open" (a live, date-derived count from each notice's `meeting_date`). Route:
  `homesignalmap.html?zip=84302` (pretty `/development/84302` redirects via `404.html`).
  Same egress caveat as the alerts builds — not eyeballed live from the sandbox; `verify-development`
  CI does the live browser check. City-council planning feeds beyond Box Elder County are the
  deferred engine-coverage item (logged, not blocking).
- 🟢 **`homesignalmap.html` is the full canonical page — THREE map views** (founder's refined
  Leaflet / Three.js / MapLibre page, ported and wired to live data): **2D map** (Leaflet + OSM),
  **3D aerial** (Three.js isometric blocks — built=green, approved=blue, proposed=orange wireframe,
  with orbit / time-of-day / "From home"), and **3D satellite** (MapLibre GL + Esri imagery + AWS
  terrarium terrain). All three share one dataset via `MAP_SITES`; the legend doubles as
  built/approved/proposed filters; the radius selector (½/1/2/3/5 mi) drives the address view.
  Libraries load from **jsDelivr** (CSP: self + jsDelivr for scripts, `worker-src blob:` for
  MapLibre, imagery hosts allow-listed). The **address box stays live** (`{address,radius_mi}`
  unchanged); ZIP mode reads the cache and centers on the centroid with **no "this address" pin
  until the resident searches**. `render()` drops any unsourced site and sets `window.__HS_SITES`;
  the Leaflet map lives in an inner `#mapInner` so the verifier's `#map .leaflet-container`
  selector matches even for an empty ZIP.

---

## 8. Source adapters (`get-address-report` enrichment sources)

The `get-address-report` edge function pulls from multiple public-record sources.
Full registry: **`docs/source-registry.md`** — the authoritative list of every source,
its API, schema mapping, coverage scope, build status, and Step-0 checklist.
Full site-side governance: **`docs/development-tracker-source-of-truth.md`**
(anti-fabrication prime directive, §10 legal framing, §12 stop list).

**Before writing any source adapter code:**
1. Read `docs/source-registry.md` in full.
2. If the source isn't in the registry, add it (with coverage scope, API, schema
   mapping, and counts bucket) before writing any code.
3. Confirm the source's Step-0 checklist is complete — fixtures captured, parser
   tested against real pages, interface pinned with vintage.

**The five rules that never bend:**

- **Coverage scope is mandatory.** Every source declares `covers: [{state, county}]`
  in the registry. The engine checks this before activating any source for a ZIP.
  A Utah planning feed does not run for a Texas ZIP. No exceptions.
  (`if (!source.covers(zip.state, zip.county)) continue;`)

- **Every emitted site must carry a `record_url`** pointing to the official public
  record. A site without one is dropped by the anti-fabrication gate in
  `verify-development.mjs` and fails CI. No exceptions.

- **Absent fields stay absent.** A field the source page doesn't state is not on
  the site object. Never default, never infer, never interpolate. This includes
  coordinates: an area-scope record whose geocoder returns coordinates outside
  the covered jurisdiction's bounding box gets its lat/lng nulled, not trusted.

- **Quarantine, don't stop.** Any per-record or per-ZIP failure (fetch error,
  parse miss, geocode failure): log to the quarantine list, skip the record,
  continue the batch. A run with quarantined records is a success; the quarantine
  log is the only human follow-up.

- **Additive only.** A new source adapter is a new branch. It never modifies
  existing source behavior. If adding it requires changing how FRS, ECHO, or
  PMN work, that is a §12 stop — ask before proceeding.

**counts buckets** (declared in the registry, not chosen at build time):
- `facilities` — EPA-registered or federally licensed physical facilities
  (FRS, TRI, SEMS, APHIS, FAA, RCRAInfo, NRC)
- `development` — permits, construction filings, planning notices
  (TABS, PMN, county permit portals)
- enrichment — adds fields to existing sites, no new count
  (ECHO violations, OSHA violations, TRI releases on FRS sites)

**The case study (always the acceptance test for TX sources):**
`docs/case-study-78617-caldwell-gap-analysis.md` — the Drey Dossier / Neuralink /
2200 Caldwell Ln investigation. When the TABS adapter and APHIS adapter are both
live, a refresh of ZIP 78617 must surface the five Caldwell permit filings and
the entity link connecting River Bottoms Ranch LLC ↔ Neuralink via shared phone
(813) 758-6679. That before/after is the proof the backbone works.

### Status (2026-07-10)
- 🟢 **TX TDLR/TABS is LIVE end to end** (engine v16/v17, registry mode, Travis pins):
  the 78617 refresh caches all 5 Caldwell filings (counts facilities 29 / development 5 /
  civic 1, `tabs_quarantined: []`), the coverage gate held on a UT spot-check (84302 → 0
  TABS fetches), and `verify-development` CI is the live page check. Fixture receipts:
  `fixtures/tabs/` + runbook §2.1.
- 🟢 **The PROPERTY PAGE (address dossier, §4.3+§4.3.1) is LIVE**: `homesignalmap.html?addr=…`
  reads `property_reports` (RLS on, public select, service-role writes), written by the
  engine's v17 ZIP-mode refresh — `canonicalAddr()` is the ONE normalizer (engine-side);
  both "Ln"/"Lane" filing variants collapse to the one key
  `2200 CALDWELL LN, DEL VALLE, TX 78617` (5 filings, 1 row). `sources_checked` lists only
  sources the refresh actually queried that returned empty at that address. ZIP-list
  `record ▸` on permit records routes to the property page; the external record link lives
  there. Verifier §4.5 covers every cached property page (record links, ≥2-evidence entity
  links, honest Also-checked).
- ⚠️ **Standing answer — MCP edge-function deploys have a ~30 KB payload ceiling**: the
  multi-file get-address-report deploy (~55 KB) reliably kills the tool permission stream.
  Deploy as ONE esbuild bundle (`esbuild index.ts --bundle --format=esm --external:jsr:*
  --minify-whitespace`) with a provenance header naming the repo commit; the repo's
  readable multi-file source stays the parked reference.
