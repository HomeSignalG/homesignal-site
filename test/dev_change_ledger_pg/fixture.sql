-- Disposable stand-in for the parts of production the ledger touches. NEVER applied to
-- production: run.sh refuses unless PGDATABASE names a disposable database.
--   * the Supabase roles, and Supabase's DEFAULT PRIVILEGES (every new table and function in
--     `public` is granted to anon, authenticated and service_role), so the lock-down in
--     docs/dev-change-ledger.sql is tested against the posture that actually needs undoing;
--   * public.app_projects with the columns the ledger reads (production has more).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin; end if;
end $$;

alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create table public.app_projects (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid,
  zip              text not null,
  name             text,
  type             text,
  type_raw         text,
  status           text,
  stage            text,
  submitted_at     date,
  date_kind        text,
  address          text,
  start_date       date,
  end_date         date,
  developer        text,
  size             text,
  investment       text,
  source_ref       text,
  record_kind      text,
  registry_id      text,
  lat              double precision,
  lng              double precision,
  impact_score     integer,
  scope_text       text,
  provenance       jsonb,
  source_key       text,
  source_key_basis text,
  source_seq       smallint not null default 1,
  last_seen_at     timestamptz default now(),
  created_at       timestamptz not null default now()
);
create unique index app_projects_zip_source_key_uidx on public.app_projects (zip, source_key, source_seq);
