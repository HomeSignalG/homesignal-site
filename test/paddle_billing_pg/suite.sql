-- =====================================================================================
-- PADDLE BILLING + THE SIX-MONTH PARTNER GRANT: EXECUTABLE SUITE  (docs/paddle-billing.sql)
-- Stands on the REAL account spine, evaluation entitlement, individual signup, payment ledger and billing file, applied unmutated.
-- Every expected answer is a HARD-CODED constant. Output: one row per check (name|pass|detail).
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;
create function pg_temp._acct(p_user int) returns uuid language sql as $$ select brokerage_id from public.brokerage_member where user_id = pg_temp._u(p_user) $$;

-- a Paddle event through the webhook's three-argument writer
create function pg_temp._pay(p_brokerage uuid, p_ref text, p_name text, p_status text, p_at text, p_live boolean, p_months integer, p_key text default null)
returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.billing_event_apply(p_brokerage, jsonb_build_object(
    'processor', 'paddle', 'idempotency_key', coalesce(p_key, 'evt_' || p_ref || '_' || p_name || '_' || p_at),
    'subscription_ref', p_ref, 'event_name', p_name, 'processor_status', p_status, 'occurred_at', p_at,
    'product_ref', 'pro_test', 'variant_ref', 'pri_test', 'livemode', p_live), p_months);
  return r.outcome || '/' || r.bound::text || '/' || r.state;
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp._issue(p_user int, p_k int) returns text language plpgsql as $$
declare r record; b text := format('{"n":%s}', p_k);
begin
  select * into r from public.brokerage_report_issue(pg_temp._u(p_user), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, null);
  return r.allotment || '/' || r.credit_ordinal::text;
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;

grant usage on schema public to anon, authenticated, service_role;
insert into auth.users (id, email, email_confirmed_at) select pg_temp._u(n), 'u' || n || '@t.test', now() from generate_series(1, 9) n;
-- 1 recurring individual, 2 one-time individual, 3 expired-grant individual, 4 edge-grant individual, 5 a team owner (brokerage), 6 test-mode individual
select public.individual_signup(pg_temp._u(n), 'Agent ' || n) from generate_series(1, 4) n;
select public.individual_signup(pg_temp._u(6), 'Agent 6');
select public.individual_signup(pg_temp._u(7), 'Agent 7');
create temp table _t as select * from public.evaluation_create('Team Brokerage');
select public.evaluation_invite_redeem((select owner_token from _t), pg_temp._u(5));

-- ---- the status map -------------------------------------------------------------------------------------------------------------
select pg_temp._ck('P01 Paddle words map: trialing, active, completed, paused, past_due, canceled, refunded',
  public.payment_event_map_status('paddle','trialing') = 'trialing' and public.payment_event_map_status('paddle','active') = 'active'
  and public.payment_event_map_status('paddle','completed') = 'active' and public.payment_event_map_status('paddle','paused') = 'paused'
  and public.payment_event_map_status('paddle','past_due') = 'past_due' and public.payment_event_map_status('paddle','canceled') = 'canceled'
  and public.payment_event_map_status('paddle','refunded') = 'canceled');
select pg_temp._ck('P02 an unknown or wrong-case Paddle word grants nothing (unknown); Lemon words still map as before (control)',
  public.payment_event_map_status('paddle','ACTIVE') = 'unknown' and public.payment_event_map_status('paddle','cancelled') = 'unknown'
  and public.payment_event_map_status('lemonsqueezy','cancelled') = 'canceled' and public.payment_event_map_status('lemonsqueezy','on_trial') = 'trialing'
  and public.payment_event_map_status('other','active') = 'unknown');

-- ---- Professional: recurring ----------------------------------------------------------------------------------------------------
create temp table _a as select
  pg_temp._pay(pg_temp._acct(1), 'sub_prof1', 'subscription.created', 'active', '2026-11-14T10:00:00Z', true, null) created,
  pg_temp._issue(1, 1) i1;
select pg_temp._ck('P03 a recurring Paddle subscription binds and reads paid', (select created from _a) = 'RECORDED/true/paid', (select created from _a));
select pg_temp._ck('P04 its first report is charged to the paid month, ordinal 1', (select i1 from _a) = 'paid/1', (select i1 from _a));
select pg_temp._ck('P05 a recurring subscription has NO access end date and a null access_months',
  (select access_ends_at is null from public.billing_usage(pg_temp._u(1)))
  and (select access_months is null from public.brokerage_subscription where subscription_ref = 'sub_prof1'));
select pg_temp._ck('P06 the two-argument writer still works and means recurring',
  (select (s.processor = 'paddle') and s.access_months is null from public.billing_event_apply(pg_temp._acct(1), jsonb_build_object(
     'processor','paddle','idempotency_key','evt_two_arg','subscription_ref','sub_prof1','event_name','subscription.updated',
     'processor_status','active','occurred_at','2026-11-14T10:05:00Z','livemode', true)) r
     cross join public.brokerage_subscription s where s.subscription_ref = 'sub_prof1'));
