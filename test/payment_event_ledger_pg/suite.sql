-- =====================================================================================
-- PAYMENT-EVENT LEDGER — EXECUTABLE ADVERSARIAL SUITE  (docs/payment-event-ledger.sql)
--
-- Order M, step M0 (2026-10-01): an append-only, processor-neutral record of billing-processor events, with
-- one idempotency rule, one ordering rule and one fail-closed status mapping, and NO entitlement. The processor's
-- real payload is UNVERIFIED, so every event below is SYNTHETIC and says so by its ids; what is proven is the
-- ledger's own behaviour (once, in order, closed, immutable, locked, and entitlement-free), not the processor's.
-- Every expected answer is a HARD-CODED constant. The stand-in public.subscriptions carries a TRAP that raises on
-- any touch, so a recorder that wrote to it would fail every check that records an event.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- The two checks that need TWO CONCURRENT SESSIONS (a retry race, and ordering under a race) are run.sh's.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);

create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

-- run a statement; 'ok', or the SQLSTATE and (for a constraint) its name
create function pg_temp._try(p_sql text) returns text language plpgsql as $$
declare _c text; _s text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics _c = constraint_name;
  _s := sqlstate;
  return _s || case when coalesce(_c, '') <> '' then ':' || _c else '' end;
end $$;

-- the error MESSAGE of a statement that fails (null when it succeeds)
create function pg_temp._msg(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- run a statement AS a role (invoker rights); 'ok' or the SQLSTATE
create function pg_temp._as(p_role text, p_sql text) returns text language plpgsql as $$
begin
  execute format('set role %I', p_role);
  begin
    execute p_sql;
    execute 'reset role';
    return 'ok';
  exception when others then
    execute 'reset role';
    return sqlstate;
  end;
end $$;

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly created
-- schema here has neither, and without them every refusal below could come from the SCHEMA or from RLS rather
-- than from the objects' own privileges. Set here, undone at the end.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- a synthetic event. p_status null drops the key entirely (an absent status).
create function pg_temp._e(p_key text, p_sub text, p_name text, p_status text, p_at text,
    p_live boolean default true, p_proc text default 'lemonsqueezy') returns jsonb language sql as
$$ select jsonb_strip_nulls(jsonb_build_object('processor', p_proc, 'idempotency_key', p_key, 'subscription_ref', p_sub,
     'event_name', p_name, 'processor_status', p_status, 'occurred_at', p_at,
     'product_ref', 'synthetic-prod', 'variant_ref', 'synthetic-var', 'livemode', p_live)) $$;

-- record through the one writer and keep what came back, or the SQLSTATE[:constraint] when it refused
create temp table _ev (name text primary key, outcome text, event_id bigint, is_latest boolean, recorded_at timestamptz, err text);
create function pg_temp._go(p_name text, p_event jsonb) returns void language plpgsql as $$
declare r record; c text;
begin
  select * into r from public.payment_event_record(p_event);
  insert into _ev values (p_name, r.outcome, r.event_id, r.is_latest, r.recorded_at, null);
exception when others then
  get stacked diagnostics c = constraint_name;
  insert into _ev values (p_name, null, null, null, null, sqlstate || case when coalesce(c, '') <> '' then ':' || c else '' end);
end $$;
create function pg_temp._o(p_name text) returns text language sql as
$$ select coalesce(outcome || ':' || is_latest::text, err) from _ev where name = p_name $$;
create function pg_temp._id(p_name text) returns bigint language sql as $$ select event_id from _ev where name = p_name $$;

create function pg_temp._n() returns bigint language sql as $$ select count(*) from public.payment_event $$;
create function pg_temp._fp() returns text language sql as
$$ select coalesce(md5(string_agg(row_to_json(e)::text, ',' order by e.event_id)), 'empty') from public.payment_event e $$;

-- ---- E01..E02  the environment the claims depend on -----------------------------------------------
create table public._m0_probe (x int);
select pg_temp._ck('E01 control: the stand-in reproduces Supabase default privileges — a fresh table in public IS readable and writable by anon and authenticated, so the lock-down below is what removes that',
  has_table_privilege('anon', 'public._m0_probe', 'select') and has_table_privilege('authenticated', 'public._m0_probe', 'insert'),
  null);
drop table public._m0_probe;
select pg_temp._ck('E02 control: the TRAP on the stand-in subscriptions table is armed — a direct insert is refused and it holds no rows — so a "0 rows" below can only mean the ledger never touched it',
  pg_temp._try($$insert into public.subscriptions (user_id, status) values (gen_random_uuid(), 'active')$$) = 'P0001'
  and (select count(*) from public.subscriptions) = 0
  and (select count(*) from pg_trigger where tgrelid = 'public.subscriptions'::regclass and not tgisinternal) = 2,
  pg_temp._try($$insert into public.subscriptions (user_id, status) values (gen_random_uuid(), 'active')$$));

-- ---- D01  once: an event is recorded once; a replay is a DUPLICATE ------------------------------------
select pg_temp._go('a1', pg_temp._e('k-1001-created', '1001', 'subscription_created', 'active', '2026-10-01T10:00:00Z'));
select pg_temp._ck('D01 the first event is RECORDED, is the latest of its subscription, and exactly one row is stored',
  pg_temp._o('a1') = 'RECORDED:true' and pg_temp._n() = 1, pg_temp._o('a1'));
create temp table _a1 as select event_id, md5(row_to_json(e)::text) as fp, recorded_at from public.payment_event e where e.idempotency_key = 'k-1001-created';
select pg_temp._go('a1_replay', pg_temp._e('k-1001-created', '1001', 'subscription_created', 'active', '2026-10-01T10:00:00Z'));
select pg_temp._ck('D01b the SAME key replayed is a DUPLICATE: same event_id, the first row''s recorded_at, still the latest, and the row count and the stored row are unchanged',
  pg_temp._o('a1_replay') = 'DUPLICATE:true' and pg_temp._id('a1_replay') = pg_temp._id('a1')
  and (select recorded_at from _ev where name = 'a1_replay') = (select recorded_at from _a1)
  and pg_temp._n() = 1
  and (select md5(row_to_json(e)::text) from public.payment_event e where e.idempotency_key = 'k-1001-created') = (select fp from _a1),
  pg_temp._o('a1_replay'));
select pg_temp._go('a1_tz', pg_temp._e('k-1001-created', '1001', 'subscription_created', 'active', '2026-10-01T12:00:00+02:00'));
select pg_temp._ck('D01c the same key with the same INSTANT written in another offset (12:00+02:00 is 10:00Z) is still a DUPLICATE, not a conflict',
  pg_temp._o('a1_tz') = 'DUPLICATE:true' and pg_temp._n() = 1, pg_temp._o('a1_tz'));
select pg_temp._go('a1_status', pg_temp._e('k-1001-created', '1001', 'subscription_created', 'past_due', '2026-10-01T10:00:00Z'));
select pg_temp._go('a1_sub', pg_temp._e('k-1001-created', '9999', 'subscription_created', 'active', '2026-10-01T10:00:00Z'));
select pg_temp._go('a1_live', pg_temp._e('k-1001-created', '1001', 'subscription_created', 'active', '2026-10-01T10:00:00Z', false));
select pg_temp._ck('D01d the SAME key for a DIFFERENT event (another status, another subscription, another mode) is REFUSED loudly (23505, a named constraint) and writes nothing — a key that is too coarse must not drop real events in silence',
  pg_temp._o('a1_status') = '23505:payment_event_idempotency_key_reused'
  and pg_temp._o('a1_sub') = '23505:payment_event_idempotency_key_reused'
  and pg_temp._o('a1_live') = '23505:payment_event_idempotency_key_reused'
  and pg_temp._n() = 1,
  pg_temp._o('a1_status') || ' / ' || pg_temp._o('a1_sub') || ' / ' || pg_temp._o('a1_live'));
select pg_temp._go('a1_stripe', pg_temp._e('k-1001-created', '1001', 'subscription_created', 'active', '2026-10-01T10:00:00Z', true, 'stripe'));
select pg_temp._ck('D01e the idempotency key is scoped to the PROCESSOR: the same key from another processor is a new event, and nothing was dropped',
  pg_temp._o('a1_stripe') = 'RECORDED:true' and pg_temp._n() = 2, pg_temp._o('a1_stripe'));
select pg_temp._ck('D01f the server stamps recorded_at (the caller has no key for it) and it is the server clock, not the processor''s time',
  (select recorded_at > '2026-10-01T10:00:00Z' and recorded_at <= now() + interval '1 minute' from _a1)
  and pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$,
        (pg_temp._e('k-rec', '1001', 'subscription_updated', 'active', '2026-10-01T10:01:00Z') || '{"recorded_at":"2020-01-01T00:00:00Z"}'::jsonb)::text)) = '22023'
  and pg_temp._n() = 2,
  null);

