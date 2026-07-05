-- box-elder-development-reports-seed.sql
-- Cached ZIP-mode output of the get-address-report edge function for Box Elder County, UT.
-- Covers all 18 Box Elder County ZIPs (the full county). 84302 = Brigham City prototype.
--
-- Prime directive (docs/development-tracker-source-of-truth.md §0): the cache holds ONLY what
-- the engine returned — never hand-authored. Every rendered site carries an official
-- record_url/url (EPA ECHO registry link or a Utah PMN / county / city notice URL).
--
-- WHY THIS SEED IS A REFRESH SCRIPT, NOT A LITERAL SNAPSHOT (standing answer, §6):
--   A single-ZIP literal was fine for the 84302 prototype, but a whole county (18 ZIPs ×
--   ~40-64 sites) is ~220 KB of engine output, most of it the same county notices repeated
--   per ZIP. Embedding that as hand-copied JSON is exactly the "hand-authored site data" §0
--   warns against and is not meaningfully more reproducible. Instead this seed pins the ZIP
--   centroids (the one thing never guessed, §7.1) and RE-INVOKES the engine, so re-applying
--   rebuilds the cache from the live source of truth. This is also the shape the national
--   batch (§7) uses.
--
-- PROVENANCE: ZIP centroids PINNED to the `zipcodes` PyPI package v3.0.0 (bundled offline
--   USPS dataset — the same source the alerts builds pin, §12.0). Engine: get-address-report
--   v10 ZIP mode. Batch build date: 2026-07-05.
--
-- Parked / applied manually in the Supabase SQL editor. RLS ships enabled below (public
-- select, no anon writes) — do NOT model on page_cache (which shipped RLS-disabled).

-- ── Table + RLS (idempotent; identical to docs/development-reports-cache.sql) ──────────
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

-- ── The pinned Box Elder County ZIP set (zip, centroid lat, centroid lng, USPS city) ──
--    zipcodes PyPI v3.0.0. All 18 verified county='Box Elder County', state='UT', 0 quarantined.
create temporary table _be_zips (zip text, lat float8, lng float8, city text);
insert into _be_zips (zip, lat, lng, city) values
 ('84301',41.6093,-112.1241,'Bear River City'),
 ('84302',41.5079,-112.0152,'Brigham City'),
 ('84306',41.7813,-112.0666,'Collinston'),
 ('84307',41.545,-112.1514,'Corinne'),
 ('84309',41.6972,-112.0947,'Deweyville'),
 ('84311',41.8118,-112.119,'Fielding'),
 ('84312',41.7413,-112.1516,'Garland'),
 ('84313',41.7094,-113.8833,'Grouse Creek'),
 ('84314',41.652,-112.105,'Honeyville'),
 ('84316',41.7733,-112.3968,'Howell'),
 ('84324',41.4975,-111.9416,'Mantua'),
 ('84329',41.8551,-113.3478,'Park Valley'),
 ('84330',41.8831,-112.1388,'Plymouth'),
 ('84331',41.9757,-112.2384,'Portage'),
 ('84334',41.7868,-112.1467,'Riverside'),
 ('84336',41.966,-112.7269,'Snowville'),
 ('84337',41.7016,-112.1813,'Tremonton'),
 ('84340',41.3989,-112.0317,'Willard');

-- ── STEP 1 — invoke the engine ZIP mode for each pinned ZIP (server-side egress via pg_net).
--    Run this, then wait ~40s for the EPA/PMN pulls to land in net._http_response.
select z.zip, net.http_post(
  'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
  jsonb_build_object('zip', z.zip, 'lat', z.lat, 'lng', z.lng),
  '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 45000) as req_id
from _be_zips z order by z.zip;

-- ── STEP 2 — after the responses land, upsert every 200 into the cache (idempotent).
--    Anti-fabrication is enforced by the engine (only sourced sites returned); re-checked below.
insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at)
select (j->>'zip'), (j->'home'->>'lat')::float8, (j->'home'->>'lng')::float8, j->'counts', j->'sites',
       coalesce((j->>'paywall')::bool,false),
       'zipcodes PyPI v3.0.0 (bundled offline USPS dataset) centroid; get-address-report v10 ZIP mode; Box Elder County batch',
       now()
from (
  select content::jsonb j from net._http_response resp
  where resp.status_code = 200
    and (content::jsonb->>'zip') in (select zip from _be_zips)
    and resp.created > now() - interval '10 minutes'
) r
on conflict (zip) do update set
  home_lat=excluded.home_lat, home_lng=excluded.home_lng, counts=excluded.counts,
  sites=excluded.sites, paywall=excluded.paywall, source_vintage=excluded.source_vintage,
  refreshed_at=excluded.refreshed_at;

-- ── Verify (expected: 18 rows, all 18 Box Elder ZIPs) ─────────────────────────────────
--   select zip, (counts->>'facilities')::int facilities, (counts->>'development')::int development,
--          jsonb_array_length(sites) mapped from public.development_reports order by zip;
-- ── Anti-fabrication invariant (must return 0) ────────────────────────────────────────
--   select count(*) from public.development_reports, jsonb_array_elements(sites) s
--   where coalesce(s->>'url','')='' and coalesce(s->>'record_url','')='';
