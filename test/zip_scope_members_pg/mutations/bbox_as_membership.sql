create or replace function public.zip_scope_members(p_zip text, p_pts jsonb) returns table (ord integer, verdict text)
language sql stable security definer set search_path = geo, public, pg_temp as
$$ with b as (select ST_Envelope(geo.zip_membership_boundary(p_zip)) g)
   select t.ord::integer, case when ST_Intersects(ST_SetSRID(ST_MakePoint((t.e->>1)::float8,(t.e->>0)::float8),4269),b.g) then 'member' else 'outside' end
     from jsonb_array_elements(p_pts) with ordinality t(e,ord), b $$;
revoke all on function public.zip_scope_members(text,jsonb) from public, anon, authenticated;
grant execute on function public.zip_scope_members(text,jsonb) to service_role;
