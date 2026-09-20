-- ============================================================================
-- PHASE 6 · GEOGRAPHY HEALTH — observe-only.
--
-- PARKED. NOT APPLIED. Creating these objects arms nothing: there is no cron
-- entry here, no trigger, no call site inside pipeline_health_tick(), and the
-- reconciliation engine is not invoked. Applying this file is a later decision.
--
-- ⚠️ PHASE 6 APPLIED NOTHING TO PRODUCTION. The §11 invariant list permits
-- indexes as the ONLY structural mutation, and the index decision came back
-- BLOCKED BY INGEST HEALTH, so production carries none of this yet.
--
-- ----------------------------------------------------------------------------
-- THE INSTRUMENT DECISION, AND THE TWO CANDIDATES THAT WERE REJECTED
--
-- (1) REJECTED — cumulative `pg_stat_user_tables` write counters.
--     They are free (shared-memory, no heap access) and the delta between two
--     observations is exactly "did this plane progress in that window", so this
--     was the intended design. Measured on 2026-09-19 it does not survive its
--     own control: 85 `geo` relations are tracked and **0 of 85 carry a single
--     recorded write**, while `geo.n5_geom` demonstrably holds 1,209,747 rows
--     that were written by the N5 pipeline. 12 geo relations do show READS, so
--     the schema is tracked; `pg_stat_database.stats_reset` is NULL. The
--     collector's write history for these tables is simply gone.
--     ⇒ **A zero here means "no record of writes", never "no writes."** The
--     absolute value is unusable. A delta would still be valid where no reset
--     intervenes, but it cannot be distinguished from a reset without a stored
--     previous value, and building the primary signal on a counter this
--     database has already lost once is how a frozen pipeline reads green.
--
-- (2) REJECTED — `max(computed_at)` over the resident-facing planes.
--     Honest and crash-safe, and too expensive to run hourly. Measured:
--     `max(computed_at)` on `geo.zip_authoritative_membership` is a PARALLEL
--     SEQ SCAN of 901,465 rows — **841.8 ms, 18,003 buffer reads, all cold**.
--     Three planes per tick is ~2.5 s and ~54,000 buffer reads against a health
--     tick that completes in 0.4 s today, evicting cache on a database whose
--     ingest job spent 3.5 hours degraded earlier the same day. An index on the
--     timestamp column would fix it, and index creation is blocked.
--
-- (3) CHOSEN — the WRITER STAMPS ITS OWN PROGRESS, O(1).
--     The reconciliation engine is the only writer of these planes, so it can
--     record what it did in constant time and health can read it in constant
--     time. No scan of a 2.8M-row corpus, no dependency on a statistics
--     subsystem, no new index. The cost of the health tick does not grow with
--     the corpus, which is the property the earlier anti-join model lacked.
-- ============================================================================

begin;

-- ------------------------------------------------------- 1. progress (O(1))
create table if not exists geo.geography_progress (
  component            text        not null primary key,
  last_batch_at        timestamptz,
  last_success_at      timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  keys_processed_total bigint      not null default 0,
  batches_total        bigint      not null default 0,
  last_run_id          text,
  updated_at           timestamptz not null default now(),
  constraint geography_progress_component_ck
    check (component in ('reconcile','discovery_sweep'))
);
alter table geo.geography_progress enable row level security;

comment on table geo.geography_progress is
  'Phase 6 observe-only. One row per geography component, stamped by that '
  'component in constant time. Health reads this instead of scanning the '
  'authoritative planes: max(computed_at) on one plane measured 841.8 ms / '
  '18,003 cold buffer reads, which an hourly tick cannot afford.';

