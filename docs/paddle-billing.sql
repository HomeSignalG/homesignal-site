-- ============================================================================
-- PADDLE BILLING + THE ONE-TIME SIX-MONTH PARTNER GRANT   (2026-11-14)
-- SQL OF RECORD. NOT APPLIED until the founder says so (this changes the billing functions in production).
--
-- WHAT THE FOUNDER ASKED FOR (2026-11-14, in his words, restated so nobody re-derives it)
--   * Paddle REPLACES Lemon Squeezy as the payment processor.
--   * "Professional": $78 USD a month, recurring, 100 reports a month, NO free trial.
--   * "Private Partner Offer": $234 USD ONCE for SIX MONTHS of Professional access, 100 reports a month, NO automatic renewal, NO trial.
--     An INDIVIDUAL agent offer, not a brokerage-wide license. "Implement six-month access expiration in JODY."
--   * "Brokerage & Enterprise": custom quoted only. Nothing here sells it.
--
-- WHAT THIS ADDS (additive; the existing ledger rows, the one Lemon test binding and every existing account are left exactly as they are)
--   1. public.payment_event_map_status gains a 'paddle' branch. The 'lemonsqueezy' branch STAYS: the ledger is immutable and three Lemon events
--      (test mode) are in it; their stored mapped_status is a generated column and must keep meaning what it meant.
--   2. public.brokerage_subscription.access_months (nullable, 1..24). NULL = a recurring subscription (unchanged). A number = a ONE-TIME grant
--      that lasts that many whole calendar months from bound_at, set by the server from the price the buyer paid, never read from a payload.
--   3. public.billing_plan_of: a grant whose latest event is still 'active' but whose time has run out reads 'expired' (not 'paid').
--      Nothing else about the state changes. The report gate already treats anything but 'paid' as "use the free evaluation", so an expired
--      grant stops charging the paid allotment with no change to brokerage_report_issue.
--   4. public.brokerage_paid_credit_guard also refuses a paid credit whose month index is at or past the grant's length (a constraint-level
--      backstop to the state check: the 7th month of a six-month grant cannot be written by any caller).
--   5. public.billing_event_apply(brokerage, event, access_months): the webhook's one writer, with the offer's duration. A grant is only for an
--      account_type = 'individual' account (EV013 OFFER_NOT_FOR_ACCOUNT otherwise). The two-argument form stays and means "recurring".
--   6. public.billing_usage gains access_ends_at (when a grant's access ends, NULL for a subscription) so the page can say it.
--
--   7. public.billing_grant_of(ref, livemode): a refund or chargeback names a TRANSACTION, not a brokerage; a grant is bound under its transaction
--      id, so this is the one way back, and it matches a one-time grant only.
--
-- REFUNDS AND CHARGEBACKS (founder 2026-11-14: "define partial-refund behavior explicitly, ensure changes affect only the entitlement from the relevant
--   purchase"): an approved FULL refund or an approved chargeback ends that purchase's access; a PARTIAL refund never changes access; a reversed
--   chargeback restores it (never extending the six months). Recorded as ledger events on the grant's own transaction id, so they can reach nothing else.
--
-- WHAT IT DELIBERATELY DOES NOT CHANGE: billing_report_limit() = 100; the paid ledger and its cap; brokerage_report_issue and billing_paid_issue;
--   the checkout slot; the free evaluation; any existing row.
--
-- ACCESS: system-only, exactly as the billing file: the new function is executable by service_role alone.
-- Idempotent: safe to run twice. Fail-closed: every splice states its anchor count. ROLLBACK is at the foot of this file.
-- ============================================================================

-- ---- 0. PRECONDITIONS ----------------------------------------------------------------------------------------------
do $pre$
begin
  if to_regclass('public.brokerage_subscription') is null or to_regclass('public.brokerage_paid_credit') is null
     or to_regclass('public.payment_event') is null or to_regclass('public.brokerage_account') is null then
    raise exception 'paddle_billing: apply docs/brokerage-billing.sql and docs/payment-event-ledger.sql first';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'brokerage_account' and column_name = 'account_type') then
    raise exception 'paddle_billing: apply docs/individual-agent-signup.sql first (a one-time grant is for an individual account)';
  end if;
  if to_regprocedure('public.billing_plan_of(uuid)') is null or to_regprocedure('public.billing_usage(uuid)') is null
     or to_regprocedure('public.billing_event_apply(uuid, jsonb)') is null or to_regprocedure('public.brokerage_paid_credit_guard()') is null
     or to_regprocedure('public.payment_event_map_status(text, text)') is null then
    raise exception 'paddle_billing: a billing function this file stands on is missing';
  end if;
end $pre$;

-- ---- 1. THE STATUS MAP: Paddle's words (the Lemon branch stays, for the rows already recorded) ---------------------------
-- Paddle spells it "canceled". 'completed' is a one-time transaction that was paid; 'refunded' (an approved FULL refund) and 'charged_back' (an approved
-- chargeback) end that purchase's access. A partial refund records nothing here: it never changes access (see _shared/paddle-billing.ts).
create or replace function public.payment_event_map_status(p_processor text, p_status text) returns text
language sql immutable
set search_path = public, pg_temp
as $$
  select case
    when p_processor = 'lemonsqueezy' then
      case p_status
        when 'on_trial'  then 'trialing'
        when 'active'    then 'active'
        when 'paused'    then 'paused'
        when 'past_due'  then 'past_due'
        when 'unpaid'    then 'unpaid'
        when 'cancelled' then 'canceled'
        when 'expired'   then 'canceled'
        else 'unknown'
      end
    when p_processor = 'paddle' then
      case p_status
        when 'trialing'  then 'trialing'
        when 'active'    then 'active'
        when 'completed' then 'active'
        when 'paused'    then 'paused'
        when 'past_due'  then 'past_due'
        when 'canceled'  then 'canceled'
        when 'refunded'  then 'canceled'
        when 'charged_back' then 'canceled'
        else 'unknown'
      end
    else 'unknown'
  end
$$;

-- ---- 2. THE GRANT'S LENGTH ------------------------------------------------------------------------------------------
alter table public.brokerage_subscription add column if not exists access_months integer;
do $c$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.brokerage_subscription'::regclass and conname = 'brokerage_subscription_access_months') then
    alter table public.brokerage_subscription
      add constraint brokerage_subscription_access_months check (access_months is null or access_months between 1 and 24);
  end if;
end $c$;

-- ---- 3. THE PLAN STATE: a grant that ran out is 'expired' -------------------------------------------------------------
-- Same function, same columns. Only the CTE also reads access_months and one CASE branch is added, before 'paid'.
create or replace function public.billing_plan_of(p_brokerage uuid)
returns table (binding_id uuid, livemode boolean, bound_at timestamptz, processor_status text, mapped_status text, occurred_at timestamptz, state text)
language sql stable security definer set search_path = public, pg_temp
as $$
  with b as (
    select s.binding_id, s.processor, s.subscription_ref, s.livemode, s.bound_at, s.access_months
      from public.brokerage_subscription s
     where s.brokerage_id = p_brokerage
     order by s.livemode desc, s.bound_at desc, s.binding_id
     limit 1)
  select b.binding_id, b.livemode, b.bound_at, e.processor_status, e.mapped_status, e.occurred_at,
         case
           when not exists (select 1 from public.brokerage_account a where a.id = p_brokerage and a.status = 'active') then 'suspended'
           when not b.livemode then 'test_only'
           when e.mapped_status = 'active' and b.access_months is not null
                and now() >= ((b.bound_at at time zone 'UTC') + b.access_months * interval '1 month') at time zone 'UTC' then 'expired'
           when e.mapped_status = 'active' then 'paid'
           when e.mapped_status is null then 'none'
           when e.mapped_status = 'trialing' then 'trialing'
           when e.mapped_status in ('paused', 'past_due', 'unpaid') then 'past_due'
           when e.mapped_status = 'canceled' then 'canceled'
           else 'unknown'
         end
    from b
    left join public.payment_event e on e.event_id = public.payment_event_latest_id(b.processor, b.livemode, b.subscription_ref)
$$;

-- ---- 4. THE PAID CREDIT GUARD: a grant's month index can never reach its length -----------------------------------------
create or replace function public.brokerage_paid_credit_guard() returns trigger
language plpgsql set search_path = public, pg_temp
as $$
declare
  b public.brokerage_subscription%rowtype;
begin
  select s.* into b from public.brokerage_subscription s where s.binding_id = new.binding_id;
  if not found or b.livemode is not true or b.brokerage_id <> new.brokerage_id then
    raise exception 'brokerage_paid_credit: a paid credit needs a live subscription binding of the same brokerage' using errcode = '55000';
  end if;
  new.period_index := public.billing_period_index(b.bound_at, now());
  new.issued_at    := now();
  if b.access_months is not null and new.period_index >= b.access_months then
    raise exception 'brokerage_paid_credit: this one-time access has ended' using errcode = '55000';
  end if;
  return new;
end $$;

-- ---- 5. THE WEBHOOK'S WRITER, with the offer's duration -----------------------------------------------------------------
-- The duration comes from the SERVER (the price the buyer paid, looked up in its own configuration), never from the payload. A grant is for an
-- individual account only. Replaying a recorded grant with a different length is a configuration error and is refused, not silently kept.
create or replace function public.billing_event_apply(p_brokerage uuid, p_event jsonb, p_access_months integer)
returns table (outcome text, event_id bigint, is_latest boolean, bound boolean, state text)
language plpgsql security definer set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_proc  text;
  v_ref   text;
  v_live  boolean;
  b       public.brokerage_subscription%rowtype;
  r       record;
  v_bound boolean := false;
begin
  if p_brokerage is null or not exists (select 1 from public.brokerage_account a where a.id = p_brokerage) then
    raise exception using errcode = 'EV012', message = 'BROKERAGE_UNKNOWN';
  end if;
  if p_access_months is not null then
    if p_access_months < 1 or p_access_months > 24 then
      raise exception 'billing_event_apply: access_months must be between 1 and 24' using errcode = '22023';
    end if;
    if not exists (select 1 from public.brokerage_account a where a.id = p_brokerage and a.account_type = 'individual') then
      raise exception using errcode = 'EV013', message = 'OFFER_NOT_FOR_ACCOUNT';
    end if;
  end if;
  if jsonb_typeof(p_event) is distinct from 'object'
     or jsonb_typeof(p_event -> 'processor') is distinct from 'string'
     or jsonb_typeof(p_event -> 'subscription_ref') is distinct from 'string'
     or jsonb_typeof(p_event -> 'livemode') is distinct from 'boolean' then
    raise exception 'billing_event_apply: the event must be an object with a processor, a subscription_ref and a livemode' using errcode = '22023';
  end if;
  v_proc := p_event ->> 'processor';
  v_ref  := p_event ->> 'subscription_ref';
  v_live := (p_event ->> 'livemode')::boolean;
  perform pg_advisory_xact_lock(hashtextextended('billing|' || v_proc || '|' || v_live::text || '|' || v_ref, 0));

  select s.* into b from public.brokerage_subscription s where s.processor = v_proc and s.livemode = v_live and s.subscription_ref = v_ref;
  if found and b.brokerage_id <> p_brokerage then
    raise exception using errcode = 'EV011', message = 'BINDING_CONFLICT';
  end if;
  if found and b.access_months is distinct from p_access_months then
    raise exception using errcode = 'EV011', message = 'BINDING_CONFLICT';
  end if;

  select * into r from public.payment_event_record(p_event);
  if not found then
    raise exception 'billing_event_apply: the ledger returned nothing';
  end if;

  if b.binding_id is null then
    insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode, access_months)
    values (p_brokerage, v_proc, v_ref, v_live, p_access_months);
    v_bound := true;
  end if;
  return query select r.outcome, r.event_id, r.is_latest, v_bound, (select pl.state from public.billing_plan_of(p_brokerage) pl);
