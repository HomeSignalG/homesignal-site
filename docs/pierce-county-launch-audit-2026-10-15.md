# Pierce County WA — launch-readiness audit (2026-10-15)

Read-only audit of the 65 existing Pierce County ZIP pages. No page was created, no production row was
written. Every number below came from `scripts/audits/pierce-county-launch-audit.sql` (each section
prints its own control). Pierce pages = `communities` with `state='WA'`, `county='Pierce'`, `level='zip'`
(control: **65**). Development records = cached `development_reports.sites` entries with a
`source_registry_id` (control: **18,612** page-records, **10,098** distinct).

## Result

| check | result |
|---|---|
| Refresh ≤ 72 h | **64 / 65** (newest 2026-10-15 15:42Z, oldest 2026-10-11 18:58Z) |
| Older than 72 h | **1**: **98396** (93.4 h) — none older than 7 d |
| Coverage `populated` | **64 / 65** (control: 12,722 rows in `app_coverage_states`) |
| Not populated | **98396** `temporarily_unavailable` — see below |
| Null / zero lat-lng | **0 / 18,612** |
| `scope` = point | **18,612 / 18,612** |
| Outside Washington bbox | **0** |
| Outside Pierce bbox | **4** — all WSDOT, see below |
| Statuses unmapped | **0** (every raw status maps to a bucket) |
| Missing address / filing date / record URL / bucket | **0 / 0 / 0 / 0** |
| Missing permit type | **81** distinct, all WSDOT (project-plan rows carry no permit type) |

### 98396 (the one stale, non-populated ZIP) — flagged, not changed
`coverage_state` is *derived* by a view; there is nothing to "set". Reading: last success 2026-10-11
18:58Z, last attempt 2026-10-14 10:34Z, `facilities_unavailable = true` (the EPA read was refused), 53 development
markers, `data_quality = pass`. That is the designed hold (a retried ZIP inside the 7-day window); it
recovers when the rolling refresh next reaches it (~53 h sweep, 240 ZIPs/h). I did not force a refresh.
Re-run section 1–2 of the SQL after the next sweep; if it is still not `populated` after 7 days it becomes
`failed_ingest` and needs a look at the EPA path, not at Pierce data.

### Coordinate leads
* **4 records outside the Pierce bbox** (ZIPs 98354, 98424): two WSDOT I-5 pavement projects
  (`wsdot-project-delivery-plan-under-construction` / `-complete`) whose pin is the midpoint of a polyline
  running King–Snohomish–Whatcom (≈ 48.0 N). Their own address field reads "005 King, Skagit, Snohomish,
  Whatcom" — Pierce is not in it. **Not fixed**: source-supplied geometry is deliberately never fenced
  (CLAUDE.md, engine v20). Suggested fix, needs a decision: drop a corridor record whose point is outside
  the report ZIP's scope box.
* The bbox is an approximation; no county polygon exists in-house. It proves "plausibly Pierce", not "inside
  the county line".

### Not verified
* **Map dot clustering / UI marker integrity** was not exercised: the sandbox cannot reach the live site.
  Data-level proxy only (SQL 3c): launch ZIPs stack records on shared points — Puyallup 98371 189 records on
  117 points (max 10 on one point), 98373 752/475 (10), Gig Harbor 98335 293/212 (6), Lakewood 98499 224/150 (4),
  Graham 98338 187/134 (3), Sumner 98390 138/96 (10). Needs a look in a browser (`verify-development`).
* The brief says Tacoma covers 17 ZIPs; I did not count that.

## Tacoma maintenance noise (`tacoma-accela-permits`)
Tacoma files nearly everything as type **Building** (4,691 of 5,334 distinct records), so a type whitelist
cannot separate a furnace swap from a project; only the scope text can.

* New pure rule `isMinorRepairNoise` in `sources/record-hygiene.ts`, opt-in per entry via
  `drop_minor_repairs: { types: ["Building"] }`. A record is dropped only if its text names a minor-repair term
  (furnace, heat pump, water heater, fire alarm, water/fire damage, re-roof, repipe …) **and** states no
  development evidence (new construction, addition, ADU, demolition, alteration/remodel/renovation, tenant
  improvement …). Precision over recall: "New SFD with furnace and water heater" and "244SF addition" are kept.
* Measured on the cached records with the identical pattern strings (SQL section 5): **2,181 of 5,334 (41%)
  would drop, 3,153 kept.** Dropped samples are re-roofs, repipes, fire-damage repairs, boiler/heat-pump swaps.
* Counted in the run report as `minor_repairs_dropped`.
* Judgement call: re-roofs on commercial/multifamily buildings and like-for-like mechanical swaps are treated as
  noise. Interior remodels/alterations are kept. Tune the two term lists if you want it stricter or looser.

## Applicant-named titles (`pierce-county-pals-permits`) — founder privacy decision applied 2026-10-15
PALS builds the title as `applicationType + projectName`, and `projectName` mixes applicants, plat text and project names.
Decision: **individual homeowner names are stripped entirely; corporate applicants are kept; plat/subdivision text is left as filed.**

