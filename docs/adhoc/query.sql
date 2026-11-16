select jsonb_pretty(jsonb_build_object(
 'by_kind',(select jsonb_agg(x) from (select left(title,28) t, count(*) n from public.app_changes where zip='97149' group by 1 order by 2 desc limit 12) x),
 'plng',(select count(*) from public.app_changes where zip='97149' and (title ilike '%PLNG%' or title ilike '%land use%')),
 'alerts_planning_shape',(select jsonb_agg(x) from (select left(title,70) t, left(source_url,80) u, published_at::date d from public.alerts where community_id='5ec7e696-93fa-4a7c-81b0-50f8d2828353' and category='Planning, zoning & development' order by published_at desc limit 4) x)
)) r
