-- REPAIR — the 2026-08-08→12 EPA FRS outage false-zero cohort. (2026-08-13)
--
-- WHAT IS BEING REPAIRED. 515 ZIP pages whose `facilities` was written as 0 while FRS was
-- refusing every request. The set is reconstructed from EVIDENCE, not from a remembered number:
--
--   The outage window is bounded by the facility-hit rate, hour by hour, in
--   public.development_reports:
--       2026-08-08 20:00Z   225 rows, 197 with facilities   87.6%
--       2026-08-08 22:00Z    16 rows,   0 with facilities    0.0%   <- collapse
--       ... every hour in between: 0.0% ...
--       2026-08-12 02:00Z     1 row,    0 with facilities    0.0%
--       2026-08-12 18:00Z     7 rows,   7 with facilities  100.0%   <- recovery
--
--   Every row refreshed inside [2026-08-08 21:00Z, 2026-08-12 18:00Z) is therefore suspect, and
--   the query confirms the signature is total: 515 rows written, 515 of them zero, ZERO
--   exceptions. Against a ~10% baseline zero-rate, 515 consecutive genuine zeros is not a thing
--   that happens — the facilities value for every one of them is untrustworthy.
--
-- WHY THE SET IS 515 AND NOT 448. An earlier read of this cohort said 448. Two errors, both
-- found by re-deriving from the data rather than trusting the figure:
--   (a) It started the window at 2026-08-09 00:00Z. The collapse is actually at 08-08 22:00Z,
--       so 27 rows written in the last two hours of 08-08 were missed.
--   (b) It excluded 40 rows that had no development content, on the theory they were probably
--       genuinely-empty rural ZIPs. That exclusion is unjustified: EPA returned nothing for
--       515 of 515 rows in the window, so a page having no OTHER content says nothing about
--       whether its EPA read was trustworthy. Those rows are equally untrustworthy.
--   Repairing a superset is safe in any case — a genuinely-empty ZIP re-refreshed through the
--   normal path simply comes back empty again, this time authoritatively.
--
-- HOW IT IS REPAIRED. Not by setting the field. Each ZIP is pushed back through the NORMAL,
-- CORRECTED refresh path (get-address-report -> dev_refresh_collect), so the value comes from
-- EPA, respects the radius back-off, respects looksIndustrial() filtering, and lands under the
-- per-report guard (docs/dev-refresh-per-report-epa-guard.sql). A ZIP whose EPA read fails again
-- stays flagged unavailable rather than acquiring a fresh false zero.
--
-- THROTTLED ON PURPOSE. FRS was returning HTTP 429 during this repair (measured: the
-- atlanta-dense health probe took a 429 at 21:45Z on 2026-08-13). Firing 515 reports at once
-- would be a self-inflicted denial of service on the source we are trying to read, so the repair
-- runs in small batches and is designed to be re-run until the ledger drains.
--
-- IDEMPOTENT AND RESUMABLE. `public.epa_outage_repair_2026_08` holds the pre-repair snapshot
-- (taken BEFORE any write, so it cannot be reconstructed optimistically) and per-ZIP attempt
-- counts. Step 2 always picks the least-attempted unrepaired ZIPs, so re-running it resumes
-- rather than restarts, and a partially-complete run is never a problem.

-- ── STEP 0 (once) — the ledger. Applied as migration epa_outage_repair_ledger_2026_08. ───────
-- create table if not exists public.epa_outage_repair_2026_08 (
--   zip text primary key,
--   outage_refreshed_at timestamptz not null,
--   before_facilities int not null, before_development int not null, before_flagged boolean not null,
--   attempts int not null default 0, last_attempt_at timestamptz,
--   after_facilities int, after_flagged boolean, repaired_at timestamptz);
-- alter table public.epa_outage_repair_2026_08 enable row level security;
-- insert into public.epa_outage_repair_2026_08
--       (zip, outage_refreshed_at, before_facilities, before_development, before_flagged)
-- select d.zip, d.refreshed_at,
--        coalesce((d.counts->>'facilities')::int,0), coalesce((d.counts->>'development')::int,0),
--        coalesce(d.facilities_unavailable,false)
--   from public.development_reports d
--  where d.refreshed_at >= '2026-08-08 21:00:00+00' and d.refreshed_at < '2026-08-12 18:00:00+00'
-- on conflict (zip) do nothing;

