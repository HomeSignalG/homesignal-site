-- ============================================================================
-- SAVED REPORTS: REMOVE FROM MY LIST, AND RESTORE  (Development Activity, 2026-10-12)
-- SQL OF RECORD. One small table and three functions. NOT APPLIED: founder approval is required before it touches production.
-- Applying it needs docs/saved-reports.sql (and, in production, docs/brokerage-billing.sql, which splices the ownership reader). ADDITIVE ONLY,
-- idempotent; ROLLBACK is at the foot.
--
-- WHAT IT IS
--   An agent can take a report out of THEIR OWN Saved Reports list and put it back. "Archive" here means one thing: this person's list stops
--   showing the report. The report is not changed, not deleted, not refunded and not hidden from anyone else.
--     public.saved_report_archive          one row per (person, report) the person has removed from their own list. Nothing else.
--     saved_reports_listed(user, archived) the person's reports, EITHER the ones still on their list OR the ones they removed.
--     saved_reports_archive_set(user, ids, archived)   remove (true) or restore (false) a set of reports, all or nothing.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   Who may see a report is still decided in ONE place: public.evaluation_reports_of (docs/saved-reports.sql, spliced onto the combined free +
--   paid ledger by docs/brokerage-billing.sql), which goes through public.brokerage_membership_of. Both functions here CALL it; neither joins
--   the ledger, the membership table or the snapshot itself, so a later change to who owns a report cannot leave this file answering differently.
--   Decision owners, none duplicated here:
--     which reports the caller may see ......... public.evaluation_reports_of (membership + standing + ledger). Read, never re-derived.
--     what the report says / its number ........ public.report_snapshot / the ledger ordinal, returned by evaluation_reports_of unchanged.
--     what has been charged ..................... the credit ledgers. NOT TOUCHED: this file cannot reach them (it names neither table).
--
-- RULES THIS ENCODES (each pinned by test/saved_reports_archive_pg and test/saved-reports-archive-structure.test.mjs)
--   1. The archive is PER PERSON: (user_id, report_id). One member's removal changes nobody else's list. The user id is the caller's own, set by the
--      edge function from the verified sign-in, never taken from the request.
--   2. A report is archived or restored only if the caller can see it through evaluation_reports_of RIGHT NOW. An unknown id, another brokerage's
--      id, and the id of a person who has lost standing (removed from the brokerage, revoked or expired evaluation) are all NOT_FOUND, the same
--      for each. Nothing is changed when any id of the set is refused (all or nothing).
--   3. Idempotent and race-safe: archive is INSERT ... ON CONFLICT DO NOTHING, restore is DELETE of the person's own row. Repeating either, or two
--      sessions doing it at once, ends in the same state and never errors. The function returns how many rows THIS call changed.
--   4. Removing a report from a list charges nothing, refunds nothing and writes nowhere else: no ledger, no snapshot, no share, no watch, no
--      billing row. A share link and a property watch are keyed on the report, not on anyone's list, so they go on working.
--   5. The listing is filtered HERE (the server), not by the page. The default list is the reports not archived by this person; archived = true
--      is the reports they removed. A report that is both never appears in the default list or in a search of it.
--   6. The set is bounded (1 to 100 ids), matching the edge function's 4 KB request limit, so one call cannot be made large enough to hold a lock long.
--   7. Nothing here is readable by anon or authenticated; the table has no grant to any role and the functions are executable by service_role alone.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD
--   No address, label, client, email or property key. The row is two ids and a time.
--   This is NOT a privacy deletion: the report, its private context and its retention clock are exactly what they were
--   (docs/report-private-context-contract-2026-09-30.md). Account-data erasure is a separate workflow.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.evaluation_reports_of(uuid)') is null
     or to_regclass('public.report_snapshot') is null
     or to_regclass('auth.users') is null then
    raise exception 'saved_reports_archive: apply docs/saved-reports.sql (and its layers) first';
  end if;
end $pre$;

-- ---- 1. THE TABLE ---------------------------------------------------------------------------------
-- Removing a person's account removes their list state with it (on delete cascade); a report snapshot is never deleted, so the reference is
-- RESTRICT by default and can never cascade into a snapshot.
create table if not exists public.saved_report_archive (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  report_id   uuid        not null references public.report_snapshot (report_id),
  archived_at timestamptz not null default now(),
  constraint saved_report_archive_pk primary key (user_id, report_id)
);
alter table public.saved_report_archive enable row level security;
-- No policy and no grant: the table is reached only through the two SECURITY DEFINER functions below.
revoke all on table public.saved_report_archive from public, anon, authenticated, service_role;

