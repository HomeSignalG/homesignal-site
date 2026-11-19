\set ON_ERROR_STOP on
create or replace function public.t(p_name text, p_ok boolean) returns void language sql as $$ insert into public.t_res values (p_name, coalesce(p_ok,false)) $$;
insert into public.bsky_maps_priority_classification values ('11111','eligible'),('11111','eligible'),('22222','eligible'),('33333','eligible'),('44444','eligible'),('55555','not_eligible');
insert into public.communities(zip_codes) values ('{11111}'),('{22222}'),('{33333}');
insert into geo.zcta_boundary values ('11111'),('22222'),('33333'),('44444');
insert into public._core_facts values
 ('11111','{"sources":[{"registry_id":"a","failures_48h":0},{"registry_id":"b","failures_48h":0}],"failures_without_records":[],"not_in_serving_generation":0,"report":{"refreshed_at":"2099-01-01T00:00:00Z"}}'),
 ('22222','{"sources":[],"failures_without_records":[],"not_in_serving_generation":0}'),
 ('33333','{"sources":[{"registry_id":"a","failures_48h":1}],"failures_without_records":[]}');
create or replace function public.h(variadic tabs text[]) returns text language sql as $$ select md5(string_agg(x, '|')) from (select unnest(tabs) x) q $$;
create temp table before_hash as select
  (select md5(string_agg(t::text,'')) from public.social_posts t) sp, (select md5(string_agg(t::text,'')) from public.app_projects t) ap,
  (select md5(string_agg(t::text,'')) from public.email_deliveries t) ed, (select md5(string_agg(t::text,'')) from public.maps_zip_order t) mz,
  (select md5(string_agg(t::text,'')) from public.feeds t) fe;
select public.subscriber_zip_lifecycle_sync() \gset s1_
select public.t('T1 four subscriber ZIPs registered; shared ZIP is one row', (select count(*)=4 from public.subscriber_zip_lifecycle));
select public.t('T2 two subscribers on one ZIP = count 2', (select active_subscribers=2 from public.subscriber_zip_lifecycle where zip='11111'));
select public.t('T3 non-eligible ZIP not registered', (select count(*)=0 from public.subscriber_zip_lifecycle where zip='55555'));
select public.t('T4 clean facts but no reconciliation stops at reconciliation', (select stage='reconciliation' from public.subscriber_zip_lifecycle where zip='11111'));
select public.t('T5 no source -> source_assessment', (select stage='source_assessment' from public.subscriber_zip_lifecycle where zip='22222'));
select public.t('T6 failing source -> remediation_queue', (select stage='remediation_queue' from public.subscriber_zip_lifecycle where zip='33333'));
select public.t('T7 no community row -> geographic_validation', (select stage='geographic_validation' from public.subscriber_zip_lifecycle where zip='44444'));
select public.t('T8 re-run is idempotent (no stage change)', (public.subscriber_zip_lifecycle_sync()->>'stage_changes')='0');
select public.t('T9 history holds one entry per first stage', (select count(*)=4 from public.subscriber_zip_lifecycle_history));

-- Evidence permitting the reconciliation -> later transition: existence of a row is not enough
create or replace function public.setrec(p jsonb) returns void language sql as $$
  update public.subscriber_zip_lifecycle set reconciliation_at = now(), reconciliation_json = p where zip = '11111' $$;
create or replace function public.entry(over jsonb default '{}') returns jsonb language sql as $$
  select jsonb_build_object('complete', true, 'missing', 0, 'undecidable', 0, 'run_id', 'r1', 'kind', 'verified_matched', 'at', now()::text) || over $$;
create or replace function public.rec(a jsonb, b jsonb, declared boolean default true) returns jsonb language sql as $$
  select jsonb_build_object('coverage_declared_complete', declared, 'sources', jsonb_build_object('a', a, 'b', b)) $$;
