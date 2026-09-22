select json_build_object(
 'migs', (select json_agg(version||' '||name order by version) from supabase_migrations.schema_migrations where version >= '20260922164000'),
 'ledger_cols', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='dc_resident_lineage_ledger'),
 'ledger_def_md5', (select md5(pg_get_viewdef('public.dc_resident_lineage_ledger'::regclass))),
 'opts', (select array_to_string(reloptions,',') from pg_class where oid='public.dc_resident_lineage_ledger'::regclass),
 'grants', (select count(*) from information_schema.role_table_grants where table_schema='public' and table_name='dc_resident_lineage_ledger' and grantee in ('anon','authenticated')),
 'active', (select json_agg(left(query,80)||' | '||state||' | '||(now()-query_start)::text) from pg_stat_activity where query ilike '%dc_resident_lineage_ledger%' and pid <> pg_backend_pid())
) facts;
