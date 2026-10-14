-- SCRATCH, READ-ONLY, NEVER MERGE (claude/wsb-adhoc). One SELECT; every number is paired with its control in the same result.
select jsonb_build_object(
  'now', now(),
  'pg_version', current_setting('server_version'),
  'fn', (select jsonb_object_agg(proname || '(' || pg_get_function_identity_arguments(oid) || ')',
           jsonb_build_object('md5', md5(prosrc), 'len', length(prosrc)))
         from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('dev_refresh_collect','dev_change_observe_zip','dev_change_tick','app_source_key_basis','app_source_key',
                          'zip_scope_bounds','zip_scope_members','dev_change_recovery_rule_version','dev_source_receipts',
                          'dev_continuity_step','dev_reports_generation_receipt','dev_change_scope_ready','dev_change_scope_health',
                          'dev_monitoring_coverage','dev_change_recovery_probe','dev_change_materialization_current')),
  'fn_control_total_public_functions', (select count(*) from pg_proc where pronamespace = 'public'::regnamespace),
  'basis_body', (select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = 'app_source_key_basis'),
  'rel', (select jsonb_object_agg(r, to_regclass('public.' || r) is not null)
          from unnest(array['dev_source_continuity','dev_refresh_generation','dev_source_continuity_state','dev_change_recovery',
                            'dev_change_event','dev_change_event_reportable','dev_change_run']) r),
  'trigger_receipt', (select count(*) from pg_trigger where tgname = 'dev_reports_generation_receipt_trg' and not tgisinternal),
  'event_has_rule_version_col', (select count(*) from information_schema.columns where table_schema='public' and table_name='dev_change_event' and column_name='rule_version'),
  'event_columns', (select count(*) from information_schema.columns where table_schema='public' and table_name='dev_change_event'),
  'view_md5', md5(pg_get_viewdef('public.dev_change_event_reportable'::regclass)),
  'view_def', pg_get_viewdef('public.dev_change_event_reportable'::regclass),
  'view_has_is_baseline', position('is_baseline' in pg_get_viewdef('public.dev_change_event_reportable'::regclass)) > 0,
  'anon_exec', (select jsonb_object_agg(p.proname, has_function_privilege('anon', p.oid, 'execute'))
                from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in ('zip_scope_bounds','zip_scope_members')),
  'cron', (select jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active))
           from cron.job where jobname in ('property-watch-run','dev-change-observe','dev-reports-rolling-refresh')),
  'ledger', (select jsonb_agg(name order by version) from supabase_migrations.schema_migrations
             where name ~* '(continuity|recovery|plan_stable|zip_scope|dev_refresh_collect|dev_source|dev_change)'),
  'ledger_control_total', (select count(*) from supabase_migrations.schema_migrations),
  'denton_app_projects', (select jsonb_build_object('rows', count(*), 'keys', count(distinct source_key), 'max_submitted_at', max(submitted_at),
                            'within_365d', count(*) filter (where submitted_at >= now() - interval '365 days'))
                          from public.app_projects where source_key like 'arcgis:denton-county-dev-permits:%' and record_kind = 'development'),
  'denton_alias_keys_present', (select count(*) from public.app_projects where source_key like 'arcgis:denton-county-dev-permits:%#%' and record_kind = 'development'),
  'app_projects_control_total_estimate', (select reltuples::bigint from pg_class where oid = 'public.app_projects'::regclass),
  'dev_change_event_estimate', (select reltuples::bigint from pg_class where oid = 'public.dev_change_event'::regclass)
) as result;
