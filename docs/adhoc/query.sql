-- SCRATCH, read-only catalog probe. Never merge.
select json_build_object(
 'tables', (select json_agg(json_build_object('t', n.nspname||'.'||c.relname, 'kind', c.relkind, 'est_rows', c.reltuples::bigint) order by c.relname)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','gov_archive','evidence') and c.relkind in ('r','v','m','p')
      and (c.relname ~* '(env|epa|echo|frs|facilit|risk|gov_action|gov_subject|source_check|coverage|outcome|evidence|water|flood|utility|sdwis|npdes|project|app_changes|zip_geo|zcta|boundar|development_report|source_reg|dc_)')),
 'functions', (select json_agg(n.nspname||'.'||p.proname order by p.proname)
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','gov_archive','evidence')
      and p.proname ~* '(env|epa|echo|facilit|risk|coverage|outcome|source_check|evidence|refresh_zip|zip_geo|gov_action)'),
 'schemas', (select json_agg(nspname order by nspname) from pg_namespace where nspname !~ '^(pg_|information_schema)')
);
