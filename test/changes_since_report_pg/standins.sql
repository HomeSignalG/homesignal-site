-- Disposable stand-in for the ONE production object this proof does not apply: the failure record public.dev_refresh_source_failures
-- (the refresh's own table, whose DDL is split across docs/dev-refresh-source-failure-guard.sql and a later `kind` migration). run.sh
-- applies the REAL view the reader queries, public.dev_change_source_fetch_health, sliced out of docs/dev-change-baseline.sql by
-- pattern (never retyped), on top of this table. So the thing proven here is the production view's own definition and grants, read
-- through the same translator and the same role as the data layer; only the table under it is a stand-in, with the columns the
-- view reads. The whole-ledger view dev_change_source_health is NOT used by the reader and is proven by its own suite
-- (test/dev_change_baseline_pg), which also pins that the reader's view never touches the ledger.
-- NEVER applied to production: run.sh refuses unless PGDATABASE names a disposable database.
-- Supabase grants USAGE on schema public to its three API roles; run.sh rebuilds the schema from nothing, so the stand-in restores
-- it. (Production has it by platform default; every other disposable harness runs as the database owner and never needs it.)
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's service_role BYPASSES row level security (that is how PostgREST reads the ledger and the snapshot with the service key).
-- The shared fixtures create it as a plain nologin role, so on a FRESH cluster (CI) the ledger's tables, which have RLS and no policy,
-- read as empty to it: the first run of this proof on a fresh cluster found zero ledger rows and zero events. A role created by an
-- earlier session on a developer machine may already carry the attribute, which hid it locally. Set it here, from production's fact.
alter role service_role bypassrls;

create table public.dev_refresh_source_failures (
  id             bigint generated always as identity primary key,
  zip            text        not null,
  registry_id    text        not null,
  reason         text        not null,
  cached_records integer     not null,
  blocked_update boolean     not null,
  seen_at        timestamptz not null default now(),
  kind           text        not null
);
-- production: RLS on, no policy; the service role reads it by BYPASSRLS (set above), anon and authenticated read nothing
alter table public.dev_refresh_source_failures enable row level security;
