-- ============================================================================
-- DEVELOPMENT CHANGE BASELINE  (Development Activity plan, Order D — 2026-09-30)
-- The driver that walks the 12,722 canonical ZIPs into the change ledger, the per-ZIP cursor
-- that makes the walk resumable, and the per-source evidence view. SQL OF RECORD.
--
-- Builds on docs/dev-change-ledger.sql (Order C), which must already be applied. It writes
-- NO ledger row itself: every project and event is still written by dev_change_observe_zip,
-- the ledger's only writer. This file only decides WHICH ZIP to observe next and WHEN TO STOP.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path") — nothing here re-decides a fact
-- another owner already decides:
--   the ZIP universe .......... public.canonical_zip_registry (12,722; a ZIP is never created here)
--   "the ZIP changed" ......... public.app_community_meta.updated_at, which app_refresh_zip
--                               upserts on every materialisation (the sweep's own ordering key)
--   ledger writes ............. public.dev_change_observe_zip (Order C)
--   per-source failure ........ public.dev_refresh_source_failures, written by the refresh
--                               (dev_refresh_collect). This file READS it; it records no failure
--                               of its own for a source.
--   capacity .................. the operator states the physical free disk, verified
--                               independently, exactly as docs/n5-generation-publish.sql does
--                               (2,048 MB safety floor). The database cannot verify that figure;
--                               it can only refuse to run without it, and it enforces its own
--                               byte budget on the ledger tables (which it CAN measure).
--
-- RULES THIS ENCODES (each pinned by test/dev_change_baseline_pg)
--   1. A ZIP is FIRST observed only inside a BASELINE run. A non-baseline run refuses a ZIP the
--      ledger has never observed, because every record on it would be written as material
--      `first_detected` news. The baseline is the only place a first sighting is not news.
--   2. A ZIP is due when it has never been observed, or its last attempt failed before any
--      success, or it was re-materialised after the last observation AND the last observation
--      is at least p_min_interval_hours old (default 24). Re-observation rewrites every record
--      of the ZIP (the ledger must track the newest retrieval instant to order later copies),
--      so the interval is a write-volume bound, not a freshness promise.
--   3. One bad ZIP never blocks the walk. A ZIP that raises is rolled back (its sub-transaction
--      writes nothing), recorded in the cursor with the error text, and put behind the queue.
--   4. FAIL CLOSED on capacity. A baseline run refuses to start without a stated free-disk
--      figure of at least floor + the ledger budget; every run refuses without a ledger budget
--      and stops (not errors) when the ledger tables reach it.
--   5. A tick is bounded by ZIP count AND wall-clock seconds (always at least one ZIP), so one
--      call fits inside the database statement timeout (120 s for postgres) — call it from a
--      direct connection or pg_cron, never through PostgREST (8 s).
--   6. NO SCHEDULE IS ARMED HERE. Arming a recurring job is a separate reviewed act.
--   7. source health is EVIDENCE, not a label. The HEALTHY / STALE / ERROR / VERIFIED ZERO / UNKNOWN
--      words are defined by the founder's Maps workbook (Instructions, MEASUREMENT CONTRACT), at
--      (ZIP x feed family) grain, and its CHANGE CONTROL forbids an agent redefining them. For the
--      development family that contract records NO approved freshness SLA (SLA_UNDEFINED) and NO
--      freshness source field ("submitted_at is a filing date, not source freshness"), and the
--      refresh logs failures but not successes. So no label is computed here and no threshold is
--      invented: the view exposes the counts, over the windows the workbook itself uses (24 hours
--      and 14 days), from which the workbook's own audit assigned ERROR and UNKNOWN.
--
-- ADDITIVE ONLY. Creates one table, one view and one function; sets one storage parameter
-- (fillfactor) on the ledger's own project table so its frequent whole-table rewrites can be
-- HOT updates. Alters and writes no other existing object. Idempotent.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) -----------------------------------------------------
do $pre$
declare _missing text;
begin
  if to_regprocedure('public.dev_change_observe_zip(text, uuid)') is null then
    raise exception 'dev_change_baseline: docs/dev-change-ledger.sql (Order C) is not applied';
  end if;
  select string_agg(x, ', ') into _missing from (
    select 'canonical_zip_registry.zip' x
     where not exists (select 1 from information_schema.columns where table_schema = 'public'
                        and table_name = 'canonical_zip_registry' and column_name = 'zip')
    union all
    select 'app_community_meta.' || c from unnest(array['zip', 'updated_at']) c
     where not exists (select 1 from information_schema.columns where table_schema = 'public'
                        and table_name = 'app_community_meta' and column_name = c)
    union all
    select 'dev_refresh_source_failures.' || c
      from unnest(array['registry_id', 'kind', 'blocked_update', 'seen_at']) c
     where not exists (select 1 from information_schema.columns where table_schema = 'public'
                        and table_name = 'dev_refresh_source_failures' and column_name = c)
  ) m;
  if _missing is not null then
    raise exception 'dev_change_baseline: missing %', _missing;
  end if;
