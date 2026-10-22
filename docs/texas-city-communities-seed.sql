-- Texas city communities for the multi-city ZIP pages (Pierce WA / Florida pattern,
-- docs/pierce-city-communities-seed.sql, docs/florida-city-communities-seed.sql). 2026-10-22.
-- A city community exists only for a city whose OWN council source we read
-- (homesignal-ingest feeds.csv mtg-<slug>-city-catchall). level=city, zip_codes '{}', parent = the county root,
-- census_place_geoid from geo.zcta_place_overlap (never typed), so public.zip_government_bodies(zip) links each
-- city to every TX ZIP page whose land it covers by >= 1%.
--
-- WHY: before this, 0 of the cities listed on any TX ZIP page had a source (Dallas on 58 pages, Austin 49,
-- Fort Worth 44, El Paso 24, ...), and 184 TX pages had no government content at all (Tarrant 99, Montgomery 22,
-- Fort Bend 21, Hays 8, Bastrop 5, Burnet 4, plus single-ZIP roots).
--
-- Probed live 2026-10-22 via pg_net (newest 40 events of each tenant, the governing body present):
--   Dallas        Legistar cityofdallas    City Council, 14 upcoming to 2026-12-17
--   Austin        Legistar austintexas     City Council + Work Session, newest council 2026-10-22
--   El Paso       Legistar elpasotexas     City Council + Work Session, newest council 2026-10-27
--   Denton        Legistar denton-tx       City Council, newest 2026-10-28
--   Mesquite      Legistar mesquite        City Council, newest 2026-10-19
--   Round Rock    Legistar roundrock       City Council, newest 2026-10-26
--   McKinney      Legistar mckinney        City Council Regular / Special / Work Session, newest 2026-10-27
--   Garland       CivicClerk garlandtx     City Council Regular Meeting, 15 upcoming
--   Sugar Land    CivicClerk sugarlandtx   City Council Meeting / Workshop, 15 upcoming
--   Flower Mound  CivicClerk flowermoundtx Town Council Meeting / Work Session, 15 upcoming
--   Euless        CivicClerk eulesstx      City Council Meeting / Worksession, newest 2026-10-27
-- Held, with reasons:
--   Fort Worth   Legistar fortworthgov: CITY COUNCIL events stop at 2026-06-16 (the city moved systems).
--   Plano        Legistar plano: 20 of its newest 37 events are agenda status "Hidden", among them a
--                "City Council" on 2026-12-25; the reader stores Hidden events, so it would list placeholders.
--   Houston, Arlington, Frisco, Irving, Carrollton, Lewisville, Conroe, Missouri City, Georgetown, Richardson,
--   Grand Prairie (Legistar 400 settings error), Cedar Park (CivicClerk 0 events), and the other Tarrant /
--   Montgomery / Fort Bend / Hays cities: no Legistar webapi tenant and no CivicClerk tenant under the slugs
--   tried (Legistar 500 "not set up", CivicClerk 404). Not wired.

insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, v.county, 'TX', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Dallas', 'Dallas', 'dallas-tx', 'Dallas city', 'dallas-county-tx'),
             ('Austin', 'Travis', 'austin-tx', 'Austin city', 'travis-county-tx'),
             ('El Paso', 'El Paso', 'el-paso-tx', 'El Paso city', 'el-paso-county-tx'),
             ('Denton', 'Denton', 'denton-tx', 'Denton city', 'denton-county-tx'),
             ('Mesquite', 'Dallas', 'mesquite-tx', 'Mesquite city', 'dallas-county-tx'),
             ('Round Rock', 'Williamson', 'round-rock-tx', 'Round Rock city', 'williamson-county-tx'),
             ('McKinney', 'Collin', 'mckinney-tx', 'McKinney city', 'collin-county-tx'),
             ('Garland', 'Dallas', 'garland-tx', 'Garland city', 'dallas-county-tx'),
             ('Sugar Land', 'Fort Bend', 'sugar-land-tx', 'Sugar Land city', 'fort-bend-county-tx'),
             ('Flower Mound', 'Denton', 'flower-mound-tx', 'Flower Mound town', 'denton-county-tx'),
             ('Euless', 'Tarrant', 'euless-tx', 'Euless city', 'tarrant-county-tx'))
     v(name, county, slug, census_name, parent_slug)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '48%' and place_funcstat = 'A') o on o.place_name = v.census_name
join public.communities p on p.slug = v.parent_slug
where not exists (select 1 from public.communities c where c.slug = v.slug);
