-- The full weekly configuration (docs/weekly-1..7) on a DISPOSABLE database. Prints one "Wnn|true/false" line per check.
-- Everything here is TEST DATA; no line is real research.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return code is null or sqlstate = code; end $$;
grant execute on function pg_temp.raises(text, text) to anon, authenticated, service_role;
\set admin '{"email":"founder@test.invalid"}'
\set other '{"email":"someone@test.invalid"}'
\if :{?rls_tables}
\else
\set rls_tables 22
\endif

-- W01 no direct table/view access for anon or authenticated
select 'W01|' || not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'weekly\_%' and c.relkind in ('r', 'v')
    and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
         or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')));
select 'W01b|' || ((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'weekly\_%' and c.relkind = 'r' and c.relrowsecurity) = :rls_tables);   -- 1-7: 19 workbench tables + the topic queue's 3; 1-9 adds 3 (release_catalog.py names them)
-- W02 service functions: service_role yes, authenticated and anon no; admin functions: authenticated yes, anon no
select 'W02|' || (has_function_privilege('service_role', 'public.weekly_research_record(uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_research_record(uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_run_claim(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.weekly_script_record(uuid,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_weekly_paste_answer(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_paste_answer(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public._wk_dispatch(text,uuid)', 'execute'));

-- W03 a signed-in non-admin is refused
set role authenticated;
select set_config('test.jwt', :'other', false);
select 'W03|' || pg_temp.raises($q$select public.hs_weekly_request_research('Air Quality', 'TEST request text that is long enough')$q$, '42501');
-- admin: request + paste
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_request_research('Air Quality', 'TEST: research the October 2026 EPA oil-and-gas proposal (fixture)') as req \gset
select (public.hs_weekly_paste_answer(:'req', 'TEST DATA pasted answer') ->> 'run_id') as run1 \gset
select 'W04|' || pg_temp.raises($q$select public.hs_weekly_paste_answer($q$ || quote_literal(:'req') || $q$::uuid, 'again')$q$, '55006');
reset role;
-- W05 dispatch: one call, the right workflow, ref main, run id only
select 'W05|' || (select count(*) = 1 and bool_and(url like '%/workflows/weekly-research-ingest.yml/dispatches' and body ->> 'ref' = 'main'
  and body -> 'inputs' = jsonb_build_object('run', :'run1')) from net.calls);
select 'W05b|' || pg_temp.raises($q$select public._wk_dispatch('impact-story-render.yml', gen_random_uuid())$q$, null);

-- service: claim + record two sources and three findings
set role service_role;
select 'W06|' || ((public.weekly_run_claim(:'run1') -> 'answer' ->> 'raw_text') = 'TEST DATA pasted answer');
select 'W06b|' || pg_temp.raises($q$select public.weekly_run_claim($q$ || quote_literal(:'run1') || $q$::uuid)$q$, '55000');
select (public.weekly_research_record(:'run1', $j${
  "runner_seconds": 90,
  "sources": [
    {"ref": "s1", "url": "https://example.test/epa-proposal", "publisher": "TEST Agency", "title": "TEST proposal page",
     "quote": "TEST quoted sentence", "retrieved_at": "2026-11-10T12:00:00Z", "content_sha256": "aa", "quote_match": "exact",
     "date_extraction": "page_metadata", "published_date": "2026-10-20"},
    {"ref": "s2", "url": "https://example.test/analysis", "publisher": "TEST Analyst", "title": "TEST analysis",
     "quote": "TEST other sentence", "retrieved_at": "2026-11-10T12:00:01Z", "quote_match": "not_found", "date_extraction": "not_stated"}],
  "findings": [
    {"finding_key": "air-proposal-status", "statement": "TEST: the change is proposed, not final.", "qualifiers": ["proposed"], "source_refs": ["s1"]},
    {"finding_key": "air-estimate-scope", "statement": "TEST: the agency estimate is a multi-year figure.", "qualifiers": ["estimated"], "uncertainty": "TEST assumptions not reviewed", "source_refs": ["s1", "s2"]},
    {"finding_key": "air-rejected-one", "statement": "TEST: a finding the reviewer rejects.", "source_refs": ["s2"]}]}$j$::jsonb) ->> 'findings') as nf \gset
reset role;
select 'W07|' || (:'nf' = '3' and (select status from public.weekly_runs where id = :'run1') = 'done');
-- W08 an exact quote does not approve a finding; only a human decision does
select 'W08|' || (select bool_and(human_decision = 'pending') from public.weekly_finding_state);
select 'W08b|' || exists (select 1 from public.weekly_sources where quote_match = 'exact');
-- W09 append-only
select 'W09|' || (pg_temp.raises($q$update public.weekly_findings set statement = 'x'$q$, '55000')
  and pg_temp.raises($q$delete from public.weekly_sources$q$, '55000')
  and pg_temp.raises($q$update public.weekly_research_answers set raw_text = 'x'$q$, '55000'));
-- W10 three labels are separate and constrained: unknown date has no value; an unread page matched nothing
select 'W10|' || (pg_temp.raises($q$insert into public.weekly_sources (answer_id, url, quote_match, date_extraction, published_date)
    select id, 'https://e.test', 'exact', 'unknown', '2026-01-01' from public.weekly_research_answers limit 1$q$, '23514')
  and pg_temp.raises($q$insert into public.weekly_sources (answer_id, url, quote_match, date_extraction)
    select id, 'https://e.test', 'exact', 'page_metadata' from public.weekly_research_answers limit 1$q$, '23514')
  and pg_temp.raises($q$insert into public.weekly_sources (answer_id, url, quote_match, date_extraction, fetch_error)
    select id, 'https://e.test', 'exact', 'unknown', 'timeout' from public.weekly_research_answers limit 1$q$, '23514')
  and pg_temp.raises($q$insert into public.weekly_sources (answer_id, url, quote_match, date_extraction)
    select id, 'http://e.test', 'not_checked', 'unknown' from public.weekly_research_answers limit 1$q$, '23514'));
-- W11 a short quote is not cleared by default; permissions are separate
select 'W11|' || (select bool_and(publication_permission = 'to_confirm' and export_permission = 'record_only'
  and storage_permission = 'excerpt' and kind = 'third_party') from public.weekly_sources);

-- reviewer decisions + seal v1
set role authenticated;
select set_config('test.jwt', :'admin', false);
select f ->> 'id' as f_status from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'findings') f
  where f ->> 'finding_key' = 'air-proposal-status' \gset
select f ->> 'id' as f_scope from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'findings') f
  where f ->> 'finding_key' = 'air-estimate-scope' \gset
select f ->> 'id' as f_rej from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'findings') f
  where f ->> 'finding_key' = 'air-rejected-one' \gset
select public.hs_weekly_finding_decide(:'f_status', 'approved'), public.hs_weekly_finding_decide(:'f_scope', 'approved'),
       public.hs_weekly_finding_decide(:'f_rej', 'rejected');
select (public.hs_weekly_library_seal('Air Quality') ->> 'library_version_id') as lv1 \gset
-- W12 the overview carries the three results separately
select 'W12|' || (select bool_and(s ? 'quote_match' and s ? 'date_extraction' and f ? 'human_decision' and not (f ? 'verified'))
  from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'findings') f, jsonb_array_elements(f -> 'sources') s);
reset role;
-- W13 v1 holds exactly the two approved findings
select 'W13|' || ((select array_agg(finding_id order by finding_id) from public.weekly_library_version_findings where library_version_id = :'lv1')
  = (select array_agg(id order by id) from public.weekly_findings where id in (:'f_status', :'f_scope')));
-- W14 a sealed version takes no new rows, cannot be unsealed, is never deleted
select 'W14|' || (pg_temp.raises($q$insert into public.weekly_library_version_findings values ($q$ || quote_literal(:'lv1') || $q$, $q$ || quote_literal(:'f_rej') || $q$)$q$, '55000')
  and pg_temp.raises($q$update public.weekly_library_versions set sealed = false$q$, '55000')
  and pg_temp.raises($q$delete from public.weekly_library_versions$q$, '55000'));

-- profile: a writing request is refused until the profile is approved
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_profile_create($j$[
  "Explain unfamiliar terms in plain words.", "Explain the quality-of-life effect.", "Keep qualifications and uncertainty.",
  "Add no fact that the cited findings do not state.", "Never read citation markers aloud.",
  "Do not call the $45 billion a cash payment or annual savings.",
  "Do not attribute the entire figure to scrapping the Super Emitter Program.",
  "Do not say companies would have no remaining duty to fix leaks.",
  "Say \"company emissions detected by third parties\", not \"third-party leaks\".",
  "Attribute forecasts; distinguish proposed changes from final rules."]$j$::jsonb) as prof \gset
