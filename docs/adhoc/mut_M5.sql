-- M5: bypass dc_current_observation (every historical run becomes current). Rolled back.
do $mut$
declare v text; r text;
begin
  v := pg_get_viewdef('public.dc_current_observation'::regclass);
  if position('WHERE (r.id IN (' in v) = 0 then raise exception 'NEEDLE_ABSENT M5 %', left(v, 400); end if;
  execute 'create or replace view public.dc_current_observation as ' || replace(v, 'WHERE (r.id IN (', 'WHERE (true OR r.id IN (');
  select string_agg(check_no::text||'='||outcome, ',' order by check_no) into r from public.dc_step3a_selftest() where outcome not in ('PASS','INFO');
  raise exception 'MUTATION_RESULT M5_current_observation_bypassed NON_PASSING=[%]', coalesce(r, 'NONE');
end $mut$;