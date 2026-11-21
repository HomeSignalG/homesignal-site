create or replace function geo.zip_geom_membership_in(p_boundary geometry, p_geom geometry) returns text language sql immutable as
$$ select case when p_geom is null or ST_IsEmpty(p_geom) then 'no_coordinates' when p_boundary is null then 'not_measured'
 when exists (select 1 from ST_DumpPoints(ST_SetSRID(p_geom,4269)) d where ST_Intersects(d.geom, p_boundary)) then 'member' else 'outside' end $$;
