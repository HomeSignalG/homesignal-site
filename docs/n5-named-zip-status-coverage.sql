-- ⛔ PARKED — DO NOT APPLY. Step 7 of the TIGER/ZCTA health plan (2026-09-28).
-- Named-ZIP READY coverage for 94128, 95219, 99128.
--
-- ⚖️ STANDING FOUNDER LOCK (2026-09-27), restated on this park:
--   "Do not unlist ~1,005 map pages just because they have plants and no new
--    construction. 'Nothing is being built' is a valid answer. Those pages stay listed.
--    This was the old Unit 1 idea; it is rejected."
-- The `_nfc >= 3` limb of `indexable` STAYS. Unit 1 is rejected.
-- EPA-only / plant-only Map 1 pages remain listed. This park does not assign
-- indexable, does not change robots, and does not unlist any ZIP page.
--
-- This file documents the intended gate. It is NOT a splice of
-- geo.n5_generation_publish_problems. It never calls geo.n5_generation_activate.
-- Parking is not taking the live write for the 3 ZIPs. Do not activate a
-- generation from this park. Do not reload geo.zcta_boundary. Do not dispatch
-- phase2-b1-zcta.
--
-- The live COUNT check canonical_zip_without_status can still miss a named ZIP
-- if someone deletes CANDIDATES in scripts/verify-map1-zip-states.mjs or if the
-- serving generation was activated before the publish_scope union existed.
-- This function names the three ZIPs. READY must fail when a named ZIP exists
-- in public.canonical_zip_registry and has no geo.maps_zip_geography_status
-- row for the generation. It does not require status for a ZIP that is not in
-- the registry.

DO $$
BEGIN
  RAISE EXCEPTION
    'geo.n5_named_zip_status_problems is PARKED (Step 7). Do not apply this file. Never activate a generation from this park. Unit 1 is rejected; plant-only pages stay listed.';
END
$$;

-- Intended gate (unreachable on apply because the DO block above raises).
-- Kept in this file so the offline checker can pin the named list and the
-- registry join. Not a live writer.

create or replace function geo.n5_named_zip_status_problems(p_generation_id text)
returns table(check_name text, n bigint, detail text)
language sql
stable
as $fn$
  select
    'named_zip_without_status'::text as check_name,
    count(*)::bigint as n,
    string_agg(z.zip, ',' order by z.zip collate "C") as detail
  from (
    select unnest(array['94128', '95219', '99128']::text[]) as zip
  ) z
  join public.canonical_zip_registry r
    on r.zip = z.zip
  left join geo.maps_zip_geography_status s
    on s.generation_id = p_generation_id
   and s.zcta5::text = z.zip
  where s.zcta5 is null;
$fn$;
