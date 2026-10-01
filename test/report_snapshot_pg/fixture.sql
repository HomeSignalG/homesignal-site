-- Disposable stand-in for the parts of production the report snapshot touches. NEVER applied to
-- production: run.sh refuses unless PGDATABASE names a disposable database.
--   * the Supabase roles, and Supabase's DEFAULT PRIVILEGES (every new table and function in
--     `public` is granted to anon, authenticated and service_role), so the lock-down in
--     docs/report-snapshot.sql is tested against the posture that actually needs undoing.
-- The snapshot table has no dependency on any other table, so nothing else is stood in.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin; end if;
end $$;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
