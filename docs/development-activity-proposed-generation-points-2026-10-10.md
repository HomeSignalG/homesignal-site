# Proposed projects in the Development Activity report — the radius read ignored the serving generation (2026-10-10)

**Verdict: SAFE CORRECTION READY (not applied).** One reusable defect, one DDL file, no application-code change.
Everything below was measured read-only against production on 2026-10-10 and is marked with how it was measured.
Nothing was written to production, nothing deployed, nothing merged.

## Current sources of truth (read, not remembered)
`homesignal-site` `main` `34ba0ab` · `homesignal-ingest` `main` `30a47e7`. Serving generation `n5-national-2026-10-10`
(ACTIVE since 11:45Z); frozen snapshot `phase1-2026-09-01` (READY, canonical-synced 2026-09-03).

## The path a proposed record takes, and where it was lost
1. publisher record → `app_projects` (`status='Proposed'`, `source_key`) — works.
2. geometry: **two stores.** `geo.n5_geom` = the frozen phase-1 snapshot's `proven_stored_point` rows + recovered publisher
   geometry. `geo.n5_gen_proven_point` = the serving generation's own verified stored points, rebuilt daily by
   `geo.n5_gen_prepare_publish` with the same rule (one distinct stored coordinate of a PROVEN registry; otherwise a
   `geo.n5_generation_key_verdict`). Map 1's ZIP mode, the ZIP pages and `n5_serving_membership` read the second.
3. `public.n5_projects_within_radius` — **read `geo.n5_geom` only.** ← the missing link.
4. `readReportInputs` → hydrate → `assemble` → `lib/da-report-view.js` — all correct once a row arrives (proven below).

So any project captured after 2026-09-01 and not recovered as publisher geometry was drawn on Map 1 and never reached the
report, whatever its lifecycle, Type or rights status.

## Measurements (each with its control)
| claim | query result |
|---|---|
| radius RPC corpus is the frozen snapshot | `geo.n5_verdict_manifest`: one row, READY, `phase1-2026-09-01`; `proven_stored_point` rows all carry that `verdict_snapshot_id` |
| generation holds points the RPC cannot see | generation 724,721 points; **78,301** have no admitted `n5_geom` row; **0** of those carry a generation reject verdict |
| by lifecycle (those 78,301 keys) | Approved 58,394 · Operating 8,130 · **Proposed 7,575** · Decided 4,257 |
| Texas planning sample (6 cleared families: austin site-plan / zoning / subdivision, arlington-planning, san-marcos-planning, round-rock-large-development) | **970 Proposed keys**; 760 visible to the report today; **194 are generation-only** → 954 after; 16 stay held |
| the real example | Austin `SP-2026-0279C` "Lightsey Residences", Proposed / In Review, filed 2026-09-01: **0 rows from the deployed RPC at 0.5 mi and at 1 mi** with the subject 0.449 mi away; control: the same call returned 173 other rows |
| performance of the new branch | `EXPLAIN ANALYZE` of the equivalent SELECT in central Austin: 27.9 ms, `n5_gen_proven_point_gix` + indexed anti-joins (a read; no DDL ran in production) |

### The 16 still held (970 − 954), by exact exclusion point
* 9 created after today's 11:45Z generation capture (8 Austin site-plan, 1 Austin subdivision) — enter at the next generation.
* 5 San Marcos: no coordinate in the source record (geometry missing) — correctly held.
* 2 with a generation reject verdict (1 Austin site-plan, 1 San Marcos) — correctly held.

## The correction (docs/n5-spatial-read-rpc.sql, revision 4)
A second candidate branch in `hit`: the ACTIVE generation's `geo.n5_gen_proven_point` rows, **only** for projects `geo.n5_geom`
does not already admit, excluding `geo.n5_point_reject` and the generation's own reject verdicts. Same `ST_DWithin` on the same
geography cast, same marker derivation, same ordering and `p_limit + 1` / `has_more`. Label stays `proven_stored_point`,
`feature_id` `pt:1`. Return type, grants, security definer and `search_path` unchanged (plain `CREATE OR REPLACE`). No serving
generation, or only `ACTIVE_LEGACY`, behaves exactly as revision 3. It is strictly additive: every row revision 3 returned is
still returned unchanged. No Texas code, no ZIP list, no new vocabulary, no second distance calculation.

**Side effect, intended:** Map 1's address mode calls the same function, so it gains the projects its ZIP mode already draws.

