-- Executable acceptance suite for Impact Stories (docs/impact-stories.sql). Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', case when e is null then '' else json_build_object('email', e)::text end, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create temp table _ids (k text primary key, v text);
create function pg_temp.id(k text) returns text language sql as $$ select v from _ids where _ids.k = id.k $$;
create function pg_temp.st(a text) returns text language sql as $$ select public._hs_is_artifact_state(pg_temp.id('s')::uuid, a)->>'state' $$;
create function pg_temp.cur() returns int language sql as $$ select current_version from public.impact_stories where id = pg_temp.id('s')::uuid $$;
create function pg_temp.lastjob() returns public.impact_story_jobs language sql as $$
  select * from public.impact_story_jobs where story_id = pg_temp.id('s')::uuid order by created_at desc, attempts desc limit 1 $$;
-- the worker: claim + complete with a given result
create function pg_temp.work(res jsonb) returns jsonb language plpgsql as $$ declare j uuid := (pg_temp.lastjob()).id; c jsonb; begin
  c := public.hs_impact_story_job_claim(j);
  if not (c->>'claimed')::boolean then raise exception 'not claimable'; end if;
  return public.hs_impact_story_job_complete(j, res); end $$;
create function pg_temp.ok_val(n boolean, ph text) returns jsonb language sql as $$
  select jsonb_build_object('pack', jsonb_build_object('ok', true, 'blocking', '[]'::jsonb),
    'arc', jsonb_build_object('fear', jsonb_build_object('ok', true, 'blocking', '[]'::jsonb, 'status', 'needs_qualification'),
                              'anger', jsonb_build_object('ok', n, 'blocking', case when n then '[]'::jsonb else '["ANGER: the qualifier line is not in its narration."]'::jsonb end, 'status', 'needs_qualification'),
                              'motivation', jsonb_build_object('ok', true, 'blocking', '[]'::jsonb, 'status', 'supported')),
    'narrative', jsonb_build_object('ok', n, 'blocking', case when n then '[]'::jsonb else '["Story arc: ANGER: the qualifier line is not in its narration."]'::jsonb end),
    'pack_hash', ph) $$;
create function pg_temp.pack(h text, verified timestamptz, nclaims int default 2) returns jsonb language sql as $$
  select jsonb_build_object('hash', h, 'title', 'Gig Harbor dock', 'verified_at', verified, 'fresh_days', 30,
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', 'c' || g)), '[]') from generate_series(1, nclaims) g)) $$;
-- an integrated story: the arc + outline (Analyze), and with_main adds the script, QOL, Shorts and packaging (Generate)
create function pg_temp.body(packaging_text text default 'Who gets the dock?', with_main boolean default true, anger_beat text default 'Two records, two docks.') returns jsonb language sql as $$
  select jsonb_build_object('schema', 'impact-story/2',
    'arc', jsonb_build_object('fear', '{"status":"needs_qualification","beat":{"text":"Listed species.","claims":["c1"]}}'::jsonb,
                              'anger', jsonb_build_object('status', 'needs_qualification', 'beat', jsonb_build_object('text', anger_beat, 'claims', '["c2"]'::jsonb)),
                              'motivation', '{"status":"supported","beat":{"text":"A working dock.","claims":["c1"]}}'::jsonb),
    'outline', '[{"act":1,"threads":["motivation","fear"]},{"act":6,"threads":["anger"]}]'::jsonb)
  || case when with_main then jsonb_build_object('main', '{"acts":[{"act":1}]}'::jsonb, 'qol', '[{"topic":"Traffic"}]'::jsonb,
    'shorts', '{"a":{"question":"Who?"},"b":{"question":"When?"}}'::jsonb, 'packaging', jsonb_build_object('thumbnail', jsonb_build_object('text', packaging_text)))
    else '{}'::jsonb end $$;
create function pg_temp.nst() returns text language sql as $$ select pg_temp.st('narrative') $$;
create function pg_temp.stage() returns text language sql as $$ select public._hs_is_status(pg_temp.id('s')::uuid)->>'stage' $$;
create function pg_temp.nxt() returns text language sql as $$ select public._hs_is_status(pg_temp.id('s')::uuid)->>'next' $$;

-- 1. access ------------------------------------------------------------------------------------------
select pg_temp.as_user(null);
select pg_temp.chk('1a no session: list refused', pg_temp.err('select public.hs_impact_story_list()') like '42501%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('1b non-admin: create refused', pg_temp.err($q$select public.hs_impact_story_create('gig-harbor-fishing-homeport-dock')$q$) like '42501%');
select pg_temp.chk('1c anon cannot execute a founder function', not has_function_privilege('anon', 'public.hs_impact_story_list()', 'execute'));
select pg_temp.chk('1d authenticated cannot execute a worker function', not has_function_privilege('authenticated', 'public.hs_impact_story_job_complete(uuid, jsonb)', 'execute'));
select pg_temp.chk('1e service_role can execute the worker functions', has_function_privilege('service_role', 'public.hs_impact_story_job_claim(uuid)', 'execute'));
select pg_temp.chk('1f no direct table access for browser roles', not has_table_privilege('authenticated', 'public.impact_stories', 'select')
   and not has_table_privilege('anon', 'public.impact_story_versions', 'select') and not has_table_privilege('authenticated', 'public.impact_story_approvals', 'insert'));
select pg_temp.chk('1g every impact table has RLS on', (select bool_and(relrowsecurity) from pg_class where relname like 'impact_stor%' and relkind = 'r'));

-- 2. create, pack job, dispatch, idempotency ------------------------------------------------------------
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('2a catalog lists verified projects', jsonb_array_length(public.hs_impact_story_catalog()) = 1);
insert into _ids select 's', public.hs_impact_story_create('gig-harbor-fishing-homeport-dock')->>'story_id';
select pg_temp.chk('2b a pack job is queued', (pg_temp.lastjob()).kind = 'pack' and (pg_temp.lastjob()).status = 'queued');
select pg_temp.chk('2c the worker is dispatched on main with the job id only', (select body from net.requests order by id desc limit 1)
   = jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('job_id', (pg_temp.lastjob()).id::text))
   and (select url from net.requests order by id desc limit 1) like '%/homesignal-ingest/actions/workflows/impact-story-job.yml/dispatches');
select pg_temp.chk('2d title defaults to the verified project title', (select title from public.impact_stories where id = pg_temp.id('s')::uuid) like '3003 Gig Harbor%');
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'pack');
select pg_temp.chk('2e a duplicate click returns the same job', (select count(*) from public.impact_story_jobs where story_id = pg_temp.id('s')::uuid) = 1
   and (select count(*) from net.requests) = 1);
select pg_temp.chk('2f analyze before a pack: sources needed', pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'analyze')) like '%Sources needed%');
select pg_temp.chk('2g stage is intake, next is check sources', public._hs_is_status(pg_temp.id('s')::uuid)->>'stage' = 'intake');

-- 3. worker completes the pack ------------------------------------------------------------------------
select pg_temp.chk('3a claim + complete pack', (pg_temp.work(jsonb_build_object('pack', pg_temp.pack('P1', now() - interval '1 day'))))->>'ok' = 'true');
select pg_temp.chk('3b a finished job cannot be claimed again', (public.hs_impact_story_job_claim((pg_temp.lastjob()).id)->>'claimed')::boolean = false);
select pg_temp.chk('3c stage moves to the story outline: Analyze', pg_temp.stage() = 'outline' and pg_temp.nxt() = 'Analyze story');
select pg_temp.chk('3d generate before an outline is refused', pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'generate')) like '%no story outline%');

-- 4. analyze -> the arc and outline; one approval, nothing decidable yet ---------------------------------
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'analyze');
select pg_temp.chk('4a analyze is a job receipt, not a result', pg_temp.cur() = 0 and (pg_temp.lastjob()).status = 'queued');
select pg_temp.work(jsonb_build_object('body', pg_temp.body(with_main => false), 'derived', jsonb_build_object('validation', pg_temp.ok_val(false, 'P1'))));
select pg_temp.chk('4b analyze result is version 1, at the outline', pg_temp.cur() = 1 and pg_temp.stage() = 'outline'
   and pg_temp.nxt() = 'Review the outline, then Generate story');
select pg_temp.chk('4c the status carries ONE artifact, the integrated narrative',
   (select array_agg(k order by k) from jsonb_object_keys(public._hs_is_status(pg_temp.id('s')::uuid)->'artifacts') k) = array['narrative']);
select pg_temp.chk('4d a blocked narrative cannot be approved, and says why', pg_temp.nst() = 'blocked'
   and pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 1)', pg_temp.id('s'), 'narrative', 'approved')) like '%qualifier line%');
select pg_temp.chk('4e the old per-part decisions are refused', pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 1)', pg_temp.id('s'), 'main', 'approved')) like '%One approval now covers%'
   and pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 1)', pg_temp.id('s'), 'angle', 'approved')) like '%One approval now covers%'
   and pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 1)', pg_temp.id('s'), 'whatever', 'approved')) like '%bad artifact%');
select pg_temp.chk('4f choosing one angle is retired with a readable answer, and changes nothing',
   pg_temp.err(format('select public.hs_impact_story_angle(%L, 1, %L, %L)', pg_temp.id('s'), 'anger', 'select')) like '%replaced by the story outline%' and pg_temp.cur() = 1);
select pg_temp.chk('4g a section revision needs a note and a known section',
   pg_temp.err(format('select public.hs_impact_story_section_revision(%L, 1, %L, %L)', pg_temp.id('s'), 'anger', '  ')) like '%Say what to change%'
   and pg_temp.err(format('select public.hs_impact_story_section_revision(%L, 1, %L, %L)', pg_temp.id('s'), 'villain', 'x')) like '%bad section%'
   and pg_temp.err(format('select public.hs_impact_story_section_revision(%L, 0, %L, %L)', pg_temp.id('s'), 'anger', 'x')) like '40001%');
