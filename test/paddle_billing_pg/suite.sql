-- =====================================================================================
-- PADDLE BILLING — EXECUTABLE ADVERSARIAL SUITE  (docs/paddle-billing.sql)
-- Stands on the REAL layers brokerage-billing.sql stands on, applied unmutated (free limit under test = 10). Every expected answer is a HARD-CODED
-- constant. The suite runs as the table owner; refusals for the API roles are asked AS those roles.
-- Output: one line per check: PASS/FAIL name :: detail
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as $$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
create function pg_temp._why(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create temp table _setup (n serial, step text, result text);
create function pg_temp._run(p_step text, p_sql text) returns void language plpgsql as $$
begin execute p_sql; insert into _setup (step, result) values (p_step, 'ok');
exception when others then insert into _setup (step, result) values (p_step, sqlstate || ': ' || sqlerrm); end $$;
create function pg_temp._as(p_role text, p_sql text) returns text language plpgsql as $$
begin
  execute 'set local role ' || quote_ident(p_role);
  begin execute p_sql; reset role; return 'ok';
  exception when others then reset role; return sqlstate || ': ' || sqlerrm; end;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;
create function pg_temp._tok(b text) returns text language sql immutable as $$ select encode(sha256(convert_to('partner-token-' || b, 'UTF8')), 'hex') $$;

create temp table _e (label text primary key, evaluation_id uuid, brokerage_id uuid, token text);
create function pg_temp._mk(p_label text, p_name text) returns void language plpgsql as $$
begin insert into _e select p_label, c.evaluation_id, c.brokerage_id, c.owner_token from public.evaluation_create(p_name) c; end $$;
create function pg_temp._ev(p_label text) returns uuid language sql as $$ select evaluation_id from _e where label = p_label $$;
create function pg_temp._bk(p_label text) returns uuid language sql as $$ select brokerage_id from _e where label = p_label $$;
create function pg_temp._own(p_label text, p_user int) returns void language plpgsql as $$
begin perform 1 from public.evaluation_invite_redeem((select token from _e where label = p_label), pg_temp._u(p_user)); end $$;
create function pg_temp._agent(p_label text, p_user int) returns void language plpgsql as $$
declare t text; begin select m.token into t from public.evaluation_invite_mint(pg_temp._ev(p_label), 'agent') m; perform 1 from public.evaluation_invite_redeem(t, pg_temp._u(p_user)); end $$;

-- prices: the two LIVE ids, and two SANDBOX ids registered the way the founder will register real ones
create function pg_temp._pro() returns text language sql as $$ select 'pri_01m7d6kede6hqr2kh9b78mb25j' $$;
create function pg_temp._par() returns text language sql as $$ select 'pri_01m7d6q4yw2yzygm5cz92s5abg' $$;
create function pg_temp._spro() returns text language sql as $$ select 'pri_sandboxpro0000000000000000' $$;
create function pg_temp._spar() returns text language sql as $$ select 'pri_sandboxpar0000000000000000' $$;

create temp table _p (label text primary key, outcome text, bound boolean, state text, latest boolean, err text);
create function pg_temp._evt(p_ref text, p_name text, p_status text, p_at text, p_price text, p_live boolean, p_key text) returns jsonb language sql as $$
  select jsonb_build_object('processor', 'paddle', 'idempotency_key', p_key, 'subscription_ref', p_ref, 'event_name', p_name, 'processor_status', p_status,
    'occurred_at', p_at, 'product_ref', 'pro_test', 'variant_ref', p_price, 'livemode', p_live) $$;
create function pg_temp._apply(p_label text, p_brokerage uuid, p_plan text, p_enr uuid, p_event jsonb, p_period jsonb default null) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.paddle_event_apply(p_brokerage, p_event, p_plan, p_enr, p_period);
  insert into _p values (p_label, r.outcome, r.bound, r.state, r.is_latest, null);
exception when others then insert into _p (label, err) values (p_label, sqlstate || ': ' || sqlerrm); end $$;
create function pg_temp._refund(p_label text, p_event jsonb) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.paddle_adjustment_apply(p_event);
  insert into _p values (p_label, r.outcome, r.bound, r.state, r.is_latest, null);
exception when others then insert into _p (label, err) values (p_label, sqlstate || ': ' || sqlerrm); end $$;
create function pg_temp._o(p_label text) returns text language sql as $$ select coalesce(outcome, err) from _p where label = p_label $$;
create function pg_temp._s(p_label text) returns text language sql as $$ select state from _p where label = p_label $$;
create function pg_temp._plan(p_brokerage uuid) returns text language sql as $$ select state from public.billing_plan_of(p_brokerage) $$;
create function pg_temp._bind(p_brokerage uuid, p_ref text, p_bound timestamptz, p_live boolean default true) returns void language sql as $$
  insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode, bound_at) values (p_brokerage, 'paddle', p_ref, p_live, p_bound) $$;

create temp table _i (label text primary key, report_id uuid, replayed boolean, ordinal int, used int, remaining int, allot text, err text);
create function pg_temp._iss(p_label text, p_u int, p_k int) returns void language plpgsql as $$
declare r record; b text := format('{"product":"HomeSignal Development Activity","n":%s}', p_k);
begin
  select * into r from public.brokerage_report_issue(pg_temp._u(p_u), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, null);
  insert into _i values (p_label, r.report_id, r.replayed, r.credit_ordinal, r.credits_used, r.credits_remaining, r.allotment, null);
exception when others then insert into _i (label, err) values (p_label, sqlstate || ': ' || sqlerrm); end $$;
create function pg_temp._allot(p_label text) returns text language sql as $$ select coalesce(allot, err) from _i where label = p_label $$;
create function pg_temp._paid_n(p_label text) returns integer language sql as $$ select count(*)::int from public.brokerage_paid_credit c where c.brokerage_id = pg_temp._bk(p_label) $$;
create function pg_temp._sum(p_user int) returns text language sql as $$
  select coalesce(string_agg(state || '/' || coalesce(plan_key, '-') || '/' || coalesce(kind, '-') || '/' || credit_limit || '/' || credits_used || '/' || credits_remaining, ';'), 'none') from public.billing_summary(pg_temp._u(p_user)) $$;

-- ---- setup -------------------------------------------------------------------------------------------
select pg_temp._run('users', $$insert into auth.users (id, email, raw_user_meta_data) select pg_temp._u(g), 'person' || g || '@example.test', '{}'::jsonb from generate_series(1, 40) g$$);
do $$ declare l text; u int; begin
  for l, u in select * from (values ('pro',1),('par',2),('par2',3),('hen',4),('snd',5),('old',11),('rfd',7),('lim1',12),('lim2',13),('vfy',14),('lem',15),
      ('k0',16),('k1',17),('k2',18),('k3',19),('k4',20),('k5',21),('k6',22),('roll',38)) v loop
    perform pg_temp._run('mk ' || l, format($f$select pg_temp._mk(%L, %L)$f$, l, 'Brokerage ' || l));
    perform pg_temp._run('own ' || l, format($f$select pg_temp._own(%L, %s)$f$, l, u));
  end loop;
end $$;
select pg_temp._run('agent pro', $$select pg_temp._agent('pro', 30)$$);
select pg_temp._run('sandbox prices', $$insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind, access_months) values
  (pg_temp._spro(), false, 'professional', 'Professional', 'recurring', null), (pg_temp._spar(), false, 'private_partner', 'Private Partner Offer', 'one_time', 6)$$);
