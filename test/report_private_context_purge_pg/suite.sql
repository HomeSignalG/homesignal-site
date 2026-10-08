-- =====================================================================================
-- PRIVATE-CONTEXT PURGE SCHEDULE + ITS MONITOR CHECK — EXECUTABLE ADVERSARIAL SUITE
-- (docs/report-private-context-purge-schedule.sql; Order F2 gate 5)
--
-- Runs against a DISPOSABLE Postgres with the F2 private layer, a stand-in pg_cron and a stand-in
-- pipeline_health_tick() already applied, and the shipped file applied once. Every expected answer is a
-- HARD-CODED constant, never computed by the code under test. The retention clock is exercised by moving a
-- context's two timestamps back (as the table owner, the way the F2 suite travels in time).
-- Output: one row per check (check, pass, detail); a NULL pass is stored as FALSE.
-- =====================================================================================
\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

create temp table _r (n serial, check_name text, pass boolean, detail text);
create function pg_temp._ck(n text, p boolean, d text default null) returns void language sql as
$$ insert into _r (check_name, pass, detail) values (n, coalesce(p, false), d) $$;

-- Setup steps go through wrappers so a REGRESSION becomes a FAILED CHECK, not a crash. Z01 (last) fails if any raised.
create temp table _setup (n serial, step text, result text);

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
-- Supabase's service_role has BYPASSRLS and all three API roles hold USAGE on schema public.
alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

create function pg_temp._mk(p_addr text) returns uuid language plpgsql as $$
begin
  return public.report_private_context_create(jsonb_build_object('address', p_addr), 'report', 'r');
exception when others then
  insert into _setup (step, result) values ('create ' || p_addr, sqlstate);
  return null;
end $$;

-- end the report's need and put the clock where it would be if it had been running for 90 days plus p_ago
create function pg_temp._due(p_ctx uuid, p_ago interval) returns void language plpgsql as $$
begin
  perform public.report_private_context_need_close(p_ctx, 'report', 'r');
  update public.report_private_context
     set purge_due_at = now() - p_ago, last_needed_at = now() - p_ago - public.report_private_context_grace()
   where context_id = p_ctx;
exception when others then
  insert into _setup (step, result) values ('due', sqlstate);
end $$;
-- end the report's need and leave the clock running from now (due in 90 days)
create function pg_temp._close(p_ctx uuid) returns void language plpgsql as $$
begin
  perform public.report_private_context_need_close(p_ctx, 'report', 'r');
exception when others then
  insert into _setup (step, result) values ('close', sqlstate);
end $$;

-- one monitor tick, one statement (the stand-in creates a temp table per call, so ONE call per statement)
create temp table _tickdetail (n serial, detail text);
create function pg_temp._tick() returns text language plpgsql as $$
declare r text;
begin
  perform count(*) from public.pipeline_health_tick();
  select ok::text || '|' || alertable::text || '|' || detail into r
    from public.pipeline_health_check where check_name = 'report_private_context_retention';
  insert into _tickdetail (detail) values (r);
  return r;
exception when others then
  insert into _setup (step, result) values ('tick', sqlstate);
  return null;
end $$;
-- run the job exactly as pg_cron would: the stored command text
create function pg_temp._run_job() returns integer language plpgsql as $$
declare _c text; _n integer;
begin
  select command into _c from cron.job where jobname = 'report-private-context-purge';
  execute _c into _n;
  return _n;
exception when others then
  insert into _setup (step, result) values ('run_job', sqlstate);
  return -1;
end $$;
create function pg_temp._health(p_grace interval default interval '1 hour')
returns table (contexts_total bigint, active_n bigint, overdue_n bigint, oldest_overdue_at timestamptz,
               invariant_breaks bigint, broken_invariants text, job_state text) language sql as
$$ select * from public.report_private_context_purge_health(p_grace) $$;

-- ---- J01..J03  the schedule ---------------------------------------------------------------------------
select pg_temp._ck('J01 exactly ONE job is scheduled, active, on the four fixed minutes, calling the purge batch and nothing else',
  (select count(*) = 1 and bool_and(active and schedule = '5,20,35,50 * * * *'
                                    and command = 'select public.report_private_context_purge_due()')
     from cron.job where jobname = 'report-private-context-purge')
  and (select count(*) = 1 from cron.job),
  (select string_agg(jobname || ' ' || schedule || ' ' || command || ' ' || active, '; ') from cron.job));
