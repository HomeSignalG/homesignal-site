\set ON_ERROR_STOP off
drop table if exists public.zz_results; create table public.zz_results (n text, ok boolean, detail text); grant all on public.zz_results to public;
create function pg_temp.ck(n text, ok boolean, d text default '') returns void language sql as $$ insert into public.zz_results values (n, coalesce(ok,false), d) $$;
create function pg_temp.as_user(e text) returns void language plpgsql as $$ begin
  perform set_config('test.jwt', case when e is null then '' else jsonb_build_object('email', e)::text end, false); end $$;
create function pg_temp.fails(sql text, code text) returns boolean language plpgsql as $$
begin execute sql; return false; exception when others then return sqlstate = code; end $$;
\set ON_ERROR_STOP on
\o /dev/null

select pg_temp.as_user('founder@example.com');
-- 1 reject Short 1 with a plain note; the other three are approved
select public.hs_youtube_video_file_decide('tacoma','final','approved');
select public.hs_youtube_video_file_decide('tacoma','short2','approved');
select public.hs_youtube_video_file_decide('tacoma','thumbnail','approved');
select public.hs_youtube_video_file_decide('tacoma','short1','rejected','The narrator mispronounces the word "noise".');
select pg_temp.ck('01 reject records the note', (select file_decisions->'short1'->>'note' like '%noise%' from public.youtube_video_reviews));
select pg_temp.ck('02 overall status is rejected', (select status='rejected' from public.youtube_video_reviews));

-- authorization
select pg_temp.as_user('stranger@example.com');
select pg_temp.ck('03 non-admin cannot revise', pg_temp.fails($$select public.hs_youtube_video_revise('tacoma','short1')$$,'42501'));
select pg_temp.as_user(null);
select pg_temp.ck('04 anonymous cannot revise', pg_temp.fails($$select public.hs_youtube_video_revise('tacoma','short1')$$,'42501'));
select pg_temp.ck('05 browser roles cannot call worker functions',
  not has_function_privilege('authenticated','public.hs_youtube_revision_complete(uuid,jsonb)','execute')
  and not has_function_privilege('anon','public.hs_youtube_revision_mark(uuid,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.hs_youtube_publishable_files(text)','execute')
  and has_function_privilege('service_role','public.hs_youtube_revision_complete(uuid,jsonb)','execute'));
select pg_temp.ck('06 browser roles have no table access',
  not has_table_privilege('authenticated','public.youtube_video_revisions','select')
  and not has_table_privilege('authenticated','public.youtube_video_versions','select'));

select pg_temp.as_user('founder@example.com');
-- validation
select pg_temp.ck('07 an approved file cannot be revised', pg_temp.fails($$select public.hs_youtube_video_revise('tacoma','final')$$,'22023'));
select pg_temp.ck('08 unknown file refused', pg_temp.fails($$select public.hs_youtube_video_revise('tacoma','nope')$$,'22023'));

-- the click
create temp table click as select public.hs_youtube_video_revise('tacoma','short1') as r;
select pg_temp.ck('09 click creates a durable queued job', (select (r->>'status')='queued' and (r->>'already_active')='false' from click));
select pg_temp.ck('10 a worker run was dispatched to video-revise.yml', (select count(*)=1 and min(url) like '%/video-revise.yml/dispatches' from net.sent));
select pg_temp.ck('11 the saved note reached the worker unchanged',
  (select body->'inputs'->>'instruction' = 'The narrator mispronounces the word "noise".' and body->'inputs'->>'asset'='short1' and body->'inputs'->>'revision_id' is not null from net.sent));
select pg_temp.ck('12 the credential rides in the header, never the body', (select headers->>'Authorization' = 'Bearer ghp_test' and body::text not like '%ghp_test%' from net.sent));
select pg_temp.ck('13 original upload was recorded as version 1',
  (select version=1 and path='tacoma/short1.mp4' from public.youtube_video_versions where file_key='short1'));
-- duplicate clicks
select public.hs_youtube_video_revise('tacoma','short1');
select public.hs_youtube_video_revise('tacoma','short1');
select pg_temp.ck('14 duplicate clicks create no second job and no second dispatch',
  (select count(*)=1 from public.youtube_video_revisions) and (select count(*)=1 from net.sent));
