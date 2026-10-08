-- ============================================================================
-- DROP THREE INDEXES THAT DUPLICATE OR NEVER SERVE A QUERY (2026-09-27)
--
-- SQL OF RECORD. Frees ~418 MB of disk. Removes NO data: an index is a derived copy of
-- columns that stay in the table, and each one here can be rebuilt from the ROLLBACK
-- section at the bottom.
--
--   public.app_projects_zip_idx              (zip)                   226 MB
--   public.app_projects_source_key_kind_idx  (source_key, record_kind) 182 MB
--   public.dc_obs_payload_gin                gin (raw_payload)        10 MB
--
-- WHY EACH ONE IS SAFE, MEASURED 2026-09-27 (stats since the 2026-09-22 restart)
-- ----------------------------------------------------------------------------
-- 1. app_projects_zip_idx (zip) is the leading column of TWO other indexes that stay:
--    app_projects_zip_source_key_uidx (zip, source_key, source_seq) and
--    app_projects_zip_kind_date_idx (zip, record_kind, submitted_at desc, id).
--    It has 2,324 scans, so it is USED. What matters is what the planner picks without it.
--    Measured by dropping it inside a rolled-back transaction and re-running EXPLAIN:
--      where zip = '57105' (largest ZIP, 19,833 rows)  20,349 -> 20,527  (+0.9%)
--      where zip = '84302'                               493.9 -> 497.5  (+0.7%)
--      reaper-shaped delete where zip = ...              496.1 -> 499.7  (+0.7%)
--      min(zip) where zip > ...  (skip scan)             1.02  -> 1.16
--      zip + record_kind lookups                  unchanged (already zip_kind_date_idx)
--    Every one moves to zip_source_key_uidx. Nothing falls back to a sequential scan.
--
-- 2. app_projects_source_key_kind_idx (source_key, record_kind) is an exact PREFIX of
--    app_projects_skey_kind_id_idx (source_key, record_kind, id). The planner already
--    prefers the wider index: 4 scans on the narrow one against 5,000 on the wide one,
--    and the EXPLAINs for source_key = X, source_key = X and record_kind = Y, and
--    source_key = any(...) choose the wide index both BEFORE and after the drop, at
--    identical cost. The narrow one is what scripts/n5_a4_index.py built on 2026-09-03;
--    that script refuses to build when any leading-source_key index already exists, so it
--    cannot re-add it while the wide index is present.
--
-- 3. dc_obs_payload_gin has 0 scans, and a GIN on jsonb can only serve containment and
--    key-existence operators (@>, <@, ?, ?|, ?&, @?, @@). No function, view or
--    materialized view applies any of them to raw_payload: every reader uses -> / ->>,
--    which a GIN cannot help. Checked below inside the database, not by hand.
--
-- ⚠️ app_projects_skey_kind_id_idx HAD NO SQL OF RECORD ANYWHERE in this repo, although
-- app_zip_projects_markers depends on it (migration 20260906151558 names it). After this
-- change it is the ONLY leading-source_key index, so its definition is recorded in the
-- ROLLBACK/RECOVERY section, and the guard below refuses to drop anything unless it
-- exists, is valid, and has exactly that definition.
--
-- HOW TO APPLY
-- ----------------------------------------------------------------------------
-- Run this file ONCE (db-sql.yml, sql_file=docs/db-redundant-index-cleanup.sql). The
-- Management API runs a file as one transaction, so DROP INDEX CONCURRENTLY cannot run
-- here. A plain DROP INDEX only removes catalog rows, but it needs a brief ACCESS
-- EXCLUSIVE lock on the table, so lock_timeout makes it give up quickly rather than
-- queue behind a long reader and block every query that arrives after it.
-- If it times out, nothing changed: run it again.
--
-- The guard block is idempotent: an index that is already gone is skipped, and the
-- definition checks still run.
-- ============================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

do $guard$
declare
  r record;
  n int;
