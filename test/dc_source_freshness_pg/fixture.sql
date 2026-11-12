-- Disposable stand-ins for what docs/dc-source-freshness.sql reads. Column names and types as in
-- production (docs/dc-step2a-foundation.sql), only the columns the reader names.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create table public.dc_source (
  source_key text primary key, publisher text not null, active_state text not null, distributions text[] not null);
create table public.dc_acquisition_run (
  id bigserial primary key, source_key text not null, distribution_key text not null,
  started_at timestamptz not null, completed_at timestamptz, completeness_state text,
  source_declared_freshness timestamptz, request_url text, failure_detail jsonb);
alter table public.dc_source enable row level security;
alter table public.dc_acquisition_run enable row level security;
revoke all on public.dc_source, public.dc_acquisition_run from public, anon, authenticated;

-- The production shape read 2026-11-12: Atlas's last complete read 11-06 (edition 11-05), then 404s.
insert into public.dc_source values
  ('compute_atlas', 'Compute Atlas (Edward Kubiak)', 'ACTIVE', '{facilities}'),
  ('epoch_ai', 'Epoch AI', 'ACTIVE', '{data_centers,timelines}'),
  ('retired_src', 'Retired', 'NOT_ACTIVE', '{d}'),
  ('never_read', 'Never Read', 'ACTIVE', '{d}');
insert into public.dc_acquisition_run (source_key, distribution_key, started_at, completed_at, completeness_state, source_declared_freshness, request_url, failure_detail) values
  ('compute_atlas','facilities','2026-11-05 09:44:44+00','2026-11-05 09:44:50+00','SUCCESS_COMPLETE','2026-11-04 20:15:59.2+00','https://secret.invalid/a',null),
  ('compute_atlas','facilities','2026-11-06 09:45:01+00','2026-11-06 09:45:05+00','SUCCESS_COMPLETE','2026-11-05 18:24:03.746+00','https://secret.invalid/a',null),
  ('compute_atlas','facilities','2026-11-11 09:44:20+00','2026-11-11 09:44:21+00','FETCH_FAILED',null,'https://secret.invalid/a','{"message":"HTTP 404"}'),
  ('compute_atlas','facilities','2026-11-12 09:44:17+00','2026-11-12 09:44:18+00','FETCH_FAILED',null,'https://secret.invalid/a','{"message":"HTTP 404"}'),
  ('epoch_ai','data_centers','2026-11-12 10:16:25+00','2026-11-12 10:16:26+00','SUCCESS_COMPLETE',null,'https://secret.invalid/e',null),
  ('epoch_ai','timelines','2026-11-12 10:16:27+00','2026-11-12 10:16:29+00','SUCCESS_COMPLETE',null,'https://secret.invalid/e',null),
  ('retired_src','d','2026-11-12 01:00:00+00','2026-11-12 01:00:01+00','SUCCESS_COMPLETE',null,null,null);
