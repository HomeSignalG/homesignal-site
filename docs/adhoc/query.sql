-- SCRATCH, read-only. Never merge. Gate 0 probe A
select json_build_object(
 'ledger_evidence', (select json_agg(json_build_object('v',version,'name',name,'has_stmts',statements is not null) order by version) from supabase_migrations.schema_migrations where name ilike 'evidence%' or name ilike 'ev\_%'),
 'ledger_evidence_n', (select count(*) from supabase_migrations.schema_migrations where name ilike 'evidence%'),
 'ledger_total', (select count(*) from supabase_migrations.schema_migrations),
 'ev_tables', (select json_agg(json_build_object('t',c.relname,'kind',c.relkind,'n_live',s.n_live_tup,'ins',s.n_tup_ins,'upd',s.n_tup_upd,'del',s.n_tup_del,'last_autoanalyze',s.last_autoanalyze) order by c.relname) from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_stat_user_tables s on s.relid=c.oid where n.nspname='evidence' and c.relkind in ('r','v','m')),
 'ev_functions', (select json_agg(json_build_object('f',n.nspname||'.'||p.proname,'secdef',p.prosecdef,'calls',f.calls) order by p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace left join pg_stat_user_functions f on f.funcid=p.oid where n.nspname='evidence' or (n.nspname='public' and p.proname like 'ev\_%')),
 'track_functions', current_setting('track_functions'),
 'stats_reset', (select stats_reset from pg_stat_database where datname=current_database()),
 'grants_anon_auth', (select json_agg(distinct table_name||':'||grantee||':'||privilege_type) from information_schema.role_table_grants where table_schema='evidence' and grantee in ('anon','authenticated')),
 'fn_exec_anon', (select json_agg(p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='evidence' or (n.nspname='public' and p.proname like 'ev\_%')) and has_function_privilege('anon', p.oid, 'execute')),
 'schema_usage_anon', has_schema_privilege('anon','evidence','usage'),
 'cron_refs', (select json_agg(json_build_object('job',jobname,'active',active,'cmd',left(command,120))) from cron.job where command ilike '%evidence.%' or command ilike '%ev\_%'),
 'max_ts', json_build_object(
    'ev_source_check', (select max(checked_at) from evidence.ev_source_check),
    'ev_claim', (select max(observed_at) from evidence.ev_claim),
    'ev_source_record', (select max(retrieved_at) from evidence.ev_source_record)),
 'counts', json_build_object('ev_claim',(select count(*) from evidence.ev_claim),'ev_entity',(select count(*) from evidence.ev_entity),'ev_source',(select count(*) from evidence.ev_source),'ev_source_check',(select count(*) from evidence.ev_source_check),'ev_source_coverage',(select count(*) from evidence.ev_source_coverage),'ev_predicate',(select count(*) from evidence.ev_predicate))
);
