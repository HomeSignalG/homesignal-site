# Official-record reconciliation — scoped proposal (2026-11-21)

**Status: proposal only. Nothing is built or scheduled. Tab 2 coverage for this stays "not measured".**

## What it would prove
For a named source, inside a declared scope (a ZIP boundary or county) and date window: every record the official system lists is either on JODY, or is explained (too recent for ingest, or deliberately excluded), and every JODY record from that source still exists officially. It validates only that declared scope, never a ZIP as a whole.

## Which sources have a system we can query
Measured from `supabase/functions/get-address-report/jurisdiction-registry.json` (2026-11-21): 261 development sources with a public record-level query endpoint that the engine already reads: ArcGIS 230, Socrata 24, CKAN 3, and one each of CSV, Carto, OpenDataSoft and county cases. Government meetings and notices (`public.feeds`, 2,944 active) come from vendor APIs and pages (CivicClerk, Legistar, PrimeGov, CivicPlus, PMN, notice lists).
Not yet established, and not assumed: which of the 261 expose a stable record id, a filing date and a geometry or ZIP column (needed to compare), and which meetings sources list a complete calendar. The first pass has to classify each source as comparable or not comparable; sources behind a block page (403) are not comparable and are not worked around.

## Comparison method
1. Official side: count and key list for the scope and window (`returnCountOnly` plus paged ids for ArcGIS, `$select=id` for Socrata, the equivalent for the others). Boundary comes from `geo.zcta_boundary`; the window is the source's own recency window.
2. JODY side: `app_projects` keys for the same source, scope and window, frozen with a fingerprint before the official read (the pattern in homesignal-ingest PR #1153, built by the ingestion session and not yet dispatched).
3. Per record: MATCHED · OFFICIAL_ONLY_RECENT (inside the ingest lag, not a defect) · OFFICIAL_ONLY_OLD (a candidate gap) · JODY_ONLY (removed upstream or outside scope) · NOT_COMPARABLE (no key, or the window cannot be queried).
4. A read that does not complete is UNVERIFIED_INCOMPLETE and never samples; it is never reported as clean.

## Cadence and cost (estimates, not measurements)
- Subscriber ZIPs weekly; every other source-scope on a rotating schedule, each at most once a week or month.
- The pilot caps itself at 8 GETs of 30 s each and a 15-minute job. A full pass of 261 sources at about 4 to 8 requests each is roughly 1,000 to 2,000 requests, spread over the rotation. Database cost is reading keys from `app_projects`; no new fetch by the ingest run.

## Smallest first slice
Run the existing 85083 / Phoenix building-permits pilot (ingest PR #1153: one source, one ZIP, frozen JODY keys, at most 8 GETs; it needs its own approval token and has not been dispatched). If it reports a verdict, add 64166 (Kansas City MO, which has a registered ArcGIS source) with the same method. That gives one real comparison on each subscriber ZIP before anything is scheduled.

## Where results would show in Tab 2
A new "Official-record reconciliation" section: one row per source-scope with the five counts above, the date of the last complete read, and a verdict (verified for that scope, gaps found, unverified incomplete, not comparable). The headline is a count, "N of 261 sources reconciled in the last 14 days", and it reads "not measured" until the first complete run. A gap becomes a Tab 2 finding (`RECONCILIATION_GAP`) with the missing record ids.

## Decisions needed
1. Owner for the recurring job (the ingestion session owns #1153; scheduling it is new scope).
2. Approval to dispatch the #1153 pilot.
3. Whether OFFICIAL_ONLY_OLD should page (a finding) or only be listed.