select public.hs_impact_story_section_revision(pg_temp.id('s')::uuid, 1, 'anger', 'Ask it as a question, not a charge.');
select pg_temp.chk('4h a section revision is an event on the version, and writes no version', pg_temp.cur() = 1
   and (select detail from public.impact_story_events where kind = 'section_revision' order by id desc limit 1)
       = '{"section":"anger","version":1,"note":"Ask it as a question, not a charge."}'::jsonb);
select pg_temp.chk('4i a non-admin cannot leave a revision note', (select pg_temp.as_user('stranger@example.com')) is null
   and pg_temp.err(format('select public.hs_impact_story_section_revision(%L, 1, %L, %L)', pg_temp.id('s'), 'anger', 'x')) like '42501%');
select pg_temp.as_user('founder@example.com');

-- 5. generate -> the one approval ------------------------------------------------------------------------
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'generate');
select pg_temp.work(jsonb_build_object('body', pg_temp.body(), 'derived', jsonb_build_object('validation', pg_temp.ok_val(false, 'P1'))));
select pg_temp.chk('5a generated version 2, still blocked: the narrative says why', pg_temp.cur() = 2 and pg_temp.nst() = 'blocked' and pg_temp.stage() = 'script'
   and pg_temp.nxt() = 'Review and approve the integrated narrative');
select pg_temp.chk('5b reject needs a note', pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 2)', pg_temp.id('s'), 'narrative', 'rejected')) like '%Say what to change%');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'narrative', 'rejected', 2, 'Speak the anger qualifier.', 'Act 6');
select pg_temp.chk('5c a rejection is tied to its line', (select target from public.impact_story_approvals order by id desc limit 1) = 'Act 6');
-- the founder fixes the script; re-check passes
select public.hs_impact_story_save(pg_temp.id('s')::uuid, 2, pg_temp.body() || '{"main":{"acts":[{"act":1},{"act":6}]}}');
select pg_temp.chk('5d save creates version 3 and queues a re-check', pg_temp.cur() = 3 and (pg_temp.lastjob()).kind = 'validate');
select pg_temp.chk('5e until the re-check, nothing is approvable', pg_temp.nst() = 'checking');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, 'P1'))));
select pg_temp.chk('5f re-check attaches to version 3 (no new version)', pg_temp.cur() = 3 and pg_temp.nst() = 'pending');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'narrative', 'approved', 3);
select pg_temp.chk('5g one approval: on to the Visuals step', pg_temp.stage() = 'visuals' and public._hs_is_status(pg_temp.id('s')::uuid)->>'library' = 'needs_review');
select pg_temp.chk('5h approving twice records nothing new', (select (public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'narrative', 'approved', 3))->>'unchanged') = 'true'
   and (select count(*) from public.impact_story_approvals where artifact = 'narrative' and decision = 'approved') = 1);

-- 6. any change inside the narrative needs approving again; a change outside it does not ----------------
select public.hs_impact_story_save(pg_temp.id('s')::uuid, 3, pg_temp.body() || '{"main":{"acts":[{"act":1},{"act":6}]},"suitability":"edited note"}');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, 'P1'))));
select pg_temp.chk('6a an edit outside the narrative keeps the approval', pg_temp.cur() = 4 and pg_temp.nst() = 'approved');
select public.hs_impact_story_save(pg_temp.id('s')::uuid, 4, pg_temp.body('Who is the dock for?') || '{"main":{"acts":[{"act":1},{"act":6}]},"suitability":"edited note"}');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, 'P1'))));
select pg_temp.chk('6b a thumbnail-only edit needs the one approval again', pg_temp.cur() = 5 and pg_temp.nst() = 'pending' and pg_temp.stage() = 'script'
   and (public._hs_is_artifact_state(pg_temp.id('s')::uuid, 'narrative')->>'why') like 'Changed since you approved version 3%');
select public.hs_impact_story_save(pg_temp.id('s')::uuid, 5, pg_temp.body('Who is the dock for?', anger_beat => 'Edited beat.') || '{"main":{"acts":[{"act":1},{"act":6}]},"suitability":"edited note"}');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, 'P1'))));
select pg_temp.chk('6c so does an edit to one section of the arc', pg_temp.cur() = 6 and pg_temp.nst() = 'pending'
   and (select detail->'changed' from public.impact_story_events where kind = 'saved' order by id desc limit 1) = '["narrative"]');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'narrative', 'approved', 6);
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'narrative', 'revoked', 6, 'Check the hearing date again.');
select pg_temp.chk('6d a revoked approval blocks readiness', pg_temp.nst() = 'revoked' and pg_temp.stage() = 'script');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'narrative', 'approved', 6);
select pg_temp.chk('6e re-approval is a new row; history kept', (select count(*) from public.impact_story_approvals where artifact = 'narrative') = 5);

-- 7. optimistic lock, superseded results ---------------------------------------------------------------
select pg_temp.chk('7a a stale editor cannot overwrite', pg_temp.err(format('select public.hs_impact_story_save(%L, 5, %L::jsonb)', pg_temp.id('s'), pg_temp.body())) like '40001%');
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'generate', 'short_b');
insert into _ids select 'g', (pg_temp.lastjob()).id::text;
select public.hs_impact_story_job_claim(pg_temp.id('g')::uuid);
select pg_temp.chk('7b only one job at a time per story', pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'pack')) like '%already running%');
select pg_temp.chk('7c a save during a running job still lands', (public.hs_impact_story_save(pg_temp.id('s')::uuid, 6, pg_temp.body('Who is the dock for?', anger_beat => 'Edited beat.') || '{"main":{"acts":[{"act":1},{"act":6}]},"suitability":"edited note","notes":"draft"}'))->'job'->>'status' = 'waiting');
select pg_temp.chk('7d ...as version 7', pg_temp.cur() = 7);
create temp table _r7 as select public.hs_impact_story_job_complete(pg_temp.id('g')::uuid, jsonb_build_object('body', pg_temp.body())) r;
select pg_temp.chk('7e a result on a replaced version is kept on the job, not applied', (select r->>'superseded' from _r7) = 'true'
   and pg_temp.cur() = 7 and (select status from public.impact_story_jobs where id = pg_temp.id('g')::uuid) = 'superseded');
select pg_temp.chk('7f the waiting check for version 7 starts once the job ends', (pg_temp.lastjob()).kind = 'validate' and (pg_temp.lastjob()).base_version = 7 and (pg_temp.lastjob()).status = 'queued');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, 'P1'))));
select pg_temp.chk('7g the approval survives an unchanged narrative', pg_temp.nst() = 'approved');

-- 8. failure, retry, missing credential ---------------------------------------------------------------
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'validate', 'all', true);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_fail((pg_temp.lastjob()).id, 'No story has been written for this project yet. Ask Claude, in a Claude Code session.');
select pg_temp.chk('8a failure is readable', (pg_temp.lastjob()).status = 'failed' and (pg_temp.lastjob()).error like '%Ask Claude%');
select pg_temp.chk('8b a finished job cannot be retried', pg_temp.err(format('select public.hs_impact_story_job_retry(%L)', (select id from public.impact_story_jobs where status='complete' limit 1))) like '%not failed or stuck%');
select public.hs_impact_story_job_retry((pg_temp.lastjob()).id);
select pg_temp.chk('8c retry re-runs the SAME job', (pg_temp.lastjob()).status = 'queued' and (pg_temp.lastjob()).attempts = 2
   and (select count(*) from public.impact_story_jobs where kind = 'validate' and base_version = 7) = 2);
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, 'P1'))));
delete from vault.decrypted_secrets;
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'pack');
select pg_temp.chk('8d no credential: failed with a reason, nothing dispatched', (pg_temp.lastjob()).status = 'failed' and (pg_temp.lastjob()).error like '%no GitHub credential%');
insert into vault.decrypted_secrets values ('github_actions_pat', 'test-pat');
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'pack');
select pg_temp.chk('8e the identical request after a failure retries the same job', (pg_temp.lastjob()).status = 'queued' and (pg_temp.lastjob()).attempts = 2);

-- 9. new evidence and stale sources -----------------------------------------------------------------
select pg_temp.work(jsonb_build_object('pack', pg_temp.pack('P2', now())));
select pg_temp.chk('9a a changed pack queues a re-check and warns', (pg_temp.lastjob()).kind = 'validate'
   and exists (select 1 from public.impact_story_events where kind = 'freshness_warning'));
select pg_temp.chk('9b the approval holds until checked against the new pack', pg_temp.nst() = 'checking' and pg_temp.stage() <> 'media');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, 'P2'))));
select pg_temp.chk('9c re-checked against the same text: the approval returns', pg_temp.nst() = 'approved' and pg_temp.stage() = 'visuals');
update public.impact_stories set pack = jsonb_set(pack, '{verified_at}', to_jsonb(now() - interval '45 days')) where id = pg_temp.id('s')::uuid;
select pg_temp.chk('9d stale sources block the approval and say so', pg_temp.nst() = 'blocked'
   and pg_temp.nxt() = 'Re-check sources'
   and pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'analyze')) like '%out of date%');
update public.impact_stories set pack = jsonb_set(pack, '{verified_at}', to_jsonb(now())) where id = pg_temp.id('s')::uuid;

-- 12. render and the media gate (gate 2) -------------------------------------------------------------------
create function pg_temp.files(j uuid, short_a_ok boolean default true) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('asset', a, 'path', pg_temp.id('s') || '/' || j || '/' || a || '.mp4',
    'captions_path', pg_temp.id('s') || '/' || j || '/' || a || '.srt', 'bytes', 1000, 'sha256', repeat('a', 64),
    'width', case when a like 'short%' then 1080 when a = 'thumbnail' then 1280 else 1920 end,
    'height', case when a like 'short%' then 1920 when a = 'thumbnail' then 720 else 1080 end, 'duration_s', 60,
    'preset', 'impact-x', 'qc', jsonb_build_object('ok', a <> 'short_a' or short_a_ok), 'stills', '[]'::jsonb, 'shots', '[]'::jsonb))
  from unnest(array['main', 'short_a', 'short_b', 'thumbnail']) a $$;
