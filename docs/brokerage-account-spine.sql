-- ============================================================================
-- BROKERAGE ACCOUNT SPINE  (Development Activity plan, Order K0 — 2026-10-01)
-- SQL OF RECORD. PARKED: NOT APPLIED to production. New schema in production needs its own founder go.
-- Two tables and one resolver: the answer to "who is this signed-in person, in the commercial sense?".
--
-- WHAT IT IS
--   public.brokerage_account   the commercial customer: one row per brokerage (id, name, status).
--   public.brokerage_member    an explicit membership of one Supabase Auth user in one brokerage, as an
--                              owner or an agent. A membership is active, or it was deactivated.
--   public.brokerage_membership_of(user_id)
--                              the ONE resolver: the user's active brokerage and role, or nothing.
--   The names are FIXED: Order L (the evaluation account, invites, entitlement, quota) hangs its rows off
--   brokerage_account and calls the resolver; it does not create account tables of its own (plan Hard Rules
--   30, 38-41: reuse existing authentication; membership is explicit; the brokerage owns the account).
--
-- WHAT IT DELIBERATELY DOES NOT HOLD
--   No street address, property key, report label, client name, email, email domain, credit, quota, price,
--   invite token, seat limit or billing state. Customer-entered private context lives only in the deletable
--   report_private_context layer (CLAUDE.md "Permanent historical intelligence", founder decision 2026-09-29);
--   no code in this file names that layer, a report, a Follow, or any resident table. Whose report is whose
--   (Order J) and what a brokerage may use (Orders L and M) are those orders' rows, not columns here.
--
-- THE INVARIANTS, by constraint and trigger (not by convention)
--   * A user holds at most ONE ACTIVE membership (partial unique index). An invite therefore cannot mint a
--     second 20-report pool for the same person (plan Hard Rules 38-39). A deactivated row does not block
--     re-joining, here or elsewhere. (Default D-K1.)
--   * role is exactly owner | agent; membership status is exactly active | deactivated; brokerage status is
--     exactly active | suspended | closed. (D-K2, D-K6.)
--   * A membership is active exactly when it has no deactivation time, and the deactivation time is stamped by
--     the database at the moment of deactivation, never taken from the caller.
--   * The LAST ACTIVE OWNER of an ACTIVE brokerage cannot be deactivated or demoted. Concurrent attempts on
--     two owners are serialised on the brokerage row, so both cannot pass the check and leave none. That holds
--     at READ COMMITTED, the only isolation level where waiting on the row lock also refreshes what the check
--     sees. At REPEATABLE READ or SERIALIZABLE the guard REFUSES any owner removal (errcode 55000) instead of
--     risking a brokerage left with no owner (measured on PostgreSQL 16: REPEATABLE READ left zero). Every
--     writer Order L adds must therefore remove owners at READ COMMITTED, the default.
--   * Identity columns (id, brokerage, user, joined time) never change, and a deactivated membership is
--     terminal: a person who leaves and returns is a NEW membership row. (D-K5.)
--   * Deleting an auth user (an account deletion or a privacy request) is never blocked by this spine: their
--     memberships go with them (ON DELETE CASCADE, as every resident table keyed to auth.users does). If that
--     was the last active owner, an active brokerage with no active owner is the stated, detectable result,
--     and what to do about it belongs to Order L. (D-K4.)
--   * Membership is by user id only. The resolver takes a user id, never an email or a domain.
--
-- ACCESS: system-only, STRICTER than the dashboard_admins posture (which revokes anon and authenticated only and
-- leaves service_role reading it directly). RLS on, NO policy, every privilege on both tables revoked from
-- public, anon, authenticated AND service_role: the only way in is the resolver, executable by service_role
-- alone, so every future writer is a SECURITY DEFINER function or a migration. Nothing in this file writes a row, and no caller exists: there are no writers until the
-- invite flow of Order L (D-K3). The tables are empty.
--
-- THE GATE IS UNCHANGED. supabase/functions/_shared/admin-gate.ts still answers "who may call an internal
-- function" from public.dashboard_admins. When Orders J and L land, the entitlement check replaces isAdmin in
-- THAT ONE place, and the resolver is read there and by the workspace and admin reads — never called directly
-- from a handler (so it cannot become a second gate).
--
-- ADDITIVE ONLY. Creates two tables, two indexes beside the primary keys, one trigger and two functions; alters
-- nothing that exists. Idempotent: safe to run twice. ROLLBACK is at the foot of this file.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) ------------------------------------------
do $pre$
begin
  if to_regprocedure('gen_random_uuid()') is null then
    raise exception 'brokerage_account_spine: gen_random_uuid() is not available';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'brokerage_account_spine: auth.users does not exist (Supabase Auth is the one identity system; this file adds no second one)';
  end if;
