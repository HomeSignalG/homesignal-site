-- Map 1 draws Douglas County CO's own permits (Colorado pre-launch, 2026-10-21)
--
-- WHAT. douglas-county-co-permits is a new registry source (All_Permits_View, the county's own
-- table of permits it issues in unincorporated Douglas County; founder approved it for ZIP pages,
-- Map 1 and paid reports on 2026-10-21). A source with no row in geo.n5_accepted_source is
-- frozen as UNCLASSIFIED and Map 1 draws none of its records, so without this row the permits
-- would reach the 14 Douglas ZIP pages and never the map.
--
-- TREATMENT PROVEN, by precedent. Each row's point is the publisher's own, stated as text in
-- LOCATION and read by the connector's latlng_text_col; a row without it falls back to the
-- fenced address geocode. That is cincinnati-building-permits' shape (publisher coordinates plus
-- fenced geocodes, PROVEN since 2026-10-20). A failed geocode leaves the record unpinned, which
-- N5 rejects; nothing is guessed.
--
-- projects/pairs are filled the way the freeze fills them, from public.app_projects over
-- Douglas County's own ZIP pages (registry_id has no index). They read 0 if this runs before the
-- refreshed ZIPs carry the source; the counts are informational, the treatment is what N5 reads.
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

  create temp table _dg_zip on commit drop as
    select c.zip_codes[1] as zip
      from public.communities c
     where c.level = 'zip' and c.state in ('CO', 'Colorado') and c.county = 'Douglas';
  if (select count(*) from _dg_zip) = 0 then
    raise exception 'Douglas County CO ZIP pages not found';
  end if;

  insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs)
  select 'douglas-county-co-permits', 'PROVEN',
         (select count(distinct source_key) from public.app_projects
           where zip in (select zip from _dg_zip) and registry_id = 'douglas-county-co-permits'),
         (select count(*) from public.app_projects
           where zip in (select zip from _dg_zip) and registry_id = 'douglas-county-co-permits')
  on conflict (registry_id) do nothing;

  select count(*) into v_after from geo.n5_accepted_source
   where registry_id = 'douglas-county-co-permits' and treatment = 'PROVEN';
  if v_after <> 1 then
    raise exception 'post-check failed: douglas-county-co-permits is not PROVEN';
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   delete from geo.n5_accepted_source where registry_id = 'douglas-county-co-permits';
