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
create function pg_temp.ok_val(a boolean, m boolean, sa boolean, sb boolean, pk boolean, ph text) returns jsonb language sql as $$
  select jsonb_build_object('pack', jsonb_build_object('ok', true, 'blocking', '[]'::jsonb),
    'angles', jsonb_build_object('motivation', jsonb_build_object('ok', a, 'blocking', case when a then '[]'::jsonb else '["Angle motivation: no counterweight."]'::jsonb end),
                                 'anger', jsonb_build_object('ok', false, 'blocking', '["An ANGER angle must rest on a documented decision."]'::jsonb)),
    'angle', jsonb_build_object('ok', false, 'blocking', '["No angle is selected."]'::jsonb),
    'main', jsonb_build_object('ok', m, 'blocking', case when m then '[]'::jsonb else '["Act 3 line 1: the number 4 is not in any cited claim."]'::jsonb end),
    'short_a', jsonb_build_object('ok', sa, 'blocking', '[]'::jsonb), 'short_b', jsonb_build_object('ok', sb, 'blocking', '[]'::jsonb),
    'packaging', jsonb_build_object('ok', pk, 'blocking', '[]'::jsonb), 'pack_hash', ph) $$;
create function pg_temp.pack(h text, verified timestamptz, nclaims int default 2) returns jsonb language sql as $$
  select jsonb_build_object('hash', h, 'title', 'Gig Harbor dock', 'verified_at', verified, 'fresh_days', 30,
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', 'c' || g)), '[]') from generate_series(1, nclaims) g)) $$;
create function pg_temp.body(sel text, packaging_text text default 'Who gets the dock?', with_main boolean default true) returns jsonb language sql as $$
  select jsonb_build_object('schema', 'impact-story/1', 'selected_angle', sel,
    'angles', '[{"id":"motivation","emotion":"MOTIVATION","stake":{"text":"x","claims":["c1"]}},{"id":"anger","emotion":"ANGER"}]'::jsonb)
  || case when with_main then jsonb_build_object('main', '{"acts":[{"act":1}]}'::jsonb, 'qol', '[{"topic":"Traffic"}]'::jsonb,
    'shorts', '{"a":{"question":"Who?"},"b":{"question":"When?"}}'::jsonb, 'packaging', jsonb_build_object('thumbnail', jsonb_build_object('text', packaging_text)))
    else '{}'::jsonb end $$;

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
select pg_temp.chk('3c stage moves to angles', public._hs_is_status(pg_temp.id('s')::uuid)->>'stage' = 'angles');
select pg_temp.chk('3d generate before an angle is refused', pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'generate')) like '%Approve an angle%');

-- 4. analyze -> angle cards -> select -> approve angle ----------------------------------------------
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'analyze');
select pg_temp.chk('4a analyze is a job receipt, not a result', pg_temp.cur() = 0 and (pg_temp.lastjob()).status = 'queued');
select pg_temp.work(jsonb_build_object('body', pg_temp.body(null, with_main => false), 'derived', jsonb_build_object('validation', pg_temp.ok_val(true, false, false, false, false, 'P1'))));
select pg_temp.chk('4b analyze result is version 1', pg_temp.cur() = 1);
select pg_temp.chk('4c an unsupported ANGER card cannot be selected and approved',
   pg_temp.err(format('select public.hs_impact_story_angle(%L, 1, %L, %L)', pg_temp.id('s'), 'anger', 'select')) is null
   and pg_temp.st('angle') = 'blocked'
   and pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 2)', pg_temp.id('s'), 'angle', 'approved')) like '%documented decision%');
select public.hs_impact_story_angle(pg_temp.id('s')::uuid, 2, 'anger', 'reject');
select public.hs_impact_story_angle(pg_temp.id('s')::uuid, 3, 'motivation', 'select');
select pg_temp.chk('4d selecting carries the card checks: approvable at once', pg_temp.cur() = 4 and pg_temp.st('angle') = 'pending');
select pg_temp.chk('4e rejection is recorded on the version', (select body->'angle_rejections' from public.impact_story_versions where story_id = pg_temp.id('s')::uuid and version = 4) = '["anger"]');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'angle', 'approved', 4);
select pg_temp.chk('4f angle approved', pg_temp.st('angle') = 'approved');
select pg_temp.chk('4g script approvals need a script first', pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 4)', pg_temp.id('s'), 'main', 'approved')) is not null);