select 'W15|' || pg_temp.raises($q$select public.hs_weekly_angles_request($q$ || quote_literal(:'lv1') || $q$::uuid, $q$ || quote_literal(:'prof') || $q$::uuid)$q$, '22023');
select public.hs_weekly_profile_approve(:'prof');
select (public.hs_weekly_angles_request(:'lv1', :'prof') ->> 'run_id') as ra \gset
select 'W15b|' || pg_temp.raises($q$select public.hs_weekly_angles_request($q$ || quote_literal(:'lv1') || $q$::uuid, $q$ || quote_literal(:'prof') || $q$::uuid)$q$, '55006');
reset role;

-- ANGLES: three evidence-backed cards. They may share findings AND category; nothing requires them to differ.
\set card '{"claim":"TEST public claim","category":"contradiction","finding_ids":["air-proposal-status@1","air-estimate-scope@1"],"public_stakes":"TEST stakes","editorial_position":"TEST position","context":"TEST context","evidence_limits":"TEST limits","opening":"TEST opening","why_different":"TEST'
set role service_role;
select 'A01|' || ((public.weekly_run_claim(:'ra') ->> 'mode') = 'angles');
-- a card citing a finding that is not pinned, and a card with no findings, are refused
select 'A02|' || (pg_temp.raises($q$select public.weekly_script_record($q$ || quote_literal(:'ra') || $q$::uuid, jsonb_build_object('provider','claude-plan','prompt_sha256',repeat('a',64),'checks','{"ok":true}'::jsonb,
    'body', jsonb_build_object('angles', jsonb_build_array(
      '{"claim":"x","category":"contradiction","finding_ids":["air-not-pinned@1"]}'::jsonb, '{"claim":"y","finding_ids":["air-proposal-status@1"]}'::jsonb, '{"claim":"z","finding_ids":["air-proposal-status@1"]}'::jsonb))))$q$, '22023')
  and pg_temp.raises($q$select public.weekly_script_record($q$ || quote_literal(:'ra') || $q$::uuid, jsonb_build_object('provider','claude-plan','prompt_sha256',repeat('a',64),'checks','{"ok":true}'::jsonb,
    'body', jsonb_build_object('angles', jsonb_build_array('{"claim":"x","finding_ids":[]}'::jsonb, '{"claim":"y","finding_ids":["air-proposal-status@1"]}'::jsonb, '{"claim":"z","finding_ids":["air-proposal-status@1"]}'::jsonb))))$q$, '22023'));
select public.weekly_script_record(:'ra', jsonb_build_object('provider', 'claude-plan', 'model', 'test', 'prompt_sha256', repeat('3', 64),
  'checks', '{"ok": true, "label": "mechanical checks passed", "certifies_accuracy": false}'::jsonb,
  'body', jsonb_build_object('angles', jsonb_build_array(
    (:'card' || ' 1"}')::jsonb, (:'card' || ' 2"}')::jsonb,
    jsonb_set((:'card' || ' 3"}')::jsonb, '{category}', '"false_claim"'))))) as ang1 \gset
reset role;
select 'A03|' || (select stage = 'angles' and depends_on is null from public.weekly_scripts where id = :'ang1');

-- an outline cannot be requested before the angle set is approved with a selected card
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'A04|' || pg_temp.raises($q$select public.hs_weekly_outline_request($q$ || quote_literal(:'ang1') || $q$::uuid)$q$, '22023');
select 'A05|' || (pg_temp.raises($q$select public.hs_weekly_version_approve($q$ || quote_literal(:'ang1') || $q$::uuid)$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_version_approve($q$ || quote_literal(:'ang1') || $q$::uuid, 2)$q$, '22023'));
-- high-risk category: allowed only with an explicit acknowledgement; it is not selected here
select (public.hs_weekly_version_approve(:'ang1', 2, null, true) ->> 'approved') as hr_ok \gset
select (public.hs_weekly_version_approve(:'ang1', 0, null, false, 'TEST pick the first angle') ->> 'current') as ang_cur \gset
select 'A06|' || (:'hr_ok' = 'true' and :'ang_cur' = 'true');
select (public.hs_weekly_outline_request(:'ang1') ->> 'run_id') as ro \gset
reset role;
select 'A07|' || ((select input ->> 'selected_index' from public.weekly_runs where id = :'ro') = '0');
set role service_role;
select 'A08|' || ((public.weekly_run_claim(:'ro') -> 'angle' ->> 'why_different') = 'TEST 1');
select public.weekly_script_record(:'ro', jsonb_build_object('provider', 'claude-plan', 'model', 'test', 'prompt_sha256', repeat('4', 64),
  'checks', '{"ok": true, "label": "mechanical checks passed", "certifies_accuracy": false}'::jsonb,
  'body', '{"beats":[{"beat":"collision","purpose":"TEST","finding_ids":["air-proposal-status@1"]},{"beat":"mechanism","purpose":"TEST","finding_ids":["air-estimate-scope@1"]},{"beat":"landing","purpose":"TEST","finding_ids":[]}]}'::jsonb)) as out1 \gset
reset role;
select 'A09|' || (select stage = 'outline' and depends_on = :'ang1'::uuid and selected_index = 0 from public.weekly_scripts where id = :'out1');
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'A10|' || pg_temp.raises($q$select public.hs_weekly_script_request($q$ || quote_literal(:'out1') || $q$::uuid)$q$, '22023');
select public.hs_weekly_version_approve(:'out1');
select (public.hs_weekly_script_request(:'out1') ->> 'run_id') as run2 \gset
reset role;
select 'W16|' || ((select input -> 'lessons_retrieved' from public.weekly_runs where id = :'run2') = '[]'::jsonb);
-- draft 1 (fixture script that breaks the rule later made a lesson)
set role service_role;
select public.weekly_run_claim(:'run2') as claim2 \gset
select 'W17|' || (jsonb_array_length((:'claim2')::jsonb -> 'findings') = 2 and ((:'claim2')::jsonb -> 'outline' -> 'beats' -> 0 ->> 'beat') = 'collision'
  and ((:'claim2')::jsonb -> 'angle' ->> 'why_different') = 'TEST 1'
  and ((:'claim2')::jsonb -> 'findings' -> 0 -> 'quotes') is not null);
select 'W17b|' || pg_temp.raises($q$select public.weekly_script_record($q$ || quote_literal(:'run2') || $q$::uuid, jsonb_build_object(
  'provider', 'claude-plan', 'prompt_sha256', repeat('a', 64), 'body', '{"segments":[]}'::jsonb, 'checks', '{}'::jsonb,
  'lessons_included', jsonb_build_array(gen_random_uuid())))$q$, '22023');
select public.weekly_script_record(:'run2', $j${"provider": "claude-plan", "model": "test", "prompt_sha256": "1111111111111111111111111111111111111111111111111111111111111111",
  "body": {"segments": [{"story": "s", "text": "TEST: third-party leaks would no longer be reported.", "claim_ids": ["air-proposal-status@1"]}]},
  "checks": {"ok": true, "label": "mechanical checks passed", "certifies_accuracy": false}, "runner_seconds": 120}$j$::jsonb) as s1 \gset
reset role;

-- correction -> lesson -> approved. A LOCAL review never becomes a lesson.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_correction_save(:'s1', 0, 'TEST local fix only', 'TEST local') as corr_local \gset
select 'W17c|' || pg_temp.raises($q$select public.hs_weekly_lesson_propose($q$ || quote_literal(:'corr_local') || $q$::uuid, 'TEST lesson text')$q$, '22023');
select public.hs_weekly_correction_save(:'s1', 0, 'TEST: reports of company emissions detected by third parties would no longer reach EPA under the proposal.', null, 'reusable') as corr \gset
select public.hs_weekly_lesson_propose(:'corr', 'Say "company emissions detected by third parties", not "third-party leaks".',
  '{"type": "avoid_phrase", "value": "third-party leaks"}') as les \gset
select public.hs_weekly_lesson_decide(:'les', 'approved');
-- the first script is not approved; a second script from the same outline retrieves the lesson
select (public.hs_weekly_script_request(:'out1') ->> 'run_id') as run3 \gset
reset role;
select 'W18|' || ((select before_text from public.weekly_corrections where id = :'corr') = 'TEST: third-party leaks would no longer be reported.');
select 'W19|' || ((select input -> 'lessons_retrieved' from public.weekly_runs where id = :'run3') = jsonb_build_array(:'les'));
set role service_role;
select 'W20|' || ((public.weekly_run_claim(:'run3') -> 'lessons' -> 0 ->> 'example_before') = 'TEST: third-party leaks would no longer be reported.');
-- FIXTURE DEMONSTRATION: a weak opening (background before conflict)
select public.weekly_script_record(:'run3', jsonb_build_object('provider', 'claude-plan', 'model', 'test', 'prompt_sha256', repeat('2', 64),
  'body', $b${"segments":[
    {"story":"s","beat":"collision","text":"TEST: For years the agency has collected methane reports from oil and gas sites. The program began in 2024 and covers large releases. Officials describe it as one of several monitoring tools. Now a proposal would let reports of company emissions detected by third parties stop reaching EPA.","claim_ids":["air-proposal-status@1"]},
    {"story":"s","beat":"landing","text":"TEST: The change is proposed, not final.","claim_ids":["air-proposal-status@1"]}]}$b$::jsonb,
  'checks', '{"ok":true,"label":"mechanical checks passed","certifies_accuracy":false,"material_issues":[],"high_risk":[]}'::jsonb,
  'lessons_included', jsonb_build_array(:'les'),
  'lesson_assessments', jsonb_build_array(jsonb_build_object('lesson_id', :'les', 'assessed', 'applied', 'assessed_by', 'rule',
    'note', 'avoid_phrase "third-party leaks" absent')))) as s2 \gset
