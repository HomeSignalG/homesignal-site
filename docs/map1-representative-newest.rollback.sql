-- ============================================================================
-- ROLLBACK of docs/map1-representative-newest.sql: the exact inverse. NOT APPLIED.
-- Both site readers go back to `order by p.id asc limit 1`, byte for byte (each body must
-- fingerprint back to its recorded pre-state, and owner, grants and SET clauses must be
-- unchanged). Roll back the ingest reader FIRST (homesignal-ingest's own rollback of
-- app_development_projects_for_zips): while any other function still calls
-- public.app_project_representative, this file restores the two site readers and KEEPS the
-- shared function, and says so. PART A' (the index) is separate and optional: keeping the
-- index is harmless, and it must run alone, outside a transaction.
-- ============================================================================

-- ========================== PART B': the two site readers and the rule ==========================
do $rb$
declare
  rep_fn       constant text := 'public.app_project_representative(text,text)';
  mk_fn        constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  mk_pre       constant text := '4918783a335244d4a7056b4922120c1c';
  mk_post      constant text := 'f67816155b6d039afe5220a257ea570c';
  az_fn        constant regprocedure := 'public.app_authoritative_projects_for_zip(text)'::regprocedure;
  az_pre       constant text := 'f10327fed96e87285fee43cad667b764';
  az_post      constant text := '160a745bd4dd888dcc914172ff92b9d8';
  src          text;
  newdef       text;
  got          int;
  attrs_before text;
  attrs_after  text;
  others       int;
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
      raise notice 'map1-representative-newest rollback: % already at its pre-state (md5 %), left alone', f.fn, f.pre_md5;
      continue;
    end if;
    if md5(src) <> f.post_md5 then
      raise exception 'map1-representative-newest rollback: the live body of % drifted (md5 %, expected %). Not rolled back.',
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
  -- newest record, chosen by public.app_project_representative, the one rule Map 1, the ZIP
  -- page and the Rule D read share (docs/map1-representative-newest.sql).$r$,
               $n$  -- One project per (ZIP, source_key) membership; the descriptive row is the lowest stable id.$n$),
        (1, 2, $r$        from public.app_project_representative(mm.source_key, p_kind) p) a on true$r$,
               $n$        from public.app_projects p
       where p.source_key = mm.source_key
         and p.record_kind = p_kind
       order by p.id asc
       limit 1) a on true$n$),
        (2, 1, $r$    -- The descriptive row is the source_key's newest record, chosen by
    -- public.app_project_representative, the one rule Map 1, the ZIP page and the Rule D read
    -- share (docs/map1-representative-newest.sql).
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
        raise exception 'map1-representative-newest rollback: % anchor % appears % time(s), expected 1. Not rolled back.',
          f.fn, r.n, got;
      end if;
      newdef := replace(newdef, r.needle, r.repl);
    end loop;

    execute newdef;

    select p.prosrc into src from pg_proc p where p.oid = f.fn;
    if md5(src) <> f.pre_md5 then
      raise exception 'map1-representative-newest rollback: % fingerprints to %, expected the pre-state %. Not rolled back.',
        f.fn, md5(src), f.pre_md5;
    end if;
    select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                     array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                     p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
      into attrs_after from pg_proc p where p.oid = f.fn;
    if attrs_after is distinct from attrs_before then
      raise exception 'map1-representative-newest rollback: attributes of % changed (% -> %). Not rolled back.',
        f.fn, attrs_before, attrs_after;
    end if;
    raise notice 'map1-representative-newest rollback: % restored (body md5 % -> %)', f.fn, f.post_md5, f.pre_md5;
  end loop;

  if to_regprocedure(rep_fn) is not null then
    select count(*) into others from pg_proc p
     where p.oid <> to_regprocedure(rep_fn)
       and position('app_project_representative(' in p.prosrc) > 0;
    if others > 0 then
      raise notice 'map1-representative-newest rollback: % other function(s) still call public.app_project_representative; it is KEPT. Roll back homesignal-ingest''s reader, then run this file again.', others;
    else
      execute 'drop function public.app_project_representative(text, text)';
      raise notice 'map1-representative-newest rollback: public.app_project_representative dropped';
    end if;
  end if;
end
$rb$;

-- ========================== PART A': the index (OPTIONAL, run ALONE) ==========================
drop index concurrently if exists public.app_projects_skey_kind_date_idx;
