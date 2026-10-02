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

## Applied (2026-10-01 22:46 UTC — outside :18–:45, not at :10) and read back

- Migration `identity_open_record_keys_once` (ledger `20261001224631`). Stored text md5 `b9dde85f0f5e35805bdcc754bc1d9fd1` = the committed file with its trailing newline stripped. The live view's `pg_get_viewdef` md5 `3e0c7823…` = the md5 a fresh build of `docs/dc-step3a-canonical-identity.sql` produces. `security_invoker` kept, ACL `{postgres, service_role}`, comment kept.
- **Parity on production after the apply (22:49):** 272 rows, md5 `35cadd92…` = the old view's — in **18.1 s**.
- **Geography job, the first :35 run after the apply (23:35): 26.9 s, succeeded** (22:35: 210.6 s; 21:35: 216.2 s; 20:35: 193.9 s; 19:35: 196.7 s). Run-time ceiling headroom: 300 s → ~11x.
- `dc_resolvers` still reads the *slow* class for up to 24 h: its window looks at the slowest successful run in the last 24 h, so it clears once the 200 s+ runs age out (tomorrow ~19:35). That is the check working, not a regression.

## The +22 is EXPLAINED (2026-10-02) — it is today's Atlas acquisition, not this change and not the Epoch cleanup

*(The section that stood here on 2026-10-01 called it unexplained. It was reconciled the next morning; the earlier text is superseded, not deleted from git history.)*

Resolved live canonical geography went 1,836 (17:06 baseline, fingerprint `a1dfcdd7…`) to 1,858 (23:38). Each piece, with its control:

- **Atlas acquisition `run_seq 2570` landed 2026-10-01 16:41:50** with **2,290** records against 2,268 the day before (`run_seq 2567`): **22 added, 0 removed, 2 coordinates changed** (joined on `publisher_record_id`).
- **22 canonical entities were created at 16:42:00** — the same 22. Their geography rows were created at **17:35:00**: the 16:35 geography run preceded the acquisition, so 17:35 was the first run to see them. All 22 are `PUBLISHER_POINT` / `RESOLVED`.
- **Control:** no live entity created before 16:00 has a geography row created after 17:00 (empty result), so nothing else was newly placed. Excluding the 22 new entities the resolved count is **1,836 — equal to the baseline count**.
- **The fingerprint difference** over those 1,836 (`229bf82e…` vs `a1dfcdd7…`) is the **2 coordinate changes** the publisher made in that same run.
- The earlier "22 DERIVED_ADDRESS_POINT" are a different 22: old rows, created 09-22..09-25, unchanged. The matching number was a coincidence.

**My baseline was taken at 17:06 and so could not include rows the 17:35 run was always going to add; and my "0 acquisitions since 17:06" used a column (`observed_at`) that I did not control-check against the run table.** Today's Epoch run (17:00:15) and Atlas run (16:41:50) were both before the baseline. Neither the Epoch cleanup nor the view change moved a single existing marker.
