-- The incorporated city a saved home lies in, as the Census geocoder states it
-- (step 7 of the multi-city ZIP page build, option 3, 2026-10-18).
--
-- A ZIP can lie in several cities (zip_government_bodies). For a home with an exact
-- address the question "which city governs THIS house" has one answer, and the Census
-- geographies geocoder gives it (supabase/functions/geocode-address v2, layer
-- "Incorporated Places"). The add-your-home flow writes it here; the alert-topic picker
-- reads it to mark the government that covers the home.
--
--   place_geoid       7-digit Census place GEOID, or null
--   place_checked_at  when the geocoder answered. null = never asked (every home saved
--                     before this change), so nothing is claimed. Set with place_geoid
--                     null = asked, and the home lies in no incorporated place (the
--                     county governs it).
--
-- Additive only: two nullable columns, no backfill. Table grants already cover new
-- columns; RLS on app_properties is unchanged.
alter table public.app_properties
  add column if not exists place_geoid text,
  add column if not exists place_checked_at timestamptz;

do $do$
begin
  if exists (select 1 from public.app_properties where place_geoid is not null and place_geoid !~ '^\d{7}$') then
    raise exception 'app_properties.place_geoid holds a non-GEOID value';
  end if;
end
$do$;

alter table public.app_properties
  drop constraint if exists app_properties_place_geoid_shape;
alter table public.app_properties
  add constraint app_properties_place_geoid_shape
  check (place_geoid is null or (place_geoid ~ '^\d{7}$' and place_checked_at is not null));
