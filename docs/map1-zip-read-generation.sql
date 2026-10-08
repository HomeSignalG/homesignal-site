-- ============================================================================
-- MAP 1 READS ONE NAMED GENERATION THROUGH ONE FUNCTION (2026-10-08). DDL OF RECORD.
-- Rollback: docs/map1-zip-read-generation.rollback.sql (restores the reader byte for byte).
--
-- WHY. N5 fix 5: a new national generation must be PROVEN before it serves, and part of that
-- proof is rendering the candidate in Map 1 itself. Map 1's ZIP read,
-- public.app_zip_projects_markers(text,text,boolean), could only read the SERVING generation:
-- its authoritative half reads geo.n5_serving_status / _membership / _marker, and each of those
-- views is the base table filtered to the one ACTIVE / ACTIVE_LEGACY generation. A candidate
-- could therefore only be seen by switching to it, which is the thing the proof must precede.
--
-- WHAT CHANGES. The authoritative half moves, unchanged, into
-- geo.n5_zip_projects_markers_at(p_generation_id, p_zip, p_kind), which reads the base tables
-- filtered to the generation it is given. The public reader keeps its legacy half and, for the
-- authoritative half, returns geo.n5_zip_projects_markers_at(geo.n5_serving_generation_id(), ...).
-- So there is ONE authoritative reader: Map 1 asks it for the serving generation, and the
-- pre-activation proof (docs/n5-generation-publish-part-d.sql, D14) asks it for a candidate.
-- A second, hand-written candidate reader is exactly the parallel truth path CLAUDE.md forbids.
--
-- WHY THE OUTPUT CANNOT CHANGE. Each serving view is `base where generation_id = (the one
-- serving generation)`, and geo.n5_serving_generation_id() returns that same generation:
-- geo.n5_generation_one_serving (a unique index) allows at most one ACTIVE / ACTIVE_LEGACY row.
-- With no serving generation, the views return no rows and `generation_id = null` matches no
-- rows either, so both report status 'unknown'. The five replacements below are the only
-- edits; the block is otherwise moved verbatim.
--
-- HOW IT IS APPLIED. Both bodies are computed from the LIVE reader, never retyped (claims rule
-- 7). The block refuses unless the live reader fingerprints to the known pre-state (md5
-- 371f1fcfdfaf412b7de1a8a0bd7618ae, docs/map1-representative-pick.sql's post-state). Every
-- anchor must appear the expected number of times, and each replacement is counted. Before the
-- swap it reads Map 1's answer for a fixed ZIP sample (every kind); after the swap the answers
-- must be byte-identical, in the same transaction. Both bodies must then fingerprint to the
-- recorded post-state, the reader's owner, grants, SECURITY DEFINER, STABLE, search_path and
-- 25 s timeout must be unchanged, and anon / authenticated / PUBLIC must not be able to execute
-- the new function (a BUILDING generation must never be readable by a visitor).
--
-- PROOF: test/n5_generation_pg/run_map1_generation.py (n5-generation-publish-suite.yml).
-- ============================================================================
do $split$
declare
  fn         constant regprocedure := 'public.app_zip_projects_markers(text,text,boolean)'::regprocedure;
  at_sig     constant text := 'geo.n5_zip_projects_markers_at(text,text,text)';
  pre_md5    constant text := '371f1fcfdfaf412b7de1a8a0bd7618ae';
  post_md5   constant text := '83f36dcc7babb2db4e75fc136297519f';
  at_md5     constant text := '0c8b9f8f8496a8ed0315c6c257669ae8';
  head_end_anchor constant text := E'  v_zip := p_zip;\n';
  block_anchor    constant text := '  select s.status into v_status';
  src        text;
  head       text;
  blk        text;
  at_blk     text;
  at_src     text;
  new_src    text;
  newdef     text;
  i_head     int;
  i_blk      int;
  got        int;
  r          record;
  attrs_before text;
  attrs_after  text;
  sample_before text;
  sample_after  text;
  sample_sql constant text := $s$
    select md5(coalesce(string_agg(z.zip || '|' || k.k || '|'
                 || public.app_zip_projects_markers(z.zip, k.k, true)::text,
                 E'\n' order by z.zip collate "C", k.k collate "C"), ''))
      from (select r.zip::text zip from public.canonical_zip_registry r
             order by md5(r.zip::text) collate "C" limit 16) z
     cross join (values ('development'), ('facility')) k(k)$s$;
begin
  perform set_config('lock_timeout', '5s', true);
  perform set_config('statement_timeout', '300s', true);

  select p.prosrc into src from pg_proc p where p.oid = fn;
  if md5(src) = post_md5 then
    if to_regprocedure(at_sig) is not null
       and md5((select prosrc from pg_proc where oid = to_regprocedure(at_sig))) = at_md5 then
      raise notice 'map1-zip-read-generation: already applied (reader %, at %), nothing to do', post_md5, at_md5;
      return;
    end if;
    raise exception 'map1-zip-read-generation: the reader is applied but % is missing or differs. Not applied.', at_sig;
  end if;
  if md5(src) <> pre_md5 then
    raise exception 'map1-zip-read-generation: the live reader drifted (md5 %, expected %). Not applied.',
      md5(src), pre_md5;
  end if;
  -- The rollback keeps the generation read (the pre-activation proof reads it), so an existing
  -- function is accepted only when it carries exactly the recorded body.
  if to_regprocedure(at_sig) is not null
     and md5((select prosrc from pg_proc where oid = to_regprocedure(at_sig))) <> at_md5 then
    raise exception 'map1-zip-read-generation: % already exists with another body (md5 %). Not applied.',
      at_sig, md5((select prosrc from pg_proc where oid = to_regprocedure(at_sig)));
  end if;
  if right(src, 5) <> E'\nend\n' then
    raise exception 'map1-zip-read-generation: the reader body does not end with "end". Not applied.';
  end if;

  -- The head (declarations, input checks, the char(5) copy) and the authoritative block.
  got := (length(src) - length(replace(src, head_end_anchor, ''))) / length(head_end_anchor);
  if got <> 1 then raise exception 'map1-zip-read-generation: head anchor appears % time(s). Not applied.', got; end if;
  got := (length(src) - length(replace(src, block_anchor, ''))) / length(block_anchor);
  if got <> 1 then raise exception 'map1-zip-read-generation: block anchor appears % time(s). Not applied.', got; end if;
  i_head := position(head_end_anchor in src) + length(head_end_anchor) - 1;
  i_blk  := position(block_anchor in src);
  if i_blk <= i_head then raise exception 'map1-zip-read-generation: the block precedes the head. Not applied.'; end if;
  head := substr(src, 1, i_head);
  blk  := substr(src, i_blk, length(src) - i_blk + 1 - length(E'end\n'));

  -- The block, reading the generation it is given instead of the serving one.
  at_blk := blk;
  for r in
    select * from (values
      (1, 'from geo.n5_serving_status s where s.zip = v_zip',
          'from geo.maps_zip_geography_status s where s.generation_id = p_generation_id and s.zip = v_zip', 1),
      (2, 'geo.n5_serving_membership mm', 'geo.zip_authoritative_membership mm', 3),
      (3, 'mm.zcta5 = v_zip', 'mm.generation_id = p_generation_id and mm.zcta5 = v_zip', 3),
      (4, 'from geo.n5_serving_marker k', 'from geo.zip_authoritative_marker k', 1),
      (5, 'k.zcta5 = v_zip', 'k.generation_id = p_generation_id and k.zcta5 = v_zip', 1)) v(n, needle, repl, want)
    order by n
  loop
    got := (length(at_blk) - length(replace(at_blk, r.needle, ''))) / length(r.needle);
    if got <> r.want then
      raise exception 'map1-zip-read-generation: anchor % appears % time(s), expected %. Not applied.', r.n, got, r.want;
    end if;
    at_blk := replace(at_blk, r.needle, r.repl);
    got := (length(at_blk) - length(replace(at_blk, r.repl, ''))) / length(r.repl);
    if got <> r.want then
      raise exception 'map1-zip-read-generation: replacement % landed % time(s), expected %. Not applied.', r.n, got, r.want;
    end if;
  end loop;
  if at_blk ~ 'n5_serving_' then
    raise exception 'map1-zip-read-generation: the generation read still names a serving view. Not applied.';
  end if;

  at_src := head || E'\n'
    || E'  -- ONE named generation (docs/map1-zip-read-generation.sql). Map 1 calls this with the\n'
    || E'  -- serving generation; the pre-activation proof calls it with a candidate. The block below\n'
    || E'  -- is public.app_zip_projects_markers'' authoritative half, moved, reading the base tables\n'
    || E'  -- filtered to p_generation_id instead of the geo.n5_serving_* views.\n'
    || at_blk || E'end\n';
  new_src := substr(src, 1, i_blk - 1)
    || E'  -- THE AUTHORITATIVE READ LIVES IN ONE PLACE. geo.n5_zip_projects_markers_at reads one named\n'
    || E'  -- generation; Map 1 asks it for the serving one and the pre-activation proof asks it for a\n'
    || E'  -- candidate, so a candidate is proven through exactly the code residents run.\n'
    || E'  -- docs/map1-zip-read-generation.sql\n'
    || E'  return geo.n5_zip_projects_markers_at(geo.n5_serving_generation_id(), p_zip, p_kind);\n'
    || E'end\n';

  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_before from pg_proc p where p.oid = fn;
  execute sample_sql into sample_before;

  execute format($c$create or replace function geo.n5_zip_projects_markers_at(p_generation_id text, p_zip text, p_kind text)
    returns jsonb language plpgsql stable set search_path to 'public', 'geo', 'pg_temp' as %L$c$, at_src);
  execute 'revoke all on function geo.n5_zip_projects_markers_at(text,text,text) from public';
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function geo.n5_zip_projects_markers_at(text,text,text) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'revoke all on function geo.n5_zip_projects_markers_at(text,text,text) from authenticated';
  end if;

  newdef := pg_get_functiondef(fn);
  got := (length(newdef) - length(replace(newdef, src, ''))) / length(src);
  if got <> 1 then
    raise exception 'map1-zip-read-generation: the reader body appears % time(s) in its definition. Not applied.', got;
  end if;
  execute replace(newdef, src, new_src);

  if md5((select prosrc from pg_proc where oid = fn)) <> post_md5 then
    raise exception 'map1-zip-read-generation: the reader fingerprints to %, expected %. Rolled back.',
      md5((select prosrc from pg_proc where oid = fn)), post_md5;
  end if;
  if md5((select prosrc from pg_proc where oid = to_regprocedure(at_sig))) <> at_md5 then
    raise exception 'map1-zip-read-generation: % fingerprints to %, expected %. Rolled back.',
      at_sig, md5((select prosrc from pg_proc where oid = to_regprocedure(at_sig))), at_md5;
  end if;
  select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                   array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                   p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
    into attrs_after from pg_proc p where p.oid = fn;
  if attrs_after is distinct from attrs_before then
    raise exception 'map1-zip-read-generation: reader attributes changed (% -> %). Rolled back.', attrs_before, attrs_after;
  end if;
  if has_function_privilege('public', to_regprocedure(at_sig), 'execute')
     or (exists (select 1 from pg_roles where rolname = 'anon')
         and has_function_privilege('anon', to_regprocedure(at_sig), 'execute'))
     or (exists (select 1 from pg_roles where rolname = 'authenticated')
         and has_function_privilege('authenticated', to_regprocedure(at_sig), 'execute')) then
    raise exception 'map1-zip-read-generation: a visitor role can execute %. Rolled back.', at_sig;
  end if;

  execute sample_sql into sample_after;
  if sample_after is distinct from sample_before then
    raise exception 'map1-zip-read-generation: Map 1''s answers changed on the ZIP sample (% -> %). Rolled back.',
      sample_before, sample_after;
  end if;

  raise notice 'map1-zip-read-generation: applied (reader % -> %, at %, sample %)', pre_md5, post_md5, at_md5, sample_after;
end
$split$;
