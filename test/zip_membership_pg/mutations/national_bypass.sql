-- MUTATION (must be KILLED): a SOURCE-SPECIFIC bypass. The national plane skips the canonical
-- predicate and stamps every candidate it retrieved as a member — its own ZIP association.
create or replace function public.national_dc_zip_members(p_zip text)
returns table(source_key text, source_name text, source_url text, project_name text,
              developer_or_operator text, raw_status text, normalized_status text,
              project_type text, lat double precision, lng double precision,
              location_text text, location_precision text, distance_mi numeric,
              last_seen_at timestamptz, has_more boolean, zip_membership text)
language sql stable security definer set search_path to 'public', 'geo', 'pg_temp'
as $function$
  with bb as (select ST_XMin(g) x0, ST_XMax(g) x1, ST_YMin(g) y0, ST_YMax(g) y1
                from (select geo.zip_membership_boundary(p_zip) g) q where g is not null)
  select r.source_key, r.source_name, r.source_url, r.project_name, r.developer_or_operator,
         r.raw_status, r.normalized_status, r.project_type, r.lat, r.lng, r.location_text,
         r.location_precision, null::numeric, r.last_seen_at, false, 'member'::text
    from public.national_dc_records r, bb
   where r.map_eligible and r.lat between bb.y0 and bb.y1 and r.lng between bb.x0 and bb.x1;
$function$;
