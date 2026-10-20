# Maine pre-launch audit — 2026-10-20

Scope: the **273 existing Maine ZIP pages** in `public.communities` (`state='ME'`, `level='zip'`,
10 county roots). Control: all 273 are in `canonical_zip_registry`. No page was created, removed or
re-parented. Every number was read from production the same day.

## 1. Inventory and freshness (control: 273 pages, 273 `development_reports` rows)

| check | result |
|---|---|
| pages with a development report | 273 / 273 |
| development refresh within 72 h | 271 |
| pages with a Census ZIP boundary (`geo.n5_serving_status = boundary_complete`) | 273 / 273 |
| EPA facility layer older than 7 d | 1 (York) |
| EPA read marked unavailable (`facilities_unavailable`, page shows "—", not a false 0) | 67 |
| `app_community_meta.data_quality = pass` | 263 |

## 2. Map 1 dots and labels

Maine's development records come from **one source family**, MaineDOT `MaineDOT_OpenData`
MapServer 4 (points) and 5 (lines). Control: on all 273 pages `counts.development` equals the
MaineDOT row count (0 mismatches). Every other Map 1 dot is an EPA FRS facility (`On file`,
Lifecycle unknown, by the 2026-09-24 gate).

| source | rows (ZIP copies) | projects | type on Map 1 | status | no coords | no record URL |
|---|---:|---:|---|---|---:|---:|
| maine-dot-public-projects-lines | 651 | 257 | Roads & infrastructure | Proposed | 13 (1 project, coordinate clamp) | 0 |
| maine-dot-public-projects | 415 | 255 | Roads & infrastructure | Proposed | 0 | 0 |
| EPA FRS facilities | 1,489 | 1,026 | Industrial / energy / logistics overlay | Lifecycle unknown | 0 | 0 |

Future dates up to 2031 are **not** a defect: both entries declare `file_date_kind: "estimated"`
(`conbegin_forecast`, the forecast construction start), which the date-sanity guard exempts.

### Defect: the MaineDOT layer is frozen, and its stale forecasts were drawn as current

- Every cached record carries `2 - Design/Permitting Phase`, because the entry's filter
  `conbegin_forecast IS NOT NULL` admits only that phase (501 of 503). MaineDOT dates the other
  phases with other columns: construction by `conbegin_actual` (73/75 points, 73/79 lines),
  completion by `concomp_actual` (414/414, 597/597); awaiting kick-off has no date.
- **The layer has stopped moving projects between phases.** Today's `reporting_status` counts are
  identical to the 2026-08-05 and 2026-08-23 wire receipts (points 117/503/75/414, lines
  96/366/79/597). Newest actual dates: kick-off 2025-04-18, construction start 2025-04-02,
  completion 2025-05-28. Completions by year (points/lines): 2020 97/127, 2021 83/97, 2022 51/127,
  2023 81/118, 2024 100/124, **2025 2/4, 2026 0/0**.
- Consequence on the pages: of the 512 distinct projects shown as Proposed, **301 had a forecast
  construction start that had already passed, 181 by more than a year**.

**Fix:** `recency_days: 365` on both entries (same rule as Denton #2094, Spokane #2093, SLC #2089).
Tested on the live layers with the connector's exact clause: points 501 → 390, lines 363 → 179.
Measured effect on the cached pages:

- MaineDOT records 1,066 → 624; 170 of 234 pages lose some.
- **51 pages go to 0 development records.** Each is refused once by CORE GUARD 2 and written when
  its last write passes 7 days, so they update within about a week.
- **38 of those 51 drop to `noindex` on the development / Map 1 surface** (fewer than 3 regulated
  facilities, and their only development content was a lapsed forecast): 04431, 04410, 04660,
  04918, 04001, 04029, 04450, 04421, 04573, 04040, 04855, 04495, 04616, 04061, 04987, 04456,
  04862, 04057, 04860, 04422, 04006, 04986, 04435, 04612, 04677, 04459, 04496, 04685, 04079,
  04777, 04949, 04922, 04488, 04427, 04574, 04653, 04917, 04354. The community / Alerts pages are
  unaffected (their robots decision is Rule F).

Not wired, deliberately: separate construction / completed entries dated by the actual columns.
They are well populated, but the layer has recorded no phase change since 2025-05-28, so they
would publish a frozen phase as current.

## 3. Government Notices and Upcoming Meetings

| county | pages | government tile | meetings stored / upcoming | hold reason |
|---|---:|---|---|---|
| Hancock | 40 | delivering (14 notices) | 15 / 0 (newest today) | — |
| Cumberland | 38 | delivering (65) | 59 / 0 (newest 10-19) | — |
| Waldo | 18 | delivering (23) | 21 / 4 | — |
| Androscoggin | 14 | delivering (16) | 23 / 4 | — |
| Penobscot | 47 | dark | — | held: bespoke county site, no adapted platform (2026-08-26/27) |
| York | 36 | dark | — | placeholder row, no source |
| Lincoln | 27 | dark | — | held: AgendaCenter dry run 0 items (2026-08-24) |
| Kennebec | 26 | dark | — | held: no vendor platform found (2026-08-26) |
| Knox | 19 | dark | — | placeholder row, no source |
| Sagadahoc | 8 | dark | — | placeholder row, no source |

110 of 273 pages deliver the government tile; 163 are dark. All six dark counties are source
discovery (C3), not wiring defects. Hancock and Cumberland read 0 upcoming because their newest
meetings were held this week (between sessions, per the 2026-10-19 classes).

**Sanitation:** 0 of 118 meetings and 0 of 118 government notices match
`^(Test|Draft|Placeholder|WorkSession-Draft)`; 0 mention cancellation; 0 fall outside the
730-day meetings / 365-past government-notice windows. Cancelled meetings stay visible with a
badge by founder ruling (2026-10-19), so "Cancel" is not filtered.

## 4. Local News

219 of 273 pages show Local News. The other 54 (Lincoln 27, Knox 19, Sagadahoc 8) are mapped to
4–5 publishers each, including Boothbay Register and Penobscot Bay Pilot, and are delivering
(15 / 7 / 2 stories in the last 14 days). None of those stories carries one of the 12 topics, so
the subtopic gate renders nothing: taxonomy-locked, not a wiring defect.

## 5. Not applicable to Maine

- **County Board of Supervisors / LAFCO fallback:** neither body exists in Maine (county
  commissioners; no LAFCOs). Every Maine ZIP page already cascades to its county root.
- **Network interception (Legistar / PrimeGov / CivicEngage / Azure Blob):** Maine's live
  government sources are Legistar (Cumberland, `cumberlandcounty.legistar.com`), CivicPlus
  iCalendar / AgendaCenter (Androscoggin), CivicClerk (Waldo) and a WordPress archive (Hancock),
  all read server-side by the ingest adapters. No PrimeGov or Azure Blob source is configured.
