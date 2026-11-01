-- Each row: name|t/f. Run after docs/source-freshness.sql has been applied on the fixture.
\pset footer off
select 'C01 newest = latest event date (issued/filed), not scheduled, unstated, future or malformed',
       (select newest_record_date = date '2026-10-01' from public.dev_source_freshness where registry_id = 'src-a');
select 'C02 a source dated only by plans has no newest date',
       (select newest_record_date is null from public.dev_source_freshness where registry_id = 'src-b');
select 'C03 last success = newest COMPLETED read, never a failed one',
       (select last_success_at = timestamptz '2026-11-01 05:32+00' from public.dev_source_freshness where registry_id = 'src-a');
select 'C04 a source with only an impaired-but-complete legacy row still counts that completed read',
       (select last_success_at = timestamptz '2026-10-29 00:00+00' from public.dev_source_freshness where registry_id = 'src-b');
select 'C05 a ledger-only source is listed with no check date',
       (select newest_record_date = date '2026-07-04' and last_success_at is null from public.dev_source_freshness where registry_id = 'src-c');
select 'C05b record counts are stored (0 = not measured yet)',
       (select array_agg(ledger_records order by registry_id) = array[6::bigint, 1, 1] from public.dev_source_freshness);
select 'C05c the reader returns the record count (0 for an unmeasured source)',
       (select ledger_records = 0 from public.source_freshness_for_zip('44444', array['zz-new']) where registry_id = 'zz-new');
select 'C06 a null registry id is never a row', not exists (select 1 from public.dev_source_freshness where registry_id is null);
select 'C07 a second refresh with nothing new writes nothing (idempotent)', public.dev_source_freshness_refresh() = 0;
-- the reader
select 'C10 ZIP 11111: src-a complete with its own read date',
       (select zip_read_state = 'complete' and zip_last_read_at = timestamptz '2026-11-01 05:32+00' and zip_failing_since is null
          from public.source_freshness_for_zip('11111') where registry_id = 'src-a');
select 'C11 ZIP 22222: src-a failing here even though it succeeded elsewhere',
       (select zip_read_state = 'failing' and zip_failing_since = timestamptz '2026-10-31 17:00+00'
               and last_success_at = timestamptz '2026-11-01 05:32+00'
          from public.source_freshness_for_zip('22222') where registry_id = 'src-a');
select 'C12 ZIP 22222: a COMPLETED fallback read after an earlier break is complete, never "did not complete"',
       (select zip_read_state = 'complete' and zip_failing_since is null from public.source_freshness_for_zip('22222') where registry_id = 'src-b');
select 'C12b ZIP 11111: a failed read reports when the failing began',
       (select zip_read_state = 'failing' and zip_failing_since = timestamptz '2026-10-31 17:08+00'
          from public.source_freshness_for_zip('11111') where registry_id = 'src-b');
select 'C13 absent reads as not_reported, retired as retired',
       (select zip_read_state = 'not_reported' from public.source_freshness_for_zip('33333') where registry_id = 'src-b')
   and (select zip_read_state = 'retired' from public.source_freshness_for_zip('44444') where registry_id = 'src-b');
select 'C14 a requested source with no row for the ZIP is not_read',
       (select zip_read_state = 'not_read' from public.source_freshness_for_zip('44444', array['src-a']) where registry_id = 'src-a');
select 'C15 no ZIP: source-wide facts only, no ZIP state',
       (select count(*) = 1 and bool_and(zip_read_state is null and zip_last_read_at is null)
          from public.source_freshness_for_zip(null, array['src-a']));
select 'C16 a malformed ZIP is treated as no ZIP',
       (select bool_and(zip_read_state is null) from public.source_freshness_for_zip('1111x', array['src-a']));
select 'C17 malformed ids are dropped, ids capped at 50',
       (select count(*) = 0 from public.source_freshness_for_zip(null, array['Bad Id', 'x;drop', '']))
   and (select count(*) = 50 from public.source_freshness_for_zip(null, array(select 'id-' || g from generate_series(1, 80) g)));
select 'C18 rows come back ordered by registry id', (select array_agg(registry_id) = array['src-a','src-b']
          from public.source_freshness_for_zip('11111'));
-- security
select 'C20 anon cannot run the refresh', not has_function_privilege('anon', 'public.dev_source_freshness_refresh()', 'execute');
select 'C21 authenticated cannot run the refresh', not has_function_privilege('authenticated', 'public.dev_source_freshness_refresh()', 'execute');
select 'C22 service_role can run the refresh', has_function_privilege('service_role', 'public.dev_source_freshness_refresh()', 'execute');
select 'C23 anon can call the reader', has_function_privilege('anon', 'public.source_freshness_for_zip(text, text[])', 'execute');
select 'C24 anon cannot read the table directly', not has_table_privilege('anon', 'public.dev_source_freshness', 'select');
select 'C25 the table has RLS on', (select relrowsecurity from pg_class where oid = 'public.dev_source_freshness'::regclass);
select 'C26 both functions are SECURITY DEFINER with a fixed search_path',
       (select bool_and(prosecdef and proconfig::text like '%search_path=public, pg_temp%') from pg_proc
         where proname in ('dev_source_freshness_refresh', 'source_freshness_for_zip'));
select 'C27 the reader is STABLE (cannot write)', (select provolatile = 's' from pg_proc where proname = 'source_freshness_for_zip');
select 'C28 refresh has a statement time limit', (select proconfig::text like '%statement_timeout=120s%' from pg_proc where proname = 'dev_source_freshness_refresh');
-- cron
select 'C30 exactly one hourly job', (select count(*) = 1 and bool_and(schedule = '41 * * * *') from cron.job where jobname = 'dev-source-freshness');
