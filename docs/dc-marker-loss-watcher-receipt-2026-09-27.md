# Step 13 (C9): the Map 1 marker-loss window — receipt, 2026-09-27

**What ships:** `docs/dc-marker-loss-watcher.sql`. Within about 2 minutes of an acquisition, the same canonical
resolver runs that today waits for :25. Every resolver run now goes through one lock.

## The defect, measured

- On 2026-09-27 the Compute Atlas acquisition landed at **14:49:52**. Map 1's canonical markers went
  **971 → 1**, and came back only after `dc-resolve-canonical` ran at **15:25:00–15:25:19**: **35.5 minutes** in
  the dark.
- It can reach about **60 minutes** when an acquisition lands just after :25. Atlas and Epoch land daily between
  13:35 and 15:11 UTC, so this happens every day.

**Mechanism** (read from the live definitions):
- `dc_complete_acquisition` inserts the observations. The statement trigger `dc_mark_run_advanced` flips
  `advanced_observations` in the same transaction, so the new run is **current the moment the acquisition
  commits**.
- Map 1 (`map1_dc_zip_members`) draws an entity only through a `dc_entity_observation` link to a **current**
  observation. Only `dc_resolve_canonical` writes that link, and it runs hourly at :25.

## Two fixes that cannot work, and why

| option | why not |
|---|---|
| resolve inside the acquisition (zero window) | Acquisitions complete through PostgREST (`dc_evidence_writer.py` → `rpc/dc_complete_acquisition`) under the `authenticator` role's **`statement_timeout=8s`**. Over the last 7 days the resolvers took canonical **10.1 s avg / 39.3 s max** and geography **46.0 s / 116.5 s**, so every acquisition would time out and roll back. |
| keep the old run "current" until it is linked | `dc_resolve_canonical` itself selects `dc_current_observation`, so it would never see the new run. |

## The fix

- **`dc_resolve_on_acquisition()`**, pg_cron job `dc-resolve-on-acquisition`, every 2 minutes.
  - If a current run has **not one** linked observation, it runs `dc_resolve_canonical(true, false)`.
    Otherwise it is one read.
  - A run is unlinked only between an acquisition and its first resolve: at 19:3x today, 0 of 2,880 current
    observations were unlinked (2,242 Atlas, 93 Epoch data centres, 545 Epoch timelines).
  - Keying on whole runs means a single unlinkable record can never make it fire forever.
- **`dc_resolve_serialized(kind)`**: the hourly :25 and :35 jobs now go through one advisory lock.
  - Neither resolver guards against a concurrent run, and the watcher would make overlap possible.
  - The watcher only tries the lock. If a resolver already holds it, the watcher returns `busy` and the next
    run picks the work up.
- **Map 1 needs only the canonical link.** An entity's resolved geography persists across runs, so geography
  stays hourly. The stand-in proves it: Map 1 comes back row for row after the canonical resolve alone.
- **Worst-case window:** 2 minutes of detection plus a 39-second resolve, about **2.7 minutes**, down from
  about 60.
- **Unchanged:** every resolver, reader, rule and pin. The file refuses to apply unless both resolver jobs
  run exactly the commands measured today (also the commands the step 3a/3b files of record schedule).
  Re-applying it changes nothing.
- **Why every 2 minutes, not every minute:** `cron.job_run_details` has **no purge job** (37,741 rows since
  2026-07-03, about 1,103 a day). A 1-minute job would add 1,440 rows a day; 2 minutes adds 720, the same as the
  existing `*/2` `dev-reports-rolling-refresh`.

## Proof

- `test/dc_marker_loss_pg/run.sh`: **25 checks** on the step 11 stand-in, whose stub scheduler carries
  production's exact resolver commands. It proves:
  - W2: a re-acquisition leaves **0** canonical markers (the defect reproduced);
  - W3: the watcher resolves it and Map 1 is back row for row, carrying the new observation;
  - W4: a second call does nothing;
  - W5: with the lock held elsewhere, the watcher returns `busy` at once and resolves nothing;
  - W6: once the lock is free, the next call resolves;
  - W12: the hourly wrapper itself holds the lock while it runs;
  - W8–W10: the jobs are exact, re-applying is a no-op, and a drifted job is refused and left untouched;
  - W11: neither function can be run by anon or authenticated.
