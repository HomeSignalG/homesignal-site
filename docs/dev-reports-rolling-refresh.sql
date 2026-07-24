-- ============================================================================
-- PHASE 1 — BATCHED (ROLLING) development_reports CACHE REFRESH
-- Applied to production 2026-07-24 via MCP migrations
--   `dev_refresh_batched_canary`  (column + workhorse + health receipts)
--   `dev_refresh_rolling_rollout` (combined tick + cron reschedule)
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
--
-- PROBLEM (DB-verified 2026-07-24, before change):
--   development_reports = 12,722 rows; 6,536 stale >2d, 3,314 >7d, oldest
--   2026-07-11. The old dev_refresh_fire() fired net.http_post for ALL rows at
--   once (nightly 09:00); dev_refresh_collect() (09:08) only captured the 200s
--   that answered inside its 20-min window. At 12,722 scale that drained only a
--   few hundred/night (measured 418/19/12/112 over prior 4 nights) while the cron
--   reported success — so most reports drifted stale.
--
-- DESIGN: bounded rolling refresh, oldest-first, self-retrying.
--   * last_refresh_attempt_at (new nullable column) = the in-flight/cooldown claim.
--   * dev_refresh_fire_batch(_batch,_cooldown_min): selects the oldest
--     refreshed_at (NULLS FIRST), FOR UPDATE SKIP LOCKED, LIMIT _batch; ATOMICALLY
--     marks last_refresh_attempt_at=now (claim) via UPDATE ... RETURNING before
--     firing, so a row in flight is never re-selected within _cooldown_min; a
--     failed row keeps its OLD refreshed_at and becomes eligible again after the
--     cooldown (retry). It NEVER writes sites/counts — only dev_refresh_collect()
--     does, on a 200, with the existing per-dimension transient-safe guard — so a
--     failed fire can never overwrite a valid cached report.
--   * dev_refresh_tick(): ONE combined job — collect the prior tick's responses
--     (15-min-old, fully drained), then fire the next batch. Cooldown (20m) >
--     cadence (15m) ⇒ a just-fired batch is never re-fired next tick; failed rows
--     retry after ~2 ticks.
--   * dev_refresh_health(): freshness-based receipts (success = freshness, not
--     cron exit status).
--
-- MEASURED THROUGHPUT + SLA (canary 2026-07-24, batch 350 fired at once):
--   success s = 267/350 = 76.3%; failures = transient 503 (edge cold-start),
--   all retried after cooldown; 350 drained in ~2.5 min; 0 cross-ZIP leakage;
--   0 valid reports overwritten (80 failed-with-content rows untouched; the 3
--   failed-and-empty rows were pre-existing honestly-empty ZIPs).
--   Chosen: 250/tick × 96 ticks/day (every 15 min) = 24,000 attempts/day.
--   Full 12,722 sweep = 12,722 / 0.763 = 16,674 attempts ≈ 16.7h < 24h SLA
--   (worst-case s=0.55 → 23,131 attempts ≈ 23.1h < 24h). Headroom 1.44×.
--
-- ROLLBACK: the old dev_refresh_fire()/dev_refresh_collect() functions are LEFT
-- INTACT. To revert: cron.unschedule('dev-reports-rolling-refresh');
-- cron.schedule('dev-reports-refresh-fire','0 9 * * *','select public.dev_refresh_fire();');
-- cron.schedule('dev-reports-refresh-collect','8 9 * * *','select public.dev_refresh_collect();');
-- The new column/functions are additive and harmless if left in place.
-- ============================================================================

-- ---------- 1. in-flight / cooldown claim column ---------------------------
alter table public.development_reports
  add column if not exists last_refresh_attempt_at timestamptz;

