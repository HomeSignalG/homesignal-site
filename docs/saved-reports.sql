-- ============================================================================
-- SAVED REPORTS  (Development Activity build step 6 — 2026-10-03)
-- SQL OF RECORD. Two READ-ONLY functions. No table, no column, no trigger, no schedule; nothing is written, charged or deleted.
-- Applying it needs docs/brokerage-account-spine.sql, docs/report-snapshot.sql and docs/evaluation-entitlement.sql (all applied
-- 2026-10-02). ADDITIVE ONLY, idempotent; ROLLBACK is at the foot.
--
-- WHAT IT IS
--   Every report that used a free report is already stored, once, with a permanent random id (public.report_snapshot.report_id,
--   Order F) and is linked to its brokerage's evaluation in the credit ledger (public.evaluation_credit, Order L1). What was missing
--   is a way for a member of that brokerage to see which reports their brokerage has and to open one again. These two functions are
--   that, and nothing more:
--     evaluation_reports_of(user)        the brokerage's stored reports, newest first: id, number, time, and the handle of the private
--                                        context (so the caller can show the address while the layer still keeps it).
--     evaluation_report_open(user, id)   ONE stored report, by its id, and only if that report is in the ledger of the caller's own
--                                        brokerage. Its stored text, byte for byte.
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   report_snapshot (the report, immutable) <- evaluation_credit (which brokerage's evaluation it belongs to) <- evaluation (the
--   standing) <- brokerage_membership_of (who the caller is). Decision owners, none duplicated here:
--     who the person is ......................... public.brokerage_membership_of (Order K0). Read, never re-derived. No email, no domain.
--     which brokerage a report belongs to ........ public.evaluation_credit. It is a join, not a copy: no owner column is added.
--     what the report says ....................... public.report_snapshot.body, returned as stored. Not recomputed, not re-rendered.
--     whether a report is charged ................ public.evaluation_report_issue. These functions cannot charge: they write nothing.
--     what the private layer keeps ............... public.report_private_context. These functions never name it; they return the opaque
--                                                  handle a stored snapshot already carries, and the caller asks the layer's own reader.
--
-- RULES THIS ENCODES (each pinned by test/trial_report_pg and test/saved-reports-structure.test.mjs)
--   1. A report is opened only through the caller's own brokerage. An id from another brokerage, an unknown id and a report that
--      was never charged (there is none: only a charged report is stored) all give ZERO rows: the caller cannot tell them apart.
--   2. Every member of a brokerage sees all of its reports (D-6-2). The ledger holds no user id by design (evaluation-entitlement
--      header: retaining an agent identity in a permanent trail is an open founder question), so "whose report" is not recorded.
--   3. Standing is the one the report function uses (_shared/admin-gate.ts trialStanding): an ACTIVE, unexpired evaluation, or a
--      COMPLETE one (its 10 reports are used; they stay readable). A revoked or expired evaluation shows nothing (D-6-3).
--   4. Reopening never charges and never writes: both functions are STABLE and read only.
--   5. The listing is bounded: at most evaluation_report_limit() rows exist per evaluation (the ledger's ordinal CHECK).
--   6. Nothing here is readable by anon or authenticated; both functions are executable by service_role alone.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD
--   No address, label, client, email, property key or coordinate is read or returned: the address stays in the private layer,
--   behind its own reader. The functions return a handle (the snapshot's private_context_id) and nothing derived from it.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.brokerage_membership_of(uuid)') is null
     or to_regprocedure('public.evaluation_report_limit()') is null
     or to_regclass('public.evaluation') is null
     or to_regclass('public.evaluation_credit') is null
     or to_regclass('public.report_snapshot') is null then
    raise exception 'saved_reports: apply docs/brokerage-account-spine.sql, docs/report-snapshot.sql and docs/evaluation-entitlement.sql first';
  end if;
end $pre$;

-- ---- 1. THE LIST ----------------------------------------------------------------------------------
-- The caller's brokerage's stored reports, newest first. `number` is the ledger ordinal (1 = the first report the brokerage made).
create or replace function public.evaluation_reports_of(p_user_id uuid)
returns table (report_id uuid, number integer, generated_at timestamptz, private_context_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.report_id, c.ordinal, s.generated_at, s.private_context_id
    from public.brokerage_membership_of(p_user_id) r
    join public.evaluation e on e.brokerage_id = r.brokerage_id
    join public.evaluation_credit c on c.evaluation_id = e.evaluation_id
    join public.report_snapshot s on s.report_id = c.report_id
   where e.status = 'complete' or (e.status = 'active' and (e.expires_at is null or e.expires_at > now()))
   order by c.ordinal desc
$$;

-- ---- 2. OPEN ONE ----------------------------------------------------------------------------------
-- One stored report by its id, only through the caller's own brokerage. The body is the stored text, unchanged.
create or replace function public.evaluation_report_open(p_user_id uuid, p_report_id uuid)
returns table (report_id uuid, number integer, generated_at timestamptz, body text, private_context_id uuid)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.report_id, c.ordinal, s.generated_at, s.body, s.private_context_id
    from public.brokerage_membership_of(p_user_id) r
    join public.evaluation e on e.brokerage_id = r.brokerage_id
    join public.evaluation_credit c on c.evaluation_id = e.evaluation_id
    join public.report_snapshot s on s.report_id = c.report_id
   where s.report_id = p_report_id
     and (e.status = 'complete' or (e.status = 'active' and (e.expires_at is null or e.expires_at > now())))
$$;

-- ---- 3. LOCK-DOWN: system-only --------------------------------------------------------------------
-- Supabase's default privileges open every new function in `public` to anon and authenticated; revoke by name, grant service_role alone.
revoke all on function public.evaluation_reports_of(uuid)       from public, anon, authenticated, service_role;
revoke all on function public.evaluation_report_open(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.evaluation_reports_of(uuid)       to service_role;
grant execute on function public.evaluation_report_open(uuid, uuid) to service_role;

-- ---- 4. POST-CONDITION ----------------------------------------------------------------------------
do $post$
declare
  f   text;
  bad text;
begin
  foreach f in array array['public.evaluation_reports_of(uuid)', 'public.evaluation_report_open(uuid, uuid)'] loop
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                where p.oid = f::regprocedure and a.grantee <> p.proowner
                  and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
      raise exception 'saved_reports: % is executable by a role it should not be', f;
    end if;
    select p.provolatile::text into bad from pg_proc p where p.oid = f::regprocedure and p.provolatile <> 's';
    if bad is not null then raise exception 'saved_reports: % must be STABLE (it writes nothing)', f; end if;
    if not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) then
      raise exception 'saved_reports: % must be SECURITY DEFINER (the tables are closed to its caller)', f;
    end if;
  end loop;
end $post$;

-- ROLLBACK (this file only; it holds no data):
-- ROLLBACK-BEGIN
--   drop function if exists public.evaluation_report_open(uuid, uuid), public.evaluation_reports_of(uuid);
-- ROLLBACK-END
