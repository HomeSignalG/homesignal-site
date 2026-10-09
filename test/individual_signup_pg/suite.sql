-- =====================================================================================
-- INDIVIDUAL-AGENT SIGNUP — EXECUTABLE ADVERSARIAL SUITE  (docs/individual-agent-signup.sql, Order L2)
-- Runs AFTER run.sh has applied every layer unmutated (spine, private context, snapshot, evaluation entitlement, saved reports, share,
-- property watch, payment ledger, report header, billing) and seeded a LEGACY brokerage with members, credits and a report BEFORE the
-- L2 file was applied. Every expected answer is a hard-coded constant. Output: check_name|pass|detail.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null
create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ': ' || sqlerrm; end $$;
create function pg_temp._u(n int) returns uuid language sql as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql as $$ select ('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;
create temp table _setup (n serial, step text, result text);
create function pg_temp._run(p_step text, p_sql text) returns void language plpgsql as $$
begin execute p_sql; insert into _setup (step, result) values (p_step, 'ok');
exception when others then insert into _setup (step, result) values (p_step, sqlstate || ': ' || sqlerrm); end $$;
-- one report through the SAME function the report endpoint uses: 'ok:<ordinal>:<used>:<remaining>' or SQLSTATE: message
create function pg_temp._iss(p_u int, p_k int) returns text language plpgsql as $$
declare b text := '{"report":' || p_k || '}'; r record;
begin
  select * into r from public.evaluation_report_issue(pg_temp._u(p_u), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, null);
  return 'ok:' || r.credit_ordinal || ':' || r.credits_used || ':' || r.credits_remaining || ':' || r.replayed;
exception when others then return sqlstate || ': ' || sqlerrm; end $$;

-- ---- users (confirmed email unless noted) -------------------------------------------------------------
insert into auth.users (id, email, email_confirmed_at) values
  (pg_temp._u(1), 'ann@example.test', now()), (pg_temp._u(2), 'ben@example.test', now()), (pg_temp._u(3), 'cy@example.test', null),
  (pg_temp._u(4), 'dee@example.test', now()), (pg_temp._u(5), 'eli@example.test', now()), (pg_temp._u(6), 'fay@example.test', now());

-- ---- A. THE TYPE COLUMN AND THE LEGACY ACCOUNTS (seeded by run.sh BEFORE this file was applied) ----------------
select pg_temp._ck('A01 account_type exists, is NOT NULL, defaults to brokerage and is limited to the two types',
  (select is_nullable = 'NO' and column_default like '%brokerage%' from information_schema.columns where table_schema = 'public' and table_name = 'brokerage_account' and column_name = 'account_type')
  and pg_temp._why($$insert into public.brokerage_account (name, account_type) values ('x', 'team')$$) like '23514%',
  (select is_nullable || column_default from information_schema.columns where table_schema = 'public' and table_name = 'brokerage_account' and column_name = 'account_type'));
\i :fpfile
select pg_temp._ck('A02 every account that existed before the file is a brokerage and nothing about it changed (fingerprint taken by run.sh before the apply)',
  (select count(*) = 1 and bool_and(account_type = 'brokerage') from public.brokerage_account where name = 'Legacy Brokerage')
  and :'fp' = :'before_fp',
  :'fp' || ' vs ' || :'before_fp');

-- ---- B. THE SIGNUP ------------------------------------------------------------------------------------------------
select pg_temp._run('signup ann', $$create temp table _s1 as select * from public.individual_signup(pg_temp._u(1), '  Ann Agent ')$$);
select pg_temp._ck('B01 a confirmed person gets an individual account named by their own (trimmed) name, an OWNER membership and an active evaluation with 0 seats',
  (select account_type = 'individual' and name = 'Ann Agent' and status = 'active' from public.brokerage_account where id = (select brokerage_id from _s1))
  and (select role = 'owner' and status = 'active' from public.brokerage_member where user_id = pg_temp._u(1))
  and (select status = 'active' and seat_limit = 0 and expires_at is null from public.evaluation where evaluation_id = (select evaluation_id from _s1))
  and (select not replayed from _s1)
  and (select count(*) = 1 from public.evaluation_event where evaluation_id = (select evaluation_id from _s1) and kind = 'created'),
  null);
select pg_temp._ck('B02 the existing readers see it as it is: owner of an individual account, 10 free reports, none used',
  (select role = 'owner' from public.brokerage_membership_of(pg_temp._u(1)))
  and (select account_type = 'individual' from public.brokerage_account_type_of(pg_temp._u(1)))
  and (select status = 'active' and credit_limit = 10 and credits_used = 0 and credits_remaining = 10 from public.evaluation_usage(pg_temp._u(1)))
  and (select state = 'none' and role = 'owner' and credit_limit = 100 from public.billing_usage(pg_temp._u(1))),
  (select string_agg(state || '/' || role || '/' || credit_limit, ',') from public.billing_usage(pg_temp._u(1))));
select pg_temp._run('signup ann again', $$create temp table _s2 as select * from public.individual_signup(pg_temp._u(1), 'A Different Name')$$);
select pg_temp._ck('B03 signing up again is a replay: the same account, replayed = true, nothing new written, the name is not overwritten',
  (select replayed and brokerage_id = (select brokerage_id from _s1) and evaluation_id = (select evaluation_id from _s1) from _s2)
  and (select count(*) = 1 from public.brokerage_account where account_type = 'individual')
  and (select name = 'Ann Agent' from public.brokerage_account where id = (select brokerage_id from _s1)),
  null);
select pg_temp._ck('B04 an unconfirmed email, an unknown user, no user, and a blank / over-long / control-character name are each refused (EV001) and write nothing',
  pg_temp._why(format($$select * from public.individual_signup(%L, 'Cy')$$, pg_temp._u(3))) = 'EV001: SIGNUP_REFUSED'
  and pg_temp._why(format($$select * from public.individual_signup(%L, 'Ghost')$$, pg_temp._u(99))) = 'EV001: SIGNUP_REFUSED'
  and pg_temp._why($$select * from public.individual_signup(null, 'Nobody')$$) = 'EV001: SIGNUP_REFUSED'
  and pg_temp._why(format($$select * from public.individual_signup(%L, '   ')$$, pg_temp._u(2))) = 'EV001: SIGNUP_REFUSED'
  and pg_temp._why(format($$select * from public.individual_signup(%L, %L)$$, pg_temp._u(2), repeat('x', 121))) = 'EV001: SIGNUP_REFUSED'
  and pg_temp._why(format($$select * from public.individual_signup(%L, %L)$$, pg_temp._u(2), E'Bad\nName')) = 'EV001: SIGNUP_REFUSED'
  and (select count(*) = 0 from public.brokerage_member where user_id in (pg_temp._u(2), pg_temp._u(3))),
  null);
select pg_temp._ck('B05 a person who already belongs to a brokerage (agent or owner) is refused with ALREADY_A_MEMBER and nothing is written',
  (select pg_temp._why(format($$select * from public.individual_signup(%L, 'Legacy Owner')$$, user_id)) = 'EV004: ALREADY_A_MEMBER' from public.brokerage_member where role = 'owner' and brokerage_id = (select id from public.brokerage_account where name = 'Legacy Brokerage'))
  and pg_temp._why($$select * from public.individual_signup('b0000000-0000-4000-8000-000000000002', 'Legacy Agent')$$) = 'EV004: ALREADY_A_MEMBER'
  and (select count(*) = 1 from public.brokerage_account where account_type = 'individual'),
  null);
select pg_temp._run('deactivate legacy agent', $$update public.brokerage_member set status = 'deactivated' where user_id = 'b0000000-0000-4000-8000-000000000002'$$);
select pg_temp._run('former agent signs up', $$create temp table _s3 as select * from public.individual_signup('b0000000-0000-4000-8000-000000000002', 'Former Agent')$$);
select pg_temp._ck('B06 a person whose membership was DEACTIVATED may sign up (a deactivated row blocks nothing) and gets their own account',
  (select not replayed from _s3)
  and (select count(*) = 2 from public.brokerage_account where account_type = 'individual'),
  null);

-- ---- C. AN INDIVIDUAL ACCOUNT CANNOT BECOME A TEAM -----------------------------------------------------------------
select pg_temp._ck('C01 a second member (agent OR owner) cannot be added to an individual account, by any writer, even a direct insert',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'agent')$$, (select brokerage_id from _s1), pg_temp._u(2))) like '55000%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'owner')$$, (select brokerage_id from _s1), pg_temp._u(2))) like '55000%'
  and (select count(*) = 1 from public.brokerage_member where brokerage_id = (select brokerage_id from _s1)),
  null);
