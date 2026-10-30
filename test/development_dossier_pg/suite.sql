-- Development dossier suite. Every row: name|t-or-f|detail. Any '|f|' fails the run.
\set ON_ERROR_STOP 1
create temp table ck (n serial, name text, ok boolean, detail text);
create or replace function pg_temp.ck(p_name text, p_ok boolean, p_detail text default '') returns void
language sql as $$ insert into ck (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail) $$;
-- runs a statement as a role/user; returns the SQLSTATE it failed with, or 'ok'
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
create or replace function pg_temp.as_uid(p_uid text) returns void language sql as
  $$ select set_config('test.uid', coalesce(p_uid, ''), false) $$;

\set rev '11111111-1111-4111-8111-111111111111'
\set rev2 '22222222-2222-4222-8222-222222222222'
\set nobody '33333333-3333-4333-8333-333333333333'
insert into public.development_reviewer (user_id, granted_by) values (:'rev', 'founder');
insert into public.development_reviewer (user_id, granted_by, revoked_at) values (:'rev2', 'founder', now());

-- 1. grants
select pg_temp.ck('grants: anon reads no dossier table',
  pg_temp.try('anon', null, 'select * from public.development_project_link') = '42501'
  and pg_temp.try('anon', null, 'select * from public.development_project') = '42501');
select pg_temp.ck('grants: authenticated reads no dossier table',
  pg_temp.try('authenticated', :'rev', 'select * from public.development_project_link') = '42501'
  and pg_temp.try('authenticated', :'rev', 'select * from public.development_reviewer') = '42501');
select pg_temp.ck('grants: only service_role runs the snapshot',
  pg_temp.try('anon', null, 'select public.development_dossier_snapshot()') = '42501'
  and pg_temp.try('authenticated', :'rev', 'select public.development_dossier_snapshot()') = '42501'
  and pg_temp.try('service_role', null, 'select public.development_dossier_snapshot()') = 'ok');
select pg_temp.ck('grants: anon cannot propose or decide',
  pg_temp.try('anon', null, $q$select public.development_link_decide(gen_random_uuid(), 'approved')$q$) = '42501');

-- 2. projects
select pg_temp.ck('project: a non-reviewer cannot create one',
  pg_temp.try('authenticated', :'nobody', $q$select public.development_project_create('x-y', 'UT')$q$) = '42501');
select pg_temp.ck('project: a revoked reviewer cannot create one',
  pg_temp.try('authenticated', :'rev2', $q$select public.development_project_create('x-y', 'UT')$q$) = '42501');
select pg_temp.as_uid(:'rev');
select public.development_project_create('stratos-box-elder', 'ut') as p_stratos \gset
select public.development_project_create('proctor-4-tacoma', 'WA', 'Proctor 4 mixed-use development') as p_proctor \gset
select pg_temp.as_uid(null);
select pg_temp.ck('project: the key is permanent',
  pg_temp.try('postgres', null, $q$update public.development_project set project_key = 'other' where project_key = 'proctor-4-tacoma'$q$) = '42501');
select pg_temp.ck('project: a project is never deleted',
  pg_temp.try('postgres', null, $q$delete from public.development_project where project_key = 'proctor-4-tacoma'$q$) = '42501');
select pg_temp.ck('project: a bad key is refused',
  pg_temp.try('authenticated', :'rev', $q$select public.development_project_create('Stratos Box', 'UT')$q$) = '23514');

-- 3. proposing and deciding
select pg_temp.as_uid(null);
-- a job (service_role, no uid) proposes; the row is a candidate
set role service_role;
select public.development_link_propose('stratos-box-elder', 'water_filing', 'ut_dwr:a55167', 'water_change_application', 'a',
  'https://www.waterrights.utah.gov/search/?q=a55167', 'Change Details for a55167', null, null,
  'Change application a55167 filed on water right 13-2', '2026-10-15', 'Filed', 'Water', false, 'water-rights-match') as l_water \gset
reset role;
select pg_temp.ck('propose: a job''s link is a candidate named automated:<job>',
  (select link_state = 'candidate' and proposed_by = 'automated:water-rights-match' from public.development_project_link where link_id = :'l_water'));