create function pg_temp.fid(a text) returns bigint language sql as $$
  select (x->>'id')::bigint from jsonb_array_elements(public._hs_is_media(pg_temp.id('s')::uuid)->'files') x where x->>'asset' = a $$;
create function pg_temp.fst(a text) returns text language sql as $$
  select x->>'state' from jsonb_array_elements(public._hs_is_media(pg_temp.id('s')::uuid)->'files') x where x->>'asset' = a $$;
-- 12V. visuals (2026-10-29): every shot previewed and approved in ONE action before anything is rendered -------------
create function pg_temp.vman(j uuid, shot_status text default 'clear', same boolean default true, pfx_ok boolean default true,
                             license text default 'CC BY 4.0') returns jsonb language sql as $$
  select jsonb_build_object('hash', md5(j::text || shot_status || same::text || license) || md5(j::text),
    'pack_hash', (select pack_hash from public.impact_stories where id = pg_temp.id('s')::uuid),
    'renderer', 'impact-render-3', 'opts', '{"overlay":1}'::jsonb, 'timing', '{"total_s":600}'::jsonb,
    'counts', jsonb_build_object('clear', case when shot_status = 'clear' then 2 else 1 end, 'flagged', case when shot_status = 'flagged' then 1 else 0 end,
                                 'blocked', case when shot_status = 'blocked' then 1 else 0 end),
    'approvable', shot_status <> 'blocked', 'identity', jsonb_build_object('same', same),
    'assets', jsonb_build_object(
      'main', jsonb_build_object('shots', jsonb_build_array(jsonb_build_object('id', 'a1-s1', 'status', shot_status,
        'preview', jsonb_build_object('path', case when pfx_ok then pg_temp.id('s') || '/visuals/' || j || '/preview-main-000.jpg' else 'elsewhere/x.jpg' end),
        'photo', jsonb_build_object('id', 'oak', 'record', jsonb_build_object('license', license, 'sha256', repeat('c', 64),
                                    'file_url', 'https://upload.wikimedia.org/x.jpg'))))),
      'thumbnail', jsonb_build_object('shots', jsonb_build_array(jsonb_build_object('id', 'thumbnail', 'status', 'clear',
        'preview', jsonb_build_object('path', pg_temp.id('s') || '/visuals/' || j || '/preview-thumbnail-000.jpg'))))),
    'alternatives', jsonb_build_array(jsonb_build_object('subject_id', 'oak-trees', 'candidates', jsonb_build_array(
      jsonb_build_object('id', 'oak-alt-1', 'title', 'File:Oak2.jpg', 'license', 'CC BY 4.0', 'author', 'B. Person',
        'page_url', 'https://commons.wikimedia.org/wiki/File:Oak2.jpg', 'file_url', 'https://upload.wikimedia.org/y.jpg',
        'sha256', repeat('d', 64), 'preview', jsonb_build_object('path', pg_temp.id('s') || '/visuals/' || j || '/cand-d.jpg')))))) $$;
create function pg_temp.vis() returns jsonb language sql as $$ select public._hs_is_visuals(pg_temp.id('s')::uuid) $$;
create function pg_temp.prep_visuals(shot_status text default 'clear', same boolean default true, pfx_ok boolean default true,
                                     license text default 'CC BY 4.0') returns uuid language plpgsql as $$ declare j uuid; begin
  perform public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, pg_temp.cur(), true);
  j := (pg_temp.lastjob()).id;
  perform public.hs_impact_story_job_claim(j);
  perform public.hs_impact_story_job_complete(j, jsonb_build_object('manifest', pg_temp.vman(j, shot_status, same, pfx_ok, license)));
  return j; end $$;
create function pg_temp.approve_visuals() returns void language plpgsql as $$ begin
  perform pg_temp.prep_visuals();
  perform public.hs_impact_story_visuals_approve(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash');
end $$;
select pg_temp.chk('12V1 an approved narrative goes to the Visuals step first; Render is refused until the visuals are approved',
  pg_temp.stage() = 'visuals' and pg_temp.nxt() = 'Prepare the visuals' and pg_temp.vis()->>'state' = 'none'
  and pg_temp.err(format('select public.hs_impact_story_render(%L, 7)', pg_temp.id('s'))) like '%Approve the visuals before rendering%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12V2 non-admin cannot prepare, approve or revoke visuals',
  pg_temp.err(format('select public.hs_impact_story_visuals_prepare(%L, 7)', pg_temp.id('s'))) like '42501%'
  and pg_temp.err(format('select public.hs_impact_story_visuals_approve(%L, 1, %L)', pg_temp.id('s'), 'x')) like '42501%'
  and pg_temp.err(format('select public.hs_impact_story_visuals_revoke(%L, 1)', pg_temp.id('s'))) like '42501%'
  and not has_function_privilege('anon', 'public.hs_impact_story_visuals_approve(uuid, bigint, text)', 'execute'));
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('12V3 a stale version is refused', pg_temp.err(format('select public.hs_impact_story_visuals_prepare(%L, 6)', pg_temp.id('s'))) like '40001%');
select public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, 7);
insert into _ids select 'v1', (pg_temp.lastjob()).id;
select pg_temp.chk('12V4 Prepare is its own job, dispatched to the render workflow, carrying the narrative and the photo choices',
  (pg_temp.lastjob()).kind = 'visuals' and (select url from net.requests order by id desc limit 1) like '%/impact-story-render.yml/dispatches'
  and (pg_temp.lastjob()).input->>'narrative_hash' = public._hs_is_artifact_state(pg_temp.id('s')::uuid, 'narrative')->>'hash'
  and (pg_temp.lastjob()).input->>'choices_key' = md5('') and pg_temp.vis()->>'state' = 'preparing'
  and pg_temp.nxt() like 'Preparing the preview stills%'
  and (public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, 7)->>'existing')::boolean);
select public.hs_impact_story_job_claim(pg_temp.id('v1')::uuid);
select public.hs_impact_story_job_complete(pg_temp.id('v1')::uuid, jsonb_build_object('manifest', pg_temp.vman(pg_temp.id('v1')::uuid, 'clear', true, false)));
select pg_temp.chk('12V5 a preview outside the job''s folder is refused', (pg_temp.lastjob()).status = 'failed' and (pg_temp.lastjob()).error like '%outside%'
  and (select count(*) from public.impact_story_visual_manifests) = 0 and pg_temp.vis()->>'state' = 'failed');
select public.hs_impact_story_job_retry(pg_temp.id('v1')::uuid);
select public.hs_impact_story_job_claim(pg_temp.id('v1')::uuid);
select public.hs_impact_story_job_complete(pg_temp.id('v1')::uuid, jsonb_build_object('manifest', '{"hash":"nope"}'::jsonb));
select pg_temp.chk('12V6 a result with no proper manifest is refused', (pg_temp.lastjob()).status = 'failed' and (pg_temp.lastjob()).error like '%no manifest%');
select pg_temp.prep_visuals('blocked');
select pg_temp.chk('12V7 a blocked shot: the set needs fixes and cannot be approved',
  pg_temp.vis()->>'state' = 'needs_fixes' and pg_temp.nxt() like 'Replace the blocked pictures%'
  and pg_temp.err(format('select public.hs_impact_story_visuals_approve(%L, %s, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', pg_temp.vis()->>'manifest_hash')) like '%cannot be approved%');
select pg_temp.prep_visuals('clear', false);
select pg_temp.chk('12V8 previews that did not match the render are not approvable', pg_temp.vis()->>'state' = 'needs_fixes'
  and not (pg_temp.vis()->>'approvable')::boolean);
select pg_temp.prep_visuals('clear', true, true, '');
select pg_temp.chk('12V9 the server re-checks every photo: one without its license is refused even when the engine said clear',
  pg_temp.vis()->>'state' = 'ready'
  and pg_temp.err(format('select public.hs_impact_story_visuals_approve(%L, %s, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', pg_temp.vis()->>'manifest_hash')) like '%failed the server check%');
select pg_temp.prep_visuals('flagged');
select pg_temp.chk('12V10 a clean set (flags are only for looking) is ready, and the page is told so',
  pg_temp.vis()->>'state' = 'ready' and pg_temp.stage() = 'visuals' and pg_temp.nxt() = 'Review the visuals, then Approve all visuals'
  and jsonb_array_length(public.hs_impact_story_get(pg_temp.id('s')::uuid)->'visuals'->'manifest'->'assets'->'main'->'shots') = 1);
select pg_temp.chk('12V11 approve needs the previews the page showed: an older set or a changed hash is refused',
  pg_temp.err(format('select public.hs_impact_story_visuals_approve(%L, %s, %L)', pg_temp.id('s'), (pg_temp.vis()->>'manifest_id')::bigint - 1, pg_temp.vis()->>'manifest_hash')) like '40001%Newer previews%'
  and pg_temp.err(format('select public.hs_impact_story_visuals_approve(%L, %s, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', repeat('0', 64))) like '40001%changed%');