select pg_temp._run('empty individual account', $$insert into public.brokerage_account (id, name, account_type) values ('f0000000-0000-4000-8000-000000000001', 'Empty Individual', 'individual')$$);
select pg_temp._ck('C01b a non-owner is refused by the role rule ALONE: even into an individual account that has nobody in it',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values ('f0000000-0000-4000-8000-000000000001', %L, 'agent')$$, pg_temp._u(6))) like '55000%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values ('f0000000-0000-4000-8000-000000000001', %L, 'owner')$$, pg_temp._u(6))) = 'ok',
  null);
select pg_temp._run('remove empty individual', $$delete from public.brokerage_member where brokerage_id = 'f0000000-0000-4000-8000-000000000001'; delete from public.brokerage_account where id = 'f0000000-0000-4000-8000-000000000001'$$);
select pg_temp._ck('C02 no invite can exist for an individual account: the admin mint (either role) and a direct insert are all refused as NOT_ENTITLED',
  pg_temp._why(format($$select * from public.evaluation_invite_mint(%L, 'agent')$$, (select evaluation_id from _s1))) = 'EV003: NOT_ENTITLED'
  and pg_temp._why(format($$select * from public.evaluation_invite_mint(%L, 'owner')$$, (select evaluation_id from _s1))) = 'EV003: NOT_ENTITLED'
  and pg_temp._why(format($$select * from public.evaluation_invite_mint(%L, 'agent', %L)$$, (select evaluation_id from _s1), pg_temp._u(1))) = 'EV003: NOT_ENTITLED'
  and pg_temp._why(format($$insert into public.evaluation_invite (evaluation_id, role, token_hash, expires_at) values (%L, 'agent', repeat('a', 64), now() + interval '1 day')$$, (select evaluation_id from _s1))) = 'EV003: NOT_ENTITLED'
  and (select count(*) = 0 from public.evaluation_invite where evaluation_id = (select evaluation_id from _s1)),
  null);
