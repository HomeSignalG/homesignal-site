-- ============================================================================
-- MAPS POPULATION BACKFILL — run the get-address-report engine for every ZIP
-- page that had a meta row + pinned centroid but NO development_reports cache.
-- Applied to production 2026-07-23 via MCP migration
-- `dev_backfill_uncached_zips` + the fire/collect/materialize loop below.
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
--
-- WHY: the "42 remaining states" build (docs/remaining-states-communities-seed.sql)
-- created 12,722 ZIP PAGES (community rows + pinned centroids + app_community_meta),
-- but the get-address-report engine was only ever invoked for a subset. 4,961 ZIPs
-- had NO development_reports row at all — meaning not even the NATIONAL EPA FRS
-- facilities floor had ever been checked for them. Their pages rendered as
-- "coverage_coming" but that was UNVERIFIED emptiness, not an honest empty state:
-- no source check had run. Per the Maps data contract, an empty page is honest
-- only when the source checks for its geography completed and returned nothing.
--
-- WHAT: fire the engine (facilities floor + any wired connectors) for each uncached
-- ZIP using its pinned zip_centroids coordinate, collect the JSON 200 responses into
-- development_reports, then materialize. Only real engine output is ever written
-- (anti-fabrication preserved: every marker keeps its record_url/source_ref; no
-- coordinate is invented; a ZIP with 0 real facilities is left honestly empty).
-- Reproducible + self-contained in Postgres (pg_net gives HTTPS egress; the sandbox
-- has none — the repo's standing pattern).
--
-- RESULT (DB-verified 2026-07-23): 4,961/4,961 uncached ZIPs cached; 4,114 gained
-- real EPA facilities, 779 verified honestly empty (remote/rural — 0 industrial
-- facilities is valid), the rest civic/other. app_community_meta: pass 7,665 →
-- 11,656; coverage_coming 5,057 → 1,066, and ALL 1,066 now have a completed engine
-- check (0 unchecked). +37,810 real facility markers (135,957 → 173,767). 0
-- unsourced, 0 out-of-bounds, 0 beyond-fence, 0 exact-identity duplicates
-- (backfill ran through get-address-report v22, which dedupes at assembly).
--
-- All go through the SAME v22 engine + the SAME app_refresh_zip materializer +
-- dev_sites_deduped() safeguard as the nightly path — this is a one-time catch-up
-- of pages the nightly fire never reached, not a new code path.
-- ============================================================================

-- ---------- Fire: engine call per uncached ZIP (pinned centroid) ------------
create or replace function public.dev_backfill_fire(_limit int default 400)
returns integer language plpgsql security definer set search_path = public, net as $$
declare n integer;
begin
  with cand as (
    select m.zip, z.lat, z.lng
    from public.app_community_meta m
    join public.zip_centroids z on z.zip = m.zip
    where not exists (select 1 from public.development_reports r where r.zip = m.zip)
    order by m.zip
    limit _limit
  ),
  fired as (
    select net.http_post(
      'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
      jsonb_build_object('zip', zip, 'lat', lat, 'lng', lng),
      '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 90000) as req
    from cand
  )
  select count(*) into n from fired;
  return n;
end $$;

-- ---------- Collect: INSERT new reports from recent JSON 200 ZIP responses ---
-- Idempotent + race-safe (ON CONFLICT DO NOTHING). Same non-JSON guard as
-- dev_refresh_collect. Only inserts a row when the engine returned a valid ZIP-mode
-- body with a real home point.
create or replace function public.dev_backfill_collect(_since_min int default 25)
returns integer language plpgsql security definer set search_path = public, net as $$
declare n integer;
begin
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - (_since_min || ' minutes')::interval
      and left(ltrim(content), 1) = '{'
      and (content::jsonb->>'mode') = 'zip'
    order by content::jsonb->>'zip', id desc
  )
  insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at, created_at)
  select j->>'zip',
         (j->'home'->>'lat')::double precision,
         (j->'home'->>'lng')::double precision,
         j->'counts', j->'sites',
         coalesce((j->>'paywall')::boolean, false),
         'get-address-report v22 ZIP mode; backfill of uncached ZIPs',
         now(), now()
  from resp
  where j->>'zip' is not null
    and (j->'home'->>'lat') is not null
    and (j->'home'->>'lng') is not null
  on conflict (zip) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- The loop actually run (transient 503 cold-starts self-heal:
--            a 503'd ZIP stays uncached and is re-fired by the next wave) ------
-- Repeat until (select count(*) from app_community_meta m where not exists
--   (select 1 from development_reports r where r.zip=m.zip)) = 0 :
--   select public.dev_backfill_fire(900);      -- fire a wave
--   -- wait ~3-4 min for pg_net to drain + the engine to answer
--   select public.dev_backfill_collect(15);    -- insert the 200s
--
-- ---------- Materialize every backfilled ZIP (idempotent, batched) ----------
-- select public.app_refresh_zip(r.zip)
-- from public.development_reports r
-- where r.source_vintage like '%backfill%';    -- run in <=2000-row chunks

-- NOTE: the nightly dev_refresh_fire/collect (docs/development-reports-refresh-cron.sql)
-- now sees all 12,722 rows in development_reports, so every ZIP is on the daily
-- refresh going forward; this backfill is the one-time catch-up only.
