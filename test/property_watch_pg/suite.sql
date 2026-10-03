-- =====================================================================================
-- PROPERTY WATCH — EXECUTABLE ADVERSARIAL SUITE  (docs/property-watch.sql)
--
-- Development Activity build step 9: an agent watches the property of one of its brokerage's stored reports; a daily system job checks it and
-- emails the agent when a development record near it has a material change. This suite stands on the REAL account spine, private-context layer,
-- snapshot writer, evaluation entitlement and saved-reports functions, all applied unmutated. It proves the posture (system-only, RLS on, the
-- tables writable only through the functions), ownership (one watch per agent and report, another agent's or brokerage's watch is invisible),
-- standing (the SAME check that opens a saved report), the per-brokerage limit, the watch and its follow need written together and removed
-- together by EVERY path (stop, end, a direct delete, a deleted user), the job's lease, the fixed daily slot, the back-off that never moves it,
-- what an email told the agent and when that is forgotten, the audit, and that nothing private is stored or changed.
-- What only two real sessions can prove (the last place under the limit, and READ COMMITTED) is in run.sh.
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

-- run a statement; 'ok', or SQLSTATE: message
create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
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

-- Setup steps go through this wrapper so a REGRESSION in the code under test becomes a FAILED CHECK, not a crash that ends the suite
-- before the checks that would have named it. S01 (last) fails if any step raised.
create temp table _setup (n serial, step text, result text);
create function pg_temp._run(p_step text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into _setup (step, result) values (p_step, 'ok');
exception when others then
  insert into _setup (step, result) values (p_step, sqlstate || ': ' || sqlerrm);
end $$;

alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- ---- fixtures ------------------------------------------------------------------------------------
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;

-- the private contexts an agent typed: the values the layer keeps and the watch layer must never hold
create temp table _pv (name text primary key, j jsonb);
insert into _pv values
  ('p0', '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST","latitude":40.712980288068,"longitude":-74.003758107366,"property_keys":["nyc:1001387","1001387"],"label":"Acme Realty Smith listing"}'),
  ('p1', '{"address":"22 Birch Lane, Brigham City, UT 84302","normalized_address":"22 BIRCH LN","latitude":41.5102,"longitude":-112.0155,"property_keys":["ut:22birch"],"label":"Jones buyers"}'),
  ('p2', '{"address":"300 Harbor Way, Tampa, FL 33602","normalized_address":"300 HARBOR WAY","latitude":27.9506,"longitude":-82.4572}'),
  ('p3', '{"address":"9 Cedar Court, Austin, TX 78701","normalized_address":"9 CEDAR CT","latitude":30.2672,"longitude":-97.7431}'),
  ('p4', '{"address":"77 Gamma Road, Denver, CO 80202","normalized_address":"77 GAMMA RD","latitude":39.7392,"longitude":-104.9903}'),
  ('p5', '{"address":"5 Delta Drive, Phoenix, AZ 85001","normalized_address":"5 DELTA DR","latitude":33.4484,"longitude":-112.074}'),
  ('p6', '{"address":"8 Echo Street, Boise, ID 83702","normalized_address":"8 ECHO ST","latitude":43.615,"longitude":-116.2023}');

create temp table _e (label text primary key, evaluation_id uuid, brokerage_id uuid, invite_id uuid, token text);
create function pg_temp._mk(p_label text, p_name text) returns void language plpgsql as $$
begin
  insert into _e select p_label, c.evaluation_id, c.brokerage_id, c.invite_id, c.owner_token from public.evaluation_create(p_name) c;
end $$;
create function pg_temp._ev(p_label text) returns uuid language sql as $$ select evaluation_id from _e where label = p_label $$;
create function pg_temp._bk(p_label text) returns uuid language sql as $$ select brokerage_id from _e where label = p_label $$;
create function pg_temp._own(p_label text, p_user int) returns void language plpgsql as $$
begin
  perform 1 from public.evaluation_invite_redeem((select token from _e where label = p_label), pg_temp._u(p_user));
end $$;
create function pg_temp._agent(p_label text, p_user int) returns void language plpgsql as $$
declare t text;
begin
  select m.token into t from public.evaluation_invite_mint(pg_temp._ev(p_label), 'agent') m;
  perform 1 from public.evaluation_invite_redeem(t, pg_temp._u(p_user));
end $$;

-- reports by label, stored through the real issue function (the credit ledger row is what says whose a report is)
create temp table _i (label text primary key, report_id uuid, ctx uuid, err text);
create function pg_temp._iss(p_label text, p_u int, p_k int, p_priv jsonb default null) returns void language plpgsql as $$
declare r record; b text := format('{"product":"HomeSignal Development Activity","n":%s}', p_k);
begin
  select * into r from public.evaluation_report_issue(pg_temp._u(p_u), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, p_priv);
  insert into _i values (p_label, r.report_id, r.private_context_id, null);
exception when others then
  insert into _i (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._rp(p_label text) returns uuid language sql as $$ select report_id from _i where label = p_label $$;
create function pg_temp._cx(p_label text) returns uuid language sql as $$ select ctx from _i where label = p_label $$;

-- a stored report that belongs to NO brokerage's ledger (written straight through the snapshot writer)
create temp table _direct (report_id uuid primary key);
create function pg_temp._snap(p_n int, p_priv jsonb default null) returns uuid language plpgsql as $$
declare v_id uuid; b text := format('{"direct":%s}', p_n);
begin
  select s.report_id into v_id from public.report_snapshot_issue(b, pg_temp._h(b), 'engine-v1', '{}'::jsonb, p_priv) s;
  insert into _direct values (v_id) on conflict do nothing;
  return v_id;
end $$;

-- the outcome of a start call, by label
create temp table _w (label text primary key, watch_id uuid, started boolean, err text);
create function pg_temp._st(p_label text, p_user uuid, p_report uuid) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.evaluation_property_watch_start(p_user, p_report);
  insert into _w values (p_label, r.watch_id, r.started, null);
exception when others then
  insert into _w (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._wid(p_label text) returns uuid language sql as $$ select watch_id from _w where label = p_label $$;
create function pg_temp._werr(p_label text) returns text language sql as $$ select err from _w where label = p_label $$;

-- how many follow needs are OPEN on a context for a ref
create function pg_temp._open_follow(p_ctx uuid, p_ref text) returns integer language sql as $$
  select count(*)::int from public.report_private_context_need where context_id = p_ctx and kind = 'follow' and ref = p_ref and closed_at is null $$;
create function pg_temp._open_any(p_ctx uuid) returns integer language sql as $$
  select count(*)::int from public.report_private_context_need where context_id = p_ctx and closed_at is null $$;

-- a digest of every stored snapshot, which the watch layer must never change
create function pg_temp._untouched() returns text language sql as $$
  select md5(coalesce((select string_agg(row_to_json(s)::text, ',' order by s.report_id) from public.report_snapshot s where s.report_id not in (select report_id from _direct)), ''))
$$;

-- ---- setup: nine people, seven brokerages -----------------------------------------------------------
select pg_temp._run('users', $$insert into auth.users (id, email, raw_user_meta_data)
  select pg_temp._u(g), 'person' || g || '@example.test', jsonb_build_object('full_name', 'Person Number ' || g) from generate_series(1, 12) g$$);
select pg_temp._run('mk alpha', $$select pg_temp._mk('alpha', 'Acme Realty')$$);
select pg_temp._run('mk beta',  $$select pg_temp._mk('beta', 'Birch Homes')$$);
select pg_temp._run('mk gamma', $$select pg_temp._mk('gamma', 'Gamma Group')$$);
select pg_temp._run('mk delta', $$select pg_temp._mk('delta', 'Delta Estates')$$);
select pg_temp._run('mk echo',  $$select pg_temp._mk('echo', 'Echo Estates')$$);
select pg_temp._run('mk fox',   $$select pg_temp._mk('fox', 'Fox Company')$$);
select pg_temp._run('mk hotel', $$select pg_temp._mk('hotel', 'Hotel Group')$$);
select pg_temp._run('own alpha', $$select pg_temp._own('alpha', 1)$$);
select pg_temp._run('agent alpha', $$select pg_temp._agent('alpha', 2)$$);
select pg_temp._run('own beta',  $$select pg_temp._own('beta', 3)$$);
select pg_temp._run('own gamma', $$select pg_temp._own('gamma', 5)$$);
select pg_temp._run('own delta', $$select pg_temp._own('delta', 6)$$);
select pg_temp._run('own echo',  $$select pg_temp._own('echo', 7)$$);
select pg_temp._run('own fox',   $$select pg_temp._own('fox', 8)$$);
select pg_temp._run('agent fox', $$select pg_temp._agent('fox', 9)$$);
select pg_temp._run('own hotel', $$select pg_temp._own('hotel', 10)$$);
select pg_temp._run('agent hotel', $$select pg_temp._agent('hotel', 11)$$);
-- person 4 belongs to no brokerage at all

select pg_temp._run('issue alpha', $x$do $d$ begin
  perform pg_temp._iss('a1', 1, 1, (select j from _pv where name = 'p0'));
  perform pg_temp._iss('a2', 2, 2, (select j from _pv where name = 'p1'));
  perform pg_temp._iss('a3', 1, 3);                                                -- no private context at all
  perform pg_temp._iss('a4', 1, 4, (select j from _pv where name = 'p2'));         -- the one whose context is purged
  perform pg_temp._iss('b1', 3, 5, (select j from _pv where name = 'p3'));
  perform pg_temp._iss('g1', 5, 6, (select j from _pv where name = 'p4'));
  perform pg_temp._iss('d1', 6, 7, (select j from _pv where name = 'p5'));
  perform pg_temp._iss('e1', 7, 8, (select j from _pv where name = 'p6'));
end $d$$x$);
select pg_temp._run('issue hotel', $x$do $d$ begin
  perform pg_temp._iss('h1', 10, 201, '{"address":"1 Hotel Row, Reno, NV 89501","latitude":39.5296,"longitude":-119.8138}');
  perform pg_temp._iss('h2', 10, 202, '{"address":"2 Hotel Row, Reno, NV 89501","latitude":39.5297,"longitude":-119.8139}');
  perform pg_temp._iss('h3', 11, 203, '{"address":"3 Hotel Row, Reno, NV 89501","latitude":39.5298,"longitude":-119.8140}');
  perform pg_temp._iss('h4', 11, 204, '{"address":"4 Hotel Row, Reno, NV 89501","latitude":39.5299,"longitude":-119.8141}');
  perform pg_temp._iss('h5', 10, 205);   -- a report with NO private context, in the same brokerage
end $d$$x$);
select pg_temp._run('issue fox', $x$do $d$ begin for n in 1..20 loop
  perform pg_temp._iss('f' || n, 8, 100 + n, jsonb_build_object('address', n || ' Fox Road, Boise, ID 83702', 'latitude', 43.6 + n / 1000.0, 'longitude', -116.2));
end loop; end $d$$x$);

create temp table _base (untouched text);
insert into _base select pg_temp._untouched();
-- every private context's VALUES, one hash per context: a context may be purged (by this suite, on purpose) but one that is still active must not have changed
create function pg_temp._ctxhash(c public.report_private_context) returns text language sql as $$
  select md5(concat_ws('~', c.context_id, c.state, c.address, c.normalized_address, c.latitude, c.longitude, c.property_keys, c.label)) $$;
create temp table _basectx as select c.context_id, pg_temp._ctxhash(c) as h from public.report_private_context c;

-- ---- Z  what the apply left behind --------------------------------------------------------------------
select pg_temp._ck('Z01 the apply stored no watch and no told-about row: the file seeds nothing (the zero is real: both tables exist and the owner can read them)',
  to_regclass('public.property_watch') is not null and to_regclass('public.property_watch_seen') is not null
  and (select count(*) from public.property_watch) = 0 and (select count(*) from public.property_watch_seen) = 0, null);
select pg_temp._ck('Z02 the two tables are exactly the planned ones: no column for an address, a label, a client, a coordinate, an email or a person''s name in either',
  (select string_agg(relname, ',' order by relname collate "C") from pg_class where relnamespace = 'public'::regnamespace and relname like 'property\_watch%' and relkind = 'r')
    = 'property_watch,property_watch_seen'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'property_watch')
    = 'created_at:timestamp with time zone,failure_count:integer,last_outcome:text,last_run_at:timestamp with time zone,lease_until:timestamp with time zone,next_due_at:timestamp with time zone,report_id:uuid,retry_after:timestamp with time zone,user_id:uuid,watch_id:uuid'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'property_watch_seen')
    = 'event_type:text,notified_at:timestamp with time zone,observed_at:timestamp with time zone,project_id:text,watch_id:uuid',
  (select string_agg(table_name || '.' || column_name, ',' order by table_name collate "C", column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name like 'property\_watch%'));
select pg_temp._ck('Z03 the watch layer is exactly sixteen functions: five constants, the three an agent uses, the four the job uses, the audit, and the three trigger functions — nothing else carries either prefix',
  (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'property\_watch%' or proname like 'evaluation\_property\_watch%'))
    = 'evaluation_property_watch_start,evaluation_property_watch_stop,evaluation_property_watches_of,property_watch_claim,property_watch_close_need,property_watch_end,property_watch_guard,property_watch_integrity,property_watch_lease,property_watch_limit,property_watch_no_truncate,property_watch_period,property_watch_record_failure,property_watch_record_run,property_watch_retry,property_watch_seen_keep',
  (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'property\_watch%' or proname like 'evaluation\_property\_watch%')));
