# Phase 5 — source-key-scoped reconciliation

Branch `claude/amazing-planck-k897il`. Nothing in this phase is scheduled, applied
to a plane, or armed. No backfill ran, no registry was activated, no orphan cleanup
ran, and `baltimore-city-housing-permits` is untouched.

**Production invariants, re-read after every step of this work and unchanged
throughout** (2026-09-19): `zip_authoritative_membership` **901,465** ·
`zip_authoritative_marker` **1,004,080** · `n5_geom` **1,209,747** ·
`n5_boundary_membership` **907,297** · `preservation.app_project_identity`
**3,172,292** · `n5_accepted_source` **234** · 19475 **34** membership / **40**
markers · 64165 **29**.

---

## 0. A defect in the previous Phase 5 commit, found before anything else

Commit `47b005e` shipped `scripts/n5_a3_markers.py::BUILD` with a **missing comma
between the `pt` and `expected` CTEs**. The statement could never have parsed.

Every structural assertion in `test/geo-source-scoped-mutation.test.mjs` passed,
because every string it looks for was present. **A pin that reads SQL as text cannot
tell a statement that RUNS from one that merely CONTAINS the right words.** That is
the same shape as this repository's own rule that an instrument must prove it ran.

Two things changed as a result, and the second matters more than the first:

1. the comma is restored;
2. `test/geo-sql-cte-structure.test.mjs` now checks the one structural property that
   broke — inside a `with` chain, each CTE's closing paren must be followed by `,` or
   by the statement keyword. It strips string literals, dollar-quoted blocks, quoted
   identifiers and comments first, so `string_agg(x, ',')` and `collate "C"` are not
   read as structure (the over-flagging direction, which is how a gate becomes noise
   and then gets deleted). **27 checks, 0 failures.** Proven load-bearing: reintroduce
   the missing comma and it fails, **naming the CTE** —
   `scripts/n5_a3_markers.py::BUILD CTE chain: CTE pt: closing ")" is followed by
   "expected as ( select z" - expected "," (another CTE) or the statement keyword`.
   §7 of that file is a negative control on the exact 47b005e text.

---

## 1. `feature_id` has no per-feature identity — measured, and it forces the design

Production census, 2026-09-19:

| provenance | rows | distinct keys | distinct `feature_id` |
|---|---:|---:|---:|
| `proven_stored_point` | 718,278 | 718,278 | **1** (the literal `pt:1`) |
| `recovered_authoritative` | 491,469 | 160,182 | 491,465 |

and within the RECOVERY half:

| measure | value |
|---|---:|
| keys whose features share ONE `feature_id` prefix | **160,182 of 160,182** |
| keys with more than one feature | 54,904 |
| …of those, keys whose features are **all one geometry** | **49,615** |
| heaviest key | 191 features |

`scripts/n5_shard.py:437-443` states the rule: the id is
`<the identity we asked for>#<index within THAT key's features, ordered by the
geometry itself>`. The census confirms the consequence — **the prefix is constant
within a key, so it discriminates nothing, and the index is positional and derived by
sorting the whole fetched set.** Drop one feature that sorts first and every remaining
feature's id shifts by one. And for 49,615 keys the geometry cannot break the tie
either, because every feature is the same geometry.

**So `(source_key, feature_id)` is a stable identity for a ROW and not for a FEATURE.**
There is no per-feature `UPDATE` to write because there is no per-feature identity to
write it against.

**The smallest correct identity rule is therefore the KEY.** Stage 1 compares the two
feature *sets* by fingerprint and, only when they differ, replaces that key's whole
set. Unchanged ⇒ **no write**, which is not an optimisation: a no-op write would
advance `recovered_at` and destroy the first-acquisition vintage that column exists to
record. PROVEN is the degenerate case of the same rule — one row per key at `pt:1`.

The fingerprint pins `collate "C"` (rule 9). A false drift alarm is how a real one
gets ignored later.

---

## 2. Stage 1 is TWO statements, and Postgres forces that

