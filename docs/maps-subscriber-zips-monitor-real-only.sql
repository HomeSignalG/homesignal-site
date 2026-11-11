-- DDL of record. Apply AFTER docs/maps-subscriber-zips-monitor.sql and the 2026-11-11 version of
-- docs/maps-zip-order-subscriber-zips.sql.
--
-- The maps_subscriber_zips alarm follows the list rule: test sign-ups do not count (founder, 2026-11-11).
--
-- WHY. The list rule now keeps a ZIP on the MAPS post list only for a subscriber who is not a known
-- test identity (public.bsky_maps_known_test_identity, homesignal-ingest). The alarm still paged on
-- ANY subscribed ZIP missing from the list, and called a ZIP "test" only when every subscriber
-- carried referral_source 'admin_test'. Left alone, removing the 65 Pierce County test ZIPs from
-- the list would page as "65 subscriber ZIPs are not on the list".
--
-- WHAT CHANGES, three expressions inside the existing check and nothing else:
--   * "real since" asks public.bsky_maps_known_test_identity(user) instead of reading referral_source;
--   * a ZIP missing from the list counts (and is named) only when it has a real subscriber.
-- The 7-day "no published post" rule, the trigger count and the wording are unchanged.
--
-- THE SPLICE: the live definition is read, never retyped. It refuses unless the body fingerprints
-- to the one it was written against (md5 242beb326ba16126bf173228923f6a24, read 2026-11-11) or
-- already carries the change; each old expression must appear exactly once; undoing the three
-- replacements must reproduce the body it started from; owner, grants, SECURITY DEFINER,
-- search_path, volatility, arguments and result must not change. Safe to apply twice.
do $mig$
declare
  fn       constant regprocedure := 'public.pipeline_health_tick()'::regprocedure;
  pre_md5  constant text := '242beb326ba16126bf173228923f6a24';
  olds     constant text[] := array[
    $o$min(us.created_at) filter (where u.referral_source is distinct from 'admin_test') as real_since$o$,
    $o$count(*) filter (where not z.listed) as n_missing,$o$,
    $o$filter (where not z.listed) as missing,$o$];
  news     constant text[] := array[
    $n$min(us.created_at) filter (where not public.bsky_maps_known_test_identity(u.id)) as real_since$n$,
    $n$count(*) filter (where not z.listed and z.real_since is not null) as n_missing,$n$,
    $n$filter (where not z.listed and z.real_since is not null) as missing,$n$];
  _src text; _def text; _back text; i int; n_old int; n_new int; done int := 0;
  _attrs_before text; _attrs_after text;
begin
  perform set_config('lock_timeout', '5s', true);
  select p.prosrc into _src from pg_catalog.pg_proc p where p.oid = fn;

  for i in 1..3 loop
    n_old := (length(_src) - length(replace(_src, olds[i], ''))) / length(olds[i]);
    n_new := (length(_src) - length(replace(_src, news[i], ''))) / length(news[i]);
    if n_old = 0 and n_new = 1 then done := done + 1; end if;
  end loop;
  if done = 3 then
    raise notice 'pipeline_health_tick: maps_subscriber_zips already counts real subscribers only (body md5 %)', md5(_src);
    return;
  end if;
  if done <> 0 then
    raise exception 'pipeline_health_tick: the change is half applied (% of 3 expressions). Not applied.', done;
  end if;
  if md5(_src) <> pre_md5 then
    raise exception 'pipeline_health_tick drifted (body md5 %, expected %). Re-derive this migration. Not applied.',
      md5(_src), pre_md5;
  end if;
  if to_regprocedure('public.bsky_maps_known_test_identity(uuid)') is null then
    raise exception 'public.bsky_maps_known_test_identity(uuid) does not exist. Not applied.';
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into _attrs_before from pg_catalog.pg_proc p where p.oid = fn;

  _def := pg_get_functiondef(fn);
  for i in 1..3 loop
    n_old := (length(_def) - length(replace(_def, olds[i], ''))) / length(olds[i]);
    if n_old <> 1 then
      raise exception 'pipeline_health_tick: expression % appears % time(s), expected exactly 1. Not applied.', i, n_old;
    end if;
    _def := replace(_def, olds[i], news[i]);
  end loop;
  execute _def;

  select p.prosrc into _src from pg_catalog.pg_proc p where p.oid = fn;
  _back := _src;
  for i in 1..3 loop
    if (length(_src) - length(replace(_src, news[i], ''))) / length(news[i]) <> 1
       or position(olds[i] in _src) > 0 then
      raise exception 'pipeline_health_tick: expression % was not replaced exactly once. Rolled back.', i;
    end if;
    _back := replace(_back, news[i], olds[i]);
  end loop;
  if md5(_back) <> pre_md5 then
    raise exception 'pipeline_health_tick: more than the three expressions changed (undone body md5 %, expected %). Rolled back.',
      md5(_back), pre_md5;
  end if;
  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   pg_get_function_arguments(p.oid), pg_get_function_result(p.oid))
    into _attrs_after from pg_catalog.pg_proc p where p.oid = fn;
  if _attrs_after is distinct from _attrs_before then
    raise exception 'pipeline_health_tick: its attributes changed (% -> %). Rolled back.', _attrs_before, _attrs_after;
  end if;
  raise notice 'pipeline_health_tick: maps_subscriber_zips now counts real subscribers only (body md5 % -> %)', pre_md5, md5(_src);
end
$mig$;

-- VERIFY AFTER APPLYING: the next hourly tick at :10 fills the row.
--   select ok, alertable, detail from public.pipeline_health_check where check_name = 'maps_subscriber_zips';
