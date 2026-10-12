-- =====================================================================================
-- SAVED REPORTS: REMOVE FROM MY LIST — EXECUTABLE ADVERSARIAL SUITE  (docs/saved-reports-archive.sql)
-- Stands on the REAL account spine, private context, snapshot, evaluation entitlement, saved reports, share links, property watch, payment ledger
-- and billing SQL, applied unmutated. Every expected answer is a HARD-CODED constant, never computed by the code under test.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
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

create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;

-- users 1..5 exist; 1 = owner of Alpha, 2 = agent of Alpha, 3 = agent of Alpha (removed later), 4 = owner of Bravo, 5 = in no brokerage
insert into auth.users (id, email) select pg_temp._u(i), 'u' || i || '@example.test' from generate_series(1, 5) i;
create temp table _e (label text primary key, evaluation_id uuid, brokerage_id uuid, token text);
insert into _e select 'alpha', c.evaluation_id, c.brokerage_id, c.owner_token from public.evaluation_create('Alpha Realty') c;
insert into _e select 'bravo', c.evaluation_id, c.brokerage_id, c.owner_token from public.evaluation_create('Bravo Realty') c;
select pg_temp._run('alpha owner', $$ select 1 from public.evaluation_invite_redeem((select token from _e where label = 'alpha'), pg_temp._u(1)) $$);
select pg_temp._run('bravo owner', $$ select 1 from public.evaluation_invite_redeem((select token from _e where label = 'bravo'), pg_temp._u(4)) $$);
select pg_temp._run('alpha agent 2', $$ select 1 from public.evaluation_invite_redeem((select m.token from public.evaluation_invite_mint((select evaluation_id from _e where label = 'alpha'), 'agent') m), pg_temp._u(2)) $$);
select pg_temp._run('alpha agent 3', $$ select 1 from public.evaluation_invite_redeem((select m.token from public.evaluation_invite_mint((select evaluation_id from _e where label = 'alpha'), 'agent') m), pg_temp._u(3)) $$);

-- five reports through THE issuing entry: Alpha makes k1..k4 (k1 with a kept private context, so it can be watched), Bravo makes k5
create temp table _i (label text primary key, report_id uuid, number int);
create function pg_temp._iss(p_label text, p_u int, p_k int, p_priv jsonb default null) returns void language plpgsql as $$
declare r record; b text := format('{"product":"HomeSignal Development Activity","n":%s}', p_k);
begin
  select * into r from public.brokerage_report_issue(pg_temp._u(p_u), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, p_priv);
  insert into _i values (p_label, r.report_id, r.credit_ordinal);
end $$;
select pg_temp._run('r1', $$ select pg_temp._iss('r1', 1, 1, '{"address":"1 Centre Street, New York, NY 10007","normalized_address":"1 CENTRE ST","latitude":40.712980288068,"longitude":-74.003758107366,"property_keys":["nyc:1001387"],"label":"Smith"}'::jsonb) $$);
select pg_temp._run('r2', $$ select pg_temp._iss('r2', 2, 2) $$);
select pg_temp._run('r3', $$ select pg_temp._iss('r3', 1, 3) $$);
select pg_temp._run('r4', $$ select pg_temp._iss('r4', 2, 4) $$);
select pg_temp._run('r5', $$ select pg_temp._iss('r5', 4, 5) $$);
create function pg_temp._r(l text) returns uuid language sql as $$ select report_id from _i where label = l $$;
create function pg_temp._nums(p_user int, p_arch boolean) returns text language sql as
$$ select coalesce(string_agg(number::text, ',' order by number desc), '-') from public.saved_reports_listed(pg_temp._u(p_user), p_arch) $$;
create function pg_temp._set(p_user int, p_labels text[], p_arch boolean) returns text language plpgsql as $$
begin return public.saved_reports_archive_set(pg_temp._u(p_user), (select array_agg(pg_temp._r(l)) from unnest(p_labels) l), p_arch)::text;
exception when others then return sqlerrm; end $$;

