-- =====================================================================================
-- BROKERAGE ACCOUNT SPINE — EXECUTABLE ADVERSARIAL SUITE  (docs/brokerage-account-spine.sql)
--
-- Order K0 of the Development Activity plan: the account tables the Agent Workspace, the Brokerage Admin and
-- Order L (evaluation, invites, entitlement) hang off. Two tables (brokerage_account, brokerage_member) and one
-- resolver (brokerage_membership_of). This suite proves the posture (empty, unreadable by anon, authenticated and
-- service_role, reached only through the resolver), the invariants (one active membership per user, closed
-- vocabularies, the last active owner of an active brokerage cannot be removed, identity and history cannot be
-- rewritten) and the resolver (an active member of an active brokerage, by user id only).
-- Every expected answer is a HARD-CODED constant, never computed by the code under test. The suite runs as the
-- table owner; refusals for the API roles are asked AS those roles (SET ROLE).
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);

create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

-- run a statement; 'ok', or SQLSTATE: message (a constraint refusal names the constraint in its message)
create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- Setup steps go through this wrapper so that a REGRESSION in the code under test becomes a FAILED CHECK, not a
-- crash that ends the suite before the checks that would have named it. S01 (last) fails if any step raised.
create temp table _setup (n serial, step text, result text);
create function pg_temp._run(p_step text, p_sql text) returns void language plpgsql as $$
begin
  execute p_sql;
  insert into _setup (step, result) values (p_step, 'ok');
exception when others then
  insert into _setup (step, result) values (p_step, sqlstate || ': ' || sqlerrm);
end $$;

