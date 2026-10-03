-- =====================================================================================
-- PROPERTY WATCH SCHEDULE — EXECUTABLE ADVERSARIAL SUITE  (docs/property-watch-schedule.sql)
--
-- Development Activity build step 9, part 2: the pg_cron job that wakes the daily check, the wrapper it calls, the counts-only health read and the
-- check spliced into the one pipeline monitor. It stands on the REAL watch layer (docs/property-watch.sql) and the real account, private-context,
-- snapshot, entitlement and saved-reports layers beneath it, all applied unmutated, plus disposable stand-ins for pg_cron, pg_net, the vault and
-- the monitor (the fixtures say what each reproduces). The file under test is applied by run.sh before this suite runs.
-- Every expected answer is a HARD-CODED constant. Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

create function pg_temp._why(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;

-- run a statement AS a role; 'ok' or the SQLSTATE
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

-- ---- fixtures: one brokerage, one owner, six reports with a kept property, six watches -----------------------------------------------------
create function pg_temp._u(n int) returns uuid language sql immutable as $$ select ('a0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._k(n int) returns uuid language sql immutable as $$ select ('e0000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp._h(b text) returns text language sql immutable as $$ select encode(sha256(convert_to(b, 'UTF8')), 'hex') $$;

create temp table _e (label text primary key, evaluation_id uuid, brokerage_id uuid, invite_id uuid, token text);
create function pg_temp._mk(p_label text, p_name text) returns void language plpgsql as $$
begin
  insert into _e select p_label, c.evaluation_id, c.brokerage_id, c.invite_id, c.owner_token from public.evaluation_create(p_name) c;
end $$;
create function pg_temp._own(p_label text, p_user int) returns void language plpgsql as $$
begin
  perform 1 from public.evaluation_invite_redeem((select token from _e where label = p_label), pg_temp._u(p_user));
end $$;
create temp table _i (label text primary key, report_id uuid, ctx uuid);
create function pg_temp._iss(p_label text, p_u int, p_k int, p_priv jsonb) returns void language plpgsql as $$
declare r record; b text := format('{"product":"HomeSignal Development Activity","n":%s}', p_k);
begin
  select * into r from public.evaluation_report_issue(pg_temp._u(p_u), pg_temp._k(p_k), b, pg_temp._h(b), 'engine-v1', '{"engine":"test"}'::jsonb, p_priv);
  insert into _i values (p_label, r.report_id, r.private_context_id);
end $$;
create function pg_temp._rp(p_label text) returns uuid language sql as $$ select report_id from _i where label = p_label $$;
create function pg_temp._cx(p_label text) returns uuid language sql as $$ select ctx from _i where label = p_label $$;
create temp table _w (label text primary key, watch_id uuid);
create function pg_temp._wid(p_label text) returns uuid language sql as $$ select watch_id from _w where label = p_label $$;

select pg_temp._run('users', $$insert into auth.users (id, email) select pg_temp._u(g), 'person' || g || '@example.test' from generate_series(1, 3) g$$);
select pg_temp._run('mk', $$select pg_temp._mk('alpha', 'Acme Realty')$$);
select pg_temp._run('own', $$select pg_temp._own('alpha', 1)$$);
select pg_temp._run('issue', $x$do $d$ begin for n in 1..6 loop
  perform pg_temp._iss('r' || n, 1, n, jsonb_build_object('address', 'SCHEDMARK' || n || ' Test Road, Boise, ID 83702', 'latitude', 43.6 + n / 1000.0, 'longitude', -116.2));
end loop; end $d$$x$);
select pg_temp._run('watch', $x$do $d$ begin for n in 1..6 loop
  insert into _w select 'w' || n, s.watch_id from public.evaluation_property_watch_start(pg_temp._u(1), pg_temp._rp('r' || n)) s;
end loop; end $d$$x$);

-- put the six watches in a known, healthy state
create function pg_temp._reset() returns void language sql as $$
  update public.property_watch set next_due_at = now(), lease_until = null, retry_after = null, failure_count = 0, last_outcome = null
$$;
select pg_temp._reset();

create function pg_temp._health() returns table (watches bigint, overdue_n bigint, failing_n bigint, failing_outcomes text,
                                                invariant_breaks bigint, broken_invariants text, job_state text, cron_failing boolean)
language sql as $$ select * from public.property_watch_job_health() $$;
create function pg_temp._mon(p_name text) returns table (ok boolean, detail text) language sql as $$
  select result_ok, result_detail from public.pipeline_health_tick() where result_check = p_name
$$;
-- the monitor creates a temp table that lives to the end of its transaction, so it is run once per STATEMENT and its answer kept here
create temp table _m (label text primary key, ok boolean, detail text);

-- ---- J  the job ---------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('J01 there is ONE job, named property-watch-run, on minutes 3, 13, 23, 33, 43 and 53 of every hour, running exactly the wrapper, and active',
  (select count(*) = 1 and bool_and(schedule = '3,13,23,33,43,53 * * * *' and command = 'select public.property_watch_run_scheduled()' and active) from cron.job where jobname = 'property-watch-run')
  and (select count(*) = 1 from cron.job),
  (select string_agg(jobname || '|' || schedule || '|' || command || '|' || active::text, '; ') from cron.job));
select pg_temp._ck('J02 six wakes an hour of five watches each is 720 checks a day: more than the 25 a brokerage may hold across 28 brokerages, and a watch is checked soon after its own slot (the founder''s daily cadence is each watch''s slot, kept by the database, not this schedule)',
  array_length(string_to_array(split_part((select schedule from cron.job where jobname = 'property-watch-run'), ' ', 1), ','), 1) * 5 * 24 = 720,
  (select schedule from cron.job where jobname = 'property-watch-run'));

-- ---- W  the wrapper pg_cron calls ---------------------------------------------------------------------------------------------------------------
create function pg_temp._tryrun() returns text language plpgsql as $$
begin
  perform public.property_watch_run_scheduled();
  return 'ok';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
delete from net.calls;
select pg_temp._run('call', $$select pg_temp._tryrun()$$);
select pg_temp._ck('W01 the wrapper makes exactly ONE request: a POST to run-property-watch, claiming 5 watches, with the project''s public key at the gateway and the vault secret in x-signup-secret',
  (select count(*) = 1 from net.calls)
  and (select url = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/run-property-watch'
         and body = '{"limit": 5}'::jsonb and timeout_milliseconds = 150000
         and headers->>'x-signup-secret' = 'S3CR3T-vault-value'
         and headers->>'apikey' = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U'
         and headers->>'Authorization' = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF3bm5tbGp1Y2FqbmV4cHhkZ3hyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTAyOTgsImV4cCI6MjA5NTk4NjI5OH0.prpXB6lSIhWMAsdkkaxAfkvEodbojfUUyN4L4JbQE1U'
         and headers->>'Content-Type' = 'application/json'
         from net.calls),
  (select url || ' ' || body::text from net.calls limit 1));
select pg_temp._ck('W02 the secret goes only in the header: it appears in no URL and not in the body',
  (select count(*) = 1 and bool_and(position('S3CR3T' in url) = 0 and position('S3CR3T' in body::text) = 0) from net.calls), null);
-- decode defensively: a key that is not a JWT must FAIL the check by name, not end the suite
create function pg_temp._jwt_role(p_jwt text) returns text language plpgsql as $$
begin
  return convert_from(decode(rpad(translate(split_part(p_jwt, '.', 2), '-_', '+/'), ((length(split_part(p_jwt, '.', 2)) + 3) / 4) * 4, '='), 'base64'), 'UTF8')::jsonb->>'role';
exception when others then
  return null;
end $$;
select pg_temp._ck('W03 the public key is a key with role "anon": decoded, it carries no authority the site''s pages do not already hand every visitor',
  (select pg_temp._jwt_role(headers->>'apikey') = 'anon' from net.calls limit 1), null);

delete from net.calls;
update vault.decrypted_secrets set decrypted_secret = null where name = 'signup_hook_secret';
create temp table _t (label text primary key, res text);
insert into _t values ('null', pg_temp._tryrun());
update vault.decrypted_secrets set decrypted_secret = '   ' where name = 'signup_hook_secret';
insert into _t values ('blank', pg_temp._tryrun());
delete from vault.decrypted_secrets where name = 'signup_hook_secret';
insert into _t values ('absent', pg_temp._tryrun());
select pg_temp._ck('W04 with the secret absent, null or blank the wrapper RAISES 28000 and makes no request (a missing secret is a failed run the monitor can see, never a request that goes out unauthenticated)',
  (select count(*) = 3 and bool_and(res like '28000:%') from _t) and (select count(*) = 0 from net.calls),
  (select string_agg(label || '=' || res, ' | ') from _t));
insert into vault.decrypted_secrets values ('signup_hook_secret', 'S3CR3T-vault-value');

select pg_temp._ck('W05 the wrapper is executable by its owner and nobody else: not anon, not authenticated, not service_role, not PUBLIC (asked of the privilege catalog)',
  not has_function_privilege('anon', 'public.property_watch_run_scheduled()', 'execute') and not has_function_privilege('authenticated', 'public.property_watch_run_scheduled()', 'execute')
  and not has_function_privilege('service_role', 'public.property_watch_run_scheduled()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.proname = 'property_watch_run_scheduled' and a.grantee = 0),
  (select proacl::text from pg_proc where proname = 'property_watch_run_scheduled'));
select pg_temp._ck('W06 and CALLED as anon and authenticated it is refused (42501)',
  pg_temp._as('anon', 'select public.property_watch_run_scheduled()') = '42501' and pg_temp._as('authenticated', 'select public.property_watch_run_scheduled()') = '42501', null);
select pg_temp._ck('W07 the health read is executable by service_role and by no other role',
  has_function_privilege('service_role', 'public.property_watch_job_health()', 'execute') and not has_function_privilege('anon', 'public.property_watch_job_health()', 'execute')
  and not has_function_privilege('authenticated', 'public.property_watch_job_health()', 'execute')
  and not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.proname = 'property_watch_job_health' and a.grantee = 0), null);
select pg_temp._ck('W08 the two functions are SECURITY DEFINER with a pinned search_path',
  (select count(*) = 2 and bool_and(prosecdef and proconfig is not null and exists (select 1 from unnest(proconfig) c where c like 'search_path=%')) from pg_proc where proname in ('property_watch_run_scheduled', 'property_watch_job_health')), null);

-- ---- H  the health read: each defect, beside a healthy control --------------------------------------------------------------------------------------
select pg_temp._ck('H01 on the healthy state: six watches (the control is not zero), none overdue, none failing, no invariant broken, the job ok and its runs not failing',
  (select watches = 6 and overdue_n = 0 and failing_n = 0 and failing_outcomes = '' and invariant_breaks = 0 and broken_invariants = '' and job_state = 'ok' and not cron_failing from pg_temp._health()),
  (select row_to_json(h)::text from pg_temp._health() h));
insert into _m select 'healthy', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('H02 the monitor reads OK on the healthy state, is ALERTABLE, and says what it checked',
  (select ok and detail = 'check job active; 6 watch(es); none more than 6 hours overdue; none failing; no watch invariant broken' from _m where label = 'healthy')
  and (select alertable from public.pipeline_health_check where check_name = 'property_watch_run'),
  (select detail from _m where label = 'healthy'));

-- overdue: only a watch that is more than 6 hours past its slot AND not leased AND not backing off
update public.property_watch set next_due_at = now() - interval '7 hours' where watch_id = pg_temp._wid('w1');        -- overdue
update public.property_watch set next_due_at = now() - interval '5 hours' where watch_id = pg_temp._wid('w2');        -- late, not yet overdue
update public.property_watch set next_due_at = now() - interval '7 hours', lease_until = now() + interval '5 minutes' where watch_id = pg_temp._wid('w3');   -- being checked
update public.property_watch set next_due_at = now() - interval '7 hours', retry_after = now() + interval '1 hour' where watch_id = pg_temp._wid('w4');      -- backing off
select pg_temp._ck('H03 a watch more than 6 hours overdue is counted; one 5 hours late, one that is leased and one that is backing off are not (the harm is "nobody is checking it")',
  (select overdue_n = 1 from pg_temp._health()), (select overdue_n::text from pg_temp._health()));
insert into _m select 'overdue', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('H04 and the monitor FAILS, saying how many, with fixed words and no property',
  (select not ok and detail = '1 watch(es) are more than 6 hours overdue and nothing is holding them' from _m where label = 'overdue'),
  (select detail from _m where label = 'overdue'));
select pg_temp._reset();

-- failing: three failed checks in a row, by outcome
update public.property_watch set failure_count = 3, last_outcome = 'EMAIL_FAILED', retry_after = now() + interval '1 hour' where watch_id = pg_temp._wid('w1');
update public.property_watch set failure_count = 5, last_outcome = 'READ_FAILED', retry_after = now() + interval '1 hour' where watch_id in (pg_temp._wid('w2'), pg_temp._wid('w3'));
update public.property_watch set failure_count = 2, last_outcome = 'READ_FAILED', retry_after = now() + interval '1 hour' where watch_id = pg_temp._wid('w4');
select pg_temp._ck('H05 a watch is failing at its THIRD failed check in a row, not its second: three watches counted, grouped by outcome name',
  (select failing_n = 3 and failing_outcomes = 'EMAIL_FAILED x1, READ_FAILED x2' from pg_temp._health()), (select failing_n::text || ' ' || failing_outcomes from pg_temp._health()));
insert into _m select 'failing', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('H06 and the monitor FAILS naming the outcomes and nothing else about them',
  (select not ok and detail = '3 watch(es) failed their last 3 or more checks (EMAIL_FAILED x1, READ_FAILED x2)' from _m where label = 'failing'),
  (select detail from _m where label = 'failing'));
select pg_temp._reset();

-- an invariant: a follow need closed behind the watch's back
select pg_temp._run('close need', format($$select public.report_private_context_need_close(%L, 'follow', %L)$$, pg_temp._cx('r5'), pg_temp._wid('w5')::text));
select pg_temp._ck('H07 a watch whose follow need was closed behind its back is an invariant break, named',
  (select invariant_breaks = 1 and broken_invariants = 'watch_without_open_follow_need' from pg_temp._health()), (select broken_invariants from pg_temp._health()));
insert into _m select 'invariant', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('H08 and the monitor FAILS saying so',
  (select not ok and detail = '1 watch invariant violation(s): watch_without_open_follow_need' from _m where label = 'invariant'),
  (select detail from _m where label = 'invariant'));
select pg_temp._run('reopen need', format($$select public.report_private_context_need_open(%L, 'follow', %L)$$, pg_temp._cx('r5'), pg_temp._wid('w5')::text));
select pg_temp._ck('H09 once the need is open again the invariant reads clean (the break was the need, not the check)',
  (select invariant_breaks = 0 from pg_temp._health()), (select invariant_breaks::text from pg_temp._health()));

-- the job's state
create temp table _js (label text primary key, state text);
update cron.job set active = false where jobname = 'property-watch-run';
insert into _js select 'inactive', job_state from pg_temp._health();
insert into _m select 'inactive', ok, detail from pg_temp._mon('property_watch_run');
update cron.job set active = true, command = 'select 1' where jobname = 'property-watch-run';
insert into _js select 'wrong_command', job_state from pg_temp._health();
insert into _m select 'wrong_command', ok, detail from pg_temp._mon('property_watch_run');
create temp table _jobsave as select * from cron.job where jobname = 'property-watch-run';
delete from cron.job where jobname = 'property-watch-run';
insert into _js select 'missing', job_state from pg_temp._health();
insert into _m select 'missing', ok, detail from pg_temp._mon('property_watch_run');
insert into cron.job (jobid, schedule, command, nodename, nodeport, database, username, active, jobname)
  select jobid, schedule, 'select public.property_watch_run_scheduled()', nodename, nodeport, database, username, true, jobname from _jobsave;
insert into _js select 'ok', job_state from pg_temp._health();
insert into _m select 'job back', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('H10 the job''s state is reported as missing, inactive or wrong_command, and the monitor FAILS for each with the same words; once it is back it reads ok',
  (select state = 'inactive' from _js where label = 'inactive') and (select not ok and detail like 'pg_cron job property-watch-run is inactive — watched properties are not being checked%' from _m where label = 'inactive')
  and (select state = 'wrong_command' from _js where label = 'wrong_command') and (select not ok and detail like 'pg_cron job property-watch-run is wrong_command%' from _m where label = 'wrong_command')
  and (select state = 'missing' from _js where label = 'missing') and (select not ok and detail like 'pg_cron job property-watch-run is missing%' from _m where label = 'missing')
  and (select state = 'ok' from _js where label = 'ok') and (select ok and detail like 'check job active;%' from _m where label = 'job back'),
  (select string_agg(label || '=' || state, '; ') from _js));

-- the job's own runs: all of the newest three failed
insert into cron.job_run_details (jobid, status, start_time) select jobid, 'failed', now() - interval '3 minutes' from cron.job where jobname = 'property-watch-run';
insert into cron.job_run_details (jobid, status, start_time) select jobid, 'failed', now() - interval '2 minutes' from cron.job where jobname = 'property-watch-run';
create temp table _cr (label text primary key, failing boolean);
insert into _cr select 'two failed', (select cron_failing from pg_temp._health());
insert into cron.job_run_details (jobid, status, start_time) select jobid, 'failed', now() - interval '1 minute' from cron.job where jobname = 'property-watch-run';
insert into _cr select 'three failed', (select cron_failing from pg_temp._health());
insert into cron.job_run_details (jobid, status, start_time) select jobid, 'succeeded', now() from cron.job where jobname = 'property-watch-run';
insert into _cr select 'last succeeded', (select cron_failing from pg_temp._health());
select pg_temp._ck('H11 the runs are failing only when the NEWEST THREE all failed: two failed is not enough, three is, and one success after them clears it',
  (select not failing from _cr where label = 'two failed') and (select failing from _cr where label = 'three failed') and (select not failing from _cr where label = 'last succeeded'),
  (select string_agg(label || '=' || failing::text, '; ') from _cr));
delete from cron.job_run_details;
insert into cron.job_run_details (jobid, status, start_time) select jobid, 'failed', now() - (g || ' minutes')::interval from cron.job, generate_series(1, 3) g where jobname = 'property-watch-run';
insert into _m select 'cron failing', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('H12 and the monitor FAILS when the last three runs failed to start',
  (select not ok and detail = 'the last 3 runs of property-watch-run failed to start' from _m where label = 'cron failing'), (select detail from _m where label = 'cron failing'));
delete from cron.job_run_details;

-- several defects at once are all reported
update public.property_watch set next_due_at = now() - interval '7 hours' where watch_id = pg_temp._wid('w1');
update public.property_watch set failure_count = 4, last_outcome = 'NO_RECIPIENT', retry_after = now() + interval '1 hour' where watch_id = pg_temp._wid('w2');
update cron.job set active = false where jobname = 'property-watch-run';
insert into _m select 'several', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('H13 several defects are all reported in one detail, in a fixed order, with fixed words',
  (select not ok and detail = 'pg_cron job property-watch-run is inactive — watched properties are not being checked; 1 watch(es) are more than 6 hours overdue and nothing is holding them; 1 watch(es) failed their last 3 or more checks (NO_RECIPIENT x1)' from _m where label = 'several'),
  (select detail from _m where label = 'several'));
update cron.job set active = true where jobname = 'property-watch-run';
select pg_temp._reset();

-- ---- M  a check that cannot run is a FAILING check, and never stops the other checks ---------------------------------------------------------------
-- a tick that RAISES must fail the check by name, not end the suite: the tick is run inside a function that records the error
create function pg_temp._tick_try(p_label text) returns void language plpgsql as $$
begin
  insert into _m select p_label, result_ok, result_detail from public.pipeline_health_tick() where result_check = 'property_watch_run';
exception when others then
  insert into _m values (p_label, null, 'the monitor itself raised ' || sqlstate);
end $$;
update public.pipeline_health_check set updated_at = now() - interval '1 hour' where check_name = 'other_check';
alter function public.property_watch_job_health() rename to property_watch_job_health_away;
select pg_temp._tick_try('cannot run');
alter function public.property_watch_job_health_away() rename to property_watch_job_health;
select pg_temp._ck('M01 when the health read cannot run the check FAILS saying so (42883 here: the function is missing), it is still alertable, and it does not hide behind a pass',
  (select ok = false and detail = 'the watch check could not run (SQLSTATE 42883) — a check that cannot run is a failing check' from _m where label = 'cannot run')
  and (select alertable from public.pipeline_health_check where check_name = 'property_watch_run'),
  (select coalesce(detail, 'null') from _m where label = 'cannot run'));
select pg_temp._ck('M02 and the monitor''s OTHER checks still ran in that same tick (a broken check can never stop the others from running)',
  (select updated_at > now() - interval '1 minute' from public.pipeline_health_check where check_name = 'other_check'), null);
insert into _m select 'restored', ok, detail from pg_temp._mon('property_watch_run');
select pg_temp._ck('M03 once the function is back the check reads OK again (the failing row was the function, not the check)',
  (select ok from _m where label = 'restored'), (select detail from _m where label = 'restored'));

-- ---- V  nothing private ------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('V01 the health read and the monitor''s detail carry no address, label, coordinate, report, watch id or user (scanned as text, with the defects above present) - and the same scan DOES find the address in the private layer, so a leak would show',
  (select not exists (select 1 from (
      select row_to_json(h)::text as t from pg_temp._health() h
      union all select detail from public.pipeline_health_check where check_name = 'property_watch_run') x
    where t ~* 'SCHEDMARK|Test Road|Boise|43\.6|-116\.2|latitude|longitude|a0000000-0000|e0000000-0000|person[0-9]@'))
  and exists (select 1 from public.report_private_context c where c.address like 'SCHEDMARK%'),
  null);

-- ---- Z  the apply changed nothing it stands on ------------------------------------------------------------------------------------------------------
select pg_temp._ck('Z01 the watches are untouched by the schedule file: six, one per report, none stopped',
  (select count(*) = 6 from public.property_watch) and (select count(distinct report_id) = 6 from public.property_watch), null);
select pg_temp._ck('S99 every setup step in this suite ran without raising',
  (select count(*) = 0 from _setup where result <> 'ok'), (select string_agg(step || ': ' || result, '; ') from _setup where result <> 'ok'));

\o
select check_name || '|' || case when pass then 't' else 'f' end || '|' || coalesce(detail, '') from _r order by n;
