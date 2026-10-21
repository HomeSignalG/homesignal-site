-- Utah city communities for the ZIP pages (same pattern as docs/king-city-communities-seed.sql and
-- docs/pierce-city-communities-seed.sql). A city community exists only once HomeSignal reads that city's
-- own council source; until then public.zip_government_bodies lists the city as not read yet.
--   zip_codes '{}'      the city owns no ZIP page; ZIP pages stay parented to the county
--   census_place_geoid  read from geo.zcta_place_overlap inside the insert (never typed)
--   government_topics   '{}' — a city's topics follow its ACTIVE feeds
--
-- Why (docs/utah-prelaunch-audit-2026-10-20.md, Finding 3): 193 of 214 cities listed on Utah ZIP pages
-- had no source. Utah County's cities, Brigham City, Tremonton and Bluffdale predate this file.
--
-- Step 1 (2026-10-20): the ten largest unread cities by page count. Each council's Utah Public Notice
-- (PMN) body was found by search and verified first-party through pg_net the same day (body page
-- "Entity Name" and its upcoming notices):
--   Salt Lake City   body 1360  entity Salt Lake City    formal meeting 2026-10-20
--   West Valley City body 398   entity West Valley City  regular meeting 2026-10-13
--   Millcreek        body 5741  entity Millcreek         work + regular meeting 2026-10-12
--   West Jordan      body 395   entity West Jordan       public hearing 2026-10-27
--   Sandy            body 464   entity Sandy             council meeting 2026-10-20, hearing 2026-11-10
--   Murray           body 735   entity Murray            council meeting 2026-10-20
--   Draper           body 5555  entity Draper            council agenda 2026-10-20
--   Ogden            body 6587  entity Ogden             "City Council, Redevelopment Agency, Municipal
--                                                        Building Authority" (Ogden posts all three under
--                                                        one body), agenda 2026-10-21
--   Logan            body 494   entity Logan             regular meeting 2026-10-20
--   St. George       body 241   entity St. George        regular meeting 2026-10-22
--   (body 1371 is North Ogden, a different city; 9431 is Ogden Valley; both rejected for Ogden)
-- Feeds: homesignal-ingest feeds.csv ut-<slug>-council-notices / ut-<slug>-council-agenda
-- (jurisdiction_slug = slug, html route on utah.gov/pmn/sitemap/publicbody/<id>.html).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, v.county, 'UT', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Salt Lake City','Salt Lake','salt-lake-city-ut','salt-lake-county'), ('West Valley City','Salt Lake','west-valley-city-ut','salt-lake-county'),
             ('Millcreek','Salt Lake','millcreek-ut','salt-lake-county'), ('West Jordan','Salt Lake','west-jordan-ut','salt-lake-county'),
             ('Sandy','Salt Lake','sandy-ut','salt-lake-county'), ('Murray','Salt Lake','murray-ut','salt-lake-county'), ('Draper','Salt Lake','draper-ut','salt-lake-county'),
             ('Ogden','Weber','ogden-ut','weber-county'), ('Logan','Cache','logan-ut','cache-county'), ('St. George','Washington','st-george-ut','washington-county-ut')) v(name, county, slug, root)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap where place_geoid like '49%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
join public.communities p on p.slug = v.root and p.state = 'UT' and p.level = 'county'
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-20: Salt Lake City a3d153a5-104d-489c-9837-4dd1411f9ba2 (4967000)
--   · West Valley City 307716e4-0607-4aa1-b99e-1eaf7cb4ede2 (4983470) · Millcreek 73439b69-a370-4d70-910d-5f40a2aa38fa (4950150)
--   · West Jordan 5a7a16f1-ba2b-4634-bba3-7ef790f3ef6c (4982950) · Sandy eebc16ab-998e-4782-be7a-9a028d60d18f (4967440)
--   · Murray 9724eb3c-07fc-46f4-a18f-2536ddf5f7eb (4953230) · Draper 01141b73-1499-4ee9-a3aa-766647a96fa0 (4920120)
--   · Ogden 0aedf490-6da3-4fad-b5ff-23cb4d299d8f (4955980) · Logan 88a7ada9-aa22-493c-8c09-3c4e9adf7d83 (4945860)
--   · St. George 0816ae8d-41f7-4caf-9913-4f814c66304b (4965330)