select pg_temp.ck('15 duplicate click answers with the active job', (select (public.hs_youtube_video_revise('tacoma','short1')->>'already_active')='true'));
-- not approvable while generating; publish contract excludes it
select pg_temp.ck('16 cannot approve a file while it is being revised', pg_temp.fails($$select public.hs_youtube_video_file_decide('tacoma','short1','approved')$$,'55006'));
select pg_temp.as_user(null);
set role service_role;
select pg_temp.ck('17 publish contract lists only the 3 approved untouched files',
  (select count(*)=3 and bool_and(file_key<>'short1') from public.hs_youtube_publishable_files('tacoma')));
select public.hs_youtube_revision_mark((select id from public.youtube_video_revisions), 'running');
select public.hs_youtube_revision_mark((select id from public.youtube_video_revisions), 'validating');
select pg_temp.ck('18 status moves queued -> running -> validating', (select status='validating' and started_at is not null from public.youtube_video_revisions));

-- worker failure, then safe retry
select public.hs_youtube_revision_mark((select id from public.youtube_video_revisions), 'failed', jsonb_build_object('error','Revision failed because narration generation could not complete. Your original video is safe. Retry Generation.'));
select pg_temp.ck('19 failed job keeps a friendly error', (select status='failed' and error like '%Your original video is safe%' from public.youtube_video_revisions));
select pg_temp.ck('20 a failure changed nothing about the files',
  (select files->'short1'->>'path'='tacoma/short1.mp4' and file_decisions->'short1'->>'status'='rejected' from public.youtube_video_reviews)
  and (select count(*)=1 from public.youtube_video_versions where file_key='short1'));
reset role;
select pg_temp.as_user('founder@example.com');
select public.hs_youtube_video_revision_retry((select id from public.youtube_video_revisions));
select pg_temp.ck('21 retry requeues the SAME job (attempts 2) and dispatches again',
  (select count(*)=1 and max(attempts)=2 and max(status)='queued' from public.youtube_video_revisions) and (select count(*)=2 from net.sent));
select pg_temp.ck('22 retry of a non-failed job refused', pg_temp.fails(format($$select public.hs_youtube_video_revision_retry(%L)$$, (select id from public.youtube_video_revisions)),'22023'));

-- success
select pg_temp.as_user(null);
set role service_role;
select pg_temp.ck('23 a path outside the versions folder is refused',
  pg_temp.fails(format($$select public.hs_youtube_revision_complete(%L, '{"path":"tacoma/short1.mp4","bytes":1,"sha256":"x"}')$$, (select id from public.youtube_video_revisions)),'22023'));
create temp table done as select public.hs_youtube_revision_complete((select id from public.youtube_video_revisions),
  '{"path":"tacoma/versions/short1/v2-ab12cd34.mp4","parent_path":"tacoma/versions/short1/v1-bb.mp4","bytes":12500000,"sha256":"ee","meta":{"duration":31.2},"settings":{"pron_level":{"noise":1}},"plan":{"corrections":[{"kind":"pronunciation"}]}}'::jsonb) as r;
reset role;
select pg_temp.ck('24 result accepted as version 2', (select (r->>'accepted')='true' and (r->>'version')='2' from done));
select pg_temp.ck('25 only short1 pointer moved',
  (select files->'short1'->>'path'='tacoma/versions/short1/v2-ab12cd34.mp4' and (files->'short1'->>'version')='2'
      and files->'final'->>'path'='tacoma/final.mp4' and files->'short2'->>'path'='tacoma/short2.mp4' and files->'thumbnail'->>'path'='tacoma/thumbnail.png'
   from public.youtube_video_reviews));
select pg_temp.ck('26 other approvals retained, new version has no decision',
  (select file_decisions ? 'final' and file_decisions ? 'short2' and file_decisions ? 'thumbnail' and not file_decisions ? 'short1' from public.youtube_video_reviews));
