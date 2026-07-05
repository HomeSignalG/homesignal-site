-- utah-development-reports-seed.sql
-- Cached ZIP-mode output of the get-address-report edge function for the modeled Utah ZIPs
-- (136 ZIPs across Box Elder, Utah, Salt Lake, Davis, Weber, Tooele, Cache counties).
--
-- Prime directive (docs/development-tracker-source-of-truth.md §0): the cache holds ONLY what
-- the engine returned — never hand-authored. Every rendered site carries an official
-- record_url/url. Facilities are national (EPA FRS); planning notices are per the ZIP's OWN
-- county (engine v11 is MULTI-COUNTY — resolveCommunityIds). Box Elder + Utah County have wired
-- feeds → full pages; the other counties are facilities-only (valid, the national floor).
--
-- This seed is a REPRODUCIBLE pg_net REFRESH SCRIPT (standing answer, §6): it pins the ZIP
-- centroids (the one thing never guessed, §7.1) and re-invokes the engine, so re-applying
-- rebuilds the cache from the live source of truth. Supersedes the single-county
-- box-elder-development-reports-seed.sql (its 18 ZIPs are a subset of these 136).
--
-- PROVENANCE: centroids PINNED to `zipcodes` PyPI v3.0.0 (bundled offline USPS dataset, §12.0).
--   Engine: get-address-report v11 (multi-county) ZIP mode. Batch build date: 2026-07-05.
--   Fired via pg_net in one batch; 4 transient 503 cold-starts were retried to completion.
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

-- ── The pinned Utah ZIP set (zip, centroid lat, centroid lng) — zipcodes PyPI v3.0.0 ──
--    84684/84685 were absent from the dataset and quarantined (excluded, not guessed).
create temporary table _ut_zips (zip text, lat float8, lng float8);
insert into _ut_zips (zip, lat, lng) values
 ('84003',40.3928,-111.7941),
 ('84004',40.4616,-111.7689),
 ('84005',40.3802,-111.991),
 ('84006',40.5646,-112.0977),
 ('84010',40.8775,-111.8727),
 ('84011',40.8894,-111.8808),
 ('84013',40.2959,-112.0923),
 ('84014',40.9268,-111.877),
 ('84015',41.1294,-112.0482),
 ('84016',41.1108,-112.0261),
 ('84020',40.5046,-111.881),
 ('84022',40.3631,-113.0697),
 ('84025',40.9889,-111.8938),
 ('84029',40.6005,-112.4618),
 ('84034',40.2022,-113.8649),
 ('84037',41.0375,-111.9326),
 ('84040',41.0846,-111.9274),
 ('84041',41.0879,-111.9704),
 ('84042',40.3412,-111.7144),
 ('84043',40.3958,-111.8506),
 ('84044',40.7009,-112.0809),
 ('84045',40.3495,-111.9043),
 ('84047',40.6152,-111.8851),
 ('84054',40.8446,-111.9191),
 ('84056',41.128,-111.9723),
 ('84057',40.3134,-111.6953),
 ('84058',40.2818,-111.7209),
 ('84059',40.177,-111.536),
 ('84062',40.372,-111.7333),
 ('84065',40.4954,-111.9444),
 ('84067',41.1724,-112.0382),
 ('84069',40.3566,-112.4659),
 ('84070',40.5794,-111.8816),
 ('84071',40.4415,-112.3559),
 ('84074',40.5454,-112.3002),
 ('84075',41.0864,-112.0451),
 ('84080',40.0826,-112.426),
 ('84083',40.2714,-113.1954),
 ('84084',40.6254,-111.9677),
 ('84087',40.8874,-111.9027),
 ('84088',40.5959,-111.9644),
 ('84089',40.9635,-112.116),
 ('84092',40.5834,-111.7467),
 ('84093',40.5927,-111.831),
 ('84094',40.5688,-111.8617),
 ('84095',40.5541,-111.9539),
 ('84096',40.5144,-112.0325),
 ('84097',40.2972,-111.6705),
 ('84101',40.7559,-111.8967),
 ('84102',40.76,-111.8627),
 ('84103',40.7776,-111.8749),
 ('84104',40.7499,-111.926),
 ('84105',40.7372,-111.8581),
 ('84106',40.7056,-111.8548),
 ('84107',40.6568,-111.8904),
 ('84108',40.7371,-111.8258),
 ('84109',40.7043,-111.8142),
 ('84111',40.7548,-111.881),
 ('84112',40.7659,-111.8403),
 ('84113',40.7658,-111.8364),
 ('84115',40.7145,-111.8931),
 ('84116',40.7857,-111.9291),
 ('84117',40.6551,-111.834),
 ('84118',40.6504,-112.0054),
 ('84119',40.6916,-112.0011),
 ('84120',40.6916,-112.0011),
 ('84121',40.6226,-111.7777),
 ('84123',40.6596,-111.9193),
 ('84124',40.6772,-111.8133),
 ('84128',40.6916,-112.0011),
 ('84129',40.6531,-111.9674),
 ('84301',41.6093,-112.1241),
 ('84302',41.5079,-112.0152),
 ('84304',41.8169,-111.9982),
 ('84305',41.9188,-112.0486),
 ('84306',41.7813,-112.0666),
 ('84307',41.545,-112.1514),
 ('84308',41.9443,-111.9733),
 ('84309',41.6972,-112.0947),
 ('84310',41.3303,-111.8558),
 ('84311',41.8118,-112.119),
 ('84312',41.7413,-112.1516),
 ('84313',41.7094,-113.8833),
 ('84314',41.652,-112.105),
 ('84315',41.1668,-112.1364),
 ('84316',41.7733,-112.3968),
 ('84317',41.2721,-111.7618),
 ('84318',41.8,-111.8123),
 ('84319',41.6311,-111.849),
 ('84320',41.9701,-111.8768),
 ('84321',41.747,-111.8226),
 ('84322',41.6412,-111.8966),
 ('84323',41.7355,-111.8344),
 ('84324',41.4975,-111.9416),
 ('84325',41.71,-111.9817),
 ('84326',41.6759,-111.8185),
 ('84327',41.8627,-111.9908),
 ('84328',41.56,-111.8297),
 ('84329',41.8551,-113.3478),
 ('84330',41.8831,-112.1388),
 ('84331',41.9757,-112.2384),
 ('84332',41.7,-111.8123),
 ('84333',41.9282,-111.8069),
 ('84334',41.7868,-112.1467),
 ('84335',41.8403,-111.8528),
 ('84336',41.966,-112.7269),
 ('84337',41.7016,-112.1813),
 ('84338',41.9105,-111.934),
 ('84339',41.6343,-111.9317),
 ('84340',41.3989,-112.0317),
 ('84341',41.7759,-111.8068),
 ('84401',41.2215,-111.9621),
 ('84402',41.2553,-111.9567),
 ('84403',41.1894,-111.9489),
 ('84404',41.2627,-111.9837),
 ('84405',41.1739,-111.9809),
 ('84408',41.1956,-111.9485),
 ('84409',41.2553,-111.9567),
 ('84412',41.2553,-111.9567),
 ('84414',41.3112,-111.9689),
 ('84415',41.2553,-111.9567),
 ('84601',40.2319,-111.6755),
 ('84602',40.3563,-111.7325),
 ('84603',40.2039,-111.6261),
 ('84604',40.2607,-111.6549),
 ('84605',40.177,-111.536),
 ('84606',40.2347,-111.6447),
 ('84626',39.9739,-111.9554),
 ('84633',39.953,-111.9008),
 ('84651',40.0449,-111.7321),
 ('84653',40.0113,-111.5998),
 ('84655',39.9737,-111.8037),
 ('84660',40.1099,-111.6462),
 ('84663',40.1625,-111.5987),
 ('84664',40.1337,-111.5801),
 ('84665',39.1936,-111.6924);

