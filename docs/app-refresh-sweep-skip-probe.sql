-- app_refresh_sweep SHADOW SKIP PROBE — instrument first, decide later.
--
-- Founder instruction, 2026-08-19: *"instrument-first, as recommended. Evaluate the skip predicate
-- every tick, log what it WOULD have decided, act on nothing. … Build in the max-age floor from
-- the start. … Log the predicate's three OR branches separately so we learn which one does the
-- work."*
--
-- APPLIED to qwnnmljucajnexpxdgxr on 2026-08-19 as four migrations, in this order:
--   1. app_skip_probe_tables
--   2. app_skip_probe_fingerprint_and_predicate
--   3. app_skip_probe_recorder
--   4. app_refresh_sweep_shadow_probe          (the programmatic patch to the sweep)
-- Background and the cost measurements this answers: docs/app-refresh-sweep-churn-investigation.md
--
-- ⛔ NOTHING IS SKIPPED. Every ZIP is still materialised on the normal ~4h rotation. The predicate
-- is evaluated and its verdict recorded; the verdict drives nothing. Residents see no change.
--
-- KILL SWITCH: `update public.app_flags set enabled=false where name='sweep_skip_probe';`
-- Probing stops on the next tick, no migration. The flag is read ONCE per sweep call, not per ZIP
-- — a kill switch that costs something per row becomes a reason not to have one.

-- ─────────────────────────────────────────────────────────────────────────────
-- WHY THERE IS A STATE TABLE AND NOT JUST COUNTERS — the simulation is the point
--
-- Evaluating the predicate against the REAL last-refresh time answers the wrong question. In the
-- real world every ZIP is refreshed every ~4h, so "has the cache moved since 4h ago?" is not what
-- a skipping world would ask. `app_skip_probe_state.last_would_refresh_at` carries the timeline
-- the ZIP WOULD have had if we had been acting on the predicate, and every branch is measured
-- against THAT.
--
-- Without it two things break:
--   • The max-age floor could never bind. A 24h floor never fires on a 4h rotation, so it would
--     read 0 forever and we would learn nothing about the one guarantee we are building in.
--   • The cache branch would be measured over a 4h interval instead of the (longer) interval a
--     skipping world would actually accumulate over, understating how often it fires.

create table if not exists public.app_skip_probe_state (
  zip                   text primary key,
  last_would_refresh_at timestamptz not null,
  evaluations           bigint not null default 0,
  would_skips           bigint not null default 0,
  wrong_skips           bigint not null default 0,
  updated_at            timestamptz not null default now()
);

create table if not exists public.app_skip_probe_rollup (
  bucket                 timestamptz primary key,
  n_evaluated            bigint not null default 0,
  n_would_skip           bigint not null default 0,
  n_changed              bigint not null default 0,
  n_wrong_skip           bigint not null default 0,
  n_right_skip           bigint not null default 0,
  n_branch_cache         bigint not null default 0,
  n_branch_upstream      bigint not null default 0,
  n_branch_time          bigint not null default 0,
  n_floor_forced         bigint not null default 0,
  n_time_day_rollover    bigint not null default 0,
  n_time_meeting_crossed bigint not null default 0,
  n_time_alert_aged      bigint not null default 0,
  n_never_materialized   bigint not null default 0,
  n_probe_errors         bigint not null default 0,
  updated_at             timestamptz not null default now()
);

create table if not exists public.app_skip_probe_wrong (
  id                 bigserial primary key,
  zip                text not null,
  observed_at        timestamptz not null default now(),
  predicate          jsonb not null,
  changed_components text[] not null,
  fp_before          jsonb not null,
  fp_after           jsonb not null
);
create index if not exists app_skip_probe_wrong_observed_idx on public.app_skip_probe_wrong (observed_at desc);

-- RLS enabled with NO policies on all three: operator instrumentation, not page data.

-- ─────────────────────────────────────────────────────────────────────────────
-- THE WRONG-SKIP AUDIT IS 100%, NOT A SAMPLE
--
-- The original proposal was a 25-ZIP-per-tick shadow sample. It is not needed: because nothing is
-- actually skipped, the real refresh runs for EVERY ZIP anyway, so every ZIP on every tick is its
-- own test case. Fingerprint before, refresh, fingerprint after — if the predicate said "skip" and
-- the fingerprint moved, that is a wrong skip, measured rather than estimated. This is only
-- possible while the predicate is acted on by nothing; it is a property of instrument-first that a
-- skip-first rollout would have thrown away.

