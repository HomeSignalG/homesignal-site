-- M15_replay_mints_duplicates: rolled-back mutation. Applies an exact needle to the LIVE definition, runs the real
-- selftest, then RAISES so the whole transaction (the mutation included) rolls back.
do $mut$
declare d text; r text;
begin
  d := pg_get_functiondef('public.dc_resolve_canonical(boolean,boolean)'::regprocedure);
  if position($n$then r.source_key || '|' || r.distribution_key || '|' || r.publisher_record_id$n$ in d) = 0 then
    raise exception 'NEEDLE_ABSENT M15_replay_mints_duplicates';
  end if;
  execute replace(d, $n$then r.source_key || '|' || r.distribution_key || '|' || r.publisher_record_id$n$, $x$then r.source_key || '|' || r.distribution_key || '|' || r.publisher_record_id || '|' || r.acquisition_run_id::text$x$);
  select string_agg(check_no::text||'='||outcome, ',' order by check_no) into r from public.dc_step3a_selftest() where outcome not in ('PASS','INFO');
  raise exception 'MUTATION_RESULT M15_replay_mints_duplicates NON_PASSING=[%]', coalesce(r, 'NONE');
end $mut$;
