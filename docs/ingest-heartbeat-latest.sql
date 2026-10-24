-- The EXTERNAL ingest heartbeat check reads ONE timestamp, not the table (2026-10-24).
--
-- check-ingest-heartbeat-external.yml read public.ingest_run_heartbeat with the public anon
-- key. Phase 1 of the anon read lockdown (homesignal-ingest 20260926204051) revoked anon SELECT
-- on that table, so the check has answered HTTP 401 (42501 permission denied) on every run since,
-- and the alarm meant to survive an ingest outage could not see one.
--
-- The lockdown stays: anon still cannot read the table. This function returns only the time of
-- the newest completed run for one workflow, the single value the check needs. No run_id, no row
-- counts, no detail.
-- Callers: scripts/check-ingest-heartbeat-external.mjs (rpc/ingest_heartbeat_latest).

create or replace function public.ingest_heartbeat_latest(p_workflow text)
returns timestamptz
language sql
stable
security definer
set search_path = pg_catalog, public
as $fn$
  select max(h.finished_at) from public.ingest_run_heartbeat h where h.workflow = p_workflow
$fn$;

revoke all on function public.ingest_heartbeat_latest(text) from public;
grant execute on function public.ingest_heartbeat_latest(text) to anon, authenticated, service_role;

comment on function public.ingest_heartbeat_latest(text) is
  'Newest finished_at in ingest_run_heartbeat for one workflow. The only heartbeat value the public key can read; see docs/ingest-heartbeat-latest.sql.';

do $check$
begin
  if has_table_privilege('anon', 'public.ingest_run_heartbeat', 'select') then
    raise exception 'anon can read ingest_run_heartbeat again; this function is meant to replace that read, not sit beside it';
  end if;
  if not has_function_privilege('anon', 'public.ingest_heartbeat_latest(text)', 'execute') then
    raise exception 'anon cannot execute ingest_heartbeat_latest';
  end if;
  if public.ingest_heartbeat_latest('ingest') is null then
    raise exception 'ingest_heartbeat_latest(''ingest'') returned NULL: no heartbeat row, or the function reads the wrong column';
  end if;
end $check$;
