-- ============================================================================
-- INDIVIDUAL-AGENT SIGNUP  (Development Activity plan, Order L2 — 2026-10-09)
-- SQL OF RECORD. PARKED: NOT APPLIED to production. Applying it needs the founder's separate go (new schema in production).
-- Founder model: an individual agent gets 10 free Development Activity reports, then $79/month for 100. Brokerages, teams and
-- enterprise customers are custom-quoted. An individual registers and receives their own account AUTOMATICALLY, with no
-- manual HomeSignal step. This file adds nothing parallel: an individual is the OWNER of a single-person account in the existing
-- brokerage infrastructure, with the existing 10-report evaluation and the existing billing.
--
-- WHAT IT ADDS (additive; nothing existing is edited or replaced)
--   * public.brokerage_account.account_type  'brokerage' | 'individual', NOT NULL, default 'brokerage'. Every existing account
--     therefore reads 'brokerage' and nothing about it changes. The type never changes after creation (a guard).
--   * An individual account holds at most ONE active member, and that member is its owner (a trigger on brokerage_member, serialised
--     on the account row like the spine's own guard). A team cannot be built inside an individual account, so a team cannot
--     subscribe through the individual plan.
--   * An individual account can have no invites (a trigger on evaluation_invite). Redeeming an invite is the only other way a second
--     person could join; there is none to redeem.
--   * public.individual_signup(user, name): the ONE autonomous writer. In one transaction it creates the account, the owner
--     membership and the evaluation (seat limit 0, no end date); the 10-report cap is the existing evaluation ledger, and the
--     number 10 stays public.evaluation_report_limit(). It is idempotent for the same person and refuses a person who already
--     belongs to any other account.
--   * public.brokerage_account_type_of(user) and public.individual_account_check() (a reader and an audit).
--
-- WHAT IT DELIBERATELY DOES NOT CHANGE
--   The $79 price, public.billing_report_limit() = 100, billing, the paid ledger, checkout, the payment provider, any existing
--   account / membership / evaluation / credit / report row. Billing already starts a checkout for an OWNER of any active account,
--   so an individual owner uses the same path; nothing here activates a live checkout.
--
-- ABUSE, STATED PLAINLY: signup requires a CONFIRMED email (the sign-in code proves control of the address) and is one free pool per
--   person-id. It cannot stop one human using many email addresses; the invite-only evaluation could. That is a product risk to
--   watch with the existing audit, not something this file can close by itself.
--
-- ACCESS: system-only, like the spine. Every function below is executable by service_role alone; the trigger functions by nobody.
-- ADDITIVE ONLY and idempotent: safe to run twice. ROLLBACK is at the foot of this file.
-- ============================================================================

-- ---- 0. PRECONDITIONS (fail closed) -----------------------------------------------------------------
do $pre$
begin
  if to_regclass('public.brokerage_account') is null or to_regclass('public.brokerage_member') is null
     or to_regprocedure('public.brokerage_membership_of(uuid)') is null then
    raise exception 'individual_agent_signup: the account spine (docs/brokerage-account-spine.sql) is not applied';
  end if;
  if to_regclass('public.evaluation') is null or to_regclass('public.evaluation_invite') is null
     or to_regprocedure('public.evaluation_report_limit()') is null then
    raise exception 'individual_agent_signup: the evaluation entitlement (docs/evaluation-entitlement.sql) is not applied';
  end if;
  if to_regclass('auth.users') is null then
    raise exception 'individual_agent_signup: auth.users does not exist';
  end if;
end $pre$;

-- ---- 1. THE ACCOUNT TYPE ----------------------------------------------------------------------------------
alter table public.brokerage_account add column if not exists account_type text not null default 'brokerage';
do $c$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.brokerage_account'::regclass and conname = 'brokerage_account_type') then
    alter table public.brokerage_account
      add constraint brokerage_account_type check (account_type in ('brokerage', 'individual'));
  end if;
end $c$;

-- ---- 2. GUARDS ----------------------------------------------------------------------------------------------
-- The type is set when the account is made and never changes: moving an account between plans is a deliberate act with its own
-- review, never an UPDATE that slips a team into a $79 account.
create or replace function public.brokerage_account_type_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if new.account_type is distinct from old.account_type then
    raise exception 'brokerage_account: the account type cannot change after creation' using errcode = '55000';
  end if;
  return new;
end $$;
create or replace trigger brokerage_account_type_guard_trg
  before update on public.brokerage_account
  for each row execute function public.brokerage_account_type_guard();

-- An individual account has at most one ACTIVE member and it is the owner. The account row is locked first so two concurrent
-- inserts cannot both see "nobody yet"; the check then reads fresh data only at READ COMMITTED, so anything else is refused.
create or replace function public.brokerage_member_individual_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare v_type text;
begin
  select a.account_type into v_type from public.brokerage_account a where a.id = new.brokerage_id;
  if v_type is distinct from 'individual' then
    return new;
  end if;
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'brokerage_member: adding a member to an individual account needs READ COMMITTED (the one-member check is serialised on a row lock; this transaction is at %)',
      current_setting('transaction_isolation') using errcode = '55000';
  end if;
  perform 1 from public.brokerage_account a where a.id = new.brokerage_id for no key update;
  if new.role <> 'owner' then
    raise exception 'brokerage_member: an individual account has an owner and nobody else' using errcode = '55000';
  end if;
  if new.status = 'active' and exists (select 1 from public.brokerage_member m where m.brokerage_id = new.brokerage_id and m.status = 'active') then
    raise exception 'brokerage_member: an individual account holds one person' using errcode = '55000';
  end if;
  return new;
end $$;
create or replace trigger brokerage_member_individual_guard_trg
  before insert on public.brokerage_member
  for each row execute function public.brokerage_member_individual_guard();

-- An individual account has no invites to mint. Refused as the existing NOT_ENTITLED so the trial function needs no new mapping.
create or replace function public.evaluation_invite_individual_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id
              where e.evaluation_id = new.evaluation_id and a.account_type = 'individual') then
    raise exception using errcode = 'EV003', message = 'NOT_ENTITLED';
  end if;
  return new;
