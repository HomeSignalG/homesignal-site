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

---

## 14. PRODUCTION INSTALLATION — **INSTALLED AND VERIFIED**, 2026-09-03 21:31:19Z

**Outcome: A — RPC INSTALLED AND VERIFIED.** `public.n5_projects_within_radius(double precision,
double precision, numeric, integer)` is live in production, owned by `postgres`, with a body
**byte-identical** to the reviewed artifact. **It has never been executed.**

| | |
|---|---|
| Authorized DDL commit | `361941d4aaf77766368ce64834e42e918b5bea55` |
| DDL sha256 | `2b1b80995cb1419a35cfa8d0ba64e975fac91779a84b163e0eef2a319f80b764` |
| Applied at | **2026-09-03 21:31:19Z**, run `33808337362`, head `c7ff0a7` |
| Transport | PG-wire session pooler :5432, TLS, `psql -X --single-transaction`, `ON_ERROR_STOP`, `lock_timeout='5s'`, `statement_timeout='5min'` |
| Retry count | **0** — applied exactly once, never re-applied |

**Artifact identity.** The receipt-only commit `ed957b0` changed `docs/n5-spatial-read-rpc-readiness.md`
and nothing else; the DDL sha256 is identical at `361941d`, at `ed957b0`, at HEAD and in the
working tree. Passed on the runner before any database contact.

### The association gate — original, observed, superseded

The unit was first **BLOCKED** (§13) because `geo.n5_association` read **21,674** against a fixed
precondition of **20,170**. **Founder ruling 2026-09-03: that fixed equality is RETIRED for this
installation unit and is not replaced by any other constant.** The RPC neither reads nor writes
that table — proven from the installed body itself (`no_n5_association = true`) — and an
independent shard campaign is legitimately consuming the snapshot this session published, so a
fixed equality would convert real shard progress into a false installation failure. Association
is **observational**: measured, reported, never asserted.

| observational | before (21:23:07Z) | after (21:33:05Z) | delta |
|---|---:|---:|---:|
| `geo.n5_association` | 21,674 | **22,698** | **+1,024** |
| shards `done` | 18 | **41** | +23 |
| shards `pending` | 526 | **503** | −23 |
| shards `running` | 0 | **0** | 0 |

**Attribution:** association growth tracks shard completion exactly in direction and timing
(+23 shards, +1,024 rows), the installed function contains no reference to `geo.n5_association`,
and every hard control below is unchanged. The movement is the independent campaign, not the
install.

### Hard controls — all unchanged (a divergence would have been a STOP)

| control | before | after |
|---|---|---|
| `geo.n5_geom` total | 741,562 | **741,562** |
| `proven_stored_point` | 718,278 | **718,278** |
| `recovered_authoritative` | 23,284 | **23,284** |
| canonical PROVEN fingerprint | `bbda250fc30ee0b3aa3f46a259392aa3` | **`bbda250fc30ee0b3aa3f46a259392aa3`** |
| `geo.n5_point_reject` | 5,171 | **5,171** |
| manifest state | READY | **READY** |
| `canonical_synced_at` | 2026-09-03 20:49:04.959655+00 | **2026-09-03 20:49:04.959655+00** |

The pre-apply values are the run's own PRE-STATE gate, which passed at 21:31:06–21:31:19Z and
asserts each of them; the post-apply values were re-read at 21:33:05Z. **`CREATE FUNCTION`
mutated no N5 data.**

### Installed object

```
n5_projects_within_radius(double precision, double precision, numeric, integer)
identity args : p_lat double precision, p_lng double precision, p_radius_mi numeric, p_limit integer
returns       : TABLE(source_key text, feature_id text, registry_id text, provenance text,
                      distance_mi double precision, geometry_type text, has_more boolean)
owner         : postgres          prosecdef : true (SECURITY DEFINER)
provolatile   : s (STABLE)        proconfig : search_path=public
overloads     : 1
```

**Definition identity — EXACT, not merely token-level.** `md5(prosrc)` in production is
**`e1bb67c604aaaa4e1ab541ee32bc82ea`**, length **6,569**, equal to the md5 of the dollar-quoted
body of the committed file. Production carries the reviewed semantics verbatim.

Token readout over the **stored production body**: both provenance classes allowlisted by name ·
provenance in the result type, selected from the row and carried to the output · `outcome=1` +
`geom is not null` · proven snapshot condition · rejected-identity exclusion via
`geo.n5_point_reject` · lifecycle `READY` + `canonical_synced_at is not null` + `INTO STRICT` ·
radius allowlist `{0.5,1,2,5}` · `p_limit` validation · hard maximum 2000 · `limit p_limit + 1` ·
explicit `has_more` · deterministic ordering · true-geometry `ST_DWithin`/`ST_Distance` ·
`(source_key, feature_id)` grain · **no** `distinct on` · **no** representative-point reduction ·
**no** `app_projects` · **no** `geo.n5_association` · **no** dynamic SQL.

### Security

`EXECUTE`: PUBLIC **false**, `anon` **true**, `authenticated` **true** — exactly the reviewed
grants. No new privilege on `geo.*`: `anon`/`authenticated` SELECT on `geo.n5_geom` **false**,
`anon` SELECT on `geo.n5_point_reject` **false** and on `geo.n5_verdict_manifest` **false**,
`anon` USAGE on schema `geo` **false**. RLS **unchanged and unaltered** — `n5_geom`,
`n5_point_reject`, `n5_verdict_manifest` each `rls=true, force=false, policies=0`, which is the
state the SECURITY DEFINER model depends on and which makes the `postgres` ownership above
load-bearing rather than cosmetic.

### Two defects, both in the instrument, neither in production

1. **The run went red on DEFINITION IDENTITY against a byte-identical install.** The expected
   `prosrc` md5 was computed by anchoring on `as $fn$\n … \n$fn$;`, which strips the leading and
   trailing newline Postgres stores inside the dollar quotes — 6,567 characters compared against
   production's 6,569. It could never have matched. Verified afterwards: md5 of the file's true
   dollar-quoted content is `e1bb67c604aaaa4e1ab541ee32bc82ea`, exactly what production holds.
2. **`provenance_returned` searched `prosrc` for a `RETURNS TABLE` element.** The result type is
   not part of the body, so that check could only ever report false. Replaced by three checks
   that read the right places: `pg_get_function_result` for the result type, and the body for the
   select-list and output carry-through — all three **true**.