-- --------------------------------------- 2. the activation boundary (§5)
--
-- STEADY-STATE WORK and HISTORICAL REPAIR BACKLOG are different operational
-- populations and must never be summed. The boundary is the instant the
-- reconciliation engine is first switched on; work arising at or after it is
-- steady state. The historical debt - 53,610 source keys / 124,070 pairs /
-- 141,612 rows / 3,152 ZIP pages / 147 registries, the corrected Phase 0
-- baseline - is NOT in the queue and must not be enqueued to make health aware
-- of it. Health knows it as a CONSTANT recorded here, never as pending work.
create table if not exists geo.geography_activation (
  singleton          boolean     not null primary key default true,
  activated_at       timestamptz,
  historical_keys    bigint      not null default 53610,
  historical_pairs   bigint      not null default 124070,
  historical_rows    bigint      not null default 141612,
  historical_zips    integer     not null default 3152,
  historical_regs    integer     not null default 147,
  backlog_state      text        not null default 'not_started',
  note               text,
  constraint geography_activation_singleton_ck check (singleton),
  constraint geography_activation_backlog_ck
    check (backlog_state in ('not_started','in_progress','complete'))
);
alter table geo.geography_activation enable row level security;
insert into geo.geography_activation (singleton, note)
values (true, 'Phase 6: engine not activated. Historical figures are the corrected '
              'Phase 0 baseline (predB), carried as a CONSTANT and never as queue work.')
on conflict (singleton) do nothing;

comment on table geo.geography_activation is
  'Separates STEADY-STATE work from the HISTORICAL REPAIR BACKLOG. activated_at '
  'NULL means the engine has never run, which is a declared pre-activation state '
  'and is deliberately NOT reported as healthy. The historical counts are a '
  'constant: dumping those 53,610 keys into the work queue would make the '
  'scheduler the backfill mechanism, which is exactly what must not happen.';

-- ------------------------------ 3. observations, so trend needs no scan (§4)
create table if not exists geo.geography_health_observation (
  observed_at        timestamptz not null default now() primary key,
  pending_keys       integer,
  oldest_pending_age interval,
  queue_delta        integer,
  last_success_at    timestamptz,
  last_error_at      timestamptz,
  ingest_fresh_secs  integer,
  state              text        not null,
  detail             text        not null
);
alter table geo.geography_health_observation enable row level security;

create index if not exists geography_health_observation_recent_ix
  on geo.geography_health_observation (observed_at desc);

comment on table geo.geography_health_observation is
  'Append-only. "Is the queue growing or shrinking?" is answered by comparing '
  'the last two rows, so the trend costs two index lookups rather than a scan '
  'of any history.';

