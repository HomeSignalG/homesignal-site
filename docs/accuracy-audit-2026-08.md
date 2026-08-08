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
