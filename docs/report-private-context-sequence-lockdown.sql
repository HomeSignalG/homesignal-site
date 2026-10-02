-- ============================================================================
-- REPORT PRIVATE CONTEXT — CLOSE THE EVENT COUNTER  (follow-up to docs/report-private-context.sql — 2026-10-02)
-- SQL OF RECORD. PARKED: NOT APPLIED to production by this file's own merge; applying it is a separate step with its own go.
--
-- THE GAP, MEASURED ON PRODUCTION 2026-10-02 (read-only)
--   public.report_private_context_event has `event_id bigint generated always as identity`, which owns a SEQUENCE,
--   report_private_context_event_event_id_seq. Supabase's default privileges grant every new sequence in `public` to anon,
--   authenticated and service_role. docs/report-private-context.sql locked down the three TABLES and the functions and never
--   named the sequence, so it kept the default grants: anon and authenticated both hold USAGE, SELECT and UPDATE on it, while the
--   table itself is closed to them. (Order J1's file, written afterwards, carries a loop for exactly this; this layer predates it.)
--   Measured across all 33 identity/serial sequences in `public`: 5 are in that state — this one, and four that belong to other
--   workstreams (dc_acquisition_run, local_news_geo_migration_rows, maps_dc_generation_request, source_document_events). This file
--   closes only the one that belongs to this layer; the other four are named in the status file for their owners.
--
-- WHY IT MATTERS (and how much, stated without inflation)
--   UPDATE on a sequence is setval(). A role that can call setval can push the counter to its maximum, after which every later
--   insert into the audit log fails — and the audit log is written by report_private_context_create, _need_open, _need_close and
--   _purge, so a maxed counter would make purge and creation fail. USAGE is nextval(), which burns ids and leaves gaps in an
--   append-only log. I know of NO REST route to either (PostgREST does not expose sequences, and pg_catalog.nextval is not in an
--   exposed schema); that was not tested end to end, because a successful test would itself move a production counter. It is a
--   hardening gap, not a known exposure, and it is closed here so the system-only claim in the contract is true of the counter too.
--
-- WHAT THIS DOES
--   Revokes every privilege on the sequence(s) owned by report_private_context* tables from public, anon, authenticated and
--   service_role. Computed from the dependency catalogue (the sequence an identity column owns), not typed, so a later sequence
--   on this layer is covered. The owner keeps its privilege, and every writer is a SECURITY DEFINER function owned by the owner,
--   so no writer changes behaviour. service_role has no INSERT on the event table (system-only), so it never needed the counter.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   It touches no table, no function, no row and no other schema object, and no sequence outside this layer. It is NOT a general
--   "close every sequence" fix: the four others belong to other workstreams, and revoking from a role their writers may rely on
--   without reading those writers would be a guess.
--
-- FAIL CLOSED. Refuses to run if the event table is absent. Refuses to report success if it found NO sequence to close (a loop
-- over nothing looks exactly like a loop that worked) or if any sequence of this layer is still usable by a role other than its
-- owner. ADDITIVE in effect (it only removes privileges nothing uses). Idempotent: safe to run twice. ROLLBACK is at the foot.
-- ============================================================================

-- ---- 0. PRECONDITION (fail closed) -------------------------------------------------------
do $pre$
begin
  if to_regclass('public.report_private_context_event') is null then
    raise exception 'report_private_context_sequence_lockdown: public.report_private_context_event does not exist (apply docs/report-private-context.sql first)';
  end if;
end $pre$;

-- ---- 1. CLOSE THE COUNTER(S), computed ---------------------------------------------------
-- A sequence "belongs to this layer" when a report_private_context* table's column owns it (an identity or serial column).
do $seq$
declare s record; n int := 0;
begin
  for s in select format('%I.%I', ns.nspname, sq.relname) as sq
             from pg_class sq
             join pg_namespace ns on ns.oid = sq.relnamespace
             join pg_depend d     on d.objid = sq.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i')
             join pg_class t      on t.oid = d.refobjid and t.relkind in ('r', 'p')
            where ns.nspname = 'public' and sq.relkind = 'S' and t.relname like 'report\_private\_context%' loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', s.sq);
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'report_private_context_sequence_lockdown: found no sequence owned by a report_private_context table (the layer has an identity column, so this is a broken lookup, not a clean result)';
  end if;
end $seq$;

-- ---- 2. POST-CONDITION (fail closed) -------------------------------------------------------
-- Computed, not typed: no grantee at all except the owner (this also covers PUBLIC and any privilege a newer PostgreSQL adds),
-- and the owner must still be able to use the counter, or every definer writer would stop working.
do $post$
declare s record; open_to text;
begin
  for s in select sq.oid, sq.relname, sq.relowner
             from pg_class sq
             join pg_namespace ns on ns.oid = sq.relnamespace
             join pg_depend d     on d.objid = sq.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a', 'i')
             join pg_class t      on t.oid = d.refobjid and t.relkind in ('r', 'p')
            where ns.nspname = 'public' and sq.relkind = 'S' and t.relname like 'report\_private\_context%' loop
    select string_agg(coalesce(r.rolname, 'PUBLIC'), ', ') into open_to
      from pg_class c, aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
      left join pg_roles r on r.oid = a.grantee
     where c.oid = s.oid and a.grantee <> c.relowner;
    if open_to is not null then
      raise exception 'report_private_context_sequence_lockdown: sequence % is still usable by %', s.relname, open_to;
    end if;
    if not has_sequence_privilege(s.relowner, s.oid, 'USAGE') then
      raise exception 'report_private_context_sequence_lockdown: the owner of sequence % lost USAGE (every definer writer would fail)', s.relname;
    end if;
  end loop;
end $post$;

-- ROLLBACK (this file only; restores Supabase's default grants, which is the gap above, so do it only to diagnose a writer):
--   grant all on sequence public.report_private_context_event_event_id_seq to anon, authenticated, service_role;
