# Passive-installation manifest — definitions only

**PARKED. Installation requires separate approval.** Every step below defines
objects or builds indexes. **No step executes reconciliation, seeds work, starts a
worker, or schedules anything.**

Baseline `dedb7db`. **Exact measurement times** for every live value quoted here:
production fingerprints and invariants read **2026-09-20 15:10:18 UTC**; the
concurrency/drift check against `origin/main` (`7d55275`) ran in the same session
immediately before it. Both must be **re-taken in the apply window** — they are a
precondition, not a record.

---

## 1. Steps, in order

| # | artifact | defines | executes |
|---|---|---|---|
| 1 | `docs/geo-work-handoff.sql` (executable half only) | `geo.n5_reconcile_queue`, `geo.n5_reconcile_queue_unclaimed_ix`, `geo.enqueue_work(text[],text)` | nothing |
| 2 | `docs/geo-proven-expected-geometry.sql` | `geo.proven_expected_geometry(text[])` | nothing (`stable`) |
| 3 | `docs/geo-reconciler-install.sql` | `geo.n5_reconcile_stage1(text[],text)`, `geo.n5_reconcile(text[],text)` | nothing — see §2 |
| 4 | `docs/geo-health-model.sql` | `geo.geography_progress`, `geo.geography_activation`, `geo.geography_health_observation`, `geo.geography_health_state(...)`, `geo.v_geography_registry_health`, `geo.geography_health_probe(int,boolean)` | nothing |
| 5 | index 1 — `n5_boundary_membership_sk_ix` | index | build only |
| 6 | index 2 — `zip_authoritative_membership_sk_ix` | index | build only |
| 7 | index 3 — `zip_authoritative_marker_sk_ix` | index | build only |
| 8 | `docs/geo-lifecycle-handoff-install.sql` | 4 splices into `public.app_refresh_zip(text)` | nothing at install; **capture starts** (§5) |
| 9 | `docs/geo-health-integration-install.sql` | 1 splice into `public.pipeline_health_tick()` | nothing |

Steps 8–9 are last deliberately: they are the only steps that change behaviour,
and each refuses unless its dependency from steps 1/4 is already present.

## 2. ⛔ `docs/geo-source-scoped-reconcile.sql` IS NOT IN THIS MANIFEST, AND MUST NOT BE

It was in the previous draft's order. That was wrong. Verified at `dedb7db`,
2026-09-20:

1. **It carries four bare, top-level resident-geography DML statements** —
   `delete from geo.zip_authoritative_membership` (line 86), `insert into` the
   same (95), and the identical pair for `geo.zip_authoritative_marker` (113,
   120). Applying it as an installer would **mutate the exact planes this
   workstream must not touch.**
2. **They are parameterised with psql bind placeholders** (`:keys`, `:run`, lines
   87/89/98/99/114/116/123/124), which are not valid SQL in any driver. It cannot
   execute as written even if that were wanted.
3. **It calls `geo.n5_expected_marker(:keys)` (lines 116, 124), and that function
   is defined nowhere in the repository.** `git grep n5_expected_marker dedb7db`
   returns call sites only, never a definition. The file defines exactly one
   function, `geo.n5_expected_membership`.

So the reconciler had **never existed as an installable artifact**. The canonical
implementation is `scripts/n5_reconcile_sql.py` (`STAGES` + `render`), whose only
consumer was `scripts/geo_steady_state_fixture.py`, which wraps the rendered
stages into a function **in a fixture schema**. `scripts/gen_geo_reconciler_install.py`
performs the same wrapping against `PROD_RELS`, and `docs/geo-reconciler-install.sql`
is its output. Keep the old file as the design record; install the generated one.

**Defining is not running.** Every DML statement sits inside a function body;
creating the function compiles it and executes none of it. **Proven on an isolated
PostgreSQL: resident membership/marker rows were 1/1 before the install and 1/1
after, with both functions defined.** Reconciliation happens only when something
calls `geo.n5_reconcile(...)`, and after a passive install nothing does — the
handoffs only enqueue, there is no worker, and no cron job references it.