-- fingerprints of everything the feature must NOT touch
create function pg_temp._fp() returns text language sql as $$
  select md5(
    coalesce((select string_agg(c::text, ',' order by c.evaluation_id, c.ordinal) from public.evaluation_credit c), '')
 || coalesce((select string_agg(p::text, ',' order by p.number, p.report_id) from public.brokerage_paid_credit p), '')
 || coalesce((select string_agg(s.report_id::text || s.content_hash || s.body, ',' order by s.report_id) from public.report_snapshot s), '')
 || coalesce((select string_agg(u::text, ',' order by u.evaluation_id) from public.evaluation_usage(pg_temp._u(1)) u), '')
 || coalesce((select string_agg(u::text, ',' order by u.evaluation_id) from public.evaluation_usage(pg_temp._u(4)) u), '')) $$;
create temp table _fp0 as select pg_temp._fp() as fp;
create temp table _body0 as select o.report_id, o.number, o.body from public.evaluation_report_open(pg_temp._u(1), pg_temp._r('r2')) o;

-- a share link and a watch on reports about to be removed from a list
select pg_temp._run('share r2', $$ select * from public.evaluation_report_share_create(pg_temp._u(2), pg_temp._r('r2'), repeat('a', 64)) $$);
select pg_temp._run('watch r1', $$ select * from public.evaluation_property_watch_start(pg_temp._u(1), pg_temp._r('r1')) $$);

-- ---- A. setup ------------------------------------------------------------------------
select pg_temp._ck('A1 the fixtures built: two brokerages, three Alpha members, five reports, numbered 1-4 for Alpha and 1 for Bravo',
  not exists (select 1 from _setup where result <> 'ok') and (select count(*) from _i) = 5 and pg_temp._nums(1, false) = '4,3,2,1' and pg_temp._nums(4, false) = '1',
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));
select pg_temp._ck('A2 the default list is the full ownership list and the archived list starts empty (everyone, both views)',
  pg_temp._nums(1, true) = '-' and pg_temp._nums(2, false) = '4,3,2,1' and pg_temp._nums(2, true) = '-' and pg_temp._nums(3, false) = '4,3,2,1' and pg_temp._nums(5, false) = '-');
select pg_temp._ck('A3 the list agrees with the ONE ownership reader, report for report',
  (select string_agg(report_id::text || number, ',' order by number) from public.saved_reports_listed(pg_temp._u(1), false))
  = (select string_agg(report_id::text || number, ',' order by number) from public.evaluation_reports_of(pg_temp._u(1))));

-- ---- B. one report: remove and restore --------------------------------------------------------------
select pg_temp._ck('B1 removing report 2 from user 1''s list changes ONE row', pg_temp._set(1, array['r2'], true) = '1');
select pg_temp._ck('B2 it leaves user 1''s list and is in their archived list', pg_temp._nums(1, false) = '4,3,1' and pg_temp._nums(1, true) = '2');
select pg_temp._ck('B3 the same brokerage''s other members still see it: independent lists (user 2 and user 3 unchanged)',
  pg_temp._nums(2, false) = '4,3,2,1' and pg_temp._nums(3, false) = '4,3,2,1' and pg_temp._nums(2, true) = '-');
select pg_temp._ck('B4 removing it AGAIN is a quiet no-op (0 rows changed, no error)', pg_temp._set(1, array['r2'], true) = '0');
select pg_temp._ck('B5 restoring it changes one row and the report is back with its ORIGINAL number', pg_temp._set(1, array['r2'], false) = '1' and pg_temp._nums(1, false) = '4,3,2,1' and pg_temp._nums(1, true) = '-');
select pg_temp._ck('B6 restoring it again is a quiet no-op', pg_temp._set(1, array['r2'], false) = '0');
select pg_temp._ck('B7 restoring a report that was never removed is a no-op, not an error', pg_temp._set(2, array['r3'], false) = '0');

-- ---- C. several reports: exactly the ones named -------------------------------------------------------
select pg_temp._ck('C1 removing {r1, r3} changes exactly 2 rows', pg_temp._set(1, array['r1','r3'], true) = '2');
select pg_temp._ck('C2 exactly those two are gone from user 1''s list; {r2, r4} remain', pg_temp._nums(1, false) = '4,2' and pg_temp._nums(1, true) = '3,1');
select pg_temp._ck('C3 a set with a duplicate id counts it once', pg_temp._set(1, array['r2','r2'], true) = '1' and pg_temp._nums(1, false) = '4');
select pg_temp._ck('C4 a set that is partly already removed changes only the rest', pg_temp._set(1, array['r1','r4'], true) = '1' and pg_temp._nums(1, false) = '-');
select pg_temp._ck('C5 every report archived: the default list is empty and the archived list holds all four', pg_temp._nums(1, false) = '-' and pg_temp._nums(1, true) = '4,3,2,1');
select pg_temp._ck('C6 restoring all four brings all four back', pg_temp._set(1, array['r1','r2','r3','r4'], false) = '4' and pg_temp._nums(1, false) = '4,3,2,1');
select pg_temp._ck('C7 meanwhile user 2 never moved', pg_temp._nums(2, false) = '4,3,2,1' and pg_temp._nums(2, true) = '-');

