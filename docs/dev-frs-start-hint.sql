-- EPA facility layer: start dense ZIPs at the rung their stored list fits inside, and judge a
-- genuine zero by the facility clock (2026-10-18).
--
-- WHY. 1,170 ZIPs carried an EPA facility layer older than 7 days while their core layer was fresh.
-- Measured over the 2,348 ZIPs stored at the 40-facility cap, by the smallest ladder rung their
-- stored list fits inside:
--     rung 0.25 / 0.5 / 1     89 ZIPs, 41 stale (46%)   -- includes Tacoma 98411 98412 98415 98421 98464
--     rung 1.5               321 ZIPs, 65 stale (20%)
--     rung 2                 507 ZIPs, 33 stale  (7%)
--     needs the full 3 mi  1,431 ZIPs, 20 stale  (1.4%)
-- The engine starts every ZIP at 3 mi and walks down on each "process limit" refusal, so a dense ZIP
-- spends 3-4 requests before one answers. Through the deployed engine on 2026-10-18: 98421
-- "3:process_limit","2:process_limit" then 1.5 answered; 98402 "3:process_limit","2:process_limit",
-- "1.5:process_limit","1:429","1:429","1:429" and kept its old layer. About half of single EPA probes
-- failed that day (epa_frs_probes), so every wasted request is another chance to fail.
--
-- PART 1  public.dev_frs_start_mi(zip): for a ZIP whose stored list is at the cap (40, the engine's
--         MAX_FACILITIES), the smallest engine rung below 3 mi that holds every stored facility
--         (5% + 0.02 mi margin). Else null. FRS returns every facility inside a circle and the page
--         keeps the nearest 40, so when that circle still holds 40 the answer is the same answer.
--         The engine (sources/epa-frs.ts frsStartRung, index.ts facilitySites) runs the full ladder
--         again whenever the hinted answer has fewer than 40, or is a zero at the smaller circle.
-- PART 2  dev_refresh_fire_batch / dev_refresh_fire_targets send it as `frs_start_mi`. Spliced from
--         the live bodies, one occurrence each. The old engine ignores the key, so order is free.
-- PART 3  dev_refresh_collect passes d.facilities_refreshed_at (the regulatory clock) to
--         dev_epa_write_refused, not d.refreshed_at (core). Core refreshes every ~53 h, so with the
--         core clock a healthy EPA zero could never replace a cached nonzero list: "fresh" was always
--         true. This is the clock half of docs/dev-epa-facility-clock-and-outcome.sql, alone, spliced
--         from the live body (that file's full body predates later splices and must not be replayed).
--
-- Each splice refuses unless the live body fingerprints to the value read on 2026-10-18 and the
-- anchor occurs exactly as often as expected; it then re-reads the function to prove it took.

create or replace function public.dev_frs_start_mi(_zip text)
returns numeric
language sql
stable
set search_path = public, pg_temp
as $fn$
  select case when coalesce((d.counts->>'facilities')::int, 0) >= 40 then (
    select min(r)
      from unnest(array[0.25, 0.5, 1, 1.5, 2]::numeric[]) r
     where r >= (
       select max(sqrt(((x->>'e')::float8) ^ 2 + ((x->>'n')::float8) ^ 2)) * 1.05 + 0.02
         from jsonb_array_elements(case when jsonb_typeof(d.sites) = 'array' then d.sites else '[]'::jsonb end) x
        where x ? 'registry_id'
          and jsonb_typeof(x->'e') = 'number'
          and jsonb_typeof(x->'n') = 'number'))
  end
  from public.development_reports d
  where d.zip = _zip
$fn$;

revoke all on function public.dev_frs_start_mi(text) from public, anon, authenticated;
grant execute on function public.dev_frs_start_mi(text) to service_role;

do $do$
declare
  f record;
  def text;
  newdef text;
  n int;
  anchor text := $a$jsonb_build_object('zip', r.zip, 'lat', r.home_lat, 'lng', r.home_lng)$a$;
  repl   text := $a$jsonb_build_object('zip', r.zip, 'lat', r.home_lat, 'lng', r.home_lng, 'frs_start_mi', public.dev_frs_start_mi(r.zip))$a$;
  old_arg text := $a$dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)$a$;
  new_arg text := $a$dev_epa_write_refused(epa_ok, j, d.counts, d.facilities_refreshed_at)$a$;
begin
  -- PART 2
  for f in select * from (values
      ('dev_refresh_fire_batch',   'eca28fcfaf8d038aee3ca03232bc5e0d'),
      ('dev_refresh_fire_targets', '6cf023c88e1e739a634d720a996b6fcf')) v(name, md5)
  loop
    select pg_get_functiondef(p.oid), p.prosrc into def, newdef
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = f.name;
    if md5(newdef) = f.md5 then
      n := (length(def) - length(replace(def, anchor, ''))) / length(anchor);
      if n <> 1 then raise exception '%: anchor appeared % times, expected 1', f.name, n; end if;
      execute replace(def, anchor, repl);
    elsif position('frs_start_mi' in newdef) = 0 then
      raise exception '%: live body % is neither the expected % nor already spliced', f.name, md5(newdef), f.md5;
    end if;
    select prosrc into newdef from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.proname = f.name;
    if position($a$'frs_start_mi', public.dev_frs_start_mi(r.zip)$a$ in newdef) = 0 then
      raise exception '%: splice did not take', f.name;
    end if;
  end loop;

  -- PART 3
  select pg_get_functiondef(p.oid), p.prosrc into def, newdef
    from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'dev_refresh_collect';
  if md5(newdef) = '12b3dcc680b322af7d2cd61734be9b4c' then
    n := (length(def) - length(replace(def, old_arg, ''))) / length(old_arg);
    if n <> 4 then raise exception 'dev_refresh_collect: old guard call appeared % times, expected 4', n; end if;
    execute replace(def, old_arg, new_arg);
  elsif position(old_arg in newdef) > 0 then
    raise exception 'dev_refresh_collect: live body % is not the expected one and still uses the core clock', md5(newdef);
  end if;
  select prosrc into newdef from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname = 'dev_refresh_collect';
  n := (length(newdef) - length(replace(newdef, new_arg, ''))) / length(new_arg);
  if n <> 4 or position(old_arg in newdef) > 0 then
    raise exception 'dev_refresh_collect: splice did not take (% facility-clock calls)', n;
  end if;
end
$do$;
