select jsonb_pretty(jsonb_build_object(
 'communities_with_zip', (select jsonb_agg(jsonb_build_object('id',id,'name',name,'level',level,'parent',parent_id,'n_zips',cardinality(zip_codes),'has_97149',zip_codes @> array['97149'])) from public.communities where zip_codes @> array['97149']),
 'county_root_alerts', (select jsonb_agg(jsonb_build_object('category',category,'pipeline',pipeline_type,'n',n,'min_pub',mn,'max_pub',mx,'max_created',mc)) from (select category,pipeline_type,count(*) n,min(published_at) mn,max(published_at) mx,max(created_at) mc from public.alerts where community_id='5ec7e696-93fa-4a7c-81b0-50f8d2828353' and created_at > '2026-11-16' group by 1,2) s),
 'dev_report', (select jsonb_build_object('refreshed_at',refreshed_at,'facilities_refreshed_at',facilities_refreshed_at,'last_attempt',last_refresh_attempt_at,'n_sites',jsonb_array_length(sites),'area_sites',(select count(*) from jsonb_array_elements(sites) e where e->>'scope'='area'),'plng_sites',(select count(*) from jsonb_array_elements(sites) e where e->>'label' ilike '%PLNG%' or e->>'url' ilike '%PLNG%'),'counts',counts) from public.development_reports where zip='97149'),
 'dev_report_area_labels', (select jsonb_agg(e->>'label') from (select e from public.development_reports d, jsonb_array_elements(d.sites) e where d.zip='97149' and e->>'scope'='area' limit 40) x),
 'app_changes', (select jsonb_agg(jsonb_build_object('category',category,'n',n,'newest',mx)) from (select category,count(*) n,max(created_at) mx from public.app_changes where zip='97149' group by 1) s),
 'app_changes_plng', (select count(*) from public.app_changes where zip='97149' and (title ilike '%PLNG%' or source_ref ilike '%PLNG%')),
 'app_projects_97149', (select jsonb_agg(jsonb_build_object('kind',record_kind,'n',n)) from (select record_kind,count(*) n from public.app_projects where zip='97149' group by 1) s),
 'meta', (select to_jsonb(m) - 'component_scores' from public.app_community_meta m where zip='97149'),
 'refresh_failures', (select count(*) from public.app_refresh_failures where zip='97149'),
 'now', now()
));
