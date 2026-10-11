# Frisco "Proposed Zoning" (layer 5) — draft registry integration: evidence and open decisions (2026-10-11)

Draft PR only. Nothing is merged, deployed, activated, refreshed or cleared. Fixture: `fixtures/arcgis/frisco_proposed_zoning_layer5_2026-10-11.json`
(from the founder-authorized probe of 2026-10-11; no further probes were made). Test: `test/frisco-proposed-zoning-registry.test.mjs`.

## What the layer is (measured)
20 features, 17 distinct `PROJECT_NO`. Status (feature counts): UNDER REVIEW 11 · REVISE AND RESUBMIT 8 · REVIEW COMPLETE 1.
Repeated polygons: SUP26-0007 ×3, Z26-0009 ×2. One null `PROJECT_NAME` (Z26-0010). `Project_Type` is only `SUP` or `ZONING` (a process kind).
20/20 `Hyperlink` values are https on `etrakit.friscotexas.gov` and `activityNo` equals `PROJECT_NO` (checked in the test); repeated links are exactly the repeated polygons.

## What each constraint became
| # | constraint | result |
|---|---|---|
| 1 | universal path | one registry entry; `sources/arcgis.ts`, N5, report code untouched |
| 2 | `PROJECT_NO` identity, multi-polygon | `identity_fields:["PROJECT_NO"]`; 19 published polygon rows → 16 `source_id`s (test 3h/3i) |
| 3 | true geometry, 0.5 mi edge | connector emits a centroid pin; N5 stores the true rings and uses `ST_DWithin` on them. The test shows a point 0.45 mi from a real polygon's edge is beyond 0.5 mi by centroid (6c). SQL itself is covered by existing `test/n5_spatial_pg` (needs a Postgres this sandbox lacks; run in CI) |
| 4 | statuses | UNDER REVIEW + REVISE AND RESUBMIT → proposed, **provisional**; REVIEW COMPLETE held; unknown/blank statuses fail closed (3b) |
| 5 | staff fields | excluded by an explicit `out_fields` allow-list; request URL and output asserted free of them |
| 6 | Type | none configured; names like "AG to SF-7" or "Child-Care" stay unclassified (4a–4c) |
| 7 | dates | month-first parse verified; `filed` only; no decision_date (5a–5d) |
| 8 | links | all 20 valid/complete; duplicates only on multi-polygon projects |
| 9 | rights | not cleared (7a–7d) |

## Files touched beyond the registry entry (required by existing CI parity gates)
- `lib/generated/county-sources.json` regenerated (`node scripts/gen-county-sources.mjs`): adds the entry under TX|Collin and TX|Denton. **When merged and deployed, ZIP-page empty-state copy for those counties will name "City of Frisco" for this source** — a resident-visible wording effect that follows merge, not this draft.
- `lib/residential-qualify.js`: one line, `frisco-proposed-zoning` added to the label-kind name table (derived by `scripts/residential-name-kind.mjs`; `test/residential-name-kind.test.mjs`).
- Test status: full unit suite has 34 pre-existing failing files on `main` (browser suites, environment) and exactly one more with this change: `report-rights-r7` (deliberate, below). Registry guards, `arcgis-geometry`, N5 spatial tests and the new suite (60+ checks, 5 mutations killed) pass.

## Findings you should know about
1. **Rights tripwire is red by design.** `test/report-rights-r7.test.mjs` (7 checks) fails because the registry now has 241 ids against R7's 240. That is the existing control making a new source's clearance an explicit decision (R8). I did not regenerate `report-rights.json`. The draft PR's CI will therefore show this one failure; merging requires your R8 ruling or holding the entry out.
2. **Shared `isoDay()` accepts impossible dates** (`31/31/2026` → `"2026-31-31"`, `02/30/2026` → `"2026-02-30"`). Not Frisco-specific, not fixed here (`sources/arcgis.ts` is owned by open work). The paid report's `validDay` round-trip refuses such values, so they never display as a date. Pinned in test 5f/5g so a fix must update it. The live Frisco data has no such value.
3. **Title** is `PROJECT_NAME` + project number ("University Village Monopole SUP26-0007"); a null name shows just the number.
4. `Applied_Date` is not a stable "filed" date: Z25-0007 (a 2025 number) carries 09/14/2026, so it is the latest submittal.

## Unresolved decisions (founder / Frisco)
- Whether UNDER REVIEW and REVISE AND RESUBMIT are both "active, undecided". Evidence is the layer's own Type text ("Zoning: Under Review" / "Zoning: Revise and Resubmit") and the city's description of unscheduled cases; **no official definition found**. Mapping is provisional pending the city's answer (inquiry draft: `docs/frisco-gis-licensing-inquiry-DRAFT.md`, not sent).
- REVIEW COMPLETE (Z25-0009): outcome unknown; its own Type text still reads "Under Review". Held.
- SUP26-0009 "(Withdrawn as SUP25-0008)" with status UNDER REVIEW: probably a refiled predecessor, unconfirmed. Published as the publisher states it; no per-record exclusion.
- Rights: R8 ruling, and the licensing answer from Frisco GIS.
- Whether the title should drop the project number.

## Does the layer add meaningful quality-of-life value?
Honest answer: **it adds official Proposed-stage evidence near an address, but no new distinct quality-of-life consideration today.** With no authoritative Type and an empty `DESCRIPTION`, every record reports "Impact not determined from available records", so the report's QoL wording does not change. The value is existence and stage of a pending zoning or SUP case within 0.5 mi (with a link to the city record). A rezoning such as "AG to SF-7" (Z26-0011) is probably residential, but a Type may not be inferred from a name; it would need a city-stated land use. That is a licensing/definition question for Frisco, not an engineering one.