Both are fixed in `.github/workflows/n5-rpc-apply.yml`. **The RPC was NOT re-applied to correct
them** — a second application is not authorized and was not needed: the remaining verification
(definition identity, tokens, grants, RLS, hard controls, observational delta) was completed by
**read-only catalog queries** against the already-installed function.

**Arming:** the apply workflow is now **DISARMED**, so no ordinary commit can re-run it. The
precheck's own `n5_projects_within_radius` absence requirement is a second, independent guard —
it would now refuse rather than replace.

⚠️ **INSTALLATION IS NOT A LIVE PROOF.** The function has never been called. The next unit is a
single read-only invocation at one known point, 0.5 mi, small `p_limit`.

---

## 15. First live radius proof — **BLOCKED BEFORE THE RPC CALL**, 2026-09-03 22:19:43Z

**Outcome: C — BLOCKED BEFORE RPC CALL.** `public.n5_projects_within_radius` was **not invoked**.
Invocation count for this unit: **0**.

### Positive control selected (read-only, deterministic — first by `source_key collate "C"`)

| field | value |
|---|---|
| `source_key` | `arcgis:adams-county-building-permits:BDP25-2820` |
| `feature_id` | `pt:1` |
| `registry_id` | `adams-county-building-permits` |
| `provenance` | `proven_stored_point` |
| geometry type | `ST_Point` (SRID 4269) |
| latitude | `39.8448270000018` |
| longitude | `-104.992321500002` |
| `verdict_snapshot_id` | `phase1-2026-09-01` |

Intended as a **POINT/COORDINATE TEST** — the geometry's own stored coordinate, no geocoding and
no reverse-geocoding. It was never passed to the RPC.

### Pre-call hard controls — the RPC object passed, the corpus did not

| control | required | observed 22:19:43Z | verdict |
|---|---|---|---|
| RPC overloads | 1 | **1** | ✅ |
| owner | postgres | **postgres** | ✅ |
| SECURITY DEFINER | true | **true** | ✅ |
| volatility | STABLE | **s** | ✅ |
| search_path | public | **search_path=public** | ✅ |
| manifest state | READY | **READY** | ✅ |
| `canonical_synced_at` | not null | **2026-09-03 20:49:04.959655+00** | ✅ |
| `proven_stored_point` | 718,278 | **718,278** | ✅ |
| canonical PROVEN fingerprint | `bbda250f…` | **`bbda250fc30ee0b3aa3f46a259392aa3`** | ✅ |
| rejects | 5,171 | **5,171** | ✅ |
| **`geo.n5_geom` total** | **741,562** | **741,715 (+153)** | ⛔ |
| **`recovered_authoritative`** | **23,284** | **23,437 (+153)** | ⛔ |

§2 is explicit — *"If ANY hard control differs: STOP WITHOUT INVOKING THE RPC."* Two differ, so
the call was not made.

### What moved, and why it is not corruption

| observational | 21:33:05Z | 22:19:43Z | delta |
|---|---:|---:|---:|
| `geo.n5_association` | 22,698 | **22,835** | +137 |
| shards `done` | 41 | **81** | +40 |
| shards `pending` | 503 | **463** | −40 |
| shards `running` | 0 | **0** | 0 |

Attribution, measured rather than assumed:

- **153 `recovered_authoritative` rows** were written between **21:50:53.636437Z** and
  **22:08:19.006257Z**; the last shard finished **22:08:30.850042Z**, immediately after.
- **0 `proven_stored_point` rows** were written in that window, and the PROVEN fingerprint is
  byte-identical — the control proving the canonical PROVEN corpus was not disturbed.
- The new rows span **33 distinct z3 shards** and are all `ST_MultiLineString` / `ST_MultiPolygon`
  — publisher geometry, exactly what `n5_shard.py::recover_shard` fetches on the RECOVERY path.
- All recovered rows carry `verdict_snapshot_id` NULL, by design.

So this is the shard campaign doing precisely its job. It is legitimate independent work — and it
is still a hard-control divergence I may not reinterpret on my own.

### ⚠️ Why this is NOT the same as the association ruling

The association gate was retired because the RPC neither reads nor writes `geo.n5_association`.
**That reasoning does not transfer here: `geo.n5_geom` is the RPC's actual read target**, and it
is growing while the campaign runs. Three consequences worth stating before any ruling:

1. **Newly recovered geometry is immediately visible to the RPC.** The predicate is
   snapshot-isolated for PROVEN rows (`verdict_snapshot_id = v_snapshot`) but recovered rows pass
   on `provenance = 'recovered_authoritative'` alone — correct under the founder's semantic
   ("any canonical physically located project geometry near this home"), but it means the
   eligible corpus is not frozen.
2. **The RPC's result set is therefore not stable between calls while the campaign runs.** A
   result is true at the instant of the call.
3. **`has_more = false` means "complete at that instant"**, not "complete thereafter". That is
   worth pinning down before the value is ever shown to a resident.

None of this makes a single read-only proof invalid — it makes the *wording* of what the proof
establishes matter.

### Ruling needed (I did not choose)

- **(a) Re-baseline, freezing only what is genuinely frozen.** Keep `proven_stored_point`
  = 718,278, the PROVEN fingerprint, rejects, manifest state and `canonical_synced_at` as HARD —
  those are snapshot-isolated and demonstrably stable — and make `geo.n5_geom` total and
  `recovered_authoritative` **observational** while the campaign runs, exactly as association is.
  A single point-in-time proof is then meaningful and repeatable.
- **(b) Wait for the campaign to drain** (463 shards pending) and use the stable totals.

The installed RPC is unaffected either way: owner, security, volatility, search_path and its
byte-identical body (`prosrc` md5 `e1bb67c604aaaa4e1ab541ee32bc82ea`) all re-verified above.

**Holds observed:** the RPC was not invoked, not modified, not re-applied. No second point, no
second radius, no geocoding. No shard run, paused, resumed or altered; no 760; no index; no
`app_projects`/A3/RLS/Map 1 change; no canonical geometry, reject or association write by me;
PR #1015 still DRAFT.

---

## 16. FIRST LIVE RADIUS PROOF — **PASSED**, 2026-09-03 22:51:48Z → 22:52:44Z

