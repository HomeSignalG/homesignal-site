-- Tab 2 · PER-FEED READ HEALTH (2026-11-21). SQL of record; supersedes the health parts of docs/feed-inventory-health.sql (apply that first).
-- Needs homesignal-ingest migration 20261121010000_feed_read_outcome.sql (public.feed_read_outcome) and feed_health() writing it (homesignal-ingest #1158).
-- READ-ONLY. Adds _hs_feed_inventory_v2 (inventory + health + last outcome columns), hs_feed_inventory_summary / _page and the recorder's feed findings.
-- Feed-to-ZIP mapping (zip_pages, FEEDS_REACH_NO_ZIP_PAGE) stays separate from read health; the community-output proxy (evidence_class) is kept as a labelled proxy and is never used as a health state.

-- Per-feed READ HEALTH from public.feed_read_outcome (written by homesignal-ingest feed_health(); one row per active feed per run).
-- States (first match wins): NEVER_CHECKED (no outcome row) · STALE_EVIDENCE (newest outcome older than the MONITORING threshold below)
--   · READ_FAILED (newest outcome: the read raised) · READ_OK_ZERO_ITEMS (newest outcome: a successful read returned zero items; NOT a failure)
--   · READ_OK_ITEMS (newest outcome: a successful read returned items).
-- The 12-hour threshold is a MONITORING threshold, not any source's publishing schedule: the full ingest run is scheduled every 4 hours,
-- so 12 h means three runs in a row produced no outcome for the feed. An old newest_item_date is information only and never sets a state.
create or replace function public._hs_feed_read_state()
returns table(feed_id text, state text, last_attempt_at timestamptz, last_outcome text, items_returned int, newest_item_date timestamptz, last_error text, consecutive_errors int, last_run_id text)
language sql stable security definer set search_path = public as $$
  with ranked as (select o.*, row_number() over (partition by o.feed_id order by o.attempted_at desc, o.id desc) rn from public.feed_read_outcome o),
       firstok as (select r.feed_id, min(r.rn) m from ranked r where r.outcome <> 'error' group by 1),
       streak as (select r.feed_id, count(*)::int n from ranked r left join firstok f on f.feed_id = r.feed_id where r.outcome = 'error' and r.rn < coalesce(f.m, 2147483647) group by 1)
  select l.feed_id,
    case when l.attempted_at < now() - interval '12 hours' then 'STALE_EVIDENCE'
         when l.outcome = 'error' then 'READ_FAILED'
         when l.outcome = 'empty' then 'READ_OK_ZERO_ITEMS'
         else 'READ_OK_ITEMS' end,
    l.attempted_at, l.outcome, l.items_returned, l.newest_item_date, l.error, coalesce(st.n, 0), l.run_id
  from ranked l left join streak st on st.feed_id = l.feed_id where l.rn = 1;
$$;
revoke all on function public._hs_feed_read_state() from public, anon, authenticated;

-- A new function name instead of DROP + CREATE: the return columns change, and a destructive statement needs a human confirmation in the migration tool.
-- _hs_feed_inventory_rows() (docs/feed-inventory-health.sql) stays in place, unused after this file.
create or replace function public._hs_feed_inventory_v2()
returns table(feed_id text, active boolean, kind text, community_id text, community_name text, zip_pages int, shared_source int,
              last_output_at timestamptz, feed_last_row_at timestamptz, evidence_class text, evidence_basis text,
              health_state text, last_attempt_at timestamptz, last_outcome text, items_returned int, newest_item_date timestamptz, last_error text, consecutive_errors int, last_run_id text)
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
    case when f.target_table = 'meetings' then 'meetings stored for this community (meetings.feed_id also available per feed)' else 'alerts stored for this community and pipeline (alerts has no feed_id)' end,
    case when not f.active then 'INACTIVE' else coalesce(rs.state, 'NEVER_CHECKED') end,
    rs.last_attempt_at, rs.last_outcome, rs.items_returned, rs.newest_item_date, rs.last_error, rs.consecutive_errors, rs.last_run_id
  from public.feeds f
  left join public._hs_feed_read_state() rs on rs.feed_id = f.feed_id
  left join public.communities c on c.id::text = f.community_id
  left join chain ch on ch.root::text = f.community_id
  left join links lk on lk.root::text = f.community_id
  left join m_feed mf on mf.feed_id = f.feed_id
  left join m_comm mc on mc.cid = f.community_id
  left join a_comm ac on ac.cid = f.community_id and ac.pipeline_type = f.pipeline_type
  left join shared s on s.source = f.source and s.community_id = f.community_id and s.target_table = f.target_table;
$$;
revoke all on function public._hs_feed_inventory_v2() from public, anon, authenticated;

create or replace function public.hs_feed_inventory_summary()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; r jsonb; hb record;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  select workflow, max(finished_at) at into hb from public.ingest_run_heartbeat where workflow = 'ingest' group by workflow;
  select jsonb_build_object(
    'feeds_total', count(*), 'active', count(*) filter (where active), 'inactive', count(*) filter (where not active),
    'by_kind', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public._hs_feed_inventory_v2() where active group by 1) q),
    'by_evidence', (select coalesce(jsonb_object_agg(evidence_class, n), '{}'::jsonb) from (select evidence_class, count(*) n from public._hs_feed_inventory_v2() group by 1) q),
    'by_kind_evidence', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'evidence_class', evidence_class, 'feeds', n) order by kind, evidence_class), '[]'::jsonb) from (select kind, evidence_class, count(*) n from public._hs_feed_inventory_v2() where active group by 1, 2) q),
    'communities', count(distinct community_id) filter (where active),
    'distinct_sources', (select count(distinct source) from public.feeds where active),
    'active_feeds_sharing_a_source', count(*) filter (where active and shared_source > 1),
    'active_feeds_reaching_no_zip_page', count(*) filter (where active and zip_pages = 0),
    'active_feeds_unknown_community', count(*) filter (where active and community_name is null),
    'health_unknown', count(*) filter (where active and health_state in ('NEVER_CHECKED', 'STALE_EVIDENCE')),
    'health_states', (select coalesce(jsonb_object_agg(health_state, n), '{}'::jsonb) from (select health_state, count(*) n from public._hs_feed_inventory_v2() where active group by 1) q),
    'stale_threshold_hours', 12,
    'latest_outcome_at', max(last_attempt_at),
    'feeds_with_outcome', count(*) filter (where active and last_attempt_at is not null))
  into r from public._hs_feed_inventory_v2();
  return r || jsonb_build_object('parent_job', jsonb_build_object('workflow', 'ingest', 'last_completed', hb.at, 'proves', 'a scheduled ingest run completed (4-hourly); per-feed read health comes from the per-feed outcome rows, not from this'),
    'not_in_this_inventory', 'Local News registry endpoints (local_news_registry heartbeat) are a separate pipeline and are not rows of public.feeds',
    'proxy_note', 'Stored-output evidence is per community, not per feed. It shows something was stored; it cannot show the last read succeeded, that coverage is complete, or that a quiet feed is broken. Read health comes only from the per-feed outcome rows.',
    'stale_note', 'STALE_EVIDENCE is a monitoring threshold (12 hours = three missed 4-hourly ingest runs for this feed), not a source publishing schedule. An old newest item date never sets a state.',
    'as_of', now());