-- partner side
create temp table _pt (k text primary key, id uuid);
select pg_temp._run('partner brokerage', $$insert into _pt values ('pb', public.partner_brokerage_create('Acme Realty (partner)'))$$);
select pg_temp._run('partner brokerage off', $$insert into _pt values ('pboff', public.partner_brokerage_create('Dormant Realty'))$$);
select pg_temp._run('off it', $$update public.partner_brokerage set status = 'inactive' where partner_id = (select id from _pt where k = 'pboff')$$);
select pg_temp._run('link ok', $$insert into _pt values ('l_ok', public.partner_link_create((select id from _pt where k='pb'), pg_temp._tok('ok'), now() + interval '30 days', 50))$$);
select pg_temp._run('link expired', $$insert into _pt values ('l_exp', public.partner_link_create((select id from _pt where k='pb'), pg_temp._tok('exp'), now() - interval '1 day', 50))$$);
select pg_temp._run('link off brokerage', $$insert into _pt values ('l_off', public.partner_link_create((select id from _pt where k='pboff'), pg_temp._tok('off'), null, 50))$$);
select pg_temp._run('link one seat', $$insert into _pt values ('l_one', public.partner_link_create((select id from _pt where k='pb'), pg_temp._tok('one'), null, 1))$$);
select pg_temp._run('link inactive', $$insert into _pt values ('l_dead', public.partner_link_create((select id from _pt where k='pb'), pg_temp._tok('dead'), null, 50))$$);
select pg_temp._run('kill link', $$update public.partner_link set active = false where link_id = (select id from _pt where k = 'l_dead')$$);

-- =====================================================================================================
-- A. THE MAPPING AND THE PRICE TABLE
-- =====================================================================================================
select pg_temp._ck('A01 paddle statuses map: active->active, completed->active, trialing->trialing, past_due->past_due, paused->paused, canceled->canceled, refunded->canceled; anything else (incl. wrong case) -> unknown',
  public.payment_event_map_status('paddle','active') = 'active' and public.payment_event_map_status('paddle','completed') = 'active'
  and public.payment_event_map_status('paddle','trialing') = 'trialing' and public.payment_event_map_status('paddle','past_due') = 'past_due'
  and public.payment_event_map_status('paddle','paused') = 'paused' and public.payment_event_map_status('paddle','canceled') = 'canceled'
  and public.payment_event_map_status('paddle','refunded') = 'canceled' and public.payment_event_map_status('paddle','ACTIVE') = 'unknown'
  and public.payment_event_map_status('paddle','billed') = 'unknown' and public.payment_event_map_status('paddle', null) = 'unknown');
select pg_temp._ck('A02 the historical Lemon Squeezy mapping is unchanged (its recorded test events keep their meaning) and an unknown processor maps to unknown',
  public.payment_event_map_status('lemonsqueezy','cancelled') = 'canceled' and public.payment_event_map_status('lemonsqueezy','active') = 'active'
  and public.payment_event_map_status('stripe','active') = 'unknown');
select pg_temp._ck('A03 the two LIVE prices are seeded: Professional is recurring, the Private Partner offer is one-time for 6 months; both 100 reports a month',
  public.billing_price_for('professional', true) = pg_temp._pro() and public.billing_price_for('private_partner', true) = pg_temp._par()
  and (select kind = 'recurring' and access_months is null and reports_per_month = 100 from public.billing_plan_price where price_ref = pg_temp._pro() and livemode)
  and (select kind = 'one_time' and access_months = 6 and reports_per_month = 100 from public.billing_plan_price where price_ref = pg_temp._par() and livemode));
select pg_temp._ck('A04 a price cannot be 99 reports, a one-time price must name months, a recurring price cannot, and a plan outside the two is refused',
  pg_temp._why($$insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind, access_months, reports_per_month) values ('pri_x1', true, 'professional', 'P', 'recurring', null, 99)$$) like '23514%'
  and pg_temp._why($$insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind, access_months) values ('pri_x2', true, 'private_partner', 'P', 'one_time', null)$$) like '23514%'
  and pg_temp._why($$insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind, access_months) values ('pri_x3', true, 'professional', 'P', 'recurring', 6)$$) like '23514%'
  and pg_temp._why($$insert into public.billing_plan_price (price_ref, livemode, plan_key, plan_label, kind) values ('pri_x4', true, 'brokerage_enterprise', 'B', 'recurring')$$) like '23514%');
select pg_temp._ck('A05 there is NO live price for Brokerage & Enterprise: it cannot be bought (quote only)', public.billing_price_for('brokerage_enterprise', true) is null);

-- =====================================================================================================
-- B. PROFESSIONAL ($78 a month, recurring)
-- =====================================================================================================
select pg_temp._run('pro created', $$select pg_temp._apply('b1', pg_temp._bk('pro'), 'professional', null,
  pg_temp._evt('sub_pro1','subscription_created','active','2026-11-16T10:00:00Z', pg_temp._pro(), true,'evt_b1'),
  '{"next_billed_at":"2026-12-16T10:00:00Z","period_ends_at":"2026-12-16T10:00:00Z"}'::jsonb)$$);
select pg_temp._ck('B01 a signed live Professional subscription event binds the subscription to the brokerage and the plan is PAID', pg_temp._o('b1') = 'RECORDED' and (select bound from _p where label='b1') and pg_temp._plan(pg_temp._bk('pro')) = 'paid', pg_temp._o('b1'));
select pg_temp._run('pro dup', $$select pg_temp._apply('b2', pg_temp._bk('pro'), 'professional', null,
  pg_temp._evt('sub_pro1','subscription_created','active','2026-11-16T10:00:00Z', pg_temp._pro(), true,'evt_b1'), '{"next_billed_at":"2026-12-16T10:00:00Z"}'::jsonb)$$);
select pg_temp._ck('B02 a re-delivered event (same Paddle event_id) is DUPLICATE: one ledger row, one period observation, nothing changes',
  pg_temp._o('b2') = 'DUPLICATE' and (select count(*) = 1 from public.payment_event where idempotency_key = 'evt_b1') and (select count(*) = 1 from public.billing_period_observation where subscription_ref = 'sub_pro1'));
select pg_temp._run('pro old', $$select pg_temp._apply('b3', pg_temp._bk('pro'), 'professional', null,
  pg_temp._evt('sub_pro1','subscription_updated','past_due','2026-11-15T09:00:00Z', pg_temp._pro(), true,'evt_b3'), null)$$);
select pg_temp._ck('B03 an OLDER event delivered LATER is recorded and is not the latest: the plan stays paid (ordered by Paddle time, never arrival)',
  pg_temp._o('b3') = 'RECORDED' and not (select latest from _p where label = 'b3') and pg_temp._plan(pg_temp._bk('pro')) = 'paid');
select pg_temp._run('pro report', $$select pg_temp._iss('b4', 1, 1001)$$);
select pg_temp._ck('B04 a paid member''s report is charged to the PAID allotment (ordinal 1, 99 left)', pg_temp._allot('b4') = 'paid' and (select ordinal = 1 and remaining = 99 from _i where label = 'b4'), pg_temp._allot('b4'));
select pg_temp._ck('B05 the dashboard reader: Professional, recurring, 100 allowed, 1 used, 99 left, a next reset and a renewal date, no access end',
  pg_temp._sum(1) = 'paid/professional/recurring/100/1/99' and (select next_reset_at is not null and renews_at = '2026-12-16T10:00:00Z' and access_ends_at is null and cancel_effective_at is null from public.billing_summary(pg_temp._u(1))), pg_temp._sum(1));