**Outcome: A — FIRST LIVE RADIUS PROOF PASSED.** `public.n5_projects_within_radius` was invoked
**exactly once** against the live production corpus and returned a truthful, bounded, correctly
ordered result.

### ⚖️ Founder ruling applied — RECOVERY is live, PROVEN is pinned

The fixed equalities `geo.n5_geom total = 741,562` and `recovered_authoritative = 23,284` are
**RETIRED** for this proof and are **not** replaced by any newer constant. RECOVERY geometry is
authoritative publisher geometry added by the national shard campaign and legitimately grows
while that campaign runs; PROVEN is snapshot-scoped and stays pinned to the synchronized verdict
snapshot. So those two populations are **observational** here, while PROVEN count, PROVEN
fingerprint, rejects, manifest state, `canonical_synced_at` and snapshot/reject leakage remain
**HARD**.

**Product semantic this establishes, and which must survive into any Map 1 wording:** a radius
result is *the canonical physically located project geometry available at the time of the query*.
Therefore **`has_more = false` means "this was the complete eligible radius result at this query
transaction" — NOT "no further canonical geometry can ever be added".**

### Test identity

**POINT/COORDINATE TEST.** The query coordinate is a stored canonical geometry's own point.
**No geocoding and no reverse-geocoding was performed, and this does not prove street-address
geocoding.**

| | |
|---|---|
| positive control | `arcgis:adams-county-building-permits:BDP25-2820` · `pt:1` · `adams-county-building-permits` |
| provenance / geometry | `proven_stored_point` · `ST_Point` · SRID 4269 · snapshot `phase1-2026-09-01` |
| test latitude | `39.8448270000018` |
| test longitude | `-104.992321500002` |
| call | `public.n5_projects_within_radius(39.8448270000018, -104.992321500002, 0.5, 5)` |
| invocation count | **1** — no retry, no second point, radius or limit |
| elapsed | **not separately instrumented** (see defects) |
| rows returned | **5** (= `p_limit`) |

### Returned rows — in the function's own emission order

| # | source_key | feature_id | registry_id | provenance | distance_mi | geometry_type | has_more |
|---|---|---|---|---|---:|---|---|
| 1 | `arcgis:adams-county-building-permits:BDP25-2820` | `pt:1` | adams-county-building-permits | `proven_stored_point` | **0.000000000000** | ST_Point | true |
| 2 | `arcgis:adams-county-building-permits:BDP26-0844` | `pt:1` | adams-county-building-permits | `proven_stored_point` | 0.030504138270 | ST_Point | true |
| 3 | `arcgis:adams-county-building-permits:BDP26-0113` | `pt:1` | adams-county-building-permits | `proven_stored_point` | 0.087110433866 | ST_Point | true |
| 4 | `arcgis:adams-county-building-permits:BDP26-0651` | `pt:1` | adams-county-building-permits | `proven_stored_point` | 0.095105952282 | ST_Point | true |
| 5 | `arcgis:adams-county-building-permits:BDP26-1660` | `pt:1` | adams-county-building-permits | `proven_stored_point` | 0.101699266347 | ST_Point | true |

Order was captured with `row_number() over ()` — an **empty** window, which preserves the
function's own emission order rather than re-sorting it, so the ordering below is the function's
and not the test's.

**Provenance counts (never collapsed): `proven_stored_point` = 5 · `recovered_authoritative` = 0.**
A stored point is the snapshot's asserted coordinate; it is **not** recovered publisher geometry.

### Assertions

- Every row: `source_key`, `feature_id`, `registry_id`, `provenance`, `distance_mi`,
  `geometry_type`, `has_more` all non-null ✅
- `provenance` ∈ {`proven_stored_point`, `recovered_authoritative`} on all 5 ✅
- Distance bounds: min **0.000000000000**, max **0.101699266347**, all `>= 0` and `<= 0.5` ✅
- Ordering: strictly increasing, hence monotonically non-decreasing ✅
- **Tie ordering: NOT EXERCISED.** All five distances are distinct, so the deterministic
  `(distance_mi, source_key, feature_id)` tie-break never arbitrated anything. Reported as
  not-exercised rather than as a pass — an untriggered branch is not evidence.
- Positive control: **present at emission order 1 with distance exactly `0.000000000000`** ✅ —
  the geography round trip from the stored 4269 point through 4326 and back returns the point to
  itself with no measurable error.
- `has_more`: **true**, identical on all 5 rows ✅ — taken from the explicit returned value, not
  inferred from the row count. **Interpretation: additional eligible canonical geometries existed
  beyond `p_limit = 5` within 0.5 miles at this query transaction.** They were not enumerated; no
  second call was made.

### HARD controls — snapshot-pinned PROVEN, unchanged across the call

| control | before 22:51:48.620918Z | after 22:52:44.128733Z |
|---|---|---|
| `proven_stored_point` | 718,278 | **718,278** |
| PROVEN fingerprint | `bbda250fc30ee0b3aa3f46a259392aa3` | **`bbda250fc30ee0b3aa3f46a259392aa3`** |
| rejects | 5,171 | **5,171** |
| manifest state | READY | **READY** |
| `canonical_synced_at` | 2026-09-03 20:49:04.959655+00 | **2026-09-03 20:49:04.959655+00** |
| PROVEN rows on a wrong snapshot | 0 | **0** |
| rejected identities with RPC-visible PROVEN geometry | 0 | **0** |

RPC object at call time: 1 overload · owner `postgres` · SECURITY DEFINER · STABLE ·
`search_path=public` · positive control present with the expected snapshot attribution.

### OBSERVATIONAL — live RECOVERY corpus

| observational | before | after | delta |
|---|---:|---:|---:|
| `geo.n5_geom` total | 742,398 | 742,398 | **0** |
| `recovered_authoritative` | 24,120 | 24,120 | **0** |
| `geo.n5_association` | 23,324 | 23,324 | **0** |
| shards done / pending / running | 121 / 423 / 0 | 121 / 423 / 0 | **0** |

The campaign happened to be quiet across this ~56-second window, so nothing had to be attributed.
Had it moved, the movement would have belonged to the campaign, not to this `STABLE` read.

### Unexpected defects

**One, in the harness, not the RPC: elapsed time was not instrumented.** Server-side timing would
have required either wrapping the call in a timing CTE — whose evaluation order Postgres does not
guarantee, so it could have misreported — or a second timed execution, which is exactly what the
authorization forbids. Preserving the single-invocation guarantee was worth more than a duration
figure, so none is claimed rather than one being estimated. No defect was found in the RPC: every
semantic assertion passed and every hard control held.