end $pre$;

-- ---- 1. THE BROKERAGE ACCOUNT ------------------------------------------------------------
create table if not exists public.brokerage_account (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null,
  status     text        not null default 'active',
  created_at timestamptz not null default now(),
  constraint brokerage_account_name   check (btrim(name) <> ''),
  constraint brokerage_account_status check (status in ('active', 'suspended', 'closed'))
);

-- ---- 2. THE MEMBERSHIP -------------------------------------------------------------------
create table if not exists public.brokerage_member (
  id             uuid        primary key default gen_random_uuid(),
  brokerage_id   uuid        not null references public.brokerage_account (id),
  user_id        uuid        not null references auth.users (id) on delete cascade,
  role           text        not null,
  status         text        not null default 'active',
  joined_at      timestamptz not null default now(),
  deactivated_at timestamptz,
  constraint brokerage_member_role         check (role in ('owner', 'agent')),
  constraint brokerage_member_status       check (status in ('active', 'deactivated')),
  constraint brokerage_member_deactivation check ((status = 'active') = (deactivated_at is null)),
  constraint brokerage_member_span         check (deactivated_at is null or deactivated_at >= joined_at)
);
-- One ACTIVE membership per user. A deactivated row is history and blocks nothing.
create unique index if not exists brokerage_member_one_active_per_user
  on public.brokerage_member (user_id) where status = 'active';
create index if not exists brokerage_member_by_brokerage
  on public.brokerage_member (brokerage_id);

-- ---- 3. THE GUARD ------------------------------------------------------------------------------
create or replace function public.brokerage_member_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.id <> old.id or new.brokerage_id <> old.brokerage_id or new.user_id <> old.user_id or new.joined_at <> old.joined_at then
    raise exception 'brokerage_member: identity columns cannot change (a person who moves brokerage is a new membership)' using errcode = '55000';
  end if;
  if old.status = 'deactivated' then
    raise exception 'brokerage_member: a deactivated membership is terminal (re-joining is a new membership)' using errcode = '55000';
  end if;
  if new.status = 'deactivated' then
    new.deactivated_at := now();                 -- stamped here, never taken from the caller
  end if;
  if old.role = 'owner' and (new.role <> 'owner' or new.status <> 'active') then
    -- The row lock below serialises two removals only if the waiter then re-reads committed data. Above READ
    -- COMMITTED the transaction keeps its old snapshot, so the second remover would still see the first owner
    -- active and both would commit. Refuse rather than allow that.
    if current_setting('transaction_isolation') <> 'read committed' then
      raise exception 'brokerage_member: removing or demoting an owner needs READ COMMITTED (the last-owner check cannot be serialised at %)',
        current_setting('transaction_isolation') using errcode = '55000';
    end if;
    -- Serialise concurrent removals of owners of ONE brokerage: without this, two sessions each deactivating a
    -- different owner both see the other still active, both pass, and none is left.
    perform 1 from public.brokerage_account a where a.id = old.brokerage_id for no key update;
    if exists (select 1 from public.brokerage_account a where a.id = old.brokerage_id and a.status = 'active')
       and not exists (select 1 from public.brokerage_member m
                        where m.brokerage_id = old.brokerage_id and m.id <> old.id and m.role = 'owner' and m.status = 'active') then
      raise exception 'brokerage_member: the last active owner of an active brokerage cannot be deactivated or demoted' using errcode = '55000';
    end if;
  end if;
  return new;
