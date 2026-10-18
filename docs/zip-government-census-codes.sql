-- Census place codes on HomeSignal communities — applied 2026-10-18 (multi-city ZIP pages).
-- public.zip_government_bodies (docs/zip-government-bodies.sql) joins a Census place to the
-- community that publishes it through communities.census_place_geoid. Both sets below are
-- COMPUTED in the database from geo.zcta_place_overlap and refuse unless the expected count
-- moves (claims rules 7/8); neither list is typed by hand.

-- 1. Utah city communities (20 of 21). A city takes a code only when exactly ONE incorporated
--    Utah place (FIPS 49, funcstat A/B) carries its name. Cedar Valley has no 2020 Census place
--    and stays uncoded (the function still shows it through its chain, share unknown).
--    Woodland Hills resolves to its Census place, which lies on 84653 etc., not on its withheld
--    ZIP 84685 — that is the true geography. Fingerprint after:
--    md5(string_agg(name||'|'||census_place_geoid order by name collate "C")) = da6150768092fc772c069ced15776562
do $$
declare n int;
begin
  with c as (select id, name from public.communities where level='city' and state='UT' and census_place_geoid is null),
  m as (select c.id, min(o.place_geoid) g, count(distinct o.place_geoid) k
        from c join geo.zcta_place_overlap o on left(o.place_geoid,2)='49' and o.place_funcstat in ('A','B')
         and regexp_replace(o.place_name,' (city|town)$','') = c.name group by c.id)
  update public.communities x set census_place_geoid = m.g from m where x.id = m.id and m.k = 1;
  get diagnostics n = row_count;
  if n not in (0, 20) then raise exception 'utah back-fill: % rows, expected 20', n; end if;
end $$;

-- 2. County roots that ARE a city (consolidated city-counties and independent cities, 15):
--    one incorporated place covers >= 98% of the land of the root's ZIP pages, or the root's
--    name equals the place's name. NYC's five boroughs, Philadelphia, St. Louis city, New Orleans,
--    Virginia Beach, Anchorage, Juneau, Sitka, Baltimore city, Carson City, Fairfax city VA.
--    Known residuals (consolidated in law, below 98% by ZIP land and differently named):
--    Denver County CO (0.829) and Wyandotte County KS (0.706) — their city is listed as a
--    separate body with no source. Fingerprint after (level county):
--    eb0fae4cb2dcfba51829c3177efa0fa7
do $$
declare n int;
begin
  with r as (select id, name from public.communities where parent_id is null and level='county' and census_place_geoid is null),
  z as (select r.id rid, k.zip_codes[1] zip from r join public.communities k on k.parent_id=r.id and k.level='zip'),
  land as (select z.rid, sum(b.zcta_arealand) tot from (select distinct rid, zip from z) z
    join (select distinct zcta5, zcta_arealand from geo.zcta_place_overlap) b on b.zcta5=z.zip group by 1),
  cov as (select z.rid, o.place_geoid, o.place_name, sum(o.part_arealand) part
    from z join geo.zcta_place_overlap o on o.zcta5=z.zip and o.place_funcstat in ('A','B') group by 1,2,3),
  pick as (select c.rid, c.place_geoid from cov c join land l on l.rid=c.rid join r on r.id=c.rid
    where c.part::numeric/l.tot >= 0.98 or lower(c.place_name)=lower(r.name))
  update public.communities x set census_place_geoid = p.place_geoid from pick p where x.id = p.rid;
  get diagnostics n = row_count;
  if n not in (0, 15) then raise exception 'consolidated roots: % rows, expected 15', n; end if;
end $$;
