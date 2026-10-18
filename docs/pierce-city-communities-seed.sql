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