The first version was one statement with the DELETE as a data-modifying CTE. It
failed, live, on the first fixture case:

```
ERROR: 23505 duplicate key value violates unique constraint "t_geom_pkey"
DETAIL: Key (source_key, feature_id)=(K, k#0) already exists.
```

Every data-modifying CTE in a statement sees the same snapshot, so the INSERT's unique
check still saw the rows the DELETE had removed. **This is not an edge case: whole-set
replacement reuses feature ids by construction, so it is the normal path.**

The two statements run in one implicit transaction, so atomicity is unchanged. The
`changed` set is recomputed in the second statement rather than carried: after the
delete a changed key's stored fingerprint is `md5('')` and its incoming one is not, so
it still qualifies, while an unchanged key still matches and is still skipped.

Pinned by `test/geo-sql-cte-structure.test.mjs` §1 (the composition must stay two
statements built from one prelude) and proven load-bearing live — see mutation **M3**.

---

## 3. Discovery — the matrix

The steady-state path is source-key-scoped, so "which keys" is now a real question
rather than "whichever ZIP3 ran". The mechanism is `docs/geo-reconcile-discovery.sql`
(**parked, not applied, nothing scheduled**): a queue filled by a **statement-level
trigger on `geo.n5_geom`** (insert, update *and* delete), drained in bounded batches,
with a **keyset-paginated audit sweep** as the safety net. There is **no unbounded
national `n5_geom` scan on any tick** — the sweep reads `_batch` keys per call and
completes a full pass over many calls.

| # | lifecycle state | discovery source | why it cannot be missed |
|---|---|---|---|
| 1 | key not yet acquired | — | it holds no geometry and belongs on no plane; absence is correct, not a miss |
| 2 | acquisition writes a NEW key's features | `zz_n5_geom_enqueue_ins` (statement trigger, same transaction as the insert) | a row cannot exist in `n5_geom` without the trigger having enqueued it; the enqueue is not a call a writer must remember |
| 3 | acquisition rewrites an EXISTING key (stage 1 replacement) | `zz_n5_geom_enqueue_del` + `..._ins` — the replacement is a delete **and** an insert | either half alone would enqueue it; both do |
| 4 | key fully placed, publisher returns byte-identical features | stage 1 writes nothing, so no trigger fires and no queue row appears | correct: nothing changed, so nothing needs reconciling, and re-running would only burn the vintage |
| 5 | geometry changed, same ZCTA | trigger (state 3) | the reconcile re-derives the point and rewrites only if a column actually differs |
| 6 | geometry moved ZCTA (A→B) | trigger (state 3) | stages 2–4 each delete what the key no longer earns and insert what it now does — **proven, case 2** |
| 7 | a key's last usable feature removed (A→none) | `zz_n5_geom_enqueue_del`, or an insert of an `outcome<>1` quarantine row | this is the transition that leaves *stale* resident-facing rows rather than missing ones, so DELETE has its own trigger reading the OLD table rather than being left out — **proven, case 4** |
| 8 | whole source key disappears from the publisher | **not the geometry layer's call** — see §5 | the reconcile refuses to invent a second definition of "deleted"; retention stays with the application's existing stale sweep |
| 9 | registry disposition changes (processable ⇄ held) | `reason='registry_treatment_change'` on the way back in; on the way out the key is simply never named | a held key is byte-identical while unnamed and is fully re-placed when restored — **proven, cases 9a/9b** |
| — | anything the above missed, incl. rows predating the trigger | `geo.n5_audit_sweep(_after, _batch)` | keyset-paginated, `_batch` keys per call, enqueues any key with usable geometry that is on **neither** plane; bounded by construction |

⚠️ **The audit sweep's two `not exists` probes are per-key index lookups, and the
index they need does not exist yet — see §7.** Without it the sweep degrades to a
sequential scan per slice and becomes the thing it exists to avoid.

---

## 4. What was proven, live, against the shipped SQL

