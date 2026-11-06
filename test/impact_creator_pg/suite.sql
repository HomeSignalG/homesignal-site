-- Executable acceptance suite for creator-directed Impact Stories (docs/impact-stories.sql + docs/impact-discovery.sql).
-- :'script' is the founder's 14-scene EPA methane storyboard as the page parses it. Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', case when e is null then '' else json_build_object('email', e)::text end, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create temp table _ids (k text primary key, v text);
create function pg_temp.id(k text) returns uuid language sql as $$ select v::uuid from _ids where _ids.k = id.k $$;
create function pg_temp.v(k text) returns text language sql as $$ select v from _ids where _ids.k = v.k $$;
create function pg_temp.put(k text, v text) returns void language sql as $$ insert into _ids values (k, v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.lastjob(s uuid) returns public.impact_story_jobs language sql as $$
  select * from public.impact_story_jobs where story_id = s order by created_at desc, attempts desc limit 1 $$;
create function pg_temp.work(s uuid, res jsonb) returns jsonb language plpgsql as $$ declare j uuid := (pg_temp.lastjob(s)).id; begin
  if not (public.hs_impact_story_job_claim(j)->>'claimed')::boolean then raise exception 'not claimable'; end if;
  return public.hs_impact_story_job_complete(j, res); end $$;
create temp table _script as select (:'script')::jsonb j;
create function pg_temp.script() returns jsonb language sql as $$ select j from _script $$;
create function pg_temp.scene_set(p jsonb, n int, k text, v jsonb) returns jsonb language sql as $$
  select jsonb_set(p, array['scenes', (n - 1)::text, k], v) $$;
-- the engine's answer for one version of the script: its fact-check flags (impact/creator.py check())
create function pg_temp.validation(h text, flags jsonb) returns jsonb language sql as $$
  select jsonb_build_object('pack_hash', 'h1', 'narrative', jsonb_build_object('ok', true, 'blocking', '[]'::jsonb, 'warnings', '[]'::jsonb),
    'creator', jsonb_build_object('mode', 'creator', 'script_hash', h, 'ok', true, 'blocking', '[]'::jsonb, 'flags', flags,
      'items', '[]'::jsonb, 'timing', '[]'::jsonb, 'arc', '[]'::jsonb, 'scenes', '[]'::jsonb)) $$;
create function pg_temp.body(script jsonb) returns jsonb language sql as $$
  select jsonb_build_object('schema', 'impact-story/3', 'arc', '{"fear":{}}'::jsonb, 'outline', '[{"act":1}]'::jsonb,
    'main', '{"acts":[]}'::jsonb, 'creator_script', script,
    'creator_review', jsonb_build_object('script_hash', public._hs_is_creator_hash(script), 'items', '[]'::jsonb)) $$;
-- one high-risk flag (scene 3's claim about children's breathing) and one low-risk flag (scene 1's "twenty-four")
create function pg_temp.flags() returns jsonb language sql as $$ select jsonb_build_array(
  jsonb_build_object('key', md5('high-3'), 'id', 'f3', 'scene', 3, 'field', 'narration', 'risk', 'high', 'verdict', 'unsupported',
    'label', 'Unsupported', 'sentence', 'Children breathe more air per pound of body weight than adults.',
    'concern', 'No record in the pack says this.', 'suggestion', 'The EPA''s children''s health policy exists because children can be more exposed.'),
  jsonb_build_object('key', md5('low-1'), 'id', 'f1', 'scene', 1, 'field', 'narration', 'risk', 'low', 'verdict', 'needs_context',
    'label', 'Needs context', 'sentence', 'Seventy-two hours.', 'concern', 'Only in certain malfunction, safety or maintenance situations.',
    'suggestion', 'Seventy-two hours, in certain situations.')) $$;

-- 1. the contract and its version ------------------------------------------------------------------------
select pg_temp.chk('1a the page-parsed 14-scene storyboard passes the contract', cardinality(public._hs_is_creator_problems(pg_temp.script())) = 0
  and jsonb_array_length(pg_temp.script()->'scenes') = 14);
select pg_temp.chk('1b the database names the version exactly as the engine does (impact/creator.py, tests/test_impact_creator.py)',
  public._hs_is_creator_hash(pg_temp.script()) = '0a716a897032f76f8f00d3e44b93dada');
select pg_temp.chk('1c a visual or audio direction is not a locked word; narration is',
  public._hs_is_creator_hash(pg_temp.scene_set(pg_temp.script(), 2, 'visual', '"Another shot"')) = '0a716a897032f76f8f00d3e44b93dada'
  and public._hs_is_creator_hash(pg_temp.scene_set(pg_temp.script(), 2, 'narration', '"Changed."')) <> '0a716a897032f76f8f00d3e44b93dada');
select pg_temp.chk('1d each refusal is named',
  array_to_string(public._hs_is_creator_problems(pg_temp.scene_set(pg_temp.script(), 2, 'stage', '"joy"')), ';') like '%emotional stage%'
  and array_to_string(public._hs_is_creator_problems(pg_temp.scene_set(pg_temp.script(), 2, 'narration', '""')), ';') like '%no narration%'
  and array_to_string(public._hs_is_creator_problems(pg_temp.scene_set(pg_temp.script(), 2, 'n', '7')), ';') like '%numbered%'
  and array_to_string(public._hs_is_creator_problems(pg_temp.scene_set(pg_temp.script(), 2, 'narration', '" padded"')), ';') like '%clean form%'
  and array_to_string(public._hs_is_creator_problems(pg_temp.scene_set(pg_temp.script(), 2, 'sources', '["ftp://x"]')), ';') like '%not a web link%'
  and array_to_string(public._hs_is_creator_problems(pg_temp.scene_set(pg_temp.script(), 2, 'stage', '"custom"')), ';') like '%name the custom stage%'
  and array_to_string(public._hs_is_creator_problems(jsonb_set(pg_temp.script(), '{scenes}',
        (select jsonb_agg(jsonb_set(pg_temp.script()->'scenes'->0, '{n}', to_jsonb(g))) from generate_series(1, 61) g))), ';') like '%at most 60 scenes%');
select pg_temp.chk('1e a long script (25 scenes, over the old 12,000-character limit) is accepted',
  cardinality(public._hs_is_creator_problems(jsonb_set(pg_temp.script(), '{scenes}',
    (select jsonb_agg(jsonb_set(jsonb_set(pg_temp.script()->'scenes'->0, '{n}', to_jsonb(g)), '{narration}', to_jsonb(repeat('Word ', 120) || 'end.')))
       from generate_series(1, 25) g)))) = 0);

-- 2. Suggest a topic: the two modes -----------------------------------------------------------------------
select pg_temp.as_user('founder@example.com');
select pg_temp.put('j1', public.hs_impact_discovery_suggest('{"title":"A topic JODY writes","category":"other"}')->>'id');
select pg_temp.chk('2a "Let JODY write the story" is unchanged: no script, mode jody',
  (select creation_mode = 'jody' and creator_script is null from public.impact_discovery_candidates where id = pg_temp.id('j1')));
select pg_temp.put('c1', public.hs_impact_discovery_suggest(jsonb_build_object('title', 'EPA methane flaring rule', 'category', 'other',
  'mode', 'creator', 'creator_script', pg_temp.script(), 'links', jsonb_build_array('https://www.federalregister.gov/x')))->>'id');
select pg_temp.chk('2b "I will provide the script" stores the whole script and its version, as a draft (nothing started)',
  (select creation_mode = 'creator' and creator_script = pg_temp.script() and creator_script_hash = '0a716a897032f76f8f00d3e44b93dada'
     and status = 'nominated' from public.impact_discovery_candidates where id = pg_temp.id('c1'))
  and not exists (select 1 from public.impact_discovery_research_runs where candidate_id = pg_temp.id('c1')));
select pg_temp.chk('2c a broken script is refused with its problems; nothing is stored',
  pg_temp.err(format('select public.hs_impact_discovery_suggest(%L)', jsonb_build_object('title', 'Broken script topic', 'mode', 'creator',
    'creator_script', pg_temp.scene_set(pg_temp.script(), 4, 'stage', '"joy"')))) like '%Scene 4: the emotional stage%'
  and not exists (select 1 from public.impact_discovery_candidates where title = 'Broken script topic'));
select pg_temp.chk('2d a script sent with "Let JODY write" is refused rather than silently dropped',
  pg_temp.err(format('select public.hs_impact_discovery_suggest(%L)', jsonb_build_object('title', 'Mixed mode topic', 'mode', 'jody',
    'creator_script', pg_temp.script()))) like '%I will provide the script%');
select pg_temp.chk('2e the overview shows the mode and the script',
  public.hs_impact_discovery_overview()->'candidates' @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('c1'),
    'creation_mode', 'creator', 'creator_script_hash', '0a716a897032f76f8f00d3e44b93dada')));

