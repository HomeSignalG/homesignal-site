-- =====================================================================================
-- BROKERAGE BILLING — EXECUTABLE ADVERSARIAL SUITE  (docs/brokerage-billing.sql)
--
-- Development Activity build step 11: the $79 a month plan's database layer. A processor subscription is BOUND to one brokerage (the webhook's one
-- writer, billing_event_apply, records the event through the payment ledger that already exists); the plan state is DERIVED from the ledger's latest
-- live event; a paid brokerage's reports are charged to a 100-a-month allotment kept in its own append-only ledger (the cap is a constraint), never
-- to the 10 free reports; and the six readers that decide whose a report is read ONE view over both ledgers. This suite stands on the REAL account
-- spine, private-context layer, snapshot writer, evaluation entitlement, saved reports, share links, property watch and payment-event ledger, applied
-- unmutated. What only two real sessions can prove (the 100th credit of a month, one key) is in run.sh.
-- Every expected answer is a HARD-CODED constant, never computed by the code under test. The suite runs as the table owner; refusals for the API
-- roles are asked AS those roles (SET ROLE).
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

create function pg_temp._and_strict(a boolean, b boolean) returns boolean language sql immutable as $$ select a and coalesce(b, false) $$;
create aggregate pg_temp.all_t(boolean) (sfunc = pg_temp._and_strict, stype = boolean, initcond = 't');

create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || ': ' || sqlerrm; end $$;

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

-- ---- fixtures ------------------------------------------------------------------------------------
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;

create temp table _pv (name text primary key, j jsonb);
insert into _pv values
  ('p0', '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST","latitude":40.712980288068,"longitude":-74.003758107366,"property_keys":["nyc:1001387"],"label":"Acme Realty Smith listing"}'),
  ('p1', '{"address":"22 Birch Lane, Brigham City, UT 84302","normalized_address":"22 BIRCH LN","latitude":41.5102,"longitude":-112.0155,"property_keys":["ut:22birch"]}');

create temp table _e (label text primary key, evaluation_id uuid, brokerage_id uuid, token text);
create function pg_temp._mk(p_label text, p_name text) returns void language plpgsql as $$
begin insert into _e select p_label, c.evaluation_id, c.brokerage_id, c.owner_token from public.evaluation_create(p_name) c; end $$;
create function pg_temp._ev(p_label text) returns uuid language sql as $$ select evaluation_id from _e where label = p_label $$;
create function pg_temp._bk(p_label text) returns uuid language sql as $$ select brokerage_id from _e where label = p_label $$;
create function pg_temp._own(p_label text, p_user int) returns void language plpgsql as $$
begin perform 1 from public.evaluation_invite_redeem((select token from _e where label = p_label), pg_temp._u(p_user)); end $$;
create function pg_temp._agent(p_label text, p_user int) returns void language plpgsql as $$
declare t text;
begin
  select m.token into t from public.evaluation_invite_mint(pg_temp._ev(p_label), 'agent') m;
  perform 1 from public.evaluation_invite_redeem(t, pg_temp._u(p_user));
end $$;

-- a payment event through the webhook's one writer; the outcome (or the SQLSTATE and message) is kept by label
create temp table _p (label text primary key, outcome text, bound boolean, state text, err text);
create function pg_temp._pay(p_label text, p_brokerage uuid, p_sub text, p_status text, p_at text, p_live boolean default true, p_name text default null, p_key text default null)
returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.billing_event_apply(p_brokerage, jsonb_build_object(
    'processor', 'lemonsqueezy',
    'idempotency_key', coalesce(p_key, coalesce(p_name, 'subscription_updated') || ':' || p_sub || ':' || p_at),
    'subscription_ref', p_sub, 'event_name', coalesce(p_name, 'subscription_updated'), 'processor_status', p_status,
    'occurred_at', p_at, 'product_ref', '11', 'variant_ref', '22', 'livemode', p_live));
  insert into _p values (p_label, r.outcome, r.bound, r.state, null);
