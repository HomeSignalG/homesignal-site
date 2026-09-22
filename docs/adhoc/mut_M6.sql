-- M6_fuzzy_or_name_confirms: rolled-back mutation. Applies an exact needle to the LIVE definition, runs the real
-- selftest, then RAISES so the whole transaction (the mutation included) rolls back.
do $mut$
declare d text; r text;
begin
  d := pg_get_functiondef('public.dc_adjudicate_pair(uuid,uuid,text)'::regprocedure);
  if position($n$return query select 'CANDIDATE_MATCH'::text,$n$ in d) = 0 then
    raise exception 'NEEDLE_ABSENT M6_fuzzy_or_name_confirms';
  end if;
  execute replace(d, $n$return query select 'CANDIDATE_MATCH'::text,$n$, $x$return query select 'CONFIRMED_MATCH'::text,$x$);
  select string_agg(check_no::text||'='||outcome, ',' order by check_no) into r from public.dc_step3a_selftest() where outcome not in ('PASS','INFO');
  raise exception 'MUTATION_RESULT M6_fuzzy_or_name_confirms NON_PASSING=[%]', coalesce(r, 'NONE');
end $mut$;