⚠️ **What this proof does and does not establish.** It establishes that the installed RPC reads
the synchronized canonical corpus, returns provenance-labelled rows at the
`(source_key, feature_id)` grain, bounds distances to the requested radius, orders nearest-first,
and reports truncation explicitly. It does **not** establish street-address geocoding — no address
was involved at any point.

---

## 17. Address → coordinate proof — **BLOCKED BEFORE THE ADDRESS LOOKUP**, 2026-09-03 22:57:54Z

**Outcome: C — BLOCKED BEFORE ADDRESS LOOKUP.** The geocode endpoint was **not invoked**
(invocation count **0**), and `public.n5_projects_within_radius` was **not invoked** (count **0**).
The block is the sandbox's egress policy, not a defect in the geocoding path.

### The existing production path — identified from source, not assumed

The repo contains **two** address-touching production surfaces, and they are different products:

| | `geocode-address` | `get-address-report` |
|---|---|---|
| repo path | `supabase/functions/geocode-address/index.ts` (41 lines) | `supabase/functions/get-address-report/index.ts` |
| called by | **`shell.js:493` and `shell.js:968`** — the site's add-your-home address flow | `homesignalmap.html:484` — the development-tracker report engine |
| job | street address → coordinate, nothing else | full multi-source property/ZIP report |
| provider | **U.S. Census one-line geocoder**, `benchmark=Public_AR_Current`, `/geocoder/locations/onelineaddress` | Census direct at `index.ts:202`, plus a cached ladder for *source records* |
| request | `POST {address}` | `POST {address, radius_mi}` or `{zip,…}` |
| response | `{match:{matchedAddress,lat,lng,zip,city,state}}`, or `{match:null}`, or 502 `{error:'geocoder_unavailable'}` | full report document |
| **persistent writes** | **NONE** — the file imports no Supabase client, opens no DB connection, and touches no table or cache | `property_reports` upsert (`index.ts:538`) and the write-through `geocodes` cache ladder, both in the **ZIP-mode** branch |

**`geocode-address` was selected** because this unit's objective is exactly *street address →
coordinate* and that function is the only production surface whose sole job is that, and is
**provably free of persistent application-data writes** — it is a stateless Census proxy. It is a
real production path, not a test harness: the shipped `shell.js` calls it for every visitor who
adds their home.

**`get-address-report` was deliberately NOT selected.** Its ZIP-mode branch performs a
`property_reports` upsert and write-through geocode-cache writes; qualifying its address mode as
write-free would have required auditing the whole engine, and calling it would have risked exactly
the read-only violation §1 says to stop for. Recorded as a decision, not an oversight.

Its honesty contract is worth preserving in any future Map 1 wording: it returns **only the first
confirmed match** reduced to fixed fields, never a raw passthrough and never a guessed point, and
distinguishes a geocoder **outage** (502) from a genuine **no-match** (`match:null`) so the two
never collapse into one message.

⚠️ **The contract exposes no match-quality field.** `{matchedAddress, lat, lng, zip, city, state}`
carries no `match_type`. The repo's own tiering classifies the Census rung as
`range_interpolated` (`geocode-cache.ts`, `censusRung`), but **that is repo knowledge, not
something this response would state**, and an approximate match must never be reported as exact.

### Selected address — documented, not invented

`2200 CALDWELL LN, DEL VALLE, TX 78617` — the repo's canonical positive control: CLAUDE.md §8
names the 78617/Caldwell case study "always the acceptance test for TX sources"; it appears as a
geocode fixture in `test/verify-geocodes.test.mjs` (with `matched_address` identical to the input)
and in `test/navigation-zip.test.mjs`. **Not** derived by reverse-geocoding the previous unit's
canonical point.

### What blocked it

One request was attempted to
`https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/geocode-address` at
**22:57:54.030018090Z**. It never left the sandbox:

```
curl: (56) CONNECT tunnel failed, response 403
HTTP_STATUS=000   TIME_TOTAL=0.221615s
```

The agent proxy's own status endpoint records the cause verbatim:

```
{ "ts": "2026-09-03T22:57:54.259Z", "kind": "connect_rejected",
  "detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
  "host": "qwnnmljucajnexpxdgxr.supabase.co:443" }
```

`/root/.ccr/README.md` is explicit for this failure class: *"The destination host is not allowed
by your organization's egress policy for this session. Do not retry or route around it — report
the blocked host."* So it was not retried and not routed around.

**The TCP tunnel was refused, so no HTTP request reached Supabase.** The edge function did not
run, the Census geocoder was never contacted, and no coordinate was produced. Nothing was
invoked twice, and no second address, spelling or geocoder was tried.

⚠️ **Why the database still works while this does not.** The Supabase MCP transport reaches the
project through `mcp-proxy.anthropic.com`, which is on the proxy's `noProxy` allow-list; direct
HTTPS to `*.supabase.co` is not. So catalog and SQL evidence in §§13–16 remains fully valid — the
blocked surface is specifically the **edge-function HTTP endpoint**.

### Assertions not reached

Latitude/longitude, matched address, match quality, cache status and the N5 input-domain
assertion are all **unevaluated** — there is no response to assert against. None is claimed.

### Side effects

- **N5 data mutation: NONE.** Nothing in this unit wrote to `geo.*`; the only production contact
  was read-only catalog/SQL and one refused TCP tunnel.
- **Persistent application-data writes: NONE.** The selected endpoint has no write path at all,
  and it never executed.
- **Map 1: unmodified.** No file under the map surfaces was touched.
- Ordinary platform request logging is the sandbox proxy's own failure record quoted above.

### The founder's call to unblock

1. **Allow `qwnnmljucajnexpxdgxr.supabase.co` for this session's egress policy**, then re-run this
   unit unchanged — one address, one call, against a write-free endpoint. Cleanest, and it keeps
   the proof on the real browser→edge-function path the product uses.
2. **Invoke the endpoint from Postgres via `pg_net`** (`net.http_post`), the pattern CLAUDE.md
   already documents for "sandbox has no egress; Postgres does". ⚠️ **This is not equivalent**: it
   writes rows into `net.http_request_queue` / `net._http_response`, so it is no longer a
   zero-write unit, and it exercises a different transport than the one the product uses. Offered
   for completeness; **not** taken on my own judgement.