-- ================================================================= 4. STATE
--
-- A PURE FUNCTION of scalars. Every branch is testable without touching a
-- plane, a queue, or production - which is why the Phase 6 fixture can prove
-- all eleven required cases without invoking reconciliation even once.
--
-- ⚠️ THRESHOLDS ARE PROVISIONAL AND SAY SO IN THEIR OWN NAME. Phase 5's
-- performance benchmarking is still blocked, so the Phase 7 scheduler interval
-- is not yet chosen. These are derived from a PROVISIONAL 15-minute bounded
-- drain and must be re-derived when that interval is settled. They are
-- deliberately not the old thresholds: the old model measured ROW ARRIVAL on a
-- frozen pipeline, which is the measurement that reported green throughout the
-- incident this workstream exists to fix.
create or replace function geo.geography_health_state(
  _activated_at       timestamptz,
  _pending_keys       integer,
  _oldest_pending_age interval,
  _last_success_at    timestamptz,
  _last_error_at      timestamptz,
  _consecutive_errors integer,
  _queue_growth_windows integer,      -- consecutive observations where the queue grew
  _ingest_active      boolean,
  _now                timestamptz default now(),
  _interval           interval default '15 minutes',   -- PROVISIONAL
  _sla                interval default '24 hours'      -- PROVISIONAL
) returns table (state text, reason text)
language plpgsql immutable parallel safe
set search_path = pg_catalog, pg_temp
as $fn$
begin
  -- (0) NOT ACTIVATED is its own state and is NOT healthy.
  -- A pre-activation system has zero pending work and zero progression, which
  -- is numerically identical to a perfectly idle healthy one. Reporting that as
  -- HEALTHY would mean the monitor says "fine" for the entire period before
  -- anyone turns the engine on - and, if activation is later forgotten, forever.
  if _activated_at is null then
    state := 'NOT_ACTIVATED';
    reason := 'reconciliation engine has never run; geography progression is 0 by '
              'design, not by health';
    return next; return;
  end if;

  -- (1) CRITICAL - repeated failure.
  if coalesce(_consecutive_errors, 0) >= 3 then
    state := 'CRITICAL';
    reason := format('reconciliation failed %s consecutive times (last error %s)',
                     _consecutive_errors, coalesce(_last_error_at::text, 'unknown'));
    return next; return;
  end if;

  -- (2) CRITICAL - work older than the SLA.
  -- 🔑 THIS IS THE RULE THAT STOPS "SUCCESSFUL JOB, ZERO KEYS" READING HEALTHY.
  -- The state is driven by the AGE OF ELIGIBLE WORK, never by the existence of
  -- a recent successful run. A drain that succeeds while claiming nothing is
  -- indistinguishable from a working one if you only look at last_success_at -
  -- and that is precisely the shape of the incident being guarded against.
  if _oldest_pending_age is not null and _oldest_pending_age > _sla then
    state := 'CRITICAL';
    reason := format('oldest pending key is %s old, past the %s SLA (%s pending)',
                     _oldest_pending_age, _sla, coalesce(_pending_keys, 0));
    return next; return;
  end if;

  -- (3) CRITICAL - the queue has grown across many consecutive windows. A
  -- monotonically growing queue is a drain that cannot keep up, whatever its
  -- individual runs report.
  if coalesce(_queue_growth_windows, 0) >= 6 then
    state := 'CRITICAL';
    reason := format('queue grew across %s consecutive observation windows',
                     _queue_growth_windows);
    return next; return;
  end if;

  -- (4) CRITICAL - the frozen-pipeline signature: ingest is producing eligible
  -- work and geography has not completed a batch for many scheduler intervals.
  -- Gated on _ingest_active so a quiet night is never called an outage (case C).
  if _ingest_active and (_last_success_at is null or _last_success_at < _now - (_interval * 8)) then
    state := 'CRITICAL';
    reason := format('ingest is active but reconciliation last succeeded %s (>%s)',
                     coalesce(_last_success_at::text, 'never'), _interval * 8);
    return next; return;
  end if;

  -- (5) WARNING - accumulating beyond scheduler jitter.
  if _oldest_pending_age is not null and _oldest_pending_age > _interval * 4 then
    state := 'WARNING';
    reason := format('oldest pending key is %s old, beyond %s of scheduler jitter (%s pending)',
                     _oldest_pending_age, _interval * 4, coalesce(_pending_keys, 0));
    return next; return;
  end if;

  if coalesce(_queue_growth_windows, 0) >= 3 then
    state := 'WARNING';
    reason := format('queue grew across %s consecutive observation windows',
                     _queue_growth_windows);
    return next; return;
  end if;

  if coalesce(_consecutive_errors, 0) > 0 then
    state := 'WARNING';
    reason := format('reconciliation has %s consecutive failure(s)', _consecutive_errors);
    return next; return;
  end if;

  if _ingest_active and (_last_success_at is null or _last_success_at < _now - (_interval * 3)) then
    state := 'WARNING';
    reason := format('ingest is active but reconciliation last succeeded %s',
                     coalesce(_last_success_at::text, 'never'));
    return next; return;
  end if;

  -- (6) HEALTHY. Reached only when work is not aging, the queue is not growing,
  -- nothing is failing, and - if ingest is active - geography is progressing.
  state := 'HEALTHY';
  reason := format('%s pending, oldest %s, last success %s',
                   coalesce(_pending_keys, 0),
                   coalesce(_oldest_pending_age::text, 'n/a'),
                   coalesce(_last_success_at::text, 'n/a'));
  return next;
end $fn$;
revoke all on function geo.geography_health_state(timestamptz,integer,interval,timestamptz,
  timestamptz,integer,integer,boolean,timestamptz,interval,interval) from public;

commit;

