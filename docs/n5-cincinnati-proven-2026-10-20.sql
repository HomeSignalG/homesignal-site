-- Map 1 draws Cincinnati's building permits from their stored point (Ohio pre-launch, 2026-10-20)
--
-- WHAT. cincinnati-building-permits sat in geo.n5_accepted_source as treatment RECOVERY, and
-- scripts/n5_shard.py::EXCLUDED_SOURCES excludes it from recovery because the recovery fetcher
-- reads ArcGIS only ("socrata four-segment source_key ... EXCLUDED until configured"). So every
-- daily N5 generation filed all of its keys as SOURCE_EXCLUDED and Map 1 drew none of them.
-- Measured on n5-national-2026-10-20: 2,813 keys SOURCE_EXCLUDED, 0 members on any ZIP, while
-- the engine cache held 2,903 Cincinnati permits on Hamilton County's 56 ZIP pages (newest
-- filed 2026-10-16).
--
-- WHY PROVEN IS RIGHT. PROVEN serves the record's stored point (geo.n5_gen_prepare_publish,
-- part D, D6). Cincinnati's stored points, measured 2026-10-20 over all 2,814 keys:
--   2,388 carry the publisher's own coordinate (geo_precision 'point'),
--     426 carry a geocode that passed sources/geo-fence.ts (geo_precision 'address'; the class
--         the 2026-10-20 founder ruling already lets Map 1 draw, docs/n5-geocoded-sources-served-2026-10-20.sql),
--       0 have no coordinate, 0 fall outside Hamilton County's bounding box, 0 have < 4 decimals.
-- Positive control, same key shape: chicago-, mesa- and seattle-building-permits are Socrata
-- sources under PROVEN and are served (7,392 / 1,304 / 6,209 members on 2026-10-20).
--
-- TAKES EFFECT with the next generation that opens; the ACTIVE generation is unchanged.
-- Apply only while no generation is BUILDING.

do $$
declare
  v_t text;
  v_building int;
begin
  select count(*) into v_building from geo.n5_generation where state = 'BUILDING';
  if v_building > 0 then
    raise exception 'a generation is BUILDING; apply after it finishes';
  end if;

  select treatment into v_t from geo.n5_accepted_source where registry_id = 'cincinnati-building-permits';
  if v_t = 'PROVEN' then
    raise notice 'already applied';
    return;
  end if;
  if v_t is distinct from 'RECOVERY' then
    raise exception 'cincinnati-building-permits treatment is %, expected RECOVERY', v_t;
  end if;

  update geo.n5_accepted_source set treatment = 'PROVEN'
   where registry_id = 'cincinnati-building-permits' and treatment = 'RECOVERY';

  select treatment into v_t from geo.n5_accepted_source where registry_id = 'cincinnati-building-permits';
  if v_t is distinct from 'PROVEN' then
    raise exception 'post-check failed: treatment %', v_t;
  end if;
end $$;

-- ROLLBACK (run only while no generation is BUILDING):
--   update geo.n5_accepted_source set treatment = 'RECOVERY' where registry_id = 'cincinnati-building-permits';
