select jsonb_build_object(
 'cron', (select coalesce(jsonb_agg(jsonb_build_object('jobid',jobid,'name',jobname,'schedule',schedule,'active',active)), '[]') from cron.job where jobname ilike '%dev-change%' or jobname ilike '%watch%'),
 'observe_runs', (select coalesce(jsonb_agg(x), '[]') from (select id, baseline, started_at, finished_at, zips_observed from public.dev_change_run order by started_at desc limit 8) x),
 'observe_fn_has_recovery', (select position('dev_change_recovery' in prosrc) > 0 from pg_proc where proname='dev_change_observe_zip' and pronamespace='public'::regnamespace limit 1),
 'recovery_rule_version', public.dev_change_recovery_rule_version(),
 'watches_total', (select count(*) from public.property_watch),
 'watch_users', (select count(distinct user_id) from public.property_watch),
 'watch_last_runs', (select jsonb_build_object('max_last_run', max(last_run_at), 'min_next_due', min(next_due_at)) from public.property_watch),
 'watch_seen_total', (select count(*) from public.property_watch_seen),
 'watch_zip_dist', (select coalesce(jsonb_agg(x), '[]') from (select left(to_jsonb(r)->>'zip',3) z3, count(*) n, count(distinct w.user_id) users from public.property_watch w join public.report_snapshot r on r.report_id=w.report_id group by 1 order by 2 desc limit 15) x)
) as result;