-- ============================================================ 5. REGISTRY HEALTH
--
-- One national number cannot name a failing registry, so health carries a
-- per-registry view. It is bounded because it aggregates the WORK QUEUE (small
-- by design) and never the 2.8M-row planes.
--
-- ⚖️ GOVERNANCE HOLDS ARE NOT PIPELINE FAILURES. Measured from
-- docs/geo-registry-classification.json: 240 registries - PROVEN 145, RECOVERY 78,
-- NOAUTH 7, IDENT_UNRESOLVED 2, HIST_UNRECOVERABLE 1, PENDING_REVIEW 1,
-- BLOCKED_NO_RECORDS 6. Only PROVEN and RECOVERY are PROCESSABLE. The 7 holds
-- (baltimore-city-housing-permits plus the six zero-record registries) are
-- decisions, and a monitor that pages on a decision is a monitor that gets muted.
-- They are reported as HOLD, never as unhealthy, and they are excluded from every
-- national roll-up.
--
-- The three recorded-but-non-processable treatments (NOAUTH, IDENT_UNRESOLVED,
-- HIST_UNRECOVERABLE) are likewise not failures: they are carried in the
-- catalogue and matched by neither association branch, which is the second of
-- Phase 3's two exclusion mechanisms.
begin;

create or replace view geo.v_geography_registry_health
with (security_invoker = true) as
with hold as (
  -- Held registries, named from the catalogue rather than from a list retyped
  -- here. A registry absent from geo.n5_accepted_source has no treatment row,
  -- which is exactly what a governance hold looks like in the database.
  select s.registry_id, s.treatment
    from geo.n5_accepted_source s),
q as (
  select k.registry_id,
         count(*)::int pending_keys,
         max(now() - k.enqueued_at) oldest_pending_age,
         count(*) filter (where k.claimed_at is not null)::int claimed
    from (select q.source_key, q.enqueued_at, q.claimed_at,
                 (select g.registry_id from geo.n5_geom g
                   where g.source_key = q.source_key limit 1) registry_id
            from geo.n5_reconcile_queue q) k
   group by k.registry_id)
select coalesce(h.registry_id, q.registry_id)          as registry_id,
       h.treatment,
       (h.treatment in ('PROVEN','RECOVERY'))          as processable,
       (h.registry_id is null)                         as governance_hold,
       coalesce(q.pending_keys, 0)                     as pending_keys,
       q.oldest_pending_age,
       coalesce(q.claimed, 0)                          as claimed_keys,
       case
         when h.registry_id is null                         then 'HOLD'
         when h.treatment not in ('PROVEN','RECOVERY')       then 'NOT_PROCESSABLE'
         when coalesce(q.pending_keys,0) = 0                 then 'IDLE'
         when q.oldest_pending_age > interval '24 hours'     then 'CRITICAL'
         when q.oldest_pending_age > interval '1 hour'       then 'WARNING'
         else 'WORKING'
       end                                             as registry_state
  from hold h
  full outer join q on q.registry_id = h.registry_id;

comment on view geo.v_geography_registry_health is
  'Per-registry geography health. HOLD and NOT_PROCESSABLE are governance and '
  'classification states, never failures, and are excluded from national '
  'roll-ups. Bounded: aggregates the work queue, never the authoritative planes.';

-- ====================================================== 6. THE PROBE (O(small))
--
-- Assembles the scalars, calls the pure state function, appends one observation,
-- and returns the verdict. READ-ONLY with respect to resident geography: it
-- touches no plane, dispatches nothing, and its only write is its own
-- observation row.
--
-- 🔑 THE QUEUE AGGREGATE IS CAPPED. If the queue is ever larger than
-- _max_scan, the probe does NOT aggregate it - it reports CRITICAL on the size
-- alone. An unbounded count over a runaway queue is how a health check becomes
-- the outage, and a health check that is the outage cannot report it.
create or replace function geo.geography_health_probe(
  _max_scan int default 200000,
  _record   boolean default true
) returns table (state text, reason text, pending_keys integer,
                 oldest_pending_age interval, queue_delta integer)
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
declare
  v_act timestamptz; v_pending int; v_oldest interval;
  v_succ timestamptz; v_err timestamptz; v_errs int;
  v_prev int; v_grow int; v_ingest boolean; v_fresh int;
  v_state text; v_reason text; v_capped boolean := false;
