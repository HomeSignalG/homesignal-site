-- docs/youtube-video-rebuild.sql (step 8) on a disposable Postgres. Every check raises on failure (exit code = result).
\set ON_ERROR_STOP 1
create function pg_temp.ok(c boolean, what text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', what; end if; raise notice 'ok %', what; end $$;
create function pg_temp.last_inputs() returns jsonb language sql as $$ select body -> 'inputs' from net.calls order by id desc limit 1 $$;
select set_config('test.jwt', '{"email":"founder@example.com"}', false);

insert into public.youtube_video_reviews (slug, title, files, file_decisions, status, meta)
values ('rb', 'Rebuild', '{"final":{"path":"rb/final.mp4","bytes":10},"short1":{"path":"rb/short1.mp4","bytes":5}}',
        '{"final":{"status":"approved","version":1}}', 'pending',
        '{"master":{"url":"https://github.com/HomeSignalG/homesignal-ingest/releases/tag/video-rb-run40785247916"}}');

-- 1. a full rebuild needs no note, rejects nothing, and asks for mode=rebuild with the newest code
do $$ declare r jsonb; i jsonb; rv public.youtube_video_revisions%rowtype; begin

  perform public._hs_yv_ensure_v1('rb', 'final');
  update public.youtube_video_versions set settings = '{"bed_gain":0.5}' where slug = 'rb' and file_key = 'final';
  r := public.hs_youtube_video_rebuild('rb', 'final');
  select * into rv from public.youtube_video_revisions where id = (r ->> 'revision_id')::uuid;
  i := pg_temp.last_inputs();
  perform pg_temp.ok(i ->> 'mode' = 'rebuild' and i ->> 'code' = '' and i ->> 'revision_id' = rv.id::text, 'a rebuild asks for mode=rebuild and main''s code');
  perform pg_temp.ok(rv.settings = '{"bed_gain":0.5}' and rv.parent_version = 1 and rv.plan ->> 'mode' = 'rebuild', 'it carries the accepted fixes');
  perform pg_temp.ok((select file_decisions -> 'final' ->> 'status' from public.youtube_video_reviews where slug = 'rb') = 'approved',
                     'pressing rebuild rejects nothing');
  -- a second click returns the same job and sends nothing
  perform pg_temp.ok((public.hs_youtube_video_rebuild('rb', 'final') ->> 'already_active')::boolean
                     and (select count(*) from public.youtube_video_revisions where slug = 'rb') = 1, 'a second click starts nothing');
  -- a retry of a failed rebuild is still a rebuild
  update public.youtube_video_revisions set status = 'failed' where id = rv.id;
  perform public.hs_youtube_video_revision_retry(rv.id);
  perform pg_temp.ok(pg_temp.last_inputs() ->> 'mode' = 'rebuild', 'a retried rebuild is still a rebuild');
  update public.youtube_video_revisions set status = 'cancelled' where id = rv.id;
end $$;

-- 2. a fix of a first version is built with the code of the build run it came from
do $$ declare r jsonb; begin
  perform public.hs_youtube_video_file_decide('rb', 'short1', 'rejected', 'speak slower');
  r := public.hs_youtube_video_revise('rb', 'short1');
  perform pg_temp.ok(pg_temp.last_inputs() ->> 'mode' = 'build' and pg_temp.last_inputs() ->> 'code' = 'run:40785247916',
                     'a fix of the first version names its build run');
  update public.youtube_video_revisions set status = 'cancelled' where slug = 'rb';
end $$;

-- 3. a fix of a later version is built with the commit recorded on it; an unusable value is never sent
do $$ declare r jsonb; begin
  insert into public.youtube_video_versions (slug, file_key, version, path, meta)
  values ('rb', 'short1', 2, 'rb/versions/short1/v2.mp4', jsonb_build_object('code_commit', repeat('c', 40)));
  r := public.hs_youtube_video_revise('rb', 'short1');
  perform pg_temp.ok(pg_temp.last_inputs() ->> 'code' = repeat('c', 40) and pg_temp.last_inputs() ->> 'parent_version' = '2',
                     'a fix names the commit that made its version');
  update public.youtube_video_revisions set status = 'cancelled' where slug = 'rb';
  update public.youtube_video_versions set meta = '{"code_commit":"main; rm -rf"}' where slug = 'rb' and file_key = 'short1' and version = 2;
  r := public.hs_youtube_video_revise('rb', 'short1');
  perform pg_temp.ok(pg_temp.last_inputs() ->> 'code' = '', 'a recorded value that is not a commit is not sent');
  update public.youtube_video_revisions set status = 'cancelled' where slug = 'rb';
end $$;

-- 4. refusals
do $$ begin
  insert into public.youtube_video_revision_plans (slug, file_key, parent_version, note, settings, requested_by, status)
  values ('rb', 'final', 1, 'x', '{}', 'founder@example.com', 'planning');
  begin perform public.hs_youtube_video_rebuild('rb', 'final'); perform pg_temp.ok(false, 'a rebuild waits for a note being read');
  exception when sqlstate '55006' then perform pg_temp.ok(true, 'a rebuild waits for a note being read'); end;
  update public.youtube_video_revision_plans set status = 'ready' where slug = 'rb';
  perform public.hs_youtube_video_rebuild('rb', 'final');
  perform pg_temp.ok((select status from public.youtube_video_revision_plans where slug = 'rb') = 'cancelled',
                     'a plan waiting for Confirm is cancelled, never built on the wrong version');
  update public.youtube_video_revisions set status = 'cancelled' where slug = 'rb';
  begin perform public.hs_youtube_video_rebuild('rb', 'short2'); perform pg_temp.ok(false, 'a file not uploaded is refused');
  exception when sqlstate 'P0002' then perform pg_temp.ok(true, 'a file not uploaded is refused'); end;
  perform pg_temp.ok(not has_function_privilege('anon', 'public.hs_youtube_video_rebuild(text,text)', 'execute')
                     and has_function_privilege('authenticated', 'public.hs_youtube_video_rebuild(text,text)', 'execute')
                     and not has_function_privilege('authenticated', 'public._hs_yv_dispatch(uuid)', 'execute'), 'grants');
end $$;
select set_config('test.jwt', '{"email":"stranger@example.com"}', false);
do $$ begin
  begin perform public.hs_youtube_video_rebuild('rb', 'final'); perform pg_temp.ok(false, 'a non-admin cannot rebuild');
  exception when others then perform pg_temp.ok(sqlstate <> 'P0001' or sqlerrm not like 'FAIL%', 'a non-admin cannot rebuild'); end;
end $$;

\echo all rebuild checks passed
