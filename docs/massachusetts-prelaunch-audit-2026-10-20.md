# Massachusetts pre-launch audit — 2026-10-20

Scope: the **627 existing MA ZIP pages** (`communities.state='MA' and level='zip'`), all in
`canonical_zip_registry`, all materialized, all with a `development_reports` row. No page was
created. Every figure below comes from a query run on 2026-10-20 with its control beside it.

## 1. Live render (Playwright)

`verify-communities` run `39466444914` (main `5f19eb1`, 17:29→18:19Z): Chromium walked **12,722**
materialized pages including all 627 MA, **0 failed**, 49/49 ZIP-coverage panels correct,
0 cross-state violations. The sandbox cannot reach the site, so the runner is the instrument; a
second full-corpus walk was not started (CLAUDE.md: never stack full-corpus verifiers).

## 2. Map 1 pins

| check | result |
|---|---|
| serving generation | `n5-national-2026-10-20` ACTIVE |
| pages `boundary_complete` | 500 |
| pages `not_measured` | 127 — exactly the Fix 4 no-boundary class: md5 `7f5a39a2…` in the DB equals the md5 over `docs/maps-coverage/fix4/no-boundary-zip-classification.csv` (98 PO box, 22 single-org, 4 standard-no-ZCTA, 3 dataset-flagged) |
| member pins | 9,165 on 476 pages (6,672 projects) |
| pins with no point | 0 |
| pins outside their own ZIP polygon (independent `ST_Covers`) | **0** |

Labels: every drawn MA project carries a mapped Type except 49 MassDOT projects whose `Proj_Type` is
**null at the source** (left unclassified, never guessed). Boston and Cambridge permits are typed
`Development` ("Other project") by their registry entries — generic but not wrong; a richer Type needs
a per-source column probe and is left as a follow-up.

## 3. Development / permit freshness

| source | MA pages | newest row | newest filing |
|---|---:|---|---|
| massdot-highway-projects | 624 | 2026-09-11 | *2050-10-02 — see FIX 1* |
| data.cambridgema.gov | 24 | 2026-10-20 | 2026-10-05 |
| worcester-building-permits | 9 | 2026-10-19 | 2026-10-16 |
| data.boston.gov | 29 | 2026-10-19 | 2026-10-16 |

0 permit rows with a future filed/issued date; 0 rows without coordinates. Core report refresh:
4 of 627 older than 72 h, 0 older than 7 d.

**EPA facility layer: 50 of 627 pages older than 7 days** (oldest 2026-08-17, mostly dense Boston /
Cambridge ZIPs). All 50 carry `facilities_unavailable = true`, so the page shows the count as unknown,
never a false zero. This is the national EPA throughput issue (CLAUDE.md, 2026-10-18/19: recovering at
~200 writes an hour; do not drain the queue). FLAG, not hand-patched.

### FIX 1 — a 2050 placeholder date on 341 MassDOT projects (homesignal-site)

341 MassDOT design-stage projects carry `ScheduledAdDate` **2050-10-01/02** on 537 of 627 MA pages
(20,790 page rows). Nationally, every real future schedule ends at **2042-07-07**; nothing is dated
2043–2049. `sources/date-sanity.ts` now refuses a date of any kind more than **20 years** ahead
(the record stays; the date moves to `file_date_refused`). Names no source; also catches a
`decided 9999` sentinel (Champaign IL, which #2100's year-2100 rule already caught). #2100 had called 2050-10-02 a real
plan; the founder ruled it a placeholder on 2026-10-20, and #2100's test now expects it withheld. Test: `test/massachusetts-prelaunch-2026-10-20.test.mjs`.
Takes effect as the rolling refresh revisits each ZIP after the engine deploy.

## 4. Government notices and meetings

Only **Plymouth** County delivered (21 notices, 21 meetings, newest today). Of the other ten:

- **Middlesex, Worcester, Essex, Hampden, Berkshire, Suffolk, Hampshire** — county government abolished
  (CLAUDE.md "MA/CT/RI/VT"); their pages need per-town communities on the site side. Unchanged.
- **Barnstable, Norfolk, Bristol** — real elected county governments, held with `source NULL`. Probed
  their own sites through pg_net:

### FIX 2 — Barnstable and Norfolk Government Notices (homesignal-ingest)

- **Barnstable:** the county's own WordPress iCalendar `capecod.gov/events/?ical=1` carries the Board of
  Regional Commissioners and the Assembly of Delegates. Read by the existing `civicplus_ical` adapter;
  the feed filter drops outreach events (nurse clinics, SHINE talks).
- **Norfolk:** the Commissioners' own Agendas & Minutes page; `dated_pdf_links` reads only Commission
  agenda files with a full date (44 in the last 365 days, newest 10‑21‑2026), excludes the Advisory
  Board, Finance Committee, quorum notices and the draft. One county file is misdated 2029 (uploaded
  2023); the shipped 730-day window drops it.
- **Bristol:** host failed TLS from pg_net; stays held.

Not applicable to MA, stated rather than skipped: LAFCO feeds (a California institution) and
"unincorporated ZIP fallback" (every MA ZIP lies in an incorporated city or town). No MA source uses
Legistar, PrimeGov, CivicClerk or Azure blob agendas.

## 5. Local News

Every page's empty Local News section matches its stored data: pages rendering no news belong to
roots with **0 in-window topic-tagged rows** (e.g. Middlesex 32 in window, 0 tagged), and all 627
pages were re-materialized today. That is the 12-topic gate working (taxonomy-locked, not wiring).

## Verdict

Wiring is functional on all 627 pages. Two fixes shipped. Open, recorded: EPA staleness (national),
per-town government for the seven abolished-county counties (site work), Bristol County source,
generic Boston/Cambridge Type.
