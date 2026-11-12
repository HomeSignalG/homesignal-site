-- Minimal live shape for docs/maps-zip-order-subscriber-zips.sql (read from production
-- 2026-11-09; suite.sql S00 checks the view and the list table against production's fingerprints): communities, users, user_subscriptions, the canonical resolver view
-- alert_subscription_state (pg_get_viewdef, verbatim logic), maps_zip_order, auth.jwt().
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema if not exists auth;
create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
create table public.communities (id uuid primary key default gen_random_uuid(), level text not null, zip_codes text[] not null);
create table public.users (id uuid primary key default gen_random_uuid(), email text, community_id uuid,
  zip_code text, alert_email_consent boolean not null default true, unsubscribed boolean not null default false,
  referral_source text);
-- Stand-in for homesignal-ingest's test-identity rule (its real body reads more columns). Two
-- values count as test here so a test can tell "asks the function" from "reads referral_source".
create function public.bsky_maps_known_test_identity(p_user uuid) returns boolean language sql stable as
  $$ select coalesce((select u.referral_source in ('admin_test','campaign_test') from public.users u where u.id = p_user), false) $$;
create table public.user_subscriptions (user_id uuid, community_id uuid, stream text, topic text,
  origin text, sort_order integer, created_at timestamptz default now());
create view public.alert_subscription_state with (security_invoker = true) as
  select u.id as user_id, u.email, u.community_id, u.zip_code, s.stream, s.topic, s.origin,
         u.alert_email_consent, u.unsubscribed,
         ((u.community_id is not null) and u.alert_email_consent and (not u.unsubscribed)
          and (s.origin = 'explicit')) as subscribed, s.sort_order
  from public.users u join public.user_subscriptions s
    on s.user_id = u.id and s.community_id = u.community_id;
create table public.maps_zip_order (founder_position integer not null constraint maps_zip_order_pkey primary key, zip text not null,
  uploaded_at timestamptz not null default now(),
  constraint maps_zip_order_position_positive check (founder_position >= 1),
  constraint maps_zip_order_zip_unique unique (zip),
  constraint maps_zip_order_zip_format check (zip ~ '^[0-9]{5}$'));
insert into public.communities (id, level, zip_codes) values
 ('00000000-0000-0000-0000-000000085083','zip','{85083}'),
 ('00000000-0000-0000-0000-000000064166','zip','{64166}'),
 ('00000000-0000-0000-0000-000000097702','zip','{97702}'),
 ('00000000-0000-0000-0000-000000084336','zip','{84336}'),
 ('00000000-0000-0000-0000-000000098303','zip','{98303}'),
 ('00000000-0000-0000-0000-0000000c0001','county','{98303,98304}');
insert into public.maps_zip_order (founder_position, zip) values (1,'98303'),(2,'98304');
-- an active maps subscriber not on the list (backfill must add it)
insert into public.users (id, email, community_id, zip_code) values
 ('10000000-0000-0000-0000-000000000001','a@x','00000000-0000-0000-0000-000000097702','97702');
insert into public.user_subscriptions values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000097702','maps','t','explicit',0,now());
-- an UNSUBSCRIBED maps subscriber (must NOT be added)
insert into public.users (id, email, community_id, zip_code, unsubscribed) values
 ('10000000-0000-0000-0000-000000000002','b@x','00000000-0000-0000-0000-000000084336','84336', true);
insert into public.user_subscriptions values
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000084336','maps','t','explicit',0,now());
