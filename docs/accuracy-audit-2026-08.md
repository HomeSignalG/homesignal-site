# Accuracy audit — data residents see, 2026-08-07

**Scope attempted:** all 12,722 cached pages, all 183 registry entries.
**Anchored on production** (`development_reports.sites` and `app_projects`) plus the shipped
`jurisdiction-registry.json`. **Nothing was fixed.** Every finding carries a count and an example.

> ⚠️ **Read the coverage section (§C) before treating this as a clean bill of health.** Six of the
> twelve requested check classes were completed exhaustively; **four were not run at all**, and two
> were run structurally rather than against the live endpoint. Saying which is the point — an audit
> whose own coverage is invisible is the failure mode it exists to catch.

---

# ⭐ HEADLINE FINDING — the undated count conflated "we failed to read" with "there is nothing to read"

**69% of the undated records were never a backlog.** Of **86,749** development records rendering with
no date, **59,895 come from sources that publish no day-granularity date at all.** No refresh, no
config change and no parser fix can recover them, because there is nothing to recover — and
producing a date would mean inventing one, which is the single thing this tracker never does.

| class | records | share | recoverable? |
|---|---:|---:|---|
| **the source publishes no usable date** — 7 entries | **59,895** | **69.0%** | **No. Undated is the correct output.** |
| **programme-milestone dates only** — `hdot-active-design-projects` | 1,848 | 2.1% | Not by a date fix — date-semantics piece (b), `scheduled` |
| **the parser could not read a published format** — 2 entries | 14,905 | 17.2% | **Yes** — the isoDay fix; 10,490 recovered so far |
| **working mapping, minority of source rows blank** — 22 entries | ~10,101 | 11.6% | No. The publisher did not publish those values. |

**The worked case.** `loudoun-county-residential-permits` is 45,618 records — more than half the
total, and the one that looked most like a backlog. Its layer publishes exactly two date-like
fields, both `esriFieldTypeString`, and the live values are `YEAR_ISSUED = "2011"` and
`MONTH_ISSUED = "JUNE"`. A year and a month name. There is no day. Re-cached through the **deployed
post-fix engine** at 13:44:39Z, ZIP 20129 returned 49 Loudoun sites and ZIP 20130 returned 6 — **0
with a `file_date` on either**. That is the correct output, not a gap.

## The control that makes this trustworthy

The proof is not that nothing changed — it is that **a refresh through the FIXED engine changed
nothing, on pages that demonstrably refreshed.** After the 12:58:34Z deploy these entries had pages
re-cached through the new code, and their null counts are byte-identical before and after:

| entry | pages refreshed since deploy | null before | null after |
|---|---:|---:|---:|
| `adot-tip-fy2026-2030` | 7 | 685 | **685** |
| `mdot-sha-project-portal` | 4 | 30 | **30** |
| `dallas-specific-use-permits` | 12 | 3 | **3** |
| `nvdot-project-boundaries` | 2 | 2,928 | **2,928** |
| `fdot-active-construction-projects` | 2 | 25 | **25** |

Meanwhile the two entries the fix targets moved on the same code: `anaheim-land-use-cases`
**796 → 0** (7 of 7 pages), `virginia-beach-building-permits` **14,109 → 4,415** (8 of 9 pages).
Same engine, same run, opposite results — which is what separates "nothing to read" from "failed to
read."

**Every entry in the no-date class carries a POSITIVE receipt** in `docs/source-registry.md`
("source publishes year/month only; undated is correct", and the equivalent for each), so no future
session reads its null count as a queue. That conflation cost two separate investigations.

Full working: §H2, §H3, §H6, §H7.

# ⭐ SECOND HEADLINE — `dallas-specific-use-permits` renders a DECISION date in the filing slot on 164 pages

Separate finding, separate fix path — it belongs with the **date-semantics** work, not with the
undated-records work above.

`app_refresh_zip` fills the resident-facing date from `coalesce(file_date, decision_date)`. Three
entries declare **no** `file_date`, so every one of their records renders the date a case was
*decided* in the position that reads as when it was *filed*:

| entry | records | pages | what the date actually is |
|---|---:|---:|---|
| **`dallas-specific-use-permits`** | **30,975** | **164** | `EFFECTIVEDATE` — cache range 2009-03-27 → 2026-05-27 |
| `anne-arundel-subdivision-activity` | 5,149 | 37 | `FN_APV_DT` (final approval) |
| `anne-arundel-commercial-site-plans` | 2,367 | 37 | `FN_APV_DT` |
| + 6 entries where only a minority of rows fall through | 619 | ~192 | mixed |
| **total** | **39,110** | **390 distinct pages** | |

**Dallas is 2.9× Anne Arundel's record count and 4.4× its page count** — the largest instance by a
wide margin, and it was invisible until the config-vs-table pass, because nothing in the registry
declares the substitution. It is already stamped `date_kind = 'decided'` in production (Round 6), so
the fact is now recorded in the data; what remains is piece (c), rendering the label. Until then a
Dallas resident reads a decision date as a filing date on 164 pages.

Full working: §G1, §F2, §C3.

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

