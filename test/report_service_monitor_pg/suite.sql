-- =====================================================================================
-- THE REPORT-SERVICE EMAIL ALARM — EXECUTABLE ADVERSARIAL SUITE (docs/report-service-monitor.sql; audit item C)
-- Runs against a DISPOSABLE Postgres with a stand-in pg_cron, a stand-in pg_net and a stand-in pipeline_health_tick(),
-- with the shipped file applied once. Every expected answer is a HARD-CODED constant. Time is moved by editing
-- report_service_probe.fired_at, and the functions' answers are written by hand into net._http_response.
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;
create temp table _setup (n serial, step text, result text);

create function pg_temp._as(p_role text, p_sql text) returns text language plpgsql as $$
begin
  execute format('set role %I', p_role);
  begin execute p_sql; execute 'reset role'; return 'ok';
  exception when others then execute 'reset role'; return sqlstate; end;
end $$;
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema net to service_role;

-- one probe: p_age old; p_status null + p_timed_out false = no answer on record at all
create function pg_temp._probe(p_fn text, p_age interval, p_status int, p_content text default '{}', p_timed_out boolean default false) returns void language plpgsql as $$
declare i bigint := nextval('net.req_seq');
begin
  insert into public.report_service_probe (fn, request_id, fired_at) values (p_fn, i, now() - p_age);
  if p_status is not null or p_timed_out then
    insert into net._http_response (id, status_code, content, timed_out) values (i, p_status, p_content, p_timed_out);
  end if;
exception when others then insert into _setup (step, result) values ('probe ' || p_fn, sqlstate);
end $$;
create function pg_temp._reset() returns void language sql as $$
  delete from public.report_service_probe; delete from net._http_response; delete from net.sent;
$$;
create function pg_temp._state(p_fn text) returns text language sql as $$ select state from public.report_service_health() where fn = p_fn $$;
create function pg_temp._tick() returns void language sql as $$ select count(*) from public.pipeline_health_tick() $$;
create function pg_temp._row() returns public.pipeline_health_check language sql as $$ select * from public.pipeline_health_check where check_name = 'report_service' $$;

\set R 'get-development-activity-report'
\set B 'manage-billing'
\set W 'development-activity-billing-webhook'
\set OKW '{"configured":true}'