reset role;
-- W21 the four states, kept apart
select 'W21|' || (select retrieved and included and assessed = 'applied' and assessed_by = 'rule' and reviewer_decision = 'pending'
  from public.weekly_lesson_uses where script_id = :'s2' and lesson_id = :'les');
select id as use_id from public.weekly_lesson_uses where script_id = :'s2' \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lesson_use_review(:'use_id', 'confirmed');
select 'W22|' || pg_temp.raises($q$select public.hs_weekly_lesson_use_review($q$ || :'use_id' || $q$, 'corrected')$q$, '55000');
select 'W22b|' || pg_temp.raises($q$select public.hs_weekly_lesson_use_review($q$ || :'use_id' || $q$, 'pending')$q$, '22023');
reset role;
select 'W23|' || (select reviewer_decision = 'confirmed' and reviewed_by = 'founder@test.invalid' from public.weekly_lesson_uses where id = :'use_id');

-- RUBRIC GATE (provisional internal criteria). Each failing gate is refused on its own.
\set good '{"hook_conflict":3,"human_stakes":3,"emotional_force":3,"argument_coherence":3,"factual_discipline":4,"spoken_clarity":3,"closing":3}'
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'R01|' || (pg_temp.raises($q$select public.hs_weekly_version_approve($q$ || quote_literal(:'s2') || $q$::uuid, null, null)$q$, '22023')
  and pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', '{"hook_conflict":3,"human_stakes":2,"emotional_force":3,"argument_coherence":3,"factual_discipline":4,"spoken_clarity":3,"closing":2}'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', '{"hook_conflict":4,"human_stakes":4,"emotional_force":4,"argument_coherence":4,"factual_discipline":3,"spoken_clarity":4,"closing":4}'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', '{"hook_conflict":2,"human_stakes":4,"emotional_force":4,"argument_coherence":4,"factual_discipline":4,"spoken_clarity":4,"closing":4}'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', '{"hook_conflict":4,"human_stakes":4,"emotional_force":2,"argument_coherence":4,"factual_discipline":4,"spoken_clarity":4,"closing":4}'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', '{"hook_conflict":4,"human_stakes":4,"emotional_force":4,"argument_coherence":2,"factual_discipline":4,"spoken_clarity":4,"closing":4}'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', jsonb_set(:'good'::jsonb, '{closing}', '3.5')), '22023')
  and pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', :'good'::jsonb - 'closing'), '22023'));
reset role;
select 'R01b|' || (cardinality(public.weekly_rubric_problems(:'good'::jsonb)) = 0
  and cardinality(public.weekly_rubric_problems('{"hook_conflict":3,"human_stakes":0,"emotional_force":3,"argument_coherence":3,"factual_discipline":4,"spoken_clarity":4,"closing":4}'::jsonb)) = 0);
