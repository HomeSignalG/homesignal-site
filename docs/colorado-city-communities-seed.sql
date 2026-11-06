-- Colorado city communities for the multi-city ZIP pages (pattern: docs/pierce-city-communities-seed.sql).
-- A city community exists only once HomeSignal reads that city's own source.
--   zip_codes '{}'      the town owns no ZIP page; 80654 stays parented to Morgan County
--   census_place_geoid  read from geo.zcta_place_overlap inside the insert (never typed)
--   government_topics   '{}' — a city's topics follow its ACTIVE feeds (zip_government_topics)

-- Wiggins (2026-10-21). Morgan County's own site answers CloudFront 403 "Request blocked" to
-- pg_net and to a GitHub runner (recon-fetch run 39661057343), not worked around. The Town of
-- Wiggins' own calendar (Munibit, app.membershipware.com mwjsPost?tn=wigginscogov) answers
-- HTTP 200 with its Board of Trustees meetings (pg_net request 18450). The town is 0.56% of ZIP
-- 80654 "Wiggins" and lies wholly inside it, so the named-town rule lists it there
-- (docs/zip-government-bodies.sql, founder 2026-10-21).
-- Feeds: homesignal-ingest feeds.csv gov-wiggins-co-town-board, mtg-wiggins-co-town-catchall.
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select 'Wiggins', 'Morgan', p.state, array[]::text[], 'city', p.id, array[]::text[], 'wiggins-co', o.place_geoid
from public.communities p
join (select distinct place_geoid from geo.zcta_place_overlap where place_name = 'Wiggins town' and place_geoid like '08%' and place_funcstat='A') o on true
where p.slug = 'morgan-county-co'
  and not exists (select 1 from public.communities where slug = 'wiggins-co');
-- applied 2026-10-21: Wiggins bfe4bf6d-b53a-45a8-b775-48f51be5f602 (Census place 0884770)

-- Calhan (2026-11-06). Named-town rule: the town is 0.21% of ZIP 80808 "Calhan" and lies inside it.
-- The Town of Calhan's own Revize site lists its Board of Trustees meeting minutes and packets as
-- dated PDFs, "Regular MMDDYY.pdf" / "Special MMDDYY.pdf" (pg_net request 30244 and recon-fetch
-- run 42252053132, both HTTP 200; newest Regular 9/14/26, posted 2026-10-21). A real file answers
-- 200 PDF, a made-up name 404 (pg_net 30247 / 30248). Packets post after the meeting, so the
-- meetings tile shows held meetings, not upcoming ones. The town's TownCloud agenda portal is a
-- script-built page and is not read.
-- Feeds: homesignal-ingest feeds.csv gov-calhan-co-town-board, mtg-calhan-co-town-catchall.
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select 'Calhan', 'El Paso', p.state, array[]::text[], 'city', p.id, array[]::text[], 'calhan-co', o.place_geoid
from public.communities p
join (select distinct place_geoid from geo.zcta_place_overlap where place_name = 'Calhan town' and place_geoid like '08%' and place_funcstat='A') o on true
where p.slug = 'el-paso-county-co'
  and not exists (select 1 from public.communities where slug = 'calhan-co');
-- applied 2026-11-06: Calhan 092a33f4-5998-4553-a6b6-8e9db5720c96 (Census place 0811260), migration calhan_co_town_community_20261106

-- HELD: Ignacio (81137, La Plata County). The town's own site, townofignacio.colorado.gov, lists
-- dated "Town Board Agenda MM-DD-YYYY.pdf" files, but answers HTTP 403 to pg_net (requests 30231,
-- 30232) and to a GitHub runner (recon-fetch run 42252053132), 2026-11-06. Not worked around.
-- Re-check only if the site answers on its own. No community is created until a source is read.
