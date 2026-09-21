-- READ-ONLY. Scratch slot; never merges to main.
-- 64165 Data Center Theme draft: why the capture declined, read from the row itself.
with dc as (
  select id, zip, status, image_bucket_path,
         evidence->>'project_id'   as pid,
         evidence->>'project_name' as pname,
         evidence->'visual'        as visual
  from public.social_posts
  where content_family = 'MAPS' and status = 'draft' and zip = '64165'
),
mk as (
  select public.app_zip_projects_markers(
           p_zip => '64165', p_kind => 'development', p_authoritative => true
         ) as j
)
select 1 as ord, 'draft id'                as k, (select id::text from dc) as v
union all select 2, 'draft project_id',        (select pid from dc)
union all select 3, 'draft project_name',      (select pname from dc)
union all select 4, 'image_bucket_path',       (select coalesce(image_bucket_path,'(none)') from dc)
union all select 5, 'visual.state',            (select visual->>'state' from dc)
union all select 6, 'visual.reason (VERBATIM)',(select visual->>'reason' from dc)
union all select 7, 'visual.attempts',         (select visual->>'attempts' from dc)
union all select 8, 'visual.retry_after',      (select visual->>'retry_after' from dc)
union all select 9, 'project record_kind',     (select p.record_kind from public.app_projects p where p.id::text = (select pid from dc))
union all select 10,'project source_key',      (select p.source_key from public.app_projects p where p.id::text = (select pid from dc))
union all select 11,'project lat,lng',         (select p.lat::text||','||p.lng::text from public.app_projects p where p.id::text = (select pid from dc))
union all select 12,'project record_url null?',(select (p.record_url is null)::text from public.app_projects p where p.id::text = (select pid from dc))
union all select 13,'RPC status for 64165',    (select j->>'status' from mk)
union all select 14,'RPC marker count',        (select jsonb_array_length(coalesce(j->'markers','[]'::jsonb))::text from mk)
union all select 15,'project IS in RPC markers?',
  (select exists(
     select 1 from mk, jsonb_array_elements(coalesce(mk.j->'markers','[]'::jsonb)) m
     where m->>'zip_project_ref' = (select p.source_key from public.app_projects p where p.id::text=(select pid from dc))
   )::text)
union all select 16,'CONTROL: markers keys present on first marker',
  (select string_agg(kk, ',' order by kk) from mk, jsonb_array_elements(coalesce(mk.j->'markers','[]'::jsonb)) m,
        jsonb_object_keys(m) kk where m = (mk.j->'markers'->0))
order by ord;
