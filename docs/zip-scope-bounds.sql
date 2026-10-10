-- docs/zip-scope-bounds.sql — DDL of record for public.zip_scope_bounds(p_zip)
-- STATUS: NOT APPLIED. Written 2026-10-10 on an isolated branch; applying it is a separate,
-- explicitly authorised step (see docs/geographic-coverage-audit-2026-10-10.md §7).
--
-- WHAT IT IS
-- The bounding box of a ZIP's CANONICAL polygon, for the ZIP-mode spatial prefilter of radius-scoped
-- sources (supabase/functions/get-address-report/sources/scope-box.ts). It is a thin projection of
-- the one existing boundary authority, geo.zip_membership_boundary(zip) — it reads no table of its
-- own and holds no second copy of ZIP geometry. A ZIP with no boundary (not_measured) returns no
-- row, never a guessed box.
--
-- IT IS A PREFILTER, NOT MEMBERSHIP. Who belongs to a ZIP is decided by
-- geo.zip_point_membership_in / the serving generation. Nothing here changes that.
--
-- ACCESS: service role only (the engine calls it with the service key). Supabase's default
-- privileges grant EXECUTE on every new public function to anon/authenticated DIRECTLY, and a
-- `revoke … from public` does not remove a direct grant — revoke them by name and prove it.

create or replace function public.zip_scope_bounds(p_zip text)
returns table (xmin double precision, ymin double precision, xmax double precision, ymax double precision)
language sql
stable
security definer
set search_path = geo, public, pg_temp
as $fn$
  select ST_XMin(g), ST_YMin(g), ST_XMax(g), ST_YMax(g)
    from (select geo.zip_membership_boundary(p_zip) as g) s
   where g is not null
     and p_zip ~ '^[0-9]{5}$';
$fn$;

revoke all on function public.zip_scope_bounds(text) from public;
revoke all on function public.zip_scope_bounds(text) from anon, authenticated;
grant execute on function public.zip_scope_bounds(text) to service_role;

-- Post-conditions (fail the whole migration rather than ship an open or wrong function).
do $$
begin
  if has_function_privilege('anon', 'public.zip_scope_bounds(text)', 'execute')
     or has_function_privilege('authenticated', 'public.zip_scope_bounds(text)', 'execute') then
    raise exception 'zip_scope_bounds is executable by anon/authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.zip_scope_bounds(text)', 'execute') then
    raise exception 'zip_scope_bounds is not executable by service_role';
  end if;
  -- Same box as the canonical boundary, on a known-wide ZIP (76247 Justin, TX).
  if not exists (
    select 1 from public.zip_scope_bounds('76247') b
     where b.xmin < b.xmax and b.ymin < b.ymax
       and b.xmin = ST_XMin(geo.zip_membership_boundary('76247'))
       and b.ymax = ST_YMax(geo.zip_membership_boundary('76247'))
  ) then
    raise exception 'zip_scope_bounds(76247) does not match geo.zip_membership_boundary';
  end if;
  -- A ZIP with no boundary yields NO row.
  if exists (select 1 from public.zip_scope_bounds('00000')) then
    raise exception 'zip_scope_bounds returned a row for a ZIP with no boundary';
  end if;
end $$;
