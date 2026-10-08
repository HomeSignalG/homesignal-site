-- ============================================================================
-- ROLLBACK for docs/map1-zip-read-char5.sql: the exact inverse, computed from the LIVE body.
-- Refuses unless the live body fingerprints to the post-state 4918783a335244d4a7056b4922120c1c;
-- does nothing if it already fingerprints to the pre-state 5517dce94b4ed2dd9f6dc12b9c4389a8.
-- After it runs the body must fingerprint to the pre-state again, attributes unchanged.
-- Exercised by test/n5_generation_pg/run_map1_char5.py (apply -> rollback -> apply).
-- ============================================================================
do $unsplice$
declare
  fn        constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  pre_md5   constant text := '5517dce94b4ed2dd9f6dc12b9c4389a8';
  post_md5  constant text := '4918783a335244d4a7056b4922120c1c';
  src       text;
  newdef    text;
  got       int;
  attrs_before text;
  attrs_after  text;
  r         record;
begin
  perform set_config('lock_timeout', '5s', true);

  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) = pre_md5 then
    raise notice 'map1-zip-read-char5 rollback: already at the pre-state (body md5 %), nothing to do', pre_md5;
    return;
  end if;
  if md5(src) <> post_md5 then
    raise exception 'map1-zip-read-char5 rollback: the live body drifted (md5 %, expected %). Not rolled back.',
      md5(src), post_md5;
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_before from pg_proc p where p.oid = fn;

  newdef := pg_get_functiondef(fn);
  for r in
    select * from (values
      (5, $r$k.zcta5 = v_zip$r$,  $n$k.zcta5 = p_zip$n$,  1),
      (4, $r$mm.zcta5 = v_zip$r$, $n$mm.zcta5 = p_zip$n$, 3),
      (3, $r$s.zip = v_zip$r$,    $n$s.zip = p_zip$n$,    1),
      (2, $r$  -- The geo ZIP keys are char(5). Compared with the text p_zip, every key is cast to text,
  -- which no index covers, so each call read the whole serving plane. p_zip is checked
  -- above to be exactly 5 digits, so this copy is exact. docs/map1-zip-read-char5.sql
  v_zip := p_zip;

  if not p_authoritative then$r$,
          $n$  if not p_authoritative then$n$, 1),
      (1, $r$  v_status   text;
  v_zip      char(5);
begin$r$,
          $n$  v_status   text;
begin$n$, 1)) v(n, needle, repl, want)
    order by n desc
  loop
    got := (length(newdef) - length(replace(newdef, r.needle, ''))) / length(r.needle);
    if got <> r.want then
      raise exception 'map1-zip-read-char5 rollback: anchor % appears % time(s), expected %. Not rolled back.',
        r.n, got, r.want;
    end if;
    newdef := replace(newdef, r.needle, r.repl);
    got := (length(newdef) - length(replace(newdef, r.repl, ''))) / length(r.repl);
    if got <> r.want then
      raise exception 'map1-zip-read-char5 rollback: replacement % landed % time(s), expected %. Not rolled back.',
        r.n, got, r.want;
    end if;
  end loop;

  execute newdef;

  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) <> pre_md5 then
    raise exception 'map1-zip-read-char5 rollback: the body fingerprints to %, expected %. Undone.',
      md5(src), pre_md5;
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_after from pg_proc p where p.oid = fn;
  if attrs_after is distinct from attrs_before then
    raise exception 'map1-zip-read-char5 rollback: function attributes changed (% -> %). Undone.',
      attrs_before, attrs_after;
  end if;

  raise notice 'map1-zip-read-char5 rollback: done (body md5 % -> %)', post_md5, pre_md5;
end
$unsplice$;
