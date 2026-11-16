-- RESEARCH REQUESTS ANSWERED BY PERPLEXITY'S API (docs/weekly-perplexity-api.sql) on a DISPOSABLE Postgres (never
-- production). Run by run_perplexity.sh after files 1, 2, 2a and the Perplexity file. Every line 'Pnn|true' is one check.
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
select (public.hs_weekly_edition_create('Water Quality', '2026-11-06') ->> 'id') as edw \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST data centers","topic":"Data Centers"}') ->> 'lead_id') as l1 \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST second","topic":"Data Centers"}') ->> 'lead_id') as l2 \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST water","topic":"Water Quality"}') ->> 'lead_id') as l3 \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST race","topic":"Data Centers"}') ->> 'lead_id') as l4 \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST cap","topic":"Data Centers"}') ->> 'lead_id') as l5 \gset
set role service_role;
select 'P01|' || (public.weekly_perplexity_claim('sonar-pro') = '{"claimed": false, "reason": "nothing_due"}'::jsonb) || ' nothing is sent before a request exists';
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_send_to_research(:'l1', :'ed') ->> 'request_id') as r1 \gset
set role service_role;
select public.weekly_perplexity_claim('sonar-pro') as c1 \gset
reset role;
select 'P02|' || ((:'c1'::jsonb ->> 'claimed')::boolean and (:'c1'::jsonb ->> 'request_id') = :'r1' and (:'c1'::jsonb ->> 'attempt') = '1'
  and (:'c1'::jsonb ->> 'request_text') = (select request_text from public.weekly_research_requests where id = :'r1')) || ' the request is claimed word for word';
set role service_role;
select 'P03|' || ((public.weekly_perplexity_claim('sonar-pro') ->> 'reason') = 'nothing_due') || ' a running call is not sent twice';
select 'P04|' || pg_temp.raises(format('select public.weekly_perplexity_record(%L::uuid, %L)', :'c1'::jsonb ->> 'call_id', '   '), '22023') || ' an empty answer is refused';
select 'P05|' || pg_temp.raises($q$select public.weekly_perplexity_claim('Bad Model!')$q$, '22023') || ' a bad model name is refused';
select (public.weekly_perplexity_record((:'c1'::jsonb ->> 'call_id')::uuid, 'WEEKLY-ANSWER v1 TEST answer', '["https://example.test/a"]', null, '{"total_tokens": 10}') ->> 'answer_id') as a1 \gset
reset role;
select 'P06|' || exists (select 1 from public.weekly_research_answers where id = :'a1' and request_id = :'r1' and provider = 'perplexity'
  and mode = 'api' and raw_text = 'WEEKLY-ANSWER v1 TEST answer' and pasted_by = 'system:perplexity-api:sonar-pro') || ' the answer is saved as an API answer';
select 'P07|' || exists (select 1 from public.weekly_perplexity_calls where request_id = :'r1' and status = 'done' and answer_id = :'a1'
  and citations = '["https://example.test/a"]' and finished_at is not null) || ' the call records its citations';
select 'P08|' || ((public.weekly_request_research_status(:'r1') ->> 'answer_id') = :'a1') || ' the lead now has an answer';
set role service_role;
select 'P09|' || pg_temp.raises(format('select public.weekly_perplexity_record(%L::uuid, %L)', :'c1'::jsonb ->> 'call_id', 'again'), '55006') || ' a finished call cannot record twice';
select 'P10|' || ((public.weekly_perplexity_claim('sonar-pro') ->> 'reason') = 'nothing_due') || ' an answered request is never sent again';
-- three failures end the retries
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_send_to_research(:'l2', :'ed') ->> 'request_id') as r2 \gset
set role service_role;
select public.weekly_perplexity_fail((public.weekly_perplexity_claim('sonar-pro') ->> 'call_id')::uuid, 'HTTP 500');
select public.weekly_perplexity_claim('sonar-pro') as c22 \gset
select 'P11|' || ((:'c22'::jsonb ->> 'attempt') = '2' and (:'c22'::jsonb ->> 'request_id') = :'r2') || ' a failed call is retried';
-- a stale running call counts as a failure
reset role;
update public.weekly_perplexity_calls set started_at = now() - interval '16 minutes' where id = (:'c22'::jsonb ->> 'call_id')::uuid;
set role service_role;
select public.weekly_perplexity_claim('sonar-pro') as c23 \gset
reset role;
select 'P12|' || ((:'c23'::jsonb ->> 'attempt') = '3' and exists (select 1 from public.weekly_perplexity_calls where id = (:'c22'::jsonb ->> 'call_id')::uuid
  and status = 'failed' and error = 'no result was recorded within 15 minutes')) || ' a call with no result in 15 minutes is failed and retried';
