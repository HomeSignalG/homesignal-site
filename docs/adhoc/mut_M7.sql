-- M7_coordinates_confirm: rolled-back mutation. Applies an exact needle to the LIVE definition, runs the real
-- selftest, then RAISES so the whole transaction (the mutation included) rolls back.
do $mut$
declare d text; r text;
begin
  d := pg_get_functiondef('public.dc_adjudicate_pair(uuid,uuid,text)'::regprocedure);
  if position($n$-- A1. The one confirming rule$n$ in d) = 0 then
    raise exception 'NEEDLE_ABSENT M7_coordinates_confirm';
  end if;
  execute replace(d, $n$-- A1. The one confirming rule$n$, $x$if p_candidate_rule_key = 'SAME_OPERATOR_IDENTICAL_COORDS' then return query select 'CONFIRMED_MATCH'::text, 'MUTANT_COORDS'::text, '{}'::jsonb; return; end if;
    -- A1. The one confirming rule$x$);
  select string_agg(check_no::text||'='||outcome, ',' order by check_no) into r from public.dc_step3a_selftest() where outcome not in ('PASS','INFO');
  raise exception 'MUTATION_RESULT M7_coordinates_confirm NON_PASSING=[%]', coalesce(r, 'NONE');
end $mut$;
