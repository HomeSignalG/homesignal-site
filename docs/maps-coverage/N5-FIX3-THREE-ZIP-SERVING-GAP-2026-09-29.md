# Fix 3 — the three ZIPs with a boundary and no serving row (2026-09-29)

**ZIPs 94128 (San Francisco, San Mateo County CA), 95219 (Stockton CA) and 99128 (Farmington,
Whitman County WA).** Each has a usable Census ZCTA polygon and had no row in the generation Map 1
served until 2026-09-27. This is a separate population from the 706 canonical ZIPs that have no
usable boundary; those were not touched.

## 1. What was missing, measured

`geo.maps_zip_geography_status`, grouped by generation and status (read 2026-09-29):

| generation | boundary_complete | not_measured | canonical ZIPs with no row |
|---|---:|---:|---:|
| `legacy-phase1-2026-09-01` (served until 2026-09-27 15:00Z) | 12,013 | 706 | **3** |
| `n5-national-2026-09-25` | 12,016 | 706 | 0 |
| `n5-national-2026-09-27` (ACTIVE since 2026-09-29 20:30Z) | 12,016 | 706 | 0 |

The three missing from legacy are exactly 94128, 95219 and 99128. Controls in the same read:
12,722 canonical ZIPs, 12,016 of them with a `geo.zcta_boundary` row, 0 canonical ZIPs without a
boundary and without a serving row.

All three boundaries are valid, non-empty `MULTIPOLYGON`s from `TIGER/Line 2025 (2020 Census ZCTA
delineation)`: 8.687 km², 362.882 km² and 154.091 km².

## 2. Why they were omitted

**Each is the only canonical ZIP in its ZIP3 prefix.** `canonical_zip_registry` holds exactly one
ZIP in each of 941, 952 and 991.

The legacy generation was built by the retired `scripts/n5_unit_a_shadow.py`:

- `select_prefixes()` returns only prefixes with a finished shard:
  `select z3 from geo.n5_shard where state='done'`.
- Its `POPULATE` statement writes a `boundary_complete` status row only for boundaries it made
  resident for that prefix.
- The 706 `not_measured` rows came from a separate backfill that covered ZIPs **without** a
  boundary.

`geo.n5_shard` holds no row for snapshot `phase1-2026-09-01` in 941, 952 or 991, so none of the
three prefixes was ever built. A ZIP with a boundary in a shard-less prefix was covered by neither
writer. That is the whole cause.

## 3. The generation path already carries the repair for presence