set role service_role;
select public.weekly_perplexity_fail((:'c23'::jsonb ->> 'call_id')::uuid, 'HTTP 500');
select 'P13|' || ((public.weekly_perplexity_claim('sonar-pro') ->> 'reason') = 'nothing_due') || ' no fourth attempt';
-- a closed edition's request is not sent
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_send_to_research(:'l3', :'edw') ->> 'request_id') as r3 \gset
select public.hs_weekly_lead_disposition(:'l3', :'edw', 'dropped', 'TEST') is not null as c \gset
select public.hs_weekly_edition_close(:'edw', 'TEST closed') is not null as c \gset
set role service_role;
select 'P14|' || ((public.weekly_perplexity_claim('sonar-pro') ->> 'reason') = 'nothing_due') || ' a closed edition is not researched';
-- an answer pasted while a call runs wins; the call's answer is not saved
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_send_to_research(:'l4', :'ed') ->> 'request_id') as r4 \gset
set role service_role;
select public.weekly_perplexity_claim('sonar-pro') as c4 \gset
reset role;
insert into public.weekly_research_answers (request_id, provider, mode, raw_text, pasted_by) values (:'r4', 'perplexity', 'manual_paste', 'TEST pasted', 'founder@test.invalid');
set role service_role;
select 'P15|' || ((public.weekly_perplexity_record((:'c4'::jsonb ->> 'call_id')::uuid, 'TEST api') ->> 'reason') = 'already_answered') || ' a request answered by hand keeps that answer';
reset role;
select 'P16|' || ((select count(*) from public.weekly_research_answers where request_id = :'r4') = 1
  and exists (select 1 from public.weekly_perplexity_calls where id = (:'c4'::jsonb ->> 'call_id')::uuid and status = 'failed')) || ' and the call is closed';
-- the daily cap
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_send_to_research(:'l5', :'ed') ->> 'request_id') as r5 \gset
reset role;
insert into public.weekly_research_requests (topic, request_text, created_by)
  select 'Data Centers', 'TEST filler request number ' || g, 'founder@test.invalid' from generate_series(1, 15) g;
-- five calls so far (r1 once, r2 three times, r4 once) plus fifteen = 20
insert into public.weekly_perplexity_calls (request_id, attempt, model, request_sha256, status, finished_at, error)
  select id, 1, 'sonar-pro', request_sha256, 'failed', now(), 'TEST' from public.weekly_research_requests where request_text like 'TEST filler%';
set role service_role;
select 'P17|' || ((public.weekly_perplexity_claim('sonar-pro') ->> 'reason') = 'daily_cap') || ' no more than 20 calls in 24 hours';
reset role;
update public.weekly_perplexity_calls set started_at = now() - interval '25 hours' where request_id in (select id from public.weekly_research_requests where request_text like 'TEST filler%');
set role service_role;
select 'P18|' || ((public.weekly_perplexity_claim('sonar-pro') ->> 'request_id') = :'r5') || ' the cap counts only the last 24 hours';
-- who may call what
reset role;
select 'P19|' || (not has_function_privilege('authenticated', 'public.weekly_perplexity_claim(text)', 'execute')
  and not has_function_privilege('anon', 'public.weekly_perplexity_record(uuid,text,jsonb,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_perplexity_fail(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_perplexity_heartbeat(text,text)', 'execute')
  and has_function_privilege('service_role', 'public.weekly_perplexity_claim(text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_perplexity_status(uuid[])', 'execute')
  and not has_table_privilege('authenticated', 'public.weekly_perplexity_calls', 'select')
  and not has_table_privilege('anon', 'public.weekly_perplexity_sync', 'select')) || ' only the service role sends and records';
set role service_role;
select public.weekly_perplexity_heartbeat('no_key', 'PERPLEXITY_API_KEY is not set');
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_perplexity_status(array[:'r1', :'r2']::uuid[]) as st \gset
select 'P20|' || ((:'st'::jsonb -> 'requests' -> :'r1' -> 'answer' ->> 'raw_text') = 'WEEKLY-ANSWER v1 TEST answer'
  and jsonb_array_length(:'st'::jsonb -> 'requests' -> :'r2' -> 'calls') = 3
  and (:'st'::jsonb -> 'sync' ->> 'last_outcome') = 'no_key'
  and (:'st'::jsonb -> 'requests' -> :'r1' ->> 'due') = 'false') || ' the admin reader shows the answer, the attempts and the last check';
select set_config('test.jwt', :'stranger', false);
select 'P21|' || pg_temp.raises($q$select public.hs_weekly_perplexity_status('{}')$q$, '42501') || ' a non-admin cannot read it';