-- 5. generate -> per-artifact approvals ----------------------------------------------------------------
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'generate');
select pg_temp.work(jsonb_build_object('body', pg_temp.body('motivation'), 'derived', jsonb_build_object('validation', pg_temp.ok_val(true, false, true, true, true, 'P1') || '{"angle":{"ok":true,"blocking":[]}}')));
select pg_temp.chk('5a generated version 5; the angle approval survives (card unchanged)', pg_temp.cur() = 5 and pg_temp.st('angle') = 'approved');
select pg_temp.chk('5b a blocked main script cannot be approved, and says why', pg_temp.st('main') = 'blocked'
   and pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 5)', pg_temp.id('s'), 'main', 'approved')) like '%number 4%');
select pg_temp.chk('5c reject needs a note', pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 5)', pg_temp.id('s'), 'short_a', 'rejected')) like '%Say what to change%');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'short_a', 'rejected', 5, 'Lead with the date.', 'hook line 1');
select pg_temp.chk('5d rejection is tied to its line', pg_temp.st('short_a') = 'rejected' and (select target from public.impact_story_approvals order by id desc limit 1) = 'hook line 1');
-- the founder fixes the script; re-check passes
select public.hs_impact_story_save(pg_temp.id('s')::uuid, 5, pg_temp.body('motivation') || '{"main":{"acts":[{"act":1},{"act":2}]}}');
select pg_temp.chk('5e save creates version 6 and queues a re-check', pg_temp.cur() = 6 and (pg_temp.lastjob()).kind = 'validate');
select pg_temp.chk('5f until the re-check, nothing new is approvable', pg_temp.st('main') = 'checking');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, true, true, true, true, 'P1') || '{"angle":{"ok":true,"blocking":[]}}')));
select pg_temp.chk('5g re-check attaches to version 6 (no new version)', pg_temp.cur() = 6 and pg_temp.st('main') = 'pending');
select pg_temp.chk('5h the earlier rejection still applies to the unchanged Short A', pg_temp.st('short_a') = 'rejected');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, a, 'approved', 6) from unnest(array['main','short_a','short_b','packaging']) a;
select pg_temp.chk('5i all approved: ready to render', public._hs_is_status(pg_temp.id('s')::uuid)->>'stage' = 'media'
   and public._hs_is_status(pg_temp.id('s')::uuid)->>'library' = 'ready');
select pg_temp.chk('5j approving twice records nothing new', (select (public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'main', 'approved', 6))->>'unchanged') = 'true'
   and (select count(*) from public.impact_story_approvals where artifact = 'main' and decision = 'approved') = 1);

-- 6. targeted invalidation ------------------------------------------------------------------------------
select public.hs_impact_story_save(pg_temp.id('s')::uuid, 6, pg_temp.body('motivation', 'Who is the dock for?') || '{"main":{"acts":[{"act":1},{"act":2}]}}');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, true, true, true, true, 'P1') || '{"angle":{"ok":true,"blocking":[]}}')));
select pg_temp.chk('6a a thumbnail-only edit invalidates packaging only', pg_temp.st('packaging') = 'pending'
   and pg_temp.st('main') = 'approved' and pg_temp.st('short_a') = 'approved' and pg_temp.st('short_b') = 'approved' and pg_temp.st('angle') = 'approved');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'packaging', 'approved', 7);
-- revoke blocks
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'main', 'revoked', 7, 'Check the hearing date again.');
select pg_temp.chk('6b a revoked approval blocks readiness', pg_temp.st('main') = 'revoked' and public._hs_is_status(pg_temp.id('s')::uuid)->>'stage' = 'script');
select public.hs_impact_story_decide(pg_temp.id('s')::uuid, 'main', 'approved', 7);
select pg_temp.chk('6c re-approval is a new row; history kept', (select count(*) from public.impact_story_approvals where artifact = 'main') = 3);

-- 7. optimistic lock, superseded results ---------------------------------------------------------------
select pg_temp.chk('7a a stale editor cannot overwrite', pg_temp.err(format('select public.hs_impact_story_save(%L, 5, %L::jsonb)', pg_temp.id('s'), pg_temp.body('motivation'))) like '40001%');
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'generate', 'short_b');
insert into _ids select 'g', (pg_temp.lastjob()).id::text;
select public.hs_impact_story_job_claim(pg_temp.id('g')::uuid);
select pg_temp.chk('7b only one job at a time per story', pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'pack')) like '%already running%');
-- the founder saves while the AI runs: the save lands, its check waits for the running job
select pg_temp.chk('7c a save during a running job still lands', (public.hs_impact_story_save(pg_temp.id('s')::uuid, 7, pg_temp.body('motivation', 'Who is the dock for?') || '{"main":{"acts":[{"act":1},{"act":2}]},"notes":"draft"}'))->'job'->>'status' = 'waiting');
select pg_temp.chk('7d ...as version 8', pg_temp.cur() = 8);
create temp table _r7 as select public.hs_impact_story_job_complete(pg_temp.id('g')::uuid, jsonb_build_object('body', pg_temp.body('motivation'))) r;
select pg_temp.chk('7e a result on a replaced version is kept on the job, not applied', (select r->>'superseded' from _r7) = 'true'
   and pg_temp.cur() = 8 and (select status from public.impact_story_jobs where id = pg_temp.id('g')::uuid) = 'superseded');
