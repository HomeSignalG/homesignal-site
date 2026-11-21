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

### 1a. Option A probe — EXACT PLAN AWAITING YOUR APPROVAL (prepared, NOT run)
**APPROVED 2026-11-21 as written, with the conditions in section 9.** Files live in a SEPARATE probe-only PR (branch `claude/tceq-air-probe-only`, not #3104): `.github/probes/tceq-air-feasibility-probe.mjs`, `.github/workflows/tceq-air-feasibility-probe.yml`, `test/tceq-air-feasibility-probe.test.mjs` (19 offline checks). The earlier copies were removed from #3104.
- **Run:** GitHub Actions `workflow_dispatch` from `main` only, input `confirm` must equal `RUN-TCEQ-PROBE`. Permissions `contents: read`. No secrets, no database, no writes; output is the job log. 15-minute timeout. It cannot start until this PR is merged (a separate approval) and you give the confirm string.
- **Command:** `node scripts/tceq-air-feasibility-probe.mjs` after `node test/tceq-air-feasibility-probe.test.mjs`.
- **Hard limits, enforced in code:** GET only (never POST or a form); one request at a time, ≥ 5 s apart; **25 requests maximum** including robots files; honest fixed User-Agent `HomeSignal-source-feasibility/1.0 (+https://jodytracks.com; read-only; contact via site)`, never changed; one retry on 5xx only; **stop at the first 403 or 429** (recorded as an access refusal, not retried); every non-robots URL is checked against its host's robots.txt first and a Disallow is recorded `RESTRICTED` and **not fetched**; a host with no robots.txt is recorded as "none answered", not as permission.
- **Exact requests (≤ 16 expected):**
  1. robots.txt of: `www.tceq.texas.gov`, `www2.tceq.texas.gov`, `records.tceq.texas.gov`, `data.texas.gov`, `api.us.socrata.com` (5).
  2. `https://www.tceq.texas.gov/permitting/air` (1).
  3. `https://api.us.socrata.com/api/catalog/v1?domains=data.texas.gov&q=air%20permit&limit=20` (1).
  4. `https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH_GET_FILE&Rendition=Web&dID=10258370&searchType=External` and the same with `dID=10258371` (2).
  5. `https://records.tceq.texas.gov/cs/idcplg?IdcService=TCEQ_EXTERNAL_SEARCH` — Records Online search entry page, GET only, never submitted (1). If that exact seed is wrong it is recorded as such; the probe does not guess further paths.
  6. Up to **6 same-allowlisted-host links** found on the TCEQ air page whose text or path matches open data / bulk / download / dataset / terms / permit status / NSR / public notice / RSS / feed / API, robots-checked first (≤ 6).
- **Output (job log between BEGIN/END RESULT):** per URL: status, content type, robots verdict and rule, bytes, title; for the two PDFs: whether `185303` and `414660` appear, plus up to 12 matching lines (RN, county, latitude/longitude, action, registration) so location evidence is visible; the Socrata catalog hit list; the discovered links.
- **What the probe can and cannot settle:** it can show whether a documented bulk/feed/dataset exists on these pages, whether any path is robots-restricted (exact rule quoted), whether the PDFs carry identifiers, status/action and location, and what terms text is published. It cannot prove incremental refresh on Records Online without a search submission, which it will not make; if the pages offer no feed or documented data route, that is recorded and **option B (1b) is the fallback**. Retrieving the two known PDFs alone is not recorded as a working ingestion source.
- **Restrictions that apply:** TCEQ's NSR search and CR Query send `Disallow: /` (evidence in ingest#1156); the probe re-reads robots and will not request a disallowed path. Different hostnames are not treated as permission.
- **Needs from you:** approve this plan as written (and, separately, merging this PR so the workflow can run from main).

### 1b. Bulk/export request — DRAFT FOR YOUR REVIEW (not sent)
> To: TCEQ Air Permits Division / Public Information (address to be confirmed by you).
> HomeSignal publishes public-records maps of development and environmental filings. We ask for a published or supplied export (CSV/JSON or an open-data dataset), with a documented refresh cadence, of New Source Review air permit applications, standard-permit registrations, permits, and amendments, with: permit and project numbers, regulated-entity (RN) and customer (CN) identifiers, action type and status, received and action dates, county, street address or coordinates where held, and the public record URL. We want to link each row to its public TCEQ record. We will honor any stated terms or attribution. Please also tell us whether automated access to Records Online is permitted and by what route.
Per your standing rule ("we do no manual sends") it is a draft only; how it is delivered is your call.

Remaining approval needed: (A) approve the 1a probe as written, or (B) approve sending/using 1b.

## 2. Report integration (prepared, not wired)
- Report = **0.5-mile circle around the address** (`REPORT_RADIUS_MI`), stored as an immutable snapshot. It is not a whole-ZIP product.
- Reader: `map1_air_permits_near(lat, lng, radius, state, county)`, capped at 20 mi. It is the address-circle reader, NOT a ZIP-boundary reader (a whole-ZIP report calls `air_permits_for_zip`).
- **Radius rule (revised 2026-11-21, same predicate as development):** `n5_projects_within_radius` tests development geometry with `ST_DWithin` on the true geometry as geography, so a shape that only partly crosses the radius is included. Air permits reuse that predicate. A record with a VERIFIED footprint (`air_permit_footprints`: `verified_boundary` or `verified_parcel`, each with an https evidence link and a named verifier) is judged by its footprint alone, over all its parcels; a point-only record by its point. One row per record, with `matched_by` and `distance_mi`. A city/ZIP/county location has no basis in the schema and ingest refuses one.
- Records with no point and no footprint cannot be tested; the reader counts them for the subject's county and the report says e.g. "1 air permit in Cameron County has no mapped location, so it could not be tested against this distance and is not listed."
- Footprints are written only by `air_permit_footprint_set` (service_role, reviewed, replaces a record's footprints atomically). Nothing populates them automatically yet. The ZIP reader still counts footprint-only records as unlocated (conservative disclosure); extending it to footprints is not done.
- SpaceX 185303 / 414660 location: **no real location is stored anywhere.** No production record exists. The only record is a labelled FIXTURE with a reviewed-point stand-in near Boca Chica; its true coordinates, parcel or boundary are unverified (the PDFs have not been read) and no source for it has been established.
- Prepared: `supabase/functions/_shared/report-air-permits.ts` (reader, fail-closed; section builder) and `test/report-air-permits.test.mjs` (13 fixture checks). Air permits stay out of every development count.
- NOT done, needs approval: wiring into `assemble()` / `readReportInputs`, bumping `REPORT_VERSION`, snapshot hash and PDF template, then deploying get-development-activity-report, follow-development-report, run-property-watch, manage-property-watch. Not authorized by this message.

## 3. SQL review package (`docs/air-permits.sql`, 6 tables, 7 functions)
- **Tables**: sources, states, runs, records, record_observations. RLS: no visitor grants on tables; all reads through security-definer readers.
- **Writer**: `air_permits_ingest` — service_role only; refuses non-`active` sources, missing stable id/number, non-https link, uncontrolled `action_kind`, point without stated basis. Activation = `access_status` set to `active` (a separate, explicit act); Texas ships `blocked`.
- **Readers**: `air_permits_for_zip` (polygon members), `map1_air_permits_near` (circle); anon/authenticated/service_role may execute; nothing else.
- **Dedup/update**: record key per source+permit; history row only when a field changed (append-only observations, frozen by trigger).
- **Complete/stale/removed**: only a `complete` run refreshes freshness or marks absent records removed; `max_age_hours` makes a source `unavailable`; blocked sources never read as none.
- **Missing coordinates**: stored, county-counted in the ZIP reader, never placed or guessed; circle reader excludes them.
- **Interaction**: no existing table touched; separate from water rights and `app_projects`; air records never counted as development.
- **Affected consumers once applied**: Map 1, ZIP page section, `development.html` (all read the readers; empty until a source is active). Report: none until wired.
- **Replica dry-run plan** (needs separate approval): disposable PostGIS container only (the §7.11 shape), apply file, run `test/air_permits_pg` (50 checks, 19 mutations, run on local PostGIS), apply twice, run rollback block, confirm catalog signature returns to start. No DDL against production, even rolled back.
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

## 6. ZIP reader geometry correction (prepared; SQL NOT applied)
- Defect closed in the SQL: `air_permits_for_zip` used points only, so a record with a verified footprint and no point read as "no location".
- Rule: the established whole-ZIP assignment — boundary-inclusive `ST_Intersects` against `geo.zip_membership_boundary` (the predicate `geo.zip_point_membership_in` uses for points, applied to the shape; ZCTAs tile, so a shape crossing two ZIPs is listed in both, like an edge point). A verified footprint decides alone over all its parcels; a point never overrides it in either direction; point-only records use the point; one row per permit with the count of intersecting parcels; footprint-decided records return no point and state `verified_parcel`/`verified_boundary`.
- Genuinely unlocated = no point and no footprint, counted separately; footprint-only records are not counted as unlocated.
- Not substituted: no centroid, no radius reader. No new function was added to the `geo` schema; the predicate is the same one, inlined, so there is no second membership definition to keep in sync.
- Not done: Map 1 draws pins from points only, so a footprint-only record appears in the ZIP list/section and is "listed by its shape, not pinned"; drawing footprint polygons on Map 1 is not built.
- Fixture tests (local PostGIS): ZIP 1 footprint-only included; 2 edge-crossing included; 3 three parcels listed once with 2 intersecting counted; 4 point inside + footprint outside excluded; 5 point outside + footprint inside included with no point; 6 no location excluded and counted, footprint-only not counted; 7 circle reader is not used. Suite: 61 checks, 0 failed; 23 deliberate-break checks all caught (point-overrides-footprint, footprint counted as unlocated, centroid for radius, bbox, removal, etc.).

## 7. Permissions evidence (SQL revoke correction + role tests)
- Correction: `air_permit_footprints` was missing from the table revoke line, so `anon` could read it (found by the new test, fixed). The footprint writer and shape helper are explicitly revoked from public/anon/authenticated and granted only to `service_role` (writer).
- Test (`test/air_permits_pg/suite.sql`, H4, runs under `SET ROLE`, not as the owner): anon and authenticated get SQLSTATE 42501 on SELECT and DELETE of all six tables; 42501 calling the footprint writer, the ingest function and the shape helper; both readers execute for anon and authenticated; service_role passes the writer's privilege check (reaches its own validation, 22023); all four functions are security definer; RLS on for all six tables.
- Mutations proving it: table left exposed → 2 checks fail; writer granted to anon → 2 fail. Run on local PostGIS with fixture roles; production role grants are verified only after an approved replica/apply.

## 8. Completion items (kept separate)
| item | state |
|---|---|
| Radius behavior (report circle, footprints) | SQL + TS prepared, fixture-tested; not applied |
| ZIP behavior (footprints) | SQL prepared, fixture-tested; not applied; Map 1 does not draw polygons |
| Source acquisition (Texas) | blocked; option A probe prepared, awaiting approval |
| Report wiring / REPORT_VERSION / snapshot / PDF / edge deploys | not done; each needs approval |
| Map 1 footprint display (draw verified shapes) | NOT BUILT — open; footprint-only permits listed but not drawn |
| Public verification | none; nothing deployed |
Passing CI does not complete Texas ingestion or public coverage.

## 9. Conditions on the probe approval (2026-11-21) and how each is met
1. **Separate PR, #3104 not merged to run it.** Probe-only PR from branch `claude/tceq-air-probe-only` contains exactly three files. Its merge needs your separate approval. **Does merging it deploy or publish anything?** No deploy or publication. The `pages` (build/deploy/IndexNow) workflow is path-filtered and the files sit under `.github/**` and `test/**`, which its push filter excludes; I placed the script in `.github/probes/` deliberately for that reason. By reading every workflow's push filter, the merge can fire only read-only check workflows (`unit-tests`, and two gates with no path filter); none deploys or publishes. The probe itself runs only on a manual dispatch from main with the confirm string.
2. **Cap counts everything; redirects and robots rules.** Robots files, each redirect hop and each retry count toward 25 (test B5, B7). Redirects are followed by hand; each target is robots-checked first and not followed if disallowed, outside the approved hosts, or non-https (B4, B6). A robots.txt that is unreachable (any non-200, including 404, or a network error or redirect) or unparseable (HTML, empty, no User-agent line) makes the host RESTRICTED and nothing is fetched from it (B2, B3, P6).
   - Consequence to expect: `records.tceq.texas.gov` reportedly answers 404 for robots.txt; under this rule the Records Online host is RESTRICTED and the two PDFs would NOT be fetched. The probe records that and does not look for another way. If you want a 404 treated as "no restrictions published" for that host, that is a decision for you; I have not assumed it.
3. **www2.tceq.texas.gov expected RESTRICTED** (`Disallow: /`): recorded, nothing requested from it (test B1).
4. **Option B request drafted for your review, not sent:** `docs/tceq-air-export-request-DRAFT-2026-11-21.md`.
5. **weather_thin build failure compared against main:** `main` fails identically. The five most recent scheduled `pages` runs on main (head 0231ef9, 11:16Z to 13:46Z) all fail at the same step with `control class weather_thin ... (0 member(s))`, so it is independent of #3104. Because the build fails, main's deploy job is skipped, so public pages are not being republished from main while this persists. I have not relaxed the control.
6. **Map 1 footprint display is unfinished work.** A footprint-only permit is listed on ZIP pages but not drawn on Map 1. That is not complete Map 1 coverage. Item remains open; nothing built.

## 10. Decisions recorded 2026-11-21 (later)
- **Records Online robots.txt 404.** For `records.tceq.texas.gov` only, a genuine HTTP 404 for `/robots.txt` is treated as "no robots rules published", not RESTRICTED. It is not permission for unrestricted automated collection, overrides no terms, and authorizes no production ingestion. Unchanged and conservative: an applicable Disallow is respected; 401/403/429 stops the run; network errors, unresolved 5xx, redirects, HTML/challenge pages (including a 404 that carries a challenge body) stay blocked; request cap, spacing, redirect allowlist, timeouts, size limits and honest user agent are kept. Implemented and tested in probe-only PR #3109.
- **Merging #3109 is approved only for #3109 (once its checks on the exact head pass). It does not authorize dispatching the probe.** #3104 is not merged.
- **INDEPENDENT DEPLOYMENT BLOCKER (not part of this work): the `weather_thin` build failure.** `scripts/prove-zip-pages.mjs` fails with "no control resolved for weather_thin" (0 members) on `main` itself: five consecutive scheduled `pages` runs (head 0231ef9, 11:16Z to 13:46Z, 2026-11-21) fail at that step, so `main`'s deploy job is skipped and pages are not republished from `main`. Supported by the main-run comparison, not caused by #3104 or #3109. The control has not been weakened and no unrelated code was changed here. Owner and fix are separate work.
- **Still unfinished, not completed by merging or running the probe:** Map 1 footprint rendering (footprint-only permits are listed but not drawn) and Development Activity Report integration (prepared, not wired).