-- ---------- 2. bounded, oldest-first, concurrency-safe fire ----------------
create or replace function public.dev_refresh_fire_batch(_batch int default 250, _cooldown_min int default 20)
returns integer language plpgsql security definer set search_path to 'public','net' as $fn$
declare n integer := 0; r record;
begin
  for r in
    with sel as (
      select zip
      from public.development_reports
      where last_refresh_attempt_at is null
         or last_refresh_attempt_at < now() - make_interval(mins => _cooldown_min)
      order by refreshed_at asc nulls first
      limit _batch
      for update skip locked
    ),
    claimed as (
      update public.development_reports d
        set last_refresh_attempt_at = now()
        from sel where d.zip = sel.zip
        returning d.zip, d.home_lat, d.home_lng
    )
    select zip, home_lat, home_lng from claimed
  loop
    perform net.http_post(
      'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
      jsonb_build_object('zip', r.zip, 'lat', r.home_lat, 'lng', r.home_lng),
      '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 90000);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- ---------- 3. combined tick (collect prior, then fire next) ----------------
create or replace function public.dev_refresh_tick(_batch int default 250, _cooldown_min int default 20)
returns jsonb language plpgsql security definer set search_path to 'public','net' as $fn$
declare _collected int; _fired int;
begin
  _collected := public.dev_refresh_collect();          -- transient-safe upsert (unchanged)
  _fired     := public.dev_refresh_fire_batch(_batch, _cooldown_min);
  return jsonb_build_object('collected', _collected, 'fired', _fired, 'at', now());
end $fn$;

-- ---------- 4. freshness-based operational receipts ------------------------
create or replace function public.dev_refresh_health()
returns jsonb language sql security definer set search_path to 'public','net' as $fn$
  select jsonb_build_object(
    'total',                 count(*),
    'refreshed_24h',         count(*) filter (where refreshed_at >= now()-interval '24 hours'),
    'older_24h',             count(*) filter (where refreshed_at <  now()-interval '24 hours'),
    'older_48h',             count(*) filter (where refreshed_at <  now()-interval '48 hours'),
    'older_7d',              count(*) filter (where refreshed_at <  now()-interval '7 days'),
    'oldest_refreshed_at',   min(refreshed_at),
    'newest_refreshed_at',   max(refreshed_at),
    'full_sweep_lag_hours',  round(extract(epoch from (now()-min(refreshed_at)))/3600.0, 1),
    'in_flight_recent',      count(*) filter (where last_refresh_attempt_at >= now()-interval '30 minutes'),
    'retry_eligible_stale',  count(*) filter (where refreshed_at < now()-interval '48 hours'
                               and (last_refresh_attempt_at is null or last_refresh_attempt_at < now()-interval '30 minutes')),
    'pending_pg_net',        (select count(*) from net.http_request_queue)
  )
  from public.development_reports;
$fn$;

-- ---------- 5. cron: ONE rolling scheduler, retire the two all-at-once jobs --
-- (idempotent to re-apply: cron.schedule upserts by name; unschedule is safe.)
--   select cron.unschedule('dev-reports-refresh-fire');
--   select cron.unschedule('dev-reports-refresh-collect');
--   select cron.schedule('dev-reports-rolling-refresh', '*/15 * * * *', 'select public.dev_refresh_tick();');
--
-- NOTE: dev_refresh_collect() is unchanged; dev_refresh_fire() (0-arg,
-- all-at-once) is retained ONLY for rollback and is no longer scheduled.
-- app-content-refresh (app_refresh_all, 09:20) materialization is untouched.

-- ---------- Reproducible SQL checks (verification) -------------------------
-- oldest-first + bounded:   select public.dev_refresh_fire_batch(1,60); -- fires exactly the single oldest
-- no duplicate in-flight:   two calls within cooldown claim disjoint zip sets
-- collection:               select public.dev_refresh_collect();        -- returns rows updated
-- freshness trend:          select public.dev_refresh_health();         -- older_48h must trend to 0
-- cron uniqueness:          select jobname,schedule from cron.job where command ilike '%dev_refresh%';
