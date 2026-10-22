-- Map 1 draws City of Spokane permits (2026-10-22)
--
-- WHAT. spokane-city-permits is a new registry source (Washington audit step 2; founder: "go",
-- then "Yes, last 12 months", 2026-10-22). A source with no row in geo.n5_accepted_source is
-- frozen as UNCLASSIFIED and Map 1 draws none of its records, so without this row the permits
-- would reach the Spokane ZIP pages and never the map.
--
-- TREATMENT PROVEN. Every record carries the city's own point geometry (esriGeometryPoint,
-- read with outSR=4326); nothing is geocoded.
--
-- projects/pairs are filled the way the freeze fills them, from public.app_projects over every
-- Washington ZIP page; the counts are informational, the treatment is what N5 reads.
--
-- TAKES EFFECT with the next generation that opens; the ACTIVE generation is unchanged.
-- Apply only while no generation is BUILDING.

do $$
declare
  v_building int;
  v_after int;
begin
  select count(*) into v_building from geo.n5_generation where state = 'BUILDING';
  if v_building > 0 then
    raise exception 'a generation is BUILDING; apply after it finishes';
  end if;

  create temp table _wa_zip on commit drop as
    select c.zip_codes[1] as zip
      from public.communities c
     where c.level = 'zip' and c.state in ('WA', 'Washington');
  if (select count(*) from _wa_zip) = 0 then
    raise exception 'Washington ZIP pages not found';
  end if;

  insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs)
  select 'spokane-city-permits', 'PROVEN',
         (select count(distinct source_key) from public.app_projects
           where zip in (select zip from _wa_zip) and registry_id = 'spokane-city-permits'),
         (select count(*) from public.app_projects
           where zip in (select zip from _wa_zip) and registry_id = 'spokane-city-permits')
  on conflict (registry_id) do nothing;

  select count(*) into v_after from geo.n5_accepted_source
   where registry_id = 'spokane-city-permits' and treatment = 'PROVEN';
  if v_after <> 1 then
    raise exception 'post-check failed: spokane-city-permits is not PROVEN';
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   delete from geo.n5_accepted_source where registry_id = 'spokane-city-permits';