-- 3. Save Draft: editing the script before research -------------------------------------------------------
select pg_temp.chk('3a a stale page cannot overwrite the script',
  pg_temp.err(format('select public.hs_impact_discovery_creator_script_save(%L, %L, %L)', pg_temp.id('c1'),
    pg_temp.scene_set(pg_temp.script(), 14, 'headline', '"FOLLOW THE RULE"'), 'ffffffffffffffffffffffffffffffff')) like '40001%');
select pg_temp.put('h2', public.hs_impact_discovery_creator_script_save(pg_temp.id('c1'),
  pg_temp.scene_set(pg_temp.script(), 14, 'headline', '"FOLLOW THE RULE"'), '0a716a897032f76f8f00d3e44b93dada')->>'creator_script_hash');
select pg_temp.chk('3b a saved edit is a new version, logged',
  pg_temp.v('h2') <> '0a716a897032f76f8f00d3e44b93dada'
  and (select creator_script->'scenes'->13->>'headline' from public.impact_discovery_candidates where id = pg_temp.id('c1')) = 'FOLLOW THE RULE'
  and exists (select 1 from public.impact_discovery_events where candidate_id = pg_temp.id('c1') and kind = 'creator_script_saved'));
select public.hs_impact_discovery_creator_script_save(pg_temp.id('c1'), pg_temp.script(), pg_temp.v('h2'));
select pg_temp.put('ok3c', public.hs_impact_discovery_creator_script_save(pg_temp.id('j1'), pg_temp.script(), null)->>'ok');
select pg_temp.chk('3c a JODY-written topic of yours can be given a script (switching to creator mode)',
  pg_temp.v('ok3c')::boolean
  and (select creation_mode from public.impact_discovery_candidates where id = pg_temp.id('j1')) = 'creator');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('3d a non-admin cannot save a script; anon cannot execute it',
  pg_temp.err(format('select public.hs_impact_discovery_creator_script_save(%L, %L, null)', pg_temp.id('c1'), pg_temp.script())) like '42501%'
  and not has_function_privilege('anon', 'public.hs_impact_discovery_creator_script_save(uuid, jsonb, text)', 'execute'));
