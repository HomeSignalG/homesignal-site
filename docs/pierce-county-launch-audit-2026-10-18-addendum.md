# Pierce County WA: corrected launch verdict and fix record (2026-10-18)

Supersedes the "ready for launch" verdict in `pierce-county-launch-audit-2026-10-15.md`. That verdict
checked only the development permits the work had changed. This file records what the full check found,
what was fixed, at what level, and what still needs a decision. Every figure was measured on 2026-10-18.

## How it is measured now
`scripts/audits/county-launch-readiness.sql` (params `WA`, `Pierce`). First run, before any fix:

| check | value | verdict |
|---|---|---|
| pages | 65 | PASS |
| pages with no Census ZIP boundary | 98344 98395 98397 98401 98411 98412 98413 98415 98442 98464 98492 98497 (all in the national Fix 4 record) | listed |
| development reports older than 72 h / 7 d | 0 / 0 | PASS |
| EPA facility layer older than 7 d | 11: 98402 98411 98412 98415 98421 98464 98466 98467 98497 98498 98499 | **FAIL** |
| pierce-county-pals-permits | 62 pages, newest new row 2026-10-18 | PASS |
| tacoma-accela-permits | 17 pages, newest 2026-10-18 | PASS |
| wsdot complete / under construction / proposed | 50 / 39 / 47 pages, newest 10-02 / 09-08 / 08-15 | proposed FLAG |
| government feeds on the chain | alerts 1/1, meetings 7/7 active | PASS |
| government notices delivered | 22, newest 2026-10-13 | PASS |
| meetings delivered | 21, newest 2026-10-13 | PASS |
| city places with a feed | 0 of 0 (no city community is modelled; government is county-only) | FLAG |
| local news stored | 15, newest 2026-10-15 | PASS |
| pages rendering no Local News / nothing at all | 0 / 0 | PASS |

## 1. EPA facility layer: NATIONAL engine defect, fixed (PR #2012)
- Cause, measured: one FRS record carries a raw TAB inside its address ("…WATER SYSTEM", "7415 CHAMBERS
  CREEK RD W<TAB>"). `JSON.parse` threw, `frsAt` called it TRANSIENT, and every refresh of a ZIP whose
  circle contains that record returned `epa.ok:false`. FRS fetched through pg_net for 98467 at 3 mi returned
  100 KB with exactly one raw TAB; the engine returned `ok:false reason:transient attempts:3` for 98402,
  98411, 98467, 98499, while controls 98404, 98445, 84302, 78617 returned `ok:true`.
- Scope: 1,213 of 12,722 ZIPs nationally had a facility layer older than 7 days, 1,120 of them flagged
  `facilities_unavailable`. Not every one is proven to be this cause; the fix is verified per ZIP after deploy.
- Fix: `parseEpaJson` (sources/epa-frs.ts) also replaces U+0000-U+001F with a space; ECHO uses the same
  function. Tests 6e0-6e4, 6f.
- Note: probing FRS directly in a burst drew HTTP 429 / 502. Do not re-probe FRS in bulk to confirm.

## 2. No-boundary pages: expected, no fix
All 12 are in `docs/maps-coverage/fix4/no-boundary-zip-classification.csv` (8 PO-box, 2 standard with no
Census area, 98442 and 98492 restored as coverage-limited). They correctly show no map area. The six Tacoma
pages that looked thin (98401 98411 98412 98413 98415 98464) are among them.

## 3. County RSS "no new items since 10-13": not a defect
Every item in `piercecountywa.gov/RSSFeed.aspx?ModID=65&CID=All-0` (fetched 2026-10-18) is already stored in
both `alerts` and `meetings`. The newer pubDates are revisions of agendas already ingested.

## 4. WSDOT proposed "no new row since 08-15": not a defect
One WSDOT dataset (Project Delivery Plan, 97 Pierce projects) split by date: proposed = advertisement date in
the future. Rows move between the three layers as dates pass; no new projects were added since 08-15. The
service publishes no edit date, so its freshness cannot be proven. Correction to an earlier answer: proposed
records DO carry a date (a future one); a query that excluded future dates made them look undated.

## 5. City government: COUNTY onboarding, national pattern (cities deferred everywhere). Needs a decision.
Verified first-party sources (pg_net, 2026-10-18):
| city | source | state |
|---|---|---|
| Tacoma | Legistar webapi tenant `cityoftacoma` | live: 18 events Oct-Nov 2026, 4 City Council |
| University Place | CivicPlus `cityofup.com/RSSFeed.aspx?ModID=65&CID=All-0` | live, 7 items, advisory commissions: needs CID scoping to the council |
| Puyallup, Gig Harbor, Fife, DuPont | CivicPlus Agenda Creator RSS | empty envelope (0 items): try AgendaCenter HTML / Calendar.aspx |
| Lakewood, Sumner | not CivicPlus (404) | vendor not yet identified |
| Bonney Lake | no response | not yet identified |

Why it is not armed here: arming needs (a) city community rows and a ZIP-to-city assignment (Pierce ZIPs
today parent straight to the county; a ZIP like 98444 is part Tacoma, part unincorporated Parkland, so putting
it under Tacoma would show Tacoma's council to Parkland residents), (b) feed rows in `feeds.csv` and
`public.feeds` with `jurisdiction_slug`, (c) meetings enrollment in both halves of the gate, and (d) a runner
dry run per feed. (b)-(d) are the Upcoming Meetings session's area (ingest Rule #0a). The ZIP-to-city
assignment is the decision.

## 6. Local news: REGISTRY gap. Needs a Gold Master revision (founder approval).
The registry maps exactly two endpoints to all 65 Pierce ZIPs: `api-weather-gov-b48b17e6` and
`cascadepbs-org-c1082a7d`. Candidates:
- Already in the registry, mapped to no Pierce ZIP: Seattle Times (`seattletimes-com-561624e7`), MyNorthwest
  (`mynorthwest-com-a292fbf0`). Mapping them adds no endpoint.
- New, verified live: Gig Harbor Now `gigharbornow.org/feed/` (21 items, newest 2026-10-14); KNKX
  `knkx.org/sitemap.xml` (263 entries, newest 2026-10-18).
- New, unverified: The News Tribune `thenewstribune.com/sitemap/story/googlenews.xml` (pg_net: HTTP/2 stream
  error; same McClatchy shape as the registry's working theolympian.com entry, verify from a runner).
- Rejected: tacomaweekly.com/feed/ (404), thesubtimes.com/feed/ (a "Website Update" page, not a feed),
  piercecountyherald.com (SSL error).
Workbook data changes originate in the repo, but adding endpoints requires the approved workbook first.

## Out of scope, recorded
- OpenStreetMap data-centre layer is a one-time load (2026-09-15); national, known (§7.09 retirement condition).
- Map 1 data-centre markers on Pierce: 1 (Centeris, OSM, 98374). Epoch and Compute Atlas: none published.