-- ---- D02  in order: the processor's time decides, arrival never does ------------------------------------
select pg_temp._go('o_new', pg_temp._e('k-1002-updated', '1002', 'subscription_updated', 'past_due', '2026-10-01T11:00:00Z'));
select pg_temp._go('o_old', pg_temp._e('k-1002-created', '1002', 'subscription_created', 'active', '2026-10-01T09:00:00Z'));
select pg_temp._ck('D02 an OLDER event that ARRIVES LATER is recorded (it is evidence) but reported NOT the latest, and the newer event stays the latest',
  pg_temp._o('o_new') = 'RECORDED:true' and pg_temp._o('o_old') = 'RECORDED:false'
  and public.payment_event_latest_id('lemonsqueezy', true, '1002') = pg_temp._id('o_new'),
  pg_temp._o('o_old'));
select pg_temp._go('o_old_replay', pg_temp._e('k-1002-created', '1002', 'subscription_created', 'active', '2026-10-01T09:00:00Z'));
select pg_temp._go('o_new_replay', pg_temp._e('k-1002-updated', '1002', 'subscription_updated', 'past_due', '2026-10-01T11:00:00Z'));
select pg_temp._ck('D02b a replay reports the event''s CURRENT standing: the old one is a DUPLICATE and not the latest, the newer one a DUPLICATE and the latest',
  pg_temp._o('o_old_replay') = 'DUPLICATE:false' and pg_temp._o('o_new_replay') = 'DUPLICATE:true',
  pg_temp._o('o_old_replay') || ' / ' || pg_temp._o('o_new_replay'));
