# Alerts SEO — the build receipt

**WORKSTREAM GOAL: build, deploy and prove crawlable SEO for HomeSignal's canonical
ZIP/community pages, using the existing GitHub stack and GitHub Actions-generated GitHub
Pages deployment artifacts.**

This file is the implementation record for that build. It supersedes nothing in
`docs/crawler-ground-truth-2026-09-03.md` (the measurement) or
`docs/alerts-seo-architecture-decision-2026-09-04.md` (the halt that preceded the founder's
architecture ruling); it records what was built on top of both.

---

## 1 · Architecture, as implemented

**GitHub repository → GitHub Actions build → generated ZIP-specific HTML in the deployment
artifact → GitHub Pages.** No Cloudflare, no Worker, no DNS change, no new hosting vendor,
no Supabase-hosted HTML.

| piece | file |
|---|---|
| one shared runtime | `lib/community-page.js` — loaded by the legacy `community.html?zip=` page **and** by every generated document |
| one shared template + build | `scripts/gen_zip_pages.py` |
| the deployment build | `.github/workflows/pages.yml` (`build` on every push to its inputs; `deploy` on `main` only) |
| offline gates | `test/zip-pages-seo.test.mjs`, `test/zip-pages-no-point.test.mjs`, `test/community-page-contract.test.mjs` |
| candidate crawler proof | `scripts/prove-zip-pages.mjs` (initial HTTP response + Googlebot UAs + hydration, over the built artifact) |

**§0 reading, recorded in `CLAUDE.md` so it is not re-litigated:** the prohibition is on
*maintaining or committing* per-community HTML **source** files, and on any architecture
that needs engineering work when a ZIP is added. Deterministic ZIP documents generated
during the deployment build, existing only inside the artifact, are not that. The invariant
stated positively: **one shared implementation + a data-driven build → ZIP-specific
deployment documents.** A build gate fails if `community/` ever becomes tracked by git.

### One deliberate difference at flip time, stated rather than discovered later

The artifact stages the repo minus `.git`, `.github`, `test/`, `docs/` and `node_modules`.
Under branch deployment those trees are served publicly today (Pages serves whatever is on
the branch), so switching the source **removes `homesignal.net/docs/…` and
`homesignal.net/test/…` from the public site**. That is a tightening, not a regression — no
shipped page links to either (checked: zero `href` references to `docs/` or `test/` across
every `.html`/`.js` that ships) and they are internal engineering records, not product. It
is recorded here because it happens at the flip, not at merge.

---

## 2 · Fresh measurement — the 12,722 cross-tab

Measured **2026-09-04 14:26:44Z**, server-side, against production. Rule F unchanged: **≥3
legitimate non-weather Alerts items** across local-news journalism, government notices and
forward-dated upcoming meetings. Weather displays and never counts.

| control | value |
|---|---:|
| canonical registry rows | **12,722** |
| distinct canonical ZIPs | **12,722** |
| duplicates | **0** |
| ZIP 80249 (removed drift page) in the registry | **0** |
| `app_community_meta` rows | 12,722 |
| `app_changes` rows | 158,646 |
| forward-dated meetings | 1,698 |
| active local-news retractions | 817 |

| | Rule F PASS | Rule F FAIL | total |
|---|---:|---:|---:|
| development/facility gate PASS | **6,727** | **4,975** | 11,702 |
| development/facility gate FAIL | **529** | **491** | 1,020 |
| total | **7,256** | **5,466** | **12,722** |

- **Alerts-only PASS: 529** — pages that qualify on Alerts substance while the
  development/facility flag says no. Under the old single flag every one of them was
  **noindex**.
- **Development-only PASS: 4,975** — pages the old flag indexed on development substance
  with fewer than 3 Alerts items. Their *community* page is now noindex; their *map* page is
  untouched.
- **F-visible (`gn + um ≥ 3`) would be 6,555**, so **701 pages pass Rule F only via local
  news** — which is exactly why §3 below was mandatory.

The earlier counts (7,058 / 7,071) were not forced; movement is normal ingestion.

---

## 3 · The local-news display mismatch is fixed

`d4392d7` proved `community.html` never called `HS.data.news()`, so local news counted
toward Rule F while the page never displayed it. Both halves now render it:

- the **generated document** ships a `Local news` section in the initial HTML;
- the **hydrated page** reads `HS.data.news(zip)` and renders a `Local news` group in the
  same column as the other Alerts tiles.