-- ---- F  the probe -----------------------------------------------------------------------------------------------------------------------------
select pg_temp._reset();
select public.report_service_probe_fire();
select pg_temp._ck('F01 one fire sends exactly three GETs, one to each function, to this project',
  (select count(*) = 3
      and count(*) filter (where url = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-development-activity-report') = 1
      and count(*) filter (where url = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/manage-billing') = 1
      and count(*) filter (where url = 'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/development-activity-billing-webhook') = 1
     from net.sent), null);
select pg_temp._ck('F02 each probe carries only the public key (apikey and Bearer, the same value) and a 15 second limit',
  (select bool_and(headers ? 'apikey' and headers ->> 'Authorization' = 'Bearer ' || (headers ->> 'apikey') and timeout_ms = 15000
                   and (headers ->> 'apikey') like 'eyJ%') from net.sent), null);
select pg_temp._ck('F03 each probe is logged against its request id',
  (select count(*) = 3 and count(distinct request_id) = 3 and bool_and(request_id in (select id from net.sent)) from public.report_service_probe), null);
select pg_temp._reset();
insert into public.report_service_probe (fn, request_id, fired_at) values ('manage-billing', 1, now() - interval '4 days'), ('manage-billing', 2, now() - interval '1 day');
select public.report_service_probe_fire();
select pg_temp._ck('F05 probe rows older than three days are removed on the next fire, newer ones kept',
  (select count(*) filter (where request_id = 1) = 0 and count(*) filter (where request_id = 2) = 1 from public.report_service_probe), null);

-- ---- H  the health read -------------------------------------------------------------------------------------------------------------------------
select pg_temp._reset();
select pg_temp._ck('H01 no probe at all: all three are UNKNOWN',
  (select count(*) = 3 and bool_and(state = 'unknown') from public.report_service_health()), null);
select pg_temp._probe(:'R', interval '12 minutes', 200); select pg_temp._probe(:'R', interval '2 minutes 10 seconds', 200);
select pg_temp._probe(:'B', interval '12 minutes', 200); select pg_temp._probe(:'B', interval '3 minutes', 200);
select pg_temp._probe(:'W', interval '12 minutes', 200, :'OKW'); select pg_temp._probe(:'W', interval '3 minutes', 200, :'OKW');
select pg_temp._ck('H02 two good answers each: all three ok',
  (select count(*) = 3 and bool_and(state = 'ok') from public.report_service_health()), (select string_agg(fn || '=' || state, ',') from public.report_service_health()));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '12 minutes', 500); select pg_temp._probe(:'R', interval '3 minutes', 200);
select pg_temp._ck('H03 ONE bad answer then a good one does not page', pg_temp._state(:'R') = 'ok', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '12 minutes', 200); select pg_temp._probe(:'R', interval '3 minutes', 500);
select pg_temp._ck('H04 a good answer then ONE bad one does not page (needs two in a row)', pg_temp._state(:'R') = 'ok', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '12 minutes', 500); select pg_temp._probe(:'R', interval '3 minutes', 503);
select pg_temp._ck('H05 two bad answers in a row: DOWN', pg_temp._state(:'R') = 'down', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'B', interval '12 minutes', 404); select pg_temp._probe(:'B', interval '3 minutes', 404);
select pg_temp._ck('H06 a missing function (404) is DOWN, like any status but 200', pg_temp._state(:'B') = 'down', pg_temp._state(:'B'));
select pg_temp._reset();
select pg_temp._probe(:'B', interval '12 minutes', null, null, true); select pg_temp._probe(:'B', interval '3 minutes', null, null, true);
select pg_temp._ck('H07 two timeouts in a row: DOWN', pg_temp._state(:'B') = 'down', pg_temp._state(:'B'));
select pg_temp._reset();
select pg_temp._probe(:'W', interval '12 minutes', 200, '{"configured":false}'); select pg_temp._probe(:'W', interval '3 minutes', 200, '{"configured":false}');
select pg_temp._ck('H08 the webhook answering "configured: false" twice is DOWN, and says it is not set up',
  pg_temp._state(:'W') = 'down' and (select detail like '%NOT set up%every payment event would be refused%' from public.report_service_health() where fn = :'W'),
  (select detail from public.report_service_health() where fn = :'W'));
select pg_temp._reset();
select pg_temp._probe(:'W', interval '12 minutes', 200, '{ "configured" : true }'); select pg_temp._probe(:'W', interval '3 minutes', 200, '{ "configured" : true }');
select pg_temp._ck('H09 "configured: true" is read however the JSON is spaced', pg_temp._state(:'W') = 'ok', pg_temp._state(:'W'));
select pg_temp._reset();
select pg_temp._probe(:'W', interval '12 minutes', 200, 'not json at all {{{'); select pg_temp._probe(:'W', interval '3 minutes', 200, 'not json at all {{{');
select pg_temp._ck('H10 an unreadable webhook body is DOWN and never raises', pg_temp._state(:'W') = 'down', pg_temp._state(:'W'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '41 minutes', 200); select pg_temp._probe(:'R', interval '51 minutes', 200);
select pg_temp._ck('H11 the newest probe older than 40 minutes: STALE (the probe job stopped)', pg_temp._state(:'R') = 'stale', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '39 minutes', 200); select pg_temp._probe(:'R', interval '49 minutes', 200);
select pg_temp._ck('H12 39 minutes old is still fine', pg_temp._state(:'R') = 'ok', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '12 minutes', 200); select pg_temp._probe(:'R', interval '30 seconds', 500); select pg_temp._probe(:'R', interval '20 seconds', 500);
select pg_temp._ck('H13 probes fired under 2 minutes ago have not had time to answer: they are not judged', pg_temp._state(:'R') = 'ok', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '12 minutes', 200); select pg_temp._probe(:'R', interval '8 minutes', 200); select pg_temp._probe(:'R', interval '3 minutes', null);
select pg_temp._ck('H14 a probe with no answer on record (purged) is ignored, not counted as a failure', pg_temp._state(:'R') = 'ok', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '3 minutes', null);
select pg_temp._ck('H15 a function with no answered probe is UNKNOWN, not ok and not down', pg_temp._state(:'R') = 'unknown', pg_temp._state(:'R'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '12 minutes', 500, 'SECRETXYZ 742 Evergreen Terrace a@b.co'); select pg_temp._probe(:'R', interval '3 minutes', 500, 'SECRETXYZ 742 Evergreen Terrace a@b.co');
select pg_temp._ck('H16 the detail carries a status number and fixed words, never a body',
  (select detail !~ 'SECRETXYZ|Evergreen|@' and detail like '%newest status 500%' from public.report_service_health() where fn = :'R'),
  (select detail from public.report_service_health() where fn = :'R'));

select pg_temp._reset();
select pg_temp._probe(:'B', interval '12 minutes', 200, '{}', true); select pg_temp._probe(:'B', interval '3 minutes', 200, '{}', true);
select pg_temp._ck('H07b an answer flagged as timed out counts as a failure even if it carries a status (belt and braces beside H07)', pg_temp._state(:'B') = 'down', pg_temp._state(:'B'));
select pg_temp._reset();
select pg_temp._probe(:'R', interval '12 minutes', 200, 'SECRETXYZ 742 Evergreen Terrace a@b.co'); select pg_temp._probe(:'R', interval '3 minutes', 200, 'SECRETXYZ 742 Evergreen Terrace a@b.co');
select pg_temp._ck('H17 a HEALTHY detail carries a status number and fixed words too, never a body',
  (select detail !~ 'SECRETXYZ|Evergreen|@' and detail = 'answered (status 200)' from public.report_service_health() where fn = :'R'),
  (select detail from public.report_service_health() where fn = :'R'));

-- ---- M  the check in the monitor ----------------------------------------------------------------------------------------------------------------
select pg_temp._reset(); select pg_temp._tick();
select pg_temp._ck('M01 no answers yet: the check exists, passes, and is NOT alertable (no evidence is not a failure)',
  (select ok and not alertable and detail like 'UNKNOWN%' from pg_temp._row()), (select detail from pg_temp._row()));
select pg_temp._probe(:'R', interval '12 minutes', 200); select pg_temp._probe(:'R', interval '3 minutes', 200);
select pg_temp._probe(:'B', interval '12 minutes', 200); select pg_temp._probe(:'B', interval '3 minutes', 200);
select pg_temp._probe(:'W', interval '12 minutes', 200, :'OKW'); select pg_temp._probe(:'W', interval '3 minutes', 200, :'OKW');
select pg_temp._tick();
select pg_temp._ck('M02 all healthy: the check passes and is alertable', (select ok and alertable and detail like 'the report function, billing function and payment webhook all answered%' from pg_temp._row()), (select detail from pg_temp._row()));
select pg_temp._probe(:'B', interval '2 minutes 30 seconds', 502); select pg_temp._probe(:'B', interval '2 minutes 20 seconds', 502);
select pg_temp._tick();
select pg_temp._ck('M03 one function down: the check FAILS and is alertable', (select not ok and alertable from pg_temp._row()), (select detail from pg_temp._row()));
select pg_temp._ck('M04 the failing detail names the function that is down and not the healthy ones',
  (select detail like 'manage-billing: down%' and detail not like '%get-development-activity-report%' and detail not like '%development-activity-billing-webhook%' from pg_temp._row()),
  (select detail from pg_temp._row()));
select pg_temp._ck('M05 the other check in the monitor still runs', (select count(*) = 1 from public.pipeline_health_check where check_name = 'other_check'), null);
select pg_temp._ck('M06 the splice is in the monitor exactly once, beside exactly one anchor, and the other check is still there',
  (select (length(d) - length(replace(d, '-- >>> report_service (begin)', ''))) / length('-- >>> report_service (begin)') = 1
      and (length(d) - length(replace(d, '-- <<< report_service (end)', ''))) / length('-- <<< report_service (end)') = 1
      and (length(d) - length(replace(d, 'insert into public.pipeline_health_check as c (', ''))) / length('insert into public.pipeline_health_check as c (') = 1
      and position('''other_check''' in d) > 0
     from (select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) d) x), null);
-- a check that cannot run is a failing check, not a dead monitor
alter table net._http_response rename to _http_response_gone;
select pg_temp._tick();
select pg_temp._ck('M07 when the check itself cannot run it is reported as a FAILING, alertable row, and the monitor still returns',
  (select not ok and alertable and detail like 'the report-service check could not run (SQLSTATE %' from pg_temp._row())
  and (select count(*) = 1 from public.pipeline_health_check where check_name = 'other_check'), (select detail from pg_temp._row()));
alter table net._http_response_gone rename to _http_response;

-- a stopped probe job pages by email too
select pg_temp._reset();
select pg_temp._probe(:'R', interval '41 minutes', 200); select pg_temp._probe(:'R', interval '51 minutes', 200);
select pg_temp._probe(:'B', interval '12 minutes', 200); select pg_temp._probe(:'B', interval '3 minutes', 200);
select pg_temp._probe(:'W', interval '12 minutes', 200, :'OKW'); select pg_temp._probe(:'W', interval '3 minutes', 200, :'OKW');
select pg_temp._tick();
select pg_temp._ck('M08 a probe job that stopped (STALE) FAILS the check and pages, naming the function',
  (select not ok and alertable and detail like 'get-development-activity-report: stale%' from pg_temp._row()), (select detail from pg_temp._row()));

-- ---- J  the schedule ------------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('J01 ONE job, every 10 minutes, running the fire function',
  (select count(*) = 1 and bool_and(schedule = '*/10 * * * *' and command = 'select public.report_service_probe_fire()' and active) from cron.job where jobname = 'report-service-probe'), null);

-- ---- G  who may call it -----------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('G01 the API roles cannot fire the probe, read the health, or read the probe log; the service role can',
  not has_function_privilege('anon', 'public.report_service_probe_fire()', 'execute')
  and not has_function_privilege('authenticated', 'public.report_service_probe_fire()', 'execute')
  and not has_function_privilege('anon', 'public.report_service_health()', 'execute')
  and not has_function_privilege('authenticated', 'public.report_service_health()', 'execute')
  and has_function_privilege('service_role', 'public.report_service_probe_fire()', 'execute')
  and has_function_privilege('service_role', 'public.report_service_health()', 'execute')
  and pg_temp._as('anon', 'select * from public.report_service_probe') = '42501'
  and pg_temp._as('authenticated', 'select * from public.report_service_probe') = '42501'
  and pg_temp._as('anon', 'select public.report_service_probe_fire()') = '42501', null);
select pg_temp._ck('G02 both functions are SECURITY DEFINER with a pinned search_path; the probe log has row security on',
  (select bool_and(p.prosecdef and p.proconfig is not null) from pg_proc p where p.proname in ('report_service_probe_fire', 'report_service_health'))
  and (select relrowsecurity from pg_class where oid = 'public.report_service_probe'::regclass), null);

select pg_temp._ck('Z01 every setup step in this suite ran without raising',
  not exists (select 1 from _setup where result <> 'ok'), (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;
\o
select check_name, pass, detail from _r order by n;
