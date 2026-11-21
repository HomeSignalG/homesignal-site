-- Tab 2 · LEGACY ALERT/MEETING FEED INVENTORY AND PROXY HEALTH (2026-11-20). SQL of record. ADDITIVE + READ-ONLY (functions only; the recorder is redefined to add feed findings).
--
-- WHAT EXISTS (measured 2026-11-20): public.feeds holds 3,302 rows, 2,944 active (38 news alerts, 734 government-notice alerts, 2,172 meetings),
-- 507 communities, 796 distinct sources. NO per-feed attempt / success / failure record exists anywhere in the database: ingest.py::feed_health()
-- computes it and only logs. The ingest heartbeat (ingest_run_heartbeat, workflow 'ingest') proves a parent RUN completed; it names no feed outcome.
-- alerts has no feed_id; meetings has feed_id.
--
-- THEREFORE every feed's health is HEALTH_UNKNOWN here. This file adds an INVENTORY (every feed accounted for, mapped to the ZIP pages its community reaches)
-- plus a PROXY (newest stored output). The proxy proves only that SOMETHING was stored for that community (and pipeline); it cannot prove the feed's last
-- read succeeded, that it is complete, or that a quiet feed is broken: a working feed can publish nothing new. Feed-level silence is structural
-- (topic readers share one source with a catch-all), so the unit for the proxy is the COMMUNITY, never the feed.
-- Nothing here fetches, schedules or changes ingestion.
-- (applied as ONE transaction by apply_migration)

create or replace function public._hs_community_zips(p_comm uuid)
returns table(zip text) language sql stable security definer set search_path = public as $$
  with recursive d as (select id, 0 depth from public.communities where id = p_comm
                       union all select c.id, d.depth + 1 from d join public.communities c on c.parent_id = d.id where d.depth < 6)
  select distinct z::text from (
    select unnest(c.zip_codes) z from d join public.communities c on c.id = d.id where c.level = 'zip'
    union all select l.zip from public.zip_government_city_links l where l.community_id = p_comm) q where z is not null;
$$;
revoke all on function public._hs_community_zips(uuid) from public, anon, authenticated;

create or replace function public._hs_feed_inventory_rows()
returns table(feed_id text, active boolean, kind text, community_id text, community_name text, zip_pages int, shared_source int,
              last_output_at timestamptz, feed_last_row_at timestamptz, evidence_class text, evidence_basis text)
language sql stable security definer set search_path = public as $$
  with recursive d as (select id root, id cur, 0 depth from public.communities
                       union all select d.root, c.id, d.depth + 1 from d join public.communities c on c.parent_id = d.cur where d.depth < 6),
  chain as (select d.root, count(distinct z) zips from d join public.communities c on c.id = d.cur and c.level = 'zip' cross join lateral unnest(c.zip_codes) z group by d.root),
  links as (select community_id root, count(distinct zip) zips from public.zip_government_city_links group by 1),
  m_feed as (select feed_id, max(created_at) at from public.meetings where feed_id is not null group by 1),
  m_comm as (select community_id::text cid, max(created_at) at from public.meetings group by 1),
  a_comm as (select community_id::text cid, pipeline_type, max(created_at) at from public.alerts group by 1, 2),
  shared as (select source, community_id, target_table, count(*) n from public.feeds where active and source is not null group by 1, 2, 3)
  select f.feed_id, f.active,
    case when f.target_table = 'meetings' then 'meetings' when f.pipeline_type = 'government_notice' then 'alerts_government' when f.pipeline_type = 'news' then 'alerts_news' else 'other' end,
    f.community_id, c.name,
    coalesce(ch.zips, 0)::int + coalesce(lk.zips, 0)::int,
    coalesce(s.n, 1)::int,
    case when f.target_table = 'meetings' then mc.at else ac.at end,
    case when f.target_table = 'meetings' then mf.at else null end,
    case when not f.active then 'INACTIVE'
         when (case when f.target_table = 'meetings' then mc.at else ac.at end) is null then 'NO_STORED_OUTPUT_FOR_COMMUNITY'
         when (case when f.target_table = 'meetings' then mc.at else ac.at end) >= now() - interval '30 days' then 'STORED_OUTPUT_WITHIN_30D'
         else 'STORED_OUTPUT_OLDER_THAN_30D' end,
    case when f.target_table = 'meetings' then 'meetings stored for this community (meetings.feed_id also available per feed)' else 'alerts stored for this community and pipeline (alerts has no feed_id)' end
  from public.feeds f
  left join public.communities c on c.id::text = f.community_id
  left join chain ch on ch.root::text = f.community_id
  left join links lk on lk.root::text = f.community_id
  left join m_feed mf on mf.feed_id = f.feed_id
  left join m_comm mc on mc.cid = f.community_id
  left join a_comm ac on ac.cid = f.community_id and ac.pipeline_type = f.pipeline_type
  left join shared s on s.source = f.source and s.community_id = f.community_id and s.target_table = f.target_table;