-- ---- D. fail closed -----------------------------------------------------------------------------
select pg_temp._ck('D1 another brokerage''s report is NOT_FOUND', pg_temp._set(1, array['r5'], true) = 'NOT_FOUND');
select pg_temp._ck('D2 ALL OR NOTHING: a set holding one own report and one foreign one changes nothing',
  pg_temp._set(1, array['r3','r5'], true) = 'NOT_FOUND' and pg_temp._nums(1, false) = '4,3,2,1' and pg_temp._nums(1, true) = '-');
select pg_temp._ck('D3 an unknown id is NOT_FOUND, the same answer',
  pg_temp._why($$select public.saved_reports_archive_set(pg_temp._u(1), array['99999999-9999-4999-8999-999999999999'::uuid], true)$$) like '%NOT_FOUND%');
select pg_temp._ck('D4 the other brokerage''s owner cannot remove or restore Alpha''s report',
  pg_temp._why(format($$select public.saved_reports_archive_set(pg_temp._u(4), array[%L::uuid], true)$$, pg_temp._r('r1'))) like '%NOT_FOUND%'
  and pg_temp._why(format($$select public.saved_reports_archive_set(pg_temp._u(4), array[%L::uuid], false)$$, pg_temp._r('r1'))) like '%NOT_FOUND%');
select pg_temp._ck('D5 a person in no brokerage cannot', pg_temp._set(5, array['r1'], true) = 'NOT_FOUND' and pg_temp._nums(5, true) = '-');
select pg_temp._ck('D6 an empty set, a null set and a null id are ARCHIVE_INVALID',
  pg_temp._why($$select public.saved_reports_archive_set(pg_temp._u(1), '{}'::uuid[], true)$$) like '%ARCHIVE_INVALID%'
  and pg_temp._why($$select public.saved_reports_archive_set(pg_temp._u(1), null, true)$$) like '%ARCHIVE_INVALID%'
  and pg_temp._why(format($$select public.saved_reports_archive_set(pg_temp._u(1), array[%L::uuid, null], true)$$, pg_temp._r('r1'))) like '%ARCHIVE_INVALID%'
  and pg_temp._why(format($$select public.saved_reports_archive_set(pg_temp._u(1), array[%L::uuid], null)$$, pg_temp._r('r1'))) like '%ARCHIVE_INVALID%'
  and pg_temp._why(format($$select public.saved_reports_archive_set(null, array[%L::uuid], true)$$, pg_temp._r('r1'))) like '%ARCHIVE_INVALID%');
select pg_temp._ck('D7 a set over the bound (101 distinct ids) is ARCHIVE_INVALID and changes nothing; 100 reaches the ownership check',
  pg_temp._why($$select public.saved_reports_archive_set(pg_temp._u(1), (select array_agg(gen_random_uuid()) from generate_series(1, 101)), true)$$) like '%ARCHIVE_INVALID%'
  and pg_temp._why($$select public.saved_reports_archive_set(pg_temp._u(1), (select array_agg(gen_random_uuid()) from generate_series(1, 100)), true)$$) like '%NOT_FOUND%'
  and pg_temp._nums(1, true) = '-');
select pg_temp._ck('D8 a set that repeats ONE id 101 times is one id, not over the bound',
  pg_temp._set(1, array_fill('r3'::text, array[101]), true) = '1' and pg_temp._nums(1, true) = '3');
select pg_temp._set(1, array['r3'], false);

-- ---- E. what removing from a list must NOT touch --------------------------------------------------------
select pg_temp._set(1, array['r1','r2'], true); select pg_temp._set(2, array['r1'], true); select pg_temp._set(1, array['r2'], false);
select pg_temp._ck('E1 free credits, paid credits, snapshots (body and hash) and the trial figures are byte-for-byte what they were',
  pg_temp._fp() = (select fp from _fp0), pg_temp._fp());
