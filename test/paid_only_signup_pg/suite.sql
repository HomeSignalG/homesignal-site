-- =====================================================================================
-- PAID-ONLY INDIVIDUAL SIGNUP: EXECUTABLE SUITE  (docs/paid-only-individual-signup.sql)
-- run.sh seeds LEGACY accounts under the unmodified layers, applies the file, then runs this. Every expected answer is a hard-coded constant.
-- Output: one row per check (name|pass|detail).
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as $$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;
create function pg_temp._acct(p_user int) returns uuid language sql as $$ select brokerage_id from public.brokerage_member where user_id = pg_temp._u(p_user) $$;
create function pg_temp._pay(p_user int, p_ref text, p_name text, p_status text, p_at text, p_live boolean, p_key text default null) returns text language plpgsql as $$
declare r record;
begin
  select * into r from public.billing_event_apply(pg_temp._acct(p_user), jsonb_build_object(
    'processor','paddle','idempotency_key', coalesce(p_key, 'evt_' || p_ref || '_' || p_name || '_' || p_at),
    'subscription_ref', p_ref, 'event_name', p_name, 'processor_status', p_status, 'occurred_at', p_at,
    'product_ref','pro_test','variant_ref','pri_test','livemode', p_live), null);
  return r.outcome || '/' || r.state;
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp._issue(p_user int, p_k int) returns text language plpgsql as $$
declare r record; b text := format('{"n":%s}', p_k);
begin
  select * into r from public.brokerage_report_issue(pg_temp._u(p_user), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, null);
  return r.allotment || '/' || r.credit_ordinal::text || '/' || r.credits_remaining::text;
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp._direct(p_user int, p_k int) returns text language plpgsql as $$
declare r record; b text := format('{"d":%s}', p_k);
begin
  select * into r from public.evaluation_report_issue(pg_temp._u(p_user), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, null);
  return 'issued/' || r.credit_ordinal::text;
exception when others then return sqlstate || ': ' || sqlerrm;
end $$;

-- seeded by run.sh BEFORE the file was applied: users 1,2 = legacy individuals (user 1 made 2 free reports), 5 = a team owner (legacy brokerage)
-- NEW after the file: users 3,4,6 sign up now.
insert into auth.users (id, email, email_confirmed_at) select pg_temp._u(n), 'n' || n || '@t.test', now() from generate_series(3, 4) n;
insert into auth.users (id, email, email_confirmed_at) values (pg_temp._u(6), 'n6@t.test', now());
select public.individual_signup(pg_temp._u(3), 'New Agent 3');
select public.individual_signup(pg_temp._u(4), 'New Agent 4');
select public.individual_signup(pg_temp._u(6), 'New Agent 6');

-- ---- existing accounts keep everything ---------------------------------------------------------------------------------------------
select pg_temp._ck('S01 every account that existed before keeps its free reports (free_reports = true)',
  (select count(*) from public.evaluation e where e.brokerage_id in (pg_temp._acct(1), pg_temp._acct(2), pg_temp._acct(5)) and e.free_reports) = 3);
select pg_temp._ck('S02 a legacy individual''s usage is unchanged: 2 used, the rest remaining, the limit is the free limit',
  (select u.credits_used = 2 and u.credit_limit = public.evaluation_report_limit() and u.credits_remaining = public.evaluation_report_limit() - 2 from public.evaluation_usage(pg_temp._u(1)) u));
select pg_temp._ck('S03 a legacy individual still makes a free report (trial allotment, ordinal 3)', pg_temp._issue(1, 31) like 'trial/3/%');
select pg_temp._ck('S04 a legacy team (brokerage) still makes a free report', pg_temp._issue(5, 33) like 'trial/1/%');

-- ---- the new individual: no free reports --------------------------------------------------------------------------------------------
select pg_temp._ck('S05 a NEW individual''s evaluation is created with free_reports = false',
  (select not e.free_reports from public.evaluation e where e.brokerage_id = pg_temp._acct(3)));
select pg_temp._ck('S06 and reads 0 free reports: limit 0, used 0, remaining 0',
  (select u.credit_limit = 0 and u.credits_used = 0 and u.credits_remaining = 0 from public.evaluation_usage(pg_temp._u(3)) u));