$$;
revoke all on function public._hs_feed_inventory_rows() from public, anon, authenticated;

create or replace function public.hs_feed_inventory_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; r jsonb; hb record;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  select workflow, max(finished_at) at into hb from public.ingest_run_heartbeat where workflow = 'ingest' group by workflow;
  select jsonb_build_object(
    'feeds_total', count(*), 'active', count(*) filter (where active), 'inactive', count(*) filter (where not active),
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public._hs_feed_inventory_rows() where active group by 1) q),
    'by_evidence', (select coalesce(jsonb_object_agg(evidence_class, n), '{}'::jsonb) from (select evidence_class, count(*) n from public._hs_feed_inventory_rows() group by 1) q),
    'by_kind_evidence', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'evidence_class', evidence_class, 'feeds', n) order by kind, evidence_class), '[]'::jsonb) from (select kind, evidence_class, count(*) n from public._hs_feed_inventory_rows() where active group by 1, 2) q),
    'communities', count(distinct community_id) filter (where active),
    'distinct_sources', (select count(distinct source) from public.feeds where active),
    'active_feeds_sharing_a_source', count(*) filter (where active and shared_source > 1),
    'active_feeds_reaching_no_zip_page', count(*) filter (where active and zip_pages = 0),
    'active_feeds_unknown_community', count(*) filter (where active and community_name is null),
    'health_unknown', count(*) filter (where active))
  into r from public._hs_feed_inventory_rows();
  return r || jsonb_build_object('parent_job', jsonb_build_object('workflow', 'ingest', 'last_completed', hb.at, 'proves', 'a scheduled ingest run completed (4-hourly); it does not say which feeds read successfully'),
    'not_in_this_inventory', 'Local News registry endpoints (local_news_registry heartbeat) are a separate pipeline and are not rows of public.feeds',
    'proxy_note', 'Stored-output evidence is per community, not per feed. It shows something was stored; it cannot show the last read succeeded, that coverage is complete, or that a quiet feed is broken.',
    'as_of', now());
end $$;
revoke all on function public.hs_feed_inventory_summary() from public, anon;
grant execute on function public.hs_feed_inventory_summary() to authenticated;

create or replace function public.hs_feed_inventory_page(p_filter text default 'active', p_offset int default 0, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; lim int := least(greatest(coalesce(p_limit, 100), 1), 500); off int := greatest(coalesce(p_offset, 0), 0); res jsonb;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  with f as (select * from public._hs_feed_inventory_rows() r where
      case when p_filter = 'all' then true when p_filter = 'active' then r.active when p_filter = 'inactive' then not r.active
           when p_filter = 'no_zip_page' then r.active and r.zip_pages = 0
           when p_filter like 'kind:%' then r.active and r.kind = substr(p_filter, 6)
           when p_filter like 'evidence:%' then r.active and r.evidence_class = substr(p_filter, 10)
           else false end),
  p as (select *, count(*) over () total from f order by active desc, kind, community_name nulls first, feed_id offset off limit lim)
  select jsonb_build_object('filter', p_filter, 'total', coalesce((select total from p limit 1), (select count(*) from f)), 'offset', off, 'limit', lim,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('feed_id', feed_id, 'active', active, 'kind', kind, 'community', community_name, 'zip_pages', zip_pages, 'shared_source', shared_source,
              'last_output_at', last_output_at, 'feed_last_row_at', feed_last_row_at, 'evidence_class', evidence_class, 'health', case when active then 'HEALTH_UNKNOWN' else 'INACTIVE' end) order by active desc, kind, community_name nulls first, feed_id) from p), '[]'::jsonb)) into res;
  return res;