select public.hs_impact_story_visuals_approve(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash');
select pg_temp.chk('12V12 ONE action approves the whole set; the story moves on to Render',
  pg_temp.vis()->>'state' = 'approved' and pg_temp.stage() = 'media' and pg_temp.nxt() = 'Render the videos'
  and (public.hs_impact_story_visuals_approve(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash')->>'existing')::boolean
  and (select count(*) from public.impact_story_visual_events where decision = 'approved') = 1
  and exists (select 1 from public.impact_story_events where kind = 'visuals_approved'));
select pg_temp.chk('12V13 manifests and visual decisions are append-only',
  pg_temp.err('update public.impact_story_visual_manifests set approvable = true') is not null
  and pg_temp.err('delete from public.impact_story_visual_events') is not null);
select public.hs_impact_story_visuals_revoke(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, 'Look again.');
select pg_temp.chk('12V14 revoking the approval sends the story back to the Visuals step',
  pg_temp.vis()->>'state' = 'ready' and pg_temp.stage() = 'visuals');
select public.hs_impact_story_choose_asset(pg_temp.id('s')::uuid, (pg_temp.vis()->'job'->>'id')::uuid, 'oak-trees', 'oak-alt-1');
select pg_temp.chk('12V15 an alternative the visuals offered can be chosen; the previews are then stale',
  pg_temp.vis()->>'state' = 'stale' and pg_temp.vis()->>'why' like '%chose or rejected a photo%'
  and pg_temp.err(format('select public.hs_impact_story_choose_asset(%L, %L, %L, %L)', pg_temp.id('s'), pg_temp.vis()->'job'->>'id', 'oak-trees', 'made-up')) like '%not one of the candidates%');
select public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, pg_temp.cur(), true);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_fail((pg_temp.lastjob()).id, 'Runner lost.');
select pg_temp.chk('12V17 a newer prepare that failed: the shown manifest still names the job that made it (its alternatives are chosen from that job)',
  pg_temp.vis()->'job'->>'status' = 'failed'
  and pg_temp.vis()->>'manifest_job_id' = (select job_id::text from public.impact_story_visual_manifests order by id desc limit 1)
  and pg_temp.vis()->>'manifest_job_id' is distinct from pg_temp.vis()->'job'->>'id');
-- 12V19-12V24 (2026-10-30): a photo the founder rejects in the Visuals step
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12V19 non-admin cannot reject or restore a photo',
  pg_temp.err(format('select public.hs_impact_story_photo_reject(%L, 1, %L)', pg_temp.id('s'), 'oak')) like '42501%'
  and pg_temp.err(format('select public.hs_impact_story_photo_restore(%L, %L)', pg_temp.id('s'), 'oak')) like '42501%'
  and not has_function_privilege('anon', 'public.hs_impact_story_photo_reject(uuid, bigint, text, text)', 'execute'));
select pg_temp.as_user('founder@example.com');
insert into _ids select 'vk0', public._hs_is_choice_key(pg_temp.id('s')::uuid)->>'key';
select pg_temp.chk('12V20 only a photo the newest previews show can be rejected, and only on those previews',
  pg_temp.err(format('select public.hs_impact_story_photo_reject(%L, %s, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', 'made-up')) like '%not in these previews%'
  and pg_temp.err(format('select public.hs_impact_story_photo_reject(%L, %s, %L)', pg_temp.id('s'), (pg_temp.vis()->>'manifest_id')::bigint - 1, 'oak')) like '40001%Newer previews%');
select public.hs_impact_story_photo_reject(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, 'oak', 'Wrong kind of tree.');
select pg_temp.chk('12V21 a rejected photo is listed with its file and changes the photo key, and rejecting it again changes nothing',
  pg_temp.vis()->'rejected'->0->>'id' = 'oak' and pg_temp.vis()->'rejected'->0->>'file_url' = 'https://upload.wikimedia.org/x.jpg'
  and pg_temp.vis()->'rejected'->0->>'sha256' = repeat('c', 64)
  and public._hs_is_choice_key(pg_temp.id('s')::uuid)->>'key' <> pg_temp.id('vk0')
  and (public.hs_impact_story_photo_reject(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, 'oak')->>'existing')::boolean
  and (select count(*) from public.impact_story_photo_rejections) = 1
  and exists (select 1 from public.impact_story_events where kind = 'photo_rejected'));
select public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, pg_temp.cur(), true);
select pg_temp.chk('12V22 the next Prepare carries the rejected photos to the engine',
  (pg_temp.lastjob()).input->'rejected_photos'->0->>'id' = 'oak'
  and public.hs_impact_story_job_claim((pg_temp.lastjob()).id)->'input'->'rejected_photos'->0->>'file_url' = 'https://upload.wikimedia.org/x.jpg');
select public.hs_impact_story_job_complete((pg_temp.lastjob()).id, jsonb_build_object('manifest', pg_temp.vman((pg_temp.lastjob()).id)));
select pg_temp.chk('12V23 previews made with the rejection are current',
  pg_temp.vis()->>'state' = 'ready');
select public.hs_impact_story_photo_restore(pg_temp.id('s')::uuid, 'oak');
select pg_temp.chk('12V24 a rejection can be undone, once; with none left the key is the old one again; rows are append-only',
  jsonb_array_length(pg_temp.vis()->'rejected') = 0 and pg_temp.vis()->>'state' = 'stale'
  and pg_temp.vis()->>'why' like '%chose or rejected a photo%'
  and public._hs_is_choice_key(pg_temp.id('s')::uuid)->>'key' = pg_temp.id('vk0')
  and pg_temp.err(format('select public.hs_impact_story_photo_restore(%L, %L)', pg_temp.id('s'), 'oak')) like '%not rejected%'
  and pg_temp.err('update public.impact_story_photo_rejections set note = null') is not null
  and pg_temp.err('delete from public.impact_story_photo_rejections') is not null);
-- 12V25-12V29: Approve / Reject / Need new photo under every shot
select public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, pg_temp.cur(), true);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_complete((pg_temp.lastjob()).id, jsonb_build_object('manifest',
  jsonb_set(jsonb_set(pg_temp.vman((pg_temp.lastjob()).id), '{assets,main,shots,0,subject_ref}', '"oak-trees"'),
            '{assets,thumbnail,shots,0,map}', 'true')));
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12V25 non-admin cannot decide a shot',
  pg_temp.err(format('select public.hs_impact_story_shot_decide(%L, 1, %L, %L, %L, %L)', pg_temp.id('s'), 'x', 'main', 'a1-s1', 'approved')) like '42501%');
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('12V26 a decision needs the newest previews and their hash, a real shot, and a note to reject a shot with no photo',
  pg_temp.err(format('select public.hs_impact_story_shot_decide(%L, %s, %L, %L, %L, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', repeat('0', 64), 'main', 'a1-s1', 'approved')) like '40001%changed%'
  and pg_temp.err(format('select public.hs_impact_story_shot_decide(%L, %s, %L, %L, %L, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', pg_temp.vis()->>'manifest_hash', 'main', 'nope', 'approved')) like '%not in these previews%'
  and pg_temp.err(format('select public.hs_impact_story_shot_decide(%L, %s, %L, %L, %L, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', pg_temp.vis()->>'manifest_hash', 'thumbnail', 'thumbnail', 'rejected')) like '%Say what is wrong%'
  and pg_temp.err(format('select public.hs_impact_story_shot_decide(%L, %s, %L, %L, %L, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', pg_temp.vis()->>'manifest_hash', 'thumbnail', 'thumbnail', 'new_photo')) like '%not about a subject%');