select pg_temp.chk('7f the waiting check for version 8 starts once the job ends', (pg_temp.lastjob()).kind = 'validate' and (pg_temp.lastjob()).base_version = 8 and (pg_temp.lastjob()).status = 'queued');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, true, true, true, true, 'P1') || '{"angle":{"ok":true,"blocking":[]}}')));

-- 8. failure, retry, missing credential ---------------------------------------------------------------
select public.hs_impact_story_request(pg_temp.id('s')::uuid, 'validate', 'all', true);
select public.hs_impact_story_job_claim((pg_temp.lastjob()).id);
select public.hs_impact_story_job_fail((pg_temp.lastjob()).id, 'The AI drafting key is not configured on the worker.');
select pg_temp.chk('8a failure is readable', (pg_temp.lastjob()).status = 'failed' and (pg_temp.lastjob()).error like '%not configured%');
select pg_temp.chk('8b a running job cannot be retried', pg_temp.err(format('select public.hs_impact_story_job_retry(%L)', (select id from public.impact_story_jobs where status='complete' limit 1))) like '%not failed or stuck%');
select public.hs_impact_story_job_retry((pg_temp.lastjob()).id);
select pg_temp.chk('8c retry re-runs the SAME job', (pg_temp.lastjob()).status = 'queued' and (pg_temp.lastjob()).attempts = 2
   and (select count(*) from public.impact_story_jobs where kind = 'validate' and base_version = 8) = 2);
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, true, true, true, true, 'P1') || '{"angle":{"ok":true,"blocking":[]}}')));
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
select pg_temp.chk('9b approvals hold until checked against the new pack', pg_temp.st('main') = 'checking' and pg_temp.st('angle') = 'checking' and public._hs_is_status(pg_temp.id('s')::uuid)->>'stage' <> 'media');
select pg_temp.work(jsonb_build_object('derived', jsonb_build_object('validation', pg_temp.ok_val(true, true, true, true, true, 'P2') || '{"angle":{"ok":true,"blocking":[]}}')));
select pg_temp.chk('9c re-checked against the same text: approvals return', pg_temp.st('main') = 'approved' and public._hs_is_status(pg_temp.id('s')::uuid)->>'stage' = 'media');
update public.impact_stories set pack = jsonb_set(pack, '{verified_at}', to_jsonb(now() - interval '45 days')) where id = pg_temp.id('s')::uuid;
select pg_temp.chk('9d stale sources block everything and say so', pg_temp.st('main') = 'blocked'
   and public._hs_is_status(pg_temp.id('s')::uuid)->>'next' = 'Re-check sources'
   and pg_temp.err(format('select public.hs_impact_story_request(%L, %L)', pg_temp.id('s'), 'analyze')) like '%out of date%');
update public.impact_stories set pack = jsonb_set(pack, '{verified_at}', to_jsonb(now())) where id = pg_temp.id('s')::uuid;

-- 10. changing the angle invalidates everything written from it -----------------------------------------
select public.hs_impact_story_angle(pg_temp.id('s')::uuid, 8, 'anger', 'select');
select pg_temp.chk('10a new angle: main and angle approvals no longer apply', pg_temp.st('main') <> 'approved' and pg_temp.st('angle') <> 'approved');
select public.hs_impact_story_angle(pg_temp.id('s')::uuid, 9, 'motivation', 'select');
select pg_temp.chk('10b back to the approved angle: the approved text is approved again', pg_temp.st('angle') = 'approved' and pg_temp.st('main') = 'approved');

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
select pg_temp.chk('11f get returns history', jsonb_array_length(public.hs_impact_story_get(pg_temp.id('s')::uuid)->'versions') = 10
   and jsonb_array_length(public.hs_impact_story_get(pg_temp.id('s')::uuid)->'events') > 10);
select pg_temp.chk('11g Tab 16 table untouched', (select count(*) from public.youtube_video_reviews) = 1);

\o
select count(*) || ' checks passed' as result from _res where ok;
