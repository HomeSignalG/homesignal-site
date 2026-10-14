with dz as (
  select distinct unnest(zip_codes) zip from public.communities where county ilike 'Denton%' and state in ('TX','Texas')
)
select jsonb_build_object(
 'denton_zips', (select count(*) from dz),
 'ap_by_reg', (select coalesce(jsonb_agg(x), '[]') from (
     select a.registry_id, count(*) n, count(distinct a.zip) zips, min(a.created_at) min_created, max(a.created_at) max_created
       from public.app_projects a where a.zip in (select zip from dz) and a.record_kind='development' and (a.registry_id like 'denton-%')
      group by 1 order by 1) x),
 'dev_reports_denton_sources', (select count(*) from public.development_reports d where d.zip in (select zip from dz) and d.sites::text like '%denton-city-projects%'),
 'dev_reports_denton_total', (select count(*) from public.development_reports d where d.zip in (select zip from dz))
) as result;
