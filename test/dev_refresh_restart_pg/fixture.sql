-- Minimal stand-in for what public.dev_refresh_collect() reads and writes. DISPOSABLE
-- database only. Column names and types are production's (information_schema,
-- 2026-09-28); the helper functions are stubs that change nothing, so a response is
-- written unless the cursor logic refuses it.
drop schema if exists net cascade;
drop schema if exists public cascade;
create schema public;
create schema net;

create sequence net.http_request_queue_id_seq;
create table net._http_response (
  id bigint primary key,
  status_code integer,
  content_type text,
  headers jsonb,
  content text,
  timed_out boolean,
  error_msg text,
  created timestamptz not null default now()
);

create table public.development_reports (
  zip text primary key,
  sites jsonb,
  counts jsonb,
  paywall boolean,
  echo jsonb,
  cwa jsonb,
  source_vintage text,
  refreshed_at timestamptz,
  last_collected_response_id bigint,
  facilities_refreshed_at timestamptz,
  facilities_unavailable boolean
);

create table public.epa_frs_probes (
  target text, ok boolean, probed_at timestamptz, resolved_at timestamptz
);
insert into public.epa_frs_probes values ('rural', true, now(), now());

create table public.dev_refresh_source_failures (
  zip text, registry_id text, reason text, cached_records int,
  blocked_update boolean, kind text, detail jsonb
);

create function public.dev_failed_sources(jsonb)
  returns table (registry_id text, reason text)
  language sql as $$ select null::text, null::text where false $$;
create function public.dev_truncated_sources(jsonb)
  returns table (registry_id text, cap int, fetched int)
  language sql as $$ select null::text, null::int, null::int where false $$;
create function public.dev_retired_sources(text, jsonb)
  returns table (registry_id text, cached_records int)
  language sql as $$ select null::text, null::int where false $$;
create function public.dev_epa_write_refused(boolean, jsonb, jsonb, timestamptz)
  returns boolean language sql as $$ select false $$;
create function public.dev_echo_merge_facility_sites(jsonb, jsonb, jsonb)
  returns jsonb language sql as $$ select $1 $$;
