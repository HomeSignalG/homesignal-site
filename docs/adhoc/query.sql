-- SCRATCH, read-only. Never merge. probe 4
select json_build_object(
 'probe3_still_active', (select json_agg(json_build_object('pid',pid,'started',query_start,'state',state)) from pg_stat_activity where pid<>pg_backend_pid() and query like '-- SCRATCH, read-only. Never merge.%'),
 'ev_status_enum', (select json_agg(e.enumlabel order by e.enumsortorder) from pg_type t join pg_enum e on e.enumtypid=t.oid join pg_attribute a on a.atttypid=t.oid where a.attrelid='evidence.ev_source_check'::regclass and a.attname='status'),
 'ev_check_sample', (select json_agg(json_build_object('src',source_id,'subj',subject_key,'st',status::text,'n',found_n,'basis',left(query_basis,80),'at',checked_at)) from (select * from evidence.ev_source_check order by checked_at desc limit 8) s),
 'dc_cols', (select json_object_agg(table_name, cols) from (select table_name, json_agg(column_name||':'||data_type order by ordinal_position) cols from information_schema.columns where table_schema='public' and table_name in ('dc_source','dc_acquisition_run','dc_source_observation','dc_canonical_entity','dc_entity_observation') group by 1) s),
 'dc_source', (select json_agg(row_to_json(d)) from public.dc_source d),
 'dc_run', (select json_agg(row_to_json(r)) from public.dc_acquisition_run r),
 'ev_tables', (select json_agg(json_build_object('t',c.relname,'est',c.reltuples::bigint)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='evidence' and c.relkind in ('r','v')),
 'maps_geo_status', (select json_agg(json_build_object('s',status,'n',n)) from (select status,count(*) n from geo.maps_zip_geography_status group by 1) x)
);
