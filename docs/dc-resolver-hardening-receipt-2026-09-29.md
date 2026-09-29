# Resolver hardening — receipt, 2026-09-29

**Status: written and proven on a disposable stand-in. NOT applied to production.** Applying it needs a go.

**What ships:** `docs/dc-resolver-hardening.sql`, plus edits to `docs/dc-marker-loss-watcher.sql` and
`docs/dc-address-check-monitor.sql`. It closes the three gaps the step 12 and 13 receipts recorded and did not fix.

## 1. Nobody watched the resolver jobs — now one health check does

`dc-resolve-geography` was cancelled by the 120 s statement timeout at 2026-09-28 20:35 and nothing alerted. The new
check `dc_resolvers` rides the one monitor (`pipeline_health_tick`, hourly at :10) and reads pg_cron's own run
history. It fails when:

| class | fails when | source of the threshold |
|---|---|---|
| quiet, hourly jobs | no successful run of `dc-resolve-canonical` or `dc-resolve-geography` in **3 h** | one failed run is deliberately not an alert: the 20:35 cancellation cost one skipped hour and left every entity placed |
| quiet, watcher | no successful run of `dc-resolve-on-acquisition` in **10 min** (5 missed runs) | it closes the Map 1 marker-loss window, so it is watched far tighter |
| slow | a successful run in the last 24 h took more than **2/3 of its own limit**: 80 s of 120, 200 s of 300 | measured 2026-09-28: geography 101–108 s (avg 102.4), canonical max 33 s, watcher max 22.4 s |
| missing | a job is absent from `cron.job`, or disabled | — |
| open | `anon` or `authenticated` can execute any of the four resolver functions | see 3 |

An absent job or an empty history fails; it never reads as healthy. The check is always alertable.

Read live 2026-09-29 00:50 UTC (24 h, before this change): canonical 24 runs, 24 ok, max 33.0 s · geography 24 runs,
23 ok, 1 failed, max 120.0 s, avg 102.4 s · watcher 720 runs, 720 ok, max 22.4 s. Against those numbers the check
would have stayed quiet on the single failure and would have flagged geography at 120 s once its ceiling moved
(see 2), which is the intended early warning.

## 2. The geography 120 s limit — and a defect in step 12 found on the way

Geography now runs with a **300 s** ceiling. **It has to be a separate statement ahead of the call**, and that was
measured rather than assumed:

- Postgres 16, statement limit 2 s, 3 s of work: a `SET LOCAL statement_timeout` inside the function is cancelled at
  2 s; a function-level `SET statement_timeout` clause is cancelled at 2 s; `set statement_timeout = '20s'; select fn()`
  completes.
- **Real pg_cron, same result.** pg_cron 1.6 (production runs 1.6.4) started in a private cluster with a 2 s limit and
  four one-second jobs: the plain call and the SET-inside-the-function call both failed every run (9 of 9); the
  SET-then-call and SET LOCAL-then-call jobs completed every run (6 of 6).
- **Step 12's snapshot carried the same defect.** Its receipt said the job "has its own 300 s ceiling", but the SET
  was inside the function, where it does nothing. It never showed, because the snapshot takes 44–47 s against 120 s.
  Corrected: the ceiling is now in the job command, and the function no longer pretends to set it.

Both jobs are owned by their files of record, and the files were changed together:

- `docs/dc-marker-loss-watcher.sql` schedules `set statement_timeout = '300s'; select public.dc_resolve_serialized('geography')`
  and its drift guard accepts three commands: the step 3b one, the un-prefixed serialized one (production today) and
  the 300 s one. Re-applying the old file therefore cannot silently put the 120 s limit back.
- `docs/dc-address-check-monitor.sql` schedules the snapshot the same way.

**Re-apply order:** `dc-marker-loss-watcher.sql`, `dc-address-check-monitor.sql`, then `dc-resolver-hardening.sql`. All
three are idempotent.

## 3. `dc_resolve_canonical` and `dc_resolve_geography` were open to the public key

Measured 2026-09-29 (`pg_proc.proacl`): both were `{=X, postgres=X, anon=X, authenticated=X, service_role=X}`, so anyone
holding the public site key could run an identity resolve through `/rest/v1/rpc/`. Now revoked from `public`, `anon`
and `authenticated` by name (a revoke from PUBLIC alone is not a lock on Supabase: default privileges grant EXECUTE to
anon and authenticated directly). `postgres` (the cron user) and `service_role` keep it.

- **Nothing legitimate uses the open door:** every pg_cron job that names a resolver runs as `postgres`, and no
  non-doc file in either repo calls the resolvers over REST (the replica dry-run scripts run as a superuser).
- **All or nothing.** The file refuses, and, applied in one transaction as `apply_migration` does, undoes the revoke,
  if any pg_cron job that names a resolver would lose the ability to run it.
- **It stays locked:** the `dc_resolvers` check fails if anon or authenticated can run any of the four resolver
  functions, which also catches a later drop-and-recreate or a broad `grant execute on all functions`.

## Proof

- `test/dc_resolver_hardening_pg/run.sh`: **32 checks** on the step 11 stand-in.
  - H0 the exposure reproduced; H1 closed for anon, authenticated and PUBLIC while the owner and `service_role` keep it.
  - H2 healthy history is healthy; a failed hourly run beside a recent success passes; every limit fails one side and
    passes the other (3h01m/2h59m, 11/9 min, 201/199 s, 81/79 s); a slow run older than 24 h no longer counts.
  - H3 empty history, unscheduled job, disabled job, anon/authenticated/PUBLIC re-grants all fail and say which.
  - H4 re-apply changes nothing; a cron job that would lose EXECUTE refuses and rolls the whole file back.
  - H5 the Postgres half of the timeout claim (above).
- **13 deliberate breaks each failed the run on exit code**, file restored byte-identical after each: no revoke on
  either resolver, revoke from PUBLIC only, each quiet limit widened, geography limit set to 120, the 2/3 threshold
  disabled, check made non-alertable, the owner guard removed, an absent job reading healthy, a disabled job ignored,
  the privilege half dropped, and any-status runs counted as health.
- `test/dc_marker_loss_pg/run.sh` gains W9b: the first apply of the 300 s file meets production's current
  un-prefixed command and accepts it. `test/dc-resolver-hardening-structure.test.mjs`: 17 checks, including that no
  function in these files sets `statement_timeout` inside itself.
- The repo's whole offline unit suite: 266 files, all passed.

## Not done, and why

- **The two other jobs that hit the same wall are untouched:** `app-content-refresh` and `dev-reports-rolling-refresh`
  each reached 120.0–120.3 s in the last 14 days. They are other planes with other owners, and each needs its own
  measured fix. The same finding applies to them: the ceiling would have to sit in their job command, not their function.
- **Geography is still ~100 s of work.** The ceiling gives headroom; it does not make the resolver faster, and the
  `slow` class of the new check is what says when that headroom is being used up.
