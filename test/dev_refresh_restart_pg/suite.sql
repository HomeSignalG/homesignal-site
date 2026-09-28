-- Scenarios for the restart heal. Each line prints NAME|t or NAME|f.
-- Run with psql -tA against the fixture plus the function under test.

\ir helpers.sql

-- R00-R04, R12: the restart shape. The counter restarted and has issued 5 ids; every
-- cursor was set before the restart. ZIP 00001's answer id 3 landed BEFORE the first
-- tick healed, so it is left for the rotation (re-fired with a fresh id), never
-- replayed; its next answer, id 6, must be saved.
select pg_temp.reset();
select setval('net.http_request_queue_id_seq', 5, true);
select pg_temp.row_('00001', 11000), pg_temp.row_('00002', 11001), pg_temp.row_('00003', null);
select pg_temp.resp(3, '00001');
select public.dev_refresh_collect();
select 'R12|' || case when not coalesce(pg_temp.saved('00001'), false) and pg_temp.cur('00001') = 5 then 't' else 'f' end; -- pre-heal answer not replayed
select pg_temp.resp(nextval('net.http_request_queue_id_seq'), '00001');
select 'R00|' || case when public.dev_refresh_collect() = 1 then 't' else 'f' end;
select 'R01|' || case when pg_temp.saved('00001') then 't' else 'f' end;       -- the next answer is saved
select 'R02|' || case when pg_temp.cur('00001') = 6 then 't' else 'f' end;     -- its cursor is that answer
select 'R03|' || case when pg_temp.cur('00002') = 5 then 't' else 'f' end;     -- a stale cursor becomes the counter, never NULL
select 'R04|' || case when pg_temp.cur('00003') is null then 't' else 'f' end; -- an empty cursor stays empty

-- R05-R06: no restart. Cursors at or below the counter are left alone.
select pg_temp.reset();
select setval('net.http_request_queue_id_seq', 100, true);
select pg_temp.row_('00004', 50), pg_temp.row_('00005', 80);
select pg_temp.resp(60, '00004'), pg_temp.resp(70, '00005');
select public.dev_refresh_collect();
select 'R05|' || case when pg_temp.saved('00004') and pg_temp.cur('00004') = 60 then 't' else 'f' end; -- newer answer saved
select 'R06|' || case when not pg_temp.saved('00005') and pg_temp.cur('00005') = 80 then 't' else 'f' end; -- older answer still skipped, cursor untouched

-- R07-R08: a counter that has restarted and issued NOTHING yet (last_value 1, is_called
-- false). Its first id will be 1, so the stale cursor must become 0, not 1.
select pg_temp.reset();
alter sequence net.http_request_queue_id_seq restart;
select pg_temp.row_('00006', 9000);
select public.dev_refresh_collect();
select 'R07|' || case when pg_temp.cur('00006') = 0 then 't' else 'f' end;
select pg_temp.resp(nextval('net.http_request_queue_id_seq'), '00006');
select public.dev_refresh_collect();
select 'R08|' || case when pg_temp.saved('00006') and pg_temp.cur('00006') = 1 then 't' else 'f' end;

-- R09-R11: shape of the installed function.
select 'R09|' || case when (select (length(prosrc) - length(replace(prosrc, '(R) RESTART HEAL', ''))) / 16
                               from pg_proc where oid = 'public.dev_refresh_collect()'::regprocedure) = 1
                      then 't' else 'f' end;                                   -- present exactly once
select 'R10|' || case when (select position('(R) RESTART HEAL' in prosrc) > position('pg_try_advisory_xact_lock' in prosrc)
                               and position('(R) RESTART HEAL' in prosrc) < position('(0) THE RESPONSE SET' in prosrc)
                               from pg_proc where oid = 'public.dev_refresh_collect()'::regprocedure)
                      then 't' else 'f' end;                                   -- after the lock, before step (0)
select 'R11|' || case when (select prosecdef and proconfig = array['search_path=public, net']
                               from pg_proc where oid = 'public.dev_refresh_collect()'::regprocedure)
                      then 't' else 'f' end;                                   -- SECURITY DEFINER and search_path unchanged
