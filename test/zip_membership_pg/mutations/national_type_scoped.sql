-- MUTATION (must be KILLED): TYPE decides geography. The national read admits a member only when
-- its project Type is the one the original feed used, so another Type at the same coordinate
-- (a future feed, a different classification) silently loses its ZIP.
create or replace function public.national_dc_zip_members(p_zip text)
returns table(source_key text, source_name text, source_url text, project_name text,
              developer_or_operator text, raw_status text, normalized_status text,
              project_type text, lat double precision, lng double precision,
              location_text text, location_precision text, distance_mi numeric,
              last_seen_at timestamptz, has_more boolean, zip_membership text)
language sql stable security definer set search_path to 'public', 'geo', 'pg_temp'
as $function$
  with g as (select geo.zip_membership_boundary(p_zip) as geom)
  select r.source_key, r.source_name, r.source_url, r.project_name, r.developer_or_operator,
         r.raw_status, r.normalized_status, r.project_type, r.lat, r.lng, r.location_text,
         r.location_precision, null::numeric, r.last_seen_at, false, 'member'::text
    from public.national_dc_records r, g
   where r.map_eligible and g.geom is not null and r.project_type = 'datacenter'
     and geo.zip_point_membership_in(g.geom, r.lat, r.lng) = 'member';
$function$;
