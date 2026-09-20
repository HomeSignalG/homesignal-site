# Lifecycle handoff + health integration — review package

**Status: ARTIFACTS READY FOR REVIEW. Nothing is installed. No production
mutation was performed in preparing this.** Every production interaction was a
catalog read or a `SELECT` that computed a transformation and returned
fingerprints without applying it.

Accepted baseline: **`dedb7db`** (`origin/claude/amazing-planck-k897il`, unmerged;
diverged from `main` at `33f224e`). This work sits on top of it.

---

## A. Why this exists

`docs/geo-work-handoff.sql`, accepted at `dedb7db`, carries the queue and
`geo.enqueue_work` as executable SQL but describes **the four splices into
`public.app_refresh_zip` only as prose inside a comment block** under the heading
*"THE FOUR SPLICES INTO public.app_refresh_zip — NOT APPLIED."* Verified three
ways: comment-stripped extraction of the file (5 executable statements, none
touching `app_refresh_zip`); a search of every geography path at `dedb7db` for
`app_refresh_zip` (only that file and one `.md`); and `geo_steady_state_fixture.py`,
which emits only the adapter and the reconciler.

This repo has already paid for that shape once — *"A PARKED MIGRATION THAT IS
MOSTLY COMMENTS IS NOT A MIGRATION"* (CLAUDE.md, EPA Phase 1b). These files are
the missing executable half. **They add nothing to the accepted design and change
none of it.**

## B. Artifacts

| file | role |
|---|---|
| `docs/geo-lifecycle-handoff-install.sql` | the four splices, fail-closed, self-proving |
| `docs/geo-lifecycle-handoff-rollback.sql` | generated reversal, fingerprint-pinned |
| `docs/geo-health-integration-install.sql` | `geography_progression` into the LIVE `pipeline_health_tick` |
| `docs/geo-health-integration-rollback.sql` | generated reversal |
| `scripts/geo_handoff_splice.py` | the anchors, defined ONCE; generates verifier/rollback/fixture |
| `scripts/geo_handoff_fixture.py` | isolated behavioural proof, disposable local PostgreSQL |
| `test/geo-lifecycle-handoff.test.mjs` | 44 offline pins, CI-resident |
| `scripts/geo_health_fixture.py` | **defect fixed** — see F9 |

## C. Fingerprints (measured read-only against live production, 2026-09-20)

| object | before | after (expected) | bytes |
|---|---|---|---|
| `public.app_refresh_zip(text)` | `6591d7f79f9a6cd0b476bbcfc2065b9a` | `ba2e6f9d8932d08e4373bfe97ae25ffd` | 19,428 → 20,233 |
| `public.pipeline_health_tick()` | `c51e56b4158453184d966f00ef28cbb2` | `c98aad2d980a595982638a49e2472223` | 11,550 → 12,430 |

Verified in the same read-only pass, applying nothing:
`precondition_ok` **true** · anchor occurrences **1:1 2:1 3:1 4:1 5:1 6:1** ·
`excision_reconstructs_original` **true** (both objects) · `handoff_count` **4** ·
`get_diag_replaced` **true** · `line30_delete_intact` **true** ·
health anchor occurrences **1**, `_eval` inserts **10 → 12**.

