# Utah pre-launch audit — all 310 ZIP pages (2026-10-20)

Read-only measurements against production, taken 2026-10-20 with the committed check
`scripts/audits/county-launch-readiness.sql` (params `'UT', null`, every county). Every number below
came from a query run that day; controls are in the right-hand column of the check's output.

## Verdict by area

| area | result | control |
|---|---|---|
| Pages | 310 ZIP pages, 29 county roots, 21 city communities | `communities` state UT |
| Development reports | 0 older than 72 h | 310 rows |
| **EPA facility layer** | **FAIL: 14 pages older than 7 days**, 8 of them since 2026-08-23..27 | 310 rows |
| **Development sources** | **FAIL: `slc-planning-petitions` newest filing 2020-06-09** | 4 sources, 12 SLC pages |
| Government feeds | alerts 367/395 active, meetings 393/398 active | 793 feeds |
| Government notices | 1,851 rows, newest 2026-10-20 | |
| Meetings | 1,663 rows, newest 2026-10-20; every county root has a meeting dated within 15 days | |
| Local news | 6,061 rows, newest 2026-10-20; 0 of 310 pages without a Local News item | 7,644 rendered rows |
| Pages rendering nothing | 0 | |
| **City councils read** | **FLAG: 193 of 214 cities listed on the pages have no source**; 29 of 310 pages list a read city | 320 page-city pairs |
| Map 1 serving generation | `n5-national-2026-10-20` on all 310; 292 boundary_complete, 18 not_measured (Fix 4 class) | |
| Map 1 development dots | 4,165 (UDOT lines 3,253 · UDOT points 155 · SLC 570 · Provo 187) | |

## Finding 1 — Salt Lake City planning petitions are a frozen 2020 snapshot (FIXED, this PR)

`Planning_Petition/FeatureServer/0` (pg_net 8704/8705, 2026-10-20): 3,113 rows, `max(AppliedDate)` =
2020-06-09, 636 still `Active`. Production drew 570 of them on 11 Salt Lake City ZIP pages, **538 as
Proposed**, filed 1982–2020. Nothing upstream has changed since mid-2020 (the city takes planning
applications in Accela Citizen Access, which publishes no open layer; the org catalog has no live
replacement: `ActivePermitProjects` is 9 small-cell permits, `Rezone_Petitions` last edited 2023).

Fix: `recency_days: 365` on the entry (filter on `AppliedDate`). The entry emits nothing until the city
files again, and then shows the new filing with no further change. No page loses all development: each
of the 12 affected ZIPs keeps 28–331 UDOT records (so the "never zero a page" guard is not involved).
Takes effect after the edge function is deployed and each page's next rolling refresh, then the next
N5 generation for Map 1.

Why no gate saw it: the readiness check's source test used `created_at`, which re-materialization keeps
fresh (SLC rows read 2026-08-15). Check 14 now reads the newest **filing** date and FAILs a source older
than 365 days; on this run it flags SLC alone.

Seen outside Utah, not touched here (same shape, newest filing > 365 days, still carrying Proposed):
`cabarrus-county-plan-reviews` (20,819 Proposed, newest 2025-04-03), `nj-stip-projects` (815, 2023-03-24),
`clark-county-active-projects` (449, 2023-11-26), `denton-county-dev-permits` (2023-06-06). DOT
programme lists dated by creation can be legitimately old; each needs its own look.

## Finding 2 — EPA facility layer frozen on 8 Utah pages by unparseable EPA records (FIXED, this PR)

Every refresh of 84078 (Vernal) and 84602 (Provo) returned `epa.ok:false reason:transient` with
`SyntaxError`. Captured bodies (pg_net 8906, 8971) fail `JSON.parse` after both existing repairs, at:

- FRS 110012372477, LocationAddress `"UINTAH & OURAY RESERVATION\"` (Vernal, 3 mi)
- FRS 110070713364, FacilityName `"REIMSCHUSSEL ESTATES, PLAT \B\"` (Provo, 2 mi)

A value ending in a raw backslash turns its closing quote into an escaped quote. `parseEpaJson` now
doubles an odd backslash run before a quote that is followed by the next key or the end of an
object/array. Both real bodies parse (376 and 655 records). Test: `test/epa-result-semantics.test.mjs`
6e5–6e8, including controls that valid escaped quotes and an escaped trailing backslash are unchanged;
removing the repair fails the file.

