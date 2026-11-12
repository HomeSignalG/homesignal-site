\set ON_ERROR_STOP on
create temp table t(id text, ok boolean, detail text);
create temp view f as select * from public.dc_source_freshness();

insert into t select 'S01 one row per ACTIVE source, in key order; a NOT_ACTIVE source is absent',
  (select array_agg(source_key order by ord) from (select source_key, row_number() over () ord from f) z) = '{compute_atlas,epoch_ai,never_read}', (select string_agg(source_key, ',') from f);
insert into t select 'S02 Atlas: edition 11-05, last success 11-06, newest attempt 11-12 FETCH_FAILED (three different facts)',
  (select publisher_edition_at = '2026-11-05 18:24:03.746+00' and last_success_at = '2026-11-06 09:45:05+00'
          and last_attempt_at = '2026-11-12 09:44:17+00' and last_attempt_state = 'FETCH_FAILED' and source_name = 'Compute Atlas (Edward Kubiak)'
     from f where source_key = 'compute_atlas'), (select row_to_json(f)::text from f where source_key = 'compute_atlas');
insert into t select 'S03 a publisher that states no edition date reads NULL, never a read time',
  (select publisher_edition_at is null and last_attempt_state = 'SUCCESS_COMPLETE' from f where source_key = 'epoch_ai'), null;
insert into t select 'S04 two distributions: last success is the OLDER of the two newest complete reads',
  (select last_success_at = '2026-11-12 10:16:26+00' from f where source_key = 'epoch_ai'), (select last_success_at::text from f where source_key = 'epoch_ai');
insert into t select 'S05 a source never read: every date NULL, state NULL',
  (select publisher_edition_at is null and last_success_at is null and last_attempt_at is null and last_attempt_state is null from f where source_key = 'never_read'), null;

-- one distribution's newest attempt fails while the other succeeds later: the failure is reported
insert into public.dc_acquisition_run (source_key, distribution_key, started_at, completed_at, completeness_state)
  values ('epoch_ai','data_centers','2026-11-13 10:16:25+00','2026-11-13 10:16:26+00','PARTIAL'),
         ('epoch_ai','timelines','2026-11-13 10:16:27+00','2026-11-13 10:16:29+00','SUCCESS_COMPLETE');
insert into t select 'S06 a failed distribution is not hidden by a later healthy one',
  (select last_attempt_state = 'PARTIAL' and last_attempt_at = '2026-11-13 10:16:25+00' and last_success_at = '2026-11-12 10:16:26+00' from f where source_key = 'epoch_ai'),
  (select row_to_json(f)::text from f where source_key = 'epoch_ai');
-- an open run (no completion) reads IN_FLIGHT
insert into public.dc_acquisition_run (source_key, distribution_key, started_at) values ('compute_atlas','facilities','2026-11-13 09:44:00+00');
insert into t select 'S07 an open newest run reads IN_FLIGHT; the last success and edition stay',
  (select last_attempt_state = 'IN_FLIGHT' and last_attempt_at = '2026-11-13 09:44:00+00' and last_success_at = '2026-11-06 09:45:05+00'
          and publisher_edition_at = '2026-11-05 18:24:03.746+00' from f where source_key = 'compute_atlas'), null;
-- one distribution never read completely -> the source has no complete read
insert into public.dc_source values ('half', 'Half', 'ACTIVE', '{a,b}');
insert into public.dc_acquisition_run (source_key, distribution_key, started_at, completed_at, completeness_state)
  values ('half','a','2026-11-12 01:00:00+00','2026-11-12 01:00:01+00','SUCCESS_COMPLETE');
insert into t select 'S08 a source with a distribution never read has no last success',
  (select last_success_at is null from f where source_key = 'half'), null;

insert into t select 'S09 anon and authenticated may run the reader but may not read the tables',
  has_function_privilege('anon', 'public.dc_source_freshness()', 'execute')
  and has_function_privilege('authenticated', 'public.dc_source_freshness()', 'execute')
  and not has_table_privilege('anon', 'public.dc_acquisition_run', 'select')
  and not has_table_privilege('anon', 'public.dc_source', 'select'), null;
insert into t select 'S10 PUBLIC holds no grant on the reader',
  not exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.dc_source_freshness()'::regprocedure and a.grantee = 0), null;
insert into t select 'S11 the answer carries no URL, failure detail or run id',
  (select array_agg(a.attname::text order by a.attnum) from pg_attribute a where a.attrelid = 'f'::regclass and a.attnum > 0)
    = '{source_key,source_name,publisher_edition_at,last_success_at,last_attempt_at,last_attempt_state}'
  and (select count(*) from f where row_to_json(f)::text ~* 'secret|404|http') = 0, null;
insert into t select 'S12 stable, security definer, pinned search_path',
  (select p.provolatile = 's' and p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'] from pg_proc p where p.oid = 'public.dc_source_freshness()'::regprocedure), null;

set role anon;
select count(*) as anon_rows from public.dc_source_freshness() \gset
reset role;
insert into t select 'S13 as anon the reader answers', :anon_rows >= 3, null;

select id, ok, coalesce(detail, '') from t order by id;
-- a NULL verdict is a failure: count only rows that are TRUE
select case when count(*) filter (where ok is true) = 13 and count(*) = 13 then 'SUITE PASS ' || count(*) else 'SUITE FAIL' end from t;
