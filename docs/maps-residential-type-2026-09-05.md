# Map 1 — the RESIDENTIAL Type: qualify on ACTIVITY, not on residential use

**Founder rule, 2026-09-05.** Map 1 `Residential` means **meaningful new residential
development**. It does **not** mean routine work on an existing residential property.

A record does not become residential development because the property is residential, because
the source calls the building `Residential`, because `type_raw` contains "Residential", because
the work happens at an apartment complex, or because an old registry `type_map` mapped it to
`Residential`. **Classify the activity, not the building or the use.**

## What the previous read-only gate established

| | |
|---|---|
| live Residential objects | 266,421 |
| ZIPs displaying Residential | 1,126 |
| Residential objects in `app_projects` | 454,095 |
| unambiguously individual-property | ≥162,805 (61.1%) |
| unambiguously subdivision/planning | 1,134 (0.4%) |

It also proved the registries disagree with each other: New Hanover maps
`NHC Residential Electrical/Plumbing/Mechanical` → **Residential**, while Detroit maps the same
real-world class → **Development**. Historical `type_map` values describe ingestion behaviour;
they are not the product definition.

## The enforcement layer, and why it is not `lib/map.js`

`lib/map.js` answers *what TYPE is this object* (shape). `lib/residential-qualify.js` answers
*is this a Map 1 residential-development object at all* (eligibility). They are different
questions and must not be merged: `NAME_RULES` matches a bare `/residential/`, so a record
correctly rejected as `HVAC Residential` would otherwise be re-admitted downstream **by its own
name**. `test/residential-qualification.test.mjs` §16a proves that with a control — the
classifier alone *does* call the excluded record Residential — and §16b proves the gate runs
first.

The gate runs at the single point each mode builds a site:

* `lib/zip-authoritative.js::zipAuthSiteFromMarker` — ZIP mode
* `lib/n5-radius.js::n5SiteFromRow` — address mode

so one decision governs **qualification = rendered markers = rail count**. `zipAuthProjectCount`
counts sites, so a rejected record cannot be counted; `zipAuthNote` reads the same sites, so the
sentence a resident reads and the pins they see cannot disagree.

**A rejected record is DROPPED. It is never relabelled `Development` or `other`** — an HVAC
permit is not made correct by changing its Type. Qualification and Type assignment stay separate
decisions.

**Scope is enforced by the SHIPPED classifier**, not by a second copy of the residential rules:
the gate calls `HS.resolveTrackerMarker(site)` and acts only when `typeKey === 'residential'`.
Data center, Regulated facility, Roads & infrastructure and Commercial are untouched by
construction, and that is asserted (§22a–22d).

## The evidence, and why `name` is structured source evidence

`app_projects` carries only these usable fields — measured 2026-09-05: `scope_text`, `size` and
`developer` are NULL for **100%** of residential rows. So the rule reads `type_raw`, `name`,
`registry_id`, and (for reporting) `status` / `submitted_at`.

`name` is not free text being guessed at. Each registry's `column_map.title` is an ARRAY whose
FIRST element is a real source column, and for the high-volume families that column *is* the
activity:

| registry | `title[0]` | example |
|---|---|---|
| `miami-building-permits` | `ScopeofWork` | `NEW CONSTRUCTION …` |
| `memphis-dpd-building-permits` | `Construction_Type` | `NEW …` / `ALT …` |
| `dekalb-county-building-permits` | `WorkTypeDescription` | `Repairs to Existing Structure …` |
| `denton-county-dev-permits` | `PermitType` | `HOUSE` / `ADDITION TO HOUSE` |
| `little-rock-permits` | `PermitType` | `PLU` / `ELE` / `MEC` / `BLD` |

`type_raw` is **not** uniform and is never read as activity nationally: it is the activity in
New Hanover, but the BUILDING USE in Little Rock (`APARTMENT COMPLEX` is 86.5% plumbing,
electrical and mechanical permits) and a `UNIT_TYPE` in Loudoun.

## Precedence

