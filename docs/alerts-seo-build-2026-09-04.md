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

## 10 · What remains

**The one-time repository setting: Settings → Pages → Build and deployment → Source =
"GitHub Actions".** It cannot be changed from CI. Until it is, the existing branch
deployment continues to serve the site exactly as today — the replacement is built and
proven but not switched on.