select pg_temp.as_user('founder@example.com');

-- 4. Research & Fact-Check: the run carries the script; the story keeps it ---------------------------------
select pg_temp.put('r1', public.hs_impact_discovery_research_start(pg_temp.id('c1'))->'research'->>'id');
select pg_temp.chk('4a while research works, the script cannot be changed',
  pg_temp.err(format('select public.hs_impact_discovery_creator_script_save(%L, %L, %L)', pg_temp.id('c1'),
    pg_temp.scene_set(pg_temp.script(), 1, 'headline', '"X"'), '0a716a897032f76f8f00d3e44b93dada')) like '%Research is working%');
select pg_temp.as_user(null);
create temp table _claim as select public.impact_discovery_research_claim(pg_temp.id('r1')) j;
select pg_temp.chk('4b the research job is handed the mode, the exact script and its version',
  (select j->'candidate'->>'creation_mode' from _claim) = 'creator'
  and (select j->'candidate'->'creator_script' from _claim) = pg_temp.script()
  and (select j->'candidate'->>'creator_script_hash' from _claim) = '0a716a897032f76f8f00d3e44b93dada');
select public.impact_discovery_research(pg_temp.id('c1'), '{"outcome":"verified","source_slug":"epa-methane-creator","evidence":{"sources":[{"url":"https://example.gov/a"}]}}');
select public.impact_discovery_research_complete(pg_temp.id('r1'), '{"status":"verified","summary":"Checked 9 records; 2 flags.","source_slug":"epa-methane-creator"}');
select pg_temp.put('st', (select story_id::text from public.impact_discovery_candidates where id = pg_temp.id('c1')));
select pg_temp.chk('4c the story is creator-directed and its script record starts with the founder''s original',
  (select creation_mode from public.impact_stories where id = pg_temp.id('st')) = 'creator'
  and (select count(*) = 1 and bool_and(kind = 'original' and script = pg_temp.script() and script_hash = '0a716a897032f76f8f00d3e44b93dada')
         from public.impact_story_creator_scripts where story_id = pg_temp.id('st')));
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('4e once the topic has a story, the topic''s script is no longer edited there',
  pg_temp.err(format('select public.hs_impact_discovery_creator_script_save(%L, %L, %L)', pg_temp.id('c1'),
    pg_temp.scene_set(pg_temp.script(), 1, 'headline', '"X"'), '0a716a897032f76f8f00d3e44b93dada')) like '%already has a story%');
