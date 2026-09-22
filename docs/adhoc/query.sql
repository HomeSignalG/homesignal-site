-- READ-ONLY adhoc probe #2 (Environment & Utilities audit). Never merge.
with acm as materialized (select source_ref, array_agg(distinct category) cats, count(distinct zip) zips from public.app_changes where source_ref is not null group by source_ref),
fn as (select pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure) d),
lines as (select n, l from fn, regexp_split_to_table(fn.d, E'\n') with ordinality t(l,n))
select json_build_object(
 'fn_category_lines', (select json_agg(n||': '||left(btrim(l),170) order by n) from lines where l ~* 'category|pipeline_type|relevance|insert into public\.app_|record_kind'),
 'water_gov_alerts', (select json_agg(t) from (select a.title, a.agency_name, c.name comm, a.created_at::date d,
     (select cats from acm where acm.source_ref=a.source_url) mat_cats,
     (select zips from acm where acm.source_ref=a.source_url) mat_zips
   from public.alerts a left join public.communities c on c.id=a.community_id
   where a.pipeline_type='government_notice' and a.category='Water districts & utilities' order by a.created_at desc limit 6) t),
 'water_gov_alerts_materialized', (select json_build_object('alerts',count(*),'with_app_changes',count(acm.source_ref)) from public.alerts a left join acm on acm.source_ref=a.source_url where a.pipeline_type='government_notice' and a.category='Water districts & utilities'),
 'negative_water_word_other_cat', (select json_agg(t) from (select a.category, a.title, (select cats from acm where acm.source_ref=a.source_url) mat_cats
   from public.alerts a where a.pipeline_type='government_notice' and a.category<>'Water districts & utilities' and a.title ~* '\mwater\M' order by a.created_at desc limit 5) t),
 'negative_water_word_count', (select count(*) from public.alerts a where a.pipeline_type='government_notice' and a.category<>'Water districts & utilities' and a.title ~* '\mwater\M'),
 'water_meetings', (select json_agg(t) from (select m.title, m.meeting_date::date, c.name comm,
     (select cats from acm where acm.source_ref=m.source_url) mat_cats
   from public.meetings m left join public.communities c on c.id=m.community_id where m.category='Water districts & utilities' order by m.meeting_date desc limit 5) t),
 'local_news_env_subtopics', (select json_agg(t order by n desc) from (select s, count(*) n from public.alerts a, unnest(a.subtopics) s where a.category='local_news' group by s) t),
 'local_news_env_example', (select json_agg(t) from (select a.title, a.subtopics, (select cats from acm where acm.source_ref=a.source_url) mat_cats, (select zips from acm where acm.source_ref=a.source_url) mat_zips
   from public.alerts a where a.category='local_news' and a.subtopics && array['Water Quality','Soil Quality','Air Quality'] and a.source_url in (select source_ref from acm) order by a.created_at desc limit 3) t),
 'app_projects_by_kind', (select json_agg(t) from (select record_kind, count(*) n, count(distinct zip) zips from public.app_projects group by 1) t),
 'facility_example', (select json_agg(t) from (select zip, name, status, developer, source_ref, facility_env is not null has_env from public.app_projects where record_kind='facility' limit 2) t),
 'utility_dev_example', (select json_agg(t) from (select zip, name, status, record_kind, source_ref from public.app_projects where record_kind='development' and name ~* '(wastewater|water treatment|water reclamation|sewer|substation|transmission line|pump station)' order by submitted_at desc nulls last limit 4) t),
 'utility_dev_count', (select count(*) from public.app_projects where record_kind='development' and name ~* '(wastewater|water treatment|water reclamation|sewer|substation|transmission line|pump station)'),
 'env_risk', (select json_build_object('rows',count(*),'flood',count(flood),'wildfire',count(wildfire),'heat',count(heat)) from public.app_environmental_risk),
 'env_like_tables', (select json_agg(table_schema||'.'||table_name order by table_name) from information_schema.tables where table_schema in ('public') and table_name ~* '(env|epa|facilit|coverage|echo|frs|utilit|water|subject|event)'),
 'app_projects_columns', (select json_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='app_projects'),
 'utah_zip_pages', (select count(distinct z) from public.communities c, unnest(c.zip_codes) z where c.level='zip' and c.state='UT' and z in (select zip from public.canonical_zip_registry)),
 'crz_columns', (select json_agg(column_name) from information_schema.columns where table_schema='public' and table_name='canonical_zip_registry')
) as r;
