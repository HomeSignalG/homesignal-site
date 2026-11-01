-- ============================================================================
-- SOURCE FRESHNESS — per development source, plus this ZIP's own read status (SQL OF RECORD)
-- NOT APPLIED. Founder, 2026-11-01: build and test; apply only after final approval.
--
-- WHAT A PAGE SAYS, for each development source it reads (homesignalmap.html, ZIP pages):
--   1. the newest record date the source has given us        -> newest_record_date (source-wide)
--   2. the last time ANY read of the source completed         -> last_success_at    (source-wide)
--   3. whether THIS ZIP's own latest read of it completed      -> zip_read_state + its dates
-- Three separate facts, never merged:
--   * A recent check (2) never makes the data current: the newest record date (1) is shown beside it.
--   * A successful read elsewhere (2) never stands for this ZIP: (3) is read from this ZIP's own row.
-- Universal: keyed by registry_id; no source, ZIP or place is named in this file.
--
-- WHERE EACH VALUE COMES FROM (both already measured; nothing is re-decided here):
--   newest_record_date  public.dev_change_project (the change ledger): the newest submitted_at among the
--                       source's records whose date_kind says something happened (filed, issued, decided,
--                       awarded, completed). Scheduled, estimated, hearing and unstated dates never count;
--                       future dates never count. Measured 2026-11-01: portland-building-permits = 2026-10-01.
--   last_success_at     public.dev_source_continuity: newest last_tick_at over the source's per-ZIP rows
--                       whose latest read COMPLETED (complete, scope expanded/fallback/legacy).
--                       NOT dev_change_project.last_observed_at: that is a cache instant carried by
--                       records, which its own view says is "NOT proof the source itself was fetched".
--   zip_read_state      public.dev_source_continuity, the row for (this ZIP, this source). PK (zip, registry_id).
--
-- COST: newest_record_date scans dev_change_project (1.07M rows; the refresh measured ~9 s read-only), so it is stored in
-- dev_source_freshness and refreshed hourly. A page calls source_freshness_for_zip(), which reads that
-- small table plus this ZIP's continuity rows by primary key.
-- ROLLBACK: docs/source-freshness.rollback.sql.
-- ============================================================================

create table if not exists public.dev_source_freshness (
  registry_id        text primary key,
  newest_record_date date,
  ledger_records     bigint not null default 0,   -- records the ledger holds for the source (0 = not measured yet)
  last_success_at    timestamptz,
  computed_at        timestamptz not null default now()
);
-- A replay over an earlier version of this table adds the column.
alter table public.dev_source_freshness add column if not exists ledger_records bigint not null default 0;

-- Read only through source_freshness_for_zip(). No visitor grant on the table itself.
alter table public.dev_source_freshness enable row level security;
revoke all on public.dev_source_freshness from public, anon, authenticated;

create or replace function public.dev_source_freshness_refresh()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
as $fn$
declare n integer := 0;
begin
  -- One run at a time. A second run that starts while one is still working does nothing (returns -1)
  -- instead of waiting or writing the same rows twice.
  if not pg_try_advisory_xact_lock(hashtext('public.dev_source_freshness_refresh')) then
    return -1;
  end if;

  with ok as (
    select c.registry_id, max(c.last_tick_at) as last_success_at
      from public.dev_source_continuity c
     where c.complete and c.scope in ('expanded', 'fallback', 'legacy')
     group by c.registry_id
  ), seen as (
    -- Every source the ledger holds, and the newest date among records whose date says something
    -- HAPPENED (filed, issued, decided, awarded, completed). A scheduled, estimated or hearing date is
    -- a plan, not a record date, and a date of unstated kind says nothing: neither counts. Future
    -- dates never count. Same parse guard as dev_change_source_health.
    select p.registry_id,
           max(case when p.facts->>'date_kind' in ('filed', 'issued', 'decided', 'awarded', 'completed')
                     and p.facts->>'submitted_at' ~ '^\d{4}-\d{2}-\d{2}$'
                     and (p.facts->>'submitted_at')::date <= current_date
                    then (p.facts->>'submitted_at')::date end) as newest_record_date,
           count(*) as ledger_records
      from public.dev_change_project p
     where p.registry_id is not null
     group by p.registry_id
  ), ids as (
    select registry_id from ok union select registry_id from seen
  ), up as (
    insert into public.dev_source_freshness (registry_id, newest_record_date, ledger_records, last_success_at, computed_at)
    select i.registry_id, s.newest_record_date, coalesce(s.ledger_records, 0), ok.last_success_at, now()
      from ids i
      left join ok on ok.registry_id = i.registry_id
      left join seen s on s.registry_id = i.registry_id
    on conflict (registry_id) do update
       set newest_record_date = excluded.newest_record_date,
           ledger_records     = excluded.ledger_records,
           last_success_at    = excluded.last_success_at,
           computed_at        = excluded.computed_at
     where (dev_source_freshness.newest_record_date, dev_source_freshness.ledger_records, dev_source_freshness.last_success_at)
           is distinct from (excluded.newest_record_date, excluded.ledger_records, excluded.last_success_at)
    returning 1
  ), del as (
    -- A source neither table mentions any more is dropped, so a page never shows a dead source's dates.
    delete from public.dev_source_freshness f
     where f.registry_id not in (select registry_id from ids)
    returning 1
  )
  select (select count(*) from up) + (select count(*) from del) into n;
  return n;
