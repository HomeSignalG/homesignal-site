-- P0 verification, control 3: a LEGITIMATE MEASURED ZERO through the real RPC.
-- Keyed to 8 candidate ZIPs, never a scan. READ-ONLY.
with cand as (
  select c.zip
  from public.canonical_zip_registry c
  join geo.maps_zip_geography_status g on g.zip = c.zip and g.status = 'boundary_complete'
  join public.app_zip_geography_cutover x on x.zip = c.zip and x.enabled
  where not exists (select 1 from public.app_projects p
                     where p.zip = c.zip and p.record_kind = 'development')
  order by c.zip collate "C"
  limit 8
)
select zip,
       jsonb_typeof(public.app_projects_for_zip(zip,'development'))  as typeof,
       case when jsonb_typeof(public.app_projects_for_zip(zip,'development'))='array'
            then jsonb_array_length(public.app_projects_for_zip(zip,'development')) end as arrlen,
       left(public.app_projects_for_zip(zip,'development')::text, 60) as head
from cand order by zip collate "C";