-- run a statement and RECORD its outcome, so a check that depends on a state change reads a result that was already
-- produced (a state-changing call inside a check's own boolean expression would depend on evaluation order)
create temp table _w (label text primary key, result text);
create function pg_temp._do(p_label text, p_sql text) returns void language plpgsql as $$
begin
  insert into _w values (p_label, pg_temp._why(p_sql));
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

-- the first column of the first row of a query, run AS a role; 'ERR:<sqlstate>' when it raised, NULL when no row
create function pg_temp._as_val(p_role text, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  execute format('set role %I', p_role);
  begin
    execute p_sql into v;
    execute 'reset role';
    return v;
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate;
  end;
end $$;

-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public. A freshly created
-- schema here has neither, and without them every refusal below could come from the SCHEMA or from RLS rather than
-- from the object's own privileges. Set here, undone at the end.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- fixed identities (test data, not code under test)
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._b(n int) returns uuid language sql immutable as $$ select ('b0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._m(n int) returns uuid language sql immutable as $$ select ('c0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- a user's resolved membership as 'brokerage|role' (or 'none'), run as the table owner
create function pg_temp._res(n int) returns text language sql as
$$ select coalesce((select count(*) || ':' || string_agg(r.brokerage_id::text || '|' || r.role, ',') from public.brokerage_membership_of(pg_temp._u(n)) r), 'none') $$;
-- a member row's state as 'role/status'
create function pg_temp._st(k int) returns text language sql as
$$ select role || '/' || status || case when deactivated_at is null then '' else '/stamped' end from public.brokerage_member where id = pg_temp._m(k) $$;

-- ---- Z01..Z05  what the apply left behind: nothing but structure ---------------------------------------------------------
select pg_temp._ck('Z01 after the apply both tables exist and hold NO row: the file seeds nothing (the zero is real: both tables are reachable by their owner)',
  to_regclass('public.brokerage_account') is not null and to_regclass('public.brokerage_member') is not null
  and (select count(*) from public.brokerage_account) = 0 and (select count(*) from public.brokerage_member) = 0,
  null);
select pg_temp._ck('Z02 the two tables carry exactly the planned columns and no others: nothing for an address, label, client, email, domain, credit, quota, price, invite token or seat',
  (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns
    where table_schema = 'public' and table_name = 'brokerage_account')
    = 'created_at:timestamp with time zone,id:uuid,name:text,status:text'
  and (select string_agg(column_name || ':' || data_type, ',' order by column_name collate "C") from information_schema.columns
        where table_schema = 'public' and table_name = 'brokerage_member')
    = 'brokerage_id:uuid,deactivated_at:timestamp with time zone,id:uuid,joined_at:timestamp with time zone,role:text,status:text,user_id:uuid',
  (select string_agg(table_name || '.' || column_name, ',' order by table_name collate "C", column_name collate "C") from information_schema.columns
    where table_schema = 'public' and table_name like 'brokerage%'));
select pg_temp._ck('Z03 the constraints are exactly the planned ones, and the only foreign keys point at brokerage_account (no action) and auth.users (cascade)',
  (select string_agg(conname, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.brokerage_account'::regclass and contype in ('p', 'f', 'c', 'u'))
    = 'brokerage_account_name,brokerage_account_pkey,brokerage_account_status'
  and (select string_agg(conname, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.brokerage_member'::regclass and contype in ('p', 'f', 'c', 'u'))
    = 'brokerage_member_brokerage_id_fkey,brokerage_member_deactivation,brokerage_member_pkey,brokerage_member_role,brokerage_member_span,brokerage_member_status,brokerage_member_user_id_fkey'
  and (select string_agg(confrelid::regclass::text || ':' || confdeltype::text, ',' order by confrelid::regclass::text collate "C") from pg_constraint
        where conrelid = 'public.brokerage_member'::regclass and contype = 'f') = 'auth.users:c,brokerage_account:a',
  (select string_agg(conname, ',' order by conname collate "C") from pg_constraint where conrelid = 'public.brokerage_member'::regclass));
select pg_temp._ck('Z04 exactly one trigger exists on the two tables: a BEFORE UPDATE row guard on the membership table (and none on the account table)',
  (select count(*) = 1 and bool_and(tgname = 'brokerage_member_guard_trg' and tgrelid = 'public.brokerage_member'::regclass
                                    and (tgtype & 2) = 2 and (tgtype & 1) = 1 and (tgtype & 16) = 16 and (tgtype & 4) = 0 and (tgtype & 8) = 0 and (tgtype & 32) = 0)
     from pg_trigger where not tgisinternal and tgrelid in ('public.brokerage_account'::regclass, 'public.brokerage_member'::regclass)),
  (select string_agg(tgname || ':' || tgtype, ',') from pg_trigger where not tgisinternal and tgrelid in ('public.brokerage_account'::regclass, 'public.brokerage_member'::regclass)));
select pg_temp._ck('Z05 one membership per user is a UNIQUE index on user_id that covers ACTIVE rows only (so a deactivated row blocks nothing)',
  (select count(*) = 1 and bool_and(i.indisunique and pg_get_indexdef(i.indexrelid) like '%(user_id)%' and pg_get_expr(i.indpred, i.indrelid) = '(status = ''active''::text)')
     from pg_index i join pg_class c on c.oid = i.indexrelid
    where c.relname = 'brokerage_member_one_active_per_user' and i.indrelid = 'public.brokerage_member'::regclass),
  (select pg_get_indexdef(indexrelid) from pg_index where indrelid = 'public.brokerage_member'::regclass and indisunique and not indisprimary));

-- ---- setup: five brokerages, twelve people, eleven memberships ---------------------------------------------------------------
select pg_temp._run('users', format($$insert into auth.users (id, email) values
  (%L, 'owner@alpha.example'), (%L, 'agent2@alpha.example'), (%L, 'agent3@alpha.example'), (%L, 'owner@beta.example'),
  (%L, 'owner@gamma.example'), (%L, 'shared@alpha.example'), (%L, 'shared@alpha.example'), (%L, 'owner@delta.example'),
  (%L, 'agent@delta.example'), (%L, 'agent10@beta.example'), (%L, 'owner@epsilon.example'), (%L, 'agent@epsilon.example')$$,
  pg_temp._u(1), pg_temp._u(2), pg_temp._u(3), pg_temp._u(4), pg_temp._u(5), pg_temp._u(6), pg_temp._u(7), pg_temp._u(8), pg_temp._u(9), pg_temp._u(10), pg_temp._u(11), pg_temp._u(12)));
select pg_temp._run('brokerages', format($$insert into public.brokerage_account (id, name) values
  (%L, 'Alpha Realty'), (%L, 'Beta Homes'), (%L, 'Gamma Group'), (%L, 'Delta Estates'), (%L, 'Epsilon Partners')$$,
  pg_temp._b(1), pg_temp._b(2), pg_temp._b(3), pg_temp._b(4), pg_temp._b(5)));
select pg_temp._run('members', format($$insert into public.brokerage_member (id, brokerage_id, user_id, role) values
  (%L, %L, %L, 'owner'), (%L, %L, %L, 'agent'), (%L, %L, %L, 'agent'), (%L, %L, %L, 'owner'), (%L, %L, %L, 'agent'),
  (%L, %L, %L, 'owner'), (%L, %L, %L, 'owner'), (%L, %L, %L, 'agent'), (%L, %L, %L, 'agent'), (%L, %L, %L, 'owner'), (%L, %L, %L, 'agent')$$,
  pg_temp._m(1), pg_temp._b(1), pg_temp._u(1),   pg_temp._m(2), pg_temp._b(1), pg_temp._u(2),   pg_temp._m(3), pg_temp._b(1), pg_temp._u(3),
  pg_temp._m(4), pg_temp._b(2), pg_temp._u(4),   pg_temp._m(5), pg_temp._b(2), pg_temp._u(7),   pg_temp._m(6), pg_temp._b(3), pg_temp._u(5),
  pg_temp._m(7), pg_temp._b(4), pg_temp._u(8),   pg_temp._m(8), pg_temp._b(4), pg_temp._u(9),   pg_temp._m(9), pg_temp._b(2), pg_temp._u(10),
  pg_temp._m(10), pg_temp._b(5), pg_temp._u(11), pg_temp._m(11), pg_temp._b(5), pg_temp._u(12)));
select pg_temp._ck('Z06 the setup landed: five brokerages, eleven active memberships, and every one of them is an ordinary row',
  (select count(*) = 5 from public.brokerage_account) and (select count(*) = 11 and bool_and(status = 'active' and deactivated_at is null) from public.brokerage_member),
  null);

-- ---- B02  one ACTIVE membership per user ---------------------------------------------------------------------------------------
select pg_temp._ck('B02a a person who is an active member of one brokerage cannot be made an active member of another (so an invite cannot mint a second pool for them)',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'agent')$$, pg_temp._b(2), pg_temp._u(1)))
    like '23505:%brokerage_member_one_active_per_user%'
  and (select count(*) = 1 from public.brokerage_member where user_id = pg_temp._u(1)),
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'agent')$$, pg_temp._b(2), pg_temp._u(1))));
select pg_temp._ck('B02b nor a second time in the SAME brokerage, whatever the role',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'owner')$$, pg_temp._b(1), pg_temp._u(2)))
    like '23505:%brokerage_member_one_active_per_user%',
  null);