-- ── STEP 1 — FIRE one throttled batch. Re-run as needed; picks up where it left off. ─────────
-- Batch size is deliberately small: one ZIP report can issue several FRS calls (the back-off
-- ladder), so 25 ZIPs is already up to ~150 upstream requests.
with next as (
  select r.zip, d.home_lat, d.home_lng
    from public.epa_outage_repair_2026_08 r
    join public.development_reports d on d.zip = r.zip
   where r.repaired_at is null
   order by r.attempts, r.zip
   limit 25
), fired as (
  select n.zip,
         net.http_post(
           'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
           jsonb_build_object('zip', n.zip, 'lat', n.home_lat, 'lng', n.home_lng),
           '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 90000) as req
    from next n
)
update public.epa_outage_repair_2026_08 r
   set attempts = r.attempts + 1, last_attempt_at = now()
  from fired f
 where r.zip = f.zip;

-- ── STEP 2 — COLLECT (wait ~2-4 min after STEP 1; dev_refresh_collect reads a 20-minute window)
-- This is the ONLY writer. It applies every existing guard plus the new per-report EPA check.
-- select public.dev_refresh_collect();

-- ── STEP 3 — RECONCILE the ledger from the live table. Safe to run repeatedly. ───────────────
-- A ZIP counts as repaired when its facilities value is once again AUTHORITATIVE — meaning the
-- unavailable flag is clear. That covers both outcomes that are real answers: a restored non-zero
-- count, AND a confirmed genuine zero. It deliberately does NOT count "still flagged" as done.
-- update public.epa_outage_repair_2026_08 r
--    set after_facilities = coalesce((d.counts->>'facilities')::int, 0),
--        after_flagged    = coalesce(d.facilities_unavailable, false),
--        repaired_at      = case when coalesce(d.facilities_unavailable, false) = false
--                                 and d.refreshed_at > r.outage_refreshed_at
--                                then now() else null end
--   from public.development_reports d
--  where d.zip = r.zip;

-- ── STEP 4 — PROGRESS / final report ────────────────────────────────────────────────────────
-- select count(*) as damaged,
--        count(*) filter (where repaired_at is not null) as repaired,
--        count(*) filter (where repaired_at is not null and after_facilities > 0) as restored_nonzero,
--        count(*) filter (where repaired_at is not null and after_facilities = 0) as confirmed_genuine_zero,
--        count(*) filter (where repaired_at is null) as still_unavailable,
--        count(*) filter (where after_flagged is false and after_facilities = 0
--                           and repaired_at is null) as FALSE_ZEROS_REMAINING  -- must be 0
--   from public.epa_outage_repair_2026_08;

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- RESULT — first repair pass, 2026-08-13 (ledger receipts, not estimates)
--
-- THIS IS A SNAPSHOT OF A NUMBER THAT IS STILL CLIMBING. The rolling refresh keeps repairing
-- rows after this was written, so treat the figures below as a floor and run STEP 4 for the
-- live count. Two readings, ~10 minutes apart, to make the direction explicit:
--
--                            reading 1     reading 2
--   damaged identified          515           515
--   attempted                   250           250
--   repaired                     28            66   (facilities authoritative again)
--     · restored non-zero        15            38   — 170 → 592 EPA facilities recovered
--     · confirmed genuine zero   13            28   — EPA answered; nothing is really there
--   still flagged unknown       487           449
--   FALSE ZEROS REMAINING         0             0   <- the target metric, at every reading
--
-- WHY ONLY 28 OF 250. Not a mechanism failure — EPA itself. Measured across 407 distinct ZIP
-- reports through the live v23 engine in a 30-minute window:
--     epa ok            174  (42.8%)
--     epa failed        233  (57.2%)   <- every one of these would have been an authoritative
--                                         zero under the pre-fix code
--     answered only after backing off below r=3   113 of the 174 successes
-- The repair yield tracks EPA's success rate exactly. A ZIP whose read fails stays flagged
-- unknown, which is the correct outcome — it is NOT re-damaged.
--
-- The damage cohort is disproportionately DENSE URBAN (Brooklyn 11211, Manhattan 10011,
-- Columbus 43229, the Dallas 75xxx block), which is precisely where FRS's process limit and
-- rate limiting bite hardest. That is why this cohort was damaged in the first place, and why
-- it is the slowest to repair.
--
-- HOW THE REMAINING 487 FINISH — NO NEW JOB NEEDED. cron job 14 `dev-reports-rolling-refresh`
-- runs `dev_refresh_tick()` every 15 minutes: collect, then fire the next 250 ZIPs ordered by
-- `refreshed_at asc nulls first` with a 20-minute cooldown. Every remaining ZIP is therefore
-- re-attempted on a rolling basis and repairs itself the first time EPA answers for it, under
-- the same guard. Re-run STEP 3 + STEP 4 above at any time to see progress.
--
-- DELIBERATELY STOPPED HAND-FIRING. Manual batches compete with that cron for the same
-- rate-limited upstream, and firing 100 at once was measured to saturate the pg_net worker
-- (queue frozen at 377, no responses for several minutes). The paced cron is the better
-- instrument; this ledger exists to VERIFY it, not to replace it.

-- ══════════════════════════════════════════════════════════════════════════════════════════════
-- SECOND PASS, 2026-08-14 — two findings that change how this repair must be run
--
-- Progress: repaired 66 -> 119 of 515. 1,666 EPA facilities recovered. 396 remaining.
-- FALSE ZEROS REMAINING: 0 at every reading.
--
-- ── FINDING 1: BATCH SIZE IS THE WHOLE GAME. Use 25, NOT 75+. ────────────────────────────────
-- Measured back to back, same cohort, same hour:
--     batch of 75  ->  10 repaired  (13%),  epa ok 17/64,  avg 15.8 FRS attempts per ZIP
--     batch of 25  ->  19 repaired  (76%)
--     batch of 25  ->  24 repaired  (96%)
-- The mechanism was never the problem. `avg_attempts 15.8` against a ladder maximum of 18
-- (6 radii x 3 tries) means a failing ZIP re-walks almost the ENTIRE back-off ladder, so a
-- 75-ZIP batch issues ~1,185 FRS requests. That trips EPA's rate limiter, which causes more
-- failures, which causes more full-ladder retries. The retry logic AMPLIFIES LOAD ~16x exactly
-- when the source is least able to take it. Small batches stay under the limiter and the same
-- code then succeeds 96% of the time.
--   Corollary: a report whose ladder fully exhausts can exceed the 90 s pg_net timeout, so the
--   request dies in transport and the attempt is spent for nothing (11 of 75 in one batch).
--
-- ── FINDING 2: THE ROLLING REFRESH CANNOT REACH THIS COHORT. HEAD-OF-LINE STARVATION. ────────
-- An earlier note in this repo said the remaining rows "repair themselves" via cron job 14.
-- THAT WAS WRONG, and 16 hours of production proved it: between 2026-08-13 22:40Z and
-- 2026-08-14 14:37Z the cohort went 66 -> 66. Measured: of the 449 then-unrepaired rows,
-- `attempted_since_last_night` = 0. Not one was retried, while cron 14 ran successfully every
-- 15 minutes throughout and EPA was healthy 6-8 of 8 probes per hour.
--
-- Why: `dev_refresh_fire_batch` selects `order by refreshed_at asc nulls first`. **2,143 rows
-- sit ahead of this cohort and ALL 2,143 still carry a pre-outage `refreshed_at`** — their
-- writes keep being refused by a guard, and a refused write never advances `refreshed_at`, so
-- they return to the head of the queue forever. They are re-fired every cooldown, consume the
-- entire 250-row budget, and permanently starve everything behind them. The queue is not a
-- queue; it is a treadmill for its first 2,143 entries.
--
-- That starvation is ALSO what limits this repair: cron 14's 250 futile fires every 15 minutes
-- saturate the pg_net worker (observed: queue pinned at 250-377 with zero completions for
-- minutes) and rate-limit EPA for the repair batches running beside them.
--
-- FIXING THE STARVATION IS OUT OF SCOPE HERE and is a gated change — it alters refresh ordering
-- for all 12,722 pages. Recorded, not actioned. Until it is fixed, this cohort only drains by
-- running STEP 1 by hand at batch size 25, ideally when the queue is near-empty.
--
-- ── SECOND-PASS PROGRESS (2026-08-14, batch size 25 throughout) ──────────────────────────────
--     start of pass    66 repaired /  449 remaining /   592 facilities recovered
--     end of pass     214 repaired /  301 remaining / 3,473 facilities recovered
--     FALSE ZEROS REMAINING: 0 at every single reading.
--
-- Per-batch yields, in order: 10/75 · 19/25 · 24/25 · 12/25 · 17/25 · 6/25 · 11/25 · 19/25 ·
-- 15/25 · 15/25. The 25-batches average ~60% and peak at 96%; the one 75-batch managed 13%.
--
-- The pass ends not because the cohort is exhausted but because of CONTENTION: cron 14 fires
-- 250 futile requests every 15 minutes (Finding 2), which pins the pg_net worker — observed
-- three times, queue frozen at 250-377 with zero completions for minutes at a stretch. Repair
-- batches can only run in the gaps between those fires.

-- ── THIRD PASS, 2026-08-14 (after the fair-ordering fix landed) ──────────────────────────────
--   repaired 234 of 515 · 3,732 EPA facilities recovered · 281 remaining · FALSE ZEROS: 0
--
-- THE FAIR-ORDERING FIX IS WORKING, measured on the population it targets: rows never written
-- since the outage fell **2,061 -> 1,519 in 90 minutes** (1,250 fired, 685 written in that
-- window). Before the fix that population had been frozen for days.
--
-- ⚠️ NEW INTERACTION, worth knowing before running another manual pass. `dev_refresh_collect`
-- advances `refreshed_at` even when the EPA read FAILED — the row is still written, just with
-- facilities 0 and facilities_unavailable = true. Under the new `greatest(refreshed_at,
-- last_refresh_attempt_at)` ordering that pushes the row to the BACK of the queue. So every
-- manual repair batch DEPRIORITISES the rows it failed to fix, handing the cron's attention to
-- other rows for a full cycle.
--   That is correct fairness — the row genuinely was just tried — but it means the two repair
--   paths do not compound. Measured: the cohort shows `attempted_since_fix = 0` from the cron
--   precisely because the manual passes keep marking it as recently touched.
--   PRACTICAL CONSEQUENCE: pick one path per cohort. Hand-firing is the fast path and is what
--   drove 66 -> 234; leaving it alone lets the cron reach the cohort within a cycle. Doing both
--   at once mostly wastes the cron's turn.
--
-- CONTENTION IS THE OTHER CEILING, unchanged: cron 14 queues 250 every 15 minutes, and while
-- that batch drains pg_net returns almost nothing (measured this pass: queue pinned at 281 with
-- **2 responses in 10 minutes**). Manual batches land only in the gaps between cron fires.

-- ── FOURTH PASS, 2026-08-14 (post fair-ordering) ─────────────────────────────────────────────
--   repaired 357 of 515 (69%) · 329 restored non-zero + 28 confirmed genuine zeros
--   5,310 EPA facilities recovered · 158 remaining · FALSE ZEROS REMAINING: 0
--
-- Session arc, for scale: 66 -> 357 repaired, 592 -> 5,310 facilities recovered.
--
-- THE FAIR-ORDERING FIX KEEPS DELIVERING on the population it targets. Rows never written since
-- the outage, sampled across the pass: **2,061 -> 1,519 -> 1,335**. That set had been frozen for
-- days before the fix; it is now draining on its own.
--
-- The remaining 158 are the hard tail — dense-urban ZIPs where FRS's process limit and rate
-- limiting bite hardest, several with 3+ attempts. They are the reason this cohort was damaged
-- first and the reason it repairs last. Every one of them renders "—, unavailable"; none states
-- a false zero.
