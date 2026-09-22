do $g$ declare r text; n int; begin
  select count(*) into n from public.dc_step3a_selftest() where outcome='PASS';
  select string_agg(check_no::text||'='||outcome, ',' order by check_no) into r from public.dc_step3a_selftest() where outcome not in ('PASS','INFO');
  raise exception 'GREEN 3A PASS=% NON_PASSING=[%]', n, coalesce(r,'NONE');
end $g$;