select pg_temp.as_user(null);
select pg_temp.work(pg_temp.id('st'), jsonb_build_object('pack', jsonb_build_object('hash', 'h1', 'title', 'EPA', 'verified_at', now(),
  'fresh_days', 30, 'claims', '[{"id":"c1"}]'::jsonb)));
-- the analyze job serves the whole locked story, with the engine's flags
select public._hs_is_queue(pg_temp.id('st'), 'analyze', '{"scope":"all"}'::jsonb, 'worker');
select pg_temp.work(pg_temp.id('st'), jsonb_build_object('body', pg_temp.body(pg_temp.script()),
  'derived', jsonb_build_object('validation', pg_temp.validation('0a716a897032f76f8f00d3e44b93dada', pg_temp.flags()))));
select pg_temp.as_user('founder@example.com');

-- 5. flags: high-risk blocks, low-risk needs a decision --------------------------------------------------
select pg_temp.chk('5a the story reports the script, its flags and why it cannot be approved yet',
  (public.hs_impact_story_get(pg_temp.id('st'))->'creator'->>'mode') = 'creator'
  and (public.hs_impact_story_get(pg_temp.id('st'))->'creator'->>'high')::int = 1
  and (public.hs_impact_story_get(pg_temp.id('st'))->'creator'->>'low_open')::int = 1
  and public.hs_impact_story_get(pg_temp.id('st'))->'creator'->>'why' like '%high-risk problem%');
select pg_temp.chk('5b Approve & Lock is refused while a high-risk flag is open, even when every other check passes',
  public._hs_is_artifact_state(pg_temp.id('st'), 'narrative')->>'state' = 'blocked'
  and pg_temp.err(format('select public.hs_impact_story_decide(%L, %L, %L, 1)', pg_temp.id('st'), 'narrative', 'approved')) like '%high-risk%');
select pg_temp.chk('5c the status names the founder''s next step', public._hs_is_status(pg_temp.id('st'))->>'next' = 'Review the flags on your script');
select pg_temp.chk('5d a high-risk problem cannot be kept',
  pg_temp.err(format('select public.hs_impact_story_creator_flag_decide(%L, 1, %L, %L)', pg_temp.id('st'), md5('high-3'), 'keep')) like '%cannot be kept%');
select public.hs_impact_story_creator_flag_decide(pg_temp.id('st'), 1, md5('low-1'), 'keep', 'The 72-hour figure is the headline; context follows in scene 2.');
select pg_temp.chk('5e a low-risk flag can be kept with the founder''s reason, recorded for this version only',
  (select decision = 'keep' and script_hash = '0a716a897032f76f8f00d3e44b93dada' from public.impact_story_creator_flag_decisions
    where story_id = pg_temp.id('st') and flag_key = md5('low-1'))
  and (public._hs_is_creator_state(pg_temp.id('st'))->>'low_open')::int = 0);
select pg_temp.chk('5f an unknown flag is refused',
  pg_temp.err(format('select public.hs_impact_story_creator_flag_decide(%L, 1, %L, %L)', pg_temp.id('st'), md5('nope'), 'keep')) like 'P0002%');
select pg_temp.chk('5g a stale page cannot decide', pg_temp.err(format('select public.hs_impact_story_creator_flag_decide(%L, 0, %L, %L)',
  pg_temp.id('st'), md5('low-1'), 'keep')) like '40001%');

-- 6. accepting a suggestion makes a revision; the locked script is untouched until it is applied -------------
select public.hs_impact_story_creator_flag_decide(pg_temp.id('st'), 1, md5('high-3'), 'accept');
select pg_temp.put('rev1', (public._hs_is_creator_state(pg_temp.id('st'))->'pending'->>'id'));
select pg_temp.chk('6a the suggestion replaced exactly that sentence in a new, proposed revision',
  (select script->'scenes'->2->>'narration' from public.impact_story_creator_scripts where id = pg_temp.v('rev1')::bigint)
    = 'Families living near well pads breathe what a flare does not burn. The EPA''s children''s health policy exists because children can be more exposed.'
  and (select source = 'accept_suggestion' and based_on = '0a716a897032f76f8f00d3e44b93dada' from public.impact_story_creator_scripts where id = pg_temp.v('rev1')::bigint)
  and public._hs_is_creator_state(pg_temp.id('st'))->'pending'->>'status' = 'proposed');
