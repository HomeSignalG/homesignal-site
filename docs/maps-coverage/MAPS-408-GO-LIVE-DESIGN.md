# Maps 408-page go-live — authoritative read path + SEO delivery (DESIGN + PRE-STATE)

**Nothing in this document was implemented.** No production object, page, workflow, sitemap,
robots value, canonical, workbook or database row was changed. Every number is a read, taken
2026-09-03. Pre-state fingerprints are recorded in §11 so the design can be diffed against
reality later.

---

## 1. The 408 predicate, and exact accounting for the other 16

Predicate and generated list: `GO-LIVE-408.md` — **408 ZIPs, list md5
`2e76ff284765a48460a099efc26bc365`**, reproducing the artifact's own `indexable_after_switch`
column exactly (diff empty).

The excluded 16 are **mutually exclusive** — checked, not assumed:

| excluded | n | ZIPs |
|---|---:|---|
| no production page (class E) | **13** | 01054 01093 01301 01330 01337 01338 01339 01340 01342 01364 01367 01370 01373 |
| below substance after the authoritative switch (class D) | **2** | 01252, 01441 |
| remaining non-candidate state — `coverage_coming` cache state (class B) | **1** | 01034 |

⚠️ **Class B does not map onto the exclusions, and forcing it to would misreport.** Class B has
**two** members and they land on opposite sides: **`01034` is excluded** (its cache row never
reached `pass`, so it fails the gate's first clause even with 3 authoritative developments), while
**`06390` is INSIDE the 408** — it is the single page that *gains* eligibility from the switch
(0 displayed development + 2 facilities today; 7 authoritative developments after).

Sitemap delta implied by the set, counted in the committed `sitemap.xml`: **407 of the 408 are
already listed and indexable; `06390` is not.** The 2 class-D pages are listed today and must
come out. Net 409 → 408.

---

## 2. Current Maps ZIP read path, end to end

```
GET /homesignalmap.html?zip=01001              (GitHub Pages, static file, no server logic)
  └─ 404.html only for the pretty alias /development/<zip>/ → JS location.replace to ?zip=
  ↓ browser parses the static shell: generic <title>, generic description,
    robots = "noindex, nofollow"  (homesignalmap.html:11)
    canonical = https://homesignal.net/homesignalmap.html  (:14, parameterless)
  ↓ JS init reads ZIP from location.search              (:1011 ZIP_MODE)
  ↓ HS.data.community(zip)      → app_community_meta  (name/county/state/lat/lng/indexable)
  ↓ HS.rpcAllRows(zip,'development')  →  RPC app_projects_for_zip(p_zip, p_kind)
  ↓ HS.rpcAllRows(zip,'facility')     →  same RPC, p_kind='facility'
       lib/data.js:125 — one jsonb payload per (zip, kind); { rows, complete },
       complete=false on any failure so callers refuse to render a partial set
  ↓ render() drops any site without record_url, sets window.__HS_SITES
  ↓ setIndexable(...) rewrites the robots meta AFTER the async read  (:531, :1120)
```

**`public.app_projects_for_zip(text,text)` is the smallest point at which authoritative
membership can replace legacy membership.** It is already the single, public, versioned contract
for both record kinds; DDL of record `docs/maps-single-payload-read-migration.sql`. Its internals
can change while its name, signature and return shape (a jsonb array of `app_projects` rows) stay
byte-compatible with every caller and test.

**`geo` stays private.** Measured: `information_schema.role_table_grants` for schema `geo` with
grantee in (anon, authenticated, PUBLIC) → **0**. The design adds no grant there and exposes no
geometry.

⚠️ **The function is fingerprinted by a standing guard.**
`docs/preservation-baseline-protection.sql` Part 9 records
`read_path_md5 = md5(pg_get_functiondef('public.app_projects_for_zip(text,text)'))`. Live value
today is **`ec1b01ae4485ad2c59b9f946c9d565b6` — identical to the recorded baseline.** Any cutover
changes it by design, so the baseline must be re-recorded in the same change with a receipt, or
the guard reports a false alarm and the next real drift gets ignored.

---

## 3. The authoritative read product

**Two bounded public relations, no geometry, no `geo` exposure:**

| relation | shape | why it is safe to expose |
|---|---|---|
| `public.zip_authoritative_membership` | `(zip text, source_key text, lat double precision, lng double precision, primary key (zip, source_key))` | `source_key` is already returned to the browser inside `to_jsonb(p)` by today's RPC, and the coordinate is a point already rendered on the page. Nothing new is disclosed. |
| `public.maps_zip_geography_status` | `(zip text primary key, status text check (status in ('boundary_complete','not_measured')), completed_at timestamptz)` | one word per ZIP |

`app_projects_for_zip` keeps its name, signature and return shape and becomes, in words:

- `p_kind = 'facility'` → **byte-identical to today**. Facilities are untouched, by construction,
  not by intention.
- `p_kind = 'development'` and the ZIP is **not** `boundary_complete` → **today's body exactly**:
  the ZIP's own `app_projects` rows. Current production behaviour is preserved for every ZIP
  outside the completed set.
- `p_kind = 'development'` and the ZIP **is** `boundary_complete` → the authoritative set:
  - **confirmed pairs** (5,335) render from the ZIP's own `app_projects` rows, unchanged;
  - **refuted pairs** (14,643) are absent because membership does not contain them — a removal by
    non-membership, never a delete;
  - **geometry-only pairs** (558) render descriptive attributes borrowed from the project's rows
    under another ZIP, with the coordinate taken from the membership relation, and `zip` set to
    `p_zip` so the record renders on the page it belongs to.

🔑 **Why the coordinate must come from the membership relation and cannot be borrowed.** Measured
across the 1,883 authoritative projects: 7,136 distinct `(source_key, source_seq)` groups, of
which **5,116 carry more than one coordinate** across ZIPs (max 35) while only 2 disagree on name,
8 on status, 9 on date. `source_seq` is a **per-ZIP ordinal**, not a stable identity for a part of
a multi-coordinate project. So descriptive fields are safely borrowable and **the point is not**.
The membership relation therefore carries a per-pair representative point derived inside the
database from the authoritative geometry clipped to that ZCTA — the same rule the legacy
materializer already applies when it splits a multi-coordinate project across ZIPs.

**Feasibility is measured, not hoped:** all **558** geometry-only pairs (282 projects) already
exist as development rows in `app_projects` under some other ZIP — `absent_from_app_projects = 0`,
`source_key IS NULL` count = 0. Every authoritative pair can be rendered with real attributes and
a real record URL. Nothing is fabricated.

**Deduplication.** The unit is the `(zip, project)` pair, so the membership primary key enforces
it: one project cannot appear twice on one page. Multi-coordinate projects keep one rendered
record per authoritative point for that ZIP, which is what the page draws today.

---

## 4. Completed vs incomplete — fallback semantics

**Two states, one table, and the dangerous third state is made unrepresentable.**

- `boundary_complete` — a boundary-first pass executed successfully for this ZIP's prefix. A zero
  here is a **measured zero** and must render as "no development records", never as an empty page
  waiting for data.
- `not_measured` (or absent) — geography has not been completed. **Preserve current production
  behaviour**, i.e. today's legacy body.

⛔ **The read must never silently fall back for a `boundary_complete` ZIP.** Enforced structurally,
not by convention:

1. **Fail closed, not fail back.** For a `boundary_complete` ZIP the development branch reads the
   membership relation only. If it is empty, the answer is `[]`. There is no code path from
   `boundary_complete` to the legacy set.
2. **The unrepresentable state.** A ZIP may be marked `boundary_complete` only in the same
   transaction that writes its membership rows, guarded by a `CHECK`-style assertion in the
   refresh, so "complete with no membership loaded" cannot exist as an intermediate.
3. **The distinction is visible to the page**, so a measured zero and a not-yet-measured ZIP
   render different copy. The existing `app_coverage_states` view is the precedent for
   truthful-state copy that does not gate layout (`lib/data.js::coverageState`).

---

## 5. Root cause of the 13 missing pages — it is a REGISTRY ruling, not a materializer bug

Measured:

| check | result |
|---|---|
| `public.canonical_zip_registry` exists | yes, **12,722** ZIPs |
| of the 13, present in the registry | **0** |
| of the 13, modelled in `communities` (level=zip) | **0** |
| fail-closed triggers | `trg_communities_canonical_zip`, `trg_app_community_meta_canonical_zip`, `trg_development_reports_canonical_zip` |

So the absence does **not** originate in `development_reports`, the materializer's candidate
generation, `app_community_meta` or `gen_sitemap.py`. Those are all downstream of a ZIP universe
that is closed by founder ruling: *"The Gold Master registry is the source of truth for which ZIP
pages exist. Production must not create or expand the ZIP universe independently."* The guard
**fails closed at the database**, which is why an insert would be refused rather than silently
succeeding — the 80249 control working as designed.

The 13 are real ZCTAs (they came from the pinned TIGER national file; the 013 run log names
`01301 01330 01337 01338 01339 01340 01342 …` in its "boundaries a shard-first build would never
have loaded" list). **Canonical ≠ ZCTA universe**, and that gap is the finding.

**Smallest change so future boundary-first discoveries are not discarded — and it is not loosening
the guard:**

1. Boundary-first writes discoveries it cannot place to a **proposal relation**
   (`geo.n5_zip_page_candidate`: zcta5, authoritative membership count, first-seen run id) instead
   of dropping them. Discovery becomes durable evidence rather than a silent loss.
2. A reviewed **registry amendment path**: the founder's Gold Master registry gains the ZIP, the
   canonical registry is re-seeded from it, and only then do the existing materializer and sitemap
   pick the page up with **no code change** — which is the pure-data property §0 exists to protect.
3. Nothing auto-creates a page. The queue makes the decision *possible and visible*; it does not
   make it automatic.

Nationally this matters more than these 13: a boundary-first pass over all 544 prefixes will find
the same class everywhere, and without step 1 each discovery is lost at the moment it is made.

---

## 6. Server-delivered SEO content — and the hosting constraint that forces a founder decision

**Current initial response for `?zip=01001`** (the static file, before any JavaScript):

| element | in the raw HTML today |
|---|---|
| ZIP-specific content | **none** — every record is fetched client-side |
| title | generic `HomeSignal — Development around your home` (ZIP title set only at `:1048`/`:1059`) |
| description | generic (`:13`) |
| canonical | `https://homesignal.net/homesignalmap.html` — parameterless (`:14`) |
| `og:url` | same parameterless URL (`:16`) |
| robots | `noindex, nofollow` (`:11`), rewritten only after the async read (`:531`) |
| internal links | parameterless only; per-ZIP links are JS-built (`community.html:72`) |
| structured data | none — `grep -rln 'application/ld+json' *.html` matches **0 files** |

⛔ **A static host cannot vary a response by query string.** `homesignalmap.html?zip=01001` and
`?zip=06390` are the same file on GitHub Pages. So **ZIP-specific content in the initial response
is impossible at the `?zip=` URL**, and no amount of prerendering changes that. There are exactly
three honest options, and choosing between them is a founder decision:

| option | what it costs | reversible? |
|---|---|---|
| **(a) path-based prerender** — a generator emits `/development/<zip>/index.html` for eligible ZIPs, and the `?zip=` form becomes the alias that canonicalizes to the path | tension with `CLAUDE.md` §0 *"no per-community HTML files … no per-community deploy"* — the files exist, though nobody hand-authors them and adding a ZIP still needs zero engineering | yes — delete the directory |
| (b) edge-rendered page | a second rendering system, a routing change away from Pages | partly |
| (c) status quo | pages stay honestly noindexed; the objective is not met | n/a |

**Recommendation: (a), and it reuses existing machinery rather than creating a second rendering
system.** The pattern already exists in this repo: `scripts/gen_sitemap.py` + `.github/workflows/
sitemap.yml` — a scheduled job that reads the live DB with the anon key, regenerates a committed
static artifact, pushes with `DEPLOY_KEY` (the ruleset-bypass credential) and lets Pages
republish. A prerender generator is the same shape with a different output, including the same
"never use `[skip ci]`" caveat that workflow already documents. `lib/generated/` is the existing
precedent for generated, committed, never-hand-edited artifacts.

**§0 is not overridden here — it is put to the founder.** The prerendered page would remain a
render of DB data with no per-community *authoring* and no per-community *decision*; but §0's
words are "no per-community HTML files", and this creates 408 of them. That needs a ruling, not an
interpretation.

---

## 7. Canonical

**The project already has the convention and it is written down**: `404.html:10` — *"the canonical
URL is homesignalmap.html?zip="* — and the sitemap advertises exactly that form for all 11,667
map pages. Nothing new is invented.

- **If option (c)/(b):** canonical becomes `https://homesignal.net/homesignalmap.html?zip=<zip>`,
  emitted per page. Under (b) it is server-set; under (c) it cannot be set correctly at all in the
  initial response, which is itself an argument against staying there.
- **If option (a):** the prerendered file lives at a path, so the canonical must be the path form
  `https://homesignal.net/development/<zip>/`, with `?zip=` carrying a canonical pointing at it.
  **That is a change to the declared convention and needs the same founder ruling as §6** — it
  also means the sitemap `<loc>` scheme changes, which `gen_sitemap.py` has a guard around.

⚠️ Today `/development/<zip>/` is served by `404.html` with **HTTP 404** and a JS redirect. It is
not crawlable and must not be made canonical while that remains true.

`og:url` carries the identical defect (`:16`) and moves with the canonical.

---

## 8. Robots / indexability

**Decided before delivery, never by JavaScript.**

- The generator evaluates, per ZIP, the existing substance rule **plus** geography readiness:
  `boundary_complete AND pass AND (authoritative_dev > 0 OR facilities >= 3)` — the same clause as
  §1's predicate, no new threshold — and writes `index, follow` or `noindex, nofollow` into the
  emitted HTML.
- Pages whose geography is **not** complete keep `noindex, nofollow` in the static shell, which is
  today's safe default. Nothing about the national tail changes.
- `01252` and `01441` **must lose indexability at cutover.** They are indexable today only
  because legacy-refuted development props them up; after correction they are below the existing
  bar. This is a de-indexing that the design has to perform, not a regression to explain away.
- The client-side `setIndexable()` path becomes redundant for prerendered pages and must be made
  **inert for them** rather than left racing the static value.

---

## 9. Structured data and internal links

**Structured data — minimum, and nothing invented.** There is no `ld+json` anywhere in the repo
today, so there is no house convention to follow and no legacy to preserve.

- Emit `BreadcrumbList` (Home → Development → `<place> (<ZIP>)`) and a `WebPage` whose `name`,
  `description` and `spatialCoverage`/`about` restate facts the page already holds.
- ⛔ **Do not emit `ItemList` of the development records, and do not emit `Product`, `Event`,
  `LocalBusiness`, `AggregateRating` or `Review`.** These are government filings; none of those
  types describes them honestly, and the anti-fabrication directive (`CLAUDE.md` §7) governs
  structured data exactly as it governs the rendered page.
- `Dataset` for the ZIP's record set is defensible and is offered as a founder option, not assumed.

**Internal links.** No static per-ZIP link to a Maps page exists anywhere today —
`maps.html:214`, `how-it-works.html:32` and `community.html:72` all link parameterless or build
the href in JS. Discoverability rests entirely on the sitemap, which is not a substitute for
in-site links. The same generator emits a **static hub** (e.g. `/development/index.html`) listing
the eligible ZIP pages grouped by state and county, and each community page gains its Maps link in
the *prerendered* output rather than only in JS. Hub and sitemap are generated from the same
predicate so they cannot disagree.

---

## 10. Bounded rollout, and the exact rollback

```
PRE-STATE (recorded in §11)
  → SHADOW: the authoritative read product exists and is compared against production
            for all 424; the RPC still returns today's answer. Zero user-visible change.
  → CUTOVER: maps_zip_geography_status marks ONLY the 13 completed prefixes' ZIPs
            boundary_complete; app_projects_for_zip is replaced. No other ZIP is affected.
  → VERIFY: §11 matrix, run against production.
  → ROLLBACK if any check fails.
```

**Rollback mechanism, exactly:**

1. **Primary — one statement.** Re-apply the pre-cutover function body verbatim from
   `docs/maps-single-payload-read-migration.sql` (`create or replace function
   public.app_projects_for_zip(...)`), then assert
   `md5(pg_get_functiondef(...)) = ec1b01ae4485ad2c59b9f946c9d565b6`. That md5 **is** the rollback
   receipt: it proves the pre-cutover body was restored byte for byte, not approximately.
2. **Secondary — data-level.** `delete from public.maps_zip_geography_status` returns every ZIP to
   `not_measured`, which by §4's semantics is today's behaviour, even if the function change is
   left in place. Two independent levers, either sufficient.
3. The new relations are **additive** and may remain; nothing reads them once (1) or (2) is done.
4. `geo.n5_association` and `geo.n5_boundary_membership` are never written by any step, so rollback
   has nothing to undo there.

**No national switch.** `maps_zip_geography_status` is the whole blast-radius control: a ZIP not in
it behaves exactly as it does today.

---

## 11. Verification matrix (to run at cutover — not run now)

**Pre-state fingerprints recorded now**, so every check below has a before:

| | value |
|---|---|
| `read_path_md5` | `ec1b01ae4485ad2c59b9f946c9d565b6` |
| `geo.n5_association` | 20,170 rows · `4520cac2cba9039845b1db6237231536` · sum `43526467596064` |
| `geo.n5_boundary_membership` | 18,184 rows · 15 run ids |
| readiness artifact body | `d67f9cc3783cf775d42b35f91103cc7f` (424 rows) |
| 408 list body | `2e76ff284765a48460a099efc26bc365` |
| `app_community_meta` | 12,722 rows · 11,689 indexable |
| committed sitemap map pages | 11,667 · 409 of the 424 · 407 of the 408 |

**Geography / read product**

| # | assertion |
|---|---|
| G1 | a known **confirmed** pair still renders (pick from `confirmed > 0` rows) |
| G2 | a known **refuted** pair disappears — e.g. 01602, 1,322 refuted pairs of 1,327 displayed |
| G3 | a known **geometry-only** pair appears with a real `record_url` and a point inside the ZCTA |
| G4 | a **measured-zero** ZIP returns `[]` for development and renders measured-zero copy |
| G5 | an **incomplete** ZIP returns byte-identical output to pre-cutover |
| G6 | a **completed** ZIP never returns a legacy-only pair — assert the returned set equals membership exactly, for all 411 pages with a production page |
| G7 | `boundary_complete` with empty membership → `[]`, proven by a deliberate fault injection in a test database, never in production |

**Product controls**

| # | assertion |
|---|---|
| P1 | facilities: `p_kind='facility'` output byte-identical for all 424 |
| P2 | 8,615 facility records unchanged; `app_community_meta` untouched by the read |
| P3 | no duplicate `(zip, project)` in any returned payload |
| P4 | returned objects keep every field today's callers read (`lib/data.js`, `lib/map.js`, `lib/templates.js`); `test/maps-pagination.test.mjs` still passes unmodified |
| P5 | `{ rows, complete }` contract intact — `complete:false` on failure, never a partial set |

**SEO delivery** (representative eligible ZIP, raw `curl` with JavaScript disabled)

| # | assertion |
|---|---|
| S1 | substantive ZIP-specific content present in the initial HTML |
| S2 | correct ZIP canonical in the raw HTML |
| S3 | correct robots in the raw HTML — no JS needed to reach it |
| S4 | crawlable `<a href>` links from a static hub to the page, and back |
| S5 | structured data validates, and asserts nothing the page does not hold |
| S6 | an ineligible/incomplete ZIP remains `noindex` in the raw HTML |

**Special cases — named, because the general checks would miss them**

| ZIP | why it is in the matrix |
|---|---|
| `06390` | the only page that GAINS eligibility; must appear in the sitemap and flip to index |
| `01252`, `01441` | must LOSE indexability and leave the sitemap; a pass here looks like a regression and is the correct outcome |
| `01004` (0 authoritative, 21 refuted, 5 facilities) | measured-zero but facility-useful: page stays substantive and honest |
| `01373` (11 authoritative, no production page) | geometry-only discovery: must land in the proposal queue, and must NOT be auto-created |
| one ordinary incomplete national ZIP outside 010–019/062/063/520 | proves the blast radius: byte-identical behaviour |

---

## 12. Workbook consequence — stated, not applied

Unchanged today: **`Blockers` (M) is still the only truthfully refreshable column.**

**`Verified` must not become true because authoritative geography exists in shadow.** Shadow means
the page still serves legacy membership; verifying a page against a set it does not render would
be the "instrument proves it ran" failure in its purest form.

**Would a successful production read cutover plus the §11 matrix remove that blocker? Yes, for the
408 and only for them** — `Verified` becomes truthfully claimable per page when G1–G7 and P1–P5
pass on that page's live output, because at that point what the page renders and what the
authoritative geography says are the same set. It does **not** become claimable for the 16, nor
for any ZIP outside the completed prefixes.

`Wired` and `Live` keep their existing definitions verbatim. `Live` is still "record-backed in the
DB, measured after deploy and re-cache"; the cutover does not redefine it, and a page that was
Live before remains Live after (the 74 measured-zero pages stay record-backed through facilities).

---

## 13. Implementation units — smallest independently testable, deliberately unbundled

| unit | scope | depends on | independently testable? |
|---|---|---|---|
| **A** | authoritative read product built and compared in **shadow**; the two bounded relations; no RPC change | — | yes — pure comparison, zero user-visible change |
| **B** | production read cutover for completed ZIPs (`app_projects_for_zip` internals + status table + baseline re-record) | A | yes — G/P matrix |
| **C** | geometry-only discovery support: the proposal relation + the registry amendment path | — | yes — no page is created |
| **D** | server/static ZIP-specific HTML (generator + workflow), still `noindex` | founder ruling on §6/§7 | yes — assert raw HTML content with robots unchanged |
| **E** | canonical / robots / structured data / internal links in the emitted HTML | D | yes |
| **F** | sitemap + indexability regeneration against the new predicate | B, E | yes |
| **G** | workbook refresh (Blockers, then Verified after B) | B | yes |

They stay separable on evidence: A touches nothing the page reads; C touches no page at all; D can
ship entirely noindexed, so content delivery is provable before any indexing decision. The one
real coupling is **E after D** (there is no HTML to put a canonical in until D exists) and
**F after B and E** (advertising a page whose content is still legacy would be advertising the
wrong thing).

---

## 14. Recommended first unit: **A — the authoritative read product in shadow**

Because it is the only unit that converts the remaining unknown into a measurement while being
provably incapable of changing what a resident sees: no RPC change, no page change, no indexing
change, and its rollback is `drop table`. It also front-loads the one design risk this document
found by measurement rather than assumption — the per-ZIP representative point for the 558
geometry-only pairs, which cannot be borrowed from another ZIP's row (§3). If that derivation is
wrong, unit A is where it shows up, at zero cost; discovering it during B would mean discovering it
in production.

D is the tempting first move because it unblocks the SEO objective, but it is gated on a founder
ruling (§6) and would deliver prerendered pages carrying the *legacy* development set — content
that B then has to change underneath.