end $$;
create or replace trigger evaluation_invite_individual_guard_trg
  before insert on public.evaluation_invite
  for each row execute function public.evaluation_invite_individual_guard();

-- ---- 3. THE SIGNUP: account + owner membership + evaluation, in ONE transaction ---------------------------------------
-- The only autonomous writer. p_user_id must be a Supabase Auth user with a CONFIRMED email. The name is printed on the person's
-- reports as their account name, so it is checked here too (the function in front of this one cleans it first).
--   * already the owner of an individual account  -> that account, replayed = true, nothing written (safe to retry)
--   * a member of any other account                -> EV004 ALREADY_A_MEMBER, nothing written
--   * no confirmed email / unknown user / bad name -> EV001 SIGNUP_REFUSED, nothing written
-- One advisory lock per person serialises two simultaneous signups; the spine's one-active-membership index is the backstop.
create or replace function public.individual_signup(p_user_id uuid, p_name text)
returns table (evaluation_id uuid, brokerage_id uuid, replayed boolean)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_name  text := btrim(coalesce(p_name, ''));
  v_acct  uuid;
  v_eval  uuid;
  v_exist record;
begin
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'individual_signup: needs READ COMMITTED (this transaction is at %)', current_setting('transaction_isolation') using errcode = '55000';
  end if;
  if p_user_id is null or v_name = '' or char_length(v_name) > 120 or v_name ~ '[\x00-\x1f\x7f]'
     or not exists (select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null) then
    raise exception using errcode = 'EV001', message = 'SIGNUP_REFUSED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('individual_signup:' || p_user_id::text, 0));
  select m.brokerage_id, m.role, a.account_type into v_exist
    from public.brokerage_member m join public.brokerage_account a on a.id = m.brokerage_id
   where m.user_id = p_user_id and m.status = 'active';
  if found then
    if v_exist.account_type = 'individual' and v_exist.role = 'owner' then
      return query select e.evaluation_id, e.brokerage_id, true from public.evaluation e where e.brokerage_id = v_exist.brokerage_id;
      return;
    end if;
    raise exception using errcode = 'EV004', message = 'ALREADY_A_MEMBER';
  end if;
  insert into public.brokerage_account (name, account_type) values (v_name, 'individual') returning brokerage_account.id into v_acct;
  insert into public.brokerage_member (brokerage_id, user_id, role) values (v_acct, p_user_id, 'owner');
  insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0) returning evaluation.evaluation_id into v_eval;
  insert into public.evaluation_event (evaluation_id, kind) values (v_eval, 'created');
  return query select v_eval, v_acct, false;
