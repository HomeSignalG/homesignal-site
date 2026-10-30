-- Official records + proposal job suite. Every row: name|t-or-f|detail. Any '|f|' fails the run.
\set ON_ERROR_STOP 1
create temp table ck (n serial, name text, ok boolean, detail text);
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into ck (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
create or replace function pg_temp.try(p_role text, p_uid text, p_sql text) returns text
language plpgsql as $$
declare st text := 'ok';
begin
  begin
    perform set_config('test.uid', coalesce(p_uid, ''), true);
    execute format('set local role %I', p_role);
    execute p_sql;
    reset role;
  exception when others then st := sqlstate; reset role;
  end;
  perform set_config('test.uid', '', true);
  return st;
end $$;

\set rev '11111111-1111-4111-8111-111111111111'
insert into public.development_reviewer (user_id, granted_by) values (:'rev', 'founder');
select set_config('test.uid', :'rev', false);
select public.development_project_create('stratos-box-elder', 'UT');
create temp table seed as
select public.development_link_propose('stratos-box-elder', k, r, ro, 'a', u, 'label', null, 'note', t) id, k, r
  from (values
    ('land_assembly', 'stratos-box-elder', 'associated_land', 'https://example.gov/land', 'land'),
    ('water_filing', 'ut_dwr:a55167', 'water_change_application', 'https://www.waterrights.utah.gov/asp_apps/chprint/chprint.asp?chnum=a55167', 'filing'),
    ('organization', 'UT:MIDA', 'governing_body', 'https://www.utah.gov/pmn/sitemap/publicbody/1077.html', 'MIDA'),
    ('organization', 'UT:Bar H Ranch Inc.', 'applicant', 'https://www.waterrights.utah.gov/search/?q=a55167', 'Bar H'),
    ('organization', 'UT:Murray Hollow LC', 'landowner_of_record', 'https://erecord.example.gov/R3', 'Murray')
  ) v(k, r, ro, u, t);
select public.development_link_decide(id, case when r = 'UT:Murray Hollow LC' then 'rejected' else 'approved' end,
                                      case when r = 'UT:Murray Hollow LC' then 'not this project' end) from seed;
select set_config('test.uid', '', false);

-- 1. grants
select pg_temp.ck('grants: anon reads no official record table',
  pg_temp.try('anon', null, 'select * from public.official_record') = '42501'
  and pg_temp.try('anon', null, 'select * from public.official_record_party') = '42501'
  and pg_temp.try('anon', null, 'select * from public.official_record_observation') = '42501');
select pg_temp.ck('grants: authenticated reads none either',
  pg_temp.try('authenticated', :'rev', 'select * from public.official_record') = '42501');
select pg_temp.ck('grants: only service_role writes or proposes',
  pg_temp.try('anon', null, $q$select public.official_records_ingest('{"records":[]}')$q$) = '42501'
  and pg_temp.try('authenticated', :'rev', $q$select public.development_propose_from_records('x')$q$) = '42501'
  and pg_temp.try('authenticated', :'rev', 'select * from public.official_records_watch_list()') = '42501'
  and pg_temp.try('service_role', null, 'select * from public.official_records_watch_list()') = 'ok');

-- 2. entity names
select pg_temp.ck('names: a legal form is an organization; a person or family trust is not',
  public.development_entity_is_organization('Bar H Ranch, Inc.') and public.development_entity_is_organization('MURRAY HOLLOW LC')
  and public.development_entity_is_organization('Utah Division of Water Rights')
  and public.development_entity_is_organization('O`Leary Digital Utah DC Sub I, L.L.C.')
  and not public.development_entity_is_organization('JOHN Q DOE')
  and not public.development_entity_is_organization('Jane Roe Family Trust')
  and not public.development_entity_is_organization('Smith Ranch'));
select pg_temp.ck('names: spellings of one entity share a key',
  public.development_entity_keys('Bar H Ranch, Inc.') && public.development_entity_keys('BAR H RANCH INCORPORATED')
  and public.development_entity_keys('O`Leary Digital Utah DC Sub I, LLC') && public.development_entity_keys('O''Leary Digital Utah DC Sub I, L L C')
  and public.development_entity_keys('Military Installation Development Authority (MIDA)') && public.development_entity_keys('MIDA')
  and not (public.development_entity_keys('Bar H Land LLC') && public.development_entity_keys('Bar H Ranch Inc')));

-- 3. the watch list is every linked water filing
select pg_temp.ck('watch list: the linked filing',
  (select array_agg(subject_ref) from public.official_records_watch_list()) = array['ut_dwr:a55167']);

-- 4. ingest
\set payload '{"source":"ut_dwr","subject_ref":"ut_dwr:a55167","complete":true,"records":[{"record_key":"ut_dwr_change:a55167","kind":"change_record","parent_key":"ut_dwr_folder:13-2","title":"Change Details a55167 (water right 13-2)","url":"https://www.waterrights.utah.gov/asp_apps/chprint/chprint.asp?chnum=a55167","filed_on":"2026-10-15","content_sha256":"aa","facts":{"status":"Unapproved"},"parties":[{"name":"Bar H Ranch, Inc.","role":"owner","quote":"Name: Bar H Ranch, Inc."},{"name":"O''Leary Digital Utah DC Sub I, LLC","role":"buyer_under_contract","quote":"O''Leary Digital Utah DC Sub I, LLC, is under contract to purchase this"},{"name":"O`Leary Digital Utah DC Sub I, LLC","role":"developer","quote":"to be developed by O`Leary Digital Utah DC Sub I, LLC"}]},{"record_key":"ut_dwr_folder:13-2","kind":"document_folder","title":"Scanned documents for water right 13-2","url":"https://waterrights.utah.gov/cgi-bin/docview.exe?Folder=13-2","content_sha256":"bb"},{"record_key":"ut_dwr_doc:0689/06893380","kind":"document","parent_key":"ut_dwr_folder:13-2","title":"Change Application (Oct 15, 2026)","doc_type":"Change Application","filed_on":"2026-10-15","url":"https://waterrights.utah.gov/docImport/0689/06893380.pdf"},{"record_key":"ut_dwr_doc:0666/06669416","kind":"document","parent_key":"ut_dwr_folder:13-2","title":"Change Application (Apr 29, 1968)","doc_type":"Change Application","filed_on":"1968-04-29","url":"https://waterrights.utah.gov/docImport/0666/06669416.pdf"},{"record_key":"ut_dwr_doc:0689/06894173","kind":"document","parent_key":"ut_dwr_folder:13-2","title":"Letter of Concern","doc_type":"Letter of Concern","filed_on":"2026-10-16","url":"https://waterrights.utah.gov/docImport/0689/06894173.pdf"},{"record_key":"ut_dwr_doc:0689/06894529","kind":"document","parent_key":"ut_dwr_folder:13-2","title":"Correspondence","doc_type":"Correspondence","filed_on":"2026-10-21","url":"https://waterrights.utah.gov/docImport/0689/06894529.pdf"},{"record_key":"ut_dwr_doc:0689/06899999","kind":"document","parent_key":"ut_dwr_folder:13-2","title":"Protest of Application","doc_type":"Protest of Application","filed_on":"2026-10-22","url":"https://waterrights.utah.gov/docImport/0689/06899999.pdf"}]}'
set role service_role;
select public.official_records_ingest(:'payload') as r1 \gset
reset role;
select pg_temp.ck('ingest: seven records new, three parties', (:'r1'::jsonb ->> 'new')::int = 7
  and (select count(*) from public.official_record_party) = 3, :'r1');
select pg_temp.ck('ingest: refuses a person as a party',
  pg_temp.try('service_role', null, $q$select public.official_records_ingest('{"source":"ut_dwr","records":[{"record_key":"ut_dwr_change:a1","kind":"change_record","title":"x","url":"https://x.gov/","parties":[{"name":"John Q Doe","role":"owner","quote":"Name: John Q Doe"}]}]}')$q$) = '22023'
  and not exists (select 1 from public.official_record where record_key = 'ut_dwr_change:a1'));
select pg_temp.ck('ingest: the table refuses a person too',
  pg_temp.try('postgres', null, $q$insert into public.official_record_party values ('ut_dwr_change:a55167','X','John Q Doe','owner','q')$q$) = '23514');
set role service_role;
select public.official_records_ingest(:'payload') as r2 \gset
reset role;
select pg_temp.ck('ingest: an identical reading changes nothing and adds no observation',
  (:'r2'::jsonb ->> 'new')::int = 0 and (:'r2'::jsonb ->> 'changed')::int = 0 and (:'r2'::jsonb ->> 'seen')::int = 7
  and (select count(*) from public.official_record_observation) = 7, :'r2');
set role service_role;
select public.official_records_ingest(replace(:'payload', '"status":"Unapproved"', '"status":"Approved"')::jsonb) as r3 \gset
reset role;
select pg_temp.ck('ingest: a changed record keeps its history (one new observation)',
  (:'r3'::jsonb ->> 'changed')::int = 1
  and (select count(*) from public.official_record_observation where record_key = 'ut_dwr_change:a55167') = 2
  and (select facts ->> 'status' from public.official_record where record_key = 'ut_dwr_change:a55167') = 'Approved', :'r3');
select pg_temp.ck('ingest: observations are append-only',
  pg_temp.try('postgres', null, 'delete from public.official_record_observation') = '42501'
  and pg_temp.try('postgres', null, $q$update public.official_record_observation set title = 'x'$q$) = '42501');

-- 5. the proposal job
set role service_role;
create temp table p1 as select * from public.development_propose_from_records('official-records-test');
reset role;
select pg_temp.ck('propose: exactly the expected candidates',
  (select array_agg(x order by x collate "C") from (select object_kind || '|' || object_ref || '|' || role x from p1) q) = array[
    'document|https://waterrights.utah.gov/docImport/0689/06893380.pdf|primary_document',
    'organization|UT:BAR H RANCH INC|landowner_of_record',
    'organization|UT:BULL PASS RANCH LLC|landowner_of_record',
    'organization|UT:O''Leary Digital Utah DC Sub I, LLC|buyer_under_contract',
    'organization|UT:O''Leary Digital Utah DC Sub I, LLC|master_developer',
    'water_filing|ut_dwr:a60001|water_change_application'],
  (select string_agg(object_kind || '|' || object_ref || '|' || role, ' ; ' order by 1) from p1));
select pg_temp.ck('propose: every row is a candidate from the job, none approved',
  (select count(*) from public.development_project_link where proposed_by = 'automated:official-records-test') = 6
  and not exists (select 1 from public.development_project_link where proposed_by = 'automated:official-records-test'
                  and link_state <> 'candidate'));
select pg_temp.ck('propose: carries the record quote and source',
  exists (select 1 from public.development_project_link where object_ref = 'UT:O''Leary Digital Utah DC Sub I, LLC'
          and evidence_quote like '%under contract to purchase%' and evidence_url like 'https://www.waterrights.utah.gov/%'));
select pg_temp.ck('propose: never a rejected entity, a person, a trust, a non-anchor parcel, an unverified body',
  not exists (select 1 from p1 where object_ref ilike '%murray%' or object_ref ilike '%doe%' or object_ref ilike '%trust%'
              or object_ref ilike '%hansel%' or object_ref ilike '%commission%' or object_ref ilike '%mida%'));
select pg_temp.ck('propose: never a protest, letter of concern, correspondence or an old document',
  not exists (select 1 from p1 where object_ref ~ '(06894173|06894529|06669416|06899999)'));
set role service_role;
create temp table p2 as select * from public.development_propose_from_records('official-records-test');
reset role;
select pg_temp.ck('propose: a second run proposes nothing new', (select count(*) from p2) = 0);
select pg_temp.ck('propose: candidates are not in the published snapshot',
  not (public.development_dossier_snapshot()::text like '%Bull Pass%'));

-- 6. a complete reading marks what left the source
set role service_role;
select public.official_records_ingest(
  replace(replace(:'payload', ',{"name":"O`Leary Digital Utah DC Sub I, LLC","role":"developer","quote":"to be developed by O`Leary Digital Utah DC Sub I, LLC"}', ''),
          ',{"record_key":"ut_dwr_doc:0689/06894529","kind":"document","parent_key":"ut_dwr_folder:13-2","title":"Correspondence","doc_type":"Correspondence","filed_on":"2026-10-21","url":"https://waterrights.utah.gov/docImport/0689/06894529.pdf"}', '')::jsonb) as r4 \gset
reset role;
select pg_temp.ck('ingest: a party no longer named is marked removed, not deleted',
  (select removed_at is not null from public.official_record_party where role = 'developer'), :'r4');
select pg_temp.ck('ingest: a document no longer listed is marked removed, not deleted',
  (select removed_from_source_at is not null from public.official_record where record_key = 'ut_dwr_doc:0689/06894529')
  and (:'r4'::jsonb ->> 'removed')::int = 1, :'r4');

select n, name, case when ok then 't' else 'f' end, detail from ck order by n;
