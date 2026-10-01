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

## ⚠️ UNEXPLAINED, recorded and not hand-waved: the resolved set grew by 22 between my 17:06 baseline and the 23:35 run

Before (17:06, after nothing of mine): 1,836 resolved live canonical geography rows, fingerprint `a1dfcdd7…`. After (23:38): **1,858 = 1,836 PUBLISHER_POINT + 22 DERIVED_ADDRESS_POINT**.
- All 1,858 rows were rewritten by the **17:35 run** (the first run after the Epoch consolidation at 17:12), **not** by the 22:46 view change (whose rows are proven identical).
- **0** acquisitions or geocodes since 17:06; 0 new entities. The 22 are existing `compute_atlas` entities whose derived points were ACCEPTED on 2026-09-25.
- None of the 22 has a candidate pair with a timeline observation (0 of 22), and only 1 has any candidate at all, so the obvious mechanism (an identity question closed by the Epoch consolidation) is **not** supported by the data.
- The publisher-only fingerprint is `cff81f7f…` (1,836 rows) and the before-fingerprint covered 1,836 rows of a different composition, so I cannot say whether the 22 are new *derived* points or 22 publisher points swapped for them. **Not proven either way.**
- Map 1 impact is unmeasured: the daily snapshot (11:50) read 1,825 markers / 980 canonical on 10-01 before any of this; tomorrow's snapshot is the first reading after. Its coverage check will page on a >5% move.
