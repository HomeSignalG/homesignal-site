\pset tuples_only on
\pset format unaligned
create function public.t(n text, ok boolean) returns text language sql as $$ select case when ok then 'PASS ' else 'FAIL ' end || n $$;
-- read as a role: 'ok:<rows>' | 'denied' | 'err:<sqlstate>'
create function public.t_read(r text, rel text) returns text language plpgsql as $$
declare n bigint;
begin
  execute format('set local role %I', r);
  begin execute format('select count(*) from %s', rel) into n;
  exception when insufficient_privilege then reset role; return 'denied';
            when others then reset role; return 'err:'||sqlstate; end;
  reset role; return 'ok:'||n;
end $$;
create function public.t_snap() returns text language sql as $$
  select jsonb_build_object('viewdef', md5(pg_get_viewdef('public.dc_current_observation'::regclass)),
     'owner', pg_get_userbyid(c.relowner), 'acl', c.relacl::text, 'comment', obj_description(c.oid),
     'cols', (select string_agg(attname||':'||format_type(atttypid,atttypmod), ',' order by attnum) from pg_attribute where attrelid=c.oid and attnum>0 and not attisdropped),
     'kind', c.relkind)::text from pg_class c where c.oid='public.dc_current_observation'::regclass $$;
create function public.t_opts() returns text language sql as $$ select coalesce(reloptions::text,'null') from pg_class where oid='public.dc_current_observation'::regclass $$;

select 'INFO server ' || current_setting('server_version');
select public.t('A1 starting state (what dc-step3c-view-grants-fix.sql leaves): security_invoker=true', public.t_opts()='{security_invoker=true}');

-- B. REPRODUCE THE LOSS: replay the merged definition (verbatim from the file as merged)
set role dc_owner; \i :here/old-definition.sql
reset role;
select public.t('B1 replaying the merged definition DROPS security_invoker (reloptions=null)', public.t_opts()='null');

-- stand-ins: the seven production dependents are security_invoker views that read the base view
set role dc_owner;
create view public.dc_identity_candidate with (security_invoker=true) as select * from public.dc_current_observation;
create view public.dc_resident_lineage_ledger with (security_invoker=true) as select * from public.dc_current_observation;
create view public.dc_observation_derived_point with (security_invoker=true) as select * from public.dc_current_observation;
create view public.dc_observation_site_address with (security_invoker=true) as select * from public.dc_current_observation;
create view public.dc_record_identity with (security_invoker=true) as select * from public.dc_current_observation;
create view public.dc_entity_geography_evidence with (security_invoker=true) as select * from public.dc_current_observation;
create view public.dc_map1_address_check with (security_invoker=true) as select * from public.dc_current_observation;
reset role;
grant select on public.dc_current_observation to service_role;
grant select on public.dc_identity_candidate, public.dc_resident_lineage_ledger, public.dc_observation_derived_point,
  public.dc_observation_site_address, public.dc_record_identity, public.dc_entity_geography_evidence, public.dc_map1_address_check to service_role;
grant select on public.dc_current_observation to no_base, rls_reader;
grant select on public.dc_acquisition_run, public.dc_source_observation to rls_reader;
-- EXECUTE on a function called inside a view is checked against the CALLING role even for a definer-style view
grant execute on function public.dc_source_map_admitted(text,text) to rls_reader, no_base;

-- C. BEFORE the ALTER (the state production is in now)
create temp table snaps(k text, v text);
insert into snaps values ('S0', public.t_snap()), ('S0opts', public.t_opts());
select public.t('C1 service_role reads the view (2 rows)', public.t_read('service_role','public.dc_current_observation')='ok:2');
select public.t('C2 service_role reads dependent '||d, public.t_read('service_role','public.'||d)='ok:2')
  from unnest(array['dc_identity_candidate','dc_resident_lineage_ledger','dc_observation_derived_point','dc_observation_site_address','dc_record_identity','dc_entity_geography_evidence','dc_map1_address_check']) d;
