-- READ-ONLY. Scratch slot; never merges to main.
-- (a) app_projects + RPC schema, read rather than assumed (this query already cost one
--     42703 by taking record_url from prose about the emitted site object).
-- (b) The Data Center Theme draft partition, so the record correction carries its receipt.
-- (c) 64165: the capture decline, read verbatim off the row.
with dc as (
  select id, zip, status, image_bucket_path,
         evidence->>'project_id'   as pid,
         evidence->>'project_name' as pname,
         evidence->'visual'        as visual
  from public.social_posts
  where content_family = 'MAPS' and status = 'draft' and zip = '64165'
),
maps as (
  select * from public.social_posts where content_family = 'MAPS' and status = 'draft'
),
mk as (
  select public.app_zip_projects_markers(
           p_zip => '64165', p_kind => 'development', p_authoritative => true
         ) as j
)
select 1 as ord, 'SCHEMA app_projects columns' as k,
       (select string_agg(column_name, ',' order by ordinal_position)
          from information_schema.columns
         where table_schema='public' and table_name='app_projects') as v
union all select 2, 'SCHEMA app_zip_projects_markers signature',
       (select string_agg(pg_get_function_identity_arguments(p.oid), ' | ')
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='app_zip_projects_markers')

-- (b) the partition: every MAPS draft accounted for, DC split by whether it is project-backed
union all select 10, 'CONTROL MAPS drafts total', (select count(*)::text from maps)
union all select 11, 'DC theme drafts',
       (select count(*) filter (where evidence->>'theme'='datacenter')::text from maps)
union all select 12, 'DC with an image',
       (select count(*) filter (where evidence->>'theme'='datacenter'
                                  and coalesce(image_bucket_path,'') <> '')::text from maps)
union all select 13, 'DC no image, ABSENCE post (no evidence.project_id) = EXEMPT',
       (select count(*) filter (where evidence->>'theme'='datacenter'
                                  and coalesce(image_bucket_path,'') = ''
                                  and evidence->>'project_id' is null)::text from maps)
union all select 14, 'DC no image, PROJECT-BACKED = genuinely blocked',
       (select count(*) filter (where evidence->>'theme'='datacenter'
                                  and coalesce(image_bucket_path,'') = ''
                                  and evidence->>'project_id' is not null)::text from maps)
union all select 15, 'DC project-backed blocked: which ZIPs',
       (select coalesce(string_agg(distinct zip, ',' order by zip),'(none)') from maps
         where evidence->>'theme'='datacenter' and coalesce(image_bucket_path,'')=''
           and evidence->>'project_id' is not null)
union all select 16, 'DC no-image visual states',
       (select coalesce(string_agg(s, ', '),'(none)') from (
          select coalesce(evidence->'visual'->>'state','(no stamp)')||' x'||count(*) as s
            from maps where evidence->>'theme'='datacenter' and coalesce(image_bucket_path,'')=''
           group by 1 order by 1) t)

-- (c) 64165
union all select 20, '64165 draft id',            (select id::text from dc)
union all select 21, '64165 project_id',          (select coalesce(pid,'(null)') from dc)
union all select 22, '64165 project_name',        (select coalesce(pname,'(null)') from dc)
union all select 23, '64165 image_bucket_path',   (select coalesce(nullif(image_bucket_path,''),'(none)') from dc)
union all select 24, '64165 visual.state',        (select coalesce(visual->>'state','(no stamp)') from dc)
union all select 25, '64165 visual.reason VERBATIM', (select coalesce(visual->>'reason','(none)') from dc)
union all select 26, '64165 visual FULL jsonb',   (select coalesce(visual::text,'(null)') from dc)
union all select 30, '64165 project record_kind', (select p.record_kind from public.app_projects p where p.id::text=(select pid from dc))
union all select 31, '64165 project source_key',  (select p.source_key from public.app_projects p where p.id::text=(select pid from dc))
union all select 32, '64165 project lat,lng',     (select coalesce(p.lat::text,'null')||','||coalesce(p.lng::text,'null') from public.app_projects p where p.id::text=(select pid from dc))
union all select 33, '64165 RPC status',          (select coalesce(j->>'status','(null)') from mk)
union all select 34, '64165 RPC marker count',    (select jsonb_array_length(coalesce(j->'markers','[]'::jsonb))::text from mk)
union all select 35, '64165 project IS in RPC markers?',
       (select exists(select 1 from mk, jsonb_array_elements(coalesce(mk.j->'markers','[]'::jsonb)) m
                       where m->>'zip_project_ref' = (select p.source_key from public.app_projects p
                                                       where p.id::text=(select pid from dc)))::text)
union all select 36, 'CONTROL keys on RPC marker[0]',
       (select coalesce(string_agg(kk, ',' order by kk),'(no markers)')
          from mk, jsonb_object_keys(coalesce(mk.j->'markers'->0,'{}'::jsonb)) kk)
order by ord;
