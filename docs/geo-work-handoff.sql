-- ============================================================================
-- WORK HANDOFF — how a NEW or CHANGED live project reaches the reconciler.
--
-- PARKED. NOT APPLIED.
--
-- ----------------------------------------------------------------------------
-- THE FINDING: ALL THREE LIFECYCLE EVENTS ALREADY KNOW THE source_key, INSIDE
-- ONE FUNCTION, AT THE MOMENT THEY HAPPEN. Nothing needs rediscovering.
--
-- Traced in the live body of public.app_refresh_zip (line numbers from
-- pg_get_functiondef, 2026-09-19):
--
--   line  36  insert into public.app_projects (... source_key, source_seq,
--             last_seen_at) ... on conflict (zip, source_key, source_seq)
--             do update set ...            <- NEW **and** UPDATE, development
--   line 105  the same shape for facilities
--   line 153  delete from public.app_projects p
--             where p.zip=_zip and (p.last_seen_at is null or p.last_seen_at < _run)
--             and not exists (property_company_roles / project_facility_refs /
--                             identity_conflicts)          <- the STALE SWEEP
--   line 195  update public.app_projects set lat=null, lng=null
--                                                          <- the GEOCODE FENCE
--
-- ⛔ SO NO TRIGGER ON public.app_projects IS PROPOSED, AND THE MEASUREMENT IS
-- WHY: that table carries 48,366,569 recorded tuple writes (48,278,764 of them
-- updates) against 3,213,331 live rows. A statement trigger with a transition
-- table would sit on the materializer's hottest statement to learn something the
-- statement itself is already holding. `returning` costs nothing extra.
--
-- 🔑 THE GEOCODE FENCE AT LINE 195 IS THE ONE THAT WOULD HAVE BEEN MISSED. It
-- nulls lat/lng on a record whose geocode failed its fence. That is a COORDINATE
-- CHANGE with no insert and no delete - invisible to a NEW/DELETE-only handoff,
-- and invisible to a `not exists (n5_geom)` sweep because the key still has
-- geometry. It is exactly the blind spot Phase 6B identified, and here it is a
-- statement that already knows its own rows.
--
-- ----------------------------------------------------------------------------
-- WRITE-PATH COST. app_refresh_zip runs ~240 times/hour (dev_refresh_tick(8,20)
-- every 2 minutes). Each of the four sites gains one INSERT ... SELECT DISTINCT
-- into a small queue over rows the statement already produced. That is ~960
-- extra small inserts/hour against a table doing ~48M tuple writes - and each is
-- bounded by one ZIP's affected keys, not by the corpus.
--
-- ⚠️ A source_key can span ZIPs while app_refresh_zip is per-ZIP. That is FINE
-- and is not a partial handoff: the reconciler is source-key scoped and rebuilds
-- the whole key from all its evidence, so enqueuing from any one ZIP is
-- sufficient. Enqueuing it again from a sibling ZIP is an idempotent no-op.
-- ============================================================================

begin;

-- One queue, one meaning: A KEY THAT NEEDS EVALUATING. It never records
-- completion - completion is state equality, which the reconciler establishes.
-- A ledger that can say "done" while downstream state is wrong is the failure
-- this workstream exists to end.
create table if not exists geo.n5_reconcile_queue (
  source_key   text        not null primary key,
  reason       text        not null,
  enqueued_at  timestamptz not null default now(),
  claimed_at   timestamptz,
  claimed_by   text,
  constraint n5_reconcile_queue_reason_ck
    check (reason in ('project_upsert','stale_removed','geocode_nulled',
                      'registry_treatment_change','audit_sweep','manual'))
);
alter table geo.n5_reconcile_queue enable row level security;
create index if not exists n5_reconcile_queue_unclaimed_ix
  on geo.n5_reconcile_queue (enqueued_at) where claimed_at is null;

-- The enqueue, as ONE function so the four call sites cannot drift apart.
create or replace function geo.enqueue_work(_keys text[], _reason text)
returns integer
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $fn$
declare n integer;
begin
  if _keys is null or cardinality(_keys) = 0 then return 0; end if;
  insert into geo.n5_reconcile_queue (source_key, reason)
  select distinct k, _reason from unnest(_keys) k where k is not null
  on conflict (source_key) do update
     set enqueued_at = now(), claimed_at = null, claimed_by = null,
         reason = excluded.reason;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function geo.enqueue_work(text[], text) from public;

commit;

-- ============================================================================
-- THE FOUR SPLICES INTO public.app_refresh_zip — NOT APPLIED.
--
-- Applied by SPLICING the live pg_get_functiondef, never by replaying a dated
-- CREATE OR REPLACE from this repo: that function has been amended repeatedly
-- (the EPA plane split, the government-notice 365/730 window) and a replay would
-- silently revert whatever landed since. Fail closed on each anchor appearing
-- exactly once, and re-read the body afterwards.
--
--  (1) + (2) the two upserts — NEW and UPDATE:
--        wrap each `insert into public.app_projects ... on conflict ... do update`
--        in a CTE and add `returning source_key`, then
--        `perform geo.enqueue_work(array(select distinct source_key from up),
--                                  'project_upsert');`
--
--  (3) the stale sweep — DELETE:
--        `delete from public.app_projects p where ... returning p.source_key`
--        into a CTE, then enqueue with reason 'stale_removed'.
--        ⚠️ Enqueue the key even though the row is gone: that is the WHOLE point.
--        The reconciler asks the PROVEN adapter for expected geometry, gets
--        outcome 3 / SOURCE_REMOVED because no live row remains, and retires the
--        geography. Dropping the key here because "it no longer exists" is how
--        stale geography is left behind.
--
--  (4) the geocode fence at line 195 — COORDINATE CHANGE:
--        `update public.app_projects set lat=null, lng=null where ...
--         returning source_key`, enqueue with reason 'geocode_nulled'.
--
-- DELIBERATELY NOT INCLUDED, because each is already owned:
--   * no trigger on public.app_projects  (the statements already know the keys)
--   * no trigger on geo.n5_geom          (that table is the reconciler's OUTPUT;
--                                         triggering on it to create more
--                                         reconciliation work is circular, and no
--                                         lifecycle event is detectable ONLY there)
--   * no forward/reverse/drift anti-join sweeps as PRIMARY discovery — all three
--     lifecycles above are event-discoverable at a point that already holds the key
--
-- STILL REQUIRED, AND OUT OF SCOPE HERE:
--   * a bounded invariant AUDIT as a safety net for missed or partial work
--     (docs/geo-reconcile-discovery.sql::geo.n5_audit_sweep, already written)
--   * PERIODIC REACQUISITION for RECOVERY. A remote publisher can change geometry
--     with no local event of any kind: app_projects unchanged, treatment
--     unchanged, n5_geom present, nothing fires. No local change-detection can
--     see a remote-only change, so the honest answer is periodic refresh, and it
--     is a LATER requirement that does not block NEW/current propagation.
-- ============================================================================
