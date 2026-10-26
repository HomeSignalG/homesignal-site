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
select pg_temp.chk('5g one approval: ready to render', pg_temp.stage() = 'media' and public._hs_is_status(pg_temp.id('s')::uuid)->>'library' = 'ready');
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
select pg_temp.chk('9c re-checked against the same text: the approval returns', pg_temp.nst() = 'approved' and pg_temp.stage() = 'media');
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
select pg_temp.chk('12a the story is ready to render', pg_temp.stage() = 'media' and pg_temp.nxt() = 'Render the videos');
select pg_temp.chk('12b render on a stale version is refused', pg_temp.err(format('select public.hs_impact_story_render(%L, 6)', pg_temp.id('s'))) like '40001%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('12c non-admin: render and media decisions refused', pg_temp.err(format('select public.hs_impact_story_render(%L, 7)', pg_temp.id('s'))) like '42501%'
   and pg_temp.err(format('select public.hs_impact_story_media_decide(%L, 1, %L)', pg_temp.id('s'), 'approved')) like '42501%');
select pg_temp.as_user('founder@example.com');
select public.hs_impact_story_render(pg_temp.id('s')::uuid, 7);
select pg_temp.chk('12d render is its own job, dispatched to the render workflow', (pg_temp.lastjob()).kind = 'render'
   and (select url from net.requests order by id desc limit 1) like '%/impact-story-render.yml/dispatches'
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
select public.hs_impact_story_media_decide(pg_temp.id('s')::uuid, pg_temp.fid(a), 'approved') from unnest(array['main', 'short_a', 'short_b']) a;
select pg_temp.chk('12l three of four approved: not ready to export', pg_temp.stage() = 'media');
select public.hs_impact_story_media_decide(pg_temp.id('s')::uuid, pg_temp.fid('thumbnail'), 'approved');
select pg_temp.chk('12m every file approved: ready to export, nothing published', pg_temp.stage() = 'distribution'
   and pg_temp.nxt() = 'Ready to export. Publishing is not built yet.' and (public._hs_is_media(pg_temp.id('s')::uuid)->>'complete')::boolean);
select pg_temp.chk('12n rendered files and media decisions are append-only', pg_temp.err('update public.impact_story_assets set bytes = 1') is not null
   and pg_temp.err('delete from public.impact_story_media_decisions') is not null);
select pg_temp.chk('12o the bucket is private and only admins may read it', not (select public from storage.buckets where id = 'impact-media')
   and exists (select 1 from pg_policies where policyname = 'impact_media_admin_read' and cmd = 'SELECT')
   and not exists (select 1 from pg_policies where tablename = 'objects' and policyname like 'impact_media%' and cmd <> 'SELECT'));
select public.hs_impact_story_render(pg_temp.id('s')::uuid, 7, true);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_complete((pg_temp.lastjob()).id, jsonb_build_object('assets', pg_temp.files((pg_temp.lastjob()).id, false)));
select pg_temp.chk('12p a new render needs reviewing again; a file that failed its checks cannot be approved', pg_temp.stage() = 'media'
   and pg_temp.fst('main') = 'pending' and pg_temp.fst('short_a') = 'blocked'
   and pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L)', pg_temp.id('s'), pg_temp.fid('short_a'), 'approved')) like '%media checks failed%');
select pg_temp.chk('12q a file from an older render cannot be decided',
   pg_temp.err(format('select public.hs_impact_story_media_decide(%L, %s, %L)', pg_temp.id('s'), (select min(id) from public.impact_story_assets), 'approved')) like '%not part of the current render%');

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

\o
select count(*) || ' checks passed' as result from _res where ok;