select pg_temp._ck('E2 the usage figures say 4 of 10 used for Alpha and 1 of 10 for Bravo, unchanged',
  (select credits_used || '/' || credits_remaining from public.evaluation_usage(pg_temp._u(1))) = '4/6' and (select credits_used || '/' || credits_remaining from public.evaluation_usage(pg_temp._u(4))) = '1/9');
select pg_temp._ck('E3 an ARCHIVED report still opens, with its original number and its stored text unchanged',
  (select count(*) from public.evaluation_report_open(pg_temp._u(1), pg_temp._r('r1')) o where o.number = 1 and o.body = format('{"product":"HomeSignal Development Activity","n":%s}', 1)) = 1
  and (select count(*) from public.evaluation_report_open(pg_temp._u(1), pg_temp._r('r2')) o, _body0 b0 where o.body = b0.body and o.number = b0.number) = 1);
select pg_temp._ck('E4 a share link made for a report on a list that no longer shows it still opens for the client, with the report it was made for',
  (select count(*) from public.report_share_open(repeat('a', 64)) o where o.report_id = pg_temp._r('r2')) = 1);
select pg_temp._ck('E5 the property watch on a removed report is still there (same watch, still listed)',
  (select count(*) from public.evaluation_property_watches_of(pg_temp._u(1)) w where w.report_id = pg_temp._r('r1')) = 1);
select pg_temp._ck('E6 a link can still be made, and a watch started, for an archived report (they are keyed on the report, not the list)',
  pg_temp._why(format($$select * from public.evaluation_report_share_create(pg_temp._u(1), %L::uuid, repeat('b', 64))$$, pg_temp._r('r1'))) = 'ok'
  and pg_temp._why(format($$select * from public.evaluation_property_watch_start(pg_temp._u(1), %L::uuid)$$, pg_temp._r('r1'))) = 'ok');
select pg_temp._ck('E7 the archive row holds two ids and a time and nothing else',
  (select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'saved_report_archive') = 'archived_at,report_id,user_id');
select pg_temp._ck('E8 exactly two rows exist at this point, one each for user 1 (r1) and user 2 (r1), and no other',
  (select count(*) from public.saved_report_archive) = 2
  and (select count(*) from public.saved_report_archive where user_id = pg_temp._u(1) and report_id = pg_temp._r('r1')) = 1
  and (select count(*) from public.saved_report_archive where user_id = pg_temp._u(2) and report_id = pg_temp._r('r1')) = 1,
  (select count(*) from public.saved_report_archive)::text);

-- ---- F. who may call it -----------------------------------------------------------------------------
select pg_temp._ck('F1 anon and authenticated cannot execute either function',
  pg_temp._as('anon', format($$select * from public.saved_reports_listed(%L::uuid, false)$$, pg_temp._u(1))) like '42501%'
  and pg_temp._as('authenticated', format($$select * from public.saved_reports_listed(%L::uuid, false)$$, pg_temp._u(1))) like '42501%'
  and pg_temp._as('anon', format($$select public.saved_reports_archive_set(%L::uuid, array[%L::uuid], true)$$, pg_temp._u(1), pg_temp._r('r1'))) like '42501%'
  and pg_temp._as('authenticated', format($$select public.saved_reports_archive_set(%L::uuid, array[%L::uuid], true)$$, pg_temp._u(1), pg_temp._r('r1'))) like '42501%');
select pg_temp._ck('F2 the service role can execute both',
  pg_temp._as('service_role', format($$select * from public.saved_reports_listed(%L::uuid, false)$$, pg_temp._u(1))) = 'ok'
  and pg_temp._as('service_role', format($$select public.saved_reports_archive_set(%L::uuid, array[%L::uuid], false)$$, pg_temp._u(1), pg_temp._r('r1'))) = 'ok');
select pg_temp._ck('F3 the table has no grant to any request role and its rows cannot be read or written directly',
  pg_temp._as('anon', 'select * from public.saved_report_archive') like '42501%' and pg_temp._as('authenticated', 'select * from public.saved_report_archive') like '42501%'
  and pg_temp._as('service_role', 'select * from public.saved_report_archive') like '42501%'
  and pg_temp._as('service_role', format($$insert into public.saved_report_archive (user_id, report_id) values (%L, %L)$$, pg_temp._u(1), pg_temp._r('r4'))) like '42501%'
  and (select relrowsecurity from pg_class where oid = 'public.saved_report_archive'::regclass));
