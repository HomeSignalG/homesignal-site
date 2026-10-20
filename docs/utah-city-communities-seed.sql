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
