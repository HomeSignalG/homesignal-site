# Closing the defect: a new or moved project now reaches authoritative ZIP geography

**The defect:** the geography pipeline was built from a frozen historical snapshot,
so a new or relocated project could exist in HomeSignal and never appear on its ZIP map.

**PASS.** Code + fixtures only. Nothing was applied to production.

---

## 1. Does a current steady-state PROVEN geometry writer exist? **NO.**

Three independent pieces of evidence, each measured:

- The **only** production inserts into `geo.n5_geom` are `scripts/n5_shard.py:494` and
  `:500`, and **both hard-code `provenance='recovered_authoritative'`**. Every
  occurrence of `proven_stored_point` in shipped code is a test fixture or a read-path
  assertion.
- All **718,278** `proven_stored_point` rows share **one `recovered_at`** —
  `2026-09-03 20:48:18.372585+00`, a single distinct minute — carry
  `verdict_snapshot_id = 'phase1-2026-09-01'` (the **frozen** snapshot), and have
  `first_z3` NULL on every row. One set-based statement. For contrast the RECOVERY half
  spans **417 distinct minutes** across 2026-09-02…09-05 over **425** distinct
  `first_z3` values — what an incrementally-running process looks like.
- It is **not in the migration ledger** either: the nearest recorded migration is
  `20260903204603`, two minutes earlier.

So PROVEN geometry was produced **once, off the frozen snapshot, by a statement that is
in neither the repo nor the ledger.** A PROVEN project arriving tomorrow had nothing to
materialise it. That is the defect, at its root.

## 2. The minimal permanent PROVEN adapter

`docs/geo-proven-expected-geometry.sql` → `geo.proven_expected_geometry(_keys text[])`.
Source-key scoped · deterministic · idempotent · `STABLE` (a pure read) · reads **live
`public.app_projects` only, never `preservation.*`** · no ZIP3 · performs **no**
downstream mutation — it *returns* expected geometry in exactly the shape
`geo.n5_geom_incoming` takes, and the Phase 5 reconciler converges.

**The stored-coordinate contract is AGREEMENT, not selection** — measured, not assumed,
over `frisco-active-building-permits` (550 keys / 956 live rows):

| | |
|---|---:|
| keys with exactly one live row | 326 |
| keys with **more than one** live row | **224** (up to 5) |
| keys whose rows **agree** on one coordinate | **548** |
| keys whose rows **disagree** | **2** |
| no coordinate / null island / invalid | 0 / 0 / 0 |

Multi-row keys are normal — `app_projects` is keyed `(zip, source_key, source_seq)`, so
one project spanning two ZIPs is two rows. **`min(id)` would silently pick one of two
contradictory coordinates and publish it as authoritative.** Disagreement is therefore
rejected as `MULTI_COORD_UNRESOLVED`, never resolved.

That reason, and four others, were **already designed**: `geo.n5_point_reject` has
carried a CLOSED CHECK domain since `20260902234917` — `NO_REGISTRY_VERDICT`,
`NULL_COORD`, `NULL_ISLAND`, `OUTSIDE_JURISDICTION`, `INVALID_COORD`,
`MULTI_COORD_UNRESOLVED`. The contract existed; only the writer was missing. The adapter
implements it and invents no new reason. `OUTSIDE_JURISDICTION` is **not** implemented
(it needs the registry coverage envelope) and that is stated in the file — its absence
can only fail to reject a point, never fabricate one.

## 3–5. The three handoff points — all inside one function, all already holding the key

Traced in the live body of `public.app_refresh_zip`:

| event | site | what it already knows |
|---|---|---|
| **NEW + UPDATE** | line 36 (`development`) and line 105 (`facility`): `insert into public.app_projects (… source_key …) on conflict (zip, source_key, source_seq) do update` | the upserted rows |
| **COORDINATE CHANGE** | line 195: `update public.app_projects set lat=null, lng=null` — the geocode fence | the fenced rows |
| **REMOVAL** | line 153: the stale sweep `delete … where last_seen_at < _run and not exists(…)` | the deleted rows |

Each gains a `returning source_key` feeding `geo.enqueue_work(...)`. **No trigger on
`public.app_projects`** — that table carries **48,366,569** recorded tuple writes
(48,278,764 updates) against 3,213,331 live rows, and a transition-table trigger would
sit on the materializer's hottest statement to learn what the statement is already
holding. Cost added: ~960 small inserts/hour against ~48M tuple writes.

🔑 **The geocode fence is the one that would have been missed.** It nulls `lat/lng` with
no insert and no delete — invisible to a NEW/DELETE-only handoff, and invisible to a
`not exists (n5_geom)` sweep because the key still *has* geometry. It is the Phase 6B
blind spot, and it turns out to be a statement that already knows its own rows.

**A `source_key` can span ZIPs while `app_refresh_zip` is per-ZIP. That is not a partial
handoff:** the reconciler is source-key scoped and rebuilds the whole key from all its
evidence, so enqueuing from any one ZIP suffices and a sibling ZIP's enqueue is an
idempotent no-op.

## 6. NEW RECOVERY reaches existing acquisition unchanged

