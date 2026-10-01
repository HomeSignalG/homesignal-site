-- ============================================================================
-- DEVELOPMENT CHANGE LEDGER — THE REPORTABLE EVENTS  (Development Activity plan, decision 10 option (a))
-- SQL OF RECORD. One view: public.dev_change_event_reportable.
--
-- WHAT IT IS
--   The single definition of WHICH ledger events may be shown to a reader as changes. An event is
--   reportable only when it was written by an ORDINARY run. Every event written by a baseline run
--   is excluded, and so is any event that names no run at all.
--
-- WHY IT EXISTS (measured 2026-09-29, design doc docs/development-activity-change-baseline-2026-09-30.md §10)
--   The national baseline wrote 922,244 events. 959 of them were typed status_changed or
--   source_record_updated although nobody saw a change: they are differences between ZIP COPIES of
--   one record, materialised at different times, met inside the one baseline run. They are true
--   observations and the ledger keeps them (it is append-only and nothing may be deleted). What is
--   wrong is only calling them changes. `dev_change_event.is_baseline` cannot express this, because
--   those events carry is_baseline = false; the run they belong to is what says "this was the
--   baseline". So the reader rule is on the RUN, and this view is where it lives.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   public.app_projects -> dev_change_observe_zip (the ledger's ONLY writer) -> dev_change_event
--     -> [this view: which events may be shown as changes] -> the report reader (later units).
--   Decision owner for "may this event be shown as a change": THIS VIEW. A reader must select from it
--   and must not re-derive the rule from dev_change_event and dev_change_run itself.
--
-- RULES THIS ENCODES (each pinned by test/dev_change_reportable_pg and test/dev-change-reportable-structure.test.mjs)
--   1. The run is judged by the EVENT'S OWN run_id, never by the project's first or last run.
--      A record first seen in an ordinary run and later met again inside a baseline run keeps its
--      ordinary first_detected event; a record baselined once and changed in an ordinary run keeps
--      that change.
--   2. An event with no run is not reportable (inner join). It cannot be classified, so it fails closed.
--   3. Nothing is deleted, updated or re-typed. The ledger is untouched; this file only READS it.
--   4. The view carries the event's own columns and nothing else, so it adds no fact of its own.
--
-- WHAT THIS DOES NOT DECIDE (recorded, not solved)
--   An ORDINARY run re-observes ZIP copies as well, so the same cross-copy disagreements can appear
--   there as change events, and this view would show them. Whether the writer should resolve copies
--   that disagree to the newest materialisation without an event (decision 10 option (b)) is a change
--   to dev_change_observe_zip and is not made here. It must be settled before a recurring job is armed.
--
-- ADDITIVE ONLY. Creates one view. Alters no table, writes no row, arms no schedule.
-- Idempotent: safe to run twice. ROLLBACK is at the foot of this file.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------
do $pre$
declare _missing text;
begin
  if to_regprocedure('public.dev_change_observe_zip(text, uuid)') is null then
    raise exception 'dev_change_reportable: the Order C ledger (dev_change_observe_zip) is not installed';
  end if;
  select string_agg(t || '.' || c, ', ') into _missing
    from (values
      ('dev_change_event', 'id'), ('dev_change_event', 'identity_key'), ('dev_change_event', 'event_type'),
      ('dev_change_event', 'material'), ('dev_change_event', 'is_baseline'), ('dev_change_event', 'observed_at'),
      ('dev_change_event', 'prev_facts'), ('dev_change_event', 'new_facts'), ('dev_change_event', 'prev_fp'),
      ('dev_change_event', 'new_fp'), ('dev_change_event', 'changed_fields'), ('dev_change_event', 'publisher_event_type'),
      ('dev_change_event', 'publisher_event_date'), ('dev_change_event', 'source_id'),
      ('dev_change_event', 'derivation_version'), ('dev_change_event', 'facts_version'),
      ('dev_change_event', 'rights_class'), ('dev_change_event', 'run_id'), ('dev_change_event', 'created_at'),
      ('dev_change_run', 'id'), ('dev_change_run', 'baseline')) v(t, c)
   where not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = v.t and column_name = v.c);
  if _missing is not null then
    raise exception 'dev_change_reportable: the ledger is missing column(s): %', _missing;
  end if;
end $pre$;

-- ---- 1. THE VIEW --------------------------------------------------------------
create or replace view public.dev_change_event_reportable with (security_invoker = true) as
select e.id, e.identity_key, e.event_type, e.material, e.is_baseline, e.observed_at,
       e.prev_facts, e.new_facts, e.prev_fp, e.new_fp, e.changed_fields,
       e.publisher_event_type, e.publisher_event_date, e.source_id,
       e.derivation_version, e.facts_version, e.rights_class, e.run_id, e.created_at
  from public.dev_change_event e
  join public.dev_change_run r on r.id = e.run_id
 where not r.baseline;

-- ---- 2. LOCK-DOWN: system-only ------------------------------------------------
-- Supabase's default privileges grant every new relation in `public` to anon and authenticated
-- (and everything to service_role). Revoke by name, then grant back the one thing the reader needs.
revoke all on public.dev_change_event_reportable from public, anon, authenticated, service_role;
grant select on public.dev_change_event_reportable to service_role;

-- ROLLBACK (this file only; touches nothing else):
--   drop view if exists public.dev_change_event_reportable;
