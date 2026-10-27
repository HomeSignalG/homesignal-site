-- Stand-ins for production (disposable database only). classify_channel is loaded from docs/acquisition-attribution.sql
-- WITHOUT its two youtube lines (check.py strips them), so the splice in docs/youtube-engagement.sql is exercised against
-- the real body.
do $r$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $r$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table public.dashboard_admins (email text primary key);
insert into public.dashboard_admins values ('founder@example.com');
create table public.acquisition_touch (id bigserial primary key, created_at timestamptz default now(), subject_type text, subject_id text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, referrer text, landing_path text, zip text, first_touch_at timestamptz,
  visitor_id uuid, channel text, host text, is_internal boolean not null default false, user_id uuid, report_id uuid);
create table public.analytics_exclusion (user_id uuid primary key, reason text);
create or replace function public.analytics_is_excluded(p_user uuid) returns boolean language sql stable as $$
  select exists (select 1 from public.analytics_exclusion where user_id = p_user) $$;
create table public.report_snapshot (report_id uuid primary key, generated_at timestamptz);
create table public.report_owner (report_id uuid primary key, user_id uuid);   -- stand-in for the brokerage membership walk
create or replace function public._report_account(p_report_id uuid, p_at timestamptz) returns table (brokerage_id uuid, user_id uuid)
  language sql stable as $$ select null::uuid, o.user_id from public.report_owner o where o.report_id = p_report_id $$;
-- the columns hs_youtube_engagement reads (DDL of record: docs/youtube-channel-sync.sql)
create table public.youtube_channel_videos (video_id text primary key, url text, title text, privacy_status text,
  upload_status text, published_at timestamptz, duration_s int);