end $$;

-- the two-argument form stays (the live webhook and the tests call it) and means "recurring": it is the three-argument form with NULL
create or replace function public.billing_event_apply(p_brokerage uuid, p_event jsonb)
returns table (outcome text, event_id bigint, is_latest boolean, bound boolean, state text)
language sql security definer set search_path = public, pg_temp
as $$ select * from public.billing_event_apply(p_brokerage, p_event, null::integer) $$;

-- ---- 5b. A REFUND'S WAY BACK TO ITS PURCHASE -----------------------------------------------------------------------------------
-- A Paddle adjustment (refund, chargeback) carries no custom data. It names the TRANSACTION it adjusts, and a one-time grant is bound under that
-- transaction id. This answers: which brokerage, and which grant length, was bound under that id? Nothing else is returned, and a recurring
-- subscription (access_months null) never matches, so a refund of one monthly charge cannot reach the subscription.
create or replace function public.billing_grant_of(p_ref text, p_livemode boolean)
returns table (brokerage_id uuid, access_months integer)
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.brokerage_id, s.access_months
    from public.brokerage_subscription s
   where s.processor = 'paddle' and s.livemode = p_livemode and s.subscription_ref = p_ref and s.access_months is not null
$$;
revoke all on function public.billing_grant_of(text, boolean) from public, anon, authenticated;
grant execute on function public.billing_grant_of(text, boolean) to service_role;

