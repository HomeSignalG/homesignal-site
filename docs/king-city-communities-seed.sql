-- King County WA city communities, for the multi-city ZIP pages (same pattern as
-- docs/pierce-city-communities-seed.sql). A city community exists only once HomeSignal reads that
-- city's own council source; until then public.zip_government_bodies lists the city with
-- "HomeSignal is not reading this city yet".
--   zip_codes '{}'      the city owns no ZIP page; ZIP pages stay parented to the county
--   census_place_geoid  read from geo.zcta_place_overlap inside the insert (never typed)
--   government_topics   '{}' — a city's topics follow its ACTIVE feeds
--
-- Step 1 (2026-10-19): eight cities whose own council source was probed live through pg_net.
--   Legistar Events API (webapi.legistar.com/v1/<client>):
--     Seattle   40 events 2026-09-10..2026-11-23, 7 upcoming (City Council, Council Briefing, committees)
--     Bellevue  40 events 2026-06-16..2026-10-21, 2 upcoming (City Council Regular Meeting, city boards)
--     Redmond   40 events 2026-08-11..2026-12-22, 16 upcoming (City Council, Committees of the Whole)
--   CivicClerk Events API (<tenant>.api.civicclerk.com, the adapter's own le today+90 query):
--     Auburn (auburnwa) · Des Moines (desmoineswa) · Kenmore (kenmorewa) · Snoqualmie (snoqualmiewa)
--     · North Bend (northbendwa): 15 events each, city council plus city boards, 0 "Test" rows
-- Feeds: homesignal-ingest feeds.csv mtg-<slug>-city-catchall (jurisdiction_slug = slug).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'King', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Seattle', 'seattle-wa'), ('Bellevue', 'bellevue-wa'), ('Redmond', 'redmond-wa'),
             ('Auburn', 'auburn-wa'), ('Des Moines', 'des-moines-wa'), ('Kenmore', 'kenmore-wa'),
             ('Snoqualmie', 'snoqualmie-wa'), ('North Bend', 'north-bend-wa')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
cross join (select id from public.communities where slug = 'king-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-19: Seattle 3aa722d5-d580-49ee-b04c-49f5808ba8cb (5363000) · Bellevue e709e195-4deb-497e-b59b-10dd245bb691 (5305210)
--   · Redmond 0a4709ac-9796-49e6-8b82-b52b7846276f (5357535) · Auburn 5a582055-2b2e-4f24-ac76-4dc8dacded66 (5303180)
--   · Des Moines a285904e-df45-4bdc-9688-9d315a216dbe (5317635) · Kenmore fac27255-6743-49f5-8b92-d6daf6bc9231 (5335170)
--   · Snoqualmie ce4eb6a1-7479-424b-a1b2-b914a9fe8e72 (5365205) · North Bend 15838dc6-fb13-453c-85e3-0ca956b0a43f (5349485)

-- HELD 2026-10-19 (no community row yet):
--   Mercer Island  mercerislandwa CivicClerk tenant: 13 of its 15 in-window events are vendor
--                  "Test ..." rows (e.g. "Test City Council Regular Hybrid Meeting"); reading it would
--                  show test meetings as real ones
--   Renton, Kent, Kirkland, Shoreline, Burien, SeaTac, Tukwila, Sammamish, Issaquah, Bothell, Federal Way
--                  no Legistar tenant (webapi answers 500 "LegistarConnectionString setting is not set
--                  up") and no CivicClerk tenant (404); their own sites are the next probe

-- Step 2 (2026-10-19): three more cities, each source probed live through pg_net.
--   Duvall           CivicPlus AgendaCenter, City Council category (City-Council-1): 22 agendas, newest 2026-10-20
--   Black Diamond    CivicPlus iCalendar catID 14 "Main Calendar": City Council, work sessions, Planning and Civil
--                    Service meetings through 2027-01-19, plus holiday entries the feed's filter drops
--   Lake Forest Park CivicPlus iCalendar catID 14 "Meetings Calendar": City Council regular meetings, work sessions
--                    and committees through 2026-12-17 (its AgendaCenter categories stop in 2022)
-- Feeds: homesignal-ingest feeds.csv mtg-<slug>-city-catchall.
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'King', 'WA', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Duvall', 'duvall-wa'), ('Black Diamond', 'black-diamond-wa'), ('Lake Forest Park', 'lake-forest-park-wa')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '53%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
cross join (select id from public.communities where slug = 'king-county-wa') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-19: Duvall 39baaa64-1734-47d6-8343-e5c401aba224 (5319035)
--   · Black Diamond 0761eaf7-e4ec-463a-ba19-e4a409aa6c59 (5306330)
--   · Lake Forest Park 5ca7a034-47c5-44f4-a010-1b72b413e479 (5337270)

-- HELD after step 2 (2026-10-19), each probed through pg_net:
--   Kent             Granicus kentwa: view_id 1 empty, 2-8 return 404
--   Mercer Island    CivicClerk tenant carries vendor "Test ..." rows (see above)
--   Renton, Kirkland, Shoreline, SeaTac, Bothell   their own sites answer 403 to pg_net
--   Issaquah         Cloudflare challenge page; not worked around
--   Burien, Tukwila, Sammamish, Federal Way, Newcastle, Normandy Park, Maple Valley, Covington
--                    /AgendaCenter answers 404 (a different CMS); next probe is each city's own CMS
--   Woodinville, Enumclaw   host does not resolve from pg_net
--   No eSCRIBE tenant found for any King city.
