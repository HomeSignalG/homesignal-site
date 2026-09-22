-- READ-ONLY adhoc probe #3b (coverage-state distribution; single grouped pass). Never merge.
select json_build_object(
 'coverage_by_core_and_overlay', (select json_agg(t order by n desc) from (select coverage_state, regulatory_overlay_state, count(*) n from public.app_coverage_states group by 1,2) t),
 'coverage_view_rows', (select count(*) from public.app_coverage_states)
) as r;