Asserted offline in `test/zip-pages-seo.test.mjs` (§6) against both the built bytes and the
shipped runtime. **No page is qualified by invisible content.**

### A second mismatch found while building, and fixed

A ZIP can be **Alerts-PASS while `data_quality = 'coverage_coming'`** (529 such pages;
control B, 01034 Granville MA, 6 local-news items). On those branches the app renders
coverage copy only — and the ported runtime **deleted the build-time block** before doing
so, so JavaScript removed precisely the content the crawler had just been served. The SSR
block is now dropped **only** on the branch that re-renders the same Alerts populations
(`test/community-page-contract.test.mjs`).

---

## 4 · Upcoming Meetings — the generator now matches the shipped read

The ported generator attached meetings by walking **down** from every meeting-holding
community to its ZIP descendants, with **no sibling-exclusion**. `lib/data.js::meetings`
resolves the ZIP's most-specific community, walks **up** the `parent_id` chain, and excludes
`City government (X)` rows for towns other than the ZIP's own. The difference is not
cosmetic: on a shared county root it put every town's council on every ZIP page in the
county — and Rule F counts those rows, so it also bought index slots with them.

`scripts/gen_zip_pages.py::meetings_for` is now a faithful port: most-specific resolution →
ancestor chain (≤6 hops) → forward-dated only → 24 by date → sibling-exclusion → 12. The
forward-date filter is asserted **in the assembler** rather than trusted from the network
query, and the fixture carries a 2020-dated meeting that must never render as "upcoming".

---

## 5 · Publication policy — every canonical ZIP gets a document

**Selected: generate all 12,722. Indexability is a separate decision, carried in `robots`.**

Justification, in the terms §9 of the brief asks for:

| requirement | why generating all 12,722 satisfies it |
|---|---|
| no generic-shell response for a canonical ZIP URL | every canonical path returns its own ZIP-specific document |
| honest empty/thin pages | an empty page still names every section and says truthfully that nothing is on file |
| `noindex, follow` on a failing page | shipped in the initial HTML; links are still followed |
| automatic fail→pass and pass→fail | a ZIP crossing Rule F changes its **robots directive**, never its existence — no page appears or disappears, no URL 404s on a data movement |
| sitemap consistency | the artifact's sitemap advertises exactly the Rule F pass set |
| no manually maintained per-ZIP files | nothing generated is committed; a gate fails if it ever is |

Generating only the passers would make a ZIP's *existence* depend on a content threshold, so
every fail→pass transition would be a new URL and every pass→fail a 404 — the opposite of a
stable canonical identity. Cost measured rather than assumed (§8).

---

## 6 · Robots, canonical, legacy URL

- **Rule F PASS →** `index, follow` in the initial HTML. **Rule F FAIL →** `noindex, follow`.
  Decided at build time; JavaScript never moves it (`setIndexable` is gone from the runtime,
  and its absence is asserted).
- **Canonical:** every generated document self-references `https://homesignal.net/community/<zip>/`.
- **Legacy `community.html?zip=`:** stays functional for in-app navigation and bookmarks,
  is **permanently `noindex, nofollow`** (static, in its `<head>`), and adds a canonical
  pointing **at** the ZIP path. One canonical identity, no duplicate-indexing ambiguity.
