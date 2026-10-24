-- Stand-ins for what Supabase provides. They exist only in the disposable test database.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text, metadata jsonb);
create table public.dashboard_admins (email text primary key);
insert into public.dashboard_admins values ('founder@example.com');
-- only the columns video_next_slot reads
create table public.social_posts (id uuid default gen_random_uuid(), status text, scheduled_slot timestamptz);
grant usage on schema public, auth, storage to anon, authenticated, service_role;
