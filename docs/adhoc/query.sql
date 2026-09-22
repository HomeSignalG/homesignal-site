-- SCRATCH, read-only. Never merge.
select json_build_object(
 'geo_state', (select json_agg(json_build_object('s',geography_state,'n',n)) from (select geography_state, count(*) n from public.app_zip_geography_state group by 1) x),
 'coverage_state', (select json_agg(json_build_object('s',coverage_state,'o',regulatory_overlay_state,'n',n)) from (select coverage_state, regulatory_overlay_state, count(*) n from public.app_coverage_states group by 1,2) x),
 'stats', (select json_agg(json_build_object('t',tablename,'c',attname,'nd',n_distinct,'mcv',most_common_vals::text,'mcf',most_common_freqs::text)) from pg_stats where schemaname='public' and ((tablename='app_projects' and attname in ('record_kind','type','lens','date_kind','status','source_key_basis')) or (tablename='app_changes' and attname in ('lens','confidence','category')))),
 'source_registry', (select json_agg(json_build_object('id',source_id,'agency',agency_code,'prog',program_code,'kinds',subject_kinds,'rt',record_types,'status',connection_status)) from public.source_registry),
 'ev_source_check', (select json_agg(json_build_object('src',source_id,'status',status,'n',n)) from (select source_id,status::text,count(*) n from evidence.ev_source_check group by 1,2) x),
 'ev_source_coverage', (select json_agg(row_to_json(c)) from evidence.ev_source_coverage c),
 'echo_violation_counts', (select json_agg(row_to_json(e)) from public.echo_violation_counts e),
 'membership_cols', (select json_object_agg(table_name, cols) from (select table_name, json_agg(column_name||':'||data_type order by ordinal_position) cols from information_schema.columns where table_schema='geo' and table_name in ('zip_authoritative_membership','zip_authoritative_marker','maps_zip_geography_status','zcta_boundary','project_zip_association') group by 1) s),
 'fac_env_sample', (select json_agg(json_build_object('type',type,'type_raw',type_raw,'fe',facility_env,'src',source_ref,'prov',provenance)) from (select * from public.app_projects where zip='84302' and record_kind='facility' limit 3) f),
 'dev_type_sample_84302', (select json_agg(json_build_object('type',type,'type_raw',type_raw,'kind',record_kind,'name',left(name,80))) from (select * from public.app_projects where zip='84302' and record_kind='development' limit 8) d)
);