The build sandbox has no egress to Supabase, so the behavioural proof ran server-side
against an **isolated `geo_fx` schema** (RLS on every relation, no grant to
anon/authenticated/PUBLIC, synthetic two-ZCTA geometry, **dropped at the end and the
teardown verified**: `information_schema.schemata` → 0, `pg_proc` in that schema → 0).

**The text under test is the repo module's own output, proven rather than asserted.**
The fixture's two functions were compared to `scripts/n5_reconcile_fixture.py`'s
`reconcile_function()` on a whitespace-and-case-normalised form:

| function | repo emitter | deployed | match |
|---|---|---|---|
| `reconcile` (stages 2–4) | `9b8a8e373e8b7a5e90aa6a1dd5547201` | `9b8a8e373e8b7a5e90aa6a1dd5547201` | ✅ |
| `reconcile_stage1` | `56724c09cfc3171f5e317bd9b36014a8` | `56724c09cfc3171f5e317bd9b36014a8` | ✅ |

**30 assertions passed, 0 failed.** Every case drives the full four-stage cascade —
geometry → boundary → membership → markers — not four toy queries.

| case | what it asserts | result |
|---|---|---|
| none → A | all four planes gain the key on AAAAA | PASS |
| idempotent | a re-run with identical input leaves all four planes byte-identical, **and writes nothing** | PASS |
| **A → B (the cascade)** | boundary, membership and markers all move to BBBBB **and nothing is left on AAAAA** (the three-plane sum is 0) | PASS |
| → A+B | boundary, membership and markers all span both | PASS |
| A+B → B | the **contraction** an append-only probe can never perform | PASS |
| A → none | the quarantine row survives; boundary, membership and markers all empty | PASS |
| source disappearance | key named, fetch empty → **geometry NOT deleted**, planes stay as they were | PASS |
| treatment held | an unnamed key is byte-identical across all four planes | PASS |
| treatment restored | the SAME cascade re-places it | PASS |
| **control** | key `U`, seeded once and never named again, is **byte-identical across all four planes** at the end | PASS |

The control is the one that makes the rest mean anything: without it, "the subject
moved" says nothing about blast radius.

**Negative control** — the harness must be able to fail. Asserting `AAAAA` while the
key was on `BBBBB` raised
`FIXTURE FAIL [negative control (expected to raise)]: got BBBBB, want AAAAA`,
and the pass log stayed at 27, proving a failing check logs nothing. A suite that has
never produced a red is indistinguishable from one that cannot.

### Mutations — every assertion proven load-bearing

| mutation | expected if load-bearing | measured |
|---|---|---|
| **M1** stage 2 with its DELETE limb removed (the old append-only shape) | a contraction leaves the stale ZCTA | boundary after contracting to B: **`AAAAA,BBBBB`** (shipped path: `BBBBB`) |
| **M2** stage 3 scoped off the BOUNDARY plane instead of the geometry — the shape Phase 5 inherited | a brand-new key gets no membership | geom 1, boundary 0, **membership 0**; control: shipped path places the same key on `AAAAA` |
| **M3** stage 1 collapsed back into ONE statement | `23505` on whole-set replacement | fired with **SQLSTATE 23505**; control: shipped two-statement stage 1 handles the same input and moves the key to `BBBBB` |

M2 is the discovery blind spot itself, measured: **scoping the membership stage off
the boundary plane silently drops every newly-acquired key.** That is why stages 2, 3
and 4 each derive `expected` from `geo.n5_geom` directly and none of them reads
another plane's scope.

---

## 5. Source disappearance is not the geometry layer's decision

Case 8 is deliberately a no-op on `n5_geom`. The application already owns retention:
`docs/app-projects-stable-key-migration.sql:349` deletes an `app_projects` row whose
`last_seen_at` predates the run **and** which no `property_company_roles`,
`project_facility_refs` or `identity_conflicts` row references.

Inventing a delete inside the geometry layer would create a **second definition of
"deleted"**, with its own conditions, that nobody reconciles against the first. The
reconcile acts only on keys the fetch actually returned; a key that is named but
absent from the incoming set is reported, never enacted.