select pg_temp._run('deactivate m2', format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(2)));
select pg_temp._ck('B02c deactivating an AGENT is allowed, and stamps the row: status deactivated, a deactivation time, role untouched',
  pg_temp._st(2) = 'agent/deactivated/stamped', pg_temp._st(2));
select pg_temp._run('rejoin elsewhere', format($$insert into public.brokerage_member (id, brokerage_id, user_id, role) values (%L, %L, %L, 'agent')$$, pg_temp._m(12), pg_temp._b(2), pg_temp._u(2)));
select pg_temp._ck('B02d a DEACTIVATED row does not block joining another brokerage: the same person is now an active agent of Beta and a deactivated one of Alpha (two rows)',
  pg_temp._st(12) = 'agent/active' and pg_temp._st(2) = 'agent/deactivated/stamped'
  and (select count(*) = 2 from public.brokerage_member where user_id = pg_temp._u(2)),
  null);
select pg_temp._ck('B02e ...and while that second membership is active, going back to the first brokerage is refused',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'agent')$$, pg_temp._b(1), pg_temp._u(2)))
    like '23505:%brokerage_member_one_active_per_user%',
  null);
select pg_temp._run('leave beta', format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(12)));
select pg_temp._run('rejoin alpha', format($$insert into public.brokerage_member (id, brokerage_id, user_id, role) values (%L, %L, %L, 'agent')$$, pg_temp._m(13), pg_temp._b(1), pg_temp._u(2)));
select pg_temp._ck('B02f a person who left and returns is a NEW membership row: three rows for them, exactly one active, the two deactivated ones untouched',
  (select count(*) = 3 and count(*) filter (where status = 'active') = 1 and count(*) filter (where status = 'deactivated') = 2 from public.brokerage_member where user_id = pg_temp._u(2))
  and pg_temp._st(13) = 'agent/active' and pg_temp._st(2) = 'agent/deactivated/stamped' and pg_temp._st(12) = 'agent/deactivated/stamped',
  null);
