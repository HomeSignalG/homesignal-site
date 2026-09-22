-- P0 POST-MERGE PRODUCTION ACCEPTANCE — steps 4/5/6/7, ONE query, READ-ONLY.
-- No 12,722-call scan: the universe is partitioned by the producer's OWN predicate; the
-- canonical RPC is called on ~28 KEYED ZIPs only (the controls + the Utah 18).
with canon as (select zip from public.canonical_zip_registry),
branch as (
  select c.zip,
         case
           when coalesce(g.status,'') <> 'boundary_complete'
             then 'envelope:' || coalesce(g.status,'unknown')
           when x.zip is not null then 'array'
           else 'envelope:boundary_complete_not_cut_over'
         end as producer_branch
  from canon c
  left join geo.maps_zip_geography_status g on g.zip = c.zip
  left join public.app_zip_geography_cutover x on x.zip = c.zip and x.enabled
),
classified as (
  select *, case producer_branch
              when 'array' then 'complete'
              when 'envelope:not_measured' then 'not_measured'
              when 'envelope:unknown' then 'not_measured'
              else 'unavailable' end as js_outcome
  from branch
),
-- The controls, through the REAL canonical RPC.
ctl(zip, label) as (values
  ('84011','A_84011_known_unavailable'),
  ('84302','B_84302_authoritative_data'),
  ('02366','C_verified_zero'), ('02543','C_verified_zero'),
  ('03215','C_verified_zero'), ('03240','C_verified_zero')),
ctl_r as (
  select ctl.label, ctl.zip,
         public.app_projects_for_zip(ctl.zip,'development') as dev,
         public.app_projects_for_zip(ctl.zip,'facility')     as fac
  from ctl)

-- §6 NATIONAL FOUR-STATE PARTITION (re-measured, not repeated)
select '6_national' as section, producer_branch as k, js_outcome as v, count(*)::text as n from classified group by 1,2,3
union all select '6_control','canonical_zips',null,(select count(*)::text from canon)
union all select '6_control','rows_not_in_exactly_one_branch',null,(select count(*)::text from classified where producer_branch is null)
-- §6 STRUCTURAL: no refusal branch can return an array. Sampled through the REAL RPC.
union all
select '6_invariant','refusal_branches_returning_an_array', null,
       (select count(*)::text from (
          select zip from classified where producer_branch <> 'array' order by zip collate "C" limit 40) s
        where jsonb_typeof(public.app_projects_for_zip(s.zip,'development')) = 'array')
union all
select '6_invariant','refusal_sample_size_checked', null,
       (select count(*)::text from (select zip from classified where producer_branch <> 'array' order by zip collate "C" limit 40) s)

-- §4 CONTROLS
union all
select '4_control', label, zip,
       'typeof=' || jsonb_typeof(dev)
       || ' | dev_len=' || coalesce((case when jsonb_typeof(dev)='array' then jsonb_array_length(dev) end)::text,'n/a')
       || ' | status=' || coalesce(dev->>'zip_geography_status','n/a')
       || ' | fac_typeof=' || jsonb_typeof(fac)
       || ' | fac_len=' || coalesce((case when jsonb_typeof(fac)='array' then jsonb_array_length(fac) end)::text,'n/a')
from ctl_r
-- §4 the 84011 no-fallback control: the rows exist and the RPC still refuses them.
union all
select '4_control','A_84011_source_rows_that_must_NOT_leak','84011',
       (select count(*)::text from public.app_projects where zip='84011' and record_kind='development')

-- §5 UTAH CLOSURE — every UT ZIP the predicate says refuses, asked through the RPC.
union all
select '5_utah', 'ut_total_pages', null, (select count(*)::text from classified where zip between '84001' and '84791')
union all
select '5_utah', 'ut_array_branch', null, (select count(*)::text from classified where zip between '84001' and '84791' and producer_branch='array')
union all
select '5_utah', 'ut_refusing', null, (select count(*)::text from classified where zip between '84001' and '84791' and producer_branch<>'array')
union all
select '5_utah', 'ut_refusing_confirmed_object_via_RPC', null,
       (select count(*)::text from (select zip from classified where zip between '84001' and '84791' and producer_branch<>'array') s
         where jsonb_typeof(public.app_projects_for_zip(s.zip,'development'))='object'
           and (public.app_projects_for_zip(s.zip,'development')->>'unavailable')::boolean is true)
union all
select '5_utah', 'ut_refusing_zips', null,
       (select string_agg(zip,',' order by zip collate "C") from classified where zip between '84001' and '84791' and producer_branch<>'array')

-- §7 PRESERVATION
union all
select '7_preservation','app_projects_for_zip_md5',null,
       (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='app_projects_for_zip')
union all
select '7_preservation','app_authoritative_projects_for_zip_md5',null,
       (select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='app_authoritative_projects_for_zip')
union all
select '7_preservation','geo_status_rows',null,(select count(*)::text from geo.maps_zip_geography_status)
union all
select '7_preservation','cutover_enabled',null,(select count(*)::text from public.app_zip_geography_cutover where enabled)
union all
select '7_preservation','newest_3_migrations',null,
       (select string_agg(version || ' ' || coalesce(name,''), ' | ' order by version desc)
          from (select version, name from supabase_migrations.schema_migrations order by version desc limit 3) m)
order by 1,2,3;
