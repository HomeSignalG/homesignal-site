# Development-source coverage audit, round 2 (read-only)

> Preserved as delivered on 2026-11-20 (production queried from 19:27Z, generation `n5-national-2026-11-20`).
> Nothing in this audit was implemented. Section G lists proposals only.

**Not a complete audit.** Production was measured for 3 ZIPs, 4 report subjects, 4 dense points, and the full 261-family inventory on counts only. Several downstream steps, listed in section D, are unmeasured. Every database call was a SELECT or a stable read function.

## Retractions from the first audit
- **A hydration miss is not an omitted project.** Hydration misses are stale references. I demonstrated no omission from them.
- **The 5-mile results do not describe customer reports.** The report handler is fixed at 0.5 mi (`handler.ts:110, 205`). The 5-mile displacement affects only other consumers of the radius function, not the report.
- **"285 expected" and "own ZIP / other ZIP" were not valid.** Those columns overlap. `app_projects.zip` is a materialisation ZIP, not a membership claim. Definitions are in F.
- **The 3 "missing" Phoenix keys (F6) are unexplained.** They disappear when the query is restricted to the ZIP copy, so I withdraw them as evidence of omission.

## A. Confirmed defects and demonstrated impact

| ID | Class | Evidence | Impact shown |
|---|---|---|---|
| A1 | Stale reference | Radius function returns frozen-snapshot (2026-09-01) keys with no current `app_projects` row. | Reports at 0.5 mi carry `RECORDS_NOT_LOADED` ("list may be incomplete") when no current project is missing. Coverage state drops to LIMITED_COVERAGE. |
| A2 | Proven omission (customer-visible) | MDOT 215962 (0.32 mi) and 226633 (0.43/0.44 mi) are rejected by the N5 verdict `MULTI_COORD_UNRESOLVED`. | Counterfactual on the 48854 report: with both admitted, 2 included becomes 4. They are `Approved`, with an official link, and pass relevance. |
| A3 | Proven displacement | Manhattan midtown, 0.5 mi: more than 2,000 rows, 368 of the first 2,000 unhydratable. Report limit is 1,000, so `AREA_TRUNCATED` fires. | Roughly 800 hydratable projects beyond the cap. Whether they pass relevance is unmeasured. |
| A4 | Identity migration | 256 of 3,716 old KCMO `arcgis:` keys have the same official `permit_number` under a new `socrata:` key. | Radius returns the dead key (stale) and the live key hydrates. No loss, but ledger history is split (see C3). |

**A1 at 0.5 mi, rendered through the real handler offline:**

| Subject | Rows / keys | Hydrated | Misses | Warning |
|---|---|---|---|---|
| 3225 W Oberlin Way (85083) | 27 / 27 | 21 | 6 (Phoenix permits) | RECORDS_NOT_LOADED |
| 6550 W Happy Valley Rd (85310, boundary) | 45 / 45 | 33 | 12 (6 Phoenix + 6 `peoria-az-building-permits`) | RECORDS_NOT_LOADED |
| 12400 NE Sherman Rd (64166) | 6 / 6 | 4 | 2 (KCMO permits) | RECORDS_NOT_LOADED |
| 48854 centre (coordinate-only) | 2 / 2 | 2 | 0 | none |

**Displacement at 0.5 mi in dense areas** (limit 2,000, so only Manhattan hit it):

| Point | Rows | Unhydratable | More than 2,000 |
|---|---|---|---|
| Manhattan midtown | 2,000 | 368 | yes |
| Chicago Loop | 637 | 116 | no |
| Brooklyn Williamsburg | 605 | 93 | no |
| Miami Brickell | 474 | 98 | no |

Roughly 15–25% of radius keys in dense places are unhydratable.

**A2 scale:** 4,593 keys in the active generation carry `MULTI_COORD_UNRESOLVED`. The other verdicts are `SOURCE_EXCLUDED` 107, `RECOVERY_UNSTABLE_IDENTITY` 261, `NULL_COORD` 12 and `RECOVERY_NOT_RETURNED` 5.

