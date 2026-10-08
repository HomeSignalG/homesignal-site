-- Disposable stand-ins for the three production tables the Order D driver READS. Applied AFTER
-- test/dev_change_ledger_pg/fixture.sql (which supplies the roles, Supabase's default privileges
-- and public.app_projects) and BEFORE docs/dev-change-ledger.sql. NEVER applied to production:
-- run.sh refuses unless PGDATABASE names a disposable database.
create table public.canonical_zip_registry (
  zip                text primary key,
  gold_master_version text,
  workbook_sha256    text,
  loaded_at          timestamptz not null default now()
);

-- app_refresh_zip upserts one row per materialised ZIP; updated_at is the sweep's ordering key.
create table public.app_community_meta (
  zip        text primary key,
  updated_at timestamptz not null default now()
);

-- The refresh's own failure record (written by dev_refresh_collect in production).
create table public.dev_refresh_source_failures (
  id             bigserial primary key,
  zip            text,
  registry_id    text not null,
  reason         text,
  cached_records integer,
  blocked_update boolean not null default false,
  seen_at        timestamptz not null default now(),
  kind           text not null,
  detail         jsonb
);