end $pre$;

-- ---- 1. THE PER-ZIP CURSOR ----------------------------------------------------------------
create table if not exists public.dev_change_zip_cursor (
  zip             text primary key,
  status          text not null check (status in ('ok', 'error')),
  first_ok_at     timestamptz,                       -- set once, on the first SUCCESSFUL observation
  observed_at     timestamptz not null,              -- the last attempt (success or error)
  materialized_at timestamptz,                       -- app_community_meta.updated_at read at the last SUCCESS
  last_run_id     uuid not null references public.dev_change_run (id),
  rows_read       integer not null default 0,
  identities_seen integer not null default 0,
  error           text,
  updated_at      timestamptz not null default now(),
  constraint dev_change_zip_cursor_shape check (
    (status = 'ok' and first_ok_at is not null and materialized_at is not null and error is null)
    or (status = 'error' and error is not null))
);

-- The project table is rewritten in place on every re-observation of a record. Leaving room in
-- each page lets those be HOT updates (no index entry, no bloat of the primary key).
alter table public.dev_change_project set (fillfactor = 80);

-- ---- 2. THE DRIVER --------------------------------------------------------------------------
create or replace function public.dev_change_tick(
  p_run                  uuid,
  p_max_zips             integer,
  p_max_seconds          integer,
  p_ledger_budget_mb     bigint,
  p_verified_free_disk_mb bigint default null,
  p_min_interval_hours   integer default 24
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  _floor_mb   constant bigint := 2048;      -- the same safety floor as docs/n5-generation-publish.sql
  _baseline   boolean;
  _t0         timestamptz := clock_timestamp();
  _ledger     bigint;
  _done       integer := 0;
  _errs       integer := 0;
  _rows       integer := 0;
  _events     integer := 0;
  _tried      text[] := '{}';
  _reason     text := 'none_due';
  _z          record;
  _res        jsonb;
  _left       integer;
begin
  if p_run is null then raise exception 'dev_change_tick: a run is required'; end if;
  if p_max_zips is null or p_max_zips < 1 or p_max_zips > 500 then
    raise exception 'dev_change_tick: p_max_zips must be 1..500 (got %)', p_max_zips;
  end if;
  if p_max_seconds is null or p_max_seconds < 1 or p_max_seconds > 100 then
    raise exception 'dev_change_tick: p_max_seconds must be 1..100, below the 120 s statement timeout (got %)', p_max_seconds;
  end if;
  if p_min_interval_hours is null or p_min_interval_hours < 1 then
    raise exception 'dev_change_tick: p_min_interval_hours must be >= 1 (got %)', p_min_interval_hours;
  end if;
  if p_ledger_budget_mb is null or p_ledger_budget_mb < 1 then
    raise exception 'dev_change_tick: a ledger byte budget (p_ledger_budget_mb) is required';
  end if;

  select r.baseline into _baseline from public.dev_change_run r
   where r.id = p_run and r.finished_at is null;
  if not found then raise exception 'dev_change_tick: run % is not open', p_run; end if;

  -- CAPACITY GATE. A baseline is the bulk write, so it needs the operator's independently
  -- verified physical free disk; an ordinary tick applies the same test only if a figure is given.
  if _baseline or p_verified_free_disk_mb is not null then
    if p_verified_free_disk_mb is null or p_verified_free_disk_mb < _floor_mb + p_ledger_budget_mb then
      raise exception 'CAPACITY GATE: p_verified_free_disk_mb is %, need >= % (% MB floor + % MB ledger budget). Nothing was written.',
        coalesce(p_verified_free_disk_mb::text, 'unset'), _floor_mb + p_ledger_budget_mb, _floor_mb, p_ledger_budget_mb;
    end if;
  end if;

  loop
    _ledger := pg_total_relation_size('public.dev_change_project') + pg_total_relation_size('public.dev_change_event')
             + pg_total_relation_size('public.dev_change_run')     + pg_total_relation_size('public.dev_change_zip_cursor');
    if _ledger >= p_ledger_budget_mb * 1048576 then _reason := 'ledger_budget'; exit; end if;
    if _done + _errs >= p_max_zips then _reason := 'max_zips'; exit; end if;
    if _done + _errs >= 1 and clock_timestamp() - _t0 >= make_interval(secs => p_max_seconds) then
      _reason := 'time'; exit;
    end if;

    select r.zip, m.updated_at as materialized_at into _z
      from public.canonical_zip_registry r
      join public.app_community_meta m on m.zip = r.zip
      left join public.dev_change_zip_cursor c on c.zip = r.zip
     where not (r.zip = any (_tried))
       and (c.zip is null
            or c.first_ok_at is null
            or (m.updated_at > c.materialized_at
                and c.observed_at < clock_timestamp() - make_interval(hours => p_min_interval_hours)))
       and (_baseline or c.first_ok_at is not null)
     order by c.observed_at nulls first, r.zip
     limit 1;
    if not found then _reason := 'none_due'; exit; end if;
    _tried := _tried || _z.zip;

    begin
      _res := public.dev_change_observe_zip(_z.zip, p_run);
      if _res->>'status' = 'busy' then _reason := 'busy'; exit; end if;
      insert into public.dev_change_zip_cursor as c
        (zip, status, first_ok_at, observed_at, materialized_at, last_run_id, rows_read, identities_seen, error)
      values (_z.zip, 'ok', clock_timestamp(), clock_timestamp(), _z.materialized_at, p_run,
              (_res->>'rows_read')::integer, (_res->>'identities_seen')::integer, null)
      on conflict (zip) do update
         set status = 'ok', first_ok_at = coalesce(c.first_ok_at, excluded.first_ok_at),
             observed_at = excluded.observed_at, materialized_at = excluded.materialized_at,
             last_run_id = excluded.last_run_id, rows_read = excluded.rows_read,
             identities_seen = excluded.identities_seen, error = null, updated_at = now();
      _done   := _done + 1;
      _rows   := _rows + (_res->>'rows_read')::integer;
      _events := _events + (_res->>'events_written')::integer;
    exception when others then
      -- this ZIP's writes were rolled back with its sub-transaction; record it and move on
      insert into public.dev_change_zip_cursor as c (zip, status, observed_at, last_run_id, error)
      values (_z.zip, 'error', clock_timestamp(), p_run, left(sqlerrm, 500))
      on conflict (zip) do update
         set status = 'error', observed_at = excluded.observed_at, last_run_id = excluded.last_run_id,
             error = excluded.error, updated_at = now();
      _errs := _errs + 1;
    end;
  end loop;

  select count(*) into _left
    from public.canonical_zip_registry r
    join public.app_community_meta m on m.zip = r.zip
    left join public.dev_change_zip_cursor c on c.zip = r.zip
   where c.first_ok_at is null;

  return jsonb_build_object(
    'status', case when _reason in ('busy', 'ledger_budget') then 'stopped' else 'ok' end,
    'stopped_reason', _reason,
    'baseline', _baseline,
    'zips_observed', _done,
    'zip_errors', _errs,
    'rows_read', _rows,
    'events_written', _events,
    'zips_never_observed', _left,
    'baseline_complete', (_left = 0),
    'ledger_bytes', _ledger,
    'seconds', round(extract(epoch from clock_timestamp() - _t0)::numeric, 3));
end
$fn$;

-- ---- 3. SOURCE EVIDENCE (a view, no stored state, no invented label) ----------------------------
-- One row per source family (registry_id). Ledger coverage from dev_change_project; failure
-- evidence from the refresh's own record. Only kinds that belong to a SOURCE are read: the
-- whole-report `fire_*` kinds are pipeline failures under a pseudo source and are not a source's
-- health. `retired` means the refresh dropped the source's cached records; the ledger keeps them
-- (absence is never an event) — this column is how that gap stays visible.
create or replace view public.dev_change_source_health with (security_invoker = true) as
with led as (
  select p.registry_id,
         count(*)                                                        as identities,
         count(*) filter (where p.comparable)                            as comparable,
         count(*) filter (where p.change_ready)                          as change_ready,
         count(*) filter (where p.non_comparable_reason = 'sibling_records')        as sibling_records,
         count(*) filter (where p.non_comparable_reason = 'non_durable_key_basis')  as non_durable_key_basis,
         min(p.first_observed_at)                                        as first_observed_at,
         max(p.last_observed_at)                                         as last_observed_at,
         -- The newest FILING date among the source's records (never a future placeholder). It is
         -- NOT a freshness field: the workbook's Feed Registry states submitted_at is a filing date,
         -- not source freshness. It is here so a person can see a source whose newest filing is years old.
         max(case when p.facts->>'submitted_at' ~ '^\d{4}-\d{2}-\d{2}$'
                   and (p.facts->>'submitted_at')::date <= current_date
                  then (p.facts->>'submitted_at')::date end)             as newest_filing_date
    from public.dev_change_project p
   group by p.registry_id
), fail as (
  select f.registry_id,
         count(*) filter (where f.kind = 'fetch_failed' and f.seen_at > now() - interval '24 hours')                       as fetch_failures_24h,
         count(*) filter (where f.kind = 'fetch_failed' and f.blocked_update and f.seen_at > now() - interval '24 hours')  as blocked_24h,
         count(*) filter (where f.kind = 'truncated'    and f.seen_at > now() - interval '24 hours')                       as truncated_24h,
         count(*) filter (where f.kind = 'fetch_failed' and f.seen_at > now() - interval '14 days')                        as fetch_failures_14d,
         count(*) filter (where f.kind = 'fetch_failed' and f.blocked_update and f.seen_at > now() - interval '14 days')   as blocked_14d,
         count(*) filter (where f.kind = 'truncated'    and f.seen_at > now() - interval '14 days')                        as truncated_14d,
         count(distinct f.zip) filter (where f.kind in ('fetch_failed', 'truncated') and f.seen_at > now() - interval '14 days') as zips_failed_14d,
         max(f.seen_at) filter (where f.kind = 'fetch_failed')                                                             as last_fetch_failure_at,
         bool_or(f.kind = 'retired')                                                                                       as retired_ever
    from public.dev_refresh_source_failures f
   where f.kind in ('fetch_failed', 'truncated', 'retired')
   group by f.registry_id
)
select coalesce(l.registry_id, f.registry_id)      as registry_id,
       coalesce(l.identities, 0)                   as identities,
       coalesce(l.comparable, 0)                   as comparable,
       coalesce(l.change_ready, 0)                 as change_ready,
       coalesce(l.sibling_records, 0)              as sibling_records,
       coalesce(l.non_durable_key_basis, 0)        as non_durable_key_basis,
       l.first_observed_at,
       l.last_observed_at,           -- the newest retrieval instant carried by the source's records: NOT proof the source itself was fetched
       l.newest_filing_date,
       coalesce(f.fetch_failures_24h, 0)           as fetch_failures_24h,
       coalesce(f.blocked_24h, 0)                  as blocked_24h,
       coalesce(f.truncated_24h, 0)                as truncated_24h,
       coalesce(f.fetch_failures_14d, 0)           as fetch_failures_14d,
       coalesce(f.blocked_14d, 0)                  as blocked_14d,
       coalesce(f.truncated_14d, 0)                as truncated_14d,
       coalesce(f.zips_failed_14d, 0)              as zips_failed_14d,
       f.last_fetch_failure_at,
       coalesce(f.retired_ever, false)             as retired_ever
  from led l
  full join fail f on f.registry_id = l.registry_id;

-- ---- 4. LOCK-DOWN: system-only, no anon, no authenticated -------------------------------------------
alter table public.dev_change_zip_cursor enable row level security;
revoke all on public.dev_change_zip_cursor from public, anon, authenticated, service_role;
grant select, insert, update on public.dev_change_zip_cursor to service_role;

revoke all on public.dev_change_source_health from public, anon, authenticated, service_role;
grant select on public.dev_change_source_health to service_role;

-- Every dev_change_ function, computed rather than typed (a list typed here would silently stop
-- covering the next function added). Re-run here so the new function is covered.
do $lock$
declare f record;
begin
  for f in select p.oid::regprocedure as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'dev\_change\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $lock$;

-- ROLLBACK (this file only; touches nothing else):
--   drop view if exists public.dev_change_source_health;
--   drop function if exists public.dev_change_tick(uuid, integer, integer, bigint, bigint, integer);
--   drop table if exists public.dev_change_zip_cursor;
--   alter table public.dev_change_project reset (fillfactor);
