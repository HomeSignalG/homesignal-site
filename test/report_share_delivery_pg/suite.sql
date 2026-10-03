-- =====================================================================================
-- REPORT SHARE DELIVERY — EXECUTABLE ADVERSARIAL SUITE  (docs/report-share-delivery.sql)
--
-- Development Activity build step 8: the layer that gives the share-link primitive (Order J1) an owner, an expiry and a reader. A member of
-- the brokerage that owns a stored report makes a link that lasts 6 months, lists the links of that report and revokes them; a client who
-- holds a link reads the stored report and nothing else. This suite stands on the REAL account spine, private-context layer, snapshot
-- writer, evaluation entitlement, saved-reports functions and share primitive, all applied unmutated. It proves the posture (six functions,
-- system-only, no new table or column), the 6-month lifetime, ownership (a foreign, unknown, never-stored or anonymous caller gets ONE
-- refusal), standing (an ended trial can list and revoke but not create), the cap of 25, the status being the primitive's own decision,
-- and the client read (one row when ACTIVE, zero rows otherwise and identically so, nothing of the address, label, agent or user).
-- What only two real sessions can prove (the last place under the cap, and READ COMMITTED) is in run.sh.
-- Every expected answer is a HARD-CODED constant, never computed by the code under test. The suite runs as the table owner; refusals for
-- the API roles are asked AS those roles (SET ROLE).
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

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly created schema here has neither,
-- and without them every refusal below could come from the SCHEMA or from RLS rather than from the object's own privileges.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- ---- fixtures ------------------------------------------------------------------------------------
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;

-- ten link hashes computed OUTSIDE the database (Python hashlib over the 43-character token), as in the J1 suite. The database under test
-- is only ever handed the hash, except where a check deliberately hands it a token to see it refused.
create temp table _t (n int primary key, tok text, hash text);
insert into _t values
  (1, 'eA-njyL5YEA4cX7nBOdw1mPvgYkCjOJX2O-3-zhYQII', '50db3e635f7f9cefb88df8ae86bc0edbb20f8e39a628a02c3bfe437e2541c37f'),
  (2, '8yX9GC3vlylgIcINOuEyFSG4gGTIJVpu7YlTM2hUEIA', 'ecfa94640ddb33de07ff6a0de9d4457ed01b2f80899129432815df2f8bea1757'),
  (3, 'Szw05MUxlAVsPr4LS25tJuIS349UKHVrZgd8UQL3yJI', '23e6d6c064260bf1e1f791d83eb90e0fca4802d7134dfb1896281dfe02d4488f'),
  (4, 'WJ53NYbUNKghGAkSdIF0luYn1O2Ya7DbZZTWtLILANw', '84bd7eea0294071110e2d4480fac179f354eeaa3f04f409e3fb762880b320131'),
  (5, 'tJZQBArGpfIuvPtOoU4J1_jBHe2jvndbAx5AiMHFrmc', '367165dfbf3391615c177a5e8d32bac88a23fc3efe8ccaf6111046ede5e7d3ab'),
  (6, 'UD_rpwEJJaQvt6IBnvwAmRr4vl46paNJPMLPIV18jW4', '837302b8f22e8e07ab1a92396a0259085b642e1a2ee1dfcf422bfdcd77bc172c'),
  (7, 'o8FwAMagXAOUkvpCfajwF3AZ_H_iDCQ8kCsjs4CKDMc', '3306297b151631e6440f5b381c193a1454af8baf1af567efd6283e81628b3f1c'),
  (8, 'aAJ7WuqsUM4KcNapIJq8S4a3JnH8DCaohtgrArEHQH0', '9d65da0ae64134cf0e8a2bfaaeeabde2c8041873ef5b9ec7513f531279579835'),
  (9, '-phJakwLiBJER6OXv1G1ZDlBZGAGbQzX7WRBSyr0qRM', 'dd682ddadb1e9a7baadb183a01235f6ffcbd7c6ca3925e05c807346c963e37fc'),
  (10, 'bMwKGhvyXqN8MeftgiwSBOcqeUuGW0BvcrtkKydA0ZY', 'b787053ac730bc89c3ea08bfb86bb5767c67cc0c38dac3978fdfbc4dae892b07');
create function pg_temp._hn(p_n int) returns text language sql as $$ select hash from _t where _t.n = p_n $$;
create function pg_temp._tn(p_n int) returns text language sql as $$ select tok from _t where _t.n = p_n $$;

-- the private context an agent typed for report a1: the nine values the layer keeps and the share layer must never show
create temp table _pv (name text primary key, j jsonb);
insert into _pv values
  ('p0', '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST","latitude":40.712980288068,"longitude":-74.003758107366,"property_keys":["nyc:1001387","1001387"],"label":"Acme Realty Smith listing"}');

-- evaluations by label, with the owner token evaluation_create returned (kept in a TEMP table: no permanent table holds it)
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

-- the outcome of a create call, by label
create temp table _c (label text primary key, share_id uuid, expires_at timestamptz, err text);
create function pg_temp._cr(p_label text, p_user uuid, p_report uuid, p_hash text) returns void language plpgsql as $$
declare r record;
begin
  select * into r from public.evaluation_report_share_create(p_user, p_report, p_hash);
  insert into _c values (p_label, r.share_id, r.expires_at, null);