`scripts/n5_shard.py:334 fetch_features(rid, entry, keys, z3)` **already takes a bounded
key list**, and `n5_acquire_registry.py` already calls it with `z3=None`. So a new
RECOVERY key enters the existing publisher-authoritative path with no redesign, and its
output feeds the same reconciler. Stored coordinates are never substituted for publisher
geometry.

**Acquisition failure ≠ empty expected set** — proven as test T3b.

## 7. The minimal steady-state flow

```
NEW / CHANGED / REMOVED LIVE PROJECT   (app_refresh_zip, which already knows the key)
      └─ returning source_key → geo.enqueue_work
                 ↓
           registry treatment
                 ↓
   PROVEN ─→ geo.proven_expected_geometry   (live stored coordinates, agreement rule)
   RECOVERY ─→ fetch_features               (publisher authoritative)
                 ↓  ExpectedGeometrySet(source_key)
      Phase 5 source-key reconciliation
                 ↓
   n5_geom → boundary → authoritative membership → markers → correct ZIP map
```

Removal takes the same path: stale sweep → key → expected geometry **`SOURCE_REMOVED`,
outcome 3** → reconciliation retires the geography. No live `app_projects` row is *local*
evidence of removal — unlike a failed remote fetch — so it may legitimately empty the set.

## 8. The five tests — **30 assertions, 0 failures**

Isolated `geo_fx7` schema (RLS, no grants, dropped afterwards, teardown verified). The
reconciler under test was fingerprinted against `scripts/n5_reconcile_sql.py`'s own
render and matched: `reconcile` `acbcb54aa197d7779d9f7c8a828c056c`, `reconcile_stage1`
`943f64a22b8b086453612542f53b7d2d`. `scripts/geo_steady_state_fixture.py` re-emits both.

| test | result |
|---|---|
| **T1 NEW PROVEN** | key → work → expected geometry (`outcome 1`, `pt:1`, `proven_stored_point`) → geometry → boundary `AAAAA` → membership `AAAAA` → marker `AAAAA/POINT_AUTHORITATIVE`; queue drained | **PASS** |
| **T2 PROVEN MOVE A→B** | boundary, membership and marker all on `BBBBB`; **`0` rows left on `AAAAA`** across all three planes | **PASS** |
| **T3 NEW RECOVERY** | enters the existing acquisition interface, stores `recovered_authoritative`, reaches boundary/membership/marker | **PASS** |
| **T3b acquisition failure** | geography **byte-identical** — failure is not emptiness | **PASS** |
| **T4 SOURCE REMOVAL** | `SOURCE_REMOVED` / outcome 3; boundary, membership, markers all `0` | **PASS** |
| **T5 IDEMPOTENCE** | second pass byte-identical across all four planes | **PASS** |

Plus three adapter guards against fabricating a point: conflicting coordinates →
`MULTI_COORD_UNRESOLVED` with **null geometry**; a governance-held registry →
`NO_REGISTRY_VERDICT`.

**Negative control** fired: `FIXTURE FAIL [negcontrol]: got AAAAA, want BBBBB`, logging
nothing.

## 9. Unrelated key untouched

Control key `U` was placed once and never named again. Fingerprinted across **all four
planes** (geometry, boundary, membership, markers) and asserted **byte-identical after
T2 and again after T4**. `R1` was likewise byte-identical after `P1`'s removal.

## 10. Nothing was applied to production

`membership 901,465` · `markers 1,004,080` · `n5_geom 1,209,747` · `boundary 907,297` ·
`preservation 3,172,292` · `catalogue 234` · `19475 = 34` · **KCMO `64165 = 29`,
unprocessed** · **Baltimore 0 treatment rows (held)** · work objects **0** · new
functions **0** · new indexes **0** · geography cron **0** · **triggers on
`app_projects` 0** · fixture schemas **0**.

## 11. Remaining blockers to activation

1. **Ingest health gate** — still failing; the three `source_key` indexes cannot be created.
2. **Apply** the adapter, `enqueue_work`, the queue, and the four `app_refresh_zip`
   splices (against live `pg_get_functiondef`, never a dated replay).
3. **Enable the scheduler** to drain the queue.
4. Out of scope and deliberately unsolved: historical backfill, national orphan cleanup
   (the `SOURCE_REMOVED` tombstones accumulate harmlessly — every downstream stage
   requires `outcome=1`), `OUTSIDE_JURISDICTION`, and **periodic RECOVERY reacquisition**
   — a remote publisher can change geometry with no local event of any kind, so no local
   change-detection can see it. That is a later requirement and does not block new or
   moved projects propagating.

## Offline pins

`test/geo-proven-expected-geometry.test.mjs` — **41 checks**, proven load-bearing:
neutering the agreement rule turns **four** pins red by name.

⚠️ **One pin was vacuous and only the negative control caught it.** `checkCteChain`
strips dollar-quoted blocks, and a `CREATE FUNCTION … $fn$ … $fn$` body *is* one — so
the CTE pin was scanning an empty string and passing. It now slices the inner body. Three
further pins were matching the file's own explanatory comments rather than its code.
Both are the same recurring family: **a pin must be scoped to the thing it is about.**
