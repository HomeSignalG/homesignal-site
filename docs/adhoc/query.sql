-- READ-ONLY adhoc probe (Environment & Utilities data-plane audit). Never merge.
select json_build_object(
 'control_app_changes_total', (select count(*) from public.app_changes),
 'control_app_changes_zips', (select count(distinct zip) from public.app_changes),
 'control_app_changes_newest', (select max(created_at) from public.app_changes),
 'app_changes_by_category', (select json_agg(t order by n desc) from (select coalesce(category,'<NULL>') cat, count(*) n, count(distinct zip) zips from public.app_changes group by 1) t),
 'env_regex_rows', (select count(*) from public.app_changes where category ~* '(environment|utilit|water)'),
 'env_regex_zips', (select count(distinct zip) from public.app_changes where category ~* '(environment|utilit|water)'),
 'app_changes_columns', (select json_agg(column_name||':'||data_type order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='app_changes'),
 'meetings_by_category', (select json_agg(t order by n desc) from (select coalesce(category,'<NULL>') cat, count(*) n from public.meetings group by 1) t),
 'alerts_by_pipeline_category', (select json_agg(t order by n desc) from (select pipeline_type, coalesce(category,'<NULL>') cat, count(*) n from public.alerts group by 1,2) t),
 'alerts_columns', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='alerts'),
 'refresh_fn_category_literals', (select json_agg(distinct m[1]) from (select regexp_matches(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure), '''([A-Z][A-Za-z &]+)''\s+as\s+category|category\s*=\s*''([^'']+)''', 'gi') m) x),
 'refresh_fn_len', (select length(pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure))),
 'refresh_fn_mentions_environment', (select pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure) ~* 'environment|utilit'),
 'canonical_zip_count', (select count(*) from public.canonical_zip_registry)
) as r;