-- Step 2 (2026-10-21): seventeen more city councils. Bodies come from the PMN's own municipality
-- browse (/pmn/list/entities.html?id=3 then /pmn/list/publicBodies.html?id=<entity>), and each body
-- page was read through pg_net the same day (Public Body Name, Entity Name, newest notice date):
--   Taylorsville       body 720   entity Taylorsville        "Taylorsville City Council", newest 2026-12-15
--   Holladay           body 388   entity Holladay            newest 2026-10-22
--   South Salt Lake    body 1295  entity South Salt Lake     newest 2026-10-14
--   Cottonwood Heights body 2147  entity Cottonwood Heights  newest 2026-10-20
--   Midvale            body 753   entity Midvale             newest 2026-12-01 (758/760/9179 are community councils, not the city)
--   Riverton           body 889   entity Riverton            newest 2026-10-20
--   Herriman           body 1155  entity Herriman            newest 2026-10-14 (1251 is the joint council/planning work meeting)
--   South Jordan       body 1031  entity South Jordan        newest 2026-10-20
--   Layton             body 315   entity Layton              newest 2026-10-15
--   Centerville        body 445   entity Centerville         newest 2026-10-20
--   North Salt Lake    body 452   entity City of North Salt Lake  newest 2026-10-20
--   Clearfield         body 295   entity Clearfield (5775)   newest 2026-11-10
--   West Point         body 369   entity West Point          newest 2026-10-20
--   Roy                body 9     entity Roy                 newest 2026-10-20
--   Vineyard           body 530   entity Vineyard            newest 2026-10-13 (Census "Vineyard town")
--   Cedar City         body 428   entity Cedar City          newest 2026-10-21
--   Santa Clara        body 1613  entity Santa Clara         newest 2026-10-20
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, v.county, 'UT', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Taylorsville','Salt Lake','taylorsville-ut','salt-lake-county'), ('Holladay','Salt Lake','holladay-ut','salt-lake-county'),
             ('South Salt Lake','Salt Lake','south-salt-lake-ut','salt-lake-county'), ('Cottonwood Heights','Salt Lake','cottonwood-heights-ut','salt-lake-county'),
             ('Midvale','Salt Lake','midvale-ut','salt-lake-county'), ('Riverton','Salt Lake','riverton-ut','salt-lake-county'),
             ('Herriman','Salt Lake','herriman-ut','salt-lake-county'), ('South Jordan','Salt Lake','south-jordan-ut','salt-lake-county'),
             ('Layton','Davis','layton-ut','davis-county'), ('Centerville','Davis','centerville-ut','davis-county'),
             ('North Salt Lake','Davis','north-salt-lake-ut','davis-county'), ('Clearfield','Davis','clearfield-ut','davis-county'),
             ('West Point','Davis','west-point-ut','davis-county'), ('Roy','Weber','roy-ut','weber-county'),
             ('Vineyard','Utah','vineyard-ut','utah-county'), ('Cedar City','Iron','cedar-city-ut','iron-county-ut'),
             ('Santa Clara','Washington','santa-clara-ut','washington-county-ut')) v(name, county, slug, root)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap where place_geoid like '49%' and place_funcstat = 'A') o
  on o.place_name in (v.name || ' city', v.name || ' town')
join public.communities p on p.slug = v.root and p.state = 'UT' and p.level = 'county'
where not exists (select 1 from public.communities c where c.slug = v.slug);
-- applied 2026-10-21 (migration utah_city_communities_step2_17_cities_20261021):
--   Cedar City bea4faa8-4709-44ed-862f-574c71236a9f (4911320)
--   Centerville afe7b011-72bc-461c-ba0d-b40a96f260f5 (4911980)
--   Clearfield 72ce6af3-1e7c-4b40-8aa0-6d1e1c81741a (4913850)
--   Cottonwood Heights 01c9ba57-db76-421d-bdfd-4ff61a545d07 (4916270)
--   Herriman 45cf9deb-04b8-4599-b50c-6eddf9f79a81 (4934970)
--   Holladay 94089e93-fe10-4f76-8bf4-162a3228ec31 (4936070)
--   Layton 585a3ced-7578-4ad4-a35d-73428ce6672b (4943660)
--   Midvale a650d11f-7eb6-4052-a7d9-c438cda7b5ea (4949710)
--   North Salt Lake 49bb2d34-67f6-4e57-b256-4d9dfc83e401 (4955210)
--   Riverton cd03a745-e438-4e06-a5aa-71a406ad171a (4964340)
--   Roy e5a3210a-3a62-4624-8ca4-e3a7d79acffc (4965110)
--   Santa Clara 3e5dcb58-11f4-492d-8a0d-7d695e38b405 (4967660)
--   South Jordan 27ddfa89-65e9-483c-94b5-9efe497e1db5 (4970850)
--   South Salt Lake 746eb682-07bc-4518-bcb2-ebabca713c25 (4971070)
--   Taylorsville 341c2abe-47b9-4590-8f03-d152a7b36035 (4975360)
--   Vineyard f5c8b70d-781c-4247-bcb8-2a31181602a5 (4980420)
--   West Point 5e5cab44-33f2-45fd-9d20-b206afea0100 (4983390)
