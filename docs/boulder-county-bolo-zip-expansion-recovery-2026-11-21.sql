-- ============================================================================
-- ZIP EXPANSION RECOVERY, 2026-11-21. Reverses ONLY docs/boulder-county-bolo-zip-expansion-2026-11-19.sql
-- (reviewed head 27ca30c78e42, blob b8be7a685b8bef99bd34e71d7407775b5415f8ab). NOT APPLIED.
--
-- INTENDED WINDOW: after the expansion committed and BEFORE any enrollment, feed activation, ZIP refresh,
-- report generation or other write that depends on the four ZIPs. It claims nothing beyond the checks below.
-- ORDER: if the city-community v2 rows exist, run the v2 rollback FIRST; this file refuses while they do.
--
-- Everything is ONE transaction (the db-sql route was proven to submit a string as one implicit transaction,
-- run 44958496732). Every check runs before the first change; any failed check raises and nothing changes.
-- No cascade delete, no constraint or trigger is disabled. Run it twice: the second run is a no-op that says so.
--
-- State the forward file changed, and what this restores (all of it is checked first):
--   1. public.canonical_zip_registry : 4 rows (80026, 80027, 80310, 80021; version 2.4; workbook sha 6010b509...).
--   2. public.communities            : 4 ZIP-level rows (slugs lafayette-80026, louisville-80027, boulder-80310,
--                                      broomfield-80021).
--   3. public.communities            : zip_codes of boulder-county-co (+80026, 80027, 80310) and
--                                      jefferson-county-co (+80021). Only those values are removed; every other
--                                      value and its order are kept.
--   4. public.canonical_zip_guard_selftest() : body 12746 -> 12750 (two literals). Restored to the pinned baseline
--                                      body md5 8d6bee1c736996ab9c1a6ff64247ab95.
-- Not restorable, stated: loaded_at / created_at / ids of the deleted rows (they are deleted, not restored), and
-- any audit or API log entry written when the forward file ran.
-- ============================================================================
do $$
declare
  _zips        constant text[] := array['80026','80027','80310','80021'];
  _bzips       constant text[] := array['80026','80027','80310'];
  _sha         constant text   := '6010b50953d2123330397e52d54163486e5705b882ed3dfdc4ad70ed0a990f12';
  _reg_md5     constant text   := 'ad61d07cabc455edd9468e1ed0401a74';
  _base_md5    constant text   := '8d6bee1c736996ab9c1a6ff64247ab95';
  _barr text[]; _jarr text[];
  _broot uuid; _jroot uuid; _ids uuid[]; _page_ids uuid[];
  _n int; _md5 text; _src text; _old text; _mode text;
  _regrows int; _pages int; _fn_new boolean;
  _problems text[] := '{}'::text[];
  r record; _hit boolean; _arr text; _typ text; _sql text;
