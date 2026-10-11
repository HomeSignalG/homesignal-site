-- Scenario helpers for the receipt suite. DISPOSABLE database only. They only BUILD INPUT (a pg_net-shaped response row, a cached
-- ZIP row); every outcome the suite checks is produced by the LIVE collector and docs/dev-source-receipt.sql.
create or replace function public.t_rep(reg text, scope text, ver text, complete boolean, truncated int default null) returns jsonb
language sql as $$
  select jsonb_build_object('registry_id', reg, 'fetched', 5, 'quarantined', '[]'::jsonb, 'truncated_at_max_rows', truncated,
         'scope_receipt', jsonb_build_object('scope', scope, 'version', ver, 'complete', complete)) $$;
create or replace function public.t_exp(reg text, ver text) returns jsonb language sql as $$ select public.t_rep(reg, 'expanded', ver, true) $$;
create or replace function public.t_inc(reg text, ver text) returns jsonb language sql as $$ select public.t_rep(reg, 'expanded', ver, false) $$;
create or replace function public.t_fb(reg text)  returns jsonb language sql as $$ select public.t_rep(reg, 'fallback', null, false) $$;
create or replace function public.t_leg(reg text) returns jsonb language sql as $$ select public.t_rep(reg, 'legacy', null, true) $$;
create or replace function public.t_fail(reg text) returns jsonb language sql as $$
  select jsonb_build_object('registry_id', reg, 'fetched', 0, 'quarantined', jsonb_build_array(jsonb_build_object('reason', 'fetch failed: reset', 'sample', 's'))) $$;
create or replace function public.t_zip(z text, sites jsonb default '[]', counts jsonb default '{"development":0}', age interval default '1 day') returns void
language sql as $$
  insert into public.development_reports (zip, sites, counts, refreshed_at, last_collected_response_id)
  values (z, sites, counts, now() - age, null) on conflict (zip) do nothing $$;
-- a response as pg_net stores it; returns the id the cursor must come to name
create or replace function public.t_fire(z text, reports jsonb[] default '{}', counts jsonb default '{"development":0}', sites jsonb default '[]') returns bigint
language plpgsql as $$
declare id bigint := nextval('net.http_request_queue_id_seq');
begin
  insert into net._http_response (id, status_code, content, created)
  values (id, 200, jsonb_build_object('zip', z, 'mode', 'zip', 'sites', sites, 'counts', counts, 'arcgis_reports', to_jsonb(reports))::text, now());
  return id;
end $$;
create or replace function public.t_reset() returns void language plpgsql as $$
begin
  truncate public.development_reports, net._http_response, public.dev_refresh_source_failures, public.dev_source_continuity, public.dev_refresh_generation;
end $$;
