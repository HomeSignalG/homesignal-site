create or replace function public.zip_scope_members_geom(p_zip text, p_feats jsonb) returns table (ord integer, verdict text)
language plpgsql stable security definer set search_path = geo, public, pg_temp as $f$
declare b geometry := geo.zip_membership_boundary(p_zip);
begin
  if p_zip !~ '^[0-9]{5}$' or p_feats is null or jsonb_typeof(p_feats) <> 'array' then raise exception 'x' using errcode='22023'; end if;
  return query select t.ord::integer, geo.zip_geom_membership_in(b, geo.zip_scope_feature_geom(t.e)) from jsonb_array_elements(p_feats) with ordinality t(e, ord);
end $f$;