select pg_temp._ck('Z04 the numbers are written once and are the planned ones: a check every 1 day (the founder''s daily), at most 25 watches per brokerage, a back-off unit of 1 hour, a lease of 10 minutes, told-about rows kept 100 days',
  public.property_watch_period() = interval '1 day' and public.property_watch_limit() = 25 and public.property_watch_retry() = interval '1 hour'
  and public.property_watch_lease() = interval '10 minutes' and public.property_watch_seen_keep() = interval '100 days',
  public.property_watch_period()::text || ' / ' || public.property_watch_limit()::text || ' / ' || public.property_watch_retry()::text || ' / ' || public.property_watch_lease()::text || ' / ' || public.property_watch_seen_keep()::text);

select pg_temp._ck('Z06 the keys that make the rest true exist: ONE watch per (agent, report) is a database constraint (not only a check in the function), the told-about rows go with their watch (cascade), a deleted USER takes their watches (cascade), and a stored report can never be deleted out from under a watch (no cascade on the report)',
  exists (select 1 from pg_constraint where conrelid = 'public.property_watch'::regclass and contype = 'u'
           and (select array_agg(a.attname::text order by a.attname) from pg_attribute a where a.attrelid = conrelid and a.attnum = any (conkey)) = array['report_id', 'user_id'])
  and (select confdeltype = 'c' from pg_constraint where conrelid = 'public.property_watch_seen'::regclass and contype = 'f')
  and (select confdeltype = 'c' from pg_constraint where conrelid = 'public.property_watch'::regclass and contype = 'f' and confrelid = 'auth.users'::regclass)
  and (select confdeltype = 'a' from pg_constraint where conrelid = 'public.property_watch'::regclass and contype = 'f' and confrelid = 'public.report_snapshot'::regclass),
  null);

-- ---- P  the posture: system-only ------------------------------------------------------------------------
select pg_temp._ck('P01 every function of the layer is executable by service_role and by no other role: not anon, not authenticated, not PUBLIC (asked of the privilege catalog, not of the file); the three trigger functions by nobody but their owner',
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0)
                   and (has_function_privilege('service_role', p.oid, 'execute') = (p.proname not in ('property_watch_guard', 'property_watch_close_need', 'property_watch_no_truncate'))))
     from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'property\_watch%' or p.proname like 'evaluation\_property\_watch%')),
  null);
select pg_temp._ck('P02 and CALLED as those roles they are refused (42501): anon and authenticated can neither start, list, stop, claim, record, end nor audit',
  pg_temp._as('anon', format($$select * from public.evaluation_property_watch_start(%L, %L)$$, pg_temp._u(1), pg_temp._rp('a1'))) = '42501'
  and pg_temp._as('authenticated', format($$select * from public.evaluation_property_watch_start(%L, %L)$$, pg_temp._u(1), pg_temp._rp('a1'))) = '42501'
  and pg_temp._as('authenticated', format($$select * from public.evaluation_property_watches_of(%L)$$, pg_temp._u(1))) = '42501'
  and pg_temp._as('authenticated', format($$select public.evaluation_property_watch_stop(%L, %L)$$, pg_temp._u(1), pg_temp._k(1))) = '42501'
  and pg_temp._as('anon', 'select * from public.property_watch_claim(10)') = '42501'
  and pg_temp._as('authenticated', format($$select public.property_watch_record_run(%L, 'CHECKED', null)$$, pg_temp._k(1))) = '42501'
  and pg_temp._as('authenticated', format($$select public.property_watch_record_failure(%L, 'READ_FAILED')$$, pg_temp._k(1))) = '42501'
  and pg_temp._as('anon', format($$select public.property_watch_end(%L, 'STANDING_LOST')$$, pg_temp._k(1))) = '42501'
  and pg_temp._as('anon', 'select * from public.property_watch_integrity()') = '42501'
  and pg_temp._as('anon', 'select public.property_watch_period()') = '42501',
  null);
select pg_temp._ck('P03 the tables: row level security is ON in both, and anon, authenticated and PUBLIC hold no privilege on either; service_role may SELECT and cannot INSERT, UPDATE, DELETE or TRUNCATE (every write goes through a function)',
  (select bool_and(c.relrowsecurity) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('property_watch', 'property_watch_seen'))
  and (select bool_and(not has_table_privilege(r, c.oid, p)) from pg_class c, unnest(array['anon', 'authenticated']) r,
        unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p
       where c.relnamespace = 'public'::regnamespace and c.relname in ('property_watch', 'property_watch_seen'))
  and (select bool_and(has_table_privilege('service_role', c.oid, 'select') and not has_table_privilege('service_role', c.oid, 'insert') and not has_table_privilege('service_role', c.oid, 'update')
                       and not has_table_privilege('service_role', c.oid, 'delete') and not has_table_privilege('service_role', c.oid, 'truncate'))
         from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('property_watch', 'property_watch_seen'))
  and not exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
                   where c.relnamespace = 'public'::regnamespace and c.relname in ('property_watch', 'property_watch_seen') and a.grantee = 0),
  null);
