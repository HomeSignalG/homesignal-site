-- ============================================================================
-- MAPS FULL ROLLOUT — one Maps page (maps.html: Street | Satellite | Focus)
-- for EVERY production ZIP page. Applied to production 2026-07-23 via MCP
-- migrations `zip_centroids_reference_table` and
-- `app_refresh_full_zip_universe_and_geometry_fence`. This file is the
-- reproducible SQL of record (repo convention: docs/*.sql).
--
-- WHAT CHANGED (and why):
--  1. public.zip_centroids — pinned per-ZIP viewport anchors.
--     Source: zipcodes PyPI v3.0.0 (the repo's approved USPS dataset), seed CSV
--     committed at docs/zip-centroids-v3.csv and loaded server-side via pg_net
--     (the sandbox has no egress; Postgres does — standing pattern).
--     TWO documented exceptions (ZIPs newer than the dataset; neither exists in
--     zipcodes v3.0.0, Census 2020/ACS-2025 ZCTAs, nor Utah UGRC's ZIP layer):
--       84684 → Census 2020 place internal point, West Mountain CDP  (GEOID 4983252)
--       84685 → Census 2020 place internal point, Woodland Hills city (GEOID 4985050)
--     Both are the community's OWN official federal coordinate — never an
--     inference from unrelated markers, never a guess.
--  2. app_refresh_all() — candidate set is now the FULL ZIP UNIVERSE:
--     every level='zip' community ZIP ∪ development_reports ZIPs (keeps
--     city-level pages, e.g. 84302) ∪ already-materialized ZIPs (retention).
--     The old branch that read app_community_meta as the *creation* source was
--     a chicken-and-egg: it could never create a page, only retain one — which
--     silently blocked 48 civic-eligible ZIPs (36 NV + 12 UT).
--  3. app_refresh_zip(_zip) — population logic byte-identical, plus:
--     (a) viewport-anchor fallback to zip_centroids when the ZIP has no
--         development_reports centroid (Street/Satellite need a center; without
--         one maps.html:1348 silently reverted to Focus), and
--     (b) a permanent SOURCE-GEOMETRY SANITY FENCE: a marker coordinate outside
--         the US bounding box (lat 17..72, lng -180..-60) or >100 mi from the
--         page centroid is NULLED — the record stays listed in the panel, the
--         point is never plotted, nothing is invented. Fix class: ZIP 78666
--         "La Cima Phase 3C & 7E Zoning" stored at (-6.146, -103.518) — the
--         Pacific Ocean, 2,516 mi from San Marcos TX (bad source geometry from
--         smgis.sanmarcostx.gov). Largest legitimate marker distance across all
--         135,957 production markers is 15.8 mi, so the 100-mi fence has zero
--         false-positive risk on real data.
--
-- POST-STATE (DB-verified 2026-07-23): 12,704/12,704 level='zip' pages have a
-- Maps meta row + valid centroid (12,722/12,722 including the 18 city-level
-- pages); 0 unsourced markers; 0 out-of-bounds markers; 1 record listed with
-- nulled coords (the La Cima record, preserved per the never-fabricate rule).
-- ============================================================================

-- ---------- 1. Pinned centroid reference table ------------------------------
create table if not exists public.zip_centroids (
  zip text primary key,
  lat double precision not null,
  lng double precision not null,
  source text not null default 'zipcodes-pypi-3.0.0'
);
alter table public.zip_centroids enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='zip_centroids' and policyname='public read') then
    create policy "public read" on public.zip_centroids for select using (true);
  end if;
end $$;

-- Load the pinned dataset (docs/zip-centroids-v3.csv on the repo's main branch).
-- Step A (fire):   select net.http_get('https://raw.githubusercontent.com/HomeSignalG/homesignal-site/main/docs/zip-centroids-v3.csv');
-- Step B (collect; substitute the returned request id for :REQ):
--   with resp as (select status_code, content from net._http_response where id = :REQ),
--   parsed as (
--     select split_part(line,',',1) as zip,
--            split_part(line,',',2)::double precision as lat,
--            split_part(line,',',3)::double precision as lng
--     from resp, regexp_split_to_table(content, E'\n') as line
--     where (select status_code from resp)=200 and line ~ '^\d{5},-?[0-9.]+,-?[0-9.]+$')
--   insert into public.zip_centroids (zip, lat, lng)
--   select zip, lat, lng from parsed
--   on conflict (zip) do update set lat=excluded.lat, lng=excluded.lng;

-- The two post-dataset ZIPs (first-party Census 2020 place internal points):
insert into public.zip_centroids (zip, lat, lng, source) values
 ('84684', 40.0518161, -111.7833525, 'census-2020-place-intpt (West Mountain CDP, GEOID 4983252 — ZIP post-dates zipcodes v3.0.0)'),
 ('84685', 40.0131844, -111.6557957, 'census-2020-place-intpt (Woodland Hills city, GEOID 4985050 — ZIP post-dates zipcodes v3.0.0)')
on conflict (zip) do update set lat=excluded.lat, lng=excluded.lng, source=excluded.source;

-- ---------- 2. Candidate-set fix -------------------------------------------
create or replace function public.app_refresh_all() returns integer language plpgsql as $fn$
declare n int := 0; r record;
begin
  for r in
    select zip from (
      select z.zip from public.communities c, unnest(c.zip_codes) as z(zip) where c.level='zip'
      union
      select zip from public.development_reports
      union
      select zip from public.app_community_meta
    ) cand
    order by zip
  loop
    perform public.app_refresh_zip(r.zip);
    n := n + 1;
  end loop;
  return n;
end $fn$;

-- ---------- 3. app_refresh_zip: centroid fallback + geometry fence ----------
-- Full body applied in production migration
-- `app_refresh_full_zip_universe_and_geometry_fence` (see supabase migration
-- history). The two additions relative to the prior body, verbatim:
--
--   -- after: select home_lat, home_lng into _lat, _lng from development_reports where zip=_zip;
--   if _lat is null or _lng is null then
--     select lat, lng into _lat, _lng from public.zip_centroids where zip=_zip;
--   end if;
--
--   -- after the facility insert / _nf count, inside `if _has_report then`:
--   update public.app_projects set lat=null, lng=null
--    where zip=_zip and lat is not null and (
--      lat not between 17 and 72 or lng not between -180 and -60
--      or (_lat is not null and 3959*acos(least(1::double precision, greatest(-1::double precision,
--           cos(radians(_lat))*cos(radians(lat))*cos(radians(lng)-radians(_lng))
--           + sin(radians(_lat))*sin(radians(lat))))) > 100)
--    );

-- ---------- 4. One-time backfill actually run (idempotent) ------------------
-- (a) materialize every level='zip' ZIP with no meta row yet, in bounded
--     batches (run repeatedly until 0):
--   select count(*) from (
--     select public.app_refresh_zip(z.zip)
--     from (select z.zip from public.communities c, unnest(c.zip_codes) z(zip)
--           where c.level='zip'
--             and not exists (select 1 from public.app_community_meta m where m.zip=z.zip)
--           order by z.zip limit 1000) z) s;
-- (b) centroid backfill for pages materialized before the fallback existed:
update public.app_community_meta m set lat=c.lat, lng=c.lng
from public.zip_centroids c
where m.zip=c.zip and (m.lat is null or m.lng is null);
-- (c) retroactive geometry fence over the whole marker population:
update public.app_projects p set lat=null, lng=null
from public.app_community_meta m
where m.zip=p.zip and p.lat is not null and (
  p.lat not between 17 and 72 or p.lng not between -180 and -60
  or (m.lat is not null and 3959*acos(least(1::double precision, greatest(-1::double precision,
       cos(radians(m.lat))*cos(radians(p.lat))*cos(radians(p.lng)-radians(m.lng))
       + sin(radians(m.lat))*sin(radians(p.lat))))) > 100));