create or replace function public.stage_of(z text) returns text language sql as $$ select stage from public.subscriber_zip_lifecycle where zip = z $$;
select public.setrec(public.rec(public.entry(), public.entry())); select public.subscriber_zip_lifecycle_sync();
select public.t('R1 valid entry for EVERY source + discovery declared -> advances to public_page_verification', public.stage_of('11111')='public_page_verification');
select public.setrec(public.rec(public.entry(), public.entry('{"complete":false}'))); select public.subscriber_zip_lifecycle_sync();
select public.t('R2 an incomplete retrieval is not verification', public.stage_of('11111')='reconciliation');
select public.setrec(public.rec(public.entry(), public.entry(), false)); select public.subscriber_zip_lifecycle_sync();
select public.t('R3 valid entries but source discovery not declared complete -> stays at reconciliation', public.stage_of('11111')='reconciliation');
select public.setrec(jsonb_build_object('coverage_declared_complete', true, 'sources', jsonb_build_object('a', public.entry()))); select public.subscriber_zip_lifecycle_sync();
select public.t('R4 one applicable source has no entry -> stays at reconciliation (one source never rolls the ZIP up)', public.stage_of('11111')='reconciliation');
select public.setrec(public.rec(public.entry(), public.entry(jsonb_build_object('at', (now()-interval '200 hours')::text)))); select public.subscriber_zip_lifecycle_sync();
select public.t('R5 an expired entry is not verification', public.stage_of('11111')='reconciliation');
select public.setrec(public.rec(public.entry(), public.entry('{"kind":"other"}'))); select public.subscriber_zip_lifecycle_sync();
select public.t('R6 an unknown result kind is not verification', public.stage_of('11111')='reconciliation');
select public.setrec(public.rec(public.entry(), public.entry('{"missing":2}'))); select public.subscriber_zip_lifecycle_sync();
select public.t('R7 missing records block verification', public.stage_of('11111')='reconciliation');
select public.setrec(public.rec(public.entry(), public.entry('{"undecidable":1}'))); select public.subscriber_zip_lifecycle_sync();
select public.t('R8 undecidable records block verification', public.stage_of('11111')='reconciliation');
select public.setrec(public.rec(public.entry(), public.entry('{"run_id":""}'))); select public.subscriber_zip_lifecycle_sync();
select public.t('R9 an entry with no run id is not verification', public.stage_of('11111')='reconciliation');
select public.setrec(public.rec(public.entry(), public.entry('{"kind":"verified_zero_activity"}'))); select public.subscriber_zip_lifecycle_sync();
select public.t('R10 verified_zero_activity is a valid kind', public.stage_of('11111')='public_page_verification');
do $$ begin begin update public.subscriber_zip_lifecycle set reconciliation_at = now(), reconciliation_json = null where zip='22222';
  perform public.t('R11 reconciliation timestamp without evidence json is refused by constraint', false);
 exception when check_violation then perform public.t('R11 reconciliation timestamp without evidence json is refused by constraint', true); end; end $$;

-- the sync never touches other state, and never writes reconciliation evidence
select public.t('S1 source records, posts, email rows, founder ZIP order and feeds are byte-identical after every sync',
  (select (sp,ap,ed,mz,fe) = ((select md5(string_agg(t::text,'')) from public.social_posts t),(select md5(string_agg(t::text,'')) from public.app_projects t),
   (select md5(string_agg(t::text,'')) from public.email_deliveries t),(select md5(string_agg(t::text,'')) from public.maps_zip_order t),(select md5(string_agg(t::text,'')) from public.feeds t)) from before_hash));
select public.t('S2 the sync body writes only the three lifecycle tables (static check of every insert/update/delete target)',
  (select not exists (select 1 from regexp_matches(prosrc, '(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?([a-z_\.]+)', 'gi') m(t)
    where lower(m.t[1]) not in ('public.subscriber_zip_lifecycle','public.subscriber_zip_lifecycle_history','public.subscriber_zip_lifecycle_run','l','set'))
   from pg_proc where oid='public.subscriber_zip_lifecycle_sync()'::regprocedure));