create temp table _snap0 as select (select count(*) from public.report_snapshot) s, (select count(*) from public.evaluation_credit) c;
select pg_temp._ck('S07 the entry function refuses a new individual with no paid plan (EV002 EVALUATION_COMPLETE)', pg_temp._issue(3, 41) = 'EV002: EVALUATION_COMPLETE', pg_temp._issue(3, 41));
select pg_temp._ck('S08 calling the free-evaluation function directly is refused the same way', pg_temp._direct(3, 42) = 'EV002: EVALUATION_COMPLETE', pg_temp._direct(3, 42));
select pg_temp._ck('S09 nothing was stored or charged by those refusals',
  (select count(*) from public.report_snapshot) = (select s from _snap0) and (select count(*) from public.evaluation_credit) = (select c from _snap0));

-- ---- paying opens the paid month, exactly 100 --------------------------------------------------------------------------------------
select pg_temp._ck('S10 a LIVE active recurring subscription binds and reads paid', pg_temp._pay(3, 'sub_new3', 'subscription.created', 'active', '2026-11-14T10:00:00Z', true) = 'RECORDED/paid');
select pg_temp._ck('S11 the first report is charged to the paid month, ordinal 1, 99 left', pg_temp._issue(3, 43) = 'paid/1/99', pg_temp._issue(3, 43));
select pg_temp._ck('S12 a retried key replays the stored report and charges nothing (still ordinal 1)', pg_temp._issue(3, 43) = 'paid/1/99');
do $$ declare i int; begin for i in 44..142 loop perform pg_temp._issue(3, i); end loop; end $$;
select pg_temp._ck('S13 the month holds exactly 100: 100 made, the 101st is refused ALLOTMENT_COMPLETE',
  (select count(*) from public.brokerage_paid_credit where brokerage_id = pg_temp._acct(3)) = 100 and pg_temp._issue(3, 143) = 'EV010: ALLOTMENT_COMPLETE', pg_temp._issue(3, 143));
select pg_temp._ck('S14 the paid month never touched the free ledger: the new individual has 0 free credits',
  (select count(*) from public.evaluation_credit c join public.evaluation e using (evaluation_id) where e.brokerage_id = pg_temp._acct(3)) = 0);
select pg_temp._ck('S15 cancelling ends access: the next report is refused, it does NOT fall back to a free report',
  pg_temp._pay(3, 'sub_new3', 'subscription.canceled', 'canceled', '2026-11-14T12:00:00Z', true) = 'RECORDED/canceled' and pg_temp._issue(3, 144) = 'EV002: EVALUATION_COMPLETE', pg_temp._issue(3, 144));

-- ---- a sandbox (test-mode) payment never opens a production account ----------------------------------------------------------------
select pg_temp._ck('S16 a Paddle SANDBOX (test-mode) subscription is recorded but grants nothing (test_only)',
  pg_temp._pay(4, 'sub_sandbox4', 'subscription.created', 'active', '2026-11-14T10:00:00Z', false) = 'RECORDED/test_only', pg_temp._pay(4, 'sub_sandbox4b', 'subscription.created', 'active', '2026-11-14T10:01:00Z', false));
select pg_temp._ck('S17 so that account still cannot make a report', pg_temp._issue(4, 51) = 'EV002: EVALUATION_COMPLETE', pg_temp._issue(4, 51));

-- ---- the rest of the world is untouched ---------------------------------------------------------------------------------------------
select pg_temp._ck('S18 the legacy individual''s report count and remaining free reports were not moved by anyone else''s payment',
  (select u.credits_used = 3 and u.credits_remaining = public.evaluation_report_limit() - 3 from public.evaluation_usage(pg_temp._u(1)) u));
select pg_temp._ck('S19 the audit invariants are all zero', not exists (select 1 from public.evaluation_check() k where k.kind = 'invariant' and k.violations <> 0)
  and not exists (select 1 from public.individual_account_check() k where k.kind = 'invariant' and k.violations <> 0));
select pg_temp._ck('S20 a second signup call for the same new person replays the same account and stays paid-only',
  (select replayed from public.individual_signup(pg_temp._u(6), 'New Agent 6')) and (select not e.free_reports from public.evaluation e where e.brokerage_id = pg_temp._acct(6)));

\o
select check_name || '|' || case when pass then 't' else 'f' end || '|' || coalesce(detail, '') from _r order by n;