The other 6 stale pages (84014, 84094, 84111, 84128, 84404, 84415) are 7–14 days old and showed 429 /
process-limit failures in the same window (EPA's 6 requests/minute limit); re-check after the deploy.

## Finding 3 — 193 of 214 Utah cities' own councils are not read (PLAN)

Counties are read from Utah PMN (13 body readers per county). City councils are read for 20 cities
(Utah County, Box Elder, Bluffdale). Unread and largest: Salt Lake City (16 pages), West Valley City (7),
Millcreek (6), West Jordan (5), Ogden (5), Sandy (5), Murray, Logan, Draper (4 each), St. George (3).
Every Utah city posts to PMN, so this is the Pierce/King pattern: a city community (site seed) plus two
PMN readers per city (ingest), enrolled for meetings.

**Step 1 done 2026-10-20** for those ten (`docs/utah-city-communities-seed.sql`, applied; ingest
HomeSignalG/homesignal-ingest#752; meetings enrollment 343 -> 353 applied in production, md5 95b8e739 equal
to `ingest.py`). The other 183 cities are the next tranches, largest first.

## Finding 4 — Eagle Mountain (84005) had no county on its chain (FIXED 2026-10-20)

The Eagle Mountain city community had `parent_id` null, so ZIP 84005 inherited only the city and never
Utah County. Before the fix it had 0 users and 0 subscriptions. Production migration
`eagle_mountain_city_parent_utah_county_20261020` set the parent to Utah County
(`625a808d-74f0-491a-95a7-0d7ebd1e3761`). It was guarded: it refused unless the row was still a city
with a null parent. `app_refresh_zip('84005')` then ran. `zip_government_bodies('84005')` now lists Utah
County and Eagle Mountain, and the page carries 9 Utah County government notices and 6 local news items.

## Finding 5 — Tremonton's meetings stopped on 2026-08-07: the city moved websites (FIXED in ingest)

All 4 Tremonton meetings readers read `tremontoncity.gov/events/feed/`, and nothing new arrived after
2026-08-07. The rendered-page probe (homesignal-ingest run 39468226933) found the city's new site loads
its agendas from `https://tremontoncity.gov/api/agendas` (JSON). homesignal-ingest#752 adds the
`agenda_api_json` parser and points the 4 readers at it. Its dry run (run 39470296440) read 7 real
meetings dated 2026-10-07 to 2026-10-21. The city's 7 news readers on `/feed/` also return nothing now.
The new site's equivalent is `/api/mayor-posts`. They are left as they are, because Tremonton's
government notices still arrive from PMN.

## Re-check after the fixes (2026-10-20 ~18:00 UTC)

- **SLC (check 14):** 25 ZIPs were refreshed through the deployed engine. Every SLC report came back
  without `slc-planning-petitions` sites, and after `app_refresh_zip` **0 rows remain on any page**
  (12 ZIPs before). Map 1 draws from the N5 serving generation, so its dots drop on the next daily
  build.
- **EPA (check 4):** 4 of the 14 stale pages refreshed (84014, 84078, 84079, 84603). The other 10 got
  answers that EPA refused (`429` / process limit), so their stored layer is kept and marked unknown. It is
  never written as zero. The rolling refresh retries them. Firing more requests at a rate-limited EPA
  would only make it worse.
- Readiness check after the refresh: development reports 0 pages older than 72 h. Notices, meetings and
  local news are all current to 2026-10-20. No page renders nothing.

## Not defects (checked)

- **Brigham City meetings** look empty on the city page in plain HTML (1 link; 67 once the page runs in a
  browser), but the reader stores the agenda PDFs from `aptg.co`: 56 meetings, newest stored 2026-10-09.
- **Iron County's commission archive** reader is thin (newest stored 2026-07-29), but Iron's notices
  arrive from PMN: 43 rows, newest 2026-10-15.
- **Weber's commission page** lists 5 "test new server" PDFs. The placeholder rule sets them aside.

- **Stratos AI Data Center Campus** is withheld from Map 1: Compute Atlas gives `41.5, -113.5`, a rounded
  area point (`GEOGRAPHY_UNRESOLVED`, `ROUNDED_COORDINATES`/`PUBLISHER_AREA_POINT`). That is the
  canonical geography contract failing closed, not a missing dot.
- **Wayne County's 6 pages show no "Government & civic" rows**: its recent notices are all Planning &
  Zoning, which render under "Planning & zoning" (6 rows on 84747).
- **Provo's 187 records are "unclassified"**: the layer has no type column (fields read 2026-10-20), so
  Map 1 classifies by name. Status mapping uses the source's own 21 stage words.
- **UDOT "Proposed" items dated 2011–2014**: UDOT's own `pin_stat_nm` today (pg_net 8707: 637 Proposed
  lines, newest 2026-10-20). Source truth, current.
- **Meetings with 0 upcoming** in 12 rural counties: newest meeting is within 15 days in every one
  (between sessions; PMN posts about a week ahead).
