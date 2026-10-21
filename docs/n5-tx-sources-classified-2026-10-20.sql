-- Map 1 draws Austin's issued building permits and the City of Denton's planning projects
-- (Texas pre-launch, 2026-10-20)
--
-- WHAT. geo.n5_accepted_source decides how each N5 generation places a source's records on
-- Map 1. A source with NO row is frozen as UNCLASSIFIED and filed REGISTRY_UNCLASSIFIED: its
-- records stay on the ZIP pages and Map 1 draws none of them (scripts/n5_shard.py, the
-- coalesce(a.treatment,'UNCLASSIFIED') in the freeze).
--
-- Measured 2026-10-20 over every registry source that runs on ZIP pages (244): 12 have no row,
-- 11 of them Texas. The ones holding records today:
--   denton-city-projects-* (7 layers)  127 keys on 15 Denton ZIP pages, 0 Map 1 members.
--     Control, same table, same pages: denton-county-dev-permits 20,422 keys, 20,422 members.
--   baltimore-city-housing-permits     258 keys, 0 members (Maryland; NOT changed here).
-- harris-county-permits, harris-county-plats, houston-plat-applications and
-- san-antonio-prelim-plan-review hold no records on any page today and are NOT changed here.
--
-- austin-issued-construction-permits is turned on for ZIP pages by the 2026-10-20 founder
-- ruling (registry change in the same PR). It has no row either, so without this it would reach
-- the pages and never the map.
--
-- TREATMENTS, each by precedent:
--   austin-issued-construction-permits -> PROVEN. Its registry filter keeps only rows carrying
--     the publisher's own latitude AND longitude, so every stored point is a publisher point;
--     the same treatment as chicago-, mesa- and seattle-building-permits (Socrata, PROVEN).
--   denton-city-projects-* -> RECOVERY. The seven layers are esriGeometryPolygon on the city's
--     own server (maps.cityofdenton.com, layers 0/5/8/9/12/13/15, read 2026-10-20, HTTP 200,
--     maxRecordCount 2000), identity Project_ID, key basis source_id:case_number on all 127
--     keys. That is the shape of fort-worth-zoning-cases and dallas-specific-use-permits, which
--     are RECOVERY: Map 1 re-reads each project's polygon and draws it on every ZIP it touches.
--     All 127 stored points sit inside Denton's bounding box, newest filing 2026-10-06.
--
-- The set is COMPUTED, never transcribed: the Denton layers are the registry ids present in
-- public.app_projects under the 'denton-city-projects-' prefix, fingerprinted below (n=7). The
-- projects/pairs columns are filled the way the freeze filled them: distinct keys and rows.
-- Every read of public.app_projects goes through its ZIP index, over the source's own county's
-- ZIP pages (Denton 32, Travis 86): registry_id has no index, and a whole-table scan of
-- app_projects ran past the 2-minute statement limit on the first apply (nothing committed).
--
-- TAKES EFFECT with the next generation that opens; the ACTIVE generation is unchanged.
-- Apply only while no generation is BUILDING.

do $$
declare
  v_building int;
  v_n int;
  v_fp text;
  v_after int;
begin
  select count(*) into v_building from geo.n5_generation where state = 'BUILDING';
  if v_building > 0 then
    raise exception 'a generation is BUILDING; apply after it finishes';
  end if;

  create temp table _tx_zip on commit drop as
    select c.zip_codes[1] as zip, c.county
      from public.communities c
     where c.level = 'zip' and c.state in ('TX', 'Texas') and c.county in ('Denton', 'Travis');
  if (select count(*) from _tx_zip where county = 'Denton') = 0
     or (select count(*) from _tx_zip where county = 'Travis') = 0 then
    raise exception 'county ZIP pages not found';
  end if;

  select count(*), md5(string_agg(registry_id, ',' order by registry_id collate "C"))
    into v_n, v_fp
    from (select distinct registry_id from public.app_projects
           where zip in (select zip from _tx_zip where county = 'Denton')
             and registry_id like 'denton-city-projects-%') d;
  if v_n <> 7 or v_fp <> md5('denton-city-projects-annexation,denton-city-projects-decided,denton-city-projects-planned-development,denton-city-projects-site-plan,denton-city-projects-specific-use,denton-city-projects-subdivision,denton-city-projects-zoning') then
    raise exception 'Denton city layer set moved: n=% md5=%', v_n, v_fp;
  end if;

  insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs)
  select d.registry_id, 'RECOVERY',
         (select count(distinct p.source_key) from public.app_projects p
           where p.zip in (select zip from _tx_zip where county = 'Denton') and p.registry_id = d.registry_id),
         (select count(*) from public.app_projects p
           where p.zip in (select zip from _tx_zip where county = 'Denton') and p.registry_id = d.registry_id)
    from (select distinct registry_id from public.app_projects
           where zip in (select zip from _tx_zip where county = 'Denton')
             and registry_id like 'denton-city-projects-%') d
  on conflict (registry_id) do nothing;

  insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs)
  select 'austin-issued-construction-permits', 'PROVEN',
         (select count(distinct source_key) from public.app_projects
           where zip in (select zip from _tx_zip where county = 'Travis') and registry_id = 'austin-issued-construction-permits'),
         (select count(*) from public.app_projects
           where zip in (select zip from _tx_zip where county = 'Travis') and registry_id = 'austin-issued-construction-permits')
  on conflict (registry_id) do nothing;

  select count(*) into v_after from geo.n5_accepted_source
   where (registry_id like 'denton-city-projects-%' and treatment = 'RECOVERY')
      or (registry_id = 'austin-issued-construction-permits' and treatment = 'PROVEN');
  if v_after <> 8 then
    raise exception 'post-check failed: % of 8 rows in place', v_after;
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   delete from geo.n5_accepted_source
--    where registry_id like 'denton-city-projects-%' or registry_id = 'austin-issued-construction-permits';