set role authenticated;
select set_config('test.jwt', :'admin', false);
-- PASSAGE REVIEW: a finding id outside the pinned library is refused; contradiction needs findings
select 'Q01|' || (pg_temp.raises(format('select public.hs_weekly_passage_review(%L::uuid, 0, %L, %L, null, array[%L])', :'s2', 'approved', null, 'air-not-pinned@1'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_passage_review(%L::uuid, 0, %L, %L)', :'s2', 'quote_contradicted', 'TEST'), '23514')
  and pg_temp.raises(format('select public.hs_weekly_passage_review(%L::uuid, 0, %L, %L)', :'s2', 'quote_not_found_in_sources', ''), '23514')
  and pg_temp.raises(format('select public.hs_weekly_passage_review(%L::uuid, 0, %L, %L)', :'s2', 'rewrite', 'TEST reason'), '23514')
  and pg_temp.raises(format('select public.hs_weekly_passage_review(%L::uuid, 0, %L, %L, %L)', :'s2', 'rewrite', 'TEST', 'make it pop'), '23514'));
-- the reviewer asks for "Put the conflict first", keeping the finding that supports the passage
select public.hs_weekly_passage_review(:'s2', 0, 'rewrite', 'The conflict arrives after 40 words of background.', 'conflict_first',
  array['air-proposal-status@1'], 'reusable') as rw \gset
reset role;
select ((:'rw')::jsonb ->> 'review_id') as rv, ((:'rw')::jsonb ->> 'run_id') as run5 \gset
select 'R02|' || (select decision = 'rewrite' and action = 'conflict_first' and finding_ids = array['air-proposal-status@1']
  and lesson_scope = 'reusable' and after_text is null and before_text like 'TEST: For years%' from public.weekly_corrections where id = :'rv');
set role service_role;
select public.weekly_run_claim(:'run5') as claim5 \gset
select 'R03|' || (((:'claim5')::jsonb ->> 'mode') = 'rewrite' and ((:'claim5')::jsonb -> 'parent' ->> 'action') = 'conflict_first'
  and ((:'claim5')::jsonb -> 'parent' ->> 'segment_index') = '0');
select public.weekly_script_record(:'run5', jsonb_build_object('provider', 'claude-plan', 'model', 'test', 'prompt_sha256', repeat('5', 64),
  'body', $b${"segments":[
    {"story":"s","beat":"collision","text":"TEST: A proposal would let reports of company emissions detected by third parties stop reaching EPA, and families near oil and gas sites could lose a warning about large methane releases. The change is proposed, not final. The program began in 2024.","claim_ids":["air-proposal-status@1"]},
    {"story":"s","beat":"landing","text":"TEST: The change is proposed, not final.","claim_ids":["air-proposal-status@1"]}]}$b$::jsonb,
  'checks', '{"ok":true,"label":"mechanical checks passed","certifies_accuracy":false,"material_issues":[],"high_risk":[]}'::jsonb,
  'lessons_included', jsonb_build_array(:'les'))) as s3 \gset
reset role;
select 'R04|' || (select after_text like 'TEST: A proposal would let%' and result_script_id = :'s3'::uuid from public.weekly_corrections where id = :'rv'
  and (select parent_id = :'s2'::uuid and depends_on = :'out1'::uuid from public.weekly_scripts where id = :'s3')
  and (select body -> 'segments' -> 0 ->> 'text' like 'TEST: For years%' from public.weekly_scripts where id = :'s2'));
select 'R05|' || (pg_temp.raises(format('update public.weekly_corrections set after_text = %L where id = %L', 'x', :'rv'), '55000')
  and pg_temp.raises(format('delete from public.weekly_corrections where id = %L', :'rv'), '55000'));
-- the original version is superseded and cannot be approved; the new version needs its own approval
set role authenticated;
select set_config('test.jwt', :'admin', false);
select pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s2', :'good'), '22023')::text as r6 \gset
reset role;
select 'R06|' || (:'r6' = 'true' and (public.weekly_version_status(:'s3') ->> 'approved') = 'false');
set role authenticated;
select set_config('test.jwt', :'admin', false);
-- a material issue on the NEW version blocks it; on the old version it does not carry over
select public.hs_weekly_passage_review(:'s3', 1, 'material_issue', 'TEST: a number here is not in the cited finding.');
select 'R07|' || pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s3', :'good'), '22023');
reset role;
-- a fresh rewrite clears it by making version 4 (the material issue stays on version 3)
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_passage_review(:'s3', 1, 'rewrite', 'TEST tighten the landing', 'tighten', array['air-proposal-status@1']) ->> 'run_id') as run6 \gset
reset role;
set role service_role;
select public.weekly_run_claim(:'run6') is not null as c6 \gset
-- the checks found high-risk wording
select public.weekly_script_record(:'run6', jsonb_build_object('provider', 'claude-plan', 'model', 'test', 'prompt_sha256', repeat('6', 64),
  'body', $b${"segments":[
    {"story":"s","beat":"collision","text":"TEST: A proposal would let reports of company emissions detected by third parties stop reaching EPA, and families near oil and gas sites could lose a warning about large methane releases. The change is proposed, not final.","claim_ids":["air-proposal-status@1"]},
    {"story":"s","beat":"landing","text":"TEST: Proposed, not final.","claim_ids":["air-proposal-status@1"]}]}$b$::jsonb,
  'checks', '{"ok":true,"label":"mechanical checks passed","certifies_accuracy":false,"material_issues":[],"high_risk":[{"segment":0,"term":"TEST"}]}'::jsonb,
  'lessons_included', jsonb_build_array(:'les'))) as s4 \gset
reset role;
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'R08|' || pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s4', :'good'), '22023');
select (public.hs_weekly_version_approve(:'s4', null, :'good'::jsonb, true, 'TEST approve v4') ->> 'current') as s4cur \gset
reset role;
select 'R09|' || (:'s4cur' = 'true' and (select rubric = :'good'::jsonb and high_risk_ack and body_sha256 =
  (select body_sha256 from public.weekly_scripts where id = :'s4') from public.weekly_script_approvals where script_id = :'s4'));
-- TITLES. The Air title wording was approved by the founder in a conversation; here it is TEST DATA approved by the
-- test identity on a disposable database, which is never a production approval.
\set air '[{"title":"$45B Gift to Oil—At Your Expense","rationale":"FIXTURE: approved in a conversation, not a dashboard action","input":{"headline_amount":"$45B","amount_meaning":"TEST DATA: an estimate, not a payment","beneficiary_label":"oil and gas industry","benefit_frame":"TEST","public_cost_frame":"TEST","public_cost_basis":"TEST","policy_status":"proposed","supporting_claim_ids":["air-estimate-scope@1","air-proposal-status@1"],"selected_angle_id":"0","profile_version":1}}]'
\set okchecks '{"ok":true,"label":"title checks passed","certifies_accuracy":false,"needs_research":false,"problems":[],"candidates":[{"title":"$45B Gift to Oil—At Your Expense","flags":[],"warnings":[]}]}'
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_profile_create('[{"text":"Concrete benefit first when the story supports one","origin":"inferred"},{"text":"Declarative wording by default","origin":"inferred"}]'::jsonb, 'title') as tprof \gset
select 'T00|' || pg_temp.raises(format('select public.hs_weekly_title_propose(%L::uuid, %L::jsonb, %L::uuid)', :'s4', :'air', :'prof'), '22023');
select public.hs_weekly_title_propose(:'s4', :'air'::jsonb, :'tprof') as tp1 \gset
reset role;
select ((:'tp1')::jsonb ->> 'title_version') as t1, ((:'tp1')::jsonb ->> 'run_id') as tc1 \gset
select 'T01|' || ((select version from public.weekly_editorial_profiles where id = :'tprof') = 1
  and (select scope from public.weekly_editorial_profiles where id = :'tprof') = 'title'
  and (select kind = 'human_reviewed' and run_id is null and depends_on = :'s4'::uuid and profile_id = :'tprof'::uuid from public.weekly_scripts where id = :'t1')
  and (select kind from public.weekly_runs where id = :'tc1') = 'title_check');
-- the exact wording, punctuation included
select 'T02|' || ((select body -> 'candidates' -> 0 ->> 'title' from public.weekly_scripts where id = :'t1') = '$45B Gift to Oil' || chr(8212) || 'At Your Expense');
select 'T03|' || (select st ->> 'approved' = 'false' and st ->> 'evidence_review' = 'not_checked' and st ->> 'publication' = 'not_approved'
  from (select public.weekly_version_status(:'t1') st) x);
-- editorial approval of the wording grants neither evidence clearance nor publication
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'T04|' || pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid)', :'t1'), '22023');
select public.hs_weekly_title_decide(:'t1', 0, 'approved', 'TEST DATA: wording approved') as td1 \gset
select 'T05|' || (((:'td1')::jsonb ->> 'current') = 'true' and ((:'td1')::jsonb ->> 'evidence_review') = 'not_checked'
  and ((:'td1')::jsonb ->> 'publication') = 'not_approved'
  and pg_temp.raises(format('select public.hs_weekly_title_evidence_review(%L::uuid, %L)', :'t1', 'cleared'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_title_publication_approve(%L::uuid)', :'t1'), '22023'));
reset role;
-- mechanical title checks attach to the exact text they read
select body_sha256 as t1sha from public.weekly_scripts where id = :'t1' \gset
set role service_role;
select 'T06|' || ((public.weekly_run_claim(:'tc1') -> 'title_version' -> 'body' -> 'candidates' -> 0 ->> 'title') like '$45B Gift to Oil%');
select 'T06b|' || pg_temp.raises(format('select public.weekly_title_check_record(%L::uuid, %L, %L::jsonb)', :'tc1', repeat('0', 64), :'okchecks'), '22023');
select public.weekly_title_check_record(:'tc1', :'t1sha', :'okchecks'::jsonb);
reset role;
select 'T07|' || ((public.weekly_version_status(:'t1') ->> 'evidence_review') = 'ready_for_review');
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_title_evidence_review(:'t1', 'cleared', 'TEST DATA: amount, beneficiary and status read correctly') as te1 \gset
select public.hs_weekly_title_publication_approve(:'t1', 'TEST DATA') as tpub \gset
reset role;
select 'T08|' || (((:'te1')::jsonb ->> 'evidence_review') = 'cleared' and ((:'tpub')::jsonb ->> 'publication') = 'approved'
  and (select array_agg(approval_kind order by id) = array['editorial', 'evidence', 'publication'] from public.weekly_script_approvals where script_id = :'t1'));
-- editing the wording makes a new version that needs every approval again; the old decisions stay in the history
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_title_propose(:'s4', jsonb_set(:'air'::jsonb, '{0,title}', '"$45B Gift to Oil, Paid by You"'), :'tprof', :'t1') ->> 'title_version') as t2 \gset
reset role;
select 'T09|' || ((public.weekly_version_status(:'t1') ->> 'superseded') = 'true' and (public.weekly_version_status(:'t1') ->> 'publication') = 'approved'
  and (public.weekly_version_status(:'t2') ->> 'approved') = 'false' and (public.weekly_version_status(:'t2') ->> 'evidence_review') = 'not_checked'
  and (public.weekly_version_status(:'t2') ->> 'publication') = 'not_approved'
  and (public.weekly_version_status(:'t2') ->> 'selected_index') is null
  and (select body -> 'candidates' -> 0 ->> 'title' from public.weekly_scripts where id = :'t1') like '$45B Gift to Oil%At Your Expense');
-- an evidence concern is a visible flag; the title is never rewritten
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_title_decide(:'t2', 0, 'approved');
select public.hs_weekly_title_evidence_review(:'t2', 'concerns', 'TEST DATA: "paid by you" needs a cost basis') as tc2 \gset
reset role;
select 'T10|' || (((:'tc2')::jsonb ->> 'evidence_review') = 'concerns_open'
  and (select body -> 'candidates' -> 0 ->> 'title' from public.weekly_scripts where id = :'t2') = '$45B Gift to Oil, Paid by You'
  and (select count(*) from public.weekly_scripts where stage = 'title') = 2);
-- candidate history: a rejection keeps the candidate and its reason
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_title_propose(:'s4', :'air'::jsonb || jsonb_set(:'air'::jsonb, '{0,title}', '"TEST DATA: a rejected candidate"'), :'tprof', :'t2') ->> 'title_version') as t3 \gset
select public.hs_weekly_title_decide(:'t3', 1, 'rejected', 'TEST DATA: weaker stake');
select 'T11|' || pg_temp.raises(format('select public.hs_weekly_title_decide(%L::uuid, 1, %L)', :'t3', 'rejected'), '23514');
-- generated candidates need an approved title profile
select 'T12|' || pg_temp.raises(format('select public.hs_weekly_titles_request(%L::uuid, %L::uuid)', :'s4', :'tprof'), '22023');
select public.hs_weekly_profile_approve(:'tprof');
select (public.hs_weekly_titles_request(:'s4', :'tprof') ->> 'run_id') as rt \gset
reset role;
select 'T11b|' || (select decision = 'rejected' and reason = 'TEST DATA: weaker stake' and before_text = 'TEST DATA: a rejected candidate'
  from public.weekly_corrections where script_id = :'t3' and segment_index = 1);
set role service_role;
select 'T13|' || ((public.weekly_run_claim(:'rt') ->> 'profile_version') = '1');
select public.weekly_script_record(:'rt', jsonb_build_object('provider', 'claude-plan', 'prompt_sha256', repeat('8', 64),
  'checks', :'okchecks'::jsonb, 'body', jsonb_build_object('candidates', (:'air'::jsonb || :'air'::jsonb) || jsonb_set(:'air'::jsonb, '{0,title}', '"TEST DATA three"')))) as tg \gset
reset role;
select 'T14|' || (select stage = 'title' and kind = 'ai_draft' and depends_on = :'s4'::uuid and jsonb_array_length(body -> 'candidates') = 3
  from public.weekly_scripts where id = :'tg');
-- a changed script keeps the title's history but the title must be checked against the new script
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_passage_review(:'s4', 1, 'rewrite', 'TEST DATA: tighten', 'tighten', array['air-proposal-status@1']) ->> 'run_id') as run7 \gset
reset role;
select jsonb_set(body, '{segments,1,text}', '"TEST: Proposed, not final, for now."')::text as s5body from public.weekly_scripts where id = :'s4' \gset
set role service_role;
select public.weekly_run_claim(:'run7') is not null as c8 \gset
select public.weekly_script_record(:'run7', jsonb_build_object('provider', 'claude-plan', 'prompt_sha256', repeat('9', 64),
  'body', :'s5body'::jsonb,
  'checks', '{"ok":true,"material_issues":[],"high_risk":[]}'::jsonb, 'lessons_included', jsonb_build_array(:'les'))) as s5 \gset