end $$;
revoke all on function public.hs_feed_inventory_page(text, int, int) from public, anon;
grant execute on function public.hs_feed_inventory_page(text, int, int) to authenticated;

create or replace function public.hs_feed_zips(p_feed text, p_offset int default 0, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; lim int := least(greatest(coalesce(p_limit, 100), 1), 500); off int := greatest(coalesce(p_offset, 0), 0); comm uuid; res jsonb;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  select community_id::uuid into comm from public.feeds where feed_id = p_feed;
  with z as (select zip, count(*) over () total from public._hs_community_zips(comm) order by zip offset off limit lim)
  select jsonb_build_object('feed_id', p_feed, 'found', comm is not null, 'total', coalesce((select total from z limit 1), 0), 'offset', off, 'limit', lim,
    'zips', coalesce((select jsonb_agg(zip order by zip) from z), '[]'::jsonb)) into res;
  return res;
end $$;
revoke all on function public.hs_feed_zips(text, int, int) from public, anon;
grant execute on function public.hs_feed_zips(text, int, int) to authenticated;

-- recorder: add feed findings (class-level; drill-down through detail.feed_filter)
create or replace function public._hs_feed_findings()
returns table(finding_key text, class text, subject text, severity text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare s jsonb; n_active int; n_nozip int; n_none int; hbat timestamptz;
begin
  s := null;
  select count(*) filter (where active), count(*) filter (where active and zip_pages = 0), count(*) filter (where active and evidence_class = 'NO_STORED_OUTPUT_FOR_COMMUNITY')
    into n_active, n_nozip, n_none from public._hs_feed_inventory_rows();
  select max(finished_at) into hbat from public.ingest_run_heartbeat where workflow = 'ingest';
  return query select 'FEEDS_HEALTH_UNKNOWN|all', 'FEEDS_HEALTH_UNKNOWN', 'legacy alert and meeting feeds', 'unverified',
    jsonb_build_object('what','No per-feed read success or failure is recorded','evidence', n_active||' active feeds in public.feeds: health unknown. Parent ingest run last completed '||coalesce(to_char(hbat,'YYYY-MM-DD HH24:MI "UTC"'),'never')||'; that proves a run finished, not that each feed read.',
      'checked_at', now(),'threshold','a per-feed attempt/success/failure record','action','Dependency on ingestion: persist feed_health() results (per-feed outcome) so Tab 2 can monitor feeds directly','owner','ingestion (request pending, not accepted)','zip_count',0,'zips','[]'::jsonb,'feed_filter','active');
  if n_nozip > 0 then
    return query select 'FEEDS_NO_ZIP_PAGE|all', 'FEEDS_REACH_NO_ZIP_PAGE', 'legacy feeds', 'warn',
      jsonb_build_object('what','Active feeds whose community reaches no ZIP page','evidence', n_nozip||' active feeds (parent chain and city links checked)','checked_at', now(),'threshold','every active feed should reach at least one ZIP page','action','Check the feed community mapping; the mapping is owned by site/ingestion','owner','site / ingestion','zip_count',0,'zips','[]'::jsonb,'feed_filter','no_zip_page');
  end if;
  if n_none > 0 then
    return query select 'FEEDS_NO_STORED_OUTPUT|all', 'FEEDS_NO_STORED_OUTPUT_PROXY', 'legacy feeds', 'unverified',
      jsonb_build_object('what','Proxy only: nothing was ever stored for these feeds'' community','evidence', n_none||' active feeds sit on a community (and pipeline) with no stored alert or meeting. This does not show the feed is broken: a working feed can publish nothing.','checked_at', now(),
        'threshold','no stored row for the community','action','Confirm whether the source is quiet, unmapped or failing; needs per-feed outcome from ingestion','owner','ingestion (request pending, not accepted)','zip_count',0,'zips','[]'::jsonb,'feed_filter','evidence:NO_STORED_OUTPUT_FOR_COMMUNITY');
  end if;
end $$;
revoke all on function public._hs_feed_findings() from public, anon, authenticated;

create or replace function public.zip_feed_health_record()
returns bigint language plpgsql security definer set search_path = public as $$
declare rid bigint; n int := 0; rec int := 0; ong int := 0;
begin
  begin
    create temp table _f on commit drop as select * from public._hs_zip_feed_health_findings() union all select * from public._hs_feed_findings();
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
