-- Helpers shared by suite.sql (restart heal) and cap.sql (batch cap). psql \ir'd.

create function pg_temp.reset() returns void language plpgsql as $$
begin
  truncate public.development_reports, net._http_response, public.dev_refresh_source_failures;
end $$;
create function pg_temp.row_(z text, cursor_ bigint) returns void language sql as $$
  insert into public.development_reports (zip, sites, counts, refreshed_at, last_collected_response_id)
  values (z, '[]', '{"development":0}', now() - interval '3 days', cursor_);
$$;
create function pg_temp.resp(rid bigint, z text) returns void language sql as $$
  insert into net._http_response (id, status_code, content, created)
  values (rid, 200, json_build_object('zip', z, 'mode', 'zip', 'sites', '[]'::json,
                                      'counts', json_build_object('development', 0))::text, now());
$$;
create function pg_temp.cur(z text) returns bigint language sql as $$
  select last_collected_response_id from public.development_reports where zip = z;
$$;
create function pg_temp.saved(z text) returns boolean language sql as $$
  select refreshed_at > now() - interval '1 minute' from public.development_reports where zip = z;
$$;