select pg_temp._go('o_other', pg_temp._e('k-1003-created', '1003', 'subscription_created', 'active', '2026-10-01T08:00:00Z'));
select pg_temp._ck('D02c subscriptions are independent: an event for another subscription is its own latest and does not move this one',
  pg_temp._o('o_other') = 'RECORDED:true' and public.payment_event_latest_id('lemonsqueezy', true, '1002') = pg_temp._id('o_new'),
  pg_temp._o('o_other'));
-- arrival order must not matter: the same three events, in two different arrival orders, for two subscriptions
select pg_temp._go('p1', pg_temp._e('k-p-1', '2001', 'subscription_updated', 'active', '2026-10-02T01:00:00Z'));
select pg_temp._go('p2', pg_temp._e('k-p-2', '2001', 'subscription_updated', 'paused', '2026-10-02T02:00:00Z'));
select pg_temp._go('p3', pg_temp._e('k-p-3', '2001', 'subscription_updated', 'active', '2026-10-02T03:00:00Z'));
select pg_temp._go('q3', pg_temp._e('k-q-3', '2002', 'subscription_updated', 'active', '2026-10-02T03:00:00Z'));
select pg_temp._go('q1', pg_temp._e('k-q-1', '2002', 'subscription_updated', 'active', '2026-10-02T01:00:00Z'));
select pg_temp._go('q2', pg_temp._e('k-q-2', '2002', 'subscription_updated', 'paused', '2026-10-02T02:00:00Z'));
select pg_temp._ck('D02d ARRIVAL ORDER DOES NOT DECIDE: the same three events arriving ascending (2001) and scrambled (2002) both leave the 03:00 event as the latest, and the verdicts reported on arrival are true/true/true and true/false/false',
  public.payment_event_latest_id('lemonsqueezy', true, '2001') = pg_temp._id('p3')
  and public.payment_event_latest_id('lemonsqueezy', true, '2002') = pg_temp._id('q3')
  and pg_temp._o('p1') || pg_temp._o('p2') || pg_temp._o('p3') = 'RECORDED:trueRECORDED:trueRECORDED:true'
  and pg_temp._o('q3') || pg_temp._o('q1') || pg_temp._o('q2') = 'RECORDED:trueRECORDED:falseRECORDED:false',
  pg_temp._o('q1') || ' ' || pg_temp._o('q2'));
select pg_temp._go('t1', pg_temp._e('k-t-1', '2003', 'subscription_updated', 'active', '2026-10-02T12:00:00Z'));
select pg_temp._go('t2', pg_temp._e('k-t-2', '2003', 'subscription_updated', 'paused', '2026-10-02T12:00:00Z'));
select pg_temp._ck('D02e a TIE on the processor''s time is broken by arrival, deterministically (PROVISIONAL, stated in the contract): the later arrival is the latest, and replaying the earlier one says so',
  pg_temp._o('t1') = 'RECORDED:true' and pg_temp._o('t2') = 'RECORDED:true'
  and public.payment_event_latest_id('lemonsqueezy', true, '2003') = pg_temp._id('t2'),
  pg_temp._o('t2'));
select pg_temp._go('m_test', pg_temp._e('k-m-test', '2003', 'subscription_updated', 'active', '2026-10-02T13:00:00Z', false));
select pg_temp._go('m_stripe', pg_temp._e('k-m-stripe', '2003', 'subscription_updated', 'active', '2026-10-02T14:00:00Z', true, 'stripe'));
select pg_temp._ck('D02f a TEST-MODE event and another PROCESSOR''s event with later times never displace the live event of the same subscription id: each is the latest of its own identity, and the live latest is unchanged',
  pg_temp._o('m_test') = 'RECORDED:true' and pg_temp._o('m_stripe') = 'RECORDED:true'
  and public.payment_event_latest_id('lemonsqueezy', true, '2003') = pg_temp._id('t2')
  and public.payment_event_latest_id('lemonsqueezy', false, '2003') = pg_temp._id('m_test')
  and public.payment_event_latest_id('stripe', true, '2003') = pg_temp._id('m_stripe'),
  null);

-- ---- D03  append-only -----------------------------------------------------------------------------------
create temp table _n3 as select pg_temp._n() as n, pg_temp._fp() as fp;
create temp table _scratch as select * from public.payment_event;
select pg_temp._ck('D03 control: the SAME statements succeed on an unprotected copy of the rows, so the refusals below come from the ledger''s trigger and not from the statement',
  pg_temp._try($$update _scratch set processor_status = 'x'$$) = 'ok' and pg_temp._try($$delete from _scratch$$) = 'ok'
  and (select n from _n3) >= 10,
  (select n::text from _n3));