select pg_temp.ck('27 status is pending (revised, awaiting review), not approved or rejected', (select status='pending' from public.youtube_video_reviews));
select pg_temp.ck('28 previous version kept with its rejection and note, path unchanged',
  (select decision->>'status'='rejected' and decision->>'note' like '%noise%' and path='tacoma/versions/short1/v1-bb.mp4' from public.youtube_video_versions where file_key='short1' and version=1));
select pg_temp.ck('29 new version row carries settings, meta and the revision id',
  (select settings->'pron_level'->>'noise'='1' and (meta->>'duration')='31.2' and revision_id is not null from public.youtube_video_versions where file_key='short1' and version=2));
select pg_temp.ck('30 revision shows succeeded with result version', (select status='succeeded' and result_version=2 from public.youtube_video_revisions));
select pg_temp.as_user('founder@example.com');
select pg_temp.ck('31 the list returns versions and revisions for replay',
  (select jsonb_array_length(x->0->'versions')=2 and jsonb_array_length(x->0->'revisions')=1 from (select public.hs_youtube_videos_list() x) q));
select pg_temp.as_user(null);
-- publish contract: new version not publishable until approved
set role service_role;
select pg_temp.ck('32 revised file is NOT publishable before approval', (select count(*)=3 and bool_and(file_key<>'short1') from public.hs_youtube_publishable_files('tacoma')));
select pg_temp.ck('33 a late second result for the finished job is refused',
  pg_temp.fails(format($$select public.hs_youtube_revision_complete(%L, '{"path":"tacoma/versions/short1/v3-zz.mp4","bytes":1,"sha256":"x"}')$$, (select id from public.youtube_video_revisions)),'55000'));
reset role;
select pg_temp.as_user('founder@example.com');
select public.hs_youtube_video_file_decide('tacoma','short1','approved');
select pg_temp.ck('34 approving the revised version pins version 2', (select (file_decisions->'short1'->>'version')='2' and status='approved' from public.youtube_video_reviews));
set role service_role;
select pg_temp.ck('35 now all four files are publishable at their current versions',
  (select count(*)=4 and bool_or(file_key='short1' and version=2 and path like '%v2-ab12cd34.mp4') from public.hs_youtube_publishable_files('tacoma')));
reset role;
-- stale approval: approval of v2 must not carry to a v3
select pg_temp.as_user('founder@example.com');
select public.hs_youtube_video_file_decide('tacoma','short1','rejected','speak slower');
create temp table click2 as select public.hs_youtube_video_revise('tacoma','short1') as r;
select pg_temp.ck('36 re-reject then a second revision builds on version 2 settings',
  (select (r->>'status')='queued' from click2)
  and (select (settings->'pron_level'->>'noise')='1' and parent_version=2 from public.youtube_video_revisions where parent_version=2));
-- cancel and stale result
select public.hs_youtube_video_revision_cancel((select id from public.youtube_video_revisions where parent_version=2));
select pg_temp.ck('37 cancel works and the worker can no longer deliver',
  (select status='cancelled' from public.youtube_video_revisions where parent_version=2));
set role service_role;
select pg_temp.ck('38 a cancelled revision does not accept a result',
  pg_temp.fails(format($$select public.hs_youtube_revision_complete(%L, '{"path":"tacoma/versions/short1/v3-zz.mp4","bytes":1,"sha256":"x"}')$$, (select id from public.youtube_video_revisions where parent_version=2)),'55000'));
reset role;
-- sweeper
select pg_temp.as_user('founder@example.com');
select public.hs_youtube_video_revise('tacoma','short1');
update public.youtube_video_revisions set created_at = now() - interval '2 hours' where status='queued';
set role service_role; select public.hs_youtube_revision_sweep(); reset role;
select pg_temp.ck('39 a revision stuck for 90 minutes is failed by the sweeper, not left spinning',
  (select count(*)=1 from public.youtube_video_revisions where status='failed' and error like '%90 minutes%'));
-- dispatch refusal
update public.youtube_video_revisions set status='failed' where status='queued';
select public.hs_youtube_video_revise('tacoma','short1');
insert into net._http_response values ((select max(id) from net.sent), 404);
set role service_role; select public.hs_youtube_revision_sweep(); reset role;
select pg_temp.ck('40 a dispatch GitHub refused (404) is failed with a readable reason',
  (select count(*)>=1 from public.youtube_video_revisions where error like '%GitHub answered 404%'));