select pg_temp._ck('C03 the account type cannot be changed either way, so a team cannot be moved into a $79 account and a $79 account cannot be re-labelled',
  pg_temp._why(format($$update public.brokerage_account set account_type = 'brokerage' where id = %L$$, (select brokerage_id from _s1))) like '55000%'
  and pg_temp._why($$update public.brokerage_account set account_type = 'individual' where name = 'Legacy Brokerage'$$) like '55000%'
  and pg_temp._why(format($$update public.brokerage_account set name = 'Renamed' where id = %L$$, (select brokerage_id from _s1))) = 'ok',
  null);
select pg_temp._ck('C04 the spine rule still holds: the lone owner of an active individual account cannot be deactivated',
  pg_temp._why(format($$update public.brokerage_member set status = 'deactivated' where user_id = %L$$, pg_temp._u(1))) like '55000%',
  null);
select pg_temp._run('mint agent for legacy', $$create temp table _lt as select m.token from public.evaluation_invite_mint((select evaluation_id from public.evaluation e join public.brokerage_account a on a.id = e.brokerage_id where a.name = 'Legacy Brokerage'), 'agent', (select user_id from public.brokerage_member where role = 'owner' and brokerage_id = (select id from public.brokerage_account where name = 'Legacy Brokerage'))) m$$);
select pg_temp._run('redeem agent for legacy', $$select * from public.evaluation_invite_redeem((select token from _lt), pg_temp._u(5))$$);
select pg_temp._ck('C06 a legacy brokerage still mints an agent invite and that agent joins as an agent',
  (select role = 'agent' and status = 'active' from public.brokerage_member where user_id = pg_temp._u(5)),
  null);

-- ---- D. SIGNUP -> REPORTS -> LIMIT -> PAID PLAN -----------------------------------------------------------------------
select pg_temp._run('ben signs up', $$select * from public.individual_signup(pg_temp._u(2), 'Ben Broker-Free')$$);
select pg_temp._run('ben issues 10', $x$do $d$ begin for n in 1..10 loop
    if pg_temp._iss(2, 1000 + n) not like 'ok:' || n || ':' || n || ':' || (10 - n) || ':false' then raise exception 'report % went wrong: %', n, pg_temp._iss(2, 1000 + n); end if;
  end loop; end $d$$x$);
