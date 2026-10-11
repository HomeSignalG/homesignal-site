# Collector incident — `dev_refresh_collect` fails in 7–9 tick runs (2026-10-11)

**STATUS: INVESTIGATION RECORD. NOTHING WAS CHANGED.** No second collector, no second scheduler, no timeout change, no rewrite.
Read-only measurements against production, 2026-10-11 ~18:30 UTC. This is deliberately **separate** from the geographic
(PR A) and historical-ledger (PR B) work: it is a national reliability incident and a canary cannot pass on its own account.

## What is measured (each number beside its query's shape)

| fact | evidence |
|---|---|
| job 14 `dev-reports-rolling-refresh` (`*/2`, `dev_refresh_tick(8,20)`) fails in **runs**: 9 → 7 → 7 consecutive failed ticks, each **120.0–142 s**, then **48–53 consecutive successes**, repeating roughly every 2 h | `cron.job_run_details`, run-length grouping, 17:26, 15:34, 13:34 starts |
| every failure is `canceling statement due to statement timeout` inside the **step (d) `UPDATE public.development_reports`** (the `with resp … update` statement) | `return_message` of the newest failure |
| the run of failures ends at the **same minute the offending responses age out of the 20-minute window** (17:24:25 burst → first success 17:44:24) | response `created` vs first success |
| during the 17:26–17:44 failure run **every other cron job succeeded in ≤ 1 s** (one at 109 s) — this is not a database-wide stall | `cron.job_run_details`, all jobs 17:20–17:50 |
| a tick that fails rolls back **everything**: the cursor (`last_collected_response_id`) does not move, so the next tick selects the **same 16 oldest uncollected responses** (`order by c.id limit 16`) and fails again | `dev_refresh_collect` lines 80–94 |
| consequence: of **1,229** ZIPs fired in the 6 h pg_net retains, **68 (5.5 %)** had their newest response age out **never collected** (first lost 13:28Z, last 17:24Z) | `net._http_response` ∖ `development_reports.last_collected_response_id` |
| the verification gate catches exactly this: for ZIP 11379 (response 37878, from the stuck burst) the response **exists (HTTP 200)** but `last_collected_response_id < response id` and `refreshed_at` did not advance | `scripts/verify-canary-collection.sql` run read-only |

## What was ruled out, by measurement (so nobody re-runs it)

| suspect | measured cost | verdict |
|---|---|---|
| the response selector (`distinct on (content::jsonb->>'zip')` over the 20-min window) | **0.37 s** for 91 responses | not it |
| `dev_failed_sources` / `dev_retired_sources` CTEs for the 16 **largest** responses | **0.34 s** | not it |
| the `sites` rebuild expression (3 `jsonb_array_elements` passes + `dev_echo_merge_facility_sites`) on the largest response (82801, 2,545 sites, 2.6 MB) | **0.26 s** | not it |
| the Fix 28 BEFORE-UPDATE trigger `dev_reports_enforce_dc_zip_membership`, pass 2 (full predicate on every site) on 02141 (1,954 sites) | **0.69 s** | not it |

⚠️ **A measurement of mine was wrong and is retracted.** A first query that fed the ZIP's geometry through a `Sort`
reported "28 s for two ZIPs", which looked like a smoking gun on the trigger. The geometry was being re-detoasted into every
sort tuple; with the geometry fetched once (as the trigger's `v_geom` variable does) the same work is 0.69 s. The 28 s was the
instrument. No conclusion rests on it.

## What is NOT known

**The statement that exceeds 120 s has not been isolated.** Every component that can be timed read-only is sub-second, so the
remaining candidates are (a) a row-lock wait on a `development_reports` row held by another session, or (b) a payload-specific
path in the UPDATE that read-only replays do not reproduce. The head-of-line pattern says one response (or one row) in the batch
poisons the whole statement. This cannot be settled without capturing a failing tick.

## Proposed next steps — each separately approvable, in order

1. **Observability only (no behaviour change).** On tick failure, record the `_ids` set, the per-response size, and
   `pg_locks`/`pg_stat_activity` wait events into an append-only diagnostics table. One failing run isolates (a) vs (b).
   Needs a splice of the live `dev_refresh_collect` / `dev_refresh_tick` bodies (fingerprinted, like docs/dev-change-recovery.sql).
2. **Only then** a fix chosen by the evidence — e.g. if a single response is the poison, process responses with a per-ZIP
   exception handler that quarantines the failing response id and advances the cursor for the rest. That is a behaviour
   change (a rejected response would stop being retried) and needs its own approval. A bigger statement timeout or a
   different batch size would be a blind change and is **not** proposed.
3. The geographic canary does not pass until `scripts/verify-canary-collection.sql` is all-true for the canary ZIP's request.
   Note the geographic work **adds** cache payload (recovered records) to a collector that already loses ~5 % of fires:
   national rollout of the scope needs separate collector-capacity approval, as already required.

## The canary collection gate

`scripts/verify-canary-collection.sql` (read-only). Pass = all of: the response to **this** fire exists (HTTP 200); the ZIP's
`last_collected_response_id` ≥ that response id; `refreshed_at` > the fire instant; no `blocked_update` failure rows since the
fire; materialised `app_projects` rows at/after the new `refreshed_at`; and then the recovered `source_key`s compared **by key**.
HTTP 200, a green workflow, or unrelated successful ticks are not evidence.
