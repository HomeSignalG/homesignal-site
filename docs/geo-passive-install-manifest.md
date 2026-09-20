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
| `public.app_refresh_zip(text)` | `6591d7f79f9a6cd0b476bbcfc2065b9a` | `ba2e6f9d8932d08e4373bfe97ae25ffd` | 19,428 → 20,233 |
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

## 9. F1 — CAPTURE SCOPE: the decision this package cannot make for you

**Classification: this is NOT worker-phase work and cannot be deferred to
activation.** Capture begins at **step 8**, before any worker exists, so its write
load and its authorization are properties of the *passive* install.

### What the accepted contract actually says

| source | wording |
|---|---|
| `geo-work-handoff.sql` line 2 | "WORK HANDOFF — how a **NEW or CHANGED** live project reaches the reconciler" |
| `geo-work-handoff.sql` line 52 | "One queue, one meaning: **A KEY THAT NEEDS EVALUATING**" |
| `geo-steady-state-path.md` line 102 | "**NEW / CHANGED / REMOVED** LIVE PROJECT" |

The contract scopes capture to **new, changed, or removed**. **It nowhere states
that unchanged existing keys enter the queue.**

### What the implementation does

Both upserts are `insert … on conflict (zip, source_key, source_seq) do update
set … last_seen_at = excluded.last_seen_at`. `DO UPDATE` **returns every conflicting
row whether or not any value changed**, so `returning source_key` yields *every key
in the ZIP on every refresh*. The implementation therefore enqueues unchanged keys.

**So the implementation is broader than the contract's stated scope, and the
accepted documents neither authorize nor forbid that breadth. That is the gap.**

### Immediate implications, measured

- `app_refresh_zip` runs **~240×/hour** (`dev_refresh_tick(8,20)` every 2 min).
- Distinct `source_key` per ZIP, measured 2026-09-20: **19475 → 137 · 64165 → 120 ·
  78617 → 533 · 10001 → 1,004**; corpus mean ≈ 253 (3,213,495 rows / 12,722 ZIPs).
- ⚠️ **Correction to an earlier framing of mine:** I previously described this as
  "~960 extra small inserts/hour". That counted **statements**, not rows. The real
  figure is **~240 runs × ~253 keys ≈ 60,000 queue upserts/hour** (~1,000/min),
  each paying PK and partial-index maintenance.
- The queue is **PK-bounded**, so it converges to ~**233,106** rows, not unbounded
  growth — a small table, but a continuously rewritten one.
- ⚠️ It **exceeds the 200,000 default scan cap** in `geography_health_probe`. The
  F11 precedence correction is what keeps that from paging CRITICAL for a system
  that is deliberately OFF; **without F11, option A below alarms within ~2 days.**

### The decision, stated precisely — no redesign offered

- **Option A — ratify the breadth.** Declare that "a key that needs evaluating"
  includes unchanged keys; re-evaluation is idempotent and converges to state
  equality, so unchanged keys cost work, never wrong answers. Consequences: the
  ~60k/hour write load above is accepted; activation must be sized at ~233k keys
  per sweep rather than at a change rate; F11 must ship with it. **No code changes.**
- **Option B — restrict capture to genuinely changed keys.** This is a change to
  capture and needs its own authorization and design; it is **not** designed here.
  ⛔ The obvious form is unsafe: adding a `WHERE` to `DO UPDATE` stops
  `last_seen_at` advancing, and the stale sweep deletes `last_seen_at < _run` — a
  geography optimisation would become national data loss. Any variant must keep
  `last_seen_at` moving and gate only the enqueue.
- **Option C — install steps 1–7 and 9, hold step 8.** The package supports this
  as-is: step 8 is last, refuses without its dependencies, and has an exact
  rollback. Everything else is inert. This defers the capture decision without
  deferring the rest of the install.

**Until this is answered, the package is complete but capture is unauthorized.**
