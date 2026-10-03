-- Disposable stand-in for the parts of production the evaluation entitlement touches. NEVER applied to production: run.sh refuses
-- unless PGDATABASE names a disposable database.
--   * the Supabase roles, and Supabase's DEFAULT PRIVILEGES (every new table, SEQUENCE and function in `public` is granted to anon,
--     authenticated and service_role), so the lock-down in docs/evaluation-entitlement.sql is tested against the posture that
--     actually needs undoing, including the sequence behind the event identity;
--   * auth.users, the one identity table the account spine and this file point at (production's has many more columns; none is read).
-- The three real layers it stands on (docs/brokerage-account-spine.sql, docs/report-private-context.sql, docs/report-snapshot.sql) are
-- applied UNMUTATED by run.sh before this file, in that order.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin; end if;
end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb);

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
