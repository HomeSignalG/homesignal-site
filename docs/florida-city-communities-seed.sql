-- Florida city communities for the multi-city ZIP pages (Pierce WA pattern, docs/pierce-city-communities-seed.sql).
-- 2026-10-21. A city community exists only for a city whose OWN council source we read
-- (homesignal-ingest feeds.csv mtg-<slug>-city-catchall). level=city, zip_codes '{}', parent = the county root,
-- census_place_geoid from geo.zcta_place_overlap (never typed), so public.zip_government_bodies(zip) links each
-- city to every FL ZIP page whose land it covers by >= 1%.
--
-- Probed live 2026-10-21 via pg_net (each source's newest event and its governing body):
--   Fort Lauderdale  Legistar fortlauderdale   City Commission Regular/Conference, newest 2026-10-20
--   Hollywood        Legistar hollywoodfl      Regular City Commission Meeting 2026-10-21
--   Pembroke Pines   Legistar ppines           City Commission 2026-10-21
--   Clearwater       Legistar clearwater       City Council + boards, upcoming 2026-10-22
--   Deerfield Beach  CivicClerk deerfieldbeachfl  Regular City Commission Meeting, newest 2026-10-20
--   Pinellas Park    CivicClerk pinellasparkfl    City Council Workshop / P&Z, 15 upcoming
-- Held, with reasons:
--   Miami        Legistar miamifl: City Commission, but no event after 2026-06-04 (0 since 2026-07-01).
--   Davie        CivicClerk daviefl: 0 events since 2026-07-01.
--   Tampa, St. Petersburg, Orlando, Cape Coral, North Port, Boca Raton, West Palm Beach, Hialeah, Plantation,
--   Largo, Pompano Beach, Sarasota, Miami Beach, Fort Myers, Coral Springs, Sunrise, Naples, Coral Gables,
--   Miramar, Boynton Beach, Delray Beach: no Legistar webapi tenant and no CivicClerk tenant under the slugs
--   tried (Legistar 500 "not set up", CivicClerk 404). Their councils use other systems; not wired.

insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, v.county, 'FL', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Fort Lauderdale', 'Broward', 'fort-lauderdale-fl', 'Fort Lauderdale city', 'broward-county-fl'),
             ('Hollywood', 'Broward', 'hollywood-fl', 'Hollywood city', 'broward-county-fl'),
             ('Pembroke Pines', 'Broward', 'pembroke-pines-fl', 'Pembroke Pines city', 'broward-county-fl'),
             ('Deerfield Beach', 'Broward', 'deerfield-beach-fl', 'Deerfield Beach city', 'broward-county-fl'),
             ('Clearwater', 'Pinellas', 'clearwater-fl', 'Clearwater city', 'pinellas-county-fl'),
             ('Pinellas Park', 'Pinellas', 'pinellas-park-fl', 'Pinellas Park city', 'pinellas-county-fl'))
     v(name, county, slug, census_name, parent_slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '12%' and place_funcstat = 'A') o on o.place_name = v.census_name
join public.communities p on p.slug = v.parent_slug
where not exists (select 1 from public.communities c where c.slug = v.slug);