## 2a. Dependencies each step actually requires

| need | required by | if absent |
|---|---|---|
| **PostGIS** (`geometry`, `ST_*`) | steps 2, 3, 4 | step 2 aborts with `type geometry does not exist`. Measured: the sequence fixture failed exactly this way until PostGIS 3.4 was installed. |
| `geo.n5_geom`, `n5_geom_incoming`, `n5_boundary_membership`, `zip_authoritative_membership`, `zip_authoritative_marker`, `zcta_boundary`, `n5_accepted_source` | step 3 | the reconciler body references them by name |
| `public.app_projects`, `property_company_roles`, `project_facility_refs`, `identity_conflicts` | steps 8, and the post-gates of 3 and 8 | gate aborts (fail-closed, §4) |
| `public.development_reports` | step 4 (`geography_health_probe` ingest freshness) | probe errors |
| **a READABLE `cron.job` catalog** | post-gates of steps 3 and 8 | **the install ABORTS.** This is now a hard precondition, not a warning — see §4. |
| `public.pipeline_health_check`, and `_eval` inside the live tick | step 9 | anchor will not match |
| `geo.n5_reconcile_queue` + `geo.enqueue_work` | step 8 | step 8 refuses by name |
| `geo.geography_health_probe` | step 9 | step 9 refuses by name |

All of these exist in production today except the objects steps 1–4 create.

## 3. Ownership, grants, execution role, RLS

| object | owner | grants | notes |
|---|---|---|---|
| `geo.n5_reconcile_queue` | postgres | none | `enable row level security`, **no policy** ⇒ no anon/authenticated access |
| `geo.enqueue_work` | postgres | `revoke all from public` | called from inside `app_refresh_zip`, which runs as the caller |
| `geo.proven_expected_geometry` | postgres | `revoke all from public` | `stable`, cannot mutate |
| `geo.n5_reconcile`, `…_stage1` | postgres | `revoke all from public` | **deliberately NOT `security definer`** — a definer-rights reconciler reachable from PostgREST would be a privilege-escalation surface |
| `geo.geography_health_probe` | postgres | `revoke all from public` | writes one observation row when `_record` |

Verified on the isolated server after installing steps 1–4:
`has_function_privilege('public', …, 'EXECUTE')` is **false** for
`geo.n5_reconcile`, `geo.n5_reconcile_stage1` and `geo.enqueue_work`;
`geo.n5_reconcile`'s ACL is `{postgres=X/postgres}`.

⚠️ **CORRECTED: RLS BYPASS IS NOT FUNCTION EXECUTE, AND THE PREVIOUS DRAFT OF
THIS SECTION CONFLATED THEM.** `service_role` bypassing RLS says nothing about
whether it may CALL these functions. `revoke all … from public` removes the
implicit grant, so after a passive install **no role but the owner can execute
them.** Measured on the disposable target after running the real artifacts:

```
has_function_privilege('anon',          'geo.n5_reconcile(text[],text)','EXECUTE') = f
has_function_privilege('authenticated', 'geo.n5_reconcile(text[],text)','EXECUTE') = f
has_function_privilege('service_role',  'geo.n5_reconcile(text[],text)','EXECUTE') = f
has_function_privilege('service_role',  'geo.enqueue_work(text[],text)','EXECUTE') = f
has_function_privilege('postgres',      'geo.n5_reconcile(text[],text)','EXECUTE') = t
```

**Consequence for activation, stated so it is not discovered later:** a worker
running as `service_role` will need an **explicit `grant execute`**. That grant is
a worker-phase act and is deliberately **not** part of this passive package — the
package's own property is that nothing but the owner can invoke any of it.

`geo.enqueue_work` is called from **inside** `app_refresh_zip`, which is invoked by
the materializer as its own caller, so the handoffs need no additional grant.
Granting execute to `authenticated` would expose resident-geography DML to the
browser anon path and must not be done.

## 4. Fingerprints and fail-closed checks

