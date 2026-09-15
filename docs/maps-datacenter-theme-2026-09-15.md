# MAPS · Data Center Theme — build receipt, 2026-09-15

A theme **inside** the existing Bluesky Posts → MAPS content family. No new content family,
no new tile, no new table, no new column, no new publisher, no new map, and nothing approved
or published.

Inspected at `homesignal-site` `5cad1e3` and `homesignal-ingest` `1f8fbf3`.
Concurrency verdict before editing: **GENUINE GAP** — no open PR or active branch in either
repo implements this outcome (site PRs #1152…#394, ingest PRs #487…#261 all checked).

---

## 1. The canonical Data Center type, measured — and where the brief and production differ

The brief's conceptual rule is `content_family='MAPS' AND evidence.type === <canonical type>`.
**That rule is not satisfiable as written**, and the measurement is the reason:

```sql
select record_kind,
       count(*) filter (where type     ~* 'data[[:space:]]*cent(er|re|e)|data[[:space:]]*hall|hyperscale|server[[:space:]]*farm') as hit_type,
       count(*) filter (where type_raw ~* '…same…') as hit_type_raw,
       count(*) filter (where name     ~* '…same…') as hit_name,
       count(*) as total
from public.app_projects group by 1;
```

| record_kind | `type` | `type_raw` | `name` | total |
|---|---:|---:|---:|---:|
| development | **0** | 81 | 477 | 2,977,626 |
| facility | 744 | 0 | 745 | 216,405 |

* `app_projects.type = 'datacenter'` exists **only** on `record_kind='facility'` (744 rows),
  and gate 1 of `isEligible` already refuses facilities. The 744 is the positive control that
  makes the development **0** a real absence rather than a broken query.
* `app_projects` carries **`type` and `type_raw` only** — `use_type` / `layer` / `category`
  are engine site-object fields and do not exist as columns (live `information_schema` read).

**So the canonical type is not a string on the row — it is `HS.resolveMarker(...).typeKey ===
'datacenter'`,** Map 1's own classifier, which is what decides the marker's shape *and* its
PROJECT TYPE filter bucket.

### Why membership had to be Map 1's answer and not something narrower

A theme post's image is Map 1 with the **Data center** chip selected and every other type
deselected. A queue narrower than the map would filter out the very marker the post is about;
wider, and it would carry posts the chip does not show. One classifier removes both failures by
construction.

This is also why a **broader** source type does not block the theme. Map 1 runs its data-centre
phase *before* the `TYPE_EXACT` loop precisely because every category it can displace —
Commercial, Industrial, Development, Utility, Civic — is strictly broader.

---

## 2. What was actually wrong in `ELIGIBLE_TYPES`, and what fixing it changed

`bluesky/lib/maps-eligibility.mjs` listed no spelling of the canonical type, so a record whose
**type** stated a data centre failed gate 3 while one that merely **mentioned** one passed gate
10 (`MATERIAL` already carries `data cent`). Closed by `isEligibleType`, which delegates to the
canonical vocabulary rather than hand-listing four spellings.

⚠️ **It changes no row's verdict today** — 0 development rows carry such a type. It exists so the
first registry to stamp the canonical type is not silently dropped. The brief's §4 described this
as the binding constraint; **it is not.** The binding constraints for data centres today are the
45-day recency window and the Operating exclusion (§5 below).

---

## 3. The one cross-repo duplication, and its proof

The theme decision is needed in two repos that share no package:

* **site** — the dashboard filter and the capture generator call `HS.resolveMarker` **directly**.
  `lib/maps-social-theme.js` carries **no data-centre vocabulary at all**; a test fails if any
  `.test(` / `.match(` / RegExp literal ever appears in it.
* **ingest** — the post COPY is composed there, so it needs the decision.
  `bluesky/lib/maps-datacenter.mjs` is a **verbatim port** of `lib/map.js::statedDataCenter`
  plus the `terminalNeutral` precedence that outranks it, citing source line numbers.

**Parity is measured, not asserted.** Over all 891 distinct production `(name, type, type_raw)`
shapes mentioning a data centre or an infrastructure head-noun attack pattern, plus the four
canonical spellings and the terminal-neutral control: **898 of 898 agree, 87 YES on both sides**
(non-zero positive control). Labels in `homesignal-ingest/fixtures/maps/datacenter-parity-corpus.json`
are produced **by** `lib/map.js`, so the ingest test pins against Map 1's answers.

🔑 **The first port was wrong and the parity run is what caught it.** Omitting `terminalNeutral`
(lib/map.js PRECEDENCE 1.5) disagreed on **12 real shapes** — `IRON MOUNTAIN DATA CENTER - PUMP`,
`IRON MOUNTAIN SC-31 DATA HALL TI`, `ACC Installing data center containment racking…` and nine
more, every one an `Other project` record the port would have claimed while Map 1 draws an
uncategorised capsule. Reading the regex would not have found it.

A second gap the corpus could not show: `DATACENTER_RE` joins the words with `\s*`, which cannot
match a hyphen, so the spelling `data-center` resolves in Map 1 one phase later through
`TYPE_EXACT`. Found by feeding all four canonical spellings through both sides.

---

## 4. Copy — and two deviations from the brief, stated rather than buried

The founder hook replaces the header **verbatim** for theme candidates. Everything else is the
same code on both paths: lead sentence, date line, shortening ladder, every anti-fabrication rule.

1. **The brief carries two CTA wordings** — §8 "…what's changing near you." and §26 "…what's
   changing in your area." §26 is the visual acceptance gate and the later statement, so it
   governs. Flagged here rather than silently picked.
2. **§8's noun phrase "data-center development record" is ungrammatical in the two shipped
   lead-sentence shapes** ("Plans for a data-center development record are on file with…",
   "Minneapolis has approved a data-center development record"), and those shapes encode the
   status→verb mapping this unit must not redesign. The theme's category noun is therefore
   **"a data center project"** — the identical claim, and Map 1's own legend label.

Two theme rungs re-offer the founder CTA **after** the ladder has already given up the source's
long name. Without them the approved line was dropped on posts with 70+ graphemes to spare (the
acceptance candidate landed at 226/300 carrying the shortest CTA). The record's words still
outrank ours at every subject level.

---

## 5. The real acceptance candidate, and why the queue is currently quiet

**`RBC Data Center Campus Major Amendment`** — `e25ba178-6906-487a-b28a-6e229fa08feb`,
ZIP 64155, City of Kansas City, Missouri, **Proposed**, filed 2026-09-09, case
`CD-CPC-2026-00142`, dataset-precision on `data.kcmo.org`, point geometry.

It passes the **unchanged** shipped `isEligible` and is classified `datacenter` by the shipped
`HS.resolveMarker` (`DATACENTER:name`, octagon, categories `['datacenter']`). Post text, 266/300:

```
Is a data center planned near you?
Plans for a data center project are on file with Kansas City.

Search your ZIP free to explore what's changing in your area.
https://homesignal.net/homesignalmap.html?zip=64155&utm_source=bluesky&utm_medium=social&utm_campaign=maps
```

**Its Map 1 screenshot is correctly REFUSED, and that is the contract working.** The project is
not in `geo.zip_authoritative_membership` for any of its four ZIP reports (64155/64156/64165/64166,
all `boundary_complete`), and `geo.zip_authoritative_marker` holds **0** rows for its `source_key`.
Controls prove the zero is real and project-specific: 901,465 development membership rows overall,
and its own registry is present with **2,112** members.

⚠️ **Root cause: the authoritative ZIP-geography build lags recent filings.** Newest member for
`kcmo-development-cases` is **2026-08-25**; for `minneapolis-ccs-permits`, **2026-08-28**. Both
data-centre candidates were filed 2026-09-09/10.

**Full cohort, so the queue's quietness is understood rather than assumed** — data-centre
development rows with coordinates, by lifecycle, and how many are screenshot-provable today:

| status | cohort rows | authoritatively on their ZIP page | newest provable |
|---|---:|---:|---|
| Operating (ineligible by contract) | 209 | 29 | 2026-08-10 |
| Approved | 163 | 38 | 2026-07-30 |
| Proposed | 107 | 30 | 2026-06-15 |

The intersection of *eligible* (forward lifecycle, ≤45 days) and *screenshot-provable* is
**empty, and it misses by two days**: the newest provable Approved data centre is Memphis
`COM-ADD-26-000022` (ZIP 38116, "ADD PEMB & Foundation additions and **Data Hall** structures
only"), filed **2026-07-30** — 47 days old against `RECENCY_DAYS = 45`.

**No gate was weakened to manufacture a candidate.** A quiet queue is valid, and this one
self-resolves as the geography build catches up.

---

## 6. Approval gate — measured truth table

Run through the functions lifted out of `acquisition.html`:

| scenario | result |
|---|---|
| theme post, **no capture** (today's real state) | **BLOCKED** |
| theme post, capture exists but has **not rendered** | **BLOCKED** |
| theme post, capture exists **and** rendered | approvable |
| **non-theme** MAPS post, no capture | approvable *(unchanged)* |

The stricter rule is scoped to the theme on purpose: an ordinary MAPS draft still publishes
honestly as a link card carrying the destination's own OpenGraph image, but a post whose hook
asks about a data centre must not ship a picture showing none.

---

## 7. The capture state, measured in a real browser

`?embed=1` is a **shipped product mode**, not a screenshot hack — the Place page already uses it
to host Map 1 in an iframe. Measured at 1200×630 with Leaflet served locally
(`test/maps-datacenter-capture-state.browser.test.mjs`, 23 checks):

* `.card.mapcard` is **exactly 1200×630**, document overflow **0**;
* STATUS / PROJECT TYPE / REGULATORY RECORDS / the map key / **309 px of map** all in frame;
* the card header names the place and ZIP — *"Development across Kansas City (64155) · nearby
  facilities for context"*;
* global sidebar and address search form **absent**;
* the Data center control ends **selected**, every other type **deselected**, applied through a
  `change` event on the page's own checkbox;
* the target's own popup opens and names the project;
* **counterfactual:** full-page Map 1 still has its 600 px frame.

🔑 **A comment in the first draft of the generator was false, and this test is what caught it.**
It claimed that finding the project in `window.siteMarkers` after filtering proved bucket
membership. It proves nothing: `applyFilter()` keeps every marker in that array and only adds or
removes it from the Leaflet layer group. Measured — the Residential control **stays in the array
and leaves the map**. The generator now asserts `m._map`, which is what "on the map" means.

---

## 8. Accessibility (§20) — verified, and it is a platform limit

The MAPS screenshot publishes as an **external link-card thumbnail**
(`bluesky/publish-worker.mjs`):

```js
record.embed = { $type: 'app.bsky.embed.external',
  external: { uri, title, description, ...(thumb ? { thumb } : {}) } };
```

`app.bsky.embed.external#external` has **no `alt` field**. The contrast is in this same repo:
`scripts/post-draft-bluesky.js` uses `app.bsky.embed.images` with `images: [{ alt, image, … }]`,
which **does** carry alt text.

* **The published thumb therefore has no ALT text.** That is the AT Protocol lexicon, not a
  HomeSignal choice.
* The card's `title` and `description` are real text and are accessible.
* **No fake ALT field was added** to Acquisition. The preview `img.alt=''` is marked decorative,
  which is honest for a preview.
* **This unit introduces no regression** — a theme post uses the same embed as every other MAPS
  post. Moving the screenshot to an `images` embed would gain alt text but lose the link card,
  and that is a founder decision outside this unit.

---

## 9. Unchanged, and asserted

`content_family='MAPS'` · `tile='development'` · dedupe identity
`source_key|source_seq|status|submitted_at` (pinned by exact composition) ·
`utm_source=bluesky&utm_medium=social&utm_campaign=maps` · Approve / Edit / Skip · source
verification · the 300-grapheme readout · ALERTS, Government Notices and Upcoming Meetings ·
the publisher · image storage · RLS.

**Schema changes: NONE.**
