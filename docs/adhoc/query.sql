with dz as (
  select distinct zip from public.app_projects where registry_id like 'denton-city-projects-%' or registry_id = 'denton-county-dev-permits'
)
select jsonb_build_object(
 'app_projects_by_reg', (select coalesce(jsonb_agg(x), '[]') from (select registry_id, count(*) n, count(distinct zip) zips, min(created_at) min_created, max(created_at) max_created, count(*) filter (where provenance::text like '%polygon_member%') polygon_stamped from public.app_projects where registry_id like 'denton-city-projects-%' group by 1 order by 1) x),
 'denton_zips_n', (select count(*) from dz),
 'cron', (select coalesce(jsonb_agg(jsonb_build_object('jobid',jobid,'name',jobname,'schedule',schedule,'active',active)), '[]') from cron.job where jobname ilike '%dev-change%' or jobname ilike '%property-watch%' or jobname ilike '%watch%'),
 'observe_runs', (select coalesce(jsonb_agg(x), '[]') from (select id, baseline, started_at, finished_at, zips_observed from public.dev_change_run order by started_at desc limit 8) x),
 'events_by_source_24h_and_all', (select coalesce(jsonb_agg(x), '[]') from (select e.source_id, e.event_type, e.is_baseline, e.material, count(*) n, max(e.created_at) newest from public.dev_change_event e where e.source_id like 'denton-%' group by 1,2,3,4 order by 1,2) x),
 'events_total_recent', (select jsonb_build_object('max_created', max(created_at), 'last_24h', count(*) filter (where created_at > now()-interval '24 hours'), 'last_24h_first_detected_material', count(*) filter (where created_at > now()-interval '24 hours' and event_type='first_detected' and material)) from public.dev_change_event),
 'ledger_denton', (select coalesce(jsonb_agg(x), '[]') from (select registry_id, count(*) n, count(*) filter (where change_ready) change_ready, max(observation_count) maxobs from public.dev_change_project where registry_id like 'denton-%' group by 1 order by 1) x),
 'recovery_denton', (select coalesce(jsonb_agg(x), '[]') from (select r.outcome, count(*) n from public.dev_change_recovery r join public.dev_change_project p on p.identity_key=r.identity_key where p.registry_id like 'denton-city-projects-%' group by 1) x),
 'scope_ready_denton', (select count(*) from public.dev_change_scope_ready where registry_id like 'denton-city-projects-%'),
 'continuity_denton', (select coalesce(jsonb_agg(x), '[]') from (select registry_id, count(*) n from public.dev_source_continuity where registry_id like 'denton-city-projects-%' group by 1) x),
 'observe_fn_has_recovery', (select position('dev_change_recovery' in prosrc) > 0 from pg_proc where proname='dev_change_observe_zip' and pronamespace='public'::regnamespace limit 1),
 'recovery_rule_version', public.dev_change_recovery_rule_version(),
 'watches_total', (select count(*) from public.property_watch),
 'watch_users', (select count(distinct user_id) from public.property_watch),
 'watches_in_denton_zips', (select count(*) from public.property_watch w join public.report_snapshot r on r.report_id=w.report_id where to_jsonb(r)->>'zip' in (select zip from dz)),
 'watch_users_in_denton_zips', (select count(distinct w.user_id) from public.property_watch w join public.report_snapshot r on r.report_id=w.report_id where to_jsonb(r)->>'zip' in (select zip from dz)),
 'watch_last_runs', (select jsonb_build_object('max_last_run', max(last_run_at), 'min_next_due', min(next_due_at)) from public.property_watch),
 'watch_seen_total', (select count(*) from public.property_watch_seen)
) as result;