select public.t('C3 anon denied on the view', public.t_read('anon','public.dc_current_observation')='denied');
select public.t('C4 authenticated denied on the view', public.t_read('authenticated','public.dc_current_observation')='denied');
select public.t('C5 [probe role] view-only role reads through the owner (before)', public.t_read('no_base','public.dc_current_observation')='ok:2');
select public.t('C6 [probe role] non-BYPASSRLS role sees rows through the owner (before)', public.t_read('rls_reader','public.dc_current_observation')='ok:2');

-- D. THE PROPOSED STATEMENT, and nothing else
set role dc_owner; alter view public.dc_current_observation set (security_invoker = true); reset role;
insert into snaps values ('S1', public.t_snap()), ('S1opts', public.t_opts());
select public.t('D1 reloptions is now {security_invoker=true}', (select v from snaps where k='S1opts')='{security_invoker=true}');
select public.t('D2 definition, owner, ACL, comment, columns, kind are byte-identical before/after', (select v from snaps where k='S0')=(select v from snaps where k='S1'));

-- E. AFTER the ALTER
select public.t('E1 service_role reads the view (2 rows)', public.t_read('service_role','public.dc_current_observation')='ok:2');
select public.t('E2 service_role reads dependent '||d, public.t_read('service_role','public.'||d)='ok:2')
  from unnest(array['dc_identity_candidate','dc_resident_lineage_ledger','dc_observation_derived_point','dc_observation_site_address','dc_record_identity','dc_entity_geography_evidence','dc_map1_address_check']) d;
select public.t('E3 anon still denied', public.t_read('anon','public.dc_current_observation')='denied');
select public.t('E4 authenticated still denied', public.t_read('authenticated','public.dc_current_observation')='denied');
select public.t('E5 [probe role] a view-only role is now DENIED (privileges are checked as the caller)', public.t_read('no_base','public.dc_current_observation')='denied');
select public.t('E6 [probe role] a non-BYPASSRLS role now sees 0 rows (RLS applies to the caller)', public.t_read('rls_reader','public.dc_current_observation')='ok:0');
select public.t('E7 service_role holds SELECT on both base tables and EXECUTE on the gate function (not inferred from BYPASSRLS)',
  has_table_privilege('service_role','public.dc_source_observation','select') and has_table_privilege('service_role','public.dc_acquisition_run','select')
  and has_function_privilege('service_role','public.dc_source_map_admitted(text,text)','execute'));
select public.t('E8 anon/authenticated hold none of those privileges',
  not (has_table_privilege('anon','public.dc_source_observation','select') or has_table_privilege('authenticated','public.dc_source_observation','select')
    or has_function_privilege('anon','public.dc_source_map_admitted(text,text)','execute')));

-- F. ROLLBACK statement restores the prior state exactly
set role dc_owner; alter view public.dc_current_observation reset (security_invoker); reset role;
select public.t('F1 rollback returns reloptions to null', public.t_opts()='null');
select public.t('F2 rollback leaves everything else identical', public.t_snap()=(select v from snaps where k='S0'));
select public.t('F3 [probe role] the view-only role reads again after rollback', public.t_read('no_base','public.dc_current_observation')='ok:2');

-- G. THE DURABLE FIX: the authoritative text from the repaired file, replayed from the lost state
set role dc_owner; \i :here/.new-definition.sql
reset role;
select public.t('G1 replaying the repaired definition from the lost state yields security_invoker=true', public.t_opts()='{security_invoker=true}');
select public.t('G2 ... and changes nothing else (definition, owner, ACL, comment, columns)', public.t_snap()=(select v from snaps where k='S0'));
set role dc_owner; \i :here/.new-definition.sql
reset role;
select public.t('G3 replaying it again is idempotent', public.t_opts()='{security_invoker=true}' and public.t_snap()=(select v from snaps where k='S0'));
select public.t('G4 after the repaired replay anon is still denied and service_role still reads',
  public.t_read('anon','public.dc_current_observation')='denied' and public.t_read('service_role','public.dc_current_observation')='ok:2');
select 'INFO replica viewdef md5 '||(select (v::jsonb)->>'viewdef' from snaps where k='S0')||' | production 2026-11-20 bbc58f10a4520704f7b8fe58ab65691d';
select 'DONE suite complete';
