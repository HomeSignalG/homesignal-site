-- Unit A4 — the projects/markers delivery contract. DDL of record.
--
-- ADDITIVE. public.app_projects_for_zip is NOT modified; its body still fingerprints
-- ec1b01ae4485ad2c59b9f946c9d565b6 and remains the resident path. This is a SECOND function,
-- and the frontend calls it only behind a flag that is OFF by default, so shipping A4 cannot
-- move any ZIP onto authoritative geography.
--
-- WHY SECURITY DEFINER: authoritative mode reads geo.zip_authoritative_membership and
-- geo.zip_authoritative_marker. The browser roles have NO usage on the geo schema and must not
-- get any (Step 14), so the function — not the table — is the delivery surface.
-- Least privilege: fixed search_path, no dynamic SQL, both inputs validated against closed
-- vocabularies, EXECUTE granted explicitly and only to anon/authenticated/service_role.

create or replace function public.app_zip_projects_markers(
  p_zip           text,
  p_kind          text    default 'development',
  p_authoritative boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'geo', 'pg_temp'
as $function$
declare
  v_projects jsonb;
  v_markers  jsonb;
  v_status   text;
begin
  -- Closed vocabularies. Anything else is refused rather than coerced.
  if p_zip is null or p_zip !~ '^[0-9]{5}$' then
    raise exception 'invalid zip' using errcode = '22023';
  end if;
  if p_kind is null or p_kind not in ('development', 'facility') then
    raise exception 'invalid kind' using errcode = '22023';
  end if;

  if not p_authoritative then
    -- LEGACY MODE — the grain, filter and ordering of public.app_projects_for_zip, unchanged.
    -- One project per ROW (source_seq included) and exactly one marker per row, which is what
    -- the map renders today. Collapsing to one project per source_key here would change
    -- resident behaviour while the cutover is OFF, so it deliberately does not.
    select coalesce(jsonb_agg(
             s.j || jsonb_build_object('project_ref', s.ref)
             order by s.k_date desc nulls last, s.k_name asc nulls last, s.k_id), '[]'::jsonb)
      into v_projects
      from (select to_jsonb(p) as j,
                   coalesce(p.source_key, '') || '#' || coalesce(p.source_seq, 0)::text as ref,
                   case when p_kind = 'facility' then null else p.submitted_at end as k_date,
                   case when p_kind = 'facility' then p.name else null end as k_name,
                   p.id as k_id
              from public.app_projects p
             where p.zip = p_zip and p.record_kind = p_kind) s;

    select coalesce(jsonb_agg(jsonb_build_object(
             'project_ref', coalesce(p.source_key, '') || '#' || coalesce(p.source_seq, 0)::text,
             'marker_seq', 1, 'lat', p.lat, 'lng', p.lng,
             'marker_rule', 'LEGACY_ROW_POINT') order by p.id), '[]'::jsonb)
      into v_markers
      from public.app_projects p
     where p.zip = p_zip and p.record_kind = p_kind
       and p.lat is not null and p.lng is not null;

    return jsonb_build_object('mode', 'legacy', 'zip', p_zip, 'status', 'legacy',
                              'projects', v_projects, 'markers', v_markers);
  end if;

  -- AUTHORITATIVE MODE (shadow only).
  select s.status into v_status
    from geo.maps_zip_geography_status s where s.zip = p_zip;

  -- The absence of authoritative geography must NEVER read as an authoritative zero.
  if v_status is distinct from 'boundary_complete' then
    return jsonb_build_object('mode', 'authoritative', 'zip', p_zip,
                              'status', coalesce(v_status, 'unknown'),
                              'projects', null, 'markers', null);
  end if;

  -- One project per (ZIP, source_key) membership. Descriptive row chosen by A3's rule:
  -- lowest stable id. last_seen_at is not a selector; source_seq is not geographic identity.
  --
  -- THE FIELD SET IS A CONTRACT, NOT A CONVENIENCE (2026-09-06). It carries exactly the
  -- app_projects columns the ZIP-mode path reads, and `type_raw` is in it because
  -- HS.residentialActivity reads it inside the Rule 5 gate - one call deeper than the site
  -- builder, which is how an earlier narrowing dropped it and shipped Rule 5 with half its
  -- evidence. test/zip-auth-rpc-field-contract.test.mjs fails if a field read anywhere in the
  -- path is absent here, and also fails if zip/lat/lng/stage are re-added: the page positions
  -- a site from the MARKER's coordinates and never reads project.stage, so those four were
  -- pure payload repeated once per project.
  --
  -- ONE SCAN. An earlier form split this into a narrow `distinct on` plus a pk join, which
  -- made the planner walk app_projects_source_key_kind_idx twice - measured on 20148 (13,934
  -- memberships) at 4,453 ms warm against 385 ms for this single pass, against anon's 3 s
  -- statement_timeout. The narrow projection is what keeps one pass safe on the
  -- high-multiplier ZIPs too (30033: 40,404 candidate rows for 2,261 memberships).
  --
  -- NO LIMIT, NO SLICE, NO SAMPLE: every membership row that has a development row is emitted.
  with m as (
    select mm.source_key
      from geo.zip_authoritative_membership mm
     where mm.zcta5 = p_zip),
  a as (
    select distinct on (p.source_key)
           p.source_key, p.id, p.name, p.type, p.type_raw, p.status,
           p.submitted_at, p.date_kind, p.source_ref, p.registry_id,
           p.impact_score, p.impact_dimensions
      from public.app_projects p
      join m on m.source_key = p.source_key
     where p.record_kind = p_kind
     order by p.source_key, p.id asc)
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'project_ref', a.source_key,
             'name', a.name, 'type', a.type, 'type_raw', a.type_raw,
             'status', a.status, 'submitted_at', a.submitted_at,
             'date_kind', a.date_kind, 'source_ref', a.source_ref,
             'registry_id', a.registry_id,
             'impact_score', a.impact_score, 'impact_dimensions', a.impact_dimensions)
           order by a.submitted_at desc nulls last, a.id), '[]'::jsonb)
    into v_projects
    from a;

  select coalesce(jsonb_agg(jsonb_build_object(
           'project_ref', k.source_key, 'marker_seq', k.marker_seq,
           'lat', k.lat, 'lng', k.lng, 'marker_rule', k.marker_rule)
           order by k.source_key, k.marker_seq), '[]'::jsonb)
    into v_markers
    from geo.zip_authoritative_marker k
   where k.zcta5 = p_zip;

  return jsonb_build_object('mode', 'authoritative', 'zip', p_zip,
                            'status', v_status, 'projects', v_projects, 'markers', v_markers);
end
$function$;

revoke all on function public.app_zip_projects_markers(text, text, boolean) from public;
grant execute on function public.app_zip_projects_markers(text, text, boolean)
  to anon, authenticated, service_role;

-- ROLLBACK (independent of the index; dropping either does not affect data correctness):
--   drop function if exists public.app_zip_projects_markers(text, text, boolean);
