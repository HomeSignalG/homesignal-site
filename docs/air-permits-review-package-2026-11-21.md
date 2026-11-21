# Air permits & filings — review package (2026-11-21)

Nothing here is applied, activated, deployed or sent. Status: shared foundation PREPARED; Texas acquisition BLOCKED pending the approvals in section 1.

## 1. Texas source feasibility

Evidence already on file (homesignal-ingest `docs/air-permit-coverage-audit-2026-11-21.md`, PR ingest#1156):

| route | finding | kind |
|---|---|---|
| NSR project status search (`www2.tceq.texas.gov/airperm`) | robots.txt `Disallow: /` | **restriction on automated access** |
| Central Registry query (CR Query) | robots.txt `Disallow: /` | **restriction on automated access** |
| data.texas.gov (Socrata) | no air-permit dataset found | **no route exists** |
| Records Online / Central File Room document by dID | PDFs answer 200; host robots.txt answers 404 | accessible by ID; **no discovery, no incremental refresh** |
| EPA ICIS-Air / RBLC | not checked for 185303; major-source oriented | **not substituted**: coverage of standard-permit registrations unverified |

Not established: whether Records Online has a machine-usable search or feed; TCEQ's reuse/automated-access terms; whether 185303 is in any federal dataset. These are exactly what the probe decides. A different hostname is not treated as permission.

### 1a. Proposed read-only probe (REQUIRES YOUR APPROVAL — not run)
- Runner: GitHub Actions `workflow_dispatch` from `main`, no secrets, no database key, read-only. New workflow file would be its only repo write.
- Identification: the repo's honest user agent, unchanged. No header spoofing.
- Request ceiling: **25 GET requests total, one at a time, 5 s apart, one retry on a 5xx only, never on 403/429.** Stop at the first 403/429.
- Requests (exact):
  1. `GET https://www.tceq.texas.gov/robots.txt`, `GET https://www2.tceq.texas.gov/robots.txt`, `GET https://records.tceq.texas.gov/robots.txt` (3). Records the exact bodies and status.
  2. `GET https://www.tceq.texas.gov/permitting/air` and its "NSR permits" and "data" subpages (≤4): look for a published bulk file, feed, or terms page.
  3. `GET https://www.tceq.texas.gov/` pages titled "Open Data" / "Public Information" / "Terms of use" (≤4).
  4. The two known document URLs (dID 10258370, 10258371) once each, headers only then body (2 + 2): confirm the permit number, project number, action date and any coordinates are in the text.
  5. The Records Online search entry page, **GET only, no form submission** (1), and its robots/terms. If a search needs a POST, the probe stops there and reports; it does not submit.
  6. A single query of data.texas.gov catalog `https://api.us.socrata.com/api/catalog/v1?domains=data.texas.gov&q=air%20permit` (1).
- Output (job log only): per URL status, `Content-Type`, robots verdict, and for the PDFs the extracted identifiers; a table "discovery? incremental? coverage of standard permits? geography? status? terms?" with the evidence line for each cell.
- Decision rule: if any robots file disallows the path, that route is recorded RESTRICTED and not tried. If no compliant discovery route exists, section 1b is the outcome.

### 1b. Bulk/export request — DRAFT FOR YOUR REVIEW (not sent)
> To: TCEQ Air Permits Division / Public Information (address to be confirmed by you).
> HomeSignal publishes public-records maps of development and environmental filings. We ask for a published or supplied export (CSV/JSON or an open-data dataset), with a documented refresh cadence, of New Source Review air permit applications, standard-permit registrations, permits, and amendments, with: permit and project numbers, regulated-entity (RN) and customer (CN) identifiers, action type and status, received and action dates, county, street address or coordinates where held, and the public record URL. We want to link each row to its public TCEQ record. We will honor any stated terms or attribution. Please also tell us whether automated access to Records Online is permitted and by what route.
Per your standing rule ("we do no manual sends") it is a draft only; how it is delivered is your call.

Remaining approval needed: (A) approve the 1a probe as written, or (B) approve sending/using 1b.

## 2. Report integration (prepared, not wired)
- Report = **0.5-mile circle around the address** (`REPORT_RADIUS_MI`), stored as an immutable snapshot. It is not a whole-ZIP product.
- Reader: `map1_air_permits_near` computes exact great-circle distance on stored points, capped at 20 mi. It is correct for the address circle. It is NOT a ZIP-boundary reader; a whole-ZIP report must call `air_permits_for_zip` (polygon rule). Records with no point are excluded from the circle by construction; the section states that.
- Prepared: `supabase/functions/_shared/report-air-permits.ts` (reader, fail-closed; section builder) and `test/report-air-permits.test.mjs` (10 fixture checks). Air permits stay out of every development count.
- NOT done, needs approval: wiring into `assemble()` / `readReportInputs`, bumping `REPORT_VERSION`, snapshot hash and PDF template, then deploying get-development-activity-report, follow-development-report, run-property-watch, manage-property-watch. Not authorized by this message.

## 3. SQL review package (`docs/air-permits.sql`, 5 tables, 6 functions)
- **Tables**: sources, states, runs, records, record_observations. RLS: no visitor grants on tables; all reads through security-definer readers.
- **Writer**: `air_permits_ingest` — service_role only; refuses non-`active` sources, missing stable id/number, non-https link, uncontrolled `action_kind`, point without stated basis. Activation = `access_status` set to `active` (a separate, explicit act); Texas ships `blocked`.
- **Readers**: `air_permits_for_zip` (polygon members), `map1_air_permits_near` (circle); anon/authenticated/service_role may execute; nothing else.
- **Dedup/update**: record key per source+permit; history row only when a field changed (append-only observations, frozen by trigger).
- **Complete/stale/removed**: only a `complete` run refreshes freshness or marks absent records removed; `max_age_hours` makes a source `unavailable`; blocked sources never read as none.
- **Missing coordinates**: stored, county-counted in the ZIP reader, never placed or guessed; circle reader excludes them.
- **Interaction**: no existing table touched; separate from water rights and `app_projects`; air records never counted as development.
- **Affected consumers once applied**: Map 1, ZIP page section, `development.html` (all read the readers; empty until a source is active). Report: none until wired.
- **Replica dry-run plan** (needs separate approval): disposable PostGIS container only (the §7.11 shape), apply file, run `test/air_permits_pg` (42 checks, 16 mutations), apply twice, run rollback block, confirm catalog signature returns to start. No DDL against production, even rolled back.
- **Rollback**: file footer (drop functions then tables); safe while no source is active, since nothing else depends on them.
- Separate approvals still needed: (1) replica execution, (2) production application with exact target and actions.

## 4. Testing status (kept separate)
- Fixture/unit: `air-permits`, `report-air-permits`, cache-key tests pass locally. These use labelled fixtures; **no real TCEQ record has been ingested**.
- Disposable-Postgres suite: green in CI on the PR.
- Browser tests: CI `browser` job and `membership` still running at last look; no failure observed yet. Not run locally.
- Real-source validation: none. Public verification: none (nothing deployed).

## 5. Status
- Shared foundation: prepared (not national).
- Texas acquisition: blocked.
- Texas ingestion/backfill: not tested.
- Surfaces: Map 1, ZIP page, QoL code done and fixture-tested; report prepared, not wired.
- Deployment/public verification: not done.
