-- Minimal stand-in for what docs/weekly-stage2-slice.sql needs from production. DISPOSABLE DATABASE ONLY.
-- _hs_is_admin is copied verbatim from docs/impact-stories.sql; alert_topic_catalog has its real key (stream, topic).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.dashboard_admins (email text primary key);
insert into public.dashboard_admins values ('founder@test.invalid');
create or replace function public._hs_is_admin()
returns text language plpgsql stable security definer set search_path = public as $$
declare e text := auth.jwt() ->> 'email';
begin
  if e is null or not exists (select 1 from public.dashboard_admins da where da.email = e) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return e;
end $$;
create table public.alert_topic_catalog (stream text not null, topic text not null, active boolean not null default true,
  created_at timestamptz not null default now(), constraint alert_topic_catalog_pkey primary key (stream, topic));
insert into public.alert_topic_catalog (stream, topic) values ('news', 'Air Quality'), ('news', 'Water Quality');
create schema if not exists vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('github_actions_pat', 'TEST-PAT-not-real');
create schema if not exists net;
create table net.calls (id bigserial primary key, url text, body jsonb, headers jsonb);
create or replace function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds integer) returns bigint
language sql as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id $$;
-- Supabase Storage stand-in: the two tables the storage server reads and writes, with RLS on, as in Supabase. The storage
-- server decides a read by querying storage.objects AS THE CALLER'S ROLE, so the bucket policy in the migration is what
-- allows or refuses it. hs_is_dashboard_admin is a stand-in (the production helper is not copied into this repo).
create schema if not exists storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text not null, owner uuid, metadata jsonb, created_at timestamptz not null default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant select on storage.objects to anon, authenticated;
grant all on storage.objects, storage.buckets to service_role;
alter table storage.objects force row level security;
create policy service_all on storage.objects for all to service_role using (true) with check (true);
create or replace function public.hs_is_dashboard_admin() returns boolean language sql stable security definer set search_path = public as
  $$ select exists (select 1 from public.dashboard_admins where email = auth.jwt() ->> 'email') $$;
grant execute on function public.hs_is_dashboard_admin() to anon, authenticated;
