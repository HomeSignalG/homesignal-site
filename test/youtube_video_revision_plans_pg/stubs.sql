-- Stand-ins for what Supabase provides. They exist only in the disposable test database.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
create table public.dashboard_admins (email text primary key);
insert into public.dashboard_admins values ('founder@example.com');
create schema vault;
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
insert into vault.decrypted_secrets values ('github_actions_pat', 'test-token');
create schema net;
create table net.calls (id bigserial primary key, url text, body jsonb);
create function net.http_post(url text, body jsonb, headers jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language sql as $$ insert into net.calls (url, body) values (url, body) returning id $$;
create schema extensions;
grant usage on schema public, auth, storage to anon, authenticated, service_role;
