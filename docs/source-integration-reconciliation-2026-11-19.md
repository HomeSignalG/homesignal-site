# Development source → Activity Report reconciliation (2026-11-19)

Method: registry (`jurisdiction-registry.json`, 257 ids, md5 `c92618d1…`) joined in the database to `public.app_projects` (development), `geo.n5_geom` (outcome 1) and the active generation's `geo.n5_gen_proven_point`, with grouped counts only. Read-only. Boulder is one data point, not the basis.

| Class | Count | Meaning |
|---|---:|---|
| Verified integrations | 233 | registry family has development rows AND served geometry (n5_geom or active-generation proven points) |
| Confirmed gaps (serving) | 8 | development rows exist, no served geometry in either table |
| Retired / legitimate exclusions | 16 | in registry, no development rows left in `app_projects`; 10 still carry old served geometry |
| Unverified | 1 + planes | `tdlr-tabs` (5 rows, not in registry); EPA activity (see below) |

## Confirmed serving gaps (not a hydrate or report defect: the radius read never returns them)
| Family | Rows | Evidence |
|---|---:|---|
| caltrans-sb1-projects | 15,094 | n5_geom 4,217 all `NO_GEOMETRY`; the other rows have no geom row |
| maine-dot-public-projects | 307 | 255 `NO_GEOMETRY` (its `-lines` family is served) |
| ncdot-stip-projects-points | 516 | 197 `NO_GEOMETRY` (its `-lines` family is served) |
| fairfax-recent-building-permits | 45,442 | no row in either serving table; rows created 2026-08-15..11-19 |
| fairfax-active-site-construction | 4,403 | same |
| desoto-county-permits | 7,279 | same |
| cook-county-il-highway-construction-program | 459 | same; rows created 2026-08-13..09-26 |
| lake-county-il-construction-program | 80 | same |

Cause for the five with no serving rows is unverified. Those rows were created after the generation cutoff, or their publisher class is not yet frozen; the next generation may recover them. Not touched here.

## Registry families with no development rows (legitimate retirements per CLAUDE.md, or not yet loaded)
anne-arundel-commercial-site-plans, anne-arundel-subdivision-activity, cabarrus-county-plan-reviews (frozen 2025), denton-county-dev-permits (stalled 2023), slc-planning-petitions (rejected), spokane-county-building-planning-permits (stale copy), topeka-building-permits, sd-stip-railroad-crossings, sd-stip-safety-points, sd-stip-structures, harris-county-permits, harris-county-plats, houston-plat-applications, san-antonio-prelim-plan-review, shelby-county-building-permits, tillamook-county-land-use-cases (new, no rows yet). Their reports no longer show "records lost": the report now separates a wholly retired family from a lost key.

## `record_kind` filter, all families
`app_projects`: development 2,925,395 rows across 242 families; facility 159,639 rows. Facility rows carry the EPA registry id as `registry_id` (122,975 distinct) and types industrial / energy / logistics only. A sampled 10-ZIP grouping found no development source family under `facility`. The filter therefore removes the EPA plane only. Eligible EPA-linked activity reaches the report through development sources (heavy-facility kinds, data centers), not through FRS rows.

## Coordinate-less development rows (cannot be spatially served)
bozeman-building-permits 1,065 of 1,065; little-rock-permits 49,444 of 49,515 (served geometry exists from an older load, so the gap is partly offset); vdot-syip-lines 105; san-marcos 8; bellevue 4. Needs ingest-side geocoding, not report code.

## Colorado acquisition gaps (hand to the BOLO coverage workstream; not duplicated here)
Boulder County/city planning cases, CDOT project program (no `cdot` family in the registry), Boulder County permits. Only `boulder-construction-permits`, `adams-county-building-permits`, `douglas-county-co-permits`, `denver-*`, `aurora-*`, `colorado-springs-planning-applications`, `fort-collins-building-permits` and `weld-county-site-plan-review` exist.
