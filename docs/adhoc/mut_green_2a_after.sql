do $g$ declare r text; n int; begin
  select count(*) into n from public.dc_step2a_selftest() where passed;
  select string_agg(split_part(check_name,' ',1), ',' order by check_name collate "C") into r from public.dc_step2a_selftest() where not passed;
  raise exception 'GREEN 2A PASS=% NON_PASSING=[%]', n, coalesce(r,'NONE');
end $g$;