begin
  -- (a) the covering indexes must exist, be valid, and have EXACTLY these definitions.
  for r in select * from (values
      ('app_projects_zip_source_key_uidx',
       'CREATE UNIQUE INDEX app_projects_zip_source_key_uidx ON public.app_projects USING btree (zip, source_key, source_seq)'),
      ('app_projects_zip_kind_date_idx',
       'CREATE INDEX app_projects_zip_kind_date_idx ON public.app_projects USING btree (zip, record_kind, submitted_at DESC NULLS LAST, id)'),
      ('app_projects_skey_kind_id_idx',
       'CREATE INDEX app_projects_skey_kind_id_idx ON public.app_projects USING btree (source_key, record_kind, id)')
    ) v(name, def)
  loop
    select count(*) into n
      from pg_class c join pg_index i on i.indexrelid = c.oid
     where c.oid = to_regclass('public.' || r.name)
       and i.indisvalid and i.indisready
       and pg_get_indexdef(c.oid) = r.def;
    if n <> 1 then
      raise exception 'STOP: covering index % is missing, invalid or redefined', r.name;
    end if;
  end loop;

  -- (b) each target, if still present, must be EXACTLY the index measured, and must back
  --     no constraint. A same-named index with another definition is not ours to drop.
  for r in select * from (values
      ('app_projects_zip_idx',
       'CREATE INDEX app_projects_zip_idx ON public.app_projects USING btree (zip)'),
      ('app_projects_source_key_kind_idx',
       'CREATE INDEX app_projects_source_key_kind_idx ON public.app_projects USING btree (source_key, record_kind)'),
      ('dc_obs_payload_gin',
       'CREATE INDEX dc_obs_payload_gin ON public.dc_source_observation USING gin (raw_payload)')
    ) v(name, def)
  loop
    continue when to_regclass('public.' || r.name) is null;
    if pg_get_indexdef(to_regclass('public.' || r.name)) <> r.def then
      raise exception 'STOP: % exists with an unexpected definition: %',
        r.name, pg_get_indexdef(to_regclass('public.' || r.name));
    end if;
    if exists (select 1 from pg_constraint where conindid = to_regclass('public.' || r.name)) then
      raise exception 'STOP: % backs a constraint', r.name;
    end if;
  end loop;

  -- (c) nothing may use raw_payload with an operator a GIN could serve.
  select count(*) into n from (
    select p.prosrc as body from pg_proc p
    union all select definition from pg_views
    union all select definition from pg_matviews
  ) b
  where b.body ~* 'raw_payload\)?\s*(@>|<@|\?\||\?&|\?|@\?|@@)';
  if n <> 0 then
    raise exception 'STOP: % function/view bodies apply a GIN-servable operator to raw_payload', n;
  end if;
end
$guard$;

drop index if exists public.app_projects_zip_idx;
drop index if exists public.app_projects_source_key_kind_idx;
drop index if exists public.dc_obs_payload_gin;

-- receipt: the three are gone and the covering indexes are still valid.
select c.relname as index_name,
       pg_size_pretty(pg_relation_size(c.oid)) as size,
       i.indisvalid as valid
  from pg_class c join pg_index i on i.indexrelid = c.oid
 where c.relname in ('app_projects_zip_idx', 'app_projects_source_key_kind_idx', 'dc_obs_payload_gin',
                     'app_projects_zip_source_key_uidx', 'app_projects_zip_kind_date_idx',
                     'app_projects_skey_kind_id_idx')
 order by 1;

-- ============================================================================
-- ROLLBACK / RECOVERY — each statement on its OWN, outside a transaction (CONCURRENTLY
-- does not block writes). Build time is minutes each on app_projects.
-- ----------------------------------------------------------------------------
-- create index concurrently if not exists app_projects_zip_idx
--   on public.app_projects using btree (zip);
-- create index concurrently if not exists app_projects_source_key_kind_idx
--   on public.app_projects using btree (source_key, record_kind);
-- create index concurrently if not exists dc_obs_payload_gin
--   on public.dc_source_observation using gin (raw_payload);
--
-- DEFINITION OF RECORD for the index this change leaves as the only leading-source_key
-- index (it already exists; this line is its record, not a new build):
-- create index concurrently if not exists app_projects_skey_kind_id_idx
--   on public.app_projects using btree (source_key, record_kind, id);
-- ============================================================================