begin
  select a.activated_at into v_act from geo.geography_activation a where a.singleton;

  -- queue size first, capped
  select count(*) into v_pending from (
    select 1 from geo.n5_reconcile_queue limit _max_scan + 1) t;
  if v_pending > _max_scan then
    v_capped := true;
    v_oldest := null;
  else
    select max(now() - q.enqueued_at) into v_oldest
      from geo.n5_reconcile_queue q where q.claimed_at is null;
  end if;

  select p.last_success_at, p.last_error_at into v_succ, v_err
    from geo.geography_progress p where p.component = 'reconcile';

  -- consecutive errors: an error newer than the newest success.
  v_errs := case when v_err is not null and (v_succ is null or v_err > v_succ)
                 then 1 else 0 end;

  -- Ingest activity: development_reports is 12,722 rows, so max(refreshed_at)
  -- here is trivial. The 901k-row planes are deliberately NOT read - see the
  -- rejected-instrument note at the top of this file.
  select extract(epoch from (now() - max(d.refreshed_at)))::int
    into v_fresh from public.development_reports d;
  v_ingest := coalesce(v_fresh, 999999) < 3600;

  -- trend from the previous observation only; no history scan.
  select o.pending_keys into v_prev
    from geo.geography_health_observation o
   order by o.observed_at desc limit 1;

  select coalesce(o.queue_delta, 0) into v_grow
    from geo.geography_health_observation o
   order by o.observed_at desc limit 1;
  v_grow := case when v_prev is not null and v_pending > v_prev
                 then coalesce(v_grow, 0) + 1 else 0 end;

  -- 🔑 RULE (0) OUTRANKS THE SCAN CAP, AND THIS ORDERING IS LOAD-BEARING.
  -- The cap short-circuit used to run FIRST, so a never-activated system whose
  -- queue exceeded _max_scan reported CRITICAL and never reached
  -- geography_health_state, where NOT_ACTIVATED is rule (0). Measured on an
  -- isolated PostgreSQL 2026-09-20: activated_at NULL + 201,001 queued ->
  -- 'CRITICAL: work queue exceeds the 200000 cap'; the same state at 1,000
  -- queued -> 'NOT_ACTIVATED'. Depth alone flipped the verdict.
  --
  -- That path is REACHABLE IN THE PASSIVE-INSTALLED STATE, which is why it is
  -- corrected here rather than logged: once the lifecycle handoffs are installed
  -- the queue converges to ~233,106 keys within one ~53h materializer sweep
  -- (docs/geo-lifecycle-handoff-review.md F1), which is ABOVE the 200,000
  -- default. The monitor would have paged CRITICAL for a system that is
  -- deliberately OFF, within about two days of a passive install - and an alert
  -- that fires for a correct state is how a real one gets ignored later.
  --
  -- NO THRESHOLD IS CHANGED and no state is invented. _max_scan is still 200,000,
  -- the cap still refuses to aggregate, and CRITICAL is unchanged for an ACTIVATED
  -- system. Only the precedence documented in geography_health_state - where
  -- NOT_ACTIVATED is evaluated before every failure rule - is restored to the
  -- probe that wraps it. The capped depth is appended to the reason rather than
  -- discarded, so nothing is hidden.
  if v_act is null then
    select s.state, s.reason into v_state, v_reason
      from geo.geography_health_state(v_act, v_pending, v_oldest, v_succ, v_err,
                                      v_errs, v_grow, v_ingest) s;
    if v_capped then
      v_reason := v_reason
        || format('; queue exceeds the %s scan cap so depth was not aggregated', _max_scan);
    end if;
  elsif v_capped then
    v_state := 'CRITICAL';
    v_reason := format('work queue exceeds the %s cap; refusing to aggregate it', _max_scan);
  else
    select s.state, s.reason into v_state, v_reason
      from geo.geography_health_state(v_act, v_pending, v_oldest, v_succ, v_err,
                                      v_errs, v_grow, v_ingest) s;
  end if;

  if _record then
    insert into geo.geography_health_observation
      (pending_keys, oldest_pending_age, queue_delta, last_success_at,
       last_error_at, ingest_fresh_secs, state, detail)
    values (v_pending, v_oldest, v_grow, v_succ, v_err, v_fresh, v_state, v_reason)
    on conflict (observed_at) do nothing;
  end if;

  return query select v_state, v_reason, v_pending, v_oldest, v_grow;
