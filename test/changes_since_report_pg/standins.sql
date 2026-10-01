-- Disposable stand-in for the ONE production object this proof does not apply: public.dev_change_source_health.
-- The real view (docs/dev-change-baseline.sql) reads the Order D failure log and is proven by its own suite
-- (test/dev_change_baseline_pg); here only its three columns and its grant matter, so a table with exactly those stands in.
-- NEVER applied to production: run.sh refuses unless PGDATABASE names a disposable database.
-- Supabase grants USAGE on schema public to its three API roles; run.sh rebuilds the schema from nothing, so the stand-in restores
-- it. (Production has it by platform default; every other disposable harness runs as the database owner and never needs it.)
grant usage on schema public to anon, authenticated, service_role;

create table public.dev_change_source_health (
  registry_id text primary key,
  fetch_failures_24h integer not null default 0,
  blocked_24h integer not null default 0,
  truncated_24h integer not null default 0
);
revoke all on public.dev_change_source_health from public, anon, authenticated, service_role;
grant select on public.dev_change_source_health to service_role;
