-- Disposable stand-ins for what docs/dev-change-recovery.sql READS beyond the ledger fixtures:
-- the cached report (sites + refreshed_at), dev_sites_deduped over it, and app_source_key (the REAL function,
-- extracted from docs/app-projects-stable-key-migration.sql by run.sh before this file runs).
create table if not exists public.development_reports (
  zip          text primary key,
  sites        jsonb not null default '[]'::jsonb,
  refreshed_at timestamptz
);
-- stand-in for public.dev_sites_deduped, with the PRODUCTION shape: a STABLE SQL function (provolatile 's'), so inside one
-- statement it reads the caller's snapshot. `test.dsd_sleep` makes it slow so a concurrent writer can be interleaved.
create or replace function public.dev_sites_deduped(p_zip text) returns table (el jsonb)
language sql stable as $$
  select e from public.development_reports d, jsonb_array_elements(d.sites) e,
         (select case when nullif(current_setting('test.dsd_sleep', true), '') is not null
                      then pg_sleep(current_setting('test.dsd_sleep')::float8) end) s
   where d.zip = p_zip
$$;

-- A cache refresh followed (optionally) by the materialisation of it, as dev_refresh_collect + app_refresh_zip do:
-- the cache gets the sites and refreshed_at; app_projects gets one row per site keyed by app_source_key, every row's
-- provenance.refreshed_at = the cache's refreshed_at; rows whose key is no longer in the set are removed (the reaper).
create or replace function public.sim_refresh(p_zip text, p_sites jsonb, p_at timestamptz, p_materialize boolean default true)
returns void language plpgsql as $$
begin
  insert into public.development_reports (zip, sites, refreshed_at) values (p_zip, p_sites, p_at)
  on conflict (zip) do update set sites = excluded.sites, refreshed_at = excluded.refreshed_at;
  if not p_materialize then return; end if;
  delete from public.app_projects a where a.zip = p_zip
     and not exists (select 1 from jsonb_array_elements(p_sites) e where public.app_source_key(e) = a.source_key);
  insert into public.app_projects (zip, name, type, status, stage, submitted_at, date_kind, address, record_kind, registry_id,
                                   provenance, source_key, source_key_basis, source_seq)
  select p_zip, e->>'label', 'Industrial', coalesce(e->>'status','Proposed'), e->>'stage',
         nullif(e->>'file_date','')::date, coalesce(e->>'date_kind', case when e->>'file_date' is not null then 'filed' end), e->>'address',
         'development', e->>'source_registry_id',
         jsonb_build_object('refreshed_at', p_at), public.app_source_key(e), public.app_source_key_basis(e), 1
    from jsonb_array_elements(p_sites) e
  on conflict (zip, source_key, source_seq) do update
     set name = excluded.name, status = excluded.status, stage = excluded.stage, submitted_at = excluded.submitted_at,
         date_kind = excluded.date_kind, address = excluded.address, provenance = excluded.provenance;
  insert into public.app_community_meta (zip, updated_at) values (p_zip, clock_timestamp())
  on conflict (zip) do update set updated_at = excluded.updated_at;
end $$;

create or replace function public.sim_site(p_id text, p_stage text, p_file date, p_stamped boolean default false, p_kind text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'source_id', 'arcgis:fixture:' || p_id, 'case_number', p_id, 'label', 'Permit ' || p_id,
    'stage', p_stage, 'file_date', p_file::text, 'address', p_id || ' Main St', 'scope', 'point',
    'relevance', 'development', 'record_url', 'https://example.test/' || p_id, 'source_registry_id', 'fixture',
    'date_kind', p_kind, 'scope_origin', case when p_stamped then 'polygon_member' end))
$$;

create or replace function public.sim_observe(p_zip text, p_baseline boolean default false) returns jsonb
language plpgsql as $$
declare r uuid; res jsonb;
begin
  r := public.dev_change_start_run(p_baseline, '{}'::jsonb);
  res := public.dev_change_observe_zip(p_zip, r);
  perform public.dev_change_finish_run(r);
  return res;
end $$;

-- generation helpers for the synchronisation scenarios
create or replace function public.sim_set_generation(p_zip text, p_keys text[], p_value text) returns void
language sql as $$
  update public.app_projects a set provenance = case when p_value is null then a.provenance - 'refreshed_at'
                                                     else jsonb_set(a.provenance, '{refreshed_at}', to_jsonb(p_value)) end
   where a.zip = p_zip and a.record_kind = 'development' and a.source_key = any(p_keys)
$$;