reset role;
select 'T15|' || ((public.weekly_version_status(:'t3') ->> 'outdated') = 'true'
  and (public.weekly_version_status(:'t3') ->> 'outdated_reason') like '%newer version%'
  and (public.weekly_version_status(:'t1') ->> 'publication') = 'approved');
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'T16|' || pg_temp.raises(format('select public.hs_weekly_title_decide(%L::uuid, 0, %L)', :'t3', 'approved'), '22023');
select (public.hs_weekly_title_refit(:'t3', :'s5') ->> 'title_version') as t4 \gset
reset role;
select 'T17|' || ((select depends_on = :'s5'::uuid and parent_id = :'t3'::uuid and body -> 'candidates' = (select body -> 'candidates' from public.weekly_scripts where id = :'t3')
  from public.weekly_scripts where id = :'t4')
  and (public.weekly_version_status(:'t4') ->> 'approved') = 'false' and (public.weekly_version_status(:'t4') ->> 'outdated') = 'false'
  and (public.weekly_version_status(:'t4') ->> 'selected_index') is null);

-- DOCUMENT CUES (a segment's visual). A cue points at a stored copy of a source of a finding the segment cites; setting one
-- makes a new version (only the cue changes); a visual_check run resolves it against the document; an unresolved or
-- unchecked cue blocks approval. TEST DATA.
-- SOURCE COPIES. Permission and the stored copy are separate facts: a person grants permission (once, never changed), a
-- source_copy run fetches the document, and the database records it only when the named object is in private storage
-- with the same size. A failed copy can be retried without touching the grant; an accepted copy is never replaced.
select 'V01|' || (pg_temp.raises($q$insert into public.weekly_sources (answer_id, url, quote_match, date_extraction, document_path, document_sha256, document_kind)
  select id, 'https://example.test/doc', 'not_checked', 'unknown', 'weekly-sources/t/a.pdf', repeat('c', 64), 'pdf' from public.weekly_research_answers limit 1$q$, '23514')
  and pg_temp.raises($q$insert into public.weekly_sources (answer_id, url, quote_match, date_extraction, storage_permission)
  select id, 'https://example.test/doc', 'not_checked', 'unknown', 'full_copy' from public.weekly_research_answers limit 1$q$, '23514'));
select id as ans from public.weekly_research_answers limit 1 \gset
insert into public.weekly_sources (answer_id, url, title, quote, quote_match, date_extraction)
  values (:'ans', 'https://example.test/copy.pdf', 'TEST copy', 'TEST the quoted words', 'not_checked', 'unknown') returning id as dcp \gset
set role authenticated;
select set_config('test.jwt', :'other', false);
select 'S01|' || pg_temp.raises(format('select public.hs_weekly_source_copy_grant(%L::uuid, %L, %L)', :'dcp', 'pdf', 'TEST published federal record'), '42501');
select set_config('test.jwt', :'admin', false);
select 'S02|' || (pg_temp.raises(format('select public.hs_weekly_source_copy_grant(%L::uuid, %L, %L)', :'dcp', 'docx', 'TEST published federal record'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_source_copy_grant(%L::uuid, %L, %L)', :'dcp', 'pdf', 'short'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_source_copy_retry(%L::uuid)', :'dcp'), '22023'));
select public.hs_weekly_source_copy_grant(:'dcp', 'pdf', 'TEST published federal record, public domain')::text as g1 \gset
reset role;
select copy_granted_by as gby, copy_granted_at::text as gat, copy_grant_basis as gbasis from public.weekly_sources where id = :'dcp' \gset
select (:'g1'::jsonb ->> 'run_id') as cr1 \gset
-- granted is not stored: the copy is pending, nothing is in storage, no document field is set
select 'S03|' || ((:'g1'::jsonb -> 'copy' ->> 'state') = 'pending'
  and (select storage_permission = 'full_copy' and copy_kind = 'pdf' and document_path is null and document_sha256 is null and copy_size is null
       from public.weekly_sources where id = :'dcp')
  and (select kind = 'source_copy' and status = 'queued' and input ->> 'source_id' = :'dcp' from public.weekly_runs where id = :'cr1'::uuid));
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'S04|' || (pg_temp.raises(format('select public.hs_weekly_source_copy_grant(%L::uuid, %L, %L)', :'dcp', 'html', 'TEST a second, different grant'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_source_copy_retry(%L::uuid)', :'dcp'), '55006'));
reset role;
-- the copy fails (e.g. the site did not answer): the state is failed with the reason, the grant is unchanged
set role service_role;
select public.weekly_run_claim(:'cr1')::text as cc1 \gset
select 'S05|' || ((:'cc1'::jsonb -> 'source' ->> 'granted') = 'true' and (:'cc1'::jsonb -> 'source' ->> 'stored') = 'false'
  and (:'cc1'::jsonb -> 'source' ->> 'kind') = 'pdf' and (:'cc1'::jsonb -> 'source' -> 'quotes') = '["TEST the quoted words"]'::jsonb
  and (:'cc1'::jsonb ->> 'mode') = 'source_copy');
select public.weekly_run_fail(:'cr1', 'copy not fetched: HTTP 503');
reset role;
select 'S06|' || ((public.weekly_source_copy_state(:'dcp') ->> 'state') = 'failed'
  and (public.weekly_source_copy_state(:'dcp') ->> 'last_error') = 'copy not fetched: HTTP 503'
  and (select copy_granted_by = :'gby' and copy_granted_at::text = :'gat' and copy_grant_basis = :'gbasis' and document_path is null
       from public.weekly_sources where id = :'dcp'));
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_source_copy_retry(:'dcp') ->> 'run_id') as cr2 \gset
reset role;
select 'S07|' || ((public.weekly_source_copy_state(:'dcp') ->> 'state') = 'pending' and (public.weekly_source_copy_state(:'dcp') ->> 'attempts') = '2'
  and (select copy_granted_by = :'gby' and copy_granted_at::text = :'gat' and copy_grant_basis = :'gbasis' from public.weekly_sources where id = :'dcp'));
-- the record step: refused unless the run is running and the named object is in storage with the same size
\set csha 'aaaa111122223333444455556666777788889999aaaabbbbccccddddeeeeffff'
select format('{"source_id":"%s","document_sha256":"%s","document_kind":"pdf","size":1234,"document_path":"weekly-sources/%s/%s.pdf","quote_match":"found"}',
  :'dcp', :'csha', :'dcp', :'csha') as cpay \gset
set role service_role;
select 'S08|' || pg_temp.raises(format('select public.weekly_source_copy_record(%L::uuid, %L::jsonb)', :'cr2', :'cpay'), '55000');
select public.weekly_run_claim(:'cr2') is not null as ok \gset
-- nothing in storage yet: refused as "not in private storage" (its own error code)
select 'S09|' || (pg_temp.raises(format('select public.weekly_source_copy_record(%L::uuid, %L::jsonb)', :'cr2', :'cpay'), 'P0002')
  and pg_temp.raises(format('select public.weekly_source_copy_record(%L::uuid, %L::jsonb)', :'cr2', jsonb_set(:'cpay'::jsonb, '{document_sha256}', '"nothex"')), '22023')
  and pg_temp.raises(format('select public.weekly_source_copy_record(%L::uuid, %L::jsonb)', :'cr2', jsonb_set(:'cpay'::jsonb, '{source_id}', to_jsonb(:'ans'::text))), '22023'));
reset role;
-- the object is now there (and an html object of the same checksum too): still refused for a wrong size, kind or path
insert into storage.objects (bucket_id, name, metadata) values ('weekly-sources', :'dcp' || '/' || :'csha' || '.pdf', '{"size":1234}'),
  ('weekly-sources', :'dcp' || '/' || :'csha' || '.html', '{"size":1234}');
set role service_role;
select 'S10|' || (pg_temp.raises(format('select public.weekly_source_copy_record(%L::uuid, %L::jsonb)', :'cr2', jsonb_set(:'cpay'::jsonb, '{size}', '999')), '22023')
  and pg_temp.raises(format('select public.weekly_source_copy_record(%L::uuid, %L::jsonb)', :'cr2',
        jsonb_set(jsonb_set(:'cpay'::jsonb, '{document_kind}', '"html"'), '{document_path}', to_jsonb('weekly-sources/' || :'dcp' || '/' || :'csha' || '.html'))), '22023')
  and pg_temp.raises(format('select public.weekly_source_copy_record(%L::uuid, %L::jsonb)', :'cr2', jsonb_set(:'cpay'::jsonb, '{document_path}', '"weekly-sources/other.pdf"')), '22023'));
select public.weekly_source_copy_record(:'cr2', :'cpay'::jsonb)::text as st1 \gset
reset role;
select 'S11|' || ((:'st1'::jsonb ->> 'state') = 'stored' and (:'st1'::jsonb ->> 'document_sha256') = :'csha' and (:'st1'::jsonb ->> 'size') = '1234'
  and (select document_path = 'weekly-sources/' || :'dcp' || '/' || :'csha' || '.pdf' and copy_quote_match = 'found' and copy_verified_at is not null
         and copy_granted_by = :'gby' and copy_granted_at::text = :'gat' from public.weekly_sources where id = :'dcp')
  and (select status = 'done' from public.weekly_runs where id = :'cr2'::uuid)
  and (select count(*) from public.weekly_cost_entries where run_id = :'cr2'::uuid and cost_type in ('storage_bytes', 'runner_minutes')) = 2);
-- an accepted copy is never replaced, re-fetched, or re-granted; the grant is never changed or removed
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'S12|' || (pg_temp.raises(format('select public.hs_weekly_source_copy_retry(%L::uuid)', :'dcp'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_source_copy_grant(%L::uuid, %L, %L)', :'dcp', 'pdf', 'TEST published federal record'), '22023'));
reset role;
select 'S13|' || (pg_temp.raises(format($q$update public.weekly_sources set document_sha256 = %L, document_path = %L where id = %L$q$,
      repeat('b', 64), 'weekly-sources/' || :'dcp' || '/' || repeat('b', 64) || '.pdf', :'dcp'), '55000')
  and pg_temp.raises(format($q$update public.weekly_sources set copy_grant_basis = 'TEST changed basis text' where id = %L$q$, :'dcp'), '55000')
  and pg_temp.raises(format($q$update public.weekly_sources set copy_granted_by = null, copy_granted_at = null, copy_grant_basis = null, copy_kind = null,
      storage_permission = 'excerpt', document_path = null, document_sha256 = null, document_kind = null, copy_size = null, copy_verified_at = null,
      copy_quote_match = null where id = %L$q$, :'dcp'), '55000')
  and pg_temp.raises(format($q$delete from public.weekly_sources where id = %L$q$, :'dcp'), '55000')
  and pg_temp.raises(format($q$update public.weekly_sources set title = 'TEST renamed' where id = %L$q$, :'dcp'), '55000'));
-- private storage: anon and a signed-in non-admin read nothing in the bucket; an admin reads the copy; nobody but the
-- service role writes; the function grants are as intended
set role anon;
select set_config('test.jwt', '', false);
select count(*) as n_anon from storage.objects where bucket_id = 'weekly-sources' \gset
reset role;
set role authenticated;
select set_config('test.jwt', :'other', false);
select count(*) as n_other from storage.objects where bucket_id = 'weekly-sources' \gset
select 'S14b|' || pg_temp.raises($q$insert into storage.objects (bucket_id, name, metadata) values ('weekly-sources', 'x/y.pdf', '{"size":1}')$q$, '42501');
select set_config('test.jwt', :'admin', false);
select count(*) as n_admin from storage.objects where bucket_id = 'weekly-sources' \gset
reset role;
select 'S14|' || (:'n_anon' = '0' and :'n_other' = '0' and :'n_admin' = '2'
  and (select not public from storage.buckets where id = 'weekly-sources') and (select not public from storage.buckets where id = 'weekly-visuals'));
select 'S15|' || (has_function_privilege('authenticated', 'public.hs_weekly_source_copy_grant(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_weekly_source_copy_retry(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_source_copy_grant(uuid,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_source_copy_record(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.weekly_source_copy_record(uuid,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.weekly_source_copy_record(uuid,jsonb)', 'execute'));

-- DOCUMENT CUES. Every source a cue may point at gets its copy through the same grant, run and record (pg_temp.store).
create or replace function pg_temp.store(p_src uuid, p_kind text, p_sha text, p_admin text) returns void language plpgsql as $$
declare g jsonb; run uuid;
begin
  perform set_config('test.jwt', p_admin, true);
  g := public.hs_weekly_source_copy_grant(p_src, p_kind, 'TEST a public record, kept as a full copy');
  run := (g ->> 'run_id')::uuid;
  perform public.weekly_run_claim(run);
  insert into storage.objects (bucket_id, name, metadata) values ('weekly-sources', p_src || '/' || p_sha || '.' || p_kind, '{"size":100}');
  perform public.weekly_source_copy_record(run, jsonb_build_object('source_id', p_src, 'document_sha256', p_sha, 'document_kind', p_kind,
    'size', 100, 'document_path', 'weekly-sources/' || p_src || '/' || p_sha || '.' || p_kind, 'quote_match', 'no_quote'));
end $$;
select f.id as fps from public.weekly_findings f join public.weekly_library_version_findings x on x.finding_id = f.id
  where x.library_version_id = (select library_version_id from public.weekly_scripts where id = :'s5') and f.finding_key = 'air-proposal-status' \gset
insert into public.weekly_sources (answer_id, url, title, quote_match, date_extraction)
  values (:'ans', 'https://example.test/rule.pdf', 'TEST rule', 'not_checked', 'unknown') returning id as dpdf \gset
insert into public.weekly_sources (answer_id, url, title, quote_match, date_extraction)
  values (:'ans', 'https://example.test/page', 'TEST page', 'not_checked', 'unknown') returning id as dhtml \gset
insert into public.weekly_sources (answer_id, url, quote, quote_match, date_extraction)
  values (:'ans', 'https://example.test/excerpt', 'TEST excerpt only', 'not_checked', 'unknown') returning id as dexc \gset
insert into public.weekly_sources (answer_id, url, quote_match, date_extraction)
  values (:'ans', 'https://example.test/other.pdf', 'not_checked', 'unknown') returning id as doth \gset
-- a source with permission granted but no stored copy yet: a cue may not point at it
insert into public.weekly_sources (answer_id, url, quote_match, date_extraction)
  values (:'ans', 'https://example.test/granted.pdf', 'not_checked', 'unknown') returning id as dgr \gset
select pg_temp.store(:'dpdf', 'pdf', repeat('d', 64), :'admin');
select pg_temp.store(:'dhtml', 'html', repeat('e', 64), :'admin');
select pg_temp.store(:'doth', 'pdf', repeat('f', 64), :'admin');
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_source_copy_grant(:'dgr', 'pdf', 'TEST granted, not yet copied') is not null as ok \gset
reset role;
select 'S16|' || (pg_temp.raises(format($q$update public.weekly_sources set copy_grant_basis = 'TEST a different reason' where id = %L$q$, :'dgr'), '55000')
  and pg_temp.raises(format($q$update public.weekly_sources set copy_kind = 'html' where id = %L$q$, :'dgr'), '55000')
  -- a copy without any grant is refused by the table itself, even at the one correct path
  and pg_temp.raises(format($q$insert into public.weekly_sources (id, answer_id, url, quote_match, date_extraction, document_path, document_sha256, document_kind,
      copy_size, copy_verified_at, copy_quote_match) values (%L, %L, 'https://example.test/x.pdf', 'not_checked', 'unknown', %L, %L, 'pdf', 10, now(), 'no_quote')$q$,
      '11111111-2222-3333-4444-555555555555', :'ans', 'weekly-sources/11111111-2222-3333-4444-555555555555/' || repeat('a', 64) || '.pdf', repeat('a', 64)), '23514'));
insert into public.weekly_finding_sources values (:'fps', :'dpdf'), (:'fps', :'dhtml'), (:'fps', :'dexc'), (:'fps', :'dgr');
insert into public.weekly_finding_sources select f.id, :'doth' from public.weekly_findings f where f.finding_key = 'air-estimate-scope' limit 1;
select jsonb_build_object('type', 'doc', 'claim_id', 'air-proposal-status@1', 'source_id', :'dpdf', 'page', 1,
  'quote', 'TEST: the agency proposes to rescind the program.', 'highlight', 'yellow')::text as cue0 \gset
set role authenticated;
select set_config('test.jwt', :'other', false);
select 'V02|' || pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', :'cue0'), '42501');
select set_config('test.jwt', :'admin', false);
select 'V03|' || (pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{claim_id}', '"air-estimate-scope@1"')), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{source_id}', to_jsonb(:'doth'::text))), '22023')
  -- a real source of a finding in the library, but the segment does not cite that finding
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5',
        jsonb_set(jsonb_set(:'cue0'::jsonb, '{claim_id}', '"air-estimate-scope@1"'), '{source_id}', to_jsonb(:'doth'::text))), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{source_id}', to_jsonb(:'dexc'::text))), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{source_id}', to_jsonb(:'dgr'::text))), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{highlight}', '"red"')), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{page}', '0')), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{page}', '1.5')), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', :'cue0'::jsonb || '{"image_url":"https://x.test/a.png"}'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{source_id}', to_jsonb(:'dhtml'::text))), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s5', jsonb_set(:'cue0'::jsonb, '{quote}', '""')), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 9, %L::jsonb)', :'s5', :'cue0'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, null)', :'s5'), '22023'));
