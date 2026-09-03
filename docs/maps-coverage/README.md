# Map 1 ZIP-page geometry completeness — the SEO-readiness gate

**Measured 2026-09-03.** Definition of record: `scripts/n5_zip_coverage.sql`.
Rollup artifact: `zip3-geometry-completeness.csv` (544 ZIP3 prefixes).

## What a Map 1 ZIP page owes the resident

Every development whose **authoritative geometry intersects that ZCTA polygon**. **In ZIP mode
there is no saved address, so centroid/radius placement is structurally impossible** — a ZIP
centroid is a page anchor, never a home. Radius stays valid ONLY in address mode (resident-entered
home + 0.5/1/2/5 mi). Replacing the legacy 3-mile ZIP membership with polygon intersection is the
fix for the ZIP-geography bug.

## The gate — three classes, so readiness is computable rather than judged

Every candidate development on a ZIP page falls in exactly one class:

| class | meaning | blocks the gate? |
|---|---|---|
| **adjudicated** | HAS authoritative geometry, so the polygon test already decided it — placed on this page, or correctly absent | no |
| **pending** | COULD have geometry and does not yet: an unrecovered RECOVERY project, or a PROVEN project rejected into `geo.n5_point_reject` (MULTI_COORD_UNRESOLVED / NULL_COORD). **Waiting can change these.** | **YES** |
| **terminal** | can NEVER have geometry: NOAUTH, IDENT_UNRESOLVED, HIST_UNRECOVERABLE, or a permanently excluded registry. **Waiting cannot change these.** | no — but the page must disclose them |

```
FULLY_POPULATED (SEO-ready)  ==  pending = 0
INCOMPLETE                   ==  pending > 0
```

**Terminal deliberately does not block.** A gate nobody can ever pass is not a gate: 63,624
candidate pairs can never acquire geometry, and holding their pages forever would make the metric
useless. They are excluded from the gate and disclosed on the page instead.

## National state today

| | |
|---|---:|
| ZIP pages with at least one candidate development | **10,470** |
| **FULLY POPULATED (pending = 0) — SEO-ready today** | **1,529 (14.6%)** |
| INCOMPLETE — blocked on pending geometry | 8,941 |
| … of the complete ones, complete *with disclosure* (terminal > 0) | 94 |
| … complete but empty (no development adjudicated onto them) | 44 |
| candidate pairs adjudicated | 2,195,476 |
| candidate pairs **pending** | **494,702** |
| candidate pairs terminal | 63,624 |
| ZIP3 prefixes 100% complete | **41 of 544** |
| ZIP3 prefixes 0% complete | **362 of 544** |
| prefixes with boundary-first `placed` measured | **3 of 544** (021, 010, 890) |

⚠️ **`placed_by_polygon` is populated only for the 3 probed prefixes.** Everywhere else the column
is 0 because the boundary-first pass has not run there — **that is "not measured", not "zero
developments"**, and the workbook must render it as such.

⚠️ **10,470, not 10,467.** Three ZIP pages carry boundary-first membership while carrying **no
legacy candidate at all** — developments whose geometry lands in a ZCTA the legacy method
associated with nothing. They are pure under-inclusion discoveries, and they are why the page
count rises when the two sets are joined.

## Worked example — 890 (Las Vegas / Henderson)

- **8 of 47 ZCTAs carry any geometry at all**; the other 39 are empty of placed developments.
- **11 of 47 boundaries a shard-first (centroid-era) build would never have loaded** — 89001,
  89008, 89010, 89013, 89017, 89019, 89020, 89022, 89042, 89043, 89047 — because the legacy set
  never named them, so no boundary was fetched and no development could ever have been placed.
- **89011 is the under-inclusion made visible per page: 3,754 placed by polygon against 1,611
  legacy candidates.** `placed` exceeding `adjudicated` is the signal, not an error — geometry
  landing inside the ZCTA for projects the 3-mile method never associated with it.
- Every 890 page is currently **INCOMPLETE**: even 89011, with 3,754 placed, still has 19 pending.

## What makes a blocked page complete

Blocked pages are dominated by a short list of registries. Top pending drivers by pages touched:
`txdot-projects-info-all` 666 pages · `penndot-transportation-projects` 545 · `nysdot-capital-program-projects`
632 · `massdot-highway-projects` 281 · `dallas-specific-use-permits` 164.

Two different fixes, and they are not interchangeable:
- **RECOVERY registries** (txdot, massdot, dallas …) complete when the **geometry-acquisition loop
  acquires them**. 144,769 projects remain.
- **PROVEN rejects** (penndot, nysdot, cabarrus …) are blocked by the **4,877
  MULTI_COORD_UNRESOLVED + 294 NULL_COORD** decisions. These are a **policy** question — what a
  multi-coordinate project's geometry should be — not an acquisition question. They are a small
  project count that blocks a disproportionate number of pages, because DOT projects span many ZIPs.
