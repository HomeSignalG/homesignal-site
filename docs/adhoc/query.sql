with c as (select id, slug, level, parent_id from public.communities where '78521' = any(zip_codes) or slug ilike '%78521%')
select 'communities' k, (select json_agg(c) from c)::text v
union all select 'app_changes_by_category', (select json_object_agg(category, n) from (select category, count(*) n from public.app_changes where zip='78521' group by 1) x)::text
union all select 'app_changes_newest', (select max(created_at)::text from public.app_changes where zip='78521')
union all select 'meta', (select row_to_json(m)::text from (select zip, data_quality, indexable, updated_at from public.app_community_meta where zip='78521') m)
union all select 'dev_report', (select json_build_object('refreshed', refreshed_at, 'fac_refreshed', facilities_refreshed_at, 'counts', counts, 'unavail', facilities_unavailable)::text from public.development_reports where zip='78521')
union all select 'root_feeds', (select json_agg(json_build_object('feed',feed_id,'active',active,'table',target_table)) from public.feeds f where f.community_id in (select coalesce(parent_id,id)::text from c union select id::text from c))::text
union all select 'alerts_on_root', (select json_object_agg(category, n) from (select category, count(*) n from public.alerts a where a.community_id in (select coalesce(parent_id,id) from c) group by 1) x)::text
union all select 'local_news_holds_or_alerts_78521_14d', (select count(*)::text from public.alerts a where a.category='local_news' and a.community_id in (select coalesce(parent_id,id) from c) and a.created_at > now()-interval '14 days')
union all select 'markers', (select left(public.app_zip_geography_state('78521')::text, 300));
