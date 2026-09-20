# Passive-installation manifest — definitions only

**PARKED. Installation requires separate approval.** Every step below defines
objects or builds indexes. **No step executes reconciliation, seeds work, starts a
worker, or schedules anything.**

Baseline `dedb7db`. Measurement time for every live fingerprint in this file:
**2026-09-20, re-verified 15:0x UTC** (see §6).

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

The future worker must run as **service_role** (bypasses RLS) or as the owner.
Granting it to `authenticated` would expose resident-geography DML to the browser
anon path and is out of scope here.

## 4. Fingerprints and fail-closed checks

| object | before | after (expected) | bytes |
|---|---|---|---|
| `public.app_refresh_zip(text)` | `6591d7f79f9a6cd0b476bbcfc2065b9a` | `ba2e6f9d8932d08e4373bfe97ae25ffd` | 19,428 → 20,233 |
| `public.pipeline_health_tick()` | `c51e56b4158453184d966f00ef28cbb2` | `c98aad2d980a595982638a49e2472223` | 11,550 → 12,430 |

Both splices: pin the pre-image md5 and **abort on mismatch**; assert every anchor
occurs **exactly once**; **prove the transformation reverses to the original**
before applying; re-read and compare the server-rendered body after applying.
Steps 3 and 9 additionally assert **no `app_projects` trigger** and **no geography
cron job**, each wrapped so an unreadable catalog reports `NOT EVALUATED` rather
than passing silently.

## 5. Capture contract

Step 8 starts capture **immediately** — `app_refresh_zip` runs ~240×/hour, so the
queue fills within ~2 minutes and converges to **~233,106 keys** within one ~53 h
sweep. *"Reconciliation executions = 0"* stays true; *"the queue is empty"* does
not. Nothing starts a worker. See `geo-lifecycle-handoff-review.md` F1.

## 6. The three indexes — separate, observed steps

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

## 7. Rollback artifacts and their limitations

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

Checked mechanically by `test/geo-lifecycle-handoff.test.mjs` §12, which reads
this manifest, extracts every `docs/…`/`scripts/…`/`test/…` path and asserts each
is present in the working tree. A manifest naming a file that does not exist is
the failure mode this section exists to prevent.