reset role;
select (select count(*) from net.calls) as calls_before \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_doc_cue_set(:'s5', 0, :'cue0'::jsonb) as c6 \gset
reset role;
select (:'c6'::jsonb ->> 'script_version') as s6, (:'c6'::jsonb ->> 'run_id') as vr1 \gset
select 'V04|' || ((select kind = 'human_reviewed' and run_id is null and parent_id = :'s5'::uuid and stage = 'script'
    and public.weekly_without_visuals(body) = public.weekly_without_visuals((select body from public.weekly_scripts where id = :'s5'))
    and body -> 'segments' -> 0 -> 'visual' = jsonb_set(:'cue0'::jsonb, '{source_id}', to_jsonb(:'dpdf'::text))
    and body -> 'segments' -> 1 -> 'visual' is null and public.weekly_cue_count(body) = 1
  from public.weekly_scripts where id = :'s6')
  and (public.weekly_version_status(:'s5') ->> 'superseded') = 'true'
  and (select kind = 'visual_check' and status = 'queued' and input ->> 'version_id' = :'s6' from public.weekly_runs where id = :'vr1'::uuid)
  and (select count(*) from net.calls) = :'calls_before'::integer + 1
  and (select body -> 'inputs' ->> 'run' from net.calls order by id desc limit 1) = :'vr1');
