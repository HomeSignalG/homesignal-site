-- Tab 2 · STANDING ZIP/FEED MONITOR (2026-11-20). SQL of record. ADDITIVE: three tables, two functions, one pg_cron job. Writes only its own tables.
--
-- WHY: the roll-up (docs/zip-feed-health-rollup.sql) answers only "what is true when someone opens the tab". This makes Tab 2 a standing monitor:
-- every hour pg_cron records one run and one set of FINDINGS (what failed, which ZIPs/sources, the evidence, the threshold, the action, the owner),
-- tracks each finding from first seen to RECOVERED, and the page shows whether the monitor itself is running.
--
-- NOT DUPLICATED (owned by other sessions, only READ here): pipeline_health_check (hourly monitor), dev_source_freshness (hourly, per source),
-- dev_change_scope_health / dev_monitoring_coverage (per ZIP+source change-monitoring state), dev_refresh_source_failures.
-- NOT INVENTED: no expected source schedule is made up. Coverage that no monitor can verify is recorded as a finding (class COVERAGE_NOT_VERIFIED).
-- Thresholds below are stated in each finding's `threshold` text.
-- (applied as ONE transaction by apply_migration)

create table if not exists public.zip_feed_health_runs (
  id bigserial primary key, run_at timestamptz not null default now(), ok boolean not null, error text,
  finding_count int not null default 0, ongoing_count int not null default 0, recovered_count int not null default 0);
create table if not exists public.zip_feed_health_findings (
  finding_key text primary key, class text not null, subject text not null, severity text not null,
  first_seen timestamptz not null, last_seen timestamptz not null, resolved_at timestamptz,
  detail jsonb not null default '{}'::jsonb);
create table if not exists public.zip_feed_health_cron (
  job text primary key, schedule text, max_age_minutes int not null, owner text not null);
alter table public.zip_feed_health_runs enable row level security;
alter table public.zip_feed_health_findings enable row level security;
alter table public.zip_feed_health_cron enable row level security;
revoke all on public.zip_feed_health_runs, public.zip_feed_health_findings, public.zip_feed_health_cron from public, anon, authenticated;

