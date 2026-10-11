create or replace function public.zip_scope_members(p_zip text, p_pts jsonb) returns table (ord integer, verdict text)
language sql stable security definer set search_path = geo, public, pg_temp as
$$ select t.ord::integer, case when jsonb_typeof(t.e)<>'array' then 'no_coordinates' else geo.zip_point_membership_in(geo.zip_membership_boundary(p_zip),(t.e->>0)::float8,(t.e->>1)::float8) end
     from jsonb_array_elements(p_pts) with ordinality t(e,ord) order by t.ord $$;
revoke all on function public.zip_scope_members(text,jsonb) from public, anon, authenticated;
grant execute on function public.zip_scope_members(text,jsonb) to service_role;