end $$;
revoke all on function public.hs_feed_inventory_summary() from public, anon;
grant execute on function public.hs_feed_inventory_summary() to authenticated;

create or replace function public.hs_feed_inventory_page(p_filter text default 'active', p_offset int default 0, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare caller_email text := auth.jwt() ->> 'email'; lim int := least(greatest(coalesce(p_limit, 100), 1), 500); off int := greatest(coalesce(p_offset, 0), 0); res jsonb;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then raise exception 'not authorized' using errcode = '42501'; end if;
  with f as (select * from public._hs_feed_inventory_v2() r where
      case when p_filter = 'all' then true when p_filter = 'active' then r.active when p_filter = 'inactive' then not r.active
           when p_filter = 'no_zip_page' then r.active and r.zip_pages = 0
           when p_filter like 'kind:%' then r.active and r.kind = substr(p_filter, 6)
           when p_filter like 'evidence:%' then r.active and r.evidence_class = substr(p_filter, 10)
           when p_filter like 'health:%' then r.active and r.health_state = substr(p_filter, 8)
           else false end),
  p as (select *, count(*) over () total from f order by active desc, kind, community_name nulls first, feed_id offset off limit lim)
  select jsonb_build_object('filter', p_filter, 'total', coalesce((select total from p limit 1), (select count(*) from f)), 'offset', off, 'limit', lim,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('feed_id', feed_id, 'active', active, 'kind', kind, 'community', community_name, 'zip_pages', zip_pages, 'shared_source', shared_source,
              'last_output_at', last_output_at, 'feed_last_row_at', feed_last_row_at, 'evidence_class', evidence_class, 'health', health_state, 'last_attempt_at', last_attempt_at, 'last_outcome', last_outcome, 'items_returned', items_returned, 'newest_item_date', newest_item_date, 'last_error', last_error, 'consecutive_errors', consecutive_errors) order by active desc, kind, community_name nulls first, feed_id) from p), '[]'::jsonb)) into res;
  return res;
end $$;
revoke all on function public.hs_feed_inventory_page(text, int, int) from public, anon;
grant execute on function public.hs_feed_inventory_page(text, int, int) to authenticated;

