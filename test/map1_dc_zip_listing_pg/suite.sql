\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL — %', m; end if; raise notice 'PASS — %', m; end $$;

-- L01: first batch takes the 2 never-checked ZIPs in ZIP order
select pg_temp.ok(public.map1_dc_zip_listing_refresh(2) = 2, 'L01 a batch of 2 checks 2 ZIPs');
select pg_temp.ok((select array_agg(zip order by zip) from public.map1_dc_zip_listing) = array['10001','12345'],
  'L01 the never-checked ZIPs go first, in ZIP order (12345 errors, row recorded)');
select public.map1_dc_zip_listing_refresh(100);
-- L02 members only, ordered by source_key collate "C", stable fields only
select pg_temp.ok((select member_count from public.map1_dc_zip_listing where zip='94612') = 2, 'L02 only member rows are stored');
select pg_temp.ok((select listings->0->>'source_key' from public.map1_dc_zip_listing where zip='94612') = 'dc:A',
  'L02 listings are ordered by source_key in C collation');
select pg_temp.ok((select not (listings->0 ? 'last_seen_at') and not (listings->0 ? 'lat') from public.map1_dc_zip_listing where zip='94612'),
  'L02 last_seen_at and coordinates are not stored');
select pg_temp.ok((select member_count = 0 and listings = '[]'::jsonb from public.map1_dc_zip_listing where zip='99999'),
  'L02 a ZIP with no members is stored as empty');
-- L03 truncation
select pg_temp.ok((select truncated from public.map1_dc_zip_listing where zip='10001'), 'L03 has_more is stored as truncated');
-- L04 a failed read keeps the previous row and records why
select pg_temp.ok((select last_error like 'boom%' and checked_at = '-infinity' from public.map1_dc_zip_listing where zip='12345'),
  'L04 a failed read records its error and leaves the row unchecked');
-- L05 changed_at moves only on change
update public.map1_dc_zip_listing set changed_at = '2000-01-01', checked_at = '2000-01-01';
select public.map1_dc_zip_listing_refresh(100);
select pg_temp.ok((select changed_at = '2000-01-01' and checked_at > '2020-01-01' from public.map1_dc_zip_listing where zip='94612'),
  'L05 an unchanged re-check moves checked_at, not changed_at');
update public.fx_members set map_status='Operating' where source_key='dc:A';
update public.map1_dc_zip_listing set checked_at = '2000-01-01' where zip='94612';
-- 2: the failing 12345 (checked_at -infinity) is retried first on every run, then 94612
select public.map1_dc_zip_listing_refresh(2);
select pg_temp.ok((select changed_at > '2020-01-01' from public.map1_dc_zip_listing where zip='94612'), 'L05 a changed listing moves changed_at');
-- L06 a previous good row survives a failure
update public.map1_dc_zip_listing set listings='[{"x":1}]', member_count=1, checked_at='2001-01-01', last_error=null where zip='12345';
select public.map1_dc_zip_listing_refresh(1);
select pg_temp.ok((select member_count = 1 and checked_at = '2001-01-01' and last_error like 'boom%' from public.map1_dc_zip_listing where zip='12345'),
  'L06 a failed read keeps the previous listings and checked_at');
-- L07 a ZIP that left the registry loses its row
delete from public.canonical_zip_registry where zip='99999';
select public.map1_dc_zip_listing_refresh(1);
select pg_temp.ok(not exists (select 1 from public.map1_dc_zip_listing where zip='99999'), 'L07 a ZIP that left the registry is removed');
-- L08 grants
select pg_temp.ok(has_table_privilege('anon','public.map1_dc_zip_listing','select')
  and not has_table_privilege('anon','public.map1_dc_zip_listing','insert')
  and not has_table_privilege('authenticated','public.map1_dc_zip_listing','update'), 'L08 visitors can read, never write');
select pg_temp.ok(not has_function_privilege('anon','public.map1_dc_zip_listing_refresh(integer)','execute')
  and not has_function_privilege('authenticated','public.map1_dc_zip_listing_refresh(integer)','execute')
  and has_function_privilege('service_role','public.map1_dc_zip_listing_refresh(integer)','execute'),
  'L08 only the system can run the refresh');
-- L09 cron
select pg_temp.ok((select count(*) from cron.job where jobname='map1-dc-zip-listing' and schedule='*/10 * * * *') = 1,
  'L09 one cron job, every 10 minutes');
-- L10 the count constraint holds
do $$ begin
  begin update public.map1_dc_zip_listing set member_count = 7 where zip='94607';
        raise exception 'FAIL — L10 a count that disagrees with the listings was accepted';
  exception when check_violation then raise notice 'PASS — L10 member_count must equal the number of listings'; end;
end $$;
