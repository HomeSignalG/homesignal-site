# Map 1 Residential — total qualification + false-negative recovery (2026-09-06)

Corrects the defects the independent adversarial audit proved against `origin/main = 48214b3`.
Base for this work: `origin/main = a03d0cd` (the Residential branch was fully merged — 0 commits
and 0 files on it that were not on `main` — so it was reset per the post-squash rule).

The audit's own summary of what was RIGHT is preserved unchanged: qualification runs before Type
resolution, a rejected record is dropped rather than relabelled, and no other Map Type is touched.

---

## 1. Qualification is now TOTAL

**The defect.** `zipAuthMergeSites` dropped report sites only when `scope === 'point' &&
relevance === 'development'`. Area-scope development sites survived un-gated and fed the rails,
`devCount`, `MAP_SITES` and all three map views. The shipped claim *"qualification = rail count =
rendered population"* was therefore false.

**Why the two per-mode gates could not catch it.** They run where a site is BUILT from an
`app_projects` row. Cached report sites have no project row — the site IS the record. Measured
2026-09-06: **41,661 area-scope development sites; 2,288 Residential candidates across 90 ZIPs.**

**The fix.** One semantic contract, three entry points:

| entry point | how it is gated |
|---|---|
| authoritative ZIP marker (`lib/zip-authoritative.js`) | `residentialGateDrops(site, project)` at construction — unchanged |
| address-mode radius site (`lib/n5-radius.js`) | `residentialGateDrops(site, project)` at construction — unchanged |
| cached report site (`development_reports` / `property_reports`) | **NEW** `residentialEvidenceFromSite()` adapter + `residentialSiteGateDrops()` |
| **every user-facing population** | **NEW** `HS.residentialQualifySites()` at `render()` and `renderProperty()` |

`render()` is the ONE funnel: rails, `devCount`, `MAP_SITES` and all three map views read the
array it produces, and the gate runs before `window.__HS_SITES` is set. The per-mode gates stay
because they also keep a rejected record out of `zipAuthProjectCount` and the ZIP note.

