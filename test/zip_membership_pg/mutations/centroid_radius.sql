-- MUTATION (must be KILLED): the prohibited substitution. Membership becomes "within 5 miles of
-- the ZIP's centroid" — distance(point, centroid) <= 5 mi — instead of polygon intersection.
create or replace function geo.zip_point_membership_in(p_boundary geometry, p_lat double precision, p_lng double precision)
returns text language sql immutable set search_path to 'geo', 'public', 'pg_temp'
as $function$
  select case
    when p_lat is null or p_lng is null then 'no_coordinates'
    when p_boundary is null then 'not_measured'
    when ST_DistanceSphere(ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4269), ST_Centroid(p_boundary)) / 1609.344 <= 5 then 'member'
    else 'outside'
  end;
$function$;
