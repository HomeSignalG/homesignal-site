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