-- The jobs this monitor expects to be running, with the longest tolerated gap (3x the schedule's interval; stated, not guessed).
insert into public.zip_feed_health_cron(job, schedule, max_age_minutes, owner) values
  ('dev-reports-rolling-refresh','*/2 * * * *',10,'ingestion / dev refresh'),
  ('dev-source-freshness','41 * * * *',180,'ingestion'),
  ('pipeline-health-monitor','10 * * * *',180,'ingestion'),
  ('n5-generation-dispatch','47 * * * *',180,'Map 1 / N5'),
  ('zip-dc-listing','*/10 * * * *',30,'site (data-center listings)'),
  ('bluesky-publish-dispatch','*/15 * * * *',45,'ingestion (publishing)'),
  ('zip-feed-health-record','55 * * * *',180,'site (this monitor)')
on conflict (job) do nothing;

create or replace function public._hs_zip_feed_health_findings()
returns table(finding_key text, class text, subject text, severity text, detail jsonb)
language plpgsql stable security definer set search_path = public, geo as $$
declare now_ts timestamptz := now(); sub_zips text[];
begin
  select coalesce(array_agg(distinct c.zip), '{}') into sub_zips from public.bsky_maps_priority_classification c where c.class='eligible' and c.zip ~ '^[0-9]{5}$';

  -- 1 · monitoring jobs not running (the monitor of the monitors)
  return query
  select 'MONITOR_JOB|'||z.job, 'MONITOR_JOB_NOT_RUNNING', z.job, 'bad',
    jsonb_build_object('what','Scheduled job has not succeeded recently','evidence', coalesce('last success '||to_char(l.last_ok,'YYYY-MM-DD HH24:MI "UTC"'),'no successful run recorded')||coalesce('; last status '||l.last_status,''),
      'checked_at', now_ts, 'threshold','no success within '||z.max_age_minutes||' minutes (schedule '||z.schedule||')','action','Check the pg_cron job and its last error','owner',z.owner,'zip_count',0,'zips','[]'::jsonb)
  from public.zip_feed_health_cron z left join lateral (
    select max(d.start_time) filter (where d.status='succeeded') last_ok, (array_agg(d.status order by d.start_time desc))[1] last_status
      from cron.job j join cron.job_run_details d on d.jobid=j.jobid where j.jobname=z.job) l on true
  where z.job <> 'zip-feed-health-record' and (l.last_ok is null or l.last_ok < now_ts - make_interval(mins => z.max_age_minutes));

  -- 2 · stale ZIP reports
  return query
  select 'STALE_ZIP_REPORT|all','STALE_ZIP_REPORT','all ZIP pages','bad',
    jsonb_build_object('what','ZIP page reports not refreshed','evidence', count(*)||' ZIP pages; oldest refreshed '||to_char(min(refreshed_at),'YYYY-MM-DD HH24:MI "UTC"'),
      'checked_at', now_ts,'threshold','older than 72 hours (the rolling sweep takes about 53 hours)','action','Look at those ZIPs in dev_refresh_source_failures; the refresh sweep is owned by ingestion','owner','ingestion / dev refresh',
      'zip_count', count(*), 'zips', (select coalesce(jsonb_agg(jsonb_build_object('zip',t.zip,'at',t.refreshed_at,'subscriber',t.zip=any(sub_zips)) order by t.refreshed_at),'[]'::jsonb) from (select zip, refreshed_at from public.development_reports where refreshed_at < now_ts - interval '72 hours' order by refreshed_at limit 50) t))
  from public.development_reports where refreshed_at < now_ts - interval '72 hours' having count(*) > 0;

  -- 3 · ZIP pages with no report at all
  return query
  select 'NO_REPORT|all','ZIP_PAGE_WITHOUT_REPORT','all ZIP pages','bad',
    jsonb_build_object('what','Canonical ZIP page with no development report','evidence', count(*)||' ZIP pages','checked_at', now_ts,'threshold','every canonical ZIP should hold a report','action','Investigate the refresh for these ZIPs','owner','ingestion / dev refresh',
      'zip_count', count(*), 'zips', (select coalesce(jsonb_agg(jsonb_build_object('zip',t.zip)),'[]'::jsonb) from (select r.zip from public.canonical_zip_registry r where not exists (select 1 from public.development_reports d where d.zip=r.zip) order by r.zip limit 50) t))
  from public.canonical_zip_registry r where not exists (select 1 from public.development_reports d where d.zip=r.zip) having count(*) > 0;

  -- 4 · source reads failing (kinds kept apart; retired/truncated are not failures)
  return query
  select 'SOURCE_READ|'||f.registry_id, 'SOURCE_READ_FAILURE', f.registry_id, 'bad',
    jsonb_build_object('what','Source read failed ('||string_agg(distinct f.kind, ', ')||')','evidence', count(*)||' events across '||count(distinct f.zip)||' ZIPs; latest '||to_char(max(f.seen_at),'YYYY-MM-DD HH24:MI "UTC"')||'; reason: '||left((array_agg(f.reason order by f.seen_at desc))[1],120),
      'checked_at', now_ts,'threshold','any failed read in the last 48 hours','action','Check the source endpoint and the ingest log for this registry id','owner','ingestion',
      'zip_count', count(distinct f.zip), 'zips', (select coalesce(jsonb_agg(jsonb_build_object('zip',x.zip,'subscriber',x.zip=any(sub_zips))),'[]'::jsonb) from (select distinct zip from public.dev_refresh_source_failures where registry_id=f.registry_id and kind in ('fetch_failed','fire_failed','fire_http_error') and seen_at > now_ts - interval '48 hours' order by zip limit 50) x))
  from public.dev_refresh_source_failures f where f.seen_at > now_ts - interval '48 hours' and f.kind in ('fetch_failed','fire_failed','fire_http_error') group by f.registry_id;

  -- 5 · sources that never read successfully / stale source freshness
  return query
  select 'SOURCE_NEVER_OK|'||s.registry_id,'SOURCE_NEVER_SUCCEEDED',s.registry_id,'bad',
    jsonb_build_object('what','Source has no successful read on record','evidence', s.ledger_records||' ledger records; newest record date '||coalesce(s.newest_record_date::text,'unknown'),'checked_at', s.computed_at,
      'threshold','dev_source_freshness.last_success_at is empty','action','Confirm whether the source is retired or broken; the registry is owned by ingestion','owner','ingestion','zip_count',0,'zips','[]'::jsonb)
  from public.dev_source_freshness s where s.last_success_at is null;
  return query
  select 'SOURCE_STALE|'||s.registry_id,'SOURCE_READ_STALE',s.registry_id,'warn',
    jsonb_build_object('what','Last successful read is old','evidence','last success '||to_char(s.last_success_at,'YYYY-MM-DD HH24:MI "UTC"'),'checked_at', s.computed_at,
      'threshold','no successful read in 72 hours (no per-source schedule is recorded, so this is a floor, not a schedule)','action','Check the source endpoint','owner','ingestion','zip_count',0,'zips','[]'::jsonb)
  from public.dev_source_freshness s where s.last_success_at < now_ts - interval '72 hours';

  -- 6 · EPA layer
  return query
  select 'EPA_LAYER|all','EPA_LAYER_UNAVAILABLE','all ZIP pages','warn',
    jsonb_build_object('what','EPA facility layer unavailable (count shown as unknown, not zero)','evidence', count(*) filter (where facilities_unavailable)||' ZIPs unavailable; '||count(*) filter (where facilities_refreshed_at < now_ts - interval '7 days')||' without a good read in 7 days',
      'checked_at', now_ts,'threshold','facilities_unavailable, or facility clock older than 7 days','action','EPA read health is owned by ingestion (FRS probe); no dashboard action','owner','ingestion',
      'zip_count', count(*) filter (where facilities_unavailable), 'zips', (select coalesce(jsonb_agg(jsonb_build_object('zip',t.zip,'at',t.facilities_refreshed_at,'subscriber',t.zip=any(sub_zips))),'[]'::jsonb) from (select zip, facilities_refreshed_at from public.development_reports where facilities_unavailable order by facilities_refreshed_at nulls first limit 50) t))
  from public.development_reports having count(*) filter (where facilities_unavailable) > 0;

  -- 7 · map placement: ZIPs with no serving-generation evidence for change monitoring
  return query
  select 'NO_GENERATION_EVIDENCE|all','ZIP_WITHOUT_CHANGE_EVIDENCE','all ZIP pages','warn',
    jsonb_build_object('what','Reports exist but the change monitor has no accepted generation for the ZIP','evidence', count(*)||' ZIPs','checked_at', now_ts,'threshold','every refreshed ZIP should appear in dev_source_continuity','action','Ingestion owns the change monitor','owner','ingestion',
      'zip_count', count(*), 'zips', (select coalesce(jsonb_agg(jsonb_build_object('zip',t.zip,'subscriber',t.zip=any(sub_zips))),'[]'::jsonb) from (select d2.zip from public.development_reports d2 where d2.refreshed_at is not null and not exists (select 1 from public.dev_source_continuity c where c.zip=d2.zip) order by d2.zip limit 50) t))
  from public.development_reports d where d.refreshed_at is not null and not exists (select 1 from public.dev_source_continuity c where c.zip=d.zip) having count(*) > 0;

  -- 8 · coverage not verified (the honest gap)
  return query
  select 'COVERAGE_NOT_VERIFIED|change-monitor','COVERAGE_NOT_VERIFIED','change monitoring','unverified',
    jsonb_build_object('what','Completeness of captured records is not verified','evidence', coalesce(sum(pairs) filter (where monitoring_state='legacy_scope'),0)||' ZIP+source pairs run on legacy scope; only '||coalesce(sum(pairs) filter (where monitoring_state='complete_verified'),0)||' pairs are verified complete. Fresh ingestion does not prove complete coverage.',
      'checked_at', now_ts,'threshold','monitoring_state = complete_verified','action','Dependency on ingestion: finish moving pairs off legacy scope, and add a recurring comparison with official source records. Until then Tab 2 cannot call any ZIP verified.','owner','ingestion',
      'zip_count',0,'zips','[]'::jsonb)
  from public.dev_monitoring_coverage;

  -- 9 · downstream publishing
  return query
  select 'PUBLISH_DRAFTS|maps','MAPS_DRAFTS_WAITING','Tab 12 MAPS drafts','warn',
    jsonb_build_object('what','MAPS drafts waiting for approval','evidence', count(*)||' drafts older than 3 days','checked_at', now_ts,'threshold','draft older than 3 days','action','Review in Tab 12 (nothing is sent without your approval)','owner','you (approval)','zip_count',0,'zips','[]'::jsonb)
  from public.social_posts where content_family='MAPS' and status='draft' and created_at < now_ts - interval '3 days' having count(*) > 0;
  return query
  select 'PUBLISH_APPROVED|maps','MAPS_APPROVED_NOT_PUBLISHED','Tab 12 MAPS posts','warn',
    jsonb_build_object('what','Approved MAPS posts not yet published','evidence', count(*)||' approved; oldest scheduled '||to_char(min(scheduled_slot),'YYYY-MM-DD HH24:MI "UTC"'),'checked_at', now_ts,'threshold','approved and scheduled time passed by more than 3 hours','action','Check the Bluesky publish dispatch','owner','ingestion (publishing)','zip_count',0,'zips','[]'::jsonb)
  from public.social_posts where content_family='MAPS' and status='approved' and scheduled_slot < now_ts - interval '3 hours' having count(*) > 0;

  -- 10 · existing hourly monitor, shown as is
  return query
  select 'HEALTH_CHECK|'||h.check_name,'MONITOR_CHECK_FAILING',h.check_name,'bad',
    jsonb_build_object('what','Existing pipeline health check failing','evidence', left(h.detail,240),'checked_at', now_ts,'threshold','pipeline_health_check.ok = false since '||coalesce(h.since::text,'unknown'),'action','See the check detail; owned by ingestion','owner','ingestion','zip_count',0,'zips','[]'::jsonb)
  from public.pipeline_health_check h where not h.ok;
end $$;
revoke all on function public._hs_zip_feed_health_findings() from public, anon, authenticated;

create or replace function public.zip_feed_health_record()
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint; n int := 0; rec int := 0; ong int := 0;
begin
  begin
    create temp table _f on commit drop as select * from public._hs_zip_feed_health_findings();
    insert into public.zip_feed_health_findings(finding_key, class, subject, severity, first_seen, last_seen, resolved_at, detail)
      select finding_key, class, subject, severity, now(), now(), null, detail from _f
      on conflict (finding_key) do update set severity=excluded.severity, detail=excluded.detail, last_seen=now(),
        first_seen = case when public.zip_feed_health_findings.resolved_at is not null then now() else public.zip_feed_health_findings.first_seen end, resolved_at = null;
    update public.zip_feed_health_findings f set resolved_at = now() where f.resolved_at is null and not exists (select 1 from _f where _f.finding_key = f.finding_key);
    get diagnostics rec = row_count;
    select count(*) into n from _f;
    select count(*) into ong from public.zip_feed_health_findings where resolved_at is null;
    insert into public.zip_feed_health_runs(ok, finding_count, ongoing_count, recovered_count) values (true, n, ong, rec) returning id into rid;
  exception when others then
    insert into public.zip_feed_health_runs(ok, error) values (false, left(sqlerrm, 300)) returning id into rid;
  end;
  return rid;
end $$;
revoke all on function public.zip_feed_health_record() from public, anon, authenticated;

create or replace function public.hs_zip_feed_health_monitor()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; lr record; lok timestamptz;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into lr from public.zip_feed_health_runs order by id desc limit 1;
  select max(run_at) into lok from public.zip_feed_health_runs where ok;
  return jsonb_build_object(
    'last_run', to_jsonb(lr), 'last_ok_run_at', lok, 'runs_24h', (select count(*) from public.zip_feed_health_runs where run_at > now() - interval '24 hours'),
    'failed_runs_24h', (select count(*) from public.zip_feed_health_runs where run_at > now() - interval '24 hours' and not ok),
    'cron', (select coalesce(jsonb_agg(jsonb_build_object('job',z.job,'schedule',z.schedule,'max_age_minutes',z.max_age_minutes,'owner',z.owner,
              'last_ok',(select max(d.start_time) from cron.job j join cron.job_run_details d on d.jobid=j.jobid where j.jobname=z.job and d.status='succeeded'),
              'registered',exists(select 1 from cron.job j where j.jobname=z.job and j.active)) order by z.job),'[]'::jsonb) from public.zip_feed_health_cron z),
    'findings', (select coalesce(jsonb_agg(to_jsonb(f) order by (f.resolved_at is not null), case f.severity when 'bad' then 0 when 'warn' then 1 else 2 end, f.first_seen), '[]'::jsonb)
                 from (select * from public.zip_feed_health_findings where resolved_at is null or resolved_at > now() - interval '7 days') f),
    'as_of', now());
end $$;
revoke all on function public.hs_zip_feed_health_monitor() from public, anon;
grant execute on function public.hs_zip_feed_health_monitor() to authenticated;

select cron.schedule('zip-feed-health-record', '55 * * * *', 'select public.zip_feed_health_record()')
  where not exists (select 1 from cron.job where jobname = 'zip-feed-health-record');
