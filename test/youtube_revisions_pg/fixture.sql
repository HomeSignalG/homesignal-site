-- Stand-ins for the Supabase pieces the revision SQL touches (auth.jwt, pg_net, vault, roles) and the tables it extends.
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if;
end $$;
create extension if not exists pgcrypto;
drop schema if exists auth cascade; create schema auth;
create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('test.jwt', true), '')::jsonb $$;
drop schema if exists net cascade; create schema net;
create table net._http_response (id bigint primary key, status_code int);
create sequence net.seq;
create table net.sent (id bigint, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 1000) returns bigint
  language plpgsql as $$ declare i bigint := nextval('net.seq'); begin insert into net.sent values (i, url, body, headers); return i; end $$;
drop schema if exists vault cascade; create schema vault;
create table vault.decrypted_secrets (name text, decrypted_secret text);
insert into vault.decrypted_secrets values ('github_actions_pat', 'ghp_test');
create schema if not exists public;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema net, vault to postgres;
create table public.dashboard_admins (email text primary key);
insert into public.dashboard_admins values ('founder@example.com');
create table public.youtube_video_reviews (
  slug text primary key, title text not null, status text not null default 'pending',
  files jsonb not null default '{}', meta jsonb not null default '{}', created_at timestamptz not null default now(),
  decided_at timestamptz, decided_by text, note text, file_decisions jsonb not null default '{}');
revoke all on public.youtube_video_reviews from public;
insert into public.youtube_video_reviews (slug, title, files) values
 ('tacoma', 'Tacoma', jsonb_build_object(
   'final',     jsonb_build_object('path','tacoma/final.mp4','bytes',44000000,'sha256','aa'),
   'short1',    jsonb_build_object('path','tacoma/short1.mp4','bytes',12000000,'sha256','bb'),
   'short2',    jsonb_build_object('path','tacoma/short2.mp4','bytes',11000000,'sha256','cc'),
   'thumbnail', jsonb_build_object('path','tacoma/thumbnail.png','bytes',900000,'sha256','dd')));
alter default privileges in schema public grant all on tables to service_role; grant all on public.youtube_video_reviews to service_role;
alter role service_role bypassrls;
