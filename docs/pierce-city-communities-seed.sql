-- Pierce County WA city communities — multi-city ZIP pages, step 6 (applied 2026-10-18).
-- A city community exists only once HomeSignal reads that city's own source: before that,
-- public.zip_government_bodies already lists the city on every ZIP it covers, with its land
-- share and "HomeSignal is not reading this city yet" (community_id null).
--   zip_codes '{}'      the city owns no ZIP page; ZIP pages stay parented to the county, so
--                       which community a ZIP resolves to does not change
--   census_place_geoid  how zip_government_bodies matches the Census place to this community
--   government_topics   '{}' — a city's topics follow its ACTIVE feeds (zip_government_topics)
-- Feeds: homesignal-ingest feeds.csv mtg-tacoma-wa-city-catchall (jurisdiction_slug tacoma-wa).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select 'Tacoma', 'Pierce', 'WA', array[]::text[], 'city', p.id, array[]::text[], 'tacoma-wa', '5370000'
from public.communities p
where p.slug = 'pierce-county-wa'
  and not exists (select 1 from public.communities where slug = 'tacoma-wa');
-- applied: id ef2d3dce-6b65-46bc-af1c-15ae6d185a70

-- Step 2 (2026-10-18): five more cities whose own council source was probed live and is current.
-- The Census place id is read from geo.zcta_place_overlap inside the insert (never typed).
--   Gig Harbor, Sumner, Edgewood: CivicClerk Events API (gigharborwa / sumnerwa / edgewoodwa tenants)
--   Milton, University Place:     CivicPlus AgendaCenter, City Council category (City-Council-2)
-- Feeds: homesignal-ingest feeds.csv mtg-<slug>-city-catchall.
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Pierce', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Gig Harbor', 'gig-harbor-wa'), ('Sumner', 'sumner-wa'), ('Edgewood', 'edgewood-wa'),
             ('Milton', 'milton-wa'), ('University Place', 'university-place-wa')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
cross join (select id from public.communities where slug = 'pierce-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-18: Edgewood 33a95f8d-f307-434b-a576-e0212914ccb8 · Gig Harbor 02df5066-1749-4d18-b205-8999c737be09 ·
--   Milton 8c63da95-108e-4274-8ab0-d2a5e3a5f873 · Sumner ba440325-22fc-47e0-966f-ece704af4b78 ·
--   University Place b4679c20-167f-4b66-85ea-704277cad918

-- HELD 2026-10-18 (no community row, so the ZIP pages keep saying "HomeSignal is not reading
-- this city yet"). Each was probed through pg_net; none has a current first-party council source
-- the shipped adapters read.
--   Fife           AgendaCenter City-Council-2 serves 100 agendas, newest 2018-10-23 (archive)
--   Steilacoom     AgendaCenter Town-Council-1 serves 6 agendas, newest 2021-03-02 (archive)
--   Federal Way    webapi.legistar.com/v1/federalway answers 500 "LegistarConnectionString
--                  setting is not set up" (King County city; 1.9% of one Pierce ZIP)
--   Orting         www.cityoforting.org answers 403 Access Denied to automated requests (2026-10-19)
--   South Prairie  townofsouthprairie.com is a hosting placeholder page (2026-10-19)
--   Wilkeson       a Wix blog of announcements, no meeting calendar
--   (Fircrest was held here until 2026-10-19; see Step 3. Buckley, Puyallup and DuPont until
--   2026-10-19 too, see Step 4; Ruston and Lakewood see Step 5: Puyallup moved to puyallupwa.gov, and both it and DuPont publish
--   their meetings as CivicPlus iCalendar feeds rather than in AgendaCenter.)

-- Step 3 (2026-10-19): Fircrest. Its WordPress Events Calendar API tags council events "UTC+0" with a
-- local wall clock; homesignal-ingest city_events now keeps such events date-only (#702).
-- Feed: mtg-fircrest-wa-city-catchall (jurisdiction_slug fircrest-wa).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Pierce', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Fircrest', 'fircrest-wa')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
cross join (select id from public.communities where slug = 'pierce-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-19: Fircrest e83b558a-de12-43c8-b918-230e2224bd0e (Census place 5323970)

-- Step 4 (2026-10-19): Buckley, Puyallup, DuPont. Each source was probed live through pg_net:
--   Buckley   CivicPlus AgendaCenter, City Council category (City-Council-3): 27 agendas, newest 2026-10-20
--   Puyallup  CivicPlus iCalendar catID 36 "City Council, Boards, & Commissions Meetings" (read from the
--             city's own iCalendar directory, puyallupwa.gov): 18 meeting events, newest 2026-12-28
--   DuPont    CivicPlus iCalendar catID 14 "City of DuPont Calendar": 24 City Council meetings plus
--             holiday closures; the feed keeps only meeting|council|commission|session
-- Feeds: homesignal-ingest feeds.csv mtg-<slug>-city-catchall.
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Pierce', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Buckley', 'buckley-wa'), ('Puyallup', 'puyallup-wa'), ('DuPont', 'dupont-wa')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
cross join (select id from public.communities where slug = 'pierce-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-19: Buckley d15b0a35-4acf-40b8-b702-fbc6daa3ddce (5308570) · Puyallup f90d2726-9ded-4637-a9a0-76413240d88f
--   (5356695) · DuPont 236fd97f-7cea-4e7b-96fa-99a2a39feb76 (5318965)

-- Step 5 (2026-10-19): Ruston and Lakewood. Ruston is a TOWN in the Census, so each row is matched on
-- its own Census place name.
--   Ruston    the town's WordPress Events Manager iCal (rustonwa.org/events/?ical=1), read by the shared iCal parser
--   Lakewood  dated agenda PDFs on cityoflakewood.us (notice_list parser dated_pdf_links)
-- Feeds: homesignal-ingest feeds.csv mtg-ruston-wa-city-catchall, mtg-lakewood-wa-city-catchall.
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Pierce', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Ruston', 'ruston-wa', 'Ruston town'), ('Lakewood', 'lakewood-wa', 'Lakewood city')) v(name, slug, census_name)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.census_name
cross join (select id from public.communities where slug = 'pierce-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-19: Ruston b8ba528b-4245-4c6e-8282-6b2c1ff49edd (5360510) · Lakewood 2908e5b0-32ee-4c35-893f-26b91d67bb2d (5338038)
