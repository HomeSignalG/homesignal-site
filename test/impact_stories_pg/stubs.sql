-- Stand-ins for what Supabase provides. They exist only in the disposable test database.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create extension if not exists pgcrypto;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
create table public.dashboard_admins (email text primary key);
insert into public.dashboard_admins values ('founder@example.com');
-- only the columns the catalog reads (the real table belongs to Tab 16 and is never written here)
create table public.youtube_video_reviews (slug text primary key, title text not null, created_at timestamptz default now());
insert into public.youtube_video_reviews values ('gig-harbor-fishing-homeport-dock', '3003 Gig Harbor Commercial Fishing Homeport');
create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('github_actions_pat', 'test-pat');
create schema net;
create table net.requests (id bigserial primary key, url text, body jsonb);
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, timed_out boolean,
  created timestamptz default now());
create function net.http_post(url text, body jsonb, headers jsonb, timeout_milliseconds int) returns bigint language sql as $$
  insert into net.requests (url, body) values (url, body) returning id $$;
grant usage on schema public, auth to anon, authenticated, service_role;
-- storage (the render bucket and its read policy) and Tab 16's admin helper, as Supabase has them
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function public.hs_is_dashboard_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.dashboard_admins da where da.email = (auth.jwt() ->> 'email')) $$;