> ⚠️ **SUPERSEDED AND CORRECTED 2026-08-08 — read this before quoting the paragraph above.**
>
> **(a) Three of the four are no longer "not started."** §C, §C6 and §H ran them. Only class 1
> (`type_source` — is it the publisher's land-use field or a workflow field?) remains unrun.
>
> **(b) The class NAMES above are not findings of this audit and must not be cited as such.**
> "The DeKalb / Overland Park class", "the Prince George's class" and "the WSDOT class" were
> shorthand labels, not measured defects in those entries — and the first one is now known to be
> **wrong**:
>
> | entry | what was measured, 2026-08-08 |
> |---|---|
> | `dekalb-county-building-permits` | **correct.** `Closed → operating` (164,424 rows / 59 pages), `Issued → approved` (124,156), `Open → proposed` (1,151). No inversion. |
> | `overland-park-building-permits` | **correct.** `Complete/Finaled` + `TCO → operating` (112,168 / 38 pages), `Issued → approved` (47,234). No inversion. |
> | `prince-georges-county-permits` | a 184-row `status_const` entry — it has no `status_to_bucket` vocabulary at all, so it cannot hold a lifecycle-mapping defect. |
> | `wsdot-project-delivery-plan-*` | appears in this audit only in the §F3 *scheduled-kind* table. No status-vs-date defect was measured in it. |
>
> **The sentence "the two worst historical defects (DeKalb, Prince George's)" is retracted.**
> Neither is a defect in production today. The one real lifecycle inversion found cache-wide was
> `stamford-major-developments` (`Under Construction → operating`, 47 records / 9 pages), now
> fixed. Rule 17 in `docs/maps-go-live-governance.md` cites **only** Stamford and Phoenix — the two
> cases actually measured — and was checked for this: it contains no WSDOT or Prince George's
> reference.

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

---

# §C — STATUS × DECISION-DATE, all 182 operative entries

The pass owed since Round 1. Two instruments, both stated so their silence is legible:
**config** (`status_to_bucket` / `column_map.decision_date` across all 183 declared entries) and
**live data** (`app_projects`, where `stage` holds the VERBATIM source status and `status` holds the
lifecycle word a resident reads — **882 distinct (entry, stage, status) combinations** over 175
entries with records; plus `development_reports.sites` for `decision_date`, read over all ten ZIP
shards so coverage is complete).

## C1. Statuses asserting an event that has not happened — ZERO, and the detector is proven live

Two failure shapes were checked. Both came back empty, and neither zero is a silent one:

| shape | live result | positive control (proves the class exists and the check can see it) |
|---|---|---|
| a **dead** status (denied / withdrawn / void / expired / cancelled / revoked / rejected / refused / abandoned) rendered on a page | **0 records** | **264** such values are declared across the registry — and **all 264 map to `exclude`**, so they can never materialize |
| a **pending / in-review / submitted** status rendered as built or operating | **0 records** | **196** such values are declared: 182 → `proposed`, 10 → `approved`, 4 → `exclude`; **0 → built/operating** |

The 10 pending-family values mapped to `approved` were read individually — every one is a compound
status where approval has already happened and something downstream is outstanding
(`Issued - Amendment Pending`, `CO Pending`, `Pending Inspection`, `Approved, Final Review Pending`,
`05_Construction (Pending)`, …). Two are pre-issuance but post-approval (`Pending Issuance`,
`Pending CC Issuance`). None asserts an unhappened approval.

**This is the cleanest result in the whole audit: the fail-closed status gate is doing its job.**

## C2. The real defect class — an APPROVED or ISSUED record displayed as *Proposed*

The lifecycle bands are `proposed` → `approved` → `built/operating`. Two measurements agree that a
small set of entries land finished-or-approved records in the *first* band.

**(a) The same source word, two different bands.** Of the entries declaring an approval-family
status, **78 map it to `approved`** and **8 to `proposed`**. Four of the eight are defensible —
they qualify the approval as a review step (`Plans Approved`, `Approved for Issuance`,
`Review Approved`, `Revisions Approved`). **Four map the bare, unqualified form:**

| entry | verbatim status | displayed | records | pages |
|---|---|---|---:|---:|
| `missoula-addresses-with-permits` | `Approved` | Proposed | 2,052 | 9 |
| `bentonville-catalyst-permits` | `APPROVED` | Proposed | 45 | 8 |
| `columbia-mo-permits` | `Approved` | Proposed | 24 | 3 |
| `cincinnati-building-permits` | `Approved` | Proposed | 3 | 3 |
| **total** | | | **2,124** | **~23** |

**This resolves the item held from Round 4.** Bentonville's `APPROVED → proposed` is not an
isolated judgment call; it is one of four entries doing the same thing while 78 do the opposite
with the same word. The inconsistency is the finding — a resident comparing two ZIP pages sees the
identical source status in different bands.

**(b) Far larger: records in the `proposed` band that carry a real ISSUE date.** Reading
`sites.decision_date` (which the connector fills from a per-entry column):

| entry | `decision_date` column | proposed records carrying one | pages |
|---|---|---:|---:|
| `phoenix-building-permits` | `PER_ISSUE_DATE` | **43,054** | 77 |
| `baltimore-county-permits` | `ISSDATE` | 375 | 41 |
| `slc-planning-petitions` | `IssuedDate` | 538 | 12 |

Phoenix's `OPEN` (a permit entered and issued, not yet finaled) maps to `proposed`, so **43,054
records on 77 pages read as *Proposed* while carrying the city's own permit-issue date.** By record
count this is 20× the (a) class and the single largest status-semantics exposure found.

## C3. `decision_date` does not always hold a decision — 12 of 59 entries

**59 entries declare `column_map.decision_date`** across 40 distinct column names. Reading the
names against what they are:

| what the column actually records | entries | columns |
|---|---:|---|
| **a status-change timestamp** (when the status last moved — not a decision) | **5** | `StatusDate` (charlotte), `Status_Date` (fort-worth), `record_status_date` (asheville), `status_date` (austin-site-plan-cases, austin-subdivision-cases) |
| **a project END / expiry date** | **7** | `EstEndDate` (fdot), `EstimatedEndDate` (lexington), `project_end_date` (columbia-mo-capital), `COMPLETEDATE` (kcmo-development-cases), `completeDate` (minneapolis-ccs), `End_Date` (lake-county-il), `Expiration` (champaign-il) |
| a genuine decision / issue / approval date | 47 | — |

`decision_date` is not rendered today, so this is latent **except where §G1's substitution reaches
it**: when a record has no `file_date`, the materializer puts `decision_date` in the filing slot.
The sharpest case is **`fdot-active-construction-projects` — 577 records on 160 pages whose
displayed date is an `EstEndDate`, an estimated *completion*, sitting in the position that reads as
when the project was filed.** Same route for `charlotte` (5), `austin-subdivision-cases` (19),
`austin-site-plan-cases` (6), `denton` (7) and `columbia-mo-capital-projects` (5).

`columbia-mo-capital-projects` also carries **`decision_date` values from `1969-12-31` to
`2037-07-15`** — an epoch sentinel and a far-future programme date in the same column. §A2 found
epoch sentinels in `file_date`; this is the first in `decision_date`.

## C4. Dead map keys — bounded, and deliberately not called a defect

Across the 175 entries with records, **1,206 non-`exclude` status values are declared and 881
distinct verbatim status values actually appear in live rows** — so **at least ~325 declared values
match nothing on any page today**. Concentrated in a few entries: `tacoma-accela-permits` (68
declared / 35 live), `new-orleans-permits` (39 / 9), `asheville-accela-permits` (33 / 15),
`hartford-building-permits` (25 / 8), `cabarrus-county-plan-reviews` (32 / 15),
`mesa-building-permits` (21 / 8), `seattle-land-use-permits` (21 / 9).

**This is a maintenance signal, not an error.** A declared value can legitimately be absent because
the entry's `recency_days` window excludes it, because the status is rare, or because the source
retired it. Nothing here shows a wrong record on a page. It is reported because the opposite
direction — a live value with no declared key — is impossible by construction (the gate fails
closed and excludes it), so this is the only visibility config drift has.

## C5. What §C did NOT check

- **Whether a `type_map` value is the *right* use-type.** `use_type` drives pin shape; this pass
  checked lifecycle, not classification. The existing `registry-type-path-coherence` unit test
  covers only the unreachable-`type_map` case.
- **Whether an entry's chosen `status_raw` column is the best one available** on the layer. That
  needs a live field-list probe per entry (the same gap `registry-type-path-coherence` records).
- **Per-record correctness of any status** — only the mapping from a status value to a band.

---

# §H — The undated 32, probed live. Correction first.

## H0. The classification in the ruling does not match the data — checking before acting

The ruling partitioned the undated set as **12 mechanical + 4 date-semantics + 4 genuinely
undated = 20**. That partition is not from any measurement in this audit, and two of its named
entries do not exist:

| named | checked | result |
|---|---|---|
| `tampa` | substring scan of `jurisdiction-registry.json` | **0 occurrences.** Tampa was a Florida candidate **rejected at smoke** (the city's WAF 403s Supabase edge-runtime egress) — it was never wired, has no records, and so cannot be undated. |
| `mecklenburg` | same scan | **1 occurrence — as a `coverage.county` on `charlotte-land-dev-commercial-projects`**, not an entry id. That entry is fully dated: 19,853 rows, 19,853 dated. |
| `delaware-county-pa … "entered"` | registry | it declares **no** `file_date` and **no** `decision_date`; there is no `entered` mapping. |
| `colorado-springs … "decided"` | live field list | the layer publishes **no date-like field at all** — nothing to label `decided`. |
| control | `loudoun` | 5 occurrences — the scan reads the file. |

The real set is **32 entries + 1 null-registry group** (the five TX TDLR/TABS filings on 78617,
which are not registry-driven). Enumerated and probed rather than partitioned by assumption.

## H1. The one genuine mechanical fix — a date parser that could not read a published format

`isoDay()` in `sources/arcgis.ts` and `sources/socrata.ts` accepted `YYYY-MM-DD`, `M/D/YYYY`,
epoch ms and 13-digit epoch strings. It did **not** accept the year-first slash form. Live receipts
(pg_net, 2026-08-08, `?f=json` field lists then real rows):

```
virginia-beach … /query?outFields=IssueDate,ApplicationDate,FinalDate
  → {"IssueDate":"2023/01/03","ApplicationDate":"2023/01/01","FinalDate":"2023/04/27"}   [String]
anaheim       … /query?outFields=Application_Received,City_Council_Date
  → {"Application_Received":"2008/08/19","City_Council_Date":" "}                        [String]
```

Both entries declare the correct column. The source publishes a real date, the registry names it,
and the parser dropped every row — the exact shape the ruling describes. **One added regex, in two
files, strictly disjoint from the existing patterns** (a 4-digit leading group can never match
`M/D/YYYY`), so it can only turn a null into a date. Pinned by
`test/iso-day-year-first-slash.test.mjs`, which drives the shipped source, covers every prior form
to prove none moved, and fails when the new branch is removed. Suite **91/91 green**.

Expected recovery, to be measured against these null counts after deploy + re-cache:

| entry | undated now | pages |
|---|---:|---:|
| `virginia-beach-building-permits` | 14,109 | 9 |
| `anaheim-land-use-cases` | 796 | 7 |

**`ckan` / `csv` / `carto` were checked and are not affected** — their `isoDay` uses `new Date()`,
which already accepts the form.

## H2. Loudoun is NOT a mechanical fix — the source publishes no day

Loudoun (45,618 records / 18 pages) was the ruling's headline case. Its layer carries exactly two
date-like fields, both `esriFieldTypeString`, and the live values are:

```
{"YEAR_ISSUED":"2011","MONTH_ISSUED":"JUNE"}
```

**Year and month NAME — no day.** There is no column to map. Composing the two would not help
(`column_map` arrays JOIN values, they do not fall back — the UDOT standing answer), and turning
`2011` + `JUNE` into a rendered date would require inventing a day, which is the one thing this
tracker never does. The registry's `YEAR_ISSUED` mapping is not wrong so much as unusable at the
granularity the page needs. Recorded positively; not fixed.

## H3. The rest of the 32, by why they are undated

**Probed live (`?f=json`), so the absence is a finding rather than an assumption:**

| entry | rows | what the layer actually publishes | verdict |
|---|---:|---|---|
| `colorado-springs-planning-applications` | 3,702 | **no date-like field at all** | source publishes no date; undated is correct |
| `fort-collins-building-permits` | 810 | no date field (`B1_APPL_STATUS` only) | source publishes no date; undated is correct |
| `nvdot-project-boundaries` | 2,928 | only `Data_Collection_Date` — when the GIS layer was collected, not a project date | source publishes no project date; undated is correct |
| `delaware-county-pa-subdivisions-land-developments` | 5,243 | `Year` (Integer) | year granularity only; undated is correct |
| `akdot-stip-24-27` | 909 | `STIP_Year`, `Year_24`…`Year_27` | programme year only; undated is correct |
| `adot-tip-fy2026-2030` | 685 | `TOTAL_YEAR` | programme year only; undated is correct |
| `loudoun-county-residential-permits` | 45,618 | `YEAR_ISSUED` + `MONTH_ISSUED` (see §H2) | year + month only; undated is correct |
| `hdot-active-design-projects` | 1,848 | **21 programme-milestone date fields** (`awarddate`, `bid_open_date`, `ntpdate`, `actual_advertise_date`, `construction_date`, …) | **NOT undated — belongs to date-semantics piece (b) as `scheduled`** |

**The remaining 22 entries are a different thing entirely and must not be batched with the above.**
Their mapping *works*; a minority of source rows simply carry no value — `topeka` 4,668 undated of
84,077 (5.5%), `savannah` 741 of 3,550, `little-rock` 420 of 48,951, `canyon-county` 294,
`kenton-county` 158, `clark-county-active-projects` 139, `irving` 77, `austin-zoning-cases` 67,
`louisville` 48, and 13 more in single or double digits. **No config or code change can recover a
value the publisher did not publish**, and treating these as "mechanical fixes" would mean
inventing dates. Left as-is, deliberately.

## H4. `hdot` and the four `decided` cases fold into date-semantics, per Ruling 2

Mapping `hdot`'s `awarddate` (or any of its 20 siblings) into the current unlabelled slot would
relocate the ambiguity exactly as the ruling says — a programme milestone reading as a filing date.
It is therefore piece (b) work with `file_date_kind: "scheduled"`, not a mechanical fix, and is not
wired here. Same for the substitution cases already stamped `decided` in Round 6
(`anne-arundel` ×2, `dallas-specific-use-permits`).

## H5. COVERAGE STATEMENT ABOUT THIS AUDIT ITSELF

**Rounds §A–§C read configuration. A materializer substitution is structurally invisible to that
instrument** — the transformation happens in `app_refresh_zip`, downstream of every field those
rounds inspected, so no amount of care reading `jurisdiction-registry.json` could have surfaced it.
§F2 found the first instance only because it compared a rendered date against a cached one; §G1
found the other eight only because it compared config against the table for every entry.

Concretely, reading config alone: could not see that 39,110 records on 390 pages render a decision
date in the filing slot; could not see that three entries declare a `file_date` column that fires
on no row; could not see that 49,884 records carry no coordinates. All three needed the table.

**Any future check of this system that reads only the registry should say so in its own report.**
An audit that read only config and says so is honest; one that read only config and implies
completeness is not.

---

# §C6 — MAP KEYS, as its own sub-pass (exact string matching, both directions)

§C4 reported "at least ~325" dead keys from a count subtraction. That was a bound, not a list. This
sub-pass does the exact per-entry string comparison the ruling asked for, in **both** directions,
and supersedes the ~325 figure.

**Method.** For each entry: the verbatim non-`exclude` values declared in `status_to_bucket`, against
the distinct verbatim `app_projects.stage` values that entry actually produced (`stage` carries the
source status untouched). Three outcomes are distinguished — **dead key** (declared, matches no live
value even case-insensitively), **case-fold-only** (declared key matches a live value only after
lowercasing — the drift the connector's `noteCaseFold` path would silently absorb), and **unmapped
live** (a live value no declared key covers).

**Scope, stated so its silence is legible: 75 entries examined.** `status_const` entries are
excluded — their `stage` is the constant, not a source vocabulary, so they have no keys to be dead.
The remaining entries are those whose declared count does not exceed their live count; since the
unmapped direction measures **zero** (below), declared ≥ live always holds, so declared = live
implies zero dead keys for those.

## Result

| | count |
|---|---:|
| entries with ≥1 dead key | **42** |
| dead keys, total | **280** |
| case-fold-only matches | **0** |
| **unmapped live values** | **0** |
| **entries with BOTH dead keys and unmapped values** | **0** |

**The ruling's hypothesis is testable and the answer is that it never occurs.** "Dead keys AND
unmapped values in one entry means it was drafted from assumption twice" — no entry is in that
state, because the unmapped direction is empty everywhere. That is not luck: the status gate fails
closed, so a live value can only exist if a declared key already covered it. §C4 asserted this from
the code; this measures it across 75 entries and finds no exception. The **0 case-fold-only** result
matters too — it means no declared key is being rescued by case-insensitive matching, so the drift
the case-fold path exists to absorb is not currently present. (Where a source genuinely publishes
both cases — `sussex-county-de-conditional-use` emits `Approved` *and* `APPROVED` — both forms are
declared explicitly.)

## The 42, by dead-key count

| entry | dead | declared | live |
|---|---:|---:|---:|
| `tacoma-accela-permits` | 34 | 68 | 35 |
| `new-orleans-permits` | 30 | 39 | 9 |
| `asheville-accela-permits` | 18 | 33 | 15 |
| `cabarrus-county-plan-reviews` | 17 | 32 | 15 |
| `hartford-building-permits` | 17 | 25 | 8 |
| `mesa-building-permits` | 13 | 21 | 8 |
| `seattle-land-use-permits` | 12 | 21 | 9 |
| `bend-or-permit-applications` | 9 | 15 | 6 |
| `adams-county-building-permits` | 8 | 18 | 10 |
| `bellevue-permits` | 8 | 15 | 7 |
| `fort-worth-development-permits` | 8 | 20 | 12 |
| `bentonville-catalyst-permits` | 7 | 14 | 7 |
| `boulder-construction-permits` | 7 | 17 | 10 |
| `coconino-county-permits` | 7 | 21 | 14 |
| `columbia-mo-permits` | 7 | 18 | 11 |
| `forsyth-county-ga-building-permits` | 7 | 15 | 8 |
| `naperville-building-permits` | 6 | 13 | 7 |
| `seattle-building-permits` | 6 | 21 | 15 |
| `anaheim-land-use-cases` | 5 | 13 | 8 |
| `new-hanover-county-building-permits` | 5 | 17 | 12 |
| `raleigh-building-permits` | 5 | 14 | 9 |
| `kcmo-development-cases` | 4 | 13 | 9 |
| `lee-county-fl-development-orders` | 4 | 13 | 9 |
| `round-rock-large-development-projects` | 4 | 12 | 8 |
| `fort-collins-building-permits` | 3 | 12 | 9 |
| `missoula-addresses-with-permits` | 3 | 15 | 12 |
| `pierce-county-pals-permits` | 3 | 9 | 6 |
| `tempe-building-permits` | 3 | 10 | 7 |
| `durham-building-permits` · `kcmo-building-permits` · `pittsburgh-pli-permits` · `portland-building-permits` · `sussex-county-de-conditional-use` · `tucson-residential-building-permits` | 2 each | | |
| `arlington-planning-cases` · `austin-zoning-cases` · `charlotte-land-dev-commercial-projects` · `clark-county-active-dev-permits` · `henderson-commercial-permits` · `peoria-az-building-permits` · `san-marcos-planning-cases` · `wake-county-building-permits` | 1 each | | |

## What a dead key does and does not prove

It is **harmless at runtime** — an unused branch in a lookup — which is exactly why it survives, and
exactly why it is the only visible trace of a mapping drafted from a vendor's documented status list
rather than read from the live layer. The shape supports that reading: the worst offenders are all
**Accela/EnerGov-family portals** (`tacoma` 34, `asheville` 18, `new-orleans` 30, `hartford` 17,
`cabarrus` 17), whose published status vocabularies are far larger than any one jurisdiction uses.

**But a dead key is not proof of assumption.** Each entry's live vocabulary is bounded by its
`recency_days` window and by the ZIPs HomeSignal covers, so a status that is real but rare, seasonal,
or retired reads as dead here. The honest claim is the narrow one: **280 declared values do nothing
today, in 42 entries, and none of them is compensating for an unmapped live value.**

---

# §H6 — The isoDay fix MEASURED (deployed, re-cached, counted against the null baseline)

Shipped in #651 (squash-merged `803031f`), deployed via `deploy-edge-functions` run **31258446921**,
green at **12:58:34Z**, then the 16 affected ZIP pages re-cached through the live engine and
re-materialized. Ruling 1 asked for recovery measured per entry against its null count, not assumed:

| entry | undated before | dated after | pages recovered | recovery |
|---|---:|---:|---|---:|
| `anaheim-land-use-cases` | 796 | **796** | 7 of 7 | **100%** |
| `virginia-beach-building-permits` | 14,109 | **9,694** | 7 of 9 | **68.7%** |
| **total** | **14,905** | **10,490** | 14 of 16 | **70.4%** |

Per-page, `virginia-beach-building-permits`:

| ZIP | records | dated after |
|---|---:|---:|
| 23452 | 1,996 | 1,996 |
| 23454 | 2,032 | 2,032 |
| 23455 | 1,609 | 1,609 |
| 23464 | 1,597 | 1,597 |
| 23462 | 1,504 | 1,504 |
| 23453 | 804 | 804 |
| 23457 | 152 | 152 |
| **23451** | 2,458 | **0** — blocked |
| **23456** | 1,957 | **0** — blocked |

Every recovered record is stamped `date_kind = 'filed'` (both entries map an application/issue date,
and neither declares a `file_date_kind` yet), with date ranges that make sense: virginia-beach
2026-01-02 → 2026-07-31 (its 365-day window), anaheim 2025-07-01 → 2026-07-29 (its `extra_where`
string-compare window). The 2008 values seen in the raw probe are outside both windows and are
correctly not fetched.

## The two blocked pages — a real limit, not a flake

`23451` and `23456` (Virginia Beach oceanfront and the large southern ZIP) return **HTTP 546
`WORKER_RESOURCE_LIMIT`** from the edge function — *"Function failed due to not having enough
compute resources"* — reproduced **twice each** across separate fires (responses `23071`, `23073`,
`23074`). They are the two largest VB pages by record count. This is the same CPU-budget class
recorded for Miami in the FLORIDA WIRE PASS, not a transient cold start (the transient shapes seen
in the same window — `503 BOOT_ERROR` and a 90 s DNS timeout — recovered on retry; 546 did not).

**Consequence, stated plainly: 4,415 records on 2 pages still render undated, and re-running the
refresh will not change that.** `23456` currently holds pre-fix output that a warm isolate served
before the deploy propagated; `23451` never completed at all. Both need a smaller payload — the
established levers are `out_fields` projection and `page_size` (both already exist, default-off) or
a narrower `spatial_zip_radius_mi` — which changes what residents see and is therefore a separate,
gated decision, not part of this mechanical fix. Logged, not worked around.

---

# §H7 — Loudoun re-cached through the DEPLOYED engine: still 0 dated, and that is correct

The question raised on the re-cache report was the right one: *processed and still null, or merely
queued?* Both were checked, in that order.

**First, the queue state at 13:47Z:** Loudoun had **0 of 18 pages refreshed since the deploy**
(`development_reports.refreshed_at` newest 2026-08-08 05:30Z, i.e. before the 12:58:34Z deploy), and
the pg_net worker was draining a 250-deep backlog. So "not moved" was, at that moment, *not yet
processed* — the report of recovery covered only the 16 ZIPs pushed through by hand.

**Then the decisive test.** Three Loudoun ZIPs were fired individually and two came back at
**13:44:39Z**, through the deployed post-fix engine:

| ZIP | Loudoun sites returned | sites carrying a `file_date` |
|---|---:|---:|
| 20129 | 49 | **0** |
| 20130 | 6 | **0** |

**Loudoun does not recover when processed.** The fix is reading exactly the column the registry
names — `YEAR_ISSUED` — and that column holds `"2011"`. Running the *shipped* post-fix `isoDay`
(extracted from `sources/arcgis.ts`) over Loudoun's real live values:

```
isoDay("2011")       -> null
isoDay("JUNE")       -> null
isoDay("2011 JUNE")  -> null
isoDay("2023/01/03") -> "2023-01-03"     ← control: the fix works
```

A year is not a date, and `MONTH_ISSUED` is a month NAME with no day. Producing a rendered date here
means inventing a day. **Loudoun's 45,618 records were never in the fix's scope** (§H2) — they are in
the *source publishes no usable date* set (§H3), recorded as settled in `docs/source-registry.md`.

**So the 86,749 undated total does not reduce to one fixable batch.** Its composition:

| class | records | recoverable by the isoDay fix? |
|---|---:|---|
| source publishes no day-granularity date (loudoun 45,618 · delaware-county-pa 5,243 · colorado-springs 3,702 · nvdot 2,928 · akdot 909 · fort-collins 810 · adot 685) | **59,895** | **no** — nothing to map |
| programme-milestone dates only (`hdot-active-design-projects`) | 1,848 | **no** — date-semantics piece (b), `scheduled` |
| parser could not read a published format (virginia-beach, anaheim) | 14,905 | **yes** — 10,490 recovered so far |
| working mapping, minority of source rows carry no value (topeka, savannah, little-rock, canyon, kenton, clark, irving, austin-zoning, louisville, + 13 more) | ~10,101 | **no** — the publisher did not publish them |

⚠️ **`hdot` is broken out deliberately** — an earlier draft folded it into the no-date class at
61,743. It is not the same thing: hdot publishes 21 real date fields, all programme milestones, so
its records are undated only until piece (b) classifies them.

## Re-measure, per entry (null before → null now, and pages refreshed since the 12:58:34Z deploy)

| entry | null before | null now | pages | refreshed since deploy |
|---|---:|---:|---:|---:|
| `anaheim-land-use-cases` | 796 | **0** | 7 | **7** |
| `virginia-beach-building-permits` | 14,109 | **4,415** | 9 | **8** |
| `loudoun-county-residential-permits` | 45,618 | 45,618 | 18 | 0 |
| `delaware-county-pa-subdivisions-land-developments` | 5,243 | 5,243 | 40 | 0 |
| `topeka-building-permits` | 4,668 | 4,668 | 23 | 0 |
| `colorado-springs-planning-applications` | 3,702 | 3,702 | 29 | 0 |
| `nvdot-project-boundaries` | 2,928 | 2,928 | 139 | 2 |
| `anne-arundel-subdivision-activity` | 2,007 | 2,007 | 37 | 0 |
| `hdot-active-design-projects` | 1,848 | 1,848 | 85 | 0 |
| `anne-arundel-commercial-site-plans` | 1,175 | 1,175 | 37 | 0 |
| `akdot-stip-24-27` | 909 | 909 | 28 | 0 |
| `fort-collins-building-permits` | 810 | 810 | 5 | 0 |
| `savannah-commercial-building-permits` | 741 | 741 | 14 | 0 |
| `adot-tip-fy2026-2030` | 685 | 685 | 181 | 7 |
| `little-rock-permits` | 420 | 420 | 14 | 0 |
| 16 more, each < 300 | 1,290 | 1,290 | — | 20 |

**Only the two entries the fix targets have moved.** Every other entry's null count is byte-identical
before and after, including the entries whose pages *have* refreshed since the deploy
(`nvdot` 2 pages, `adot` 7, `mdot-sha` 4, `dallas` 12, `fdot` 2) — a refresh through the fixed engine
changes nothing where the source publishes no date, which is the expected result and a second
independent confirmation of the classification.

⚠️ **`topeka-building-permits` is not recovering.** Its null count is unchanged at 4,668 and **0 of
its 23 pages have refreshed since the deploy**. It never had zero dates — 79,420 of its 84,088 rows
were already dated — so nothing about it changed; it is in the third class above.

---

# §H8 — There is a THIRD gap: re-cached is not materialized. And 23451's blocker is not payload size.

Two corrections to §H6/§H7, both found by checking the cache rather than the table.

## H8.1 `23456` was never a WORKER_RESOURCE_LIMIT case — its CACHE was already fixed

Its `development_reports` row was refreshed by the nightly rolling job at **13:30Z** (post-deploy)
and **all 2,302 of its Virginia Beach sites carry a `file_date`**, ranging 2026-01-02 → 2026-07-31.
`app_projects` showed 0 dated purely because the row had not been re-materialized. One
`app_refresh_zip('23456')` moved it to **1,957 / 1,957 dated**. The 546 I recorded for it came from
an *extra manual fire* that raced the nightly job — a self-inflicted error, not the page's state.

## H8.2 The general form — 1,532 ZIPs currently have a cache newer than their table

```
zips where development_reports.refreshed_at > max(app_projects.created_at):  1,532
  … of those, lagging by more than 5 minutes:                                1,519
  oldest such refresh:                                        2026-08-08 05:45Z
```

The mechanism, from `cron.job`:

| job | schedule | what it updates |
|---|---|---|
| `dev-reports-rolling-refresh` → `dev_refresh_tick()` | **every 15 min** | `development_reports` (the cache) |
| `app-content-refresh` → `app_refresh_batch(1500)` | **hourly, :40** | `app_projects` (what the page reads) — **1,500 ZIPs per hour** |

At 12,722 pages and 1,500/hour, a full materialization sweep takes **~8.5 hours**, while the cache
re-refreshes every 15 minutes. `dev_refresh_collect()` does **not** call `app_refresh_zip` — the two
halves are independent jobs.

**So the propagation chain is three stages, not two: merged → deployed → re-cached → materialized.**
Measuring a fix from `app_projects` understates it by up to ~8.5 hours, and the understatement is
invisible unless you compare `refreshed_at` against the table. This is the same shape as
merged-is-not-deployed, one level further down, and it is now written down.

## H8.3 `23451`'s blocker is the GEOCODER, not payload size — the options, measured

Cached row sizes for all nine Virginia Beach pages are **0.02–0.28 MB** — nowhere near any size
ceiling (the cache-wide high-water mark is Cleveland 44127 at 5.98 MB). Payload size is not the
constraint. The cost is **geocoding**: the entry sets `geocode_assemble: true` and the layer carries
**no coordinate columns at all**, so every record's `StreetAddress` goes through the geocoder.

| ZIP | VB sites | addresses geocoded | row size | outcome |
|---|---:|---:|---:|---|
| 23451 | 2,605 | **2,458** | 0.28 MB | **546 WORKER_RESOURCE_LIMIT** ×2 |
| 23456 | 2,302 | 1,957 | 0.26 MB | succeeded via the nightly job |
| 23454 | 2,176 | 2,032 | 0.24 MB | succeeded |
| 23452 | 2,070 | 1,996 | 0.23 MB | succeeded |

23451 is the largest geocode load in the set and the only failure — but 23454 succeeded at 2,032,
so the threshold is marginal rather than a hard wall.

**The options, in order of how little they change:**

1. **Retry as the geocode cache warms — no config change at all.** `public.geocodes` holds 98,033
   cached results and the eight successful VB pages just added thousands of Virginia Beach
   addresses. A later attempt does strictly less work than the ones that failed. **Recommended
   first, because it changes nothing residents see.** (Fired again at the time of writing.)
2. **`out_fields` projection** (additive, default-off, already exists). Reduces parse work, not
   geocode work — so on the measured evidence this is unlikely to be decisive here.
3. **`page_size`** (same). Fewer, larger fetches; also not the bottleneck.
4. **Narrow `recency_days` from 365.** Halving the window roughly halves the geocode load and would
   almost certainly clear it — but it **removes records residents currently see**, so it is a
   founder call, not a mechanical fix.
5. **Find a Virginia Beach layer that publishes coordinates**, eliminating the geocoder entirely.
   Highest value, highest effort, and a new-source decision.

**Nothing in 2–5 is applied.** 23451 remains on its 2026-08-03 (pre-fix) cache vintage, 2,458
records undated, pending option 1 or a ruling.

## H8.4 Recoverable class — final standing

| entry | undated before | undated now | dated now | pages complete |
|---|---:|---:|---:|---|
| `anaheim-land-use-cases` | 796 | **0** | 796 | 7 of 7 |
| `virginia-beach-building-permits` | 14,109 | **2,458** | 11,651 | **8 of 9** |
| **total** | **14,905** | **2,458** | **12,447** | **15 of 16** |

**12,447 of 14,905 recovered — 83.5%.** The entire remainder is one page, `23451`.

---

# §H9 — 23451: option 1 is EXHAUSTED. Options 2–5 with measured tradeoffs.

**The warm-cache retry failed.** Third attempt, response `24081` at **2026-08-08 14:06:15Z**, again
`546 WORKER_RESOURCE_LIMIT` — after eight other Virginia Beach pages had already warmed
`public.geocodes` (98,033 rows). So "retry until the geocode cache carries it" is closed: the page
does not clear on repetition. `23451`'s cache remains at its **2026-08-03 15:30Z** vintage with
**0 of 2,605 VB sites carrying a `file_date`** — genuinely pre-fix, not materialization lag.

**Measured facts the options have to work against.** Row size is not the constraint (0.28 MB against
a cache-wide high-water mark of 5.98 MB). The layer publishes **no coordinate columns**, the entry is
`geocode_assemble: true`, and **2,458 addresses** must go through the geocoder — the largest load in
the set. 23454 succeeded at 2,032, so the ceiling sits somewhere in 2,032–2,458.

| # | option | what it changes | measured effect | what residents lose |
|---|---|---|---|---|
| 2 | **`out_fields` projection** | additive, default-off, already shipped | layer has **17 fields, 6 mapped**; declared width 34,720 chars/row → a projection cuts roughly **2/3 of transfer and parse** | **nothing** |
| 3 | **`page_size`** | additive, default-off, already shipped | fewer, larger fetches | **nothing** |
| 4 | **narrow `recency_days` 365 → 180** | one registry value | VB's real span is only 2026-01-02 → 2026-07-31, so 365 barely binds: **9,848 of 11,651 (84.5%) are already inside 180 days**. Cuts ~15.5% → ~2,077 geocodes on 23451 — *marginally* under 23454's successful 2,032 | **~381 records on this page, ~1,803 across the entry** |
| 4b | **narrow to 90 days** | one registry value | 4,744 of 11,651 (40.7%) survive → ~1,008 geocodes, comfortably clear | **59% of every VB record** |
| 5 | **find a VB layer that publishes coordinates** | new source | removes the geocoder entirely; the only option that fixes the cause | **nothing** — but not probed yet, so unverified |

**Recommendation, and the honest caveat.** Try **2 + 3 together first**: they are the only levers that
cost residents nothing, they are already-shipped default-off options, and a 2/3 cut in parse work is
the largest no-loss saving available. **But the bottleneck measured here is geocoding, not parsing**,
so they may not be decisive — which is exactly why 4 and 4b are on the table and are a founder call:
they buy headroom by deleting records residents currently see. **Option 5 is the only one that
removes the cause**, and it has not been probed.

**Nothing applied.** `23451` stays on its pre-fix vintage, 2,458 records undated, pending a ruling.

---

# §C — STATUS: DELIVERED (merged in #651, not a pending item)

Recorded here because it has been asked for three times. §C and §C6 are complete and in this
document above:

- **§C1** — statuses asserting an unhappened event: **ZERO**, with positive controls proving the
  detector fires (264 dead-state values, **all** mapped to `exclude`; 196 pending-family values,
  **none** to built/operating).
- **§C2** — the defect runs the other way: **Phoenix `OPEN` renders 43,054 records on 77 pages as
  *Proposed* while carrying the city's own `PER_ISSUE_DATE`**, plus 4 entries mapping a bare
  `Approved` to `proposed` while 78 map it to `approved`.
- **§C3** — `decision_date` holds three different things across 59 declaring entries: 5 map a
  status-change timestamp, 7 map an end/expiry date.
- **§C6** — 42 entries carry 280 dead map keys; **0 unmapped live values, 0 case-fold-only matches**,
  so no entry is in the drafted-from-assumption-twice state.

**§C6 deliberately did NOT sub-classify the 280 dead keys.** Splitting them into "plausible vocabulary
the source simply has not emitted lately" versus "values that cannot exist on this layer" requires a
**live per-entry status enumeration** — the registry cannot answer it and neither can the table, since
a dead key produces no rows by definition. That is a further pass (42 live probes), not a
re-reading of what is already measured, and it is not claimed as done.

---

# §I — The four two-stage `APPROVED` entries fold into date-semantics piece (b)

**Ruled 2026-08-08: the bucket is defensible, the WORD is misleading, so the fix is the LABEL.**
Not a `status_to_bucket` change. Recorded here so piece (b) picks them up with the rest.

**The evidence, and why it is decisive.** In each of the four, `APPROVED` and `ISSUED` coexist in
the same corpus as two distinct populations, with `APPROVED` small and upstream and `ISSUED` large
and downstream — the signature of a two-stage permit system where plan approval precedes permit
issuance:

| entry | `APPROVED` → proposed | `ISSUED` → approved | finaled-family → operating |
|---|---:|---:|---:|
| `missoula-addresses-with-permits` | 2,052 | 16,433 | 38,114 |
| `bentonville-catalyst-permits` | 45 | 9,904 | 21,662 |
| `columbia-mo-permits` | 24 | 3,512 | 901 |
| `cincinnati-building-permits` | 3 | 1,570 | 505 |
| **total** | **2,124** | **31,419** | **61,182** |

A single-stage reading would have moved 2,124 records from `proposed` to `approved` and collapsed a
real distinction the publisher draws. The resident-facing problem is narrower and different: the
page says **"Proposed"** where the source says **`APPROVED`**, and those two words disagree even
though the band is right. That is a labelling problem, identical in shape to rendering a decision
date in a filing slot.

**Piece (b) scope, updated.** Alongside the ~15 non-filing `file_date_kind` entries, piece (b) now
also owns: a way to show a two-stage source's own verbatim stage word without moving its lifecycle
band. Until then, four entries display `Proposed` on records their publisher calls approved.

**Not shipped, deliberately.** No registry change was made to any of the four.

---

# §J — Stamford lifecycle fix: shipped state as of 2026-08-08 15:0xZ (NOT complete)

| | |
|---|---|
| registry change | `Under Construction`: `operating` → `approved` (PR #653, squash `9f84e7c`) |
| deployed | `deploy-edge-functions` on the merged sha, green |
| verified pre-persist | every `Under Construction` record came back from the **deployed** engine as `bucket: approved` on all 9 pages that answered |
| re-cached + materialized | 9 of 10 Stamford ZIPs |
| **flipped** | **43 of 47 records, on 8 pages** — `06807 · 06820 · 06870 · 06878 · 06901 · 06902 · 06905 · 06906` |
| **still wrong** | **4 records on `06907`**, whose cache is still `2026-08-08 02:30Z` (pre-change) |

`06907`'s refresh did not return before this was written — it sits behind the rolling job's queue,
not behind a `546` or any error. The nightly `dev_refresh_tick` will carry it, and the hourly
`app_refresh_batch` will materialize it (§H8.2 — the cache and the table are separate jobs, so
expect the page to trail the cache by up to ~8.5 h even after the refresh lands).

**Do not report this fix as complete until `06907` shows `Under Construction → Approved`.** The
check is one query:

```sql
select btrim(stage), status, count(*) from public.app_projects
where record_kind='development' and registry_id='stamford-major-developments'
  and btrim(stage)='Under Construction' group by 1,2;
-- complete when the only row is (Under Construction, Approved, 47)
```

---

# §K — FINAL STATE (2026-08-08). Read this section first; the rest is working.

## K1. Found and SHIPPED

| # | fix | before | after | where |
|---|---|---|---|---|
| 1 | **`isoDay()` could not parse year-first slash dates** — two entries' records rendered undated | `virginia-beach` 14,109 undated · `anaheim` 796 undated | `virginia-beach` **2,458** · `anaheim` **0** — **12,447 of 14,905 recovered (83.5%)** | §H1, §H6 |
| 2 | **Date semantics piece (a)** — `FileDateKind` on `NormalizedRecord`, stamped by all 5 live connectors, materialized to `app_projects.date_kind` | no record declared what its date meant | **`filed` 2,712,902 · `decided` 39,106 · null 74,310**; the `decided` count reproduced the independent cache-side measurement exactly | Round 6 |
| 3 | **Stamford lifecycle inversion** — `Under Construction` mapped to the *built* band | 47 records / 9 pages shown as built while under construction | **43 of 47 flipped to `Approved`**; 4 queued (§K3) | §J |
| 4 | **`champaign-il-special-use-permits` fabricated record precision** — `record_url` mapped to a column that was not a public URL | claimed `record` precision on a non-resolving link | mapping dropped, precision demoted to `dataset` | Round 1 |
| 5 | **`burlington-vt-*` `out_fields` projection dropped the type column** | records emitted `unclassified` | `PrimaryLUC` restored to both entries; pinned by a projection invariant in `registry-type-path-coherence` | Round 1 |

## K2. Found and correctly LEFT ALONE — with the reason

| finding | size | why nothing was done |
|---|---:|---|
| **Sources publishing no day-granularity date** — loudoun, delaware-county-pa, colorado-springs, nvdot, akdot, fort-collins, adot | **59,895 records** | **Undated is the correct output.** Loudoun's layer publishes `YEAR_ISSUED "2011"` + `MONTH_ISSUED "JUNE"`; rendering a date means inventing a day. Positive receipts per entry in `docs/source-registry.md`. |
| `hdot-active-design-projects` | 1,848 | Publishes 21 **programme-milestone** dates. Mapping one into today's unlabelled slot relocates ambiguity → piece (b) as `scheduled`. |
| Partial source-side nulls — topeka, savannah, little-rock + 19 more | ~10,101 | Mapping works; the publisher did not publish those values. Nothing can recover them. |
| **280 dead map keys across 42 entries** | — | Harmless unused lookup branches, and **0 unmapped live values / 0 case-fold-only matches**, so none is compensating for anything. Maintenance signal, not a defect. |
| **Shared-URL `record_url_precision`** | 22 record-precision entries | The 183-entry distinct-URL scan was **clean**, and one shared URL is exactly what `dataset` means. **There is no incorrect precision claim to fix.** |
| **Four two-stage `APPROVED` entries** — missoula, bentonville, columbia-mo, cincinnati | 2,124 records | Bucket is defensible, word is misleading → **label, not bucket**. Folded into piece (b). §I |
| `dekalb-county-building-permits`, `overland-park-building-permits` | 276,592 records | **Measured correct.** Their Operating populations are `Closed` and `Complete/Finaled`+`TCO`; `Issued` already maps to `approved` in both. |

## K3. Still IN FLIGHT — and exactly what completes each

| item | state | what completes it |
|---|---|---|
| **Stamford `06907`** — 4 records still showing `Under Construction` as *Operating* | cache still `2026-08-08 02:30Z` (pre-change). **Queued behind the rolling job — not a `546`, not an error.** | `dev_refresh_tick` carries the cache, then `app_refresh_batch` materializes. **Done when** `select btrim(stage), status, count(*) … group by 1,2` returns only `(Under Construction, Approved, 47)`. |
| **Virginia Beach `23451`** — 2,458 records undated | cache still `2026-08-03 15:30Z`, **0 sites carrying a `file_date`** — genuinely pre-fix. Retry-as-cache-warms **exhausted** (3× `546 WORKER_RESOURCE_LIMIT`). | Needs a founder decision — §K4. |

## K4. Needs a FOUNDER DECISION

1. **Virginia Beach `23451`, options 2–5** (§H9). Blocker is the **geocoder**, not payload size: rows are 0.28 MB, but the layer has no coordinate columns and 2,458 addresses must be geocoded.
   - **2 + 3 (`out_fields` + `page_size`)** — layer has 17 fields / 6 mapped, 34,720 declared chars per row, so a projection cuts ~2/3 of parse. **Costs residents nothing.** Caveat: the bottleneck is geocoding, so it may not be decisive.
   - **4 — `recency_days` 365 → 180.** VB's real span is 2026-01-02 → 2026-07-31, so 365 barely binds: 84.5% already sit inside 180 days. Cuts ~15.5% → ~2,077 geocodes, *marginally* under the observed ceiling. **Removes ~381 records here, ~1,803 entry-wide.**
   - **4b — → 90 days.** Clears comfortably. **Removes 59% of every VB record.**
   - **5 — find a VB layer that publishes coordinates.** Removes the cause. Not probed.
2. **Date semantics piece (c) — rendering the label.** The only step that changes what residents read. Until it ships, `dallas-specific-use-permits` shows a decision date as a filing date on **164 pages / 30,975 records**, and Anne Arundel on 37 pages / 7,516.
3. **Piece (b) classification** — ~15 non-filing entries plus `hdot` (`scheduled`) plus the four two-stage `APPROVED` entries.
4. **Phoenix `OPEN` → `proposed`** (§C2) — 43,054 records on 77 pages read *Proposed* while carrying the city's own `PER_ISSUE_DATE`. Measured, never ruled.
5. **13,285 future-dated records across 20 entries / 1,436 pages** (§D3) — DOT programme dates. Ruled Class 1 (not defects) but the display question rides on piece (c).
6. **49,884 records with no coordinates** — `little-rock-permits` 48,951, `bozeman-building-permits` 933 (§G3). They list but can never render as pins. Never ruled.

## K5. What this audit structurally COULD NOT check

Stated so the coverage claim is honest — these are unrun, not clean:

1. **Whether a `type_map` value is the RIGHT use-type.** `use_type` drives pin shape. This audit checked lifecycle, not classification. Needs a live field list plus a judgment call per entry, **×140 entries with a `type_map`**. The existing unit test covers only the *unreachable*-`type_map` case.
2. **Whether an entry's `status_raw` column is the best one the layer offers.** Needs a live field list per entry; the registry cannot answer it and neither can the table.
3. **Dead-key sub-classification** — "vocabulary the source hasn't emitted lately" vs "values that cannot exist" needs **42 live per-entry status enumerations**. A dead key produces no rows by definition, so no amount of DB reading resolves it.
4. **Per-record correctness of any value.** Everything here is presence, mapping and internal consistency. A record whose title, address or status is simply wrong at the publisher is invisible to every check run.
5. **Live HTTP verification of `record_url`.** The distinct-URL scan was **structural only** — no URL was fetched.
6. **Pages marked covered while empty, or honest-empty while records exist.**
7. **The instrument bias, stated in §H5:** §A–§C read configuration, and a materializer substitution is structurally invisible to that instrument. Any future check that reads only the registry must say so in its own report.

---

# §L — VB 23451: the `max_rows` measurement, and why 15,000 does not bite

Measured live against the layer **in the connector's own scope** (`Zip='<zip>' AND IssueDate >= '2025/08/08'` — the entry's `recency_days: 365`), so these are the row counts the connector actually pulls:

| ZIP | rows the source publishes IN SCOPE | outcome |
|---|---:|---|
| **23451** | **4,262** | **`546 WORKER_RESOURCE_LIMIT` ×3** |
| 23456 | 3,882 | succeeded |
| 23454 | 3,618 | succeeded |
| 23452 | 3,313 | succeeded |
| 23464 | 2,800 | succeeded |

*(23451 all-time, outside the window, is 16,037 — the connector never fetches that.)*

**The largest payload that succeeded is 3,882 rows. 23451 is 4,262 — only 9.8% above it.** That
narrow margin is consistent with everything else observed: the ceiling is not a cliff, it sits
between those two numbers.

## Where 15,000 sits — it has no effect

`max_rows` defaults to **20,000** and caps rows pulled per dataset. **23451 pulls 4,262.** A cap of
15,000 is **3.5× above the payload that fails**, so it would never engage; the entry would behave
byte-identically and 23451 would fail a fourth time for the same reason. It was not applied.

## ⚠️ For a cap to bite it MUST truncate real records — back to the founder

To get 23451 under the largest known success it would have to be set at **≤ 3,882**, discarding at
least **380 of the 4,262 records (8.9%)** the publisher lists for that ZIP — and, being a per-dataset
cap, it would apply to **every Virginia Beach page**, silently trimming 23456 (3,882) at the boundary
too. That is the "a cap that truncates real records is a different decision" case, so it is not
applied and comes back to you.

**What the truncation guard does and does not give you.** It surfaces a `truncated` entry in
`dev_refresh_source_failures` naming the cap and the fetched count, so the hit is visible rather than
silent — but it is **visible to an operator reading a failures table, not to a resident reading the
page**. The page shows a shorter list with no indication anything was dropped.

## Option 2 status — applied, one attempt, result pending

`out_fields` projection shipped for `virginia-beach-building-permits` (6 mapped columns of 17;
34,720 declared chars/row → ~2/3 less transfer and parse), merged and deployed. The single ruled
attempt on 23451 was fired and **had not returned when this was written** — it sits behind the
rolling job's queue, with **no `546` recorded in the window**. Per the ruling this is the one
attempt; if it comes back `546`, that is the fourth failure and confirmation, and the decision above
is the live one.

---

# §M — Date semantics piece (b): the CLASSIFICATION LIST

**⚠️ First, a correction to my own scope estimate.** §F3 said "the ~15 non-filing entries." That
counted only entries where a defect had already been found. Classifying by each entry's declared
`file_date` **column name** across all 172 entries that declare one:

| what the column name says the date IS | entries |
|---|---:|
| **`issued`** — an issue/permit date | **69** |
| `filed` — application/submission/receipt | 60 |
| **`scheduled` / `estimated`** — a start, award, letting or completion date | **9** |
| **UNRESOLVED from the name alone** | **34** |

**112 of 172 entries are NOT `filed`** by their own column's name — 7× my estimate. Every one of them
currently carries the `filed` default stamped by piece (a), which is why piece (c) must not ship
before this pass.

## The 9 `scheduled` / `estimated`

`columbia-mo-capital-projects` `project_start_date` · **`fdot-active-construction-projects` `StartDate`**
(the §D1 confirmed defect) · `iowa-dot-bid-projects` `CONTRACT_AWARDED` ·
`lake-county-il-construction-program` `Start_Date` · **`lexington-row-permits` `EstimatedStartDate`**
(§E2) · `mdot-sha-project-portal` `Estimated_Project_Start_Year` ·
`vtrans-project-locations` `ExpectedConstructionStart` · `wisdot-highway-program-6yr` `LET_DATE` ·
`wsdot-project-delivery-plan-complete` `OperComplete`

## The 34 UNRESOLVED — these need a decision or a probe, not a guess

The column name does not say what the date means. Reading them, they fall into recognisable shapes,
but **shape is a lead, not a fact** (claims discipline rule 1) — none of these is classified here:

- **Meeting / hearing dates, which are neither filed nor issued:** `clv-planning-cases` `MTG_DATE` ·
  `summit-county-oh-planning-commission-items` `MeetingDate` · `boone-county-ky-planning-board-actions`
  `ACTIONDATE` · `clarksville-montgomery-*` `ACTION_DAT`
- **Advertisement / obligation dates on DOT programmes:** `ctdot-project-work-areas` `CurrentADVdate` ·
  `wsdot-project-delivery-plan-{proposed,under-construction}` `AdDate` · `mdot-stip-projects`
  `PHASE_SCHD_OBLG_DATE` · `maine-dot-public-projects` `conbegin_forecast` · `massdot-highway-projects`
  `From_Date` · `nj-stip-projects` `PROJ_RECD` · `aldot-*` `SELECTED_DT`
- **A DECISION date already, used in the filing slot:** `stamford-major-developments`
  `USER_Approval_Date` · `champaign-il-special-use-permits` `Effective_` ·
  `lee-county-fl-development-orders` `STATUS_DATE`
- **A last-updated timestamp, not an event:** `txdot-projects-info-all` `LAST_PROJ_UPDATE_DT` ·
  `butler-county-ks-permits` / `cook-county-il-highway-construction-program` `CreationDate`
- **Ambiguous local names:** `PERMIT_DAT` (chattanooga ×2, kenton) · `PRMT_DATE` (murfreesboro) ·
  `ZC_DATE` · `DATE_` · `Date` · `Year` · `InDate` / `INDATE` / `Entry_Date` / `DATE_RCVD` /
  `PROJ_RECD` (probably filed) · `ISSDTTM` (probably issued) · `PER_ENT_DATE` (Phoenix — permit
  *entered*, probably filed)

## What piece (b) actually costs, honestly

- **9 `scheduled` + the 3 already-stamped `decided` entries: cheap.** Self-describing names, two of
  them already proven defects. Ship as registry edits.
- **69 `issued`: cheap but not free.** Names are self-describing, but a spot-check against the live
  layer is warranted before relabelling 69 entries at once.
- **34 UNRESOLVED: the real work.** Each needs a live field-list probe plus a judgment call, and
  several (`MTG_DATE`, `LAST_PROJ_UPDATE_DT`, `USER_Approval_Date`) may be the *wrong column* rather
  than a mislabelled one — which is a different fix.

---

# §N — Piece (b), first tranche SHIPPED + the wrong-column probe results

## N1. The 6 `scheduled` / `estimated` entries — shipped, each with future-date evidence

Classified on a **corroborating instrument, not the column name**: a filing date cannot be in the
future, so future-dated records prove the column is a plan, not a filing.

| entry | `file_date` column | kind | future-dated | latest date |
|---|---|---|---:|---|
| `wisdot-highway-program-6yr` | `LET_DATE` | `scheduled` | **1,785 / 1,822 = 98.0%** | 2032-02-10 |
| `vtrans-project-locations` | `ExpectedConstructionStart` | `estimated` | **398 / 414 = 96.1%** | 2032-12-21 |
| `columbia-mo-capital-projects` | `project_start_date` | `scheduled` | 180 = 12.5% | 2029-10-01 |
| `fdot-active-construction-projects` | `StartDate` | `scheduled` | 445 = 10.2% | 2029-01-23 |
| `mdot-sha-project-portal` | `Estimated_Project_Start_Year` | `estimated` | 31 = 3.9% | 2029-04-01 |
| `lexington-row-permits` | `EstimatedStartDate` | `estimated` | 262 = 3.0% | 2026-10-05 |

Registry-only, additive, byte-identical round-trip asserted; `file-date-kind` test now reports
**6 entries declare an explicit kind**; suite 91/91 green.

## N2. Three of the nine were NOT shipped — and why

- **`lake-county-il-construction-program` (`Start_Date`)** — the name says scheduled but the
  instrument is silent: **0 future-dated of 80, latest 2026-08-01**. Name-only is not evidence
  (claims discipline rule 1). Held.
- **`iowa-dot-bid-projects` (`CONTRACT_AWARDED`)** and
  **`wsdot-project-delivery-plan-complete` (`OperComplete`)** — both are **past events with no member
  in the vocabulary**. `FileDateKind` is `filed | issued | scheduled | estimated | decided`; there is
  no `awarded` and no `completed`. ⚠️ **This is a vocabulary gap, and extending the type is a code
  change — a founder decision, not a registry edit.**

## N3. The three already-stamped `decided` entries need NO registry edit

`dallas-specific-use-permits` and `anne-arundel-{subdivision-activity,commercial-site-plans}` declare
**no** `file_date`, so `file_date_kind` never applies to them. The materializer already stamps
`'decided'` on the substitution path — verified in production: `date_kind='decided'` on **39,106
records / 390 pages / 9 entries**. Nothing to ship.

## N4. WRONG COLUMN vs MISLABELLED — the split, from 5 live field-list probes

The more serious class is real, and it has a clear signature: **does the layer offer a better date?**

| entry | date fields the layer offers | verdict |
|---|---|---|
| **`txdot-projects-info-all`** | **15**, incl. `DSGN_START_ACTL_DT`, `ACTUAL_LET_DATE`, `CNSTR_WKBG_DT`, `PROJ_ESTMTD_LET_D`, `COMMISSION_AWARD_OF_CONTRACT` | 🔴 **WRONG COLUMN.** `LAST_PROJ_UPDATE_DT` is a record-touch timestamp, chosen over five real event dates. **27,060 records on 666 pages** — the widest page footprint of any entry in the registry — carry a "when we last edited this row" date in the filing slot. |
| `clv-planning-cases` | **1** — `MTG_DATE` only | 🟡 **Vocabulary gap, not a wrong column.** The layer publishes no filing date at all; a hearing date is the only date available, and `FileDateKind` has no `hearing` member. |
| `summit-county-oh-planning-commission-items` | **1** — `MeetingDate` only | 🟡 Same as above. |
| `kenton-county-devtracking-permits` | 2 — `PERMIT_DAT`, `EDIT_DATE` | 🟢 Fine. `PERMIT_DAT` is the only substantive date; `EDIT_DATE` would be worse. |
| `new-castle-county-permits` | 6 — `ISSDTTM`, `APDTTM`, `COODTTM`, `TMPCOODTTM`, + 2 system | 🟢 **Correctly chosen** — `ISSDTTM` is the issue date, picked over approval and C-of-O. **Counts as a PASS for the 69-`issued` spot-check.** |

**Split so far: 1 wrong column · 2 vocabulary gaps · 2 correct.** The remaining 29 unresolved entries
need the same probe each. **`txdot` is the finding to carry forward** — a wrong column is a different
and worse defect than a wrong label, because no amount of labelling fixes it.

---

# §O — TxDOT column fix + the vocabulary extension

## O1. Population measured on ALL candidates before choosing (85,460 rows in the layer)

| column | populated | share | what it is |
|---|---:|---:|---|
| `LAST_PROJ_UPDATE_DT` ← **was in use** | 85,460 | **100%** | when the row was last touched — not a project event |
| `PROJ_ESTMTD_LET_D` | 85,437 | 99.97% | *estimated* letting date — a forecast |
| **`ACTUAL_LET_DATE`** ← **chosen** | **51,488** | **60.2%** | the contract actually went out to bid |
| `CNSTR_NTPD_DT` | 14,035 | 16.4% | notice to proceed |
| `CNSTR_WKBG_DT` | 13,830 | 16.2% | construction work began |
| `COMMISSION_AWARD_OF_CONTRACT` | 11,902 | 13.9% | commission award |
| `DSGN_START_ACTL_DT` | 11,272 | 13.2% | design start |
| `CNST_EST_CMPLT_DT` | 3,337 | 3.9% | estimated completion |

**Chosen: `ACTUAL_LET_DATE`**, per the ruling's own test — of the two candidates named
(`ACTUAL_LET_DATE`, `CNSTR_WKBG_DT`) it is **3.7× better populated** (60.2% vs 16.2%) and is a real
past event a resident can act on.

⚠️ **Two things to overrule with if you disagree.**
1. **`date_kind` is `awarded`, and that is the NEAREST member rather than an exact one.** TxDOT
   distinguishes *letting* (bids opened, `ACTUAL_LET_DATE`) from *commission award*
   (`COMMISSION_AWARD_OF_CONTRACT`, a separate column). The vocabulary has no `let`. `awarded` is
   the closest true statement; adding TxDOT-specific jargon to a national vocabulary is worse.
2. **`PROJ_ESTMTD_LET_D` would date 99.97% of records instead of 60.2%** — but it is a forecast, and
   for the 51,488 projects already let it would show an *estimate* in place of the real date. Not
   chosen; flagged because it is the only way to keep near-universal coverage.

## O2. Before → after, so the fix is visible

| | before (production now) | after (predicted from the live layer) |
|---|---|---|
| records | 27,193 on 666 pages | unchanged |
| **dated** | **27,193 (100%)** | **~60% — roughly 10,900 records become UNDATED** |
| oldest | **2024-03-01** ← a 2-year floor on a highway programme | the real letting history, decades deep |
| newest | 2026-08-07 | — |
| **dated in the last 30 days** | **1,846** ← TxDOT does not file 1,846 projects a month | should collapse to the real letting cadence |

**Trading a wrong date on 10,900 records for an honest absence is the intended outcome**, and it is
the same call as §H3: a record with no date beats a record with a date that means something else.
The 2024-03-01 floor is the proof the old column was a touch timestamp — it is when TxDOT's system
started stamping updates, not when Texas started building roads.

*(After-state is predicted, not measured: the fix needs a deploy plus a re-cache of 666 pages.
Measure it with the same query before reporting it as done.)*

## O3. Vocabulary extended — `awarded`, `completed`, `hearing`

`FileDateKind` is now `filed | issued | scheduled | estimated | decided | awarded | completed |
hearing` (`sources/socrata.ts`), with the three new members documented inline. Code change,
approved. It unblocks four entries immediately:

| entry | column | kind |
|---|---|---|
| `iowa-dot-bid-projects` | `CONTRACT_AWARDED` | `awarded` |
| `wsdot-project-delivery-plan-complete` | `OperComplete` | `completed` |
| `clv-planning-cases` | `MTG_DATE` | `hearing` |
| `summit-county-oh-planning-commission-items` | `MeetingDate` | `hearing` |

For the two `hearing` entries this is the whole fix: their layers publish **exactly one date** and it
is the meeting date, so the label — not the column — was the defect. `test/file-date-kind.test.mjs`
carries the widened vocabulary and rejects anything outside it; suite 91/91 green.

## O4. Running total for piece (b)

**11 of 172 entries now declare an explicit kind**: 3 `scheduled`, 3 `estimated`, 2 `hearing`,
1 `awarded`, 1 `completed`, 1 `awarded` (txdot). The 3 substitution entries are stamped `decided` by
the materializer without config. Remaining: **69 `issued`** (spot-check first — 1 of 1 passed so far)
and **29 unresolved** (one probe each; 1 wrong column, 2 vocabulary gaps, 2 correct so far).

---

# §Q — The 31 unresolved, probed. 23 classified, 5 flagged as WRONG COLUMN or worse.

**Every one of the 31 is ArcGIS.** All 31 field lists pulled live via `pg_net` (HTTP 200 on all 24
fired this pass; the other 7 were probed earlier or classified from production evidence). The test
is the one that found TxDOT: **does the layer offer a better date?** — corroborated against
production date distributions, never against a column name.

## Q1. Classified and SHIPPED — 23 entries

**Column confirmed correct, label was the defect (12):**

| entry | column | date fields the layer offers | kind |
|---|---|---|---|
| `aldot-atrip-ii-projects` | `SELECTED_DT` | `SELECTED_DT`, `Year_Text` | `awarded` |
| `aldot-rebuild-alabama-grant-projects` | `SELECTED_DT` | same | `awarded` |
| `boone-county-ky-planning-board-actions` | `ACTIONDATE` | `ACTIONDATE`, `BRDACTION` | `decided` |
| `champaign-il-special-use-permits` | `Effective_` | `Effective_`, `Expiration`, `Site_Visit` | `decided` |
| `chattanooga-building-permits` | `PERMIT_DAT` | `PERMIT_DAT`, `PERMIT_YEAR` | `issued` |
| `chattanooga-permits-archive` | `PERMIT_DAT` | same | `issued` |
| `murfreesboro-building-permits` | `PRMT_DATE` | `PRMT_DATE`, `PRMT_YEAR` | `issued` |
| `kenton-county-devtracking-permits` | `PERMIT_DAT` | `PERMIT_DAT`, `EDIT_DATE` | `issued` |
| `new-castle-county-permits` | `ISSDTTM` | `ISSDTTM`, `APDTTM`, `COODTTM`, `TMPCOODTTM` | `issued` |
| `clarksville-montgomery-final-subdivisions` | `ACTION_DAT` | `ACTION_DAT`, `DATE`, `RPC_ACTION` | `decided` |
| `clarksville-montgomery-preliminary-subdivisions` | `ACTION_DAT` | same | `decided` |
| `stamford-major-developments` | `USER_Approval_Date` | + 5 more (see Q2) | `decided` |

**Programme dates, proven by future-dated records in production (5):**

| entry | future-dated | latest | kind |
|---|---:|---|---|
| `wsdot-project-delivery-plan-proposed` | **731 / 731 = 100%** | 2042-07-07 | `scheduled` |
| `mdot-stip-projects` | **5,467 / 7,410 = 73.8%** | 2029-09-28 | `scheduled` |
| `maine-dot-public-projects` | **243 / 444 = 54.7%** | 2031-01-13 | `estimated` |
| `ctdot-project-work-areas` | 2,308 / 22,774 = 10.1% | 2030-10-09 | `scheduled` |
| `wsdot-project-delivery-plan-under-construction` | 8 / 966 | 2026-08-03 | `scheduled` (same `AdDate` column as the 100%-future sibling) |

**Confirmed `filed` — the layer offers an issue/approval date and the mapped column is correctly the
intake date (6):** `arlington-permit-applications` (`InDate`), `arlington-planning-cases` (`INDATE`,
over `ISSUEDATE`/`FINALDATE`), `fort-worth-zoning-cases` (`ZC_DATE`, over `DATE_APPRO`),
`nj-stip-projects` (`PROJ_RECD`, over `AWARD_DATE`), `phoenix-building-permits` (`PER_ENT_DATE`,
over `PER_ISSUE_DATE`), `york-county-pa-planning-subdivisions` (`DATE_RCVD`, over
`CREATE_DATE`/`MODIFY_DATE`). Declared explicitly so it is recorded rather than defaulted.

## Q2. 🔴 FIVE FLAGGED — these need a decision, and two are TxDOT again

| # | entry | records / pages | what the probe found | why it is not a label fix |
|---|---|---:|---|---|
| 1 | **`cook-county-il-highway-construction-program`** | 403 / 127 | uses `CreationDate`; **the layer also offers `start`** | **WRONG COLUMN — a second TxDOT.** `CreationDate` is the ArcGIS row-creation field. Production corroborates: every date sits in a 10-week band, **2026-04-14 → 2026-06-25**, on a construction programme — that is a GIS load batch, not a schedule. |
| 2 | **`massdot-highway-projects`** | **92,315 / 624** | uses `From_Date`; the layer offers **`bidOpenedDate`, `ntpDate`, `ScheduledAdDate`, `PrcApprovedDate`, `completeDateApproved`, `ReadinessDate`** | **WRONG COLUMN — a third TxDOT, and the largest.** `From_Date`/`To_Date` read as a validity range, not an event. Floor is a suspiciously round **2023-01-01**, and **0 records in the last 30 days** on a live state programme. |
| 3 | **`sheridan-county-building-permits`** | 6,492 / 12 | the layer publishes **`Year` and nothing else** | **No usable date exists.** The current mapping renders **all 6,492 records as `1970-01-01`** (min = max = 1970-01-01 in production — the §A2 epoch sentinel). The honest fix is to drop the mapping so they render undated, which **removes a date from every record** — beyond error correction, so it stops here. |
| 4 | **`butler-county-ks-permits`** | 1,216 / 15 | uses `CreationDate`; the layer offers **only `CreationDate`, `EditDate`, `soilprofile`** | **Wrong column with NO alternative.** Both candidates are system timestamps. Production: floor **2026-01-08** with **no `recency_days` window** — the TxDOT signature — but there is nothing better to move to. Dropping the date is the only honest fix; same call as #3. |
| 5 | **`stamford-major-developments`** | 347 / 10 | uses `USER_Approval_Date`; the layer also offers **`USER_ZB_application__`, `USER_FIL_received`, `USER_Shared_received`** | Labelled `decided` in Q1, which is now truthful. But a **filing** column exists and would fit the slot better. Column change = what residents see moves; flagged rather than taken. |

**Two more needing a value probe before classification** (name is genuinely ambiguous, no better
column obviously offered): `desoto-county-permits` (`Date`, 7,105 records) and
`weld-county-site-plan-review` (`DATE_`, 592 records; production floor is the `1899-12-30` epoch
sentinel). `lee-county-fl-development-orders` (`STATUS_DATE`) and
`montgomery-county-pa-act247-proposals` (`Entry_Date` vs the layer's own `Received_Date`) are the
same shape.

## Q3. Running total

**34 of 172 entries now declare an explicit kind** (11 before this pass + 23 here). Remaining:
**69 `issued`** (spot-checks below) and **8 unresolved** — 5 flagged above, 3 awaiting a value probe.

---

# §R — The two wrong columns fixed, the two false dates dropped, and a correction to §Q

## R1. `massdot-highway-projects` — the largest wrong column yet (92,315 records / 624 pages)

Population measured live on every candidate over the layer's 24,045 rows **before** choosing:

| column | populated | share | note |
|---|---:|---:|---|
| `From_Date` ← was in use | 24,045 | **100%** | paired with a `To_Date` that is **0 of 24,045** |
| `ReadinessDate` | 13,161 | 54.7% | `M/D/YYYY` string; vague meaning |
| **`ScheduledAdDate`** ← **chosen** | **13,020** | **54.2%** | ISO string, real span **1992-12-31 → 2050-10-02** |
| `PrcApprovedDate` | 12,862 | 53.5% | |
| `bidOpenedDate` | 5,174 | 21.5% | |
| `completeDateApproved` | 5,081 | 21.1% | |
| `ntpDate` | 5,037 | 21.0% | |
| `To_Date` | **0** | 0% | |

**`From_Date` with an entirely empty `To_Date` is a record-validity range, not a project event** —
and production agrees: a round **2023-01-01** floor and **0 records in the last 30 days** on a live
state programme. Live min/max on `From_Date` confirms the floor exactly (epoch ms 1672531200000 =
2023-01-01).

Chose `ScheduledAdDate` over `ReadinessDate` on **meaning at a statistical tie** (13,020 vs 13,161).
Its 1992→2050 span is a real programme history; `From_Date`'s is a bulk-set floor. It is an
**ISO-format STRING** and this entry has **no `recency_days`**, so there is no DATE-literal
lexicographic hazard (the nyc-dob defect class). `date_kind: "scheduled"`.

**~46% of records will become undated. That is intended**, per the TxDOT precedent, and it is
recorded in the entry's `_receipts` with a do-not-revert.

## R2. ⚠️ CORRECTION TO §Q — Cook County's `start` is NOT a usable column

§Q flagged `cook-county-il-highway-construction-program` as a wrong column *and named `start` as the
better one*. **Measuring before applying disproved that.** A live min/max probe on `start` returned:

```
{"a": "Fall 2025", "b": "Summer 2026"}
```

**Season strings.** `isoDay()` cannot parse them, so `start` would emit nothing. The layer's only
other dates are `CreationDate` and `EditDate` — both ArcGIS system timestamps, and `CreationDate`'s
403 records all sit inside one 10-week band (2026-04-14 → 2026-06-25), a load batch.

**So Cook County is not a wrong-column fix, it is a drop:** the source publishes **no parseable event
date**. Mapping removed, positive receipt recorded. *This is exactly why the ruling's "measure
population on all candidates" step exists — the §Q flag would have shipped a column that produces
zero records.*

## R3. Two false dates dropped (founder ruling)

| entry | records / pages | what was being shown | why dropping is error-correction |
|---|---:|---|---|
| `sheridan-county-building-permits` | 6,492 / 12 | **`1970-01-01` on every record** — min = max in production, the Unix epoch from an integer `Year` coerced to a timestamp | the layer publishes `Year` and **nothing else**. A false date removed, not a date removed. |
| `butler-county-ks-permits` | 1,216 / 15 | `CreationDate`, the ArcGIS row-creation field | the layer offers only `CreationDate`, `EditDate`, `soilprofile` — **no event date exists**. Floor 2026-01-08 with 116 in the last 30 days and no recency window: a load batch. |

Both carry a positive receipt — *"the source publishes no event date; undated is correct"* — with an
explicit do-not-remap, in the same form as §H3.

## R4. `stamford-major-developments` — left alone, per ruling

`decided` is truthful and now declared. The layer does offer filing columns
(`USER_ZB_application__`, `USER_FIL_received`, `USER_Shared_received`); moving to one changes what
residents see **without correcting an error**, so it is recorded here as a future product option and
not taken inside a remediation pass.

## R5. State after this pass

**35 of 170 entries declare an explicit kind** (172 declared a `file_date` before this pass; 2 have
now had the mapping dropped, so the denominator moves to 170, and `massdot` joins the classified
set). Still open: **69 `issued`** (spot-checks not started), **3 needing a value probe** (`desoto`
`Date`, `weld-county` `DATE_`, `montgomery-county-pa` `Entry_Date` vs the layer's own
`Received_Date` — a possible fourth wrong column), and **piece (c)**, which stays blocked until
those close.

⚠️ **Nothing in §R is deployed yet.** Registry edits only, 91/91 green. Each needs the full TxDOT
sequence — merge, deploy, re-cache, measure after-state against prediction — before any of it can be
called done.

---

# §S — The three value probes close (montgomery is NOT a fourth wrong column), and the re-cache pipeline is measured to be the real blocker

§R merged as PR #656 (squash `3344689`) and deployed from `main` at **2026-08-09 19:51:52Z**
(`deploy-edge-functions` run 31332765014, success; edge-function **version 197**). The measurement
half of that ruling could not be completed, for a reason that is itself the largest finding of this
pass and is documented in §S2.

## S1. The three value probes — all three resolved, and the one flagged as a fourth wrong column is not

The founder's flag was that `montgomery-county-pa-act247-proposals` "offers `Received_Date` against
the `Entry_Date` in use, which may be a fourth wrong column" — the same shape as TxDOT and MassDOT.
It is not, and the probe is decisive rather than suggestive: **the two columns are the same event.**

| entry | verdict | kind | the receipt (live, 2026-08-09) |
|---|---|---|---|
| `montgomery-county-pa-act247-proposals` | **correct column — NOT a fourth wrong column** | `filed` | `Entry_Date` is `Received_Date` truncated to midnight on **8 of 8** newest rows: `1785888000000` = 2026-08-05 vs `"8/5/2026 1:54:17 PM"`; `1785715200000` = 2026-08-03 vs `"8/3/2026 6:12:25 PM"`; `1785369600000` = 2026-07-30 vs `"7/30/2026 12:00:00 AM"`; `1785110400000` = 2026-07-27 vs `"7/27/2026 3:27:37 PM"` |
| `desoto-county-permits` | **correct column** | `issued` | `Date` is the date-typed rendering of Accela's own `AISSDT` (B1 issue date): `AISSDT 20180629.0 → Date 1530230400000` = 2018-06-29, `AISSDT 20180628.0 → Date 1530144000000` = 2018-06-28 |
| `weld-county-site-plan-review` | **correct column** | `decided` | complete `PER_STATUS` vocabulary is 3 values summing to the layer's 434 rows — `Recorded` 432, `" Recorded"` 1, `" "` 1 — and only `Recorded` is mapped, so every emitted record is a recorded plan; `DATE_` sits beside `RECP_NUM` and lags the case vintage (`SPR15-0017` / `RECP_NUM 4215393` → `DATE_` 2016-06-29) |

**Why the montgomery result is not just a negative.** `Entry_Date` is also the *better* of the two
columns, which is the opposite of the TxDOT/MassDOT pattern where the unused column was better:
it is `esriFieldTypeDate`, while `Received_Date` is a `String(50)` whose values are
format-inconsistent inside one column — its min is `"01/02/2007"` and its max
`"9/9/2022 3:09:09 PM"`, i.e. a lexicographic pair that is not a range at all. Population is a
statistical tie (7,198 vs 7,201). **Standing answer: an unused date column beside the one in service
is a lead, not a defect — three of the five leads this audit chased turned out to be wrong columns
and this one did not. Compare the VALUES on the same rows before concluding either way.**

**Positive control on the montgomery probe (Rule 13).** The probe's scope had to be shown to be the
connector's. Production's oldest is **2021-08-09** against the entry's `recency_days: 1825`
measured from 2026-08-09 = **2021-08-10** (one day, timezone), and production's newest,
**2026-08-05**, is the layer's own maximum. The window is enforced, on this column.

**Correction carried into the desoto record.** Its production reading of "0 records in the last 30
days" is **not** a truncation on our side — the layer's own `max(Date)` is 2026-06-30 over 5,616
rows with `Date` populated on 100% of them, and production carries the identical
2015-01-09 → 2026-06-30 range. That is the source's freshness, and the entry is correct.

**Left open, deliberately:** weld's production floor is the Excel-zero sentinel `1899-12-30` on a
handful of rows (§A2). That is a source-side null rendered as a date and needs a **value-level**
filter, not a column change — a code change, so it is recorded, not taken.

**State of the classification: 38 of 170 entries now declare an explicit kind.** Every entry the
audit flagged as ambiguous is resolved. What remains is the **69 `issued`** spot-checks and then
piece (c).

## S2. 🔴 THE RE-CACHE PIPELINE IS DELIVERING ~2% OF WHAT IT FIRES — this is why no after-state could be measured

The §R after-state was to be measured on 779 pages (massdot 624 · cook-county 127 · butler 16 ·
sheridan 12). All 779 were queued into `dev_refresh_targets` and the first 120 fired. **None
landed.** Measured over the last 40 minutes, across both the 15-minute cron tick and my own batch:

| fired at | fired | HTTP 200 | 503 `BOOT_ERROR` | client timeout at exactly 90,000 ms |
|---|---:|---:|---:|---:|
| 19:45 (cron `dev_refresh_tick`) | 250 | **0** | 55 | 195 |
| 19:53 (this session, `dev_refresh_fire_targets(120)`) | 120 | **0** | 16 | 104 |

**370 fired, 0 collected.** Two independent causes, both measured, neither caused by the §R deploy:

1. **Our client gives up before the server finishes.** `dev_refresh_fire_targets` and
   `dev_refresh_fire_batch` hard-code a **90,000 ms** pg_net timeout. The edge function's own logs
   show ZIP reports completing with **`status_code 200` at 100–155 s** (and `504` past ~150 s), on
   the *pre-deploy* version 196. So a run that SUCCEEDS server-side is discarded client-side and
   never reaches `dev_refresh_collect`. That is 299 of the 370.
2. **Concurrency-driven load shedding.** 250 + 120 invocations each holding a worker for ~150 s
   exceeds what the edge runtime will spin up; it then answers `503 {"code":"BOOT_ERROR"}` after
   ~10.5 s. That is 71 of the 370.

**Isolated positive control — the deploy is exonerated and the runtime is confirmed.** A single
request, fired alone with a 120 s budget, did **not** return `BOOT_ERROR`: it ran and timed out —
`Timeout of 120000 ms reached … HTTP Request/Response time: 119963.721000 ms`. The function boots;
one ZIP simply takes longer than the pipeline allows it. (The 503s also began in the cron batch
fired at 19:45, **six minutes before** the 19:51:52Z deploy, and version 196 was logging 200s at
19:47 — so the failure predates version 197 in both directions.)

**Independent cross-instrument confirmation, and the number that matters.** Counting from the cache
itself rather than from the fires — `development_reports.refreshed_at` per hour over the last ten
hours: **30, 27, 27, 21, 28, 23, 19, 17, 16, 19**. Against ~1,000 fires per hour (250 × four ticks),
that is a **~2.3% collection rate**, and it has been that way all day, not just during this pass.

**What that rate implies, stated so nobody re-derives it:**

- the 779 §R pages need **~39 hours** of wall clock, not a long tail of minutes;
- a full 12,722-ZIP sweep needs **~26 days**, so the "hourly materializer, 8.5 h sweep" mental model
  is wrong at the *cache* layer even though it is right at the *table* layer;
- **this is why TxDOT is still at ~2 of 666 pages** two days after its fix deployed — measured
  cache-wide right now: 27,193 records / 666 pages, of which **27,113 are still dated (99.7%)** and
  1,730 still fall in the last 30 days, both of which are the OLD column's signature. The fix is
  live and correct on the pages that re-cached; the rest have not been reached.

**Not fixed here, and this is the one thing that needs a decision.** Raising the pg_net timeout past
the engine's real runtime (and lowering the batch so the runtime stops shedding) is a change to two
`SECURITY DEFINER` functions behind a scheduled job. It changes no resident-visible content — only
whether a refresh that already succeeded gets stored — but it is a code change to a scheduled path,
so it stops here for a ruling. **Every remaining after-state measurement in this audit is blocked
behind it**, including §R's, TxDOT's remaining 664 pages, Stamford `06907` and Virginia Beach
`23451`.

---

# §T — 🔴 FOUND WHILE MEASURING §R: the EPA facilities layer is being ERASED page by page, and the rolling refresh is what is erasing it

This was not what the pass was looking for. It surfaced because §R's after-state had to be measured
from a fresh engine response rather than from the cache, and that response carried
**`facilities: 0` against a cached 40** on ZIP 82801 (Sheridan WY).

## T1. The instrument, and why the correlation is with TIME and not geography

`development_reports`, every row, grouped by the day it was last refreshed:

| refreshed on | pages | `facilities = 0` | % |
|---|---:|---:|---:|
| 2026-08-02 → 08-06 | 17 | 0 | 0.0% |
| 2026-08-07 | 2,133 | 155 | 7.3% |
| 2026-08-08 | 10,086 | 1,081 | 10.7% |
| **2026-08-09** | **486** | **486** | **100.0%** |

**Every page refreshed today came back with zero EPA facilities — 486 of 486.** Cache-wide the
count now stands at **1,722 pages of 12,722 at `facilities = 0`**, and *all* of them were refreshed
2026-08-07 or later; not one page refreshed before 08-07 is affected. A geographic explanation is
ruled out by inspection of the list: it includes **downtown Atlanta 30312, downtown San Jose 95113
and 95112, Cleveland 44112, Arlington TX 76013** — dense urban cores, several of which the
`facilities > 0` population held a real count for as recently as yesterday (82801 was **40** on
2026-08-08 and **0** on the fresh response today).

## T2. Why a transient upstream failure reaches the cache at all

`dev_refresh_collect`'s transient-safe guard refuses a write on two conditions: *both* dimensions
zero, or *development* zero. **There is no facilities-only guard.** So a page with real development
records and a failed EPA fetch — which is every page carrying a permit source — is written straight
through with its facilities zeroed. That is precisely the class engine v13 was built to prevent
("NEVER treat an FRS non-200 / error / parse-fail as 0 facilities"); v13 hardened the *fetch*, and
this is the *write* path, which was never given the same rule.

## T3. Action taken, and what it is not

**`dev-reports-rolling-refresh` (pg_cron job 14) is PAUSED** (`cron.alter_job(14, active := false)`,
verified `active = false`). It was destroying the facilities layer at the refresh rate — 486 pages
today. Pausing changes nothing a resident sees, is reversible with one flag, and only stops further
overwrites; the corruption already written is *not* undone by it. `app-content-refresh` (job 13) is
deliberately left running — it mirrors, it does not fetch.

⚠️ **This has a second effect that must be stated plainly: the §R re-cache cannot run while the job
is paused.** Stopping an active data loss took priority over completing a measurement. Both need the
same decision.

## T4. What is NOT yet established

Whether the zeros are EPA's outage or ours. A direct probe of the exact endpoint the engine calls
(`ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities`) was fired and had not returned by
the time of this report — **which is itself weak evidence in the same direction, and is recorded as
unreturned rather than as a result.** The distinction matters for the remedy, not for the finding:
either way the *write* path is wrong, because a source that cannot be read must never be recorded
as a source that returned nothing.

**Recovery is available and cheap once the cause is known** — the 1,722 pages are identified by
`counts->>'facilities' = '0'` and can be re-fetched — but re-running the refresh before the fetch is
trusted would extend the damage rather than repair it.