| object | before | after (expected) | bytes |
|---|---|---|---|
| `public.app_refresh_zip(text)` | `6591d7f79f9a6cd0b476bbcfc2065b9a` | `de2df4de16ce9c5a9488cf8130b99d65` | 19,428 → 21,514 |
| `public.pipeline_health_tick()` | `c51e56b4158453184d966f00ef28cbb2` | `c98aad2d980a595982638a49e2472223` | 11,550 → 12,430 |

Both splices: pin the pre-image md5 and **abort on mismatch**; assert every anchor
occurs **exactly once**; **prove the transformation reverses to the original**
before applying; re-read and compare the server-rendered body after applying.
Steps 3 and 8 additionally assert **no `app_projects` trigger** and **no geography
cron job**. ⚠️ **CORRECTED — THESE NOW FAIL CLOSED.** An earlier draft made them
`raise warning`, reasoning by analogy with a migration where an unreadable cron
catalog must not roll back a correct view. That analogy is wrong for a
**pre-mutation safety gate**: *"I could not check whether the scheduler is on"* is
not permission to proceed. Each read is still wrapped so the abort **names which
check could not run** — an unevaluated check must neither pass silently nor abort
anonymously — but it aborts the transaction either way. Proven: with the `cron`
schema renamed away, `docs/geo-reconciler-install.sql` exits **non-zero** and
defines **0** functions.

## 5. Capture contract (created by step 8)

Step 8 starts capture **immediately** — `app_refresh_zip` runs ~240×/hour, so the
queue fills within ~2 minutes and converges to **~233,106 keys** within one ~53 h
sweep. *"Reconciliation executions = 0"* stays true; *"the queue is empty"* does
not. Nothing starts a worker. See `geo-lifecycle-handoff-review.md` F1.

## 6. Steps 5–7: the three indexes — separate, observed steps

Each is its own step. Build one at a time, `CREATE INDEX CONCURRENTLY`, and
between each: re-read the ingest gate (0 failures, p95 ≤ 15 s, 0 runs ≥ 60 s over
the two most recent completed hours), then confirm `indisvalid`, `indisready`,
the exact definition, and size. Stop on any material ingest regression and do not
drop a valid index without evidence it is the cause.

```sql
create index concurrently if not exists n5_boundary_membership_sk_ix
  on geo.n5_boundary_membership(source_key);
create index concurrently if not exists zip_authoritative_membership_sk_ix
  on geo.zip_authoritative_membership(source_key);
create index concurrently if not exists zip_authoritative_marker_sk_ix
  on geo.zip_authoritative_marker(source_key);
```