Measured consequence, and it is the right one: after case 8 the key's geometry row
survives while all three downstream planes stay empty — because case 4 had already
emptied them on the evidence, not on the absence.

---

## 6. Treatment change uses fixtures, never Baltimore

`baltimore-city-housing-permits` was not read, activated, classified or touched. The
treatment transition is modelled exactly as production would express it — **a
non-processable key is simply never named in the bounded key set** — and proven in
both directions on fixture key `K`.

This matters because the alternative was to exercise the mechanism against the one
registry the founder put on hold, which would have used a hold as a test rig.

---

## 7. INDEX REQUIRED — CREATION DEFERRED UNTIL INGEST HEALTHY

**Not "probably".** Measured by `EXPLAIN` (planning only — nothing executed, nothing
written) on the real bounded `source_key in (…)` delete predicate that stages 2, 3 and
4 each carry, against production relations:

| relation | rows | plan | cost |
|---|---:|---|---:|
| `geo.n5_geom` — **has `n5_geom_sk_ix (source_key)`** | 1,209,747 | **Index Scan using `n5_geom_sk_ix`** | **15.83** |
| `geo.n5_boundary_membership` | 907,297 | **Seq Scan** | 26,523.81 |
| `geo.zip_authoritative_membership` | 901,465 | **Seq Scan** | 29,384.14 |
| `geo.zip_authoritative_marker` | 1,004,080 | **Seq Scan** | 33,587.73 |

The first row is the **positive control**: the identical predicate shape on the one
relation that already carries a `(source_key)` btree plans as an index scan at
**~1,860× lower cost**. Without that control the three sequential scans would say
nothing about the missing index — they could have been the planner's correct choice.

So a three-key reconcile currently plans a **full sequential scan of ~2.8 million rows
across the three destination planes**, on every batch. This is not an index added
because it might help; it is the difference between a bounded operation and a
national one.

**The exact proven definitions:**

```sql
create index concurrently if not exists n5_boundary_membership_sk_ix
  on geo.n5_boundary_membership using btree (source_key);
create index concurrently if not exists zip_authoritative_membership_sk_ix
  on geo.zip_authoritative_membership using btree (source_key);
create index concurrently if not exists zip_authoritative_marker_sk_ix
  on geo.zip_authoritative_marker using btree (source_key);
```

**Deferred, and the reason is stated rather than implied:** three index builds over
~2.8M rows is material write and I/O load, and `dev-reports-rolling-refresh` is
degraded. `concurrently` lowers the locking cost, not the I/O. It is also useless
until a caller drains the queue, and no caller is wired.

⚠️ This is the opposite case to Phase 2, where the index was **rejected** because live
evidence showed it unnecessary. Here live evidence shows it necessary. The rule that
produced both verdicts is the same one: measure, then decide.

---

## 8. Performance measurement remains deferred

No load test was run. The only production reads this phase performed were catalog
reads, five `EXPLAIN`s without `ANALYZE`, and the row counts at the top of this file.
The fixture ran on a handful of synthetic rows in a schema that no longer exists.

---

## 9. Classification deployment — provisionally accepted, NOT applied

`docs/geo-classification-deploy.sql` (233 rows + 7 holds, generated by
`scripts/gen-geo-classification-deploy.mjs`) is unchanged and unapplied. The six
zero-record blocked registries are unchanged. Baltimore's hold stands.

---

## 10. Files

| file | what it is |
|---|---|
| `scripts/n5_reconcile_sql.py` | the four stages, relation names parameterised, ONE implementation |
| `scripts/n5_reconcile_fixture.py` | emits the fixture payload from that module — the proof cannot drift from the code |
| `docs/geo-reconcile-discovery.sql` | the parked discovery queue, triggers and bounded sweep |
| `test/geo-sql-cte-structure.test.mjs` | the offline instrument that catches the 47b005e defect class |
| `scripts/n5_a3_markers.py` | the missing comma, restored |
| `scripts/n5_unit_a_shadow.py` | `select_prefixes()` docstring corrected — it described a ZIP3 delete Phase 5 had already removed |
