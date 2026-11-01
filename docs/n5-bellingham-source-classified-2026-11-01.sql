-- Map 1 draws City of Bellingham permits (bellingham-trakit-permits), wired 2026-11-01.
--
-- WHAT. A source with no row in geo.n5_accepted_source is frozen as UNCLASSIFIED and Map 1 draws none of its
-- records (same reason as the Skagit, Douglas CO and Oregon rows). Founder cleared this source on 2026-11-01.
--
-- TREATMENT. PROVEN: every row's point is the publisher's own geometry (the city's D_Permits point layer, TRAKiT
-- permits joined by the city to address points, parcels or street centroids). Measured 2026-11-01: 269 of 269
-- in-scope rows carry a point, all inside ZCTAs 98225 / 98226 / 98229.
--
-- TAKES EFFECT with the next generation that opens. Apply only while no generation is BUILDING.

do $$
declare
  v_building int;
  v_after int;
begin
  select count(*) into v_building from geo.n5_generation where state = 'BUILDING';
  if v_building > 0 then
    raise exception 'a generation is BUILDING; apply after it finishes';
  end if;

  insert into geo.n5_accepted_source (registry_id, treatment, projects, pairs)
  values ('bellingham-trakit-permits', 'PROVEN', 0, 0)
  on conflict (registry_id) do nothing;

  select count(*) into v_after from geo.n5_accepted_source
   where registry_id = 'bellingham-trakit-permits' and treatment = 'PROVEN';
  if v_after <> 1 then
    raise exception 'post-check failed: bellingham-trakit-permits is not classified PROVEN';
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   delete from geo.n5_accepted_source where registry_id = 'bellingham-trakit-permits';