## B. Intended exclusions needing an owner decision
1. **Aged-out open permits (Phoenix).** Registry `recency_days = 365` on filing date, so still-open permits can leave. Example: PER_NUM 25019389 (OPEN, STRUC, issued 2025-11-13).
2. **Standing-inventory rule.** Completed ("operating") records appear only if an event falls in the last 90 days (`national-report.ts:907`, `RECENT_DAYS = 90`). Intended and feature-specific, and many aged-out Phoenix records are `DONE`.
3. **Multi-coordinate fail-closed.** N5 phase-1 behaviour. It is the upstream N5 decision, so it hits Map 1, the report, posts and emails alike.
4. **Source-level N5 exclusions.** `SOURCE_EXCLUDED` (cook-county, lake-county IL: 107 keys) and `IDENT_UNRESOLVED` (the two Fairfax families).
5. **Whether posts and emails should inherit the Map 1 membership gate.**
6. **Whether a spatially valid but aged-out record stays reportable.** Recommendation in E.

## C. Orphan investigation

**C1. Phoenix: 14 orphan keys sampled** (85083, 2 mi, ordered by `md5(source_key)`). Publisher layer queried by `PER_NUM` on 2026-11-20: 62,973 records total, 17,167 filed since 2025-11-20.
- **12 of 14 found at the publisher, all aged out.** Filed 2025-08-30 to 2025-11-04, before the 2025-11-20 cutoff. Examples: 25015631, 25015166, 214274, 25019389. Their statuses are 9 DONE and 3 OPEN.
- **2 of 14 not found:** `T969035`, `T970655` (T-prefixed numbers). Class: unknown (disappeared or renumbered).
- **Unexplained gap:** `app_projects` holds 16,806 Phoenix keys against 17,167 publisher records since the cutoff, a difference of 361 (2%). Possible duplicate numbers or ingestion loss. Not resolved.

**C2. KCMO: all 3,716 old `arcgis:` keys** (key suffix = permit number, compared by exact equality only):

| Class | Count | Basis |
|---|---|---|
| Out-of-scope permit types (electrical, mechanical, plumbing and similar) | 2,920 | Current `extra_where` keeps only `CPPU - Building/Demolition`. Intended content exclusion. |
| In-scope type, same permit number now under a `socrata:` key | 256 | Identity migration. |
| In-scope type, absent from current dataset | 540 | Inference: aged out (current minimum filing 2025-11-19). **Publisher not reachable from the sandbox, so unconfirmed.** |

**C3. Ledger.** Old KCMO keys CPBC-2025-00870 and CPBC-2025-00270 have `dev_change_project` rows. The new socrata key for 00870 has none. Changes-since cannot compare history across that identity split.

**Retention policy.** I found no stated rule. The evidence points to "not reportable once the current pipeline stops materialising it":
- Sources are deliberately windowed.
- The report excludes standing inventory.
- History is retained separately (ledger plus the permanent-intelligence rule in CLAUDE.md).

This is an owner call.

**Correction options**

| Option | Gains | Costs |
|---|---|---|
| Hydratability predicate before the limit | Fixes the warning and the displacement. Smallest change. | Hides aged-out records, which is only right if the retention answer is "no". |
| Fix identity migration (alias by exact official id) | Keeps ledger continuity (256 KCMO). | Alias table to maintain. |
| Retain historical materialisations | Would keep history reportable. | Larger store. Reintroduces records the sources deliberately dropped. |
| Restore missing details | Not applicable. The sample shows aged-out, not damaged. | n/a |
| Exclude obsolete entries at generation | Fixes at the source. | Needs a generation rebuild. |

## D. Source inventory (261 families)
- **Measured for all 261** (production, generation `n5-national-2026-11-20`): `app_projects` distinct development keys, generation points, recovered geometry, snapshot points, verdict rejects, N5 treatment, and 24-hour fetch-failure counters. Machine-readable copy: `family-inventory.json` / `.csv` (regenerated 2026-11-21 from query output; see README).
- **Not measured per family:** cache presence, fetch-zero outcome, Map 1 membership (measured for 12 families and 3 ZIPs only), and report-level relevance.