exception when others then
  insert into _c (label, err) values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._sid(p_label text) returns uuid language sql as $$ select share_id from _c where label = p_label $$;
create function pg_temp._cerr(p_label text) returns text language sql as $$ select err from _c where label = p_label $$;

-- the outcome of a revoke call, by label: 'true' | 'false' | the SQLSTATE and message
create temp table _v (label text primary key, res text);
create function pg_temp._rv(p_label text, p_user uuid, p_share uuid) returns void language plpgsql as $$
begin
  insert into _v values (p_label, public.evaluation_report_share_revoke(p_user, p_share)::text);
exception when others then
  insert into _v values (p_label, sqlstate || ': ' || sqlerrm);
end $$;
create function pg_temp._vres(p_label text) returns text language sql as $$ select res from _v where label = p_label $$;

-- a snapshot written DIRECTLY through the real writer: a stored report that belongs to NO brokerage's ledger. The suite's own test data,
-- so the untouched-digest below leaves it out (it is what the share layer must not have changed that matters).
create temp table _direct (report_id uuid primary key);
create function pg_temp._snap(p_n int) returns uuid language plpgsql as $$
declare v_id uuid; b text := format('{"direct":%s}', p_n);
begin
  select s.report_id into v_id from public.report_snapshot_issue(b, pg_temp._h(b), 'engine-v1', '{}'::jsonb, null) s;
  insert into _direct values (v_id) on conflict do nothing;
  return v_id;
end $$;

-- a digest of everything the share layer must never change: every snapshot row and every private-context row
create function pg_temp._untouched() returns text language sql as $$
  select md5(coalesce((select string_agg(row_to_json(s)::text, ',' order by s.report_id) from public.report_snapshot s where s.report_id not in (select report_id from _direct)), '')
          || '|' || coalesce((select string_agg(row_to_json(c)::text, ',' order by c.context_id) from public.report_private_context c), ''))
$$;

-- a digest of the two share tables, to prove an open writes nothing
create function pg_temp._shares_digest() returns text language sql as $$
  select md5(coalesce((select string_agg(row_to_json(s)::text, ',' order by s.share_id) from public.report_share s), '')
          || '|' || coalesce((select string_agg(row_to_json(e)::text, ',' order by e.event_id) from public.report_share_event e), ''))
$$;

-- ---- setup: seven people, seven brokerages -----------------------------------------------------------
select pg_temp._run('users', $$insert into auth.users (id, email, raw_user_meta_data)
  select pg_temp._u(g), 'person' || g || '@example.test', jsonb_build_object('full_name', 'Person Number ' || g) from generate_series(1, 12) g$$);
select pg_temp._run('mk alpha', $$select pg_temp._mk('alpha', 'Acme Realty')$$);
select pg_temp._run('mk beta',  $$select pg_temp._mk('beta', 'Birch Homes')$$);
select pg_temp._run('mk gamma', $$select pg_temp._mk('gamma', 'Gamma Group')$$);
select pg_temp._run('mk delta', $$select pg_temp._mk('delta', 'Delta Estates')$$);
select pg_temp._run('mk echo',  $$select pg_temp._mk('echo', 'Echo Estates')$$);
select pg_temp._run('mk fox',   $$select pg_temp._mk('fox', 'Fox Company')$$);
select pg_temp._run('own alpha', $$select pg_temp._own('alpha', 1)$$);
select pg_temp._run('agent alpha', $$select pg_temp._agent('alpha', 2)$$);
select pg_temp._run('own beta',  $$select pg_temp._own('beta', 3)$$);
select pg_temp._run('own gamma', $$select pg_temp._own('gamma', 5)$$);
select pg_temp._run('own delta', $$select pg_temp._own('delta', 6)$$);
select pg_temp._run('own echo',  $$select pg_temp._own('echo', 7)$$);
select pg_temp._run('own fox',   $$select pg_temp._own('fox', 8)$$);
-- person 4 belongs to no brokerage at all

-- Alpha: a1 (with a private context), a2 (without; the cap target), a3. Beta: b1. Gamma: g1. Delta: d1. Echo: e1. Fox: twenty.
select pg_temp._run('issue alpha', $x$do $d$ begin
  perform pg_temp._iss('a1', 1, 1, (select j from _pv where name = 'p0'));
  perform pg_temp._iss('a2', 2, 2);
  perform pg_temp._iss('a3', 1, 3);
  perform pg_temp._iss('b1', 3, 4);
  perform pg_temp._iss('g1', 5, 5);
  perform pg_temp._iss('d1', 6, 6);
  perform pg_temp._iss('e1', 7, 7);
end $d$$x$);
select pg_temp._run('issue fox', $x$do $d$ begin for n in 1..20 loop perform pg_temp._iss('f' || n, 8, 100 + n); end loop; end $d$$x$);

create temp table _base (untouched text);
insert into _base select pg_temp._untouched();

-- ---- Z  what the apply left behind --------------------------------------------------------------------
select pg_temp._ck('Z01 the apply stored no share: the file seeds nothing (the zero is real: the share table exists and is read by the owner)',
  to_regclass('public.report_share') is not null and (select count(*) from public.report_share) = 0 and (select count(*) from public.report_share_event) = 0,
  null);
