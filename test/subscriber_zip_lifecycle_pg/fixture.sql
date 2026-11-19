create role anon nologin; create role authenticated nologin;
create schema geo; create extension if not exists pgcrypto;
create table public.bsky_maps_priority_classification(zip text, class text);
create table public.communities(id uuid default gen_random_uuid(), zip_codes text[]);
create table geo.zcta_boundary(zcta5 bpchar);
create table public.dashboard_admins(email text);
create or replace function auth_jwt_stub() returns jsonb language sql as $$ select '{}'::jsonb $$;
create schema if not exists auth; create or replace function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
-- stand-in for Tab 2's reader: returns facts keyed by a settings table
create table public._core_facts(zip text primary key, j jsonb);
create or replace function public._hs_subscriber_zip_health_core() returns jsonb language sql as $$ select coalesce(jsonb_agg(j || jsonb_build_object('zip', zip)), '[]') from public._core_facts $$;
