-- County launch-readiness check: every feed that puts data on a county's ZIP pages, in ONE read-only query.
-- READ-ONLY. Counts and dates only; it never prints a record title, address or name.
--
-- WHY THIS EXISTS (2026-10-18). Pierce County WA was reported "ready for launch" after checking only the
-- development permits it had changed. The EPA facility layer (its own refresh clock) was stale on 11 of 65
-- pages, and government and local-news coverage were never measured. A launch verdict must come from this
-- file, run just before the verdict, and it must name every row that is not PASS.
--
-- HOW TO RUN: set the two values in `params`, then run the whole file (Supabase SQL editor, the MCP
-- execute_sql tool, or db-sql.yml from a branch). One row per check:
--   verdict PASS | FLAG (look at it, may be acceptable) | FAIL (not ready until fixed or ruled acceptable)
--   value    what was measured                control   a non-zero count that proves the query saw data
-- A check whose control is 0 measured nothing, and its verdict is FAIL regardless of the value.
--
-- Thresholds come from the launch brief and CLAUDE.md, not from this county:
--   development refresh 72 h FLAG / 7 d FAIL · EPA facility layer 7 d FAIL · government notices and
--   meetings: newest delivered row 30 d FLAG / 90 d FAIL (GOV_STALE_DAYS) · local news newest 14 d FLAG
--   (the 14-day render window) · a development source with no new row in 60 d FLAG.
-- Pages with no Census ZIP boundary are listed, not failed: they are the national Fix 4 class
-- (PO-box / single-organisation ZIPs) and correctly show no map area.

