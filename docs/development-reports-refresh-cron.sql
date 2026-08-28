-- development_reports auto-refresh — parked reference (applied live via mcp__Supabase__apply_migration).
-- Makes ZIP pages stop being a frozen MANUAL snapshot: nothing else re-runs the seed, so a new hearing
-- ingested into alerts/meetings never reached a ZIP page until a human re-ran the pg_net batch by hand.
--
-- Fully self-contained in Postgres: pg_net gives the DB HTTPS egress (the CI sandbox has none), pg_cron
-- schedules it. Two steps because pg_net is async — fire all engine calls, then collect the responses a
-- few minutes later. The page surfaces development_reports.refreshed_at as an "Updated <date>" line so the
-- snapshot is always honestly dated.

-- STEP 1 — fire one engine call per cached ZIP, using its pinned centroid (home_lat/home_lng).
create or replace function public.dev_refresh_fire() returns integer
language plpgsql security definer set search_path = public, net as $$
declare n integer;
begin
  perform net.http_post(
    'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
    jsonb_build_object('zip', zip, 'lat', home_lat, 'lng', home_lng),
    '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 90000)
  from public.development_reports;
  get diagnostics n = row_count;
  return n;
end $$;

-- STEP 2 — upsert fresh engine output. TRANSIENT-SAFE: never overwrite a row that currently has content
-- with an all-empty response (that signature = FRS gave up / a flaky fetch), so a bad night can't blank
-- good pages. Legit count changes (up or down, as long as not to 0/0) still apply. Same idea as the
-- one-time FRS-fix re-cache "improvement guard", generalized for a recurring refresh.
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
    order by content::jsonb->>'zip', id desc
  )
  update public.development_reports d set
    counts        = j->'counts',
    sites         = j->'sites',
    paywall       = coalesce((j->>'paywall')::boolean, false),
    source_vintage= 'get-address-report v14 ZIP mode; pg_cron daily auto-refresh',
    refreshed_at  = now()
  from resp
  where d.zip = (j->>'zip')
    and not (
      coalesce((j->'counts'->>'facilities')::int, 0) = 0
      and coalesce((j->'counts'->>'development')::int, 0) = 0
      and coalesce((d.counts->>'facilities')::int, 0) + coalesce((d.counts->>'development')::int, 0) > 0
    );
  get diagnostics n = row_count;
  return n;
end $$;

-- Daily schedule (UTC): fire 09:00, collect 09:08. cron.schedule upserts by job name (idempotent).
select cron.schedule('dev-reports-refresh-fire',    '0 9 * * *', 'select public.dev_refresh_fire();');
select cron.schedule('dev-reports-refresh-collect', '8 9 * * *', 'select public.dev_refresh_collect();');

-- To run an immediate refresh by hand: select public.dev_refresh_fire();  -- wait ~7 min
--                                       select public.dev_refresh_collect();
-- To inspect: select jobname, schedule, active from cron.job where jobname like 'dev-reports-refresh%';
--             select * from cron.job_run_details order by start_time desc limit 10;

-- UPDATE 2026-07-13: dev_refresh_collect hardened against non-JSON 200s. It cast EVERY recent
-- 200's content to jsonb before the mode filter could exclude it, so a single non-JSON 200 in
-- the 20-min window (e.g. an ad-hoc HTML/ArcGIS probe made while debugging) threw
-- "invalid input syntax for type json" and aborted the whole nightly upsert. Guard added:
-- `and left(ltrim(content),1) = '{'` — only JSON-object bodies are considered. Applied via
-- migration dev_refresh_collect_guard_nonjson. Normal cron operation only ever fires
-- get-address-report (all JSON), so this is defensive; behavior is otherwise identical.
--
-- Also 2026-07-13: Provo Planning Applications (arcgis) went live in the engine; re-cached the
-- 6 Provo ZIPs via net.http_post → the scoped-upsert form of this collect (filtered to those
-- request ids to avoid the non-JSON probe rows). Result: 84601 dev 10→92 (82 per-parcel Provo
-- points), 84604 →82 (72 pts), 84606 →50 (40 pts); 84603/84605 stay facility-floor (PO-box ZIPs,
-- 0 Provo addresses — correct, not fabricated); 84602 (BYU campus) timed out that run and stays
-- on its prior facility-floor row (re-collects on the next nightly fire). app_projects then
-- materialized 136 Provo development rows across 84601/84604/84606, 0 missing coords/source_ref,
-- statuses Approved+Proposed (honest), sourced to provo.gov/174/Projects-and-Planning.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- UPDATE 2026-08-28: FIRING CONCURRENCY CUT TO 8 EVERY 2 MINUTES — measured, not guessed.
--
-- Applied to the live scheduler:
--     select cron.alter_job(
--       job_id   := 14,
--       schedule := '*/2 * * * *',
--       command  := 'select public.dev_refresh_tick(8, 20);',
--       active   := true);
--
-- WHY. Job 14 fired dev_refresh_tick() at its DEFAULT _batch of 250 every 15 minutes, i.e. 250
-- concurrent edge invocations and therefore up to 250 concurrent EPA FRS calls. FRS throttles
-- under that load. Before PR #952 the throttling silently UNDERCOUNTED facilities (a transient
-- failure shrank the search radius and the tiny circle answered ok:true); after #952 it fails
-- honestly as ok:false, so the pages stayed correct but stopped updating. Both are fixed by
-- firing fewer at once.
--
-- MEASUREMENT (the same 32 ZIPs in every arm, so batch size is the only variable; job 14 paused
-- for the duration so the 250-wide tick could not contaminate the signal):
--     32 at once     16/32 epa.ok   50.0%   avg 2.21 attempts   16 answered at full 3 mi
--     16 at a time   28/32 epa.ok   87.5%   avg 1.72 attempts   22 answered at full 3 mi
--      8 at a time   32/32 epa.ok  100.0%   avg 1.69 attempts   22 answered at full 3 mi
-- The control that makes it a real result: 22 answered at the FULL 3 mi in both the 16 and 8
-- arms — identical. The pool's density profile is stable across batch sizes, so what moves is
-- the failure rate, not the geography.
--
-- Both ends measured. The live tick at _batch=250, running 12 h AFTER #952 deployed: 1,932
-- responses, 275 with epa.ok = 14.2%.
--     was:  250 / 15 min = 24,000 fired/day x 14.2%  ~= 3,408 clean refreshes/day
--     now:    8 /  2 min =  5,760 fired/day x ~100%  =  5,760 clean refreshes/day
-- 4.2x fewer requests, ~1.7x more CORRECT refreshes. Full-fleet cycle 12,722 / 5,760 ~= 2.2 days,
-- well inside the rate at which permit data changes.
--
-- Live confirmation at the new setting: 4 consecutive automated ticks over ~6 minutes returned
-- 31/32 epa.ok (96.9%), avg 1.44 attempts — the SUSTAINED rate, not a single burst.
--
-- DO NOT "fix" this by lowering pg_net.batch_size (currently 200). That is a DATABASE-WIDE
-- setting shared with the ingest pipeline; narrowing it to protect FRS throttles everything else
-- in the project. The tick's own _batch is the correctly-scoped lever.
