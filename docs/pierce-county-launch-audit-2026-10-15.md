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

## Flush record and corrections (2026-10-15, evening)

**What was done, beyond the "let the rotation do it" plan above (founder instruction: flush now).** The same deployed engine was
called for each of the 61 name-affected Pierce ZIPs as a fresh request (`net.http_post`, the payload the rotation sends, rows
tracked in `dev_refresh_inflight`), in rounds of 8/12/12/12/13/4, then `public.app_refresh_zip(zip)` was run for each landed ZIP so
`app_projects` followed immediately instead of at the next 15-minute sweep. `dev_refresh_fire_targets` was not used and no timestamp
was back-dated. The collector stores about 4 ZIPs per 2-minute tick, so a round lands over 4-6 minutes; round 1 looked stuck and was not.

**Measured after (counts only):** 65 Pierce pages, 62 refreshed after the deploy (the other 3 have no PALS names), all 65 `populated`.
Uncleaned PALS titles: **0 of 12,836** in `development_reports` and **0 of 12,836** in `app_projects` (queries B2/B3 in
`scripts/audits/pierce-privacy-backfill.sql`, each beside a non-zero control). `app_community_meta` behind its report: 0. Record ids
unchanged (0 PALS rows created after the deploy).

**Correction to the verification above.** Sections A1/A2 of the backfill SQL compare a title with its raw permit type, so they only
work on OLD titles; after cleaning they keep flagging cleaned rows and cannot reach 0. They are now labelled pre-refresh only, and B2/B3
replace them. (A1/A2's "62 ZIPs still to strip" reading after the flush was this artifact, not a leak.)

**Plat-text residual, measured (the keep-list can keep "First Last, Lot N").** Across 4,675 distinct PALS records, 2,110 are kept as
plat text; 441 of those open with two capitalised words before a plat keyword, falling in 159 distinct prefixes. A random 12 of the 98
single-occurrence prefixes were all subdivision names, and the 35 prefixes without a subdivision noun (132 records) read as plat names
(many "... Add", i.e. addition). **No personal name was found; absence is evidence, not proof**, because there is no list of persons to
test against. The rule is unchanged. Other fields were checked and carry no applicant text: `label` equals `title` on all 12,836
entries, `address` is a site address, and `app_projects.provenance` holds only case number, precision, jurisdiction and vintage keys.

**Rows removed by the Tacoma noise filter (not by the privacy rule), and not archived.** Materializing the flushed ZIPs removed
about 1,965 stale `app_projects` rows, concentrated in Tacoma ZIPs (98404 414 · 98406 302 · 98407 291 · 98422 201 · 98408 178 ·
98409 171 · 98403 91 · 98418 86 · 98465 63 · 98444 48 · 98402 40 · others under 30), none referenced by `app_changes`
(`stale_kept_referenced` 0 everywhere). They are minor-repair permits the new rule drops by design (SQL section 5 had sized the cohort at
2,181 distinct records), but the longitudinal-asset rule says removal should not destroy history, and no snapshot was taken first. Their
identity is recoverable: ids derive from the case number and the public source still serves them, so reverting `drop_minor_repairs` and
re-running the same flush would restore them. The privacy-stripped names themselves are intentionally not retained anywhere.

**Other residuals.** Old response bodies in `net._http_response` still contain pre-deploy names until pg_net's retention expires them.
The `indexnow` job of pages run 38782500923 failed after `build` and `deploy` had succeeded. Read from its log: the notifier waited the
full 600 s and then refused, because `/community/29904/` was "not serving this build's bytes yet (HTTP 200)"; the job reported
63 changed pages and **submitted 0**, so nothing was announced. That is the gate working as designed (notify only what is live), not a
fault in the Pierce work. The likely reason is that later pushes to `main` (#1965, #1967, #1969) replaced this build before it served
long enough to be seen, but that was not checked, so treat it as a hypothesis; the next successful build carries the same delta forward
("Carry over notifications an earlier IndexNow job did not send"). ZIP 98397 (no PALS records) is the one non-indexable Pierce page and predates this work (its report was
refreshed before the deploy and it has 0 `app_projects`).