select pg_temp._ck('D03a an UPDATE is refused even for the table owner, whatever it changes — a status, the processor''s time, the server''s time, or nothing at all',
  pg_temp._try($$update public.payment_event set processor_status = 'cancelled'$$) = 'P0001'
  and pg_temp._try($$update public.payment_event set occurred_at = occurred_at + interval '1 day'$$) = 'P0001'
  and pg_temp._try($$update public.payment_event set recorded_at = recorded_at + interval '1 day'$$) = 'P0001'
  and pg_temp._try($$update public.payment_event set processor = processor$$) = 'P0001',
  pg_temp._try($$update public.payment_event set processor_status = 'cancelled'$$));
select pg_temp._ck('D03b a DELETE is refused, with and without a WHERE clause',
  pg_temp._try($$delete from public.payment_event$$) = 'P0001' and pg_temp._try($$delete from public.payment_event where event_id = 1$$) = 'P0001',
  pg_temp._try($$delete from public.payment_event$$));
select pg_temp._ck('D03c a TRUNCATE is refused, with CASCADE too',
  pg_temp._try($$truncate public.payment_event$$) = 'P0001' and pg_temp._try($$truncate public.payment_event cascade$$) = 'P0001',
  pg_temp._try($$truncate public.payment_event$$));
select pg_temp._ck('D03d after every attempt above the ledger is exactly as it was: the same count and the same fingerprint over every column of every row',
  pg_temp._n() = (select n from _n3) and pg_temp._fp() = (select fp from _n3), pg_temp._fp());

-- ---- D04  lock-down: system-only ----------------------------------------------------------------------------
select pg_temp._ck('D04 anon, authenticated and PUBLIC hold NO privilege on the table (select, insert, update, delete, truncate, references, trigger)',
  not exists (select 1 from unnest(array['anon', 'authenticated']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
               where has_table_privilege(r, 'public.payment_event', p))
  and not exists (select 1 from aclexplode((select relacl from pg_class where oid = 'public.payment_event'::regclass)) a where a.grantee = 0),
  null);
select pg_temp._ck('D04b service_role may only SELECT: it cannot insert (so it cannot choose an id, a mapping or a time), update, delete or truncate',
  has_table_privilege('service_role', 'public.payment_event', 'select')
  and not has_table_privilege('service_role', 'public.payment_event', 'insert')
  and not has_table_privilege('service_role', 'public.payment_event', 'update')
  and not has_table_privilege('service_role', 'public.payment_event', 'delete')
  and not has_table_privilege('service_role', 'public.payment_event', 'truncate'),
  null);
select pg_temp._ck('D04c no API role holds any privilege on the identity sequence behind event_id (the default grant that Supabase makes is undone)',
  not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['usage', 'select', 'update']) p
               where has_sequence_privilege(r, pg_get_serial_sequence('public.payment_event', 'event_id'), p))
  and not exists (select 1 from aclexplode((select relacl from pg_class where oid = pg_get_serial_sequence('public.payment_event', 'event_id')::regclass)) a where a.grantee = 0),
  pg_get_serial_sequence('public.payment_event', 'event_id'));
select pg_temp._ck('D04d EVERY payment_event_ function is locked to service_role: anon, authenticated and PUBLIC cannot execute any of the eight (control: there are eight, so the scan found them)',
  (select count(*) = 8 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'payment\_event\_%')
  and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'payment\_event\_%'
               and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                    or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
                    or not has_function_privilege('service_role', p.oid, 'execute'))),
  (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'payment\_event\_%'));
select pg_temp._ck('D04e control: all three API roles hold USAGE on the schema, so the refusals below come from the objects and not from the schema',
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage') and has_schema_privilege('service_role', 'public', 'usage'),
  null);
create temp table _sr as select pg_temp._as('service_role', format($$select * from public.payment_event_record(%L::jsonb)$$,
  pg_temp._e('k-sr-1', '3001', 'subscription_created', 'active', '2026-10-03T00:00:00Z')::text)) as recorded;
select pg_temp._ck('D04f AS service_role: the recorder works (its definer rights do the insert), the table can be read, a direct insert is refused (42501), and so are update and delete (42501)',
  (select recorded from _sr) = 'ok'
  and pg_temp._as('service_role', 'select count(*) from public.payment_event') = 'ok'
  and pg_temp._as('service_role', $$insert into public.payment_event (processor, idempotency_key, subscription_ref, event_name, occurred_at, livemode) values ('lemonsqueezy', 'k-direct', '3002', 'subscription_created', now(), true)$$) = '42501'
  and pg_temp._as('service_role', $$update public.payment_event set processor_status = 'x'$$) = '42501'
  and pg_temp._as('service_role', $$delete from public.payment_event$$) = '42501'
  and exists (select 1 from public.payment_event where idempotency_key = 'k-sr-1'),
  (select recorded from _sr));
