-- ============================================================================
-- ROLLBACK of docs/map1-zip-read-generation.sql. Restores public.app_zip_projects_markers to
-- the body it carried before (md5 371f1fcfdfaf412b7de1a8a0bd7618ae), byte for byte.
--
-- The old body is RECONSTRUCTED, never retyped: the authoritative block is read back out of
-- geo.n5_zip_projects_markers_at, the five generation edits are reversed (each counted), and
-- the result must fingerprint to the pre-state or nothing is changed.
--
-- geo.n5_zip_projects_markers_at is KEPT: the pre-activation proof
-- (geo.n5_generation_record_proof, docs/n5-generation-publish-part-d.sql D14) reads candidates
-- through it. It stays executable by no visitor role. Re-applying the forward file accepts it.
-- After using this, the proof still reads candidates correctly, but Map 1 no longer reads the
-- serving generation through the same function, so the proof's "one reader" guarantee lapses
-- until the forward file is applied again.
-- ============================================================================
do $rb$
declare
  fn         constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  at_fn      constant regprocedure := 'geo.n5_zip_projects_markers_at(text,text,text)'::regprocedure;
  pre_md5    constant text := '371f1fcfdfaf412b7de1a8a0bd7618ae';
  post_md5   constant text := '83f36dcc7babb2db4e75fc136297519f';
  at_md5     constant text := '0c8b9f8f8496a8ed0315c6c257669ae8';
  block_anchor constant text := '  select s.status into v_status';
  call_anchor  constant text := E'  -- THE AUTHORITATIVE READ LIVES IN ONE PLACE.';
  src        text;
  at_src     text;
  blk        text;
  old_src    text;
  newdef     text;
  got        int;
  r          record;
  attrs_before text;
  attrs_after  text;
begin
  perform set_config('lock_timeout', '5s', true);
  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) = pre_md5 then
    raise notice 'map1-zip-read-generation rollback: the reader is already the pre-state; nothing to do';
    return;
  end if;
  if md5(src) <> post_md5 then
    raise exception 'map1-zip-read-generation rollback: the live reader is % - not the split reader %. Not applied.',
      md5(src), post_md5;
  end if;
  select p.prosrc into at_src from pg_proc p where p.oid = at_fn;
  if md5(at_src) <> at_md5 then
    raise exception 'map1-zip-read-generation rollback: % is % - not the recorded %. Not applied.', at_fn, md5(at_src), at_md5;
  end if;

  got := (length(at_src) - length(replace(at_src, block_anchor, ''))) / length(block_anchor);
  if got <> 1 then raise exception 'map1-zip-read-generation rollback: block anchor appears % time(s). Not applied.', got; end if;
  blk := substr(at_src, position(block_anchor in at_src));
  blk := substr(blk, 1, length(blk) - length(E'end\n'));
  for r in
    select * from (values
      (5, 'k.generation_id = p_generation_id and k.zcta5 = v_zip', 'k.zcta5 = v_zip', 1),
      (4, 'from geo.zip_authoritative_marker k', 'from geo.n5_serving_marker k', 1),
      (3, 'mm.generation_id = p_generation_id and mm.zcta5 = v_zip', 'mm.zcta5 = v_zip', 3),
      (2, 'geo.zip_authoritative_membership mm', 'geo.n5_serving_membership mm', 3),
      (1, 'from geo.maps_zip_geography_status s where s.generation_id = p_generation_id and s.zip = v_zip',
          'from geo.n5_serving_status s where s.zip = v_zip', 1)) v(n, needle, repl, want)
    order by n desc
  loop
    got := (length(blk) - length(replace(blk, r.needle, ''))) / length(r.needle);
    if got <> r.want then
      raise exception 'map1-zip-read-generation rollback: anchor % appears % time(s), expected %. Not applied.', r.n, got, r.want;
    end if;
    blk := replace(blk, r.needle, r.repl);
  end loop;

  got := (length(src) - length(replace(src, call_anchor, ''))) / length(call_anchor);
  if got <> 1 then raise exception 'map1-zip-read-generation rollback: call anchor appears % time(s). Not applied.', got; end if;
  old_src := substr(src, 1, position(call_anchor in src) - 1) || blk || E'end\n';
  if md5(old_src) <> pre_md5 then
    raise exception 'map1-zip-read-generation rollback: the reconstruction fingerprints to %, not %. Not applied.',
      md5(old_src), pre_md5;
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_before from pg_proc p where p.oid = fn;
  newdef := pg_get_functiondef(fn);
  got := (length(newdef) - length(replace(newdef, src, ''))) / length(src);
  if got <> 1 then
    raise exception 'map1-zip-read-generation rollback: the reader body appears % time(s) in its definition. Not applied.', got;
  end if;
  execute replace(newdef, src, old_src);
  if md5((select prosrc from pg_proc where oid = fn)) <> pre_md5 then
    raise exception 'map1-zip-read-generation rollback: post-condition failed. Rolled back.';
  end if;
  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_after from pg_proc p where p.oid = fn;
  if attrs_after is distinct from attrs_before then
    raise exception 'map1-zip-read-generation rollback: reader attributes changed. Rolled back.';
  end if;
  raise notice 'map1-zip-read-generation rollback: reader restored to %', pre_md5;
end
$rb$;
