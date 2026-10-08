-- MUTATION (must be KILLED): the facility read serves every cached facility point, stamping
-- each a member without asking the canonical predicate — the radius-derived plane restored.
create or replace function public.zip_mode_report_sites(p_zip text)
returns jsonb language sql stable security definer set search_path to 'public', 'geo', 'pg_temp'
as $function$
  select jsonb_build_object('zip', p_zip, 'status', 'complete',
    'sites', coalesce(jsonb_agg(case when e->>'scope' = 'point' then e || '{"zip_membership":"member"}'::jsonb else e end)
                      filter (where not (e->>'scope' = 'point' and coalesce(e->>'relevance','') = 'development')), '[]'::jsonb),
    'facility_counts', jsonb_build_object('member', count(*) filter (where e->>'scope' = 'point' and coalesce(e->>'relevance','') <> 'development'),
                                          'outside', 0, 'not_measured', 0, 'no_coordinates', 0))
    from public.development_reports d, jsonb_array_elements(d.sites) e where d.zip = p_zip;
$function$;