begin
  -- ---- 0. what state are we in? ------------------------------------------------------------------
  select count(*) into _regrows from public.canonical_zip_registry where zip = any(_zips);
  select count(*) into _pages from public.communities where lower(slug) in
    ('lafayette-80026','louisville-80027','boulder-80310','broomfield-80021');
  select prosrc into _src from pg_proc where oid = 'public.canonical_zip_guard_selftest()'::regprocedure;
  _fn_new := position('12750' in _src) > 0;
  select id into strict _broot from public.communities where slug = 'boulder-county-co'   and level = 'county';
  select id into strict _jroot from public.communities where slug = 'jefferson-county-co' and level = 'county';

  if _regrows = 0 and _pages = 0
     and not coalesce((select zip_codes && _zips from public.communities where id = _broot), false)
     and not coalesce((select zip_codes && _zips from public.communities where id = _jroot), false)
     and not _fn_new then
    -- Already recovered, or never expanded. Prove the pristine state, change nothing.
    select count(*), md5(string_agg(zip, ',' order by zip collate "C")) into _n, _md5 from public.canonical_zip_registry;
    if _n <> 12746 or _md5 <> _reg_md5 or md5(_src) <> _base_md5 then
      raise exception 'refusing: no expansion state found, but the registry or guard self-test is not the pinned baseline (rows %, md5 %, selftest md5 %)',
        _n, _md5, md5(_src);
    end if;
    perform set_config('homesignal.zip_recovery_mode', 'already_recovered_no_change', true);
    raise notice 'ZIP expansion already recovered (or never applied): baseline verified, nothing changed';
    return;
  end if;

  if _regrows <> 4 or _pages <> 4 or not _fn_new then
    raise exception 'refusing: partial or mixed expansion state (registry rows %, ZIP pages %, guard on 12750 form %); recovery would be ambiguous',
      _regrows, _pages, _fn_new;
  end if;

  -- ---- 1. registry must be exactly baseline + the four expansion rows --------------------------------
  select count(*), md5(string_agg(zip, ',' order by zip collate "C")) into _n, _md5
    from public.canonical_zip_registry where zip <> all(_zips);
  if _n <> 12746 or _md5 <> _reg_md5 then
    raise exception 'refusing: registry outside the four ZIPs is % rows md5 % (not the 12,746 baseline); something else changed it', _n, _md5;
  end if;
  if (select count(*) from public.canonical_zip_registry) <> 12750 then
    raise exception 'refusing: registry is not exactly 12,750 rows';
  end if;
  if (select count(*) from public.canonical_zip_registry
       where zip = any(_zips) and gold_master_version = '2.4' and workbook_sha256 = _sha) <> 4 then
    raise exception 'refusing: the four registry rows are not the expansion output (version 2.4, workbook sha 6010b509...)';
  end if;

  -- ---- 2. the four ZIP pages must be exactly the expansion output -------------------------------------
  select array_agg(c.id order by c.slug) into _page_ids
    from public.communities c
    join (values ('80026','Lafayette (80026)','lafayette-80026','Boulder',   _broot),
                 ('80027','Louisville / Superior (80027)','louisville-80027','Boulder',_broot),
                 ('80310','Boulder (80310)','boulder-80310','Boulder',       _broot),
                 ('80021','Broomfield (80021)','broomfield-80021','Jefferson',_jroot)) v(z,n,s,co,par)
      on c.slug = v.s and c.name = v.n and c.county = v.co and c.state = 'CO' and c.level = 'zip'
     and c.zip_codes = array[v.z] and c.parent_id = v.par and c.government_topics = '{}'::text[]
     and c.census_place_geoid is null;
  if coalesce(array_length(_page_ids, 1), 0) <> 4 then
    raise exception 'refusing: the four ZIP pages are not exactly the expansion output (name/county/state/level/ZIP/parent/topics/geoid differ)';
  end if;
  -- Nothing else may claim the ZIPs except those pages and the two county roots.
  if (select count(*) from public.communities where zip_codes && _zips) <> 6
     or exists (select 1 from public.communities where zip_codes && _zips and id <> all(_page_ids || array[_broot, _jroot])) then
    raise exception 'refusing: another community claims one of the four ZIPs';
  end if;
  -- The pages must have no children and the v2 city rows must be gone (run the v2 rollback first).
  if exists (select 1 from public.communities where parent_id = any(_page_ids)) then
    raise exception 'refusing: a community is parented to one of the four ZIP pages';
  end if;
  if exists (select 1 from public.communities where lower(slug) in ('boulder-co','lafayette-co','louisville-co','superior-co')) then
    raise exception 'refusing: city-community v2 rows exist; run the v2 rollback FIRST, then this recovery';
  end if;

  -- ---- 3. county arrays: each added ZIP exactly once in its own root, none in the other ----------------
  select zip_codes into _barr from public.communities where id = _broot;
  select zip_codes into _jarr from public.communities where id = _jroot;
  if (select count(*) from unnest(_barr) z where z = any(_bzips)) <> 3
     or (select count(distinct z) from unnest(_barr) z where z = any(_bzips)) <> 3
     or '80021' = any(_barr)
     or (select count(*) from unnest(_jarr) z where z = '80021') <> 1
     or _jarr && _bzips then
    raise exception 'refusing: a county ZIP array is not in the expected expanded shape (each added ZIP exactly once, in its own county root)';
  end if;

  -- ---- 4. guard self-test body must be the forward output of the pinned baseline ------------------------
  if (length(_src) - length(replace(_src, '12750', ''))) / 5 <> 2
     or position('12746' in _src) > 0
     or position($q$expected := '12750';$q$ in _src) = 0
     or position($q$canonical_zip_registry) = 12750);$q$ in _src) = 0 then
    raise exception 'refusing: guard self-test body is not the expected 12750 form';
  end if;
  _old := replace(_src, '12750', '12746');
  if md5(_old) <> _base_md5 then
    raise exception 'refusing: reverting the guard self-test would not reproduce the pinned baseline body (md5 %); it was changed after expansion', md5(_old);
  end if;
  if not exists (select 1 from pg_proc where oid = 'public.canonical_zip_guard_selftest()'::regprocedure
                   and prosecdef and proconfig = array['search_path=public, pg_temp']) then
    raise exception 'refusing: guard self-test attributes (security definer / search_path) differ from the forward output';
  end if;
  if exists (select 1 from public.canonical_zip_guard_selftest() where not passed) then
    raise exception 'refusing: guard self-test is failing before recovery';
  end if;

  -- ---- 5. dependent references: every public base table, by column name and by foreign key ---------------
  for r in
    select c.relname as tbl, a.attname as col, format_type(a.atttypid, a.atttypmod) as typ, 'community'::text as kind
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('communities','canonical_zip_registry')
       and a.attname = 'community_id'
    union all
    select c.relname, a.attname, format_type(a.atttypid, a.atttypmod), 'zip'
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('communities','canonical_zip_registry')
       and a.attname in ('zip','zip_code','zcta5') and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'bpchar'::regtype)
    union all
    select c.relname, a.attname, format_type(a.atttypid, a.atttypmod), 'zip_array'
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r','p') and c.relname not in ('communities','canonical_zip_registry')
       and a.attname = 'zip_codes' and a.atttypid = 'text[]'::regtype
    union all
    select conrelid::regclass::text, a.attname, format_type(a.atttypid, a.atttypmod), 'community'
      from pg_constraint k join pg_attribute a on a.attrelid = k.conrelid and a.attnum = any(k.conkey)
     where k.contype = 'f' and k.confrelid = 'public.communities'::regclass and k.conrelid <> 'public.communities'::regclass
  loop
    if r.kind = 'community' then
      _arr := _page_ids::text; _typ := r.typ;
      _sql := format('select exists (select 1 from public.%I where %I = any(%L::%s[]))', r.tbl, r.col, _arr, _typ);
    elsif r.kind = 'zip' then
      _arr := _zips::text; _typ := r.typ;
      _sql := format('select exists (select 1 from public.%I where %I = any(%L::%s[]))', r.tbl, r.col, _arr, _typ);
    else
      _sql := format('select exists (select 1 from public.%I where %I && %L::text[])', r.tbl, r.col, _zips::text);
    end if;
    execute _sql into _hit;
    if _hit then _problems := _problems || (r.tbl || '.' || r.col); end if;
  end loop;
  if array_length(_problems, 1) > 0 then
    raise exception 'refusing: dependent records reference the four ZIPs or their pages in: %', array_to_string(_problems, ', ');
  end if;

  -- ---- 6. all checks passed: reverse, in dependency order -------------------------------------------------
  -- Pages first (children of the roots), then the county arrays (the canonical-ZIP trigger re-checks the
  -- remaining values against the registry), then the registry rows, then the guard body.
  delete from public.communities where id = any(_page_ids);
  get diagnostics _n = row_count;
  if _n <> 4 then raise exception 'recovery: expected to delete 4 ZIP pages, deleted %', _n; end if;

  update public.communities
     set zip_codes = array(select z from unnest(zip_codes) with ordinality t(z, o) where z <> all(_bzips) order by o)
   where id = _broot;
  get diagnostics _n = row_count;
  if _n <> 1 then raise exception 'recovery: Boulder root update touched % rows', _n; end if;

  update public.communities
     set zip_codes = array(select z from unnest(zip_codes) with ordinality t(z, o) where z <> '80021' order by o)
   where id = _jroot;
  get diagnostics _n = row_count;
  if _n <> 1 then raise exception 'recovery: Jefferson root update touched % rows', _n; end if;

  delete from public.canonical_zip_registry
   where zip = any(_zips) and gold_master_version = '2.4' and workbook_sha256 = _sha;
  get diagnostics _n = row_count;
  if _n <> 4 then raise exception 'recovery: expected to delete 4 registry rows, deleted %', _n; end if;

  execute format('create or replace function public.canonical_zip_guard_selftest() returns table '
    || '(case_name text, expected text, blocked boolean, passed boolean, detail text) '
    || 'language plpgsql security definer set search_path = public, pg_temp as %L', _old);

  -- ---- 7. post-checks: the pinned baseline, read back ---------------------------------------------------
  select count(*), md5(string_agg(zip, ',' order by zip collate "C")) into _n, _md5 from public.canonical_zip_registry;
  if _n <> 12746 or _md5 <> _reg_md5 then raise exception 'post-check: registry is not the 12,746 baseline'; end if;
  if exists (select 1 from public.communities where zip_codes && _zips)
     or exists (select 1 from public.communities where lower(slug) in ('lafayette-80026','louisville-80027','boulder-80310','broomfield-80021')) then
    raise exception 'post-check: a four-ZIP community or array value is still present';
  end if;
  if md5((select prosrc from pg_proc where oid = 'public.canonical_zip_guard_selftest()'::regprocedure)) <> _base_md5 then
    raise exception 'post-check: guard self-test body is not the pinned baseline';
  end if;
  if exists (select 1 from public.canonical_zip_guard_selftest() where not passed) then
    raise exception 'post-check: guard self-test failing after recovery';
  end if;
  perform set_config('homesignal.zip_recovery_mode', 'recovered', true);
end $$;

-- The one result the route returns. A refusal raises inside the block above, so this never runs after one.
select 'ZIP_EXPANSION_RECOVERY_OK'                                              as receipt,
       current_setting('homesignal.zip_recovery_mode', true)                    as mode,
       (select count(*) from public.canonical_zip_registry)                     as registry_rows,
       (select md5(string_agg(zip, ',' order by zip collate "C")) from public.canonical_zip_registry) as registry_md5,
       (select count(*) from public.canonical_zip_registry where zip in ('80026','80027','80310','80021')) as target_registry_rows,
       (select count(*) from public.communities where zip_codes && array['80026','80027','80310','80021']) as communities_claiming_targets,
       (select md5(prosrc) from pg_proc where oid = 'public.canonical_zip_guard_selftest()'::regprocedure) as selftest_md5;