select pg_temp._ck('F4 the list is STABLE, the writer VOLATILE, both SECURITY DEFINER with a fixed search path',
  (select string_agg(proname || ':' || provolatile::text || ':' || prosecdef::text || ':' || (proconfig::text like '%search_path=public, pg_temp%')::text, ',' order by proname)
     from pg_proc where proname in ('saved_reports_listed', 'saved_reports_archive_set') and pronamespace = 'public'::regnamespace)
  = 'saved_reports_archive_set:v:true:true,saved_reports_listed:s:true:true');
select pg_temp._ck('F5 the two functions write nowhere but the archive: no insert, update or delete on a credit, snapshot, share, watch, evaluation or brokerage table',
  (select count(*) from pg_proc where proname in ('saved_reports_listed', 'saved_reports_archive_set') and pronamespace = 'public'::regnamespace) = 2
  and (select count(*) from pg_proc where proname in ('saved_reports_listed', 'saved_reports_archive_set') and pronamespace = 'public'::regnamespace
     and prosrc ~* '(insert\s+into|update|delete\s+from)\s+(public\.)?(evaluation_credit|brokerage_paid_credit|report_snapshot|report_share|property_watch|evaluation|brokerage)') = 0);

-- ---- G. standing is checked NOW -------------------------------------------------------------------------
select pg_temp._set(3, array['r1'], true);
select pg_temp._ck('G1 user 3 has removed a report (control) and is a member', pg_temp._nums(3, true) = '1');
select pg_temp._run('remove user 3', $$ select public.brokerage_member_remove(pg_temp._u(1), (select id from public.brokerage_member where user_id = pg_temp._u(3))) $$);
select pg_temp._ck('G2 a REMOVED member sees no list, archived or not, and cannot remove or restore',
  pg_temp._nums(3, false) = '-' and pg_temp._nums(3, true) = '-' and pg_temp._set(3, array['r2'], true) = 'NOT_FOUND' and pg_temp._set(3, array['r1'], false) = 'NOT_FOUND',
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));
select pg_temp._ck('G3 the removed member''s earlier state did not leak into anyone else''s list (user 1 has all four after F2 restored r1; user 2 still has r1 removed)', pg_temp._nums(1, false) = '4,3,2,1' and pg_temp._nums(2, false) = '4,3,2', pg_temp._nums(1, false) || ' | ' || pg_temp._nums(2, false));
select pg_temp._run('revoke bravo', $$ select public.evaluation_revoke((select evaluation_id from _e where label = 'bravo')) $$);
select pg_temp._ck('G4 a REVOKED evaluation: no list and no write (NOT_FOUND), the state is kept untouched',
  pg_temp._nums(4, false) = '-' and pg_temp._set(4, array['r5'], true) = 'NOT_FOUND');
select pg_temp._ck('G5 the removed member''s own archive row survives until their account does (the state is not silently dropped)',
  (select count(*) from public.saved_report_archive where user_id = pg_temp._u(3)) = 1);

-- ---- H. a person's account takes their list state with it; nothing else -----------------------------------
select pg_temp._run('delete user 2', $$ delete from auth.users where id = pg_temp._u(2) $$);
select pg_temp._ck('H1 deleting an account deletes that person''s archive rows and no snapshot', not exists (select 1 from public.saved_report_archive where user_id = pg_temp._u(2))
  and (select count(*) from public.report_snapshot) = 5, (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));
select pg_temp._ck('H3 the references are as designed: an account''s rows go with the account (CASCADE), and a stored report is never removed by an archive row or the reverse (NO ACTION)',
  (select string_agg(confrelid::regclass::text || ':' || confdeltype::text, ',' order by confrelid::regclass::text) from pg_constraint
    where conrelid = 'public.saved_report_archive'::regclass and contype = 'f') = 'auth.users:c,report_snapshot:a');
select pg_temp._ck('H2 a stored report cannot be deleted from under an archive row',
  pg_temp._why(format($$delete from public.report_snapshot where report_id = %L$$, pg_temp._r('r1'))) <> 'ok');

-- ---- K. SETUP COMPLETENESS ----------------------------------------------------------------------------
select pg_temp._ck('S99 every setup step in this suite ran without raising',
  not exists (select 1 from _setup where result <> 'ok' and step not in ('remove user 3', 'delete user 2')) , (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

revoke usage on schema public from anon, authenticated, service_role;
\o
select check_name, pass, detail from _r order by n;
