-- READ-ONLY adhoc probe #4 — pick exact production control ZIPs for the Environment P0. Never merge.
select json_build_object(
 'gov_water', (select json_agg(t) from (select zip, category, title from public.app_changes
    where title in ('Public Meeting and Public Hearing') and plain_language like '%Water districts & utilities%' and zip like '843%' order by zip limit 5) t),
 'local_news_water', (select json_agg(t) from (select zip, category, title from public.app_changes
    where category='Local News' and title = 'Baltimore to begin blending river water with reservoir supply amid drought' order by zip limit 5) t),
 'facility_01001', (select json_agg(t) from (select zip, name from public.app_projects where zip='01001' and record_kind='facility' order by name limit 3) t),
 'dev_46205', (select json_agg(t) from (select zip, name, status from public.app_projects where zip='46205' and record_kind='development' and name like 'Storm Sewer Repair%' limit 2) t),
 'meta_controls', (select json_agg(t) from (select zip, data_quality from public.app_community_meta where zip in ('84302','01001','46205') order by zip) t)
) as r;
