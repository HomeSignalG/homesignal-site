-- del-valle-78617-development-reports-seed.sql
-- Cached ZIP-mode output of the get-address-report edge function for ZIP 78617
-- (Del Valle, Travis County, TX) — the first non-Utah development ZIP page.
--
-- Prime directive (docs/development-tracker-source-of-truth.md §0): the cache holds ONLY what
-- the engine returned — never hand-authored. Every rendered site carries an official
-- record_url/url. Facilities are national (EPA FRS); civic/planning items come from the ZIP's
-- OWN county chain (engine v11+ is MULTI-COUNTY — resolveCommunityIds). Travis County's
-- Commissioners Court feed (CivicClerk) is wired in ingest, so 78617 ships facilities + the
-- county's civic items; a full planning-notice page is the decoupled ingest follow-up (§7.6).
--
-- This seed is a REPRODUCIBLE pg_net REFRESH SCRIPT (standing answer, §6): it pins the ZIP
-- centroid (the one thing never guessed, §7.1) and re-invokes the engine, so re-applying
-- rebuilds the cache from the live source of truth.
--
-- PROVENANCE: centroid PINNED to `zipcodes` PyPI v3.0.0 (bundled offline USPS dataset, §12.0):
--   78617 → Del Valle, Travis County, TX (30.1745, -97.6134), STANDARD, active.
--   Engine: get-address-report v14 (multi-county) ZIP mode. Build date: 2026-07-10.
--   First cache: facilities 29 · development 0 · civic 1 · 30 sites · 0 unsourced.
--   Known residual (logged, not fixed here): area-scope civic items carry Box-Elder-hardcoded
--   lat/lng from the engine's centroid()/PLACES geocoder — inert (area items are never
--   map-pinned; mappable() is point-only). Tracked as a follow-up issue.
--
-- Parked / applied manually in the Supabase SQL editor. RLS ships enabled below.

create table if not exists public.development_reports (
  zip           text primary key check (zip ~ '^\d{5}$'),
  home_lat      double precision not null,
  home_lng      double precision not null,
  counts        jsonb not null default '{}'::jsonb,
  sites         jsonb not null default '[]'::jsonb,
  paywall       boolean not null default false,
  source_vintage text,
  refreshed_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
alter table public.development_reports enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public'
     and tablename='development_reports' and policyname='development_reports_public_read') then
    create policy development_reports_public_read
      on public.development_reports for select using (true);
  end if;
end$$;

-- ── The pinned ZIP (zip, centroid lat, centroid lng) — zipcodes PyPI v3.0.0 ──────────
create temporary table _tx_78617_zips (zip text, lat float8, lng float8);
insert into _tx_78617_zips (zip, lat, lng) values
 ('78617',30.1745,-97.6134);

-- ── STEP 1 — invoke the engine ZIP mode (server-side egress via pg_net). ─────────────
--    Wait ~60s for the async response to land; retry any transient 503 cold-start.
select z.zip, net.http_post(
  'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
  jsonb_build_object('zip', z.zip, 'lat', z.lat, 'lng', z.lng),
  '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 45000) as req_id
from _tx_78617_zips z order by z.zip;

-- ── STEP 2 — after the response lands, upsert every 200 (idempotent, never clobber
--    with older data). Validation gates mirror the batch runbook §7.2: zip shape,
--    centroid in the TX bbox, and the anti-fabrication invariant (0 unsourced sites).
insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at)
select (j->>'zip'), (j->'home'->>'lat')::float8, (j->'home'->>'lng')::float8, j->'counts', j->'sites',
       coalesce((j->>'paywall')::bool,false),
       'zipcodes PyPI v3.0.0 centroid; get-address-report v14 (multi-county) ZIP mode; 78617 Del Valle TX build',
       now()
from (
  select content::jsonb j from net._http_response resp
  where resp.status_code = 200
    and (content::jsonb->>'zip') in (select zip from _tx_78617_zips)
    and resp.created > now() - interval '15 minutes'
) r
where (j->>'zip') ~ '^\d{5}$'
  and (j->'home'->>'lat')::float8 between 25.8 and 36.6
  and (j->'home'->>'lng')::float8 between -106.7 and -93.5
  and not exists (
    select 1 from jsonb_array_elements(j->'sites') s
    where coalesce(s->>'url', s->>'record_url', '') = ''
       or coalesce(s->>'scope','') = '' or coalesce(s->>'type','') = '')
on conflict (zip) do update set
  home_lat=excluded.home_lat, home_lng=excluded.home_lng, counts=excluded.counts,
  sites=excluded.sites, paywall=excluded.paywall, source_vintage=excluded.source_vintage,
  refreshed_at=excluded.refreshed_at
  where public.development_reports.refreshed_at < excluded.refreshed_at;

-- ── Verify (expected 1 row) + anti-fabrication invariant (must return 0) ─────────────
--   select zip, home_lat, home_lng, (counts->>'facilities')::int as facilities,
--          jsonb_array_length(sites) as mapped, refreshed_at
--   from public.development_reports where zip='78617';
--   select count(*) from public.development_reports, jsonb_array_elements(sites) s
--   where zip='78617' and coalesce(s->>'url','')='' and coalesce(s->>'record_url','')='';