select pg_temp._ck('B02g a deactivated membership is TERMINAL: it cannot be reactivated (a returning person is a new row), and the row stays as it was',
  pg_temp._why(format($$update public.brokerage_member set status = 'active', deactivated_at = null where id = %L$$, pg_temp._m(2))) like '55000:%terminal%'
  and pg_temp._why(format($$update public.brokerage_member set role = 'owner' where id = %L$$, pg_temp._m(2))) like '55000:%terminal%'
  and pg_temp._st(2) = 'agent/deactivated/stamped',
  pg_temp._why(format($$update public.brokerage_member set status = 'active', deactivated_at = null where id = %L$$, pg_temp._m(2))));
select pg_temp._ck('B02h across the whole table no person has two ACTIVE rows, beside a control that the same query WOULD find someone with several rows (so the zero is not an empty read)',
  not exists (select 1 from public.brokerage_member where status = 'active' group by user_id having count(*) > 1)
  and exists (select 1 from public.brokerage_member group by user_id having count(*) > 1),
  null);

-- ---- B03  closed vocabularies and the shape of a row ---------------------------------------------------------------------------
select pg_temp._ck('B03a a role other than owner or agent is refused, in any spelling, and null is refused',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'admin')$$, pg_temp._b(1), pg_temp._u(6))) like '23514:%brokerage_member_role%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'Owner')$$, pg_temp._b(1), pg_temp._u(6))) like '23514:%brokerage_member_role%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, null)$$, pg_temp._b(1), pg_temp._u(6))) like '23502:%'
  and pg_temp._why(format($$update public.brokerage_member set role = 'viewer' where id = %L$$, pg_temp._m(3))) like '23514:%brokerage_member_role%',
  null);
select pg_temp._ck('B03b a membership status other than active or deactivated is refused, in any spelling (asked with a deactivation time set, so the status vocabulary is the only rule that can refuse it)',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role, status, deactivated_at) values (%L, %L, 'agent', 'pending', now())$$, pg_temp._b(1), pg_temp._u(6))) like '23514:%brokerage_member_status%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role, status, deactivated_at) values (%L, %L, 'agent', 'ACTIVE', now())$$, pg_temp._b(1), pg_temp._u(6))) like '23514:%brokerage_member_status%'
  and pg_temp._why(format($$update public.brokerage_member set status = 'invited', deactivated_at = now() where id = %L$$, pg_temp._m(3))) like '23514:%brokerage_member_status%'
  and pg_temp._st(3) = 'agent/active',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role, status, deactivated_at) values (%L, %L, 'agent', 'pending', now())$$, pg_temp._b(1), pg_temp._u(6))));
select pg_temp._ck('B03c a brokerage status other than active, suspended or closed is refused, and so is a blank or null name',
  pg_temp._why($$insert into public.brokerage_account (name, status) values ('X', 'paused')$$) like '23514:%brokerage_account_status%'
  and pg_temp._why($$insert into public.brokerage_account (name, status) values ('X', 'Active')$$) like '23514:%brokerage_account_status%'
  and pg_temp._why($$insert into public.brokerage_account (name) values ('')$$) like '23514:%brokerage_account_name%'
  and pg_temp._why($$insert into public.brokerage_account (name) values ('   ')$$) like '23514:%brokerage_account_name%'
  and pg_temp._why($$insert into public.brokerage_account (name) values (null)$$) like '23502:%',
  null);
select pg_temp._ck('B03d a membership is active exactly when it has no deactivation time: an active row with one, a deactivated row without one, and a deactivation before the join are all refused',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role, status, deactivated_at) values (%L, %L, 'agent', 'active', now())$$, pg_temp._b(1), pg_temp._u(6))) like '23514:%brokerage_member_deactivation%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role, status) values (%L, %L, 'agent', 'deactivated')$$, pg_temp._b(1), pg_temp._u(6))) like '23514:%brokerage_member_deactivation%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role, status, joined_at, deactivated_at) values (%L, %L, 'agent', 'deactivated', now(), now() - interval '1 day')$$, pg_temp._b(1), pg_temp._u(6))) like '23514:%brokerage_member_span%',
  null);
select pg_temp._ck('B03e the memberships cannot point at a person or a brokerage that does not exist',
  pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'agent')$$, pg_temp._b(1), pg_temp._u(99))) like '23503:%'
  and pg_temp._why(format($$insert into public.brokerage_member (brokerage_id, user_id, role) values (%L, %L, 'agent')$$, pg_temp._b(99), pg_temp._u(6))) like '23503:%'
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(6)),
  null);