1. `DEV_ANYWHERE` — subdivision / plat / site plan / planned development (Class 6, unconditional)
2. `ROUTINE_NAME_HEAD` — the work-type column outranks the occupancy column
3. `DEV_HEAD` / `DEV_HEAD_WEAK+NOUN` — an explicit new-construction scope
4. `ACCESSORY_OBJECT_OUTRANKS_DEV_HEAD` — a standalone accessory object with no development scale
5. `ROUTINE_ANYWHERE`
6. `FAMILY_TYPE_RAW` — the only registry-specific assertions
7. `UNRESOLVED` → **does not render** (Class 4 fails conservatively)

## Why the measurement is generated, not hand-written

The product decision runs in JS; the national population (450k+ objects) can only be counted in
Postgres. Two hand-written implementations would drift. `scripts/residential-qualify-sql.mjs`
**generates** the SQL from the module's own exported vocabulary, and every phrase is asserted to
be pure `[a-z0-9 ]` — with no metacharacter, a POSIX alternation of literals and a substring
containment test are the same predicate in both engines.
`test/residential-qualify-sql-parity.test.mjs` pins that on 30 real production strings.

## What the adversarial production audit changed

Automated tests passed while the rule was still wrong. Reading real rows caught it:

* **Miami** files ScopeofWork as `NEW CONSTRUCTION` and puts the real object in `WorkItems`, so
  `NEW CONSTRUCTION WOOD FENCE`, `NEW CONSTRUCTION COMBINATION POOL AND SPA`,
  `NEW CONSTRUCTION TREE REMOVAL` and `NEW CONSTRUCTION GENERATOR (SINGLE FAMILY / DUPLEX)` all
  head-matched a development phrase while being a fence, a pool, some trees and a generator.
  → accessory objects now outrank a development head unless the record states development scale.
* The first fix was **itself too broad**: listing windows, siding, roof, garage and waterproofing
  as accessory objects excluded `NEW CONSTRUCTION TWO-FAMILY RESIDENCE|WATERPROOFING`, a real
  two-family residence. Those are normal components of a new build and were removed from that
  list; they remain routine on their own.
* `type_raw='Residential'` self-corroborated every weak head, turning the street `NEW HOPE RD`
  into a development. The corroborating noun must come from the same field as the head.

## How the national numbers are produced

`scripts/residential-measure.mjs` + `.github/workflows/residential-measure.yml`.

SQL could not deliver them here, and that is worth recording so nobody repeats it: there is no
index on `app_projects (record_kind, type)`, so isolating the ~635k residential rows out of 3.2M
is a full scan. With a concurrent geography build (`geo.n5_p2_gap` DDL, observed in
`pg_stat_activity` at 20:09Z) on the same instance, **every** shape tried exceeded both the 60s
MCP budget and the 120s Management-API budget: hash join, cross-join-lateral over the membership
keys, and a ZIP-range chunk.

Measuring through `app_zip_projects_markers` is not a weaker substitute — it is the read the page
itself performs, and the counts come from the same `lib/` modules the browser runs, loaded in the
page's order. **"Before" is not a second implementation**: the same shipped `zipAuthSitesFrom()`
runs twice per ZIP, once with `HS.residentialGateDrops` detached, so the difference *is* what the
gate removed. The script reports which table supplied the ZIP denominator, because a denominator
that silently changed source would make every percentage unreadable.

## Deferred, not done

* **Temporal relevance is unresolved and deliberately not decided here.** Retained records include
  Denton `HOUSE` permits dated 2013–2014 and an Austin subdivision case dated 2003. The founder
  rule says activity qualification and temporal relevance are separate questions and that a
  threshold must be measured before adoption. The stage/date distribution of the retained set is
  reported; no date threshold is applied.
* **11,310 Residential objects hold authoritative POLYGON geometry rendered as a point-on-surface
  pentagon.** Separate presentation question, untouched by this population correction.
* **Recovery from other Types is not implemented.** Generic-typed records that state residential
  development are already classified Residential by `NAME_RULES` and are therefore gated like any
  other; records typed Commercial/Industrial that state residential development are not retyped,
  because retyping is a classifier change and this unit corrects the population.
