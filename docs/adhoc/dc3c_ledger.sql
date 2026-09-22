select json_build_object(
 'cols', (select json_agg(column_name||':'||data_type order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='dc_resident_lineage_ledger'),
 'relkind', (select c.relkind::text from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='dc_resident_lineage_ledger'),
 'rows', (select count(*) from public.dc_resident_lineage_ledger),
 'comment', (select obj_description('public.dc_resident_lineage_ledger'::regclass)),
 'grants', (select json_agg(grantee||':'||privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name='dc_resident_lineage_ledger'),
 'rls', (select relrowsecurity from pg_class where oid='public.dc_resident_lineage_ledger'::regclass),
 'triggers', (select json_agg(tgname) from pg_trigger where tgrelid='public.dc_resident_lineage_ledger'::regclass and not tgisinternal),
 'migrations', (select json_agg(version||' '||name order by version) from supabase_migrations.schema_migrations where name ilike '%lineage%' or name ilike '%step3%' or name ilike '%dc_%' or version >= '20260922000000'),
 'writers', (select json_agg(p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosrc ilike '%dc_resident_lineage_ledger%'),
 'views', (select json_agg(c.relname) from pg_depend d join pg_rewrite rw on rw.oid=d.objid join pg_class c on c.oid=rw.ev_class where d.refobjid='public.dc_resident_lineage_ledger'::regclass and c.relname<>'dc_resident_lineage_ledger')
) facts;