-- A refund or chargeback of a SUBSCRIPTION's payment finds its brokerage by the subscription id (recurring bindings only: access_months is null). Same lock-down.
create or replace function public.billing_subscription_brokerage(p_ref text, p_livemode boolean)
returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.brokerage_id
    from public.brokerage_subscription s
   where s.processor = 'paddle' and s.livemode = p_livemode and s.subscription_ref = p_ref and s.access_months is null
$$;
revoke all on function public.billing_subscription_brokerage(text, boolean) from public, anon, authenticated;
grant execute on function public.billing_subscription_brokerage(text, boolean) to service_role;

-- ---- 6. THE READER: access_ends_at ----------------------------------------------------------------------------------------
-- A column is added, so the function is replaced (dropped and created), then its privileges are set again exactly as the billing file set them.
drop function if exists public.billing_usage(uuid);
create function public.billing_usage(p_user_id uuid)
returns table (brokerage_id uuid, role text, state text, credit_limit integer, credits_used integer, credits_remaining integer,
               period_ends_at timestamptz, access_ends_at timestamptz)
language sql stable security definer set search_path = public, pg_temp
as $$
  select r.brokerage_id, r.role,
         coalesce(pl.state, 'none'),
         public.billing_report_limit(),
         case when pl.state = 'paid' then u.n else 0 end,
         case when pl.state = 'paid' then greatest(public.billing_report_limit() - u.n, 0) else 0 end,
         case when pl.state = 'paid' then least(
              public.billing_period_end(pl.bound_at, public.billing_period_index(pl.bound_at, now())),
              ((pl.bound_at at time zone 'UTC') + g.access_months * interval '1 month') at time zone 'UTC') end,
         case when pl.state in ('paid', 'expired') and g.access_months is not null
              then ((pl.bound_at at time zone 'UTC') + g.access_months * interval '1 month') at time zone 'UTC' end
    from public.brokerage_membership_of(p_user_id) r
    left join lateral public.billing_plan_of(r.brokerage_id) pl on true
    left join lateral (select s.access_months from public.brokerage_subscription s where s.binding_id = pl.binding_id) g on true
    cross join lateral (
      select count(*)::integer as n from public.brokerage_paid_credit c
       where pl.binding_id is not null and c.binding_id = pl.binding_id
         and c.period_index = public.billing_period_index(pl.bound_at, now())) u
