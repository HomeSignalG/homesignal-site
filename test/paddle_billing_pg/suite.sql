-- PADDLE FULFILMENT AGAINST THE REAL BILLING SQL. Deliveries are built by gen-events.mjs: signed with the real secrets, verified and translated by the REAL adapter, then replayed here
-- through public.billing_event_apply (the webhook's one writer). Every expected answer is a hard-coded constant. Output: one row per check: name|t/f|detail.
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as $$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
create function pg_temp._why(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;
create function pg_temp._bk(l text) returns uuid language sql as $$ select brokerage_id from public.fx_acct where label = l $$;
create function pg_temp._un(l text) returns int language sql as $$ select user_n from public.fx_acct where label = l $$;
\i :events
-- apply one delivery by label, the way the webhook does: an event names its brokerage; an adjustment is looked up by its subscription
create temp table _a (label text primary key, outcome text, is_latest boolean, bound boolean, state text, err text);
create function pg_temp._apply(p_label text) returns void language plpgsql as $$
declare f record; b uuid; r record;
begin
  select * into f from _fx where label = p_label;
  b := case when f.kind = 'event' then f.brokerage
            else public.billing_binding_brokerage(f.event->>'processor', (f.event->>'livemode')::boolean, f.event->>'subscription_ref') end;
  select * into r from public.billing_event_apply(b, f.event);
  insert into _a values (p_label, r.outcome, r.is_latest, r.bound, r.state, null);
exception when others then insert into _a (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._st(p_label text) returns text language sql as $$ select state from _a where label = p_label $$;
create function pg_temp._plan(l text) returns text language sql as $$ select state from public.billing_plan_of(pg_temp._bk(l)) $$;
create function pg_temp._usage(l text) returns text language sql as $$
  select coalesce(string_agg(role || '/' || state || '/' || credit_limit || '/' || credits_used || '/' || credits_remaining, ';'), 'none') from public.billing_usage(pg_temp._u(pg_temp._un(l))) $$;
create temp table _i (label text primary key, allot text, used int, remaining int, err text);
create function pg_temp._iss(p_label text, p_acct text, p_k int) returns void language plpgsql as $$
declare r record; b text := format('{"product":"HomeSignal Development Activity","n":%s}', p_k);
begin
  select * into r from public.brokerage_report_issue(pg_temp._u(pg_temp._un(p_acct)), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, null);
  insert into _i values (p_label, r.allotment, r.credits_used, r.credits_remaining, null);
exception when others then insert into _i (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._ledger(p_sub text) returns integer language sql as $$ select count(*)::int from public.payment_event where processor = 'paddle' and subscription_ref = p_sub $$;
create function pg_temp._paid(l text) returns integer language sql as $$ select count(*)::int from public.brokerage_paid_credit where brokerage_id = pg_temp._bk(l) $$;

-- ---- N. the status map ------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('N1 Paddle statuses map exactly: active->active, trialing, paused, past_due, canceled, refunded and charged_back->canceled',
  public.payment_event_map_status('paddle','active') = 'active' and public.payment_event_map_status('paddle','trialing') = 'trialing' and public.payment_event_map_status('paddle','paused') = 'paused'
  and public.payment_event_map_status('paddle','past_due') = 'past_due' and public.payment_event_map_status('paddle','canceled') = 'canceled'
  and public.payment_event_map_status('paddle','refunded') = 'canceled' and public.payment_event_map_status('paddle','charged_back') = 'canceled');
select pg_temp._ck('N2 an unknown Paddle word, a case variant, a null and an unknown processor are all `unknown`, never `active`',
  public.payment_event_map_status('paddle','ACTIVE') = 'unknown' and public.payment_event_map_status('paddle','unpaid') = 'unknown' and public.payment_event_map_status('paddle', null) = 'unknown'
  and public.payment_event_map_status('paddle ','active') = 'unknown' and public.payment_event_map_status('stripe','active') = 'unknown');
select pg_temp._ck('N3 the Lemon Squeezy mapping is unchanged (customers on it are untouched)',
  public.payment_event_map_status('lemonsqueezy','active') = 'active' and public.payment_event_map_status('lemonsqueezy','on_trial') = 'trialing' and public.payment_event_map_status('lemonsqueezy','cancelled') = 'canceled'
  and public.payment_event_map_status('lemonsqueezy','expired') = 'canceled' and public.payment_event_map_status('lemonsqueezy','unpaid') = 'unpaid' and public.payment_event_map_status('lemonsqueezy','refunded') = 'unknown');

-- ---- A. an INDIVIDUAL buys (no brokerage involved), renews, goes past due, resumes, cancels --------------------------------------------------------------------
select pg_temp._ck('A0 the buyer is an INDIVIDUAL account: type individual, one member, owner', (select account_type from public.brokerage_account where id = pg_temp._bk('ind')) = 'individual'
  and (select count(*) from public.brokerage_membership_of(pg_temp._u(1))) = 1 and pg_temp._usage('ind') = 'owner/none/100/0/0', pg_temp._usage('ind'));
select pg_temp._apply('a_created');
select pg_temp._ck('A1 a verified active subscription binds to the buyer''s account and makes it PAID: 100 reports, none used, 100 left',
  pg_temp._st('a_created') = 'paid' and (select outcome from _a where label='a_created') = 'RECORDED' and (select bound from _a where label='a_created') and pg_temp._usage('ind') = 'owner/paid/100/0/100',
  coalesce((select err from _a where label='a_created'), pg_temp._usage('ind')));
select pg_temp._apply('a_created_dup');
select pg_temp._ck('A2 the SAME delivery again is a DUPLICATE: nothing new recorded, still paid', (select outcome from _a where label='a_created_dup') = 'DUPLICATE' and pg_temp._ledger('sub_A') = 1 and pg_temp._plan('ind') = 'paid',
  (select err from _a where label='a_created_dup'));
select pg_temp._apply('a_past_due');
select pg_temp._ck('A3 past_due ends access at once (no grace is invented): state past_due, 0 left', pg_temp._plan('ind') = 'past_due' and pg_temp._usage('ind') = 'owner/past_due/100/0/0', pg_temp._usage('ind'));
select pg_temp._apply('a_resumed');
select pg_temp._ck('A4 a later active event restores access (a retried payment succeeded)', pg_temp._plan('ind') = 'paid' and pg_temp._usage('ind') = 'owner/paid/100/0/100');
select pg_temp._iss('a_r1', 'ind', 1);
select pg_temp._ck('A5 a report made while paid is charged to the PAID allotment: 1 used, 99 left, one paid-credit row',
  (select allot from _i where label='a_r1') = 'paid' and (select used from _i where label='a_r1') = 1 and (select remaining from _i where label='a_r1') = 99 and pg_temp._paid('ind') = 1,
  coalesce((select err from _i where label='a_r1'), 'x'));
select pg_temp._apply('a_canceled');
select pg_temp._ck('A6 CANCELLATION: state canceled, the allowance reads 0 left, and a new report is NOT charged to the paid allotment', pg_temp._plan('ind') = 'canceled' and pg_temp._usage('ind') = 'owner/canceled/100/0/0', pg_temp._usage('ind'));
select pg_temp._iss('a_r2', 'ind', 2);
select pg_temp._ck('A7 after cancellation no paid credit is ever written (the paid ledger still holds exactly the one earlier report)', pg_temp._paid('ind') = 1 and coalesce((select allot from _i where label='a_r2'), 'refused') <> 'paid',
  coalesce((select allot from _i where label='a_r2'), (select err from _i where label='a_r2')));
select pg_temp._ck('A8 the reports already made survive the cancellation (the stored report is kept)', exists (select 1 from public.brokerage_paid_credit c where c.brokerage_id = pg_temp._bk('ind')));

-- ---- B. out of order -------------------------------------------------------------------------------------------------------------------------------
select pg_temp._apply('b_canceled_first');
select pg_temp._ck('B1 a cancellation that arrives first binds and reads canceled', pg_temp._st('b_canceled_first') = 'canceled' and pg_temp._plan('brk') = 'canceled', (select err from _a where label='b_canceled_first'));
select pg_temp._apply('b_active_late');
select pg_temp._ck('B2 an OLDER active event arriving LATER is recorded but is not the latest: the plan stays canceled (order is Paddle''s occurred_at, never arrival)',
  (select outcome from _a where label='b_active_late') = 'RECORDED' and not (select is_latest from _a where label='b_active_late') and pg_temp._plan('brk') = 'canceled' and pg_temp._ledger('sub_B') = 2,
  coalesce((select err from _a where label='b_active_late'), pg_temp._plan('brk')));

-- ---- C. refund -------------------------------------------------------------------------------------------------------------------------------------
select pg_temp._apply('c_created');
select pg_temp._ck('C0 the refund target subscription is paid first', pg_temp._plan('ref') = 'paid');
select pg_temp._ck('C1 an adjustment names no brokerage: it is found through the subscription''s binding (live), and an unbound id and the TEST mode find nothing',
  public.billing_binding_brokerage('paddle', true, 'sub_C') = pg_temp._bk('ref') and public.billing_binding_brokerage('paddle', true, 'sub_unbound') is null and public.billing_binding_brokerage('paddle', false, 'sub_C') is null);
select pg_temp._apply('c_refund');
select pg_temp._ck('C2 an approved FULL REFUND ends access: state canceled, 0 left', pg_temp._st('c_refund') = 'canceled' and pg_temp._plan('ref') = 'canceled' and pg_temp._usage('ref') = 'owner/canceled/100/0/0',
  coalesce((select err from _a where label='c_refund'), pg_temp._usage('ref')));
select pg_temp._apply('c_older_active');
select pg_temp._ck('C3 an active event DATED BEFORE the refund, arriving after it, does not give the access back', pg_temp._plan('ref') = 'canceled');
select pg_temp._apply('c_later_active');
select pg_temp._ck('C4 a genuinely LATER active event (Paddle charged again, so the subscription is live) does give access back: documented, not a silent bug', pg_temp._plan('ref') = 'paid');

-- ---- D. sandbox never grants ------------------------------------------------------------------------------------------------------------------------
select pg_temp._apply('d_sandbox');
select pg_temp._ck('D1 a SANDBOX subscription binds as TEST mode: state test_only, 0 left (it can never make a live account paid)',
  pg_temp._plan('sbx') = 'test_only' and pg_temp._usage('sbx') = 'owner/test_only/100/0/0' and (select livemode from public.brokerage_subscription where subscription_ref = 'sub_D') = false, pg_temp._usage('sbx'));
select pg_temp._iss('d_r1', 'sbx', 3);
select pg_temp._ck('D2 a report on a test-only plan is never charged to the paid allotment', pg_temp._paid('sbx') = 0);

-- ---- E. the monthly allowance and its RESET ---------------------------------------------------------------------------------------------------------
-- the binding is dated so that the first month ends in ~4 seconds: two reports now, then the same account after the month turns
insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode, bound_at) values (pg_temp._bk('rst'), 'paddle', 'sub_E', true, now() - interval '1 month' + interval '4 seconds');
select pg_temp._apply('e_active');
select pg_temp._ck('E1 an active live subscription bound to a pre-existing binding is paid with 100 left', pg_temp._plan('rst') = 'paid' and pg_temp._usage('rst') = 'owner/paid/100/0/100', pg_temp._usage('rst'));
select pg_temp._iss('e_r1', 'rst', 11);
select pg_temp._iss('e_r2', 'rst', 12);
select pg_temp._ck('E2 two reports are charged to month 0: 2 used, 98 left', (select used from _i where label='e_r2') = 2 and (select remaining from _i where label='e_r2') = 98 and pg_temp._usage('rst') = 'owner/paid/100/2/98',
  coalesce((select err from _i where label='e_r2'), pg_temp._usage('rst')));
select pg_sleep(5);
select pg_temp._ck('E3 THE MONTH RESET: once the billing month turns the allowance is a fresh 100 (the earlier two are history, not counted)', pg_temp._usage('rst') = 'owner/paid/100/0/100', pg_temp._usage('rst'));
select pg_temp._iss('e_r3', 'rst', 13);
select pg_temp._ck('E4 the first report of the new month is paid report 1 of 100 and the ledger keeps both months',
  (select used from _i where label='e_r3') = 1 and (select remaining from _i where label='e_r3') = 99
  and (select count(*) from public.brokerage_paid_credit where brokerage_id = pg_temp._bk('rst') and period_index = 0) = 2
  and (select count(*) from public.brokerage_paid_credit where brokerage_id = pg_temp._bk('rst') and period_index = 1) = 1, coalesce((select err from _i where label='e_r3'), 'x'));
do $$ begin for i in 14..112 loop perform pg_temp._iss('e_f' || i, 'rst', i); end loop; end $$;
select pg_temp._iss('e_over', 'rst', 200);
select pg_temp._ck('E5 the 100th report of the month is allowed and the 101st is refused ALLOTMENT_COMPLETE (no overage, no extra purchase)',
  (select used from _i where label='e_f112') = 100 and (select remaining from _i where label='e_f112') = 0 and (select err from _i where label='e_over') like '%ALLOTMENT_COMPLETE%'
  and (select count(*) from public.brokerage_paid_credit where brokerage_id = pg_temp._bk('rst') and period_index = 1) = 100,
  coalesce((select err from _i where label='e_over'), 'no error') || ' used=' || coalesce((select used::text from _i where label='e_f112'), '?'));

-- ---- F. one subscription belongs to one account for ever ----------------------------------------------------------------------------------------------
select pg_temp._apply('f_conflict');
select pg_temp._ck('F1 a second account presenting an already-bound subscription is refused BINDING_CONFLICT and records nothing', (select err from _a where label='f_conflict') like '%BINDING_CONFLICT%'
  and pg_temp._ledger('sub_A') = 4 and (select count(*) from public.brokerage_subscription where subscription_ref = 'sub_A') = 1 and pg_temp._usage('other') = 'owner/none/100/0/0', (select err from _a where label='f_conflict'));

-- ---- G. paused, H. chargeback -----------------------------------------------------------------------------------------------------------------------
select pg_temp._apply('g_active'); select pg_temp._apply('g_paused');
select pg_temp._ck('G1 a paused subscription does not grant (state past_due, 0 left)', pg_temp._plan('pau') = 'past_due' and pg_temp._usage('pau') = 'owner/past_due/100/0/0', pg_temp._usage('pau'));
select pg_temp._apply('h_active'); select pg_temp._apply('h_chargeback');
select pg_temp._ck('H1 an approved chargeback ends access like a cancellation', pg_temp._plan('chb') = 'canceled' and pg_temp._usage('chb') = 'owner/canceled/100/0/0', pg_temp._usage('chb'));

-- ---- J. a word nobody mapped never grants ---------------------------------------------------------------------------------------------------------------
select pg_temp._ck('J1 a status word the map does not know is recorded as unknown and does not grant',
  (select state from public.billing_event_apply(pg_temp._bk('other'), jsonb_build_object('processor','paddle','idempotency_key','evt_unknown_1','subscription_ref','sub_J','event_name','subscription.updated','processor_status','weird','occurred_at','2026-11-12T10:00:00Z','variant_ref','pri_01m7d6kede6hqr2kh9b78mb25j','livemode',true))) = 'unknown'
  and pg_temp._usage('other') = 'owner/unknown/100/0/0', pg_temp._usage('other'));

-- ---- K. privileges and privacy -----------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('K1 the binding lookup and the status map are executable by service_role alone',
  has_function_privilege('service_role', 'public.billing_binding_brokerage(text,boolean,text)', 'EXECUTE') and not has_function_privilege('anon', 'public.billing_binding_brokerage(text,boolean,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.billing_binding_brokerage(text,boolean,text)', 'EXECUTE') and not has_function_privilege('anon', 'public.payment_event_map_status(text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.payment_event_map_status(text,text)', 'EXECUTE') and has_function_privilege('service_role', 'public.payment_event_map_status(text,text)', 'EXECUTE'));
select pg_temp._ck('K2 nothing personal reached the ledger: every Paddle row holds only opaque ids (no email, customer id, name or amount)',
  not exists (select 1 from public.payment_event e where e.processor = 'paddle' and (e.subscription_ref ~ '[@ ]' or coalesce(e.product_ref,'') ~ '[@ ]' or coalesce(e.variant_ref,'') ~ '[@ ]' or e.idempotency_key ~ '[@ ]'))
  and (select count(*) from public.payment_event where processor = 'paddle') > 15);
select pg_temp._ck('K3 the audit finds nothing wrong after all of it (billing_check reports no violation)', not exists (select 1 from public.billing_check() c where c.kind = 'invariant' and c.violations > 0) and exists (select 1 from public.billing_check() c where c.kind = 'control' and c.violations > 0),
  (select string_agg(row_to_json(c)::text, ' ') from public.billing_check() c where c.kind = 'invariant' and c.violations > 0));
select pg_temp._ck('K4 a payment event can never be changed or removed (append-only)', pg_temp._why($$update public.payment_event set livemode = true$$) like '%append-only%' and pg_temp._why($$delete from public.payment_event$$) like '%append-only%');

\o
select check_name || '|' || case when pass then 't' else 'f' end || '|' || coalesce(detail, '') from _r order by n;
