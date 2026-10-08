-- DDL OF RECORD — close the anon read+write hole on unprotected public tables.
-- Applied 2026-09-19 as migration `lock_anon_writable_diagnostic_tables`.
--
-- THE DEFECT, measured with the PUBLIC ANON KEY (the key that ships in the browser),
-- with controls in both directions so the readings mean something:
--
--   feed_candidates         -> 200, real rows      <- exposed
--   tceq_operator_requests  -> 200, real rows      <- exposed
--   users        (control)  -> []                  <- correctly locked
--   feeds        (control)  -> []                  <- correctly locked
--
-- 51 public tables carried RLS OFF while `anon` held SELECT *and* INSERT/UPDATE/DELETE,
-- so anyone with the browser key could read and write them. No subscriber data was among
-- them (`users` and `feeds` were already locked); they are internal diagnostic cohorts
-- (gn_*_cohort_*, commercial_baseline_*, _ct_zips …), archives, and work queues — the
-- `epa_split_probe_20260907` posture this repo's CLAUDE.md already flags as a defect,
-- reached 51 times over.
--
-- WHY RLS WITH ZERO POLICIES IS THE INTENDED END STATE, not an oversight: it denies anon
-- and authenticated every row while service_role continues unaffected. 37 other tables in
-- this schema already sit exactly like this, so the change makes the schema consistent
-- rather than introducing a new pattern.
--
-- SAFETY CHECK RUN BEFORE APPLYING (this is the half worth repeating, not the SQL):
--   * No shipped browser page references any of the 51. The anon key is a browser key, so
--     this is the check that decides whether the site breaks.
--   * The only code references anywhere were a JSON schema, a SQL *generator* that emits
--     DDL text, and comments — none of them a runtime anon read.
--   * The ingest workflows that genuinely read some of these authenticate with the
--     service-role write key, which bypasses RLS by design.
--
-- VERIFIED AFTER APPLY, live over the anon key:
--   feed_candidates        -> []        (was: real rows)
--   tceq_operator_requests -> []        (was: real rows)
--   app_changes            -> real rows <- control
--   development_reports    -> real rows <- control
--   app_community_meta     -> real rows <- control
-- The controls are what make the zeros evidence rather than a broken request.
-- Catalog after: anon-readable tables with RLS off = 1, and that one is spatial_ref_sys.
--
-- spatial_ref_sys is EXCLUDED and must stay excluded: PostGIS owns it, so ALTER fails
-- "must be owner of table", and it is public geodetic reference data with nothing private
-- in it. Any other extension-owned table is likewise not ours to alter.
--
-- Rule 7: the set is COMPUTED IN THE DATABASE. A hand-typed list of 50 table names is an
-- unreviewed edit to production — re-running this block is how you re-derive it, never a
-- transcription. It is idempotent (already-locked tables drop out of the cursor) and
-- FAILS CLOSED twice: it refuses to report success if it finds nothing to do, and raises
-- if anything is still exposed when it finishes.

do $$
declare
  r record;
  n_before int;
  n_locked int := 0;
  n_after  int;
begin
  select count(*) into n_before
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    and has_table_privilege('anon', c.oid, 'SELECT');

  if n_before = 0 then
    raise exception 'FAIL-CLOSED: 0 anon-readable RLS-off tables found; refusing to report success over nothing';
  end if;

  for r in
    select c.oid, c.relname
    from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      and has_table_privilege('anon', c.oid, 'SELECT')
      and c.relname <> 'spatial_ref_sys'
      and not exists (select 1 from pg_depend d
                      where d.objid = c.oid and d.deptype = 'e')
    order by c.relname
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    n_locked := n_locked + 1;
  end loop;

  select count(*) into n_after
  from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    and has_table_privilege('anon', c.oid, 'SELECT')
    and c.relname <> 'spatial_ref_sys';

  if n_after <> 0 then
    raise exception 'INCOMPLETE: % anon-readable RLS-off tables remain after the pass', n_after;
  end if;

  raise notice 'before=% locked=% after=% (spatial_ref_sys excluded by design)',
    n_before, n_locked, n_after;
end $$;

-- 📌 NOT DONE HERE, and deliberately: the 50 tables are LOCKED, not DROPPED. Most are
-- one-off diagnostic cohorts whose findings already live in docs, and deleting them is a
-- destructive change this repo's CLAUDE.md reserves for the founder. Locking is reversible
-- in one statement per table; a DROP is not. A cleanup pass naming each table and its
-- owner is the right follow-up, as a separate decision.
