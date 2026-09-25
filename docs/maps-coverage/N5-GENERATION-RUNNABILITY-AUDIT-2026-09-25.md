# N5 generation path — runnability audit against the LIVE catalog (2026-09-25)

**Status: the national generation cannot yet run. Map 1 is unchanged and still serves
`legacy-phase1-2026-09-01`.** `docs/n5-generation-publish.sql` Parts A–C are applied and proven
output-identical (see CLAUDE.md §7.13). What is not runnable is the *lifecycle* that builds a
new generation on top of them.

## How this was found

1. The first production `open` (`n5-generation.yml` run `36172375498`, generation
   `n5-national-2026-09-25`) was refused:
   `null value in column "identity_hash" of relation "app_project_identity" violates not-null
   constraint`. The capture was one statement, so **nothing was written** (verified: no
   generation row, 0 captured rows).
2. Rather than discover the next failure one multi-hour run at a time, a read-only workflow audit
   (5 stage auditors + 1 adversarial verifier per finding, 29 agents) compared every statement
   in the path against the live catalog: `information_schema`, `pg_get_constraintdef`,
   `pg_get_functiondef`, triggers, and `EXPLAIN` / small timed `SELECT`s. There were no writes.
   Every finding below survived its verifier.

## The defects

The fix class is **R** (repo code only) or **DDL** (needs a new production DDL-of-record part).

| # | defect | where | fix class |
|---|---|---|---|
| 1 | The capture omits `identity_hash` / `content_hash`, which are NOT NULL in production. **Fixed on this branch** with the canonical expressions from `docs/preservation-baseline-phase1.sql`, pinned byte-for-byte by `test/n5-generation-publish.test.mjs`. | `n5_orchestrate.py` `mode_open` | R |
| 2 | The `geo.n5_snapshot` insert omits `sources`, `projects`, `pairs` and `checksum`, which are NOT NULL with no default, and it runs **after** the capture has committed. | `mode_open` "snapshot row" | R |
| 3 | `open` is four separate autocommit requests (capture, snapshot, generation, manifest). A failure between them wedges the generation id: the precheck refuses "snapshot already has rows", and a BUILDING generation with 0 shards turns every `work` tick red. | `mode_open`; `n3_pilot.sql()` sends one POST per call | R |
| 4 | Server `statement_timeout` is **120 s** (`platform-defaults.conf`). The capture is two full seq scans of `app_projects` (3,038 MB heap) plus a ~3.0M-row write through a per-row `guard_frozen` trigger, and it sets no timeout. The refused run spent **113.9 s before its first row**. | `mode_open` capture | R (plus confirming the API gateway holds a request that long) |
| 5 | `n5_shard.py` is never told the new snapshot. `SNAPSHOT` defaults to `phase1-2026-09-01`, the orchestrator passes only `GENERATION`/`Z3`, so every shard stops "Conflicting identity". | `n5_orchestrate.py` `mode_work` env; `n5_shard.py:37`, `:872-874` | R |
| 6 | `geo.n5_association` is not generation-scoped. Its PK is `(source_key, zip)`, it holds the legacy build (2,818,231 rows, all 544 prefixes), and `associate()` inserts ON CONFLICT DO NOTHING while `got`/`phantom`/`total_ok` count every row in the prefix. Any prefix whose data drifted since 1 Sep halts (e.g. 800: 612 legacy keys with no live row). | `n5_shard.py:572-577`, `:712-751` | **DDL** + R |
| 7 | The recovery cache probe is sent `read_only=True` with raw source_key literals. The live key `arcgis:centre-county-pa-building-permits:Call In R Fi` trips the write-word guard ("call"), so shard 168 crashes. | `n5_shard.py:299-302` | R |
| 8 | Nothing materialises `proven_stored_point` geometry for a new snapshot. All 718,278 such rows are phase1's. PROVEN projects filed after 1 Sep have no `n5_geom` row and end UNACCOUNTED (e.g. 881 in prefixes 800-809 alone). Publish also reads the phase1 `pt:1` point, so 14 moved points would publish at their old location (max 910 m). | `n5_shard.py` (no writer); `geo.n5_gen_candidate_geom` | R (constraints already allow it) |
| 9 | The orchestrator publishes only **shard** prefixes, but `geo.n5_generation_publish_scope` includes the 40 canonical-only prefixes. `n5_gen_record_unresolved` therefore raises "unpublished" on every tick. | `n5_orchestrate.py` `unpublished_prefixes`, `publish_pending` | R |
| 10 | `n5_gen_record_unresolved` has no evidence class for EXCLUDED sources, registries with no `n5_accepted_source` row (`baltimore-city-housing-permits`, 270 keys), completed-but-empty recoveries, or `registry_id` NULL keys. Replayed on legacy data: 4,003+ keys get no reason code, so INV-1 refuses READY forever. The verdicts exist in the shard stage but are not persisted. | `docs/n5-generation-publish.sql:541-565`; `n5_shard.py:274-277` | **DDL** + R |
| 11 | `mark_ready` and `activate` are each one statement doing far more than 120 s of work. The chunk-coverage predicate measured 24.7 s per 100k rows (~12 min over the snapshot). Per-chunk reconcile is two full seq scans of membership (chunk 850: 56.7 s), times 544 chunks. The orchestrator sends no timeout. | `n5_generation_publish_problems`, `n5_reconcile_chunk`, `mark_ready`, `activate`; `mode_ready` / `mode_activate` | **DDL** (function rewrite; verifier measured the grouped predicate at 11.5 s) + R |

**Test fidelity (the reason the suite was green).** `test/n5_generation_pg/fixture_prestate.sql`
declares `identity_hash` nullable. It has no `geo.n5_snapshot` table and no generation-less
`n5_association` pressure. The suite never invokes `n5_orchestrate.py`, and its seed fabricates
snapshot point evidence (`proven_stored_point` / `n5_point_reject` rows for the candidate
snapshot) that nothing in production writes. **The suite proved the serving design. It did not
prove the build.** The fix is a fixture generated from, or checked against, the live catalog,
plus an orchestrator-level test.

## What is safe right now

- **Production is consistent.** Parts A–C are in, serving is unchanged, and no BUILDING
  generation exists. The failed `open` wrote nothing.
- **Disk:** 24 GB provisioned, database ~11.5 GB. The attempt used no space.
- ⛔ **Do not dispatch `open` again until #2–#5 are fixed.** Once #1 is fixed, a run commits
  ~1.4 GB of capture and then fails at #2, leaving an orphan that blocks the name.
