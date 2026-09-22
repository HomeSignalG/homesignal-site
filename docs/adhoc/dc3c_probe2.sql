-- read-only: resident access grants + cost/shape of reusing the shipped national_dc_for_zip as the reachability authority
with adm as (select s.zip from geo.maps_zip_geography_status s join public.development_reports d on d.zip = s.zip where s.status = 'boundary_complete'),
hits as (select distinct r.source_key from adm cross join lateral public.national_dc_for_zip(adm.zip, 5) r),
trunc as (select count(*) n from adm cross join lateral (select bool_or(has_more) hm from public.national_dc_for_zip(adm.zip, 5)) x where x.hm)
select json_build_object(
  't0', clock_timestamp()::text,
  'admitted_zips', (select count(*) from adm),
  'reachable_via_rpc', (select count(*) from hits),
  'reachable_fp', (select md5(string_agg(source_key, ',' order by source_key collate "C")) from hits),
  'zips_truncated', (select n from trunc),
  'eligible_not_reached', (select count(*) from public.national_dc_records n where n.map_eligible and n.source_key not in (select source_key from hits)),
  'reached_but_ineligible', (select count(*) from hits h join public.national_dc_records n using (source_key) where not n.map_eligible),
  'grants', (select json_agg(table_name||':'||grantee||':'||privilege_type order by 1) from information_schema.role_table_grants where table_schema='public' and table_name in ('app_projects','national_dc_records','development_reports','social_posts') and grantee in ('anon','authenticated') and privilege_type='SELECT'),
  'rls', (select json_agg(relname||'='||relrowsecurity order by relname) from pg_class where relname in ('app_projects','national_dc_records','development_reports','social_posts') and relnamespace='public'::regnamespace),
  'policies', (select json_agg(tablename||':'||policyname||':'||array_to_string(roles,',')||':'||cmd||':'||coalesce(qual,'') order by 1) from pg_policies where schemaname='public' and tablename in ('app_projects','national_dc_records','development_reports')),
  't1', clock_timestamp()::text
) facts;