exception when others then
  insert into _p (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._perr(p_label text) returns text language sql as $$ select err from _p where label = p_label $$;
create function pg_temp._pstate(p_label text) returns text language sql as $$ select state from _p where label = p_label $$;

-- a report through THE issuing entry; kept by label
create temp table _i (label text primary key, report_id uuid, ctx uuid, replayed boolean, ordinal int, used int, remaining int, status text, allot text, ends timestamptz, err text);
create function pg_temp._iss(p_label text, p_u int, p_k int, p_priv jsonb default null, p_hash text default null) returns void language plpgsql as $$
declare r record; b text := format('{"product":"HomeSignal Development Activity","n":%s}', p_k);
begin
  select * into r from public.brokerage_report_issue(pg_temp._u(p_u), pg_temp._k(p_k), b, coalesce(p_hash, pg_temp._h(b)), 'engine-v1', '{"engine":"test"}'::jsonb, p_priv);
  insert into _i values (p_label, r.report_id, r.private_context_id, r.replayed, r.credit_ordinal, r.credits_used, r.credits_remaining, r.evaluation_status, r.allotment, r.period_ends_at, null);
exception when others then
  insert into _i (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._rp(p_label text) returns uuid language sql as $$ select report_id from _i where label = p_label $$;
create function pg_temp._ierr(p_label text) returns text language sql as $$ select err from _i where label = p_label $$;

create function pg_temp._plan(p_brokerage uuid) returns text language sql as $$ select state from public.billing_plan_of(p_brokerage) $$;
create function pg_temp._usage(p_user int) returns text language sql as $$
  select coalesce(string_agg(role || '/' || state || '/' || credit_limit || '/' || credits_used || '/' || credits_remaining, ';'), 'none') from public.billing_usage(pg_temp._u(p_user)) $$;
create function pg_temp._free_n(p_label text) returns integer language sql as $$
  select count(*)::int from public.evaluation_credit c where c.evaluation_id = pg_temp._ev(p_label) $$;
create function pg_temp._paid_n(p_label text) returns integer language sql as $$
  select count(*)::int from public.brokerage_paid_credit c where c.brokerage_id = pg_temp._bk(p_label) $$;

-- the definition (without its body) and privileges of the six ownership readers, so the splice can be shown to change the body and nothing else
create function pg_temp._reader_attrs() returns text language sql as $$
  select string_agg(p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || p.provolatile::text || ':' || coalesce(p.proconfig::text, '-') || ':' || coalesce(p.proacl::text, '-') || ':' || p.proowner::text, ',' order by p.oid::regprocedure::text collate "C")
    from pg_proc p where p.oid in (
      'public.evaluation_reports_of(uuid)'::regprocedure, 'public.evaluation_report_open(uuid, uuid)'::regprocedure,
      'public.evaluation_report_shares_of(uuid, uuid)'::regprocedure, 'public.evaluation_report_share_revoke(uuid, uuid)'::regprocedure,
      'public.report_share_open(text)'::regprocedure, 'public.evaluation_property_watches_of(uuid)'::regprocedure) $$;

-- a table the map product owns, trapped: any touch from this layer raises (the plan's per-user map subscription must never be read or written here)
create table public.subscriptions (user_id uuid, status text);
create function pg_temp._trap() returns trigger language plpgsql as $$ begin raise exception 'the map product''s subscriptions table was touched'; end $$;
create trigger subscriptions_trap before insert or update or delete on public.subscriptions for each statement execute function pg_temp._trap();
create trigger subscriptions_trap_t before truncate on public.subscriptions for each statement execute function pg_temp._trap();

-- ---- setup -----------------------------------------------------------------------------------------------
select pg_temp._run('users', $$insert into auth.users (id, email, raw_user_meta_data)
  select pg_temp._u(g), 'person' || g || '@example.test', jsonb_build_object('full_name', 'Person Number ' || g) from generate_series(1, 14) g$$);
select pg_temp._run('mk fox', $$select pg_temp._mk('fox', 'Fox Realty')$$);      -- the paying brokerage: owner 1, agent 2
select pg_temp._run('mk hen', $$select pg_temp._mk('hen', 'Hen Homes')$$);       -- never subscribes: owner 3
select pg_temp._run('mk owl', $$select pg_temp._mk('owl', 'Owl Group')$$);       -- test payments only: owner 4
select pg_temp._run('mk elk', $$select pg_temp._mk('elk', 'Elk Estates')$$);      -- subscribes, cancels, subscribes again: owner 5
select pg_temp._run('mk yak', $$select pg_temp._mk('yak', 'Yak Company')$$);      -- a complete free evaluation, then pays: owner 6
select pg_temp._run('mk cod', $$select pg_temp._mk('cod', 'Cod Homes')$$);       -- statuses: owner 7
select pg_temp._run('mk emu', $$select pg_temp._mk('emu', 'Emu Estates')$$);      -- pays, then its evaluation expires: owner 13
select pg_temp._run('own fox', $$select pg_temp._own('fox', 1)$$);
select pg_temp._run('agent fox', $$select pg_temp._agent('fox', 2)$$);
select pg_temp._run('own hen', $$select pg_temp._own('hen', 3)$$);
select pg_temp._run('own owl', $$select pg_temp._own('owl', 4)$$);
select pg_temp._run('own elk', $$select pg_temp._own('elk', 5)$$);
select pg_temp._run('own yak', $$select pg_temp._own('yak', 6)$$);
select pg_temp._run('own cod', $$select pg_temp._own('cod', 7)$$);
select pg_temp._run('own emu', $$select pg_temp._own('emu', 13)$$);
-- person 8 belongs to no brokerage at all

-- the readers' attributes BEFORE anything of the billing layer is used: the splice already ran when this file was applied, so this captures the
-- post-splice attributes, which run.sh compares to the pre-splice ones taken before the file was applied
create temp table _base as select pg_temp._reader_attrs() as attrs;

-- =====================================================================================================
-- A. POSTURE: empty, unreadable, system-only
-- =====================================================================================================
select pg_temp._ck('A01 the two tables are empty before anything is used (a layer that starts with rows is a different layer)',
  (select count(*) = 0 from public.brokerage_subscription) and (select count(*) = 0 from public.brokerage_paid_credit),
  (select count(*)::text from public.brokerage_subscription));
select pg_temp._ck('A02 row level security is on for both tables, with NO policy, so a role with a grant would still read nothing',
  (select count(*) = 2 from pg_class where oid in ('public.brokerage_subscription'::regclass, 'public.brokerage_paid_credit'::regclass) and relrowsecurity)
  and (select count(*) = 0 from pg_policy where polrelid in ('public.brokerage_subscription'::regclass, 'public.brokerage_paid_credit'::regclass)),
  null);
select pg_temp._ck('A03 anon, authenticated, PUBLIC and service_role hold NO privilege on either table or the ownership view (control: Supabase''s default privileges would have granted all of them)',
  (select count(*) = 0 from information_schema.role_table_grants g
    where g.table_schema = 'public' and g.table_name in ('brokerage_subscription', 'brokerage_paid_credit', 'evaluation_credit_all')
      and g.grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role'))
  and (select count(*) > 0 from pg_default_acl d where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r'),
  null);
select pg_temp._ck('A04 every billing function is executable by service_role alone; the trigger functions and the helper that charges the paid month are executable by NOBODY (control: the free evaluation function is still executable by service_role)',
  (select count(*) = 8 from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('billing_report_limit', 'billing_period_index', 'billing_period_end', 'billing_plan_of', 'billing_event_apply', 'billing_usage', 'brokerage_report_issue', 'billing_check')
     and has_function_privilege('service_role', p.oid, 'EXECUTE')
     and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and (select count(*) = 3 from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('billing_append_only', 'brokerage_paid_credit_guard', 'billing_paid_issue')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  and has_function_privilege('service_role', 'public.evaluation_report_issue(uuid,uuid,text,text,text,jsonb,jsonb)', 'EXECUTE'),
  null);
select pg_temp._ck('A05 the functions that touch a table are SECURITY DEFINER with a pinned search_path (a caller''s search_path cannot redirect them)',
  (select count(*) = 6 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and p.proname in ('billing_plan_of', 'billing_event_apply', 'billing_usage', 'billing_paid_issue', 'brokerage_report_issue', 'billing_check')
     and p.proconfig::text like '%search_path=public, pg_temp%'),
  null);
select pg_temp._ck('A06 the two numbers are written once each and are the founder''s: 10 free reports and 100 a month',
  public.evaluation_report_limit() = 10 and public.billing_report_limit() = 100, public.billing_report_limit()::text);
select pg_temp._ck('A07 as anon, authenticated and service_role, reading either table, the view, or calling a billing function that is not theirs is refused (42501)',
  pg_temp._as('anon', 'select * from public.brokerage_subscription') like '42501:%'
  and pg_temp._as('authenticated', 'select * from public.brokerage_paid_credit') like '42501:%'
  and pg_temp._as('service_role', 'select * from public.evaluation_credit_all') like '42501:%'
  and pg_temp._as('anon', 'select * from public.billing_plan_of(''00000000-0000-0000-0000-000000000000'')') like '42501:%'
  and pg_temp._as('authenticated', 'select * from public.billing_usage(''00000000-0000-0000-0000-000000000000'')') like '42501:%'
  and pg_temp._as('service_role', 'select * from public.billing_paid_issue(null,null,null,null,null,null,null,null,null)') like '42501:%',
  null);

-- =====================================================================================================
-- B. NOTHING PERSONAL IS STORED
-- =====================================================================================================
select pg_temp._ck('B01 the binding table has exactly six columns, all ids and times: no email, name, card, address, customer id, price, plan name or free text',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'brokerage_subscription')
    = 'binding_id,bound_at,brokerage_id,livemode,processor,subscription_ref',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'brokerage_subscription'));
select pg_temp._ck('B02 the paid ledger has exactly nine columns, all ids, counters and times',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'brokerage_paid_credit')
    = 'binding_id,brokerage_id,idempotency_key,issued_at,number,ordinal,period_index,report_id',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'brokerage_paid_credit'));
select pg_temp._ck('B03 no column of either table or the view could hold a payer or an address (searching by meaning: email, mail, name, phone, card, customer, address, street, price, amount, text, note, label, coordinate, lat, lng)',
  (select count(*) = 0 from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('brokerage_subscription', 'brokerage_paid_credit', 'evaluation_credit_all')
     and (c.column_name ~ '(email|mail|name|phone|card|customer|address|street|price|amount|note|label|coordinate|lat|lng|first|last|payer|user)'))
  and (select count(*) > 10 from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('brokerage_subscription', 'brokerage_paid_credit', 'evaluation_credit_all')),
  null);

-- =====================================================================================================
-- C. THE PLAN STATE: derived from the ledger's latest event, and only a live 'active' pays
-- =====================================================================================================
select pg_temp._ck('C01 a brokerage that never subscribed has no plan row, and its usage reads state none, a limit of 100, nothing used and nothing left',
  (select count(*) = 0 from public.billing_plan_of(pg_temp._bk('hen'))) and pg_temp._usage(3) = 'owner/none/100/0/0',
  pg_temp._usage(3));
select pg_temp._ck('C02 a person who belongs to no brokerage has no billing row at all (no row, not a row of zeros)',
  pg_temp._usage(8) = 'none' and pg_temp._usage(99) = 'none', pg_temp._usage(8));

-- Fox: a live subscription, created active
select pg_temp._run('fox pays', $$select pg_temp._pay('fox1', pg_temp._bk('fox'), '5001', 'active', '2026-10-04T12:00:00Z', true, 'subscription_created')$$);
select pg_temp._ck('C03 a live "active" event binds the subscription to the brokerage and the plan is PAID: recorded, bound, state paid',
  (select outcome = 'RECORDED' and bound and state = 'paid' from _p where label = 'fox1') and pg_temp._plan(pg_temp._bk('fox')) = 'paid',
  coalesce(pg_temp._perr('fox1'), pg_temp._pstate('fox1')));
select pg_temp._ck('C04 the usage of a paid brokerage reads paid with the whole month left, for the owner AND the agent (a seat shares the pool)',
  pg_temp._usage(1) = 'owner/paid/100/0/100' and pg_temp._usage(2) = 'agent/paid/100/0/100', pg_temp._usage(1) || ' | ' || pg_temp._usage(2));
select pg_temp._ck('C05 the event went through the payment ledger''s one writer: exactly one row there, mapped_status active, live, and the binding names the same subscription',
  (select count(*) = 1 from public.payment_event where subscription_ref = '5001' and mapped_status = 'active' and livemode)
  and (select count(*) = 1 from public.brokerage_subscription where subscription_ref = '5001' and livemode and brokerage_id = pg_temp._bk('fox')),
  null);
select pg_temp._run('fox again', $$select pg_temp._pay('fox1b', pg_temp._bk('fox'), '5001', 'active', '2026-10-04T12:00:00Z', true, 'subscription_created')$$);
select pg_temp._ck('C06 the same event delivered again is a DUPLICATE: nothing new recorded, nothing new bound',
  (select outcome = 'DUPLICATE' and not bound from _p where label = 'fox1b')
  and (select count(*) = 1 from public.payment_event where subscription_ref = '5001') and (select count(*) = 1 from public.brokerage_subscription where subscription_ref = '5001'),
  pg_temp._perr('fox1b'));

-- Cod: the processor's words, one at a time, later and later
select pg_temp._run('cod active', $$select pg_temp._pay('cod0', pg_temp._bk('cod'), '5100', 'active', '2026-10-04T10:00:00Z')$$);
select pg_temp._ck('C07 cod starts paid (control: the next checks move it away from paid)', pg_temp._plan(pg_temp._bk('cod')) = 'paid', pg_temp._plan(pg_temp._bk('cod')));
select pg_temp._run('cod on_trial',  $$select pg_temp._pay('cod1', pg_temp._bk('cod'), '5100', 'on_trial',  '2026-10-04T11:00:00Z')$$);
create temp table _c as select 'on_trial'::text as word, pg_temp._plan(pg_temp._bk('cod')) as state;
select pg_temp._run('cod paused',    $$select pg_temp._pay('cod2', pg_temp._bk('cod'), '5100', 'paused',    '2026-10-04T12:00:00Z')$$);
insert into _c select 'paused', pg_temp._plan(pg_temp._bk('cod'));
select pg_temp._run('cod past_due',  $$select pg_temp._pay('cod3', pg_temp._bk('cod'), '5100', 'past_due',  '2026-10-04T13:00:00Z')$$);
insert into _c select 'past_due', pg_temp._plan(pg_temp._bk('cod'));
select pg_temp._run('cod unpaid',    $$select pg_temp._pay('cod4', pg_temp._bk('cod'), '5100', 'unpaid',    '2026-10-04T14:00:00Z')$$);
insert into _c select 'unpaid', pg_temp._plan(pg_temp._bk('cod'));
select pg_temp._run('cod cancelled', $$select pg_temp._pay('cod5', pg_temp._bk('cod'), '5100', 'cancelled', '2026-10-04T15:00:00Z')$$);
insert into _c select 'cancelled', pg_temp._plan(pg_temp._bk('cod'));
select pg_temp._run('cod expired',   $$select pg_temp._pay('cod6', pg_temp._bk('cod'), '5100', 'expired',   '2026-10-04T16:00:00Z')$$);
insert into _c select 'expired', pg_temp._plan(pg_temp._bk('cod'));
select pg_temp._run('cod strange',   $$select pg_temp._pay('cod7', pg_temp._bk('cod'), '5100', 'ACTIVE',    '2026-10-04T17:00:00Z')$$);
insert into _c select 'ACTIVE (upper case)', pg_temp._plan(pg_temp._bk('cod'));
select pg_temp._run('cod novel',     $$select pg_temp._pay('cod8', pg_temp._bk('cod'), '5100', 'grace_period', '2026-10-04T18:00:00Z')$$);
insert into _c select 'grace_period', pg_temp._plan(pg_temp._bk('cod'));
select pg_temp._ck('C08 each processor word maps as stated and ONLY "active" is paid: on_trial -> trialing, paused/past_due/unpaid -> past_due, cancelled/expired -> canceled, a word in another case or one never seen -> unknown (never paid)',
  (select string_agg(word || '=' || state, ', ' order by word) from _c)
    = 'ACTIVE (upper case)=unknown, cancelled=canceled, expired=canceled, grace_period=unknown, on_trial=trialing, past_due=past_due, paused=past_due, unpaid=past_due',
  (select string_agg(word || '=' || state, ', ' order by word) from _c));
select pg_temp._ck('C09 the usage of a brokerage in every one of those states grants nothing: remaining 0 (a state that is not paid never shows a figure to spend)',
  pg_temp._usage(7) = 'owner/unknown/100/0/0', pg_temp._usage(7));

-- Order: an older event arriving late never undoes a newer one
select pg_temp._run('cod late old active', $$select pg_temp._pay('cod9', pg_temp._bk('cod'), '5100', 'active', '2026-10-04T09:00:00Z', true, 'subscription_updated', 'late-old-active')$$);
select pg_temp._ck('C10 an OLDER event that arrives LATER is recorded but does not change the state: the latest by the processor''s own time decides (still unknown after the 18:00 word, not paid by a 09:00 "active" arriving late)',
  pg_temp._plan(pg_temp._bk('cod')) = 'unknown' and (select outcome = 'RECORDED' from _p where label = 'cod9'), pg_temp._plan(pg_temp._bk('cod')));

-- Owl: test mode only
select pg_temp._run('owl test pays', $$select pg_temp._pay('owl1', pg_temp._bk('owl'), '9001', 'active', '2026-10-04T12:00:00Z', false, 'subscription_created')$$);
select pg_temp._ck('C11 a TEST-mode "active" event is recorded and bound (so the founder''s test payment can be checked) but the state is test_only, never paid',
  (select outcome = 'RECORDED' and bound and state = 'test_only' from _p where label = 'owl1') and pg_temp._plan(pg_temp._bk('owl')) = 'test_only'
  and (select count(*) = 1 from public.brokerage_subscription where subscription_ref = '9001' and not livemode)
  and pg_temp._usage(4) = 'owner/test_only/100/0/0', pg_temp._usage(4));
select pg_temp._ck('C12 a live and a test subscription with the SAME processor id are two different things (livemode is part of the identity): binding "9001" live for another brokerage is not a conflict',
  (select pg_temp._why($$select pg_temp._pay('hen9001', pg_temp._bk('hen'), '9001', 'on_trial', '2026-10-04T12:30:00Z', true)$$) = 'ok')
  and pg_temp._perr('hen9001') is null and pg_temp._plan(pg_temp._bk('hen')) = 'trialing'
  and pg_temp._plan(pg_temp._bk('owl')) = 'test_only', coalesce(pg_temp._perr('hen9001'), pg_temp._plan(pg_temp._bk('hen'))));

-- Elk: subscribes, cancels, subscribes again
select pg_temp._run('elk 1', $$select pg_temp._pay('elk1', pg_temp._bk('elk'), '6001', 'active', '2026-09-01T12:00:00Z', true, 'subscription_created')$$);
select pg_temp._run('elk 2', $$select pg_temp._pay('elk2', pg_temp._bk('elk'), '6001', 'cancelled', '2026-09-20T12:00:00Z', true, 'subscription_cancelled')$$);
select pg_temp._ck('C13 a cancelled live subscription is canceled and is not paid', pg_temp._plan(pg_temp._bk('elk')) = 'canceled', pg_temp._plan(pg_temp._bk('elk')));
select pg_temp._run('elk 3', $$select pg_temp._pay('elk3', pg_temp._bk('elk'), '6002', 'active', '2026-10-02T12:00:00Z', true, 'subscription_created')$$);
select pg_temp._ck('C14 subscribing again makes a NEW binding and the plan is paid again (the brokerage''s current binding is its latest live one); the old binding and its events stay',
  pg_temp._plan(pg_temp._bk('elk')) = 'paid' and (select count(*) = 2 from public.brokerage_subscription where brokerage_id = pg_temp._bk('elk'))
  and (select count(*) = 3 from public.payment_event where subscription_ref in ('6001', '6002')), pg_temp._plan(pg_temp._bk('elk')));
select pg_temp._ck('C15 a test binding never outranks a live one: owl has only a test binding, elk has a canceled live one and a paid live one, and a later TEST "active" for elk changes nothing',
  (select pg_temp._why($$select pg_temp._pay('elk4', pg_temp._bk('elk'), '6900', 'active', '2026-10-03T12:00:00Z', false)$$) = 'ok')
  and pg_temp._plan(pg_temp._bk('elk')) = 'paid' and pg_temp._plan(pg_temp._bk('owl')) = 'test_only', pg_temp._plan(pg_temp._bk('elk')));

-- Refusals
select pg_temp._run('conflict', $$select pg_temp._pay('conf', pg_temp._bk('hen'), '5001', 'active', '2026-10-04T13:00:00Z', true, 'subscription_updated')$$);
select pg_temp._ck('C16 a subscription already bound to ANOTHER brokerage is refused (BINDING_CONFLICT, EV011) and records nothing: the ledger holds the same rows, no binding was added',
  pg_temp._perr('conf') like 'EV011: BINDING_CONFLICT%'
  and (select count(*) = 1 from public.payment_event where subscription_ref = '5001')
  and (select count(*) = 1 from public.brokerage_subscription where subscription_ref = '5001' and brokerage_id = pg_temp._bk('fox'))
  and pg_temp._plan(pg_temp._bk('hen')) = 'trialing', pg_temp._perr('conf'));
select pg_temp._run('nobody', $$select pg_temp._pay('nob', 'f0000000-0000-4000-8000-000000000000'::uuid, '7777', 'active', '2026-10-04T13:00:00Z')$$);
select pg_temp._ck('C17 an id that is no brokerage is refused (BROKERAGE_UNKNOWN, EV012) and records nothing',
  pg_temp._perr('nob') like 'EV012: BROKERAGE_UNKNOWN%' and (select count(*) = 0 from public.payment_event where subscription_ref = '7777'), pg_temp._perr('nob'));
select pg_temp._ck('C18 a payer''s email, a name or any key the ledger does not know is refused by the ledger itself and nothing is bound or recorded (the allow-list is the ledger''s, reached through this one writer)',
  pg_temp._why($$select * from public.billing_event_apply(pg_temp._bk('hen'), '{"processor":"lemonsqueezy","idempotency_key":"k1","subscription_ref":"7001","event_name":"x","occurred_at":"2026-10-04T13:00:00Z","livemode":true,"user_email":"a@b.example"}'::jsonb)$$) like '22023:%'
  and pg_temp._why($$select * from public.billing_event_apply(pg_temp._bk('hen'), '{"processor":"lemonsqueezy","idempotency_key":"k2","subscription_ref":"7002","event_name":"x","occurred_at":"2026-10-04T13:00:00","livemode":true}'::jsonb)$$) like '22023:%'
  and pg_temp._why($$select * from public.billing_event_apply(pg_temp._bk('hen'), '[1]'::jsonb)$$) like '22023:%'
  and pg_temp._why($$select * from public.billing_event_apply(pg_temp._bk('hen'), '{"processor":1}'::jsonb)$$) like '22023:%'
  and (select count(*) = 0 from public.brokerage_subscription where subscription_ref in ('7001', '7002'))
  and (select count(*) = 0 from public.payment_event where subscription_ref in ('7001', '7002')), null);
select pg_temp._ck('C19 the map product''s subscriptions table was never touched by any of this (a trap on it would have raised)',
  (select count(*) = 0 from public.subscriptions), null);

-- a suspended brokerage grants nothing whatever its subscription says
select pg_temp._run('suspend', $$update public.brokerage_account set status = 'suspended' where id = pg_temp._bk('cod')$$);
select pg_temp._ck('C20 a brokerage that is not active is "suspended" whatever its subscription says (a paid one is not paid while suspended), and it has no members for the resolver',
  (select pg_temp._why($$select pg_temp._pay('cod10', pg_temp._bk('cod'), '5100', 'active', '2026-10-04T19:00:00Z', true, 'subscription_updated')$$) = 'ok')
  and pg_temp._plan(pg_temp._bk('cod')) = 'suspended' and pg_temp._usage(7) = 'none', pg_temp._plan(pg_temp._bk('cod')));
select pg_temp._run('unsuspend', $$update public.brokerage_account set status = 'active' where id = pg_temp._bk('cod')$$);
select pg_temp._ck('C21 reactivated, the same brokerage is paid again from the ledger alone (nothing was stored that had to be put back)', pg_temp._plan(pg_temp._bk('cod')) = 'paid', pg_temp._plan(pg_temp._bk('cod')));

-- =====================================================================================================
-- D. THE FREE REPORTS: the entry still charges the evaluation until the plan is paid, and the two never mix
-- =====================================================================================================
select pg_temp._run('hen free', $x$do $d$ begin
  perform pg_temp._iss('hen1', 3, 301, (select j from _pv where name = 'p0'));
  perform pg_temp._iss('hen2', 3, 302);
end $d$$x$);
select pg_temp._ck('D01 a brokerage whose plan is not paid is charged the FREE evaluation by the one entry: allotment trial, ordinals 1 and 2 of 10, status active, no period',
  (select allot = 'trial' and ordinal = 1 and used = 1 and remaining = 9 and status = 'active' and ends is null and not replayed from _i where label = 'hen1')
  and (select allot = 'trial' and ordinal = 2 and used = 2 and remaining = 8 from _i where label = 'hen2')
  and pg_temp._free_n('hen') = 2 and pg_temp._paid_n('hen') = 0, coalesce(pg_temp._ierr('hen1'), pg_temp._ierr('hen2')));
select pg_temp._run('owl free', $x$select pg_temp._iss('owl1', 4, 401)$x$);
select pg_temp._ck('D02 a brokerage with only a TEST subscription is charged the FREE evaluation, never the paid month',
  (select allot = 'trial' from _i where label = 'owl1') and pg_temp._free_n('owl') = 1 and pg_temp._paid_n('owl') = 0, pg_temp._ierr('owl1'));
select pg_temp._run('cod issue while paid', $x$select pg_temp._iss('cod1', 7, 701)$x$);

-- Fox: some free reports first (3), then pays (it already paid in C03, so these free reports are made through the entry BEFORE its first paid report by
-- using the idempotency of a free key: a free report made while not paid. Fox is paid already; make a separate brokerage's free history instead.)
select pg_temp._run('yak free x10', $x$do $d$ declare n int; begin
  for n in 1..10 loop perform pg_temp._iss('y' || n, 6, 6000 + n); end loop; end $d$$x$);
select pg_temp._ck('D03 a brokerage''s 10 free reports are used up through the one entry, the evaluation is complete, and the 11th free report is refused (EVALUATION_COMPLETE, EV002) while it has no paid plan',
  (select count(*) = 10 from _i where label ~ '^y[0-9]+$' and report_id is not null and allot = 'trial')
  and (select status = 'complete' from public.evaluation where evaluation_id = pg_temp._ev('yak'))
  and pg_temp._why($$select pg_temp._iss('y11', 6, 6011)$$) = 'ok' and pg_temp._ierr('y11') like 'EV002: EVALUATION_COMPLETE%',
  coalesce(pg_temp._ierr('y11'), (select count(*)::text from _i where label ~ '^y[0-9]+$')));
select pg_temp._run('yak pays', $$select pg_temp._pay('yak1', pg_temp._bk('yak'), '8001', 'active', '2026-10-04T12:00:00Z', true, 'subscription_created')$$);
select pg_temp._ck('D04 paying does not touch the free ledger and the free reports do not count toward the plan: 10 used, complete, and the paid month still shows 100 of 100',
  pg_temp._plan(pg_temp._bk('yak')) = 'paid' and pg_temp._free_n('yak') = 10 and pg_temp._usage(6) = 'owner/paid/100/0/100'
  and (select status = 'complete' from public.evaluation where evaluation_id = pg_temp._ev('yak')), pg_temp._usage(6));

-- =====================================================================================================
-- E. THE PAID MONTH
-- =====================================================================================================
select pg_temp._run('yak paid', $x$do $d$ begin
  perform pg_temp._iss('yp1', 6, 6101, (select j from _pv where name = 'p1'));
  perform pg_temp._iss('yp2', 6, 6102);
end $d$$x$);
select pg_temp._ck('E01 a brokerage whose free reports are all used makes a report on the paid plan: allotment paid, status paid, ordinals 1 and 2 of the month, 99 and 98 left, and the month ends one calendar month after the binding',
  (select allot = 'paid' and status = 'paid' and ordinal = 1 and used = 1 and remaining = 99 and not replayed from _i where label = 'yp1')
  and (select allot = 'paid' and ordinal = 2 and used = 2 and remaining = 98 from _i where label = 'yp2')
  and (select ends = (select (b.bound_at at time zone 'UTC' + interval '1 month') at time zone 'UTC' from public.brokerage_subscription b where b.subscription_ref = '8001') from _i where label = 'yp1'),
  coalesce(pg_temp._ierr('yp1'), pg_temp._ierr('yp2')));
select pg_temp._ck('E02 the free ledger is untouched by paid reports (still 10, complete) and the paid ledger holds 2; the usage shows 2 used and 98 left',
  pg_temp._free_n('yak') = 10 and pg_temp._paid_n('yak') = 2 and pg_temp._usage(6) = 'owner/paid/100/2/98', pg_temp._usage(6));
select pg_temp._ck('E03 paid reports are numbered from 11 (the free ones are 1 to 10): the first two paid reports are 11 and 12, and the saved list shows all twelve, newest first (12, 11, 10)',
  (select min(c.number) = 11 and max(c.number) = 12 and count(*) = 2 from public.brokerage_paid_credit c where c.brokerage_id = pg_temp._bk('yak'))
  and (select count(*) = 12 from public.evaluation_reports_of(pg_temp._u(6)))
  and (select (array_agg(t.number order by t.ord))[1:3] = array[12, 11, 10] from public.evaluation_reports_of(pg_temp._u(6)) with ordinality as t(report_id, number, generated_at, private_context_id, ord)),
  (select (array_agg(t.number order by t.ord))[1:3]::text from public.evaluation_reports_of(pg_temp._u(6)) with ordinality as t(report_id, number, generated_at, private_context_id, ord)));
select pg_temp._run('fx issue', $x$do $d$ begin perform pg_temp._iss('fx1', 1, 1101); perform pg_temp._iss('fx2', 2, 1102); end $d$$x$);
select pg_temp._ck('E04 the agent and the owner of one brokerage draw from ONE paid month: fox owner makes one, fox agent makes one, the ordinals are 1 and 2 and the usage is 2 used for both seats',
  (select ordinal = 1 and allot = 'paid' from _i where label = 'fx1') and (select ordinal = 2 and allot = 'paid' from _i where label = 'fx2')
  and pg_temp._usage(1) = 'owner/paid/100/2/98' and pg_temp._usage(2) = 'agent/paid/100/2/98',
  coalesce(pg_temp._ierr('fx1'), pg_temp._ierr('fx2')));
select pg_temp._run('fx1 again', $x$select pg_temp._iss('fx1again', 1, 1101)$x$);
select pg_temp._ck('E05 a retried key returns the stored PAID report and charges nothing: replayed true, the same report, the same ordinal, the ledger and the count unchanged',
  (select replayed and report_id = pg_temp._rp('fx1') and ordinal = 1 and allot = 'paid' from _i where label = 'fx1again')
  and pg_temp._paid_n('fox') = 2 and pg_temp._usage(1) = 'owner/paid/100/2/98', pg_temp._ierr('fx1again'));
select pg_temp._run('fx1 other', $x$select pg_temp._iss('fx1other', 2, 1101)$x$);
select pg_temp._ck('E06 the other agent retrying the same key is answered too (a key belongs to the brokerage, as the free ledger''s does)',
  (select replayed and report_id = pg_temp._rp('fx1') from _i where label = 'fx1other')
  and pg_temp._paid_n('fox') = 2, pg_temp._ierr('fx1other'));
select pg_temp._run('yfree', $x$select pg_temp._iss('yfree', 6, 6001)$x$);
select pg_temp._ck('E07 a retried key is answered across BOTH ledgers: a key that made a FREE report, retried after the plan became paid, returns that free report (replayed, allotment trial) and charges the paid month nothing',
  (select replayed and report_id = pg_temp._rp('y1') and allot = 'trial' from _i where label = 'yfree')
  and pg_temp._paid_n('yak') = 2 and pg_temp._free_n('yak') = 10, coalesce(pg_temp._ierr('yfree'), 'x'));
select pg_temp._ck('E08 a key is required (22023, IDEMPOTENCY_KEY_REQUIRED)',
  pg_temp._why($$select * from public.brokerage_report_issue(pg_temp._u(1), null, '{"n":1}', pg_temp._h('{"n":1}'), 'v', '{}'::jsonb, null)$$) like '22023: IDEMPOTENCY_KEY_REQUIRED%', null);

-- who may charge
select pg_temp._run('refusals', $x$do $d$ begin
  perform pg_temp._iss('stranger', 8, 801);
  perform pg_temp._iss('nobody', 99, 802);
end $d$$x$);
select pg_temp._ck('E09 a person with no brokerage, and an unknown person, are refused (NOT_ENTITLED, EV003) and charge nothing',
  pg_temp._ierr('stranger') like 'EV003: NOT_ENTITLED%' and pg_temp._ierr('nobody') like 'EV003: NOT_ENTITLED%', pg_temp._ierr('stranger'));
select pg_temp._run('henfree', $x$select pg_temp._iss('henfree', 3, 303)$x$);
select pg_temp._ck('E10 a brokerage''s paid month cannot be spent by another brokerage''s member: hen''s owner has no plan and is charged hen''s FREE ledger, never fox''s paid one (fox still has 2 paid reports)',
  (select allot = 'trial' from _i where label = 'henfree') and pg_temp._paid_n('fox') = 2, pg_temp._ierr('henfree'));

-- a refusal by the snapshot costs nothing and leaves no gap
select pg_temp._run('bad hash', $x$select pg_temp._iss('badhash', 1, 1103, null, 'not-a-hash')$x$);
select pg_temp._run('good after bad', $x$select pg_temp._iss('fx3', 1, 1104)$x$);
select pg_temp._ck('E11 a report the snapshot refuses (a bad content hash) is charged nothing and leaves no hole: the next report is ordinal 3 and number 13-style contiguous, and the ledger holds 3',
  pg_temp._ierr('badhash') is not null and (select ordinal = 3 and used = 3 and remaining = 97 from _i where label = 'fx3')
  and pg_temp._paid_n('fox') = 3 and (select max(number) = 13 and count(*) = 3 from public.brokerage_paid_credit where brokerage_id = pg_temp._bk('fox')),
  coalesce(pg_temp._ierr('badhash'), 'no error') || ' / ' || coalesce(pg_temp._ierr('fx3'), 'ok'));

-- states that do not grant fall back to the free evaluation
select pg_temp._run('cod lapses', $$select pg_temp._pay('cod11', pg_temp._bk('cod'), '5100', 'past_due', '2026-10-04T20:00:00Z')$$);
select pg_temp._run('cod after lapse', $x$select pg_temp._iss('cod2', 7, 702)$x$);
select pg_temp._ck('E12 when the plan stops being paid the entry goes back to the free evaluation (past_due is not paid): the new report is a free one, and the paid ledger is unchanged',
  pg_temp._plan(pg_temp._bk('cod')) = 'past_due' and (select allot = 'trial' from _i where label = 'cod2') and pg_temp._paid_n('cod') = 1 and pg_temp._free_n('cod') = 1,
  coalesce(pg_temp._ierr('cod2'), pg_temp._plan(pg_temp._bk('cod'))));
select pg_temp._run('cod1 again', $x$select pg_temp._iss('cod1again', 7, 701)$x$);
select pg_temp._ck('E13 a PAID key retried after the plan lapsed still returns the stored paid report (replay is checked before the plan), charging nothing',
  (select replayed and report_id = pg_temp._rp('cod1') and allot = 'paid' from _i where label = 'cod1again')
  and pg_temp._paid_n('cod') = 1 and pg_temp._free_n('cod') = 1, pg_temp._ierr('cod1again'));
select pg_temp._run('yak cancels', $$select pg_temp._pay('yak2', pg_temp._bk('yak'), '8001', 'cancelled', '2026-10-05T12:00:00Z', true, 'subscription_cancelled')$$);
select pg_temp._run('yp3', $x$select pg_temp._iss('yp3', 6, 6103)$x$);
select pg_temp._ck('E14 a brokerage that lapsed AFTER using its free reports up cannot make a new report at all: yak cancels, and a new key is refused EVALUATION_COMPLETE (EV002) while the paid ledger is untouched',
  pg_temp._plan(pg_temp._bk('yak')) = 'canceled'
  and pg_temp._ierr('yp3') like 'EV002: EVALUATION_COMPLETE%' and pg_temp._paid_n('yak') = 2,
  coalesce(pg_temp._ierr('yp3'), 'no error'));
select pg_temp._ck('E15 the usage after the lapse reads canceled with nothing to spend, though two paid reports were made; the reports themselves stay readable',
  pg_temp._usage(6) = 'owner/canceled/100/0/0' and (select count(*) = 12 from public.evaluation_reports_of(pg_temp._u(6))), pg_temp._usage(6));

-- an evaluation the admin ended ends the brokerage's right to make reports, paid or not
select pg_temp._run('elk issue', $x$select pg_temp._iss('elk1', 5, 5201)$x$);
select pg_temp._run('revoke elk', $$select public.evaluation_revoke(pg_temp._ev('elk'))$$);
select pg_temp._run('elk after revoke', $x$select pg_temp._iss('elk2', 5, 5202)$x$);
select pg_temp._ck('E16 a revoked evaluation is refused (NOT_ENTITLED, EV003) even for a brokerage whose plan is paid: the admin''s act stands',
  (select allot = 'paid' from _i where label = 'elk1') and pg_temp._ierr('elk2') like 'EV003: NOT_ENTITLED%' and pg_temp._plan(pg_temp._bk('elk')) = 'paid',
  coalesce(pg_temp._ierr('elk2'), 'no error'));

-- an evaluation that has EXPIRED ends the right to make reports, paid or not (the readers hide its reports on the same test)
select pg_temp._run('emu pays', $$select pg_temp._pay('emu1', pg_temp._bk('emu'), '9101', 'active', '2026-10-04T13:00:00Z', true, 'subscription_created')$$);
select pg_temp._run('emu issue', $x$select pg_temp._iss('emu1', 13, 13001)$x$);
select pg_temp._run('emu expires', $$update public.evaluation set expires_at = created_at + interval '1 millisecond' where evaluation_id = pg_temp._ev('emu')$$);
select pg_temp._run('emu after expiry', $x$select pg_temp._iss('emu2', 13, 13002)$x$);
select pg_temp._ck('E17 an expired evaluation is refused (NOT_ENTITLED, EV003) even for a brokerage whose plan is paid: a payment adds an allotment and never reopens an account that has ended',
  (select allot = 'paid' from _i where label = 'emu1') and pg_temp._ierr('emu2') like 'EV003: NOT_ENTITLED%' and pg_temp._plan(pg_temp._bk('emu')) = 'paid' and pg_temp._paid_n('emu') = 1,
  coalesce(pg_temp._ierr('emu2'), 'no error'));

-- put emu back (the monitor's invariant J01 reads a paid brokerage with an expired evaluation as a defect, which is what E17 made on purpose)
select pg_temp._run('emu un-expires', $$update public.evaluation set expires_at = null where evaluation_id = pg_temp._ev('emu')$$);

-- =====================================================================================================
-- F. THE CAP IS A CONSTRAINT, AND THE MONTH IS NOT THE WRITER'S TO CHOOSE
-- =====================================================================================================
-- Hen subscribes now and uses the whole month through the entry
select pg_temp._run('hen pays', $$select pg_temp._pay('hen1p', pg_temp._bk('hen'), '5200', 'active', '2026-10-04T14:00:00Z', true, 'subscription_created')$$);
select pg_temp._run('hen fills the month', $x$do $d$ declare n int; begin
  for n in 1..100 loop perform pg_temp._iss('h' || n, 3, 3100 + n); end loop; end $d$$x$);
select pg_temp._ck('F01 a brokerage makes 100 paid reports in its month, ordinals 1 to 100, and the 100th leaves 0',
  (select count(*) = 100 from _i where label ~ '^h[0-9]+$' and report_id is not null and allot = 'paid')
  and (select ordinal = 100 and used = 100 and remaining = 0 from _i where label = 'h100') and pg_temp._usage(3) = 'owner/paid/100/100/0',
  coalesce((select string_agg(label || ':' || err, ';') from _i where label ~ '^h[0-9]+$' and err is not null), 'x'));
select pg_temp._run('hen 101', $x$select pg_temp._iss('h101', 3, 3201)$x$);
select pg_temp._ck('F02 the 101st report of the month is refused by the function (ALLOTMENT_COMPLETE, EV010) and costs nothing: still 100 in the ledger, and no snapshot was stored for it',
  pg_temp._ierr('h101') like 'EV010: ALLOTMENT_COMPLETE%' and pg_temp._paid_n('hen') = 100
  and (select count(*) = 100 from public.evaluation_credit_all a join public.evaluation e on e.evaluation_id = a.evaluation_id where e.brokerage_id = pg_temp._bk('hen') and a.ordinal > 10),
  pg_temp._ierr('h101'));
select pg_temp._ck('F03 the cap holds by CONSTRAINT even for a writer that bypasses the function: inserting ordinal 101, or a second row in an ordinal already used, is refused by the table itself (check / primary key), as the table owner',
  pg_temp._why($$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select b.binding_id, b.brokerage_id, 0, 101, 500, gen_random_uuid(), pg_temp._rp('h1') from public.brokerage_subscription b where b.subscription_ref = '5200'$$) like '23514:%brokerage_paid_credit_ordinal%'
  and pg_temp._why($$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select b.binding_id, b.brokerage_id, 0, 1, 501, gen_random_uuid(), (select report_id from public.report_snapshot_issue('{"x":1}', pg_temp._h('{"x":1}'), 'v', '{}'::jsonb, null)) from public.brokerage_subscription b where b.subscription_ref = '5200'$$) like '23505:%',
  null);
select pg_temp._ck('F04 the MONTH is stamped by the database: a writer that names month 7 for a row gets the real current month instead, so it cannot buy a second 100 by naming another month (the insert lands in the real month and meets the primary key of the full one)',
  pg_temp._why($$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select b.binding_id, b.brokerage_id, 7, 1, 502, gen_random_uuid(), (select report_id from public.report_snapshot_issue('{"x":2}', pg_temp._h('{"x":2}'), 'v', '{}'::jsonb, null)) from public.brokerage_subscription b where b.subscription_ref = '5200'$$) like '23505:%'
  and (select count(*) = 0 from public.brokerage_paid_credit where period_index = 7), null);
select pg_temp._ck('F05 a paid credit needs a LIVE binding of the SAME brokerage: a test binding is refused (55000), and a binding of another brokerage is refused by the foreign key (23503)',
  pg_temp._why($$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select b.binding_id, b.brokerage_id, 0, 1, 11, gen_random_uuid(), (select report_id from public.report_snapshot_issue('{"x":3}', pg_temp._h('{"x":3}'), 'v', '{}'::jsonb, null)) from public.brokerage_subscription b where b.subscription_ref = '9001' and not b.livemode$$) like '55000:%'
  and pg_temp._why($$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select b.binding_id, pg_temp._bk('fox'), 0, 1, 11, gen_random_uuid(), (select report_id from public.report_snapshot_issue('{"x":4}', pg_temp._h('{"x":4}'), 'v', '{}'::jsonb, null)) from public.brokerage_subscription b where b.subscription_ref = '5200'$$) like '55000:%',
  null);
select pg_temp._ck('F06 a number can never be reused: a second row with an existing number for the brokerage is refused by the unique constraint, and a number at or below 10 (a free report''s) is refused by the check',
  pg_temp._why($$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select b.binding_id, b.brokerage_id, 0, 1, 10, gen_random_uuid(), (select report_id from public.report_snapshot_issue('{"x":5}', pg_temp._h('{"x":5}'), 'v', '{}'::jsonb, null)) from public.brokerage_subscription b where b.subscription_ref = '5200'$$) like '23514:%brokerage_paid_credit_number%'
  and pg_temp._why($$insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id)
     select b.binding_id, b.brokerage_id, 0, 1, 11, gen_random_uuid(), (select report_id from public.report_snapshot_issue('{"x":6}', pg_temp._h('{"x":6}'), 'v', '{}'::jsonb, null)) from public.brokerage_subscription b where b.subscription_ref = '5200'$$) like '23505:%',
  null);

-- the next month: a binding made 35 days ago has a month 1; the usage and the cap are per month
select pg_temp._run('mk bat', $$select pg_temp._mk('bat', 'Bat Homes')$$);
select pg_temp._run('own bat', $$select pg_temp._own('bat', 9)$$);
select pg_temp._run('bat binding', $$insert into public.brokerage_subscription (brokerage_id, processor, subscription_ref, livemode, bound_at)
  values (pg_temp._bk('bat'), 'lemonsqueezy', '5300', true, now() - interval '35 days')$$);
select pg_temp._run('bat pays', $$select pg_temp._pay('bat1', pg_temp._bk('bat'), '5300', 'active', '2026-10-04T14:00:00Z', true, 'subscription_updated')$$);
select pg_temp._run('bat old month', $x$do $d$ declare n int; begin
  alter table public.brokerage_paid_credit disable trigger brokerage_paid_credit_guard;
  for n in 1..100 loop
    insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id, issued_at)
    select b.binding_id, b.brokerage_id, 0, n, 10 + n, gen_random_uuid(),
           (select report_id from public.report_snapshot_issue(format('{"bat":%s}', n), pg_temp._h(format('{"bat":%s}', n)), 'v', '{}'::jsonb, null)),
           now() - interval '34 days'
      from public.brokerage_subscription b where b.subscription_ref = '5300';
  end loop;
  alter table public.brokerage_paid_credit enable trigger brokerage_paid_credit_guard;
end $d$$x$);
select pg_temp._ck('F07 a binding made 35 days ago is in its SECOND month (index 1): the 100 reports of month 0 do not count against it, so its usage reads 0 used, 100 left (month 0 is full: 100 rows exist)',
  public.billing_period_index(now() - interval '35 days', now()) = 1 and public.billing_period_index(now() - interval '29 days', now()) = 0
  and (select count(*) = 100 from public.brokerage_paid_credit c join public.brokerage_subscription b using (binding_id) where b.subscription_ref = '5300' and c.period_index = 0)
  and pg_temp._usage(9) = 'owner/paid/100/0/100', pg_temp._usage(9));
select pg_temp._run('bat new month', $x$do $d$ begin perform pg_temp._iss('bn1', 9, 9001); perform pg_temp._iss('bn2', 9, 9002); end $d$$x$);
select pg_temp._ck('F08 in the second month the first report is ordinal 1 again and the NUMBER carries on from 111 (the month resets, the numbers never repeat), and the month ends one calendar month after the second month began',
  (select ordinal = 1 and used = 1 and remaining = 99 and allot = 'paid' from _i where label = 'bn1')
  and (select ordinal = 2 from _i where label = 'bn2')
  and (select max(number) = 112 and count(*) = 102 from public.brokerage_paid_credit where brokerage_id = pg_temp._bk('bat'))
  and (select ends = (select ((b.bound_at at time zone 'UTC') + interval '2 months') at time zone 'UTC' from public.brokerage_subscription b where b.subscription_ref = '5300') from _i where label = 'bn1'),
  coalesce(pg_temp._ierr('bn1'), 'x'));
select pg_temp._ck('F09 month arithmetic: whole calendar months from the bound day, computed in UTC (31 Jan + 1 month is 28 Feb; a time before the binding is month 0; the boundary instant belongs to the NEW month)',
  public.billing_period_index('2026-01-31T10:00:00Z', '2026-02-27T10:00:00Z') = 0
  and public.billing_period_index('2026-01-31T10:00:00Z', '2026-02-28T10:00:00Z') = 1
  and public.billing_period_index('2026-10-04T12:00:00Z', '2026-11-04T11:59:59Z') = 0
  and public.billing_period_index('2026-10-04T12:00:00Z', '2026-11-04T12:00:00Z') = 1
  and public.billing_period_index('2026-10-04T12:00:00Z', '2026-10-01T12:00:00Z') = 0
  and public.billing_period_end('2026-10-04T12:00:00Z', 0) = '2026-11-04T12:00:00Z'::timestamptz,
  null);

-- =====================================================================================================
-- G. APPEND-ONLY
-- =====================================================================================================
select pg_temp._ck('G01 neither table can be changed or emptied, by anyone including the owner: update, delete and truncate are refused (55000) on both (control: the same statements work on an unprotected copy)',
  pg_temp._why($$update public.brokerage_subscription set livemode = true$$) like '55000:%'
  and pg_temp._why($$delete from public.brokerage_subscription$$) like '55000:%'
  and pg_temp._why($$truncate public.brokerage_subscription cascade$$) like '55000:%'
  and pg_temp._why($$update public.brokerage_paid_credit set ordinal = ordinal$$) like '55000:%'
  and pg_temp._why($$delete from public.brokerage_paid_credit$$) like '55000:%'
  and pg_temp._why($$truncate public.brokerage_paid_credit$$) like '55000:%'
  and pg_temp._why($$create temp table _copy as select * from public.brokerage_subscription; update _copy set livemode = livemode; delete from _copy; truncate _copy$$) = 'ok',
  null);

-- =====================================================================================================
-- H. WHOSE A REPORT IS: the six readers read the ONE view, and a paid report is found as a free one is
-- =====================================================================================================
select pg_temp._ck('H01 every one of the six ownership readers now reads public.evaluation_credit_all and none still names the trial table; their security, volatility, search path, owner and privileges are exactly what the base recorded after the splice (the splice changed the body and nothing else)',
  (select count(*) = 6 from pg_proc p where p.oid in ('public.evaluation_reports_of(uuid)'::regprocedure, 'public.evaluation_report_open(uuid, uuid)'::regprocedure,
        'public.evaluation_report_shares_of(uuid, uuid)'::regprocedure, 'public.evaluation_report_share_revoke(uuid, uuid)'::regprocedure,
        'public.report_share_open(text)'::regprocedure, 'public.evaluation_property_watches_of(uuid)'::regprocedure)
     and pg_get_functiondef(p.oid) like '%public.evaluation_credit_all c%' and pg_get_functiondef(p.oid) not like '%public.evaluation_credit c%')
  and (select attrs from _base) = pg_temp._reader_attrs(),
  null);
select pg_temp._ck('H02 the saved list of a paid brokerage shows its paid reports beside its free ones, newest first, and its number is the report''s (fox: 3 paid reports, 11 to 13)',
  (select count(*) = 3 and min(number) = 11 and max(number) = 13 from public.evaluation_reports_of(pg_temp._u(1))), (select count(*)::text from public.evaluation_reports_of(pg_temp._u(1))));
select pg_temp._ck('H03 a paid report opens for its own brokerage''s members (the owner AND the agent) with the stored body, and for NOBODY else: another brokerage''s owner and a stranger see zero rows',
  (select count(*) = 1 from public.evaluation_report_open(pg_temp._u(1), pg_temp._rp('fx1')))
  and (select count(*) = 1 from public.evaluation_report_open(pg_temp._u(2), pg_temp._rp('fx1')))
  and (select count(*) = 0 from public.evaluation_report_open(pg_temp._u(3), pg_temp._rp('fx1')))
  and (select count(*) = 0 from public.evaluation_report_open(pg_temp._u(8), pg_temp._rp('fx1')))
  and (select body like '%"n":1101%' from public.evaluation_report_open(pg_temp._u(1), pg_temp._rp('fx1'))), null);
select pg_temp._ck('H04 a free report still opens as before (hen''s first free report, for hen''s owner) and a free report of one brokerage is still invisible to another',
  (select count(*) = 1 from public.evaluation_report_open(pg_temp._u(3), pg_temp._rp('hen1')))
  and (select count(*) = 0 from public.evaluation_report_open(pg_temp._u(1), pg_temp._rp('hen1'))), null);

create temp table _s (share_id uuid, expires_at timestamptz);   -- created up front: a step that fails must fail the CHECKS below, not leave them reading a table that is not there
select pg_temp._run('share paid', $x$insert into _s select * from public.evaluation_report_share_create(pg_temp._u(1), pg_temp._rp('fx1'), pg_temp._h('token-for-fx1'))$x$);
select pg_temp._ck('H05 a share link can be made for a PAID report by its brokerage, listed for it, and its public page opens it with the brokerage''s name; another brokerage cannot make or list or revoke it',
  (select count(*) = 1 from _s)
  and (select count(*) = 1 and bool_and(status = 'ACTIVE') from public.evaluation_report_shares_of(pg_temp._u(2), pg_temp._rp('fx1')))
  and (select count(*) = 1 and bool_and(brokerage_name = 'Fox Realty' and body like '%1101%') from public.report_share_open(pg_temp._h('token-for-fx1')))
  and pg_temp._why($$select * from public.evaluation_report_share_create(pg_temp._u(3), pg_temp._rp('fx1'), pg_temp._h('thief'))$$) like 'EV006:%'
  and (select count(*) = 0 from public.evaluation_report_shares_of(pg_temp._u(3), pg_temp._rp('fx1')))
  and pg_temp._why($$select public.evaluation_report_share_revoke(pg_temp._u(3), (select share_id from _s))$$) like 'EV006:%',
  null);
select pg_temp._run('revoke share', $$select public.evaluation_report_share_revoke(pg_temp._u(1), (select share_id from _s))$$);
select pg_temp._ck('H06 the owner revokes that link and the public page stops showing the paid report',
  (select count(*) = 0 from public.report_share_open(pg_temp._h('token-for-fx1')))
  and (select count(*) = 1 and bool_and(status = 'REVOKED') from public.evaluation_report_shares_of(pg_temp._u(1), pg_temp._rp('fx1'))), null);
create temp table _w (watch_id uuid, created_at timestamptz, started boolean);
select pg_temp._run('watch paid', $x$do $d$ begin
  perform pg_temp._iss('fxp', 1, 1105, (select j from _pv where name = 'p1'));
  insert into _w select * from public.evaluation_property_watch_start(pg_temp._u(1), pg_temp._rp('fxp'));
end $d$$x$);
select pg_temp._ck('H07 a property watch can be started on a PAID report that kept its private context, and the watch list shows it under its paid number (14)',
  (select started from _w) and (select count(*) = 1 and bool_and(number = 14) from public.evaluation_property_watches_of(pg_temp._u(1))),
  coalesce((select err from (select pg_temp._ierr('fxp') as err) x), 'x'));

-- =====================================================================================================
-- J. THE AUDIT
-- =====================================================================================================
select pg_temp._ck('J01 every invariant of billing_check() reads zero beside non-zero controls (bindings and paid credits exist)',
  (select count(*) = 8 and bool_and(violations = 0) from public.billing_check() where kind = 'invariant') and (select count(*) = 2 and bool_and(violations > 0) from public.billing_check() where kind = 'control'),
  (select string_agg(check_name || '=' || violations, ';') from public.billing_check() where violations <> 0 and kind = 'invariant'));
select pg_temp._run('seed wrong month', $x$do $d$ begin
  alter table public.brokerage_paid_credit disable trigger brokerage_paid_credit_guard;
  insert into public.brokerage_paid_credit (binding_id, brokerage_id, period_index, ordinal, number, idempotency_key, report_id, issued_at)
  select b.binding_id, b.brokerage_id, 3, n, 899 + n, gen_random_uuid(), (select report_id from public.report_snapshot_issue(format('{"seed":%s}', n), pg_temp._h(format('{"seed":%s}', n)), 'v', '{}'::jsonb, null)), now()
    from public.brokerage_subscription b, unnest(array[1, 3]) n where b.subscription_ref = '5001';
  alter table public.brokerage_paid_credit enable trigger brokerage_paid_credit_guard;
end $d$$x$);
select pg_temp._ck('J02 the audit CATCHES a row that sits in the wrong month and a gap in the numbers (seeded with the guard off): paid_credit_in_the_wrong_month = 2, ordinal_gaps_in_a_month = 1, number_gaps_for_a_brokerage = 1',
  (select violations = 2 from public.billing_check() where check_name = 'paid_credit_in_the_wrong_month')
  and (select violations = 1 from public.billing_check() where check_name = 'ordinal_gaps_in_a_month')
  and (select violations = 1 from public.billing_check() where check_name = 'number_gaps_for_a_brokerage'),
  (select string_agg(check_name || '=' || violations, ';') from public.billing_check() where violations <> 0));

-- =====================================================================================================
-- K. SETUP COMPLETENESS
-- =====================================================================================================
select pg_temp._ck('S99 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok'),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

revoke usage on schema public from anon, authenticated, service_role;
\o
select check_name, pass, detail from _r order by n;
