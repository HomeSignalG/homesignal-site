-- docs/weekly-stage2-slice.sql on a DISPOSABLE database. Prints one "Wnn|true/false" line per check.
-- Everything here is TEST DATA; no line is real research.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return code is null or sqlstate = code; end $$;
grant execute on function pg_temp.raises(text, text) to anon, authenticated, service_role;
\set admin '{"email":"founder@test.invalid"}'
\set other '{"email":"someone@test.invalid"}'

-- W01 no direct table/view access for anon or authenticated
select 'W01|' || not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'weekly\_%' and c.relkind in ('r', 'v')
    and (has_table_privilege('anon', c.oid, 'select,insert,update,delete')
         or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')));
select 'W01b|' || ((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'weekly\_%' and c.relkind = 'r' and c.relrowsecurity) = 19);
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

-- profile: a script request is refused until the profile is approved
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
select 'W15|' || pg_temp.raises($q$select public.hs_weekly_script_request($q$ || quote_literal(:'lv1') || $q$::uuid, $q$ || quote_literal(:'prof') || $q$::uuid)$q$, '22023');
select public.hs_weekly_profile_approve(:'prof');
select (public.hs_weekly_script_request(:'lv1', :'prof') ->> 'run_id') as run2 \gset
reset role;
select 'W16|' || ((select input -> 'lessons_retrieved' from public.weekly_runs where id = :'run2') = '[]'::jsonb);
-- draft 1 (fixture script that breaks the rule later made a lesson)
set role service_role;
select 'W17|' || (jsonb_array_length(public.weekly_run_claim(:'run2') -> 'findings') = 2);
select 'W17b|' || pg_temp.raises($q$select public.weekly_script_record($q$ || quote_literal(:'run2') || $q$::uuid, jsonb_build_object(
  'provider', 'claude-plan', 'prompt_sha256', repeat('a', 64), 'body', '{"segments":[]}'::jsonb, 'checks', '{}'::jsonb,
  'lessons_included', jsonb_build_array(gen_random_uuid())))$q$, '22023');
select public.weekly_script_record(:'run2', $j${"provider": "claude-plan", "model": "test", "prompt_sha256": "1111111111111111111111111111111111111111111111111111111111111111",
  "body": {"segments": [{"story": "s", "text": "TEST: third-party leaks would no longer be reported.", "claim_ids": ["air-proposal-status@1"]}]},
  "checks": {"label": "mechanical checks passed", "certifies_accuracy": false}, "runner_seconds": 120}$j$::jsonb) as s1 \gset
reset role;

-- correction -> lesson -> approved
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_correction_save(:'s1', 0, 'TEST: reports of company emissions detected by third parties would no longer reach EPA under the proposal.') as corr \gset
select public.hs_weekly_lesson_propose(:'corr', 'Say "company emissions detected by third parties", not "third-party leaks".',
  '{"type": "avoid_phrase", "value": "third-party leaks"}') as les \gset
select public.hs_weekly_lesson_decide(:'les', 'approved');
select (public.hs_weekly_script_request(:'lv1', :'prof') ->> 'run_id') as run3 \gset
reset role;
select 'W18|' || ((select before_text from public.weekly_corrections where id = :'corr') = 'TEST: third-party leaks would no longer be reported.');
select 'W19|' || ((select input -> 'lessons_retrieved' from public.weekly_runs where id = :'run3') = jsonb_build_array(:'les'));
set role service_role;
select 'W20|' || ((public.weekly_run_claim(:'run3') -> 'lessons' -> 0 ->> 'example_before') = 'TEST: third-party leaks would no longer be reported.');
select public.weekly_script_record(:'run3', jsonb_build_object('provider', 'claude-plan', 'model', 'test', 'prompt_sha256', repeat('2', 64),
  'body', '{"segments":[{"story":"s","text":"TEST: reports of company emissions detected by third parties would stop.","claim_ids":["air-proposal-status@1"]}]}'::jsonb,
  'checks', '{"label":"mechanical checks passed","certifies_accuracy":false}'::jsonb,
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
select 'W27b|' || ((select count(*) from public.weekly_cost_entries where category = 'writing' and cost_type = 'no_incremental_api_charge') = 2
  and (select count(*) from public.weekly_cost_entries where category = 'verification') = 2
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
select (public.hs_weekly_script_request(:'lv2', :'prof') ->> 'dispatched') as disp \gset
reset role;
select 'W29|' || (:'disp' = 'false' and exists (select 1 from public.weekly_runs where kind = 'script' and status = 'failed' and error like 'not started%'));
-- W30 script approval: admin only, tied to the body hash
set role authenticated;
select set_config('test.jwt', :'other', false);
select 'W30|' || pg_temp.raises($q$select public.hs_weekly_script_approve($q$ || quote_literal(:'s2') || $q$::uuid)$q$, '42501');
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_script_approve(:'s2');
select 'W30b|' || (select bool_or((s ->> 'approved')::boolean) and not bool_and((s ->> 'approved')::boolean)
  from jsonb_array_elements(public.hs_weekly_overview('Air Quality') -> 'scripts') s);
reset role;