select pg_temp._ck('D04g AS anon and AS authenticated: the recorder is refused, the table cannot be read, and it cannot be written (all 42501)',
  pg_temp._as('anon', format($$select * from public.payment_event_record(%L::jsonb)$$, pg_temp._e('k-anon', '3003', 'subscription_created', 'active', '2026-10-03T00:00:00Z')::text)) = '42501'
  and pg_temp._as('anon', 'select count(*) from public.payment_event') = '42501'
  and pg_temp._as('authenticated', format($$select * from public.payment_event_record(%L::jsonb)$$, pg_temp._e('k-auth', '3004', 'subscription_created', 'active', '2026-10-03T00:00:00Z')::text)) = '42501'
  and pg_temp._as('authenticated', 'select count(*) from public.payment_event') = '42501'
  and pg_temp._as('authenticated', $$insert into public.payment_event (processor, idempotency_key, subscription_ref, event_name, occurred_at, livemode) values ('lemonsqueezy', 'k-direct', '3002', 'subscription_created', now(), true)$$) = '42501'
  and pg_temp._as('anon', $$select public.payment_event_latest_id('lemonsqueezy', true, '1002')$$) = '42501'
  and not exists (select 1 from public.payment_event where idempotency_key in ('k-anon', 'k-auth', 'k-direct')),
  null);

-- ---- D05  row-level security: deny by default --------------------------------------------------------------
select pg_temp._ck('D05 row-level security is ON for the ledger and it carries NO policy (deny by default)',
  (select relrowsecurity from pg_class where oid = 'public.payment_event'::regclass)
  and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'payment_event') = 0,
  null);
-- Even if a grant slipped through, RLS alone must still show an API role nothing. The grant is made and undone inside this function.
create function pg_temp._rls_probe() returns text language plpgsql as $$
declare n bigint;
begin
  grant select on public.payment_event to anon;
  set role anon;
  select count(*) into n from public.payment_event;
  reset role;
  revoke select on public.payment_event from anon;
  return n::text;
exception when others then
  reset role;
  revoke select on public.payment_event from anon;
  return 'error ' || sqlstate;
end $$;
select pg_temp._ck('D05b with SELECT deliberately granted to anon, the ledger STILL returns anon 0 rows (RLS, with no policy, is doing the work), beside a ledger that holds rows',
  pg_temp._rls_probe() = '0' and pg_temp._n() >= 10 and not has_table_privilege('anon', 'public.payment_event', 'select'),
  pg_temp._rls_probe());

-- ---- D06  what can be stored: an exact allow-list ----------------------------------------------------------
select pg_temp._ck('D06 the ledger has EXACTLY these twelve columns — an identity, the processor and its opaque ids, the event name and status words, the mapped status, two times, two catalogue refs and the mode — nothing else can hold a payer, a card or an address',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'payment_event')
  = 'event_id,event_name,idempotency_key,livemode,mapped_status,occurred_at,processor,processor_status,product_ref,recorded_at,subscription_ref,variant_ref',
  (select string_agg(column_name, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'payment_event'));
select pg_temp._ck('D06b no column NAME could hold a person: the screen below matches every sample person-shaped name (control) and none of the ledger''s columns',
  (select bool_and(s ~* '(^|_)(e?mail|first_name|last_name|full_name|payer|customer|buyer|card|cardholder|billing|address|street|phone|ip|user|account|owner|client|label|lat|lng|payload|body|raw)($|_)')
     from unnest(array['user_email', 'customer_email', 'card_last_four', 'billing_address', 'full_name', 'payer_name', 'phone', 'customer_ref', 'payload', 'raw_body', 'ip_address', 'user_id']) s)
  and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_event'
                   and column_name ~* '(^|_)(e?mail|first_name|last_name|full_name|payer|customer|buyer|card|cardholder|billing|address|street|phone|ip|user|account|owner|client|label|lat|lng|payload|body|raw)($|_)'),
  null);
select pg_temp._ck('D06c the recorder''s allow-list is exactly the nine keys that become columns (the identity, the mapped status and the server time are not keys)',
  (select string_agg(k, ',' order by k collate "C") from unnest(public.payment_event_allowed_keys()) k)
  = 'event_name,idempotency_key,livemode,occurred_at,processor,processor_status,product_ref,subscription_ref,variant_ref',
  null);
-- every stray key, each added to an otherwise valid event
create temp table _stray (k text);
insert into _stray values ('user_email'), ('customer_email'), ('email'), ('name'), ('user_name'), ('card_brand'), ('card_last_four'),
  ('billing_address'), ('address'), ('customer_id'), ('payload'), ('urls'), ('test_mode'), ('status'), ('order_id'), ('user_id'),
  ('mapped_status'), ('event_id'), ('recorded_at'), ('attributes'), ('meta');
create temp table _n6 as select pg_temp._n() as n;
select pg_temp._ck('D06d control: the SAME valid event with no stray key is RECORDED, so each refusal below is about the key and nothing else',
  (select pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, pg_temp._e('k-clean', '4001', 'subscription_created', 'active', '2026-10-04T00:00:00Z')::text))) = 'ok'
  and pg_temp._n() = (select n from _n6) + 1,
  null);
select pg_temp._ck('D06e EVERY key outside the allow-list is REFUSED (22023) and nothing is written — 21 stray keys, among them an email, a name, a card brand, a billing address, a customer id, the whole payload, and the keys the database owns (mapped_status, event_id, recorded_at)',
  (select count(*) = 21 and bool_and(pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$,
        (pg_temp._e('k-stray-' || k, '4002', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || jsonb_build_object(k, 'x'))::text)) = '22023')
     from _stray)
  and pg_temp._n() = (select n from _n6) + 1,
  (select string_agg(k, ',') from _stray where pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$,
        (pg_temp._e('k-stray-' || k, '4002', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || jsonb_build_object(k, 'x'))::text)) <> '22023'));