end $fn$;
revoke all on function geo.geography_health_probe(int, boolean) from public;

commit;

-- ============================================================================
-- 7. INTEGRATION WITH public.pipeline_health_tick()  — §8
--
-- TRACED, NOT ASSUMED (2026-09-19). The live health system is:
--   * public.pipeline_health_tick()  — 11,290 chars, md5 258df595490b81c3dfcc7086cf9f8c39
--   * public.pipeline_health_check   — (check_name, ok, alertable, detail, since,
--                                       last_notified_at, updated_at)
--   * public.pipeline_health_probe
--   * pg_cron 'pipeline-health-monitor', schedule '10 * * * *', last run 19:10Z
--   * 10 checks live; 8 alertable, 2 NOT-ALERTABLE by measurement
--     (government_notice_ingest, meetings_ingest)
--
-- ⚠️ AND THE GAP IS EXACTLY THIS: **no check reports on geography at all**, while
-- `dev_reports_refresh` reads ok=true. It asks "has development_reports been
-- written recently", which stayed TRUE throughout the entire frozen-pipeline
-- incident, because ingest never stopped - only geography did. Row arrival on a
-- neighbouring table is not progression of the thing that froze.
--
-- THE INTEGRATION IS AN ADDITIONAL COMPONENT ON THE EXISTING SURFACE, never a
-- second monitoring system: one more `pipeline_health_check` row named
-- `geography_progression`, written by a block spliced into the existing tick, so
-- the existing Resend transport, the transition-only notify and the 24h dedup all
-- apply unchanged and nobody has to discover a separate dashboard.
--
-- The splice (NOT APPLIED — Phase 6 applies nothing):
--
--   insert into public.pipeline_health_check (check_name, ok, alertable, detail)
--   select 'geography_progression',
--          h.state in ('HEALTHY'),
--          h.state <> 'NOT_ACTIVATED',     -- pre-activation is reported, never paged
--          h.state || ': ' || h.reason
--     from geo.geography_health_probe() h
--   on conflict (check_name) do update
--      set ok = excluded.ok, alertable = excluded.alertable,
--          detail = excluded.detail, updated_at = now(),
--          since = case when public.pipeline_health_check.ok = excluded.ok
--                       then public.pipeline_health_check.since else now() end;
--
-- 🔑 `ok` IS FALSE FOR WARNING AS WELL AS CRITICAL, AND THAT IS DELIBERATE. The
-- existing surface is boolean; mapping WARNING to ok=true would hide the state
-- whose entire purpose is to be seen before CRITICAL. The full state name rides
-- in `detail`, so severity is not lost.
--
-- 🔑 `geography_progression` CAN GO CRITICAL INDEPENDENTLY. It does not read any
-- other check's result and no other check reads it, so a green global result
-- cannot mask it — which is the property the brief asks for by name.
--
-- ⚠️ THE SPLICE MUST BE APPLIED BY SPLICING pg_get_functiondef, NOT BY REPLAYING
-- A DATED FULL `CREATE OR REPLACE` of pipeline_health_tick(). That function lives
-- in the INGEST repo and has been amended there (local_news_heartbeat, 9 checks ->
-- 10); replaying a copy from here would silently revert whatever landed since.
-- Fail closed on the anchor appearing exactly once, and re-read the body after.
-- ============================================================================
