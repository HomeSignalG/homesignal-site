# Accuracy audit — data residents see, 2026-08-07

**Scope attempted:** all 12,722 cached pages, all 183 registry entries.
**Anchored on production** (`development_reports.sites` and `app_projects`) plus the shipped
`jurisdiction-registry.json`. **Nothing was fixed.** Every finding carries a count and an example.

> ⚠️ **Read the coverage section (§C) before treating this as a clean bill of health.** Six of the
> twelve requested check classes were completed exhaustively; **four were not run at all**, and two
> were run structurally rather than against the live endpoint. Saying which is the point — an audit
> whose own coverage is invisible is the failure mode it exists to catch.

---

## A. FINDINGS, ranked by how many residents see the error

### A1 🔴 `nyc-dob-permit-issuance` — 82.7% of records fall outside their own declared window · **202 pages**

The entry declares `recency_days: 365`. **12,489 of 15,099 records are older than that**, reaching
back to **1989-05-18**. A resident on a New York page sees permits filed 37 years ago presented in
the same list as this month's filings.

This is the largest single accuracy defect found. It is almost certainly a side-effect of the
`recency_expr` escape hatch added 2026-08-02 for this entry's MM/DD/YYYY *text* dates: that fix made
the entry place records at all (it had placed **zero** before), but the window is not being enforced
on the values it now returns.

### A2 🔴 Impossible and epoch dates — records stamped with a date that cannot be real

| entry | pages | defect | example |
|---|---:|---|---|
| `sheridan-county-building-permits` | 12 | **ALL 6,492 records dated `1970-01-01`** — the Unix epoch, i.e. every date is null and rendering as zero | oldest = newest = 1970-01-01 |
| `champaign-il-special-use-permits` | 10 | newest is **`9999-09-09`**; oldest `1899-12-30`; 6 future-dated | 9999-09-09 |
| `brunswick-county-permits` | 14 | newest **`2099-02-12`** | 3 records dated past 2099 |
| `boone-county-ky-planning-board-actions` | 16 | oldest `1899-12-30` — the Excel/OLE epoch zero | 1899-12-30 |
| `weld-county-site-plan-review` | 11 | oldest `1899-12-30` | 1899-12-30 |
| `denton-county-dev-permits` | 28 | oldest `1900-01-01` | 1900-01-01 |

`1970-01-01` (Unix zero) and `1899-12-30` (Excel zero) are the two classic "null became a date"
signatures. **Sheridan is the severe case: not some records, all of them.**

### A3 🟠 76,648 records carry NO date at all, yet render as development

Ten entries emit records with `submitted_at` null on every row:

| entry | records | pages |
|---|---:|---:|
| `loudoun-county-residential-permits` | 45,618 | 18 |
| `virginia-beach-building-permits` | 14,109 | 9 |
| `delaware-county-pa-subdivisions-land-developments` | 5,243 | 40 |
| `colorado-springs-planning-applications` | 3,702 | 29 |
| `nvdot-project-boundaries` | 2,928 | 139 |
| `hdot-active-design-projects` | 1,848 | 85 |
| `akdot-stip-24-27` | 909 | 28 |
| `anaheim-land-use-cases` | 796 | 7 |
| `fort-collins-building-permits` | 810 | 5 |
| `adot-tip-fy2026-2030` | 685 | 181 |

Undated is not automatically wrong — a programme entry legitimately may have no filing date. It is
listed because the page presents these beside dated records without distinguishing them.

### A4 🟠 Future-dated PERMITS (distinct from future-dated programmes)

DOT programme entries are *expected* to carry future dates (a STIP is a plan): `mdot-stip` 5,467 ·
`ctdot` 2,308 · `wisdot` 1,785 · `wsdot-proposed` 731/731 · `fdot` 445 · `vtrans` 398 ·
`maine-dot` 243. **Those are correct and are not findings.**

These are permits, where a future filing date is not explicable the same way:

| entry | future-dated | pages | newest |
|---|---:|---:|---|
| `bentonville-catalyst-permits` | **1,427** | 11 | 2026-12-06 |
| `lexington-row-permits` | 258 | 16 | 2026-10-05 |
| `columbia-mo-capital-projects` | 180 | 6 | 2029-10-01 |
| `lee-county-fl-development-orders` | 8 | 35 | 2027-09-20 |
| `new-hanover-county-building-permits` | 2 | 10 | 2027-06-15 |

### A5 🟠 Coordinate stacking — the centroid-collapse signature

Records sharing a coordinate to 5 decimal places (~1 m) on the same page. Multiple permits at one
address is legitimate; **a large fraction of an entry stacking is the tell that coordinates are not
per-record.**

