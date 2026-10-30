-- docs/youtube-video-revision-plans.sql on a disposable Postgres. Every check raises on failure (exit code = result).
\set ON_ERROR_STOP 1
create function pg_temp.ok(c boolean, what text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', what; end if; raise notice 'ok %', what; end $$;
create function pg_temp.as_admin() returns void language sql as $$ select set_config('test.jwt', '{"email":"founder@example.com"}', false) $$;
create function pg_temp.as_nobody() returns void language sql as $$ select set_config('test.jwt', '{"email":"stranger@example.com"}', false) $$;
create function pg_temp.plan_json(n int) returns jsonb language sql as $$
  select jsonb_build_object('version', 1, 'asset', 'final', 'note', 'too loud', 'reader', 'claude',
    'steps', case when n > 0 then '[{"from_note":"too loud","instruction":"lower the music","changes":["Background music halved"]}]'::jsonb else '[]'::jsonb end,
    'not_done', '[]'::jsonb,
    'corrections', case when n > 0 then '[{"kind":"music","summary":"Background music halved","delta":{"bed_gain":0.0225}}]'::jsonb else '[]'::jsonb end) $$;

insert into public.youtube_video_reviews (slug, title, files, file_decisions, status)
values ('demo', 'Demo', '{"final":{"path":"demo/final.mp4","bytes":10},"short1":{"path":"demo/short1.mp4","bytes":5}}',
        '{"final":{"status":"approved","version":1}}', 'pending');

select pg_temp.as_admin();

-- 1. starting a plan stores it, asks for mode=plan, and changes no decision
do $$ declare r jsonb; c jsonb; begin
  r := public.hs_youtube_video_plan_start('demo', 'final', '  too loud  ');
  perform pg_temp.ok(r ->> 'status' = 'planning', 'a new plan is planning');
  select body into c from net.calls order by id desc limit 1;
  perform pg_temp.ok(c -> 'inputs' ->> 'mode' = 'plan' and c -> 'inputs' ->> 'instruction' = 'too loud'
                     and c -> 'inputs' ->> 'revision_id' = r ->> 'plan_id' and c -> 'inputs' ->> 'plan' = '', 'the plan dispatch asks for mode=plan');
  perform pg_temp.ok((select file_decisions -> 'final' ->> 'status' from public.youtube_video_reviews where slug = 'demo') = 'approved',
                     'reading the note does not undo the approval');
  perform pg_temp.ok((select count(*) from public.youtube_video_revisions) = 0, 'no revision is created by reading the note');
end $$;

-- 2. the same note again returns the same plan; a different note replaces it
do $$ declare a jsonb; b jsonb; n0 bigint; begin
  select count(*) into n0 from net.calls;
  a := public.hs_youtube_video_plan_start('demo', 'final', 'too loud');
  perform pg_temp.ok((a ->> 'already_open')::boolean and (select count(*) from net.calls) = n0, 'the same note does not read twice');
  b := public.hs_youtube_video_plan_start('demo', 'final', 'speak slower');
  perform pg_temp.ok(b ->> 'plan_id' <> a ->> 'plan_id', 'a different note starts a new plan');
  perform pg_temp.ok((select status from public.youtube_video_revision_plans where id = (a ->> 'plan_id')::uuid) = 'cancelled', 'the replaced plan is cancelled');
  -- the worker answering for the replaced plan changes nothing
  perform pg_temp.ok(not (public.hs_youtube_revision_plan_ready((a ->> 'plan_id')::uuid, pg_temp.plan_json(1)) ->> 'stored')::boolean,
                     'an answer for a cancelled plan is not stored');
end $$;

-- 3. strangers and visitors cannot use it
select pg_temp.as_nobody();
do $$ begin
  begin perform public.hs_youtube_video_plan_start('demo', 'final', 'x'); perform pg_temp.ok(false, 'a non-admin is refused');
  exception when sqlstate '42501' then perform pg_temp.ok(true, 'a non-admin is refused'); end;
end $$;
select pg_temp.as_admin();
do $$ begin
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.hs_youtube_revision_plan_ready(uuid, jsonb)', 'execute'), 'a browser cannot store a plan');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.hs_youtube_revision_plan_fail(uuid, text)', 'execute'), 'a browser cannot fail a plan');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.hs_youtube_video_plan_start(text, text, text)', 'execute'), 'a visitor cannot start a plan');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.hs_youtube_video_plans()', 'execute'), 'a visitor cannot read plans');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.hs_youtube_revision_plan_ready(uuid, jsonb)', 'execute'), 'the worker can store a plan');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.youtube_video_revision_plans', 'select'), 'the plan table is not readable directly');
end $$;

-- 4. the worker stores the plan; a malformed one is refused
do $$ declare pid uuid; begin
  select id into pid from public.youtube_video_revision_plans where status = 'planning' and slug = 'demo' and file_key = 'final';
  begin perform public.hs_youtube_revision_plan_ready(pid, '{"steps":"x"}'); perform pg_temp.ok(false, 'a malformed plan is refused');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'a malformed plan is refused'); end;
  perform public.hs_youtube_revision_plan_ready(pid, pg_temp.plan_json(1));
  perform pg_temp.ok((select status = 'ready' and plan_md5 = md5(plan::text) from public.youtube_video_revision_plans where id = pid), 'the plan is ready with its md5');
end $$;