select pg_temp._ck('J02 the job fires every 15 minutes at most, so a context is blanked at most 15 minutes after its clock runs out (the founder''s "no more than 90 days")',
  (with m as (select unnest(string_to_array(split_part(schedule, ' ', 1), ','))::int as mi
                from cron.job where jobname = 'report-private-context-purge'),
        g as (select mi, coalesce(lead(mi) over (order by mi), min(mi) over () + 60) - mi as gap from m)
   select max(gap) = 15 and count(*) = 4 from g)
  and (select split_part(schedule, ' ', 2) || split_part(schedule, ' ', 3) || split_part(schedule, ' ', 4) || split_part(schedule, ' ', 5)
         from cron.job where jobname = 'report-private-context-purge') = '****',
  (select schedule from cron.job where jobname = 'report-private-context-purge'));
select pg_temp._ck('J03 the job writes nothing itself: its command is one call to the F2 batch (no verb but select, no second statement)',
  (select command ~ '^select public\.report_private_context_purge_due\(\)$' and command !~* '(update|delete|insert|truncate|;)'
     from cron.job where jobname = 'report-private-context-purge'),
  (select command from cron.job where jobname = 'report-private-context-purge'));

-- ---- A  an empty table ----------------------------------------------------------------------------------
select pg_temp._ck('H01 with nothing held the health read is all zero, no oldest date, no broken invariant, and the job is ok',
  (select contexts_total = 0 and active_n = 0 and overdue_n = 0 and oldest_overdue_at is null and invariant_breaks = 0
          and broken_invariants = '' and job_state = 'ok' from pg_temp._health()),
  (select row_to_json(h)::text from pg_temp._health() h));
create temp table _t0 as select pg_temp._tick() as r;
select pg_temp._ck('M01 the monitor row exists, is ALERTABLE, passes, and says nothing is held (an empty table is a pass, not "unmeasured")',
  (select r = 'true|true|purge job active; 0 private context(s) held (0 ever created); none more than 1 hour past its purge date; no retention invariant broken' from _t0),
  (select r from _t0));

-- ---- B  something held, nothing due ----------------------------------------------------------------------
create temp table _c as select
  pg_temp._mk('ZZ-SECRET-ADDR-1 Alder Court, Springfield') as c1,   -- the report still needs it: no clock
  pg_temp._mk('ZZ-SECRET-ADDR-2 Birch Lane, Springfield')  as c2,   -- need closed, clock running, due in 90 days
  pg_temp._mk('ZZ-SECRET-ADDR-3 Cedar Road, Springfield')  as c3,   -- due 30 minutes ago
  pg_temp._mk('ZZ-SECRET-ADDR-4 Dogwood Way, Springfield') as c4,   -- due 2 hours ago
  pg_temp._mk('ZZ-SECRET-ADDR-5 Elm Street, Springfield')  as c5;   -- due 5 hours ago
select pg_temp._close((select c2 from _c));
select pg_temp._ck('H02 a context still needed, and one whose clock has 90 days to run, are NOT overdue',
  (select contexts_total = 5 and active_n = 5 and overdue_n = 0 and oldest_overdue_at is null and invariant_breaks = 0
     from pg_temp._health()),
  (select row_to_json(h)::text from pg_temp._health() h));
create temp table _t1 as select pg_temp._tick() as r;
select pg_temp._ck('M02 holding contexts that are not due is a pass',
  (select r = 'true|true|purge job active; 5 private context(s) held (5 ever created); none more than 1 hour past its purge date; no retention invariant broken' from _t1),
  (select r from _t1));

-- ---- C  overdue, but inside the grace the job's own period needs -------------------------------------------
select pg_temp._due((select c3 from _c), interval '30 minutes');
select pg_temp._ck('H03 a context 30 minutes past its date is NOT overdue at the 1-hour grace, and IS at grace 0',
  (select overdue_n = 0 from pg_temp._health(interval '1 hour'))
  and (select overdue_n = 1 from pg_temp._health(interval '0'))
  and (select overdue_n = 1 from pg_temp._health(interval '29 minutes'))
  and (select overdue_n = 0 from pg_temp._health(interval '31 minutes')),
  null);
create temp table _t2 as select pg_temp._tick() as r;
select pg_temp._ck('M03 a context 30 minutes past its date (inside the job''s period plus slack) does not page',
  (select r like 'true|true|purge job active; 5 private context(s) held%' from _t2), (select r from _t2));

-- ---- D  overdue beyond the grace ---------------------------------------------------------------------------------
select pg_temp._due((select c4 from _c), interval '2 hours');
select pg_temp._due((select c5 from _c), interval '5 hours');
select pg_temp._ck('H04 two contexts more than an hour past their date: counted, and the oldest date is the 5-hour one',
  (select overdue_n = 2 and oldest_overdue_at = (select purge_due_at from public.report_private_context where context_id = (select c5 from _c))
          and invariant_breaks = 0 and job_state = 'ok'
     from pg_temp._health()),
  (select row_to_json(h)::text from pg_temp._health() h));