- **`404.html`** forwards `/community/<zip>/` to `community.html?zip=` — which matters before
  the deployment-source flip (links land correctly) and for non-canonical 5-digit paths
  after it (the dynamic page's honest "isn't covered yet" state, `noindex`). No unknown ZIP
  can become an indexable community page.

## 7 · Sitemap

The community half is rewritten **inside the artifact**, not in the repo:
`gen_zip_pages.py::reconcile_sitemap` removes every `community.html?zip=` URL and emits
`/community/<zip>/` for exactly the Rule F pass set. The development half
(`homesignalmap.html?zip=`, advertised from `app_community_meta.indexable`) is left
untouched — page-purpose separation.

Why in the artifact: until the deployment source is switched, the committed `sitemap.xml` is
what production serves, and advertising 7,256 URLs that do not exist yet would be a sitemap
of 404s. This way the advertised set becomes correct at exactly the moment the documents
start existing, and stays untouched if they never do.

The set equality is gated twice — in the offline suite and again in the build job.

---

## 8 · Frozen controls (A–J)

Re-derived from live data **2026-09-04 14:26–14:35Z** and pinned in
`.github/workflows/pages.yml`. **07010 Cliffside Park was the prior unit's "Alerts PASS +
development FAIL" control and has since become development PASS** — replaced transparently
by 01034 Granville MA, per the brief's §20 rule.

| ctl | ZIP | place | LN | wx | GN | UM | Rule F | dev gate |
|---|---|---|---:|---:|---:|---:|---:|---|
| **A** pass + dev pass | 01001 | Agawam MA | 5 | 0 | 0 | 0 | 5 ✓ | PASS |
| **B** pass + dev FAIL | 01034 | Granville MA | 6 | 0 | 0 | 0 | 6 ✓ | FAIL |
| **C** fail + dev pass | 01002 | Amherst MA | 0 | 0 | 0 | 0 | 0 ✗ | PASS |
| **D** fail + dev FAIL | 02543 | Woods Hole MA | 0 | 0 | 0 | 0 | 0 ✗ | FAIL |
| **E** local-news-carried | 01001 | Agawam MA | 5 | 0 | 0 | 0 | 5 ✓ | PASS |
| **F** weather + thin | 04401 | Bangor ME | 2 | 1 | 0 | 0 | 2 ✗ | PASS |
| **G** honest-empty | 02543 | Woods Hole MA | 0 | 0 | 0 | 0 | 0 ✗ | FAIL |
| **H** jurisdiction fan-out | 22030 | Fairfax VA | 0 | 0 | 60 | 0 | 60 ✓ | PASS |
| **I** anonymous / no point | 01001 | — every request in the proof is anonymous: no session, no saved property, no address |
| **J** point-leak negative | 28468 | Sunset Beach NC — **19,536** development records, the densest canonical ZIP; its community document must contain no coordinate, distance or radius string |

**B and C together are the page-purpose separation proof**: an Alerts-positive ZIP qualifies
its community page with the development gate saying no, and a development-positive ZIP no
longer drags a thin Alerts page into the index.

---

## 9 · ZIP geography — unchanged and asserted

Nothing in the render path reads an address, a HOME, a lat/lng, a centroid, a radius, a
distance or a nearest-point relationship. Applicability is ZIP set membership
(`app_changes.zip`, `communities.zip_codes`) and the jurisdiction chain (`parent_id`) —
exactly as the shipped pipelines already decide it. Jurisdiction fan-out across many ZIPs is
preserved and treated as correct behaviour (control H). `test/zip-pages-no-point.test.mjs`
fails on any such symbol appearing in the generator or any such string appearing in the
generated bytes.

Maps and address search are untouched: no file under the map/address surface is modified by
this build, and the full offline suite (which includes the maps suites) is green.

---

## 8b · Build receipts — run `33885422583`, job `101063880672`, head `4d1c530`, **success**

Every line below is quoted from that run's log (the gates tee into a receipts file which the
final step replays, because `upload-pages-artifact` lists all 12,722 generated paths and
pushes every earlier step past the retrievable log tail — a gate whose result cannot be read
is not a gate).

```
canonical registry: 12722 rows, 12722 distinct, 0 duplicates
documents      : 12722
rule F pass    : 7256
rule F fail    : 5466
artifact bytes : 51687277 (49.3 MB)
avg html bytes : 4062
max html bytes : 8487 (zip 84301)
sitemap        : -11701 legacy community.html?zip= URLs, +7256 /community/<zip>/ URLs
build seconds  : 95.1
generated documents: 12722
non-canonical path shapes: 0
artifact size: 132M
sitemap reconciled: 7256 community URLs == rule_f_pass 7256
GATES OK
```

| measure | value |
|---|---:|
| generated ZIP documents | **12,722** |
| ZIP HTML, uncompressed | **51,687,277 B (49.3 MB)** |
| whole artifact, uncompressed | **132 MB** |
| whole artifact, uploaded (tar.gz) | **7,766,955 B** |
| average ZIP document | **4,062 B** |
| largest ZIP document | **8,487 B** (84301, Brigham City UT) |
| generation step | **95.1 s** |
| whole build job | **2 m 06 s** (14:43:55 → 14:46:01Z) |
| `deploy` job | **skipped** — not `main` |

**The independent agreement that makes the count trustworthy:** the server-side SQL cross-tab
(§2, PostgreSQL over the tables) and the generator (Python over PostgREST) are separate
implementations of Rule F reading through different interfaces, and both return **7,256 /
5,466**.

Offline gates, in the same log: `zip-pages-seo` **60 passed, 0 failed** · `zip-pages-no-point`
**19 passed, 0 failed** · `community-page-contract` **18 passed, 0 failed**.

### Candidate crawler proof — 63 passed, 0 failed