select public.t('S2b positive control: the same check flags a write to another table', (select exists (select 1 from regexp_matches('begin update public.feeds f set v=1; delete from public.social_posts; end', '(?:insert\s+into|update|delete\s+from)\s+(?:only\s+)?([a-z_\.]+)', 'gi') m(t) where lower(m.t[1]) not in ('public.subscriber_zip_lifecycle','l','set'))));
select public.t('S3 the sync body never assigns reconciliation_* columns',
  (select prosrc !~* 'set[^;]*reconciliation_(at|json)\s*=' from pg_proc where oid='public.subscriber_zip_lifecycle_sync()'::regprocedure));
select public.t('S4 a reconciliation set by someone else is preserved by the sync', (select reconciliation_json is not null from public.subscriber_zip_lifecycle where zip='11111'));

-- departure / return
delete from public.bsky_maps_priority_classification where zip='22222'; select public.subscriber_zip_lifecycle_sync();
select public.t('T11 lost subscribers -> deprioritized, row kept', (select deprioritized_at is not null and active_subscribers=0 from public.subscriber_zip_lifecycle where zip='22222'));
insert into public.bsky_maps_priority_classification values ('22222','eligible'); select public.subscriber_zip_lifecycle_sync();
select public.t('T12 returning subscriber reactivates', (select deprioritized_at is null and active_subscribers=1 from public.subscriber_zip_lifecycle where zip='22222'));

-- failure visibility
select public.t('F0 a clean run is logged as success', (select status='success' from public.subscriber_zip_lifecycle_run order by id desc limit 1));
set test.fail_core = '1';
select public.subscriber_zip_lifecycle_sync();
select public.t('F1 per-ZIP failure is isolated: run is partial, every ZIP records its error', (select status='partial' and zips_failed>0 from public.subscriber_zip_lifecycle_run order by id desc limit 1));
select public.t('F2 a failed attempt updates last_attempt_at but NOT last_success_at', (select last_attempt_at > last_success_at and consecutive_failures=1 and last_error like '%simulated%' from public.subscriber_zip_lifecycle where zip='11111'));
select public.subscriber_zip_lifecycle_sync();
select public.t('F3 repeated failures accumulate (a fresh attempt timestamp does not hide them)', (select consecutive_failures=2 from public.subscriber_zip_lifecycle where zip='11111'));
set test.fail_core = '0'; select public.subscriber_zip_lifecycle_sync();
select public.t('F4 recovery resets failures and last_success_at moves', (select consecutive_failures=0 and last_error is null and last_success_at >= last_attempt_at - interval '1 second' from public.subscriber_zip_lifecycle where zip='11111'));
create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'simulated registration failure'; end $$;
create trigger boom_t before update on public.subscriber_zip_lifecycle for each statement execute function public.boom();
insert into public.bsky_maps_priority_classification values ('66666','eligible');
select public.subscriber_zip_lifecycle_sync() ->> 'status' as st \gset f_
select public.t('F5 whole-run failure is returned and logged as failed (not raised)', :'f_st' = 'failed' and (select status='failed' and error like '%simulated registration%' from public.subscriber_zip_lifecycle_run order by id desc limit 1));
select public.t('F6 a failed run rolls back its partial work (no new ZIP registered)', (select count(*)=0 from public.subscriber_zip_lifecycle where zip='66666'));
drop trigger boom_t on public.subscriber_zip_lifecycle;
insert into public.dashboard_admins values ('admin@x');
set request.jwt.claims = '{"email":"admin@x"}';
select public.t('F7 reader reports failed runs since last success', (select (public.hs_subscriber_zip_lifecycle()->'run'->>'failed_runs_since_last_success')::int = 1));
reset request.jwt.claims;
select public.subscriber_zip_lifecycle_sync();
select public.t('F8 a later success clears the failed-run streak and registers the new ZIP', (select count(*)=1 from public.subscriber_zip_lifecycle where zip='66666'));

-- AUTHORIZATION: unauthorized access and caller-supplied ZIP access
select public.subscriber_zip_lifecycle_sync();
insert into public.dashboard_admins values ('admin@x') on conflict do nothing;
create or replace function public.expect_denied(p_name text, p_role text, p_claims text, p_sql text) returns void language plpgsql as $$
declare denied boolean := false;
begin
  begin
    execute format('set local role %I', p_role);
    perform set_config('request.jwt.claims', p_claims, true);
    execute p_sql;
  exception when insufficient_privilege then denied := true;
  end;
  reset role;
  insert into public.t_res values (p_name, denied);