**Measured after** (production, same query shape as the audit's):

| area-scope Residential candidates | n | ZIPs |
|---|---:|---:|
| removed — ROUTINE | 1,666 | 84 |
| removed — UNRESOLVED | 340 | 74 |
| kept — DEVELOPMENT | 282 | 16 |
| **bypassing the gate** | **0** | — |

---

## 2. Source provenance as authoritative evidence (founder ruling, 2026-09-06)

Granted only where the corpus is demonstrably bounded to a development class. Every candidate was
re-proved from its own production `type_raw` census; the audit's list was not taken on trust.

### GRANTED (8)

| registry | corpus bound (production census) |
|---|---|
| `austin-subdivision-cases` | subdivision case file; `type_raw` is the land-use code (Single Family 1,176 / SF 364 / MF 48 / DUP 43) |
| `austin-site-plan-cases` | site-plan case file (MF 246, Single Family 222, Condominium 170) |
| `chester-county-pa-act247-plans` | PA Act 247 subdivision & land-development referrals; 5 land-use values only |
| `delaware-county-pa-subdivisions-land-developments` | 3 values: Residential 2,085 / Nonresidential 3,158 / null 55 |
| `york-county-pa-planning-subdivisions` | planning subdivisions; `type_raw` is a serialized checkbox matrix, so it can never supply activity |
| `fairfax-active-site-construction` | 9 values, all plan classes (Infill Lot Grading Plan 4,474 … Conservation Plan 164) |
| `seattle-land-use-permits` | Master Use Permits; 6 building-use values |
| `casa-grande-active-development-sites` | 10 zoning-district values over a development-site corpus |

### REJECTED, with the evidence that rejected them — do not "restore" these

| registry | why |
|---|---|
| `dallas-specific-use-permits` | 530 `type_raw` values that are USES: Videoboard 1,067, Bus Passenger Shelter 914, Billiard Hall 655, Day Nursery 464, Electric Substation 417. An SUP authorises a use on existing land. |
| `slc-planning-petitions` | mixed: Minor Alteration 97, Conditional Use 107, Request for Rebuild 120 — and **34 of its 44 residential rows are `Routine and Uncontest Home Occ`**, a home-occupation licence. |
| `slo-county-planning-permits` | Zoning Clearance 6,605, SolarAPP+ 1,276, Fire Suppression 879, Vacation Rental 15. Its genuine `Residential New Structure` rows already qualify on their own activity text. |
| `burlington-vt-zoning-permits` | `type_raw` is a ZONING DISTRICT (`R1 - Single Fam`, `RA - Apartments`). A district is not an activity. |
| `arlington-permit-applications` | `type_raw` is an occupancy class (Single-Family, New Tenant, Mercantile). |
| `montgomery-county-residential-permits` | a FAMILY RULE was drafted for worktype `CONSTRUCT` (2,041 rows) and the measurement killed it — the sampled descriptions are *"Construct a pre-engineered metal shed"*, *"Prefabricated Suncast Modernist shed"*, *"Build deck using Typical Deck Details"*, *"Bike shed to shelter my bikes"*. |

**Provenance sits BELOW row-level routine evidence.** Fairfax's 68 real pools are still pools.

### Result — the ten families the audit named

| registry | rows | before | after |
|---|---:|---:|---:|
| fairfax-active-site-construction | 5,083 | 629 | 5,008 |
| delaware-county-pa-subdivisions-land-developments | 2,085 | 116 | 2,041 |
| austin-subdivision-cases | 1,784 | 1,077 | 1,784 |
| chester-county-pa-act247-plans | 1,177 | 58 | 1,171 |
| austin-site-plan-cases | 995 | 33 | 974 |
| york-county-pa-planning-subdivisions | 975 | 13 | 975 |
| seattle-land-use-permits | 294 | 3 | 282 |
| casa-grande-active-development-sites | 8 | 1 | 8 |
| dallas-specific-use-permits | 477 | 0 | **0 — rejected** |
| slc-planning-petitions | 44 | 0 | **0 — rejected** |
| **total** | **12,922** | **1,930** | **12,243** |

12,243 DEVELOPMENT + 160 ROUTINE + 519 UNRESOLVED = 12,922, exact.

---

## 3. A project name is not an activity

`ROUTINE_ANYWHERE` matched over `name`, which for many families is an address or a plan title.
Measured across the ten development-provenance registries, the routine words that fire from `name`
while ABSENT from `type_raw`:

| word | n | families | what they actually are |
|---|---:|---:|---|
| **addition** | **261** | 6 | subdivision NAMES — "MC ADAMS ADDITION TO HILLBROOK SEC 4 LT 48", "FIRST ADDITION TO TEMPLE VIEW", "Cook Resubdivision of a portion of Block G Bouldins Addition" |
| pool | 68 | 1 | **real pools** — "NEW POOL AT 3540 ST AUGUSTINE LANE", "CARRIAGE HILL LOT 60 - POOL" |
| relocation | 10 | 2 | lot-line relocations |
| tree | 5 | 2 | "The Woods at Rose Tree"; York's plan "Cherry Tree" |

So `PLACE_AMBIGUOUS` is exactly four words — `addition`, `additions`, `tree`, `trees` — demoted
**only** where the family's `name` is a plan / case / address label. **`pool` was deliberately not
demoted**: demoting it would have restored exactly the permit noise the rule exists to remove.

The label-vs-activity split is GENERATED from the registry's own `column_map.title` column names
(`scripts/residential-name-kind.mjs`, 55 label families of 239) and pinned by
`test/residential-name-kind.test.mjs`, which re-derives it and fails on drift.

---

## 4. Vocabulary and precedence

* **`subdivide` / `subdivided` / `subdividing` / `resub`** added from production text, each
  space-delimited so `resub` cannot match `resubmission`.
* **Unambiguous multi-word construction phrases** (`new construction`, `new single family`, …)
  now match anywhere in ACTIVITY text rather than only at its head. Naperville's
  `RESIDENTIAL Single Family New Construction - Lot 168` was UNRESOLVED under head-only matching.
* **Precedence.** Strong routine evidence (`type_raw`, or the head of `name`) now outranks every
  development rule. That removes the `DEV_ANYWHERE` leak the audit measured at 144 records:
  `Residential Interior Remodel … CLARION LAKE SUBDIVISION` is a remodel again.

The ladder, in order: STRONG_ROUTINE → DEV_HEAD/DEV_PHRASE (accessory-overridden) →
ROUTINE_ANYWHERE (minus place-ambiguous in a label) → DEV_ANYWHERE → PROVENANCE →
FAMILY_TYPE_RAW → UNRESOLVED.

---

## 5. Measured, not fixed — recorded so the next unit does not re-derive it

### Multifamily filed under another Type — 4,237 records, all `type_map` config

| registry | `type_raw` | current Type | n | classification |
|---|---|---|---:|---|
| `nashville-building-permits-issued` | `Building Residential - New` | Development | **3,517** | **genuinely Residential** |
| `nashville-building-permits-issued` | `Building Residential - Foundation` | Development | 2 | genuinely Residential |
| `austin-site-plan-cases` | `Commercial Multi Family` | Commercial | 523 | **mixed-use** — multifamily on commercially-zoned land |
| `austin-subdivision-cases` | `Commercial Multi Family` | Commercial | 195 | mixed-use |
| `nashville-building-permits-issued` | `Building Residential - Addition` / `- Rehab` | Development | 1,937 | correctly NOT residential development |

Every one is a `jurisdiction-registry.json` `type_map` decision, not a keyword fallback, so
correcting them is a Commercial/Development taxonomy change and is deliberately out of this unit.

### Ingestion evidence deficiencies — still open

| family | rows | missing |
|---|---:|---|
| `brunswick-county-permits` | 133,241 | `column_map.title[0]` = `ProjectType`, values only Residential/Commercial — no work-class column mapped |
| `sioux-falls-building-permits` | 81,609 | `PERMITTYPE` = Residential Building / Commercial Building only |
| `huntsville-building-permits` | 71,872 | `OccupancyType` |
| `san-jose-permits` | 59,561 | `SUBDESC` (building sub-type) |
| `loudoun-county-residential-permits` | 45,618 | `UNIT_TYPE` **and no `file_date` mapped at all** — 100% undated |
| `durham-building-permits` | 35,202 | `TYPE` = RESI / MULTI_FAMILY; named projects ("Fayette Place Affordable", "Durham Summit Apts") are unreachable |
| knoxville / albuquerque / adams / sheridan / lincoln / cambridge / flathead | 21,968 | land-use or building-use only |

**449,071 rows (35.0% of the Residential corpus).** Whether an activity column exists upstream
**cannot be verified from this environment** (no egress to the source ArcGIS/Socrata hosts), so
nothing was guessed. **INGESTION FOLLOW-UP REQUIRED**: probe each layer's field list for a
work-class column and, for Loudoun, a date column; map it in `column_map`; no code change needed.

### Temporal and Stage

No threshold was invented and none is applied. The retained population's age and Stage profile is
reported by `scripts/residential-measure.mjs` (`kept_stage`, `kept_undated`) on each run.

### Topeka footing-and-foundation — conservative behaviour preserved deliberately

`Residential Building Footing and Foundat` stays UNRESOLVED. 427 addresses carry it with no
`DSP Res Building New`, but at those same addresses 104 also carry `Residential Building Addition`,
79 `Residential Multi Garage` and 58 `Residential Covered Porch` — a foundation permit is issued
for whatever is being founded. Recovering them would be coverage bought with fabrication.

---

## 6. What "one card" actually guarantees

**ONE QUALIFIED SOURCE OBJECT = ONE CARD**, not one real-world project. The rail dedupes on
`railKey` (the site's `zip_project_ref`, else its record URL), and `zipAuthProjectCount` counts
distinct `zip_project_ref`. Nothing merges two source records that describe the same building, and
nothing should: DeKalb's `1881` townhome development files New Construction, General Combined
Plumbing and Electrical Combined Line as separate permits, and only the first qualifies.