-- ---- B04  the last active owner, identity, history, deletion ---------------------------------------------------------------------
select pg_temp._ck('B04a the LAST active owner of an active brokerage cannot be deactivated, and the refusal changes nothing',
  pg_temp._why(format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(1))) like '55000:%last active owner%'
  and pg_temp._st(1) = 'owner/active',
  pg_temp._why(format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(1))));
select pg_temp._ck('B04b ...nor demoted to agent, nor both at once',
  pg_temp._why(format($$update public.brokerage_member set role = 'agent' where id = %L$$, pg_temp._m(1))) like '55000:%last active owner%'
  and pg_temp._why(format($$update public.brokerage_member set role = 'agent', status = 'deactivated' where id = %L$$, pg_temp._m(1))) like '55000:%last active owner%'
  and pg_temp._st(1) = 'owner/active',
  null);
select pg_temp._ck('B04c the guard is per brokerage: Alpha having an owner does not let Beta lose its only one',
  pg_temp._why(format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(4))) like '55000:%last active owner%'
  and pg_temp._st(4) = 'owner/active',
  null);
select pg_temp._run('promote m3', format($$update public.brokerage_member set role = 'owner' where id = %L$$, pg_temp._m(3)));
select pg_temp._do('B04d deactivate m1', format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(1)));
select pg_temp._ck('B04d an agent can be promoted to owner, and with two owners ONE of them can be deactivated',
  pg_temp._st(3) = 'owner/active'
  and (select result from _w where label = 'B04d deactivate m1') = 'ok'
  and pg_temp._st(1) = 'owner/deactivated/stamped',
  pg_temp._st(1) || ' / ' || (select result from _w where label = 'B04d deactivate m1'));
select pg_temp._ck('B04e a DEACTIVATED owner is not "another owner": the one who is left is now the last, and can be neither deactivated nor demoted',
  pg_temp._why(format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(3))) like '55000:%last active owner%'
  and pg_temp._why(format($$update public.brokerage_member set role = 'agent' where id = %L$$, pg_temp._m(3))) like '55000:%last active owner%'
  and pg_temp._st(3) = 'owner/active',
  null);
select pg_temp._run('close gamma', format($$update public.brokerage_account set status = 'closed' where id = %L$$, pg_temp._b(3)));
select pg_temp._run('suspend delta', format($$update public.brokerage_account set status = 'suspended' where id = %L$$, pg_temp._b(4)));
select pg_temp._do('B04f deactivate m6', format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(6)));
select pg_temp._do('B04f deactivate m7', format($$update public.brokerage_member set status = 'deactivated' where id = %L$$, pg_temp._m(7)));
select pg_temp._ck('B04f the guard protects an ACTIVE brokerage only: a closed or a suspended brokerage can have its last owner deactivated (so an account can be wound down)',
  (select result from _w where label = 'B04f deactivate m6') = 'ok'
  and (select result from _w where label = 'B04f deactivate m7') = 'ok'
  and pg_temp._st(6) = 'owner/deactivated/stamped' and pg_temp._st(7) = 'owner/deactivated/stamped',
  (select string_agg(label || '=' || result, '; ') from _w where label like 'B04f%'));
select pg_temp._ck('B04g a membership cannot be moved or re-keyed: its id, brokerage, person and join time never change (moving is a new membership)',
  pg_temp._why(format($$update public.brokerage_member set brokerage_id = %L where id = %L$$, pg_temp._b(1), pg_temp._m(5))) like '55000:%identity columns%'
  and pg_temp._why(format($$update public.brokerage_member set user_id = %L where id = %L$$, pg_temp._u(6), pg_temp._m(5))) like '55000:%identity columns%'
  and pg_temp._why(format($$update public.brokerage_member set joined_at = now() - interval '5 days' where id = %L$$, pg_temp._m(5))) like '55000:%identity columns%'
  and pg_temp._why(format($$update public.brokerage_member set id = %L where id = %L$$, pg_temp._m(50), pg_temp._m(5))) like '55000:%identity columns%'
  and (select brokerage_id = pg_temp._b(2) and user_id = pg_temp._u(7) from public.brokerage_member where id = pg_temp._m(5)),
  null);
