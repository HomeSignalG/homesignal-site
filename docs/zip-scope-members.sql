-- docs/zip-scope-members.sql — DDL of record for public.zip_scope_members(p_zip, p_pts)
-- STATUS: NOT APPLIED. Applying it is a separate, explicitly authorised step
-- (docs/zip-scope-bounds-runbook.md §1b). Written 2026-10-11.
--
-- WHAT IT IS
-- A BATCH wrapper around the ONE existing point-in-ZIP predicate. The ZIP-mode spatial scope
-- (sources/scope-box.ts) fetches the union of the legacy centroid scope and the polygon's bounding
-- box. The box is a PREFILTER: a record that lies in the box but outside the polygon belongs to a
-- different ZIP. This function lets the engine ask, for the records ADDED SOLELY BY THE BOX, which
-- of them are really inside the canonical polygon — in ONE call per batch, not one call per record.
--
--   boundary  = geo.zip_membership_boundary(p_zip)               (fetched ONCE per call)
--   verdict   = geo.zip_point_membership_in(boundary, lat, lng)  (boundary-INCLUSIVE, unchanged)
--
-- It decides nothing itself and holds no geometry of its own.
--
-- CONTRACT
--   input   p_zip  exactly 5 digits;  p_pts  a JSON array of [lat, lng] pairs, at most 1000.
--   output  one row per input element, ord = 1-based input position, in input order:
--           ord | verdict   with verdict in member | outside | not_measured | no_coordinates
--   A malformed ELEMENT (not a 2-number array, NaN-like, out of the lat/lng domain) yields
--   'no_coordinates' for THAT element — correspondence is never lost and one bad record never
--   fails the batch. A malformed CALL (bad ZIP, not an array, > 1000 elements) RAISES (22023);
--   the caller treats any error as "membership unknown" and uses the legacy scope.
--   A ZIP with no usable boundary yields 'not_measured' for every element, never a guess.
--
-- ACCESS: service role only. Supabase's default privileges grant EXECUTE on every new public
-- function to anon/authenticated DIRECTLY; `revoke … from public` does not remove that, so they
-- are revoked by name and proven below. SECURITY DEFINER with a pinned search_path.

create or replace function public.zip_scope_members(p_zip text, p_pts jsonb)
returns table (ord integer, verdict text)
language plpgsql
stable
security definer
set search_path = geo, public, pg_temp
as $fn$
declare
  b geometry;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'zip_scope_members: p_zip must be exactly 5 digits' using errcode = '22023';
  end if;
  if p_pts is null or jsonb_typeof(p_pts) <> 'array' then
    raise exception 'zip_scope_members: p_pts must be a JSON array of [lat,lng] pairs' using errcode = '22023';
  end if;
  if jsonb_array_length(p_pts) > 1000 then
    raise exception 'zip_scope_members: at most 1000 points per call' using errcode = '22023';
  end if;

  b := geo.zip_membership_boundary(p_zip);

  return query
  select t.ord::integer,
         case
           when jsonb_typeof(t.e) <> 'array'
             or jsonb_array_length(t.e) <> 2
             or jsonb_typeof(t.e -> 0) <> 'number'
             or jsonb_typeof(t.e -> 1) <> 'number'
             or abs((t.e ->> 0)::numeric) > 90
             or abs((t.e ->> 1)::numeric) > 180
             then 'no_coordinates'
           else geo.zip_point_membership_in(b, (t.e ->> 0)::double precision, (t.e ->> 1)::double precision)
         end
    from jsonb_array_elements(p_pts) with ordinality as t(e, ord)
   order by t.ord;
end;
$fn$;

revoke all on function public.zip_scope_members(text, jsonb) from public;
revoke all on function public.zip_scope_members(text, jsonb) from anon, authenticated;
grant execute on function public.zip_scope_members(text, jsonb) to service_role;

-- Post-conditions: fail the whole migration rather than ship an open or wrong function.
do $$
declare r record; n int := 0;
begin
  if has_function_privilege('anon', 'public.zip_scope_members(text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.zip_scope_members(text,jsonb)', 'execute') then
    raise exception 'zip_scope_members is executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.zip_scope_members(text,jsonb)', 'execute') then
    raise exception 'zip_scope_members is not executable by service_role';
  end if;
  -- Correspondence + malformed-element handling (does not need any boundary to exist).
  for r in select * from public.zip_scope_members('00000', '[[1,2],"x",[999,1],[1]]'::jsonb) order by ord loop
    n := n + 1;
    if r.ord <> n then raise exception 'zip_scope_members lost input order'; end if;
    if n = 1 and r.verdict <> 'not_measured' then raise exception 'no-boundary ZIP must be not_measured'; end if;
    if n > 1 and r.verdict <> 'no_coordinates' then raise exception 'malformed element must be no_coordinates'; end if;
  end loop;
  if n <> 4 then raise exception 'zip_scope_members must return one row per input element'; end if;
end $$;