Option 1 preserves the boundary this unit was written around. Option 2 trades it away.

---

## 18. ADDRESS → COORDINATE PROOF — **PASSED**, 2026-09-03 23:13:26Z

**Outcome: A — ADDRESS → COORDINATE PROOF PASSED.** The production `geocode-address` Edge
Function was invoked **exactly once** and returned a real, valid coordinate for the documented
positive-control address. `public.n5_projects_within_radius` was invoked **zero** times.

### This supersedes the §17 block — and the two are different things

**§17 was an ENVIRONMENT/TRANSPORT block, not a geocoder failure**, and that distinction is now
proven rather than asserted. In §17 the Claude Code sandbox's agent proxy answered **403 to
CONNECT** for `qwnnmljucajnexpxdgxr.supabase.co:443`, so no HTTP request ever reached Supabase and
the function never ran. Run from a surface with ordinary egress, **the very same endpoint, address
and request shape returned HTTP 200 and a correct coordinate on the first attempt.** Nothing in
the application was changed to achieve that: no `pg_net`, no alternate transport, no edit to
`geocode-address`, `get-address-report`, Supabase or Map 1.

### Execution surface — existing authorized pattern, not new infrastructure

GitHub Actions, `ubuntu-latest`, `.github/workflows/n5-geocode-probe.yml`, run
**`33816635075`**, job `100850116977`, head `17379b4`. Authorization evidence from the repo:

- **CLAUDE.md §5:** "the build sandbox can't reach Supabase/homesignal.net (egress blocked), so
  `.github/workflows/verify-communities.yml` + `scripts/verify-communities.mjs` do the live check
  on a GitHub runner."
- **`verify-development.yml`:** "Runs where network egress works (GitHub-hosted runner), the piece
  the build sandbox cannot do" — and `scripts/verify-development.mjs:38` already issues live HTTPS
  to `.../functions/v1/get-address-report`, the committed precedent for calling a production
  **Edge Function** from CI.
- That script reads endpoint + public anon key out of the **shipped page** "so nothing is forked";
  this probe does the same from `config.js`. **No secrets are used** — the anon key is public by
  design — and `permissions: contents: read` means the job cannot write to the repo.
- Arming-token convention, as in `.github/epa-recovery-armed` and every N5 unit in this series.

**`verify-edge-function.yml` was deliberately NOT used**: it states it "NEVER calls the live
database, the Census geocoder, the Supabase project, or the deployed Edge Function". Using it
would have contradicted its own contract.

### Bounds — asserted mechanically before arming

The workflow contains **exactly one** outbound request construct: a single `curl --retry 0` to
`functions/v1/geocode-address`. It does not call `get-address-report`, does not call Census
directly, does not touch the database, and does not invoke the radius RPC. Two other token hits
were **checked rather than assumed**: `census.gov` appears only inside a Python string literal
used to inspect the function's *source*, and `n5_geom` only inside a comment stating it is not
queried.

A **zero-application-write gate** re-proved on the runner, immediately before the request, that
`geocode-address` still has no `supabase-js` client, no project key, no DB or table access, no
persistent geocode cache, no insert/upsert/update/delete, no local persistence, and exactly one
outbound `fetch` — to the U.S. Census one-line geocoder at `benchmark=Public_AR_Current`. All nine
checks passed; had any failed, the request would never have been made.

### The one request, and what production returned

| | |
|---|---|
| endpoint | `https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/geocode-address` |
| input address | `2200 CALDWELL LN, DEL VALLE, TX 78617` |
| invocations | **1** — no retry, no second address, no alternate spelling |
| HTTP status | **200** |
| matched address | **`2200 CALDWELL LN, DEL VALLE, TX, 78617`** |
| **latitude** | **`30.215054966235`** |
| **longitude** | **`-97.53885104845`** |
| zip / city / state | `78617` / `DEL VALLE` / `TX` |
| fields returned | `city, lat, lng, matchedAddress, state, zip` |
| **match-quality fields actually returned** | **NONE** |

⚠️ **No match-quality classification is claimed.** The response carries no `match_type`,
`quality`, `precision`, `accuracy` or `confidence` field — the probe enumerated the returned keys
and reported `NONE`. The result is therefore **not** described as exact, rooftop, parcel or
range_interpolated. (The repo's own ladder classifies the Census rung as `range_interpolated` in
`geocode-cache.ts`, but that is repo knowledge about the provider, not something this response
supplied, and it is not asserted here.)

### Coordinate assertions — all passed

latitude not null ✅ · longitude not null ✅ · latitude finite ✅ · longitude finite ✅ ·
`-90 <= 30.215054966235 <= 90` ✅ · `-180 <= -97.53885104845 <= 180` ✅

**N5 input-domain compatibility (offline, type/range only):** both values are `double precision`
and fall inside the ranges `n5_projects_within_radius` validates for `p_lat` and `p_lng` ✅.
**The RPC was not invoked, `geo.n5_geom` was not queried around the coordinate, and no radius
search was reproduced.** This says the coordinate is *admissible input* — it says nothing yet
about whether any project is near that address.

### Side effects

- **Application-data writes: NONE.** The endpoint has no write path (re-proved on the runner) and
  the probe holds no service-role key.
- **N5 data mutation: NONE.** No `geo.*` contact of any kind in this unit.
- **Map 1: unmodified.**
- Ordinary GitHub Actions run logs are not application-data writes.

### Probe disarmed

`.github/n5-geocode-probe-arm` now reads `DISARMED-2026-09-03-after-geocode-probe`. Verified
mechanically across the branch: **no arm token equals its workflow's `EXPECTED_ARM`** — every N5
probe (`n5-geocode-probe-arm`, `n5-rpc-apply-arm`) is disarmed, so no accidentally armed
production probe is left behind. The workflow file is retained, disarmed, as the documented record
of how the proof was run — the same convention as `epa-recovery-watch.yml`.

---

## 19. FIRST END-TO-END STREET-ADDRESS RADIUS PROOF — **PASSED**, 2026-09-03 23:19:44Z

**Outcome: A — END-TO-END STREET-ADDRESS RADIUS PROOF PASSED.** The complete production path
executed for the first time:

> **one real street address → production `geocode-address` → the lat/lng it returned →
> production `public.n5_projects_within_radius` → a bounded canonical nearby-project result**

