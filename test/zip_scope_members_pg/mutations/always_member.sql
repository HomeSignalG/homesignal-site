create or replace function public.zip_scope_members(p_zip text, p_pts jsonb) returns table (ord integer, verdict text)
language sql stable security definer set search_path = geo, public, pg_temp as
$$ select t.ord::integer, 'member'::text from jsonb_array_elements(p_pts) with ordinality t(e,ord) $$;
revoke all on function public.zip_scope_members(text,jsonb) from public, anon, authenticated;
grant execute on function public.zip_scope_members(text,jsonb) to service_role;
