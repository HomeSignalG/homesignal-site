# Maps product readiness — the 424 geography-ready ZIP pages

**Question this answers:** now that geography is trustworthy, what NON-GEOGRAPHY blockers remain
before these pages are genuinely ready for the Maps workbook and eventual SEO/indexability?

**Nothing was changed.** No acquisition, no write to `geo.n5_association` or
`geo.n5_boundary_membership`, no production read switch, no workbook edit, no SEO/indexability
mutation. Every number below is a read.

Artifact: `completed-shards-product-readiness.csv`, 424 rows, body md5
`d67f9cc3783cf775d42b35f91103cc7f` (identical on the database side and the file side).

---

## 0. Scope control — what "displayed development" means here

The Maps read path is `public.app_projects` (the materializer's output), not the
`development_reports` cache and not `geo.n5_association`. **Every currently displayed development
record on these 424 ZIPs comes from a registry inside the N5 adjudication scope** — measured, not
assumed: 6 registries, 50,086 rows, and all 6 are in `geo.n5_accepted_source`.

| registry | rows | ZIPs | N5 treatment |
|---|---:|---:|---|
| `massdot-highway-projects` | 38,499 | 339 | RECOVERY |
| `worcester-building-permits` | 7,664 | 9 | **NOAUTH (terminal — can never have geometry)** |
| `ctdot-project-work-areas` | 3,918 | 68 | RECOVERY |
| `iowa-dot-five-year-program` / `-bid-projects` / `-bid-projects-lines` | 5 | 1 | RECOVERY / PROVEN / RECOVERY |

So the comparison is like-for-like: the authoritative set and the displayed set describe the same
corpus. **50,086 display ROWS collapse to 19,978 distinct (ZIP, project) PAIRS** — a project can
carry several `source_seq` rows on one page — and the pair is the unit that compares to boundary
membership.

---

## 1. The 424 mapped to the current Maps product

| | pages |
|---|---:|
| ZIP pages in the set | **424** |
| have a materialized production page (`app_community_meta`) | **411** |
| **have NO production page at all** | **13** |
| `data_quality = 'pass'` | 410 |
| `data_quality = 'coverage_coming'` | 1 (01034) |
| `indexable = true` today | **409** |
| carry other Maps content (EPA facilities) | 8,615 facility records across the set |

⚠️ **The 13 pages with no production row are exactly the geometry-only discoveries.** Boundary-first
placed development inside a ZCTA that production has never modelled as a page — so the content is
adjudicated and there is nowhere to render it. They are class **E**, not a data defect:
`01054 01093 01301 01330 01337 01338 01339 01340 01342 01364 01367 01370 01373`.

**Authoritative geography and current display are kept in separate columns throughout.** No column
in the artifact mixes them.

---

## 2. The read-path gap — what a switch would change (nothing was switched)

| relationship between current display and boundary-first membership | pages |
|---|---:|
| **exact match** | **7** |
| over-inclusive only | **298** |
| under-inclusive only | **30** |
| **both over- and under-inclusive** | **89** |
| measured authoritative zero | **74** |
| switching removes EVERY currently displayed development | **74** |
| boundary-first adds development to a page currently showing none | **16** |

7 + 298 + 30 + 89 = 424.

At the record level: **19,978 displayed pairs · 5,893 authoritative · 5,335 confirmed · 14,643
displayed-but-refuted · 558 authoritative-but-not-displayed.** Both closures are exact
(5,335 + 14,643 = 19,978 and 5,335 + 558 = 5,893).

🔑 **The 558 is the same number an earlier intermediate mislabelled.** It is real, and it is the
**display** under-inclusion (authoritative pairs absent from `app_projects`) — not the
`n5_association` under-inclusion, which is 301. Two different legacy sets, two different questions;
the artifact names which one each column measures.

⚠️ **The 74 pages that lose everything are not a content loss to be avoided.** All 74 currently
display development the geometry refutes; 72 of them have ≥3 EPA facilities and remain substantive
without it. See §5.

---

## 3. Maps workbook — which fields are now truthfully refreshable

Measured against the `ZIP Code Pages` tab's **13 fixed columns** as documented in
`docs/maps-go-live-governance.md` §11 (A ZIP Code · B Community Name · C County · D State ·
E Page Slug · F In Source Registry · G Source Count · H PR · I Merged · J Production · K Live ·
L Verified · M Blockers). **The workbook itself is the founder's and is not in this repo** —
`ls docs/*.xlsx` returns nothing — so this is a proposal, not an edit. `Wired` and `Live`
semantics are untouched.

| column | classification | why |
|---|---|---|
| A–E identity | **NOT APPLICABLE** | ZIP/name/county/state/slug — geography adjudication changes none of them |
| F In Source Registry | **NOT APPLICABLE** | membership of `jurisdiction-registry.json`; unchanged |
| G Source Count | **NOT APPLICABLE** | count of registry sources covering the ZIP; unchanged |
| H PR · I Merged · J Production | **NOT APPLICABLE** | process/deploy state; unchanged |
| **K Live** | **NOT APPLICABLE — and deliberately not redefined** | Live = record-backed in the DB after deploy and re-cache. These pages are record-backed today and were before this work; adjudicating geography did not move the value. Refreshing K from geography evidence would silently redefine it. |
| **L Verified** | **STILL BLOCKED** | a page cannot be verified against authoritative geography while the read path serves legacy membership. **417 of 424 pages display a development set that differs from the authoritative one**; only 7 match exactly. Unblocks when the read path switches, not before. |
| **M Blockers** | ✅ **READY TO REFRESH** | prose status. Every per-page fact in the artifact can be stated truthfully today. |

🔑 **There is no development geography / count / accuracy / duplicate COLUMN to unblock.** The tab
has 13 columns and governance §11 forbids adding any (*"Adding columns is the single most likely way
to get an edit rejected"*). The accuracy dimension that geography adjudication just made measurable
therefore has exactly one legitimate home: **the Blockers string**, extended per §11's style
(`'<STATUS> — <detail>. Gaps: <a>; <b>.'`), never replaced.

**Proposed M content per class** (not applied):
`GEOGRAPHY ADJUDICATED — boundary-first membership N; current display M pairs, K confirmed. Gaps: read path still legacy; <class-specific>.`

---

## 4. SEO / delivery readiness — measured separately from geography

These are properties of the shipped page, read from the repo, and they apply to **all 424** alike.

| gate | state | receipt |
|---|---|---|
| server-rendered / static HTML content | ❌ **none** | `homesignalmap.html` renders every record client-side from Supabase; the static file contains no ZIP content |
| `noindex` status | ⚠️ **static default is `noindex, nofollow`, flipped by JS** | `homesignalmap.html:11` `<meta name="robots" content="noindex, nofollow" id="robots-meta"/>`; `:531` sets it to index only after an async `app_community_meta.indexable` read (`:1011`, `:1120`) |
| canonical correctness | ❌ **wrong on every ZIP page** | `homesignalmap.html:14` `<link rel="canonical" href="https://homesignal.net/homesignalmap.html"/>` — parameterless, and never rewritten in JS (`grep` finds exactly one occurrence, no `setAttribute`). Every `?zip=` page declares a canonical pointing at a different URL |
| structured data | ❌ **none** | no `application/ld+json` anywhere in the page |
| internal-link discoverability | ⚠️ **JS-only** | links are built by `HS.navHref('homesignalmap.html', zip)` inside client-rendered output (`community.html:72`, `:129`); the static HTML links only to the parameterless page |
| sitemap inclusion | ✅ **409 of 424 listed** | counted directly in the committed `sitemap.xml`: 409 of the 424 appear as `homesignalmap.html?zip=<zip>` — exactly the 409 with `indexable = true`. `gen_sitemap.py` lists a dev ZIP page only if it is indexable AND has a `development_reports` row, so the 13 class-E ZIPs cannot be listed and the 2 non-indexable pages are correctly absent |
| the project's own substance gate | ✅ established, unchanged | `indexable := (pass) AND (_ndp > 0 OR _nfc >= 3)` — `docs/app-content-materialize.sql:108`. **No new numeric threshold was invented here; every projection below uses that one.** |

🔑 **So the honest headline is: geography is no longer the binding constraint, and three site-wide
delivery defects now are** — parameterless canonical, no server-rendered content, and a robots value
that only exists after JavaScript runs. They are identical on all 424 pages, so they do not
discriminate between them, which is why the per-page classes below are scored on the per-page state
and the site-wide items are reported once, here.

---

## 5. The 74 measured-zero pages

A measured authoritative development count of zero is valid geographic information, and all 74 have
an executed boundary-first pass behind that zero.

| | pages |
|---|---:|
| **ZERO DEVELOPMENT + OTHER USEFUL MAPS CONTENT** (≥3 EPA facilities — the project's own bar) | **72** |
| **ZERO DEVELOPMENT + NO SUBSTANTIVE MAPS CONTENT** (<3 facilities) | **2** — `01252` (1 facility), `01441` (1 facility) |

All 74 currently display development that boundary-first refutes in full (they are exactly the
"switching removes everything" set). **Nothing here proposes keeping refuted development to avoid an
empty page, and nothing is fabricated**: the 72 stand on real EPA facility records they already
carry, and the 2 are reported as thin rather than dressed up.

⚠️ **`01252` and `01441` are the only two pages that are indexable TODAY and would not be after a
switch** — their current indexability rests entirely on development the geometry refutes.

---

## 6. Product readiness classes

Scored per page. Class A means *per-page* delivery state is ready; the three site-wide items in §4
still apply to it.

| class | definition | pages |
|---|---|---:|
| **A** | geography correct + substantive content + page materialized, `pass`, indexable | **335** |
| **B** | geography correct + substantive content + a per-page technical blocker | **2** |
| **C** | geography correct + measured-zero development + other substantive Maps content | **72** |
| **D** | geography correct + insufficient substantive Maps content | **2** |
| **E** | unexpected remaining blocker — **no production page exists** | **13** |

- **B = `01034`, `06390`**, and the two are different failures the single blocker token
  `NOT_INDEXABLE_TODAY` does not separate — stated here rather than left ambiguous:
  - `01034` — its cache row is `coverage_coming`, so it fails the gate's `pass` half. Boundary-first
    gives it 3 authoritative developments; it would **still** not be indexable after a switch,
    because `coverage_coming` is a caching state, not a geography one.
  - `06390` (Fishers Island) — `pass`, but displays 0 development and 2 facilities today, so it
    misses the substance bar by one facility. Boundary-first gives it **7** authoritative
    developments, so it is the **one page that would GAIN indexability** from the switch.
- **D = `01252`, `01441`** — the two measured-zero, facility-thin pages above.

---

## 7. What could become Maps SEO-ready without further geography acquisition

**408 of 424** would satisfy the project's existing substance gate with authoritative membership in
place (`page_exists AND pass AND (authoritative_dev > 0 OR facilities >= 3)`), against **409**
indexable today — a net −1, composed of +1 (`06390`) and −2 (`01252`, `01441`).

**That 408 is a substance-gate projection, not a readiness claim**, because all 408 still carry the
three site-wide delivery defects in §4. Remaining blockers, by count:

| blocker | pages | needs |
|---|---:|---|
| site-wide delivery only (canonical / SSR / JS-set robots) | **335** | a page-delivery fix, not data |
| measured-zero development, facilities carry the page | **72** | nothing — but the tile copy should say zero, not empty |
| no production page exists | **13** | a `communities` + materializer pass (site side) |
| coverage_coming cache state | **1** (`01034`) | a successful re-cache |
| below the substance bar after switch | **2** (`01252`, `01441`) | more real content, or accept noindex |
| per-page substance gained by the switch | **1** (`06390`) | the read-path switch itself |
