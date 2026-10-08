-- ============================================================================
-- REPORT HEADER  (Development Activity build step 7 — 2026-10-03)
-- SQL OF RECORD. ONE READ-ONLY function. No table, no column, no trigger, no schedule; nothing is written, charged or deleted.
-- Applying it needs docs/brokerage-account-spine.sql (applied 2026-10-02). ADDITIVE ONLY, idempotent; ROLLBACK is at the foot.
--
-- WHAT IT IS
--   A report shown to a brokerage's member carries a header: the brokerage's name and the name of the agent looking at it. This function
--   answers exactly that, for one signed-in person:
--     report_header_of(user)   (brokerage_name, agent_name) — the name of the brokerage the person is an active member of, and the
--                              name the person has given themselves (or NULL).
--
-- CANONICAL TRUTH PATH (CLAUDE.md "one canonical truth path")
--   brokerage name ... public.brokerage_account.name (Order K0), reached ONLY through the one membership resolver
--                      public.brokerage_membership_of. Read, never copied: renaming the account renames every header.
--   agent name ....... Supabase Auth, the one identity system (this repo adds no second): auth.users.raw_user_meta_data ->> 'full_name'.
--                      It is SELF-DECLARED (a person can always edit their own Auth metadata), so it is shown as "prepared by" text and
--                      never used to decide who may do anything. It is returned raw; the edge function cleans it (one place:
--                      _shared/evaluation-reads.ts cleanDisplayName).
--   client label ..... NOT here. It lives in the private layer (public.report_private_context.label) and is read through that layer's own
--                      reader. This function never names it.
--
-- RULES THIS ENCODES (each pinned by test/trial_report_pg and test/report-header-structure.test.mjs)
--   1. Header values are PRESENTATION, never stored. The permanent report (public.report_snapshot) is immutable and must not retain an
--      agent's identity (docs/evaluation-entitlement.sql: the ledger holds no user id, by design). So the header is read when a report is
--      shown, for the person looking, and written nowhere.
--   2. Only an ACTIVE member of an ACTIVE brokerage has a header (that is what the resolver returns). Anyone else gets ZERO rows.
--   3. Read-only: STABLE, no DML. Executable by service_role alone.
--
-- WHAT IT DELIBERATELY DOES NOT HOLD
--   No email, phone, address, client, label, property key or coordinate. No other member's name: the function takes ONE user id and
--   returns that person's own row.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------------------------
do $pre$
begin
  if to_regprocedure('public.brokerage_membership_of(uuid)') is null
     or to_regclass('public.brokerage_account') is null
     or to_regclass('auth.users') is null then
    raise exception 'report_header: apply docs/brokerage-account-spine.sql first (it needs the account, the resolver and auth.users)';
  end if;
end $pre$;

-- ---- 1. THE HEADER ----------------------------------------------------------------------------------
create or replace function public.report_header_of(p_user_id uuid)
returns table (brokerage_name text, agent_name text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.name, u.raw_user_meta_data ->> 'full_name'
    from public.brokerage_membership_of(p_user_id) r
    join public.brokerage_account a on a.id = r.brokerage_id
    left join auth.users u on u.id = p_user_id
$$;

-- ---- 2. LOCK-DOWN: system-only ----------------------------------------------------------------------
-- Supabase's default privileges open every new function in `public` to anon and authenticated; revoke by name, grant service_role alone.
revoke all on function public.report_header_of(uuid) from public, anon, authenticated, service_role;
grant execute on function public.report_header_of(uuid) to service_role;

-- ---- 3. POST-CONDITION ------------------------------------------------------------------------------
do $post$
declare
  f   constant text := 'public.report_header_of(uuid)';
  bad text;
begin
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = f::regprocedure and a.grantee <> p.proowner
                and (a.grantee <> (select oid from pg_roles where rolname = 'service_role') or a.privilege_type <> 'EXECUTE')) then
    raise exception 'report_header: % is executable by a role it should not be', f;
  end if;
  select p.provolatile::text into bad from pg_proc p where p.oid = f::regprocedure and p.provolatile <> 's';
  if bad is not null then raise exception 'report_header: % must be STABLE (it writes nothing)', f; end if;
  if not (select p.prosecdef from pg_proc p where p.oid = f::regprocedure) then
    raise exception 'report_header: % must be SECURITY DEFINER (the tables are closed to its caller)', f;
  end if;
end $post$;

-- ROLLBACK (this file only; it holds no data):
-- ROLLBACK-BEGIN
--   drop function if exists public.report_header_of(uuid);
-- ROLLBACK-END