select pg_temp.ck('propose: a job cannot insert an approved row directly',
  pg_temp.try('postgres', null, format($q$insert into public.development_project_link (project_id, object_kind, object_ref, role, grade,
     evidence_url, link_state, proposed_by, supersedes, decided_by, decided_at) values (%L, 'water_filing', 'ut_dwr:a1', 'water_change_application', 'a',
     'https://x.gov/a', 'approved', 'automated:job', %L, %L, now())$q$, :'p_stratos', :'l_water', :'nobody')) = '42501');
select pg_temp.ck('propose: an unnamed job is refused',
  pg_temp.try('service_role', null, $q$select public.development_link_propose('stratos-box-elder', 'water_filing', 'ut_dwr:a1',
     'water_change_application', 'a', 'https://x.gov/a')$q$) = '42501');
select pg_temp.ck('propose: a role that does not fit the kind is refused',
  pg_temp.try('authenticated', :'rev', $q$select public.development_link_propose('stratos-box-elder', 'water_filing', 'ut_dwr:a1',
     'landowner_of_record', 'a', 'https://x.gov/a')$q$) = '23514');
select pg_temp.ck('propose: a malformed object key is refused',
  pg_temp.try('authenticated', :'rev', $q$select public.development_link_propose('stratos-box-elder', 'youtube_video', 'q-phnTGrMRQ',
     'explains', 'a', 'https://x.gov/a')$q$) = '23514');
select pg_temp.ck('decide: a non-reviewer cannot approve',
  pg_temp.try('authenticated', :'nobody', format($q$select public.development_link_decide(%L, 'approved')$q$, :'l_water')) = '42501');
select pg_temp.ck('decide: a revoked reviewer cannot approve',
  pg_temp.try('authenticated', :'rev2', format($q$select public.development_link_decide(%L, 'approved')$q$, :'l_water')) = '42501');

select pg_temp.as_uid(:'rev');
select public.development_link_decide(:'l_water', 'approved') as l_water_ok \gset
select pg_temp.ck('decide: approval is a new row superseding the candidate; the candidate is unchanged',
  (select link_state = 'approved' and supersedes = :'l_water' and decided_by = :'rev'::uuid from public.development_project_link where link_id = :'l_water_ok')
  and (select link_state = 'candidate' from public.development_project_link where link_id = :'l_water'));
select pg_temp.ck('decide: a decided row cannot be decided again',
  pg_temp.try('authenticated', :'rev', format($q$select public.development_link_decide(%L, 'rejected', 'x')$q$, :'l_water')) = '23505');
select pg_temp.ck('append-only: a link row cannot be updated or deleted',
  pg_temp.try('postgres', null, format($q$update public.development_project_link set grade = 'b' where link_id = %L$q$, :'l_water_ok')) = '42501'
  and pg_temp.try('postgres', null, format($q$delete from public.development_project_link where link_id = %L$q$, :'l_water_ok')) = '42501');

-- grades c/d/e and private people cannot be approved
select public.development_link_propose('stratos-box-elder', 'news_report', 'https://www.ksl.com/article/1', 'reported_by', 'c',
  'https://www.ksl.com/article/1') as l_news \gset
select pg_temp.ck('decide: a grade c link cannot be approved',
  pg_temp.try('authenticated', :'rev', format($q$select public.development_link_decide(%L, 'approved')$q$, :'l_news')) = '23514');
select public.development_link_propose('stratos-box-elder', 'organization', 'UT:Jane Example', 'landowner_of_record', 'a',
  'https://example.gov/owner', null, null, null, 'A landowner', null, null, null, true) as l_person \gset
select pg_temp.ck('decide: a link naming a private person cannot be approved',
  pg_temp.try('authenticated', :'rev', format($q$select public.development_link_decide(%L, 'approved')$q$, :'l_person')) = '23514');
select public.development_link_propose('stratos-box-elder', 'organization', 'UT:O''Leary Digital Utah DC Sub I, LLC', 'buyer_under_contract', 'b',
  'https://www.waterrights.utah.gov/search/?q=a55167') as l_b_nonote \gset
select pg_temp.ck('decide: grade b needs evidence_note',
  pg_temp.try('authenticated', :'rev', format($q$select public.development_link_decide(%L, 'approved')$q$, :'l_b_nonote')) = '23514');
select pg_temp.ck('decide: rejecting needs a reason',
  pg_temp.try('authenticated', :'rev', format($q$select public.development_link_decide(%L, 'rejected')$q$, :'l_b_nonote')) = '23514');