select pg_temp._ck('B06 an AGENT of the brokerage reads the same plan (their own role)', (select role = 'agent' and state = 'paid' from public.billing_summary(pg_temp._u(30))));
select pg_temp._run('pro cancel sched', $$select pg_temp._apply('b5', pg_temp._bk('pro'), 'professional', null,
  pg_temp._evt('sub_pro1','subscription_updated','active','2026-11-20T10:00:00Z', pg_temp._pro(), true,'evt_b5'),
  '{"next_billed_at":null,"period_ends_at":"2026-12-16T10:00:00Z","cancel_effective_at":"2026-12-16T10:00:00Z"}'::jsonb)$$);
select pg_temp._ck('B07 CANCELLATION KEEPS PAID ACCESS THROUGH THE PERIOD: Paddle keeps the status active with a scheduled cancel, the plan stays paid, reports are still issued, and the dashboard shows the end date and no renewal',
  pg_temp._plan(pg_temp._bk('pro')) = 'paid' and (select access_ends_at = '2026-12-16T10:00:00Z' and cancel_effective_at = '2026-12-16T10:00:00Z' and renews_at is null from public.billing_summary(pg_temp._u(1)))
  and (select pg_temp._iss('b6', 1, 1002) is not null) and pg_temp._allot('b6') = 'paid');
select pg_temp._run('pro canceled', $$select pg_temp._apply('b7', pg_temp._bk('pro'), 'professional', null,
  pg_temp._evt('sub_pro1','subscription_canceled','canceled','2026-12-16T10:00:00Z', pg_temp._pro(), true,'evt_b7'), null)$$);
select pg_temp._run('pro after cancel', $$select pg_temp._iss('b8', 1, 1003)$$);
select pg_temp._ck('B08 when the period ends and Paddle sends canceled, the plan is CANCELED and a new report is NOT charged to the paid allotment',
  pg_temp._plan(pg_temp._bk('pro')) = 'canceled' and pg_temp._allot('b8') is distinct from 'paid' and pg_temp._paid_n('pro') = 2, pg_temp._allot('b8'));
select pg_temp._ck('B09 a paused or past-due subscription never grants (past_due, paused, trialing, an unknown word)', (
  select bool_and(public.payment_event_map_status('paddle', s) <> 'active') from unnest(array['past_due','paused','trialing','weird','billed','draft','ready']) s));

-- unknown / mismatched / test prices
select pg_temp._run('unk price', $$select pg_temp._apply('b9', pg_temp._bk('hen'), 'professional', null, pg_temp._evt('sub_x','subscription_created','active','2026-11-16T10:00:00Z','pri_unknown0000000000000000', true,'evt_b9'), null)$$);
select pg_temp._ck('B10 a price we do not know grants nothing, records no ledger event, and is kept in the unmatched list with its reason',
  pg_temp._o('b9') = 'UNKNOWN_PRICE' and not exists (select 1 from public.payment_event where idempotency_key = 'evt_b9') and (select reason = 'UNKNOWN_PRICE' from public.paddle_unmatched_event where idempotency_key = 'evt_b9')
  and pg_temp._plan(pg_temp._bk('hen')) is null);
select pg_temp._run('mismatch', $$select pg_temp._apply('b10', pg_temp._bk('hen'), 'professional', null, pg_temp._evt('txn_m','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_b10'), null)$$);
select pg_temp._ck('B11 a signed checkout that named Professional cannot be used to pay the partner price (PLAN_MISMATCH): nothing granted', pg_temp._o('b10') = 'PLAN_MISMATCH' and pg_temp._plan(pg_temp._bk('hen')) is null);
select pg_temp._run('test on live', $$select pg_temp._apply('b11', pg_temp._bk('hen'), 'professional', null, pg_temp._evt('sub_t','subscription_created','active','2026-11-16T10:00:00Z', pg_temp._pro(), false,'evt_b11'), null)$$);
select pg_temp._ck('B12 a SANDBOX (livemode false) delivery naming a LIVE price id grants nothing and is flagged TEST_PRICE_LIVE_EVENT', pg_temp._o('b11') = 'UNKNOWN_PRICE' and exists (select 1 from public.paddle_unmatched_event where idempotency_key = 'evt_b11' and reason = 'TEST_PRICE_LIVE_EVENT') and pg_temp._plan(pg_temp._bk('hen')) is null, coalesce(pg_temp._o('b11'),'null') || '/' || coalesce(pg_temp._plan(pg_temp._bk('hen')),'nullplan'));
select pg_temp._run('sandbox pro', $$select pg_temp._apply('b12', pg_temp._bk('snd'), 'professional', null, pg_temp._evt('sub_sb1','subscription_created','active','2026-11-16T10:00:00Z', pg_temp._spro(), false,'evt_b12'), null)$$);
select pg_temp._run('sandbox report', $$select pg_temp._iss('b13', 5, 1004)$$);
select pg_temp._ck('B13 a SANDBOX Professional subscription is recorded and bound (so the founder can see the test) but the state is test_only and no paid credit is ever charged',
  pg_temp._o('b12') = 'RECORDED' and pg_temp._plan(pg_temp._bk('snd')) = 'test_only' and pg_temp._allot('b13') is distinct from 'paid' and pg_temp._paid_n('snd') = 0);
