-- ============================================================================
-- SOURCE FRESHNESS — one row per development source (SQL OF RECORD)
--
-- Founder, 2026-11-01: a page that shows a source's records says, for that source,
--   * the newest record date the source has given us ("Latest available ... record"), and
--   * the last time a read of that source COMPLETED ("Last successful source check"),
-- separately, per source. Never one "stale" label for the whole page: each source carries
-- its own two dates. Universal, keyed by registry_id; no source is named here.
--
-- WHERE EACH DATE COMES FROM (both already measured by the change ledger, nothing re-decided):
--   newest_record_date  public.dev_change_source_health.newest_filing_date: the newest
--                       submitted_at (the source's own record date) carried by the source's
--                       records, future dates excluded. Measured 2026-11-01:
--                       portland-building-permits = 2026-10-01.
--   last_success_at     public.dev_source_continuity_state: the newest last_tick_at among the
--                       source's per-ZIP rows whose read COMPLETED (complete and scope in
--                       expanded / fallback / legacy). A failed or truncated read never counts.
--                       NOT dev_change_project.last_observed_at: that is the cache instant
--                       carried by records, which its own view says is "NOT proof the source
--                       itself was fetched".
--
-- WHY A TABLE: the newest-record aggregate scans dev_change_project (1.07M rows, ~7 s), far too
-- heavy for a page read. It is refreshed hourly; a page reads at most a handful of rows.
-- ============================================================================

create table if not exists public.dev_source_freshness (
  registry_id        text primary key,
  newest_record_date date,
  last_success_at    timestamptz,
  computed_at        timestamptz not null default now()
);

alter table public.dev_source_freshness enable row level security;
revoke all on public.dev_source_freshness from public, anon, authenticated;
grant select on public.dev_source_freshness to anon, authenticated;
drop policy if exists dev_source_freshness_read on public.dev_source_freshness;
create policy dev_source_freshness_read on public.dev_source_freshness
  for select to anon, authenticated using (true);

create or replace function public.dev_source_freshness_refresh()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare n integer;
begin
  with ok as (
    select c.registry_id, max(c.last_tick_at) as last_success_at
      from public.dev_source_continuity_state c
     where c.complete and c.scope in ('expanded', 'fallback', 'legacy')
     group by c.registry_id
  ), newest as (
    select h.registry_id, h.newest_filing_date
      from public.dev_change_source_health h
     where h.registry_id is not null
  ), ids as (
    select registry_id from ok union select registry_id from newest
  )
  insert into public.dev_source_freshness (registry_id, newest_record_date, last_success_at, computed_at)
  select i.registry_id, nw.newest_filing_date, ok.last_success_at, now()
    from ids i
    left join ok on ok.registry_id = i.registry_id
    left join newest nw on nw.registry_id = i.registry_id
  on conflict (registry_id) do update
     set newest_record_date = excluded.newest_record_date,
         last_success_at    = excluded.last_success_at,
         computed_at        = excluded.computed_at;
  get diagnostics n = row_count;
  return n;
end
$fn$;

-- Only the system refreshes it. Revoke from anon and authenticated BY NAME: Supabase's default
-- privileges grant EXECUTE to them directly, so a revoke from public alone is not a lock.
revoke all on function public.dev_source_freshness_refresh() from public, anon, authenticated;
grant execute on function public.dev_source_freshness_refresh() to service_role;

-- Hourly. Unschedule first so a replay never leaves two jobs.
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dev-source-freshness';
  perform cron.schedule('dev-source-freshness', '41 * * * *', 'select public.dev_source_freshness_refresh()');
end
$cron$;

select public.dev_source_freshness_refresh();
