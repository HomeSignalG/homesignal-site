-- Stand-ins for the production objects the view reads. Columns, RLS, ACLs and owner mirror production
-- as read on 2026-11-20 (postgres owner, RLS on with 0 policies, SELECT for service_role only).
drop role if exists anon, authenticated, service_role, dc_owner, no_base, rls_reader;
create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls; create role dc_owner nologin bypassrls;
create role no_base nologin;       -- holds SELECT on the view only (semantic-change probe; not a production role)
create role rls_reader nologin;    -- no BYPASSRLS, SELECT on view and base tables (RLS probe; not a production role)
grant usage on schema public to anon, authenticated, service_role, no_base, rls_reader;
grant create, usage on schema public to dc_owner;
set role dc_owner;
create table public.dc_acquisition_run(id uuid primary key, source_key text, distribution_key text, run_seq bigint,
  completeness_state text, advanced_observations boolean, source_contract jsonb, source_release_key text, content_release_key text);
create table public.dc_source_observation(home_signal_observation_id uuid primary key, acquisition_run_id uuid,
  source_key text, distribution_key text, publisher_record_id text, source_row_ordinal int, source_native_name text,
  source_native_type text, source_native_status text, source_native_operator text, source_native_lat float8,
  source_native_lon float8, source_native_precision text, raw_payload jsonb);
create table public.dc_source_admission_gate(source_key text, distribution_key text, primary key(source_key, distribution_key));
create function public.official_document_gate_open(g text, s text) returns boolean language sql stable as $$ select true $$;
create function public.dc_source_map_admitted(p_source_key text, p_distribution_key text)
returns boolean language sql stable security definer set search_path to 'public','pg_temp' as $fn$
  select case when exists (select 1 from public.dc_source_admission_gate g where g.source_key=p_source_key and g.distribution_key=p_distribution_key)
    then public.official_document_gate_open('G3_MAP_ADMISSION', p_source_key||'/'||p_distribution_key) else true end $fn$;
alter table public.dc_acquisition_run enable row level security;
alter table public.dc_source_observation enable row level security;
revoke all on public.dc_acquisition_run, public.dc_source_observation, public.dc_source_admission_gate from public;
revoke all on function public.dc_source_map_admitted(text,text) from public;
grant select on public.dc_acquisition_run, public.dc_source_observation to service_role;
grant execute on function public.dc_source_map_admitted(text,text) to service_role;
-- the state docs/dc-step3c-view-grants-fix.sql left the view in
create view public.dc_current_observation as
select o.home_signal_observation_id, o.acquisition_run_id, o.source_key, o.distribution_key, o.publisher_record_id,
  o.source_row_ordinal, o.source_native_name, o.source_native_type, o.source_native_status, o.source_native_operator,
  o.source_native_lat, o.source_native_lon, o.source_native_precision, o.raw_payload, r.run_seq, r.source_release_key, r.content_release_key
from public.dc_source_observation o join public.dc_acquisition_run r on r.id = o.acquisition_run_id;
alter view public.dc_current_observation set (security_invoker = true);
reset role;
-- seed (owner)
set role dc_owner;
insert into public.dc_acquisition_run values
 ('00000000-0000-0000-0000-0000000000a1','official_documents','official_listing',1,'SUCCESS_COMPLETE',true,'{"release_mode":"incremental"}','r1','c1'),
 ('00000000-0000-0000-0000-0000000000a2','compute_atlas','facilities',2,'SUCCESS_COMPLETE',true,'{}','r2','c2');
insert into public.dc_source_observation(home_signal_observation_id,acquisition_run_id,source_key,distribution_key,publisher_record_id,source_row_ordinal,source_native_name,raw_payload) values
 ('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1','official_documents','official_listing','p1',1,'Doc site','{}'),
 ('00000000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-0000000000a2','compute_atlas','facilities','p2',1,'Atlas site','{}');
reset role;