select public.hs_impact_story_shot_decide(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash', 'thumbnail', 'thumbnail', 'rejected', 'Wrong headline.');
select pg_temp.chk('12V27 a rejected shot (no photo) blocks Approve all',
  pg_temp.vis()->>'state' = 'needs_fixes' and pg_temp.vis()->>'why' like 'You rejected 1 shot%'
  and pg_temp.err(format('select public.hs_impact_story_visuals_approve(%L, %s, %L)', pg_temp.id('s'), pg_temp.vis()->>'manifest_id', pg_temp.vis()->>'manifest_hash')) like '%cannot be approved%');
select public.hs_impact_story_shot_decide(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash', 'thumbnail', 'thumbnail', 'approved');
select pg_temp.chk('12V27b approving the rejected shot clears the block', pg_temp.vis()->>'state' = 'ready');
select public.hs_impact_story_visuals_approve(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash');
select public.hs_impact_story_shot_decide(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash', 'thumbnail', 'thumbnail', 'rejected', 'Changed my mind.');
select pg_temp.chk('12V27c rejecting a shot after Approve all undoes the approval, so Render is refused',
  pg_temp.vis()->>'state' = 'needs_fixes'
  and pg_temp.err(format('select public.hs_impact_story_render(%L, %s)', pg_temp.id('s'), pg_temp.cur())) like '%Approve the visuals before rendering%');
select public.hs_impact_story_shot_decide(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash', 'thumbnail', 'thumbnail', 'approved');
select public.hs_impact_story_shot_decide(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash', 'main', 'a1-s1', 'new_photo');
select pg_temp.chk('12V28 Need new photo asks the next Prepare to search for that shot''s subject',
  pg_temp.vis()->'more_photos_for' = '["oak-trees"]'::jsonb and pg_temp.vis()->>'state' = 'approved');
select public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, pg_temp.cur(), true);
select pg_temp.chk('12V28b the Prepare job carries it', (pg_temp.lastjob()).input->'more_photos_for' = '["oak-trees"]'::jsonb);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_complete((pg_temp.lastjob()).id, jsonb_build_object('manifest', jsonb_set(pg_temp.vman((pg_temp.lastjob()).id), '{assets,main,shots,0,subject_ref}', '"oak-trees"')));
select public.hs_impact_story_shot_decide(pg_temp.id('s')::uuid, (pg_temp.vis()->>'manifest_id')::bigint, pg_temp.vis()->>'manifest_hash', 'main', 'a1-s1', 'rejected');
select pg_temp.chk('12V29 rejecting a shot that shows a photo rejects the photo; decisions are append-only',
  pg_temp.vis()->'rejected'->0->>'id' = 'oak' and pg_temp.vis()->>'state' = 'stale'
  and jsonb_array_length(pg_temp.vis()->'more_photos_for') = 0
  and pg_temp.err('update public.impact_story_shot_decisions set note = null') is not null
  and pg_temp.err('delete from public.impact_story_shot_decisions') is not null);
select public.hs_impact_story_photo_restore(pg_temp.id('s')::uuid, 'oak');
-- 12V30 (founder, 2026-10-30: no drawings): previews that still carry a drawn shot are out of date and never approvable
select public.hs_impact_story_visuals_prepare(pg_temp.id('s')::uuid, pg_temp.cur(), true);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_complete((pg_temp.lastjob()).id, jsonb_build_object('manifest',
  jsonb_set(jsonb_set(pg_temp.vman((pg_temp.lastjob()).id, 'flagged'), '{assets,main,shots,0,illustration}', '{"category":"wildlife"}'),
            '{assets,main,shots,0,photo}', 'null')));
select pg_temp.chk('12V30 previews with a drawn shot read stale and cannot be approved',
  pg_temp.vis()->>'state' = 'stale' and pg_temp.vis()->>'why' like '%before drawings were removed%'
  and pg_temp.err(format('select public.hs_impact_story_visuals_approve(%L, %s, %L)', pg_temp.id('s'),
        pg_temp.vis()->>'manifest_id', pg_temp.vis()->>'manifest_hash')) like '55000%');
select pg_temp.approve_visuals();
select pg_temp.chk('12V16 the bucket accepts the JPEG previews', (select 'image/jpeg' = any (allowed_mime_types) from storage.buckets where id = 'impact-media'));
select pg_temp.chk('12a the story is ready to render', pg_temp.stage() = 'media' and pg_temp.nxt() = 'Render the videos');
select pg_temp.chk('12b render on a stale version is refused', pg_temp.err(format('select public.hs_impact_story_render(%L, 6)', pg_temp.id('s'))) like '40001%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12c non-admin: render and media decisions refused', pg_temp.err(format('select public.hs_impact_story_render(%L, 7)', pg_temp.id('s'))) like '42501%'
   and pg_temp.err(format('select public.hs_impact_story_media_decide(%L, 1, %L)', pg_temp.id('s'), 'approved')) like '42501%');
select pg_temp.as_user('founder@example.com');
select public.hs_impact_story_render(pg_temp.id('s')::uuid, 7);
select pg_temp.chk('12d render is its own job, dispatched to the render workflow', (pg_temp.lastjob()).kind = 'render'
   and (select url from net.requests order by id desc limit 1) like '%/impact-story-render.yml/dispatches'
   and (pg_temp.lastjob()).input->'visual_manifest'->>'hash' = pg_temp.vis()->>'manifest_hash'
   and (pg_temp.lastjob()).input->'visual_manifest'->'opts' = '{"overlay":1}'::jsonb
   and (pg_temp.lastjob()).input->'asset_choices'->0->>'candidate_id' = 'oak-alt-1'
   and (pg_temp.lastjob()).input->>'narrative_hash' = public._hs_is_artifact_state(pg_temp.id('s')::uuid, 'narrative')->>'hash');
select pg_temp.chk('12e a second click returns the same render', (public.hs_impact_story_render(pg_temp.id('s')::uuid, 7)->>'existing')::boolean
   and pg_temp.nxt() like 'Rendering the videos%');
insert into _ids select 'r1', (pg_temp.lastjob()).id;
select pg_temp.chk('12f the worker gets the approved body', (public.hs_impact_story_job_claim(pg_temp.id('r1')::uuid)->'base_body'->>'schema') = 'impact-story/2');
select public.hs_impact_story_job_complete(pg_temp.id('r1')::uuid, jsonb_build_object('assets',
  (select jsonb_agg(x) from jsonb_array_elements(pg_temp.files(pg_temp.id('r1')::uuid)) x where x->>'asset' <> 'thumbnail')));
select pg_temp.chk('12g a render with no thumbnail fails and says so', (pg_temp.lastjob()).status = 'failed' and (pg_temp.lastjob()).error like '%no thumbnail%');
select public.hs_impact_story_job_retry(pg_temp.id('r1')::uuid);
select public.hs_impact_story_job_claim(pg_temp.id('r1')::uuid);
select public.hs_impact_story_job_complete(pg_temp.id('r1')::uuid, jsonb_build_object('assets',
  jsonb_set(pg_temp.files(pg_temp.id('r1')::uuid), '{0,path}', '"elsewhere/main.mp4"')));
select pg_temp.chk('12h a file outside the job''s folder is refused', (pg_temp.lastjob()).status = 'failed' and (pg_temp.lastjob()).error like '%outside%'
   and (select count(*) from public.impact_story_assets) = 0);
select public.hs_impact_story_job_retry(pg_temp.id('r1')::uuid);
select public.hs_impact_story_job_claim(pg_temp.id('r1')::uuid);
select public.hs_impact_story_job_complete(pg_temp.id('r1')::uuid, jsonb_build_object('assets', pg_temp.files(pg_temp.id('r1')::uuid)));
select pg_temp.chk('12i four files recorded, each pending review', (select count(*) from public.impact_story_assets) = 4
   and pg_temp.fst('main') = 'pending' and pg_temp.stage() = 'media' and pg_temp.nxt() = 'Review each video and the thumbnail'
   and public._hs_is_status(pg_temp.id('s')::uuid)->>'library' = 'needs_review'
   and jsonb_array_length(public.hs_impact_story_get(pg_temp.id('s')::uuid)->'media'->'files') = 4);
select pg_temp.chk('12j a rejection needs a note; a bad timecode is refused',
   pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L)', pg_temp.id('s'), pg_temp.fid('thumbnail'), 'rejected')) like '%Say what to fix%'
   and pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L, %L, %L)', pg_temp.id('s'), pg_temp.fid('main'), 'rejected', 'x', '1:75')) like '23514%');
select public.hs_impact_story_media_decide(pg_temp.id('s')::uuid, pg_temp.fid('thumbnail'), 'rejected', 'Text too small on a phone.', '0:00');
select pg_temp.chk('12k a rejected file says what to fix', pg_temp.fst('thumbnail') = 'rejected');
select public.hs_impact_story_media_decide(pg_temp.id('s')::uuid, pg_temp.fid('main'), 'rejected', 'Rename the checklist.', '1:05');
select pg_temp.chk('12k2 a second fix request does not remove the first: both listed, newest first, both open',
   jsonb_array_length(public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests') = 2
   and public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests'->0->>'asset' = 'main'
   and public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests'->1->>'asset' = 'thumbnail'
   and not exists (select 1 from jsonb_array_elements(public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests') x where x->>'status' <> 'open'));
-- Start fixes: the two open requests go out as one batch, the fixer claims it and records what it did.
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12f1 non-admin cannot start fixes', pg_temp.err(format('select public.hs_impact_story_fix_start(%L)', pg_temp.id('s'))) like '42501%');
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('12f2 the fixer door is service-role only, Start fixes is for signed-in admins',
   not has_function_privilege('authenticated', 'public.impact_fix_batch_claim(uuid)', 'execute')
   and not has_function_privilege('authenticated', 'public.impact_fix_batch_complete(uuid, jsonb)', 'execute')
   and not has_function_privilege('authenticated', 'public.impact_fix_batches_list()', 'execute')
   and has_function_privilege('service_role', 'public.impact_fix_batch_complete(uuid, jsonb)', 'execute')
   and has_function_privilege('authenticated', 'public.hs_impact_story_fix_start(uuid)', 'execute')
   and not has_function_privilege('anon', 'public.hs_impact_story_fix_start(uuid)', 'execute'));
insert into _ids select 'fb', public.hs_impact_story_fix_start(pg_temp.id('s')::uuid)->'batch'->>'id';
select pg_temp.chk('12f3 Start fixes queues one batch carrying both open requests, and the page sees it',
   public._hs_is_media(pg_temp.id('s')::uuid)->'fix_batch'->>'status' = 'queued'
   and (public._hs_is_media(pg_temp.id('s')::uuid)->'fix_batch'->>'requests')::int = 2
   and not exists (select 1 from jsonb_array_elements(public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests') x where x->'batch'->>'status' <> 'queued'));
select pg_temp.chk('12f4 a second press returns the same batch', (public.hs_impact_story_fix_start(pg_temp.id('s')::uuid)->>'existing')::boolean
   and (select count(*) from public.impact_story_fix_batches) = 1);
select pg_temp.chk('12f4b the Fix button starts the Fix job on main for this batch, and a second press while queued starts it again',
   (select url from net.requests order by id desc limit 1) like '%/homesignal-ingest/actions/workflows/impact-fix-run.yml/dispatches'
   and (select body from net.requests order by id desc limit 1) = jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('batch', pg_temp.id('fb')))
   and (select count(*) from net.requests where url like '%impact-fix-run.yml%') = 2);
delete from vault.decrypted_secrets;
select public._hs_is_fix_dispatch(pg_temp.id('fb')::uuid);
select pg_temp.chk('12f4c no GitHub credential: the batch is failed with a readable reason, nothing is sent',
   (select status from public.impact_story_fix_batches where id = pg_temp.id('fb')::uuid) = 'failed'
   and (select summary from public.impact_story_fix_batches where id = pg_temp.id('fb')::uuid) like '%no GitHub credential%'
   and (select count(*) from net.requests where url like '%impact-fix-run.yml%') = 2
   and not has_function_privilege('authenticated', 'public._hs_is_fix_dispatch(uuid)', 'execute'));
insert into vault.decrypted_secrets values ('github_actions_pat', 'test-pat');
update public.impact_story_fix_batches set status = 'queued', completed_at = null, summary = null where id = pg_temp.id('fb')::uuid;
select pg_temp.chk('12f5 the fixer lists it, with the story slug', public.impact_fix_batches_list()->0->>'id' = pg_temp.id('fb')
   and public.impact_fix_batches_list()->0->>'video_slug' is not null);
select public.impact_fix_batch_claim(pg_temp.id('fb')::uuid);
select pg_temp.chk('12f6 claimed: working, out of the list, cannot be claimed twice',
   public._hs_is_media(pg_temp.id('s')::uuid)->'fix_batch'->>'status' = 'working'
   and jsonb_array_length(public.impact_fix_batches_list()) = 0
   and pg_temp.err(format('select public.impact_fix_batch_claim(%L)', pg_temp.id('fb'))) like '55000%');
select pg_temp.chk('12f7 completion is checked: a summary, every request accounted for, no stray ids, a needs_you request is not done',
   pg_temp.err(format('select public.impact_fix_batch_complete(%L, %L)', pg_temp.id('fb'), '{"status":"done","outcomes":[]}')) like '%say what was done%'
   and pg_temp.err(format('select public.impact_fix_batch_complete(%L, %L)', pg_temp.id('fb'), '{"status":"done","summary":"x","outcomes":[]}')) like '%every request needs an outcome%'
   and pg_temp.err(format('select public.impact_fix_batch_complete(%L, %L)', pg_temp.id('fb'), '{"status":"done","summary":"x","outcomes":[{"decision_id":999999,"outcome":"fixed"}]}')) like '%outcomes must name%'
   and pg_temp.err(format('select public.impact_fix_batch_complete(%L, %L::jsonb)', pg_temp.id('fb'),
         (select jsonb_build_object('status','done','summary','x','outcomes', jsonb_agg(jsonb_build_object('decision_id', r->'id', 'outcome', 'needs_you'))) from jsonb_array_elements((select requests from public.impact_story_fix_batches)) r)::text)) like '%makes the batch needs_you%'
   and pg_temp.err(format('select public.impact_fix_batch_complete(%L, %L)', pg_temp.id('fb'), '{"status":"done","summary":"x","regenerate":"render"}')) like '%bad regenerate%');
select public.impact_fix_batch_complete(pg_temp.id('fb')::uuid, (select jsonb_build_object('status','done','summary','Renamed the checklist; new tree photo.',
   'next_step','Press Render again.', 'outcomes', jsonb_agg(jsonb_build_object('decision_id', r->'id', 'outcome', 'fixed', 'note', 'done in renderer'))) from jsonb_array_elements((select requests from public.impact_story_fix_batches)) r));
select pg_temp.chk('12f8 done: each request shows its outcome, the batch says the next step, nothing is left to send',
   public._hs_is_media(pg_temp.id('s')::uuid)->'fix_batch'->>'status' = 'done'
   and public._hs_is_media(pg_temp.id('s')::uuid)->'fix_batch'->>'next_step' = 'Press Render again.'
   and not exists (select 1 from jsonb_array_elements(public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests') x where x->'batch'->>'outcome' <> 'fixed')
   and jsonb_array_length(public._hs_is_fix_eligible(pg_temp.id('s')::uuid)) = 0
   and pg_temp.err(format('select public.hs_impact_story_fix_start(%L)', pg_temp.id('s'))) like '%no open fix requests%');
select public.hs_impact_story_media_decide(pg_temp.id('s')::uuid, pg_temp.fid(a), 'approved') from unnest(array['main', 'short_a', 'short_b']) a;
select pg_temp.chk('12k3 approving a file later closes only its own request, and the request stays listed',
   (select x->>'status' from jsonb_array_elements(public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests') x where x->>'asset' = 'main') = 'closed'
   and (select x->>'status' from jsonb_array_elements(public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests') x where x->>'asset' = 'thumbnail') = 'open'
   and jsonb_array_length(public._hs_is_media(pg_temp.id('s')::uuid)->'fix_requests') = 2);
select pg_temp.chk('12l three of four approved: not ready to export', pg_temp.stage() = 'media');
select public.hs_impact_story_media_decide(pg_temp.id('s')::uuid, pg_temp.fid('thumbnail'), 'approved');
select pg_temp.chk('12m every file approved: ready to export, nothing published', pg_temp.stage() = 'distribution'
   and pg_temp.nxt() = 'Ready to export. Publishing is not built yet.' and (public._hs_is_media(pg_temp.id('s')::uuid)->>'complete')::boolean);
select pg_temp.chk('12n rendered files and media decisions are append-only', pg_temp.err('update public.impact_story_assets set bytes = 1') is not null
   and pg_temp.err('delete from public.impact_story_media_decisions') is not null);
select pg_temp.chk('12o the bucket is private; only admins may read it, and the only browser write is an admin''s photo upload (never an update or delete)',
   not (select public from storage.buckets where id = 'impact-media')
   and exists (select 1 from pg_policies where policyname = 'impact_media_admin_read' and cmd = 'SELECT')
   and (select array_agg(policyname || ':' || cmd order by policyname) from pg_policies where tablename = 'objects' and policyname like 'impact_media%')
       = array['impact_media_admin_read:SELECT', 'impact_media_admin_upload:INSERT']
   and (select with_check from pg_policies where policyname = 'impact_media_admin_upload') like '%/uploads/%');
select public.hs_impact_story_render(pg_temp.id('s')::uuid, 7, true);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_complete((pg_temp.lastjob()).id, jsonb_build_object('assets', pg_temp.files((pg_temp.lastjob()).id, false)));
select pg_temp.chk('12p a new render needs reviewing again; a file that failed its checks cannot be approved', pg_temp.stage() = 'media'
   and pg_temp.fst('main') = 'pending' and pg_temp.fst('short_a') = 'blocked'
   and pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L)', pg_temp.id('s'), pg_temp.fid('short_a'), 'approved')) like '%media checks failed%');
select pg_temp.chk('12q a file from an older render cannot be decided',
   pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L)', pg_temp.id('s'), (select min(id) from public.impact_story_assets), 'approved')) like '%not part of the current render%');

-- 12r. the quality gates (2026-10-27): a blocked render, choosing a licensed photo, a file the visual gate failed --
select public.hs_impact_story_render(pg_temp.id('s')::uuid, 7, true);
insert into _ids select 'rb', (pg_temp.lastjob()).id;
select public.hs_impact_story_job_claim(pg_temp.id('rb')::uuid);
create temp table _blk as select jsonb_build_object('blocked', true,
    'failures', jsonb_build_array(jsonb_build_object('code', 'missing_essential_image', 'label', 'Missing essential image',
                                  'detail', 'Oak trees: no licensed photo yet.', 'action', 'Choose one of the licensed candidates.')),
    'candidates', jsonb_build_array(jsonb_build_object('subject_id', 'oak-trees', 'subject', 'Oak trees', 'candidates',
      jsonb_build_array(jsonb_build_object('id', 'oak-photo-1a2b3c4d', 'title', 'File:Oak.jpg', 'license', 'CC BY-SA 4.0',
        'author', 'A. Person', 'page_url', 'https://commons.wikimedia.org/wiki/File:Oak.jpg',
        'file_url', 'https://upload.wikimedia.org/x/Oak.jpg', 'sha256', repeat('b', 64)))))) as r;
select public.hs_impact_story_job_fail(pg_temp.id('rb')::uuid, 'Nothing was rendered: Missing essential image.', (select r from _blk));
select pg_temp.chk('12r1 a blocked render keeps what is missing and the licensed candidates',
  public._hs_is_media(pg_temp.id('s')::uuid)->'blocked'->'failures'->0->>'code' = 'missing_essential_image'
  and public._hs_is_media(pg_temp.id('s')::uuid)->'blocked'->'candidates'->0->'candidates'->0->>'id' = 'oak-photo-1a2b3c4d');
-- Codex #2314: a retry whose new attempt fails with only an error must not show (or accept choices from) the first
-- attempt's blocked result.
select public.hs_impact_story_job_retry(pg_temp.id('rb')::uuid);
select pg_temp.chk('12r1a a retry clears the previous attempt''s result',
  (select result from public.impact_story_jobs where id = pg_temp.id('rb')::uuid) is null);
select public.hs_impact_story_job_claim(pg_temp.id('rb')::uuid);
select public.hs_impact_story_job_fail(pg_temp.id('rb')::uuid, 'Remotion crashed.');
select pg_temp.chk('12r1b an unstructured failure after a blocked attempt shows no blocked result and accepts no choice',
  coalesce(public._hs_is_media(pg_temp.id('s')::uuid)->'blocked', 'null'::jsonb) = 'null'::jsonb
  and pg_temp.err(format('select public.hs_impact_story_choose_asset(%L, %L, %L, %L)', pg_temp.id('s'), pg_temp.id('rb'), 'oak-trees', 'oak-photo-1a2b3c4d')) like '%did not stop%');
select public.hs_impact_story_job_retry(pg_temp.id('rb')::uuid);
select public.hs_impact_story_job_claim(pg_temp.id('rb')::uuid);
select public.hs_impact_story_job_fail(pg_temp.id('rb')::uuid, 'Nothing was rendered: Missing essential image.', (select r from _blk));
select pg_temp.chk('12r2 only a candidate that render recorded can be chosen',
  pg_temp.err(format('select public.hs_impact_story_choose_asset(%L, %L, %L, %L)', pg_temp.id('s'), pg_temp.id('rb'), 'oak-trees', 'made-up')) like '%not one of the candidates%'
  and pg_temp.err(format('select public.hs_impact_story_choose_asset(%L, %L, %L, %L)', pg_temp.id('s'), pg_temp.id('r1'), 'oak-trees', 'oak-photo-1a2b3c4d')) like '%did not stop%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12r3 non-admin cannot choose a photo',
  pg_temp.err(format('select public.hs_impact_story_choose_asset(%L, %L, %L, %L)', pg_temp.id('s'), pg_temp.id('rb'), 'oak-trees', 'oak-photo-1a2b3c4d')) like '42501%');
select pg_temp.as_user('founder@example.com');
select public.hs_impact_story_choose_asset(pg_temp.id('s')::uuid, pg_temp.id('rb')::uuid, 'oak-trees', 'oak-photo-1a2b3c4d');
select pg_temp.chk('12r4 the choice is recorded and append-only',
  public._hs_is_media(pg_temp.id('s')::uuid)->'choices'->0->>'candidate_id' = 'oak-photo-1a2b3c4d'
  and pg_temp.err('delete from public.impact_story_asset_choices') is not null);
select pg_temp.chk('12r4b a new photo choice makes the approved visuals stale: Render is refused until they are approved again',
  pg_temp.vis()->>'state' = 'stale'
  and pg_temp.err(format('select public.hs_impact_story_render(%L, 7)', pg_temp.id('s'))) like '%Approve the visuals before rendering%');
select pg_temp.approve_visuals();
select public.hs_impact_story_render(pg_temp.id('s')::uuid, 7);
select pg_temp.chk('12r5 the next Render is a new job carrying the chosen photo',
  (pg_temp.lastjob()).id <> pg_temp.id('rb')::uuid and (pg_temp.lastjob()).status = 'queued'
  and (select x->'entry'->>'sha256' from jsonb_array_elements((pg_temp.lastjob()).input->'asset_choices') x where x->>'subject_id' = 'oak-trees') = repeat('b', 64)
  and (pg_temp.lastjob()).input->>'renderer' = 'impact-render-3'
  and (select x->>'candidate_id' from jsonb_array_elements(public.hs_impact_story_job_claim((pg_temp.lastjob()).id)->'asset_choices') x where x->>'subject_id' = 'oak-trees') = 'oak-photo-1a2b3c4d');
select public.hs_impact_story_job_complete((pg_temp.lastjob()).id, jsonb_build_object('assets',
  jsonb_set(pg_temp.files((pg_temp.lastjob()).id), '{1,qc}', jsonb_build_object('ok', true, 'quality', jsonb_build_object('ok', false,
    'failures', jsonb_build_array(jsonb_build_object('code', 'excessive_documents', 'label', 'Too many documents and cards'))))),
  'quality', jsonb_build_object('ok', false), 'currency', jsonb_build_object('state', 'current')));
select pg_temp.chk('12r6 a file the visual quality gate failed is blocked and cannot be approved',
  pg_temp.fst('short_a') = 'blocked' and pg_temp.fst('main') = 'pending'
  and pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L)', pg_temp.id('s'), pg_temp.fid('short_a'), 'approved')) like '%visual quality gate failed: Too many documents and cards%'
  and public._hs_is_media(pg_temp.id('s')::uuid)->'blocked' = 'null'::jsonb
  and public._hs_is_media(pg_temp.id('s')::uuid)->'currency'->>'state' = 'current');
select pg_temp.chk('12r7 a file with no quality report (rendered before the gates) is not blocked by it', pg_temp.fst('main') = 'pending');

-- 10. a story written before the outline, and its old approvals --------------------------------------
select public.hs_impact_story_save(pg_temp.id('s')::uuid, 7, '{"schema":"impact-story/1","angles":[{"id":"motivation"}],"selected_angle":"motivation"}'::jsonb);
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(false, 'P2'))));
select pg_temp.chk('10m a changed narrative makes the rendered files stale and undecidable', pg_temp.fst('main') = 'stale'
   and not (public._hs_is_media(pg_temp.id('s')::uuid)->>'current')::boolean
   and pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L)', pg_temp.id('s'), pg_temp.fid('main'), 'approved')) like '%earlier narrative%');
select pg_temp.chk('10a an angle-card story is asked to Analyze again', pg_temp.stage() = 'outline' and pg_temp.nxt() = 'Analyze again to get the story outline'
   and pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'generate')) like '%no story outline%');
insert into public.impact_story_approvals (story_id, artifact, version, artifact_hash, decision, actor)
  values (pg_temp.id('s')::uuid, 'angle', 1, 'x', 'approved', 'history@example.com');
select pg_temp.chk('10b old per-part approval rows stay storable and readable as history',
   (select count(*) from public.impact_story_approvals where artifact = 'angle') = 1);
select pg_temp.chk('10c the artifact list is widened, never narrowed', pg_temp.err($q$insert into public.impact_story_approvals (story_id, artifact, version, artifact_hash, decision, actor) values ('$q$ || pg_temp.id('s') || $q$', 'villain', 1, 'x', 'approved', 'x')$q$) like '23514%');

-- 11. immutability, archive, duplicate -----------------------------------------------------------------
select pg_temp.chk('11a approvals are append-only', pg_temp.err('update public.impact_story_approvals set decision = $$approved$$') is not null
   and pg_temp.err('delete from public.impact_story_events') is not null);
select pg_temp.chk('11b a version body cannot be edited in place', pg_temp.err('update public.impact_story_versions set body = $${}$$') is not null
   and pg_temp.err('delete from public.impact_story_versions') is not null);
select pg_temp.chk('11c archive needs the confirm word', pg_temp.err(format('select public.hs_impact_story_archive(%L, %L)', pg_temp.id('s'), 'yes')) like '%ARCHIVE%');
select public.hs_impact_story_archive(pg_temp.id('s')::uuid, 'ARCHIVE');
select pg_temp.chk('11d archived stories accept no jobs', pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'pack')) like '%archived%');
select public.hs_impact_story_archive(pg_temp.id('s')::uuid, null, true);
insert into _ids select 'd', public.hs_impact_story_duplicate(pg_temp.id('s')::uuid)->>'story_id';
select pg_temp.chk('11e duplicate is a NEW story with no approvals copied', (select duplicated_from::text from public.impact_stories where id = pg_temp.id('d')::uuid) = pg_temp.id('s')
   and (select count(*) from public.impact_story_approvals where story_id = pg_temp.id('d')::uuid) = 0);
select pg_temp.chk('11f get returns history', jsonb_array_length(public.hs_impact_story_get(pg_temp.id('s')::uuid)->'versions') = 8
   and jsonb_array_length(public.hs_impact_story_get(pg_temp.id('s')::uuid)->'events') > 10);
select pg_temp.chk('11g Tab 16 table untouched', (select count(*) from public.youtube_video_reviews) = 1);

-- 12x. a job GitHub never started is reported at once and can be retried (seen 2026-10-26: HTTP 500 on dispatch) --
create function pg_temp.djob() returns public.impact_story_jobs language sql as $$
  select * from public.impact_story_jobs where story_id = pg_temp.id('d')::uuid order by created_at desc, attempts desc limit 1 $$;
select public.hs_impact_story_request(pg_temp.id('d')::uuid, 'pack') where not exists
  (select 1 from public.impact_story_jobs where story_id = pg_temp.id('d')::uuid and status in ('queued', 'running'));
select pg_temp.chk('12x1 a fresh queued job with no answer yet is not reported as failed',
  (public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'not_started')::boolean = false
  and (public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'stuck')::boolean = false);
insert into net._http_response (id, status_code) values ((pg_temp.djob()).dispatch_request_id, 204);
select pg_temp.chk('12x2 a dispatch GitHub accepted is not a failure',
  (public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'not_started')::boolean = false);
update net._http_response set status_code = 500 where id = (pg_temp.djob()).dispatch_request_id;
select pg_temp.chk('12x3 GitHub refusing the dispatch shows at once, with the code, and offers Retry',
  (public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'not_started')::boolean
  and (public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'stuck')::boolean
  and public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'error' like '%HTTP 500%'
  and public._hs_is_status(pg_temp.id('d')::uuid)->>'next' like '%Retry%');
select public.hs_impact_story_job_retry((pg_temp.djob()).id);
select pg_temp.chk('12x4 Retry re-dispatches the same job, which is then no longer reported',
  (pg_temp.djob()).attempts = 2 and (pg_temp.djob()).status = 'queued'
  and (select max(id) from net.requests) = (pg_temp.djob()).dispatch_request_id
  and (public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'not_started')::boolean = false);
update public.impact_story_jobs set created_at = now() - interval '20 minutes' where id = (pg_temp.djob()).id;
select pg_temp.chk('12x5 a job no worker claimed in 15 minutes is retryable',
  (public._hs_is_status(pg_temp.id('d')::uuid)->'job'->>'not_started')::boolean
  and pg_temp.err(format('select public.hs_impact_story_job_retry(%L)', (pg_temp.djob()).id)) is null);
select pg_temp.chk('12x6 the helper is not callable by visitors',
  not has_function_privilege('anon', 'public._hs_is_not_started(public.impact_story_jobs)', 'execute')
  and not has_function_privilege('authenticated', 'public._hs_is_not_started(public.impact_story_jobs)', 'execute'));

-- 12y. a render the worker may still finish is not offered for Retry (2026-10-27: a 107-minute main video) ------
select pg_temp.chk('12y1 a render running 200 minutes is not stuck', public._hs_is_stuck_after('render') > interval '330 minutes'
  and now() - interval '200 minutes' > now() - public._hs_is_stuck_after('render'));
select pg_temp.chk('12y2 other jobs keep their 40-minute limit', public._hs_is_stuck_after('pack') = interval '40 minutes');

-- 13. impact-story/3 (2026-10-27): the V3 analysis joins the one approval, without moving a v2 hash -------------
select pg_temp.chk('13a a v2 body hashes exactly as the pre-V3 slice did',
  public._hs_is_hash(pg_temp.body(), 'narrative') = md5(jsonb_build_object('arc', pg_temp.body()->'arc', 'outline', pg_temp.body()->'outline',
    'main', pg_temp.body()->'main', 'qol', pg_temp.body()->'qol', 'shorts', pg_temp.body()->'shorts', 'packaging', pg_temp.body()->'packaging')::text));
select pg_temp.chk('13b a null V3 key is the same as an absent one',
  public._hs_is_hash(pg_temp.body() || '{"discovery":null,"concepts":null}'::jsonb, 'narrative') = public._hs_is_hash(pg_temp.body(), 'narrative'));
select pg_temp.chk('13c a V3 body covers discovery, concepts and selection',
  (select array_agg(k order by k) from jsonb_object_keys(public._hs_is_artifact(pg_temp.body() || '{"discovery":{"findings":[]},"concepts":[{"id":"x"}],"selection":{"concept":"x"}}'::jsonb, 'narrative')) k)
    = array['arc','concepts','discovery','main','outline','packaging','qol','selection','shorts']);
select pg_temp.chk('13d choosing another concept changes what the approval covers',
  public._hs_is_hash(pg_temp.body() || '{"concepts":[{"id":"x"},{"id":"y"}],"selection":{"concept":"x"}}'::jsonb, 'narrative')
  <> public._hs_is_hash(pg_temp.body() || '{"concepts":[{"id":"x"},{"id":"y"}],"selection":{"concept":"y"}}'::jsonb, 'narrative'));
select pg_temp.as_user('founder@example.com');
create temp table _rev as select x, pg_temp.err(format('select public.hs_impact_story_section_revision(%L, %s, %L, %L)', pg_temp.id('s'), pg_temp.cur(), x, 'Lead with the accountability concept.')) e
  from unnest(array['concepts','discovery','visuals','accountability']) x;
select pg_temp.chk('13f a revision note can ask for another concept, the discovery, the visuals or deeper accountability research',
  (select bool_and(e is null) from _rev)
  and (select count(distinct detail->>'section') from public.impact_story_events where kind = 'section_revision'
         and detail->>'section' in ('concepts','discovery','visuals','accountability')) = 4);
select pg_temp.chk('13g the responsibility map is part of the one approval: changing who did what needs approving again',
  public._hs_is_hash(pg_temp.body() || '{"discovery":{"accountability":{"attributions":[{"id":"a","status":"alleged"}]}}}'::jsonb, 'narrative')
  <> public._hs_is_hash(pg_temp.body() || '{"discovery":{"accountability":{"attributions":[{"id":"a","status":"established"}]}}}'::jsonb, 'narrative'));
select pg_temp.chk('13e the render key names impact-render-3',
  position('impact-render-3' in pg_get_functiondef('public.hs_impact_story_render(uuid,integer,boolean)'::regprocedure)) > 0
  and position('impact-render-2' in pg_get_functiondef('public.hs_impact_story_render(uuid,integer,boolean)'::regprocedure)) = 0);

-- 12V18 (Codex on #2386): a save made while the visuals are being prepared gets its check once they finish
select public._hs_is_queue(pg_temp.id('s')::uuid, 'visuals', jsonb_build_object('scope', 'visuals|followup-test',
  'narrative_hash', 'n'||md5('x'), 'renderer', 'impact-render-3', 'choices_key', md5('')), 'founder@example.com');
create temp table _vj as select (pg_temp.lastjob()).id as id;
select public.hs_impact_story_save(pg_temp.id('s')::uuid, pg_temp.cur(), pg_temp.body('Who gets the new dock?'));
select pg_temp.chk('12V18a the save waits while the visuals job runs', (pg_temp.lastjob()).kind = 'visuals');
select public.hs_impact_story_job_claim((select id from _vj));
select public.hs_impact_story_job_complete((select id from _vj), jsonb_build_object('manifest', pg_temp.vman((select id from _vj))));
select pg_temp.chk('12V18 a save made while the visuals were prepared is checked when they finish',
  (pg_temp.lastjob()).kind = 'validate' and (pg_temp.lastjob()).status = 'queued' and (pg_temp.lastjob()).base_version = pg_temp.cur());

-- 12U (plan v3 P2, 2026-10-30): a photo the founder uploads, recorded with their permission, becomes that subject's choice
select pg_temp.as_user('founder@example.com');
select public.hs_impact_story_save(pg_temp.id('s')::uuid, pg_temp.cur(), pg_temp.body('Who gets the new dock?') ||
  '{"discovery":{"subjects":[{"id":"oak-trees","subject":"Oak trees","category":"trees"}]}}'::jsonb);
insert into _ids values ('u1', '0d0d0d0d-1111-2222-3333-444444444444'), ('u2', '0e0e0e0e-1111-2222-3333-444444444444'),
  ('u3', '0f0f0f0f-1111-2222-3333-444444444444');
create function pg_temp.up(u text, mime text default 'image/jpeg', subj text default 'oak-trees', perm boolean default true,
                           credit text default 'J. Founder', sha text default repeat('a', 64)) returns text language sql as $$
  select pg_temp.err(format('select public.hs_impact_story_upload_photo(%L, %L, %L, %L, %L, %L, true, %L)',
    pg_temp.id('s'), subj, pg_temp.id(u), mime, sha, credit, perm)) $$;
create function pg_temp.upath(u text, ext text default 'jpg') returns text language sql as $$
  select pg_temp.id('s') || '/uploads/' || pg_temp.id(u) || '.' || ext $$;
select pg_temp.chk('12U1 nothing is recorded before the file is in storage', pg_temp.up('u1') like '55000%not found in storage%');
insert into storage.objects (bucket_id, name, metadata) values
  ('impact-media', pg_temp.upath('u1'), '{"size": 204800, "mimetype": "image/jpeg"}'),
  ('impact-media', pg_temp.upath('u2', 'png'), '{"size": 99999999, "mimetype": "image/png"}'),
  ('impact-media', pg_temp.upath('u3'), '{"size": 1000, "mimetype": "image/png"}');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12U2 a non-admin cannot record an upload', pg_temp.up('u1') like '42501%');
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('12U3 the founder must confirm the permission statement, name the photographer and pick a real subject',
  pg_temp.up('u1', perm => false) like '%own this photo or have permission%'
  and pg_temp.up('u1', credit => ' ') like '%who took the photo%'
  and pg_temp.up('u1', subj => 'made-up') like '%not one of this story''s subjects%'
  and pg_temp.up('u1', sha => 'abc') like '%checksum%');
select pg_temp.chk('12U4 the stored file must be the uploaded kind and under 15 MB',
  pg_temp.up('u1', mime => 'image/png') like '%not found in storage%'
  and pg_temp.up('u2', mime => 'image/png') like '%smaller than 15 MB%'
  and pg_temp.up('u3') like '%not the kind of image%'
  and pg_temp.up('u1', mime => 'image/gif') like '%JPEG or PNG%');
create temp table _u5 as select pg_temp.up('u1') as e;
select pg_temp.chk('12U5 a recorded upload becomes the subject''s photo choice, as the engine reads it',
  (select e is null from _u5)
  and (select upload_id::text = pg_temp.id('u1') and job_id is null and entry->>'source' = 'founder_upload'
              and entry->>'file_url' = 'storage:impact-media/' || pg_temp.upath('u1') and entry->>'rights_status' = 'cleared'
              and entry->>'site_relation' = 'actual_site' and entry->>'category' = 'trees' and entry->>'author' = 'J. Founder'
         from public._hs_is_choices(pg_temp.id('s')::uuid) where subject_id = 'oak-trees')
  and (select permission from public.impact_story_uploads where id = pg_temp.id('u1')::uuid) like 'I own this photo%'
  and public._hs_is_media(pg_temp.id('s')::uuid)->'choices' @> '[{"subject_id":"oak-trees","source":"founder_upload"}]'
  and exists (select 1 from public.impact_story_events where kind = 'photo_uploaded'));
select pg_temp.chk('12U6 an upload is recorded once and never edited; a choice comes from a job or an upload, not neither',
  pg_temp.up('u1') like '23505%'
  and pg_temp.err('update public.impact_story_uploads set credit = ''x''') is not null
  and pg_temp.err(format('insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, entry, actor) values (%L, %L, %L, %L, %L)',
        pg_temp.id('s'), 'oak-trees', 'x', '{}', 'founder@example.com')) like '23514%');
select pg_temp.chk('12U7 the upload function is for signed-in admins only',
  not has_function_privilege('anon', 'public.hs_impact_story_upload_photo(uuid, text, uuid, text, text, text, boolean, boolean)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_impact_story_upload_photo(uuid, text, uuid, text, text, text, boolean, boolean)', 'execute'));
-- the storage rule itself, run as the browser's role
create temp table _sq as select
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'impact-media', pg_temp.id('s') || '/uploads/' || gen_random_uuid() || '.jpg') ok_upload,
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'impact-media', pg_temp.id('s') || '/visuals/' || gen_random_uuid() || '.jpg') other_folder,
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'impact-media', pg_temp.id('s') || '/uploads/' || gen_random_uuid() || '.mp4') other_kind,
  format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'impact-media', pg_temp.id('s') || '/uploads/' || gen_random_uuid() || '.jpg') stranger;
grant select on _sq to authenticated;
create temp table _st (k text, e text);
grant insert, select on _st to authenticated;
select pg_temp.as_user('founder@example.com');
set role authenticated;
insert into _st select 'ok_upload', pg_temp.err(ok_upload) from _sq;
insert into _st select 'other_folder', pg_temp.err(other_folder) from _sq;
insert into _st select 'other_kind', pg_temp.err(other_kind) from _sq;
reset role;
select pg_temp.as_user('stranger@example.com');
set role authenticated;
insert into _st select 'stranger', pg_temp.err(stranger) from _sq;
reset role;
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('12U8 an admin may put a photo only into a story''s uploads folder; nobody else may write',
  (select e is null from _st where k = 'ok_upload') and (select e like '42501%' from _st where k = 'other_folder')
  and (select e like '42501%' from _st where k = 'other_kind') and (select e like '42501%' from _st where k = 'stranger'));

\o
select count(*) || ' checks passed' as result from _res where ok;
