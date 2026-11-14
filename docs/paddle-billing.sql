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
-- WHAT IT DELIBERATELY DOES NOT CHANGE: billing_report_limit() = 100; the paid ledger and its cap; brokerage_report_issue and billing_paid_issue;
--   the checkout slot; the free evaluation; any existing row. A refund or chargeback does NOT revoke a grant yet: Paddle sends adjustments with
--   no custom data, so tying one back to a brokerage needs the transaction id stored. OPEN ITEM, stated rather than hidden.
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
-- Paddle spells it "canceled". 'completed' is a one-time transaction that was paid; 'refunded' is reserved for the day refunds are wired.
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
