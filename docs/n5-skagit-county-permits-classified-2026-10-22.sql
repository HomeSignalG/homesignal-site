-- Map 1 draws Skagit County WA's own permits (2026-10-22)
--
-- WHAT. skagit-county-active-permits is a new registry source (Skagit County Planning's
-- 'Active Permits Last 5 Years' layer; founder: "wire it", 2026-10-22). A source with no row in
-- geo.n5_accepted_source is frozen as UNCLASSIFIED and Map 1 draws none of its records, so
-- without this row the permits would reach the Skagit ZIP pages and never the map.
--
-- TREATMENT PROVEN. The layer is esriGeometryPoint: every row's point is the publisher's own
-- geometry, flattened by the connector to __lat/__lng. No geocoding is involved.
--
-- projects/pairs are filled the way the freeze fills them, from public.app_projects over
-- Skagit County's own ZIP pages. They read 0 if this runs before the refreshed ZIPs carry the
-- source; the counts are informational, the treatment is what N5 reads.
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

  create temp table _sk_zip on commit drop as
    select c.zip_codes[1] as zip
      from public.communities c
     where c.level = 'zip' and c.state in ('WA', 'Washington') and c.county = 'Skagit';
  if (select count(*) from _sk_zip) = 0 then
    raise exception 'Skagit County WA ZIP pages not found';
  end if;

  insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs)
  select 'skagit-county-active-permits', 'PROVEN',
         (select count(distinct source_key) from public.app_projects
           where zip in (select zip from _sk_zip) and registry_id = 'skagit-county-active-permits'),
         (select count(*) from public.app_projects
           where zip in (select zip from _sk_zip) and registry_id = 'skagit-county-active-permits')
  on conflict (registry_id) do nothing;

  select count(*) into v_after from geo.n5_accepted_source
   where registry_id = 'skagit-county-active-permits' and treatment = 'PROVEN';
  if v_after <> 1 then
    raise exception 'post-check failed: skagit-county-active-permits is not PROVEN';
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   delete from geo.n5_accepted_source where registry_id = 'skagit-county-active-permits';