-- organizations, defining record, land, media
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'organization', 'UT:Bar H Ranch, Inc.',
  'landowner_of_record', 'a', 'https://www.waterrights.utah.gov/search/?q=a55167', 'Change Details for a55167', null, null,
  'Owner of water right 13-2 and applicant on a55167'), 'approved') as l_barh \gset
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'dc_entity', 'fe2068de-0000-4000-8000-000000000001',
  'defining_record', 'a', 'https://www.compute-atlas.com/x'), 'approved') as l_def \gset
select public.development_link_propose('stratos-box-elder', 'source_record', 'wa-ecology-sepa:202603632|1', 'defining_record', 'a',
  'https://apps.ecology.wa.gov/x') as l_def2 \gset
select pg_temp.ck('defining: a second current defining record is refused',
  pg_temp.try('authenticated', :'rev', format($q$select public.development_link_decide(%L, 'approved')$q$, :'l_def2')) = '23505');
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'land_assembly', 'stratos-box-elder',
  'associated_land', 'a', 'https://example.gov/assembly'), 'approved') as l_land \gset
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'youtube_video', 'youtube:q-phnTGrMRQ',
  'explains', 'a', 'https://www.youtube.com/watch?v=q-phnTGrMRQ'), 'approved') as l_yt \gset
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'youtube_video', 'youtube:shortAAAAAA',
  'explains', 'a', 'https://www.youtube.com/shorts/shortAAAAAA'), 'approved') as l_short \gset
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'youtube_video', 'youtube:privateAAAA',
  'explains', 'a', 'https://www.youtube.com/watch?v=privateAAAA'), 'approved') as l_priv \gset
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'bluesky_post', 'bsky:at://did:plc:x/app.bsky.feed.post/aaa',
  'explains', 'a', 'https://bsky.app/profile/x/post/aaa'), 'approved') as l_bsky \gset
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'bluesky_post', 'bsky:at://did:plc:x/app.bsky.feed.post/bbb',
  'explains', 'a', 'https://bsky.app/profile/x/post/bbb'), 'approved') as l_bsky2 \gset
select public.development_link_decide(public.development_link_propose('stratos-box-elder', 'government_record', 'ut_pmn:1075195#item9',
  'agenda_item', 'a', 'https://www.utah.gov/pmn/sitemap/notice/1075195.html', null, null, null, 'MIDA board agenda item 9',
  '2026-07-15', 'On agenda', 'Approvals'), 'approved') as l_gov \gset

-- name authority
select pg_temp.ck('name: a project with a named land assembly cannot take a second name',
  pg_temp.try('authenticated', :'rev', $q$select public.development_project_set('stratos-box-elder', 'published', 'Stratos campus')$q$) = '23514');
select public.development_project_set('stratos-box-elder', 'published', null);
select public.development_project_set('proctor-4-tacoma', 'published', 'Proctor 4 mixed-use development');
select public.development_link_decide(public.development_link_propose('proctor-4-tacoma', 'source_record', 'wa-ecology-sepa:202603632|1',
  'defining_record', 'a', 'https://apps.ecology.wa.gov/separ/Main/SEPA/Record.aspx?SEPANumber=202603632'), 'approved') as l_pdef \gset

-- statements
select public.development_statement_write('stratos-box-elder', 'summary', 'A data center campus proposed for ranch land in Hansel Valley.',
  'https://www.waterrights.utah.gov/search/?q=a55167', 'Change Details for a55167') as s_sum \gset
select pg_temp.ck('statement: a fact without a source is refused',
  pg_temp.try('authenticated', :'rev', $q$select public.development_statement_write('stratos-box-elder', 'known', 'Something')$q$) = '23514');
select public.development_statement_write('stratos-box-elder', 'unknown', 'Whether MIDA adopted the items on its agenda.') as s_unk \gset
select pg_temp.ck('statement: a non-reviewer cannot write one',
  pg_temp.try('authenticated', :'nobody', $q$select public.development_statement_write('stratos-box-elder', 'unknown', 'x')$q$) = '42501');
select public.development_statement_write('stratos-box-elder', 'unknown', 'Whether MIDA and the County adopted the agenda items.',
  null, null, null, null, null, null, null, 0, :'s_unk') as s_unk2 \gset