end $$;

create or replace trigger brokerage_member_guard_trg
  before update on public.brokerage_member
  for each row execute function public.brokerage_member_guard();

-- ---- 4. THE RESOLVER (the only way in) ---------------------------------------------------------
-- Who is this user, commercially? The active brokerage and role of an active member of an ACTIVE brokerage,
-- or no row. By user id only: it never matches an email or a domain. At most one row, by the index above.
create or replace function public.brokerage_membership_of(p_user_id uuid)
returns table (brokerage_id uuid, role text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select m.brokerage_id, m.role
    from public.brokerage_member m
    join public.brokerage_account a on a.id = m.brokerage_id
   where m.user_id = p_user_id and m.status = 'active' and a.status = 'active'
$$;

-- ---- 5. LOCK-DOWN: system-only --------------------------------------------------------------------
-- Supabase's default privileges grant every new table and function in `public` to anon and authenticated (and
-- everything to service_role). Revoke by name, enable RLS with no policy (deny by default), grant back nothing
-- on the tables, and grant execute on the resolver alone.
alter table public.brokerage_account enable row level security;
alter table public.brokerage_member  enable row level security;
revoke all on public.brokerage_account from public, anon, authenticated, service_role;
revoke all on public.brokerage_member  from public, anon, authenticated, service_role;

-- Every brokerage_member* function, computed rather than typed (a list typed here would silently stop covering
-- the next function added). The prefix is this file's own, so a later order's brokerage_* functions are not
-- re-locked when this file is applied again. A trigger function is executable by nobody.
do $lock$
declare f record;
begin
  for f in select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig,
                  (p.prorettype = 'trigger'::regtype) as is_trigger
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'brokerage\_member%' loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    if not f.is_trigger then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $lock$;

-- ---- 6. POST-CONDITION (fail closed) ---------------------------------------------------------------------
-- The one promise of this file is "unreadable by anon and authenticated". If a pre-existing table, a policy or
-- a grant left that false, the apply stops here rather than reporting success over it.
do $post$
declare t text; r text;
begin
  foreach t in array array['public.brokerage_account', 'public.brokerage_member'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = t::regclass) then
      raise exception 'brokerage_account_spine: row level security is not enabled on %', t;
    end if;
    if exists (select 1 from pg_policy where polrelid = t::regclass) then
      raise exception 'brokerage_account_spine: % has a policy; it must have none', t;
    end if;
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if exists (select 1 from pg_roles where rolname = r)
         and has_table_privilege(r, t, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') then
        raise exception 'brokerage_account_spine: role % holds a privilege on %', r, t;
      end if;
    end loop;
    -- Computed, not typed: no grantee at all except the owner (this also covers PUBLIC and privileges a newer
    -- PostgreSQL adds, such as MAINTAIN, which the typed list above does not name).
    if exists (select 1 from pg_class c, aclexplode(c.relacl) a where c.oid = t::regclass and a.grantee <> c.relowner) then
      raise exception 'brokerage_account_spine: % is accessible to a role other than its owner', t;
    end if;
  end loop;
end $post$;

-- ROLLBACK (this file only). It DELETES every brokerage account and membership, so anything a later order
-- hung off these tables (Order L's rows, Order J's ownership rows) must be rolled back FIRST:
--   drop function if exists public.brokerage_membership_of(uuid);
--   drop table if exists public.brokerage_member;
--   drop function if exists public.brokerage_member_guard();
--   drop table if exists public.brokerage_account;
