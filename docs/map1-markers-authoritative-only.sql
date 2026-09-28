-- ============================================================================
-- MAP 1 MARKERS: AUTHORITATIVE REQUIRED (PARKED, NOT APPLIED).
-- Closes the public non-authoritative path on
-- public.app_zip_projects_markers(text, text, boolean).
--
-- ⛔ PARKED. Do not apply this file to production from this PR. Do not add it to
-- .github/workflows/n5-rpc-apply.yml (that workflow is dispatch-only, arm-gated,
-- and pins docs/n5-spatial-read-rpc.sql only). Rollback is
-- docs/map1-markers-authoritative-only.rollback.sql.
--
-- WHAT IT CHANGES, when later applied:
--   1. p_authoritative boolean DEFAULT false  ->  DEFAULT true
--      (pg_get_functiondef renders DEFAULT uppercase; the body does not carry this
--      string.)
--   2. The live `if not p_authoritative then … end if;` legacy fallback (app_projects
--      rows keyed on p.zip = p_zip, LEGACY_ROW_POINT markers) is replaced with
--        if p_authoritative is not true then
--          raise exception 'authoritative required' using errcode = '22023';
--        end if;
--      Omitting the argument, or passing false, becomes a hard error instead of a
--      silent legacy scan.
--
-- WHY THE DEFAULT CHANGE DOES NOT MOVE MAP 1. Every shipping caller already passes
-- { p_authoritative: true }: homesignalmap.html, scripts/verify-map1-zip-states.mjs,
-- scripts/probe-map1-card-grain.mjs, scripts/residential-measure.mjs,
-- scripts/maps-social-image.mjs, test/national-plane-failure-visibility.test.mjs.
-- Changing the default does not change Map 1's own call. It closes the public
-- omit-the-flag path.
--
-- ⛔ NOT THE UNIT 1 UNLIST. A different, rejected idea. Founder ruling 2026-09-27:
--   "Do not unlist ~1,005 map pages just because they have plants and no new
--    construction. 'Nothing is being built' is a valid answer. Those pages stay listed.
--    This was the old Unit 1 idea; it is rejected."
-- docs/epa-decouple-phase2-unit1-core-completion-markers.sql still raises before any
-- statement. This splice does not touch indexable, _nfc, or app_refresh_zip.
--
-- HOW IT IS APPLIED. The new definition is computed from the LIVE one, never retyped
-- (CLAUDE.md claims rule 7). Pre-state body md5 4918783a335244d4a7056b4922120c1c is
-- the live body AFTER docs/map1-zip-read-char5.sql (#1366). Post-state body md5
-- fa496fa442ead50e82ab1eb72a0eb4cc. Idempotent only when BOTH the body is post-state
-- AND pg_get_functiondef carries DEFAULT true. Half-applied (body post / DEFAULT not
-- true, or body pre / DEFAULT not false) refuses. Drift refuses.
--
-- ATTRIBUTES. Owner, grants, SECURITY DEFINER, STABLE, search_path, 25 s
-- statement_timeout and return type must be unchanged. pg_get_function_arguments is
-- omitted from the fingerprint because changing DEFAULT false -> DEFAULT true is the
-- intended argument change (char5 included arguments because it did not change them).
-- Identity stays public.app_zip_projects_markers(text,text,boolean).
-- ============================================================================
do $splice$
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

  if md5(src) = post_md5 then
    if has_true then
      raise notice 'map1-markers-authoritative-only: already applied (body md5 %, DEFAULT true), nothing to do', post_md5;
      return;
    end if;
    raise exception 'map1-markers-authoritative-only: half-applied (body is post-state, DEFAULT is not true). Not applied.';
  end if;
  if md5(src) <> pre_md5 then
    raise exception 'map1-markers-authoritative-only: the live body drifted (md5 %, expected %). Not applied.',
      md5(src), pre_md5;
  end if;
  if not has_false then
    raise exception 'map1-markers-authoritative-only: half-applied (body is pre-state, DEFAULT false missing). Not applied.';
  end if;
  if has_true then
    raise exception 'map1-markers-authoritative-only: half-applied (body is pre-state, DEFAULT true present). Not applied.';
  end if;

  -- pg_get_function_arguments omitted: DEFAULT false -> DEFAULT true is the intended change.
  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text)
    into attrs_before from pg_proc p where p.oid = fn;

  newdef := def_text;
  for r in
    select * from (values
      (1, $n$p_authoritative boolean DEFAULT false$n$,
          $r$p_authoritative boolean DEFAULT true$r$, 1),
      (2, $n$  if not p_authoritative then
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
  end if;$n$,
          $r$  if p_authoritative is not true then
    raise exception 'authoritative required' using errcode = '22023';
  end if;$r$, 1)) v(n, needle, repl, want)
    order by n
  loop
    got := (length(newdef) - length(replace(newdef, r.needle, ''))) / length(r.needle);
    if got <> r.want then
      raise exception 'map1-markers-authoritative-only: anchor % appears % time(s), expected %. Not applied.',
        r.n, got, r.want;
    end if;
    newdef := replace(newdef, r.needle, r.repl);
    got := (length(newdef) - length(replace(newdef, r.repl, ''))) / length(r.repl);
    if got <> r.want then
      raise exception 'map1-markers-authoritative-only: replacement % landed % time(s), expected %. Not applied.',
        r.n, got, r.want;
    end if;
  end loop;

  execute newdef;

  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) <> post_md5 then
    raise exception 'map1-markers-authoritative-only: the new body fingerprints to %, expected %. Rolled back.',
      md5(src), post_md5;
  end if;
  if (length(src) - length(replace(src, 'p.zip = p_zip', ''))) / length('p.zip = p_zip') <> 0 then
    raise exception 'map1-markers-authoritative-only: leftover p.zip = p_zip in the body. Rolled back.';
  end if;
  if (length(src) - length(replace(src, 'LEGACY_ROW_POINT', ''))) / length('LEGACY_ROW_POINT') <> 0 then
    raise exception 'map1-markers-authoritative-only: leftover LEGACY_ROW_POINT in the body. Rolled back.';
  end if;
  if position('if not p_authoritative then' in src) > 0 then
    raise exception 'map1-markers-authoritative-only: the legacy if-not branch survived. Rolled back.';
  end if;
  if (length(src) - length(replace(src, 'if p_authoritative is not true then', ''))) / length('if p_authoritative is not true then') <> 1 then
    raise exception 'map1-markers-authoritative-only: the raise-exception guard is missing or duplicated. Rolled back.';
  end if;
  def_text := pg_get_functiondef(fn);
  if position('p_authoritative boolean DEFAULT true' in def_text) = 0 then
    raise exception 'map1-markers-authoritative-only: DEFAULT true missing after apply. Rolled back.';
  end if;
  if position('p_authoritative boolean DEFAULT false' in def_text) > 0 then
    raise exception 'map1-markers-authoritative-only: DEFAULT false still present after apply. Rolled back.';
  end if;

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text)
    into attrs_after from pg_proc p where p.oid = fn;
  if attrs_after is distinct from attrs_before then
    raise exception 'map1-markers-authoritative-only: function attributes changed (% -> %). Rolled back.',
      attrs_before, attrs_after;
  end if;

  raise notice 'map1-markers-authoritative-only: applied (body md5 % -> %)', pre_md5, post_md5;
end
$splice$;
