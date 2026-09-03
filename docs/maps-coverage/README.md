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

---

## 2026-09-03 — TERMINOLOGY CORRECTION, and the 12 boundary-first placement runs

⚠️ **"SEO-ready" is withdrawn as a name.** Founder correction; three separate states, and merging
them is how a page gets called live when only its acquisition is unblocked:

| state | means | measured by |
|---|---|---|
| **ACQUISITION_UNBLOCKED** | `pending = 0` — no candidate development on this page can still gain geometry by waiting | `scripts/n5_zip_coverage.sql` |
| **BOUNDARY_PLACED** | exact boundary-first membership has actually EXECUTED for this ZIP | `geo.n5_boundary_membership` + the prefix's run receipt |
| **SEO_CANDIDATE** | both of the above — **subject to later SEO/content gates** | the intersection, listed in `COMPLETED-SHARDS-BOUNDARY-PLACED-LIST.md` |

⛔ **Everything above this line keeps its dated wording.** Those measurements were true on their
date; editing a receipt to match a later name falsifies it. Only the vocabulary moved.

**`placed_by_polygon = 0` may be read as zero ONLY after that ZIP's boundary-first placement has
executed successfully.** Before that it is `NOT_MEASURED` and the column is written EMPTY, never
`0`. The `boundary_placement` column says which.

### The 12 authorized runs (011–019, 062, 063, 520) — all succeeded

Boundary-first prefixes are now **15 of 544**, up from 3: 010, 011, 012, 013, 014, 015, 016, 017,
018, 019, **021**, 062, 063, 520, **890** (021 and 890 were the earlier bounded probes and are not
completed acquisition shards, so they are not on the artifact).

Write target was `geo.n5_boundary_membership` alone. **`geo.n5_association` was not written.**
Verified before and after the 12 runs at **20,170 rows**, fingerprint unchanged.

⚠️ **The fingerprint EXPRESSION is now pinned here, because an unpinned one is not a control.**
The pre/post comparison was made in-session with a matched expression on both sides; that
expression's text was not written down, so a later session recomputing "the md5 of
`n5_association`" gets a different string from the same unchanged table and cannot tell that
from drift. Canonical from now on — **pin the collation (rule 9)**:

```sql
-- collation-pinned, order-dependent
select md5(string_agg(source_key||'|'||zip||'|'||evidence, chr(10)
             order by (source_key||'|'||zip) collate "C")) from geo.n5_association;
--> 4520cac2cba9039845b1db6237231536   (20,170 rows, 2026-09-03)

-- order-INDEPENDENT companion: addition commutes, so no sort and no collation at all
select sum(('x'||substr(md5(source_key||'|'||zip||'|'||evidence),1,8))::bit(32)::bigint)
  from geo.n5_association;
--> 43526467596064
```

Row-level control that the table is intact rather than merely the same size: evidence
distribution **1 → 5,592 · 2 → 9,857 · 3 → 4,721**, summing to 20,170. The 5,592 evidence-1
(geometry_verified) rows are exactly the pairs boundary-first re-derived — an independent
agreement between the legacy evidence stamp and this pass.

### The artifact: 424 ZIP pages, 12 columns

`completed-shards-zip-coverage.csv`, body md5 `c999fe69662606670996c497663ae00b`, verified against
the database. **424, not 411** — 13 further pages carry boundary-first membership with no legacy
candidate at all. They are reachable only because boundaries drove the pass rather than the frozen
legacy slice; a slice-first build cannot see them, which is the under-inclusion blindness this
work exists to measure.

| aggregate | value |
|---|---:|
| exact authoritative membership (`placed_by_polygon`) | **5,893** |
| legacy membership (`geo.n5_association`) | **20,170** |
| confirmed legacy (in both) | **5,592** |
| legacy over-inclusion removed (legacy \ geometry) | **14,578** |
| geometry-only under-inclusion added (geometry \ legacy) | **301** |
| pages with membership / zero membership | 350 / 74 |
| pages with membership and **zero** legacy candidates | 16 |

Both closures are exact: `5,592 + 14,578 = 20,170` and `5,592 + 301 = 5,893`.

⚠️ **`legacy_membership` and `adjudicated` are DIFFERENT UNITS and must not be added.**
`adjudicated` (12,320 pairs) counts candidate pairs from the frozen identity snapshot — a project
under its OWN filed ZIP. `legacy_membership` (20,170) is `geo.n5_association`, the 3-mile fan-out,
which associated projects with neighbouring ZIPs the snapshot never enumerated them under. Every
adjudicated pair is in the association set; **7,850** association pairs are not adjudicated pairs.

🛑 **A withdrawn intermediate, recorded so it is not re-quoted.** A pre-artifact computation
reported legacy 19,913 / confirmed 5,335 / under-inclusion 558. It was **internally consistent and
wrong**: `confirmed` was computed against the 12,320 adjudicated pairs while `over_inclusion` was
computed against the 20,170 association pairs, and `legacy` was then written as their SUM — so it
closed only against itself. The gap is exactly **257 pairs, across 196 projects and 77 ZIPs**,
each present in `n5_association` AND re-derived by geometry, but not a candidate pair in the
snapshot. Counting them as newly-discovered under-inclusion overstated the discovery by 85%
(558 vs 301). **Two counts that both "close" can still disagree; check the denominators.**

### The run log and the artifact measure against DIFFERENT legacy sets — both correct, never interchangeable

`scripts/n5_boundary_first.py` prints its per-prefix diff against the **candidate-pair
enumeration** (`preservation.app_project_identity`, every development pair in the prefix):

```sql
leg as (select distinct i.zip::text zip, i.source_key
          from preservation.app_project_identity i
         where i.snapshot_id=… and i.record_kind='development' and left(i.zip,3)=…)
```

The artifact diffs against **`geo.n5_association`** — the 3-mile membership Maps actually
reads. So the two answer different questions and their under/over-inclusion numbers differ
per prefix by construction:

| | run log (`bf-*` job 100705341524) | artifact |
|---|---|---|
| legacy set | candidate pairs from the snapshot | `geo.n5_association` |
| question | did geometry place a project on a page the snapshot never paired it with? | how does exact membership differ from the membership in production? |
| under-inclusion, 12 prefixes | **469** | **253** (301 including 010, run in an earlier job) |

The gap reconciles exactly, prefix by prefix: for every prefix, `artifact_legacy −
log_legacy = log_under − artifact_under` (062: 1,890 − 1,797 = 102 − 9 = 93 · 063: 2,176 −
2,130 = 54 − 8 = 46 · 012: 528 − 490 = 62 − 24 = 38 · 015: 22 · 017: 8 · 019: 4 · 014: 3 ·
018: 2; 011, 013, 016 and 520 agree exactly). **Quote the basis with the number.**
