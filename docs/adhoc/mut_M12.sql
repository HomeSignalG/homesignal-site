-- M12: evidence immutability weakened (the row guard dropped). Rolled back.
do $mut$
declare r text;
begin
  if not exists (select 1 from pg_trigger where tgname = 'dc_source_observation_guard_trg') then raise exception 'NEEDLE_ABSENT M12'; end if;
  drop trigger dc_source_observation_guard_trg on public.dc_source_observation;
  select string_agg(split_part(check_name,' ',1), ',' order by check_name collate "C") into r from public.dc_step2a_selftest() where not passed;
  raise exception 'MUTATION_RESULT M12_immutability_weakened NON_PASSING=[%]', coalesce(r, 'NONE');
end $mut$;