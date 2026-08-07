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