$$;

revoke all on function public.billing_event_apply(uuid, jsonb, integer) from public, anon, authenticated;
grant execute on function public.billing_event_apply(uuid, jsonb, integer) to service_role;
revoke all on function public.billing_usage(uuid) from public, anon, authenticated;
grant execute on function public.billing_usage(uuid) to service_role;

-- ---- 7. POSTCONDITIONS (fail closed) -----------------------------------------------------------------------------------------
do $post$
begin
  if public.payment_event_map_status('paddle', 'canceled') <> 'canceled' or public.payment_event_map_status('paddle', 'completed') <> 'active'
     or public.payment_event_map_status('paddle', 'ACTIVE') <> 'unknown' or public.payment_event_map_status('lemonsqueezy', 'cancelled') <> 'canceled' then
    raise exception 'paddle_billing: the status map does not read as intended';
  end if;
  if has_function_privilege('anon', 'public.billing_event_apply(uuid, jsonb, integer)', 'execute')
     or has_function_privilege('authenticated', 'public.billing_event_apply(uuid, jsonb, integer)', 'execute')
     or has_function_privilege('anon', 'public.billing_usage(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.billing_usage(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.billing_event_apply(uuid, jsonb, integer)', 'execute')
     or not has_function_privilege('service_role', 'public.billing_usage(uuid)', 'execute') then
    raise exception 'paddle_billing: the billing functions are not system-only';
  end if;
end $post$;