-- a person-made version must change only cues, and must be a new version of an existing script
select body::text as s6body from public.weekly_scripts where id = :'s6' \gset
select 'V05|' || (pg_temp.raises(format($q$insert into public.weekly_scripts (stage, parent_id, depends_on, selected_index, topic, library_version_id, profile_id, body, checks, kind)
    select 'script', id, depends_on, selected_index, topic, library_version_id, profile_id, jsonb_set(body, '{segments,1,text}', '"TEST: changed by a person"'), checks, 'human_reviewed'
    from public.weekly_scripts where id = %L$q$, :'s6'), '22023')
  and pg_temp.raises(format($q$insert into public.weekly_scripts (stage, depends_on, selected_index, topic, library_version_id, profile_id, body, checks, kind)
    select 'script', depends_on, selected_index, topic, library_version_id, profile_id, body, checks, 'human_reviewed'
    from public.weekly_scripts where id = %L$q$, :'s6'), '22023'));
-- not approvable until the cue is checked against the document
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'V06|' || pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s6', :'good'), '22023');
reset role;
select body_sha256 as s6sha from public.weekly_scripts where id = :'s6' \gset
set role service_role;
select public.weekly_run_claim(:'vr1')::text as vclaim \gset
select 'V07|' || ((:'vclaim'::jsonb -> 'cue_version' ->> 'id') = :'s6' and (:'vclaim'::jsonb -> 'cue_version' ->> 'body_sha256') = :'s6sha'
  and (select count(*) from jsonb_array_elements(:'vclaim'::jsonb -> 'sources') x where x ->> 'source_id' in (:'dpdf', :'dhtml')
       and x ->> 'document_path' = 'weekly-sources/' || (x ->> 'source_id') || '/' || (x ->> 'document_sha256') || '.' || (x ->> 'document_kind')
       and x -> 'finding_ids' ? 'air-proposal-status@1') = 2
  and not exists (select 1 from jsonb_array_elements(:'vclaim'::jsonb -> 'sources') x where x ->> 'source_id' in (:'dexc', :'dgr'))
  and (:'vclaim'::jsonb ->> 'mode') = 'visual_check' and jsonb_array_length(:'vclaim'::jsonb -> 'findings') > 0);
select 'V08|' || (pg_temp.raises(format('select public.weekly_visual_check_record(%L::uuid, %L, %L::jsonb)', :'vr1', repeat('0', 64), '{"ok":true,"segments":[]}'), '22023')
  and pg_temp.raises(format('select public.weekly_visual_check_record(%L::uuid, %L, %L::jsonb)', :'vr1', :'s6sha', '{"segments":[]}'), '22023'));
select public.weekly_visual_check_record(:'vr1', :'s6sha', '{"ok":false,"label":"document cue checks","certifies_accuracy":false,"unresolved":1,"segments":[{"segment":0,"status":"unresolved","problems":["the words to highlight are not in the document"],"scene":null},{"segment":1,"status":"none"}]}'::jsonb);
reset role;
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'V09|' || (pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s6', :'good'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L::uuid, 0, %L::jsonb)', :'s6', jsonb_set(:'cue0'::jsonb, '{source_id}', to_jsonb(:'dpdf'::text))), '22023'));
reset role;
select 'V09b|' || ((public.weekly_visual_checks(:'s6') ->> 'ok') = 'false');
set role authenticated;
select set_config('test.jwt', :'admin', false);
-- the corrected cue is a new version; once its check resolves it can be approved
select public.hs_weekly_doc_cue_set(:'s6', 0, jsonb_set(:'cue0'::jsonb, '{quote}', '"TEST: the corrected sentence."')) as c7 \gset
reset role;
select (:'c7'::jsonb ->> 'script_version') as s7, (:'c7'::jsonb ->> 'run_id') as vr2 \gset
select body_sha256 as s7sha from public.weekly_scripts where id = :'s7' \gset
set role service_role;
select public.weekly_run_claim(:'vr2') is not null as c9 \gset
select public.weekly_visual_check_record(:'vr2', :'s7sha', '{"ok":true,"label":"document cue checks","certifies_accuracy":false,"unresolved":0,"segments":[{"segment":0,"status":"resolved","problems":[],"scene":{"type":"doc","doc":{"page":1,"highlights":[{"x":0.1,"y":0.5,"w":0.2,"h":0.01}]}}},{"segment":1,"status":"none"}]}'::jsonb);
reset role;
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_version_approve(:'s7', null, :'good'::jsonb, false, 'TEST approve the cued version') ->> 'current') as s7cur \gset
select hs_weekly_overview('Air Quality')::text as ov7 \gset
reset role;
select 'V10|' || (:'s7cur' = 'true' and (public.weekly_visual_checks(:'s7') ->> 'ok') = 'true'
  and (select (v ->> 'cues') = '1' and (v -> 'visual_checks' ->> 'ok') = 'true' and v ->> 'kind' = 'human_reviewed'
       from jsonb_array_elements(:'ov7'::jsonb -> 'versions') v where v ->> 'id' = :'s7')
  and exists (select 1 from jsonb_array_elements(:'ov7'::jsonb -> 'findings') f, jsonb_array_elements(f -> 'sources') w
              where w ->> 'id' = :'dpdf' and w ->> 'document_kind' = 'pdf'));
-- a rewrite of a cued version keeps the cue and is checked against it again
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_passage_review(:'s7', 1, 'rewrite', 'TEST DATA: tighten', 'tighten', array['air-proposal-status@1']) ->> 'run_id') as run9 \gset
reset role;
select (select count(*) from public.weekly_runs where kind = 'visual_check') as vbefore \gset
select jsonb_set(body, '{segments,1,text}', '"TEST: Proposed, not final, as of now."')::text as s8body from public.weekly_scripts where id = :'s7' \gset
set role service_role;
select public.weekly_run_claim(:'run9') is not null as c10 \gset
select public.weekly_script_record(:'run9', jsonb_build_object('provider', 'claude-plan', 'prompt_sha256', repeat('a', 64),
  'body', :'s8body'::jsonb, 'checks', '{"ok":true,"material_issues":[],"high_risk":[]}'::jsonb, 'lessons_included', '[]'::jsonb)) as s8 \gset
reset role;
select 'V11|' || ((select count(*) from public.weekly_runs where kind = 'visual_check') = :'vbefore'::integer + 1
  and exists (select 1 from public.weekly_runs where kind = 'visual_check' and input ->> 'version_id' = :'s8' and status = 'queued')
  and public.weekly_visual_checks(:'s8') is null and public.weekly_cue_count((select body from public.weekly_scripts where id = :'s8')) = 1);