-- FINGERPRINT — order-independent sum (CLAUDE.md rule 9's own recommended form). Addition
-- commutes, so no sort happens and no database collation can enter the comparison.
--
-- Exclusions and why each one:
--   app_projects.id             uuid; a delete+reinsert under the same natural key would churn it
--   app_projects.last_seen_at   THE HEARTBEAT — changes every pass by construction. Leaving it in
--                               would make every ZIP read as "changed" and the whole measurement
--                               would be a tautology that always reports 100% wrong skips.
--   app_changes.id, created_at  app_refresh_zip DELETEs and rebuilds every app_changes row for the
--                               ZIP, so both are new every pass regardless of content.
--   app_community_meta.updated_at   same heartbeat class.
-- `provenance` is deliberately KEPT despite carrying refreshed_at: it only moves when the cache
-- moves, which the cache branch already catches, so it cannot manufacture a false wrong skip.
--
--   create function public.app_zip_fingerprint(_zip text) returns jsonb  -- {projects, changes, meta}

-- ─────────────────────────────────────────────────────────────────────────────
-- THE PREDICATE — three OR branches plus a floor, each reported separately
--
--   create function public.app_skip_predicate(_zip text, _floor_hours int default 24) returns jsonb
--
--   BRANCH 1 cache     development_reports.refreshed_at > sim_last
--                      Cheap: that table's heap is 15 MB — the multi-MB `sites` jsonb is TOASTed
--                      out of line, so reading the scalar never touches it.
--   BRANCH 2 upstream  an alerts or meetings row created for this ZIP's chain root since sim_last
--   BRANCH 3 time      day_rollover  — occurred_at uses current_date in three inserts
--                      meeting_crossed — a meeting that was upcoming at sim_last no longer is
--                      alert_aged_out  — an alert that was inside the 14-day window no longer is
--   FLOOR              sim_last < now() - 24h. NOT a branch — a GUARANTEE. It is the only one of
--                      the four failure modes that is PREVENTED rather than merely detected, which
--                      is why it is built in from the start rather than added once skipping ships.
--
--   would_skip = NOT (cache OR upstream OR time OR floor)
--
-- A ZIP never materialised is counted in its own `n_never_materialized` bucket rather than folded
-- into "would refresh" — otherwise a cold start would read as the predicate doing useful work.

-- ⚠️ KNOWN LIMITATION, recorded rather than papered over: neither `alerts` nor `meetings` carries
-- an `updated_at` column. The upstream branch therefore sees INSERTS ONLY. An in-place UPDATE to
-- an existing row — the ingest repo's category backfill is exactly this shape — is invisible to
-- it. Any real skipping would need that column added upstream FIRST. This does not affect the
-- shadow measurement's honesty (a missed update shows up as a wrong skip, which is the point), but
-- it does mean the upstream branch understates how often a refresh is genuinely needed.

-- ─────────────────────────────────────────────────────────────────────────────
-- READ IT WITH:  select * from public.v_app_skip_probe;
--
-- `pct_would_have_been_wrong` (n_wrong_skip / n_would_skip) is the headline.
--
-- ⚠️ THE `representativeness` COLUMN IS NOT DECORATION. It counts the alerts and meetings actually
-- written in each bucket and marks hours with zero as "NO INGEST — upstream branch unmeasured this
-- hour". In such an hour the upstream branch reads 0 for reasons that have nothing to do with the
-- predicate, and a would-skip rate computed over those hours is an overestimate. It is computed at
-- READ time, from the source tables, so it cannot go stale — and it is a column rather than a
-- footnote because a footnote is what gets skipped.
--
-- This matters immediately: at the time the probe was armed the ingest engine had written NOTHING
-- for 21.6 hours (newest alerts.created_at 2026-08-18 20:04, newest meetings.created_at
-- 2026-08-18 18:12, and 0 rows of either since 2026-08-18 21:00). The rolling-24h counts still
-- read 151 alerts / 188 meetings, but every one of those rows predates the gap — they were aging
-- OUT of the window, not arriving in it. Do not read a would-skip rate from those hours.

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THE SHADOW RUN STILL CANNOT MEASURE
--
-- Nothing here observes the SECOND-ORDER effect of skipping: with a 4h rotation and ~1,098 ZIPs
-- per 100s tick, the sweep is budget-limited, so skipping would not merely do less work — it would
-- let the rotation reach more ZIPs per tick and shorten the pass. That feedback loop changes the
-- intervals every branch is measured over, and a shadow run holds the rotation fixed. Treat the
-- measured would-skip rate as a first-order estimate, not a prediction of steady state.

-- ─────────────────────────────────────────────────────────────────────────────
-- THE SWEEP PATCH
--
-- app_refresh_sweep is patched PROGRAMMATICALLY from its own deployed text (rule 7) against four
-- anchors, each asserted to appear exactly once, with a ROUND-TRIP identity check: stripping the
-- added blocks from the deployed body must reproduce the original byte for byte.
--
-- Two properties of the splice that are load-bearing:
--   • The before-probe and after-probe halves ride on the SAME anchor, so no future edit can
--     splice them apart and leave a fingerprint taken but never compared.
--   • Both halves sit inside their own BEGIN/EXCEPTION blocks. A probe fault must never reach the
--     sweep's own handler, which would record it as a REFRESH failure and corrupt the escalation
--     state (`app_refresh_failures.consecutive` → `escalated`) that the sweep's ordering depends
--     on. Probe errors are counted into n_probe_errors instead — never swallowed silently, because
--     a zero wrong-skip rate next to a non-zero error count is not a clean result.
--
-- ⚠️ A TICK IN FLIGHT BELONGS TO THE CODE IT STARTED WITH. The 17:45 tick began before this patch
-- landed and wrote no probe rows; 18:00 was the first probed tick. A zero in the first bucket is
-- ordering, not a fault.
