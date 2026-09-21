-- READ-ONLY. ONE call to app_zip_projects_markers, forced by MATERIALIZED: the previous
-- version referenced the CTE four times, Postgres inlined it, and the RPC ran four times
-- (85s before I cancelled it). Question: is 64165's DC project absent from the ZIP's
-- authoritative MEMBERSHIP (a geography fact), or present but dropped by the shipped site
-- builder (a record-completeness fact)? zipAuthSiteFromMarker drops a marker when it has no
-- matching projects[] entry by project_ref, when lat/lng are not finite, or on the
-- residential gate. record_url comes from projects[].source_ref.
with mk as materialized (
  select public.app_zip_projects_markers(
           p_zip => '64165', p_kind => 'development', p_authoritative => true
         ) as j
),
tgt as (select 'arcgis:kcmo-development-cases:CD-CPC-2026-00142'::text as sk),
pr as (select e as p from mk, jsonb_array_elements(coalesce(mk.j->'projects','[]'::jsonb)) e),
mr as (select e as m from mk, jsonb_array_elements(coalesce(mk.j->'markers','[]'::jsonb))  e)
select 1 as ord, 'RPC status' as k, (select coalesce(j->>'status','(null)') from mk) as v
union all select 2, 'RPC mode',            (select coalesce(j->>'mode','(null)') from mk)
union all select 3, 'projects is null?',   (select (j->'projects' = 'null'::jsonb or j->'projects' is null)::text from mk)
union all select 4, 'markers  is null?',   (select (j->'markers'  = 'null'::jsonb or j->'markers'  is null)::text from mk)
union all select 5, 'projects count',      (select jsonb_array_length(coalesce(j->'projects','[]'::jsonb))::text from mk)
union all select 6, 'markers count',       (select jsonb_array_length(coalesce(j->'markers','[]'::jsonb))::text from mk)

-- THE DECISIVE PAIR
union all select 10, 'TARGET in projects[].project_ref?',
       (select exists(select 1 from pr, tgt where pr.p->>'project_ref' = tgt.sk)::text)
union all select 11, 'TARGET in markers[].project_ref?',
       (select exists(select 1 from mr, tgt where mr.m->>'project_ref' = tgt.sk)::text)

-- if present in projects, what would the builder do with it
union all select 12, 'TARGET projects[] entry (full)',
       (select coalesce((select pr.p::text from pr, tgt where pr.p->>'project_ref'=tgt.sk limit 1),'(absent)'))
union all select 13, 'TARGET marker entry (full)',
       (select coalesce((select mr.m::text from mr, tgt where mr.m->>'project_ref'=tgt.sk limit 1),'(absent)'))

-- CONTROLS: prove the field names are right and the zero is not a wrong-key zero
union all select 20, 'CONTROL distinct project_ref keys on projects[0]',
       (select coalesce(string_agg(kk, ',' order by kk),'(no projects)')
          from mk, jsonb_object_keys(coalesce(mk.j->'projects'->0,'{}'::jsonb)) kk)
union all select 21, 'CONTROL distinct keys on markers[0]',
       (select coalesce(string_agg(kk, ',' order by kk),'(no markers)')
          from mk, jsonb_object_keys(coalesce(mk.j->'markers'->0,'{}'::jsonb)) kk)
union all select 22, 'CONTROL 3 sample project_refs actually present',
       (select coalesce(string_agg(x, ' | '),'(none)') from
          (select pr.p->>'project_ref' as x from pr limit 3) t)
union all select 23, 'CONTROL projects[] with NULL source_ref (would be dropped)',
       (select count(*) filter (where pr.p->>'source_ref' is null)::text from pr)
union all select 24, 'CONTROL kcmo-development-cases refs in this ZIP',
       (select count(*) filter (where pr.p->>'project_ref' like 'arcgis:kcmo-development-cases:%')::text from pr)

-- what app_projects itself says about this record's ZIP, vs the authoritative membership
union all select 30, 'app_projects.zip for TARGET',
       (select coalesce(string_agg(distinct p.zip, ','),'(no row)') from public.app_projects p, tgt
         where p.source_key = tgt.sk)
union all select 31, 'app_projects rows with this source_key',
       (select count(*)::text from public.app_projects p, tgt where p.source_key = tgt.sk)
union all select 32, 'app_projects.source_ref null for TARGET?',
       (select coalesce(string_agg((p.source_ref is null)::text, ','),'(no row)')
          from public.app_projects p, tgt where p.source_key = tgt.sk)
union all select 33, 'app_projects.type / status for TARGET',
       (select coalesce(string_agg(coalesce(p.type,'(null)')||' / '||coalesce(p.status,'(null)'), ','),'(no row)')
          from public.app_projects p, tgt where p.source_key = tgt.sk)
order by ord;
