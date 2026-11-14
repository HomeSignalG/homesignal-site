-- ============================================================================
-- PADDLE BILLING: the status map's Paddle branch (Development Activity billing, 2026-11-14).
-- Additive. Changes ONE function body, public.payment_event_map_status, by adding a `paddle` branch; the Lemon Squeezy branch and every
-- recorded event are untouched, and nothing is stored. The ledger's mapped_status is a GENERATED column over this function, so existing rows
-- are not rewritten (they are all lemonsqueezy/unknown and map exactly as before).
--
-- WHY ONLY THIS: the rest of the billing database layer (docs/brokerage-billing.sql) is processor-neutral by design (docs/brand/PADDLE-AUDIT.md):
-- the binding is keyed (processor, livemode, subscription_ref), the plan state comes from the ledger's latest event, the allowance is 100 a
-- month counted from the binding's day, and paid means the latest LIVE event maps to 'active'. Paddle needed only its status words mapped.
--
-- WORDS MAPPED (processor_status -> mapped_status):
--   active -> active (the only status that grants) · trialing -> trialing · paused -> paused · past_due -> past_due · canceled -> canceled
--   refunded -> canceled   written by the adapter for an APPROVED FULL REFUND adjustment
--   charged_back -> canceled   written by the adapter for an approved CHARGEBACK adjustment
--   anything else -> unknown (never grants)
--
-- Apply through db-sql.yml from main (never a begin/rollback dry run against production, CLAUDE.md 7.11). Idempotent. Rollback at the foot.
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public.payment_event_map_status(text,text)') is null then
    raise exception 'paddle-billing: public.payment_event_map_status(text, text) is absent (apply docs/payment-event-ledger.sql first)';
  end if;
  if to_regclass('public.payment_event') is null then
    raise exception 'paddle-billing: public.payment_event is absent (apply docs/payment-event-ledger.sql first)';
  end if;
  if pg_get_functiondef('public.payment_event_map_status(text,text)'::regprocedure) !~ 'lemonsqueezy' then
    raise exception 'paddle-billing: the live status map has no lemonsqueezy branch; refusing to replace a body this file does not recognise';
  end if;
end $pre$;

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
        when 'trialing'     then 'trialing'
        when 'active'       then 'active'
        when 'paused'       then 'paused'
        when 'past_due'     then 'past_due'
        when 'canceled'     then 'canceled'
        when 'refunded'     then 'canceled'
        when 'charged_back' then 'canceled'
        else 'unknown'
      end
    else 'unknown'
  end
$$;

-- Which brokerage a processor subscription is bound to, or null. A refund or chargeback arrives with no custom data (Paddle's adjustment carries none), so the
-- webhook finds its brokerage here, by the binding the subscription's own first event made. Read-only, system-only.
do $pre2$
begin
  if to_regclass('public.brokerage_subscription') is null then
    raise exception 'paddle-billing: public.brokerage_subscription is absent (apply docs/brokerage-billing.sql first)';
  end if;
end $pre2$;
create or replace function public.billing_binding_brokerage(p_processor text, p_livemode boolean, p_subscription_ref text) returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select s.brokerage_id from public.brokerage_subscription s
   where s.processor = p_processor and s.livemode = p_livemode and s.subscription_ref = p_subscription_ref
$$;
revoke all on function public.billing_binding_brokerage(text, boolean, text) from public, anon, authenticated;
grant execute on function public.billing_binding_brokerage(text, boolean, text) to service_role;

-- privileges: unchanged by CREATE OR REPLACE; re-assert the system-only lock-down the ledger file applies to every payment_event_ function
revoke all on function public.payment_event_map_status(text, text) from public, anon, authenticated;
grant execute on function public.payment_event_map_status(text, text) to service_role;

-- ROLLBACK (removes the paddle branch; only appropriate before any paddle event is recorded, since those would then map to 'unknown')
-- ROLLBACK-BEGIN
-- drop function if exists public.billing_binding_brokerage(text, boolean, text);
-- create or replace function public.payment_event_map_status(p_processor text, p_status text) returns text language sql immutable set search_path = public, pg_temp as $f$ select case when p_processor = 'lemonsqueezy' then case p_status when 'on_trial' then 'trialing' when 'active' then 'active' when 'paused' then 'paused' when 'past_due' then 'past_due' when 'unpaid' then 'unpaid' when 'cancelled' then 'canceled' when 'expired' then 'canceled' else 'unknown' end else 'unknown' end $f$;
-- ROLLBACK-END
