-- READ-ONLY. One SELECT. Changes nothing, reads no table row, prints only role names, object names and counts.
-- Question: which role owns objects that were created through the Supabase Management API (/database/query), the path the
-- migration runner (scripts/db_migrate.py, write_sql) uses? docs/weekly-verify-after-1.sql expects owner=postgres.
-- Evidence objects, each recorded in CLAUDE.md as applied through db-sql.yml (the same API):
--   public.state_cleanup_*  (db-sql.yml run 39640349827, 2026-10-21)
--   geo.n5_gen_*, geo.n5_generation_*  (n5-generation-publish PART A / PART C via db-sql.yml, 2026-09-25)
-- Limit: this shows the CURRENT owner. An "alter ... owner to" after creation would hide the creating role.
select jsonb_pretty(jsonb_build_object(
  'reader', jsonb_build_object('role', current_user, 'bypasses_row_security', (select rolbypassrls from pg_roles where rolname = current_user)),
  'api_created_function_owners', (select coalesce(jsonb_object_agg(owner, n), '{}'::jsonb) from (
      select pg_get_userbyid(p.proowner) as owner, count(*) as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where (s.nspname = 'public' and p.proname like 'state\_cleanup\_%') or (s.nspname = 'geo' and p.proname ~ '^n5_gen(eration)?_')
       group by 1) x),
  'api_created_table_owners', (select coalesce(jsonb_object_agg(owner, n), '{}'::jsonb) from (
      select pg_get_userbyid(c.relowner) as owner, count(*) as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'state\_cleanup\_%' group by 1) x),
  'all_public_function_owners', (select coalesce(jsonb_object_agg(owner, n), '{}'::jsonb) from (
      select pg_get_userbyid(p.proowner) as owner, count(*) as n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
       where s.nspname = 'public' group by 1) x),
  'all_public_table_owners', (select coalesce(jsonb_object_agg(owner, n), '{}'::jsonb) from (
      select pg_get_userbyid(c.relowner) as owner, count(*) as n from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relkind = 'r' group by 1) x),
  'weekly_objects_present', (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
       where s.nspname = 'public' and c.relname like 'weekly\_%')
)) as execution_role_check;
