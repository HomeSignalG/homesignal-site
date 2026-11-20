-- Stand-ins for production dependencies (shapes checked against production 2026-11-19: communities.zip_codes text[],
-- geo.zcta_boundary.zcta5 text, class/zip text columns). Supabase default privileges are REPLICATED so the revokes in the file are tested.
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema geo; create schema auth;
grant usage on schema public, geo, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create table public.bsky_maps_priority_classification(zip text, class text);
create table public.communities(id uuid default gen_random_uuid(), zip_codes text[]);
create table geo.zcta_boundary(zcta5 text);
create table public.dashboard_admins(email text);
-- tables the sync must NEVER touch
create table public.social_posts(id int, body text); create table public.app_projects(id int, v text);
create table public.email_deliveries(id int, v text); create table public.maps_zip_order(zip text, pos int); create table public.feeds(id int, v text);
insert into public.social_posts values (1,'a'); insert into public.app_projects values (1,'a'); insert into public.email_deliveries values (1,'a');
insert into public.maps_zip_order values ('11111',1); insert into public.feeds values (1,'a');
-- stand-in for Tab 2's reader (production's is created by docs/subscriber-zip-health.sql)
create table public._core_facts(zip text primary key, j jsonb);
create function public._hs_subscriber_zip_health_core() returns jsonb language plpgsql as $$
begin
  if coalesce(current_setting('test.fail_core', true), '') = '1' then raise exception 'simulated reader failure'; end if;
  return (select coalesce(jsonb_agg(j || jsonb_build_object('zip', zip)), '[]') from public._core_facts);
end $$;
create table public.t_res(n text, ok boolean);
