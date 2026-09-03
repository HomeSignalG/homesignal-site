# N5 PRODUCTION APPLICATION PLAN — design only, NOT AUTHORIZED TO RUN

Written 2026-09-03 against branch `claude/n5-canonical-provenance`. Migration of record:
`docs/n5-canonical-geometry-provenance.sql`. Pre-state receipts:
`docs/n5-applied-state-of-record.md`. Ownership: `docs/n5-object-ownership.md`.

**Nothing in this file has been executed. No production write has been made.**

---

## 0. APPLY-TIME PRECONDITIONS — both halves

### (i) Writer quiescence — the parallel session must be idle

Two sessions write `geo.n5_*` (Rule #0a), and Option-A attribution rests on **set/coordinate
identity** rather than on a stamp the legacy writer left on `n5_geom`. A moving corpus therefore
invalidates the proof silently.

**How it is confirmed, immediately before each half:**

```sql
select now(),
       (select max(recovered_at) from geo.n5_geom)        as geom_last_write,
       (select max(rejected_at)  from geo.n5_point_reject) as reject_last_write,
       (select count(*) from geo.n5_shard where state='running') as shards_running,
       (select count(*) from pg_stat_activity
         where state <> 'idle' and query ilike '%n5_%' and pid <> pg_backend_pid()) as active_n5;
```

**Required:** `shards_running = 0`, `active_n5 = 0`, and both last-write timestamps older than
the start of the apply window. *Measured 2026-09-03 15:15:21Z: last `n5_geom` write
00:32:12Z (14h 43m quiet), last reject write 2026-09-02 23:50:51Z, 0 shards running, 0 active
`n5_*` queries.* This must be **re-run at apply time**, not carried from that reading.

### (ii) The proofs re-run INSIDE the apply transaction

This is already true by construction and is the reason the gates live in the migration rather
than in a runbook: `§3` (fail-closed legacy geometry gate), the archive-complete gate and the
rebuild gate are all `DO` blocks **in the same transaction as the writes they authorise**. A
design-time proof is a statement about the past; these are evaluated against apply-time truth
and `RAISE` before any attribution or destruction if the state has moved.

---

## 1. GEOMETRY HALF — apply first (lower risk)

One transaction. Attribution only: **no canonical geometry row is deleted or rebuilt.**

```
SNAPSHOT=phase1-2026-09-01   # informational; the migration reads it from the data
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f docs/n5-canonical-geometry-provenance.sql
```

Sections that act: §1 classification · §2 add `verdict_snapshot_id` · **§3 gate** · §4 backfill +
biconditional + `pt:` namespace constraint · §6 create the three publication tables · §7
association comment.

| property | expectation |
|---|---|
| rows touched | **718,278** updated (`provenance='proven_stored_point'`); 23,284 recovered rows untouched |
| WAL | UPDATE rewrites every touched tuple. Heap is **140 MB** / 322 MB total for 741,562 rows ⇒ ~198 B/row heap ⇒ **~140–190 MB** of WAL for the update, plus index maintenance. Budget **~250 MB**; DB is 6,888 MB. |
| scans | the §3 gate does one pass over `preservation.app_project_identity` (**1,125 MB**) and one over `n5_geom`. Expect **tens of seconds**, dominated by the identity scan. |
| locks | `ADD COLUMN` (nullable, no default) is catalog-only. `ADD CONSTRAINT ... CHECK` takes **ACCESS EXCLUSIVE** on `geo.n5_geom` and validates by full scan — reads are blocked for that window (~seconds at 741k rows). |
| availability | the canonical radius corpus is briefly unreadable during the two `ADD CONSTRAINT` statements. Nothing in the product reads `n5_geom` yet (the bounded spatial read RPC of #1015 is unmerged), so **user-visible impact is currently nil**. |
| rollback before COMMIT | automatic and complete — proven executably (assertion 2, and the 11 negative controls each roll the whole migration back). |
| reversal after COMMIT | none automatic. Reversing would need a separate designed migration: drop the two constraints, `set verdict_snapshot_id = null where provenance='proven_stored_point'`. Cheap, because nothing was destroyed. **Not written now.** |

**Lower-lock variant, if the ACCESS EXCLUSIVE window is judged unacceptable:** add both CHECKs
`NOT VALID`, then `VALIDATE CONSTRAINT` (takes SHARE UPDATE EXCLUSIVE, allows reads and writes).
That splits the work across two transactions and so **weakens the single-transaction guarantee** —
do not adopt it without a decision, and never adopt it silently.

**Verify after COMMIT (read-only):**

```sql
select count(*) filter (where provenance='proven_stored_point' and verdict_snapshot_id is null) must_be_0,
       count(*) filter (where provenance='recovered_authoritative' and verdict_snapshot_id is not null) also_0,
       count(*) filter (where provenance='proven_stored_point') should_be_718278
  from geo.n5_geom;
```

---

## 2. REJECT HALF — apply second

Same file, same command: the reject transition is `§5` of the same migration and is **conditional
on the pre-state**, so once the geometry half has committed, re-running the file performs the
reject work and no-ops everything already done. (If both halves are wanted in one shot, the single
invocation above already does both — splitting is a risk-staging choice, not a requirement.)

| property | expectation |
|---|---|
| rows copied to archive | **5,171** (table is 1,624 kB — trivial) |
| rows deleted then rebuilt | 5,171 → 5,171 (expected identical set; the rebuild gate asserts it) |
| WAL | a few MB for the archive + delete + rebuild. The cost is CPU, not WAL: the rebuild scans `preservation.app_project_identity` again. |
| locks | `ACCESS EXCLUSIVE` on `geo.n5_point_reject` for the column adds and the PK swap. Small table, brief. |
| availability | `geo.n5_point_reject` is an evidence surface, not a product read path; no user-visible impact. The archive means the historical rows are never unavailable. |
| destructive step gating | `delete from geo.n5_point_reject` is **unreachable** unless the archive-complete gate passes — rowcount equality plus per-row `detail` and `rejected_at` preservation. Proven executably by assertion 95, which poisons one archived `detail` and confirms the migration refuses and the live table and its old PK survive intact. |
| rollback before COMMIT | automatic and complete. |
| reversal after COMMIT | restore from `geo.n5_point_reject_archive` (which is exactly why it exists), then re-widen the PK. **Not written now.** |

---

## 3. ORDER, AND WHAT IS EXPLICITLY NOT IN THIS PLAN

1. Confirm writer quiescence → 2. apply the **geometry half**, verify, report → 3. apply the
**reject half**, verify, report.

**Not in scope and not authorized here:** populating `geo.n5_proven_verdict` · running the
canonical sweep · running any shard · shard 760 · reclamation · `geo.b4_candidate_zcta_measurement`
· #1015 · merging #1016. The migration deliberately does none of them.

---

## 4. TRANSPORT PREREQUISITE

**HTTP management API transaction semantics: UNPROVEN.** Both `scripts/n3_pilot.py::sql()` and
`.github/workflows/db-sql.yml` POST the whole script in one request, but
`api.supabase.com/v1/projects/{ref}/database/query` is published only as *"[Beta] Run sql query"*
and states no transaction semantics. Not tested against production.

**PG wire protocol preferred**, and it is the only mechanism that satisfies this plan: the gates
and the writes they authorise must be in **one transaction**, so a transport that cannot carry
`BEGIN … COMMIT` as one unit is not acceptable regardless of convenience.

**The single prerequisite:** a `SUPABASE_DB_URL` (direct connection string, or the pooler in
*session* mode — transaction-mode pooling is not acceptable) available to whoever applies, as a
GitHub Actions secret or an operator-local value. **No such credential exists in this repository
today** — `grep` for `postgres://`, `postgresql://`, `DATABASE_URL`, `PGPASSWORD` across all
`.yml`/`.py`/`.mjs`/`.sh` returns nothing outside the disposable test harness. Obtaining it is a
founder action, not an agent action.

---

## 5. GREEN RECEIPTS BACKING THIS PLAN

- Executable PostgreSQL + PostGIS: **96 / 96**, local (PG 16.13 / PostGIS 3.4.2) and in CI
  (`postgis/postgis:16-3.4`, PG 16.4), against a **production-faithful** fixture.
- Of those, **12** assert the corrected migration succeeds against the real legacy pre-state and
  **11** are negative controls proving it fails and rolls back when any invariant is corrupted.
- Static source assertions: **178 / 178**. Offline unit suite: **141 / 141 files**.
- Residual fidelity limit: the fixture reproduces production's **shape and invariants** at 5-project
  scale, not its 723,449-project volume. Scale is the only modelled difference.