select pg_temp.as_uid(null);

-- 4. the snapshot
set role service_role;
select public.development_dossier_snapshot() as snap \gset
reset role;
select pg_temp.ck('snapshot: both published projects, at their paths',
  (:'snap'::jsonb #>> '{dossiers,stratos-box-elder,path}') = '/development/ut/stratos-box-elder/'
  and (:'snap'::jsonb #>> '{dossiers,proctor-4-tacoma,path}') = '/development/wa/proctor-4-tacoma/', :'snap');
select pg_temp.ck('snapshot: Stratos is named by its land assembly, basis record',
  (:'snap'::jsonb #>> '{dossiers,stratos-box-elder,display_name}') = 'Stratos data center project'
  and (:'snap'::jsonb #>> '{dossiers,stratos-box-elder,name_source}') = 'resolved_project'
  and (:'snap'::jsonb #>> '{dossiers,stratos-box-elder,name_basis}') = 'record');
select pg_temp.ck('snapshot: a project with no app_projects record still publishes (defining = the DC entity)',
  (:'snap'::jsonb #>> '{dossiers,stratos-box-elder,defining,kind}') = 'dc_entity'
  and (:'snap'::jsonb #>> '{dossiers,stratos-box-elder,defining,facts,classification}') = 'CONFIRMED_DC');
select pg_temp.ck('snapshot: Proctor 4 defining record is the source record, with its facts and ZIPs',
  (:'snap'::jsonb #>> '{dossiers,proctor-4-tacoma,defining,facts,name}') = 'Proctor 4 - Mixed-Use Development'
  and (:'snap'::jsonb #> '{dossiers,proctor-4-tacoma,defining,facts,zips}') = '["98406","98407"]'::jsonb
  and (:'snap'::jsonb #>> '{dossiers,proctor-4-tacoma,name_source}') = 'project');
select pg_temp.ck('snapshot: the water filing carries the filing''s own facts',
  (select l #>> '{facts,filing_type}' = 'Permanent change application' and (l #>> '{facts,points}')::int = 2
          and l ->> 'date' = '2026-10-15' and l ->> 'date_label' = 'Filed'
     from jsonb_array_elements(:'snap'::jsonb #> '{dossiers,stratos-box-elder,links}') l where l ->> 'kind' = 'water_filing'));
select pg_temp.ck('snapshot: the main video and the Short are told apart',
  (select count(*) filter (where l #>> '{facts,kind}' = 'main') = 1 and count(*) filter (where l #>> '{facts,kind}' = 'short') = 1
     from jsonb_array_elements(:'snap'::jsonb #> '{dossiers,stratos-box-elder,links}') l where l ->> 'kind' = 'youtube_video'));
select pg_temp.ck('snapshot: a video not verified public and an unpublished post are withheld, and counted',
  not exists (select 1 from jsonb_array_elements(:'snap'::jsonb #> '{dossiers,stratos-box-elder,links}') l
               where l ->> 'ref' in ('youtube:privateAAAA', 'bsky:at://did:plc:x/app.bsky.feed.post/bbb'))
  and jsonb_array_length(:'snap'::jsonb #> '{dossiers,stratos-box-elder,withheld}') = 2);
select pg_temp.ck('snapshot: candidates, grade c and private-person links never appear',
  not exists (select 1 from jsonb_array_elements(:'snap'::jsonb #> '{dossiers,stratos-box-elder,links}') l
               where l ->> 'kind' = 'news_report' or l ->> 'ref' = 'UT:Jane Example'
                  or l ->> 'ref' like 'UT:O''Leary%'));
select pg_temp.ck('snapshot: a corrected statement replaces the old one',
  (select count(*) = 1 and bool_and(s ->> 'body' like '%County adopted%')
     from jsonb_array_elements(:'snap'::jsonb #> '{dossiers,stratos-box-elder,statements}') s where s ->> 'kind' = 'unknown'));

-- revocation: the link leaves the snapshot; its history stays
select pg_temp.as_uid(:'rev');
select pg_temp.ck('revoke: needs a reason',
  pg_temp.try('authenticated', :'rev', format($q$select public.development_link_decide(%L, 'revoked')$q$, :'l_barh')) = '23514');
select public.development_link_decide(:'l_barh', 'revoked', 'Wrong entity') as l_barh_rev \gset
select pg_temp.as_uid(null);
set role service_role;
select public.development_dossier_snapshot() as snap2 \gset
reset role;
select pg_temp.ck('revoke: the organization leaves the snapshot',
  not exists (select 1 from jsonb_array_elements(:'snap2'::jsonb #> '{dossiers,stratos-box-elder,links}') l where l ->> 'ref' = 'UT:Bar H Ranch, Inc.'));
select pg_temp.ck('revoke: all three rows (candidate, approved, revoked) remain',
  (select count(*) = 3 from public.development_project_link where object_ref = 'UT:Bar H Ranch, Inc.'));
update public.development_project set page_state = 'withdrawn' where project_key = 'proctor-4-tacoma';
select pg_temp.ck('withdrawn: a withdrawn project is not in the snapshot (the others stay)',
  ((public.development_dossier_snapshot() -> 'dossiers') ? 'stratos-box-elder')
  and not ((public.development_dossier_snapshot() -> 'dossiers') ? 'proctor-4-tacoma'));
-- a second name that slipped past the guard (trigger disabled) still never publishes
alter table public.development_project disable trigger development_project_guard;
update public.development_project set display_name = 'Other name' where project_key = 'stratos-box-elder';
alter table public.development_project enable trigger development_project_guard;
select pg_temp.ck('snapshot: two names for one project refuse the snapshot (never a silent pick)',
  pg_temp.try('service_role', null, 'select public.development_dossier_snapshot()') = 'P0001');


-- 5. the review screen's reads (docs/development-review.sql)
select pg_temp.ck('review: anon cannot read the queue',
  pg_temp.try('anon', null, 'select public.development_review_queue()') = '42501');
select pg_temp.ck('review: a signed-in non-reviewer cannot read the queue',
  pg_temp.try('authenticated', :'nobody', 'select public.development_review_queue()') = '42501');
select pg_temp.ck('review: a revoked reviewer cannot read the queue',
  pg_temp.try('authenticated', :'rev2', 'select public.development_review_queue()') = '42501');
select pg_temp.ck('review: a reviewer can read the queue',
  pg_temp.try('authenticated', :'rev', 'select public.development_review_queue()') = 'ok');
select pg_temp.as_uid(:'rev');
select public.development_review_queue() as q \gset
select pg_temp.as_uid(null);
select pg_temp.ck('review: every project is listed, withdrawn ones included',
  (select count(*) = 2 from jsonb_array_elements(:'q'::jsonb -> 'projects')));
select pg_temp.ck('review: only the current row of each link chain is listed',
  (select count(*) = 1 and bool_and(l ->> 'link_state' = 'revoked')
     from jsonb_array_elements(:'q'::jsonb -> 'projects') p, jsonb_array_elements(p -> 'links') l
    where l ->> 'object_ref' = 'UT:Bar H Ranch, Inc.'));
select pg_temp.ck('review: the listed link ids are exactly the current rows',
  (select array_agg((l ->> 'link_id')::uuid order by (l ->> 'link_id') collate "C")
     from jsonb_array_elements(:'q'::jsonb -> 'projects') p, jsonb_array_elements(p -> 'links') l)
  = (select array_agg(x.link_id order by x.link_id::text collate "C") from public.development_project_link x
      where not exists (select 1 from public.development_project_link s where s.supersedes = x.link_id)));
select pg_temp.ck('review: the path is the page the build writes',
  (select bool_and(p ->> 'path' = '/development/' || lower(p ->> 'state') || '/' || (p ->> 'project_key') || '/')
     from jsonb_array_elements(:'q'::jsonb -> 'projects') p));
select pg_temp.ck('review: only a reviewer can request publishing',
  pg_temp.try('anon', null, 'select public.development_publish_request()') = '42501'
  and pg_temp.try('authenticated', :'nobody', 'select public.development_publish_request()') = '42501'
  and pg_temp.try('authenticated', :'rev2', 'select public.development_publish_request()') = '42501');
select pg_temp.ck('review: nobody signed in reads the publish log',
  pg_temp.try('authenticated', :'rev', 'select * from public.development_publish_request_log') = '42501'
  and pg_temp.try('anon', null, 'select * from public.development_publish_request_log') = '42501');

select name, case when ok then 't' else 'f' end, left(detail, 300) from ck order by n;
