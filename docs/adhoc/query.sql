-- READ-ONLY, cheap. The capture-policy doc records "absence posts (unaffected) | 2" measured
-- 2026-09-21; I now measure 18. Rule #0a: name the cause, do not absorb the delta.
with m as (select * from public.social_posts where content_family='MAPS' and status='draft'),
dc as (select * from m where evidence->>'theme'='datacenter')
select 1 as ord, 'DC drafts by created_at DATE, absence vs project-backed' as k,
       (select string_agg(d||': absence '||a||' / project '||pb, '  |  ' order by d) from (
          select created_at::date::text as d,
                 count(*) filter (where evidence->>'project_id' is null)     as a,
                 count(*) filter (where evidence->>'project_id' is not null) as pb
            from dc group by 1) t) as v
union all select 2, 'DC absence posts created_at min .. max',
       (select min(created_at)::text||'  ..  '||max(created_at)::text from dc
         where evidence->>'project_id' is null)
union all select 3, 'DC project-backed created_at min .. max',
       (select min(created_at)::text||'  ..  '||max(created_at)::text from dc
         where evidence->>'project_id' is not null)
union all select 4, 'DC absence posts created TODAY (2026-09-21)',
       (select count(*)::text from dc where evidence->>'project_id' is null
          and created_at::date = date '2026-09-21')
union all select 5, 'DC absence posts distinct ZIPs',
       (select count(distinct zip)::text from dc where evidence->>'project_id' is null)
union all select 6, 'CONTROL DC totals absence/project-backed',
       (select count(*) filter (where evidence->>'project_id' is null)::text||' / '||
               count(*) filter (where evidence->>'project_id' is not null)::text from dc)
union all select 7, 'CONTROL do absence posts carry evidence.none_found or similar key set',
       (select coalesce(string_agg(kk, ',' order by kk),'(none)')
          from (select jsonb_object_keys(evidence) kk from dc
                 where evidence->>'project_id' is null limit 40) t)
union all select 8, 'CONTROL all MAPS drafts by created_at DATE',
       (select string_agg(d||' x'||n, ', ' order by d) from (
          select created_at::date::text as d, count(*) as n from m group by 1) t)
order by ord;