-- 5. confirm needs the md5 the founder saw; then the note becomes the rejection and the build carries the plan
do $$ declare p public.youtube_video_revision_plans%rowtype; r jsonb; rv public.youtube_video_revisions%rowtype; c jsonb; begin
  select * into p from public.youtube_video_revision_plans where status = 'ready' and slug = 'demo' and file_key = 'final';
  begin perform public.hs_youtube_video_plan_confirm(p.id, 'not-the-md5'); perform pg_temp.ok(false, 'a different md5 is refused');
  exception when sqlstate '55000' then perform pg_temp.ok(true, 'a different md5 is refused'); end;
  r := public.hs_youtube_video_plan_confirm(p.id, p.plan_md5);
  select * into rv from public.youtube_video_revisions where id = (r ->> 'revision_id')::uuid;
  perform pg_temp.ok(rv.confirmed_plan = p.plan and rv.instruction = p.note and rv.parent_version = 1, 'the revision carries the confirmed plan');
  perform pg_temp.ok(rv.plan -> 'corrections' = p.plan -> 'corrections', 'the revision shows the planned corrections');
  perform pg_temp.ok((select file_decisions -> 'final' ->> 'status' from public.youtube_video_reviews where slug = 'demo') = 'rejected', 'confirming records the note as the rejection');
  select body into c from net.calls order by id desc limit 1;
  perform pg_temp.ok(c -> 'inputs' ->> 'revision_id' = rv.id::text and (c -> 'inputs' ->> 'plan')::jsonb = p.plan and not (c -> 'inputs' ? 'mode'),
                     'the build is dispatched with the plan');
  perform pg_temp.ok((select status = 'confirmed' and revision_id = rv.id from public.youtube_video_revision_plans where id = p.id), 'the plan is marked confirmed');
  perform pg_temp.ok((public.hs_youtube_video_plan_confirm(p.id, p.plan_md5) ->> 'already_confirmed')::boolean, 'a second click returns the same revision');
  perform pg_temp.ok((select count(*) from public.youtube_video_revisions) = 1, 'only one revision exists');
  -- no new plan while that revision builds
  begin perform public.hs_youtube_video_plan_start('demo', 'final', 'again'); perform pg_temp.ok(false, 'no plan while a revision builds');
  exception when sqlstate '55006' then perform pg_temp.ok(true, 'no plan while a revision builds'); end;
  -- a retry dispatches the same plan
  update public.youtube_video_revisions set status = 'failed', plan = '{"corrections":[]}' where id = rv.id;
  perform public.hs_youtube_video_revision_retry(rv.id);
  select body into c from net.calls order by id desc limit 1;
  perform pg_temp.ok((c -> 'inputs' ->> 'plan')::jsonb = p.plan, 'a retry builds the same confirmed plan');
  update public.youtube_video_revisions set status = 'cancelled' where id = rv.id;
end $$;

-- 6. a plan that changes nothing cannot be confirmed; a plan made on an older version goes stale
do $$ declare r jsonb; pid uuid; md text; begin
  r := public.hs_youtube_video_plan_start('demo', 'short1', 'make it better');
  pid := (r ->> 'plan_id')::uuid;
  perform public.hs_youtube_revision_plan_ready(pid, pg_temp.plan_json(0));
  select plan_md5 into md from public.youtube_video_revision_plans where id = pid;
  begin perform public.hs_youtube_video_plan_confirm(pid, md); perform pg_temp.ok(false, 'an empty plan cannot be confirmed');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'an empty plan cannot be confirmed'); end;
  perform pg_temp.ok((public.hs_youtube_video_plan_cancel(pid) ->> 'cancelled')::boolean, 'a plan can be cancelled');
  r := public.hs_youtube_video_plan_start('demo', 'short1', 'too loud');
  pid := (r ->> 'plan_id')::uuid;
  perform public.hs_youtube_revision_plan_ready(pid, pg_temp.plan_json(1));
  select plan_md5 into md from public.youtube_video_revision_plans where id = pid;
  insert into public.youtube_video_versions (slug, file_key, version, path) values ('demo', 'short1', 2, 'demo/versions/short1/v2.mp4');
  r := public.hs_youtube_video_plan_confirm(pid, md);
  perform pg_temp.ok((r ->> 'stale')::boolean and not (r ? 'revision_id'), 'a plan on an older version builds nothing');
  perform pg_temp.ok((select status from public.youtube_video_revision_plans where id = pid) = 'stale', 'that plan is marked stale');
end $$;

-- 7. failures and a reader that never answers
do $$ declare r jsonb; pid uuid; begin
  r := public.hs_youtube_video_plan_start('demo', 'short1', 'speak slower');
  pid := (r ->> 'plan_id')::uuid;
  perform public.hs_youtube_revision_plan_fail(pid, 'Claude could not read your note this time.');
  perform pg_temp.ok((select status = 'failed' and error like 'Claude could not%' from public.youtube_video_revision_plans where id = pid), 'a failure is stored with its reason');
  r := public.hs_youtube_video_plan_start('demo', 'short1', 'lower the music');
  update public.youtube_video_revision_plans set created_at = now() - interval '31 minutes' where id = (r ->> 'plan_id')::uuid;
  r := public.hs_youtube_video_plan_start('demo', 'short1', 'lower the music');
  perform pg_temp.ok(not (r ->> 'already_open')::boolean, 'a reader silent for 30 minutes does not hold the file');
  perform pg_temp.ok((select count(*) from public.youtube_video_revision_plans where file_key = 'short1' and status = 'failed') = 2, 'the silent one is marked failed');
  perform pg_temp.ok(jsonb_array_length(public.hs_youtube_video_plans()) >= 6, 'the plans list returns them');
end $$;

-- 8. no credential: the plan fails readably instead of spinning
do $$ declare r jsonb; begin
  delete from vault.decrypted_secrets;
  r := public.hs_youtube_video_plan_start('demo', 'final', 'shorten the pauses');
  perform pg_temp.ok(r ->> 'status' = 'failed', 'with no GitHub credential the plan fails at once');
end $$;
\echo all plan checks passed