select pg_temp.chk('6b the story''s locked script and the topic''s original are unchanged (nothing is silently rewritten)',
  (select body->'creator_script' from public.impact_story_versions where story_id = pg_temp.id('st') and version = 1) = pg_temp.script()
  and public._hs_is_creator_state(pg_temp.id('st'))->>'current_hash' = '0a716a897032f76f8f00d3e44b93dada');
select pg_temp.chk('6c the flag shows it is in the revision; approval waits for the revision to be sent',
  (select (f->>'in_revision')::boolean from jsonb_array_elements(public._hs_is_creator_state(pg_temp.id('st'))->'flags') f where f->>'key' = md5('high-3'))
  and public._hs_is_artifact_state(pg_temp.id('st'), 'narrative')->>'why' like '%Send it with Fix%'
  and public._hs_is_status(pg_temp.id('st'))->>'next' = 'Send your revised script with Fix');
select pg_temp.chk('6d accepting the same suggestion again is refused (the sentence is gone from the revision)',
  pg_temp.err(format('select public.hs_impact_story_creator_flag_decide(%L, 1, %L, %L)', pg_temp.id('st'), md5('high-3'), 'accept')) like '%exactly once%');
select pg_temp.put('e6', public.hs_impact_story_creator_revise(pg_temp.id('st'), 1,
     pg_temp.scene_set((select script from public.impact_story_creator_scripts where id = pg_temp.v('rev1')::bigint), 7, 'headline', '"$45 BILLION (EPA ESTIMATE)"'),
     'Clarified the figure.')->>'id');
select pg_temp.chk('6e the founder''s own edit on top of the revision replaces it as the one waiting',
  pg_temp.v('e6') is not null
  and public._hs_is_creator_state(pg_temp.id('st'))->'pending'->>'source' = 'edit'
  and (select count(*) from jsonb_array_elements(public._hs_is_creator_state(pg_temp.id('st'))->'revisions') r where r->>'status' = 'superseded') = 1
  and (select count(*) from jsonb_array_elements(public._hs_is_creator_state(pg_temp.id('st'))->'revisions') r where r->>'status' = 'current' and r->>'kind' = 'original') = 1);
select pg_temp.put('rev2', (public._hs_is_creator_state(pg_temp.id('st'))->'pending'->>'id'));
select pg_temp.chk('6f a revision identical to the current script is refused',
  pg_temp.err(format('select public.hs_impact_story_creator_revise(%L, 1, %L)', pg_temp.id('st'), pg_temp.script())) like '%script the story has now%');
select pg_temp.chk('6g a broken revision is refused with its problem',
  pg_temp.err(format('select public.hs_impact_story_creator_revise(%L, 1, %L)', pg_temp.id('st'), pg_temp.scene_set(pg_temp.script(), 5, 'narration', '""'))) like '%Scene 5 has no narration%');
select pg_temp.chk('6h the founder''s own words cannot be changed with a line note (they are changed as a versioned revision)',
  pg_temp.err(format('select public.hs_impact_story_line_note(%L, %L, %L, %L)', pg_temp.id('st'), 'main.acts.0.scenes.0.narration.0', 'x', 'shorten')) like '%locked%'
  and pg_temp.err(format('select public.hs_impact_story_line_note(%L, %L, %L, %L)', pg_temp.id('st'), 'main.acts.0.scenes.0.onscreen', 'x', 'shorten')) like '%locked%'
  and pg_temp.err(format('select public.hs_impact_story_line_note(%L, %L, %L, %L)', pg_temp.id('st'), 'packaging.titles.0', 'x', 'shorter title')) is null);

-- 7. Fix sends the revision; the engine applies it word for word ------------------------------------------
select pg_temp.chk('7a Fix carries the waiting revision as a creator_script request with the exact script and version',
  exists (select 1 from jsonb_array_elements(public._hs_is_fix_eligible(pg_temp.id('st'))) r
           where r->>'kind' = 'creator_script' and (r->>'id')::bigint = pg_temp.v('rev2')::bigint
             and r->'script' = (select script from public.impact_story_creator_scripts where id = pg_temp.v('rev2')::bigint)
             and r->>'script_hash' = (select script_hash from public.impact_story_creator_scripts where id = pg_temp.v('rev2')::bigint)));
