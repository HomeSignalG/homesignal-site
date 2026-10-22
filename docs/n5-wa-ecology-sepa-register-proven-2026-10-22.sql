-- Map 1 draws Washington Ecology SEPA Register projects (2026-10-22)
--
-- WHAT. wa-ecology-sepa-register is a new statewide WA registry source (#2169; founder: "yes",
-- 2026-10-22). A source with no row in geo.n5_accepted_source is frozen as UNCLASSIFIED and Map 1
-- draws none of its records, so without this row the projects would reach the WA ZIP pages and
-- never the map.
--
-- TREATMENT PROVEN. Most records carry Ecology's own coordinates (Socrata latitude/longitude);
-- the rest are placed by geocoding the record's own address, which passed the engine's geocode
-- fence. Map 1 serves geocoded points under the founder ruling of 2026-10-20 (CLAUDE.md 7.12b),
-- and sources placed that way (boulder, hartford, naperville) are PROVEN. Area-only records have
-- no point and become notices, not map dots.
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
  select 'wa-ecology-sepa-register', 'PROVEN',
         (select count(distinct source_key) from public.app_projects
           where zip in (select zip from _wa_zip) and registry_id = 'wa-ecology-sepa-register'),
         (select count(*) from public.app_projects
           where zip in (select zip from _wa_zip) and registry_id = 'wa-ecology-sepa-register')
  on conflict (registry_id) do nothing;

  select count(*) into v_after from geo.n5_accepted_source
   where registry_id = 'wa-ecology-sepa-register' and treatment = 'PROVEN';
  if v_after <> 1 then
    raise exception 'post-check failed: wa-ecology-sepa-register is not PROVEN';
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   delete from geo.n5_accepted_source where registry_id = 'wa-ecology-sepa-register';