⚠️ `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block**, so these
three are the only steps that are not wrapped in `begin/commit`. A failed
concurrent build leaves an `indisvalid = false` index that must be dropped before
retrying — check for one before each retry.

## 7. Rollback artifacts and their limitations (by step)

| step | rollback | limitation |
|---|---|---|
| 8 | `docs/geo-lifecycle-handoff-rollback.sql` | **refuses unless the live body is exactly the post-install one.** If another session amends `app_refresh_zip` after install, the reversal must be re-derived. |
| 9 | `docs/geo-health-integration-rollback.sql` | same, against `pipeline_health_tick` — and that function is amended by the other session more often. Leaves the `geography_progression` row in `pipeline_health_check`; deleting it is a separate, deliberate statement given in the file. |
| 1–4 | none shipped | the objects are inert once step 8 is reversed: nothing calls them and nothing reads the queue. Dropping them is a deliberate separate act, not part of a rollback. |
| 5–7 | `drop index concurrently geo.<name>` | indexes are transparent; dropping one only restores the previous plan. |

**There is no single-command rollback of the whole package**, and that is
deliberate: a blanket reversal would have to guess whether concurrent changes to
either function were ours.

## 8. Every referenced file exists

Checked mechanically by `test/geo-lifecycle-handoff.test.mjs` §12 and, for the artifacts actually executed, by `scripts/geo_install_sequence_fixture.py`, whose `artifact()` raises `FileNotFoundError` on any manifest path that does not exist, which reads
this manifest, extracts every `docs/…`/`scripts/…`/`test/…` path and asserts each
is present in the working tree. A manifest naming a file that does not exist is
the failure mode this section exists to prevent.

## 9. F1 — RESOLVED: capture is scoped to NEW / CHANGED / REMOVED (option B)

**Decision taken: option B.** Capture now satisfies the accepted contract's own
wording — *"how a **NEW or CHANGED** live project reaches the reconciler"*,
*"a key that needs evaluating"*, *"NEW / CHANGED / REMOVED"*. An unchanged key
whose refresh heartbeat advanced is no longer captured.

### The relevance predicate is read off the geography path, not guessed

The only `app_projects` columns any accepted geography artifact consumes are the
ones `geo.proven_expected_geometry`'s `live` CTE selects — **`source_key`,
`registry_id`, `lat`, `lng`** — under the eligibility filter
**`record_kind = 'development'`**. The reconciler reads `geo.*` only; its sole
`app_projects` references are in its post-gate. So a change is relevant iff, for
a `(zip, source_key, source_seq)`:

* the row did not exist before → **NEW**, or
* `registry_id` / `lat` / `lng` changed, or
* `record_kind` changed → an **eligibility flip**, in either direction.

`last_seen_at` is deliberately absent: it is the heartbeat.

### How, without touching the materializer's upsert

Each upsert gains a **pre-image CTE** (`geo_prev_dev` / `geo_prev_fac`) bounded to
`zip = _zip` — the same bound the upsert already has, never a corpus scan — and
the handoff joins the `RETURNING` set against it.

⛔ **No `WHERE` is added to `DO UPDATE`.** That would stop `last_seen_at`
advancing for unchanged rows, and the stale sweep deletes `last_seen_at < _run` —
a geography optimisation would become national data loss. The upsert, its SET
list, the stale-sweep predicates, the retention `not exists` guards, `_stale` and
every returned count are untouched.

**No warm-up.** On the first refresh after install the pre-image already holds the
existing rows, so an unchanged corpus enqueues nothing. Installing never enrolls
the historical backlog.

**Concurrency, and which way it fails.** Both CTEs belong to one statement: the
pre-image reads the statement snapshot while `ON CONFLICT` re-reads the latest
committed row, so under READ COMMITTED a concurrent writer can make the two
disagree. That direction is **over-capture, never a miss** — and re-evaluating an
unchanged key is idempotent. A missed change cannot arise, because `RETURNING`
reports what this statement wrote. Committed relevant changes keep their handoff
in the same transaction.

**Cross-ZIP / `source_seq`.** The join key is `(zip, source_key, source_seq)`, so a
new `source_seq` is NEW, and a key spanning ZIPs is captured by whichever ZIP saw
the change; the reconciler is key-scoped and rebuilds from all of a key's
evidence. **Facility eligibility is unchanged and explicit** — facility upserts
still enqueue exactly as before; only the change scoping is new.

### Load: what is estimated and what is measured

⚠️ **Correcting my own earlier wording.** I wrote "~253 keys/ZIP" from
3,213,495 rows ÷ 12,722 ZIPs. **Rows divided by ZIP count is a rows-per-ZIP
estimate, not a measured distinct-key rate**, and I presented it as though it were
measured. What *was* measured, on four ZIPs, read-only on 2026-09-20, is
**distinct `source_key` per ZIP: 64165 → 120 · 19475 → 137 · 78617 → 533 ·
10001 → 1,004**. Four ZIPs are not a national rate and no national rate is claimed
here.

**Bounded before/after, at fixture scale — not a production benchmark.** In the
isolated fixture, four consecutive unchanged refreshes of a 2-row ZIP:

| | keys enqueued |
|---|---:|
| pre-correction scoping (one key per upserted row per refresh) | **8** |
| corrected scoping | **0** |

The production effect is not measured and cannot be until capture is installed.
What the correction guarantees is the *shape*: steady-state enqueue volume is now
proportional to **relevant change**, not to refresh cadence.