select public.hs_impact_story_fix_start(pg_temp.id('st'));
select pg_temp.chk('7b once sent, the revision is "sending": a second revision and withdrawing it are refused',
  public._hs_is_creator_state(pg_temp.id('st'))->'pending'->>'status' = 'sending'
  and pg_temp.err(format('select public.hs_impact_story_creator_revise(%L, 1, %L)', pg_temp.id('st'), pg_temp.scene_set(pg_temp.script(), 1, 'headline', '"Y"'))) like '%being applied%'
  and pg_temp.err(format('select public.hs_impact_story_creator_revision_withdraw(%L, %s)', pg_temp.id('st'), pg_temp.v('rev2'))) like '%not sent%'
  and public._hs_is_status(pg_temp.id('st'))->>'owner' = 'working');
select pg_temp.as_user(null);
select public.impact_fix_batch_claim((select id from public.impact_story_fix_batches where story_id = pg_temp.id('st')));
select public.impact_fix_batch_plan((select id from public.impact_story_fix_batches where story_id = pg_temp.id('st')),
  jsonb_build_object('summary', 'Apply your revised script and redo the fact-check.', 'items', (select jsonb_agg(jsonb_build_object(
    'decision_id', (r->>'id')::bigint, 'understood', 'Your request.', 'changes', jsonb_build_array('Change as asked.')))
    from public.impact_story_fix_batches b, jsonb_array_elements(b.requests) r where b.story_id = pg_temp.id('st'))));
select pg_temp.as_user('founder@example.com');
select public.hs_impact_story_fix_confirm(pg_temp.id('st'), (select id from public.impact_story_fix_batches where story_id = pg_temp.id('st')),
  (select plan_md5 from public.impact_story_fix_batches where story_id = pg_temp.id('st')));
select pg_temp.as_user(null);
select public.impact_fix_batch_claim((select id from public.impact_story_fix_batches where story_id = pg_temp.id('st')));
select public.impact_fix_batch_complete((select id from public.impact_story_fix_batches where story_id = pg_temp.id('st')),
  jsonb_build_object('status', 'done', 'summary', 'Applied your script.', 'regenerate', 'analyze',
    'outcomes', (select jsonb_agg(jsonb_build_object('decision_id', (r->>'id')::bigint, 'outcome', 'fixed', 'note', 'Applied word for word.'))
      from public.impact_story_fix_batches b, jsonb_array_elements(b.requests) r where b.story_id = pg_temp.id('st'))));
select pg_temp.chk('7c after the fixer finished and before the new version, the revision is "applying"',
  public._hs_is_creator_state(pg_temp.id('st'))->'pending'->>'status' = 'applying'
  and (pg_temp.lastjob(pg_temp.id('st'))).kind = 'analyze');
-- the engine's new version: the revised script, a clean fact-check
select pg_temp.work(pg_temp.id('st'), jsonb_build_object('body',
  pg_temp.body((select script from public.impact_story_creator_scripts where id = pg_temp.v('rev2')::bigint)),
  'derived', jsonb_build_object('validation', pg_temp.validation((select script_hash from public.impact_story_creator_scripts where id = pg_temp.v('rev2')::bigint), '[]'::jsonb))));
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('7d the revision is now the current, locked script; the original stays in the history',
  public._hs_is_creator_state(pg_temp.id('st'))->>'current_hash' = (select script_hash from public.impact_story_creator_scripts where id = pg_temp.v('rev2')::bigint)
  and public._hs_is_creator_state(pg_temp.id('st'))->>'pending' is null
  and exists (select 1 from jsonb_array_elements(public._hs_is_creator_state(pg_temp.id('st'))->'revisions') r where r->>'kind' = 'original' and r->>'status' = 'superseded'));
select pg_temp.chk('7e a decision on the old version does not carry over to the new one',
  not exists (select 1 from public.impact_story_creator_flag_decisions d where d.script_hash = public._hs_is_creator_state(pg_temp.id('st'))->>'current_hash'));

-- 8. Approve & Lock ---------------------------------------------------------------------------------------
select pg_temp.chk('8a with every flag resolved, Approve & Lock is offered', (public._hs_is_creator_state(pg_temp.id('st'))->>'ok')::boolean
  and public._hs_is_artifact_state(pg_temp.id('st'), 'narrative')->>'state' = 'pending'
  and public._hs_is_status(pg_temp.id('st'))->>'next' = 'Approve & lock your script');
