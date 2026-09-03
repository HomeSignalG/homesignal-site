# N5 spatial read RPC — production readiness receipt (revision 2)

**Function:** `public.n5_projects_within_radius(p_lat double precision, p_lng double precision, p_radius_mi numeric, p_limit integer default 500)`
**DDL of record:** `docs/n5-spatial-read-rpc.sql` — sha256 `2b1b80995cb1419a35cfa8d0ba64e975fac91779a84b163e0eef2a319f80b764`
**PR:** #1015 (DRAFT, branch `claude/n5-spatial-read-rpc`) — **not merged, not applied**
**Status:** design + offline/executable validation complete. **NOT created in production. Never executed in production.**

---

## 1. What revision 1 said, and why it is obsolete

PR #1015 revision 1 (2026-09-02) was written when `geo.n5_geom` held **RECOVERY geometry only** —
8,625 eligible rows. Its measurements (25 / 28 / 52 / 69 rows at 0.5 / 1 / 2 / 5 mi) and its
scope note ("returns ONLY projects with recovered authoritative geometry … NOAUTH 7,657 vs
RECOVERY 1,962, PROVEN 1") were true on that date and are now false. Its own header already
carried a ⚠️ correction saying presence in the table no longer implies recovered geometry.

## 2. The corpus this revision is designed against

Snapshot `phase1-2026-09-01` reached **CANONICAL SYNC COMPLETE 2026-09-03 20:49:04.959655Z**
(`docs/n5-production-application-plan.md` §11). Measured on the synchronised corpus, read-only:

| provenance | outcome | rows | queryable |
|---|---:|---:|---|
| `proven_stored_point` | 1 | 718,278 | yes |
| `recovered_authoritative` | 1 | 23,283 | yes |
| `recovered_authoritative` | 3 | 1 | no — `NO_GEOMETRY`, `geom` NULL |
| **total `geo.n5_geom`** | | **741,562** | **741,561 queryable** |

SRID is uniformly **4269** across all queryable rows on both classes. Geometry types:
proven `ST_Point` 718,278; recovered `ST_MultiPolygon` 9,083, `ST_MultiLineString` 8,177,
`ST_Point` 6,023. Rejects 5,171, of which **0** carry a proven point and **0** carry
RPC-visible recovered geometry. Proven rows with a wrong `verdict_snapshot_id`: **0**.

⚠️ These counts are **documentation, not runtime behaviour**. No count is hard-coded into any
predicate; the predicate is structural so the function stays correct as the corpus grows.

## 3. Founder decision (2026-09-03)

> Map 1 street-address radius mode means **"ANY CANONICAL PHYSICALLY LOCATED PROJECT GEOMETRY
> NEAR THIS HOME."** The radius corpus SHALL include BOTH `proven_stored_point` and
> `recovered_authoritative`. Do NOT restrict it to `recovered_authoritative` only. The read
> surface must expose provenance so these two evidence classes remain distinguishable.

Implemented exactly: both classes are allowlisted **by name**, and `provenance` is a returned
column on every row.

## 4. The revised contract

```
returns table (
  source_key    text,      -- project identity
  feature_id    text,      -- geometry-instance identity
  registry_id   text,
  provenance    text,      -- 'proven_stored_point' | 'recovered_authoritative'
  distance_mi   double precision,
  geometry_type text,
  has_more      boolean    -- explicit truncation signal
)
```

**Removed from revision 1's contract**, with reasons:

| column | why removed |
|---|---|
| `first_z3` | NULL on **all 718,278** proven rows (the sweep writes null) and on 14,658 of 23,284 recovered rows. Only 8,626 rows corpus-wide carry it — almost exactly the 8,625 revision 1 was measured against. |
| `recovered_at` | On a proven row this is the canonical **sync** stamp (2026-09-03 20:49), not a recovery time. |
| `outcome` | Pinned to 1 by the predicate, so returning it conveys nothing. |

Removal was chosen over renaming: no pre-existing canonical semantic could be proven for
`first_z3` or `recovered_at` under this contract, and inventing one is worse than dropping it.

## 5. Eligibility predicate

```sql
outcome = 1
  AND geom IS NOT NULL
  AND provenance = any (array['proven_stored_point','recovered_authoritative'])
  AND (provenance = 'recovered_authoritative' OR verdict_snapshot_id = <consumable snapshot>)
  AND NOT (provenance = 'proven_stored_point'
           AND EXISTS (SELECT 1 FROM geo.n5_point_reject r WHERE r.source_key = g.source_key))
  AND geom && st_expand(<home in 4269>, ...)          -- index-usable prefilter
  AND st_dwithin(st_transform(geom,4326)::geography, <home>::geography, <metres>)
```

Every class test is a **positive allowlist**, so an outcome code or provenance class minted
later fails **closed**. Snapshot isolation applies to proven points; recovered geometry is not
snapshot-scoped and carries `verdict_snapshot_id` NULL by design (all 23,284 rows).

The reject clause is **scoped to proven points on purpose**: a reject records that the
snapshot's stored *coordinate* was unusable (`NULL_COORD` / `MULTI_COORD_UNRESOLVED`); it is
not a verdict against real publisher geometry for the same project, and suppressing recovered
geometry on that basis would discard good data.

## 6. Lifecycle guard — fails closed

The function refuses to serve unless **exactly one** snapshot satisfies
`state = 'READY' AND canonical_synced_at IS NOT NULL` — the same two claims
`n5_shard.py::assert_snapshot_consumable()` requires of a shard, not a weaker local
definition. `SELECT … INTO STRICT` fails closed in both directions (`NO_DATA_FOUND`,
`TOO_MANY_ROWS`), both raising SQLSTATE `55000`.

🔑 **The mid-sweep case is the one that matters.** `sync_canonical()` NULLs
`canonical_synced_at` as its first durable act and restores it only after both set-equality
verifications pass, so for the whole duration of a sweep this function **raises** instead of
returning a half-swept corpus. Executed and proven, not asserted — see §9.

## 7. Truncation contract

Radius stays bounded to the product allowlist (0.5/1/2/5 mi) — never an unbounded national
read. On top of that: `p_limit` is caller-supplied (default 500), **rejected rather than
clamped** outside `[1, 2000]`, and `has_more` is explicit on every row. It is computed by
fetching `p_limit + 1` rows and reporting whether the extra one existed.

* `has_more = false` → the result **is** the complete match set, and its row count is the true
  number of matching geometries.
* `has_more = true` → further matching geometry exists beyond what was returned.

A caller never infers truncation from `rows == p_limit`, which is ambiguous exactly when the
true count equals the limit.

**Why revision 1's bare `LIMIT 2000` was not acceptable.** It was sized against 8,625 rows;
the queryable corpus is now 741,561 — **86× larger**. Measured 2026-09-03 on 0.1° cells (≈6.9
mi, *smaller* than a 5-mi-radius circle, therefore a lower bound): **max 23,321 points in one
cell**, **87 cells over 2,000**, and **397,241 of 718,278 proven points (55.3%)** sit in cells
that already exceed 2,000. Silent truncation across every dense metro was certain.

## 8. Geometry, identity and access path

* **Geometry:** `ST_DWithin`/`ST_Distance` on `geography` against the **true** stored geometry.
  No `ST_Centroid`, no `ST_PointOnSurface`, no `geo.n5_rep_point()` (the representative-point
  reducer used by the A3 shadow path), no `app_projects` lat/lng. A home inside a polygon
  measures **0**; a point outside measures distance to the **edge**.
* **Identity grain:** exactly `(source_key, feature_id)` — the table's primary key. No
  `distinct on`, no `group by`, `source_ref` and `source_seq` never used as identity. One
  `source_key` with many geometries returns many rows.
* **Access path:** `EXPLAIN` (no `ANALYZE`) on the production corpus, 2026-09-03:
  `Index Scan using n5_geom_gix`, `Index Cond: ((geom IS NOT NULL) AND (geom && '…'::geometry))`,
  `Filter: ((outcome = 1) AND st_dwithin(…))`. **No index is created by this change.**
* **A3:** the A3 `source_key` finding measured an `app_projects`/shadow-read path and is **not
  binding here** — this function reads `geo.n5_geom` directly, which carries its own
  `n5_geom_sk_ix` btree(`source_key`) alongside the GiST, and joins `app_projects` nowhere.
  📌 Recorded and **not acted on**: `app_projects` was observed 2026-09-03 to carry
  `app_projects_source_key_kind_idx (source_key, record_kind)`, a leading-`source_key` index,
  so the earlier A3 premise — that the only `source_key`-bearing index was
  `(zip, source_key, source_seq)` — may itself now be stale. That is the parallel session's
  object and was not touched.

## 9. Security model

`SECURITY DEFINER`, `STABLE`, `set search_path = public`, `revoke all … from public`,
`grant execute … to anon, authenticated`. No grant on `geo.*`. No dynamic SQL. No writes.

🔒 **Ownership is load-bearing and must be verified at apply time.** `geo.n5_geom`,
`geo.n5_point_reject` and `geo.n5_verdict_manifest` all have **RLS enabled with zero
policies** and `relforcerowsecurity = false`, and neither `anon` nor `authenticated` holds
SELECT on them (measured 2026-09-03). A table owner bypasses RLS when force is off, so this
function reads rows **only if it is owned by `postgres`**. Applied by any other role it will
create successfully, pass every test, and then **return zero rows forever** — a silent empty
result indistinguishable from "nothing near this home". The apply gate below verifies
`proowner` explicitly.

## 10. Test results

| suite | where | result |
|---|---|---|
| Static contract guards | `test/n5-spatial-read-rpc.test.mjs` (offline) | **82/82** |
| Executable contract suite | `test/n5_spatial_pg/run_suite.py` on PostGIS 16-3.4 and 17-3.5 | **78 assertions, 0 failures on both legs** — run `33807098228` |
| Full offline gate | `node scripts/run-unit-tests.mjs` | **141/141 files** |

The executable suite runs the **shipped DDL verbatim** against a disposable PostGIS and proves
the behaviours static text cannot: both provenance classes returned and labelled; NULL
geometry, unknown outcome, wrong snapshot, NULL snapshot and rejected proven points excluded;
a rejected identity's **recovered** geometry kept; POINT / LINESTRING / MULTILINESTRING /
POLYGON / MULTIPOLYGON handled; home-inside-polygon distance 0; radius sets monotonically
nested; multi-geometry preserved as separate rows; deterministic ordering; `has_more` false
when complete, true when truncated, and correct at the exact `limit == true count` boundary;
all 16 parameter-validation rejections; and the lifecycle gate refusing on non-READY,
READY-but-unsynced (**the mid-sweep window**), absent and ambiguous manifests.

**Executed receipt.** Run `33807098228` (head `04269b8`), both matrix legs
`postgis/postgis:16-3.4` (PostgreSQL 16.4) and `postgis/postgis:17-3.5`: the fail-gate step
was **skipped** on each, which happens only when the executable and static suites both exit 0.

⚠️ **The first run, `33806849721`, went RED — and the defect was in the INSTRUMENT, not the
RPC.** Assertions 29 and 30 (`MULTILINESTRING is handled`, `MULTIPOLYGON is handled`) failed
because the suite collected geometry types as `{source_key: geometry_type}`, which collapses
`proj:multi`'s three geometry instances to whichever sorted last and discards two of the five
types before they can be asserted — **the very per-`source_key` collapse this RPC exists to
prevent, reproduced inside the instrument built to detect it.** The other 75 assertions passed,
including the two that contradicted the failures outright: `PASS 36 — one source_key with 3
geometries returns 3 SEPARATE rows` and `PASS 37 — and their feature_ids are distinct`. Fixed
by keying on the full `(source_key, feature_id)` grain and adding an assertion that all five
geometry types survive in one result set. `docs/n5-spatial-read-rpc.sql` was **not changed** —
its sha256 is identical across both runs.

**Both suites carry negative controls.** Statically, seven mutations each turn the suite red
and the file restores clean: dropping the STRICT lifecycle gate, dropping `provenance`,
reinstating a bare `LIMIT 2000`, clamping instead of rejecting an over-large limit, dropping
the reject exclusion, substituting a centroid, and collapsing per `source_key`. In the
executable suite, removing `STRICT` is shown to break the mid-sweep refusal and removing the
reject clause is shown to let the rejected identity back in — then the shipped DDL is restored
and the guarantee re-proven.

## 11. Exact production apply gate (NOT executed)

Nothing below has been run. In order, in one session, over the verified PG-wire path:

1. **Quiescence + pre-state**, read-only: assert exactly one manifest with `state='READY'` and
   `canonical_synced_at IS NOT NULL`, and that `public.n5_projects_within_radius` does **not**
   already exist.
2. **Apply** `docs/n5-spatial-read-rpc.sql` verbatim, after asserting its sha256 is
   `2b1b80995cb1419a35cfa8d0ba64e975fac91779a84b163e0eef2a319f80b764`.
3. **Verify ownership — the gate that makes or breaks the RLS model:**
   ```sql
   select pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.provolatile, p.proconfig
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='n5_projects_within_radius';
   -- REQUIRED: owner = 'postgres', prosecdef = true, provolatile = 's',
   --           proconfig contains 'search_path=public'
   ```
   Any other owner ⇒ **drop it and stop**; do not leave a function that returns silent zeros.
4. **Verify grants:** EXECUTE revoked from `public`, granted to `anon` and `authenticated`;
   and that `anon` still has **no** SELECT on `geo.n5_geom`.
5. **One bounded read-only proof call** — a single known address point at 0.5 mi with a small
   `p_limit` — asserting: rows carry both/either provenance value correctly labelled, every
   `distance_mi <= 0.5`, ordering is nearest-first, and `has_more` agrees with whether the
   limit bound the result.
6. **Prove production was not mutated:** `geo.n5_geom` count and PROVEN fingerprint unchanged
   (`741,562` / `bbda250fc30ee0b3aa3f46a259392aa3`), rejects 5,171, associations 20,170,
   `canonical_synced_at` unchanged.

## 12. Rollback / removal plan

The change is a single function and creates no table, column, index, grant on `geo.*`, or RLS
change, so removal is complete and leaves no residue:

```sql
drop function if exists public.n5_projects_within_radius(double precision, double precision, numeric, integer);
```

There is no data to restore: the function is `STABLE` and writes nothing. Removing it cannot
affect `geo.n5_geom`, the reject ledger, associations, the manifest, Map 1 or Map 2 — Map 1 is
not wired to it by this change. If a future revision changes the signature, the **old**
signature must be dropped explicitly; `create or replace` will not remove it and two
overloads would make the callable surface ambiguous.

---

## 13. Production apply attempt 2026-09-03 21:23Z — **BLOCKED BEFORE APPLY, nothing installed**

**Outcome: C — BLOCKED BEFORE APPLY.** `CREATE FUNCTION` was **not** issued. The RPC is still
absent from production, no N5 data was touched, and no ruling was made unilaterally.

**Artifact identity — PASSED.** HEAD `361941d4aaf77766368ce64834e42e918b5bea55` (the authorized
commit itself), origin == local, tree clean, and the DDL byte-identical to that commit. Its full
sha256 was read from **this committed receipt**, not from the abbreviated conversation value, and
three independent computations agree:

| source | sha256 |
|---|---|
| this receipt (§ header) | `2b1b80995cb1419a35cfa8d0ba64e975fac91779a84b163e0eef2a319f80b764` |
| working-tree file | `2b1b80995cb1419a35cfa8d0ba64e975fac91779a84b163e0eef2a319f80b764` |
| blob at `361941d` | `2b1b80995cb1419a35cfa8d0ba64e975fac91779a84b163e0eef2a319f80b764` |

**Production preconditions, observed read-only at `2026-09-03 21:23:07.223842Z`:**

| precondition | required | observed | verdict |
|---|---|---|---|
| `n5_projects_within_radius` exists (any signature) | 0 | **0** | ✅ safe to create |
| manifest `phase1-2026-09-01` state | READY | **READY** | ✅ |
| `canonical_synced_at` | not null | **2026-09-03 20:49:04.959655+00** | ✅ |
| `geo.n5_geom` total | 741,562 | **741,562** | ✅ |
| `proven_stored_point` | 718,278 | **718,278** | ✅ |
| `recovered_authoritative` | 23,284 | **23,284** | ✅ |
| canonical PROVEN fingerprint | `bbda250f…` | **`bbda250fc30ee0b3aa3f46a259392aa3`** | ✅ |
| `geo.n5_point_reject` | 5,171 | **5,171** | ✅ |
| **`geo.n5_association`** | **20,170** | **21,674** | ⛔ **+1,504 — DIVERGED** |

**Quiescence at the same instant:** 0 active N5 sessions · 0 shards `running` · **0 locks on
`geo.n5*`** (two locks seen moments earlier were transient and had cleared). So nothing was
executing — but see below: nothing executing is not the same as nothing in flight.

### Why the association count moved, and why it is not a defect

`geo.n5_shard`: **18 `done`, 526 `pending`, 0 `running`**, newest completion
**2026-09-03 20:51:07.302586Z** — roughly **two minutes after** `sync_canonical()` set
`canonical_synced_at` at 20:49:04.959655Z.

That is the lifecycle behaving exactly as designed, not a fault.
`assert_snapshot_consumable()` refuses a snapshot that is not READY **and** canonically synced,
so shard processing could not have run before 20:49:04 and began as soon as it could. The
+1,504 associations are the first 18 shards consuming the snapshot this session published.
Canonical geometry, its fingerprint, the reject ledger and the manifest are all **unchanged**,
which is the control that makes this attributable to shard consumption rather than to drift.

### Why this blocks, even though the RPC never reads `geo.n5_association`

The function's predicate touches `geo.n5_geom`, `geo.n5_point_reject` and
`geo.n5_verdict_manifest` only — the association count is irrelevant to its correctness. The
block is not about correctness; it is about two things the authorization requires and that
cannot currently be satisfied honestly:

1. **§2 states `associations = 20170` as a precondition and says to STOP on material
   divergence.** Deciding on my own that this particular precondition does not matter would be
   narrowing a founder-set gate mid-flight — the move this session has refused three times
   already. Rule #0: the parameter is not mine to change.
2. **§8's zero-mutation proof would be unsound as written.** With **526 shards still pending**,
   the association count is a *moving* value owned by another writer. Pinning the post-apply
   assertion to 20,170 fails immediately; pinning it to 21,674 fails the moment shard 19 runs —
   and it would fail by attributing an unrelated writer's rows to my `CREATE FUNCTION`. A
   zero-mutation proof whose baseline another session is actively changing does not prove zero
   mutation; it manufactures a false alarm about the wrong change.

### What is needed to unblock (founder ruling, not a change I may make)

Either of these makes the apply provable; both are the founder's call:

- **(a) Re-baseline and scope the proof.** Accept the live association count as the baseline and
  **exclude `geo.n5_association` from the zero-mutation assertion**, since the RPC cannot write
  it and an independent shard campaign is actively growing it. The remaining zero-mutation
  proof — geometry total/provenance split/fingerprint, rejects, manifest, `canonical_synced_at`
  — stays exact and is what a `CREATE FUNCTION` could actually threaten.
- **(b) Wait for the campaign to drain.** Apply once the 526 pending shards complete and the
  association count is stable, then use that stable value.

Nothing about the reviewed artifact changes under either ruling: the DDL, its sha256, and all
78 + 82 assertions stand.

**Holds observed:** the RPC was not created, not executed, and not modified. No shard was run or
reconciled, no index added, `app_projects`/A3/Map 1/RLS untouched, no canonical geometry, reject
or association write, no publish-verdict, no sync-canonical, PR #1015 still DRAFT.