- **Four deliberate breaks each failed the run on exit code:** no lock in the wrapper, a watcher that ignores
  the lock, a detector that never fires, and a drift guard that only warns.
- `test/dc-marker-loss-watcher-structure.test.mjs`: **12 checks**. It pins that the drift guard accepts exactly
  the step 3a/3b files of record's commands.
- Both run in CI in `zip-membership-suite.yml`.

## Recorded, not fixed here

- **`dc_resolve_canonical` can be executed by `anon`, `authenticated` and PUBLIC** (its grants read
  `=X, anon=X, authenticated=X`). Anyone with the public site key could trigger an identity resolve through
  `/rest/v1/rpc/dc_resolve_canonical`. The hourly job calls it as `postgres`, so revoking from `anon` and
  `authenticated` by name should break nothing (`revoke … from public` alone is not a lock on Supabase). This
  belongs to the anon-surface work.
- **A replay of `docs/dc-step3a-canonical-identity.sql` or `dc-step3b-canonical-geography.sql` would put the
  unlocked commands back.** Re-applying this file then restores the lock; its drift guard accepts exactly
  those commands.
- `cron.job_run_details` is never purged.

## Applied and verified in production

- **Applied 2026-09-27 19:46:22 UTC** as migration `dc_marker_loss_watcher` (ledger `20260927194622`), from
  main `0a91da4`, after that hour's resolver runs and outside the :18–:45 window.
- **Read back after the apply:**
  - All three jobs have their exact commands.
  - Both functions are `{postgres=X, service_role=X}`; anon and authenticated cannot run them.
  - A manual watcher call returned `nothing to resolve`.
  - The scheduler's first run, at 19:48:00, succeeded in 52 ms.

**Measured on the first real acquisitions, 2026-09-28** (they ran about 4 hours late on GitHub's schedule):

| run | completed | first linked | Map 1 canonical layer dark |
|---|---|---|---:|
| Compute Atlas #2561 (2,241 observations) | 17:48:55 | 17:50:00 | **1.07 min** |
| Epoch data centres #2562 (93) | 18:07:09 | 18:08:00 | **0.85 min** |
| Epoch timelines #2563 (545) | 18:07:11 | 18:08:00 | **0.81 min** |

- The worst case fell from **35.5 min** (2026-09-27) to **1.07 min**. Every observation of all three runs is
  linked.
- The watcher did both resolves itself: 2 runs over 5 s, 22.4 s at most. It had 0 failures in 855 runs
  through 2026-09-29 00:16, averaging 0.1 s otherwise.
- Afterwards Map 1 has **972** canonical markers, and **0** live entities lack geography.

## Found while measuring: geography is close to the 120 s statement timeout

- `dc-resolve-geography` ran **101–108 s** every hour on 2026-09-28. The run at **20:35 was cancelled at
  120.0 s** ("canceling statement due to statement timeout"); 21:35 succeeded.
- The damage is one skipped hour: no entity lacks geography, and its placements persist across runs.
- **The limit is real for scheduled jobs:** `statement_timeout = 120000` comes from the configuration file,
  and the same limit cancelled `dev_refresh_tick` 31 times since 2026-09-19.
- **Its run time is not driven by the leftover Epoch timeline entities.** The 09-28 timeline acquisition
  added 546 of them (2,163 → 2,709 of 5,584 live entities) and geography stayed at 101–108 s, the same as
  before. The earlier climb (1.2 s on 09-22 → 91 s on 09-27) has flattened.
  - **Corrected 2026-09-29: that was one day's evidence and it did not hold.** After the 09-29 acquisitions
    (16:07 Atlas, 16:28 Epoch, +545 timeline entities again) geography timed out at 120.0 s at 16:35, 17:35 and
    18:35 (last success 15:35, 101.7 s). Whether the timeline entities are the cause is unproven, but "flattened" was
    wrong. See `dc-resolver-hardening-receipt-2026-09-29.md`.
- **Not fixed here:** the headroom (about 12–20 s) needs its own measured fix, and a failing resolver job
  should page. See the step 12 receipt's gap note.