select public.hs_impact_story_decide(pg_temp.id('st'), 'narrative', 'approved', 2);
select pg_temp.chk('8b the approval covers the script: its hash includes creator_script and creator_review',
  public._hs_is_artifact_state(pg_temp.id('st'), 'narrative')->>'state' = 'approved'
  and public._hs_is_artifact((select body from public.impact_story_versions where story_id = pg_temp.id('st') and version = 2), 'narrative') ? 'creator_script'
  and public._hs_is_artifact((select body from public.impact_story_versions where story_id = pg_temp.id('st') and version = 2), 'narrative') ? 'creator_review');
select pg_temp.chk('8c a JODY-written body hashes exactly as before (no creator keys are added)',
  not (public._hs_is_artifact('{"arc":{},"main":{}}'::jsonb, 'narrative') ? 'creator_script')
  and public._hs_is_hash('{"arc":{},"main":{}}'::jsonb, 'narrative') = md5(jsonb_build_object('arc', '{}'::jsonb, 'outline', null, 'main', '{}'::jsonb,
        'qol', null, 'shorts', null, 'packaging', null)::text));
select pg_temp.put('e8', public.hs_impact_story_creator_revise(pg_temp.id('st'), 2, pg_temp.script(), 'Back to my first wording.')->>'id');
select pg_temp.chk('8d proposing a new revision after approval holds the approval until the revision is applied or withdrawn',
  pg_temp.v('e8') is not null
  and public._hs_is_artifact_state(pg_temp.id('st'), 'narrative')->>'state' = 'blocked');
select pg_temp.put('rev3', (public._hs_is_creator_state(pg_temp.id('st'))->'pending'->>'id'));
select public.hs_impact_story_creator_revision_withdraw(pg_temp.id('st'), pg_temp.v('rev3')::bigint);
select pg_temp.chk('8e withdrawing the unsent revision restores the approval (the locked script never moved)',
  public._hs_is_creator_state(pg_temp.id('st'))->>'pending' is null
  and public._hs_is_artifact_state(pg_temp.id('st'), 'narrative')->>'state' = 'approved');
select pg_temp.chk('8f the render job names the locked script version',
  position('creator_script_hash' in pg_get_functiondef('public.hs_impact_story_render(uuid,integer,boolean)'::regprocedure)) > 0);

-- 9. integrity and access -----------------------------------------------------------------------------------
select pg_temp.chk('9a script records and flag decisions are append-only',
  pg_temp.err(format('update public.impact_story_creator_scripts set note = %L where story_id = %L', 'x', pg_temp.id('st'))) like '42501%'
  and pg_temp.err(format('delete from public.impact_story_creator_flag_decisions where story_id = %L', pg_temp.id('st'))) like '42501%');
select pg_temp.chk('9b a JODY-written story has no creator state and no creator functions apply',
  public._hs_is_creator_state((select id from public.impact_stories where creation_mode = 'jody' limit 1)) is null
  or public._hs_is_creator_state(gen_random_uuid())->>'mode' = 'jody');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('9c non-admins cannot revise, decide or withdraw; anon cannot execute; helpers are internal',
  pg_temp.err(format('select public.hs_impact_story_creator_revise(%L, 2, %L)', pg_temp.id('st'), pg_temp.script())) like '42501%'
  and pg_temp.err(format('select public.hs_impact_story_creator_flag_decide(%L, 2, %L, %L)', pg_temp.id('st'), md5('x'), 'keep')) like '42501%'
  and not has_function_privilege('anon', 'public.hs_impact_story_creator_revise(uuid, integer, jsonb, text)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_impact_story_creator_flag_decide(uuid, integer, text, text, text)', 'execute')
  and not has_function_privilege('authenticated', 'public._hs_is_creator_state(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public._hs_is_creator_problems(jsonb)', 'execute'));
select pg_temp.chk('9d the new tables are RLS-on with no browser grants',
  (select bool_and(relrowsecurity) from pg_class where relname in ('impact_story_creator_scripts', 'impact_story_creator_flag_decisions'))
  and not has_table_privilege('authenticated', 'public.impact_story_creator_scripts', 'select'));

\o
select count(*) || ' checks passed' as result from _res where ok;