select pg_temp._run('prof txn', $$select pg_temp._apply('b14', pg_temp._bk('hen'), 'professional', null, pg_temp._evt('txn_p','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._pro(), true,'evt_b14'), null)$$);
select pg_temp._ck('B14 a one-time transaction event on the recurring price is refused (UNSUPPORTED_EVENT)', pg_temp._o('b14') = 'UNSUPPORTED_EVENT' and pg_temp._plan(pg_temp._bk('hen')) is null);
select pg_temp._ck('B15 a payer''s email in an event is REFUSED by the ledger (nothing personal is stored), and the refusal is a 22023',
  pg_temp._why($$select * from public.paddle_event_apply(pg_temp._bk('hen'), jsonb_build_object('processor','paddle','idempotency_key','evt_pii','subscription_ref','sub_pii','event_name','subscription_created','processor_status','active','occurred_at','2026-11-16T10:00:00Z','variant_ref', pg_temp._pro(),'livemode',true,'email','a@b.c'), 'professional', null, null)$$) like '22023%');
select pg_temp._run('refund pro', $$select pg_temp._refund('b15', pg_temp._evt('sub_pro2','adjustment_refunded','refunded','2026-11-17T10:00:00Z', null, true,'evt_b15'))$$);
select pg_temp._ck('B16 a refund for a subscription we never bound is NO_BINDING (kept for the operator), granting and revoking nothing', pg_temp._o('b15') = 'NO_BINDING');
select pg_temp._run('rfd sub', $$select pg_temp._apply('b16', pg_temp._bk('rfd'), 'professional', null, pg_temp._evt('sub_rfd','subscription_created','active','2026-11-16T10:00:00Z', pg_temp._pro(), true,'evt_b16'), null)$$);
select pg_temp._run('rfd refund', $$select pg_temp._refund('b17', pg_temp._evt('sub_rfd','adjustment_refunded','refunded','2026-11-16T12:00:00Z', null, true,'evt_b17'))$$);
select pg_temp._run('rfd report', $$select pg_temp._iss('b18', 7, 1005)$$);
select pg_temp._ck('B17 a FULL refund is the latest event: the plan is canceled at once and no paid report follows', pg_temp._o('b17') = 'RECORDED' and pg_temp._plan(pg_temp._bk('rfd')) = 'canceled' and pg_temp._allot('b18') is distinct from 'paid');

-- =====================================================================================================
-- C. THE PRIVATE PARTNER OFFER ($234 once, six months, 100 a month)
-- =====================================================================================================
create temp table _en (k text primary key, outcome text, eid uuid, bid uuid);
create function pg_temp._start(p_k text, p_user int, p_tok text) returns void language plpgsql as $$
declare r record; begin select * into r from public.partner_enrollment_start(pg_temp._u(p_user), pg_temp._tok(p_tok));
  insert into _en values (p_k, r.outcome, r.enrollment_id, r.brokerage_id); end $$;
select pg_temp._run('start bad token', $$select pg_temp._start('bad', 2, 'nonesuch')$$);
select pg_temp._run('start expired', $$select pg_temp._start('exp', 2, 'exp')$$);
select pg_temp._run('start off', $$select pg_temp._start('off', 2, 'off')$$);
select pg_temp._run('start dead', $$select pg_temp._start('dead', 2, 'dead')$$);
select pg_temp._run('start agent', $$select pg_temp._start('agent', 30, 'ok')$$);
select pg_temp._run('start ok', $$select pg_temp._start('ok', 2, 'ok')$$);
select pg_temp._run('start ok again', $$select pg_temp._start('ok2', 2, 'ok')$$);
select pg_temp._ck('C01 an unknown, expired, deactivated or inactive-partner link is LINK_INVALID (it never says which), and an agent (not the owner) is NOT_ENTITLED',
  (select outcome from _en where k='bad') = 'LINK_INVALID' and (select outcome from _en where k='exp') = 'LINK_INVALID' and (select outcome from _en where k='off') = 'LINK_INVALID'
  and (select outcome from _en where k='dead') = 'LINK_INVALID' and (select outcome from _en where k='agent') = 'NOT_ENTITLED');
select pg_temp._ck('C02 a valid link for the owner starts ONE enrollment, and asking again returns the same one (no pile of rows)', (select outcome from _en where k='ok') = 'OK' and (select eid from _en where k='ok') = (select eid from _en where k='ok2')
  and (select count(*) = 1 from public.partner_enrollment where account_id = pg_temp._bk('par')));
select pg_temp._run('partner no enr', $$select pg_temp._apply('c1', pg_temp._bk('par'), 'private_partner', null, pg_temp._evt('txn_c1','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_c1'), null)$$);
select pg_temp._ck('C03 the partner price paid WITHOUT an enrollment (someone found the price id) grants NOTHING: PARTNER_NOT_ELIGIBLE, plan none, kept for a refund', pg_temp._o('c1') = 'PARTNER_NOT_ELIGIBLE' and pg_temp._plan(pg_temp._bk('par')) is null
  and exists (select 1 from public.paddle_unmatched_event where idempotency_key = 'evt_c1' and reason = 'PARTNER_NOT_ELIGIBLE'));
select pg_temp._run('partner wrong acct', $$select pg_temp._apply('c2', pg_temp._bk('par2'), 'private_partner', (select eid from _en where k='ok'), pg_temp._evt('txn_c2','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_c2'), null)$$);
select pg_temp._ck('C04 an enrollment belonging to ANOTHER account cannot be used', pg_temp._o('c2') = 'PARTNER_NOT_ELIGIBLE' and pg_temp._plan(pg_temp._bk('par2')) is null);
select pg_temp._run('partner sandbox', $$select pg_temp._apply('c3', pg_temp._bk('par'), 'private_partner', (select eid from _en where k='ok'), pg_temp._evt('txn_sb','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._spar(), false,'evt_c3'), null)$$);
select pg_temp._ck('C05 a SANDBOX partner payment is recorded as test_only, does NOT bind the enrollment, and does not use up a seat on the link',
  pg_temp._o('c3') = 'RECORDED' and pg_temp._plan(pg_temp._bk('par')) = 'test_only' and (select binding_id is null from public.partner_enrollment where enrollment_id = (select eid from _en where k='ok')));
select pg_temp._run('partner pays', $$select pg_temp._apply('c4', pg_temp._bk('par'), 'private_partner', (select eid from _en where k='ok'), pg_temp._evt('txn_par1','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_c4'), null)$$);
select pg_temp._ck('C06 a confirmed LIVE partner payment from an eligible enrollment binds it, and the plan is PAID',
  pg_temp._o('c4') = 'RECORDED' and pg_temp._plan(pg_temp._bk('par')) = 'paid' and (select binding_id is not null and next_verification_at is not null from public.partner_enrollment where enrollment_id = (select eid from _en where k='ok')), pg_temp._o('c4'));
select pg_temp._ck('C07 the dashboard reader shows the partner plan: one-time, 100 allowed, 0 used, an access end exactly 6 months after the binding, NO renewal date, a next reset',
  pg_temp._sum(2) = 'paid/private_partner/one_time/100/0/100' and (select renews_at is null and access_months = 6 and next_reset_at is not null
     and access_ends_at = ((select bound_at from public.brokerage_subscription where subscription_ref = 'txn_par1') at time zone 'UTC' + interval '6 months') at time zone 'UTC' from public.billing_summary(pg_temp._u(2))), pg_temp._sum(2));
select pg_temp._run('partner dup', $$select pg_temp._apply('c5', pg_temp._bk('par'), 'private_partner', (select eid from _en where k='ok'), pg_temp._evt('txn_par1','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_c4'), null)$$);
select pg_temp._ck('C08 a re-delivered partner payment is DUPLICATE and changes nothing (one ledger row, one binding)', pg_temp._o('c5') = 'DUPLICATE'
  and (select count(*) = 1 from public.brokerage_subscription where subscription_ref = 'txn_par1') and (select count(*) = 1 from public.payment_event where idempotency_key = 'evt_c4'));
select pg_temp._run('partner second', $$select pg_temp._apply('c6', pg_temp._bk('par'), 'private_partner', (select eid from _en where k='ok'), pg_temp._evt('txn_par2','transaction_completed','completed','2026-11-17T10:00:00Z', pg_temp._par(), true,'evt_c6'), null)$$);
select pg_temp._ck('C09 the offer is ONCE per account: a second payment for another transaction is refused and the first six months are untouched', pg_temp._o('c6') = 'PARTNER_NOT_ELIGIBLE' and pg_temp._plan(pg_temp._bk('par')) = 'paid');
select pg_temp._run('partner start after', $$select pg_temp._start('after', 2, 'ok')$$);
select pg_temp._ck('C10 an account that already bought the offer cannot start another enrollment (ALREADY_USED)', (select outcome from _en where k='after') = 'ALREADY_USED');
select pg_temp._run('partner report', $$select pg_temp._iss('c7', 2, 2001)$$);
select pg_temp._ck('C11 a partner member''s report is charged to the paid allotment: ordinal 1, 99 left', pg_temp._allot('c7') = 'paid' and (select remaining = 99 from _i where label='c7'));

-- six monthly allotments, then expiry: bindings made k months (+ a minute inside the month) ago, k = 0..5, and one past six months
create function pg_temp._partner_at(p_label text, p_user int, p_ref text, p_ago interval) returns void language plpgsql as $$
declare v_en uuid; r record;
begin
  select * into r from public.partner_enrollment_start(pg_temp._u(p_user), pg_temp._tok('ok'));
  v_en := r.enrollment_id;
  perform pg_temp._bind(pg_temp._bk(p_label), p_ref, now() - p_ago);
  perform pg_temp._apply('pa_' || p_label, pg_temp._bk(p_label), 'private_partner', v_en, pg_temp._evt(p_ref,'transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_pa_' || p_label), null);
end $$;
select pg_temp._run('k0', $$select pg_temp._partner_at('k0', 16, 'txn_k0', interval '2 minutes')$$);
select pg_temp._run('k1', $$select pg_temp._partner_at('k1', 17, 'txn_k1', interval '1 month 1 day')$$);
select pg_temp._run('k2', $$select pg_temp._partner_at('k2', 18, 'txn_k2', interval '2 months 1 day')$$);
select pg_temp._run('k3', $$select pg_temp._partner_at('k3', 19, 'txn_k3', interval '3 months 1 day')$$);
select pg_temp._run('k4', $$select pg_temp._partner_at('k4', 20, 'txn_k4', interval '4 months 1 day')$$);
select pg_temp._run('k5', $$select pg_temp._partner_at('k5', 21, 'txn_k5', interval '5 months 29 days')$$);
select pg_temp._run('k6', $$select pg_temp._partner_at('k6', 22, 'txn_k6', interval '6 months 1 day')$$);
select pg_temp._run('iss k0', $$select pg_temp._iss('k0', 16, 3001)$$);
select pg_temp._run('iss k1', $$select pg_temp._iss('k1', 17, 3002)$$);
select pg_temp._run('iss k2', $$select pg_temp._iss('k2', 18, 3003)$$);
select pg_temp._run('iss k3', $$select pg_temp._iss('k3', 19, 3004)$$);
select pg_temp._run('iss k4', $$select pg_temp._iss('k4', 20, 3005)$$);
select pg_temp._run('iss k5', $$select pg_temp._iss('k5', 21, 3006)$$);
select pg_temp._run('iss k6', $$select pg_temp._iss('k6', 22, 3007)$$);
select pg_temp._ck('C12 SIX MONTHLY ALLOTMENTS: in each of months 1 to 6 of the six months the plan is paid and the first report of that month is ordinal 1 of a fresh 100',
  pg_temp._plan(pg_temp._bk('k0')) = 'paid' and pg_temp._plan(pg_temp._bk('k1')) = 'paid' and pg_temp._plan(pg_temp._bk('k2')) = 'paid' and pg_temp._plan(pg_temp._bk('k3')) = 'paid'
  and pg_temp._plan(pg_temp._bk('k4')) = 'paid' and pg_temp._plan(pg_temp._bk('k5')) = 'paid'
  and (select bool_and(allot = 'paid' and ordinal = 1 and remaining = 99) from _i where label in ('k0','k1','k2','k3','k4','k5')),
  (select string_agg(label || ':' || coalesce(allot, err) || '/' || coalesce(ordinal::text, '-'), ' ' order by label) from _i where label like 'k%'));
select pg_temp._ck('C13 the months are DISTINCT periods 0..5 (a report in month k is stamped period k)',
  (select array_agg(c.period_index order by b.subscription_ref) = array[0,1,2,3,4,5] from public.brokerage_paid_credit c join public.brokerage_subscription b using (binding_id) where b.subscription_ref in ('txn_k0','txn_k1','txn_k2','txn_k3','txn_k4','txn_k5')));
select pg_temp._ck('C14 AFTER SIX MONTHS the plan is EXPIRED automatically (derived, no job): the report is NOT charged to the paid allotment, no paid credit exists, the dashboard shows 0 left and the end date',
  pg_temp._plan(pg_temp._bk('k6')) = 'expired' and pg_temp._allot('k6') is distinct from 'paid' and pg_temp._paid_n('k6') = 0
  and (select state = 'expired' and credits_remaining = 0 and next_reset_at is null and access_ends_at < now() from public.billing_summary(pg_temp._u(22))), pg_temp._sum(22));
select pg_temp._ck('C15 the LAST month (month 6) offers no further reset date: the access end is the end of the sixth allotment', (select next_reset_at is null and access_ends_at > now() from public.billing_summary(pg_temp._u(21))), (select next_reset_at::text from public.billing_summary(pg_temp._u(21))));
-- no rollover
select pg_temp._run('roll start', $$select pg_temp._partner_at('roll', 38, 'txn_roll', interval '40 days')$$);
select pg_temp._run('roll seed', $x$do $d$ declare n int; begin
  alter table public.brokerage_paid_credit disable trigger brokerage_paid_credit_guard;
  for n in 1..3 loop
    insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id, issued_at)
    select b.binding_id, b.brokerage_id, 0, n, 10 + n, gen_random_uuid(), (select report_id from public.report_snapshot_issue(format('{"roll":%s}', n), pg_temp._h(format('{"roll":%s}', n)), 'v', '{}'::jsonb, null)), now() - interval '39 days'
      from public.brokerage_subscription b where b.subscription_ref = 'txn_roll';
  end loop;
  alter table public.brokerage_paid_credit enable trigger brokerage_paid_credit_guard;
end $d$$x$);
select pg_temp._ck('C16 NO ROLLOVER: 3 reports used in month 1 leave month 2 at exactly 100 allowed, 0 used, 100 left (never 197)', pg_temp._sum(38) = 'paid/private_partner/one_time/100/0/100', pg_temp._sum(38));
select pg_temp._run('roll cap', $x$do $d$ declare n int; begin
  alter table public.brokerage_paid_credit disable trigger brokerage_paid_credit_guard;
  for n in 1..100 loop
    insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id, issued_at)
    select b.binding_id, b.brokerage_id, 1, n, 13 + n, gen_random_uuid(), (select report_id from public.report_snapshot_issue(format('{"cap":%s}', n), pg_temp._h(format('{"cap":%s}', n)), 'v', '{}'::jsonb, null)), now()
      from public.brokerage_subscription b where b.subscription_ref = 'txn_roll';
  end loop;
  alter table public.brokerage_paid_credit enable trigger brokerage_paid_credit_guard;
end $d$$x$);
select pg_temp._run('roll 101', $$select pg_temp._iss('roll101', 38, 3101)$$);
select pg_temp._ck('C17 the 101st report in a month is refused ALLOTMENT_COMPLETE and the dashboard shows 0 left',
  (select err like 'EV010%' from _i where label = 'roll101') and pg_temp._sum(38) = 'paid/private_partner/one_time/100/100/0', (select err from _i where label = 'roll101'));

-- refund of the partner offer
select pg_temp._run('par refund', $$select pg_temp._refund('c8', pg_temp._evt('txn_par1','adjustment_refunded','refunded','2026-11-18T10:00:00Z', null, true,'evt_c8'))$$);
select pg_temp._run('par refund report', $$select pg_temp._iss('c9', 2, 2002)$$);
select pg_temp._ck('C18 a FULL refund of the partner payment revokes access at once: plan canceled, the next report is not charged to the paid allotment', pg_temp._o('c8') = 'RECORDED' and pg_temp._plan(pg_temp._bk('par')) = 'canceled' and pg_temp._allot('c9') is distinct from 'paid');
-- link seat cap, verification, link expired at payment time
select pg_temp._run('one seat a', $$select pg_temp._start('s1', 12, 'one')$$);
select pg_temp._run('one seat pay', $$select pg_temp._apply('c10', pg_temp._bk('lim1'), 'private_partner', (select eid from _en where k='s1'), pg_temp._evt('txn_s1','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_c10'), null)$$);
select pg_temp._run('one seat b', $$select pg_temp._start('s2', 13, 'one')$$);
select pg_temp._ck('C19 a link with ONE seat: once the first account has paid, a second account cannot start (LINK_INVALID)', pg_temp._plan(pg_temp._bk('lim1')) = 'paid' and (select outcome from _en where k='s2') = 'LINK_INVALID');
select pg_temp._run('vfy start', $$select pg_temp._start('v1', 14, 'ok')$$);
select pg_temp._run('vfy pay', $$select pg_temp._apply('c11', pg_temp._bk('vfy'), 'private_partner', (select eid from _en where k='v1'), pg_temp._evt('txn_v1','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_c11'), null)$$);
select pg_temp._ck('C20 periodic verification: nothing is due now; once its date passes the enrollment is listed for the operator', not exists (select 1 from public.partner_verification_due() where account_id = pg_temp._bk('vfy'))
  and exists (select 1 from public.partner_verification_due(now() + interval '31 days') where account_id = pg_temp._bk('vfy')));
select pg_temp._run('vfy ok', $$select public.partner_enrollment_verify((select eid from _en where k='v1'), 'verified')$$);
select pg_temp._ck('C21 a successful verification keeps access and schedules the next check 30 days out (the default interval)', pg_temp._plan(pg_temp._bk('vfy')) = 'paid' and (select last_verified_at is not null and next_verification_at between now() + interval '29 days' and now() + interval '31 days' from public.partner_enrollment where enrollment_id = (select eid from _en where k='v1')));
-- ---- V: re-verification: 30 days by default, configurable per partner brokerage, overdue = flagged for manual review, never an automatic suspension ----
select pg_temp._ck('V01 the partner brokerage default is 30 days', (select verification_interval_days = 30 from public.partner_brokerage where partner_id = (select id from _pt where k='pb')));
select pg_temp._run('v interval 45', $$select public.partner_brokerage_set_interval((select id from _pt where k='pb'), 45)$$);
select pg_temp._run('v verify 45', $$select public.partner_enrollment_verify((select eid from _en where k='v1'), 'verified')$$);
select pg_temp._ck('V02 the interval is the BROKERAGE''s: after setting 45 days the next check is scheduled 45 days out', (select next_verification_at between now() + interval '44 days' and now() + interval '46 days' from public.partner_enrollment where enrollment_id = (select eid from _en where k='v1')));
select pg_temp._ck('V03 an interval outside 1..365 days is refused', pg_temp._why($$select public.partner_brokerage_set_interval((select id from _pt where k='pb'), 0)$$) like '23514%' and pg_temp._why($$select public.partner_brokerage_set_interval((select id from _pt where k='pb'), 366)$$) like '23514%');
select pg_temp._run('v overdue', $$update public.partner_enrollment set next_verification_at = now() - interval '12 days' where enrollment_id = (select eid from _en where k='v1')$$);
select pg_temp._run('v overdue report', $$select pg_temp._iss('v4', 14, 2090)$$);
select pg_temp._ck('V04 an OVERDUE check is flagged for manual review (listed with its days overdue and counted by the audit) and access is NOT suspended: the plan stays paid and a paid report is still issued',
  exists (select 1 from public.partner_verification_due() where account_id = pg_temp._bk('vfy') and days_overdue = 12)
  and (select violations >= 1 from public.paddle_billing_check() where check_name = 'partner_verification_overdue_for_manual_review')
  and pg_temp._plan(pg_temp._bk('vfy')) = 'paid' and pg_temp._allot('v4') = 'paid', pg_temp._allot('v4'));
select pg_temp._run('v overdue long', $$update public.partner_enrollment set next_verification_at = now() - interval '400 days' where enrollment_id = (select eid from _en where k='v1')$$);
select pg_temp._ck('V05 even 400 days overdue never suspends by itself', pg_temp._plan(pg_temp._bk('vfy')) = 'paid');
select pg_temp._run('v back', $$select public.partner_enrollment_verify((select eid from _en where k='v1'), 'verified')$$);
select pg_temp._ck('V06 verifying removes it from the review queue', not exists (select 1 from public.partner_verification_due() where account_id = pg_temp._bk('vfy')));
select pg_temp._run('vfy fail', $$select public.partner_enrollment_verify((select eid from _en where k='v1'), 'failed')$$);
select pg_temp._run('vfy report', $$select pg_temp._iss('c12', 14, 2003)$$);
select pg_temp._ck('C22 a FAILED verification suspends the plan at once (no paid report), and a failed enrollment is never silently reversed', pg_temp._plan(pg_temp._bk('vfy')) = 'suspended' and pg_temp._allot('c12') is distinct from 'paid'
  and not public.partner_enrollment_verify((select eid from _en where k='v1'), 'verified'));
select pg_temp._run('late link', $$select pg_temp._start('l1', 11, 'ok')$$);
select pg_temp._run('late link expire', $$update public.partner_link set expires_at = now() - interval '1 minute' where link_id = (select id from _pt where k = 'l_ok')$$);
select pg_temp._run('late pay', $$select pg_temp._apply('c13', pg_temp._bk('old'), 'private_partner', (select eid from _en where k='l1'), pg_temp._evt('txn_late','transaction_completed','completed','2026-11-16T10:00:00Z', pg_temp._par(), true,'evt_c13'), null)$$);
select pg_temp._ck('C23 a link that EXPIRED between starting checkout and paying does not bind a first payment (kept for a refund)', pg_temp._o('c13') = 'PARTNER_NOT_ELIGIBLE' and pg_temp._plan(pg_temp._bk('old')) is null);

-- =====================================================================================================
-- D. SECURITY AND THE HISTORICAL RECORD
-- =====================================================================================================
select pg_temp._ck('C24 the private-offer page asks READ-ONLY: a valid link says OK and writes nothing, a bad link says LINK_INVALID',
  (select outcome = 'OK' and enrollment_id is null from public.partner_enrollment_start(pg_temp._u(40), pg_temp._tok('ok'), false) ) is not true
  and (select outcome = 'LINK_INVALID' from public.partner_enrollment_start(pg_temp._u(12), pg_temp._tok('nonesuch'), false))
  and (select count(*) = 0 from public.partner_enrollment where account_id = pg_temp._bk('lim2')), 'the first term is true only for an owner; user 40 owns nothing');
select pg_temp._ck('C25 the billing portal reads only an OWNER''s recurring Paddle subscription: the Professional owner gets sub_pro1, an agent and a partner (one-time) owner get nothing',
  (select subscription_ref = 'sub_pro1' from public.billing_portal_ref(pg_temp._u(1))) and not exists (select 1 from public.billing_portal_ref(pg_temp._u(30))) and not exists (select 1 from public.billing_portal_ref(pg_temp._u(2))));
select pg_temp._ck('D01 anon and authenticated can execute NONE of the new functions and read NONE of the new tables',
  (select bool_and(pg_temp._as(r, format('select * from public.%s limit 1', t)) like '42501%') from unnest(array['anon','authenticated']) r, unnest(array['billing_plan_price','billing_period_observation','paddle_unmatched_event','partner_brokerage','partner_link','partner_enrollment']) t)
  and pg_temp._as('anon', $$select public.billing_summary(gen_random_uuid())$$) like '42501%' and pg_temp._as('authenticated', $$select public.billing_summary(gen_random_uuid())$$) like '42501%'
  and pg_temp._as('anon', $$select public.paddle_event_apply(gen_random_uuid(), '{}'::jsonb, 'x', null, null)$$) like '42501%'
  and pg_temp._as('authenticated', $$select public.partner_enrollment_start(gen_random_uuid(), 'x')$$) like '42501%');
select pg_temp._ck('D02 service_role can run the functions but holds no privilege on the tables (everything goes through the functions)',
  pg_temp._as('service_role', $$select * from public.billing_summary(gen_random_uuid())$$) = 'ok' and pg_temp._as('service_role', $$select * from public.billing_plan_price$$) like '42501%'
  and pg_temp._as('service_role', $$insert into public.partner_link (partner_id, token_hash) values (gen_random_uuid(), 'x')$$) like '42501%');
select pg_temp._ck('D03 the unmatched list and the period record are append-only (update, delete and truncate refused)',
  pg_temp._why($$update public.paddle_unmatched_event set reason = 'NO_ACCOUNT'$$) like '55000%' and pg_temp._why($$delete from public.billing_period_observation$$) like '55000%'
  and pg_temp._why($$truncate public.paddle_unmatched_event$$) like '55000%');
select pg_temp._ck('D04 a partner link is stored as a 64-hex hash only: a plain token cannot be inserted and no column holds the token', pg_temp._why($$insert into public.partner_link (partner_id, token_hash) values ((select id from _pt where k='pb'), 'plain-token')$$) like '23514%'
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'partner_link' and column_name ~ 'token$' and column_name <> 'token_hash'));
select pg_temp._ck('D05 no new table has a column that can hold a person: no email, name, card, address, customer id, amount or free text',
  not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('billing_plan_price','billing_period_observation','paddle_unmatched_event','partner_link','partner_enrollment') and column_name ~ '^(email|first_name|last_name|full_name|name|card.*|address.*|phone.*|customer.*|amount.*|price_paid|note.*|comment.*|ip|ip_address)$'));
select pg_temp._run('lemon historical', $x$do $d$ begin
  perform public.billing_event_apply(pg_temp._bk('lem'), jsonb_build_object('processor','lemonsqueezy','idempotency_key','lem1','subscription_ref','9001','event_name','subscription_created','processor_status','active','occurred_at','2026-10-04T12:00:00Z','product_ref','1','variant_ref','2','livemode',true));
end $d$$x$);
select pg_temp._ck('D06 a historical Lemon Squeezy binding (no Paddle price row) behaves exactly as it did: active is paid; nothing it recorded is deleted or reinterpreted', pg_temp._plan(pg_temp._bk('lem')) = 'paid');
select pg_temp._ck('D07 the new audit: every invariant 0 beside non-zero controls', (select count(*) = 2 and bool_and(violations > 0) from public.paddle_billing_check() where kind = 'control') and (select count(*) = 6 and bool_and(violations = 0) from public.paddle_billing_check() where kind = 'invariant'),
  (select string_agg(check_name || '=' || violations, ';') from public.paddle_billing_check()));
select pg_temp._ck('D08 the existing brokerage audit still passes (no invariant violated by anything above)', (select bool_and(violations = 0) from public.billing_check() where kind = 'invariant'), (select string_agg(check_name || '=' || violations, ';') from public.billing_check() where violations <> 0 and kind = 'invariant'));
select pg_temp._ck('D09 no unpaid or unauthorized brokerage holds a paid credit: every paid credit belongs to a LIVE binding whose price is known and whose plan is, or was, paid',
  not exists (select 1 from public.brokerage_paid_credit c join public.brokerage_subscription b using (binding_id) where not b.livemode)
  and not exists (select 1 from public.brokerage_paid_credit c where c.brokerage_id in (pg_temp._bk('hen'), pg_temp._bk('snd'), pg_temp._bk('blk'), pg_temp._bk('nop'), pg_temp._bk('k6'), pg_temp._bk('old'), pg_temp._bk('rfd'))));

-- ---- E: the environment decides what grants (decision 4) ------------------------------------------------------------------------------
select pg_temp._ck('E01 the default mode is production: live payments grant and the helper says so', public.billing_environment_mode() = 'production' and public.billing_grants_livemode());
select pg_temp._ck('E02 no API role can read or write the environment, or call its helpers except service_role reading the mode',
  pg_temp._as('anon', $$select * from public.billing_environment$$) like '42501%' and pg_temp._as('authenticated', $$update public.billing_environment set mode = 'staging'$$) like '42501%'
  and pg_temp._as('service_role', $$update public.billing_environment set mode = 'staging'$$) like '42501%' and pg_temp._as('service_role', $$select public.billing_environment_mode()$$) = 'ok'
  and pg_temp._as('anon', $$select public.billing_grants_livemode()$$) like '42501%');
select pg_temp._ck('E03 a production database that holds a LIVE payment cannot be switched to staging (refused 55000), even by its owner', pg_temp._why($$update public.billing_environment set mode = 'staging'$$) like '55000%' and public.billing_environment_mode() = 'production');
select pg_temp._ck('E04 the environment row cannot be deleted or truncated', pg_temp._why($$delete from public.billing_environment$$) like '55000%' and pg_temp._why($$truncate public.billing_environment$$) like '55000%');
-- The sandbox end-to-end scenario, in an ISOLATED STAGING database: rolled back, so nothing it does remains here. (The refusal in E03 is switched off for this block ONLY, inside the rolled-back sub-transaction.)
create function pg_temp._staging() returns text language plpgsql as $$
declare out text; r record; bk uuid; bk2 uuid; ev uuid; tok text; st text; st2 text; alt text; ord int; mode_seen text;
begin
  begin
    alter table public.billing_environment disable trigger billing_environment_guard;
    update public.billing_environment set mode = 'staging';
    mode_seen := public.billing_environment_mode();
    select c.evaluation_id, c.brokerage_id, c.owner_token into ev, bk, tok from public.evaluation_create('Staging Realty') c;
    insert into auth.users (id, email, raw_user_meta_data) values (pg_temp._u(41), 'stg41@example.test', '{}'::jsonb) on conflict do nothing;
    perform 1 from public.evaluation_invite_redeem(tok, pg_temp._u(41));
    select c.owner_token, c.brokerage_id into tok, bk2 from public.evaluation_create('Live Realty') c;
    insert into auth.users (id, email, raw_user_meta_data) values (pg_temp._u(42), 'stg42@example.test', '{}'::jsonb) on conflict do nothing;
    perform 1 from public.evaluation_invite_redeem(tok, pg_temp._u(42));
    -- a SANDBOX payment grants here; a LIVE payment never does
    perform 1 from public.paddle_event_apply(bk, pg_temp._evt('sub_stg1','subscription_created','active','2026-11-16T10:00:00Z', pg_temp._spro(), false,'evt_stg1'), 'professional', null, null);
    perform 1 from public.paddle_event_apply(bk2, pg_temp._evt('sub_stg2','subscription_created','active','2026-11-16T10:00:00Z', pg_temp._pro(), true,'evt_stg2'), 'professional', null, null);
    st := (select state from public.billing_plan_of(bk)); st2 := (select state from public.billing_plan_of(bk2));
    select r2.allotment, r2.credit_ordinal into alt, ord from public.brokerage_report_issue(pg_temp._u(41), pg_temp._k(4101), '{"n":4101}', pg_temp._h('{"n":4101}'), 'engine-v1', '{"engine":"test"}'::jsonb, null) r2;
    out := mode_seen || '|' || coalesce(st,'-') || '|' || coalesce(st2,'-') || '|' || coalesce(alt,'-') || '|' || coalesce(ord::text,'-')
           || '|' || (select count(*) from public.brokerage_paid_credit c where c.brokerage_id = bk)::text
           || '|' || (select count(*) from public.brokerage_paid_credit c where c.brokerage_id = bk2)::text;
    raise exception using errcode = 'P0001', message = 'RESULT:' || out;
  exception when sqlstate 'P0001' then return sqlerrm;
  end;
end $$;
select pg_temp._ck('E05 in isolated STAGING a sandbox payment makes the plan PAID and its report is charged to the paid allotment, a LIVE payment is test_only and is charged nothing (sandbox end-to-end is possible without production)',
  pg_temp._staging() = 'RESULT:staging|paid|test_only|paid|1|1|0', pg_temp._staging());
select pg_temp._ck('E06 that scenario left nothing behind: the database is still production and holds no staging brokerage', public.billing_environment_mode() = 'production' and not exists (select 1 from public.brokerage_account where name in ('Staging Realty','Live Realty')));
select pg_temp._ck('E07 production never grants for a sandbox payment even for a brand-new account (the earlier B13 rule, restated against the environment)', pg_temp._plan(pg_temp._bk('snd')) = 'test_only');

-- ---- G: no free plan (decision 1) ---------------------------------------------------------------------------------------------------------
select pg_temp._run('g make', $$select pg_temp._mk('gnew', 'Gate New'); select pg_temp._mk('ggra', 'Gate Granted')$$);
select pg_temp._run('g owners', $$select pg_temp._own('gnew', 33); select pg_temp._own('ggra', 34)$$);
select pg_temp._run('g grant', $$update public.evaluation set free_reports_granted = true where evaluation_id = pg_temp._ev('ggra')$$);
select pg_temp._ck('G01 a NEW evaluation, made by any path, is created with NO free reports; only one an operator marks granted holds them (the review list shows exactly those)',
  (select not free_reports_granted from public.evaluation where evaluation_id = pg_temp._ev('gnew')) and (select free_reports_granted from public.evaluation where evaluation_id = pg_temp._ev('ggra'))
  and exists (select 1 from public.billing_free_reports_review() where brokerage_id = pg_temp._bk('ggra')) and not exists (select 1 from public.billing_free_reports_review() where brokerage_id = pg_temp._bk('gnew')));
select pg_temp._run('g new report', $$select pg_temp._iss('g1', 33, 3301)$$);
select pg_temp._ck('G02 an unpaid account that was never promised free reports is REFUSED (EV013 PAID_PLAN_REQUIRED) even before checkout launches; nothing stored, nothing charged',
  pg_temp._allot('g1') like 'EV013%' and not exists (select 1 from public.evaluation_credit where evaluation_id = pg_temp._ev('gnew')), pg_temp._allot('g1'));
select pg_temp._run('g granted report', $$select pg_temp._iss('g2', 34, 3401)$$);
select pg_temp._ck('G03 before launch, an account that WAS promised free reports can still use them (historical promise honoured until the gate is armed)', pg_temp._allot('g2') = 'trial', pg_temp._allot('g2'));
select pg_temp._run('g arm', $$select public.billing_gate_set(true, false)$$);
select pg_temp._run('g granted after', $$select pg_temp._iss('g3', 34, 3402)$$);
select pg_temp._run('g replay', $$select pg_temp._iss('g4', 34, 3401)$$);
select pg_temp._ck('G04 ARMED: an unpaid report is refused for everyone, including a granted account; a retried key of a report already made still returns that report, free of charge',
  pg_temp._allot('g3') like 'EV013%' and (select replayed from _i where label = 'g4') and pg_temp._allot('g4') = 'trial', pg_temp._allot('g3') || '/' || pg_temp._allot('g4'));
select pg_temp._ck('G05 ARMED: a PAID account still makes reports (the gate refuses only unpaid ones)', (select pg_temp._iss('g5', 12, 3501) is not null) and pg_temp._allot('g5') = 'paid', pg_temp._allot('g5'));
select pg_temp._ck('G06 ARMED: the workspace reads zero free reports for a granted account (the count already made is kept), and the invariant holds',
  (select credit_limit = credits_used and credits_remaining = 0 from public.evaluation_usage(pg_temp._u(34))) and (select violations = 0 from public.paddle_billing_check() where check_name = 'free_reports_used_after_the_gate_armed'));
select pg_temp._run('g honor', $$select public.billing_gate_set(true, true)$$);
select pg_temp._run('g honored report', $$select pg_temp._iss('g6', 34, 3403)$$);
select pg_temp._run('g unhonored report', $$select pg_temp._iss('g7', 33, 3302)$$);
select pg_temp._ck('G07 the operator can choose to honour already-promised free reports (only those): the granted account works again, the never-promised one stays refused',
  pg_temp._allot('g6') = 'trial' and pg_temp._allot('g7') like 'EV013%', pg_temp._allot('g6') || '/' || pg_temp._allot('g7'));
select pg_temp._run('g disarm', $$select public.billing_gate_set(false, false)$$);
select pg_temp._ck('G08 every change of the gate is logged (append-only) and no API role can read the gate, change it or write its log',
  (select count(*) >= 3 from public.billing_gate_log) and pg_temp._why($$update public.billing_gate_log set paid_required = false$$) like '55000%'
  and pg_temp._as('anon', $$select * from public.billing_gate$$) like '42501%' and pg_temp._as('service_role', $$select public.billing_gate_set(false, false)$$) like '42501%'
  and pg_temp._as('authenticated', $$select public.billing_gate_state()$$) like '42501%' and pg_temp._as('service_role', $$select * from public.billing_gate_state()$$) = 'ok');
select pg_temp._ck('G09 reports already made are never touched by any of this: the granted account''s first free report is still stored, and the credit ledger is unchanged', exists (select 1 from public.evaluation_credit where evaluation_id = pg_temp._ev('ggra') and ordinal = 1));
select pg_temp._ck('G10 the arming rule is a flag in the database, not a code path: arming and disarming restore the same usable answer', public.billing_free_reports_usable(pg_temp._ev('ggra')) and not public.billing_free_reports_usable(pg_temp._ev('gnew')));

-- ---- T: terms before purchase (decision 3) -----------------------------------------------------------------------------------------------------------
select pg_temp._ck('T01 the current terms version is a row in the database', public.billing_terms_current() = '2026-11-16');
select pg_temp._run('t accept', $$select public.billing_terms_accept(pg_temp._u(1), '2026-11-16', 'professional')$$);
select pg_temp._ck('T02 an OWNER accepting the current version is recorded; an old or unknown version, an agent, a stranger and an unknown plan are all refused and record nothing',
  public.billing_terms_accept(pg_temp._u(1), '2026-11-16', 'professional') = 'ACCEPTED' and public.billing_terms_accept(pg_temp._u(1), '2026-10-16', 'professional') = 'VERSION_STALE'
  and public.billing_terms_accept(pg_temp._u(1), '2026-11-16', 'brokerage_enterprise') = 'VERSION_STALE' and public.billing_terms_accept(pg_temp._u(30), '2026-11-16', 'professional') = 'NOT_OWNER'
  and public.billing_terms_accept(gen_random_uuid(), '2026-11-16', 'professional') = 'NOT_OWNER'
  and (select count(*) = 1 from public.billing_terms_acceptance where brokerage_id = pg_temp._bk('pro')) is not null and (select count(*) = 1 from public.billing_terms_acceptance where brokerage_id = pg_temp._bk('pro')));
select pg_temp._ck('T03 the acceptance record is append-only and holds no person, email or text', pg_temp._why($$update public.billing_terms_acceptance set plan_key = 'professional'$$) like '55000%' and pg_temp._why($$delete from public.billing_terms_acceptance$$) like '55000%'
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'billing_terms_acceptance' and column_name ~ '^(user|email|name|text|address|ip)'));
select pg_temp._ck('T04 no API role reads the acceptances or accepts on someone''s behalf; service_role may only call the function',
  pg_temp._as('anon', $$select * from public.billing_terms_acceptance$$) like '42501%' and pg_temp._as('authenticated', $$select public.billing_terms_accept(gen_random_uuid(), '2026-11-16', 'professional')$$) like '42501%'
  and pg_temp._as('service_role', $$select * from public.billing_terms_acceptance$$) like '42501%' and pg_temp._as('service_role', $$select public.billing_terms_accept(gen_random_uuid(), '2026-11-16', 'professional')$$) = 'ok');

select pg_temp._ck('S99 every setup step ran without raising', not exists (select 1 from _setup where result <> 'ok' and step <> 'lem bind'), (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

revoke usage on schema public from anon, authenticated, service_role;
\o
select case when pass then 'PASS ' else 'FAIL ' end || check_name || coalesce(' :: ' || detail, '') from _r order by n;
