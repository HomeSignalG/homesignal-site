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
