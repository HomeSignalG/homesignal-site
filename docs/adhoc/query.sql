select 'dc_source' k, (select json_agg(json_build_object('s',source_key,'active',active_state,'dist',distributions)) from public.dc_source)::text v
union all select 'dc_obs_by_source', (select json_object_agg(source_key, n) from (select source_key, count(*) n from public.dc_source_observation group by 1) x)::text
union all select 'dc_entities_by_class', (select json_object_agg(classification, n) from (select classification, count(*) n from public.dc_canonical_entity where superseded_by is null group by 1) x)::text
union all select 'dc_geo_by_status', (select json_object_agg(geography_status, n) from (select geography_status, count(*) n from public.dc_entity_geography group by 1) x)::text
union all select 'source_documents_by_agency', (select json_object_agg(a, n) from (select coalesce(source_agency,'?')||'|'||coalesce(source_program,'?')||'|'||coalesce(mime_type,'?') a, count(*) n from public.source_documents group by 1 order by 2 desc limit 40) x)::text
union all select 'acquisition_runs_by_program', (select json_object_agg(a, n) from (select coalesce(source_agency,'?')||'|'||coalesce(source_program,'?') a, count(*) n from public.acquisition_runs group by 1) x)::text
union all select 'official_record_by_source', (select json_object_agg(a, n) from (select source||'|'||kind a, count(*) n from public.official_record group by 1) x)::text
union all select 'dev_projects', (select json_object_agg(page_state, n) from (select page_state, count(*) n from public.development_project group by 1) x)::text
union all select 'feeds_active', (select json_object_agg(t, n) from (select target_table||'|'||coalesce(pipeline_type,'?') t, count(*) n from public.feeds where active group by 1) x)::text
union all select 'alerts_dc_terms', (select json_object_agg(t, n) from (select coalesce(pipeline_type,'?')||'|'||coalesce(category,'?') t, count(*) n from public.alerts where (coalesce(title,'')||' '||coalesce(description,'')) ~* '(data ?cent(er|re)s?|hyperscale|colocation|server farm|super-?comput|\mhpc\M|comput(e|ing) facilit)' group by 1 order by 2 desc limit 30) x)::text
union all select 'alerts_total', (select count(*)::text from public.alerts)
union all select 'meetings_dc_terms', (select count(*)::text from public.meetings where (coalesce(title,'')||' '||coalesce(agenda_summary,'')) ~* '(data ?cent(er|re)s?|hyperscale|colocation|server farm|super-?comput|\mhpc\M|comput(e|ing) facilit)')
union all select 'meetings_total', (select count(*)::text from public.meetings)
union all select 'meetings_with_agenda_summary', (select count(*)::text from public.meetings where coalesce(agenda_summary,'')<>'')
union all select 'gov_notice_alerts_with_description', (select count(*)::text from public.alerts where pipeline_type='government_notice' and coalesce(description,'')<>'')
union all select 'gov_notice_alerts_total', (select count(*)::text from public.alerts where pipeline_type='government_notice')
union all select 'alerts_dc_sample', (select json_agg(t) from (select left(title,110)||' | '||left(source_url,90) t from public.alerts where pipeline_type='government_notice' and (coalesce(title,'')||' '||coalesce(description,'')) ~* '(data ?cent(er|re)s?|hyperscale|super-?comput)' order by created_at desc limit 15) x)::text
union all select 'meetings_dc_sample', (select json_agg(t) from (select left(title,90)||' | '||left(coalesce(agenda_summary,''),80) t from public.meetings where (coalesce(title,'')||' '||coalesce(agenda_summary,'')) ~* '(data ?cent(er|re)s?|hyperscale|super-?comput)' order by created_at desc limit 15) x)::text;
