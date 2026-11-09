-- ============================================================================
-- ZIP FACILITY INVENTORY STATE — what a ZIP page may say about its EPA facility count
-- (SQL OF RECORD; APPLIED 2026-11-09 on the founder's go, before homesignal-site PR #2736 merged.)
-- ============================================================================
-- WHY (2026-11-09). The facility count on Map 1 and on the ZIP page has been shown as a plain total whenever the latest
-- EPA read did not fail. But most stored facility lists came from the old ZIP search (one 3-mile circle around a stored
-- point, nearest 40 kept), so a plain number on those pages claims a completeness nobody measured. The ZIP-boundary read
-- (get-address-report, sources/epa-frs-zip.ts) now marks a complete read: counts.facilities_coverage = "zip_boundary_v1".
-- docs/dev-refresh-collect-facility-inventory.sql keeps that marker and its date through a later failed refresh.
--
-- THE ONE DECISION: public.zip_facility_inventory_state(coverage, unavailable, measured) ->
--   'complete'        the stored list came from a complete boundary read, and the latest refresh did not fail
--                     (a count of 0 here is a verified empty ZIP)
--   'complete_as_of'  the stored list came from a complete boundary read; the latest refresh FAILED, so it is the
--                     complete inventory as of last_success_at, not a current one
--   'not_complete'    no complete boundary read is on record (a radius-era list, or every boundary read so far failed):
--                     the stored facilities inside the ZIP are real, but the number is not a total
--   'not_measured'    no ZIP boundary, or no report row: nothing can be said
-- Never decided from a count, a count of 40, or a timestamp.
-- READERS: public.zip_mode_report_sites (Map 1) gains a `facility_inventory` object; public.zip_facility_inventory(zip)
-- returns only that object (the ZIP page's count strip). Both carry member_count = the facilities the canonical boundary
-- predicate places inside the ZIP — the same population Map 1 draws.
--
-- FINGERPRINT GUARD: zip_mode_report_sites is replaced only from the SOURCE body (md5 40780011859b87916d043ae20d6d8f41,
-- 2,016 chars, production read 2026-11-09 and equal to docs/zip-membership-canonical.sql) or re-applied over TARGET
-- (md5 751f297c73b17c4dc684375df1b5b348, 2,631 chars, computed from this file).
-- Rollback: re-apply the function from docs/zip-membership-canonical.sql; drop the two new functions.
-- Tests: test/zip_membership_pg (T8, through the collector in test/dev_collect_inventory_pg).
-- ============================================================================
\set ON_ERROR_STOP on
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $g$
declare b text; begin
  select prosrc into b from pg_proc where oid = 'public.zip_mode_report_sites(text)'::regprocedure;
  if md5(b) not in ('40780011859b87916d043ae20d6d8f41', '751f297c73b17c4dc684375df1b5b348') then
    raise exception 'REFUSED: zip_mode_report_sites md5(prosrc) % is neither SOURCE nor TARGET', md5(b);
  end if;
end $g$;

create or replace function public.zip_facility_inventory_state(p_coverage text, p_unavailable boolean, p_measured boolean)
returns text
language sql
immutable
as $fn$
  select case
           when not coalesce(p_measured, false)                                   then 'not_measured'
           when p_coverage = 'zip_boundary_v1' and p_unavailable is not true     then 'complete'
           when p_coverage = 'zip_boundary_v1'                                     then 'complete_as_of'
           else 'not_complete'
         end
$fn$;

create or replace function public.zip_facility_inventory_json(p_coverage text, p_unavailable boolean,
                                                             p_last_success_at timestamptz, p_measured boolean,
                                                             p_member_count integer)
returns jsonb
language sql
immutable
as $fn$
  select jsonb_build_object(
           'state',           public.zip_facility_inventory_state(p_coverage, p_unavailable, p_measured),
           'coverage',        p_coverage,
           'latest_refresh',  case when p_unavailable is true then 'failed' when p_unavailable is false then 'ok' else 'unknown' end,
           'last_success_at', p_last_success_at,
           'member_count',    case when coalesce(p_measured, false) then p_member_count end)
$fn$;

create or replace function public.zip_mode_report_sites(p_zip text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
declare
  v_sites   jsonb;
  v_counts  jsonb;
  v_unavail boolean;
  v_success timestamptz;
  v_geom    geometry;
  v_out     jsonb;
begin
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;
  select d.sites, d.counts, d.facilities_unavailable, d.facilities_refreshed_at
    into v_sites, v_counts, v_unavail, v_success
    from public.development_reports d where d.zip = p_zip;
  if not found or jsonb_typeof(v_sites) is distinct from 'array' then
    return jsonb_build_object('zip', p_zip, 'status', 'no_report', 'sites', '[]'::jsonb,
      'facility_counts', jsonb_build_object('member', 0, 'outside', 0, 'not_measured', 0, 'no_coordinates', 0),
      'facility_inventory', public.zip_facility_inventory_json(null, null, null, false, null));
  end if;
  v_geom := geo.zip_membership_boundary(p_zip);
  with e as (
    select t.o, t.x,
           (t.x->>'scope') = 'point' as is_point,
           coalesce(t.x->>'relevance', '') = 'development' as is_dev
      from jsonb_array_elements(v_sites) with ordinality t(x, o)
  ),
  v as (
    select e.*,
           case when is_point and not is_dev then geo.zip_point_membership_in(v_geom,
                  case when x->>'lat' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then (x->>'lat')::float8 end,
                  case when x->>'lng' ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then (x->>'lng')::float8 end)
           end as verdict
      from e
     where not (is_point and is_dev)
  )
  select jsonb_build_object(
           'zip', p_zip,
           'status', case when v_geom is null then 'not_measured' else 'complete' end,
           'sites', coalesce(jsonb_agg(case when is_point then x || jsonb_build_object('zip_membership', verdict) else x end
                                       order by o) filter (where not is_point or verdict = 'member'), '[]'::jsonb),
           'facility_counts', jsonb_build_object(
              'member',         count(*) filter (where verdict = 'member'),
              'outside',        count(*) filter (where verdict = 'outside'),
              'not_measured',   count(*) filter (where verdict = 'not_measured'),
              'no_coordinates', count(*) filter (where verdict = 'no_coordinates')))
    into v_out
    from v;
  -- (INVENTORY, docs/zip-facility-inventory.sql) what the facility count may claim: see the header.
  v_out := v_out || jsonb_build_object('facility_inventory', public.zip_facility_inventory_json(
             v_counts->>'facilities_coverage', v_unavail, v_success, v_geom is not null,
             (v_out->'facility_counts'->>'member')::int));
  return v_out;
end
$function$;

revoke all on function public.zip_mode_report_sites(text) from public;
grant execute on function public.zip_mode_report_sites(text) to anon, authenticated, service_role;

-- The ZIP page's count strip: only the inventory object (no site list on the wire).
create or replace function public.zip_facility_inventory(p_zip text)
returns jsonb
language sql
stable
set search_path to 'public', 'pg_temp'
as $fn$ select public.zip_mode_report_sites(p_zip)->'facility_inventory' $fn$;

revoke all on function public.zip_facility_inventory_state(text, boolean, boolean) from public;
revoke all on function public.zip_facility_inventory_json(text, boolean, timestamptz, boolean, integer) from public;
revoke all on function public.zip_facility_inventory(text) from public;
grant execute on function public.zip_facility_inventory_state(text, boolean, boolean) to anon, authenticated, service_role;
grant execute on function public.zip_facility_inventory_json(text, boolean, timestamptz, boolean, integer) to anon, authenticated, service_role;
grant execute on function public.zip_facility_inventory(text) to anon, authenticated, service_role;

do $g$
declare b text; begin
  select prosrc into b from pg_proc where oid = 'public.zip_mode_report_sites(text)'::regprocedure;
  if md5(b) <> '751f297c73b17c4dc684375df1b5b348' then raise exception 'ROLLED BACK: zip_mode_report_sites is % after the replace, not TARGET', md5(b); end if;
  raise notice 'EVIDENCE zip_mode_report_sites md5=% (TARGET)', md5(b);
end $g$;
commit;