-- ---- 2. THE LIST ----------------------------------------------------------------------------------
-- The caller's reports through the ONE ownership reader, filtered by THIS caller's own archive rows. p_archived = false (the default view) is
-- the reports they have not removed; true is the ones they have. Same columns and order as evaluation_reports_of.
create or replace function public.saved_reports_listed(p_user_id uuid, p_archived boolean default false)
returns table (report_id uuid, number integer, generated_at timestamptz, private_context_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.report_id, r.number, r.generated_at, r.private_context_id
    from public.evaluation_reports_of(p_user_id) r
   where exists (select 1 from public.saved_report_archive a where a.user_id = p_user_id and a.report_id = r.report_id)
         = coalesce(p_archived, false)
   order by r.number desc
$$;

-- ---- 3. REMOVE / RESTORE --------------------------------------------------------------------------
-- p_archived = true removes the reports from the caller's list, false puts them back. Returns the number of rows this call changed (0 when
-- everything was already in that state). Raises ARCHIVE_INVALID for an unusable set and NOT_FOUND when any id is not one the caller can see
-- now, changing nothing in either case.
create or replace function public.saved_reports_archive_set(p_user_id uuid, p_report_ids uuid[], p_archived boolean)
returns integer
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_ids     uuid[];
  v_n       integer;
  v_visible integer;
  v_changed integer;
begin
  if p_user_id is null or p_archived is null or p_report_ids is null or array_position(p_report_ids, null) is not null then
    raise exception 'ARCHIVE_INVALID';
  end if;
  select coalesce(array_agg(distinct x), '{}') into v_ids from unnest(p_report_ids) x;
  v_n := cardinality(v_ids);
  if v_n < 1 or v_n > 100 then raise exception 'ARCHIVE_INVALID'; end if;
  -- every id must be one the caller can see through the ONE ownership reader; otherwise nothing is changed
  select count(*) into v_visible from public.evaluation_reports_of(p_user_id) r where r.report_id = any (v_ids);
  if v_visible <> v_n then raise exception 'NOT_FOUND'; end if;
  if p_archived then
    insert into public.saved_report_archive (user_id, report_id)
    select p_user_id, x from unnest(v_ids) x
    on conflict (user_id, report_id) do nothing;
  else
    delete from public.saved_report_archive where user_id = p_user_id and report_id = any (v_ids);
  end if;
  get diagnostics v_changed = row_count;
  return v_changed;
end
$$;

-- ---- 4. LOCK-DOWN: system-only --------------------------------------------------------------------
revoke all on function public.saved_reports_listed(uuid, boolean)            from public, anon, authenticated, service_role;
revoke all on function public.saved_reports_archive_set(uuid, uuid[], boolean) from public, anon, authenticated, service_role;
grant execute on function public.saved_reports_listed(uuid, boolean)            to service_role;
grant execute on function public.saved_reports_archive_set(uuid, uuid[], boolean) to service_role;

-- ---- 5. POST-CONDITION ----------------------------------------------------------------------------
do $post$
declare
  f text;
begin
  foreach f in array array['public.saved_reports_listed(uuid, boolean)', 'public.saved_reports_archive_set(uuid, uuid[], boolean)'] loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f::regprocedure and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
      raise exception 'saved_reports_archive: % is executable by a role it should not be', f;
    end if;
    if not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'saved_reports_archive: % must be SECURITY DEFINER', f;
    end if;
  end loop;
  if exists (select 1 from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'saved_report_archive'
                and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')) then
    raise exception 'saved_reports_archive: the table must have no grant to any request role';
  end if;
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.saved_report_archive'::regclass) then
    raise exception 'saved_reports_archive: row level security must be on';
  end if;
end $post$;

-- ROLLBACK (removes only what this file created; reports, ledgers, shares and watches are not touched):
-- ROLLBACK-BEGIN
--   drop function if exists public.saved_reports_archive_set(uuid, uuid[], boolean), public.saved_reports_listed(uuid, boolean);
--   drop table if exists public.saved_report_archive;
-- ROLLBACK-END