| entry | % of records stacked | worst single stack | pages |
|---|---:|---:|---:|
| `akdot-stip-24-27` | **89.4%** | 153 | 28 |
| `brunswick-county-permits` | **82.7%** | 107 | 14 |
| `slo-county-planning-permits` | 51.7% | 59 | 26 |
| `new-hanover-county-building-permits` | 50.1% | 273 | 10 |
| `prince-georges-county-permits` | 45.0% | 63 | 29 |
| `virginia-beach-building-permits` | 40.6% | 345 | 9 |
| `loudoun-county-residential-permits` | 18.5% | **425** | 18 |

**425 records on one coordinate** (Loudoun) is the worst point. Whether each stack is a real
apartment complex or a fabricated centroid needs a per-entry live check — **not done this pass**
(§C).

### A6 🟡 `brunswick-county-permits` — `case_number` is mapped to a TYPE CODE, not a case id

**132 distinct `case_number` values across 154,943 records**, and the values are category codes:
`1000` → every title begins "Commercial", `1002`/`1003` → "Residential".

Worked example, ZIP 28461 — two records, same `case_number` `1002`, same address, coordinates **8 mm
apart**:

```
cn=1002  "Residential 929 E LEONARD ST 28461 UNIT 1"   lat 33.93571424563209
cn=1002  "Residential 929 E LEONARD ST 28461"          lat 33.93571417430067
```

Two pins on one building. Whether that is one permit rendered twice or a genuine main+unit pair is
**not resolvable from the data we store** — which is the point: with `case_number` carrying a type
code, the field that should settle it cannot.

### A7 🟡 89 true duplicate rows (shards 0–1)

On a title+case+date+coordinate identity: **89 duplicate groups, 89 excess rows out of 301,946
scanned (0.03%)**. They are invisible to the engine's `dedupeExactPermits` because they differ in
`label`, `record_url` or `bucket` — i.e. the same filing carried under two lifecycle stages.

---

## B. METHODOLOGICAL FINDING — `app_projects` cannot answer the duplicate question

`app_projects` has **no `case_number` column**, and its `source_ref` is the **service URL**, constant
for every record in an entry (Brunswick: 154,943 rows, 1 distinct `source_ref`). So a duplicate check
run against the materialized table is forced onto title+date+coords, which **cannot distinguish a
true duplicate from the documented-legitimate same-title/different-case pattern** (the Mesa 85234
precedent: 27 same-title records that are 27 real cases).

My own first pass made exactly that error and produced **89,245 "excess rows" for Brunswick**. Tested
correctly against `development_reports.sites` on the full engine identity, Brunswick has **0 true
duplicates across all 154,943 rows**. The 89,245 was an artefact of the dropped field.

**Any future duplicate audit must run against `development_reports.sites`, not `app_projects`.**

---

## C. AUDIT COVERAGE — what was checked, what was found clean, what was NOT run

### Completed exhaustively (all 183 entries / all 12,722 pages)