select pg_temp._run('dated member', format($$insert into public.brokerage_member (id, brokerage_id, user_id, role, joined_at) values (%L, %L, %L, 'agent', now() - interval '10 days')$$, pg_temp._m(14), pg_temp._b(2), pg_temp._u(6)));
select pg_temp._run('back-dated deactivation', format($$update public.brokerage_member set status = 'deactivated', deactivated_at = joined_at + interval '1 day' where id = %L$$, pg_temp._m(14)));
select pg_temp._ck('B04h the deactivation time is stamped by the database at the moment of deactivation: a caller-supplied (back-dated) time is ignored',
  (select joined_at < now() - interval '9 days' and deactivated_at > now() - interval '1 minute' and deactivated_at <= now()
     from public.brokerage_member where id = pg_temp._m(14)),
  (select joined_at::text || ' / ' || deactivated_at::text from public.brokerage_member where id = pg_temp._m(14)));
create temp table _before_delete as select count(*) as members, (select count(*) from public.brokerage_account) as brokerages from public.brokerage_member;
select pg_temp._do('B04i delete u10', format($$delete from auth.users where id = %L$$, pg_temp._u(10)));
select pg_temp._ck('B04i deleting an auth user (an account deletion, a privacy request) is never blocked, and takes exactly their membership rows with it: the brokerage and everyone else are untouched',
  (select result from _w where label = 'B04i delete u10') = 'ok'
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(10))
  and (select count(*) = (select members - 1 from _before_delete) from public.brokerage_member)
  and (select count(*) = (select brokerages from _before_delete) from public.brokerage_account)
  and pg_temp._st(4) = 'owner/active' and pg_temp._st(5) = 'agent/active',
  (select result from _w where label = 'B04i delete u10'));
select pg_temp._ck('B04j control for B04k: before any owner is deleted, no ACTIVE brokerage lacks an active owner except those the suite has not yet touched: Epsilon still has its owner',
  (select count(*) = 1 from public.brokerage_member where brokerage_id = pg_temp._b(5) and role = 'owner' and status = 'active'),
  null);
select pg_temp._do('B04k delete u11', format($$delete from auth.users where id = %L$$, pg_temp._u(11)));
select pg_temp._ck('B04k (stated outcome, default D-K4) deleting the account of the LAST active owner of an ACTIVE brokerage is not blocked either: their membership goes, and the brokerage is left active with no active owner. That state is DETECTABLE by one query, and it finds exactly Epsilon beside a control that finds the brokerages that do have an owner',
  (select result from _w where label = 'B04k delete u11') = 'ok'
  and (select count(*) = 0 from public.brokerage_member where user_id = pg_temp._u(11))
  and (select count(*) = 1 and min(a.id::text) = pg_temp._b(5)::text from public.brokerage_account a
        where a.status = 'active' and not exists (select 1 from public.brokerage_member m where m.brokerage_id = a.id and m.role = 'owner' and m.status = 'active'))
  and (select count(*) = 2 from public.brokerage_account a
        where a.status = 'active' and exists (select 1 from public.brokerage_member m where m.brokerage_id = a.id and m.role = 'owner' and m.status = 'active')),
  (select result from _w where label = 'B04k delete u11'));
select pg_temp._ck('B04l no membership row is left pointing at a person who no longer exists (the control is that there are rows to check)',
  (select count(*) > 5 from public.brokerage_member)
  and not exists (select 1 from public.brokerage_member m where not exists (select 1 from auth.users u where u.id = m.user_id)),
  null);

-- ---- B05  the resolver ----------------------------------------------------------------------------------------------------------
-- state now: Alpha (active): m3 owner (u3), m13 agent (u2), m1 and m2 deactivated. Beta (active): m4 owner (u4), m5 agent (u7),
-- m12 and m14 deactivated. Gamma (CLOSED): m6 deactivated. Delta (SUSPENDED): m7 deactivated, m8 agent (u9). Epsilon (active, no owner): m11 agent (u12).
select pg_temp._ck('B05a an active member of an active brokerage resolves to exactly their brokerage and role: owner and agent, one row each',
  pg_temp._res(3) = '1:' || pg_temp._b(1)::text || '|owner' and pg_temp._res(4) = '1:' || pg_temp._b(2)::text || '|owner'
  and pg_temp._res(7) = '1:' || pg_temp._b(2)::text || '|agent' and pg_temp._res(2) = '1:' || pg_temp._b(1)::text || '|agent',
  pg_temp._res(3) || ' ' || pg_temp._res(4) || ' ' || pg_temp._res(7) || ' ' || pg_temp._res(2));
select pg_temp._ck('B05b a person with a deactivated membership (and none active) resolves to nothing',
  pg_temp._res(1) = 'none' and pg_temp._res(6) = 'none' and pg_temp._res(5) = 'none' and pg_temp._res(8) = 'none',
  pg_temp._res(1) || ' ' || pg_temp._res(6) || ' ' || pg_temp._res(5) || ' ' || pg_temp._res(8));
