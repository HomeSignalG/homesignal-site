-- READ-ONLY. The 117-vs-29 gap in 64165. The membership source is
-- geo.zip_authoritative_membership (zcta5, source_key, record_kind), computed from real ZCTA
-- geography; app_projects.zip is a SOURCE-STATED zip. If the target's point is outside the
-- 64165 ZCTA then the capture refusal is CORRECT and app_projects.zip is simply not a
-- geometric claim. If it is INSIDE, the membership is incomplete and that is a defect.
-- Step 1: learn the geo schema and read the status row (which also tests staleness directly).
select 1 as ord, 'geo tables' as k,
       (select string_agg(table_name, ',' order by table_name)
          from information_schema.tables where table_schema='geo') as v
union all select 2, 'geo columns carrying a geometry/geography type',
       (select coalesce(string_agg(table_name||'.'||column_name||':'||udt_name, ', ' order by table_name,column_name),'(none)')
          from information_schema.columns
         where table_schema='geo' and udt_name in ('geometry','geography'))
union all select 3, 'geo.maps_zip_geography_status columns',
       (select coalesce(string_agg(column_name, ',' order by ordinal_position),'(absent)')
          from information_schema.columns
         where table_schema='geo' and table_name='maps_zip_geography_status')
union all select 4, 'geo.zip_authoritative_membership columns',
       (select coalesce(string_agg(column_name, ',' order by ordinal_position),'(absent)')
          from information_schema.columns
         where table_schema='geo' and table_name='zip_authoritative_membership')
union all select 5, 'geo.maps_zip_geography_status ROW for 64165 (full)',
       (select coalesce((select to_jsonb(s)::text from geo.maps_zip_geography_status s where s.zip='64165'),'(no row)'))
union all select 6, 'membership rows for 64165 by record_kind',
       (select coalesce(string_agg(record_kind||' x'||n, ', ' order by record_kind),'(none)') from (
          select record_kind, count(*) as n from geo.zip_authoritative_membership
           where zcta5='64165' group by 1) t)
union all select 7, 'CONTROL total membership rows (all ZIPs)',
       (select count(*)::text from geo.zip_authoritative_membership)
union all select 8, 'CONTROL distinct zcta5 in membership',
       (select count(distinct zcta5)::text from geo.zip_authoritative_membership)
union all select 9, 'is TARGET source_key in membership for ANY zcta5?',
       (select coalesce(string_agg(zcta5||'/'||record_kind, ', '),'(absent everywhere)')
          from geo.zip_authoritative_membership
         where source_key='arcgis:kcmo-development-cases:CD-CPC-2026-00142')
union all select 10,'CONTROL a known-present sibling in membership for ANY zcta5?',
       (select coalesce(string_agg(zcta5||'/'||record_kind, ', '),'(absent)')
          from geo.zip_authoritative_membership
         where source_key='arcgis:kcmo-development-cases:CD-CPC-2026-00097')
union all select 11,'of the 88 absent-from-64165 rows, how many are in membership under a DIFFERENT zcta5',
       (select count(*)::text from public.app_projects p
         where p.zip='64165' and p.record_kind='development'
           and exists (select 1 from geo.zip_authoritative_membership mm
                        where mm.source_key=p.source_key and mm.record_kind='development'
                          and mm.zcta5 <> '64165'))
union all select 12,'…and how many are in NO membership row at all',
       (select count(*)::text from public.app_projects p
         where p.zip='64165' and p.record_kind='development'
           and not exists (select 1 from geo.zip_authoritative_membership mm
                            where mm.source_key=p.source_key and mm.record_kind='development'))
union all select 13,'which other zcta5 they landed in (top)',
       (select coalesce(string_agg(z||' x'||n, ', ' order by n desc, z),'(none)') from (
          select mm.zcta5 as z, count(*) as n
            from public.app_projects p
            join geo.zip_authoritative_membership mm
              on mm.source_key=p.source_key and mm.record_kind='development'
           where p.zip='64165' and p.record_kind='development' and mm.zcta5 <> '64165'
           group by 1 order by 2 desc limit 8) t)
order by ord;