**Test type:** STREET ADDRESS → PRODUCTION GEOCODER → N5 RADIUS
**Execution surface:** GitHub Actions `ubuntu-latest`, `.github/workflows/n5-e2e-address-radius.yml`,
run **33817080874**, job `100851488526`, head **`e99d812`**. Chosen because it is the only existing
authorized pattern that reaches **both** halves in one execution context — §18 proved the HTTPS
half here, §§13–16 proved the PG-wire half here. No new architecture, no `pg_net`, no direct Census
call.
**Input address:** `2200 CALDWELL LN, DEL VALLE, TX 78617`

### Geocoder — invocation 1 of 2

| | |
|---|---|
| invocations | **1** (no retry, no second spelling, no second address) |
| HTTP status | **200** |
| matched address | `2200 CALDWELL LN, DEL VALLE, TX, 78617` |
| **latitude** | **`30.215054966235`** |
| **longitude** | **`-97.53885104845`** |
| other metadata | `zip 78617`, `city DEL VALLE`, `state TX` |
| match-quality fields returned | **NONE** — no classification claimed |

### Chain of custody — the central assertion, enforced byte-wise

The raw lat/lng **text** was lifted straight out of the HTTP response body by regex and
substituted verbatim into the SQL — never parsed to a float and re-printed, never rounded, never
transformed, never looked up in `geo.n5_geom`, and never replaced by the §18 value. The exact
statement sent, printed by the run:

```
  from public.n5_projects_within_radius(30.215054966235, -97.53885104845, 0.5, 5) r;
```

A `grep -F` gate then required that literal to contain the raw geocoder text, and would have
failed the job otherwise:

> `CHAIN OF CUSTODY: SQL argument is byte-identical to the geocoder's raw lat/lng text`

**geocoder lat `30.215054966235` = RPC `p_lat` `30.215054966235` ✅ ·
geocoder lng `-97.53885104845` = RPC `p_lng` `-97.53885104845` ✅**

⚠️ **These happen to equal the §18 control exactly — which is corroboration, not the source.**
The values used were produced by **this run's** geocoder call and carried forward mechanically;
the §18 numbers rode along only as `CONTROL_LAT`/`CONTROL_LNG` and were never substituted. A
separate assertion also proved the raw text round-trips to the parsed value, so "raw" could not
silently be something else.

### Radius RPC — invocation 2 of 2

Radius **0.5 mi**, `p_limit` **5**, invoked at `23:19:44.194920647Z`, returned
`23:19:44.900012205Z` (**~0.71 s**). **2 rows**, in the function's own emission order
(`row_number() over ()`, empty window — never re-sorted):

| # | source_key | feature_id | registry_id | provenance | distance_mi | geometry_type | has_more |
|---|---|---|---|---|---:|---|---|
| 1 | `socrata:data.austintexas.gov:mavg-96ck:SP-2021-0320D` | `pt:1` | `austin-site-plan-cases` | `proven_stored_point` | **0.021017590124** | ST_Point | f |
| 2 | `socrata:data.austintexas.gov:mavg-96ck:SP-2020-0236D` | `pt:1` | `austin-site-plan-cases` | `proven_stored_point` | **0.278213114517** | ST_Point | f |

**`proven_stored_point` = 2 · `recovered_authoritative` = 0** — classes reported separately and
never collapsed. A stored point is the snapshot's asserted coordinate, **not** recovered publisher
geometry.

**Distance bounds:** 0.021017590124 .. 0.278213114517, all `>= 0` and `<= 0.5` ✅
**Emission ordering:** non-decreasing ✅ **Tie ordering:** **NOT EXERCISED** — both distances
distinct, so the tie-break never arbitrated; reported as not-exercised, not as a pass.
**`has_more` = `f`**, identical on both rows, read from the explicit column.
**Interpretation:** *this was the complete eligible canonical radius result at this query
transaction* — **not** "no further canonical geometry can ever exist there". The RECOVERY corpus
is live (§16 ruling), so the result is point-in-time.

Zero rows would have been a legitimate outcome for a real street address, and the workflow was
built to exit 0 and say so honestly. It did not arise: two real Austin site-plan cases sit within
0.5 miles of the address.

### HARD controls — verified before AND after both calls

`rpc 1 overload / postgres / SECURITY DEFINER / STABLE / search_path=public` · manifest **READY** ·
`canonical_synced_at` **2026-09-03 20:49:04.959655+00 → identical** · PROVEN **718,278** ·
fingerprint **`bbda250fc30ee0b3aa3f46a259392aa3`** · rejects **5,171** · wrong-snapshot PROVEN
**0** · rejected identities with RPC-visible PROVEN geometry **0**. The same fail-closed block ran
pre and post; both passed.

### OBSERVATIONAL — live RECOVERY corpus

| | before 23:19:39.892434Z | after 23:19:48.330792Z | delta |
|---|---:|---:|---:|
| geometry total | 742,722 | 742,722 | **0** |
| recovered_authoritative | 24,444 | 24,444 | **0** |
| association | 23,711 | 23,711 | **0** |
| shards done / pending / running | 141 / 402 / **1** | 141 / 402 / **1** | 0 |

A shard was **running** throughout and the campaign was neither paused nor altered; it simply did
not complete a unit inside the ~9-second window, so nothing needed attributing.

### Side effects

`geocode-address` application-data writes **none** (a nine-check source gate re-proved it
write-free on the runner immediately before the request) · N5 RPC data writes **none** (the
function is `STABLE`; every hard control identical) · Map 1 modifications **none**. Ordinary CI
logs are not application-data mutation.

### Probe disarmed

`.github/n5-e2e-arm` now reads `DISARMED-2026-09-03-after-e2e-proof`. Verified mechanically across
the branch: **no arm token equals its workflow's `EXPECTED_ARM`** — `n5-e2e-arm`,
`n5-geocode-probe-arm` and `n5-rpc-apply-arm` are all disarmed, so no accidentally armed production
probe remains. The workflow files are retained disarmed, per the `epa-recovery-watch.yml`
convention.

⚠️ **Scope.** This proves the *machinery* end to end for one address at one radius. It does not
establish source completeness for that address, that neighbourhood, or anywhere else, and it is
not a Map 1 implementation.

---

## 20. Map 1 address-radius implementation — **BLOCKED: the RPC returns no coordinate**

