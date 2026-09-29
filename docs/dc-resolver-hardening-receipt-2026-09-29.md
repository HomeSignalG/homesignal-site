# Resolver hardening — receipt, 2026-09-29

**Status: applied to production. v1 at 2026-09-29 19:00–19:02 UTC; v2 (which fixes a false alarm v1 raised at its first tick) at 19:47:10 UTC — see "Found after applying" and "v2 applied and read back".**

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

## Found after applying (2026-09-29, same day) — a false alarm of mine, and a real failure it landed on

**Applied** at 19:00:33, 19:01:02 and 19:01:25 UTC (ledger `20260929190033` / `…190102` / `…190125`). The stored text of all
three is byte-for-byte the committed file (md5 `3f35b938…`, `cc87fc0f…`, `e5316fa5…`). Read back: the geography job
runs `set statement_timeout = '300s'; select public.dc_resolve_serialized('geography')`; anon and authenticated cannot
run any of the four resolver functions; the monitor carries each check once.

**The 19:10:00 tick reported `dc_resolvers` failing:** *"dc-resolve-canonical has no successful run since ever;
dc-resolve-geography has no successful run since ever."* The monitor recorded a notification at 19:10:00
(`last_notified_at`; whether the mail arrived was not read from here).

- **Cause (mine): `cron.schedule()` issues a new jobid on every reschedule**, and v1 matched a job's history on jobid
  alone. Applying the 300 s ceiling rescheduled the jobs (jobids 63/62 → 66/65), so the check saw zero rows for two jobs
  that had history (canonical alone had **164** earlier runs under its old jobid). **My stand-in test never rescheduled a job**, so it could not fail on this: the same
  "a fixture that only builds the working shape" defect this repo already names. It now does (H3b, H6).
- **For canonical the alarm was false. For geography it was right about the outcome and wrong about the reason:**
  geography **really had not succeeded since 15:35** (last success 15:35:00, 101.7 s). Its runs at **16:35, 17:35 and
  18:35 each timed out at exactly 120.0 s** ("canceling statement due to statement timeout"). The 3 h limit would have
  fired on its own at about 18:35–19:10. v1 said "since ever" instead of "since 15:36".
- **v2** matches history on the job's id **or** the command text it ran (`job_run_details.command`), over the last 7 days,
  so a reschedule cannot erase it. It **upgrades v1 in place** and refuses if anything else was spliced after it.
  Stand-in: **48 checks**. It reproduces the defect (H6: v1 false-alarms after a reschedule), proves v2 removes it, proves
  a foreign splice after v1 refuses the upgrade and changes nothing, and proves each job's pattern names only its own
  resolver. The v1 fixture is pinned to production's ledger md5.
  - **Mutation results, on exit code:** matching on jobid only, no 7-day bound, either pattern too broad, the
    foreign-splice guard removed, the upgrade path replaced by a fresh insert, and the already-current short-circuit
    removed each failed the run. **One survives, by construction:** deleting the "v1 must be gone" post-condition —
    no input reaches it, because a second v1 block is refused earlier. It is kept as a backstop, like the two
    unreachable ones named in the step 13 monitor-lock record.
  - A first "remove the foreign-splice guard" mutation was itself wrong (it made the guard always refuse, which broke
    a clean upgrade and still looked like a kill). Redone so it truly removes the guard: killed by the named assertion.
- **What was not rescued by luck:** without the guard, upgrading over a foreign block **silently deletes it** (the
  replacement covers everything up to the anchor). The guard is load-bearing.

**Geography is now the live problem, and it is not what the step 13 receipt concluded.** The three timeouts started
right after today's acquisitions (Compute Atlas 2,249 records at 16:07, Epoch data centres 93 and timelines 545 at
16:28). Yesterday's identical-shaped acquisition (+546 timeline entities) left geography at 101–108 s, which is why the step 13
receipt called the leftover timeline entities "not the driver". **That conclusion rested on one day's step and is not
safe:** the run time may cross a threshold cumulatively, or something else changed at 16:07–16:35. It is unproven
either way and is left open.

## v2 applied and read back (2026-09-29 19:47 UTC, outside the :18–:45 resolver window)

- **Applied** as migration `dc_resolvers_v2_history_survives_reschedule` (ledger `20260929194710`). The stored text is the
  committed file byte for byte: md5 `4ca8903cecbb774ed03f981ab0ef8095`, 11,439 characters, both sides.
- **The upgrade was in place.** The live monitor went from 31,733 to 31,412 characters and now holds the v2 marker once,
  the v1 marker **0** times, `'dc_resolvers',` once, `'dc_address_check',` once and the anchor once. Grants are still
  `{postgres=X, service_role=X}`. Nothing else had been spliced after v1 (its length was unchanged since v1), so the
  foreign-splice guard did not fire.
- **First evaluation, 19:47:30 (run by hand, the same call the hourly job makes):** `dc_resolvers` **ok** —
  *"dc-resolve-canonical ok 19:25Z slowest 33s, dc-resolve-geography ok 19:37Z slowest 137s, dc-resolve-on-acquisition ok
  19:46Z slowest 23s; anon/authenticated cannot run any resolver"*. It reads the history across the reschedule, which is
  the case v1 got wrong. `dc_address_check` also ok (snapshot 09-29 11:50, 1,817 markers). The only failing check is
  `digest_delivery` (newest delivery 09-27 22:00, unrelated).
- **The 300 s ceiling is proven in production, not only on a stand-in:** the 19:35 geography run **succeeded in 137.2 s**,
  past the 120 s that had cancelled its three previous runs. The claim that a separate statement ahead of the call
  raises the limit under real pg_cron 1.6.4 was, before this, measured only on 1.6.2 locally.
- **Headroom, stated plainly:** 137 s is 46% of the 300 s ceiling, and the run time rose from ~102 s to >120 s in one day.
  The `slow` class alerts at 200 s. What drives the growth is open (see above).

## Not done, and why

- **The two other jobs that hit the same wall are untouched:** `app-content-refresh` and `dev-reports-rolling-refresh`
  each reached 120.0–120.3 s in the last 14 days. They are other planes with other owners, and each needs its own
  measured fix. The same finding applies to them: the ceiling would have to sit in their job command, not their function.
- **Geography is still ~100 s of work.** The ceiling gives headroom; it does not make the resolver faster, and the
  `slow` class of the new check is what says when that headroom is being used up.
