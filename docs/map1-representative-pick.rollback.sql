-- ============================================================================
-- ROLLBACK of docs/map1-representative-pick.sql. NOT APPLIED.
-- Roll back homesignal-ingest's reader FIRST (re-apply its previous DDL of record,
-- 20260928160000). Then:
--   PART B'  one transaction: both site readers go back to `order by p.id asc limit 1`, byte for
--            byte (each body must fingerprint back to its recorded pre-state, and owner, grants
--            and SET clauses must be unchanged).
--   PART C'  alone: the daily pg_cron job is unscheduled.
-- Nothing is dropped. public.app_project_representative stays defined (nothing calls it after
-- PART B'), and public.app_project_pick / app_project_pick_runs stay with their rows; removing
-- them is a separate, destructive decision. Applying docs/map1-representative-pick.sql again
-- after this rollback lands the same state.
-- ============================================================================

-- ========================== PART B': the two site readers ==========================
do $rb$
declare
  mk_fn        constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  mk_pre       constant text := '4918783a335244d4a7056b4922120c1c';
  mk_post      constant text := '371f1fcfdfaf412b7de1a8a0bd7618ae';
  az_fn        constant regprocedure := 'public.app_authoritative_projects_for_zip(text)'::regprocedure;
  az_pre       constant text := 'f10327fed96e87285fee43cad667b764';
  az_post      constant text := 'dc2304ec115550df9946e98085ae7116';
  src          text;
  newdef       text;
  got          int;
  attrs_before text;
  attrs_after  text;
  r            record;
  f            record;
begin
  perform set_config('lock_timeout', '5s', true);

  for f in
    select * from (values
      (1, mk_fn, mk_pre, mk_post),
      (2, az_fn, az_pre, az_post)) v(n, fn, pre_md5, post_md5)
    order by n
  loop
    select p.prosrc into src from pg_proc p where p.oid = f.fn;
    if md5(src) = f.pre_md5 then
      raise notice 'map1-representative-pick rollback: % already at its pre-state (md5 %), left alone', f.fn, f.pre_md5;
      continue;
    end if;
    if md5(src) <> f.post_md5 then
      raise exception 'map1-representative-pick rollback: the live body of % drifted (md5 %, expected %). Not rolled back.',
        f.fn, md5(src), f.post_md5;
    end if;

    select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                     array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                     p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
      into attrs_before from pg_proc p where p.oid = f.fn;

    newdef := pg_get_functiondef(f.fn);
    for r in
      select * from (values
        (1, 1, $r$  -- One project per (ZIP, source_key) membership. The descriptive row is the source_key's
  -- newest record, looked up by public.app_project_representative from the stored daily pick,
  -- the one rule Map 1, the ZIP page and the Rule D read share (docs/map1-representative-pick.sql).$r$,
               $n$  -- One project per (ZIP, source_key) membership; the descriptive row is the lowest stable id.$n$),
        (1, 2, $r$        from public.app_project_representative(mm.source_key, p_kind) p) a on true$r$,
               $n$        from public.app_projects p
       where p.source_key = mm.source_key
         and p.record_kind = p_kind
       order by p.id asc
       limit 1) a on true$n$),
        (2, 1, $r$    -- The descriptive row is the source_key's newest record, looked up by
    -- public.app_project_representative from the stored daily pick, the one rule Map 1, the ZIP
    -- page and the Rule D read share (docs/map1-representative-pick.sql).
    left join lateral public.app_project_representative(m.source_key, 'development') a on true$r$,
               $n$    left join lateral (
      select p.* from public.app_projects p
       where p.source_key = m.source_key and p.record_kind = 'development'
       order by p.id asc limit 1) a on true$n$))
        v(fn_n, n, needle, repl)
      where v.fn_n = f.n
      order by n
    loop
      got := (length(newdef) - length(replace(newdef, r.needle, ''))) / length(r.needle);
      if got <> 1 then
        raise exception 'map1-representative-pick rollback: % anchor % appears % time(s), expected 1. Not rolled back.',
          f.fn, r.n, got;
      end if;
      newdef := replace(newdef, r.needle, r.repl);
    end loop;

    execute newdef;

    select p.prosrc into src from pg_proc p where p.oid = f.fn;
    if md5(src) <> f.pre_md5 then
      raise exception 'map1-representative-pick rollback: % fingerprints to %, expected the pre-state %. Not rolled back.',
        f.fn, md5(src), f.pre_md5;
    end if;
    select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                     array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                     p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
      into attrs_after from pg_proc p where p.oid = f.fn;
    if attrs_after is distinct from attrs_before then
      raise exception 'map1-representative-pick rollback: attributes of % changed (% -> %). Not rolled back.',
        f.fn, attrs_before, attrs_after;
    end if;
    raise notice 'map1-representative-pick rollback: % restored (body md5 % -> %)', f.fn, f.post_md5, f.pre_md5;
  end loop;
end
$rb$;

-- ========================== PART C': stop the daily refresh (run ALONE) ==========================
do $rc$
begin
  if to_regnamespace('cron') is null then
    raise notice 'map1-representative-pick rollback: pg_cron is not installed; nothing to unschedule';
  elsif exists (select 1 from cron.job where jobname = 'app-project-pick-refresh') then
    perform cron.unschedule('app-project-pick-refresh');
    raise notice 'map1-representative-pick rollback: cron job app-project-pick-refresh unscheduled';
  else
    raise notice 'map1-representative-pick rollback: no cron job app-project-pick-refresh; nothing to unschedule';
  end if;
end
$rc$;
