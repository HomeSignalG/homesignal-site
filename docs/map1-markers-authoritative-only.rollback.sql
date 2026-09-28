-- ============================================================================
-- ROLLBACK for docs/map1-markers-authoritative-only.sql: the exact inverse.
-- PARKED, NOT APPLIED. Restores DEFAULT false and the live legacy fallback.
-- Refuses unless the live body fingerprints to fa496fa442ead50e82ab1eb72a0eb4cc
-- AND pg_get_functiondef carries DEFAULT true. Does nothing if the body already
-- fingerprints to 4918783a335244d4a7056b4922120c1c AND DEFAULT false is present.
-- Half-applied (body/DEFAULT disagree) refuses. Drift refuses.
--
-- ⛔ NOT THE UNIT 1 UNLIST. Rolling this back does not unlist plant-only map pages.
-- Founder ruling 2026-09-27: "Do not unlist ~1,005 map pages just because they have
-- plants and no new construction. 'Nothing is being built' is a valid answer. Those
-- pages stay listed. This was the old Unit 1 idea; it is rejected."
-- ============================================================================
do $unsplice$
declare
  fn        constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  pre_md5   constant text := '4918783a335244d4a7056b4922120c1c';
  post_md5  constant text := 'fa496fa442ead50e82ab1eb72a0eb4cc';
  src       text;
  def_text  text;
  newdef    text;
  got       int;
  has_false boolean;
  has_true  boolean;
  attrs_before text;
  attrs_after  text;
  r         record;
begin
  perform set_config('lock_timeout', '5s', true);

  select p.prosrc into src from pg_proc p where p.oid = fn;
  def_text := pg_get_functiondef(fn);
  has_false := position('p_authoritative boolean DEFAULT false' in def_text) > 0;
  has_true  := position('p_authoritative boolean DEFAULT true' in def_text) > 0;

  if md5(src) = pre_md5 then
    if has_false then
      raise notice 'map1-markers-authoritative-only rollback: already at the pre-state (body md5 %, DEFAULT false), nothing to do', pre_md5;
      return;
    end if;
    raise exception 'map1-markers-authoritative-only rollback: half-applied (body is pre-state, DEFAULT is not false). Not rolled back.';
  end if;
  if md5(src) <> post_md5 then
    raise exception 'map1-markers-authoritative-only rollback: the live body drifted (md5 %, expected %). Not rolled back.',
      md5(src), post_md5;
  end if;
  if not has_true then
    raise exception 'map1-markers-authoritative-only rollback: half-applied (body is post-state, DEFAULT true missing). Not rolled back.';
  end if;
  if has_false then
    raise exception 'map1-markers-authoritative-only rollback: half-applied (body is post-state, DEFAULT false still present). Not rolled back.';
  end if;

  -- pg_get_function_arguments omitted: DEFAULT true -> DEFAULT false is the intended inverse.
  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text)
    into attrs_before from pg_proc p where p.oid = fn;

  newdef := def_text;
  for r in
    select * from (values
      (2, $n$  if p_authoritative is not true then
    raise exception 'authoritative required' using errcode = '22023';
  end if;$n$,
          $r$  if not p_authoritative then
    select coalesce(jsonb_agg(
             s.j || jsonb_build_object('project_ref', s.ref)
             order by s.k_date desc nulls last, s.k_name asc nulls last, s.k_id), '[]'::jsonb)
      into v_projects
      from (select to_jsonb(p) as j,
                   coalesce(p.source_key, '') || '#' || coalesce(p.source_seq, 0)::text as ref,
                   case when p_kind = 'facility' then null else p.submitted_at end as k_date,
                   case when p_kind = 'facility' then p.name else null end as k_name,
                   p.id as k_id
              from public.app_projects p
             where p.zip = p_zip and p.record_kind = p_kind) s;

    select coalesce(jsonb_agg(jsonb_build_object(
             'project_ref', coalesce(p.source_key, '') || '#' || coalesce(p.source_seq, 0)::text,
             'marker_seq', 1, 'lat', p.lat, 'lng', p.lng,
             'marker_rule', 'LEGACY_ROW_POINT') order by p.id), '[]'::jsonb)
      into v_markers
      from public.app_projects p
     where p.zip = p_zip and p.record_kind = p_kind
       and p.lat is not null and p.lng is not null;

    return jsonb_build_object('mode', 'legacy', 'zip', p_zip, 'status', 'legacy',
                              'projects', v_projects, 'markers', v_markers);
  end if;$r$, 1),
      (1, $n$p_authoritative boolean DEFAULT true$n$,
          $r$p_authoritative boolean DEFAULT false$r$, 1)) v(n, needle, repl, want)
    order by n desc
  loop
    got := (length(newdef) - length(replace(newdef, r.needle, ''))) / length(r.needle);
    if got <> r.want then
      raise exception 'map1-markers-authoritative-only rollback: anchor % appears % time(s), expected %. Not rolled back.',
        r.n, got, r.want;
    end if;
    newdef := replace(newdef, r.needle, r.repl);
    got := (length(newdef) - length(replace(newdef, r.repl, ''))) / length(r.repl);
    if got <> r.want then
      raise exception 'map1-markers-authoritative-only rollback: replacement % landed % time(s), expected %. Not rolled back.',
        r.n, got, r.want;
    end if;
  end loop;

  execute newdef;

  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) <> pre_md5 then
    raise exception 'map1-markers-authoritative-only rollback: the body fingerprints to %, expected %. Undone.',
      md5(src), pre_md5;
  end if;
  if (length(src) - length(replace(src, 'p.zip = p_zip', ''))) / length('p.zip = p_zip') <> 2 then
    raise exception 'map1-markers-authoritative-only rollback: leftover p.zip = p_zip is not 2. Undone.';
  end if;
  if (length(src) - length(replace(src, 'LEGACY_ROW_POINT', ''))) / length('LEGACY_ROW_POINT') <> 1 then
    raise exception 'map1-markers-authoritative-only rollback: leftover LEGACY_ROW_POINT is not 1. Undone.';
  end if;
  if (length(src) - length(replace(src, 'if not p_authoritative then', ''))) / length('if not p_authoritative then') <> 1 then
    raise exception 'map1-markers-authoritative-only rollback: the legacy if-not branch did not return. Undone.';
  end if;
  if position('if p_authoritative is not true then' in src) > 0 then
    raise exception 'map1-markers-authoritative-only rollback: the raise-exception guard survived. Undone.';
  end if;
  def_text := pg_get_functiondef(fn);
  if position('p_authoritative boolean DEFAULT false' in def_text) = 0 then
    raise exception 'map1-markers-authoritative-only rollback: DEFAULT false missing after rollback. Undone.';
  end if;
  if position('p_authoritative boolean DEFAULT true' in def_text) > 0 then
    raise exception 'map1-markers-authoritative-only rollback: DEFAULT true still present after rollback. Undone.';
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text)
    into attrs_after from pg_proc p where p.oid = fn;
  if attrs_after is distinct from attrs_before then
    raise exception 'map1-markers-authoritative-only rollback: function attributes changed (% -> %). Undone.',
      attrs_before, attrs_after;
  end if;

  raise notice 'map1-markers-authoritative-only rollback: done (body md5 % -> %)', post_md5, pre_md5;
end
$unsplice$;