select pg_temp._ck('Z02 the share tables are exactly the primitive''s: no new table, and no column for an owner, an actor, a user, an email, an address or a view count (the six share columns and the four event columns are unchanged)',
  (select string_agg(relname, ',' order by relname collate "C") from pg_class where relnamespace = 'public'::regnamespace and relname like 'report\_share%' and relkind = 'r')
    = 'report_share,report_share_event'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_share')
    = 'created_at:timestamp with time zone,expires_at:timestamp with time zone,report_id:uuid,revoked_at:timestamp with time zone,share_id:uuid,token_sha256:text'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name = 'report_share_event')
    = 'at:timestamp with time zone,event_id:bigint,kind:text,share_id:uuid',
  (select string_agg(table_name || '.' || column_name, ',' order by table_name collate "C", column_name collate "C") from information_schema.columns where table_schema = 'public' and table_name like 'report\_share%'));
select pg_temp._ck('Z03 the share layer is exactly eleven functions: the primitive''s five, and the six this file adds (lifetime, limit, create, list, revoke, open) — nothing else carries either prefix',
  (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'report\_share\_%' or proname like 'evaluation\_report\_share%'))
    = 'evaluation_report_share_create,evaluation_report_share_revoke,evaluation_report_shares_of,report_share_create,report_share_event_immutable,report_share_guard,report_share_lifetime,report_share_limit,report_share_open,report_share_resolve,report_share_revoke',
  (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'report\_share\_%' or proname like 'evaluation\_report\_share%')));
select pg_temp._ck('Z04 the two numbers are the founder''s and each is written once: a link lasts 6 months, a report has at most 25 links',
  public.report_share_lifetime() = interval '6 months' and public.report_share_limit() = 25,
  public.report_share_lifetime()::text || ' / ' || public.report_share_limit()::text);

-- ---- P  the posture: system-only ------------------------------------------------------------------------
select pg_temp._ck('P01 none of the six new functions is executable by anon, authenticated or PUBLIC, and each is executable by service_role (asked of the privilege catalog, not of the file)',
  (select bool_and(not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
                   and has_function_privilege('service_role', p.oid, 'execute')
                   and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))
     from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('report_share_lifetime', 'report_share_limit', 'evaluation_report_share_create', 'evaluation_report_shares_of', 'evaluation_report_share_revoke', 'report_share_open')
      and (select count(*) from pg_proc q where q.pronamespace = 'public'::regnamespace and q.proname = p.proname) = 1),
  null);
select pg_temp._ck('P02 and CALLED as those roles they are refused (42501): anon cannot open a link, authenticated cannot make, list or revoke one, and cannot read the lifetime',
  pg_temp._as('anon', format($$select * from public.report_share_open(%L)$$, pg_temp._hn(1))) = '42501'
  and pg_temp._as('authenticated', format($$select * from public.evaluation_report_share_create(%L, %L, %L)$$, pg_temp._u(1), pg_temp._rp('a1'), pg_temp._hn(9))) = '42501'
  and pg_temp._as('authenticated', format($$select * from public.evaluation_report_shares_of(%L, %L)$$, pg_temp._u(1), pg_temp._rp('a1'))) = '42501'
  and pg_temp._as('authenticated', format($$select public.evaluation_report_share_revoke(%L, %L)$$, pg_temp._u(1), pg_temp._k(1))) = '42501'
  and pg_temp._as('anon', 'select public.report_share_lifetime()') = '42501',
  null);
select pg_temp._ck('P03 the read-only ones are STABLE, the writers are volatile, the two constants are immutable; the four that touch tables are SECURITY DEFINER (the tables are closed to their callers)',
  (select string_agg(proname || ':' || provolatile::text || ':' || prosecdef::text, ',' order by proname collate "C") from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('report_share_lifetime', 'report_share_limit', 'evaluation_report_share_create', 'evaluation_report_shares_of', 'evaluation_report_share_revoke', 'report_share_open'))
   = 'evaluation_report_share_create:v:true,evaluation_report_share_revoke:v:true,evaluation_report_shares_of:s:true,report_share_lifetime:i:false,report_share_limit:i:false,report_share_open:s:true',
  (select string_agg(proname || ':' || provolatile::text || ':' || prosecdef::text, ',' order by proname collate "C") from pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('report_share_lifetime', 'report_share_limit', 'evaluation_report_share_create', 'evaluation_report_shares_of', 'evaluation_report_share_revoke', 'report_share_open')));
select pg_temp._ck('P04 the shapes are exactly the planned ones: create takes (user, report, hash) and NO expiry; list returns five columns and no hash; open returns five columns and no share id, user, agent, address or label',
  pg_get_function_arguments('public.evaluation_report_share_create(uuid, uuid, text)'::regprocedure) = 'p_user_id uuid, p_report_id uuid, p_token_sha256 text'
  and pg_get_function_result('public.evaluation_report_share_create(uuid, uuid, text)'::regprocedure) = 'TABLE(share_id uuid, expires_at timestamp with time zone)'
  and pg_get_function_result('public.evaluation_report_shares_of(uuid, uuid)'::regprocedure)
        = 'TABLE(share_id uuid, created_at timestamp with time zone, expires_at timestamp with time zone, revoked_at timestamp with time zone, status text)'
  and pg_get_function_result('public.report_share_open(text)'::regprocedure)
        = 'TABLE(report_id uuid, generated_at timestamp with time zone, body text, private_context_id uuid, brokerage_name text)',
  pg_get_function_result('public.report_share_open(text)'::regprocedure));