**Outcome: C — BLOCKED ON ANOTHER SPECIFIC EXISTING CONTRACT.** No Map 1 file was edited. The
blocker is *not* dossier hydration (that works) — it is that a radius result **cannot be placed on
the map**, because the installed RPC returns no position and no authorized surface can supply one.

### What the read-only trace actually found (the brief's premise needs correcting)

⚠️ **Map 1 ALREADY HAS A WORKING ADDRESS MODE.** The implementation plan assumed items A–D had to
be built. They exist today in `homesignalmap.html`:

| brief item | status in current Map 1 | evidence |
|---|---|---|
| A address-mode state | **exists** — `ZIP_MODE=false` *is* address mode; `CUR_ADDRESS`, `CUR_RADIUS`, `LAST_ADDR`, `HOME_ANCHOR` | `homesignalmap.html:519, 962-966` |
| B geocode + retrieval | **exists**, but via `get-address-report` `{address, radius_mi}` | `:484, :970-973` |
| C HOME marker | **exists** — `GL.home`, dropped only on a real address search | `:962`, `updateHome3D()` |
| D radius selector + ring | **exists** — `circlePoly(GL.home.lat, GL.home.lng, CUR_RADIUS, 96)`, suppressed in ZIP mode | `:1790`, `:1902-1903` |
| H ZIP mode preserved | **exists** — separate `loadZip()` path reading `development_reports` | `:1008, :1077` |

So the real unit is narrower than stated: **swap address-mode's DEVELOPMENT retrieval to the proven
N5 chain (Rule 2) and keep everything else.** Items A, C, D, H need no work.

### Rule 7 — dossier hydration RESOLVES. This is not the blocker.

`public.app_projects` is anon-readable through an **existing** RLS policy —
`app_projects_read [SELECT] roles={anon,authenticated}` — and Map 1 already has a generic anon
PostgREST helper (`sbFetch`, `:2371`). Hydrating `source_key` needs **no new backend, no grant
change, no RLS change**. Verified against the two identities §19's live proof returned:

| source_key | name | source_ref (record_url) | type | status / stage | impact_score |
|---|---|---|---|---|---|
| `…mavg-96ck:SP-2021-0320D` | **Caldwell Lane** | real per-record `abc.austintexas.gov` permit URL | Industrial | Approved / Approved and Released | 55 |
| `…mavg-96ck:SP-2020-0236D` | **Riverside Resort** | real per-record `abc.austintexas.gov` permit URL | unclassified | Proposed / Waiting on Legal | 72 |

Both `record_kind='development'`, both carrying the `label` + `record_url` that Map 1's
anti-fabrication gate `sourced()` (`:667`) requires. *(Noted, not blocking: `impact_dimensions` is
NULL on both, so QoL dimensions would render in their existing honest-absent state; `impact_score`
is present.)*

### THE BLOCKER — no position, and no authorized way to get one

`public.n5_projects_within_radius` returns
`(source_key, feature_id, registry_id, provenance, distance_mi, geometry_type, has_more)`.
**There is no latitude, no longitude, no geometry.** Map 1 places every marker from `s.lat`/`s.lng`.

No existing surface can close that gap, measured 2026-09-03:

- anon-executable functions whose body touches `geo.n5_geom`: **exactly one —
  `public.n5_projects_within_radius`** (the one with no coordinate)
- public views over `geo.n5_geom`: **0**
- `anon` SELECT on `geo.n5_geom`: **false** · `anon` USAGE on schema `geo`: **false**

Rule 15 forbids granting direct `geo.*` access, and the HOLDS forbid expanding the RPC
speculatively. So the position must come from the RPC, and today it does not.

### Why `app_projects.lat/lng` is NOT a safe substitute

It is *tempting* because for the two proven rows it agrees almost exactly (computed locally):

| identity | provenance | RPC distance_mi | distance to app_projects point | delta |
|---|---|---:|---:|---:|
| SP-2021-0320D | `proven_stored_point` | 0.021017590 | 0.020982797 | 0.0000348 |
| SP-2020-0236D | `proven_stored_point` | 0.278213115 | 0.278335783 | 0.0001227 |

That agreement is **an artefact of provenance, not a general property**. For
`proven_stored_point` the canonical geometry *is* the stored coordinate, so the two coincide. For
`recovered_authoritative` — **9,083 MultiPolygon + 8,177 MultiLineString rows in the corpus** — the
RPC measures to the **true edge** while `app_projects` holds **one representative point**;
CLAUDE.md is explicit that "no view over a representative point can answer distance-to-polygon at
any effort." Plotting the representative point beside an authoritative edge-distance would put a
marker somewhere the stated distance does not describe. §19's proof returned only
`proven_stored_point` rows, so it **did not exercise the hazardous case** — using it as licence
would be generalising from the one shape that happens to work.

### Smallest contract required (NOT implemented — needs authorization)

Add two nullable columns to the RPC's `RETURNS TABLE` — a display position derived from the row's
**own** geometry, inside the function that already reads it:

```
display_lat  double precision,
display_lng  double precision
```

sourced from `ST_Y/ST_X` for point geometry and `ST_PointOnSurface`/`ST_LineInterpolatePoint` for
polygon/line rows — the same derivation `featurePoint()` already performs elsewhere in this repo —
**with `distance_mi` remaining the authoritative radius value**, and the UI labelling a non-point
row's marker as an indicative location on real geometry rather than a precise site. That keeps
Rule 5 ("do not convert polygons/lines to representative points for distance claims") intact,
because the derived point would be used for *placement only*, never for distance.

It is a change to the reviewed, installed RPC, so it is the founder's call, and it would need its
own review + reinstall gate. **I did not implement it, and I did not ship a list-only Map 1 view**
— Rule 7 forbids shipping a degraded parallel project experience, and a radius result with no
marker on the primary map is exactly that.

### Nothing was changed

No Map 1 edit, no RPC change, no new backend, no grant/RLS change, no production call in this unit
beyond read-only catalog and `app_projects` inspection. Map 2 untouched. PR #1015/#1016 DRAFT.

---

## 21. MARKER-POSITION CONTRACT REVISION (revision 3) — **ARTIFACT + TESTS ONLY**, 2026-09-04

Founder unit: revise the RPC artifact so a returned row carries a drawable coordinate. **Nothing
was installed and nothing was executed against production in this unit** — the production RPC is
still revision 2 (`prosrc` md5 `e1bb67c604aaaa4e1ab541ee32bc82ea`, 7 columns, no marker). Map 1
was not touched.

