# N5 PRODUCTION APPLICATION PLAN — ✅ APPLIED 2026-09-03 17:40:03Z

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

## 4b. READ-ONLY PRODUCTION PREFLIGHT — measured 2026-09-03 ~16:49Z

Re-measured from production, not carried from earlier receipts. Read-only; zero writes.

| item | measured |
|---|---|
| PostgreSQL | **17.6** aarch64 (engine 17.6.1.127) — **production is PG 17, not 16** |
| PostGIS | **3.3.7** (GEOS 3.14.1, PROJ 9.7.1) |
| project / region | `qwnnmljucajnexpxdgxr` · **us-west-2** · ACTIVE_HEALTHY · db `postgres`, port 5432 |
| §1 pre-state classification | `has_vsid=false` · `has_bicond=false` · `has_ptns=false` · reject PK `PRIMARY KEY (source_key, reason)` · no archive → **A_LEGACY** |
| association PK | `PRIMARY KEY (source_key, zip)` — already applied, §1 asserts it, #1016 does not re-author it |
| canonical geometry | **718,278** `proven_stored_point`, **718,278** `pt:1`, 0 non-`ST_Point`, 0 wrong SRID, 0 duplicate keys, 0 `pt:` squatters |
| rejects | **5,171**, 0 duplicate keys, **1** distinct snapshot = `phase1-2026-09-01`, 0 missing snapshot |
| partition closure | 718,278 + 5,171 = **723,449** ✓ |
| B2 unique derivation | 723,449 derivation rows · 723,449 distinct `source_key` · **0 duplicates** |
| §3 set identity | ELIGIBLE **718,278**; canonical∖eligible **0**; eligible∖canonical **0**; coordinate mismatch **0** at 1e-9 |
| sizes | `geo.n5_geom` 322 MB · `geo.n5_point_reject` 1,624 kB · database 6,895 MB |
| replication slots | **0** (none, so no WAL-retention risk) |
| writer quiescence @ **2026-09-03 16:49:18Z** | 0 active N5 queries · 0 locks on `n5_geom`/`n5_point_reject`/`n5_association` · 0 idle-in-transaction · **0 shards running** (544 total) · no `n5_verdict_manifest` yet |

⚠️ **Writer quiescence above is EVIDENCE, NOT PERMISSION.** It is stale the moment it is
recorded and MUST be re-proven immediately before any authorized application (§0(i)).

