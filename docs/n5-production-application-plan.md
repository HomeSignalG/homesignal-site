# N5 production application plan — DESIGN ONLY

**SAFE TO APPLY PRODUCTION: NO until explicit founder authorization.**
This file is the apply plan. It is not authorization and it is not an execution log.

Target file: `docs/n5-canonical-geometry-provenance.sql` (Option D).
Pre-state model: `test/n5_pg/fixture_pre_state.sql`.
Ownership / applied-state: `docs/n5-applied-state-of-record.md`.

Settled corpus (cite `4027754`, do not re-measure): 718,278 canonical points, 5,171 rejects, 723,449 partition, snapshot `phase1-2026-09-01`.

## Apply-time preconditions (both halves)

Both halves run under a **single PostgreSQL transaction** each. A transport that cannot put the gate and the write in one transaction is unacceptable.

### (i) Parallel writer quiescent

Confirm **no in-flight writes** to `geo.n5_geom`, `geo.n5_point_reject`, `geo.n5_association` before BEGIN, and hold that for the transaction.

How confirmed (read-only, in this order):

1. **Session inventory.** `pg_stat_activity` where `state <> 'idle'` and `query` references those three relations (including idle-in-transaction). Must be empty of writers other than this session.
2. **Lock inventory.** `pg_locks` joined to `pg_class` for those relations: no `AccessExclusiveLock` / `ShareRowExclusiveLock` / `RowExclusiveLock` held by another backend.
3. **Agent inventory.** No other cloud/agent session authorized to run N5 SQL. This session confirmed a single running agent and that `claude/homesignal-zip-forensics-13xkmw` had moved only `QUEUE.md` / `docs/maps-go-live-governance.md` (no SQL).
4. **Re-check immediately before BEGIN.** Steps 1–2 again. If any writer appears, abort — do not design around a moving target.

### (ii) In-transaction re-proof

The §6 fail-closed geometry invariants and the §3 archive-complete gate **re-run inside the apply transaction immediately before any write**. They are not design-time arguments. Attribution rests on set/coordinate identity, not a stamp (the ad-hoc run left none), and a parallel writer mutates the same tables.

If either gate raises: ROLLBACK. No silent repair.

## Geometry half (apply first)

Low-risk: the 718,278 rows are already the correct canonical points. This half adds a nullable column, re-proves identity, stamps `verdict_snapshot_id='phase1-2026-09-01'` on `provenance='proven_stored_point'` only, leaves recovered NULL, then adds the two CHECKs.

| Item | Plan |
|---|---|
| Rows touched | 718,278 UPDATEs (proven_stored_point, vsid IS NULL). 8,626 recovered rows unread-for-write. |
| DDL | `ADD COLUMN verdict_snapshot_id text`; two CHECK constraints after backfill. |
| WAL | One heap update per stamped row (HOT possible if there is room; do not assume). Plus catalog WAL for column/constraints. Expect hundreds of MB, not GB. |
| Locks | `ShareUpdateExclusive` / `AccessExclusive` on `geo.n5_geom` for ADD COLUMN and ADD CONSTRAINT. Short exclusive windows around DDL; the UPDATE takes `RowExclusive`. Reads of `n5_geom` block during AccessExclusive DDL only. |
| Availability | Map 1 radius reads that scan `n5_geom` stall during the exclusive DDL instants. The UPDATE itself does not rewrite recovered geometry. Do not run a sweep or shard concurrently. |
| Pre-COMMIT rollback | Any gate failure, or `Ctrl-C` / `ROLLBACK`, leaves production unchanged: no column, no stamps, no CHECKs. |
| Post-COMMIT reversal | `ALTER TABLE geo.n5_geom DROP CONSTRAINT n5_geom_verdict_snapshot_ck, DROP CONSTRAINT n5_geom_pt_namespace_ck, DROP COLUMN verdict_snapshot_id;` — drops the stamp with the column. Does **not** delete geometry. Founder-authorized only. |
| In-transaction re-proof | §6 runs after ADD COLUMN (nullable, unconstrained) and before UPDATE. Asserts both-direction set equality, coordinates, POINT/4269, `pt:1`, no recovered squat, reject partition closes 723,449, reject `detail->>'snapshot'` uniformly `phase1-2026-09-01`. |

