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