create or replace function public._hs_feed_findings()
returns table(finding_key text, class text, subject text, severity text, detail jsonb)
language plpgsql stable security definer set search_path = public as $$
declare n_active int; n_nozip int; n_none int; n_never int; n_stale int; n_failed int; n_unknown int; hbat timestamptz; failed_sample text; last_out timestamptz;
begin
  select count(*) filter (where active), count(*) filter (where active and zip_pages = 0), count(*) filter (where active and evidence_class = 'NO_STORED_OUTPUT_FOR_COMMUNITY'),
    count(*) filter (where active and health_state = 'NEVER_CHECKED'), count(*) filter (where active and health_state = 'STALE_EVIDENCE'), count(*) filter (where active and health_state = 'READ_FAILED'), max(last_attempt_at)
    into n_active, n_nozip, n_none, n_never, n_stale, n_failed, last_out from public._hs_feed_inventory_v2();
  n_unknown := n_never + n_stale;
  select string_agg(feed_id, ', ') into failed_sample from (select feed_id from public._hs_feed_inventory_v2() where active and health_state = 'READ_FAILED' order by consecutive_errors desc, feed_id limit 5) q;
  select max(finished_at) into hbat from public.ingest_run_heartbeat where workflow = 'ingest';
  if n_unknown > 0 then
    return query select 'FEEDS_HEALTH_UNKNOWN|all', 'FEEDS_HEALTH_UNKNOWN', 'legacy alert and meeting feeds', 'unverified',
      jsonb_build_object('what','Feeds with no current read outcome (health unknown)','evidence', n_never||' active feeds never checked (no outcome row) and '||n_stale||' with stale monitoring evidence (newest outcome older than 12 hours). Newest outcome recorded '||coalesce(to_char(last_out,'YYYY-MM-DD HH24:MI "UTC"'),'never')||'. Parent ingest run last completed '||coalesce(to_char(hbat,'YYYY-MM-DD HH24:MI "UTC"'),'never')||'; that proves a run finished, not that each feed read.',
        'checked_at', now(),'threshold','monitoring threshold: no per-feed outcome for 12 hours (three missed 4-hourly runs). This is not a source publishing schedule.','action','Confirm the next scheduled ingest run records outcomes; a feed skipped by design (placeholder source, email without mailbox) stays never checked','owner','ingestion (outcome rows written by feed_health(), homesignal-ingest #1158)','zip_count',0,'zips','[]'::jsonb,'feed_filter','health:NEVER_CHECKED');
  end if;
  if n_failed > 0 then
    return query select 'FEEDS_READ_FAILED|all', 'FEEDS_READ_FAILED', 'legacy alert and meeting feeds', 'warn',
      jsonb_build_object('what','Feeds whose newest read failed','evidence', n_failed||' active feeds: the newest recorded read raised an error (longest streaks: '||coalesce(failed_sample,'')||'). A successful read with zero items is not counted here.','checked_at', now(),
        'threshold','newest outcome = error, within the 12-hour monitoring window','action','Open the feed list for the error text; fix the source URL or adapter, or deactivate the feed','owner','ingestion','zip_count',0,'zips','[]'::jsonb,'feed_filter','health:READ_FAILED');
  end if;
  if n_nozip > 0 then
    return query select 'FEEDS_NO_ZIP_PAGE|all', 'FEEDS_REACH_NO_ZIP_PAGE', 'legacy feeds', 'warn',
      jsonb_build_object('what','Active feeds whose community reaches no ZIP page','evidence', n_nozip||' active feeds (parent chain and city links checked)','checked_at', now(),'threshold','every active feed should reach at least one ZIP page','action','Check the feed community mapping; the mapping is owned by site/ingestion','owner','site / ingestion','zip_count',0,'zips','[]'::jsonb,'feed_filter','no_zip_page');
  end if;
  if n_none > 0 then
    return query select 'FEEDS_NO_STORED_OUTPUT|all', 'FEEDS_NO_STORED_OUTPUT_PROXY', 'legacy feeds', 'unverified',
      jsonb_build_object('what','Proxy only: nothing was ever stored for these feeds'' community','evidence', n_none||' active feeds sit on a community (and pipeline) with no stored alert or meeting. This does not show the feed is broken: a working feed can publish nothing.','checked_at', now(),
        'threshold','no stored row for the community','action','Confirm whether the source is quiet or unmapped; read health is tracked separately from per-feed outcomes','owner','ingestion','zip_count',0,'zips','[]'::jsonb,'feed_filter','evidence:NO_STORED_OUTPUT_FOR_COMMUNITY');
  end if;
end $$;
revoke all on function public._hs_feed_findings() from public, anon, authenticated;
