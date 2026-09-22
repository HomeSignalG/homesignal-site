-- READ-ONLY adhoc probe #3a (Environment & Utilities audit; probe 3 split after client timeout). Never merge.
select json_build_object(
 'gov_actions', (select json_build_object('rows',count(*),'sources',json_agg(distinct source_id)) from public.gov_actions),
 'gov_subjects_by_kind', (select json_agg(t) from (select subject_kind, count(*) n from public.gov_subjects group by 1) t),
 'source_registry_rows', (select count(*) from public.source_registry),
 'echo_violation_counts_rows', (select count(*) from public.echo_violation_counts),
 'echo_violation_counts_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='echo_violation_counts'),
 'company_track_events_rows', (select count(*) from public.company_track_events),
 'company_track_events_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='company_track_events'),
 'project_facility_refs_rows', (select count(*) from public.project_facility_refs),
 'coverage_states_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='app_coverage_states'),
 'facility_env_keys_sample_2pct', (select json_agg(t) from (select k, count(*) n from public.app_projects tablesample system (2), jsonb_object_keys(facility_env) k where record_kind='facility' and jsonb_typeof(facility_env)='object' group by 1 order by 2 desc limit 15) t)
) as r;