create temp table _c4 as select pg_temp._res(9) as while_suspended_first;
select pg_temp._do('B05c close delta', format($$update public.brokerage_account set status = 'closed' where id = %L$$, pg_temp._b(4)));
create temp table _c5 as select pg_temp._res(9) as while_closed;
select pg_temp._do('B05c activate delta', format($$update public.brokerage_account set status = 'active' where id = %L$$, pg_temp._b(4)));
create temp table _c6 as select pg_temp._res(9) as while_active;
select pg_temp._do('B05c suspend delta', format($$update public.brokerage_account set status = 'suspended' where id = %L$$, pg_temp._b(4)));
create temp table _c7 as select pg_temp._res(9) as while_suspended;
select pg_temp._ck('B05c a person whose brokerage is not active resolves to nothing, whether it is suspended or closed, and again once it is active',
  (select count(*) = 3 and bool_and(result = 'ok') from _w where label like 'B05c%')
  and (select while_suspended_first = 'none' from _c4) and (select while_closed = 'none' from _c5) and (select while_active = '1:' || pg_temp._b(4)::text || '|agent' from _c6) and (select while_suspended = 'none' from _c7)
  and pg_temp._res(9) = 'none',
  (select while_closed || ' / ' || while_active || ' / ' || while_suspended from _c5, _c6, _c7));
select pg_temp._ck('B05d a user who does not exist, a deleted user and NULL resolve to nothing',
  pg_temp._res(99) = 'none' and pg_temp._res(10) = 'none' and pg_temp._res(11) = 'none'
  and (select count(*) = 0 from public.brokerage_membership_of(null)),
  null);
select pg_temp._ck('B05e membership is NEVER inferred from an email or its domain: two accounts share one address, only the member resolves; and the resolver takes a user id, nothing else',
  (select count(*) = 2 from auth.users where email = 'shared@alpha.example')
  and pg_temp._res(7) = '1:' || pg_temp._b(2)::text || '|agent' and pg_temp._res(6) = 'none'
  and (select pg_get_function_arguments(oid) = 'p_user_id uuid' and pg_get_function_result(oid) = 'TABLE(brokerage_id uuid, role text)'
         from pg_proc where oid = 'public.brokerage_membership_of(uuid)'::regprocedure),
  null);
select pg_temp._ck('B05f a brokerage left with no owner still resolves its agents: this spine invents no suspension rule (what to do is Order L''s, default D-K4)',
  pg_temp._res(12) = '1:' || pg_temp._b(5)::text || '|agent',
  pg_temp._res(12));
select pg_temp._ck('B05g across every person the resolver returns at most one row, five people resolve (Alpha 2, Beta 2, Epsilon 1), beside the memberships the table itself says are active in an active brokerage',
  (select max(c) = 1 and count(*) = 5 from (select count(*) as c from auth.users u cross join lateral public.brokerage_membership_of(u.id) group by u.id) x)
  and (select count(*) = 5 from public.brokerage_member m join public.brokerage_account a on a.id = m.brokerage_id where m.status = 'active' and a.status = 'active'),
  null);
select pg_temp._ck('B05h the resolver is STABLE and SECURITY DEFINER with a pinned search_path (it is the only function that reads the tables)',
  (select provolatile = 's' and prosecdef and coalesce(proconfig, '{}') @> array['search_path=public, pg_temp'] from pg_proc where oid = 'public.brokerage_membership_of(uuid)'::regprocedure),
  null);

-- ---- L01..L07  lock-down: system-only ------------------------------------------------------------------------------------------------
select pg_temp._ck('L01 row-level security is on for both tables, and neither carries a policy',
  (select count(*) = 2 and bool_and(relrowsecurity) from pg_class where oid in ('public.brokerage_account'::regclass, 'public.brokerage_member'::regclass))
  and not exists (select 1 from pg_policy where polrelid in ('public.brokerage_account'::regclass, 'public.brokerage_member'::regclass)),
  null);
select pg_temp._ck('L02 anon, authenticated AND service_role hold NO privilege on either table (select, insert, update, delete, truncate, references, trigger), and PUBLIC holds none',
  not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p,
                     unnest(array['public.brokerage_account', 'public.brokerage_member']) t
               where has_table_privilege(r, t, p))
  and not exists (select 1 from pg_class c, aclexplode(c.relacl) a
                   where c.oid in ('public.brokerage_account'::regclass, 'public.brokerage_member'::regclass) and a.grantee = 0),
  null);
