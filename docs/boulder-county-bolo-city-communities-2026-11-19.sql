-- City communities for the BOLO ZIP pages (Pierce WA pattern). NOT APPLIED; founder approval required.
-- level=city, zip_codes '{}', parent = the county root, census_place_geoid from geo.zcta_place_overlap by NAME
-- (measured 2026-11-19: Lafayette 0841835, Louisville 0846355, Superior 0875640, Boulder 0807850).
-- Only cities whose own meeting source was verified get a community; Boulder is created for its own feeds later
-- (its PrimeGov host's robots.txt disallows "/", so it is NOT wired yet).
insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
select v.name, 'Boulder', 'CO', array[]::text[], 'city', p.id, array[]::text[], v.slug, o.place_geoid
from (values ('Louisville','louisville-co','Louisville city'), ('Superior','superior-co','Superior town'),
             ('Lafayette','lafayette-co','Lafayette city'), ('Boulder','boulder-co','Boulder city')) v(name, slug, census_name)
join (select distinct place_geoid, place_name from geo.zcta_place_overlap
      where place_geoid like '08%' and place_funcstat = 'A') o on o.place_name = v.census_name
cross join (select id from public.communities where slug = 'boulder-county-co') p
where not exists (select 1 from public.communities c where c.slug = v.slug);
do $$ begin
  if (select count(*) from public.communities where slug in ('louisville-co','superior-co','lafayette-co','boulder-co')) <> 4 then
    raise exception 'expected 4 BOLO city communities';
  end if;
end $$;