`docs/n5-generation-publish.sql` A4b (#1336) defines the publication scope as the generation's
shard prefixes **plus every canonical prefix**. `geo.n5_gen_publish_prefix` step (4) then writes a
status row for **every** canonical ZIP in the prefix: `boundary_complete` where the loader made a
polygon resident, `not_measured` otherwise, never no row. READY and ACTIVATE refuse on
`canonical_zip_without_status` (Part D D11).

- The executable suite already pins this shape: `S1` publishes a canonical prefix with no shard
  (`113`) and shows it blocks READY until published. Mutation `M9` (scope shrinks to shards) is
  killed by it.
- In production, `n5-national-2026-09-25` has a shard for 941 (32 pairs) and 952 (2 pairs), and
  **none for 991**. 991 was published anyway (`n5_generation_publish`: zcta_loaded 1,
  status_rows 1), which is the canonical-prefix half of the scope at work.

## 4. Serving now, and correct

Read through `geo.n5_serving_status` and `public.app_zip_geography_state` on 2026-09-29:

| ZIP | status | membership_rows | geography_state |
|---|---|---:|---|
| 94128 | boundary_complete | 0 | authoritative |
| 95219 | boundary_complete | 0 | authoritative |
| 99128 | boundary_complete | 1 | authoritative |

`app_zip_geography_state` nationally: 12,016 authoritative + 706 not_measured, **0 pending**.

**The counts were recomputed, not trusted.** Each polygon was intersected with the generation's
own candidate geometry (`geo.n5_gen_candidate_geom('n5-national-2026-09-27', boundary)`):
recomputed 0 / 0 / 1, stored 0 / 0 / 1. Then, against the snapshot's expected set:

- **94128**: 32 projects state 94128 as their ZIP. All 32 have a point, and **all 32 lie outside
  the polygon**, 1.02 to 13.57 km away (SFO's ZCTA is the airport). No project from any ZIP has a
  point inside it. A measured zero is correct.
- **95219**: 2 projects state 95219. Both are recorded unresolved as `GEOMETRY_INVALID`. The only
  expected-set point inside the polygon is `arcgis:caltrans-sb1-projects:1017000185`, stated
  94505 and unresolved `GEOMETRY_INVALID`: its geometry was refused, so it is withheld rather than
  placed by its point. A measured zero is correct under the contract.
- **99128**: the one member is `arcgis:wsdot-project-delivery-plan-complete:602702O`, a WSDOT
  line whose geometry crosses the polygon. No project states 99128.

The live verifier's last run (`verify-map1-zip-states` #91, 2026-09-29 00:18Z) rendered the pages
and agreed: 94128 is a measured zero that "shows nothing, because there is nothing"; 99128 draws
its 1 development record.

## 5. What this change adds

### 5.1 Status must match the boundary, not merely exist (Part G)

The presence check cannot see a **wrong** row. The publisher decides `boundary_complete` from the
TIGER shapefile the loader downloads (`scripts/n5_publish.py::load_boundaries`). A shape it skipped
(`if not rings: continue`) would be published as `not_measured`, and every existing check would
pass.

`geo.n5_generation_publish_problems` gains `canonical_zip_status_disagrees_with_boundary`: the
count of canonical ZIPs whose status is not the one `geo.zcta_boundary` implies, in both
directions. `geo.zcta_boundary` is the same pinned file (TIGER 2025 ZCTA520, 33,791 polygons) held
in the database. Both READY and ACTIVATE already run this function, so both refuse.

- Measured before applying: **0 disagreements** in every generation that has rows (legacy, 09-25,
  09-27), so the check changes nothing today, including for the daily automatic build.
- DDL of record: Part D D11. Production apply file: `docs/n5-generation-publish-part-g.sql`,
  generated from Part D by `test/n5_generation_pg/build_part_g.py` and fail-closed on
  `md5(prosrc)` before (`611926736840a6b43847978d2ec9e9d6`, equal to Part D's pre-change body) and
  after.
- Suite (`test/n5_generation_pg/run_suite.py`, run locally on PostgreSQL 16 + PostGIS 3): **78
  PASS / 0 FAIL, 22 of 22 mutations killed.** New: `B0` control, `B1` a boundary ZIP published as
  `not_measured` blocks READY, `B2` a no-boundary ZIP published as `boundary_complete` blocks READY,
  `B3` restored. `M21` (the comparison removed) is killed by B1; `M22` (only one direction checked)
  is killed by B2. The end-to-end lifecycle through the real orchestrator also passes.

**Applied 2026-09-29 23:56Z** from `main` at `57aa5b6` (#1482), through `db-sql.yml` run
`36647789091`. Read back afterwards through MCP:

- Live `md5(prosrc)` is `66f5995db01c5bb8d6c9d88f9a217234`, which is Part G's post-condition
  value. The grants are unchanged (`postgres` only).
- The new check's predicate on the ACTIVE generation `n5-national-2026-09-27`: 12,722 status rows,
  **0 disagreements**. It takes 88 ms (`explain analyze`).
- `n5-national-2026-09-29` (BUILDING) had 0 status rows at that moment, so the check had nothing to
  read there yet. It applies when that generation publishes and asks for READY.

### 5.2 The live verifier stops failing on a state that is now correctly empty

`verify-map1-zip-states` had been red since the first national activation (runs 90 and 91) with a
single failure: `COVERAGE: no candidate ZIP is currently in the 'pending' state`. The three ZIPs
were the only live members of that state.

- `FORMER_GAP` (94128, 95219, 99128) must each resolve to a measured state. One reading `pending`
  or unresolved fails.
- The pending page contract is still exercised on the live page, by handing it the producer's exact
  `unknown` reply (`{mode:'authoritative', zip, status:'unknown', projects:null, markers:null}`,
  read from the live `app_zip_projects_markers` body). Only that ZIP's development-geography request
  is replaced, only for that page load. The case fails unless the fake actually reached the page.
- Only `pending` may be exercised this way. Every other state still needs a live member, or
  COVERAGE fails as before.
- Offline pins `10a`-`10g` in `test/map1-zip-state-kind-resolution.test.mjs`; three mutations of
  the verifier (gap may be pending, fake need not fire, any state may be synthetic) each fail it
  on exit code.

## 6. Not changed

- The 706 ZIPs with no usable boundary.
- The legacy generation's rows. It is SUPERSEDED, and the row guard refuses writes to it.
- `public.app_zip_geography_state` grants: `anon` holds INSERT/UPDATE/DELETE/TRUNCATE on the view
  but not SELECT (read 2026-09-29). Pre-existing, out of scope, recorded here only.
