select jsonb_pretty(jsonb_build_object(
 'changes', (select jsonb_agg(x) from (select category, count(*) n, max(created_at) newest, (array_agg(left(title,60) order by created_at desc))[1:3] sample from public.app_changes where zip='97149' group by category) x),
 'dev', (select jsonb_build_object('refreshed_at',refreshed_at,'area',(select count(*) from jsonb_array_elements(sites) s where s->>'scope'='area'),'plng',(select count(*) from jsonb_array_elements(sites) s where s::text like '%PLNG%')) from public.development_reports where zip='97149'),
 'proj',(select jsonb_agg(x) from (select record_kind, count(*) n from public.app_projects where zip='97149' group by 1) x)
)) r
