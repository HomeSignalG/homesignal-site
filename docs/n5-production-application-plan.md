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

**Selected architecture: Supabase session-mode pooler, port 5432, TLS** — `PG-WIRE TRANSPORT
DESIGN: PASS`. Session mode assigns a dedicated backend for the connection's lifetime, so
`SET LOCAL`, multi-statement transactions and transactional DDL all hold. **Transaction-mode
pooling (port 6543) is excluded**: a connection is multiplexed per transaction and session state
is not guaranteed. The direct endpoint (`db.<ref>.supabase.co:5432`) has identical semantics but
is IPv6-only without the IPv4 add-on, and GitHub-hosted runners are IPv4-only — hence session
mode is preferred on *reachability*, not on semantics. `PRODUCTION INSTANCE CONNECTIVITY:
UNVERIFIED` — no credentialed SELECT has reached this project's endpoint, so the gate overall is
`ATOMIC TRANSPORT GATE: CONDITIONAL` until §0 item 10 proves hostname, port, TLS, session
semantics, SELECT connectivity and server identity/version.

**The application command (design only — not run):**

```
psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f docs/n5-canonical-geometry-provenance.sql
```

**Do NOT add `-1` / `--single-transaction`.** The file owns an explicit `begin; … commit;`. With
`-1`, psql sends its own `BEGIN` first, the file's `begin;` warns *"there is already a transaction
in progress"* and is ignored, the file's `commit;` closes **psql's** transaction, and psql's
trailing `COMMIT` warns *"there is no transaction in progress"*. Still one transaction, but the
atomicity boundary becomes ambiguous — anything after the file's `commit;` would silently run
outside it — and two spurious warnings pollute the one receipt that must be unambiguous.
Atomicity is already total without it: `ON_ERROR_STOP=1` makes psql exit before reaching
`commit;`, and the server rolls the aborted transaction back.

**The single prerequisite:** a `SUPABASE_DB_URL` (direct connection string, or the pooler in
*session* mode — transaction-mode pooling is not acceptable) available to whoever applies, as a
GitHub Actions secret or an operator-local value. **No such credential exists in this repository
today** — `grep` for `postgres://`, `postgresql://`, `DATABASE_URL`, `PGPASSWORD` across all
`.yml`/`.py`/`.mjs`/`.sh` returns nothing outside the disposable test harness. Obtaining it is a
founder action, not an agent action. `CREDENTIAL PROVISIONING REQUIRED`.

---

## 4a. TIMEOUT POLICY — adopted, and executably proven

```sql
begin;
set local lock_timeout      = '5s';
set local statement_timeout = '15min';
```

**`lock_timeout` protects READERS, not the migration.** PostgreSQL's lock queue is FIFO: if an N5
writer holds ROW EXCLUSIVE on `geo.n5_geom`, the migration's pending ACCESS EXCLUSIVE request
queues behind it *and every subsequent reader queues behind the migration*. An unbounded wait
therefore turns a blocked migration into a read outage on production geometry while nothing has
been changed. 5s bounds that window; then the transaction aborts and the queue drains.

Statements needing ACCESS EXCLUSIVE: §2's `ADD COLUMN` (catalog-only), §4's two **validating**
`ADD CONSTRAINT` scans over the canonical rows, and §5's reject-table `DROP`/`ADD PRIMARY KEY`
and `SET NOT NULL`. `statement_timeout '15min'` is the ceiling for the longest single statement
(§4's UPDATE and those two scans); honest scope limit — it bounds each **statement**, not the
transaction.

**`SET LOCAL`, never `SET`:** reverted at commit *and* at rollback, so neither this session nor
the next tenant of a pooled backend inherits the values.

**No retry, no escalation, no fallback transport.** A timeout abort is the signal that the
quiescence precondition in §0 was false or stale. The two SQLSTATEs are distinguishable and the
apply receipt must record which fired: **`55P03`** lock_not_available (a writer was active) vs
**`57014`** query_canceled (the work exceeded budget).

**Executable proof — disposable PostgreSQL only, never production:**

| test | proves | result |
|---|---|---|
| E1 | `current_setting()` inside the *real* migration transaction | `lock_timeout=5s`, `statement_timeout=15min` |
| E2 | transaction-locality across **both** exits, on the same session pinned to distinctive `7s`/`77s` | unchanged after COMMIT and after ROLLBACK |
| E3 | two real concurrent connections; A holds ROW EXCLUSIVE on `geo.n5_geom`, B applies the migration | `55P03`, **5.010 / 5.009 / 5.009 s** over three repeats; full rollback |
| E3 control | the same migration with the `lock_timeout` line removed | still waiting past 120 s — the guard, not something else, is what bounds E3 |
| E4 | mechanism only, scratch `100ms` value | `57014`; setting not retained |

E3 also re-proves atomicity under a lock abort: `verdict_snapshot_id` still absent, reject PK
still `(source_key, reason)`, both row counts unchanged, and no archive or lifecycle object
created inside the failed transaction survives it.

---

## 5. GREEN RECEIPTS BACKING THIS PLAN

- Executable PostgreSQL + PostGIS: **117 / 117**, local (PG 16.13 / PostGIS 3.4.2) and in CI
  (`postgis/postgis:16-3.4`, PG 16.4), against a **production-faithful** fixture.
- Of those, **12** assert the corrected migration succeeds against the real legacy pre-state,
  **11** are negative controls proving it fails and rolls back when any invariant is corrupted,
  **7** are B1 definition validation, **2** are B2 unique-derivation, and **12** are the §4a
  timeout policy (E1–E4).
- Static source assertions: **206 / 206**. Offline unit suite: **141 / 141 files**.
- Residual fidelity limit: the fixture reproduces production's **shape and invariants** at 5-project
  scale, not its 723,449-project volume. Scale is the only modelled difference.