select pg_temp._ck('P04 the volatility and the definer are the planned ones: the list, the audit and the four constants-that-are-read are STABLE or IMMUTABLE; the writers are volatile; every function that touches a table is SECURITY DEFINER',
  (select string_agg(proname || ':' || provolatile::text || ':' || prosecdef::text, ',' order by proname collate "C") from pg_proc
    where pronamespace = 'public'::regnamespace and (proname like 'property\_watch%' or proname like 'evaluation\_property\_watch%'))
   = 'evaluation_property_watch_start:v:true,evaluation_property_watch_stop:v:true,evaluation_property_watches_of:s:true,property_watch_claim:v:true,property_watch_close_need:v:true,property_watch_end:v:true,property_watch_guard:v:false,property_watch_integrity:s:true,property_watch_lease:i:false,property_watch_limit:i:false,property_watch_no_truncate:v:false,property_watch_period:i:false,property_watch_record_failure:v:true,property_watch_record_run:v:true,property_watch_retry:i:false,property_watch_seen_keep:i:false',
  (select string_agg(proname || ':' || provolatile::text || ':' || prosecdef::text, ',' order by proname collate "C") from pg_proc
    where pronamespace = 'public'::regnamespace and (proname like 'property\_watch%' or proname like 'evaluation\_property\_watch%')));
select pg_temp._ck('P05 the shapes are exactly the planned ones: start takes (user, report) and returns (watch, created, started); the list returns nine columns and no address, label, coordinate or email; claim returns three',
  pg_get_function_arguments('public.evaluation_property_watch_start(uuid, uuid)'::regprocedure) = 'p_user_id uuid, p_report_id uuid'
  and pg_get_function_result('public.evaluation_property_watch_start(uuid, uuid)'::regprocedure) = 'TABLE(watch_id uuid, created_at timestamp with time zone, started boolean)'
  and pg_get_function_result('public.evaluation_property_watches_of(uuid)'::regprocedure)
        = 'TABLE(watch_id uuid, report_id uuid, number integer, generated_at timestamp with time zone, private_context_id uuid, created_at timestamp with time zone, last_run_at timestamp with time zone, last_outcome text, next_due_at timestamp with time zone)'
  and pg_get_function_result('public.property_watch_claim(integer)'::regprocedure) = 'TABLE(watch_id uuid, report_id uuid, user_id uuid)'
  and pg_get_function_arguments('public.property_watch_record_run(uuid, text, jsonb)'::regprocedure) = 'p_watch uuid, p_outcome text, p_seen jsonb',
  pg_get_function_result('public.evaluation_property_watches_of(uuid)'::regprocedure));

-- ---- A  start ---------------------------------------------------------------------------------------
select pg_temp._st('a1',  pg_temp._u(1), pg_temp._rp('a1'));        -- the owner, on their own brokerage's report
select pg_temp._st('a1b', pg_temp._u(1), pg_temp._rp('a1'));        -- again
select pg_temp._st('a2',  pg_temp._u(2), pg_temp._rp('a1'));        -- another member (an agent) of the SAME brokerage, same report
select pg_temp._st('a3',  pg_temp._u(3), pg_temp._rp('a1'));        -- a member of ANOTHER brokerage
select pg_temp._st('a4',  pg_temp._u(1), 'ffffffff-ffff-4fff-8fff-ffffffffffff');   -- an unknown report
select pg_temp._st('a5',  pg_temp._u(4), pg_temp._rp('a1'));        -- a person with no brokerage
select pg_temp._st('a6',  null, pg_temp._rp('a1'));                 -- nobody
select pg_temp._st('a7',  pg_temp._u(1), pg_temp._snap(1, (select j from _pv where name = 'p0')));   -- a stored report in NO brokerage's ledger
select pg_temp._st('a8',  pg_temp._u(1), null);                     -- no report
select pg_temp._st('a9',  pg_temp._u(1), pg_temp._rp('a3'));        -- a report with no private context

select pg_temp._ck('A01 the owner starts watching their own brokerage''s report: one watch, for that agent and that report, due now, never run, no failures, no lease',
  (select err is null and started and watch_id is not null from _w where label = 'a1')
  and (select count(*) = 1 and bool_and(user_id = pg_temp._u(1) and report_id = pg_temp._rp('a1') and last_run_at is null and last_outcome is null and failure_count = 0
                                         and lease_until is null and retry_after is null and next_due_at <= now() and now() - created_at < interval '1 minute')
         from public.property_watch where watch_id = pg_temp._wid('a1')),
  (select coalesce(err, watch_id::text) from _w where label = 'a1'));
select pg_temp._ck('A02 starting writes the watch AND its follow need together: exactly one open `follow` need on the report''s private context whose ref is the watch id (the database minted it)',
  pg_temp._open_follow(pg_temp._cx('a1'), pg_temp._wid('a1')::text) = 1
  and exists (select 1 from public.report_private_context_need where context_id = pg_temp._cx('a1') and kind = 'follow' and ref = pg_temp._wid('a1')::text and closed_at is null),
  pg_temp._open_follow(pg_temp._cx('a1'), pg_temp._wid('a1')::text)::text);
select pg_temp._ck('A03 starting again is IDEMPOTENT: the same watch id comes back with started = false, there is still one watch for that agent and report, and still one open need',
  (select err is null and not started and watch_id = pg_temp._wid('a1') from _w where label = 'a1b')
  and (select count(*) = 1 from public.property_watch where user_id = pg_temp._u(1) and report_id = pg_temp._rp('a1'))
  and pg_temp._open_follow(pg_temp._cx('a1'), pg_temp._wid('a1')::text) = 1,
  (select coalesce(err, watch_id::text || '/' || started::text) from _w where label = 'a1b'));
select pg_temp._ck('A04 any member of the owning brokerage can watch the same report: a SECOND watch, owned by the agent, with its own need — neither can see or stop the other''s',
  (select err is null and started and watch_id <> pg_temp._wid('a1') from _w where label = 'a2')
  and (select count(*) = 2 from public.property_watch where report_id = pg_temp._rp('a1'))
  and pg_temp._open_follow(pg_temp._cx('a1'), pg_temp._wid('a2')::text) = 1
  and pg_temp._open_any(pg_temp._cx('a1')) = 3,
  (select coalesce(err, watch_id::text) from _w where label = 'a2'));