Do not populate `geo.n5_proven_verdict`. Do not run `publish-verdict`, `sync-canonical`, any shard, or 760.

## Reject half (apply second, only after geometry half is verified)

Destructive if the archive gate is skipped. The gate makes skip unreachable.

| Item | Plan |
|---|---|
| Rows copied | 5,171 into `geo.n5_point_reject_archive` (`ON CONFLICT DO NOTHING`). |
| Archive-complete gate | In-transaction, **before** DROP: archive rowcount = live rowcount AND every live row has field-for-field `detail` / `rejected_at` / `registry_id`. Fail → RAISE → ROLLBACK; DROP is not reachable. |
| Rows rebuilt | 5,171 current-state rows from authoritative verdict semantics, `detail` preserved, `verdict_snapshot_id='phase1-2026-09-01'`, PK `(source_key)`. |
| WAL | Copy of 5,171 + create/insert new table + drop old. Small. |
| Locks | `AccessExclusive` on `geo.n5_point_reject` for DROP/RENAME. Brief. No concurrent reject writers. |
| Availability | Reject ledger unread by Map 1 radius path today; exclusive lock is still a stop for any session touching the table. |
| Rollback | Pre-COMMIT: archive may exist (CREATE is transactional) but DROP has not happened if the gate failed; on full ROLLBACK the live legacy table is intact. Post-COMMIT reversal: rename current table aside, rebuild from archive (founder-authorized playbook, not this file). |
| Drop/rebuild gated | Yes. Count-only is not enough; field-for-field round-trip is required. |

## Atomic transport

HTTP management API (`api.supabase.com/v1/projects/<ref>/database/query`, used by `.github/workflows/db-sql.yml`) transaction semantics: **UNPROVEN**. The workflow POSTs the entire file in one request, and `BEGIN`/`COMMIT` works on real PostgreSQL (executable assertion 2: injected failure rolls the whole migration back). Whether that endpoint honours a single implicit transaction around the script is **not proven against production**, and must not be experimented with on production.

**Preferred: PostgreSQL wire** (`psql` / `psycopg2` against the session pooler or direct Postgres, one connection, one script, script-owned `BEGIN`/`COMMIT`).

Prerequisite for a future authorized apply (do not collect or embed secrets here):

- A role that can DDL `geo.n5_geom` / `geo.n5_point_reject` and DML those tables.
- Wire access (direct or session pooler), not the HTTP management API, unless a later proof shows the HTTP path is one transaction.
- The transport MUST run the gate and the write in ONE transaction. A transport that cannot is unacceptable.

`db-sql.yml` must not be pointed at `docs/n5-applied-state-of-record.sql` (inert raise) or at this plan.

## Apply sequence once authorization is granted

1. Re-confirm writer quiescence.
2. Apply **geometry half** (or the full file if the operator chooses one transaction for both; the file is already one transaction covering both halves).
3. Verify: 718,278 proven rows carry `verdict_snapshot_id='phase1-2026-09-01'`; 0 recovered carry a snapshot; both CHECKs exist; reject still legacy until half 2 commits.
4. Report that receipt.
5. Apply **reject half** if it was split; if the full file was used, this is already done.
6. Verify: archive 5,171, current reject PK `(source_key)`, 5,171 current rows, detail preserved, 0 eligible keys rejected.

Default recommendation: **one transaction, whole file**, because the file's own gates already order the halves and a split requires two exclusive windows plus a hand-off. Split only if the operator wants a verified geometry-only pause; in that case the file must be sliced by a founder-authorized edit, not by running it twice (second run is a CORRECTED no-op and will not perform a half-finished reject rebuild).

If a split is required, it is a **separate authorized edit** that extracts §1–§8 as half 1 and §10–§14 as half 2. Do not invent that split at apply time.

## Out of scope (do not do)

No verdict population. No canonical sweep. No shards. 760 not run. No reclamation. B4 untouched. #1015 untouched. PR stays DRAFT until a human un-drafts it. Not merged by this plan.
