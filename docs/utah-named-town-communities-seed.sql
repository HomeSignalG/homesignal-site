-- Utah named towns: one level=city community for each Utah town that a ZIP page lists under the named-town
-- rule (docs/zip-government-bodies.sql) and that had no source (2026-10-25).
-- Queue: homesignal-ingest scripts/measure_unsourced_named_towns.sql; 31 Utah rows on 2026-10-24.
-- Same shape as docs/skagit-city-communities-seed.sql: level=city, zip_codes '{}' (the ZIP page stays parented
-- to its county), parent = that ZIP page's county root, census_place_geoid from zip_government_places.
-- The set is computed here, never typed (claims rule 7), and the insert refuses unless it is the 31 places
-- measured on 2026-10-25 (md5 over place_geoid sorted collate "C").
-- Source: every one of the 31 publishes its council on the Utah Public Notice Website (utah.gov/pmn), which the
-- engine already reads. Each town's council body was found through the site's own entity and public-body lists
-- and checked through pg_net on 2026-10-25: all 31 have notices dated inside the last 90 days.
-- Feeds: homesignal-ingest feeds.csv gov-<slug>-town-council (notices) + mtg-<slug>-town-catchall (meetings),
-- jurisdiction_slug = the slug below.
do $$
declare
  _n int;
  _md5 text;
begin
  create temp table _ut_towns on commit drop as
  select g.place_geoid,
         regexp_replace(min(g.place_name), ' (city|town)$', '') as name,
         min(r.id::text)::uuid as parent_id,
         min(r.county) as county
    from public.zip_government_places g
    join public.communities z on z.level = 'zip' and z.zip_codes @> array[g.zip]
    join public.communities r on r.id = z.parent_id and r.level = 'county'
   where g.admitted_by = 'named_town' and z.state = 'UT'
     and not exists (select 1 from public.communities c where c.census_place_geoid = g.place_geoid)
   group by g.place_geoid;
  select count(*), md5(string_agg(place_geoid, ',' order by place_geoid collate "C")) into _n, _md5 from _ut_towns;
  if _n = 0 then
    raise notice 'already applied: no Utah named town without a community';
    return;
  end if;
  if _n <> 31 or _md5 <> '035a1146f5d7ae4fc5c112e779b7b54e' then
    raise exception 'Utah named-town set moved: n=% md5=% (expected 31 / 035a1146f5d7ae4fc5c112e779b7b54e)', _n, _md5;
  end if;
  insert into public.communities (name, county, state, zip_codes, level, parent_id, government_topics, slug, census_place_geoid)
  select t.name, t.county, 'UT', array[]::text[], 'city', t.parent_id, array[]::text[],
         lower(replace(t.name, ' ', '-')) || '-ut', t.place_geoid
    from _ut_towns t;
end $$;
