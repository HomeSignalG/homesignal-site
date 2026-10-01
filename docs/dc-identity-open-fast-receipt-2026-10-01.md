# Identity-open view: record keys read once — receipt, 2026-10-01

**Status: NOT YET APPLIED to production.** Apply file: `docs/dc-identity-open-fast-apply.sql`; DDL of record: `docs/dc-step3a-canonical-identity.sql`.

## Measured (production, read-only one-off jobs; every number beside its control)

The geography job took 199 s of its 300 s ceiling (17:35 daily runs since 09-23: 9 · 7 · 83 · 94 · 98 · 101 · 157 · **199** s). In isolation one view,
`dc_entity_identity_open`, took **192–197 s**; the other pieces took ~5 s together.

| probe | result |
|---|---|
| first guess: run the different-source test before the adjudicator (145 of ~2,340 candidates survive) | 191.9 s vs 191.5 s — **no speed-up** (kept: parity-proven, harmless) |
| candidates + adjudication + filters, materialized | 272 rows, 15.8 s |
| record keys with rank < 2, materialized once | 32,170 rows, 0.4 s |
| exclusivity test against those keys (correlated probe) | 2.2 s |
| **the rewritten view, whole** | **272 rows, md5 `35cadd92…` = the old view's 272 rows and md5, 17.9 s** (a second read 16.9 s) |
| a join form of the exclusivity test | cancelled at 900 s — **worse**, rejected |

The cause was the per-row `NOT EXISTS` reaching `dc_observation_record_key` (a window-function view over every observation) once per surviving pair.

## Change
(1) The different-source / different-entity test runs before the adjudicator. (2) Rank < 2 record keys are computed once (`MATERIALIZED` CTE) and the unchanged exclusivity rule probes that. Same rows, same columns, security_invoker, closed to anon/authenticated.

## Proof (stand-in, shipped chain)
- `test/dc_identity_open_fast_pg/run.sh`: 13 shipped checks, 7 deliberate breaks killed. P2 the apply yields exactly step 3A's definition; P5 a counting wrapper proves the adjudicator is never called for a same-source pair and still is for a cross-source one; P6 the exclusivity rule keeps its meaning (a different stable record on the other entity separates; same entity does not; a singleton-keyed record never does).
- E37 in the Epoch PostGIS suite: the new view equals the previous definition (generated from git) row for row, non-vacuously (23 = 23). Suite: 39 checks pass, 44 of its breaks killed.
- Guarded apply: refuses unless the live view md5 is `86ab0fcf…`; no-op when already applied.

## Not claimed
Run-time of the geography job after the apply is measured at the first :35 run after it and reported, not assumed (expected: ~199 s → ~35 s).
