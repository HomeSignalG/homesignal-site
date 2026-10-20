# Florida pre-launch audit — 2026-10-20

Scope: the **441 existing Florida ZIP pages** (10 county roots, 0 city communities; all 441 in
`canonical_zip_registry`). No page was created. Every count below was read the same day, with
its control beside it.

| county | ZIP pages | notices | meetings | development sources on Map 1 |
|---|---:|---|---|---|
| Miami-Dade | 80 | 147, newest 10-16 | 123 | Miami permits (22 pages), FDOT |
| Hillsborough | 58 | 31, newest 10-13 | 35 | FDOT |
| Broward | 55 | 51, newest 10-12 | 51 | FDOT |
| **Palm Beach** | 53 | **0 → wired (ingest #775)** | **0 → wired** | FDOT |
| Orange | 49 | 33, newest 10-12 | 36 | FDOT |
| Pinellas | 48 | 35, newest 10-15 | 33 | FDOT |
| Lee | 36 | 26, newest 10-16 | 26 | Lee development orders (32), FDOT |
| Sarasota | 28 | 12, newest 10-06 | 12 | FDOT |
| Collier | 22 | 61, newest 10-19 | 56 | FDOT |
| **St. Johns** | 12 | **0 → wired (ingest #775)** | **0 → wired** | FDOT |

## Committed readiness check (`scripts/audits/county-launch-readiness.sql`, `co = null`)

PASS: 441 pages (control 441) · 0 pages without a Census boundary (control 33,791 ZCTAs) ·
development reports 1 page > 72 h, 0 > 7 d · 396 notices / 372 meetings, newest 2026-10-19 ·
1,662 local news rows, **0 of 441 pages render no Local News** (control 11,204 rendered rows) ·
0 pages render nothing. FLAG: 0 of 165 listed cities has its own source (no FL city communities).
FAIL: EPA facility layer older than 7 days on 19 pages (below).

## Findings and what was done

1. **FDOT road projects labelled "decided" on an estimated finish date — FIXED (this PR, universal).**
   `fdot-active-construction-projects` mapped `decision_date` to `EstEndDate`. When `StartDate` is
   empty, `app_refresh_zip` falls back to `decision_date` and stamps `date_kind = 'decided'`
   (`docs/date-kind-migration.sql`); the generated project page then prints
   "Date on record: … (decided)", and `decisionEvidenceLevel` called the source `date_only`.
   Measured: **577 FDOT rows `decided`, 390 dated in the future (to 2029-01-23)**, control 4,369
   FDOT rows. Six more entries carried the same mapping (UDOT ×2, Clark County NV, Lexington KY,
   Columbia MO, Lake County IL). The registry no longer maps an estimated/end column as
   `decision_date` on any of the seven; rows with a start date are unchanged, rows without one
   are honestly undated. Test `test/estimated-end-is-not-a-decision.test.mjs` (old registry: 16
   failures, exit 1). Takes effect after the engine deploy and each page's next refresh.
2. **St. Johns County had no government source — WIRED (ingest #775).** The Clerk of Court's
   agenda page lists the BCC agenda PDFs; 19 agendas, newest 2026-10-20. Enrollment 358 → 359,
   applied and fingerprinted.
3. **Palm Beach County had no government source — WIRED (ingest #775) from the county's own site.**
   Every vendor tenant is wrong or stale: CivicClerk `palmbeachfl` is the Town of Palm Beach;
   NovusAgenda `palmbeach` returns its error page; Legistar `pbc` and Granicus `pbc` are the county
   but newest 2026-04-27 (176 days, past `GOV_STALE_DAYS = 90`). The rendered-browser probe (run
   39476539991) showed the county moved from pbcgov.org to `discover.pbc.gov`, whose BCC Agenda page
   lists the current agendas as `Agenda_Master/YYYYMMDD.pdf` (newest 2026-10-20). Enrollment applied
   as the live 366 union of concurrent sessions + Palm Beach = 367, fingerprinted before and after.
4. **EPA facility layer stale on 19 pages — EXTERNAL.** All 19 carry `facilities_unavailable`
   (shown as unknown, never as zero). Six were run through the live engine: two now read cleanly
   (33068 → 23, 33760 → 40); four were refused on EPA's own HTTP 502s and connection failures.
   No parse defect (the Utah backslash case does not appear).
5. **Lee development orders with a 2027 "filed" date — self-heals.** 8 rows on 33919 / 33908;
   both pages were last refreshed before today's `date-sanity.ts` deploy (17:22Z).
6. **Map 1 pins — clean.** Data centres: 41 pins on 30 pages via `map1_dc_zip_members`; 0 without
   a name, a known status, a record URL or coordinates; 0 outside their own ZCTA (`ST_Covers`,
   independent of the function); 0 truncated. Development: all 441 pages `boundary_complete` in
   generation `n5-national-2026-10-20` (Miami 11,406 members / 22 pages, Lee 2,672 / 32, FDOT
   601 / 282). Miami maps only `Final` to Operating (issued-permit ruling holds).
7. **Title filtering.** "Test" entries are already dropped at ingest by homesignal-ingest #766.
   Draft / Placeholder / WorkSession-Draft: **0 of 768** stored FL notices + meetings (control =
   396 + 372). Cancelled meetings are not filtered (founder ruling 2026-10-19: badged, kept).
8. **Regional fallback.** Every unincorporated FL ZIP page reads its county commission through the
   chain root. Florida has no LAFCOs (a California body), so there is no regional feed to add.

## Not done, and why

- Development coverage beyond FDOT for Hillsborough, Broward, Palm Beach, Orange, Pinellas,
  Sarasota, Collier and St. Johns: no wireable first-party permit source today (the 2026-07-16
  rejections still stand: Tampa WAF-blocks the engine, Orlando is ungeolocatable, Fort Lauderdale
  is stalled). New-source discovery is a separate pass.
- FL city councils: no city communities exist yet; adding them is a site seed.
- After ingest #775 merges: `load-feeds-to-db.yml` from `main`, then `golive-feed.yml` for the four
  St. Johns / Palm Beach feeds; meetings and notices appear on the 65 pages after that.
