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
-- A stand-in for homesignal-ingest's public.bsky_next_slot (the one schedule picker, 2026-10-27). Its real behaviour
-- (two queues, caps, 150 minutes, the lock, DST) is tested there, in tests/bsky_schedule_pg. Here it only hands out
-- distinct future times, so the queue's own rules can be tested.
create function public.bsky_next_slot(kind text, p_after timestamptz default null, p_ignore uuid default null)
returns timestamptz language plpgsql volatile as $$
declare t timestamptz := now() + interval '3 hours';
begin
  if to_regclass('public.video_bluesky_jobs') is not null then
    execute 'select greatest($1, coalesce(max(scheduled_slot) + interval ''3 hours'', $1)) from public.video_bluesky_jobs where scheduled_slot is not null'
      into t using t;
  end if;
  return t;
end $$;
