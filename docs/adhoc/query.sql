-- READ-ONLY. Two candidate causes for 64165's DC project being absent from an otherwise
-- complete authoritative set, and they have OPPOSITE answers:
--   (a) the point is genuinely outside the 64165 ZCTA  -> the refusal is CORRECT, and
--       app_projects.zip (a source-stated ZIP) is the thing that is wrong;
--   (b) the membership set is STALE, computed before this record was ingested -> the
--       refusal is a timing artifact and clears on recomputation.
-- Distinguisher: this record's ingest timestamps against the 13 included siblings', plus
-- what the RPC actually reads.
with tgt as (select 'arcgis:kcmo-development-cases:CD-CPC-2026-00142'::text as sk)
select 1 as ord, 'RPC definition (names the membership source)' as k,
       (select pg_get_functiondef(p.oid)
          from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname='app_zip_projects_markers' limit 1) as v

union all select 10, 'TARGET created_at',
       (select p.created_at::text from public.app_projects p, tgt where p.source_key=tgt.sk)
union all select 11, 'TARGET last_seen_at',
       (select coalesce(p.last_seen_at::text,'(null)') from public.app_projects p, tgt where p.source_key=tgt.sk)
union all select 12, 'TARGET submitted_at',
       (select coalesce(p.submitted_at::text,'(null)') from public.app_projects p, tgt where p.source_key=tgt.sk)
union all select 13, 'TARGET lat,lng',
       (select p.lat::text||','||p.lng::text from public.app_projects p, tgt where p.source_key=tgt.sk)

-- the comparison cohort: every kcmo-development-cases record app_projects places in 64165
union all select 20, 'kcmo rows app_projects places in 64165',
       (select count(*)::text from public.app_projects p
         where p.zip='64165' and p.source_key like 'arcgis:kcmo-development-cases:%'
           and p.record_kind='development')
union all select 21, 'their created_at min .. max',
       (select min(p.created_at)::text||'  ..  '||max(p.created_at)::text from public.app_projects p
         where p.zip='64165' and p.source_key like 'arcgis:kcmo-development-cases:%'
           and p.record_kind='development')
union all select 22, 'their last_seen_at min .. max',
       (select coalesce(min(p.last_seen_at)::text,'(null)')||'  ..  '||coalesce(max(p.last_seen_at)::text,'(null)')
          from public.app_projects p
         where p.zip='64165' and p.source_key like 'arcgis:kcmo-development-cases:%'
           and p.record_kind='development')
union all select 23, 'CONTROL is TARGET the NEWEST of that cohort?',
       (select (p.created_at = (select max(q.created_at) from public.app_projects q
                                 where q.zip='64165' and q.source_key like 'arcgis:kcmo-development-cases:%'
                                   and q.record_kind='development'))::text
          from public.app_projects p, tgt where p.source_key=tgt.sk)
union all select 24, 'app_projects development rows in 64165 (all sources)',
       (select count(*)::text from public.app_projects p
         where p.zip='64165' and p.record_kind='development')
union all select 25, 'ARITHMETIC: app_projects 64165 dev count vs RPC projects count 29',
       (select (count(*))::text||' vs 29' from public.app_projects p
         where p.zip='64165' and p.record_kind='development')
union all select 26, 'the 64165 dev rows app_projects has that the RPC does NOT (count)',
       (select count(*)::text from public.app_projects p
         where p.zip='64165' and p.record_kind='development'
           and p.source_key not in (
             select e->>'project_ref' from
               (select public.app_zip_projects_markers(p_zip=>'64165',p_kind=>'development',p_authoritative=>true) as j) m,
               jsonb_array_elements(coalesce(m.j->'projects','[]'::jsonb)) e))
union all select 27, 'those source_keys + created_at (the disagreement set)',
       (select coalesce(string_agg(p.source_key||' @ '||p.created_at::date, ' | ' order by p.created_at),'(none)')
          from public.app_projects p
         where p.zip='64165' and p.record_kind='development'
           and p.source_key not in (
             select e->>'project_ref' from
               (select public.app_zip_projects_markers(p_zip=>'64165',p_kind=>'development',p_authoritative=>true) as j) m,
               jsonb_array_elements(coalesce(m.j->'projects','[]'::jsonb)) e))
order by ord;