select pg_temp._ck('H05 PARITY: at grace 0 the overdue count is exactly the F2 audit''s own lag row (one definition of "overdue", not two)',
  (select overdue_n from pg_temp._health(interval '0'))
  = (select violations from public.report_private_context_retention_check() where check_name = 'clock_expired_but_not_yet_purged')
  and (select overdue_n from pg_temp._health(interval '0')) = 3,
  (select overdue_n::text from pg_temp._health(interval '0')));
create temp table _t3 as select pg_temp._tick() as r;
select pg_temp._ck('M04 two contexts past the grace PAGE: failing, alertable, names the count and the oldest date, and nothing else',
  (select r = 'false|true|2 private context(s) are more than 1 hour past their purge date and still hold their values (oldest due '
              || (select to_char(purge_due_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI') from public.report_private_context
                   where context_id = (select c5 from _c)) || ' UTC)' from _t3),
  (select r from _t3));

-- ---- E  the scheduled command purges exactly what is due -----------------------------------------------------------
create temp table _e as select pg_temp._run_job() as n;
select pg_temp._ck('E01 running the job''s stored command purges the three contexts whose clock has run out — including the one only 30 minutes past — and no other',
  (select n = 3 from _e)
  and (select count(*) = 3 and bool_and(state = 'purged' and purge_reason = 'retention_expired' and purged_at is not null
                                         and address is null and normalized_address is null and latitude is null and longitude is null
                                         and property_keys is null and label is null)
         from public.report_private_context where context_id in ((select c3 from _c), (select c4 from _c), (select c5 from _c))),
  (select n::text from _e));
select pg_temp._ck('E02 the two others are untouched: the context a report still needs, and the one with 90 days to run, still hold their address',
  (select count(*) = 2 and bool_and(state = 'active' and address like 'ZZ-SECRET-ADDR-%')
     from public.report_private_context where context_id in ((select c1 from _c), (select c2 from _c))),
  null);
select pg_temp._ck('E03 each purge is in the audit log with its reason, and no row was deleted',
  (select count(*) = 3 from public.report_private_context_event where kind = 'purged' and reason = 'retention_expired')
  and (select count(*) = 5 from public.report_private_context),
  null);
select pg_temp._ck('E04 a second run purges nothing more (idempotent)', pg_temp._run_job() = 0, null);
create temp table _t4 as select pg_temp._tick() as r;
select pg_temp._ck('M05 after the job has run the monitor is healthy again: 2 held, 5 ever created',
  (select r = 'true|true|purge job active; 2 private context(s) held (5 ever created); none more than 1 hour past its purge date; no retention invariant broken' from _t4),
  (select r from _t4));

-- ---- F  the job itself ------------------------------------------------------------------------------------------------
create temp table _job as select jobname, schedule, command from cron.job where jobname = 'report-private-context-purge';
update cron.job set active = false where jobname = 'report-private-context-purge';
create temp table _tf1 as select pg_temp._tick() as r, (select job_state from pg_temp._health()) as s;
update cron.job set active = true, command = 'select 1' where jobname = 'report-private-context-purge';
create temp table _tf2 as select pg_temp._tick() as r, (select job_state from pg_temp._health()) as s;
delete from cron.job where jobname = 'report-private-context-purge';
create temp table _tf3 as select pg_temp._tick() as r, (select job_state from pg_temp._health()) as s;
insert into cron.job (jobname, schedule, command) select jobname, schedule, command from _job;
select pg_temp._ck('F01 an INACTIVE job pages, naming the state',
  (select s = 'inactive' and r = 'false|true|pg_cron job report-private-context-purge is inactive — private contexts are not being purged' from _tf1),
  (select s || ' / ' || r from _tf1));
select pg_temp._ck('F02 a job that no longer calls the purge batch pages as wrong_command',
  (select s = 'wrong_command' and r = 'false|true|pg_cron job report-private-context-purge is wrong_command — private contexts are not being purged' from _tf2),
  (select s || ' / ' || r from _tf2));
select pg_temp._ck('F03 a MISSING job pages',
  (select s = 'missing' and r = 'false|true|pg_cron job report-private-context-purge is missing — private contexts are not being purged' from _tf3),
  (select s || ' / ' || r from _tf3));
select pg_temp._ck('F04 with the job restored the monitor passes again (the failures above were the job, not the data)',
  (select job_state = 'ok' from pg_temp._health()), null);

-- ---- X  a check that cannot run is a failing check, not a dead monitor ----------------------------------------------------
alter function public.report_private_context_purge_health(interval) rename to report_private_context_purge_health_x;
create temp table _tx as select pg_temp._tick() as r;
create temp table _tx2 as select count(*) as others from public.pipeline_health_check
 where check_name = 'other_check' and ok and updated_at > now() - interval '30 seconds';
alter function public.report_private_context_purge_health_x(interval) rename to report_private_context_purge_health;
select pg_temp._ck('X01 when the health read is gone the check FAILS (alertable, says it could not run, SQLSTATE only) and the other checks still ran in that same tick',
  (select r = 'false|true|the retention check could not run (SQLSTATE 42883) — a check that cannot run is a failing check' from _tx)
  and (select others = 1 from _tx2),
  (select r || ' / others=' || (select others from _tx2) from _tx));

-- ---- G  a broken invariant -----------------------------------------------------------------------------------------------------
-- Purge a context by raw UPDATE (as the table owner, bypassing the function): no purge event, and its need is still open.
update public.report_private_context
   set state = 'purged', address = null, purged_at = now(), purge_reason = 'retention_expired', purge_due_at = null
 where context_id = (select c1 from _c);
select pg_temp._ck('G01 two F2 invariants broken: counted and NAMED, in a fixed order',
  (select invariant_breaks = 2 and broken_invariants = 'purged_with_a_need_still_open, purged_without_a_purge_event' from pg_temp._health()),
  (select row_to_json(h)::text from pg_temp._health() h));
create temp table _tg as select pg_temp._tick() as r;
select pg_temp._ck('M06 a broken invariant pages, naming the invariants and never a context',
  (select r = 'false|true|2 retention invariant violation(s): purged_with_a_need_still_open, purged_without_a_purge_event' from _tg),
  (select r from _tg));

-- ---- L  nothing private ever leaves --------------------------------------------------------------------------------------------------
select pg_temp._ck('L01 no health read, no monitor detail and no audit row contains any address entered above',
  not exists (select 1 from _tickdetail where detail like '%ZZ-SECRET%' or detail ~* 'alder|birch|cedar|dogwood|elm street|springfield')
  and (select count(*) >= 8 from _tickdetail)
  and not exists (select 1 from pg_temp._health() h where row_to_json(h)::text like '%ZZ-SECRET%')
  and not exists (select 1 from public.pipeline_health_check where detail like '%ZZ-SECRET%')
  and not exists (select 1 from public.report_private_context_event where coalesce(reason, '') || coalesce(need_kind, '') like '%ZZ-SECRET%'),
  (select count(*)::text from _tickdetail));

-- ---- P  who may call it ------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('P01 anon and authenticated cannot execute the health read; service_role can, and gets counts (it is SECURITY DEFINER with a pinned search_path)',
  not has_function_privilege('anon', 'public.report_private_context_purge_health(interval)', 'execute')
  and not has_function_privilege('authenticated', 'public.report_private_context_purge_health(interval)', 'execute')
  and has_function_privilege('service_role', 'public.report_private_context_purge_health(interval)', 'execute')
  and pg_temp._as('anon', 'select * from public.report_private_context_purge_health()') = '42501'
  and pg_temp._as('authenticated', 'select * from public.report_private_context_purge_health()') = '42501'
  and pg_temp._as('service_role', 'select * from public.report_private_context_purge_health()') = 'ok'
  and (select p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=public, pg_temp')
         from pg_proc p where p.proname = 'report_private_context_purge_health'),
  null);
-- ---- S  the splice -----------------------------------------------------------------------------------------------------------------------------
select pg_temp._ck('S01 the check is spliced into the monitor exactly once, beside exactly one anchor, and the other check is still there',
  (select (length(d) - length(replace(d, '-- >>> report_private_context_retention (begin)', ''))) / length('-- >>> report_private_context_retention (begin)') = 1
      and (length(d) - length(replace(d, '-- <<< report_private_context_retention (end)', ''))) / length('-- <<< report_private_context_retention (end)') = 1
      and (length(d) - length(replace(d, 'insert into public.pipeline_health_check as c (', ''))) / length('insert into public.pipeline_health_check as c (') = 1
      and position('''other_check''' in d) > 0
     from (select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) d) x),
  null);
select pg_temp._ck('S02 the check is ALERTABLE in the monitor source (a check that cannot page is a log line)',
  (select position($$select 'report_private_context_retention', (q.problems = ''), true,$$ in d) > 0
     from (select pg_get_functiondef('public.pipeline_health_tick()'::regprocedure) d) x),
  null);

select pg_temp._ck('Z01 every setup step in this suite ran without raising (a step that raises is a regression in the code under test, reported here instead of ending the run)',
  not exists (select 1 from _setup where result <> 'ok'),
  (select string_agg(step || '=' || result, '; ') from _setup where result <> 'ok'));

alter role service_role nobypassrls;
revoke usage on schema public from anon, authenticated, service_role;

\o
select check_name, pass, detail from _r order by n;
