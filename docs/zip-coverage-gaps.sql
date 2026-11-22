-- Tab 2 · COVERAGE GAPS AND UNCONFIRMED FINDINGS (2026-11-22). READ-ONLY; apply after docs/feed-read-health.sql and docs/zip-feed-health-monitor.sql.
-- 1. hs_zip_feed_health_monitor now lists AGED_OUT_UNCONFIRMED findings for as long as they stay unconfirmed (they used to drop out of the list 7 days
--    after they left the current set). Confirmed recoveries keep the 7-day window. Nothing is reopened and no finding row is changed.
-- 2. hs_zip_coverage_gaps(): three SEPARATE gaps, each with a count and an evidence timestamp:
--      unmapped_zips   canonical ZIPs reached by no ACTIVE feed (a coverage gap; not a failed ingestion, and not proof that no suitable feed exists)
--      all_failing_zips mapped ZIPs whose every active feed's LATEST read failed (state READ_FAILED; stale or never-checked feeds are not counted as failing)
--      official_record  completeness against official systems: NOT MEASURED (the one read-only pilot is recorded; it is not coverage)
-- 3. hs_zip_coverage_gap_page(kind, offset, limit): the ZIPs behind a gap, 100 at a time.
create or replace function public._hs_zip_feed_map()
returns table(zip text, active_feeds int, failing_feeds int)
language sql stable security definer set search_path = public as $$
  with recursive d as (select id root, id cur, 0 depth from public.communities
                       union all select d.root, c.id, d.depth + 1 from d join public.communities c on c.parent_id = d.cur where d.depth < 6),
  cf as (select community_id::uuid root, count(*) active, count(*) filter (where health_state = 'READ_FAILED') failing
         from public._hs_feed_inventory_v2() where active and community_id ~ '^[0-9a-f-]{36}$' group by 1),
  zm as (select z::text zip, d.root from d join public.communities c on c.id = d.cur and c.level = 'zip' cross join lateral unnest(c.zip_codes) z
         union select l.zip::text, l.community_id from public.zip_government_city_links l)
  select r.zip::text, coalesce(sum(cf.active), 0)::int, coalesce(sum(cf.failing), 0)::int
  from public.canonical_zip_registry r left join zm on zm.zip = r.zip::text left join cf on cf.root = zm.root group by r.zip;
$$;
revoke all on function public._hs_zip_feed_map() from public, anon, authenticated;

create or replace function public.hs_zip_coverage_gaps()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; res jsonb; lo timestamptz; lrun text;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  select o.attempted_at, o.run_id into lo, lrun from public.feed_read_outcome o order by o.attempted_at desc, o.id desc limit 1;
  select jsonb_build_object(
    'registry_zips', count(*),
    'unmapped_zips', jsonb_build_object('count', count(*) filter (where active_feeds = 0), 'meaning', 'Canonical ZIP pages that no active feed reaches (through the ZIP''s community chain or city links). This is a coverage gap. It is not a failed ingestion, and it does not show that no suitable feed exists.', 'owner', 'ingestion (sources) with the site (community mapping)'),
    'mapped_zips', count(*) filter (where active_feeds > 0),
    'all_failing_zips', jsonb_build_object('count', count(*) filter (where active_feeds > 0 and failing_feeds = active_feeds), 'meaning', 'Mapped ZIPs whose every active feed''s latest recorded read failed. A feed with no recent outcome is not counted as failing.', 'owner', 'ingestion'),
    'official_record', jsonb_build_object('status', 'NOT_MEASURED', 'meaning', 'Whether JODY holds every official record for a ZIP has not been measured. Feed reads succeeding does not show it. One read-only pilot (ZIP 85083, Phoenix building permits, 2026-11-21) was UNVERIFIED_UNDECIDABLE and is not coverage.', 'last_comparison', null, 'owner', 'site (Tab 2)'),
    'evidence', jsonb_build_object('latest_outcome_at', lo, 'latest_outcome_run_id', lrun, 'computed_at', now()))
  into res from public._hs_zip_feed_map();
  return res;
end $$;
revoke all on function public.hs_zip_coverage_gaps() from public, anon;
grant execute on function public.hs_zip_coverage_gaps() to authenticated;

create or replace function public.hs_zip_coverage_gap_page(p_kind text, p_offset int default 0, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; lim int := least(greatest(coalesce(p_limit, 100), 1), 500); off int := greatest(coalesce(p_offset, 0), 0); res jsonb;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_kind not in ('unmapped', 'all_failing') then raise exception 'unknown gap kind' using errcode = '22023'; end if;
  with m as (select * from public._hs_zip_feed_map() where case p_kind when 'unmapped' then active_feeds = 0 else active_feeds > 0 and failing_feeds = active_feeds end),
       p as (select zip, active_feeds, failing_feeds, count(*) over () total from m order by zip offset off limit lim)
  select jsonb_build_object('kind', p_kind, 'total', coalesce((select total from p limit 1), 0), 'offset', off, 'limit', lim, 'as_of', now(),
    'zips', coalesce((select jsonb_agg(jsonb_build_object('zip', zip, 'active_feeds', active_feeds, 'failing_feeds', failing_feeds) order by zip) from p), '[]'::jsonb)) into res;
  return res;
end $$;
revoke all on function public.hs_zip_coverage_gap_page(text, int, int) from public, anon;
grant execute on function public.hs_zip_coverage_gap_page(text, int, int) to authenticated;

-- Monitor listing: unconfirmed findings stay listed.
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
                 from (select * from public.zip_feed_health_findings
                       where resolved_at is null or resolved_at > now() - interval '7 days' or resolution_basis = 'AGED_OUT_UNCONFIRMED') f),
    'as_of', now());
end $$;
revoke all on function public.hs_zip_feed_health_monitor() from public, anon;
grant execute on function public.hs_zip_feed_health_monitor() to authenticated;