-- ── STEP 1 — invoke the engine ZIP mode for each pinned ZIP (server-side egress via pg_net).
--    Fire in chunks if you hit 503 cold-starts under high concurrency; wait ~60s for responses.
select z.zip, net.http_post(
  'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
  jsonb_build_object('zip', z.zip, 'lat', z.lat, 'lng', z.lng),
  '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 45000) as req_id
from _ut_zips z order by z.zip;

-- ── STEP 2 — after the responses land, upsert every 200 (idempotent). Retry any 503 ZIPs.
insert into public.development_reports (zip, home_lat, home_lng, counts, sites, paywall, source_vintage, refreshed_at)
select (j->>'zip'), (j->'home'->>'lat')::float8, (j->'home'->>'lng')::float8, j->'counts', j->'sites',
       coalesce((j->>'paywall')::bool,false),
       'zipcodes PyPI v3.0.0 centroid; get-address-report v11 (multi-county) ZIP mode; Utah statewide batch',
       now()
from (
  select content::jsonb j from net._http_response resp
  where resp.status_code = 200
    and (content::jsonb->>'zip') in (select zip from _ut_zips)
    and resp.created > now() - interval '15 minutes'
) r
on conflict (zip) do update set
  home_lat=excluded.home_lat, home_lng=excluded.home_lng, counts=excluded.counts,
  sites=excluded.sites, paywall=excluded.paywall, source_vintage=excluded.source_vintage,
  refreshed_at=excluded.refreshed_at;

-- ── Verify (expected 136 rows) + anti-fabrication invariant (must return 0) ───────────
--   select count(*) from public.development_reports;
--   select count(*) from public.development_reports, jsonb_array_elements(sites) s
--   where coalesce(s->>'url','')='' and coalesce(s->>'record_url','')='';
