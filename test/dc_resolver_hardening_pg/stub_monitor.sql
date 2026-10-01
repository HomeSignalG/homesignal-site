-- Minimal stand-in for public.pipeline_health_tick(): the real anchor and the real _eval shape, nothing else.
create or replace function public.pipeline_health_tick() returns table(result_check text, result_ok boolean, result_detail text)
language plpgsql as $function$
declare _now timestamptz := now();
begin
  create temp table _eval (c_name text, c_ok boolean, c_alertable boolean, c_detail text) on commit drop;
  insert into _eval select 'stub', true, true, 'stub';
  insert into public.pipeline_health_check as c (check_name, ok, alertable, detail, since, updated_at)
  select e.c_name, e.c_ok, e.c_alertable, e.c_detail, _now, _now from _eval e
  on conflict (check_name) do update set ok = excluded.ok, alertable = excluded.alertable,
                                         detail = excluded.detail, updated_at = _now;
  return query select e.c_name, e.c_ok, e.c_detail from _eval e;
end $function$;
