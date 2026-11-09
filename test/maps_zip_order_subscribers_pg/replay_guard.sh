#!/usr/bin/env bash
# docs/maps-zip-order.sql must REFUSE to replay over the subscriber rule (it carries the old
# hs_set_maps_zip_order, which drops subscriber ZIPs). DISPOSABLE Postgres only.
#  1. on a fresh database the old file applies whole, and its function is the old body;
#  2. after docs/maps-zip-order-subscriber-zips.sql, replaying it with plain psql (no
#     ON_ERROR_STOP, the most forgiving runner) changes nothing.
set -euo pipefail
: "${PGHOST:?}" "${PGDATABASE:?}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
P() { psql -X -q "$@"; }
P -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end $$;
create schema auth;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
SQL
md5() { P -Atc "select md5(prosrc) from pg_proc where oid = 'public.hs_set_maps_zip_order(text[])'::regprocedure"; }
P -v ON_ERROR_STOP=1 -f "$root/docs/maps-zip-order.sql" >/dev/null 2>&1 || { echo "FAIL G1 the old file does not apply on a fresh database"; exit 1; }
[ "$(md5)" = "7eca7b452cc07fd9a071398051042154" ] || { echo "FAIL G1 the old file's function body changed: $(md5)"; exit 1; }
echo "PASS G1 fresh database: the old file applies whole (old body 7eca7b45…)"
P -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<'SQL'
create table public.communities (id uuid primary key default gen_random_uuid(), level text not null, zip_codes text[] not null);
create table public.users (id uuid primary key default gen_random_uuid(), email text, community_id uuid, zip_code text,
  alert_email_consent boolean not null default true, unsubscribed boolean not null default false);
create table public.user_subscriptions (user_id uuid, community_id uuid, stream text, topic text, origin text, sort_order integer, created_at timestamptz default now());
create view public.alert_subscription_state as
  select u.id as user_id, u.community_id, s.stream, s.topic,
         ((u.community_id is not null) and u.alert_email_consent and not u.unsubscribed and s.origin = 'explicit') as subscribed
    from public.users u join public.user_subscriptions s on s.user_id = u.id and s.community_id = u.community_id;
SQL
P -v ON_ERROR_STOP=1 -f "$root/docs/maps-zip-order-subscriber-zips.sql" >/dev/null 2>&1 || { echo "FAIL G2 the subscriber rule does not apply"; exit 1; }
before="$(md5)"
out="$(P -f "$root/docs/maps-zip-order.sql" 2>&1 || true)"
grep -q "superseded here" <<<"$out" || { echo "FAIL G2 the replay was not refused"; exit 1; }
[ "$(md5)" = "$before" ] || { echo "FAIL G2 the replay replaced hs_set_maps_zip_order ($before -> $(md5))"; exit 1; }
echo "PASS G2 replay over the subscriber rule refused; hs_set_maps_zip_order unchanged ($before)"
