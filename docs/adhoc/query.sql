-- P0 verification, step 2 of 2. READ-ONLY. No RPC scan: the universe is partitioned by the
-- producer's OWN predicate, read verbatim from pg_get_functiondef in step 1 (md5
-- eec5777aac02228350dd437d4e37ccba). The RPC is called on SIX keyed ZIPs only — the controls.
with canon as (select zip from public.canonical_zip_registry),
branch as (
  select c.zip,
         g.status                                     as geo_status,
         (x.zip is not null)                          as cut_over,
         case
           when coalesce(g.status,'') <> 'boundary_complete'
             then 'envelope:' || coalesce(g.status, 'unknown')
           when x.zip is not null then 'array'
           else 'envelope:boundary_complete_not_cut_over'
         end                                          as producer_branch
  from canon c
  left join geo.maps_zip_geography_status g on g.zip = c.zip
  left join public.app_zip_geography_cutover x on x.zip = c.zip and x.enabled
),
-- How lib/zip-authoritative.js::zipAuthOutcome classifies each producer answer. The JS
-- allow-list is EXACTLY {not_measured, unknown}; everything else that is not a bare array
-- falls to 'unavailable'. Reproduced here so the two can be compared, never to replace it.
classified as (
  select *,
         case producer_branch
           when 'array' then 'complete'
           when 'envelope:not_measured' then 'not_measured'
           when 'envelope:unknown' then 'not_measured'
           else 'unavailable'
         end as js_outcome
  from branch
)
select 'A_national_partition' as section, producer_branch, js_outcome, count(*) as zips,
       null::text as zip, null::text as detail
from classified group by 1,2,3

union all
select 'B_control_totals', 'canonical_zips', null, (select count(*) from canon), null, null
union all
select 'B_control_totals', 'rows_not_in_exactly_one_branch', null,
       (select count(*) from classified where producer_branch is null), null, null
union all
select 'B_control_totals', 'geo_status_rows_total', null,
       (select count(*) from geo.maps_zip_geography_status), null, null
union all
select 'B_control_totals', 'cutover_enabled_total', null,
       (select count(*) from public.app_zip_geography_cutover where enabled), null, null

union all
select 'C_utah_partition', producer_branch, js_outcome, count(*), null, null
from classified where zip like '84%' or zip like '843%' group by 1,2,3

union all
select 'D_utah_refused_zips', 'list', null, count(*),
       string_agg(zip, ',' order by zip collate "C"), null
from classified where zip between '84001' and '84791' and producer_branch <> 'array'

union all
-- E: the SIX controls, through the REAL RPC (six calls, not 12,722).
select 'E_rpc_control', z.label, null, null, z.zip,
       left(public.app_projects_for_zip(z.zip, 'development')::text, 120)
       || ' || jsonb_typeof=' || jsonb_typeof(public.app_projects_for_zip(z.zip, 'development'))
       || ' || arrlen=' || coalesce((case when jsonb_typeof(public.app_projects_for_zip(z.zip,'development'))='array'
              then jsonb_array_length(public.app_projects_for_zip(z.zip,'development')) end)::text, 'n/a')
from (values
  ('84011', 'utah_refused'),
  ('84302', 'utah_complete_with_rows'),
  ('84001', 'utah_sample'),
  ((select zip from classified where producer_branch='array' order by zip collate "C" limit 1), 'first_complete_national'),
  ((select zip from classified where producer_branch='envelope:boundary_complete_not_cut_over' order by zip collate "C" limit 1), 'not_cut_over_sample'),
  ((select zip from classified where producer_branch='envelope:unknown' order by zip collate "C" limit 1), 'unknown_sample')
) as z(zip, label)
where z.zip is not null

union all
-- F: a MEASURED ZERO must exist for the absence sentence to be reachable at all. Counted
-- over the cut-over population only (the one the array branch serves), via app_projects —
-- the same rows app_authoritative_projects_for_zip draws on.
select 'F_measured_zero_exists', 'complete_zips_with_zero_development_rows', null, count(*), null, null
from classified cl
where cl.producer_branch = 'array'
  and not exists (select 1 from public.app_projects p
                   where p.zip = cl.zip and p.record_kind = 'development')

order by 1, 2;