Over the built artifact, served locally, before any deployment exists:

- `[01034]` HTTP 200 · `index, follow` in the **initial** HTML · canonical
  `https://homesignal.net/community/01034/` · ZIP-specific H1 and title · meta description ·
  all three Alerts headings present · real Alerts items present · no distance/HOME/centroid.
- `[01002]` the same, with `noindex, follow`.
- **Googlebot smartphone and Googlebot desktop receive byte-identical HTML** to a normal UA —
  no cloaking. Two different ZIPs return different documents.
- Controls **A / D / E / F / G / H / J** all pass, including *"E [01001] the local news that
  qualifies this page is IN the page"*, *"F [04401] a weather-only/thin page stays noindex —
  weather never carries Rule F"* with *"...while weather is still DISPLAYED"*, and
  *"J [28468] the densest development ZIP leaks no point/radius/distance string"*.
- A non-canonical ZIP path is a 404, never an indexable shell.
- Sitemap: *"advertises exactly the Rule F pass set (7256 = 7256)"*, the legacy URL is gone,
  the development half survives.
- **Hydration does not corrupt the build-time contract:** on 01034, 01002 and 01001 the robots
  directive is unchanged after JavaScript, the canonical, the ZIP identity and the title all
  survive, and there are no uncaught page errors. Alerts substance survives on both shapes —
  01034 keeps the build-time block (`ssr items 6`, the coverage-coming branch) while 01001
  re-renders the tiles itself (`ssr items 0`, 3,577 characters).

---

## 11 · DEPLOYED — and the production proof that was withheld until it was