select pg_temp._ck('P07 cancelling ends it: the state reads canceled and the next report falls to the free evaluation',
  pg_temp._pay(pg_temp._acct(1), 'sub_prof1', 'subscription.canceled', 'canceled', '2026-11-14T11:00:00Z', true, null) = 'RECORDED/false/canceled'
  and pg_temp._issue(1, 2) like 'trial/%');

-- ---- Private Partner Offer: six months, once ------------------------------------------------------------------------------------
create temp table _b as select pg_temp._pay(pg_temp._acct(2), 'txn_partner2', 'transaction.completed', 'completed', '2026-11-14T10:00:00Z', true, 6) granted;
select pg_temp._ck('P08 a paid one-time transaction binds a six-month grant and reads paid', (select granted from _b) = 'RECORDED/true/paid', (select granted from _b));
select pg_temp._ck('P09 the grant is six whole months: access_ends_at is bound_at + 6 months, and the month allotment is 100',
  (select (u.access_ends_at = ((s.bound_at at time zone 'UTC') + interval '6 months') at time zone 'UTC') and u.credit_limit = 100 and u.credits_remaining = 100
     from public.billing_usage(pg_temp._u(2)) u join public.brokerage_subscription s on s.subscription_ref = 'txn_partner2'));
select pg_temp._ck('P10 the grant has no renewal: it is bound to a transaction and a second payment event for it records but never extends it',
  pg_temp._pay(pg_temp._acct(2), 'txn_partner2', 'transaction.completed', 'completed', '2026-11-15T10:00:00Z', true, 6) = 'RECORDED/false/paid'
  and (select access_ends_at = ((bound_at at time zone 'UTC') + interval '6 months') at time zone 'UTC' from public.billing_usage(pg_temp._u(2)) u
       join public.brokerage_subscription s on s.subscription_ref = 'txn_partner2'));
select pg_temp._ck('P11 a report on the grant is charged to the paid allotment (100 a month), ordinal 1', pg_temp._issue(2, 3) = 'paid/1');
select pg_temp._ck('P12 replaying a recorded grant event is a duplicate and writes nothing',
  pg_temp._pay(pg_temp._acct(2), 'txn_partner2', 'transaction.completed', 'completed', '2026-11-14T10:00:00Z', true, 6) = 'DUPLICATE/false/paid');
select pg_temp._ck('P13 the same transaction replayed with a DIFFERENT length is refused (BINDING_CONFLICT), not silently kept',
  pg_temp._pay(pg_temp._acct(2), 'txn_partner2', 'transaction.completed', 'completed', '2027-01-01T10:00:00Z', true, 12) = 'EV011: BINDING_CONFLICT'
  and pg_temp._pay(pg_temp._acct(2), 'txn_partner2', 'transaction.completed', 'completed', '2027-01-02T10:00:00Z', true, null) = 'EV011: BINDING_CONFLICT');
select pg_temp._ck('P14 a grant is for an INDIVIDUAL account only: a brokerage account is refused (EV013) and nothing is recorded',
  pg_temp._pay(pg_temp._acct(5), 'txn_team', 'transaction.completed', 'completed', '2026-11-14T10:00:00Z', true, 6) = 'EV013: OFFER_NOT_FOR_ACCOUNT'
  and not exists (select 1 from public.brokerage_subscription where subscription_ref = 'txn_team')
  and not exists (select 1 from public.payment_event where subscription_ref = 'txn_team'));
select pg_temp._ck('P15 a grant length outside 1..24 is refused',
  pg_temp._pay(pg_temp._acct(6), 'txn_bad0', 'transaction.completed', 'completed', '2026-11-14T10:00:00Z', true, 0) like '22023:%'
  and pg_temp._pay(pg_temp._acct(6), 'txn_bad25', 'transaction.completed', 'completed', '2026-11-14T10:00:00Z', true, 25) like '22023:%');
select pg_temp._ck('P16 a test-mode (sandbox) grant is recorded but never grants: test_only',
  pg_temp._pay(pg_temp._acct(6), 'txn_sandbox', 'transaction.completed', 'completed', '2026-11-14T10:00:00Z', false, 6) = 'RECORDED/true/test_only');