-- ---- ROLLBACK (only while no grant has been bound; it refuses otherwise) ----------------------------------------------------------
-- do $rb$ begin
--   if exists (select 1 from public.brokerage_subscription where access_months is not null) then
--     raise exception 'paddle_billing rollback: a one-time grant exists; keep the column and the functions';
--   end if;
-- end $rb$;
-- then re-run, in this order: docs/brokerage-billing.sql sections 6 (billing_plan_of), 8 (billing_usage), 7 (billing_event_apply) and the
-- brokerage_paid_credit_guard function; drop function public.billing_event_apply(uuid, jsonb, integer); alter table public.brokerage_subscription
-- drop column access_months; and put the status map back to its lemonsqueezy-only body from docs/payment-event-ledger.sql.


-- ============================================================================
-- PART B (below): PAID-ONLY NEW INDIVIDUAL SIGNUP. It was a separate file in PR #2919 and is now the second half of THIS ONE migration (founder 2026-11-14:
-- "use one reviewed database migration"). Part A above must run first (it is independent of Part B); Part B runs as its own transaction. Apply both together,
-- through db-sql.yml from main, and only after the staging/sandbox gate in docs/paddle-billing-2026-11-14.md passes.
-- ============================================================================
-- ============================================================================
-- PAID-ONLY INDIVIDUAL SIGNUP   (2026-11-14, founder: "Make NEW individual registrations paid-only: no free report credits")
-- SQL OF RECORD. NOT APPLIED. Review the IMPACT and the RECOVERY below, then apply through the approved runner (db-sql.yml from main).
--
-- WHAT IT DOES
--   Individual agents who register AFTER this is applied get no free reports. The ONLY way they can make a report is an active paid plan
--   (docs/brokerage-billing.sql: billing_plan_of(...).state = 'paid', 100 reports per monthly billing period). Every account that exists today
--   keeps exactly what it has: its free evaluation, its ledger, its paid plan, its billing. Nothing is rewritten, deleted or re-priced.
--
-- HOW (three small, additive changes; each function is SPLICED from its live definition, never retyped, and fails closed if its anchor moved)
--   1. public.evaluation.free_reports boolean NOT NULL DEFAULT true.  Adding a column with a constant default is a metadata-only change in
--      PostgreSQL 11+: no row is rewritten, and every existing evaluation reads TRUE (it keeps its free reports). Nothing else about the table moves.
--   2. public.individual_signup creates the evaluation with free_reports = FALSE. This is the ONLY writer of an individual account, so it is the
--      only place a new paid-only evaluation can come from. Brokerage accounts (created by HomeSignal for a quoted customer) keep the default TRUE.
--   3. ENFORCEMENT, in the database, not the page:
--        public.evaluation_report_issue   refuses (EV002 EVALUATION_COMPLETE, the answer the report function already maps) when the evaluation has
--                                          free_reports = false. brokerage_report_issue falls through to this function for every non-paid brokerage,
--                                          so an unpaid paid-only account cannot make a report by ANY path; a paid one never reaches it.
--        public.evaluation_usage          reports 0 free reports (limit 0, used n, remaining 0) for such an account, so every reader of "how many free
--                                          reports are left" (the report function's pre-check, the trial function's status, the workspace) agrees with
--                                          the refusal. The page reads this number; it holds none of its own.
--
-- IMPACT (measure before applying: the PRE-FLIGHT block at the foot prints the counts; the migration also refuses to run if an assumption fails)
--   * Existing accounts: unchanged. The post-condition proves every evaluation that existed before is still free_reports = true and that the count
--     of evaluations, credits and paid credits is identical before and after.
--   * New individual accounts: created with 0 free reports. Until a payment is confirmed by Paddle's signed event, they can sign in, see Billing
--     and subscribe; they cannot make a report. Their saved-report archive is empty and stays readable.
--   * Brokerage-invited members: unaffected (they belong to a brokerage's evaluation, free_reports = true by default).
--   * No payment-event, subscription, ledger or credit row is touched. The checkout kill switch is not touched by this file.
--
-- RECOVERY (only if something is wrong; none of it loses a customer's data)
--   * Fast, no data change: re-open free reports for new individuals by re-applying individual_signup's old insert (the ROLLBACK block at the foot).
--     Accounts created while this was live KEEP free_reports = false until set true by the ONE statement in the ROLLBACK block (it names them by the
--     column, so it can never touch an older account).
--   * The column is additive and harmless if left in place; dropping it is NOT part of recovery (it would orphan the enforcement lines).
--
-- Idempotent: safe to run twice (a second run finds every anchor already replaced and changes nothing). Fail-closed on every splice.
-- ============================================================================

begin;

do $mig$
declare
  v_evals_before   bigint;  v_credits_before bigint;  v_paid_before bigint := 0;
  v_evals_after    bigint;  v_credits_after  bigint;  v_paid_after  bigint := 0;
  f                text;
  oid_             oid;
  def              text;
  newdef           text;
  n                integer;
  before_          record;
  after_           record;
begin
  -- ---- 0. PRECONDITIONS --------------------------------------------------------------------------------------------------
  if to_regclass('public.evaluation') is null or to_regclass('public.evaluation_credit') is null
     or to_regclass('public.brokerage_account') is null
     or to_regprocedure('public.individual_signup(uuid, text)') is null
     or to_regprocedure('public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)') is null
     or to_regprocedure('public.evaluation_usage(uuid)') is null
     or to_regprocedure('public.brokerage_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)') is null then
    raise exception 'paid_only_individual_signup: apply docs/evaluation-entitlement.sql, docs/brokerage-billing.sql and docs/individual-agent-signup.sql first';
  end if;

  lock table public.evaluation in share row exclusive mode;      -- no evaluation is created or changed while the counts are taken

  select count(*) into v_evals_before from public.evaluation;
  select count(*) into v_credits_before from public.evaluation_credit;
  if to_regclass('public.brokerage_paid_credit') is not null then
    execute 'select count(*) from public.brokerage_paid_credit' into v_paid_before;
  end if;

  -- ---- 1. THE COLUMN: existing rows read TRUE (they keep their free reports) -------------------------------------------------
  alter table public.evaluation add column if not exists free_reports boolean not null default true;
  if (select count(*) from public.evaluation e where not e.free_reports) <> 0
     and not exists (select 1 from pg_proc p where p.proname = 'individual_signup' and pg_get_functiondef(p.oid) like '%free_reports%') then
    raise exception 'paid_only_individual_signup: an evaluation already has free_reports = false before this change set it; stop and look';
  end if;

  -- ---- 2. individual_signup: the new evaluation is paid-only ------------------------------------------------------------------
  oid_ := to_regprocedure('public.individual_signup(uuid, text)')::oid;
  def  := pg_get_functiondef(oid_);
  if def not like '%free_reports%' then
    n := (length(def) - length(replace(def, 'insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)', ''))) / length('insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)');
    if n <> 1 then
      raise exception 'paid_only_individual_signup: individual_signup''s evaluation insert appears % times (expected exactly 1); refusing to splice', n;
    end if;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into before_ from pg_proc p where p.oid = oid_;
    newdef := replace(def, 'insert into public.evaluation (brokerage_id, seat_limit) values (v_acct, 0)',
                           'insert into public.evaluation (brokerage_id, seat_limit, free_reports) values (v_acct, 0, false)');
    execute newdef;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into after_ from pg_proc p where p.oid = oid_;
    if before_ is distinct from after_ then
      raise exception 'paid_only_individual_signup: individual_signup''s security, volatility, settings, owner or privileges changed';
    end if;
  end if;

  -- ---- 3a. evaluation_report_issue: refuse a paid-only evaluation (the one place every non-paid issue path ends) ---------------
  oid_ := to_regprocedure('public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)')::oid;
  def  := pg_get_functiondef(oid_);
  if def not like '%free_reports%' then
    n := (length(def) - length(replace(def, 'select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max', ''))) / length('select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max');
    if n <> 1 then
      raise exception 'paid_only_individual_signup: evaluation_report_issue''s ledger-count anchor appears % times (expected exactly 1); refusing to splice', n;
    end if;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into before_ from pg_proc p where p.oid = oid_;
    -- placed AFTER the retried-key answer (a report already made is still returned, never charged) and BEFORE anything is counted or stored
    newdef := replace(def, 'select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max',
      E'if not ev.free_reports then\n    raise exception using errcode = ''EV002'', message = ''EVALUATION_COMPLETE'';   -- a paid-only account has no free reports: only an active paid plan makes one\n  end if;\n  select count(*)::integer, coalesce(max(c.ordinal), 0) into v_used, v_max');
    execute newdef;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into after_ from pg_proc p where p.oid = oid_;
    if before_ is distinct from after_ then
      raise exception 'paid_only_individual_signup: evaluation_report_issue''s security, volatility, settings, owner or privileges changed';
    end if;
  end if;

  -- ---- 3b. evaluation_usage: a paid-only account reports 0 free reports (limit 0, remaining 0) -------------------------------------
  oid_ := to_regprocedure('public.evaluation_usage(uuid)')::oid;
  def  := pg_get_functiondef(oid_);
  if def not like '%free_reports%' then
    f := 'public.evaluation_report_limit(), u.n, greatest(public.evaluation_report_limit() - u.n, 0)';
    n := (length(def) - length(replace(def, f, ''))) / length(f);
    if n <> 1 then
      raise exception 'paid_only_individual_signup: evaluation_usage''s limit expression appears % times (expected exactly 1); refusing to splice', n;
    end if;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into before_ from pg_proc p where p.oid = oid_;
    newdef := replace(def, f, 'case when e.free_reports then public.evaluation_report_limit() else 0 end, u.n, case when e.free_reports then greatest(public.evaluation_report_limit() - u.n, 0) else 0 end');
    execute newdef;
    select p.prosecdef, p.provolatile, p.proconfig, p.proacl::text as acl, p.proowner into after_ from pg_proc p where p.oid = oid_;
    if before_ is distinct from after_ then
      raise exception 'paid_only_individual_signup: evaluation_usage''s security, volatility, settings, owner or privileges changed';
    end if;
  end if;

  -- ---- 4. POST-CONDITIONS -------------------------------------------------------------------------------------------------------
  select count(*) into v_evals_after from public.evaluation;
  select count(*) into v_credits_after from public.evaluation_credit;
  if to_regclass('public.brokerage_paid_credit') is not null then
    execute 'select count(*) from public.brokerage_paid_credit' into v_paid_after;
  end if;
  if v_evals_after <> v_evals_before or v_credits_after <> v_credits_before or v_paid_after <> v_paid_before then
    raise exception 'paid_only_individual_signup: a row count moved (evaluations %->%, credits %->%, paid credits %->%)', v_evals_before, v_evals_after, v_credits_before, v_credits_after, v_paid_before, v_paid_after;
  end if;
  if (select count(*) from public.evaluation e where not e.free_reports) <> 0 then
    raise exception 'paid_only_individual_signup: an EXISTING evaluation lost its free reports; refusing to commit';
  end if;
  if pg_get_functiondef(to_regprocedure('public.individual_signup(uuid, text)')::oid) not like '%values (v_acct, 0, false)%'
     or pg_get_functiondef(to_regprocedure('public.evaluation_report_issue(uuid, uuid, text, text, text, jsonb, jsonb)')::oid) not like '%if not ev.free_reports%'
     or pg_get_functiondef(to_regprocedure('public.evaluation_usage(uuid)')::oid) not like '%e.free_reports%' then
    raise exception 'paid_only_individual_signup: a splice did not take';
  end if;
  if exists (select 1 from public.evaluation_check() k where k.kind = 'invariant' and k.violations <> 0) then
    raise exception 'paid_only_individual_signup: an evaluation_check() invariant is not zero after the change';
  end if;
  raise notice 'paid_only_individual_signup: ok. evaluations % credits % paid credits % (all unchanged)', v_evals_after, v_credits_after, v_paid_after;
end $mig$;

commit;

-- PRE-FLIGHT (read-only; run first and compare with the NOTICE the apply prints):
--   select (select count(*) from public.evaluation) evaluations, (select count(*) from public.evaluation_credit) credits,
--          (select count(*) from public.brokerage_account where account_type = 'individual') individual_accounts;

-- ROLLBACK (recovery; see the header). ROLLBACK-BEGIN
--   -- 1. new individuals get free reports again: restore the original insert
--   --    (run docs/individual-agent-signup.sql, which defines individual_signup with the original two-column insert).
--   -- 2. accounts created while paid-only was live stay paid-only until reopened by naming the column:
--   --    update public.evaluation set free_reports = true where free_reports = false;     -- run only if the founder wants them reopened
--   -- 3. evaluation_report_issue / evaluation_usage: re-run docs/evaluation-entitlement.sql section 11 and 12 definitions (their original text).
-- ROLLBACK-END
