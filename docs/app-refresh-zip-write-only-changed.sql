-- ============================================================================
-- app_refresh_zip(): WRITE ONLY THE app_projects ROWS WHOSE CONTENT CHANGED (2026-09-25)
--
-- SQL OF RECORD. A SPLICE of the LIVE body, never a retyped copy (rules 7-8): the builder
-- below reads pg_get_functiondef, locates every anchor exactly once (fail-closed on 0 or
-- >1), and derives each new fragment FROM the text it replaces. Expected live md5 before:
-- 821a951baefc0798ad46e87de1203f95 (19,527 chars).
--
-- WHAT WAS WRONG
-- ----------------------------------------------------------------------------
-- Both app_projects upserts ended `on conflict (zip, source_key, source_seq) do update set
-- <every column>, last_seen_at=excluded.last_seen_at` with no condition, and the stale
-- reaper deleted `last_seen_at < _run`. So the heartbeat WAS the reaper's input, and every
-- existing row had to be rewritten on every refresh to survive it — changed or not.
-- Measured 2026-09-25 (pg_stat since 2026-09-22 22:36, 252 sweeps, 92,860 ZIP refreshes):
-- app_projects 23,185,711 updates vs 50,918 inserts / 158,432 deletes = ~250 rewrites per
-- refresh against ~245 rows per ZIP; the sweep wrote 88.0 GB of WAL (~349 MB per tick).
--
-- WHAT CHANGES — five things, nothing else
-- ----------------------------------------------------------------------------
-- 1. EXPECTED SET. Each upsert's source subquery becomes a CTE `src` that feeds BOTH the
--    insert and a capture of this ZIP's expected keys (_dk/_ds development, _fk/_fs
--    facility). One source query, read once; not a second copy of its predicates.
-- 2. CONDITIONAL UPDATE. `do update set ... where (app_projects.<cols>) is distinct from
--    (excluded.<cols>)`, where <cols> is EXACTLY that statement's own SET list minus
--    last_seen_at, parsed from the live text (the facility SET list is narrower than the
--    development one and stays so). An unchanged row is not rewritten.
-- 3. REAPER BY IDENTITY. Both `(p.last_seen_at is null or p.last_seen_at < _run)`
--    predicates (the delete and the _kept count) become "key absent from the expected
--    set". Before, the rows with last_seen_at >= _run were EXACTLY the rows upserted this
--    run, i.e. exactly the expected keys, so the deleted set and the kept count are
--    unchanged. The reference guards (property_company_roles, project_facility_refs,
--    identity_conflicts) are untouched, as is the source_key-null delete at the top.
-- 5. IDENTICAL ROWS NEVER REACH THE INSERT. The first revision (applied 2026-09-25 15:57Z,
--    md5 e2c6dadc…) relied on `do update ... where is distinct from` alone. Measured over the
--    next four sweeps: physical updates fell ~92% (20.7 vs ~250 per refresh), but WAL per
--    tick did NOT (370 MB vs 349 MB) and dirtied blocks rose — because ON CONFLICT LOCKS the
--    conflicting row before evaluating WHERE. 394/394 unchanged rows sampled carried a fresh
--    xmax. So each select list is wrapped as v(<the insert's own column list>) and anti-joined
--    on (zip, source_key, source_seq) + the same compared columns; only new or changed rows
--    are offered to the insert, and the conditional DO UPDATE stays as the backstop.
-- 4. COORDINATE CLAMP FOLDED IN. The post-pass nulls lat/lng that are out of range or
--    >100 mi from the ZIP centre. With the unconditional upsert that cost two writes per
--    affected row per refresh; with a conditional one it would still rewrite them forever
--    (stored NULL vs raw value). The condition is moved VERBATIM into
--    public.app_coord_outlier() and used in BOTH places: the upsert computes the final
--    value, and the post-pass (kept, for referenced stale rows) calls the same function.
--
-- last_seen_at, AFTER: "when the materializer last WROTE this row's content" (insert or
-- real change). It is no longer a per-refresh heartbeat and nothing depends on it being
-- one. Every reader, checked 2026-09-25:
--   * app_refresh_zip — the reaper; replaced by (3).
--   * app_zip_fingerprint — EXCLUDES it.
--   * dc_resident_lineage_ledger — service_role diagnostic view, passes the column through.
--   * geo.n5_shadow_projects_for_zip — orders cross-ZIP copies of one source_key by it
--     (desc) to pick one; no DB caller, EXECUTE held by postgres only, and the N5 publish
--     path that would use it is NOT APPLIED (#1336). Under the new meaning it prefers the
--     most recently WRITTEN copy instead of the most recently REFRESHED one.
--   * site JS: comments only; lib/dashboard-aggregate.js explicitly refuses to use it.
--
-- NOT CHANGED: app_changes (still rebuilt; no stable identity for every change type —
-- generated ids, current_date-dated rows, capped md5-ordered selections), and
-- app_community_meta / app_zip_source_ids (narrow; meta.updated_at is the sweep's ordering
-- key and must advance every refresh).
--
-- ROLLBACK: re-apply the pre-change body. The builder is reversible only by replaying the
-- old definition; it is archived verbatim in public.app_refresh_zip_def_archive by this
-- file (row tag 'pre-write-only-changed'), and restoring is
--   select def from public.app_refresh_zip_def_archive where tag = 'pre-write-only-changed';
--   -> execute that text; then drop function public.app_coord_outlier.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- The builder. Pure text in, text out; creates nothing itself. Named arguments let the
-- rollback-only proof build the SAME candidate under proof names.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.app_refresh_zip_write_only_changed(_def text, _fn text, _helper text)
returns jsonb
language plpgsql
as $b$
declare
  d text := _def;
  n int;
  a int; b int; s0 int; so int; sc int; e int;
  cond text; helper_sql text;
  stmt text; subq text; head text; rest text; setlist text; cols text[]; newstmt text;
  inscols text; sel text; ordpart text; confpart text; kc text;
  lat_expr constant text := $x$case when el->>'lat' ~ '^-?[0-9.]+$' then (el->>'lat')::double precision end$x$;
  lng_expr constant text := $x$case when el->>'lng' ~ '^-?[0-9.]+$' then (el->>'lng')::double precision end$x$;
  pp_open  constant text := E'    update public.app_projects set lat=null, lng=null\n     where zip=_zip and lat is not null and (\n';
  pp_close constant text := E'\n     );\n';
  sub_open constant text := E'    from (\n      select d.el,';
  sub_close constant text := E'\n    ) t\n';
  stmt_end constant text := 'last_seen_at=excluded.last_seen_at;';
  old_reap constant text := '(p.last_seen_at is null or p.last_seen_at < _run)';
  new_reap constant text := 'not exists (select 1 from unnest(_dk || _fk, _ds || _fs) e(k, s) where e.k = p.source_key and e.s = p.source_seq)';
  anchors text[] := array[
    '    insert into public.app_projects (community_id, zip, name, type, status, stage, developer, size, investment, submitted_at, lat, lng, impact_score, source_ref, record_kind, registry_id, date_kind, type_raw,',
    '    insert into public.app_projects (community_id, zip, name, type, status, developer, lat, lng, impact_score, source_ref, record_kind, registry_id, facility_env,'];
  karr text[] := array['_dk', '_fk'];
  sarr text[] := array['_ds', '_fs'];
  i int;
  cnt constant text := 'select (length($1) - length(replace($1, $2, ''''))) / length($2)';
begin
  -- 0. name
  execute cnt into n using d, 'CREATE OR REPLACE FUNCTION public.app_refresh_zip(_zip text)';
  if n <> 1 then raise exception 'header found % times', n; end if;
  d := replace(d, 'CREATE OR REPLACE FUNCTION public.app_refresh_zip(_zip text)',
                  'CREATE OR REPLACE FUNCTION ' || _fn || '(_zip text)');

  -- 1. declarations
  execute cnt into n using d, E'        _run timestamptz; _stale int; _kept int;\n';
  if n <> 1 then raise exception 'declare anchor found % times', n; end if;
  d := replace(d, E'        _run timestamptz; _stale int; _kept int;\n',
    E'        _run timestamptz; _stale int; _kept int;\n'
    || E'        _dk text[] := ''{}''; _ds smallint[] := ''{}''; _fk text[] := ''{}''; _fs smallint[] := ''{}'';\n');

  -- 2. the coordinate clamp -> one helper, derived verbatim from the post-pass
  execute cnt into n using d, pp_open;
  if n <> 1 then raise exception 'post-pass anchor found % times', n; end if;
  a := position(pp_open in d);
  b := position(pp_close in substr(d, a + length(pp_open)));
  if b = 0 then raise exception 'post-pass close not found'; end if;
  cond := substr(d, a + length(pp_open), b - 1);
  helper_sql := format(
    E'create or replace function %s(lat double precision, lng double precision, _lat double precision, _lng double precision)\n'
    || E' returns boolean language sql immutable as $h$\n  select lat is not null and coalesce((\n%s\n  ), false)\n$h$', _helper, cond);
  d := overlay(d placing E'    update public.app_projects set lat=null, lng=null\n     where zip=_zip and '
                        || _helper || E'(lat, lng, _lat, _lng);\n'
            from a for length(pp_open) + (b - 1) + length(pp_close));

  -- 3. each upsert -> src CTE + conditional update + key capture
  for i in 1..2 loop
    execute cnt into n using d, anchors[i];
    if n <> 1 then raise exception 'upsert % anchor found % times', i, n; end if;
    s0 := position(anchors[i] in d);
    so := position(sub_open in substr(d, s0));
    if so = 0 then raise exception 'upsert % subquery open not found', i; end if;
    so := s0 + so - 1;
    sc := position(sub_close in substr(d, so));
    if sc = 0 then raise exception 'upsert % subquery close not found', i; end if;
    sc := so + sc - 1;
    e := position(stmt_end in substr(d, sc));
    if e = 0 then raise exception 'upsert % end not found', i; end if;
    e := sc + e - 1 + length(stmt_end);
    stmt := substr(d, s0, e - s0);
    subq := substr(d, so + length(E'    from (\n'), sc - (so + length(E'    from (\n')));
    head := substr(d, s0, so - s0);
    rest := substr(d, sc + length(E'\n    ) t'), (e - 1) - (sc + length(E'\n    ) t')));
    -- clamp, in the select list, via placeholders so the two replacements cannot collide
    if (length(head) - length(replace(head, lat_expr, ''))) / length(lat_expr) <> 1
       or (length(head) - length(replace(head, lng_expr, ''))) / length(lng_expr) <> 1 then
      raise exception 'upsert % lat/lng expression not found exactly once', i;
    end if;
    head := replace(replace(head, lat_expr, '@@LAT@@'), lng_expr, '@@LNG@@');
    head := replace(head, '@@LAT@@', format('case when %s(%s, %s, _lat, _lng) then null else %s end', _helper, lat_expr, lng_expr, lat_expr));
    head := replace(head, '@@LNG@@', format('case when %s(%s, %s, _lat, _lng) then null else %s end', _helper, lat_expr, lng_expr, lng_expr));
    -- the statement's OWN set list, minus the heartbeat
    setlist := substr(rest, position('do update set' in rest) + length('do update set'));
    select array_agg(m[1] order by o) into cols
      from regexp_matches(setlist, '([a-z_]+)=excluded\.\1', 'g') with ordinality r(m, o)
     where m[1] <> 'last_seen_at';
    if (length(setlist) - length(replace(setlist, '=excluded.', ''))) / length('=excluded.')
       <> coalesce(array_length(cols, 1), 0) + 1 then
      raise exception 'upsert % set list has a non x=excluded.x assignment — re-derive, do not loosen', i;
    end if;
    -- SKIP IDENTICAL ROWS BEFORE THE INSERT. `on conflict do update ... where false` still
    -- LOCKS the conflicting row (tuple xmax written, page dirtied, WAL-logged, full-page image
    -- after a checkpoint) -- measured on the first deploy: 394/394 unchanged rows carried a
    -- fresh xmax. So an identical row must never reach the insert. The select list is wrapped
    -- as v(<the insert's own column list>) and anti-joined on the conflict key + the same
    -- compared columns; the conditional DO UPDATE stays as the backstop.
    if position(E')\n    select ' in head) = 0 then raise exception 'upsert % column-list/select split not found', i; end if;
    inscols := substr(head, position('(' in head) + 1, position(E')\n    select ' in head) - position('(' in head) - 1);
    sel := substr(head, position(E')\n    select ' in head) + 2);
    if position(E'\n    on conflict' in rest) = 0 then raise exception 'upsert % on conflict not found', i; end if;
    ordpart := substr(rest, 1, position(E'\n    on conflict' in rest) - 1);
    confpart := substr(rest, position(E'\n    on conflict' in rest));
    foreach kc in array array['zip', 'source_key', 'source_seq'] || cols loop
      if position(kc in inscols) = 0 then raise exception 'upsert % compared column % is not in its insert list', i, kc; end if;
    end loop;
    newstmt := E'    with src as (\n' || subq || E'\n    ), ins as (\n'
      || substr(head, 1, position(E')\n    select ' in head)) || E'\n    select v.* from (\n'
      || sel || '    from src t' || ordpart
      || E'\n    ) v(' || inscols || E')\n    where not exists (\n      select 1 from public.app_projects p\n'
      || E'       where p.zip = v.zip and p.source_key = v.source_key and p.source_seq = v.source_seq\n'
      || '         and (' || (select string_agg('p.' || c, ', ') from unnest(cols) c)
      || E')\n             is not distinct from (' || (select string_agg('v.' || c, ', ') from unnest(cols) c)
      || E'))' || confpart
      || E'\n      where (' || (select string_agg('app_projects.' || c, ', ') from unnest(cols) c)
      || E')\n        is distinct from (' || (select string_agg('excluded.' || c, ', ') from unnest(cols) c)
      || E')\n    )\n    select coalesce(array_agg(sk order by sk, seq), ''{}''), coalesce(array_agg(seq order by sk, seq), ''{}'')\n      into '
      || karr[i] || ', ' || sarr[i] || E'\n      from src;';
    execute cnt into n using d, stmt;
    if n <> 1 then raise exception 'upsert % statement text found % times', i, n; end if;
    d := replace(d, stmt, newstmt);
  end loop;

  -- 4. the reaper and the kept count: identity, not heartbeat
  execute cnt into n using d, old_reap;
  if n <> 2 then raise exception 'reaper predicate found % times, expected 2 (delete + kept count)', n; end if;
  d := replace(d, old_reap, new_reap);

  return jsonb_build_object('helper', helper_sql, 'fn', d);
end $b$;

-- ---------------------------------------------------------------------------
-- Apply.
-- ---------------------------------------------------------------------------
create table if not exists public.app_refresh_zip_def_archive (
  tag text primary key, md5 text not null, def text not null, archived_at timestamptz not null default now());
alter table public.app_refresh_zip_def_archive enable row level security;
revoke all on public.app_refresh_zip_def_archive from anon, authenticated;

do $apply$
declare _live text; _src text; _after text; _b jsonb;
begin
  _live := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  if position(E'where not exists (\n      select 1 from public.app_projects p' in _live) > 0 then
    raise notice 'already applied (md5 %) — nothing to do', md5(_live);
    return;
  end if;
  -- The builder ALWAYS runs on the audited ORIGINAL body. Live is either that body (first
  -- apply) or the first revision of this change (2026-09-25 15:57Z, md5 e2c6dadc…, which
  -- skipped the update but still LOCKED every unchanged row); both rebuild from the original.
  if md5(_live) = '821a951baefc0798ad46e87de1203f95' then
    insert into public.app_refresh_zip_def_archive (tag, md5, def)
      values ('pre-write-only-changed', md5(_live), _live)
      on conflict (tag) do nothing;
  elsif md5(_live) <> 'e2c6dadc2c8292a7903d8b13f037e7bc' then
    raise exception 'live app_refresh_zip md5 % is neither the audited original nor its first revision — re-derive', md5(_live);
  end if;
  select def into _src from public.app_refresh_zip_def_archive where tag = 'pre-write-only-changed';
  if _src is null or md5(_src) <> '821a951baefc0798ad46e87de1203f95' then
    raise exception 'archived original body missing or not the audited md5 — refusing to build';
  end if;
  _b := pg_temp.app_refresh_zip_write_only_changed(_src, 'public.app_refresh_zip', 'public.app_coord_outlier');
  execute _b->>'helper';
  execute _b->>'fn';
  _after := pg_get_functiondef('public.app_refresh_zip(text)'::regprocedure);
  if position('last_seen_at < _run' in _after) > 0
     or position('is distinct from' in _after) = 0
     or position(E'where not exists (\n      select 1 from public.app_projects p' in _after) = 0
     or position('public.app_coord_outlier(lat, lng, _lat, _lng)' in _after) = 0 then
    raise exception 'splice did not take';
  end if;
  -- the builder is deterministic: rebuilding from the archived body reproduces what is live
  if md5(pg_temp.app_refresh_zip_write_only_changed(_src, 'public.app_refresh_zip', 'public.app_coord_outlier')->>'fn')
     <> md5(_b->>'fn') then
    raise exception 'builder is not deterministic';
  end if;
  raise notice 'app_refresh_zip md5 % -> % (len % -> %)', md5(_live), md5(_after), length(_live), length(_after);
end $apply$;

commit;
