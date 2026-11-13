with dc as materialized (
  select registry_id, record_kind, type, type_raw, name, scope_text, status, zip, source_key,
         (coalesce(name,'')||' '||coalesce(type_raw,'')||' '||coalesce(scope_text,'')) txt
  from public.app_projects
  where record_kind='development'
    and (coalesce(name,'')||' '||coalesce(type_raw,'')||' '||coalesce(scope_text,'')) ~* '(data ?cent(er|re)s?|hyperscale|colocation|server farm|super-?comput|\mhpc\M|comput(e|ing) facilit)'
)
select 'dev_rows_dc_terms' k, count(*)::text v from dc
union all select 'dev_keys_dc_terms', count(distinct source_key)::text from dc
union all select 'dev_zips_dc_terms', count(distinct zip)::text from dc
union all select 'by_type', (select json_object_agg(t,n) from (select coalesce(type,'?') t, count(distinct source_key) n from dc group by 1) x)::text
union all select 'by_registry_top', (select json_object_agg(t,n) from (select coalesce(registry_id,'?') t, count(distinct source_key) n from dc group by 1 order by 2 desc limit 25) x)::text
union all select 'term_only_in_scope_text', (select count(distinct source_key)::text from dc where (coalesce(name,'')||' '||coalesce(type_raw,'')) !~* '(data ?cent(er|re)s?|hyperscale|colocation|server farm|super-?comput|\mhpc\M|comput(e|ing) facilit)')
union all select 'conversion_alteration_with_dc', (select count(distinct source_key)::text from dc where txt ~* '(convers|convert|change of (use|occupancy)|tenant improvement|\mTI\M|alteration|remodel|interior|fit-?out|retrofit)')
union all select 'amend_expand_with_dc', (select count(distinct source_key)::text from dc where txt ~* '(amend|supplement|expan|addition|phase|transfer)')
union all select 'sample_conversion', (select json_agg(t) from (select distinct left(registry_id,35)||' | '||coalesce(type,'?')||' | '||left(txt,140) t from dc where txt ~* '(convers|convert|change of (use|occupancy)|tenant improvement|alteration|fit-?out)' limit 12) x)::text
union all select 'dev_rows_total', (select count(*)::text from public.app_projects where record_kind='development')
union all select 'dev_rows_with_scope_text', (select count(*)::text from public.app_projects where record_kind='development' and coalesce(scope_text,'')<>'')
union all select 'source_documents_n', (select count(*)::text from public.source_documents)
union all select 'acquisition_runs_n', (select count(*)::text from public.acquisition_runs);