| input (type · name) | title |
|---|---|
| Construction Single Family Residence · Lucy Chege | `Single Family Residence construction` |
| Construction Residential · 3705 Rental LLC | `Residential construction (applicant: 3705 Rental LLC)` |
| Construction Residential · Lake Minterwood, Lot 38, Blk 2 | `Residential construction: Lake Minterwood, Lot 38, Blk 2` |

Measured on the 4,683 distinct PALS records cached on Pierce pages (SQL section 6, an approximation of the TS rule):
**161 corporate kept · 3,221 plat text kept · 1,301 stripped** (individuals, and anything else that states no entity word).

* ⚠️ **Correction to the first version of this report:** it said 3,208 records carried an individual's "Last, First" name.
  That was a regex hit count, not a classification; most of those are plat text ("Rolling Brook, Lot 15"). About 1,300
  records, not 3,200, are stripped.
* **Entity words are the founder's list, word-bounded** (LLC, INC, CORP, HOLDINGS, PROPERTIES, BUILDERS, HOMES, DEVELOPMENT,
  GROUP, PARTNERS, LIMITED, CO, LP, plus plural/long forms). Unbounded, `CO` matches Jacob/Rebecca/Marco and `INC` matches
  Lincoln/Vincent, which would publish individuals; the tests pin those names.
* **Fail closed.** Code cannot tell "Lucy Chege" from "Gig Harbor Medical Office", so a name is shown only if it positively
  matches the entity list or the plat shape. A real project name with no entity word is dropped. A name that is shaped
  "Last, First" is an individual even if it also contains an entity word. Family trusts, churches and public agencies are
  not on the list and are stripped.
* **Residual exposure, not fixed here:** this changes records fetched from now on. Names already cached in
  `development_reports`, materialized into `app_projects`/`app_changes`, drafted into MAPS posts, or carried in the
  Rule D project-pages object (which keeps untracked pages and "only grows") stay until each is refreshed or purged.
  Purging them is a separate, destructive step I have not taken.

## Status mapping
All raw statuses map; buckets present: proposed 3,081 · approved 9,012 · operating 6,512 · denied 7 (denied =
`decided`, the "Decided" category). Existing fleet convention kept: **Issued → approved**; there is no separate
"under construction" bucket, and WSDOT "Advertised, Not Yet Complete" is bucketed *approved* despite its
registry id saying under-construction. Changing that is a product decision.

## Shipped in this change
* `sources/record-hygiene.ts` (new), wired in `sources/arcgis.ts` (two additive, opt-in options + report counter).
* `jurisdiction-registry.json`: one line each on Tacoma and Pierce PALS.
* `test/record-hygiene.test.mjs` (67 checks, incl. the real connector end to end; mutations of the wiring each fail it).
* `scripts/audits/pierce-county-launch-audit.sql`.

## Not done / needs you
* **Not deployed.** The edge function ships from `main` via `deploy-edge-functions.yml`. Cached rows keep the old
  titles and noise until the rolling refresh re-collects each ZIP (~53 h), and `app_projects` follows the next
  materialization.
* No production data was written or deleted.

## Post-merge record (2026-10-15)

* **Merged** as `65ea03b` (#1955). **Deployed** by dispatching `deploy-edge-functions.yml` (it is dispatch-only; merging does
  not deploy): run 38778050585, all steps green; `get-address-report` is version 272, updated 17:31:52Z. The only undeployed
  change to that function tree was this PR (checked with `git log` against the previous deploy commit).
* **Canary:** one live call of the deployed engine for ZIP 98396 (the same payload the rotation sends; response read from
  `net._http_response`, nothing stored). 200, EPA ok. All 48 PALS entries kept their `source_id` (identity preserved); 37 plat
  names preserved verbatim, 10 individual names stripped, 1 corporate applicant kept; core counts equal the cache (development
  53, facilities 7).
* **Historical cache (dry run, `scripts/audits/pierce-privacy-backfill.sql`):** 3,825 `development_reports` entries (1,301
  distinct `source_id`, 62 of 65 report rows) and the same 3,825 `app_projects` rows still carry a name the rule strips. The
  other columns that could hold it (`developer`, `scope_text`, `parties`) are empty on those rows, no `app_changes` row
  references a PALS project, and the one PALS-sourced MAPS post is `skipped`.
* **Backfill = the pipeline's own rotation, not a script that writes.** The 62 affected ZIPs sit at positions 5,244–12,274 of
  12,722 in the oldest-first rotation (240 ZIPs/h), so all are re-parsed within about 51 hours of the deploy. Two shortcuts were
  rejected on evidence: `dev_refresh_fire_targets` (the `dev_refresh_targets` queue holds 1,437 unfired August rows) and
  back-dating `refreshed_at` (falsifies the freshness clock). Record ids do not change: `source_id` / `source_key` derive from
  the case number.
* **98396:** still `temporarily_unavailable` after the deploy. The canary response is healthy (EPA ok, counts equal the cache),
  so the next scheduled refresh is expected to store cleanly and flip it to `populated`; that is a prediction until the
  rotation reaches it (~23 h out). Section C of the SQL file is the check.
* **Still open:** the Rule D project-pages object (ingest-owned storage JSON, keeps untracked pages) is not queryable from SQL
  and may retain old names; purging it is a separate destructive decision.
