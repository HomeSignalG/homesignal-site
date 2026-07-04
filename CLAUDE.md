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
- ⚠️ **Delivery split is the open cross-repo item.** Notices and Meetings are separate
  *tiles*, but making them independently *deliverable* — and the email structure (default:
  two emails, one 5 PM Central window, news rides with notices — a **founder** call) —
  lives in `homesignal-ingest` `digest.py`. Spec: `docs/notices-vs-meetings-delivery-handoff.md`.

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
