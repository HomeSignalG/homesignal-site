-- READ-ONLY, deliberately CHEAP. No app_zip_projects_markers call: the previous version
-- called that RPC and ran >5.5 min before being cancelled, which under this repo's §5 rule
-- ("these are not free reads") is not a query to leave open. The stored visual.reason
-- already records WHICH branch declined, so the RPC is not needed to read the diagnosis.
with maps as (
  select * from public.social_posts where content_family = 'MAPS' and status = 'draft'
),
dc as (
  select id, zip, image_bucket_path,
         evidence->>'project_id' as pid, evidence->>'project_name' as pname,
         evidence->'visual' as visual
  from maps where zip = '64165' and evidence->>'theme' = 'datacenter'
)
select 1 as ord, 'SCHEMA app_projects columns' as k,
       (select string_agg(column_name, ',' order by ordinal_position)
          from information_schema.columns
         where table_schema='public' and table_name='app_projects') as v
union all select 2, 'SCHEMA app_zip_projects_markers signature',
       (select coalesce(string_agg(pg_get_function_identity_arguments(p.oid), ' | '),'(absent)')
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='app_zip_projects_markers')

union all select 10, 'CONTROL MAPS drafts total', (select count(*)::text from maps)
union all select 11, 'DC theme drafts',
       (select count(*) filter (where evidence->>'theme'='datacenter')::text from maps)
union all select 12, 'DC with an image',
       (select count(*) filter (where evidence->>'theme'='datacenter'
                                  and coalesce(image_bucket_path,'') <> '')::text from maps)
union all select 13, 'DC no image, ABSENCE post (no evidence.project_id)',
       (select count(*) filter (where evidence->>'theme'='datacenter'
                                  and coalesce(image_bucket_path,'') = ''
                                  and evidence->>'project_id' is null)::text from maps)
union all select 14, 'DC no image, PROJECT-BACKED',
       (select count(*) filter (where evidence->>'theme'='datacenter'
                                  and coalesce(image_bucket_path,'') = ''
                                  and evidence->>'project_id' is not null)::text from maps)
union all select 15, 'DC project-backed no-image ZIPs',
       (select coalesce(string_agg(zip, ',' order by zip),'(none)') from maps
         where evidence->>'theme'='datacenter' and coalesce(image_bucket_path,'')=''
           and evidence->>'project_id' is not null)
union all select 16, 'DC no-image visual states',
       (select coalesce(string_agg(st||' x'||n, ', ' order by st),'(none)') from (
          select coalesce(evidence->'visual'->>'state','(no stamp)') as st, count(*) as n
            from maps where evidence->>'theme'='datacenter' and coalesce(image_bucket_path,'')=''
           group by 1) t)
union all select 17, 'DC WITH image: visual states (recapture cohort)',
       (select coalesce(string_agg(st||' x'||n, ', ' order by st),'(none)') from (
          select coalesce(evidence->'visual'->>'state','(no stamp)') as st, count(*) as n
            from maps where evidence->>'theme'='datacenter' and coalesce(image_bucket_path,'')<>''
           group by 1) t)
union all select 18, 'DC WITH image: how many carry capture_policy',
       (select count(*) filter (where evidence->'visual'->'capture_policy' is not null)::text
          from maps where evidence->>'theme'='datacenter' and coalesce(image_bucket_path,'')<>'')
union all select 19, 'CONTROL non-DC MAPS drafts',
       (select count(*) filter (where coalesce(evidence->>'theme','') <> 'datacenter')::text from maps)
union all select 20, 'CONTROL MAPS rows NOT draft (must be 0 to claim draft-only)',
       (select count(*)::text from public.social_posts
         where content_family='MAPS' and status <> 'draft')

union all select 30, '64165 row count',           (select count(*)::text from dc)
union all select 31, '64165 project_id',          (select coalesce(pid,'(null)') from dc)
union all select 32, '64165 project_name',        (select coalesce(pname,'(null)') from dc)
union all select 33, '64165 image_bucket_path',   (select coalesce(nullif(image_bucket_path,''),'(none)') from dc)
union all select 34, '64165 visual FULL jsonb',   (select coalesce(visual::text,'(null)') from dc)
union all select 35, '64165 project record_kind', (select coalesce(p.record_kind,'(no row)') from public.app_projects p where p.id::text=(select pid from dc))
union all select 36, '64165 project source_key',  (select coalesce(p.source_key,'(no row)') from public.app_projects p where p.id::text=(select pid from dc))
union all select 37, '64165 project lat,lng',     (select coalesce(p.lat::text,'null')||','||coalesce(p.lng::text,'null') from public.app_projects p where p.id::text=(select pid from dc))
order by ord;
