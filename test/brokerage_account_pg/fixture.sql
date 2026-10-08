-- Disposable stand-in for the parts of production the brokerage account spine touches. NEVER applied to
-- production: run.sh refuses unless PGDATABASE names a disposable database.
--   * the Supabase roles, and Supabase's DEFAULT PRIVILEGES (every new table and function in `public` is
--     granted to anon, authenticated and service_role), so the lock-down in docs/brokerage-account-spine.sql is
--     tested against the posture that actually needs undoing;
--   * auth.users, the one identity table the spine points at (production's has many more columns; the spine
--     reads none of them, and the suite gives two users the same email on purpose).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin; end if;
end $$;

create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
