-- Probe: how component_scores is computed, and what identifies a water/utility notice
select json_build_object(
 'lens_values', (select json_object_agg(coalesce(lens,'NULL'), n) from (select lens, count(*) n from public.app_changes group by 1 order by 2 desc limit 20) q),
 'lens_for_water_ut', (select json_object_agg(coalesce(ac.lens,'NULL'), n) from (
    select ac.lens, count(*) n from public.app_changes ac
    where ac.source_ref in (select a.source_url from public.alerts a where a.category = 'Water districts & utilities')
    group by 1) ac),
 'category_x_lens_national', (select json_agg(row_to_json(x)) from (
    select category, lens, count(*) n from public.app_changes group by 1,2 order by 3 desc limit 12) x),
 -- does app_changes carry the alert's own topic anywhere?
 'app_changes_cols', (select string_agg(column_name,',' order by ordinal_position)
    from information_schema.columns where table_schema='public' and table_name='app_changes'),
 -- the component_scores computation, sliced out of the materializer
 'fn_len', (select length(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='app_refresh_zip'),
 'component_scores_slice', (select substring(d from greatest(1, position('component_scores' in d) - 1800) for 3200)
    from (select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
          where n.nspname='public' and p.proname='app_refresh_zip') s),
 'community_score_mentioned', (select position('community_score' in pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='app_refresh_zip')
) as result;
