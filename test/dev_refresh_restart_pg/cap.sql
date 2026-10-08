-- Scenarios for the batch cap (docs/dev-refresh-collect-batch-cap.sql). NAME|t or NAME|f.
\ir helpers.sql

-- C01-C04: a burst of 20 answers for 20 ZIPs lands at once (ids 101..120).
select pg_temp.reset();
select setval('net.http_request_queue_id_seq', 200, true);
select pg_temp.row_(lpad(i::text, 5, '0'), 0), pg_temp.resp(100 + i, lpad(i::text, 5, '0'))
  from generate_series(1, 20) i;
select 'C01|' || case when public.dev_refresh_collect() = 16 then 't' else 'f' end;   -- one tick saves 16
select 'C02|' || case when (select count(*) from generate_series(1, 16) i where pg_temp.saved(lpad(i::text, 5, '0'))) = 16
                      then 't' else 'f' end;                                            -- the 16 OLDEST answers
select 'C03|' || case when (select bool_and(pg_temp.cur(lpad(i::text, 5, '0')) = 0) from generate_series(17, 20) i)
                      then 't' else 'f' end;                                            -- the other 4 keep their cursors
select 'C04|' || case when public.dev_refresh_collect() = 4
                       and (select bool_and(pg_temp.saved(lpad(i::text, 5, '0'))) from generate_series(17, 20) i)
                      then 't' else 'f' end;                                            -- the next tick takes them

-- C05: a normal tick (8 answers) is untouched by the cap.
select pg_temp.reset();
select pg_temp.row_(lpad(i::text, 5, '0'), 0), pg_temp.resp(150 + i, lpad(i::text, 5, '0'))
  from generate_series(1, 8) i;
select 'C05|' || case when public.dev_refresh_collect() = 8 then 't' else 'f' end;

-- C06: the installed function carries the cap once, inside step (0), and the heal is still there.
select 'C06|' || case when (select (length(prosrc) - length(replace(prosrc, 'limit 16) e;', ''))) / 12 = 1
                                  and position('(R) RESTART HEAL' in prosrc) > 0
                                  and position('(0-cap)' in prosrc) < position('if cardinality(_ids) = 0 then' in prosrc)
                             from pg_proc where oid = 'public.dev_refresh_collect()'::regprocedure)
                      then 't' else 'f' end;
