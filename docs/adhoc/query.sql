-- READ-ONLY adhoc probe #3 (Environment & Utilities audit). Never merge.
select json_build_object(
 'gov_actions', (select json_build_object('rows',count(*),'sources',json_agg(distinct source_id)) from public.gov_actions),
 'gov_subjects_by_kind', (select json_agg(t) from (select subject_kind, count(*) n from public.gov_subjects group by 1) t),
 'echo_violation_counts_rows', (select count(*) from public.echo_violation_counts),
 'echo_violation_counts_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='echo_violation_counts'),
 'company_track_events_rows', (select count(*) from public.company_track_events),
 'company_track_events_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='company_track_events'),
 'coverage_states_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='app_coverage_states'),
 'coverage_core', (select json_agg(t) from (select coverage_state s, count(*) n from public.app_coverage_states group by 1) t),
 'coverage_overlay', (select json_agg(t) from (select regulatory_overlay_state s, count(*) n from public.app_coverage_states group by 1) t),
 'facility_env_keys', (select json_agg(t) from (select k, count(*) n from public.app_projects, jsonb_object_keys(facility_env) k where record_kind='facility' and jsonb_typeof(facility_env)='object' group by 1 order by 2 desc limit 15) t),
 'facility_with_violation_signal', (select count(*) from public.app_projects where record_kind='facility' and facility_env ? 'epa' and (facility_env->'epa') ?| array['violations','qtrs_in_nc','formal_actions','penalties']),
 'utah_env', (select json_build_object('ut_zips_with_facility', count(distinct p.zip)) from public.app_projects p where p.record_kind='facility' and p.zip in (select z from public.communities c, unnest(c.zip_codes) z where c.level='zip' and c.state='UT'))
) as r;