| Class | Families | Keys |
|---|---|---|
| Unwired, no connector | `shelby-county-building-permits` | 0 |
| Dormant, zero everywhere | `harris-county-permits`, `harris-county-plats`, `houston-plat-applications`, `san-antonio-prelim-plan-review` | 0 |
| Snapshot only, no `app_projects` (phantom source) | `cabarrus-county-plan-reviews` 725, `slc-planning-petitions` 570, `spokane-county-building-planning-permits` 6,737, `topeka-building-permits` 6,667, `sd-stip-railroad-crossings` 18, `sd-stip-safety-points` 1, `sd-stip-structures` 14; `denton-county-dev-permits` 20,118 is documented-retired and exempt | 14,732 non-retired |
| Recovered geometry but no `app_projects` | `anne-arundel-commercial-site-plans` 1,258; `anne-arundel-subdivision-activity` 2,049 | 3,307 |
| Materialised but admitted nowhere | `caltrans-sb1-projects` 2,921; `boulder-county-accela-applications` 2,532; `desoto-county-permits` 1,658 (HIST_UNRECOVERABLE); `fairfax-recent-building-permits` 9,419 and `fairfax-active-site-construction` 1,020 (IDENT_UNRESOLVED); `ncdot-stip-projects-points` 197; `maine-dot-public-projects` 193; `longmont-active-development` 96; `cook-county-il-highway-construction-program` 77 and `lake-county-il-construction-program` 30 (SOURCE_EXCLUDED); `tillamook-county-land-use-cases` 1 (NOAUTH) | 18,144 |
| Partially admitted | `kcmo-capital-projects` 206 of 339; `phoenix-proposed-zoning` 3 of 38 | 168 missing |
| Remaining | admitted in at least one path (233); many carry verdict rejects | n/a |

**Key finding:** for the 12 families measured directly, Map 1 membership equals report-radius admission exactly. Their exclusion is shared upstream (N5), not report-specific. The 18,144 keys sit in neither Map 1 nor reports.

Highest verdict-reject shares:

| Family | Rejected / keys |
|---|---|
| `udot-active-projects` | 106 / 173 |
| `nysdot-capital-program-projects` | 206 / 319 |
| `nysdot-capital-program-projects-2` | 118 / 165 |
| `penndot-transportation-projects` | 1,071 / 2,869 |
| `mdot-stip-projects` | 122 / 774 |
| `skagit-county-active-permits` | 41 / 242 |

**261 vs 260 resolved:** `shelby-county-building-permits`. It is a registered family declared as `platform: opendatasoft`, for which no connector exists (`docs/source-registry.md:5191`). The publisher generator iterates only wired connectors, so it is correctly absent. Legitimate.

**Fetch failures, last 24 h (nonzero):**

| Family | Failures |
|---|---|
| `fdot-active-construction-projects` | 281 |
| `georgia-dot-gpas-projects` | 70 |
| `nj-stip-projects` | 62 |
| `montgomery-county-pa-act247-proposals` | 31 |
| `wake-county-building-permits` | 27 |
| `charleston-county-permits` | 20 |
| `huntsville-building-permits` | 16 |
| `odot-current-projects` and `-lines` | 14 each |
| `nvdot-project-boundaries` | 12 |

Truncations: `little-rock-permits` and `brunswick-county-permits`, 2 each.

## E. Multi-coordinate MDOT keys

**All cached copies** (`app_projects`; the cache holds the same points for 48854):

| Key | Name | ZIP | Coordinates | Seq |
|---|---|---|---|---|
| 215962 | "Pine Tree Rd Tri-County Areawide" | 48842, 48910 | 42.67356, -84.50353 | 1 |
| 215962 | "N Bush St Tri-County Areawide" | 48854 | 42.58418, -84.45503 | 1 |
| 226633 | "M-36 over Sycamore Creek" | 48854 | 42.57918, -84.44763 | 1 |
| 226633 | "M-36 over Sycamore Creek" | 48854 | 42.57918, -84.44741 | 2 |

**Reading:**
- **215962:** one areawide program with at least two distinct locations about 11 km apart. The title changes per ZIP copy because it is built from each feature's route name.
- **226633:** two points about 17 m apart in one ZIP, with different `source_seq`, likely two features of one bridge.
- **Not coordinate updates:** all copies were first materialised 2026-08-15 with the same last-seen date, and both points of 226633 appear in the same 2026-11-19 cache read.
- **Publisher geometry:** not retrievable (HTTP 000 from the sandbox). Unverified.

**Proposed rule (not implemented).** Key identity by feature, not by project. A project with N distinct source features is admitted as N geometry instances (`pt:1..pt:N`), and each is tested against the ZCTA polygon and radius on its own.
- **Legitimate multi-location:** distinct feature identity (source feature id or sequence).
- **Conflict:** the same feature id with different coordinates across observations. Use the newest observation, and send ambiguous cases to a verdict.

The radius function already returns one row per instance, and `assemble` takes the nearest distance.

**Tests:**
- Two features 11 km apart: the project appears on both ZIPs' Map 1 and in each radius.
- Two features 17 m apart: one report entry, nearest distance.
- Same feature id, changed coordinate: newest wins, one instance.
- Report and Map 1 agree on the same fixtures.

