-- READ-ONLY, deliberately cheap (no join over app_projects's 3M rows).
-- HYPOTHESIS TO TEST: 64165's authoritative membership was computed 2026-09-04; the 5
-- records in NO membership row anywhere should be exactly the 5 created AFTER that date.
-- Then: is that staleness systemic, or one ZIP?
with s as (select * from geo.maps_zip_geography_status),
absent as (
  select p.source_key, p.created_at
    from public.app_projects p
   where p.zip='64165' and p.record_kind='development'
     and not exists (select 1 from geo.zip_authoritative_membership mm
                      where mm.source_key=p.source_key and mm.record_kind='development')
)
select 1 as ord, '64165 membership completed_at' as k,
       (select completed_at::text from s where zip='64165') as v
union all select 2, 'rows in NO membership anywhere (distinct source_key)',
       (select count(distinct source_key)::text from absent)
union all select 3, 'of those, created AFTER 64165 completed_at',
       (select count(distinct a.source_key)::text from absent a
         where a.created_at > (select completed_at from s where zip='64165'))
union all select 4, 'of those, created BEFORE it (would be a real gap)',
       (select count(distinct a.source_key)::text from absent a
         where a.created_at <= (select completed_at from s where zip='64165'))
union all select 5, 'their source_key @ created_at',
       (select coalesce(string_agg(a.source_key||' @ '||a.created_at::date, ' | ' order by a.created_at),'(none)')
          from absent a)
union all select 6, 'CONTROL app_projects 64165 dev rows, distinct source_key',
       (select count(distinct source_key)::text from public.app_projects
         where zip='64165' and record_kind='development')

-- is the staleness systemic?
union all select 10, 'CONTROL ZIPs with a geography status row',
       (select count(*)::text from s)
union all select 11, 'status breakdown',
       (select string_agg(st||' x'||n, ', ' order by n desc) from (
          select coalesce(status,'(null)') as st, count(*) as n from s group by 1) t)
union all select 12, 'completed_at min .. max (boundary_complete only)',
       (select min(completed_at)::text||'  ..  '||max(completed_at)::text from s where status='boundary_complete')
union all select 13, 'boundary_complete ZIPs by completed_at DATE',
       (select string_agg(d||' x'||n, ', ' order by d) from (
          select completed_at::date::text as d, count(*) as n from s
           where status='boundary_complete' group by 1) t)
union all select 14, 'generation_id breakdown',
       (select string_agg(coalesce(g,'(null)')||' x'||n, ', ' order by n desc) from (
          select generation_id as g, count(*) as n from s group by 1) t)
union all select 15, 'cutover flag breakdown',
       (select string_agg(coalesce(c::text,'(null)')||' x'||n, ', ' order by n desc) from (
          select cutover as c, count(*) as n from s group by 1) t)
union all select 16, 'newest membership computed_at anywhere',
       (select max(computed_at)::text from geo.zip_authoritative_membership)
order by ord;
