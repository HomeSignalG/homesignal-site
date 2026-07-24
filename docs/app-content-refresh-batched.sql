-- ============================================================================
-- MATERIALIZATION TIMEOUT REMEDIATION (P0) — batched, resumable app-content-refresh
-- Applied to production 2026-07-24 via MCP migrations
--   `app_refresh_batch_canary`            (the bounded batch function)
--   `app_content_refresh_batched_rollout` (cron reschedule)
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
--
-- ROOT CAUSE (DB-verified 2026-07-24, not assumed):
--   `app_refresh_all()` loops the FULL candidate union (12,722 ZIPs) calling
--   app_refresh_zip(zip) for each, in ONE transaction under the role's
--   statement_timeout = 2min. As Phase 1's rolling refresh grew the cache
--   (development_reports.sites 686K → 756K elements; dense-metro ZIPs ballooned —
--   Cleveland 44127 now 5,464 sites, materialized through dev_sites_deduped 6×),
--   total runtime crept over 120s. The 2026-07-24 09:20 run hit
--   "canceling statement due to statement timeout" and ROLLED BACK cleanly (no
--   partial write; app_projects stayed at the 07-23 vintage), so page markers
--   stopped updating. Prior daily runs: 07-22 51s, 07-23 60s, 07-24 FAILED @120s.
--
-- MEASUREMENTS (EXPLAIN ANALYZE, idempotent):
--   worst single ZIP (44127, 5,464 sites): 466 ms
--   typical ZIP (84302 / 35801): 23–29 ms standalone (~5–8 ms warm-loop)
--   ALL 142 ZIPs with >1000 sites, in one shot: 22.3 s  ← absolute worst-case batch ceiling
--   app_refresh_batch(1500): ~12 s
--   => even if every big ZIP clustered into one batch: ~33 s ≪ 120 s.
--   Full 12,722 sweep ≈ 9 batches ≈ 102 s of total work.
--
-- FIX (smallest production-safe change; preferred batching, no timeout increase):
--   app_refresh_batch(_batch) materializes the _batch candidate ZIPs with the
--   OLDEST app_community_meta.updated_at (nulls first → new/never-materialized ZIPs
--   first). One bounded transaction per call:
--     * no partial writes — an interrupted batch rolls back wholesale;
--     * resumable — updated_at only advances on commit, so the next call re-selects
--       the same batch after an interruption, and advances past it after success
--       (app_refresh_zip stamps updated_at=now(), the cursor);
--     * identical page output — same candidate union + same per-ZIP app_refresh_zip
--       as app_refresh_all(); byte-identical app_projects/app_changes/app_community_meta.
--   app_refresh_all() is LEFT INTACT for rollback + manual full runs.
--
-- CADENCE: the daily 09:20 app_refresh_all() job is replaced (same job name —
--   one materialization scheduler) with hourly app_refresh_batch(1500) at :40
--   (off the digest :00 and the Phase-1 */15 ticks). Full sweep ≈ 9 batches ⇒
--   ~2–3 complete sweeps/day; every ZIP re-materialized within ~9h. Each tick
--   ~12–33 s, far under the 120 s statement_timeout.
--
-- NOT CHANGED: Phase 1 (dev-reports-rolling-refresh */15 → dev_refresh_tick),
--   Phase 2 (app_coverage_states view), app_refresh_zip, the page contracts, Maps.
--
-- ROLLBACK: cron.schedule('app-content-refresh','20 9 * * *',
--   'select public.app_refresh_all();'); app_refresh_all() is unchanged, so this
--   restores the exact prior daily behavior. The added app_refresh_batch function
--   is additive/inert if left in place.
-- ============================================================================

create or replace function public.app_refresh_batch(_batch int default 1500)
returns integer language plpgsql as $fn$
declare n int := 0; r record;
begin
  for r in
    select cand.zip
    from (
      select z.zip from public.communities c, unnest(c.zip_codes) as z(zip) where c.level='zip'
      union
      select zip from public.development_reports
      union
      select zip from public.app_community_meta
    ) cand
    left join public.app_community_meta m on m.zip = cand.zip
    order by m.updated_at asc nulls first, cand.zip
    limit _batch
  loop
    perform public.app_refresh_zip(r.zip);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- Cron: one materialization scheduler (upsert by name), hourly bounded batch.
--   select cron.schedule('app-content-refresh', '40 * * * *',
--                        'select public.app_refresh_batch(1500);');

-- Reproducible verification:
--   sweep completeness:  select count(*) from app_community_meta where updated_at < date_trunc('day', now());  -- trends to 0 each day
--   worst-batch ceiling: explain (analyze) select public.app_refresh_zip(zip)
--                        from development_reports where jsonb_array_length(sites) > 1000;  -- must be < 120s
--   integrity:           0 unsourced / 0 out-of-bounds / 0 orphan app_projects; meta states sum to 12,722
