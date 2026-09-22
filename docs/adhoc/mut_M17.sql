-- M17_unknown_defaults_confirmed: rolled-back mutation. Applies an exact needle to the LIVE definition, runs the real
-- selftest, then RAISES so the whole transaction (the mutation included) rolls back.
do $mut$
declare d text; r text;
begin
  d := pg_get_functiondef('public.dc_classify_observation(text,text,text,jsonb)'::regprocedure);
  if position($n$return query select 'CLASSIFICATION_UNRESOLVED'::text,
            'UNKNOWN_SOURCE'::text,$n$ in d) <> 1 and position($n$return query select 'CLASSIFICATION_UNRESOLVED'::text,
            'UNKNOWN_SOURCE'::text,$n$ in d) = 0 then
    raise exception 'NEEDLE_ABSENT M17_unknown_defaults_confirmed';
  end if;
  execute replace(d, $n$return query select 'CLASSIFICATION_UNRESOLVED'::text,
            'UNKNOWN_SOURCE'::text,$n$, $x$return query select 'CONFIRMED_DC'::text,
            'UNKNOWN_SOURCE'::text,$x$);
  select string_agg(check_no::text||'='||outcome, ',' order by check_no) into r from public.dc_step3a_selftest() where outcome not in ('PASS','INFO');
  raise exception 'MUTATION_RESULT M17_unknown_defaults_confirmed NON_PASSING=[%]', coalesce(r, 'NONE');
end $mut$;
