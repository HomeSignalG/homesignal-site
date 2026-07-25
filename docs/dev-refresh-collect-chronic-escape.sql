-- ============================================================================
-- dev_refresh_collect — CHRONIC ESCAPE for the transient-safe guard
-- Applied to production 2026-07-25 via MCP migration `dev_refresh_collect_chronic_escape`.
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
--
-- PROVEN DEFECT (2026-07-25 Maps data coverage pass — ZIP 84089, Clearfield UT):
-- the guard held any all-empty / dev-zero 200 response over a previously-
-- populated row with NO time bound, so a row whose content LEGITIMATELY ages to
-- zero (concluded meetings leave the upcoming window; notices expire) froze
-- forever: refreshed_at stuck at 2026-07-11, daily attempts recorded,
-- coverage_state = failed_ingest — the only FAILED ZIP of 12,722.
-- Live receipts: the engine returned 200 all-zero for 84089 on demand; the sole
-- FRS registration in range ("409 THE BLUFF", a residential subdivision)
-- honestly fails looksIndustrial; the 9 cached civic items were concluded
-- meetings no longer upcoming.
--
-- FIX (narrow): the per-dimension holds protect only FRESH rows
-- (refreshed_at within 7 days). A flaky night still cannot blank a good page;
-- after 7 consecutive held days a clean 200 response is accepted as the new
-- truth. No fabrication — only real engine output is ever written.
-- Post-fix: 84089 re-collected (sites=0 honest), re-materialized
-- (4 current notices -> populated), 0 failed/stale states remain universe-wide.
-- ============================================================================
create or replace function public.dev_refresh_collect() returns integer
language plpgsql security definer set search_path = public, net as $$
declare n integer;
begin
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content),1) = '{'
    order by content::jsonb->>'zip', id desc
  )
  update public.development_reports d set
    counts        = j->'counts',
    sites         = j->'sites',
    paywall       = coalesce((j->>'paywall')::boolean, false),
    source_vintage= 'get-address-report ZIP mode; pg_cron daily auto-refresh',
    refreshed_at  = now()
  from resp
  where d.zip = (j->>'zip')
    -- TRANSIENT-SAFE, per-dimension — but only while the row is FRESH (<7 days).
    -- Beyond that the "flake" theory is exhausted (7+ consecutive holds) and the
    -- clean 200 response is the truth (chronic escape, 2026-07-25 — ZIP 84089).
    and not (
      d.refreshed_at >= now() - interval '7 days'
      and coalesce((j->'counts'->>'facilities')::int, 0) = 0
      and coalesce((j->'counts'->>'development')::int, 0) = 0
      and coalesce((d.counts->>'facilities')::int, 0) + coalesce((d.counts->>'development')::int, 0) > 0
    )
    and not (
      d.refreshed_at >= now() - interval '7 days'
      and coalesce((j->'counts'->>'development')::int, 0) = 0
      and coalesce((d.counts->>'development')::int, 0) > 0
    );
  get diagnostics n = row_count;
  return n;
end $$;