-- ---- expiry ----------------------------------------------------------------------------------------------------------------------------
-- a grant bound seven months ago: the binding's own bound_at is the clock the length counts from, so it is written back in time for the test
insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode, bound_at, access_months)
values (pg_temp._acct(3), 'paddle', 'txn_old3', true, now() - interval '7 months', 6);
select public.payment_event_record(jsonb_build_object('processor','paddle','idempotency_key','evt_old3','subscription_ref','txn_old3',
  'event_name','transaction.completed','processor_status','completed','occurred_at', to_char(now() - interval '7 months','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'livemode', true));
select pg_temp._ck('P17 a grant whose six months have run out reads EXPIRED, not paid', (select state from public.billing_plan_of(pg_temp._acct(3))) = 'expired');
select pg_temp._ck('P18 an expired grant: no credits remain, the end date is in the past, and the page can say so',
  (select credits_remaining = 0 and credits_used = 0 and access_ends_at < now() and state = 'expired' from public.billing_usage(pg_temp._u(3))));
select pg_temp._ck('P19 an expired grant charges NO paid report: the next report falls to the free evaluation', pg_temp._issue(3, 4) like 'trial/%');
select pg_temp._ck('P20 even a direct write cannot reach a seventh month (the credit guard refuses: this one-time access has ended)',
  pg_temp._why(format($q$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select binding_id, %L, 0, 1, 11, %L, gen_random_uuid() from public.brokerage_subscription where subscription_ref = 'txn_old3'$q$, pg_temp._acct(3), pg_temp._k(77))) like '%one-time access has ended%');
-- a grant bound five months and twenty days ago is in its sixth month: still paid, and its last month's allotment is 100
insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode, bound_at, access_months)
values (pg_temp._acct(4), 'paddle', 'txn_edge4', true, now() - interval '5 months 20 days', 6);
select public.payment_event_record(jsonb_build_object('processor','paddle','idempotency_key','evt_edge4','subscription_ref','txn_edge4',
  'event_name','transaction.completed','processor_status','completed','occurred_at', to_char(now() - interval '5 months 20 days','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'livemode', true));
select pg_temp._ck('P21 in the sixth month the grant is still paid and a report is charged to it', (select state from public.billing_plan_of(pg_temp._acct(4))) = 'paid' and pg_temp._issue(4, 5) = 'paid/1');
select pg_temp._ck('P22 in the sixth month the allotment ends when ACCESS ends, not a month later',
  (select period_ends_at = access_ends_at from public.billing_usage(pg_temp._u(4))));
-- one day past the sixth month: expired (a grant that ends a month late would still read paid here)
insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode, bound_at, access_months)
values (pg_temp._acct(7), 'paddle', 'txn_late7', true, now() - interval '6 months 1 day', 6);
select public.payment_event_record(jsonb_build_object('processor','paddle','idempotency_key','evt_late7','subscription_ref','txn_late7',
  'event_name','transaction.completed','processor_status','completed','occurred_at', to_char(now() - interval '6 months 1 day','YYYY-MM-DD"T"HH24:MI:SS"Z"'),'livemode', true));
select pg_temp._ck('P27 one day past six months the grant is expired, and a report is not charged to the paid allotment',
  (select state from public.billing_plan_of(pg_temp._acct(7))) = 'expired' and pg_temp._issue(7, 6) like 'trial/%');
select pg_temp._ck('P23 a refund-shaped status (refunded) ends a grant at once', 
  pg_temp._pay(pg_temp._acct(2), 'txn_partner2', 'adjustment.updated', 'refunded', '2026-11-16T10:00:00Z', true, 6) = 'RECORDED/false/canceled');

-- ---- what was there before stays exactly as it was ----------------------------------------------------------------------------
create temp table _l as select pg_temp._why(format($q$select * from public.billing_event_apply(%L, jsonb_build_object('processor','lemonsqueezy','idempotency_key','l1','subscription_ref','1',
    'event_name','subscription_created','processor_status','active','occurred_at','2026-10-06T18:08:09Z','livemode', false))$q$, pg_temp._acct(1))) why;
select pg_temp._ck('P24 the existing Lemon-style event still records through the three-argument writer and reads as before',
  (select why from _l) = 'ok' and (select mapped_status from public.payment_event where processor = 'lemonsqueezy' and idempotency_key = 'l1') = 'active', (select why from _l));
select pg_temp._ck('P25 the billing functions are executable by service_role alone',
  has_function_privilege('service_role','public.billing_event_apply(uuid, jsonb, integer)','execute')
  and not has_function_privilege('anon','public.billing_event_apply(uuid, jsonb, integer)','execute')
  and not has_function_privilege('authenticated','public.billing_event_apply(uuid, jsonb, integer)','execute')
  and has_function_privilege('service_role','public.billing_usage(uuid)','execute')
  and not has_function_privilege('anon','public.billing_usage(uuid)','execute')
  and not has_function_privilege('authenticated','public.billing_usage(uuid)','execute'));
select pg_temp._ck('P26 control: the suite really created grants and subscriptions (a zero here would make the rest vacuous)',
  (select count(*) from public.brokerage_subscription where access_months = 6) >= 4 and (select count(*) from public.brokerage_subscription where access_months is null and processor = 'paddle') >= 1);

\o
select check_name || '|' || case when pass then 't' else 'f' end || '|' || coalesce(detail, '') from _r order by n;
