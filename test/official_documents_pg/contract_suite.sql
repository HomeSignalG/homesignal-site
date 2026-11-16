-- OFFICIAL DOCUMENTS PR 1, evidence contract: docs/official-documents-contract.sql on the REAL Step-2A files
-- (dc-step2a-foundation, dc-step2b1a, dc-artifact-foundation). Expects psql variables fp_before (md5 of every
-- dc_source contract before the file) and is run after the file was applied twice.
\set ON_ERROR_STOP 1
create temp table if not exists _c (n serial, check_name text, pass boolean, detail text);
truncate _c;

insert into _c (check_name, pass, detail)
select 'C1 every pre-existing contract keeps its version and fingerprint',
       md5(string_agg(source_key || ':' || contract_version || ':' || contract_fingerprint, ',' order by source_key collate "C"))
         = :'fp_before', null
  from public.dc_source where source_key <> 'official_documents';
insert into _c (check_name, pass, detail)
select 'C2 official_documents is NOT_ACTIVE, unscheduled, incremental, three distributions',
       active_state = 'NOT_ACTIVE' and schedule_cron is null and release_mode = 'incremental'
       and distributions = array['official_listing', 'meeting_packets', 'tx_tceq_air'], active_state || '/' || release_mode
  from public.dc_source where source_key = 'official_documents';
insert into _c (check_name, pass, detail)
select 'C3 its fingerprint carries the incremental mode (and the formula is the shipped one plus that term)',
       contract_fingerprint = md5('official_documents|' || contract_version || '|true|true|true|false|false|1|SOURCE_RECORD_NOT_SEEN|'
                                  || 'release_mode=incremental|meeting_packets,official_listing,tx_tceq_air'),
       contract_fingerprint
  from public.dc_source where source_key = 'official_documents';

-- runs are inserted in a transaction that is rolled back; only the results are kept
begin;
insert into public.dc_acquisition_run (source_key, distribution_key, trigger_kind, request_url, parser_key, parser_version,
    source_contract_version, source_contract, source_contract_fingerprint)
values ('official_documents', 'official_listing', 'manual', 'https://example.gov/', 'p', '1', 0, '{}'::jsonb, ''),
       ('compute_atlas', 'facilities', 'manual', 'https://example.org/', 'p', '1', 0, '{}'::jsonb, '');
create temp table _snap on commit drop as select source_key, source_contract from public.dc_acquisition_run;
update public.dc_source set release_mode = 'incremental' where source_key = 'epoch_ai';
create temp table _bump on commit drop as select contract_version from public.dc_source where source_key = 'epoch_ai';
select coalesce((select (source_contract->>'release_mode') = 'incremental' from _snap where source_key = 'official_documents'), false) c4,
       coalesce((select not (source_contract ? 'release_mode') from _snap where source_key = 'compute_atlas'), false) c5,
       coalesce((select contract_version = 2 from _bump), false) c6 \gset
rollback;
insert into _c (check_name, pass, detail) values ('C4 an official-documents run freezes release_mode incremental', :'c4'::boolean, null);
insert into _c (check_name, pass, detail) values ('C5 a whole-release run''s snapshot has no release_mode key', :'c5'::boolean, null);
insert into _c (check_name, pass, detail) values ('C6 changing release_mode bumps the contract version', :'c6'::boolean, null);
insert into _c (check_name, pass, detail)
select 'C7 nothing was left behind', count(*) = 0 and (select release_mode from public.dc_source where source_key = 'epoch_ai') = 'whole',
       count(*)::text from public.dc_acquisition_run;
insert into _c (check_name, pass, detail)
select 'C8 the Step-2A selftest passes in full with the change applied', bool_and(passed) and count(*) >= 74,
       count(*) || ' checks; failing: ' || coalesce(string_agg(check_name, '; ') filter (where not passed), 'none')
  from public.dc_step2a_selftest();
insert into _c (check_name, pass, detail)
select 'C9 an invalid release mode is refused', false, null;
do $$ begin
  update public.dc_source set release_mode = 'sometimes' where source_key = 'epoch_ai';
exception when check_violation then update _c set pass = true, detail = sqlerrm where check_name = 'C9 an invalid release mode is refused'; end $$;

select check_name || '|' || coalesce(case when pass then 't' else 'f' end, 'f') || '|' || coalesce(detail, '') from _c order by n;