select pg_temp._ck('A05 NOT_FOUND, and only NOT_FOUND (EV006), for every caller who may not watch: another brokerage''s member, an unknown report, a person with no brokerage, nobody, a report in no brokerage''s ledger, no report at all',
  (select count(*) = 6 and bool_and(coalesce(err = 'EV006: NOT_FOUND', false)) from _w where label in ('a3', 'a4', 'a5', 'a6', 'a7', 'a8')),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ' order by label) from _w where label in ('a3', 'a4', 'a5', 'a6', 'a7', 'a8')));
select pg_temp._ck('A06 a report with NO private context cannot be watched: PROPERTY_NOT_KEPT (EV009), nothing stored (there is no property to keep)',
  (select err = 'EV009: PROPERTY_NOT_KEPT' from _w where label = 'a9') and not exists (select 1 from public.property_watch where report_id = pg_temp._rp('a3')),
  (select err from _w where label = 'a9'));
select pg_temp._ck('A07 the refusals stored nothing: exactly two watches exist, and the private layer holds exactly two open follow needs — a refused call leaves no trace',
  (select count(*) = 2 from public.property_watch)
  and (select count(*) = 2 from public.report_private_context_need where kind = 'follow' and closed_at is null),
  (select count(*)::text from public.property_watch));

-- a report whose private context is purged (a verified privacy request): it cannot be watched, and nothing is left half-written
select pg_temp._run('purge a4', format($$select public.report_private_context_purge(%L, 'verified_privacy_request')$$, pg_temp._cx('a4')));
select pg_temp._st('p1', pg_temp._u(1), pg_temp._rp('a4'));
select pg_temp._ck('A08 a report whose private context was PURGED cannot be watched: PROPERTY_NOT_KEPT, no watch row (the watch and its need are written in one transaction, so a refused need leaves no watch behind)',
  (select err = 'EV009: PROPERTY_NOT_KEPT' from _w where label = 'p1') and not exists (select 1 from public.property_watch where report_id = pg_temp._rp('a4')),
  (select err from _w where label = 'p1'));
-- a watch whose context is purged AFTER it started: starting again says so, and the watch row stays for the job to end
select pg_temp._st('p2s', pg_temp._u(2), pg_temp._rp('a2'));
select pg_temp._run('purge a2', format($$select public.report_private_context_purge(%L, 'verified_privacy_request')$$, pg_temp._cx('a2')));
select pg_temp._st('p2', pg_temp._u(2), pg_temp._rp('a2'));
select pg_temp._ck('A09 a watch whose private context is purged AFTER it began (a verified privacy request): the start was fine, a repeat says PROPERTY_NOT_KEPT, and the watch row stays (the daily job ends it, and the purge already closed its need)',
  (select err is null and started from _w where label = 'p2s') and (select err = 'EV009: PROPERTY_NOT_KEPT' from _w where label = 'p2')
  and exists (select 1 from public.property_watch where watch_id = pg_temp._wid('p2s')) and pg_temp._open_follow(pg_temp._cx('a2'), pg_temp._wid('p2s')::text) = 0,
  (select err from _w where label = 'p2'));

-- ---- L  the caller's own watches ------------------------------------------------------------------------
select pg_temp._ck('L01 an agent lists only THEIR OWN watches, newest first, with the report''s number and issue time and the private context''s handle (never the address): the owner sees theirs, the agent sees theirs, nobody sees anyone else''s',
  (select count(*) = 1 and bool_and(watch_id = pg_temp._wid('a1') and report_id = pg_temp._rp('a1') and number = 1 and private_context_id = pg_temp._cx('a1') and next_due_at is not null)
     from public.evaluation_property_watches_of(pg_temp._u(1)))
  and array(select watch_id from public.evaluation_property_watches_of(pg_temp._u(2))) = array[pg_temp._wid('p2s'), pg_temp._wid('a2')]   -- the function output order itself: newest first
  and (select count(*) = 0 from public.evaluation_property_watches_of(pg_temp._u(3)))
  and (select count(*) = 0 from public.evaluation_property_watches_of(pg_temp._u(4)))
  and (select count(*) = 0 from public.evaluation_property_watches_of(null)),
  (select count(*)::text from public.evaluation_property_watches_of(pg_temp._u(1))));

-- ---- T  stop ------------------------------------------------------------------------------------------
create temp table _t (label text primary key, res text);
create function pg_temp._sp(p_label text, p_user uuid, p_watch uuid) returns void language plpgsql as $$
begin
  insert into _t values (p_label, public.evaluation_property_watch_stop(p_user, p_watch)::text);
exception when others then
  insert into _t values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
-- the agent's watch on a1 (u2) must survive u1's attempts; seen rows to prove they go with the watch
select pg_temp._run('seen for a2', format($$select public.property_watch_record_run(%L, 'NOTIFIED', '[{"project_id":"proj-x","event_type":"status_changed","observed_at":"2026-10-01T02:00:00Z"}]'::jsonb)$$, pg_temp._wid('a2')));
select pg_temp._sp('t1', pg_temp._u(1), pg_temp._wid('a2'));     -- another agent of the same brokerage tries to stop it
select pg_temp._sp('t2', pg_temp._u(3), pg_temp._wid('a2'));     -- another brokerage
select pg_temp._sp('t3', pg_temp._u(2), pg_temp._k(99));         -- an unknown watch
select pg_temp._sp('t4', null, pg_temp._wid('a2'));              -- nobody
select pg_temp._sp('t5', pg_temp._u(2), null);                   -- no watch
select pg_temp._ck('T01 only the owner can stop a watch: another agent of the SAME brokerage, another brokerage, an unknown id, nobody and no id all get NOT_FOUND (EV006) and the watch, its seen rows and its need are untouched',
  (select count(*) = 5 and bool_and(coalesce(res = 'EV006: NOT_FOUND', false)) from _t where label in ('t1', 't2', 't3', 't4', 't5'))
  and exists (select 1 from public.property_watch where watch_id = pg_temp._wid('a2'))
  and (select count(*) = 1 from public.property_watch_seen where watch_id = pg_temp._wid('a2'))
  and pg_temp._open_follow(pg_temp._cx('a1'), pg_temp._wid('a2')::text) = 1,
  (select string_agg(label || '=' || res, '; ' order by label) from _t where label in ('t1', 't2', 't3', 't4', 't5')));
select pg_temp._sp('t6', pg_temp._u(2), pg_temp._wid('a2'));
select pg_temp._sp('t7', pg_temp._u(2), pg_temp._wid('a2'));
select pg_temp._ck('T02 the owner stops their watch: true; the watch row and its told-about rows are gone; its follow need is CLOSED; the other agent''s watch and need are untouched; stopping again is NOT_FOUND',
  (select res = 'true' from _t where label = 't6') and (select res = 'EV006: NOT_FOUND' from _t where label = 't7')
  and not exists (select 1 from public.property_watch where watch_id = pg_temp._wid('a2'))
  and not exists (select 1 from public.property_watch_seen where watch_id = pg_temp._wid('a2'))
  and pg_temp._open_follow(pg_temp._cx('a1'), pg_temp._wid('a2')::text) = 0
  and exists (select 1 from public.report_private_context_need where context_id = pg_temp._cx('a1') and kind = 'follow' and ref = pg_temp._wid('a2')::text and closed_at is not null)
  and exists (select 1 from public.property_watch where watch_id = pg_temp._wid('a1'))
  and pg_temp._open_follow(pg_temp._cx('a1'), pg_temp._wid('a1')::text) = 1,
  (select string_agg(label || '=' || res, '; ' order by label) from _t where label in ('t6', 't7')));

-- the 90-day clock: closing the LAST need starts it; another open need stops it from starting
select pg_temp._run('a1 report need closed', format($$select public.report_private_context_need_close(%L, 'report', (select ref from public.report_private_context_need where context_id = %L and kind = 'report'))$$, pg_temp._cx('a1'), pg_temp._cx('a1')));
select pg_temp._ck('T03 while a watch is open the 90-day clock has NOT started even though the report''s own need is closed (the watch keeps the property); the context is active with no purge date',
  (select state = 'active' and purge_due_at is null from public.report_private_context where context_id = pg_temp._cx('a1')),
  (select purge_due_at::text from public.report_private_context where context_id = pg_temp._cx('a1')));
select pg_temp._sp('t8', pg_temp._u(1), pg_temp._wid('a1'));
select pg_temp._ck('T04 stopping the LAST thing that needs a property starts the private layer''s own clock: exactly 90 days out (the watch never extends how long an address is kept beyond the time it is watched)',
  (select res = 'true' from _t where label = 't8')
  and (select purge_due_at is not null and purge_due_at - last_needed_at = interval '90 days' and state = 'active' from public.report_private_context where context_id = pg_temp._cx('a1'))
  and pg_temp._open_any(pg_temp._cx('a1')) = 0,
  (select purge_due_at::text from public.report_private_context where context_id = pg_temp._cx('a1')));

-- every removal path closes the need, because it is a trigger, not a step callers remember
select pg_temp._st('r1', pg_temp._u(5), pg_temp._rp('g1'));
select pg_temp._st('r2', pg_temp._u(6), pg_temp._rp('d1'));
select pg_temp._st('r3', pg_temp._u(3), pg_temp._rp('b1'));
select pg_temp._st('r4', pg_temp._u(7), pg_temp._rp('e1'));
select pg_temp._run('direct delete', format($$delete from public.property_watch where watch_id = %L$$, pg_temp._wid('r1')));
select pg_temp._ck('T05 a DIRECT delete of a watch row closes its need (the trigger, not the caller): the need is closed and no open need remains on that context for that ref',
  not exists (select 1 from public.property_watch where watch_id = pg_temp._wid('r1')) and pg_temp._open_follow(pg_temp._cx('g1'), pg_temp._wid('r1')::text) = 0
  and exists (select 1 from public.report_private_context_need where context_id = pg_temp._cx('g1') and kind = 'follow' and ref = pg_temp._wid('r1')::text and closed_at is not null),
  (select err from _w where label = 'r1'));
select pg_temp._run('delete user', format($$delete from auth.users where id = %L$$, pg_temp._u(3)));
select pg_temp._ck('T06 deleting the USER cascades to their watches AND closes their needs (the trigger runs as its owner, so the cascade does not need the deleting role to be able to run the private layer''s functions)',
  not exists (select 1 from public.property_watch where watch_id = pg_temp._wid('r3')) and pg_temp._open_follow(pg_temp._cx('b1'), pg_temp._wid('r3')::text) = 0
  and exists (select 1 from public.report_private_context_need where context_id = pg_temp._cx('b1') and kind = 'follow' and ref = pg_temp._wid('r3')::text and closed_at is not null)
  and exists (select 1 from _setup where step = 'delete user' and result = 'ok'),
  (select result from _setup where step = 'delete user'));
-- a TRUNCATE cannot run inside a query that also reads the table (55006), so each attempt is its own statement and the check reads its result
create temp table _tr (label text primary key, res text);
create function pg_temp._try(p_label text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into _tr values (p_label, 'ok');
exception when others then
  insert into _tr values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp._try('plain', 'truncate public.property_watch');
select pg_temp._try('cascade', 'truncate public.property_watch cascade');
select pg_temp._ck('T07 TRUNCATE of the watch table is refused for the owner and removes nothing: a plain one by the foreign key from the told-about table, a CASCADE one (which would reach both tables and skip the closing trigger) by the table''s own statement trigger',
  (select res like '0A000:%' from _tr where label = 'plain')
  and (select res like '%never truncated%' from _tr where label = 'cascade')
  and (select count(*) = 2 from public.property_watch where watch_id in (pg_temp._wid('r2'), pg_temp._wid('r4'))),
  (select string_agg(label || '=' || res, ' | ') from _tr));
select pg_temp._ck('T08 a watch''s identity cannot change (watch id, report, user, created time): each update is refused; its schedule columns can move',
  pg_temp._why(format($$update public.property_watch set user_id = %L where watch_id = %L$$, pg_temp._u(8), pg_temp._wid('r2'))) like '%identity columns cannot change%'
  and pg_temp._why(format($$update public.property_watch set report_id = %L where watch_id = %L$$, pg_temp._rp('a1'), pg_temp._wid('r2'))) like '%identity columns cannot change%'
  and pg_temp._why(format($$update public.property_watch set created_at = now() - interval '1 day' where watch_id = %L$$, pg_temp._wid('r2'))) like '%identity columns cannot change%'
  and pg_temp._why(format($$update public.property_watch set watch_id = %L where watch_id = %L$$, pg_temp._k(77), pg_temp._wid('r2'))) like '%identity columns cannot change%'
  and pg_temp._why(format($$update public.property_watch set next_due_at = next_due_at where watch_id = %L$$, pg_temp._wid('r2'))) = 'ok',
  null);

-- ---- S  standing: the SAME check that opens a saved report ---------------------------------------------
select pg_temp._run('gamma ends', format($$update public.evaluation set expires_at = created_at + interval '1 microsecond' where evaluation_id = %L$$, pg_temp._ev('gamma')));
select pg_temp._st('s1', pg_temp._u(5), pg_temp._rp('g1'));
select pg_temp._run('delta revoked', format($$select public.evaluation_revoke(%L)$$, pg_temp._ev('delta')));
select pg_temp._st('s2', pg_temp._u(6), pg_temp._rp('d1'));
select pg_temp._run('echo suspended', format($$update public.brokerage_account set status = 'suspended' where id = %L$$, pg_temp._bk('echo')));
select pg_temp._st('s3', pg_temp._u(7), pg_temp._rp('e1'));
select pg_temp._ck('S01 a brokerage without standing cannot START a watch: a trial that ended, a REVOKED evaluation and a SUSPENDED account all get NOT_FOUND — the one rule that stops them reopening a saved report',
  (select count(*) = 3 and bool_and(coalesce(err = 'EV006: NOT_FOUND', false)) from _w where label in ('s1', 's2', 's3')),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ' order by label) from _w where label in ('s1', 's2', 's3')));
select pg_temp._ck('S02 and a watch that already exists is STILL listed and STILL stoppable after standing is lost (a watch must never become impossible to take back because a trial ran out)',
  (select count(*) = 1 from public.evaluation_property_watches_of(pg_temp._u(6)) where watch_id = pg_temp._wid('r2'))
  and (select count(*) = 1 from public.evaluation_property_watches_of(pg_temp._u(7)) where watch_id = pg_temp._wid('r4')),
  null);
select pg_temp._sp('t9', pg_temp._u(7), pg_temp._wid('r4'));
select pg_temp._ck('S03 and stoppable: the suspended brokerage''s agent stops it, and its need closes',
  (select res = 'true' from _t where label = 't9') and pg_temp._open_follow(pg_temp._cx('e1'), pg_temp._wid('r4')::text) = 0, (select res from _t where label = 't9'));

-- ---- M  the per-brokerage limit -------------------------------------------------------------------------------
select pg_temp._run('fox 20 by owner', $x$do $d$ declare n int; begin for n in 1..20 loop perform pg_temp._st('fx' || n, pg_temp._u(8), pg_temp._rp('f' || n)); end loop; end $d$$x$);
select pg_temp._run('fox 5 by agent', $x$do $d$ declare n int; begin for n in 1..5 loop perform pg_temp._st('fy' || n, pg_temp._u(9), pg_temp._rp('f' || n)); end loop; end $d$$x$);
select pg_temp._st('fy6', pg_temp._u(9), pg_temp._rp('f6'));      -- the 26th
select pg_temp._st('fx1b', pg_temp._u(8), pg_temp._rp('f1'));     -- an existing watch, repeated AT the limit
select pg_temp._ck('M01 a brokerage holds at most 25 watches: the 25th (counting both members) is made, the 26th is refused WATCH_LIMIT_REACHED (EV008) and stores nothing',
  (select count(*) = 20 from _w where label ~ '^fx[0-9]+$' and err is null and started)
  and (select count(*) = 5 from _w where label ~ '^fy[0-9]$' and err is null and started)
  and (select err = 'EV008: WATCH_LIMIT_REACHED' from _w where label = 'fy6')
  and (select count(*) = 25 from public.property_watch where user_id in (pg_temp._u(8), pg_temp._u(9)))
  and not exists (select 1 from public.property_watch where user_id = pg_temp._u(9) and report_id = pg_temp._rp('f6')),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ' order by label) from _w where label in ('fy5', 'fy6')));
select pg_temp._ck('M02 repeating an EXISTING watch at the limit is still fine (idempotent: it adds nothing, so it does not count)',
  (select err is null and not started and watch_id = pg_temp._wid('fx1') from _w where label = 'fx1b'), (select coalesce(err, 'ok') from _w where label = 'fx1b'));
select pg_temp._run('fox stops one', format($$select public.evaluation_property_watch_stop(%L, %L)$$, pg_temp._u(8), pg_temp._wid('fx20')));
select pg_temp._st('fy6b', pg_temp._u(9), pg_temp._rp('f6'));
select pg_temp._ck('M03 stopping a watch frees its place: after the owner stops one, the agent''s 26th attempt (now the 25th) is made',
  (select err is null and started from _w where label = 'fy6b') and (select count(*) = 25 from public.property_watch where user_id in (pg_temp._u(8), pg_temp._u(9))),
  (select coalesce(err, 'ok') from _w where label = 'fy6b'));

-- the limit counts watches whose agent is CURRENTLY a member of the brokerage. Shown with the limit lowered to 3 (restored below, and Z05 checks it is
-- byte-for-byte what the file defines): an agent who leaves keeps their rows until the job ends them, but they no longer hold the brokerage's places.
create temp table _orig_limit (def text);
insert into _orig_limit select pg_get_functiondef('public.property_watch_limit()'::regprocedure);
select pg_temp._run('limit 3', $q$create or replace function public.property_watch_limit() returns integer language sql immutable as $f$ select 3 $f$$q$);
select pg_temp._st('h1', pg_temp._u(10), pg_temp._rp('h1'));
select pg_temp._st('h2', pg_temp._u(10), pg_temp._rp('h2'));
select pg_temp._st('h3', pg_temp._u(11), pg_temp._rp('h3'));
select pg_temp._st('h4', pg_temp._u(11), pg_temp._rp('h4'));
select pg_temp._st('h5', pg_temp._u(10), pg_temp._rp('h5'));     -- no property to keep, asked while the brokerage is FULL
select pg_temp._run('agent leaves hotel', format($$update public.brokerage_member set status = 'deactivated', deactivated_at = now() where user_id = %L$$, pg_temp._u(11)));
select pg_temp._st('h3b', pg_temp._u(10), pg_temp._rp('h3'));
select pg_temp._st('h4b', pg_temp._u(10), pg_temp._rp('h4'));
select pg_temp._st('h4c', pg_temp._u(11), pg_temp._rp('h4'));
select pg_temp._ck('M04 with the limit at 3: three watches (two by the owner, one by the agent) fill it and the fourth is refused; once the AGENT LEAVES the brokerage their watch no longer counts, so the owner can take the third place — and the fourth is refused again; the departed agent''s row is still there for the job to end, and the agent can no longer start anything',
  (select count(*) = 3 and bool_and(coalesce(err is null and started, false)) from _w where label in ('h1', 'h2', 'h3'))
  and (select err = 'EV008: WATCH_LIMIT_REACHED' from _w where label = 'h4')
  and (select err is null and started from _w where label = 'h3b')
  and (select err = 'EV008: WATCH_LIMIT_REACHED' from _w where label = 'h4b')
  and (select err = 'EV006: NOT_FOUND' from _w where label = 'h4c')
  and exists (select 1 from public.property_watch where user_id = pg_temp._u(11) and report_id = pg_temp._rp('h3')),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ' order by label) from _w where label like 'h%'));
select pg_temp._ck('M05 a report with NO private context is refused PROPERTY_NOT_KEPT even when the brokerage is full: there is no property to keep, which is a different answer from "you have too many" (the order of the two refusals is part of the contract)',
  (select err = 'EV009: PROPERTY_NOT_KEPT' from _w where label = 'h5') and not exists (select 1 from public.property_watch where report_id = pg_temp._rp('h5')),
  (select coalesce(err, 'ok') from _w where label = 'h5'));
select pg_temp._run('limit restored', (select def from _orig_limit));
select pg_temp._run('hotel cleared', format($$delete from public.property_watch where user_id in (%L, %L)$$, pg_temp._u(10), pg_temp._u(11)));
select pg_temp._ck('Z05 the lowered limit was put back exactly: the function is byte-for-byte what the file defines, and says 25',
  (select def from _orig_limit) = pg_get_functiondef('public.property_watch_limit()'::regprocedure) and public.property_watch_limit() = 25
  and has_function_privilege('service_role', 'public.property_watch_limit()', 'execute') and not has_function_privilege('anon', 'public.property_watch_limit()', 'execute'),
  public.property_watch_limit()::text);

-- ---- C  the job claims watches --------------------------------------------------------------------------------
-- a known population: remove every watch left above (each removal closes its need), then make four
select pg_temp._run('clear all', 'delete from public.property_watch');
select pg_temp._run('c setup', $x$do $d$ begin
  perform pg_temp._st('c1', pg_temp._u(1), pg_temp._rp('a1'));
  perform pg_temp._st('c2', pg_temp._u(2), pg_temp._rp('a4'));   -- purged context: refused, no watch
end $d$$x$);
select pg_temp._run('c3 watch', $x$do $d$ begin
  perform pg_temp._st('c3', pg_temp._u(8), pg_temp._rp('f1'));
  perform pg_temp._st('c4', pg_temp._u(8), pg_temp._rp('f2'));
  perform pg_temp._st('c5', pg_temp._u(8), pg_temp._rp('f3'));
end $d$$x$);
select pg_temp._run('c schedule', format($$update public.property_watch set next_due_at = now() - interval '3 hours' where watch_id = %L;
  update public.property_watch set next_due_at = now() - interval '1 hour' where watch_id = %L;
  update public.property_watch set next_due_at = now() + interval '1 hour' where watch_id = %L;
  update public.property_watch set next_due_at = now() - interval '5 hours', retry_after = now() + interval '2 hours' where watch_id = %L$$,
  pg_temp._wid('c3'), pg_temp._wid('c4'), pg_temp._wid('c5'), pg_temp._wid('c1')));
create temp table _cl (n serial, watch_id uuid, report_id uuid, user_id uuid);
insert into _cl (watch_id, report_id, user_id) select * from public.property_watch_claim(10);
select pg_temp._ck('C01 a claim returns exactly the watches that are DUE and not waiting out a back-off, oldest due first: the one due 3 hours ago, then the one due 1 hour ago — not the one due in an hour, and not the one due 5 hours ago that is backing off for 2 more hours',
  (select count(*) = 2 from _cl) and (select watch_id = pg_temp._wid('c3') from _cl where n = 1) and (select watch_id = pg_temp._wid('c4') from _cl where n = 2),
  (select string_agg(watch_id::text, ',' order by n) from _cl));
select pg_temp._ck('C02 a claim returns the watch, its report and its agent — and nothing private (three columns), and leaves each claimed watch LEASED for the planned time',
  (select bool_and(w.lease_until > now() + interval '9 minutes' and w.lease_until <= now() + interval '10 minutes') from public.property_watch w where w.watch_id in (select watch_id from _cl))
  and (select count(*) = 0 from public.property_watch w where w.lease_until is not null and w.watch_id not in (select watch_id from _cl)),
  null);
select pg_temp._ck('C03 a leased watch is not claimed again while its lease holds (two job runs cannot take the same one), and a claim with nothing due returns nothing',
  (select count(*) = 0 from public.property_watch_claim(10)), null);
select pg_temp._run('lease lapses', format($$update public.property_watch set lease_until = now() - interval '1 second' where watch_id = %L$$, pg_temp._wid('c3')));
select pg_temp._ck('C04 a lapsed lease is claimable again (a crashed run''s watches are retried), and only that one',
  (select count(*) = 1 and bool_and(watch_id = pg_temp._wid('c3')) from public.property_watch_claim(10)), null);
select pg_temp._ck('C05 the claim size is bounded: 0, a negative number, null and 101 are refused (22023); 1 returns at most one',
  pg_temp._why('select * from public.property_watch_claim(0)') like '22023:%' and pg_temp._why('select * from public.property_watch_claim(-1)') like '22023:%'
  and pg_temp._why('select * from public.property_watch_claim(null)') like '22023:%' and pg_temp._why('select * from public.property_watch_claim(101)') like '22023:%'
  and pg_temp._why('select * from public.property_watch_claim(100)') = 'ok', null);

-- ---- R  recording a check ------------------------------------------------------------------------------------
create temp table _x (label text primary key, res text);
create function pg_temp._rr(p_label text, p_watch uuid, p_outcome text, p_seen jsonb) returns void language plpgsql as $$
begin
  insert into _x values (p_label, public.property_watch_record_run(p_watch, p_outcome, p_seen)::text);
exception when others then
  insert into _x values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._rf(p_label text, p_watch uuid, p_outcome text) returns void language plpgsql as $$
begin
  insert into _x values (p_label, public.property_watch_record_failure(p_watch, p_outcome)::text);
exception when others then
  insert into _x values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._slot(p_watch uuid) returns timestamptz language sql as $$ select next_due_at from public.property_watch where watch_id = p_watch $$;
create temp table _slots (label text primary key, slot timestamptz);

-- slot arithmetic: three watches due 5 minutes ago, 3 days ago, and 10 hours from now
select pg_temp._run('slot setup', format($$update public.property_watch set next_due_at = now() - interval '5 minutes', lease_until = now() + interval '10 minutes' where watch_id = %L;
  update public.property_watch set next_due_at = now() - interval '3 days 2 hours', lease_until = now() + interval '10 minutes' where watch_id = %L;
  update public.property_watch set next_due_at = now() + interval '10 hours' where watch_id = %L$$, pg_temp._wid('c3'), pg_temp._wid('c4'), pg_temp._wid('c5')));
insert into _slots select 'c3-before', pg_temp._slot(pg_temp._wid('c3'));
insert into _slots select 'c4-before', pg_temp._slot(pg_temp._wid('c4'));
insert into _slots select 'c5-before', pg_temp._slot(pg_temp._wid('c5'));
select pg_temp._rr('r1', pg_temp._wid('c3'), 'CHECKED', null);
select pg_temp._rr('r2', pg_temp._wid('c4'), 'CHECKED_PARTIAL', '[]'::jsonb);
select pg_temp._rr('r3', pg_temp._wid('c5'), 'CHECKED', '[]');
select pg_temp._ck('R01 a CHECKED run records the time and the outcome, clears the lease, the failures and any back-off, and tells nothing (no told-about row)',
  (select res = 'true' from _x where label = 'r1')
  and (select last_outcome = 'CHECKED' and last_run_at > now() - interval '1 minute' and lease_until is null and failure_count = 0 and retry_after is null from public.property_watch where watch_id = pg_temp._wid('c3'))
  and (select last_outcome = 'CHECKED_PARTIAL' from public.property_watch where watch_id = pg_temp._wid('c4'))
  and (select count(*) = 0 from public.property_watch_seen where watch_id in (pg_temp._wid('c3'), pg_temp._wid('c4'))),
  (select string_agg(label || '=' || res, '; ' order by label) from _x where label like 'r%'));
select pg_temp._ck('R02 THE DAILY SLOT IS FIXED: a watch checked 5 minutes after its slot is next due exactly one day after that slot; one that was 3 days and 2 hours late moves to the first slot AFTER now (4 days after its old slot: no catch-up burst); one checked EARLY still moves a full day',
  (select slot + interval '1 day' = pg_temp._slot(pg_temp._wid('c3')) from _slots where label = 'c3-before')
  and (select slot + interval '4 days' = pg_temp._slot(pg_temp._wid('c4')) from _slots where label = 'c4-before')
  and (select slot + interval '1 day' = pg_temp._slot(pg_temp._wid('c5')) from _slots where label = 'c5-before')
  and pg_temp._slot(pg_temp._wid('c4')) > now() and pg_temp._slot(pg_temp._wid('c4')) <= now() + interval '1 day'
  and pg_temp._slot(pg_temp._wid('c3')) > now() and pg_temp._slot(pg_temp._wid('c3')) <= now() + interval '1 day',
  (select string_agg(s.label || ': ' || s.slot::text, ' | ') from _slots s));
select pg_temp._rr('r4', pg_temp._wid('c3'), 'NOTIFIED', '[{"project_id":"proj-a","event_type":"status_changed","observed_at":"2026-10-01T02:00:00.123456Z"},{"project_id":"proj-b","event_type":"first_detected","observed_at":"2026-09-30T02:00:00Z"}]'::jsonb);
select pg_temp._rr('r5', pg_temp._wid('c3'), 'NOTIFIED', '[{"project_id":"proj-a","event_type":"status_changed","observed_at":"2026-10-01T02:00:00.123456Z"}]'::jsonb);
select pg_temp._ck('R03 a NOTIFIED run records exactly what the email told: two rows; recording the SAME change again adds no row (a retried run cannot repeat it); the project id is the public record''s id and nothing else is stored',
  (select res = 'true' from _x where label in ('r4')) and (select res = 'true' from _x where label = 'r5')
  and (select count(*) = 2 from public.property_watch_seen where watch_id = pg_temp._wid('c3'))
  and (select last_outcome = 'NOTIFIED' from public.property_watch where watch_id = pg_temp._wid('c3'))
  and (select observed_at = timestamptz '2026-10-01T02:00:00.123456Z' from public.property_watch_seen where watch_id = pg_temp._wid('c3') and project_id = 'proj-a'),
  (select count(*)::text from public.property_watch_seen where watch_id = pg_temp._wid('c3')));
select pg_temp._rr('r6', pg_temp._wid('c3'), 'NOTIFIED', '[]');
select pg_temp._rr('r7', pg_temp._wid('c3'), 'CHECKED', '[{"project_id":"proj-c","event_type":"status_changed","observed_at":"2026-10-01T02:00:00Z"}]');
select pg_temp._rr('r8', pg_temp._wid('c3'), 'BOGUS', null);
select pg_temp._rr('r9', pg_temp._wid('c3'), null, null);
select pg_temp._rr('r10', pg_temp._wid('c3'), 'READ_FAILED', null);
select pg_temp._rr('r11', pg_temp._wid('c3'), 'CHECKED', '{"project_id":"x"}'::jsonb);
select pg_temp._rr('r12', pg_temp._wid('c3'), 'NOTIFIED', (select jsonb_agg(jsonb_build_object('project_id', 'p' || g, 'event_type', 'status_changed', 'observed_at', '2026-10-01T02:00:00Z')) from generate_series(1, 201) g));
select pg_temp._rr('r13', pg_temp._wid('c3'), 'NOTIFIED', '[{"project_id":"proj-d","event_type":"made_up","observed_at":"2026-10-01T02:00:00Z"}]');
select pg_temp._rr('r14', pg_temp._wid('c3'), 'NOTIFIED', '[{"project_id":"  ","event_type":"status_changed","observed_at":"2026-10-01T02:00:00Z"}]');
select pg_temp._rr('r15', pg_temp._wid('c3'), 'NOTIFIED', '[{"event_type":"status_changed","observed_at":"2026-10-01T02:00:00Z"}]');
select pg_temp._ck('R04 a run that cannot be recorded truthfully is refused and records nothing: NOTIFIED with nothing told, any other outcome with something told, an unknown or null outcome, a failure outcome, a non-array, more than 200, an unknown event type, a blank or missing project id',
  (select count(*) = 7 and bool_and(coalesce(res like '22023:%', false)) from _x where label in ('r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12'))
  and (select count(*) = 3 and bool_and(coalesce(res like '23514:%' or res like '23502:%', false)) from _x where label in ('r13', 'r14', 'r15'))
  and (select count(*) = 2 from public.property_watch_seen where watch_id = pg_temp._wid('c3')),
  (select string_agg(label || '=' || res, '; ' order by label) from _x where label in ('r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12', 'r13', 'r14', 'r15')));
select pg_temp._run('old seen', format($$insert into public.property_watch_seen (watch_id, project_id, event_type, observed_at)
  values (%L, 'proj-old', 'status_changed', now() - interval '101 days'), (%L, 'proj-edge', 'status_changed', now() - interval '99 days')$$, pg_temp._wid('c3'), pg_temp._wid('c3')));
select pg_temp._rr('r16', pg_temp._wid('c3'), 'CHECKED', null);
select pg_temp._ck('R05 recording a run forgets what is older than the told-about rows are kept for: the 101-day-old row is deleted, the 99-day-old row stays, the recent ones stay',
  not exists (select 1 from public.property_watch_seen where project_id = 'proj-old') and exists (select 1 from public.property_watch_seen where project_id = 'proj-edge')
  and (select count(*) = 3 from public.property_watch_seen where watch_id = pg_temp._wid('c3')),
  (select string_agg(project_id, ',') from public.property_watch_seen where watch_id = pg_temp._wid('c3')));
select pg_temp._rr('r17', pg_temp._k(88), 'CHECKED', null);
select pg_temp._rr('r18', pg_temp._k(88), 'NOTIFIED', '[{"project_id":"z","event_type":"status_changed","observed_at":"2026-10-01T02:00:00Z"}]');
select pg_temp._ck('R06 recording a run for a watch that no longer exists (stopped while the check ran) returns false and writes nothing — not even a told-about row',
  (select count(*) = 2 and bool_and(coalesce(res = 'false', false)) from _x where label in ('r17', 'r18'))
  and not exists (select 1 from public.property_watch_seen where project_id = 'z'),
  (select string_agg(label || '=' || res, '; ' order by label) from _x where label in ('r17', 'r18')));

-- ---- F  failure and back-off -------------------------------------------------------------------------------------
select pg_temp._run('f setup', format($$update public.property_watch set next_due_at = now() - interval '1 hour', lease_until = now() + interval '10 minutes', retry_after = null, failure_count = 0 where watch_id = %L$$, pg_temp._wid('c3')));
insert into _slots select 'c3-f0', pg_temp._slot(pg_temp._wid('c3'));
select pg_temp._rf('f1', pg_temp._wid('c3'), 'READ_FAILED');
create temp table _fs (label text primary key, fc int, ra timestamptz, due timestamptz, lease timestamptz, outcome text);
insert into _fs select 'one', failure_count, retry_after, next_due_at, lease_until, last_outcome from public.property_watch where watch_id = pg_temp._wid('c3');
select pg_temp._rf('f2', pg_temp._wid('c3'), 'EMAIL_FAILED');
insert into _fs select 'two', failure_count, retry_after, next_due_at, lease_until, last_outcome from public.property_watch where watch_id = pg_temp._wid('c3');
select pg_temp._run('f many', format($$update public.property_watch set failure_count = 29 where watch_id = %L$$, pg_temp._wid('c3')));
select pg_temp._rf('f3', pg_temp._wid('c3'), 'NO_RECIPIENT');
insert into _fs select 'many', failure_count, retry_after, next_due_at, lease_until, last_outcome from public.property_watch where watch_id = pg_temp._wid('c3');
select pg_temp._ck('F01 a failed check counts the failure, records why, clears the lease and backs off by one hour times the failures so far — and does NOT touch the daily slot (it is the same instant as before the first failure)',
  (select fc = 1 and outcome = 'READ_FAILED' and lease is null and ra between now() + interval '59 minutes' and now() + interval '61 minutes' from _fs where label = 'one')
  and (select fc = 2 and outcome = 'EMAIL_FAILED' and ra between now() + interval '119 minutes' and now() + interval '121 minutes' from _fs where label = 'two')
  and (select due = (select slot from _slots where label = 'c3-f0') from _fs where label = 'one')
  and (select due = (select slot from _slots where label = 'c3-f0') from _fs where label = 'two'),
  (select string_agg(label || ': fc=' || fc || ' ra=' || ra::text, ' | ' order by label) from _fs));
select pg_temp._ck('F02 the back-off is CAPPED at 24 hours however many times it has failed (30 failures wait 24 hours, not 30)',
  (select fc = 30 and outcome = 'NO_RECIPIENT' and ra between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from _fs where label = 'many'),
  (select ra::text from _fs where label = 'many'));
select pg_temp._run('f due', format($$update public.property_watch set retry_after = now() - interval '1 minute' where watch_id = %L$$, pg_temp._wid('c3')));
select pg_temp._ck('F03 a watch is claimed again once its back-off has passed — a failed check is retried, never skipped',
  (select count(*) = 1 and bool_and(watch_id = pg_temp._wid('c3')) from public.property_watch_claim(10)), null);
select pg_temp._rr('r19', pg_temp._wid('c3'), 'CHECKED', null);
select pg_temp._ck('F04 a success after failures clears the count and the back-off, and the next slot is the ORIGINAL daily slot plus a day (an hour of failures did not move the time of day it is checked)',
  (select failure_count = 0 and retry_after is null and last_outcome = 'CHECKED' from public.property_watch where watch_id = pg_temp._wid('c3'))
  and (select slot + interval '1 day' = pg_temp._slot(pg_temp._wid('c3')) from _slots where label = 'c3-f0'),
  (select slot::text || ' -> ' || pg_temp._slot(pg_temp._wid('c3'))::text from _slots where label = 'c3-f0'));
select pg_temp._rf('f4', pg_temp._wid('c3'), 'BOGUS');
select pg_temp._rf('f5', pg_temp._wid('c3'), 'CHECKED');
select pg_temp._rf('f6', pg_temp._wid('c3'), null);
select pg_temp._rf('f7', pg_temp._k(88), 'READ_FAILED');
select pg_temp._ck('F05 a failure that is not a failure is refused (22023): unknown, a success outcome, null; a failure for a watch that no longer exists is false and writes nothing',
  (select count(*) = 3 and bool_and(coalesce(res like '22023:%', false)) from _x where label in ('f4', 'f5', 'f6')) and (select res = 'false' from _x where label = 'f7')
  and (select failure_count = 0 from public.property_watch where watch_id = pg_temp._wid('c3')),
  (select string_agg(label || '=' || res, '; ' order by label) from _x where label in ('f4', 'f5', 'f6', 'f7')));

-- ---- E  end ---------------------------------------------------------------------------------------------------
select pg_temp._run('e setup', $x$do $d$ begin
  perform pg_temp._st('en1', pg_temp._u(8), pg_temp._rp('f10'));
  perform pg_temp._st('en2', pg_temp._u(8), pg_temp._rp('f11'));
end $d$$x$);
create function pg_temp._en(p_label text, p_watch uuid, p_reason text) returns void language plpgsql as $$
begin
  insert into _x values (p_label, public.property_watch_end(p_watch, p_reason)::text);
exception when others then
  insert into _x values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
select pg_temp._en('e1', pg_temp._wid('en1'), 'STANDING_LOST');
select pg_temp._en('e2', pg_temp._wid('en1'), 'STANDING_LOST');
select pg_temp._en('e3', pg_temp._wid('en2'), 'whatever');
select pg_temp._en('e4', pg_temp._wid('en2'), null);
select pg_temp._en('e5', pg_temp._wid('en2'), 'PROPERTY_NOT_KEPT');
select pg_temp._ck('E01 ending a watch removes it and closes its need (true); ending it again is false; an unknown or null reason is refused (22023) and removes nothing; both named reasons work',
  (select res = 'true' from _x where label = 'e1') and (select res = 'false' from _x where label = 'e2')
  and (select res like '22023:%' from _x where label = 'e3') and (select res like '22023:%' from _x where label = 'e4') and (select res = 'true' from _x where label = 'e5')
  and not exists (select 1 from public.property_watch where watch_id in (pg_temp._wid('en1'), pg_temp._wid('en2')))
  and pg_temp._open_follow(pg_temp._cx('f10'), pg_temp._wid('en1')::text) = 0 and pg_temp._open_follow(pg_temp._cx('f11'), pg_temp._wid('en2')::text) = 0,
  (select string_agg(label || '=' || res, '; ' order by label) from _x where label like 'e%'));

-- a batch smaller than the backlog works on the watch that has waited longest
select pg_temp._run('c6 setup', $x$do $d$ begin
  perform pg_temp._st('c6a', pg_temp._u(8), pg_temp._rp('f12'));
  perform pg_temp._st('c6b', pg_temp._u(8), pg_temp._rp('f13'));
  perform pg_temp._st('c6c', pg_temp._u(8), pg_temp._rp('f14'));
end $d$$x$);
select pg_temp._run('c6 schedule', format($$update public.property_watch set next_due_at = now() - interval '2 hours' where watch_id = %L;
  update public.property_watch set next_due_at = now() - interval '3 hours' where watch_id = %L;
  update public.property_watch set next_due_at = now() - interval '1 hour' where watch_id = %L$$, pg_temp._wid('c6a'), pg_temp._wid('c6b'), pg_temp._wid('c6c')));
create temp table _c6 (n serial, watch_id uuid);
insert into _c6 (watch_id) select watch_id from public.property_watch_claim(1);
select pg_temp._ck('C06 a claim smaller than the backlog takes the watch that has waited LONGEST (due 3 hours ago), not the first one found; the other two stay unclaimed',
  (select count(*) = 1 and bool_and(watch_id = pg_temp._wid('c6b')) from _c6)
  and (select count(*) = 2 from public.property_watch w where w.watch_id in (pg_temp._wid('c6a'), pg_temp._wid('c6c')) and w.lease_until is null),
  (select string_agg(watch_id::text, ',') from _c6));
select pg_temp._run('c6 clear', format($$delete from public.property_watch where watch_id in (%L, %L, %L)$$, pg_temp._wid('c6a'), pg_temp._wid('c6b'), pg_temp._wid('c6c')));

-- ---- I  the audit -----------------------------------------------------------------------------------------------------------------
select pg_temp._ck('I01 the audit reads clean on the state above: every invariant is zero beside a control that is not (watches > 0)',
  (select violations from public.property_watch_integrity() where check_name = 'watches') > 0
  and (select bool_and(violations = 0) from public.property_watch_integrity() where kind = 'invariant' and check_name <> 'overdue_watches'),
  (select string_agg(check_name || '=' || violations, '; ' order by check_name) from public.property_watch_integrity()));
select pg_temp._run('i break need', format($$update public.report_private_context_need set closed_at = now() where context_id = %L and kind = 'follow' and ref = %L and closed_at is null$$, pg_temp._cx('f1'), pg_temp._wid('c3')));
select pg_temp._ck('I02 the audit CATCHES a watch whose follow need was closed behind its back (positive control: the same query reads 0 above)',
  (select violations = 1 from public.property_watch_integrity() where check_name = 'watch_without_open_follow_need'),
  (select violations::text from public.property_watch_integrity() where check_name = 'watch_without_open_follow_need'));
select pg_temp._run('i overdue', format($$update public.property_watch set next_due_at = now() - interval '7 hours', retry_after = null, lease_until = null where watch_id = %L;
  update public.property_watch set next_due_at = now() - interval '7 hours', retry_after = now() + interval '3 hours', lease_until = null where watch_id = %L;
  update public.property_watch set next_due_at = now() - interval '7 hours', retry_after = null, lease_until = now() + interval '5 minutes' where watch_id = %L$$,
  pg_temp._wid('c3'), pg_temp._wid('c4'), pg_temp._wid('c5')));
select pg_temp._ck('I03 the audit reports a watch overdue by more than 6 hours that nothing is holding or backing off (one), and NOT one that is backing off or one that is leased',
  (select violations = 1 from public.property_watch_integrity() where check_name = 'overdue_watches'),
  (select violations::text from public.property_watch_integrity() where check_name = 'overdue_watches'));
select pg_temp._run('i seen old', format($$insert into public.property_watch_seen (watch_id, project_id, event_type, observed_at) values (%L, 'proj-stale', 'status_changed', now() - interval '110 days')$$, pg_temp._wid('c3')));
select pg_temp._ck('I04 the audit reports a told-about row kept past its time (110 days old, beyond the 100 days plus a day of grace)',
  (select violations = 1 from public.property_watch_integrity() where check_name = 'seen_past_keep'), (select violations::text from public.property_watch_integrity() where check_name = 'seen_past_keep'));

-- ---- V  privacy ------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('V01 nothing of the private values appears in anything the watch layer holds or returns (both tables, the list, the claim, the audit, scanned as text) — and the same scan DOES find the address in the private layer, so a leak would have been found the same way',
  (select bool_and(position(lower(v) in lower(
        coalesce((select string_agg(row_to_json(w)::text, ' ') from public.property_watch w), '') || ' '
     || coalesce((select string_agg(row_to_json(s)::text, ' ') from public.property_watch_seen s), '') || ' '
     || coalesce((select string_agg(row_to_json(l)::text, ' ') from public.evaluation_property_watches_of(pg_temp._u(1)) l), '') || ' '
     || coalesce((select string_agg(row_to_json(l)::text, ' ') from public.evaluation_property_watches_of(pg_temp._u(8)) l), '') || ' '
     || coalesce((select string_agg(row_to_json(i)::text, ' ') from public.property_watch_integrity() i), '') || ' '
     || coalesce((select string_agg(row_to_json(w)::text, ' ') from _w w), ''))) = 0)
     from unnest(array['1 Centre Street', 'New York, NY', '1 CENTRE ST', '40.712980288068', '-74.003758107366', 'nyc:1001387', 'Smith listing', 'Fox Road', '22 Birch Lane', 'Jones buyers']) v)
  and (select count(*) >= 5 from unnest(array['1 Centre Street', '1 CENTRE ST', '40.712980288068', 'nyc:1001387', 'Smith listing']) v
        where position(lower(v) in lower((select string_agg(row_to_json(p)::text, ' ') from public.report_private_context p))) > 0),
  null);
select pg_temp._ck('V02 the watch layer changed no snapshot and no private VALUE: every snapshot row is byte-identical to what it was before the first watch, every context that is still active holds exactly the address, coordinates, keys and label it held, and the ONLY contexts purged are the two this suite purged on purpose (a watch never purges or edits anything)',
  (select untouched from _base) = pg_temp._untouched()
  and not exists (select 1 from public.report_private_context c join _basectx b using (context_id) where c.state = 'active' and pg_temp._ctxhash(c) <> b.h)
  and (select count(*) = 29 from public.report_private_context c join _basectx b using (context_id) where c.state = 'active')
  and (select count(*) = 2 from public.report_private_context where state = 'purged'),
  (select count(*)::text from public.report_private_context where state = 'purged'));
select pg_temp._ck('V03 every need the watch layer wrote is a `follow` need whose ref is a random watch id (36 characters, a uuid): no ref is, or contains, an address, a label, a name or an email',
  (select bool_and(ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') from public.report_private_context_need where kind = 'follow')
  and (select count(*) >= 20 from public.report_private_context_need where kind = 'follow'),
  (select count(*)::text from public.report_private_context_need where kind = 'follow'));
select pg_temp._ck('V04 the private layer''s audit log still carries only kinds: it holds need_opened / need_closed / grace events for these watches, with no text column that could hold a value',
  (select count(*) >= 20 from public.report_private_context_event where kind = 'need_opened' and need_kind = 'follow')
  and (select count(*) >= 5 from public.report_private_context_event where kind = 'need_closed' and need_kind = 'follow'),
  (select count(*)::text from public.report_private_context_event where need_kind = 'follow'));

select pg_temp._ck('S99 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok')
  and (select count(*) = 12 from _i where report_id is not null and label in ('a1', 'a2', 'a3', 'a4', 'b1', 'g1', 'd1', 'e1', 'h1', 'h2', 'h3', 'h4'))
  and (select count(*) = 20 from _i where report_id is not null and label ~ '^f[0-9]+$'),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