-- ---- C  make a link ---------------------------------------------------------------------------------------
select pg_temp._cr('c1',  pg_temp._u(1), pg_temp._rp('a1'), pg_temp._hn(1));        -- the owner
select pg_temp._cr('c2',  pg_temp._u(2), pg_temp._rp('a1'), pg_temp._hn(2));        -- another member (an agent) of the SAME brokerage
select pg_temp._cr('c3',  pg_temp._u(3), pg_temp._rp('a1'), pg_temp._hn(3));        -- a member of ANOTHER brokerage
select pg_temp._cr('c4',  pg_temp._u(1), 'ffffffff-ffff-4fff-8fff-ffffffffffff', pg_temp._hn(3));   -- an unknown report
select pg_temp._cr('c5',  pg_temp._u(4), pg_temp._rp('a1'), pg_temp._hn(3));        -- a person with no brokerage
select pg_temp._cr('c6',  null, pg_temp._rp('a1'), pg_temp._hn(3));                 -- nobody
select pg_temp._cr('c7',  pg_temp._u(1), pg_temp._snap(1), pg_temp._hn(3));         -- a stored report that is in NO brokerage's ledger
select pg_temp._cr('c8',  pg_temp._u(1), pg_temp._rp('a1'), pg_temp._hn(1));        -- the same hash again
select pg_temp._cr('c9',  pg_temp._u(1), pg_temp._rp('a1'), pg_temp._tn(3));        -- the TOKEN itself, not its hash
select pg_temp._cr('c10', pg_temp._u(1), pg_temp._rp('a1'), null);                  -- no hash
select pg_temp._cr('c11', pg_temp._u(1), null, pg_temp._hn(3));                     -- no report

select pg_temp._ck('C01 the owner makes a link for their own brokerage''s report: one share, for that report, holding the hash they gave (never the token), live, with the expiry the call returned',
  (select err is null and share_id is not null from _c where label = 'c1')
  and (select count(*) = 1 and bool_and(s.report_id = pg_temp._rp('a1') and s.token_sha256 = pg_temp._hn(1) and s.revoked_at is null and s.expires_at = (select expires_at from _c where label = 'c1'))
         from public.report_share s where s.share_id = pg_temp._sid('c1'))
  and not exists (select 1 from public.report_share s where position(pg_temp._tn(1) in s::text) > 0),
  (select coalesce(err, share_id::text) from _c where label = 'c1'));
select pg_temp._ck('C02 the link LASTS 6 MONTHS (founder, 2026-10-03): its expiry is exactly its creation time plus six calendar months, and falls between 180 and 186 days from now',
  (select bool_and(s.expires_at = s.created_at + interval '6 months' and s.expires_at - now() between interval '180 days' and interval '186 days')
     from public.report_share s where s.share_id in (pg_temp._sid('c1'), pg_temp._sid('c2'))),
  (select string_agg((s.expires_at - s.created_at)::text, ',') from public.report_share s where s.share_id in (pg_temp._sid('c1'), pg_temp._sid('c2'))));
select pg_temp._ck('C03 any member of the owning brokerage can make one (the agent, not only the owner), and the two links are distinct shares of the same report',
  (select err is null from _c where label = 'c2') and pg_temp._sid('c1') <> pg_temp._sid('c2')
  and (select count(*) = 2 from public.report_share where report_id = pg_temp._rp('a1')),
  (select coalesce(err, share_id::text) from _c where label = 'c2'));