| check | result |
|---|---|
| Orphan `source_registry_id` in cache with no registry entry | **0** — 175 entries with records, all present in the registry; 8 registry entries dormant with 0 records |
| Records outside the entry's declared window | **1 material violation** (A1) + 15 entries with 1–375 rows of 1–2 day boundary drift, which is refresh timing, not config |
| Impossible / epoch / future dates | A2, A4 |
| Undated records | A3 |
| Coverage claim vs where records land | **CLEAN.** Only 4 entries land in more than one state, and **all four declare it**: `chicago-building-permits` (IL+IN Lake), `boone-county-ky` (KY+OH Hamilton), `kent-county-de` (DE+MD Queen Anne's), `new-castle-county` (DE+PA Delaware/Chester) |
| Coordinate stacking | A5 |

### Run, but structurally rather than against the live endpoint

- **`record_url` resolution.** Checked that no entry claiming `record_url_precision: "record"` serves
  a single shared URL — **0 found** across shards 0/2/6/9. **This is a structural check only. No HTTP
  probe was made this pass**, so a URL that resolves to a 404 or a generic shell would not appear
  here. The Champaign `G:\` defect and the SPA-shell trap were both found by *fetching*; that was not
  repeated across 183 entries.
- **Duplicates.** Full-identity test run on shards 0–1 and on Brunswick (shard 2) only — not all 10
  ZIP prefixes.

### ⚠️ NOT RUN — four requested check classes, none of them attempted

1. **Is `type_source` the publisher's land-use field or a process/workflow field?** (the DeKalb /
   Overland Park class). Needs a live field list plus a judgment call per entry, ×140 entries with a
   `type_map`. **Not started.**
2. **Does `status_to_bucket` reflect the real lifecycle?** (the Prince George's class, where four
   legible values summing exactly to the row count were entirely wrong). Needs a live
   status × decision-date crosstab per entry, ×183. **Not started.**
3. **Does any status assert an event that has not happened?** (the WSDOT class). Detectable only via
   the same crosstab. **Not started.**
4. **Dead `type_map` / `status_to_bucket` keys** — mapped values absent from the live vocabulary, the
   tell for a mapping drafted from assumption. Needs a live vocabulary pull per entry, ×183.
   **Not started.**

Also not run: **pages marked covered while empty, or honest-empty while records exist.**

**These four are where the two worst historical defects (DeKalb, Prince George's) actually lived.**
Nothing in this document should be read as evidence they are clean — they were not examined. Each
needs roughly 183 live probes and is a separate pass.

---

# ROUND 2 (2026-08-08) — FDOT, the national distinct-URL check, and the national future-date check

## D1. FDOT — one confirmed defect, one premise that does not hold

**Confirmed exactly as reported:** `fdot-active-construction-projects` = **4,394 records, 357 pages,
`count(DISTINCT source_ref) = 1`**, `submitted_at` spanning **2009-03-03 → 2029-01-23**.

### ❌ The record_url ruling does not apply — FDOT already declares `dataset`

The instruction was to *"demote `record_url_precision` to whatever the true precision is — one URL
for 4,394 records is 'agency', not 'record'."* **The entry already declares
`"record_url_precision": "dataset"`.** One shared URL is exactly what `dataset` means, so the config
is already honest and there is nothing to demote. No fix required, and none should be made.

### ✅ CONFIRMED DEFECT — `file_date` is mapped to `StartDate`, a scheduled date

`"file_date": "StartDate"` in the shipped `column_map`. **445 of 4,394 records (10.1%) carry a
`submitted_at` in the future, out to 2029-01-23, on 113 pages.**

**A filing or issue date cannot be in the future.** That alone proves `StartDate` is a *scheduled
construction start*, not a filing date — the WSDOT class — and it is provable from production data
without reaching the live layer (the FDOT endpoint did not answer through pg_net this pass, so the
field-list confirmation is **not obtained**; the config mapping and the future dates are the
evidence).

**Two compounding stamps on the same entry, both affecting all 4,394 records on all 357 pages:**
- `"status_const": "approved"` — every record is stamped approved regardless of real state.
- `"use_type_const": "Utility"` — every record is typed Utility regardless of real type.

So a resident on any of 113 Florida pages can see a project stamped **approved**, typed
**Utility**, dated **2029** — a construction start that has not happened, presented with a date that
reads as a filing.

**Correction to my own Round-1 audit:** §A4 listed FDOT among the DOT programmes whose future dates
are "correct and not findings." That was wrong for this entry — not because future dates are
inherently wrong for a programme, but because the future value is landing in `file_date`, the field
the page presents as when the thing was filed.

⚠️ `recency_days` is **null** for FDOT, so there is no declared window to violate. The Round-2
premise that "the window declaration is meaningless too" does not apply — there is no window
declaration.

## D2. National distinct-URL check — **CLEAN across all 22 record-precision entries**

Run as directed, per `registry_id`: `count(DISTINCT source_ref)` against `count(*)`.

**First, why the raw ratio is not the test.** `app_projects.source_ref` is the **service URL**,
constant per entry for **142 of 175** entries — including entries that are entirely correct. Run
unqualified, the check flags 81% of the registry. It only discriminates when combined with the
**declared** precision, which is how it was run here.

**Result: 21 live entries claim `record_url_precision: "record"` (the 22nd, `austin-issued-construction-permits`, is dormant with 0 records). NONE has a ratio near 1/N.**

| lowest ratios | records | distinct URLs | ratio |
|---|---:|---:|---:|
| `austin-zoning-cases` | 55,928 | 4,958 | 0.089 |
| `charlotte-land-dev-commercial-projects` | 19,853 | 1,762 | 0.089 |
| `tucson-residential-building-permits` | 11,849 | 2,283 | 0.193 |

Low ratios here are the **overlapping-ZIP-circle effect** (one record cached on several pages), not
a shared URL. Five entries sit at a perfect **1.0000** (`fort-collins`, `tucson-commercial`,
`austin-site-plan-cases`, `slc-planning-petitions`, `austin-subdivision-cases`).

**So this check would NOT have caught FDOT** — FDOT declares `dataset`, correctly, and never appears
in the candidate set. It also would not have caught the Champaign `G:\` defect, which was a
record-precision entry whose URLs were *distinct* and *unopenable*. **Distinctness and resolvability
are different properties**; only fetching tests the second.

## D3. National future-date check — **13,285 records · 20 entries · 1,436 pages (11.3% of all pages)**

Split by whether a future date is explicable:

**Programme entries — future dates are CORRECT, not findings** (a STIP/6-year plan is a schedule):
`mdot-stip` 5,467 (73.8%) · `ctdot` 2,308 · `wisdot` 1,785 (98.0%) · `wsdot-proposed` 731 (100%) ·
`vtrans` 398 (96.1%) · `maine-dot` 243 (54.7%) · `mdot-sha` 25 · `columbia-mo-capital` 180.

**⚠️ FDOT is the exception among programmes** — see D1. Its future value lands in `file_date`, and it
is stamped `approved`, so it reads as a filed, approved project rather than a schedule.

**Permit entries — a future filing date is NOT explicable:**

| entry | future | of total | pages | furthest |
|---|---:|---:|---:|---|
| `bentonville-catalyst-permits` | **1,427** | 31,632 | 9 | 2026-12-06 |
| `lexington-row-permits` | 251 | 8,815 | 14 | 2026-10-05 |
| `lee-county-fl-development-orders` | 8 | 4,851 | 2 | 2027-09-20 |
| `champaign-il-special-use-permits` | 6 | 255 | 6 | **9999-09-09** |
| `brunswick-county-permits` | 3 | 155,316 | 3 | **2099-02-12** |
| `bend-or-permit-applications` | 2 | 7,974 | 2 | **2033-10-20** |
| `new-hanover-county-building-permits` | 2 | 37,234 | 2 | 2027-06-15 |
| `murfreesboro` · `thurston` · `summit-county-oh` · `columbia-mo-permits` | 1 each | — | 1 each | — |

## D4. Anne Arundel — **NOT closed; both entries are live**

Reported as *"returns 0 rows in app_projects — the retirement already took effect."* Measured:

| entry | records | pages |
|---|---:|---:|
| `anne-arundel-subdivision-activity` | **7,148** | 37 |
| `anne-arundel-commercial-site-plans` | **3,544** | 37 |

Neither is retired and neither returns 0. No Anne Arundel finding was raised in Round 1, so there
was nothing to close — but the entries should not be recorded as retired, because they are serving
10,692 records on 37 pages today. (`subdivision-activity` carries records back to **1989-03-29** and
1,999 undated rows; `commercial-site-plans` back to **2000-05-23** with 1,177 undated — both already
counted in §A3.)

---

# ROUND 3 (2026-08-08) — three corrections, the owed 183-entry scan, and the UI label answer

## E1. Three ruled items do not match production. Measured in BOTH surfaces this time.

| claim | measured `app_projects` | measured `development_reports.sites` |
|---|---|---|
| *"Delaware County DOES NOT APPEAR in app_projects — its 74,957 future records are in development_reports only"* | **appears: 5,243 records / 40 pages · 0 future · 5,243 undated** | **5,243 rows · 0 future · 5,243 undated** |
| *"Anne Arundel is closed — 0 rows, retirement already took effect"* | `subdivision-activity` **7,148 / 37 pages**, `commercial-site-plans` **3,544 / 37 pages** | 7,148 and 3,544 |
| *"champaign 9999 … plus CTDOT's 1900"* | CTDOT oldest = **1998-09-16** | oldest = **1998-09-16** |

- **Delaware County has no future records in either surface, and no `74,957` anywhere.** The entry
  maps **no `file_date` at all** (`"file_date": null`, `status_const: "Submitted for county review"`),
  which is why all 5,243 rows are undated. **The ruling "filter to bid dates at or before today"
  has nothing to operate on** — there are no bid dates. It cannot be executed as written.
- **Anne Arundel is live**, second measurement. 10,692 records on 37 pages. Not retired.
- **CTDOT has no 1900 sentinel.**

## E2. Class 2 splits — one is a real defect, the other is Class 1

| entry | `file_date` mapped to | verdict |
|---|---|---|
| `bentonville-catalyst-permits` | **`ISSUED`** | ⚠️ **REAL DEFECT (Class 2).** An issue date cannot be in the future, yet 1,427 of 31,632 records are, out to 2026-12-06 on 9 pages. Either the publisher emits future ISSUED values or the column carries something else. **Needs a live probe of the source to tell which — not done.** |
| `lexington-row-permits` | **`EstimatedStartDate`** | ✅ **RECLASSIFY to Class 1.** The column is explicitly an *estimated start*. The 251 future records are the field working correctly in the wrong slot — identical to FDOT's `StartDate`, not a permit ledger with impossible dates. |

## E3. Class 1 — what the UI actually renders (and it is not "submitted")

**The development record card renders a bare, unlabelled date.** `homesignalmap.html:2228`:

```js
"<div class='fdate'>" + esc(s.start_date ? fmtDate(s.start_date) : (s.status_text||"")) + "</div>"
```

`fmtDate` emits `"Jul 5, 2026"` — no "Submitted", no "Filed", no qualifier of any kind.

**So the stated concern — *"a resident reading 'submitted' against a 2042 date"* — is not what the
page shows.** The word does not appear beside the date. ⚠️ **The underlying problem is real but is
mislabelling by OMISSION:** there is exactly one date slot and no semantic label, so a 2042 scheduled
start and a 2026 filing date occupy the identical position with nothing to distinguish them. The UI
**cannot** tell them apart, because it was never given the meaning to render.

One place does frame records as filed: page copy at line 440, *"Filed with a specific address in
this ZIP"*.

✅ **A countdown risk was checked and does NOT exist.** `friendlyDeadline()` (which renders
*"closes in N days"*) is driven by **`s.meeting_date`**, not the permit date — `homesignalmap.html:1532`.
A 2042 DOT date cannot surface as a deadline countdown.

## E4. The owed scan — ALL 183 entries, `count(DISTINCT source_ref)` vs `count(*)`

**Complete.** 175 entries carry records; **33 have more than one distinct URL, 142 have exactly one.**

- **No entry declaring `record_url_precision: "record"` appears among the 142.** The lowest
  distinct-URL count among record-precision entries is 30. **0 defects of the ruled class.**
- ⚠️ **NEW FINDING — five entries UNDER-claim their precision.** They serve genuinely per-record
  URLs but declare no precision at all:

| entry | records | distinct URLs | ratio | declared |
|---|---:|---:|---:|---|
| `columbus-building-permits` | 14,497 | 14,497 | **1.0000** | unset |
| `seattle-building-permits` | 5,836 | 5,836 | **1.0000** | unset |
| `tacoma-accela-permits` | 5,245 | 5,245 | **1.0000** | unset |
| `seattle-land-use-permits` | 326 | 326 | **1.0000** | unset |
| `cincinnati-building-permits` | 2,965 | 2,876 | 0.9700 | unset |

Harmless to residents — the links work — but the precision field misdescribes them, which is the
same class of drift in the opposite direction.

## E5. FDOT precision — still nothing to fix

Re-ruled as *"fix the precision as ruled."* The entry declares `"record_url_precision": "dataset"`,
which is correct for one shared URL. **There is no incorrect precision claim to fix.** FDOT's real
defect remains the `StartDate` → `file_date` mapping (§D1), and its 445 future records do belong in
Class 1 — as now does `lexington-row-permits`.

---

# ROUND 4 (2026-08-08) — Bentonville probed, Anne Arundel restated, and the date-semantics scope

## F1. Bentonville — probed live. **It is a SENTINEL, not a mapping error. Class 2 is now empty.**

Live probe of `.../Catalyst_Planning/FeatureServer/1`:

| probe | result |
|---|---:|
| rows in layer | **50,551** |
| `ISSUED > CURRENT_TIMESTAMP` | **444** |

**The publisher does emit future `ISSUED` values — so the column mapping is correct and this is not
our defect.** But the five furthest rows answer the question properly:

```
2026-12-06 | ISSUED  | FLOODPLAIN DEVELOPMENT
2026-12-06 | FINALED | ELECTRIC RESIDENTIAL      ← finaled, yet "issued" in the future
2026-12-06 | ISSUED  | NEW RESIDENTIAL
2026-12-06 | ISSUED  | RIGHT OF WAY
2026-12-06 | ISSUED  | FLOODPLAIN DEVELOPMENT
```

**All of them carry the identical date `2026-12-06`, across four unrelated permit types, and one is
already `FINALED`.** A permit that has been finaled cannot be issued in the future. A single shared
date spanning unrelated types is a **placeholder**, not genuine future issuance.

**Verdict: Bentonville is Class 3 (sentinel)** — the same family as champaign `9999-09-09` and
brunswick `2099-02-12`, just less obviously absurd because the value is plausible-looking. Mechanical
exclusion at source, as ruled for Class 3.

⚖️ **This leaves CLASS 2 EMPTY.** Both original members moved: `lexington` → Class 1
(`EstimatedStartDate`), `bentonville` → Class 3 (sentinel). **No permit ledger in the registry has a
genuine impossible-filing-date defect of our making.**

*(Cache/source reconciliation: 444 source rows → 1,427 cached records across 9 pages, ≈3.2×, which is
the documented 3-mile-circle overlap.)*

## F2. Anne Arundel — the actual defect, restated from scratch

Both entries map **`"file_date": null`** — no filing date is configured at all. Confirmed in the
cache: **0 of 10,692 rows carry a `file_date`.**

But `app_projects.submitted_at` is populated, and it matches `sites.decision_date` **exactly at both
ends**:

| | `sites.decision_date` | `app_projects.submitted_at` |
|---|---|---|
| `subdivision-activity` (7,148) | 1989-03-29 → 2026-03-10 | **1989-03-29 → 2026-03-10** |
| `commercial-site-plans` (3,544) | 2000-05-23 → 2026-01-14 | **2000-05-23 → 2026-01-14** |

**So the materializer fills the filing slot from the DECISION date.** A resident sees the date a case
was *decided* rendered in the position that reads as when it was *filed* — **10,692 records across 37
pages**, with dates as old as 1989.

**This is the same defect as FDOT's `StartDate`, arriving by a different route:** FDOT puts the wrong
date in `file_date` by config; Anne Arundel has no `file_date` and the materializer substitutes
`decision_date`. Coverage: `decision_date` is populated on 5,149 / 2,367 rows, so the remainder are
undated.

⚠️ **This substitution is invisible in the registry.** Nothing in the entry declares it — it happens
in the materializer. Any audit reading only config would call these entries undated and clean.

## F3. SCOPE — declare what a date MEANS (reporting before building, as ruled)

**The problem, sized.** One unlabelled `.fdate` slot currently carries at least four different
meanings: **filed** (most permit ledgers), **issued** (`bentonville` ISSUED), **scheduled/estimated
start** (`fdot` StartDate, `lexington` EstimatedStartDate), and **decided** (`anne-arundel`, via the
materializer). Measured exposure for the non-filing meanings alone:

| meaning | entries | records | pages |
|---|---|---:|---:|
| scheduled / programme | mdot-stip, ctdot, wisdot, wsdot×3, vtrans, maine-dot, fdot, mdot-sha, columbia-mo-capital, lexington | **~12,000 future-dated of a much larger dated set** | 300+ |
| decided | anne-arundel ×2 | 10,692 | 37 |
| issued | bentonville | 31,632 | 11 |

**Proposed shape — three additive pieces, no data change:**

1. **Registry declares the meaning.** One new optional field per entry, e.g.
   `"file_date_kind": "filed" | "issued" | "scheduled" | "estimated" | "decided"`. Defaults to
   `"filed"` when absent, which is what the overwhelming majority already are, so **no entry needs
   editing to keep today's behaviour**.
2. **Engine passes it through** onto the site object (one field alongside `file_date`), and the
   materializer stamps it — including stamping `"decided"` where it substitutes `decision_date`,
   which is the only way that substitution becomes visible.
3. **Page renders the label** — `.fdate` becomes `"Filed Jul 5, 2026"` / `"Scheduled Jan 2029"` /
   `"Decided Mar 2026"`.

**Cost and risk.** Piece 1 is config; pieces 2 and 3 are engine + page code, so **gated**. It changes
what every resident sees on every development record, which argues for shipping the label behind the
default (`filed`) first and correcting the ~15 non-filing entries in a second pass, so no page
changes meaning until its entry is explicitly classified.

**Recommended order:** (a) add the field with the `filed` default and stamp it, changing nothing
visible; (b) classify the ~15 known non-filing entries; (c) turn on rendering. Each step is
independently revertible; only (c) alters what residents read.

## F4. §C's four unrun classes — status

**Not started.** One partial result arrived incidentally: `bentonville-catalyst-permits` maps
**`"APPROVED"` → `proposed`** while `"ISSUED"` → `approved`. That is defensible (plan-approved
precedes permit-issued), but it means a permit whose literal status reads `APPROVED` displays as
**proposed**. Flagged, not adjudicated — it is exactly the §C class-2 shape and needs the full
status × decision-date crosstab across all 183 entries rather than a single opportunistic look.

---

# Round 5 — CONFIG vs TABLE: what the registry declares against what `app_projects` contains

**Ruling that ordered this pass (2026-08-08):** *"Every accuracy check in this audit has read config…
Before §C, run one pass comparing what the registry DECLARES against what `app_projects` actually
CONTAINS, per entry: which fields are populated in the table but null or absent in config, and which
are declared but empty in the table. Report every divergence. That is one query shape and it answers
whether Anne Arundel is unique or the first of several. State it plainly in the audit doc either
way."*

## G0. Stating it plainly: what Rounds 1–4 actually read

Rounds 1–4 mixed two instruments and did not label which was which. **§A1/§A2/§A3/§A5/§A6 read the
`development_reports.sites` cache** (real per-record values). **§D1/§D2/§E2/§E4 read
`jurisdiction-registry.json` only** — they establish what an entry *declares*, and they cannot
establish what a resident sees. §F2 (Anne Arundel) was the first check to compare the two, and it
found a defect that config alone could not show. This round is that comparison run over **all 183
entries**.

**Instrument scope, so its silence is legible.** The pass reads
`public.app_projects where record_kind = 'development'` — **2,826,146 rows across 175 distinct
`registry_id` values** (positive control: 175 of the registry's 183 entries appear; the other 8 are
dormant, listed in G4). Facility rows (`record_kind='facility'`, 217,761) are excluded because their
`registry_id` is the EPA FRS per-facility id, not a jurisdiction entry — an ungrouped query over the
whole table returns 114,902 distinct values and answers a different question.

## G1. Divergence A — populated in the table, NOT declared in config

The materializer's date expression, quoted verbatim from the live `app_refresh_zip` definition
(`pg_get_functiondef`):

```
coalesce(el->>'file_date', el->>'decision_date')  →  app_projects.submitted_at
```

**So any record with no filing date silently renders its DECISION date in the filing slot.** This is
systemic in the materializer, not an entry-level mistake — and it is invisible to every config-only
check.

Measured cache-wide over all ten ZIP shards (`left(zip,1)` = 0-9, so coverage is complete and the
per-shard ZIP sets are disjoint), counting sites with **no `file_date` and a non-empty
`decision_date`**:

| entry | records substituted | pages | declares `file_date`? |
|---|---:|---:|---|
| `dallas-specific-use-permits` | **30,975** | **164** | no — declares `decision_date: EFFECTIVEDATE` only |
| `anne-arundel-subdivision-activity` | 5,149 | 37 | no — `decision_date: FN_APV_DT` |
| `anne-arundel-commercial-site-plans` | 2,367 | 37 | no — `decision_date: FN_APV_DT` |
| `fdot-active-construction-projects` | 577 | 160 | yes (`StartDate`) — these rows lack it |
| `austin-subdivision-cases` | 19 | 10 | yes |
| `denton-county-dev-permits` | 7 | 6 | yes |
| `austin-site-plan-cases` | 6 | 6 | yes |
| `charlotte-land-dev-commercial-projects` | 5 | 5 | yes |
| `columbia-mo-capital-projects` | 5 | 5 | yes |
| **total** | **39,110** | **390 distinct pages** | |

**Answer to the question the ruling posed: Anne Arundel is NOT unique — and it is not even the
largest case.** `dallas-specific-use-permits` is the same defect at **2.9× the record count and 4.4×
the page count**, and it was not visible in any prior round. Cache receipt for Dallas, over the ZIPs
it appears on: `has_file_date 0 · has_decision_date 401 · decision range 2009-03-27 → 2026-05-27`.

The five small entries (577 / 19 / 7 / 6 / 5 / 5) are a *different* shape: they declare a filing date
and it is simply missing on a minority of rows, which then fall through to the decision date. Same
visible consequence, per-row rather than per-entry.

## G2. Divergence B — declared in config, ZERO in the table (the mapping never fires)

Three entries declare a `file_date` column that produces a value on **no row anywhere**. This is the
Burlington `out_fields` failure shape: config that looks complete, passes every unit test, and
silently yields nothing.

| entry | declares `column_map.file_date` | rows | dated | pages |
|---|---|---:|---:|---:|
| `loudoun-county-residential-permits` | `YEAR_ISSUED` | 45,618 | **0** | 18 |
| `virginia-beach-building-permits` | `IssueDate` | 14,109 | **0** | 9 |
| `anaheim-land-use-cases` | `Application_Received` | 796 | **0** | 7 |
| **total** | | **60,523** | **0** | **~32** |

These are **new findings** — not reported in Rounds 1–4, and not reachable from config, which reads
as correct in all three. Every one of those 60,523 records renders with no date at all.

The seven entries that declare no `file_date` **and** carry no dates are consistent, not divergent:
`adot-tip-fy2026-2030`, `akdot-stip-24-27`, `colorado-springs-planning-applications`,
`delaware-county-pa-subdivisions-land-developments`, `fort-collins-building-permits`,
`hdot-active-design-projects`, `nvdot-project-boundaries`. They declare nothing and produce nothing.

## G3. Divergence C — records that can never render as a pin

| entry | rows | with coordinates | pages |
|---|---:|---:|---:|
| `little-rock-permits` | 48,951 | **0** | 14 |
| `bozeman-building-permits` | 933 | **0** | 2 |

**49,884 records on 16 pages carry no lat/lng at all** — they list, but the 2D / satellite / focus
views cannot place them. Also new; no prior round measured coordinate presence per entry.

Partial coordinate loss (records present, some unplaceable):

| entry | rows | missing coords | share |
|---|---:|---:|---:|
| `gilbert-energov-permits` | 1,036 | 284 | 27.4% |
| `overland-park-building-permits` | 159,401 | 8,233 | 5.2% |
| `san-marcos-planning-cases` | 318 | 6 | 1.9% |
| `wisdot-highway-program-6yr` | 1,822 | 4 | 0.2% |
| `hdot-active-design-projects` | 1,848 | 15 | 0.8% |
| `bellevue-permits` | 348 | 2 | 0.6% |
| `anne-arundel-commercial-site-plans` | 3,544 | 2 | 0.1% |
| `adot-tip-fy2026-2030` | 685 | 1 | 0.1% |

## G4. Divergence D — declared entries with no rows at all (dormant)

Eight of the 183 entries produce zero rows in `app_projects`:
`austin-issued-construction-permits`, `harris-county-permits`, `harris-county-plats`,
`houston-plat-applications`, `montgomery-county-commercial-permits`,
`montgomery-county-demolition-permits`, `san-antonio-prelim-plan-review`,
`shelby-county-building-permits`. This matches the WIRED table in `docs/source-inventory.md`
(175 with records / 8 dormant) and the Harris/Houston pair is the already-recorded
"correctly wired, no modelled ZIP surface" case. Positive control on the same query:
`phoenix-building-permits` 95,614 and `austin-subdivision-cases` 4,515 both return non-zero.

## G5. What came back CLEAN in this pass

- **`status` and `type` are populated on 100% of all 2,826,146 development rows** — every entry, no
  exceptions. There is no entry whose status or use-type silently vanishes in materialization.
- **No entry has rows in the table without a `registry_id`** except five records on ZIP 78617, which
  are the TX TDLR/TABS filings (`tdlr.texas.gov/TABS/…`). TABS is not a registry-driven source, so a
  null `registry_id` there is correct, not a gap.
- The remaining 163 entries show `dated = rows` and `coords = rows` (or within the small margins in
  G3), i.e. config and table agree.

## G6. What this round does NOT cover

It compares **presence**, not **correctness**: it can prove a declared column produced nothing, and
that a value arrived from a field config never named, but it cannot tell whether a populated value is
the *right* one. §A1 (nyc-dob out-of-window), §D1 (FDOT `StartDate`) and §E2 (lexington
`EstimatedStartDate`) are that other class, and §C is still owed.

## G7. Correction to this audit's own denominator: 182 operative entries, not 183

`jurisdiction-registry.json` carries **183 entries across six platform arrays**, but `index.ts`
reads five of them — verbatim, lines 70–78:

```
const SOCRATA_ENTRIES = (… { socrata?: … }).socrata ?? [];
const ARCGIS_ENTRIES  = (… { arcgis?:  … }).arcgis  ?? [];
const CKAN_ENTRIES    = (… { ckan?:    … }).ckan    ?? [];
const CSV_ENTRIES     = (… { csv?:     … }).csv     ?? [];
const CARTO_ENTRIES   = (… { carto?:   … }).carto   ?? [];
```

There is no `opendatasoft` binding and no `opendatasoftForZip()` call; `grep -rni opendatasoft
--include=*.ts` over the function directory returns **zero** hits (the grep is proven live — the same
pattern's `ods` substring matches `index.ts:136`, so it was reading the files). The registry's own
`_opendatasoft_readme` states this outright: *"the connector is NOT BUILT YET — sources/ has no
opendatasoft.ts and index.ts makes no opendatasoftForZip() call, so NOTHING READS THIS ARRAY at
runtime."*

So `shelby-county-building-permits` is dormant **by design**, not by defect — it is staged data
awaiting an additive connector. **Every "183 entries" figure in Rounds 1–4 and in
`docs/source-inventory.md` is a count of declared entries, of which 182 are on a live code path.**
No finding changes; the denominator does.

---

# Round 6 — DATE SEMANTICS, piece (a): SHIPPED (nothing visible changed)

Per the ruling *"build it, in your three pieces, in your order. Default 'filed' first so nothing
changes"* — piece (a) only. Pieces (b) classify and (c) render; neither is done.

**What shipped.**

1. **`FileDateKind` is a declared type** — `"filed" | "issued" | "scheduled" | "estimated" |
   "decided"` (`sources/socrata.ts`), and `file_date_kind` is a required field on
   `NormalizedRecord`, so a connector cannot silently omit it.
2. **All five live connectors stamp it** — `arcgis`, `socrata`, `ckan`, `csv`, `carto` each emit
   `file_date_kind: entry.file_date_kind ?? "filed"` on the same record literal as `file_date`.
   (`opendatasoft` has no connector — §G7 — so there is nothing to stamp.)
3. **The registry gained an optional per-entry `file_date_kind`.** **Zero entries declare one
   yet**, which is the point: every entry keeps today's meaning by default.
4. **The materializer stamps `app_projects.date_kind`** (migration
   `app_projects_date_kind_stamp`; parked SQL `docs/date-kind-migration.sql`). It writes
   `'decided'` where it falls through to `decision_date` — **the only way the §G1 substitution
   becomes visible in the table** — and NULL where the record has no date at all.
5. **Pinned by a new unit test** — `test/file-date-kind.test.mjs`, which also asserts it hasn't
   missed a connector `index.ts` binds, and rejects an off-vocabulary kind. Proven to fail:
   deleting the stamp from one connector makes it exit 1. Suite: **90/90 green.**

**Backfill and the control that proves it.** All 12,722 pages were stamped (set-based for the
three all-substituted entries, re-materialization for the rest — both compute exactly what
`app_refresh_zip` computes). The resulting distribution:

| `date_kind` | records | pages | entries |
|---|---:|---:|---:|
| `filed` | 2,700,721 | 6,344 | 162 |
| *(null — record carries no date)* | 86,723 | 774 | 32 |
| `decided` | **39,110** | **390** | **9** |

**`decided` reproduces §G1's cache-side measurement to the record — 39,110 / 390 / 9, from a
completely different instrument.** §G1 counted sites in `development_reports.sites`; this counts
rows the materializer wrote. They agree exactly, which is the strongest available evidence that
both readings of the substitution are right.

**Nothing a resident sees has changed.** `homesignalmap.html` does not read `date_kind`; the
`.fdate` slot still renders a bare unlabelled date. That is piece (c).

**What piece (b) must now classify** — with §G1 folded in, the non-`filed` set is larger than §F3
estimated. `dallas-specific-use-permits` (30,975 records / 164 pages) was not in the §F3 table and
is the single largest `decided` entry, bigger than Anne Arundel and Bentonville combined.