**Not visible from SQL, founder-side checks at apply time:** free disk headroom (budget ≈2× the
322 MB relation while the UPDATE's dead tuples await VACUUM, plus ~140–190 MB WAL) and the
PITR/backup posture with the pre-apply restore point.

**PG 17 compatibility closed:** `.github/workflows/n5-postgis-suite.yml` now runs the full
117-assertion suite on a **two-leg matrix — `postgis/postgis:16-3.4` and `postgis/postgis:17-3.5`**,
both green. The PostGIS minor cannot match 3.3.7 (no image pairs PG17 with 3.3), but every
spatial function the migration uses predates 3.0 and each was exercised against production's
real 3.3.7 by the preflight above.

**Credential status, checked rather than inferred:** run
[33781209601](https://github.com/HomeSignalG/homesignal-site/actions/runs/33781209601) step
"Is a PG-wire credential provisioned?" reported `SUPABASE_DB_URL: NOT SET`. No GitHub
Environment is referenced by any workflow; the only DB transport in the repo is `db-sql.yml`
over the Management API. `.github/workflows/n5-db-connectivity.yml` is the SELECT-only proof,
ready to re-run the moment the secret exists.

---

## 4c. PG-WIRE CONNECTIVITY — INCIDENT, THEN PROOF

⚠️ **The first verification run is NOT a readiness receipt, and is retained rather than
overwritten.** Run `33781209601` attempt 2, 2026-09-03 17:13Z. The workflow established
read-only mode with `PGOPTIONS=-c default_transaction_read_only=on`. **Supavisor does not
forward the `options` startup parameter**, so the server never applied it: the job printed
`default_read_only | off` and then executed `create temporary table n5_readonly_probe (x int)`,
which **SUCCEEDED**. That was one unintended DDL statement against production, contrary to the
standing NO-DDL constraint.

- **Measured impact:** the object existed only in that session's temp schema and was dropped
  when psql disconnected. Verified read-only afterwards: `probe_object_anywhere = 0`, canonical
  **718,278**, rejects **5,171**, `verdict_snapshot_id` absent, reject PK `(source_key, reason)`,
  **0** lifecycle objects. Nothing persisted; no user data touched. It remains a real violation.
- **The job still reported SUCCESS**, because nothing asserted on the probe's outcome.
- Second defect the same run exposed: `pg_stat_ssl` reports the **pooler's** connection to
  Postgres, not ours, so it read `ssl = f` on a TLS client link.

**Two rules now encoded in the workflow, and they generalise beyond it:**
1. **A safety layer that can be silently stripped in transit is not a safety layer.** Read-only
   mode is now set **server-side, in-session** (`set session characteristics as transaction read
   only`), where the pooler cannot remove it.
2. **A probe whose result nothing asserts on is not a proof.** The probe now **fails the job**
   when it succeeds, and is **unreachable** unless read-only mode was affirmatively observed
   `on` in the same session — enforced by a `raise` under `ON_ERROR_STOP=1`.

Both directions were proven on a disposable cluster before production was touched again:
read-only on → probe rejected `25006`, 0 objects; read-only off → the gate aborts (exit 3) and
the statement after it never executes; probe reached with read-only off → raises, exit 3, and
the `raise` rolls the attempted object back so **0 objects survive either way**.

**Also learned, and load-bearing for the migration:** this transport's session default is
`statement_timeout = 2min`. The migration's `set local statement_timeout = '15min'` overrides it
inside the transaction — **without that declaration the 718,278-row UPDATE would be cancelled at
2 minutes.** The timeout policy is required on this path, not decorative.

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


---

## 6. APPLICATION RECEIPT — ✅ APPLIED AND VERIFIED 2026-09-03

Founder-authorized for ONE bounded operation. Applied once. **No retry occurred.**

| field | value |
|---|---|
| Authorized SHA | `8a50978ef1c2c2ec2345bbcd7e79db85989c2e0a` |
| Migration | `docs/n5-canonical-geometry-provenance.sql` |
| SHA-256 | `33ea024fcc333efdd9a7da9095768a3e39d2528cf2d5df12634faae95c9de79f` (asserted on the runner before connecting) |
| Applied from | `git show 8a50978:docs/…` — the **authorized commit's blob**, not the working tree |
| Executed at | commit `91aab3d`, workflow run [33785587515](https://github.com/HomeSignalG/homesignal-site/actions/runs/33785587515) |
| Transport | session-mode Supavisor `:5432`, TLS 1.3 (`TLS_AES_256_GCM_SHA384`) |
| Command | `psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -P pager=off -f <authorized blob>` — credential **redacted**, never echoed, never an argv item; **no `-1`**, no Management API, no port 6543 |
| PostgreSQL / PostGIS | **17.6** / **3.3.7** |
| Precheck + writer quiescence | `17:37:03Z – 17:38:01Z` — 0 active N5 queries, 0 relation locks, 0 shards running, 0 inactive replication slots, no manifest, pre-state `A_LEGACY` |
| Migration START | **2026-09-03 17:38:01Z** (same second the quiescence proof completed) |
| Migration COMMIT | **2026-09-03 17:40:03Z** |
| Elapsed | **122 s** |
| Retry count | **0** |

**In-transaction gate receipts, in order, from the job log:**

```
BEGIN · SET · SET
NOTICE: N5 pre-state classified as A_LEGACY
NOTICE: MULTIPLICITY INVARIANT PASSED - 723449 derivation rows, 723449 distinct source_keys
NOTICE: gate: authoritative=723449 eligible=718278 ineligible=5171 legacy_points=718278
NOTICE: GATE PASSED - legacy state is exactly the phase1-2026-09-01 eligible/ineligible partition
UPDATE 718278
NOTICE: ARCHIVE GATE PASSED - 5171 legacy reject row(s) preserved with detail and rejected_at intact
NOTICE: REBUILD GATE PASSED - current-state rejects reproduce the archived partition
NOTICE: DEFINITION VALIDATION PASSED - all three lifecycle tables match the contract
COMMIT
```

**Row counts, before → after:**

| | before | after |
|---|---:|---:|
| canonical `proven_stored_point` | 718,278 | **718,278** (all now carrying `verdict_snapshot_id='phase1-2026-09-01'`) |
| `recovered_authoritative` | 23,284 | **23,284** (0 attributed — biconditional holds) |
| `geo.n5_geom` total | 741,562 | **741,562** |
| `geo.n5_point_reject` | 5,171 (legacy) | **5,171** (rebuilt current-state, PK `(source_key)`) |
| `geo.n5_point_reject_archive` | — | **5,171** |
| `geo.n5_association` | 20,170 | **20,170** (untouched, PK `(source_key, zip)`) |

**Fingerprints (`collate "C"` pinned, per rule 9):** canonical geometry `bbda250fc30ee0b3aa3f46a259392aa3` — **unchanged**, so no point was lost, added or moved. Legacy rejects `17acf9a3116b2ecf71155c476771a027` — the archive reproduces them **byte for byte**.

**Post-state verification** (read-only, immediately after commit): `POST-STATE VERIFIED — geometry, rejects, archive, lifecycle, association and partition all close`. Independently re-confirmed on a second transport at 17:41Z. Partition: 718,278 + 5,171 = 723,449 ✓.

**Warnings:** two benign `constraint … does not exist, skipping` notices from `drop constraint if exists` in state A, and GitHub's unrelated Node 20 deprecation warning. Nothing else.

**Lifecycle NOT executed, by design:** `geo.n5_proven_verdict` **0 rows**, `geo.n5_verdict_manifest` **0 rows**. The tables exist with the validated definitions; nothing was published, no sweep, no shards, no 760, no reclamation, B4 and #1015 untouched, no RLS change, PR #1016 still DRAFT.

**Rehearsal that preceded this** (disposable PG16/PostGIS, production-faithful fixture): precheck PASS → the real authorized blob applied → POST-STATE VERIFIED; negative control (one canonical point deleted) failed four independent ways. Two harness defects were found there and fixed **before** production was contacted: a read-only transaction refuses `create temporary table` (SQLSTATE 25006), and psql does not interpolate `:vars` inside dollar-quoted blocks.

---

## 7. PUBLISH-VERDICT ATTEMPT 1 — ❌ FAILED 2026-09-03 17:54:48Z (statement timeout)

**Outcome: B — verdict publication FAILED. Nothing was repaired, nothing retried.**

| field | value |
|---|---|
| Snapshot | `phase1-2026-09-01` |
| Implementation | `scripts/n5_shard.py` blob `99349f5e4b31eaccf64627f4de4499aeb30e9e68` · `scripts/n3_pilot.py` blob `ae42015b86aac64047d3e586364e0da3d670d5cc`, at commit `18276e1`, `scripts/` clean |
| Run | [33787011485](https://github.com/HomeSignalG/homesignal-site/actions/runs/33787011485) |
| Precheck | **PASS** `17:51:32–17:52:37Z` — snapshot registered, 2,976,275 preservation rows, 145 PROVEN registries, derivation 723,449/723,449 with **0 duplicates**, eligible 718,278, partition closes, no manifest, 0 verdict rows, 0 shards running, no competing publisher |
| BUILDING written | `17:52:47.139568Z` |
| Failure | `17:54:48Z`, **~121 s** into the verdict build |
| Error | `STOP: SQL build verdict phase1-2026-09-01 failed HTTP 400` → `ERROR: 57014: canceling statement due to statement timeout` |

**ROOT CAUSE — a transport limit, not a data or logic defect.** `publish-verdict` reaches the
database through `n3_pilot.sql()` → the Supabase **Management API**, and that path enforces
`statement_timeout = 2min` (measured directly: `current_setting('statement_timeout')` = `2min`
on both this endpoint and the session pooler's default). `refresh_proven_verdict_sql()` is a
full pass over the 1,125 MB `preservation.app_project_identity` whose `cnt` CTE uses a
**correlated subquery**:

```sql
cnt as (select p.source_key,
               (select count(*) from pairs q where q.source_key = p.source_key) ncoord
          from proven p)
```

`n3_pilot.sql()`'s own 900 s `urlopen` timeout is irrelevant — the **server** cancels at 120 s.

**State after the failure — the fail-closed design worked exactly as written:**

- `geo.n5_proven_verdict`: **0 rows.** No partial verdict exists.
- Manifest `phase1-2026-09-01`: **`BUILDING`**, `expected_source_keys`/`verdict_rows`/
  `eligible_rows`/`reject_counts`/`fingerprint`/`completed_at` all NULL,
  **`canonical_synced_at` NULL**. `assert_snapshot_consumable()` refuses a BUILDING snapshot,
  so nothing downstream can consume it. It never approached READY.
- **Geometry untouched:** total 741,562 · canonical 718,278 · recovered 23,284 · rejects 5,171 ·
  archive 5,171 · associations 20,170 — all identical to the post-migration receipt in §6.
- Retry count **0**. No production table was repaired by hand.

**A measured fact that bounds the fix:** the precheck performs an *equivalent* derivation using
a `GROUP BY` join instead of the correlated subquery, over the same data, and the whole precheck
step — connection, TLS, ten assertions and that derivation — completed in **65 seconds**, well
inside the 120 s ceiling. The cost is in the correlated subquery's shape, not in the data volume.

**Two candidate corrections, neither authorized and neither performed:**
1. **Change the transport** — run `publish-verdict` over the PG-wire session pooler, where
   `set local statement_timeout` can be raised (proven: the migration ran a 122 s transaction
   there under a 15 min local timeout). Requires changing `n5_shard.py`'s transport.
2. **Change the derivation shape** — rewrite `cnt` as a `GROUP BY` aggregate joined to `proven`,
   which the precheck shows completes comfortably. This is an algorithm change in production
   code and is explicitly out of scope without authorization.

Re-running `publish-verdict` unchanged would fail identically and re-write `BUILDING`.

---

## 8. PUBLISH-VERDICT ATTEMPT 2 — ❌ FAILED 2026-09-03 18:29:04Z (57014 at the 15-minute wall)

**Outcome: B — publication FAILED and rolled back. Nothing repaired, nothing retried.**

**The transport correction was necessary but NOT sufficient.** Attempt 1 (Management API) was
cancelled at **120 s** by a server-side ceiling the caller cannot raise. Attempt 2 ran the
identical SQL over the PG-wire session pooler with `set local statement_timeout='15min'` — and
the statement ran for the **full 15 minutes** before being cancelled at exactly `18:29:04Z`.
So the transport change did exactly what it was designed to do (2 min → 15 min of headroom);
the binding constraint is the **derivation**, not the pipe.

| field | value |
|---|---|
| Snapshot | `phase1-2026-09-01` |
| Execution SHA | `414844a` · `scripts/n5_shard.py` blob `53dfc12ec878f3bdd6eebaccf8898eb991c45162` |
| Algorithm changed | **NO** — derivation md5 `82397daae888ad0fcbf1f3c93774ca14`, guarded by executable assertion 125 |
| Transport | PG-wire session pooler `:5432`, TLS, `psql -X -v ON_ERROR_STOP=1`, `SET LOCAL lock_timeout='5s'` / `statement_timeout='15min'`, no Management API credential present |
| Run | [33789161115](https://github.com/HomeSignalG/homesignal-site/actions/runs/33789161115) |
| Precheck | **PASS** `18:13:10–18:13:56Z` (46 s) — including the stale-BUILDING re-proof |
| BUILDING written | `18:14:04.019Z` |
| Failure | `18:29:04Z` — **exactly 15 min**, SQLSTATE `57014` |
| Retry count | **0** |

**Rollback proven, read-only, after the failure:** `geo.n5_proven_verdict` **0 rows** — the
rebuild's `DELETE` and partial `INSERT` rolled back together. Manifest `BUILDING`, every metric
NULL, `canonical_synced_at` NULL. Geometry **byte-identical to §6**: total 741,562 · canonical
718,278 · recovered 23,284 · fingerprint **`bbda250fc30ee0b3aa3f46a259392aa3`** unchanged ·
rejects 5,171 · archive 5,171 · associations 20,170. No orphaned backend.

### The decisive measurement

The same result set, computed two ways over the same 1,125 MB table, in the same run:

| form | where | time |
|---|---|---|
| `cnt` as a **correlated subquery** — the committed derivation | the publish | **> 15 min (cancelled)** |
| `cnt` as a **`GROUP BY` aggregate join** — the precheck's independent re-derivation | the precheck | the **whole** precheck step, connect + TLS + 12 assertions + this derivation, took **46 s** |

```sql
-- committed, in refresh_proven_verdict_sql():
cnt as (select p.source_key,
               (select count(*) from pairs q where q.source_key = p.source_key) ncoord
          from proven p)
-- the precheck's equivalent:
pc  as (select source_key, count(*) c from pairs group by source_key)
```

The correlated form re-scans `pairs` once per PROVEN project — 723,449 times. That is the cost,
and no timeout value fixes it.

**Consequence:** Option 1 alone cannot complete this publication. **Option 2 — reshaping `cnt`
to a `GROUP BY` join — is now required, and is explicitly outside the current authorization**
("Do NOT rewrite or optimize the verdict derivation"). Re-running unchanged would burn another
15 minutes of production CPU and fail identically.

The transport change is kept: it is correct, proven by 8 executable assertions, and every
future full-corpus operation needs it regardless.

---

## 9. CARRIED DOWNSTREAM — the A3 read-path finding (NOT solved here)

Recorded, not acted on. This belongs **after** the canonical verdict lifecycle is closed.

The parallel `claude/homesignal-zip-forensics-13xkmw` workstream benchmarked the one-pass
shadow project read `geo.n5_a3_projects_one_pass(zip)` on 2026-09-03 (run `a3m-1788459821`,
346 cutover-candidate ZIPs × 2 passes). Its own commit title states the finding:
**"one-pass shadow read benchmarked — NOT servable without a source_key index."**

`docs/maps-coverage/UNIT-A3-BENCHMARK-EVIDENCE.md` on that branch names the cause: the only
index containing `source_key` is `app_projects_zip_source_key_uidx (zip, source_key,
source_seq)`, so the read plans as a **Memoized nested loop over an index scan** rather than a
single sequential scan. That is the per-ZIP project read Map 1 would sit on.

**Explicitly NOT done here, by ruling:** no index added · `public.app_projects` unchanged ·
the shadow read unchanged · the A3 branch not merged · A3 objects not promoted, modified or
deleted · Map 1 unchanged. A3's results are another workstream's evidence, cited only.

Object family is disjoint from verdict publication: A3 writes `geo.n5_a3_*` and
`geo.zip_authoritative_marker`; it does not touch `geo.n5_geom`, `geo.n5_association`,
`geo.n5_boundary_membership`, `geo.n5_proven_verdict`, `geo.n5_verdict_manifest`,
`public.app_projects` or its indexes. Its own preservation control on
`public.app_projects_for_zip` (md5 `ec1b01ae4485ad2c59b9f946c9d565b6`) was re-verified at both
ends of that unit.