end $$;

-- ---- 4. THE READER AND THE AUDIT --------------------------------------------------------------------------------------
-- The type of a person's active account ('individual' | 'brokerage') and their role in it, or no row. By user id, through the one membership resolver.
-- Two columns on purpose: a one-column TABLE function is a scalar function to PostgreSQL and PostgREST, and a reader that expects rows would meet a bare value.
create or replace function public.brokerage_account_type_of(p_user_id uuid)
returns table (account_type text, role text)
language sql stable security definer set search_path = public, pg_temp
as $$
  select a.account_type, r.role from public.brokerage_membership_of(p_user_id) r join public.brokerage_account a on a.id = r.brokerage_id
$$;

create or replace function public.individual_account_check()
returns table (check_name text, kind text, violations bigint)
language sql stable security definer set search_path = public, pg_temp
as $$
  select 'accounts_total'::text, 'control'::text, count(*) from public.brokerage_account
  union all select 'individual_accounts', 'control', count(*) from public.brokerage_account where account_type = 'individual'
  union all select 'individual_with_more_than_one_active_member', 'invariant', count(*) from
    (select m.brokerage_id from public.brokerage_member m join public.brokerage_account a on a.id = m.brokerage_id
      where a.account_type = 'individual' and m.status = 'active' group by m.brokerage_id having count(*) > 1) g
  union all select 'individual_with_a_non_owner_member', 'invariant', count(*) from public.brokerage_member m
    join public.brokerage_account a on a.id = m.brokerage_id where a.account_type = 'individual' and m.role <> 'owner'
  union all select 'individual_with_an_invite', 'invariant', count(*) from public.evaluation_invite i
    join public.evaluation e on e.evaluation_id = i.evaluation_id join public.brokerage_account a on a.id = e.brokerage_id
    where a.account_type = 'individual'
  union all select 'individual_evaluation_with_seats', 'invariant', count(*) from public.evaluation e
    join public.brokerage_account a on a.id = e.brokerage_id where a.account_type = 'individual' and e.seat_limit is distinct from 0
$$;

-- ---- 5. LOCK-DOWN: system-only ------------------------------------------------------------------------------------------
do $lock$
declare f record;
begin
  for f in select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig,
                  (p.prorettype = 'trigger'::regtype) as is_trigger
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public'
              and (p.proname like 'individual\_%' or p.proname like 'brokerage\_account\_type%'
                   or p.proname in ('brokerage_member_individual_guard', 'evaluation_invite_individual_guard')) loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
    if not f.is_trigger then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;
end $lock$;

-- ---- 6. POST-CONDITION (fail closed) -------------------------------------------------------------------------------------
do $post$
begin
  if exists (select 1 from pg_roles r, pg_proc p
              where r.rolname in ('anon', 'authenticated') and p.pronamespace = 'public'::regnamespace
                and (p.proname like 'individual\_%' or p.proname like 'brokerage\_account\_type%')
                and has_function_privilege(r.rolname, p.oid, 'EXECUTE')) then
    raise exception 'individual_agent_signup: anon or authenticated can run one of this file''s functions';
  end if;
  if exists (select 1 from public.brokerage_account where account_type is null) then
    raise exception 'individual_agent_signup: an account has no type';
  end if;
end $post$;

-- ROLLBACK (this file only; refuses to drop the column while an individual account exists):
--   drop trigger if exists evaluation_invite_individual_guard_trg on public.evaluation_invite;
--   drop trigger if exists brokerage_member_individual_guard_trg on public.brokerage_member;
--   drop trigger if exists brokerage_account_type_guard_trg on public.brokerage_account;
--   drop function if exists public.individual_account_check();
--   drop function if exists public.brokerage_account_type_of(uuid);
--   drop function if exists public.individual_signup(uuid, text);
--   drop function if exists public.evaluation_invite_individual_guard();
--   drop function if exists public.brokerage_member_individual_guard();
--   drop function if exists public.brokerage_account_type_guard();
--   alter table public.brokerage_account drop constraint if exists brokerage_account_type;
--   -- only when no individual account exists:  alter table public.brokerage_account drop column account_type;