select pg_temp._ck('C04 NOT_FOUND, and only NOT_FOUND (EV006), for every caller who may not make the link: another brokerage''s member, an unknown report, a person with no brokerage, nobody, a report in no brokerage''s ledger, no report at all',
  (select bool_and(err = 'EV006: NOT_FOUND') from _c where label in ('c3', 'c4', 'c5', 'c6', 'c7', 'c11')),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ' order by label) from _c where label in ('c3', 'c4', 'c5', 'c6', 'c7', 'c11')));
select pg_temp._ck('C05 the refusals stored nothing: exactly two shares exist, and exactly two ''created'' events (one per share) — a refused call leaves no trace',
  (select count(*) = 2 from public.report_share) and (select count(*) = 2 and bool_and(kind = 'created') from public.report_share_event),
  (select count(*)::text from public.report_share));
select pg_temp._ck('C06 the primitive''s own refusals pass straight through and store nothing: the same hash twice (23505), the token instead of its hash (23514), no hash (23502 or 23514)',
  (select err like '23505:%' from _c where label = 'c8') and (select err like '23514:%' from _c where label = 'c9')
  and (select err like '23502:%' or err like '23514:%' from _c where label = 'c10')
  and (select count(*) = 2 from public.report_share),
  (select string_agg(label || '=' || coalesce(err, 'ok'), '; ' order by label) from _c where label in ('c8', 'c9', 'c10')));

-- ---- X  the cap: 25 ever, per report ------------------------------------------------------------------------
select pg_temp._run('cap fill', $x$do $d$ begin
  for n in 1..25 loop
    perform pg_temp._cr('x' || n, pg_temp._u(2), pg_temp._rp('a2'), pg_temp._h('cap-' || n));
  end loop;
end $d$$x$);
select pg_temp._cr('x26', pg_temp._u(1), pg_temp._rp('a2'), pg_temp._h('cap-26'));
select pg_temp._rv('xr', pg_temp._u(1), pg_temp._sid('x1'));
select pg_temp._cr('x27', pg_temp._u(1), pg_temp._rp('a2'), pg_temp._h('cap-27'));
select pg_temp._cr('c12', pg_temp._u(1), pg_temp._rp('a1'), pg_temp._hn(4));        -- another report is not held by a full one
select pg_temp._ck('X01 a report takes 25 links and the 26th is refused SHARE_LIMIT_REACHED (EV007) — and stores nothing',
  (select count(*) = 25 and bool_and(err is null) from _c where label ~ '^x([1-9]|1[0-9]|2[0-5])$')
  and (select err = 'EV007: SHARE_LIMIT_REACHED' from _c where label = 'x26')
  and (select count(*) = 25 from public.report_share where report_id = pg_temp._rp('a2')),
  (select err from _c where label = 'x26'));
select pg_temp._ck('X02 the 25 count EVERY link ever made, revoked ones included: after one is revoked the 27th is still refused (a revoked link does not free a place)',
  (select res = 'true' from _v where label = 'xr') and (select err = 'EV007: SHARE_LIMIT_REACHED' from _c where label = 'x27')
  and (select count(*) = 25 from public.report_share where report_id = pg_temp._rp('a2')),
  (select err from _c where label = 'x27'));
select pg_temp._ck('X03 the cap is per report: a full report does not stop the same brokerage sharing another (a1 took a third link while a2 was full)',
  (select err is null from _c where label = 'c12') and (select count(*) = 3 from public.report_share where report_id = pg_temp._rp('a1')),
  (select err from _c where label = 'c12'));

-- ---- L  list one report's links ---------------------------------------------------------------------------------
-- an EXPIRED link: expiry in the past is something the wrapper can never write, so it goes in directly as the table owner would
select pg_temp._run('expired link', format($$insert into public.report_share (share_id, report_id, token_sha256, created_at, expires_at)
  values (%L, %L, %L, now() - interval '7 months', now() - interval '1 month')$$, pg_temp._k(77), pg_temp._rp('a1'), pg_temp._hn(5)));
select pg_temp._rv('r2', pg_temp._u(2), pg_temp._sid('c2'));
create temp table _l1 as select * from public.evaluation_report_shares_of(pg_temp._u(1), pg_temp._rp('a1'));
create temp table _l2 as select * from public.evaluation_report_shares_of(pg_temp._u(2), pg_temp._rp('a1'));
select pg_temp._ck('L01 the owner lists the four links of their report with the primitive''s own statuses: two ACTIVE, one REVOKED, one EXPIRED',
  (select count(*) = 4 from _l1)
  and (select count(*) filter (where status = 'ACTIVE') = 2 and count(*) filter (where status = 'REVOKED') = 1 and count(*) filter (where status = 'EXPIRED') = 1 from _l1),
  (select string_agg(status, ',' order by created_at desc) from _l1));
select pg_temp._ck('L02 newest first: created_at never increases down the list, and the 7-month-old expired link is last',
  (select bool_and(created_at <= prev) from (select created_at, lag(created_at) over (order by ord) as prev from (select *, row_number() over () as ord from _l1) o) w where prev is not null)
  and (select status = 'EXPIRED' from (select *, row_number() over () as ord from _l1) o order by ord desc limit 1),
  (select string_agg(status, ',') from _l1));
select pg_temp._ck('L03 a different member of the same brokerage lists the very same four (any member sees the brokerage''s links: D-6-2)',
  (select count(*) = 4 and string_agg(share_id::text, ',' order by share_id) = (select string_agg(share_id::text, ',' order by share_id) from _l1) from _l2),
  null);
select pg_temp._ck('L04 every status listed IS the primitive''s decision: for each share, the listed status equals report_share_resolve asked of that share''s hash on its own (the list re-decides nothing)',
  (select count(*) = 4 and bool_and(l.status = (select r.status from public.report_share_resolve(s.token_sha256) r))
     from _l1 l join public.report_share s on s.share_id = l.share_id),
  (select string_agg(l.status || '/' || (select r.status from public.report_share_resolve(s.token_sha256) r), ',') from _l1 l join public.report_share s on s.share_id = l.share_id));
select pg_temp._ck('L05 an empty list, indistinguishable from "no links", for a caller who does not own the report: another brokerage''s member, a person with no brokerage, nobody, an unknown report, a report in no ledger',
  (select count(*) = 0 from public.evaluation_report_shares_of(pg_temp._u(3), pg_temp._rp('a1')))
  and (select count(*) = 0 from public.evaluation_report_shares_of(pg_temp._u(4), pg_temp._rp('a1')))
  and (select count(*) = 0 from public.evaluation_report_shares_of(null, pg_temp._rp('a1')))
  and (select count(*) = 0 from public.evaluation_report_shares_of(pg_temp._u(1), 'ffffffff-ffff-4fff-8fff-ffffffffffff'))
  and (select count(*) = 0 from public.evaluation_report_shares_of(pg_temp._u(1), pg_temp._snap(2))),
  null);
select pg_temp._ck('L06 the list is one report''s: a2''s twenty-five links are not in a1''s, and a2''s own list holds exactly its twenty-five',
  (select count(*) = 25 from public.evaluation_report_shares_of(pg_temp._u(1), pg_temp._rp('a2')))
  and not exists (select 1 from _l1 l join public.report_share s on s.share_id = l.share_id where s.report_id <> pg_temp._rp('a1')),
  null);
select pg_temp._ck('L07 the list shows no hash, no token, no report, no user: five columns only, and the hash text of no listed share appears in a row of the list',
  (select count(*) = 4 from _l1)
  and not exists (select 1 from _l1 l, public.report_share s where position(s.token_sha256 in row_to_json(l)::text) > 0)
  and (select count(*) = 5 from information_schema.columns where table_name = '_l1' and table_schema like 'pg\_temp%'),
  null);

-- ---- R  revoke ------------------------------------------------------------------------------------------------------
select pg_temp._rv('r1',  pg_temp._u(1), pg_temp._sid('c1'));        -- an owner revokes
select pg_temp._rv('r1b', pg_temp._u(1), pg_temp._sid('c1'));        -- again
select pg_temp._rv('r3',  pg_temp._u(3), pg_temp._sid('c12'));       -- another brokerage's member
select pg_temp._rv('r4',  pg_temp._u(1), pg_temp._k(555));           -- an unknown share
select pg_temp._rv('r5',  null, pg_temp._sid('c12'));                -- nobody
select pg_temp._rv('r6',  pg_temp._u(4), pg_temp._sid('c12'));       -- a person with no brokerage
select pg_temp._ck('R01 a member of the owning brokerage revokes a link: true; the second revoke is false (idempotent); the link is REVOKED; exactly one ''revoked'' event for it',
  (select res from _v where label = 'r1') = 'true' and (select res from _v where label = 'r1b') = 'false'
  and (select status = 'REVOKED' from public.evaluation_report_shares_of(pg_temp._u(1), pg_temp._rp('a1')) where share_id = pg_temp._sid('c1'))
  and (select count(*) = 1 from public.report_share_event where share_id = pg_temp._sid('c1') and kind = 'revoked'),
  (select string_agg(label || '=' || res, '; ') from _v where label in ('r1', 'r1b')));
select pg_temp._ck('R02 NOT_FOUND (EV006) for a share the caller does not own, an unknown share, nobody and a person with no brokerage — and the share they aimed at is still ACTIVE',
  (select bool_and(res = 'EV006: NOT_FOUND') from _v where label in ('r3', 'r4', 'r5', 'r6'))
  and (select status = 'ACTIVE' from public.evaluation_report_shares_of(pg_temp._u(1), pg_temp._rp('a1')) where share_id = pg_temp._sid('c12'))
  and (select count(*) = 0 from public.report_share_event where share_id = pg_temp._sid('c12') and kind = 'revoked'),
  (select string_agg(label || '=' || res, '; ' order by label) from _v where label in ('r3', 'r4', 'r5', 'r6')));
select pg_temp._ck('R03 revoking records no actor: the share tables hold no user id and no name of the agents who made or revoked a link (the nine-value needle and the two agents'' ids and names are all absent)',
  not exists (select 1 from public.report_share s where s::text ~* (pg_temp._u(1)::text || '|' || pg_temp._u(2)::text || '|person|example\.test'))
  and not exists (select 1 from public.report_share_event e where e::text ~* (pg_temp._u(1)::text || '|' || pg_temp._u(2)::text || '|person|example\.test'))
  and (select count(*) > 0 from public.report_share),
  null);

-- ---- O  the client read ------------------------------------------------------------------------------------------------
select pg_temp._cr('c13', pg_temp._u(2), pg_temp._rp('a3'), pg_temp._hn(6));         -- a3 has no private context
create temp table _o1 as select * from public.report_share_open(pg_temp._hn(2));      -- c2: REVOKED by r2 above
create temp table _o2 as select * from public.report_share_open(pg_temp._hn(4));      -- c12: ACTIVE, report a1
create temp table _o3 as select * from public.report_share_open(pg_temp._hn(6));      -- c13: ACTIVE, report a3
select pg_temp._ck('O01 an ACTIVE link opens exactly one row: the stored report text byte for byte, when it was made, its opaque context handle, and the owning brokerage''s NAME',
  (select count(*) = 1 from _o2)
  and (select body = '{"product":"HomeSignal Development Activity","n":1}' and report_id = pg_temp._rp('a1') and brokerage_name = 'Acme Realty'
          and private_context_id = (select ctx from _i where label = 'a1') and private_context_id is not null
          and generated_at = (select s.generated_at from public.report_snapshot s where s.report_id = pg_temp._rp('a1')) from _o2),
  (select body from _o2));
select pg_temp._ck('O02 a report stored with no private context opens with a NULL handle (the client page then shows the report without an address)',
  (select count(*) = 1 and bool_and(private_context_id is null and body = '{"product":"HomeSignal Development Activity","n":3}') from _o3),
  null);
select pg_temp._ck('O03 a REVOKED, an EXPIRED, an UNKNOWN link, a TOKEN where a hash belongs, an empty string and NULL all open ZERO rows, with no error — identically, so a client learns nothing about whether a link ever existed',
  (select count(*) = 0 from _o1)
  and (select count(*) = 0 from public.report_share_open(pg_temp._hn(5)))
  and (select count(*) = 0 from public.report_share_open(repeat('0', 64)))
  and (select count(*) = 0 from public.report_share_open(pg_temp._hn(10)))
  and (select count(*) = 0 from public.report_share_open(pg_temp._tn(4)))
  and (select count(*) = 0 from public.report_share_open(''))
  and (select count(*) = 0 from public.report_share_open(null)),
  null);
-- (the link goes in as its own statement: a STABLE read cannot see a row inserted by the very statement that calls it, so a create and a read
-- in one statement would read zero rows for ANY implementation and prove nothing)
select pg_temp._run('orphan link', format($$select public.report_share_create(%L, %L, null)$$, pg_temp._snap(3), pg_temp._hn(7)));
select pg_temp._ck('O04 a link made on a report that no brokerage owns (made directly through the primitive) opens NOTHING: a link does not become readable by having a snapshot — and the primitive itself calls that very link ACTIVE, so the zero is the delivery layer''s decision',
  (select status = 'ACTIVE' from public.report_share_resolve(pg_temp._hn(7))) and (select count(*) = 0 from public.report_share_open(pg_temp._hn(7))),
  null);
create temp table _d0 as select pg_temp._shares_digest() as d;
select pg_temp._run('twenty opens', $x$select count(*) from (select (public.report_share_open(h)).* from (values (pg_temp._hn(4)), (pg_temp._hn(2)), (pg_temp._hn(5)), (repeat('0', 64)), (pg_temp._hn(6))) v(h), generate_series(1, 4)) z$x$);
select pg_temp._ck('O05 opening writes nothing: twenty opens (of live, dead and unknown links), each its own statement apart from the digests, leave both share tables byte-identical',
  (select d from _d0) = pg_temp._shares_digest() and (select count(*) > 0 from public.report_share),
  null);

-- ---- E  standing, and the ways an evaluation ends -------------------------------------------------------------------------
-- Gamma: two links while the trial is live, then the trial's time runs out. It keeps what it shared and can take it back, but cannot share more.
select pg_temp._cr('g1', pg_temp._u(5), pg_temp._rp('g1'), pg_temp._h('gamma-1'));
select pg_temp._cr('g2', pg_temp._u(5), pg_temp._rp('g1'), pg_temp._h('gamma-2'));
select pg_temp._run('gamma ends', format($$update public.evaluation set expires_at = created_at + interval '1 microsecond' where evaluation_id = %L$$, pg_temp._ev('gamma')));
select pg_temp._cr('g3', pg_temp._u(5), pg_temp._rp('g1'), pg_temp._h('gamma-3'));
select pg_temp._rv('gr', pg_temp._u(5), pg_temp._sid('g2'));
select pg_temp._ck('E01 an ENDED trial (its time ran out) can no longer make a link (EV006) — but can still list its links and revoke one: a client link must never become impossible to take back',
  (select err = 'EV006: NOT_FOUND' from _c where label = 'g3')
  and (select count(*) = 2 from public.evaluation_report_shares_of(pg_temp._u(5), pg_temp._rp('g1')))
  and (select res = 'true' from _v where label = 'gr')
  and (select count(*) = 1 from public.evaluation_report_shares_of(pg_temp._u(5), pg_temp._rp('g1')) where status = 'ACTIVE'),
  (select err from _c where label = 'g3'));
select pg_temp._ck('E02 and an ended trial does NOT take back a report it already shared: the still-live link keeps opening the stored report',
  (select count(*) = 1 and bool_and(brokerage_name = 'Gamma Group') from public.report_share_open(pg_temp._h('gamma-1'))),
  null);

-- Delta: two live links, then an administrator REVOKES the evaluation. Neither link was revoked by anyone, so a link that stops opening
-- stops because of the withdrawn evaluation and for no other reason. The brokerage can still see and revoke what it shared.
select pg_temp._cr('d1', pg_temp._u(6), pg_temp._rp('d1'), pg_temp._h('delta-1'));
select pg_temp._cr('d3', pg_temp._u(6), pg_temp._rp('d1'), pg_temp._h('delta-3'));
select pg_temp._ck('E03a before the administrator acts, both links open',
  (select count(*) = 1 from public.report_share_open(pg_temp._h('delta-1'))) and (select count(*) = 1 from public.report_share_open(pg_temp._h('delta-3'))), null);
select pg_temp._run('delta revoked', format($$select public.evaluation_revoke(%L)$$, pg_temp._ev('delta')));
select pg_temp._cr('d2', pg_temp._u(6), pg_temp._rp('d1'), pg_temp._h('delta-2'));
select pg_temp._rv('dr', pg_temp._u(6), pg_temp._sid('d3'));
select pg_temp._ck('E03 an evaluation REVOKED by an administrator withdraws its links at once: a link nobody revoked (the primitive still calls it ACTIVE) now opens zero rows, no further link can be made, and the brokerage can still list and revoke what it shared',
  (select count(*) = 0 from public.report_share_open(pg_temp._h('delta-1')))
  and (select status = 'ACTIVE' from public.evaluation_report_shares_of(pg_temp._u(6), pg_temp._rp('d1')) where share_id = pg_temp._sid('d1'))
  and (select err = 'EV006: NOT_FOUND' from _c where label = 'd2')
  and (select res = 'true' from _v where label = 'dr')
  and (select count(*) = 2 from public.evaluation_report_shares_of(pg_temp._u(6), pg_temp._rp('d1'))),
  (select err from _c where label = 'd2'));

-- Echo: one live link, then the brokerage account is suspended. A link does not outlive a withdrawn account.
select pg_temp._cr('e1', pg_temp._u(7), pg_temp._rp('e1'), pg_temp._h('echo-1'));
select pg_temp._ck('E04a before the account is suspended, the link opens', (select count(*) = 1 from public.report_share_open(pg_temp._h('echo-1'))), null);
select pg_temp._run('echo suspended', format($$update public.brokerage_account set status = 'suspended' where id = %L$$, pg_temp._bk('echo')));
select pg_temp._ck('E04 a SUSPENDED brokerage''s link opens zero rows (a link does not outlive a withdrawn account), and its people can no longer make or list links',
  (select count(*) = 0 from public.report_share_open(pg_temp._h('echo-1')))
  and pg_temp._why(format($$select * from public.evaluation_report_share_create(%L, %L, %L)$$, pg_temp._u(7), pg_temp._rp('e1'), pg_temp._h('echo-2'))) like 'EV006:%'
  and (select count(*) = 0 from public.evaluation_report_shares_of(pg_temp._u(7), pg_temp._rp('e1'))),
  null);

-- Fox: the twentieth report makes the evaluation COMPLETE. Complete is a finished evaluation with standing: it still shares, and its links still open.
select pg_temp._cr('f1', pg_temp._u(8), pg_temp._rp('f1'), pg_temp._h('fox-1'));
select pg_temp._ck('E05 a COMPLETE evaluation (all twenty reports used) keeps its standing: it can make a link and the link opens',
  (select status = 'complete' from public.evaluation where evaluation_id = pg_temp._ev('fox'))
  and (select err is null from _c where label = 'f1')
  and (select count(*) = 1 and bool_and(brokerage_name = 'Fox Company') from public.report_share_open(pg_temp._h('fox-1'))),
  (select err from _c where label = 'f1'));

-- ---- V  privacy ------------------------------------------------------------------------------------------------------------
select pg_temp._ck('V01 nothing of the nine private values appears in anything these functions return for a report that HAS a private context (list, open and create outputs scanned as text) — and the same scan DOES find the address in the private layer, so a leak would have been found the same way',
  (select bool_and(position(lower(v) in lower(coalesce(
        (select string_agg(row_to_json(l)::text, ' ') from public.evaluation_report_shares_of(pg_temp._u(1), pg_temp._rp('a1')) l), '') || ' '
     || coalesce((select string_agg(row_to_json(o)::text, ' ') from public.report_share_open(pg_temp._hn(4)) o), '') || ' '
     || coalesce((select string_agg(row_to_json(c)::text, ' ') from _c c), '') || ' '
     || coalesce((select string_agg(row_to_json(s)::text, ' ') from public.report_share s), '') || ' '
     || coalesce((select string_agg(row_to_json(e)::text, ' ') from public.report_share_event e), ''))) = 0)
     from unnest(array['1 Centre Street', 'New York, NY', '1 CENTRE ST', '40.712980288068', '-74.003758107366', 'nyc:1001387', '1001387', 'Smith listing']) v)
  and (select count(*) = 8 from unnest(array['1 Centre Street', 'New York, NY', '1 CENTRE ST', '40.712980288068', '-74.003758107366', 'nyc:1001387', '1001387', 'Smith listing']) v
        where position(lower(v) in lower((select string_agg(row_to_json(p)::text, ' ') from public.report_private_context p))) > 0),
  null);
select pg_temp._ck('V02 the share layer wrote nothing to the snapshot or the private layer: every snapshot row and every private-context row is byte-identical to what it was before the first link was made',
  (select untouched from _base) = pg_temp._untouched(),
  (select untouched from _base));
select pg_temp._ck('V03 no share tables hold an agent: no share and no event row names a user, an email or a person, after every create and revoke above',
  not exists (select 1 from public.report_share s where s::text ~* ('person|example\.test|' || pg_temp._u(1)::text || '|' || pg_temp._u(2)::text || '|' || pg_temp._u(5)::text || '|' || pg_temp._u(6)::text || '|' || pg_temp._u(7)::text || '|' || pg_temp._u(8)::text))
  and not exists (select 1 from public.report_share_event e where e::text ~* ('person|example\.test|' || pg_temp._u(1)::text || '|' || pg_temp._u(2)::text || '|' || pg_temp._u(5)::text))
  and (select count(*) >= 30 from public.report_share),
  (select count(*)::text from public.report_share));

select pg_temp._ck('S01 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok')
  and (select count(*) = 7 from _i where report_id is not null and label in ('a1', 'a2', 'a3', 'b1', 'g1', 'd1', 'e1'))
  and (select count(*) = 20 from _i where report_id is not null and label ~ '^f[0-9]+$'),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