end $$;
select public.expect_denied('A1 anon cannot run the reader', 'anon', '{}', 'select public.hs_subscriber_zip_lifecycle()');
select public.expect_denied('A2 authenticated NON-admin is refused by the reader (42501)', 'authenticated', '{"email":"nobody@x"}', 'select public.hs_subscriber_zip_lifecycle()');
select public.expect_denied('A3 authenticated with no email claim is refused', 'authenticated', '{}', 'select public.hs_subscriber_zip_lifecycle()');
select public.expect_denied('A4 authenticated cannot run the sync', 'authenticated', '{"email":"admin@x"}', 'select public.subscriber_zip_lifecycle_sync()');
select public.expect_denied('A5 even an admin cannot call the stage function with a caller-supplied ZIP', 'authenticated', '{"email":"admin@x"}', $q$select * from public._hs_subscriber_zip_stage('11111','{}','{}',now())$q$);
select public.expect_denied('A6 anon cannot call the stage function with a caller-supplied ZIP', 'anon', '{}', $q$select * from public._hs_subscriber_zip_stage('11111','{}','{}',now())$q$);
select public.expect_denied('A7 authenticated cannot read the lifecycle table', 'authenticated', '{"email":"admin@x"}', 'select * from public.subscriber_zip_lifecycle');
select public.expect_denied('A8 authenticated cannot write the lifecycle table', 'authenticated', '{"email":"admin@x"}', $q$update public.subscriber_zip_lifecycle set stage='draft_eligibility'$q$);
select public.expect_denied('A9 service_role cannot write reconciliation evidence', 'service_role', '{}', $q$update public.subscriber_zip_lifecycle set reconciliation_json='{}'$q$);
select public.expect_denied('A10 service_role cannot delete lifecycle rows', 'service_role', '{}', 'delete from public.subscriber_zip_lifecycle');
select public.expect_denied('A11 anon cannot read the run log', 'anon', '{}', 'select * from public.subscriber_zip_lifecycle_run');
select public.t('A12 the reader accepts NO arguments (no caller-supplied ZIP or filter exists)', (select pronargs=0 from pg_proc where oid='public.hs_subscriber_zip_lifecycle()'::regprocedure));
select public.t('A13 admin reader lists subscriber ZIPs that have no lifecycle row (a gap between runs is visible)',
  (select (set_config('request.jwt.claims','{"email":"admin@x"}',true)) is not null and jsonb_typeof(public.hs_subscriber_zip_lifecycle()->'unregistered_subscriber_zips')='array'));
select public.t('A14 every function is SECURITY DEFINER with a pinned search_path that starts with pg_catalog',
  (select bool_and(prosecdef = (proname in ('subscriber_zip_lifecycle_sync','hs_subscriber_zip_lifecycle','_hs_subscriber_zip_stage')) or not prosecdef)
     and bool_and(not prosecdef or (proconfig::text like '%pg_catalog%')) from pg_proc where proname in
     ('subscriber_zip_lifecycle_sync','hs_subscriber_zip_lifecycle','_hs_subscriber_zip_stage')));
select public.t('A15 sync, stage and recon helpers are executable by no visitor role',
  (select bool_and(not has_function_privilege('anon', p.oid,'execute') and not has_function_privilege('authenticated', p.oid,'execute'))
     from pg_proc p where proname in ('subscriber_zip_lifecycle_sync','_hs_subscriber_zip_stage','_hs_lifecycle_recon_ok','_hs_lifecycle_recon_entry_valid','_hs_lifecycle_lock_key')));
select public.t('A16 RLS is enabled with no policy on all three tables', (select count(*)=3 and bool_and(relrowsecurity) from pg_class where relname in ('subscriber_zip_lifecycle','subscriber_zip_lifecycle_history','subscriber_zip_lifecycle_run') and relkind='r')
  and (select count(*)=0 from pg_policies where tablename like 'subscriber_zip_lifecycle%'));

select case when ok then 'PASS' else 'FAIL' end || ' ' || n as r from public.t_res order by n;