-- runaway limit
update public.youtube_video_revisions set status='failed' where status='queued';
insert into public.youtube_video_revisions (slug,file_key,parent_version,instruction,status,requested_by)
  select slug,file_key,parent_version,instruction,'failed','x' from public.youtube_video_revisions where error like '%GitHub answered 404%' limit 1;
insert into public.youtube_video_revisions (slug,file_key,parent_version,instruction,status,requested_by)
  select slug,file_key,parent_version,instruction,'unsupported','x' from public.youtube_video_revisions where error like '%GitHub answered 404%' limit 1;
select pg_temp.ck('41 the same note cannot fail forever (limit 3)', pg_temp.fails($$select public.hs_youtube_video_revise('tacoma','short1')$$,'55000'));
-- missing credential
delete from vault.decrypted_secrets;
select public.hs_youtube_video_file_decide('tacoma','short1','rejected','a different note');
update public.youtube_video_revisions set status='failed' where status in ('queued');
select public.hs_youtube_video_revise('tacoma','short1');
select pg_temp.ck('42 missing credential becomes a readable failed job, not an exception',
  (select count(*)>=1 from public.youtube_video_revisions where error like '%no GitHub credential%'));


-- ── backstops (a second review so earlier state cannot interfere) ──
insert into vault.decrypted_secrets values ('github_actions_pat', 'ghp_test');
insert into public.youtube_video_reviews (slug, title, files) values ('b2', 'B2', jsonb_build_object(
  'short1', jsonb_build_object('path','b2/short1.mp4','bytes',1,'sha256','s1'), 'final', jsonb_build_object('path','b2/final.mp4','bytes',1,'sha256','f1')));
select pg_temp.as_user('founder@example.com');
select public.hs_youtube_video_file_decide('b2','short1','rejected');
select pg_temp.ck('43 a rejection with NO note cannot be revised', pg_temp.fails($$select public.hs_youtube_video_revise('b2','short1')$$,'22023'));
select public.hs_youtube_video_file_decide('b2','short1','rejected','speak slower');
create temp table c3 as select public.hs_youtube_video_revise('b2','short1') as r;
select pg_temp.ck('44 the database itself refuses a second active revision of one file (not only the function)',
  pg_temp.fails($$insert into public.youtube_video_revisions (slug,file_key,parent_version,instruction,requested_by) values ('b2','short1',1,'x','y')$$,'23505'));
-- a newer version appears while the job runs -> its result is discarded, not applied
insert into public.youtube_video_versions (slug,file_key,version,path) values ('b2','short1',2,'b2/versions/short1/v2-other.mp4');
select pg_temp.as_user(null);
set role service_role;
create temp table c4 as select public.hs_youtube_revision_complete((select id from public.youtube_video_revisions where slug='b2'),
  '{"path":"b2/versions/short1/v2-zz.mp4","bytes":1,"sha256":"x"}'::jsonb) as r;
reset role;
select pg_temp.ck('45 a result for a superseded parent is discarded and nothing moves',
  (select (r->>'accepted')='false' and r->>'reason'='stale' from c4)
  and (select files->'short1'->>'path'='b2/short1.mp4' from public.youtube_video_reviews where slug='b2')
  and (select status='cancelled' from public.youtube_video_revisions where slug='b2'));
-- an approval of an OLD version never publishes the new one
update public.youtube_video_reviews set files = jsonb_set(files,'{final}','{"path":"b2/versions/final/v2-a.mp4","bytes":1,"sha256":"f2","version":2}'::jsonb),
  file_decisions = jsonb_build_object('final', jsonb_build_object('status','approved','version',1)) where slug='b2';
set role service_role;
select pg_temp.ck('46 an approval of version 1 does not make version 2 publishable',
  (select count(*)=0 from public.hs_youtube_publishable_files('b2') where file_key='final'));
reset role;
\o
select n, case when ok then 'PASS' else 'FAIL' end as r, detail from public.zz_results order by n;
do $$ declare f int; begin select count(*) into f from public.zz_results where not ok; if f > 0 then raise exception '% checks FAILED', f; end if; end $$;
