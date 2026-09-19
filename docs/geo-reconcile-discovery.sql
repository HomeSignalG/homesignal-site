-- ============================================================================
-- PHASE 5 · DISCOVERY — how a source key reaches the reconciler, bounded.
--
-- PARKED. NOT APPLIED. Nothing here is scheduled, and creating these objects
-- arms nothing: the queue is inert until a caller drains it, and no caller is
-- wired. Applying this file is a separate, later decision.
--
-- ----------------------------------------------------------------------------
-- THE PROBLEM THIS SOLVES, STATED AS THE DEFECT IT REPLACES
--
-- Today the ONLY thing that turns a `geo.n5_geom` key into a
-- `geo.n5_boundary_membership` row is `scripts/n5_boundary_first.py`, which is
-- driven by ZIP3 PREFIX and intersects the whole national geometry corpus
-- against one prefix's boundaries. A key acquired after that prefix last ran is
-- invisible until some prefix pass happens to run again — and in a steady state
-- where reconciliation is source-key-scoped, nothing re-runs it. The key then
-- sits in `n5_geom` holding real authoritative geometry while appearing on no
-- resident-facing plane, and no instrument reports it.
--
-- The obvious fix — "each tick, anti-join n5_geom against the planes" — is
-- exactly what must NOT happen: that is an unbounded scan of a 1.2M-row table
-- against two ~1M-row tables on every tick, against a database whose
-- `dev-reports-rolling-refresh` is already degraded.
--
-- ----------------------------------------------------------------------------
-- THE SHAPE: DISCOVERY IS THE WORK LEDGER, NOT A SCAN OF THE DESTINATION
--
-- A key can only enter `geo.n5_geom` through an acquisition writer. If the
-- writer enqueues in the SAME TRANSACTION as its insert, then "a row exists in
-- n5_geom" implies "a queue row exists or existed", by construction rather than
-- by a scan. Discovery is then draining a queue in bounded batches.
--
-- Two things make that claim safe rather than merely tidy:
--
--   (a) the enqueue is a TRIGGER on `geo.n5_geom`, not a call the writer must
--       remember. A writer that forgets is the whole failure class here, and a
--       convention is not a control — this repository has paid for that lesson
--       on `feeds.csv`, on meetings enrollment, and on the collation pin.
--
--   (b) a BOUNDED AUDIT SWEEP walks the corpus in keyset-paginated slices, N
--       keys per tick, and re-enqueues anything that is in `n5_geom` and on no
--       plane. It is a safety net for the one case the trigger cannot cover —
--       rows that predate the trigger — and for any future writer that bypasses
--       it. It completes a full pass over many ticks and never scans the corpus
--       in one.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- the ledger
create table if not exists geo.n5_reconcile_queue (
  source_key   text        not null primary key,
  reason       text        not null,
  enqueued_at  timestamptz not null default now(),
  claimed_at   timestamptz,
  claimed_by   text,
  constraint n5_reconcile_queue_reason_ck
    check (reason in ('geometry_written','audit_sweep','registry_treatment_change',
                      'boundary_vintage_change','manual'))
);
alter table geo.n5_reconcile_queue enable row level security;
-- No grant to anon/authenticated/PUBLIC. The `geo` schema has none, and a queue
-- that anyone with the anon key could fill is the `page_cache` posture reached
-- by omission.

create index if not exists n5_reconcile_queue_unclaimed_ix
  on geo.n5_reconcile_queue (enqueued_at)
  where claimed_at is null;

comment on table geo.n5_reconcile_queue is
  'Phase 5 discovery ledger. A row here means a source key needs the four-stage '
  'reconcile. Filled by a trigger on geo.n5_geom (so a key cannot be written '
  'without being enqueued), by the bounded audit sweep, and by registry '
  'disposition changes. Drained in bounded batches; never scanned whole.';

-- --------------------------------------------------- (a) the enqueue trigger
--
-- STATEMENT-level, not row-level: an acquisition writes a key's features in one
-- multi-row insert, and a row trigger would fire once per feature to enqueue the
-- same key. Uses transition tables so the work is one set operation.
create or replace function geo.n5_enqueue_written_keys() returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  insert into geo.n5_reconcile_queue (source_key, reason)
  select distinct t.source_key, 'geometry_written' from changed_rows t
  on conflict (source_key) do update
     set enqueued_at = now(), claimed_at = null, claimed_by = null,
         reason = 'geometry_written';
  return null;
end $fn$;
revoke all on function geo.n5_enqueue_written_keys() from public;

drop trigger if exists zz_n5_geom_enqueue_ins on geo.n5_geom;
create trigger zz_n5_geom_enqueue_ins
  after insert on geo.n5_geom
  referencing new table as changed_rows
  for each statement execute function geo.n5_enqueue_written_keys();

drop trigger if exists zz_n5_geom_enqueue_upd on geo.n5_geom;
create trigger zz_n5_geom_enqueue_upd
  after update on geo.n5_geom
  referencing new table as changed_rows
  for each statement execute function geo.n5_enqueue_written_keys();