-- removing the cue: a new version with no visual and no check to wait for
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'V12|' || pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'s8', :'good'), '22023');
select public.hs_weekly_doc_cue_set(:'s8', 0, null) as c9r \gset
select (:'c9r'::jsonb ->> 'script_version') as s9 \gset
select (public.hs_weekly_version_approve(:'s9', null, :'good'::jsonb, false, 'TEST approve without a cue') ->> 'current') as s9cur \gset
reset role;
select 'V13|' || (:'s9cur' = 'true' and (:'c9r'::jsonb ->> 'run_id') is null
  and (select body -> 'segments' -> 0 -> 'visual' = 'null'::jsonb and public.weekly_cue_count(body) = 0 from public.weekly_scripts where id = :'s9'));
select 'V14|' || (has_function_privilege('authenticated', 'public.hs_weekly_doc_cue_set(uuid,integer,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_doc_cue_set(uuid,integer,jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.weekly_visual_check_record(uuid,text,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_visual_check_record(uuid,text,jsonb)', 'execute'));

set role authenticated;
select set_config('test.jwt', :'admin', false);
-- DEPENDENCIES: selecting a different angle card makes the outline AND the script outdated; history stays
select public.hs_weekly_version_approve(:'ang1', 1, null, false, 'TEST switch to the second angle');
select (pg_temp.raises(format('select public.hs_weekly_script_request(%L::uuid)', :'out1'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_passage_review(%L::uuid, 0, %L, %L, %L)', :'s4', 'rewrite', 'TEST', 'tighten'), '22023'))::text as d1 \gset
reset role;
select 'D01|' || (:'d1' = 'true' and (public.weekly_version_status(:'out1') ->> 'outdated') = 'true'
  and (public.weekly_version_status(:'s4') ->> 'outdated') = 'true' and (public.weekly_version_status(:'s4') ->> 'current') = 'false'
  and (public.weekly_version_status(:'s4') ->> 'approved') = 'true');
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'D02|' || (select bool_and(not (v -> 'status' ->> 'current')::boolean or v ->> 'stage' = 'angles')
  and bool_or((v -> 'approvals' -> 0 ->> 'this_version')::boolean and v ->> 'stage' = 'script')
  from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'versions') v);
-- a NEW VERSION of the angle set supersedes it
select (public.hs_weekly_angles_request(:'lv1', :'prof', :'ang1') ->> 'run_id') as ra2 \gset
reset role;
set role service_role;
select public.weekly_run_claim(:'ra2') is not null as c7 \gset
select public.weekly_script_record(:'ra2', jsonb_build_object('provider', 'claude-plan', 'model', 'test', 'prompt_sha256', repeat('7', 64),
  'checks', '{"ok": true}'::jsonb, 'body', jsonb_build_object('angles', jsonb_build_array((:'card' || ' a"}')::jsonb, (:'card' || ' b"}')::jsonb, (:'card' || ' c"}')::jsonb)))) as ang2 \gset
reset role;
select 'D03|' || ((public.weekly_version_status(:'ang1') ->> 'superseded') = 'true'
  and (public.weekly_version_status(:'ang2') ->> 'approved') = 'false'
  and (public.weekly_version_status(:'ang1') ->> 'approved') = 'true'
  and (public.weekly_version_status(:'out1') ->> 'outdated_reason') like '%newer version%');
-- MEASUREMENT is kept apart; audience outcomes are not collected
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_overview('Air Quality') -> 'measurement' as meas \gset
select 'M01|' || (((:'meas')::jsonb -> 'audience' ->> 'status') = 'not_collected'
  and ((:'meas')::jsonb -> 'mechanical' ->> 'script_versions') = '9'
  and ((:'meas')::jsonb -> 'human' ->> 'approvals') = '3'
  and ((:'meas')::jsonb -> 'human' -> 'rubric_totals') = '[22, 22, 22]'::jsonb
  and ((:'meas')::jsonb -> 'editing' ->> 'rewrites') = '4'
  and (public.hs_weekly_overview('Air Quality') -> 'rubric' ->> 'label') like 'Provisional%');
reset role;

-- W24 new research makes a NEW finding version; v1 keeps its pinned findings
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_paste_answer(:'req', 'TEST DATA second answer') ->> 'run_id') as run4 \gset
reset role;
set role service_role;
select public.weekly_run_claim(:'run4') is not null as claimed \gset
select public.weekly_research_record(:'run4', $j${"sources": [], "findings": [
  {"finding_key": "air-proposal-status", "statement": "TEST: the change is still proposed (updated).", "qualifiers": ["proposed"]},
  {"finding_key": "air-undecided-one", "statement": "TEST: a finding nobody has decided yet."}]}$j$::jsonb);
reset role;
select 'W24|' || ((select count(*) from public.weekly_findings where finding_key = 'air-proposal-status') = 2
  and (select supersedes from public.weekly_findings where finding_key = 'air-proposal-status' and version = 2) = :'f_status'::uuid
  and exists (select 1 from public.weekly_library_version_findings where library_version_id = :'lv1' and finding_id = :'f_status'));
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_finding_decide((f ->> 'id')::uuid, 'approved')
  from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'findings') f
  where f ->> 'finding_key' = 'air-proposal-status' and (f ->> 'version') = '2';
select (public.hs_weekly_library_seal('Air Quality') ->> 'library_version_id') as lv2 \gset
reset role;
select 'W25|' || ((select count(*) from public.weekly_library_version_findings where library_version_id = :'lv1') = 2
  and not exists (select 1 from public.weekly_library_version_findings x join public.weekly_findings f on f.id = x.finding_id
                  where x.library_version_id = :'lv2' and f.id = :'f_status')
  and (select n from public.weekly_library_versions where id = :'lv2') = 2
  and not exists (select 1 from public.weekly_library_version_findings x join public.weekly_findings f on f.id = x.finding_id
                  where x.library_version_id = :'lv2' and f.finding_key = 'air-undecided-one')
  and exists (select 1 from public.weekly_library_version_findings x join public.weekly_findings f on f.id = x.finding_id
              where x.library_version_id = :'lv2' and f.finding_key = 'air-proposal-status' and f.version = 2));

-- W26 export follows export permission; the raw AI answer is record-only
insert into public.weekly_sources (answer_id, url, quote, quote_match, date_extraction, export_permission)
  select id, 'https://example.test/include', 'TEST includable quote', 'exact', 'not_stated', 'include' from public.weekly_research_answers limit 1;
insert into public.weekly_sources (answer_id, url, quote, quote_match, date_extraction, export_permission)
  select id, 'https://example.test/exclude', 'TEST excluded quote', 'exact', 'not_stated', 'exclude' from public.weekly_research_answers limit 1;
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_export('Air Quality')::text as ex \gset
reset role;
select 'W26|' || (position('TEST includable quote' in :'ex') > 0 and position('TEST excluded quote' in :'ex') = 0
  and position('example.test/exclude' in :'ex') = 0 and position('TEST quoted sentence' in :'ex') = 0
  and position('example.test/epa-proposal' in :'ex') > 0 and position('TEST DATA pasted answer' in :'ex') = 0);

-- W27 costs: plan work carries no amount; extra usage is off unless a person records it on
select 'W27|' || pg_temp.raises($q$insert into public.weekly_cost_entries (category, cost_type, scope, amount_usd) values ('writing', 'no_incremental_api_charge', 'report', 1)$q$, '23514');
select 'W27b|' || ((select count(*) from public.weekly_cost_entries where category = 'writing' and cost_type = 'no_incremental_api_charge')
    = (select count(*) from public.weekly_scripts where run_id is not null)
  and (select count(*) from public.weekly_cost_entries where category = 'verification' and cost_type = 'no_incremental_api_charge')
    = (select count(*) from public.weekly_scripts where run_id is not null)
  and (select count(*) from public.weekly_cost_entries where category = 'verification' and cost_type = 'runner_minutes')
    = (select count(*) from public.weekly_runs where kind in ('title_check', 'visual_check', 'source_copy') and status = 'done')
  and not exists (select 1 from public.weekly_cost_entries where cost_type = 'no_incremental_api_charge' and amount_usd is not null));
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_subscription_record('claude', 'TEST plan', null, 'TEST limits');
reset role;
select 'W28|' || (select bool_and(not extra_usage_enabled) from public.weekly_subscriptions);
select 'W28b|' || ((select column_default from information_schema.columns where table_name = 'weekly_subscriptions' and column_name = 'extra_usage_enabled') = 'false');

-- W29 a missing dispatch credential fails the run instead of leaving it queued
delete from vault.decrypted_secrets;
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_angles_request(:'lv2', :'prof') ->> 'dispatched') as disp \gset
reset role;
select 'W29|' || (:'disp' = 'false' and exists (select 1 from public.weekly_runs where kind = 'angles' and status = 'failed' and error like 'not started%'));
-- W30 approval is admin only
set role authenticated;
select set_config('test.jwt', :'other', false);
select 'W30|' || pg_temp.raises(format('select public.hs_weekly_version_approve(%L::uuid)', :'ang2'), '42501');
reset role;
