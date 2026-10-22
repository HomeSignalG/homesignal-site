-- Skagit County WA city communities — the four largest cities' own City Council sources (2026-10-22).
-- Founder request from the Skagit competitor audit: "Wire City Council Sources ... Anacortes (98221),
-- Mount Vernon (98273, 98274), Burlington (98233), and Sedro-Woolley (98284)."
-- Same shape as docs/pierce-city-communities-seed.sql: level=city, zip_codes '{}' (the ZIP pages stay parented
-- to the county), parent = the county root, census_place_geoid read from geo.zcta_place_overlap inside the insert.
-- Each source was probed live through pg_net on 2026-10-22:
--   Mount Vernon   CivicPlus AgendaCenter, City Council category (City-Council-4): agendas through 2026-10-14
--   Burlington     CivicPlus AgendaCenter, City Council category (City-Council-3): agendas through 2026-10-22
--   Anacortes      CivicClerk Events API (anacorteswa tenant; the city's own /700/Meeting-Documents-and-Video
--                  links it): City Council agendas through 2026-10-05; its AgendaCenter is the "Loading" shell
--   Sedro-Woolley  CivicClerk Events API (sedrowoolleywa tenant; linked from the city's home page): council
--                  agendas posted for 2026-10-28 and 2026-11-10
-- Feeds: homesignal-ingest feeds.csv mtg-<slug>-city-catchall (jurisdiction_slug = the slug below).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Skagit', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Mount Vernon', 'mount-vernon-wa'), ('Burlington', 'burlington-wa'),
             ('Anacortes', 'anacortes-wa'), ('Sedro-Woolley', 'sedro-woolley-wa')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
cross join (select id from public.communities where slug = 'skagit-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-22: Anacortes 63bb4e02-b01a-4c24-8728-515677609318 (5301990) · Burlington 504da392-391c-4710-886e-d7631826b8f1 (5308920) ·
--   Mount Vernon 054c53dd-f97d-4213-9ca6-729c34b832f5 (5347560) · Sedro-Woolley 45452811-3f68-4724-84da-ae6573602d3b (5363210)

-- Three Skagit towns, 2026-10-22 (founder "ok" to the follow-up: wire the smaller towns' councils).
-- Probed live through pg_net on 2026-10-22:
--   La Conner  CivicPlus AgendaCenter, Town Council category (Town-Council-2): agendas through 2026-10-13.
--              Its CivicClerk tenant (laconnerwa) lists council events with no agenda posted (agendaId 0) and
--              staff "Test" meetings, so it is not used.
--   Concrete   the town's own WordPress feed (townofconcrete.com/feed/): one post per council meeting, newest
--              "Town Council Meeting - October 26, 2026". Government Notices only: one title carries a typo
--              ("September 28, 2028"), which a meetings reader would store as a meeting two years out.
--   Lyman      the town's own Agendas page (townoflyman.com/agendas) links the current council agenda PDF
--              ("Council meeting Agenda 10-13-26"); the page shows only the newest (Carbonado WA shape).
-- Held: Hamilton (townofhamiltonwa.com: newest agenda February 2025, newest minutes June 2025).
-- Feeds: homesignal-ingest feeds.csv (jurisdiction_slug = the slug below).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Skagit', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('La Conner', 'la-conner-wa'), ('Concrete', 'concrete-wa'), ('Lyman', 'lyman-wa')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' town'
cross join (select id from public.communities where slug = 'skagit-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-22 (migration skagit_town_communities_seed): Concrete f7af47a4-9759-43d6-955d-3b13d49bc56c (5314380) ·
--   La Conner 7dd11827-ff1b-425c-aca5-65ae0282757b (5336780) · Lyman 80ce5bca-e1bc-4b04-9824-844d749cef32 (5340770)
