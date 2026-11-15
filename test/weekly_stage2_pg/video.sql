-- TAB 20 VIDEO PRODUCTION (docs/weekly-video.sql) on a DISPOSABLE Postgres (never production). Run by run_video.sh after
-- files 1, 2, 2a and the video file. Every line 'Vnn|true' is one check.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text, msg text default null) returns boolean language plpgsql as $$
begin execute q; return false;
exception when others then return (code is null or sqlstate = code) and (msg is null or sqlerrm = msg); end $$;
grant execute on function pg_temp.raises(text, text, text) to authenticated, service_role, anon;
\set admin '{"email":"founder@test.invalid"}'
\set stranger '{"email":"someone@test.invalid"}'
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_edition_create('Data Centers', '2026-11-06') ->> 'id') as ed \gset
select public.hs_weekly_video_request(:'ed') as r1 \gset
reset role;
select edition_key as ek from public.weekly_editions where id = :'ed' \gset
select 'V01|' || (not (:'r1'::jsonb ->> 'existing')::boolean and (:'r1'::jsonb ->> 'status') = 'queued') || ' Make video queues a job';
select 'V02|' || exists (select 1 from net.calls where url like '%/weekly-video-render.yml/dispatches'
  and body -> 'inputs' ->> 'job_id' = :'r1'::jsonb ->> 'job_id' and body ->> 'ref' = 'main') || ' the worker is dispatched from main with the job id';
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'V03|' || ((public.hs_weekly_video_request(:'ed') ->> 'existing')::boolean) || ' a second press returns the running job';
select set_config('test.jwt', :'stranger', false);
select 'V04|' || pg_temp.raises(format('select public.hs_weekly_video_request(%L)', :'ed'), null) || ' a non-admin cannot make a video';
select 'V05|' || pg_temp.raises(format('select public.hs_weekly_video_status(%L)', :'ed'), null) || ' a non-admin cannot read the jobs';
select 'V06|' || pg_temp.raises(format('select public.weekly_video_job_claim(%L)', :'r1'::jsonb ->> 'job_id'), '42501') || ' a browser session cannot claim';
reset role;
select 'V07|' || (not has_table_privilege('authenticated', 'public.weekly_video_jobs', 'select')
  and not has_table_privilege('anon', 'public.weekly_video_assets', 'select')) || ' the tables are not readable directly';
set role service_role;
select public.weekly_video_job_claim((:'r1'::jsonb ->> 'job_id')::uuid) as c1 \gset
select 'V08|' || ((:'c1'::jsonb ->> 'claimed')::boolean and :'c1'::jsonb ->> 'edition_slug' = :'ek') || ' the worker claims the job with the edition key';
select 'V09|' || (not (public.weekly_video_job_claim((:'r1'::jsonb ->> 'job_id')::uuid) ->> 'claimed')::boolean) || ' a running job is not claimed twice';
select 'V10|' || pg_temp.raises(format($q$select public.weekly_video_job_complete(%L, '{"assets":[{"asset":"main","path":"weekly/other-key/%s/main.mp4"}]}')$q$,
  :'r1'::jsonb ->> 'job_id', :'r1'::jsonb ->> 'job_id'), '22023') || ' a file outside the job folder is refused';
select 'V11|' || pg_temp.raises(format($q$select public.weekly_video_job_complete(%L, '{"assets":[]}')$q$, :'r1'::jsonb ->> 'job_id'), '22023') || ' a job with no files is refused';
select public.weekly_video_job_complete((:'r1'::jsonb ->> 'job_id')::uuid, jsonb_build_object('assets', jsonb_build_array(
  jsonb_build_object('asset', 'main', 'path', 'weekly/' || :'ek' || '/' || (:'r1'::jsonb ->> 'job_id') || '/main.mp4', 'bytes', 1000,
    'sha256', repeat('a', 64), 'width', 1920, 'height', 1080, 'duration_s', 210.5, 'qc', '{"ok": true}'::jsonb, 'stills', '["weekly/x/qc-main-1.png"]'::jsonb),
  jsonb_build_object('asset', 'thumbnail', 'path', 'weekly/' || :'ek' || '/' || (:'r1'::jsonb ->> 'job_id') || '/thumbnail.png')),
  'quality', '{"ok": true}'::jsonb));
reset role;
select 'V12|' || ((select status from public.weekly_video_jobs where id = (:'r1'::jsonb ->> 'job_id')::uuid) = 'done'
  and (select count(*) from public.weekly_video_assets where job_id = (:'r1'::jsonb ->> 'job_id')::uuid) = 2) || ' the files are recorded';
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_video_status(:'ed') as st \gset
select (:'st'::jsonb -> 'jobs' -> 0 -> 'assets' -> 0 ->> 'id') as a_main \gset
select 'V13|' || ((:'st'::jsonb -> 'jobs' -> 0 -> 'assets' -> 0 ->> 'asset') = 'main' and jsonb_array_length(:'st'::jsonb -> 'jobs' -> 0 -> 'assets') = 2) || ' the status lists the files, main first';
select 'V14|' || pg_temp.raises(format('select public.hs_weekly_video_decide(%L, %L, %L)', :'a_main', 'changes', '  '), '22023') || ' asking for changes needs a note';
select public.hs_weekly_video_decide(:'a_main', 'changes', 'Use a photo of Westlake');
select public.hs_weekly_video_decide(:'a_main', 'approved');
select 'V15|' || ((public.hs_weekly_video_status(:'ed') -> 'jobs' -> 0 -> 'assets' -> 0 -> 'decisions' -> 0 ->> 'decision') = 'approved') || ' the newest decision is listed first';
reset role;
select 'V16|' || pg_temp.raises('delete from public.weekly_video_decisions', '55000') || ' decisions are append-only';
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_video_request(:'ed') as r2 \gset
reset role;
select 'V17|' || (not (:'r2'::jsonb ->> 'existing')::boolean) || ' a finished job allows a new one';
set role service_role;
select public.weekly_video_job_fail((:'r2'::jsonb ->> 'job_id')::uuid, 'render broke', '{"code":"error"}');
reset role;
select 'V18|' || ((select status from public.weekly_video_jobs where id = (:'r2'::jsonb ->> 'job_id')::uuid) = 'failed') || ' a failure is recorded';
update public.weekly_editions set closed_at = now(), closed_by = 'founder@test.invalid', close_reason = 'TEST closed' where id = :'ed';
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'V19|' || pg_temp.raises(format('select public.hs_weekly_video_request(%L)', :'ed'), '55000') || ' a closed edition cannot be remade';
reset role;
delete from vault.decrypted_secrets;
select (public.hs_weekly_edition_create('Water Quality', '2026-11-06') ->> 'id') as ed2 \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_video_request(:'ed2') as r3 \gset
reset role;
select 'V20|' || ((:'r3'::jsonb ->> 'status') = 'failed' and (:'r3'::jsonb ->> 'error') like '%no GitHub credential%') || ' no credential fails the job with a reason';