Note on §20's proposal: it named the columns `display_lat`/`display_lng` and suggested
`ST_LineInterpolatePoint` for lines. The founder named the columns **`marker_lat`/`marker_lng`**,
and the line rule changed on measurement (below). §20's text stands as the dated record of what was
proposed; this section is what was built.

### 21.1 Premises re-verified before any DDL was written (read-only)

| claim | result |
|---|---|
| production returns no coordinate today | `TABLE(source_key, feature_id, registry_id, provenance, distance_mi, geometry_type, has_more)` — no marker column |
| eligible geometry classes | POINT 724,301 · MULTILINESTRING 10,444 · MULTIPOLYGON 9,125 = **743,870** |
| no other class exists | 0 MultiPoint, 0 GeometryCollection, 0 singular LineString/Polygon |
| CRS | **every** eligible row SRID 4269; `spatial_ref_sys` carries 4269 and 4326 (EPSG) |
| empty geometry | 0 |
| invalid geometry | 4 (all MULTIPOLYGON, all "Ring Self-intersection", CTDOT work areas) |

The corpus is LIVE (founder ruling, option (a)), so these counts moved during the unit — lines read
10,435 then 10,444, points 718,278 then 724,301. Every figure is point-in-time and none is hard-coded
into the function.

### 21.2 The line rule was decided by measurement, and the obvious answer lost

Measured on 200 real MULTILINESTRINGs:

| candidate | `ST_Intersects(geom, marker)` | max `ST_Distance` | mean offset from the length midpoint |
|---|---|---|---|
| `ST_LineInterpolatePoint(part, 0.5)` | **0 / 200** | 7.1e-15° | 0 (it *is* the midpoint) |
| `ST_ClosestPoint(part, that midpoint)` | **0 / 200** | 3.6e-15° | ~0 |
| `ST_PointOnSurface(part)` | 200 / 200 | 0 | 95.5 m · >50 m: 104/200 · >500 m: 5/200 |
| **vertex nearest that midpoint** (shipped) | **200 / 200** | **0** | **47.8 m · >50 m: 50/200 · >500 m: 2/200** |

The interpolated point misses by ~1e-14 degrees — floating-point representability, not a placement
error — but the exact-arithmetic predicate correctly reports false, and snapping does not repair it.
Only an actual stored vertex satisfies membership exactly. Between the two candidates that do,
the explicit rule is measurably better centred, so it ships. **Disclosed cost:** on a long
sparse-vertex line the vertex can sit up to **2,215 m** from the midpoint (line parts average 7.2 km,
max 51.5 km). It is still a point *of* the feature; `distance_mi` remains the distance answer.

### 21.3 Corpus-wide verification of the shipped derivation (read-only)

Marker is a POINT, never NULL, never empty, `ST_Intersects` true and `ST_Distance` **exactly 0**:

* MULTILINESTRING **10,435 / 10,435** — whole eligible line corpus
* MULTIPOLYGON **9,125 / 9,125** — whole eligible polygon corpus, including all 4 invalid rows
* re-run with the exact shipped expression at the worst-case page size (`p_limit = 2000`):
  **2,000 / 2,000** lines and **2,000 / 2,000** polygons (again including all 4 invalid rows)

Also verified: `&&`, geography `ST_DWithin` and `ST_Distance` all succeed on the 4 invalid rows
(distance 0.0000 m from their own repaired interior point), so an invalid polygon cannot break the
query; and the 4269↔4326 round trip is **byte-identical** on 500 rows, so an emitted marker can be
compared back to stored geometry exactly.

### 21.4 What the contract now is

`RETURNS TABLE (source_key, feature_id, registry_id, provenance, distance_mi, geometry_type,
marker_lat, marker_lng, has_more)` — the founder's stated order, implementable as stated.

* derived from `g.geom` of the row being returned, joined on `(source_key, feature_id)`, **LEFT** so
  a row can lose its marker but can never be dropped by marker derivation;
* computed in CTEs that run **after** the spatial filter, the ordering and the page limit — so at
  most `p_limit` markers are ever derived and a marker cannot change which rows return or in what
  order;
* emitted in EPSG:4326, fail-closed on SRID 0 or an SRID absent from `spatial_ref_sys` (NULL, never
  an untransformed coordinate presented as WGS84);
* NULL for any geometry class the rule does not cover.

⛔ **Installing this requires `DROP FUNCTION` first** — adding columns changes the return type and
PostgreSQL cannot `create or replace` through that. The drop is in the file, and it revokes grants,
which the file's GRANTS section re-applies. That is an installation-unit concern; not done here.

### 21.5 Test results

| suite | where | result |
|---|---|---|
| `test/n5-spatial-read-rpc.test.mjs` (static) | sandbox | **123 / 123** |
| `test/n5_spatial_pg/run_suite.py` (executable) | disposable local **PostgreSQL 16.13 / PostGIS 3.4.2** (the `postgis:16-3.4` matrix leg), unix socket, no credentials, destroyed after | **107 / 107** |
| `node scripts/run-unit-tests.mjs` | sandbox | **141 / 141 files** |

New executable fixtures: a **concave "C" polygon whose centroid provably falls outside it**, an
**invalid bowtie** (the production invalidity class), and a **MULTIPOINT** (a class the rule does not
cover). New behavioural assertions include: every marker `ST_Intersects` its own row's geometry at
distance exactly 0; a POINT row's marker is byte-identical to the stored point; a LINE row's marker
is an actual vertex; the MULTIPOINT row is still returned with a NULL marker; `marker_lat` is a
latitude and `marker_lng` a longitude; and marker-to-home distance differs from `distance_mi` on an
area geometry — the two answer different questions.

Three mutation controls prove those assertions are load-bearing, each flipping the suite red and
then restored green:

1. swap `ST_X`/`ST_Y` → `marker_lat` stops being a latitude;
2. polygon rule → `ST_Centroid` → the concave fixture's marker leaves the polygon;
3. widen the marker join off `feature_id` → rows multiply (a project would hydrate its marker from a
   sibling feature — exactly the substitution the founder ruled out).

### 21.6 Nothing else was touched

No production install, no production RPC invocation, no Map 1 edit, no grant/RLS/ownership change,
no new backend surface. PR #1015 / #1016 remain DRAFT.