⚠️ **`pipeline_health_tick` is actively amended by the other session (Rule #0a).**
`dedb7db` records it at `258df595490b81c3dfcc7086cf9f8c39`; that is **no longer
live** — the `local_news_heartbeat` check landed since. The artifact pins the
CURRENT value and splices additively; replaying the baseline body would delete
their work. Pinned by test §8.

## D. Two anchor hazards, both found by measurement

1. **`delete from public.app_projects p` occurs TWICE** — line 30 and line 156.
   Line 30 deletes rows `where p.source_key is null` (legacy pre-stable-key rows,
   no geography meaning). Only line 156 is the stale sweep. A bare statement-head
   anchor would have edited both. Same class as the government-notice window's
   *"the bare 14-day clause appears twice, the second one is Local News."*
2. **`      source_key_basis=…, last_seen_at=excluded.last_seen_at;` is
   byte-identical at line 106 and line 153.** Neither is anchorable alone. A2
   carries the following blank line plus the facility insert head; A3 carries the
   following `  end if;`.

## E. The one place a naive splice corrupts unrelated state

Line 162 is `get diagnostics _stale = row_count;`. Wrapping the DELETE in a CTE
makes `row_count` report the **outer** statement (1), so `_stale` — which this
function returns in its status string — would silently become 1 on every run.
A4 therefore replaces that line too, setting `_stale` from `count(*)` over the
delete's own `RETURNING` set.

**Measured, not argued.** Fixture T9 runs the spliced and unspliced functions over
identical state and asserts `_stale` is equal (`1` = `1`); T9b asserts the empty
case (`0`). **Mutation M2 reintroduces the naive wrap and the suite goes red:
`_stale` reports `1` where the truth is `0`.**

The rejected alternative — capture keys in a separate `SELECT` before the DELETE,
leaving both statements untouched — duplicates a five-line predicate into a second
copy that stops matching the first the next time either is edited. That is the
hand-copied-list anti-pattern CLAUDE.md records under `_BODY_AS_PLACE_RE`.

## F. Findings from the adversarial pass

### 🔴 F1 — STEADY STATE CONVERGES TO THE FULL NATIONAL CORPUS. This is the finding that needs a decision.

**Installation seeds nothing — proven (T7: queue is empty immediately after
install; no anti-join, no `INSERT…SELECT FROM app_projects`, no cron in any
artifact). But the handoff is not a delta feed.**

The two upserts re-touch **every row of a ZIP on every refresh** — that is what
`on conflict do update set … last_seen_at=excluded.last_seen_at` is for — so
`returning source_key` returns every key in that ZIP every run, changed or not.
`app_refresh_zip` runs ~240×/hour and the measured full sweep is ~53 hours, so
within one sweep the queue converges to essentially **every source key in the
country: ~233,106 distinct keys** (`pg_stats` n_distinct estimate, 3,213,495 live
rows).

That population **is** the historical debt. So:

- *"Installation does not import historical debt"* — **true, and proven.**
- *"The steady-state queue stays separate from historical debt"* — **false within
  ~53 hours.** They become the same set.

It is bounded, not runaway: `source_key` is the primary key, so the queue tops out
at ~233k rows and re-enqueue is an upsert. The reconciler is idempotent and
converges to state equality, so processing an unchanged key is wasted work, not
wrong work. **Nothing is unsafe while the worker is OFF.** But activation sizing
must be done against ~233k keys per sweep, not against a change rate.

⛔ **DO NOT "fix" this by adding a `WHERE` to the `DO UPDATE`.** The obvious
optimisation — skip the update when nothing changed — **would delete live rows**:
`last_seen_at` would stop advancing for unchanged rows, and the stale sweep at
line 156 deletes exactly `last_seen_at < _run`. A geography optimisation would
silently become a national data-loss bug. Any change-detection variant must keep
`last_seen_at` moving and gate only the *enqueue*. That is a change to the
accepted design and is **not implemented here**.

### 🟠 F2 — Re-enqueue clears an outstanding worker claim

`geo.enqueue_work`'s `on conflict do update` sets `claimed_at = null,
claimed_by = null`. If a worker has claimed a key and a lifecycle event lands
mid-flight, the claim is cleared and a second worker can pick the same key up.
**Proven in fixture T5.** Zero impact today (worker OFF, zero executions). **Must
be resolved before activation** — this is a blocker for the *next* phase, not this
one. It is a property of the accepted `geo-work-handoff.sql`, not of this splice.

### 🟡 F3 — Facility keys are enqueued; the PROVEN adapter only reads development rows

Both upserts enqueue, per the accepted design. `geo.proven_expected_geometry`
filters `record_kind = 'development'`, so a facility-ONLY key resolves to outcome
3 / `SOURCE_REMOVED` — "retire geography" for a key that has none. A harmless
no-op today and wasted queue volume; a mixed key still resolves correctly on its
development rows. Recorded, not changed.

### 🟡 F4 — The enqueue rides inside `app_refresh_zip`'s transaction, by design

If an enqueue raises, the **whole ZIP refresh rolls back**. That is the correct
direction — it makes "every committed lifecycle change is captured" an invariant
rather than a hope, and T6 proves a rolled-back refresh leaves no phantom work.
The cost is blast radius: a fault in the geography queue (table dropped, reason
domain violated) would stop the national materializer. The install-time dependency
checks and the closed `reason` CHECK are what keep that narrow. Wrapping the
enqueue in an exception handler would trade national availability for silent event
loss; that is a founder trade-off, deliberately **not** made here.

### 🟡 F5 — The rollback window is not guaranteed

Both rollbacks refuse unless the live body is exactly the post-install one. If
another session amends either function after install, the reversal must be
re-derived. Fail-closed is right; plan to roll back promptly or not at all.

### 🔴 F9 — The accepted Phase 6 health fixture had never been executed, and could not be

`scripts/geo_health_fixture.py` ended `sys.stdout.write("\n".join(out))` where
`scenario()` returns a **string** — so it emitted one character per line and the
SQL could not parse (`ERROR: syntax error at or near "d"`). **No workflow, test or
doc referenced the file**, so nothing ever ran it. The Phase 6B record cites it as
*"29 assertions, 3 load-bearing mutations, negative control"* — that proof was
emitted and never executed.

Fixed (one line). **Run against a real PostgreSQL it passes: `state-machine cases
passed: 17`**, covering NOT_ACTIVATED / HEALTHY / WARNING / CRITICAL / frozen-worker.
The model was sound; the runner was not. ⚠️ I could not reproduce "29" as a single
number — the state-machine scenario reports 17 and the registry cases run from a
separate `--registry` invocation; I am not claiming the 29 is wrong, only that it
is not what this file prints.

This is the repo's own rule landing on the repo: *an instrument must prove it ran
before its silence counts as evidence.*

## G. Capture contract — stated explicitly, because it changes on apply

**Once installed, the handoffs capture lifecycle events IMMEDIATELY.** The queue
begins filling on the next tick (~2 minutes). Therefore:

| claim | after install |
|---|---|
| geography worker running | **no** |
| geography scheduler / cron | **no** |
| reconciliation executions | **0** |
| historical backfill executions | **0** |
| `geo.n5_reconcile_queue` empty | **NO — it fills immediately, and converges to ~233k keys (F1)** |

*"Reconciliation executions = 0"* and *"the queue is empty"* are different claims
and only the first survives installation. Nothing here starts a worker, and the
accepted capture/activation contract is unchanged — this makes it explicit rather
than altering it.

## H. Evidence

- **Isolated fixture** (`scripts/geo_handoff_fixture.py`, disposable local
  PostgreSQL 16.13, no production contact): **21 checks, 0 failures** — T0 both
  versions compile; T1 NEW; T2 UPDATE; T3 geocode fence; T4 SOURCE_REMOVED; T5
  duplicate-event claim reset; T6 transaction rollback; T7 no install-time seeding;
  T8 closed reason domain + 4 call sites; T9/T9b `_stale` equivalence.
  The fixture function **contains the production anchor strings verbatim** (read
  out of the install artifact by `geo_handoff_splice.py`, never retyped) and is
  transformed by **the same replacement list** the migration applies, so it proves
  the real text rather than a paraphrase.
- **Mutation controls, measured on EXIT CODE** (not on FAIL-line counts — a crash
  prints nothing): M1 drop the SOURCE_REMOVED enqueue → red; M2 naive CTE wrap →
  red on `_stale`; M3 drop the fence enqueue → red; M4 upsert returns nothing →
  red. Baseline green before and after.
- **Offline pins**: `test/geo-lifecycle-handoff.test.mjs`, **44 checks, 0
  failures**, load-bearing by 5 mutations (P1–P5 each red, restored green).
- **Unit suite**: **145 passed, 0 failed.** ⚠️ 20 `.browser.test.mjs` files could
  not run here — `Cannot find package 'playwright'`, an environment limit of this
  sandbox, unrelated to these artifacts. They are **not** reported as passing.
- **Syntax**: every `DO` block in all four SQL artifacts compiles as plpgsql under
  `check_function_bodies=on` on a real server.

## I. Deployment order (for the approved window, which must re-run the ingest gate and drift check first)

1. `docs/geo-work-handoff.sql` — queue + `geo.enqueue_work`
2. `docs/geo-proven-expected-geometry.sql`
3. `docs/geo-source-scoped-reconcile.sql`
4. `docs/geo-health-model.sql`
5. `docs/geo-lifecycle-handoff-install.sql` ← refuses without (1)
6. `docs/geo-health-integration-install.sql` ← refuses without (4)

Rollback is the reverse: 6R, 5R, then drop the core deliberately if wanted.

## J. Remaining blockers to controlled activation

1. **F1** — activation must be sized against ~233k keys/sweep, or a safe
   change-detection variant designed (and it must not touch `last_seen_at`).
2. **F2** — re-enqueue clears an in-flight claim; fix before a worker runs.
3. **No CI runner for the behavioural fixture.** `geo_handoff_fixture.py` needs a
   PostgreSQL service container; the 44 offline pins run in CI, the 21 behavioural
   checks do not. Wiring that is a separate change.
4. Thresholds in `geo-health-model.sql` remain **PROVISIONAL**; the scheduler
   interval is still unchosen.
5. Both fingerprints must be re-verified in the apply window — `pipeline_health_tick`
   especially, since the other session amends it.
