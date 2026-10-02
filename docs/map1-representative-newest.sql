-- ============================================================================
-- MAP 1 STEP (a): EACH PIN SHOWS ITS PROJECT'S NEWEST RECORD (2026-10-02). DDL OF RECORD.
-- Founder-approved 2026-10-02 ("yes" to: newest record shown, page addresses kept the same,
-- all three readers changed together, before/after shown again before anything goes live).
-- NOT APPLIED. Rollback: docs/map1-representative-newest.rollback.sql (the exact inverse).
--
-- ⛔ APPLIED 2026-10-02 14:42Z AND ROLLED BACK ~14:54Z. DO NOT RE-APPLY THIS FILE.
-- PART B made Map 1 slow: app_projects holds one row per ZIP copy of a record (unique
-- (zip, source_key, source_seq)), and every copy shares its submitted_at, so the tie-break on
-- last_seen_at read every copy's heap row. Measured: 333 members in 010xx read 29,541 rows (up
-- to 1,728 copies of one key); Map 1 for ZIP 30032 took 20.8 s cold (limit 25 s) and 1.4 s
-- after the rollback; the Rule D refresh died on its first call (57014, run 37022090758).
-- The local proof's fixture had a handful of copies per key, so it could not see this.
-- Both readers were restored to their pre-state bodies (4918783a…, f10327fe…, owner, grants
-- and SET clauses unchanged). STILL PRESENT: the PART A index (harmless) and
-- public.app_project_representative, called by nothing (its drop is a destructive statement
-- waiting on the founder's confirmation).
--
-- THE DEFECT. Map 1 draws one pin per source_key, and a source_key can carry several
-- public.app_projects rows: the same record copied into each ZIP it touches, and sometimes
-- several different records that share the key (an NYC job's FO and NB permits; a 1996 site
-- plan and its 2026 amendment). Three readers pick the row that describes the pin, and all
-- three pick `order by p.id asc limit 1`. id is gen_random_uuid(), so the pick is arbitrary:
-- an older record, or a copy written before its source's status changed, can describe a pin
-- whose newer record is sitting in the next row.
--   public.app_zip_projects_markers      Map 1's ZIP read (site)
--   public.app_authoritative_projects_for_zip   the ZIP page's read (site)
--   public.app_development_projects_for_zips    the Rule D / project-page bulk read (ingest)
--
-- THE RULE, ONCE. public.app_project_representative(source_key, record_kind) returns the one
-- row that describes a source_key:
--   order by submitted_at desc nulls last, last_seen_at desc nulls last, id
-- The newest dated record first. Among copies of that date, the copy written most recently
-- (last_seen_at moves only when app_refresh_zip rewrites a row's content, so the latest copy
-- carries the source's latest status). id breaks any remaining tie, so the pick is stable.
-- All three readers call this function; none carries its own ORDER BY any more. The ingest
-- reader is changed by its own migration in homesignal-ingest, which refuses to apply until
-- this file has (it checks this function's fingerprint).
--
-- WHY NO `set search_path` ON THE FUNCTION. It is LANGUAGE sql, STABLE, not STRICT, not
-- SECURITY DEFINER and has no SET clause, so the planner INLINES it into each reader's lateral
-- join: the plan is the same index scan the readers ran before, with no per-row function
-- call. Measured locally (PostgreSQL 16, 15,000 pins): inlined 197-240 ms, the same ORDER BY
-- written inline 200-232 ms, the same function with `set search_path` 277-340 ms (+40-50%,
-- because a SET clause blocks inlining and adds a GUC save/restore per pin). Every name in the
-- body is schema-qualified and the function is not SECURITY DEFINER, so the caller's
-- search_path cannot widen what it reads. The Supabase linter will list it under
-- function_search_path_mutable; that is the accepted cost of inlining, recorded here.
-- EXECUTE is revoked from PUBLIC, anon and authenticated: the three readers are SECURITY
-- DEFINER (owner postgres), so they run it as its owner.
--
-- THE INDEX (PART A). "Newest first" cannot use app_projects_skey_kind_id_idx, which hands
-- back the lowest id directly. Without help each pin reads every copy of its key. Measured on
-- production 2026-10-02 (db-sql run 37016923943, read-only): 910,888 drawn pins would read
-- 4,475,455 rows (today about one each); worst ZIP 30032 reads 47,672 rows for 3,326 pins;
-- one key has 4,261 copies; 506 keys have more than 100. The index
--   app_projects_skey_kind_date_idx (source_key, record_kind, submitted_at desc nulls last)
-- lets each pin read only the copies that share the newest date (an Incremental Sort on
-- last_seen_at, id). Locally, a 30032-shaped ZIP: 54-58 ms without it, 19-20 ms with it,
-- 22 ms for today's lowest-id read. The heaviest key read 143 of its 4,261 copies.
-- last_seen_at is deliberately NOT in the index: every content rewrite moves it, so indexing
-- it would make those updates non-HOT (96% of this table's 4,036,197 updates are HOT today).
-- submitted_at is already in app_projects_zip_kind_date_idx, so HOT eligibility is unchanged.
-- Size: about 0.86x app_projects_skey_kind_id_idx locally; that index is 484 MB in
-- production, so expect about 400-450 MB. Database 23 GB of 36 GB provisioned (2026-10-02).
-- app_projects_skey_kind_id_idx loses its three readers after this change; dropping it is a
-- separate decision (see homesignal-site #1386, which handles this table's other indexes) and
-- is NOT done here.
--
-- WHAT RESIDENTS SEE CHANGE. Measured on production 2026-10-02 00:51Z (db-sql run
-- 36948001467, read-only), against 910,326 drawn development pins:
--   pins whose description changes      2,270 on 701 ZIP pages (1,344 source_keys)
--   drawn keys whose source_seq changes   985 (project-page addresses are KEPT: the ingest
--                                             refresh keeps each existing page's seq)
--   pins whose newest date still ties     1,212 (643 keys): decided by last_seen_at, then id
--   MAPS posts: 2 drafts (78703, 10475) whose picture tool now finds the post's own record on
--   the pin; 1 skipped post unchanged; 1 draft (33004) still does not match; no approved or
--   published post is on a changed key.
--   Facility pins: none. geo.n5_serving_membership holds 912,246 rows, all development
--   (2026-10-02), so the facility branch of the map reader never reaches this lookup today.
-- These are re-measured immediately before any apply; the numbers above are the dated record.
--
-- HOW IT IS APPLIED. PART A alone, outside a transaction (CREATE INDEX CONCURRENTLY cannot run
-- in one; the Management API path in db-sql.yml wraps a file in a transaction, so PART A runs
-- as a single statement of its own). Then PART B, one transaction. PART B refuses unless the
-- index exists, is valid and has exactly the definition above. Each reader's new definition is
-- computed from its LIVE definition, never retyped (CLAUDE.md claims rule 7), and refused
-- unless the live body fingerprints to the recorded pre-state; a reader already at its
-- post-state is left alone. Each anchor must appear exactly once and each replacement is
-- checked on its own. After the CREATE OR REPLACE each body must fingerprint to its recorded
-- post-state, and owner, grants, SECURITY DEFINER, STABLE and every SET clause (search_path,
-- the map reader's 25 s statement_timeout) must be unchanged.
--
-- PROOF: test/n5_generation_pg/run_map1_representative.py, on a throwaway PostgreSQL with
-- PostGIS, from the same production pre-state the char5 proof builds (both readers
-- fingerprint-equal to production before the change). It seeds keys whose lowest-id row is
-- not the newest, shows each reader's output change to the newest row and nothing else,
-- checks the plans inside both readers read app_projects through the new index with no
-- function call, checks the rollback restores both bodies byte for byte, and kills mutations.
-- ============================================================================

-- ========================== PART A: the index (run ALONE) ==========================
create index concurrently if not exists app_projects_skey_kind_date_idx
  on public.app_projects (source_key, record_kind, submitted_at desc nulls last);

-- ========================== PART B: the rule and the two site readers ==========================
do $rep$
declare
  idx_def      constant text := 'CREATE INDEX app_projects_skey_kind_date_idx ON public.app_projects USING btree (source_key, record_kind, submitted_at DESC NULLS LAST)';
  rep_fn       constant text := 'public.app_project_representative(text,text)';
  rep_md5      constant text := '28f6fefb57b2d7fbd64e630caf272fcf';
  rep_create   constant text := $fn$create function public.app_project_representative(p_source_key text, p_record_kind text)
returns setof public.app_projects
language sql
stable
parallel safe
as $body$
  select p.*
    from public.app_projects p
   where p.source_key = p_source_key
     and p.record_kind = p_record_kind
   order by p.submitted_at desc nulls last, p.last_seen_at desc nulls last, p.id
   limit 1
$body$$fn$;
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
  r            record;
  f            record;
begin
  perform set_config('lock_timeout', '5s', true);

  -- 1. The index must be there, valid, and exactly as recorded.
  if not exists (select 1 from pg_class c join pg_index i on i.indexrelid = c.oid
                  where c.oid = to_regclass('public.app_projects_skey_kind_date_idx')
                    and i.indisvalid and i.indisready
                    and pg_get_indexdef(c.oid) = idx_def) then
    raise exception 'map1-representative-newest: PART A has not been applied (index app_projects_skey_kind_date_idx missing, invalid or different). Not applied.';
  end if;

  -- 2. The shared rule. Created once; if present it must be exactly this function.
  if to_regprocedure(rep_fn) is null then
    execute rep_create;
    execute 'revoke all on function public.app_project_representative(text, text) from public';
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute 'revoke all on function public.app_project_representative(text, text) from anon';
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute 'revoke all on function public.app_project_representative(text, text) from authenticated';
    end if;
    execute $c$comment on function public.app_project_representative(text, text) is
'The one row that describes a source_key on Map 1, the ZIP page and the Rule D / project-page read: newest submitted_at, then most recently written copy, then id. docs/map1-representative-newest.sql'$c$;
  end if;
  select p.prosrc into src from pg_proc p where p.oid = to_regprocedure(rep_fn);
  if md5(src) <> rep_md5 then
    raise exception 'map1-representative-newest: public.app_project_representative exists with a different body (md5 %, expected %). Not applied.', md5(src), rep_md5;
  end if;
  if not exists (select 1 from pg_proc p join pg_language l on l.oid = p.prolang
                  where p.oid = to_regprocedure(rep_fn) and l.lanname = 'sql'
                    and p.provolatile = 's' and not p.prosecdef and not p.proisstrict
                    and p.proretset and p.proconfig is null
                    and p.prorettype = 'public.app_projects'::regtype) then
    raise exception 'map1-representative-newest: public.app_project_representative is not an inlinable STABLE sql set-returning function. Not applied.';
  end if;
  if has_function_privilege('public', to_regprocedure(rep_fn), 'execute')
     or (exists (select 1 from pg_roles where rolname = 'anon')
         and has_function_privilege('anon', to_regprocedure(rep_fn), 'execute'))
     or (exists (select 1 from pg_roles where rolname = 'authenticated')
         and has_function_privilege('authenticated', to_regprocedure(rep_fn), 'execute')) then
    raise exception 'map1-representative-newest: anon or authenticated can execute public.app_project_representative. Not applied.';
  end if;

  -- 3. The two site readers, each spliced from its live definition.
  for f in
    select * from (values
      (1, mk_fn, mk_pre, mk_post),
      (2, az_fn, az_pre, az_post)) v(n, fn, pre_md5, post_md5)
    order by n
  loop
    select p.prosrc into src from pg_proc p where p.oid = f.fn;
    if md5(src) = f.post_md5 then
      raise notice 'map1-representative-newest: % already applied (body md5 %), left alone', f.fn, f.post_md5;
      continue;
    end if;
    if md5(src) <> f.pre_md5 then
      raise exception 'map1-representative-newest: the live body of % drifted (md5 %, expected %). Not applied.',
        f.fn, md5(src), f.pre_md5;
    end if;

    select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                     array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                     p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
      into attrs_before from pg_proc p where p.oid = f.fn;

    newdef := pg_get_functiondef(f.fn);
    for r in
      select * from (values
        (1, 1, $n$  -- One project per (ZIP, source_key) membership; the descriptive row is the lowest stable id.$n$,
               $r$  -- One project per (ZIP, source_key) membership. The descriptive row is the source_key's
  -- newest record, chosen by public.app_project_representative, the one rule Map 1, the ZIP
  -- page and the Rule D read share (docs/map1-representative-newest.sql).$r$),
        (1, 2, $n$        from public.app_projects p
       where p.source_key = mm.source_key
         and p.record_kind = p_kind
       order by p.id asc
       limit 1) a on true$n$,
               $r$        from public.app_project_representative(mm.source_key, p_kind) p) a on true$r$),
        (2, 1, $n$    left join lateral (
      select p.* from public.app_projects p
       where p.source_key = m.source_key and p.record_kind = 'development'
       order by p.id asc limit 1) a on true$n$,
               $r$    -- The descriptive row is the source_key's newest record, chosen by
    -- public.app_project_representative, the one rule Map 1, the ZIP page and the Rule D read
    -- share (docs/map1-representative-newest.sql).
    left join lateral public.app_project_representative(m.source_key, 'development') a on true$r$))
        v(fn_n, n, needle, repl)
      where v.fn_n = f.n
      order by n
    loop
      got := (length(newdef) - length(replace(newdef, r.needle, ''))) / length(r.needle);
      if got <> 1 then
        raise exception 'map1-representative-newest: % anchor % appears % time(s), expected 1. Not applied.',
          f.fn, r.n, got;
      end if;
      newdef := replace(newdef, r.needle, r.repl);
      got := (length(newdef) - length(replace(newdef, r.repl, ''))) / length(r.repl);
      if got <> 1 then
        raise exception 'map1-representative-newest: % replacement % landed % time(s), expected 1. Not applied.',
          f.fn, r.n, got;
      end if;
    end loop;

    execute newdef;

    select p.prosrc into src from pg_proc p where p.oid = f.fn;
    if md5(src) <> f.post_md5 then
      raise exception 'map1-representative-newest: the new body of % fingerprints to %, expected %. Rolled back.',
        f.fn, md5(src), f.post_md5;
    end if;
    if position('order by p.id asc' in src) > 0
       or (length(src) - length(replace(src, 'public.app_project_representative(', '')))
          / length('public.app_project_representative(') <> 1 then
      raise exception 'map1-representative-newest: % does not read through the shared rule exactly once. Rolled back.', f.fn;
    end if;

    select concat_ws(' | ', p.proowner::regrole::text, coalesce(p.proacl::text, '(default)'),
                     array_to_string(p.proconfig, ','), p.prosecdef::text, p.provolatile::text,
                     p.proparallel::text, p.prorettype::regtype::text, pg_get_function_arguments(p.oid))
      into attrs_after from pg_proc p where p.oid = f.fn;
    if attrs_after is distinct from attrs_before then
      raise exception 'map1-representative-newest: attributes of % changed (% -> %). Rolled back.',
        f.fn, attrs_before, attrs_after;
    end if;

    raise notice 'map1-representative-newest: % applied (body md5 % -> %)', f.fn, f.pre_md5, f.post_md5;
  end loop;
end
$rep$;