select pg_temp._ck('L03a control: all three API roles hold USAGE on the schema, so the refusals below come from the objects and not from the schema',
  has_schema_privilege('anon', 'public', 'usage') and has_schema_privilege('authenticated', 'public', 'usage') and has_schema_privilege('service_role', 'public', 'usage'),
  null);
select pg_temp._ck('L03 AS each API role, every read and write of either table is refused with 42501 (24 attempts), while the table owner reads both (control)',
  (select count(*) = 24 and bool_and(pg_temp._as(r, s) = '42501')
     from unnest(array['anon', 'authenticated', 'service_role']) r,
          unnest(array['select count(*) from public.brokerage_account', 'select count(*) from public.brokerage_member',
                       'insert into public.brokerage_account default values', 'insert into public.brokerage_member default values',
                       'update public.brokerage_account set name = name', 'update public.brokerage_member set role = role',
                       'delete from public.brokerage_account', 'delete from public.brokerage_member']) s)
  and pg_temp._as(current_user, 'select count(*) from public.brokerage_account') = 'ok'
  and pg_temp._as(current_user, 'select count(*) from public.brokerage_member') = 'ok',
  null);
select pg_temp._ck('L04 only service_role can execute the resolver (anon, authenticated and PUBLIC cannot), and nobody can execute the guard function',
  has_function_privilege('service_role', 'public.brokerage_membership_of(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.brokerage_membership_of(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.brokerage_membership_of(uuid)', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.proname like 'brokerage\_member%' and a.grantee = 0)
  and not exists (select 1 from unnest(array['anon', 'authenticated', 'service_role']) r where has_function_privilege(r, 'public.brokerage_member_guard()', 'execute')),
  null);
select pg_temp._ck('L05 AS service_role the resolver works (and returns the right row) while the tables cannot be read; AS anon and AS authenticated the resolver is refused (42501)',
  pg_temp._as_val('service_role', format($$select brokerage_id::text || '|' || role from public.brokerage_membership_of(%L)$$, pg_temp._u(4))) = pg_temp._b(2)::text || '|owner'
  and pg_temp._as('service_role', 'select count(*) from public.brokerage_member') = '42501'
  and pg_temp._as('anon', format($$select * from public.brokerage_membership_of(%L)$$, pg_temp._u(4))) = '42501'
  and pg_temp._as('authenticated', format($$select * from public.brokerage_membership_of(%L)$$, pg_temp._u(4))) = '42501',
  pg_temp._as_val('service_role', format($$select brokerage_id::text || '|' || role from public.brokerage_membership_of(%L)$$, pg_temp._u(4))));
select pg_temp._ck('L06 exactly one function in the spine is SECURITY DEFINER (the resolver), and every function carries a pinned search_path',
  (select count(*) = 1 and min(proname) = 'brokerage_membership_of' from pg_proc where proname like 'brokerage\_member%' and prosecdef)
  and (select count(*) = 2 and bool_and(coalesce(proconfig, '{}') @> array['search_path=public, pg_temp']) from pg_proc where proname like 'brokerage\_member%'),
  (select string_agg(proname || ':' || prosecdef::text, ',') from pg_proc where proname like 'brokerage\_member%'));
select pg_temp._ck('L07 nothing else exists in the spine: the only relations named brokerage* are the two tables and their four indexes, and the only functions are the resolver and the guard (no invite, credit, seat or billing object)',
  (select string_agg(relname || ':' || relkind::text, ',' order by relname collate "C") from pg_class where relnamespace = 'public'::regnamespace and relname like 'brokerage%')
    = 'brokerage_account:r,brokerage_account_pkey:i,brokerage_member:r,brokerage_member_by_brokerage:i,brokerage_member_one_active_per_user:i,brokerage_member_pkey:i'
  and (select string_agg(proname, ',' order by proname collate "C") from pg_proc where pronamespace = 'public'::regnamespace and proname like 'brokerage%')
    = 'brokerage_member_guard,brokerage_membership_of',
  (select string_agg(relname || ':' || relkind::text, ',' order by relname collate "C") from pg_class where relnamespace = 'public'::regnamespace and relname like 'brokerage%'));

select pg_temp._ck('S01 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok') and (select count(*) >= 10 from _setup),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