**The founder switched *Settings → Pages → Build and deployment → Source* to "GitHub
Actions".** That setting is not readable from this session — the egress proxy blocks
`/repos/{owner}/{repo}/pages` and `/environments` (both HTTP 403, "not permitted through this
proxy") — so it was verified the only way available, **operationally and then empirically**:

| step | receipt |
|---|---|
| merge | PR #1023 squash-merged → **`f7e448a`** |
| build | run **33890821625**, job 101081759870, `main` @ `f7e448a`, **success** 15:40:26 → 15:42:23Z |
| deploy | job 101082388260, `actions/deploy-pages@v4`, **success** 15:42:30 → 15:42:36Z |
| deployment | id **6267785306**, created 15:42:23Z, **success 15:42:39Z**, via the `github-actions` app |
| the switch, proven | the previous deployment (id 6267751012, via the `github-pages` app — the branch path) was marked **`inactive` at 15:42:39Z**, the same instant. `deploy-pages` cannot succeed while the source is a branch, and the branch deployment cannot go inactive unless something replaced it. |
| the switch, proven again | `/community/01034/` returns **HTTP 200 with ZIP-specific bytes**. Under branch deployment that path does not exist — Pages ignores the query string and serves content by path only. This is the measurement that settles it. |

Build stats for the deployed artifact: **12,722 documents · Rule F pass 7,256 / fail 5,466 ·
indexable 7,256 · ZIP HTML 49.3 MB (avg 4,064 B, max 8,487 B) · whole artifact 132 MB
uncompressed** · pre-upload candidate proof **63 passed, 0 failed**.

### 11.1 · Rule F re-measured AFTER deployment (2026-09-04 15:45:37Z)

Identical to the pre-deployment measurement, so nothing was forced: **12,722 canonical ZIPs ·
PASS 7,256 · FAIL 5,466** · both 6,727 · Alerts-only 529 · development-only 4,975 · neither
491. **Every A–J control held its class — no replacement was needed** (01001's local news moved
5 → 6 items, which does not change its class).

### 11.2 · Initial HTML, from the bytes, via `pg_net`

The sandbox has no egress to `homesignal.net`, so Postgres fetched the pages. Raw response
bodies, before any JavaScript:

| ctl | ZIP | status | bytes | robots | canonical | H1 |
|---|---|---:|---:|---|---|---|
| **A** | 01001 | 200 | 3,903 | `index, follow` | `/community/01001/` | `01001 · Agawam (01001), MA` |
| **B/E** | 01034 | 200 | 3,912 | `index, follow` | `/community/01034/` | `01034 · Granville (01034), MA` |
| **C** | 01002 | 200 | 2,533 | `noindex, follow` | `/community/01002/` | `01002 · Amherst (01002), MA` |
| **D/G** | 02543 | 200 | 2,543 | `noindex, follow` | `/community/02543/` | `02543 · Woods Hole (02543), MA` |
| **F** | 04401 | 200 | 3,384 | `noindex, follow` | `/community/04401/` | `04401 · Bangor (04401), ME` |
| **H** | 22030 | 200 | 4,413 | `index, follow` | `/community/22030/` | `22030 · Fairfax (22030), VA` |
| **J** | 28468 | 200 | 6,024 | `index, follow` | `/community/28468/` | `28468 · Sunset Beach (28468), NC` |

Every one carries a ZIP-specific `<title>` and meta description, all three Alerts headings, the
"Compiled from official public records on <time>" line, and usable internal links. **`point
leak` false on all of them** (no distance, HOME, centroid, radius or nearest string). 01034
carries **6 local-news `<li>`** — the content that qualifies it — while its Government Notices
section truthfully says none are on file. 04401 **displays a weather alert and is still
`noindex`**: weather never carries Rule F.

**No cloaking.** Same URL, three user agents, body md5 over the raw bytes:
`01034` → `a6e5afd87cad` for normal, Googlebot smartphone and Googlebot desktop, all three
identical; `01002` → `3f0902f2c945`, likewise. The runner instrument independently agrees
(sha12 `494aee7b16d11d6e2587d51c` and `d5c9424b24e6ae7e7c910c15`).

### 11.3 · Meetings geography, in production

`95002` and `95008` (both Santa Clara County, which holds **231** forward-dated meetings) render
**identical 12-item lists** — the county cascade reaching both of its ZIPs. `10001` (New York
County) shares **0** titles with either. The 12 rendered titles for 95002 **exactly reproduce**
the generator's documented total order `(meeting_date asc, id asc)` — verified in SQL,
`matches_generator_total_order: true`, 12 of 12.

⚠️ **One honest limit, stated rather than implied.** The sibling-exclusion half of that rule —
`City government (X)` scoped to the ZIP's own place — **cannot be exercised in production today**:
there are currently **ZERO** forward-dated `City government (%)` meetings in the table, so
nothing exists for it to exclude. That specific rule stays proven by the offline fixture, which
carries an Agawam and a Springfield council on one shared county root and asserts Springfield is
dropped. An earlier ad-hoc comparison reported `sets_match: false` and was **my expectation's
tie-break, not a defect** — it ordered ties by title where the generator orders by id; all 12
rendered rows were inside the same 24-row date window.

### 11.4 · Legacy URL, invalid ZIP, sitemap

- `community.html?zip=01034` → **200**, 1,152 bytes, `noindex, nofollow` **in the initial
  HTML**, no competing canonical in the bytes (the canonical to `/community/01034/` is added on
  hydration and was confirmed present after JS). One canonical identity; the canonical path
  returns 200 **directly**, not by redirect.
- `/community/00000/` → **404**, `noindex`. A non-canonical ZIP is never an indexable page.
- Production `sitemap.xml`: 2,719,785 bytes · **7,256 canonical community URLs, 7,256 distinct
  (0 duplicates), 0 malformed** · **0 legacy `community.html?zip=`** · 11,701 development URLs
  untouched · 18,962 `<loc>` total (7,256 + 11,701 + 5 statics) · no 80249. **Canonical
  community URLs == current Rule F PASS, exactly.**

### 11.5 · Hydration, and the map

`verify-zip-pages-live` run **33891407719 — 162 passed, 0 failed**. After JavaScript executes:
robots is unchanged on 01034 (`index, follow`), 01002 (`noindex, follow`) and 01001; canonical,
ZIP identity and title all survive; there are no uncaught page errors; the development-map link
still works. **The 529-class defect is re-proven fixed on a current member of that class:
01034 (Alerts PASS, development FAIL, `data_quality = coverage_coming`) keeps its build-time
Alerts block after hydration — 6 items still in the DOM.** 01001 instead re-renders the tiles
itself (`ssr items 0, re-rendered true`), which is the other legitimate shape.

Map/address regression: `homesignalmap.html?zip=28468` → 200, the Leaflet map renders, **19,551
sites load**, the address search box is present, no uncaught errors.

---

## 10 · What remains

**Nothing blocking.** The one-time setting is done (§11) and the pages are live and proven.

One open follow-up, logged not done: `scripts/gen_sitemap.py` still writes the committed
`sitemap.xml` with the legacy `community.html?zip=` URLs, and the artifact rewrite replaces
that half at build time. What is SERVED is correct; the committed file is not what ships.
Retiring that generator's community half is a small separate change and was deliberately kept
out of the deployment.