select pg_temp._ck('D06f the message names the unknown FIELD and never repeats a value',
  pg_temp._msg(format($$select * from public.payment_event_record(%L::jsonb)$$,
     (pg_temp._e('k-msg', '4003', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || '{"user_email":"payer@example.com"}'::jsonb)::text)) like '%user_email%'
  and pg_temp._msg(format($$select * from public.payment_event_record(%L::jsonb)$$,
     (pg_temp._e('k-msg', '4003', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || '{"user_email":"payer@example.com"}'::jsonb)::text)) not like '%payer@example.com%',
  pg_temp._msg(format($$select * from public.payment_event_record(%L::jsonb)$$,
     (pg_temp._e('k-msg', '4003', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || '{"user_email":"payer@example.com"}'::jsonb)::text)));
-- a person-shaped VALUE in an allowed field cannot fit an opaque token
create temp table _fields (k text);
insert into _fields values ('idempotency_key'), ('subscription_ref'), ('event_name'), ('processor_status'), ('product_ref'), ('variant_ref');
select pg_temp._ck('D06g an email address, a name with a space, and an over-long value are each REFUSED (22023) in EVERY opaque field (6 fields x 3 values), nothing is written, and the message never repeats the value',
  (select count(*) = 18 and bool_and(pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$,
        (pg_temp._e('k-pii', '4004', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || jsonb_build_object(f.k, v.v))::text)) = '22023'
      and coalesce(pg_temp._msg(format($$select * from public.payment_event_record(%L::jsonb)$$,
        (pg_temp._e('k-pii', '4004', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || jsonb_build_object(f.k, v.v))::text)), '') not like '%' || v.v || '%')
     from _fields f, (values ('payer@example.com'), ('Jane Smith'), (repeat('a', 201))) v (v))
  and pg_temp._n() = (select n from _n6) + 1,
  null);
select pg_temp._ck('D06h the control for D06g: a 200-character value and a value with every allowed punctuation character ARE accepted, so the refusals are about the shape and not about length alone',
  pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-' || repeat('a', 198), '4005', 'subscription_created', 'active', '2026-10-04T00:00:00Z'))::text)) = 'ok'
  and pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k.4:0|0=6+x/y-z', '4006', 'subscription_created', 'active', '2026-10-04T00:00:00Z'))::text)) = 'ok',
  null);
select pg_temp._ck('D06i an event that is not a JSON OBJECT (an array, a string, a number, a null, an SQL NULL) is refused (22023)',
  pg_temp._try($$select * from public.payment_event_record('[]'::jsonb)$$) = '22023'
  and pg_temp._try($$select * from public.payment_event_record('"x"'::jsonb)$$) = '22023'
  and pg_temp._try($$select * from public.payment_event_record('7'::jsonb)$$) = '22023'
  and pg_temp._try($$select * from public.payment_event_record('null'::jsonb)$$) = '22023'
  and pg_temp._try($$select * from public.payment_event_record(null)$$) = '22023',
  null);
select pg_temp._ck('D06j every REQUIRED key, when absent or JSON null, is refused (22023): processor, idempotency_key, subscription_ref, event_name, occurred_at, livemode',
  (select bool_and(pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-req', '4007', 'subscription_created', 'active', '2026-10-04T00:00:00Z') - k)::text)) = '22023'
             and pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-req', '4007', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || jsonb_build_object(k, null))::text)) = '22023')
     from unnest(array['processor', 'idempotency_key', 'subscription_ref', 'event_name', 'occurred_at', 'livemode']) k),
  null);
select pg_temp._ck('D06k a wrong TYPE is refused (22023): a number for an id, an object for a status, a string for the mode, a number for the time',
  pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-ty', '4008', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || '{"subscription_ref":4008}'::jsonb)::text)) = '22023'
  and pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-ty', '4008', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || '{"processor_status":{"a":1}}'::jsonb)::text)) = '22023'
  and pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-ty', '4008', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || '{"livemode":"true"}'::jsonb)::text)) = '22023'
  and pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-ty', '4008', 'subscription_created', 'active', '2026-10-04T00:00:00Z') || '{"occurred_at":1790000000}'::jsonb)::text)) = '22023',
  null);
select pg_temp._go('ts_frac', pg_temp._e('k-ts-1', '4010', 'subscription_created', 'active', '2026-10-04T00:00:00.123456Z'));
select pg_temp._go('ts_offset', pg_temp._e('k-ts-2', '4011', 'subscription_created', 'active', '2026-10-04T02:00:00+02:00'));
select pg_temp._ck('D06l the processor''s time must carry an EXPLICIT OFFSET and be a real instant: no offset, a date only, a bad month, an impossible day, "infinity", a trailing word and an empty string are each refused (22023)',
  (select count(*) = 7 and bool_and(pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-ts', '4009', 'subscription_created', 'active', v))::text)) = '22023')
     from unnest(array['2026-10-04T00:00:00', '2026-10-04', '2026-13-04T00:00:00Z', 'infinity', '2026-10-04T00:00:00Z later', '2026-02-30T00:00:00Z', '']) v),
  null);
select pg_temp._ck('D06l2 control for D06l: the fractional-second form is accepted, and a timestamp written with a +02:00 offset is stored as the same INSTANT in UTC (02:00+02:00 is 00:00Z)',
  pg_temp._o('ts_frac') = 'RECORDED:true' and pg_temp._o('ts_offset') = 'RECORDED:true'
  and (select occurred_at from public.payment_event where idempotency_key = 'k-ts-1') = '2026-10-04T00:00:00.123456Z'::timestamptz
  and (select occurred_at from public.payment_event where idempotency_key = 'k-ts-2') = '2026-10-04T00:00:00Z'::timestamptz,
  null);
select pg_temp._ck('D06m the processor name must be lower-case letters, digits and underscores, 2 to 32, starting with a letter: "LemonSqueezy", "x", "a b", "1x" are refused (22023)',
  (select bool_and(pg_temp._try(format($$select * from public.payment_event_record(%L::jsonb)$$, (pg_temp._e('k-pr', '4012', 'subscription_created', 'active', '2026-10-04T00:00:00Z', true, p))::text)) = '22023')
     from unnest(array['LemonSqueezy', 'x', 'a b', '1x', 'a@b']) p),
  null);
-- the table is a second line of defence behind the recorder: a direct INSERT by the owner meets the same shapes
select pg_temp._ck('D06n the table itself refuses the same shapes when the recorder is bypassed (a direct insert by the owner): an email-shaped key (23514 payment_event_key_opaque), a bad processor (23514), and a caller-chosen mapped_status (428C9, a generated column)',
  pg_temp._try($$insert into public.payment_event (processor, idempotency_key, subscription_ref, event_name, occurred_at, livemode) values ('lemonsqueezy', 'a@b.c', '4013', 'subscription_created', now(), true)$$) = '23514:payment_event_key_opaque'
  and pg_temp._try($$insert into public.payment_event (processor, idempotency_key, subscription_ref, event_name, occurred_at, livemode) values ('Not Lower', 'k-direct-2', '4013', 'subscription_created', now(), true)$$) = '23514:payment_event_processor_named'
  and pg_temp._try($$insert into public.payment_event (processor, idempotency_key, subscription_ref, event_name, occurred_at, livemode, mapped_status) values ('lemonsqueezy', 'k-direct-3', '4013', 'subscription_created', now(), true, 'active')$$) = '428C9',
  null);

-- ---- D07  a status the mapping does not know is 'unknown', never 'active' -------------------------------------
create temp table _map (n int, word text, expected text);
insert into _map values (1, 'on_trial', 'trialing'), (2, 'active', 'active'), (3, 'paused', 'paused'), (4, 'past_due', 'past_due'),
  (5, 'unpaid', 'unpaid'), (6, 'cancelled', 'canceled'), (7, 'expired', 'canceled'),
  (8, 'weird_new_status', 'unknown'), (9, 'ACTIVE', 'unknown'), (10, 'Active', 'unknown'), (11, 'cancelled_by_merchant', 'unknown'), (12, 'canceled', 'unknown'), (13, 'trialing', 'unknown');
select pg_temp._go('s' || n, pg_temp._e('k-map-' || n, '5' || lpad(n::text, 3, '0'), 'subscription_updated', word, '2026-10-05T00:00:00Z')) from _map;
select pg_temp._go('s_null', pg_temp._e('k-map-null', '5100', 'subscription_updated', null, '2026-10-05T00:00:00Z'));
select pg_temp._go('s_jsonnull', (pg_temp._e('k-map-jn', '5101', 'subscription_updated', 'active', '2026-10-05T00:00:00Z') || '{"processor_status":null}'::jsonb));
select pg_temp._go('s_stripe', pg_temp._e('k-map-stripe', '5102', 'subscription_updated', 'active', '2026-10-05T00:00:00Z', true, 'stripe'));
select pg_temp._ck('D07 the SEVEN statuses the deployed webhook maps keep the same mapping (on_trial to trialing, active, paused, past_due, unpaid, cancelled to canceled, expired to canceled) and the processor''s own word is stored verbatim beside it',
  (select count(*) = 7 and bool_and(e.mapped_status = m.expected and e.processor_status = m.word)
     from _map m join public.payment_event e on e.idempotency_key = 'k-map-' || m.n where m.n <= 7),
  null);
select pg_temp._ck('D07b a status the map does NOT know is stored as ''unknown'', never ''active'': another word, the wrong case, a near miss, "canceled" spelled the way WE spell it, and "trialing" (6 words), and the original word is still stored',
  (select count(*) = 6 and bool_and(e.mapped_status = 'unknown' and e.processor_status = m.word)
     from _map m join public.payment_event e on e.idempotency_key = 'k-map-' || m.n where m.n > 7),
  null);
select pg_temp._ck('D07c an ABSENT status and a JSON-null status are stored as ''unknown'' with no status word, and a status from a processor the map has no branch for (stripe) is ''unknown'' too, even when it says "active"',
  (select mapped_status = 'unknown' and processor_status is null from public.payment_event where idempotency_key = 'k-map-null')
  and (select mapped_status = 'unknown' and processor_status is null from public.payment_event where idempotency_key = 'k-map-jn')
  and (select mapped_status = 'unknown' and processor_status = 'active' from public.payment_event where idempotency_key = 'k-map-stripe'),
  null);
select pg_temp._ck('D07d THE PROPERTY, over every row stored: nothing is mapped ''active'' except Lemon Squeezy''s own word "active" — beside a control that some rows ARE mapped active, and that rows of every other mapped value exist',
  not exists (select 1 from public.payment_event where mapped_status = 'active' and not (processor = 'lemonsqueezy' and processor_status = 'active'))
  and (select count(*) from public.payment_event where mapped_status = 'active') >= 3
  and (select count(distinct mapped_status) from public.payment_event) = 7,
  (select string_agg(distinct mapped_status, ',') from public.payment_event));
select pg_temp._ck('D07e the mapping function itself, asked directly: an unknown word, a NULL status and a NULL processor are all ''unknown''',
  public.payment_event_map_status('lemonsqueezy', 'something_else') = 'unknown'
  and public.payment_event_map_status('lemonsqueezy', null) = 'unknown'
  and public.payment_event_map_status(null, 'active') = 'unknown'
  and public.payment_event_map_status('lemonsqueezy', 'active') = 'active',
  null);

-- ---- D08  definer rights, pinned search path ------------------------------------------------------------------
select pg_temp._ck('D08 the recorder is SECURITY DEFINER with a pinned search_path (public, pg_temp), and so is EVERY other definer function in the ledger (control: there is at least the recorder)',
  (select count(*) = 1 and bool_and(p.prosecdef and coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'])
     from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'payment_event_record')
  and (select count(*) >= 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'payment\_event\_%' and p.prosecdef)
  and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'payment\_event\_%' and p.prosecdef
                   and not (coalesce(p.proconfig, '{}') @> array['search_path=public, pg_temp'])),
  null);
select pg_temp._ck('D08b there is exactly ONE writer, it takes ONE argument (a json object — no id, no time, no status, no mapped value to choose), and it returns the four things it promises',
  (select count(*) = 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'payment_event_record')
  and (select pronargs = 1 and pg_get_function_arguments(p.oid) = 'p_event jsonb' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'payment_event_record')
  and (select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'payment_event_record')
        = 'TABLE(outcome text, event_id bigint, is_latest boolean, recorded_at timestamp with time zone)',
  (select pg_get_function_result(p.oid) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'payment_event_record'));

-- ---- D09  entitlement-free: the ledger touches nothing else ------------------------------------------------
select pg_temp._ck('D09 after every event above the stand-in subscriptions table still holds 0 rows and the TRAP never fired — the ledger recorded dozens of events (control) without writing to, or reading, any entitlement-shaped table',
  (select count(*) from public.subscriptions) = 0 and pg_temp._n() >= 35,
  pg_temp._n()::text);
select pg_temp._ck('D09b the compiled source of every payment_event_ function names no subscriptions, entitlement, evaluation, credit, quota, brokerage or account table — control: the scan reads the recorder''s real source (it names the ledger) and a planted word is caught',
  (select count(*) = 8 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'payment\_event\_%')
  and (select bool_or(p.prosrc ~ 'payment_event') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'payment_event_record')
  and ('select 1 from public.subscriptions' ~* '(subscriptions|entitle|evaluation|credit|quota|brokerage|account)')
  and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'payment\_event\_%'
                   and regexp_replace(p.prosrc, '''[^'']*''', '''''', 'g') ~* '(subscriptions|entitle|evaluation|credit|quota|brokerage|account)'),
  null);
select pg_temp._ck('D09c the ledger has NO foreign key in either direction and nothing depends on it (no view, no other table) — control: it does carry its own constraints',
  (select count(*) = 0 from pg_constraint where contype = 'f' and (conrelid = 'public.payment_event'::regclass or confrelid = 'public.payment_event'::regclass))
  and (select count(*) >= 10 from pg_constraint where conrelid = 'public.payment_event'::regclass)
  and (select count(*) = 0 from pg_depend d join pg_rewrite w on w.oid = d.objid where d.refobjid = 'public.payment_event'::regclass and d.classid = 'pg_rewrite'::regclass),
  (select count(*)::text from pg_constraint where conrelid = 'public.payment_event'::regclass));
select pg_temp._ck('D09d exactly two triggers sit on the ledger — the row-level refusal of update and delete, and the statement-level refusal of truncate',
  (select string_agg(tgname, ',' order by tgname collate "C") from pg_trigger where tgrelid = 'public.payment_event'::regclass and not tgisinternal)
  = 'payment_event_no_truncate,payment_event_no_update_delete',
  null);

select pg_temp._ck('S01 every event the suite set up was either recorded or refused by the recorder itself — none ended in an error the suite did not expect (a regression is reported here instead of ending the run)',
  not exists (select 1 from _ev where err is not null and err not like '22023%' and err not like '23505%')
  and (select count(*) from _ev where outcome is not null) >= 30,
  (select string_agg(name || '=' || err, '; ') from _ev where err is not null and err not like '22023%' and err not like '23505%'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
