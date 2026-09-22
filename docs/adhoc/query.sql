-- SCRATCH, read-only. Never merge.
select json_build_object(
 'counts', json_build_object(
   'app_environmental_risk',(select count(*) from public.app_environmental_risk),
   'echo_violation_counts',(select count(*) from public.echo_violation_counts),
   'gov_actions',(select count(*) from public.gov_actions),
   'gov_subjects',(select count(*) from public.gov_subjects),
   'gov_action_relations',(select count(*) from public.gov_action_relations),
   'source_registry',(select count(*) from public.source_registry),
   'ev_source_check',(select count(*) from evidence.ev_source_check),
   'ev_source_coverage',(select count(*) from evidence.ev_source_coverage),
   'app_zip_geography_cutover',(select count(*) from public.app_zip_geography_cutover)),
 'columns', (select json_object_agg(t, cols) from (
    select table_schema||'.'||table_name t, json_agg(column_name||':'||data_type order by ordinal_position) cols
    from information_schema.columns
    where (table_schema,table_name) in (('public','app_environmental_risk'),('public','echo_violation_counts'),('public','gov_actions'),('public','gov_subjects'),('public','source_registry'),('evidence','ev_source_check'),('evidence','ev_source_coverage'),('public','app_changes'),('public','app_coverage_states'),('public','app_zip_geography_state'),('public','app_zip_geography_cutover'),('public','app_projects'),('public','development_reports'),('evidence','ev_facility'))
    group by 1) s),
 'app_coverage_states_def', pg_get_viewdef('public.app_coverage_states'::regclass),
 'app_zip_geography_state_def', pg_get_viewdef('public.app_zip_geography_state'::regclass),
 'geo_tables', (select json_agg(json_build_object('t',c.relname,'kind',c.relkind,'est',c.reltuples::bigint)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='geo' and c.relkind in ('r','v','m')),
 'app_changes_categories', (select json_agg(json_build_object('cat',category,'n',n)) from (select category, count(*) n from public.app_changes group by 1 order by 2 desc) x)
);