select pg_temp._ck('D01 a person who just signed up makes their 10 free reports through the existing report writer, each stored once, numbered 1..10',
  (select count(*) = 10 and min(ordinal) = 1 and max(ordinal) = 10 from public.evaluation_credit where evaluation_id = (select evaluation_id from public.evaluation e join public.brokerage_member m on m.brokerage_id = e.brokerage_id where m.user_id = pg_temp._u(2)))
  and (select count(distinct report_id) = 10 from public.evaluation_credit where evaluation_id = (select evaluation_id from public.evaluation e join public.brokerage_member m on m.brokerage_id = e.brokerage_id where m.user_id = pg_temp._u(2)))
  and (select status = 'complete' and credits_used = 10 and credits_remaining = 0 from public.evaluation_usage(pg_temp._u(2))),
  (select string_agg(status || credits_used, ',') from public.evaluation_usage(pg_temp._u(2))));
select pg_temp._ck('D02 the 11th FREE report is refused (EVALUATION_COMPLETE) and a retried key returns its stored report without charging',
  pg_temp._iss(2, 1011) = 'EV002: EVALUATION_COMPLETE'
  and pg_temp._iss(2, 1003) = 'ok:3:10:0:true'
  and (select count(*) = 10 from public.evaluation_credit where evaluation_id = (select evaluation_id from public.evaluation e join public.brokerage_member m on m.brokerage_id = e.brokerage_id where m.user_id = pg_temp._u(2))),
  null);
select pg_temp._ck('D03 repeating the signup after the free reports are used changes nothing: still one account, still 10 used, never a second free pool',
  (select replayed from public.individual_signup(pg_temp._u(2), 'Ben Again'))
  and (select count(*) = 1 from public.brokerage_member where user_id = pg_temp._u(2))
  and (select credits_used = 10 from public.evaluation_usage(pg_temp._u(2))),
  null);
select pg_temp._ck('D04 billing is the existing path: the individual is the OWNER the checkout is offered to, the plan is 100 reports, price and limit untouched',
  (select role = 'owner' and state = 'none' and credit_limit = 100 and credits_remaining = 0 from public.billing_usage(pg_temp._u(2)))
  and public.billing_report_limit() = 100 and public.evaluation_report_limit() = 10,
  null);

-- ---- E. ACCESS, AUDIT, AND THE REST OF THE DATABASE ---------------------------------------------------------------------
select pg_temp._ck('E01 anon and authenticated can run NONE of this file''s functions; service_role can run the three callable ones; no one can run the trigger functions',
  not exists (select 1 from pg_roles r, pg_proc p where r.rolname in ('anon', 'authenticated') and p.pronamespace = 'public'::regnamespace
              and (p.proname like 'individual\_%' or p.proname like 'brokerage\_account\_type%' or p.proname in ('brokerage_member_individual_guard', 'evaluation_invite_individual_guard'))
              and has_function_privilege(r.rolname, p.oid, 'EXECUTE'))
  and has_function_privilege('service_role', 'public.individual_signup(uuid, text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.brokerage_account_type_of(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.individual_account_check()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.brokerage_member_individual_guard()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.evaluation_invite_individual_guard()', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.brokerage_account_type_guard()', 'EXECUTE'),
  null);
select pg_temp._ck('E02 the audit reads zero violations beside non-zero controls',
  (select violations >= 4 from public.individual_account_check() where check_name = 'accounts_total')
  and (select violations = 3 from public.individual_account_check() where check_name = 'individual_accounts')
  and not exists (select 1 from public.individual_account_check() where kind = 'invariant' and violations <> 0),
  (select string_agg(check_name || '=' || violations, ',') from public.individual_account_check()));
select pg_temp._run('disable guard', $$alter table public.brokerage_member disable trigger brokerage_member_individual_guard_trg$$);
select pg_temp._run('smuggle an agent', format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'agent')$$, (select brokerage_id from _s1), pg_temp._u(6)));
select pg_temp._ck('E03 the audit CAN fail: a team smuggled in by a writer that bypasses the triggers is counted',
  (select violations = 1 from public.individual_account_check() where check_name = 'individual_with_a_non_owner_member')
  and (select violations = 1 from public.individual_account_check() where check_name = 'individual_with_more_than_one_active_member'),
  (select string_agg(check_name || '=' || violations, ',') from public.individual_account_check() where kind = 'invariant'));
select pg_temp._run('re-enable', $$alter table public.brokerage_member enable trigger brokerage_member_individual_guard_trg$$);
select pg_temp._run('clean smuggled row', $$delete from public.brokerage_member where user_id = pg_temp._u(6) and role = 'agent'$$);

select pg_temp._ck('S01 every setup step ran without raising',
  not exists (select 1 from _setup where result <> 'ok') and (select count(*) >= 5 from _setup),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));
\o
select check_name, pass, detail from _r order by n;
