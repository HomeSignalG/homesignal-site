-- Oregon city communities, for the multi-city ZIP pages (same pattern as
-- docs/king-city-communities-seed.sql). A city community exists only once HomeSignal reads that
-- city's own council source; until then public.zip_government_bodies lists the city with
-- "HomeSignal is not reading this city yet".
--   zip_codes '{}'      the city owns no ZIP page; ZIP pages stay parented to the county
--   census_place_geoid  read from geo.zcta_place_overlap inside the insert (never typed)
--   government_topics   '{}' -- a city's topics follow its ACTIVE feeds
--
-- Step 1 (2026-11-01, Oregon audit): Portland, whose ZIP pages (33 overlap the city) read only the county.
--   Source: the City Council agenda list on portland.gov/council/agenda (pg_net 2026-11-01, request 46745:
--   HTTP 200, 89,149 bytes). Each full-council agenda is linked as /council/agenda/<YYYY>/<M>/<D>; the page
--   listed 2026-09-02 .. 2026-11-04, all Wednesdays. Read by homesignal-ingest's dated_pdf_links parser
--   (config portland-or-city-council-agendas). Parent: Multnomah County, where City Hall stands; the
--   city's land in Washington and Clackamas counties is linked by geo.zcta_place_overlap, not by parent.
-- Feed: homesignal-ingest feeds.csv mtg-portland-or-city-catchall (jurisdiction_slug = portland-or).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Multnomah', 'OR', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Portland', 'portland-or')) v(name, slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '41%' and place_funcstat = 'A') o on o.place_name = v.name || ' city'
cross join (select id from public.communities where slug = 'multnomah-county-or') p
where not exists (select 1 from public.communities c where c.slug = v.slug);

-- HELD 2026-11-01 (no community row yet), each probed through pg_net:
--   Beaverton, Hillsboro, Gresham, Tigard, Lake Oswego, Eugene, Springfield, Corvallis, Bend, Medford
--     no CivicClerk tenant (<slug>or.api.civicclerk.com answers 404) and no Legistar tenant (webapi answers 500
--     "LegistarConnectionString setting is not set up"); Granicus <slug>.granicus.com fails or answers 404.
--     Next probe is each city's own site.
--   Salem   Legistar tenant `salem` is Salem OR (events at Loucks Auditorium / Salem Public Library) but its
--           newest event is 2026-06-22; its own meetings page answers 403 to pg_net. Not worked around.