-- ⚠️ DELETE is deliberately covered by its OWN trigger reading the OLD table.
-- A key whose last feature is deleted must still be reconciled — that is the
-- A->none case, and it is the one where the planes have rows the geometry no
-- longer justifies. Leaving DELETE out would make removal the one transition
-- discovery cannot see, which is the direction that leaves stale resident-facing
-- rows rather than missing ones.
create or replace function geo.n5_enqueue_deleted_keys() returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  insert into geo.n5_reconcile_queue (source_key, reason)
  select distinct t.source_key, 'geometry_written' from changed_rows t
  on conflict (source_key) do update
     set enqueued_at = now(), claimed_at = null, claimed_by = null;
  return null;
end $fn$;
revoke all on function geo.n5_enqueue_deleted_keys() from public;

drop trigger if exists zz_n5_geom_enqueue_del on geo.n5_geom;
create trigger zz_n5_geom_enqueue_del
  after delete on geo.n5_geom
  referencing old table as changed_rows
  for each statement execute function geo.n5_enqueue_deleted_keys();

-- ------------------------------------------------- (b) the bounded audit sweep
--
-- Walks `geo.n5_geom` in keyset-paginated slices and enqueues any key that is
-- absent from BOTH resident-facing planes. `_batch` keys per call; the cursor is
-- the caller's, so a full pass is many small calls and never one large one.
--
-- 🔑 THE ANTI-JOIN IS AGAINST THE SLICE, NOT THE CORPUS. `_after` bounds the
-- n5_geom read, and the two `not exists` probes are per-key index lookups
-- (`zip_authoritative_*` need a (source_key) btree for that — see
-- docs/geo-phase5-reconciliation.md §7; without it each probe degrades to a
-- sequential scan and this function becomes the very thing it exists to avoid).
create or replace function geo.n5_audit_sweep(_after text default '', _batch int default 500)
returns table (last_key text, scanned int, enqueued int)
language plpgsql
set search_path = public, pg_temp
as $fn$
declare n_scanned int := 0; n_enq int := 0; last text;
begin
  if _batch is null or _batch < 1 or _batch > 5000 then
    raise exception 'n5_audit_sweep: _batch must be between 1 and 5000, got %', _batch;
  end if;

  create temp table if not exists _sweep_slice (source_key text primary key) on commit drop;
  delete from _sweep_slice;

  insert into _sweep_slice (source_key)
  select k.source_key from (
    select distinct g.source_key
      from geo.n5_geom g
     where g.source_key > _after
     order by g.source_key
     limit _batch) k;

  select count(*), max(source_key) into n_scanned, last from _sweep_slice;

  with orphan as (
    select s.source_key from _sweep_slice s
     where exists (select 1 from geo.n5_geom g
                    where g.source_key = s.source_key and g.outcome = 1 and g.geom is not null)
       and not exists (select 1 from geo.zip_authoritative_membership m where m.source_key = s.source_key)
       and not exists (select 1 from geo.zip_authoritative_marker k where k.source_key = s.source_key)),
  ins as (
    insert into geo.n5_reconcile_queue (source_key, reason)
    select o.source_key, 'audit_sweep' from orphan o
    on conflict (source_key) do nothing
    returning 1)
  select count(*) into n_enq from ins;

  return query select last, n_scanned, n_enq;
end $fn$;
revoke all on function geo.n5_audit_sweep(text, int) from public;

comment on function geo.n5_audit_sweep(text, int) is
  'Bounded discovery safety net. Enqueues keys that hold usable geometry but '
  'appear on neither resident-facing plane. Keyset-paginated: _after is the last '
  'key of the previous call. Never scans the corpus in one pass.';

-- ---------------------------------------------------------- draining, bounded
create or replace function geo.n5_claim_batch(_worker text, _batch int default 200)
returns table (source_key text)
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if _batch is null or _batch < 1 or _batch > 2000 then
    raise exception 'n5_claim_batch: _batch must be between 1 and 2000, got %', _batch;
  end if;
  return query
  update geo.n5_reconcile_queue q
     set claimed_at = now(), claimed_by = _worker
   where q.source_key in (
     select r.source_key from geo.n5_reconcile_queue r
      where r.claimed_at is null
      order by r.enqueued_at
      limit _batch
      for update skip locked)
  returning q.source_key;
end $fn$;
revoke all on function geo.n5_claim_batch(text, int) from public;

-- A claim is not a completion. The caller deletes only the keys it actually
-- reconciled; anything it claimed and did not finish stays claimed and is
-- released by the reaper below, so a crashed worker cannot silently swallow a
-- key. "Claimed forever" and "done" must never look the same.
create or replace function geo.n5_release_stale_claims(_older_than interval default '1 hour')
returns int
language plpgsql
set search_path = public, pg_temp
as $fn$
declare n int;
begin
  update geo.n5_reconcile_queue
     set claimed_at = null, claimed_by = null
   where claimed_at is not null and claimed_at < now() - _older_than;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke all on function geo.n5_release_stale_claims(interval) from public;

commit;

-- ============================================================================
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--
--   * no pg_cron job, no schedule, no caller — discovery is inert
--   * no seed of the historical backlog (that is a bounded one-time backfill,
--     forbidden in Phase 5 and not written here)
--   * no registry activation, no orphan cleanup, no change to any plane
-- ============================================================================
