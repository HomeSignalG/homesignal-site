\set ON_ERROR_STOP on
insert into public.bsky_maps_priority_classification values ('11111','eligible'),('11111','eligible'),('22222','eligible'),('33333','eligible'),('44444','eligible'),('55555','not_eligible');
insert into public.communities(zip_codes) values ('{11111}'),('{22222}'),('{33333}');
insert into geo.zcta_boundary values ('11111'),('22222'),('33333'),('44444');
insert into public._core_facts values
 ('11111','{"sources":[{"registry_id":"a","failures_48h":0}],"failures_without_records":[],"not_in_serving_generation":0,"report":{"refreshed_at":"2099-01-01T00:00:00Z"}}'),
 ('22222','{"sources":[],"failures_without_records":[],"not_in_serving_generation":0}'),
 ('33333','{"sources":[{"registry_id":"a","failures_48h":1}],"failures_without_records":[]}');
select public.subscriber_zip_lifecycle_sync() \gset s1_
select case when count(*)=4 then 'PASS' else 'FAIL' end as "T1 four subscriber ZIPs registered, shared ZIP deduped" from public.subscriber_zip_lifecycle;
select case when active_subscribers=2 then 'PASS' else 'FAIL' end as "T2 two subscribers on one ZIP = one row, count 2" from public.subscriber_zip_lifecycle where zip='11111';
select case when count(*)=0 then 'PASS' else 'FAIL' end as "T3 non-eligible ZIP is not registered" from public.subscriber_zip_lifecycle where zip='55555';
select case when stage='reconciliation' then 'PASS' else 'FAIL' end as "T4 clean facts but no reconciliation stops at reconciliation (never verified)" from public.subscriber_zip_lifecycle where zip='11111';
select case when stage='source_assessment' then 'PASS' else 'FAIL' end as "T5 no source -> source_assessment" from public.subscriber_zip_lifecycle where zip='22222';
select case when stage='remediation_queue' then 'PASS' else 'FAIL' end as "T6 failing source -> remediation_queue" from public.subscriber_zip_lifecycle where zip='33333';
select case when stage='geographic_validation' then 'PASS' else 'FAIL' end as "T7 no community row -> geographic_validation" from public.subscriber_zip_lifecycle where zip='44444';
-- idempotent: second run changes no stage
select public.subscriber_zip_lifecycle_sync()->>'stage_changes' as sc \gset
select case when :'sc'='0' then 'PASS' else 'FAIL' end as "T8 re-run is idempotent";
select case when count(*)=4 then 'PASS' else 'FAIL' end as "T9 history holds one entry per first stage" from public.subscriber_zip_lifecycle_history;
-- reconciliation recorded -> advances past reconciliation
update public.subscriber_zip_lifecycle set reconciliation_at=now() where zip='11111';
select public.subscriber_zip_lifecycle_sync();
select case when stage='public_page_verification' then 'PASS' else 'FAIL' end as "T10 recorded reconciliation advances the ceiling" from public.subscriber_zip_lifecycle where zip='11111';
-- subscriber leaves: deprioritized, never deleted
delete from public.bsky_maps_priority_classification where zip='22222';
select public.subscriber_zip_lifecycle_sync();
select case when deprioritized_at is not null and active_subscribers=0 then 'PASS' else 'FAIL' end as "T11 lost subscribers -> deprioritized, row kept" from public.subscriber_zip_lifecycle where zip='22222';
-- returns: reactivated
insert into public.bsky_maps_priority_classification values ('22222','eligible');
select public.subscriber_zip_lifecycle_sync();
select case when deprioritized_at is null and active_subscribers=1 then 'PASS' else 'FAIL' end as "T12 returning subscriber reactivates" from public.subscriber_zip_lifecycle where zip='22222';
select case when not has_function_privilege('anon','public.subscriber_zip_lifecycle_sync()','execute') and not has_table_privilege('anon','public.subscriber_zip_lifecycle','select') then 'PASS' else 'FAIL' end as "T13 anon cannot run or read";
