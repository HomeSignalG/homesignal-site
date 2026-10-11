-- Stand-ins for what scripts/verify-canary-recovery.sql READS: the cache, the ledger's identity/recovery/readiness tables and the
-- reportable-event view. app_source_key here has the SAME first branch as production (btrim(source_id)), which is all these
-- fixtures use; the script's job is the set comparison, not key derivation.
drop table if exists public.development_reports, public.dev_change_recovery, public.dev_change_project,
                     public.dev_change_event_reportable, public.dev_change_scope_ready cascade;
create table public.development_reports (zip text primary key, sites jsonb not null default '[]');
create table public.dev_change_project (identity_key text primary key, registry_id text);
create table public.dev_change_recovery (identity_key text primary key, zip text, outcome text, classified_at timestamptz);
create table public.dev_change_event_reportable (identity_key text, event_type text, material boolean);
create table public.dev_change_scope_ready (zip text, registry_id text, lapsed_at timestamptz);
create or replace function public.app_source_key(el jsonb) returns text language sql immutable as
$$ select nullif(btrim(el->>'source_id'), '') $$;
create or replace function public.rs(p_zip text, p_stamped text[], p_unstamped text[] default '{}') returns void language sql as $$
  insert into public.development_reports (zip, sites)
  select p_zip, coalesce((select jsonb_agg(jsonb_build_object('source_id', k, 'relevance','development','scope','point','scope_origin','polygon_member','source_registry_id','rg')) from unnest(p_stamped) k), '[]'::jsonb)
              || coalesce((select jsonb_agg(jsonb_build_object('source_id', k, 'relevance','development','scope','point','source_registry_id','rg')) from unnest(p_unstamped) k), '[]'::jsonb)
$$;
create or replace function public.rl(p_zip text, p_keys text[], p_ready boolean default true, p_announced boolean default false) returns void language plpgsql as $$
declare k text;
begin
  foreach k in array p_keys loop
    insert into public.dev_change_project values (k, 'rg');
    insert into public.dev_change_recovery values (k, p_zip, 'coverage_recovered', '2026-10-11 05:00+00');
    if p_announced then insert into public.dev_change_event_reportable values (k, 'first_detected', true); end if;
  end loop;
  if p_ready then insert into public.dev_change_scope_ready values (p_zip, 'rg', null); end if;
end $$;
-- 71001 good
select public.rs('71001', array['a:1','a:2'], array['a:legacy']); select public.rl('71001', array['a:1','a:2']);
-- 71002 an expected key was not recovered
select public.rs('71002', array['b:1','b:2']); select public.rl('71002', array['b:1']);
-- 71003 an UNEXPECTED key was recovered (and stamped)
select public.rs('71003', array['c:1','c:9']); select public.rl('71003', array['c:1','c:9']);
-- 71004 a recovered key was ANNOUNCED
select public.rs('71004', array['d:1']); select public.rl('71004', array['d:1'], true, true);
-- 71005 nothing recovered at all (collection could have passed; the ledger never ran)
select public.rs('71005', array['e:1']);
-- 71006 the cache stamps a key the operator did not expect (and the ledger recovered only the expected one)
select public.rs('71006', array['f:1','f:2']); select public.rl('71006', array['f:1']);
-- 71007 readiness was not established
select public.rs('71007', array['g:1']); select public.rl('71007', array['g:1'], false);