end
$fn$;

-- Only the system runs it. Revoke from anon and authenticated BY NAME: Supabase's default privileges
-- grant EXECUTE to them directly, so a revoke from public alone is not a lock.
revoke all on function public.dev_source_freshness_refresh() from public, anon, authenticated;
grant execute on function public.dev_source_freshness_refresh() to service_role;

-- The page's one reader. p_zip: the ZIP page or Map 1 ZIP. p_ids: sources whose records the page shows
-- (Map 1 address mode, where there is no ZIP). Returns one row per source:
--   * every source with a continuity row for p_zip (a source read for this ZIP, even if it returned nothing)
--   * plus each p_ids source.
-- zip_read_state: 'complete' | 'failing' | 'not_reported' | 'retired' | 'not_read' (no row for this ZIP)
--                 | null (no ZIP was given).
-- Dropped first: a replay over an earlier version with different columns cannot replace it in place.
-- Its grants are re-applied below.
drop function if exists public.source_freshness_for_zip(text, text[]);
create or replace function public.source_freshness_for_zip(p_zip text, p_ids text[] default null)
returns table (
  registry_id        text,
  newest_record_date date,
  ledger_records     bigint,
  last_success_at    timestamptz,
  computed_at        timestamptz,
  zip_read_state     text,
  zip_last_read_at   timestamptz,
  zip_failing_since  timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  with z as (
    select case when p_zip ~ '^\d{5}$' then p_zip end as zip
  ), want as (
    select x as registry_id
      from unnest(coalesce(p_ids, '{}'::text[])) with ordinality u(x, i)
     where x ~ '^[a-z0-9][a-z0-9-]{0,99}$' and i <= 50
  ), zrow as (
    select c.registry_id, c.scope, c.complete, c.last_tick_at, c.impaired_since
      from public.dev_source_continuity c, z
     where c.zip = z.zip
  ), ids as (
    select registry_id from zrow union select registry_id from want
  )
  select i.registry_id,
         f.newest_record_date,
         coalesce(f.ledger_records, 0),
         f.last_success_at,
         f.computed_at,
         case
           when (select zip from z) is null then null
           when r.registry_id is null then 'not_read'
           when r.scope = 'retired' then 'retired'
           when r.scope = 'absent' then 'not_reported'
           -- A read that COMPLETED is complete here, even under a narrower fallback/legacy scope after an
           -- earlier break (impaired_since set): saying it "did not complete" would be false.
           when r.complete and r.scope in ('expanded', 'fallback', 'legacy') then 'complete'
           else 'failing'
         end,
         r.last_tick_at,
         case when r.registry_id is not null and r.scope not in ('absent', 'retired')
                   and not (r.complete and r.scope in ('expanded', 'fallback', 'legacy'))
              then coalesce(r.impaired_since, r.last_tick_at) end
    from ids i
    left join zrow r on r.registry_id = i.registry_id
    left join public.dev_source_freshness f on f.registry_id = i.registry_id
   order by i.registry_id collate "C"
$fn$;

revoke all on function public.source_freshness_for_zip(text, text[]) from public;
grant execute on function public.source_freshness_for_zip(text, text[]) to anon, authenticated, service_role;

-- Hourly at :41. Unschedule first so a replay never leaves two jobs.
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dev-source-freshness';
  perform cron.schedule('dev-source-freshness', '41 * * * *', 'select public.dev_source_freshness_refresh()');
end
$cron$;

select public.dev_source_freshness_refresh();