## Proof through the shipped report path
Real production records (`test/fixtures/n5-generation-points/real_rows.json`, md5 `5f5caaef…`) loaded into a real PostGIS;
the previous DDL and the new DDL each queried at constructed subject points (not customer properties); the returned rows then
run through the real handler, `assemble()`, the shipped `report-rights.json` and `lib/da-report-view.js`
(`test/national-report-generation-points.test.mjs`, 18 checks).

| subject 0.45 mi from the project | previous DDL | new DDL |
|---|---|---|
| rows returned | 4 | 11 |
| Lightsey Residences in the report | no | yes |
| briefing | 4 records · 2 approved · 2 proposed | 11 records · 2 approved · **5 proposed / under review** · **4 decided (denied or withdrawn)** |

The rendered row (shipped renderer, text of the table row):
> **Lightsey Residences** · Residential · 0.4 mi south · Official source → · **Stage: Proposed / Under Review** · Agency stage: In Review ·
> **Quality-of-Life Impact:** Potential construction noise and traffic, then added neighborhood activity or visual change. Not site-verified; no effect is established.

At ~0.55 mi it is excluded (8 rows, no Lightsey). A denied record (e.g. SWAFFORD) renders "Decided (denied or withdrawn) · Agency
stage: Denied · no development effect is considered unless it is refiled" and is counted separately from open proposals.
An unclassified Type ("South Lamar Blvd Street and Utility Improvements Plan") renders under the existing Other project fallback.

## Regression results
* `test/n5_spatial_pg/run_suite.py` on PostGIS (local PG 16 / PostGIS 3.x; production is 17.6 / 3.3.7): **135 / 135** (the 107 revision-3
  assertions unchanged and green with the new tables empty, + 28 new incl. 4 mutations each detected). Baseline before the change: 107 / 107.
* `node test/n5-spatial-read-rpc.test.mjs` (static pins): 126 pass. Three pins named the old shape (table list, ordering text, marker join) and were
  updated on purpose; they now also pin the new branch.
* `node test/national-report-generation-points.test.mjs`: 18 / 18.
* `node scripts/run-unit-tests.mjs`: every non-browser file passes; **33 `*.browser.test.mjs` files did not run** — `playwright` is not installed in this
  sandbox (`ERR_MODULE_NOT_FOUND`). They exercise unchanged JavaScript against stubs; CI runs them. Not reported green here.
* N5 membership, Rule D/F, ZIP cards, project pages, Type/lifecycle, the change ledger, watches and notifications: **not touched** — the diff is
  one SQL file and tests; none of them calls `n5_projects_within_radius` except the report (`report-reads.ts`) and Map 1 address mode (`lib/n5-radius.js`).
  Watches reuse `report-reads.ts`, so a watched address can now see these projects; that is the same read, not a second path. Saved report
  snapshots are immutable and unchanged.

## Applying it (needs the founder's separate authorization — not done)
1. Merge the PR. 2. `n5-rpc-apply.yml` pins `AUTHORIZED_COMMIT` and an expected DDL sha256; both must be updated to the merged commit with
   that authorization, then dispatched. 3. After apply: re-run the production read-only check in this file (Lightsey at ~0.45 mi → 1 row; the
   173-row control unchanged or larger; owner `postgres`, grants anon/authenticated/service_role).
**Rollback:** `CREATE OR REPLACE` the previous revision (`git show 34ba0ab:docs/n5-spatial-read-rpc.sql`); the signature is unchanged.

## What this does not claim
* The 194 / 7,575 are geometry-eligible records; whether each belongs in a paid report is still decided downstream by rights, lifecycle and Stage
  (all 6 Texas families are cleared in `report-rights.json` under ruling R7, which is source-risk acceptance and not a publisher commercial-use grant).
* A generation point is a coordinate the source asserted (same class as the snapshot point); it is not publisher site geometry and is not described as such.
* Old denied/withdrawn records (e.g. filed 2000) newly appear as decided history. The renderer prints "Confirm it is still active" under them; that
  wording is pre-existing and slightly off for a denied record — left alone, logged.
* Not tested: apply against production (no DDL is run there for a dry run); the 33 browser files above.

## Remaining coverage gap (Texas sample)
* `houston-plat-applications`, `harris-county-plats`, `san-antonio-prelim-plan-review`: **zero `app_projects` rows** — source records are not materialized, so
  no report can see them. Not investigated beyond that count; QUEUE records Harris County as one modeled ZIP page.
* `dallas-specific-use-permits`: all 1,329 keys are `Operating`; `fort-worth-zoning-cases`: 37 Approved / 7 Decided / 0 Proposed — no proposed records to show.
* The 16 held records above.