with params as (select 'WA'::text st, 'Pierce'::text co),
pages as (
  select c.zip_codes[1] zip, c.id, c.parent_id
  from public.communities c, params p where c.state = p.st and c.county = p.co and c.level = 'zip'
),
-- chain: the ZIP page plus up to two ancestors (zip -> city -> county), the cascade the site walks
chain as (
  select distinct pg.zip, x.cid
  from pages pg
  left join public.communities a on a.id = pg.parent_id
  left join public.communities b on b.id = a.parent_id
  cross join lateral (values (pg.id), (pg.parent_id), (a.parent_id), (b.parent_id)) x(cid)
  where x.cid is not null
),
chain_ids as (select distinct cid from chain),
rep as (select d.* from public.development_reports d join pages using (zip)),
dev as (
  select substring(p.source_key from '^[a-z]+:([^:]+)') src, p.zip, p.created_at
  from public.app_projects p join pages using (zip) where p.record_kind = 'development'
),
src as (select src, count(distinct zip) zips, max(created_at) newest_new from dev group by src),
gn as (
  select max(a.created_at) newest, count(*) n from public.alerts a
  where a.community_id in (select cid from chain_ids) and a.pipeline_type = 'government_notice'
),
mt as (select max(m.created_at) newest, count(*) n from public.meetings m where m.community_id in (select cid from chain_ids)),
ln as (
  select max(a.created_at) newest, count(*) n from public.alerts a
  where a.community_id in (select cid from chain_ids) and a.category = 'local_news'
),
feeds as (
  select f.target_table, count(*) filter (where f.active) active_n, count(*) n
  from public.feeds f where f.community_id in (select cid::text from chain_ids) group by f.target_table
),
places as (  -- non-county places on the chain, i.e. cities, and whether any feed is attached to them
  select c.id, c.name, exists (select 1 from public.feeds f where f.community_id = c.id::text and f.active) has_feed
  from public.communities c where c.id in (select cid from chain_ids) and c.level = 'city'
),
render as (
  select pg.zip, count(ch.id) filter (where ch.category = 'Local News') news, count(ch.id) total
  from pages pg left join public.app_changes ch on ch.zip = pg.zip group by pg.zip
)
select * from (
  select 1 o, 'pages in county' chk, count(*)::text value, count(*)::text control,
         case when count(*) > 0 then 'PASS' else 'FAIL' end verdict from pages
  union all
  select 2, 'pages with no Census ZIP boundary (Fix 4 class, listed not failed)',
         coalesce(string_agg(pg.zip, ' ' order by pg.zip), 'none'), (select count(*) from geo.zcta_boundary)::text, 'PASS'
  from pages pg where not exists (select 1 from geo.zcta_boundary b where b.zcta5 = pg.zip)
  union all
  select 3, 'development reports: pages older than 72 h / 7 d',
         count(*) filter (where refreshed_at < now() - interval '72 hours') || ' / ' ||
         count(*) filter (where refreshed_at < now() - interval '7 days'), count(*)::text,
         case when count(*) = 0 or count(*) filter (where refreshed_at < now() - interval '7 days') > 0 then 'FAIL'
              when count(*) filter (where refreshed_at < now() - interval '72 hours') > 0 then 'FLAG' else 'PASS' end
  from rep
  union all
  select 4, 'EPA facility layer: pages older than 7 d (and which)',
         count(*) filter (where facilities_refreshed_at < now() - interval '7 days') || ': ' ||
         coalesce(string_agg(zip, ' ' order by zip) filter (where facilities_refreshed_at < now() - interval '7 days'), '-'),
         count(*)::text,
         case when count(*) = 0 or count(*) filter (where facilities_refreshed_at < now() - interval '7 days') > 0 then 'FAIL' else 'PASS' end
  from rep
  union all
  select 5, 'development source ' || src || ': pages / newest new row',
         zips || ' / ' || newest_new::date, zips::text,
         case when newest_new < now() - interval '60 days' then 'FLAG' else 'PASS' end
  from src
  union all
  select 6, 'government-notice feeds on the chain: active / total, by table',
         coalesce((select string_agg(target_table || ' ' || active_n || '/' || n, ', ' order by target_table) from feeds), 'none'),
         coalesce((select sum(n) from feeds), 0)::text,
         case when coalesce((select sum(active_n) from feeds), 0) = 0 then 'FAIL' else 'PASS' end
  union all
  select 7, 'government notices delivered: rows / newest', n || ' / ' || coalesce(newest::date::text, '-'), n::text,
         case when n = 0 or newest < now() - interval '90 days' then 'FAIL'
              when newest < now() - interval '30 days' then 'FLAG' else 'PASS' end from gn
  union all
  select 8, 'meetings delivered: rows / newest', n || ' / ' || coalesce(newest::date::text, '-'), n::text,
         case when n = 0 or newest < now() - interval '90 days' then 'FAIL'
              when newest < now() - interval '30 days' then 'FLAG' else 'PASS' end from mt
  union all
  select 9, 'city places on the chain with no active feed (government is county-only there)',
         (select count(*) filter (where not has_feed) from places) || ' of ' || (select count(*) from places),
         (select count(*) from pages)::text,
         case when (select count(*) filter (where not has_feed) from places) > 0 then 'FLAG'
              when (select count(*) from places) = 0 then 'FLAG' else 'PASS' end
  union all
  select 10, 'local news stored: rows / newest', n || ' / ' || coalesce(newest::date::text, '-'), n::text,
         case when n = 0 then 'FAIL' when newest < now() - interval '14 days' then 'FLAG' else 'PASS' end from ln
  union all
  select 11, 'pages rendering no Local News item right now', count(*) filter (where news = 0) || ' of ' || count(*),
         sum(total)::text, case when count(*) filter (where news = 0) > 0 then 'FLAG' else 'PASS' end from render
  union all
  select 12, 'pages rendering nothing at all (any section)', count(*) filter (where total = 0) || ': ' ||
         coalesce(string_agg(zip, ' ' order by zip) filter (where total = 0), '-'),
         sum(total)::text, case when count(*) filter (where total = 0) > 0 then 'FLAG' else 'PASS' end from render
) r order by o, chk;
-- NOT COVERED HERE (check separately and say so in the verdict): Map 1 data-centre markers
-- (public.map1_dc_zip_members per ZIP), source-specific privacy checks (pierce-privacy-backfill.sql B2/B3
-- for PALS), and whether the Local News Gold Master registry maps enough publishers to the county
-- (homesignal-ingest adapters/local_news_registry.json zip_map).
