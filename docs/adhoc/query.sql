-- SCRATCH, read-only. Never merge. Gate 0 probe B
select json_build_object(
 'fn_exec_anon', (select json_agg(n.nspname||'.'||p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='evidence' or (n.nspname='public' and p.proname like 'ev\_%')) and has_function_privilege('anon', p.oid, 'execute')),
 'schema_usage_anon', has_schema_privilege('anon','evidence','usage'),
 'schema_usage_auth', has_schema_privilege('authenticated','evidence','usage'),
 'external_callers', (select json_agg(n.nspname||'.'||p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not in ('evidence','pg_catalog','information_schema') and p.proname not like 'ev\_%' and (p.prosrc ilike '%evidence.%' or p.prosrc ~* '\mev_(zip_is_routable|evidence_available|property_card|parcel_report|facility_card|track_record|current_owner|recorded_instruments)\M')),
 'views_ref_evidence', (select json_agg(distinct v.table_schema||'.'||v.table_name) from information_schema.view_table_usage v where v.table_schema<>'evidence' and v.view_schema is not null and v.table_schema='evidence'),
 'dependent_views', (select json_agg(distinct dv.relnamespace::regnamespace||'.'||dv.relname) from pg_depend d join pg_rewrite r on r.oid=d.objid join pg_class dv on dv.oid=r.ev_class join pg_class t on t.oid=d.refobjid join pg_namespace tn on tn.oid=t.relnamespace where tn.nspname='evidence' and dv.relnamespace::regnamespace::text<>'evidence'),
 'cron_refs', (select json_agg(json_build_object('job',jobname,'active',active,'cmd',left(command,140))) from cron.job where command ilike '%evidence%' or command ilike '%ev\_%'),
 'counts', json_build_object('ev_claim',(select count(*) from evidence.ev_claim),'ev_entity',(select count(*) from evidence.ev_entity),'ev_source',(select count(*) from evidence.ev_source),'ev_source_check',(select count(*) from evidence.ev_source_check),'ev_source_coverage',(select count(*) from evidence.ev_source_coverage),'ev_predicate',(select count(*) from evidence.ev_predicate),'ev_source_record',(select count(*) from evidence.ev_source_record),'ev_expected_regulatory_check',(select count(*) from evidence.ev_expected_regulatory_check),'ev_pilot_parcel',(select count(*) from evidence.ev_pilot_parcel)),
 'check_cols', (select json_agg(column_name||':'||data_type order by ordinal_position) from information_schema.columns where table_schema='evidence' and table_name='ev_source_check'),
 'check_newest', (select max(checked_at) from evidence.ev_source_check),
 'check_oldest', (select min(checked_at) from evidence.ev_source_check),
 'ev_source_rows', (select json_agg(row_to_json(s)) from (select * from evidence.ev_source limit 30) s),
 'expected_reg_check_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='evidence' and table_name='ev_expected_regulatory_check'),
 'zip_routable_def_head', (select left(pg_get_functiondef(p.oid),900) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='ev_zip_is_routable' limit 1)
);