## F. Features, definitions and acceptance tests

**Feature verification** (code read unless stated):

| Feature | Path |
|---|---|
| Map 1 ZIP | `homesignalmap.html:1114` → `app_zip_projects_markers` → serving membership. Measured via membership counts. |
| Map 1 address | `homesignalmap.html:1110` → `n5_projects_within_radius`. Its row limit and radii were **not** verified. |
| ZIP "Development & growth" | `lib/data.js` `zipDevelopment` → membership plus data-centre listings. Not live-run. |
| Report | Real handler run offline on exported production data (the 4 subjects above). Jurisdictions were passed empty, so the applicable-family disclosure branch is untested here. |
| Watch / changes-since | `run-property-watch/handler.ts:126` uses the same `readReportInputs`, so it shares A1–A3. |
| Shared reports | Serve the stored body as stored (`view-shared-report`). Freshness vs current data was not measured. |
| MAPS posts | Ingest `generate-maps.mjs` + `bluesky/lib/map1-membership.mjs`: `isDrawnOnMap1` requires `boundary_complete`. Intentional (post links to Map 1), but inherits N5 exclusions. |
| MAPS emails | `digest.py` MAPS stream sends published posts word for word. No direct source read. Inherits the post gate. |

**Inherited by accident:** the multi-coordinate and N5 source exclusions (shared upstream).

**Definitions.** "Own ZIP" means a serving-membership row with `zcta5 = Z`. "Other ZIP" means a row with `zcta5 ≠ Z`. They overlap for boundary points: the 6550 W Happy Valley Rd record sits in 85083 membership while its `app_projects` copy says 85310.

**Acceptance tests.** Require both of these, not a fixed count:
1. No obsolete or unloadable reference consumes the limit. Assert that every returned key hydrates, or is documented-retired.
2. No independently established eligible project is lost. Compare against canonical geometry (membership plus feature instances), not representative-point counts.

Also assert `RECORDS_NOT_LOADED` fires only on a genuinely unloadable current key.

## G. Smallest corrections and remaining production checks

**Corrections, smallest first (none implemented):**
1. Apply a hydratability predicate in `n5_projects_within_radius` before the limit. The founder's retention decision comes first.
2. Admit multi-feature projects per the rule in E. Add tests.
3. Alias identity for exact official-id matches (KCMO 256), or at least preserve ledger continuity.
4. Decide on the 11 admitted-nowhere families, 18,144 keys.

**Remaining checks (read-only):**
- Per-family `development_reports.sites` presence, bounded to 3 ZIPs at a time, to separate "cached but not materialised" from "fetched zero".
- The F6 query, run again, filtered to other-ZIP copies:
  ```sql
  select a.source_key,a.zip,a.lat,a.lng from public.app_projects a
  where a.record_kind='development' and a.registry_id='phoenix-building-permits'
    and a.zip<>'85083' and a.lat between 33.63 and 33.84 and a.lng between -112.25 and -112.01
    and st_dwithin(st_setsrid(st_makepoint(a.lng,a.lat),4326)::geography,
        st_setsrid(st_makepoint(-112.1294,33.7352),4326)::geography,2*1609.344)
    and a.source_key not in (select source_key from public.n5_projects_within_radius(33.7352,-112.1294,2::numeric,1000));
  ```
- Per-family membership counts for the remaining 249 families, in batches of about 12.
- Deployed `get-development-activity-report` source versus the repository.
- Map 1 address-mode limit and radii.
- Publisher confirmation for the 540 KCMO and 2 Phoenix unknowns, from a runner that can reach them.

**Evidence.**
- **Repos:** site `2ce8cac` and ingest `dd3669a`, both on branch `claude/sleepy-cray-3exs0h`.
- **Production:** project `qwnnmljucajnexpxdgxr`, queried 2026-11-20 about 19:27Z onward, generation `n5-national-2026-11-20`.
- **Limits:** no verified public addresses (Census geocoder blocked). The addresses used are the publisher's own permit addresses at their stored coordinates, and 48854 is coordinate-only. The KCMO and MDOT publishers were unreachable, so those findings are database-only. Two statements timed out and were re-run narrower.

> Editor's note (preservation): in section B item 2, the delivered text read `RECENT_DAYS = 58`; the code value is 90 (`national-report.ts:58`). Corrected here. Nothing else was changed.
