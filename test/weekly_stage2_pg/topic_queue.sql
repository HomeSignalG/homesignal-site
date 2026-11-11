-- docs/weekly-topic-queue.sql on a DISPOSABLE Postgres (never production), after the Stage 2 file and the demonstration
-- seed (test/weekly_stage2_pg/build_demo_fixture.py --seed: an Air Quality library, script versions and a title).
-- Every line 'Qnn|true' is one check. Run by run_topic_queue.sh with -v leads=<test/fixtures/weekly-topic-leads.json>.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return code is null or sqlstate = code; end $$;
create or replace function pg_temp.raises_like(q text, code text, pat text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return sqlstate = code and sqlerrm like pat; end $$;
-- would the statement succeed? It is run and then undone, so the check itself changes nothing.
create or replace function pg_temp.would_succeed(q text) returns boolean language plpgsql as $$
begin execute q; raise exception 'undo' using errcode = 'P9999';
exception when sqlstate 'P9999' then return true; when others then return false; end $$;
grant execute on function pg_temp.raises(text, text), pg_temp.raises_like(text, text, text), pg_temp.would_succeed(text) to anon, authenticated, service_role;
\set admin '{"email":"founder@test.invalid"}'
\set other '{"email":"someone@test.invalid"}'
\set fmt 'TEST ANSWER FORMAT: answer only in the WEEKLY-ANSWER v1 format.'

-- Q01 no direct access to the three tables; RLS on; admin functions for authenticated only; internals for nobody
select 'Q01|' || (not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('weekly_editions', 'weekly_topic_leads', 'weekly_topic_lead_events')
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')))
  and (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
       and c.relname in ('weekly_editions', 'weekly_topic_leads', 'weekly_topic_lead_events') and c.relrowsecurity) = 3
  and has_function_privilege('authenticated', 'public.hs_weekly_lead_save(uuid,jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_weekly_lead_send_to_research(uuid,uuid,text)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_weekly_topic_queue(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_lead_save(uuid,jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_topic_queue(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public._wk_lead_assign(uuid,uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_lead_state(uuid)', 'execute'));
set role authenticated;
select set_config('test.jwt', :'other', false);
select 'Q02|' || (pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST not allowed"}')$q$, '42501')
  and pg_temp.raises($q$select public.hs_weekly_topic_queue()$q$, '42501')
  and pg_temp.raises($q$select public.hs_weekly_edition_create('Air Quality', '2026-11-09')$q$, '42501'));

-- CAPTURE. A title is enough; the lead is Captured, unassigned, not promised.
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_save(null, '{"title":"  TEST quick lead  "}') ->> 'lead_id') as lq \gset
reset role;
select 'Q03|' || ((select title = 'TEST quick lead' and topic is null and source_urls = '{}' and questions = '{}' and not promised_publicly
      and commitment_wording is null and commitment_post_url is null from public.weekly_topic_leads where id = :'lq')
  and (public.weekly_lead_state(:'lq') ->> 'status') = 'captured' and (public.weekly_lead_state(:'lq') ->> 'assigned') = 'false'
  and (select count(*) from public.weekly_topic_lead_events where lead_id = :'lq' and kind = 'captured') = 1);
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'Q04|' || (pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"   "}')$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"notes":"TEST no title"}')$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST","status":"published"}')$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST","source_urls":["not a url"]}')$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST","topic":"Not A Category"}')$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST","commitment_post_url":"https://social.example.test/post/1"}')$q$, '22023')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"title":""}')$q$, :'lq'), '22023')
  and pg_temp.raises($q$select public.hs_weekly_lead_save(gen_random_uuid(), '{"title":"TEST"}')$q$, '22023'));

-- The founder's two leads, from the test fixture: stored as given, UNVERIFIED, with no address and no commitment.
select (public.hs_weekly_lead_save(null, (:'leads'::jsonb -> 'leads' -> 0)) ->> 'lead_id') as l1 \gset
select (public.hs_weekly_lead_save(null, (:'leads'::jsonb -> 'leads' -> 1)) ->> 'lead_id') as l2 \gset
reset role;
select 'Q05|' || ((select title = 'SpaceX proposed Cochise County, Arizona data center' and topic = 'Data Centers' and location = 'Cochise County, Arizona'
      and cardinality(questions) = 6 and source_urls = '{}' and social_post_url is null and not promised_publicly
      and commitment_wording is null and notes like 'UNVERIFIED LEAD%' from public.weekly_topic_leads where id = :'l1')
  and (select title = 'Oregon lake drawdown and drinking-water concerns' and topic = 'Water Quality' and cardinality(questions) = 8
      and source_urls = '{}' and not promised_publicly and commitment_post_url is null from public.weekly_topic_leads where id = :'l2')
  and (:'leads'::jsonb ->> 'note') like '%NOT a durable live queue%');

-- A DRAFT commitment is not a public promise. The published post's address is what records one, and it then never changes.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_save(null, '{"title":"TEST promised lead","topic":"Air Quality","commitment_wording":"TEST: we will look into this next week."}') ->> 'lead_id') as lp \gset
select (public.hs_weekly_topic_queue() -> 'views' -> 'promised')::text as vp0 \gset
reset role;
select 'Q06|' || ((select not promised_publicly from public.weekly_topic_leads where id = :'lp') and :'vp0' = '[]'
  and (public.weekly_lead_state(:'lp') ->> 'promised_publicly') = 'false');
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_save(:'lp', '{"commitment_post_url":"https://social.example.test/post/42","social_post_url":"https://social.example.test/post/42"}') is not null as ok \gset
select (public.hs_weekly_topic_queue() -> 'views' -> 'promised') as vp1 \gset
select 'Q07|' || ((:'vp1'::jsonb) ? :'lp' and jsonb_array_length(:'vp1'::jsonb) = 1
  and pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"commitment_post_url":""}')$q$, :'lp'), '55000')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"commitment_post_url":"https://social.example.test/post/43"}')$q$, :'lp'), '55000')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"commitment_wording":"TEST: different words"}')$q$, :'lp'), '55000')
  -- other fields of a promised lead can still be edited
  and pg_temp.would_succeed(format($q$select public.hs_weekly_lead_save(%L, '{"notes":"TEST a later note"}')$q$, :'lp')));
reset role;
select 'Q07b|' || (pg_temp.raises(format($q$delete from public.weekly_topic_leads where id = %L$q$, :'lp'), '55000')
  and pg_temp.raises(format($q$update public.weekly_topic_leads set commitment_post_url = null, commitment_wording = null where id = %L$q$, :'lp'), '55000'));

-- EDITIONS: series, category, period and an identifier. Weekly by default; two editions in one week are allowed.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_edition_create('Data Centers', '2026-11-09')::text as edc \gset
select public.hs_weekly_edition_create('Data Centers', '2026-11-09')::text as edc2 \gset
select public.hs_weekly_edition_create('Air Quality', '2026-11-09', '2026-11-22', 'TEST Special Series', 'air-test-special')::text as eda \gset
select public.hs_weekly_edition_create('Air Quality', '2026-11-16')::text as eda2 \gset
select public.hs_weekly_edition_create('Water Quality', '2026-11-09')::text as edw \gset
select (:'edc'::jsonb ->> 'id') as ec, (:'edc2'::jsonb ->> 'id') as ec2, (:'eda'::jsonb ->> 'id') as ea, (:'eda2'::jsonb ->> 'id') as ea2, (:'edw'::jsonb ->> 'id') as ew \gset
select 'Q08|' || ((:'edc'::jsonb ->> 'edition_key') = 'data-centers-2026-11-09' and (:'edc'::jsonb ->> 'period_end') = '2026-11-15'
  and (:'edc'::jsonb ->> 'series') = 'QUALITY-of-LIFE Weekly Report' and (:'edc2'::jsonb ->> 'edition_key') = 'data-centers-2026-11-09-2'
  and (:'eda'::jsonb ->> 'edition_key') = 'air-test-special' and (:'eda'::jsonb ->> 'series') = 'TEST Special Series' and (:'eda'::jsonb ->> 'period_end') = '2026-11-22'
  and pg_temp.raises($q$select public.hs_weekly_edition_create('Air Quality', '2026-11-09', '2026-11-01')$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_edition_create('Not A Category', '2026-11-09')$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_edition_create('Air Quality', null)$q$, '22023')
  and pg_temp.raises($q$select public.hs_weekly_edition_create('Air Quality', '2026-11-09', null, null, 'air-test-special')$q$, '23505')
  and pg_temp.raises($q$select public.hs_weekly_edition_create('Air Quality', '2026-11-09', null, null, 'Bad Key')$q$, '22023'));

-- SEND TO RESEARCH needs an edition; capturing did not.
select 'Q09|' || (pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, null, %L)', :'l1', :'fmt'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, gen_random_uuid(), %L)', :'l1', :'fmt'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(gen_random_uuid(), %L, %L)', :'ec', :'fmt'), '22023'));
reset role;
select (select count(*) from net.calls) as calls0, (select count(*) from public.weekly_research_requests) as req0 \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_send_to_research(:'l1', :'ec', :'fmt')::text as h1 \gset
reset role;
select (:'h1'::jsonb ->> 'request_id') as rq1 \gset
-- one request, in the existing research table, in the edition's category, carrying the lead; linked both ways
select 'Q10|' || ((:'h1'::jsonb ->> 'existing') = 'false'
  and (select count(*) from public.weekly_research_requests) = :'req0'::integer + 1
  and (select topic = 'Data Centers' and created_by = 'founder@test.invalid'
        and request_text like '%SpaceX proposed Cochise County, Arizona data center%' and request_text like '%Location: Cochise County, Arizona%'
        and request_text like '%1. What is the power demand?%' and request_text like '%6. How can the public take part?%'
        and request_text like '%edition data-centers-2026-11-09%' and request_text like '%2026-11-09 to 2026-11-15%'
        and request_text like '%Public coverage commitment: none recorded%' and request_text like '%unverified lead%'
        and request_text like '%UNVERIFIED LEAD. No source address was supplied.%' and request_text like '%' || :'fmt'
      from public.weekly_research_requests where id = :'rq1'::uuid)
  and (select count(*) from public.weekly_topic_lead_events where lead_id = :'l1' and edition_id = :'ec' and kind in ('assigned', 'handoff')) = 2
  and (select request_id = :'rq1'::uuid from public.weekly_topic_lead_events where lead_id = :'l1' and kind = 'handoff')
  and (public.weekly_lead_state(:'l1') ->> 'status') = 'queued_for_research'
  and (public.weekly_lead_state(:'l1') -> 'current' ->> 'request_id') = :'rq1'
  and (public.weekly_lead_state(:'l1') -> 'current' -> 'edition' ->> 'id') = :'ec'
  -- nothing was dispatched, posted or started by the handoff
  and (select count(*) from net.calls) = :'calls0'::integer);
-- the existing research screen's read model lists the request, so the existing paste step picks it up
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'Q10b|' || exists (select 1 from jsonb_array_elements(public.hs_weekly_overview('Data Centers') -> 'requests') x where x ->> 'id' = :'rq1');

-- A REPEATED handoff for the same lead and edition returns the same request; nothing is written.
reset role;
select (select count(*) from public.weekly_topic_lead_events) as ev0 \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_send_to_research(:'l1', :'ec', :'fmt')::text as h1b \gset
select public.hs_weekly_lead_send_to_research(:'l1', :'ec', 'TEST: a different format text')::text as h1c \gset
reset role;
select 'Q11|' || ((:'h1b'::jsonb ->> 'request_id') = :'rq1' and (:'h1b'::jsonb ->> 'existing') = 'true' and (:'h1c'::jsonb ->> 'request_id') = :'rq1'
  and (select count(*) from public.weekly_research_requests) = :'req0'::integer + 1
  and (select count(*) from public.weekly_topic_lead_events) = :'ev0'::integer);
-- the database itself refuses a second request or a second assignment for the pair
select 'Q11b|' || (pg_temp.raises(format($q$insert into public.weekly_topic_lead_events (kind, lead_id, edition_id, request_id, actor)
      select 'handoff', %L, %L, id, 'x' from public.weekly_research_requests where id <> %L limit 1$q$, :'l1', :'ec', :'rq1'), '23505')
  and pg_temp.raises(format($q$insert into public.weekly_topic_lead_events (kind, lead_id, edition_id, actor) values ('assigned', %L, %L, 'x')$q$, :'l1', :'ec'), '23505')
  and pg_temp.raises(format($q$insert into public.weekly_topic_lead_events (kind, lead_id, edition_id, request_id, actor) values ('handoff', %L, %L, %L, 'x')$q$, :'l2', :'ew', :'rq1'), '23505'));

-- A FAILED handoff leaves the lead exactly as it was.
-- (a) wrong category: the Water lead into a Data Centers edition. The lead was unassigned and stays unassigned.
select public.weekly_lead_state(:'l2')::text as s2a, (select count(*) from public.weekly_topic_lead_events) as ev1 \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, %L, %L)', :'l2', :'ec', :'fmt'), '22023') as f2a \gset
reset role;
select 'Q12|' || (:'f2a' = 't' and public.weekly_lead_state(:'l2')::text = :'s2a' and (public.weekly_lead_state(:'l2') ->> 'status') = 'captured'
  and (select count(*) from public.weekly_research_requests) = :'req0'::integer + 1
  and (select count(*) from public.weekly_topic_lead_events) = :'ev1'::integer);
-- (b) the lead already has an assignment (edition A, no request yet): a handoff to another edition fails and the
--     existing assignment is still there, unchanged.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_save(null, '{"title":"TEST assigned lead","topic":"Data Centers"}') ->> 'lead_id') as lb \gset
select public.hs_weekly_lead_assign(:'lb', :'ec')::text as ab \gset
reset role;
select public.weekly_lead_state(:'lb')::text as sb0, (select count(*) from public.weekly_topic_lead_events) as ev2 \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, %L, %L)', :'lb', :'ec2', :'fmt'), '55006') as fb \gset
reset role;
select 'Q12b|' || (:'fb' = 't' and public.weekly_lead_state(:'lb')::text = :'sb0' and (:'ab'::jsonb ->> 'existing') = 'false'
  and (public.weekly_lead_state(:'lb') -> 'current' -> 'edition' ->> 'id') = :'ec' and (public.weekly_lead_state(:'lb') ->> 'status') = 'captured'
  and (public.weekly_lead_state(:'lb') -> 'current' ->> 'request_id') is null
  and (select count(*) from public.weekly_topic_lead_events) = :'ev2'::integer
  and (select count(*) from public.weekly_research_requests) = :'req0'::integer + 1);
-- (c) the request cannot be written (it would be too long): the assignment the lead had stays, no half-made handoff.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_save(:'lb', jsonb_build_object('notes', repeat('TEST note. ', 540), 'why_it_matters', repeat('w', 2000),
  'questions', (select jsonb_agg(repeat('q', 499)) from generate_series(1, 30)))) is not null as ok \gset
reset role;
select public.weekly_lead_state(:'lb')::text as sb1, (select count(*) from public.weekly_topic_lead_events) as ev3 \gset
set role authenticated;
select set_config('test.jwt', :'admin', false);
select pg_temp.raises_like(format('select public.hs_weekly_lead_send_to_research(%L, %L, %L)', :'lb', :'ec', :'fmt'), '22023', '%limit is 20000%') as fc \gset
-- (d) a brand-new lead whose handoff fails is not left assigned either
select (public.hs_weekly_lead_save(null, jsonb_build_object('title', 'TEST long lead', 'notes', repeat('TEST note. ', 540), 'why_it_matters', repeat('w', 2000),
  'questions', (select jsonb_agg(repeat('q', 499)) from generate_series(1, 30)))) ->> 'lead_id') as ll \gset
select pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, %L, %L)', :'ll', :'ec', :'fmt'), '22023') as fd \gset
reset role;
select 'Q12c|' || (:'fc' = 't' and public.weekly_lead_state(:'lb')::text = :'sb1'
  and (public.weekly_lead_state(:'lb') -> 'current' -> 'edition' ->> 'id') = :'ec'
  and (select count(*) from public.weekly_topic_lead_events) = :'ev3'::integer + 1          -- only the new lead's "captured"
  and :'fd' = 't' and (public.weekly_lead_state(:'ll') ->> 'assigned') = 'false' and (public.weekly_lead_state(:'ll') ->> 'status') = 'captured'
  and not exists (select 1 from public.weekly_topic_lead_events where lead_id = :'ll' and kind <> 'captured')
  and (select count(*) from public.weekly_research_requests) = :'req0'::integer + 1);

-- RESEARCH PROGRESS comes from the existing research records: answer pasted -> researching; ingest finished -> ready for review.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_paste_answer(:'rq1', 'TEST DATA pasted answer for the data center lead') ->> 'run_id') as rr1 \gset
reset role;
select 'Q13|' || ((public.weekly_lead_state(:'l1') ->> 'status') = 'researching'
  and (public.weekly_lead_state(:'l1') -> 'current' -> 'research' ->> 'run_status') = 'queued');
set role service_role;
select public.weekly_run_claim(:'rr1') is not null as ok \gset
select public.weekly_research_record(:'rr1', $j${"runner_seconds": 5,
  "sources": [{"ref": "s1", "url": "https://example.test/county-record", "publisher": "TEST County", "title": "TEST record",
     "quote": "TEST quoted sentence about the proposal", "retrieved_at": "2026-11-11T12:00:00Z", "quote_match": "not_found", "date_extraction": "not_stated"}],
  "findings": [{"finding_key": "dc-test-finding", "statement": "TEST: a data center is proposed.", "qualifiers": ["proposed"], "source_refs": ["s1"]}]}$j$::jsonb) is not null as ok \gset
reset role;
-- researched is not included and not published
select 'Q13b|' || ((public.weekly_lead_state(:'l1') ->> 'status') = 'ready_for_editorial_review'
  and (public.weekly_lead_state(:'l1') -> 'current' ->> 'disposition') is null);

-- DISPOSITION. Only for a lead assigned to that edition; a promised lead cannot be deferred or dropped without a reason.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_send_to_research(:'lp', :'ea', :'fmt')::text as hp \gset
select (:'hp'::jsonb ->> 'request_id') as rqp \gset
select 'Q14|' || (pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L)', :'lq', :'ea', 'included'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L)', :'lp', :'ea', 'published'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L)', :'lp', :'ea', 'deferred'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L, %L)', :'lp', :'ea', 'dropped', 'short'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L, %L)', :'lp', :'ea', 'deferred', '          '), '22023')
  -- a lead that was NOT promised can be deferred without one
  and pg_temp.would_succeed(format('select public.hs_weekly_lead_disposition(%L, %L, %L)', :'l1', :'ec', 'deferred')));
reset role;
-- the request carries the commitment as a commitment, not as evidence
select 'Q14b|' || (select request_text like '%PROMISED PUBLICLY in a published post (https://social.example.test/post/42): "TEST: we will look into this next week."%'
       and request_text like '%A promise to cover this is not a reason to confirm it.%' from public.weekly_research_requests where id = :'rqp'::uuid);
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_disposition(:'lp', :'ea', 'deferred', 'TEST: the county record is not public yet; carry to next week')::text as dp \gset
select public.hs_weekly_topic_queue(:'ea')::text as qa \gset
reset role;
-- deferred with its reason, no current assignment, still promised and still listed; kept in the edition's own list
select 'Q15|' || ((:'dp'::jsonb -> 'state' ->> 'status') = 'deferred' and (:'dp'::jsonb -> 'state' ->> 'assigned') = 'false'
  and (:'dp'::jsonb -> 'state' -> 'current') = 'null'::jsonb
  and (:'dp'::jsonb -> 'state' -> 'last_disposition' ->> 'reason') = 'TEST: the county record is not public yet; carry to next week'
  and (:'dp'::jsonb -> 'state' -> 'last_disposition' -> 'edition' ->> 'id') = :'ea'
  and (:'dp'::jsonb -> 'state' ->> 'promised_publicly') = 'true' and (:'dp'::jsonb -> 'state' ->> 'commitment_resolved') = 'false'
  and (:'qa'::jsonb -> 'views' -> 'deferred') ? :'lp' and (:'qa'::jsonb -> 'views' -> 'promised') ? :'lp'
  and not (:'qa'::jsonb -> 'views' -> 'inbox') ? :'lp' and not (:'qa'::jsonb -> 'views' -> 'research') ? :'lp'
  and exists (select 1 from jsonb_array_elements(:'qa'::jsonb -> 'views' -> 'edition') x where x ->> 'lead_id' = :'lp' and x ->> 'disposition' = 'deferred'
              and x ->> 'reason' like 'TEST: the county record%' and x ->> 'current' = 'false'));

-- CARRY FORWARD: the deferred lead goes to a later edition and is researched again (a NEW request for that edition).
-- Its earlier disposition and reason stay on record, apart from the current assignment.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_send_to_research(:'lp', :'ea', :'fmt')::text as hp_again \gset
select pg_temp.raises(format('select public.hs_weekly_lead_assign(%L, %L)', :'lp', :'ea'), '22023') as reassign_refused \gset
select public.hs_weekly_lead_send_to_research(:'lp', :'ea2', :'fmt')::text as hp2 \gset
reset role;
select 'Q16b|' || ((:'hp_again'::jsonb ->> 'request_id') = :'rqp' and (:'hp_again'::jsonb ->> 'existing') = 'true'
  and (:'hp_again'::jsonb -> 'state' ->> 'status') = 'deferred' and :'reassign_refused' = 't'
  and (:'hp2'::jsonb ->> 'existing') = 'false' and (:'hp2'::jsonb ->> 'request_id') <> :'rqp'
  and (:'hp2'::jsonb -> 'state' ->> 'status') = 'queued_for_research'
  and (:'hp2'::jsonb -> 'state' -> 'current' -> 'edition' ->> 'id') = :'ea2'
  and (:'hp2'::jsonb -> 'state' -> 'last_disposition' ->> 'disposition') = 'deferred'
  and (:'hp2'::jsonb -> 'state' -> 'last_disposition' -> 'edition' ->> 'id') = :'ea'
  and jsonb_array_length(:'hp2'::jsonb -> 'state' -> 'editions') = 2
  and (select count(*) from public.weekly_topic_lead_events where lead_id = :'lp' and kind = 'handoff') = 2);

-- APPROVAL GATE. Versions are linked to an edition explicitly; nothing is read from titles or dates.
select id as sv from public.weekly_scripts where stage = 'script' and topic = 'Air Quality'
  and not (public.weekly_version_status(id) ->> 'superseded')::boolean order by created_at desc limit 1 \gset
select id as tv from public.weekly_scripts where stage = 'title' and topic = 'Air Quality' order by created_at desc limit 1 \gset
select id as root from public.weekly_scripts where stage = 'angles' and topic = 'Air Quality' order by created_at limit 1 \gset
\set good '{"hook_conflict":3,"human_stakes":3,"emotional_force":3,"argument_coherence":3,"factual_discipline":4,"spoken_clarity":3,"closing":3}'
select 'Q17|' || (public.weekly_version_edition(:'sv') is null and public.weekly_version_edition(:'tv') is null);
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'Q17b|' || (pg_temp.raises(format('select public.hs_weekly_edition_link_version(%L, %L)', :'ec', :'root'), '22023')            -- another category
  and pg_temp.raises(format('select public.hs_weekly_edition_link_version(%L, gen_random_uuid())', :'ea2'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_edition_link_version(gen_random_uuid(), %L)', :'root'), '22023'));
-- unlinked: the script is approvable even though leads elsewhere are unresolved (checked, then undone)
select 'Q17c|' || pg_temp.would_succeed(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'sv', :'good'));
select public.hs_weekly_edition_link_version(:'ea2', :'root')::text as lk \gset
select public.hs_weekly_edition_link_version(:'ea2', :'root')::text as lk2 \gset
reset role;
-- the link reaches the versions made from the linked one (parent / written-from), and a version has one edition
select 'Q18|' || ((:'lk'::jsonb ->> 'existing') = 'false' and (:'lk2'::jsonb ->> 'existing') = 'true'
  and public.weekly_version_edition(:'root') = :'ea2'::uuid and public.weekly_version_edition(:'sv') = :'ea2'::uuid
  and public.weekly_version_edition(:'tv') = :'ea2'::uuid
  and (select count(*) from public.weekly_topic_lead_events where kind = 'version_linked') = 1);
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'Q18b|' || (pg_temp.raises(format('select public.hs_weekly_edition_link_version(%L, %L)', :'ea', :'sv'), '22023')
  -- BLOCKED: the promised lead is assigned to this edition and has no disposition there yet
  and pg_temp.raises_like(format('select public.hs_weekly_version_approve(%L::uuid, null, %L::jsonb)', :'sv', :'good'), '22023',
        '1 lead(s) assigned to edition air-quality-2026-11-16 have no disposition yet%TEST promised lead%'));
reset role;
select 'Q18c|' || (pg_temp.raises_like(format($q$insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, approved_by)
      select id, body_sha256, 'publication', 'x' from public.weekly_scripts where id = %L$q$, :'tv'), '22023', '%have no disposition yet%')
  -- a title's editorial approval is not the gated step
  and pg_temp.would_succeed(format($q$insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, approved_by)
      select id, body_sha256, 'editorial', 'x' from public.weekly_scripts where id = %L$q$, :'tv'))
  and not exists (select 1 from public.weekly_script_approvals where script_id = :'sv'));
-- Leads in other editions, and unassigned backlog leads, are still unresolved at this point and must not matter.
select 'Q19|' || ((select count(*) from public.weekly_edition_unresolved(:'ec')) >= 2
  and (select count(*) from public.weekly_topic_leads l where (public.weekly_lead_state(l.id) ->> 'assigned') = 'false') >= 2
  and (select count(*) from public.weekly_edition_unresolved(:'ea2')) = 1);
-- RELEASED: a person decides the lead for THIS edition (here: deferred again, with a reason; inclusion is never forced)
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_disposition(:'lp', :'ea2', 'deferred', 'TEST: still unverified; not included just because it was promised') is not null as ok \gset
select public.hs_weekly_version_approve(:'sv', null, :'good'::jsonb) is not null as approved \gset
reset role;
select 'Q20|' || (:'approved' = 't' and (select count(*) from public.weekly_script_approvals where script_id = :'sv') = 1
  and (select count(*) from public.weekly_edition_unresolved(:'ec')) >= 2
  and pg_temp.would_succeed(format($q$insert into public.weekly_script_approvals (script_id, body_sha256, approval_kind, approved_by)
      select id, body_sha256, 'publication', 'x' from public.weekly_scripts where id = %L$q$, :'tv'))
  and (public.weekly_lead_state(:'lp') ->> 'status') = 'deferred'
  and (public.weekly_lead_state(:'lp') -> 'last_disposition' -> 'edition' ->> 'id') = :'ea2');

-- CLOSING an edition. Every assigned lead needs a disposition; with no published video a reason is needed; afterwards
-- nothing in it changes, and its deferred lead is still in carry-forward with its reason.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'Q21|' || (pg_temp.raises_like(format('select public.hs_weekly_edition_close(%L, %L)', :'ec', 'TEST: closing the week'), '22023', '%have no disposition yet%')
  and pg_temp.raises(format('select public.hs_weekly_edition_close(%L)', :'ea'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_edition_close(%L, %L)', :'ea', 'short'), '22023'));
select public.hs_weekly_edition_close(:'ea', 'TEST: no video this week; the lead was deferred')::text as cl \gset
select public.hs_weekly_topic_queue(:'ea')::text as qc \gset
select 'Q22|' || ((:'cl'::jsonb ->> 'closed') = 'true' and (:'cl'::jsonb ->> 'published') = 'false'
  and pg_temp.raises(format('select public.hs_weekly_edition_close(%L, %L)', :'ea', 'TEST: closing it a second time'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_lead_assign(%L, %L)', :'lq', :'ea'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, %L, %L)', :'lq', :'ea', :'fmt'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L, %L)', :'lp', :'ea', 'included', 'TEST: changing a closed decision'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_edition_link_version(%L, %L)', :'ea', :'tv'), '22023')
  and (:'qc'::jsonb -> 'views' -> 'deferred') ? :'lp' and (:'qc'::jsonb -> 'views' -> 'promised') ? :'lp'
  and exists (select 1 from jsonb_array_elements(:'qc'::jsonb -> 'views' -> 'edition') x where x ->> 'lead_id' = :'lp'
              and x ->> 'disposition' = 'deferred' and x ->> 'reason' like 'TEST: the county record%')
  and exists (select 1 from jsonb_array_elements(:'qc'::jsonb -> 'leads') x where x ->> 'id' = :'lp'
              and jsonb_array_length(x -> 'state' -> 'editions') = 2));
reset role;
select 'Q22b|' || (pg_temp.raises(format($q$update public.weekly_editions set closed_at = null, closed_by = null where id = %L$q$, :'ea'), '55000')
  and pg_temp.raises(format($q$update public.weekly_editions set period_end = '2026-12-01' where id = %L$q$, :'ec'), '55000')
  and pg_temp.raises(format($q$delete from public.weekly_editions where id = %L$q$, :'ec2'), '55000')
  and pg_temp.raises($q$update public.weekly_topic_lead_events set reason = 'x'$q$, '55000')
  and pg_temp.raises($q$delete from public.weekly_topic_lead_events$q$, '55000'));

-- PUBLICATION: our video's URL AND its date, once; a lead's own source or social post is not our video.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_lead_save(:'l1', '{"source_urls":["https://news.example.test/story-about-the-data-center"]}') is not null as ok \gset
select 'Q23|' || (pg_temp.raises_like(format('select public.hs_weekly_edition_publish(%L, %L, %L)', :'ec', 'https://video.example.test/watch?v=TEST', '2026-11-10'), '22023', '%have no disposition yet%'));
select public.hs_weekly_lead_disposition(:'l1', :'ec', 'included') is not null as ok \gset
select public.hs_weekly_lead_disposition(:'lb', :'ec', 'dropped', 'TEST: a duplicate of another lead') is not null as ok \gset
reset role;
-- included is not published
select 'Q23b|' || ((public.weekly_lead_state(:'l1') ->> 'status') = 'included' and (public.weekly_lead_state(:'lb') ->> 'status') = 'dropped'
  and not exists (select 1 from public.weekly_editions where id = :'ec' and video_url is not null));
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'Q24|' || (pg_temp.raises(format('select public.hs_weekly_edition_publish(%L, %L, null)', :'ec', 'https://video.example.test/watch?v=TEST'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_edition_publish(%L, null, %L)', :'ec', '2026-11-10'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_edition_publish(%L, %L, %L)', :'ec', '   ', '2026-11-10'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_edition_publish(%L, %L, %L)', :'ec', 'http://video.example.test/watch', '2026-11-10'), '22023')
  and pg_temp.raises(format('select public.hs_weekly_edition_publish(%L, %L, %L)', :'ec', 'https://video.example.test/watch', (current_date + 30)::text), '22023')
  -- a source story and a social post are not our published video
  and pg_temp.raises_like(format('select public.hs_weekly_edition_publish(%L, %L, %L)', :'ec', 'https://news.example.test/story-about-the-data-center', '2026-11-10'), '22023', '%not our published video%')
  and pg_temp.raises_like(format('select public.hs_weekly_edition_publish(%L, %L, %L)', :'ec', 'https://social.example.test/post/42', '2026-11-10'), '22023', '%not our published video%'));
reset role;
select 'Q24b|' || pg_temp.raises(format($q$update public.weekly_editions set video_url = 'https://video.example.test/watch?v=TEST' where id = %L$q$, :'ec'), '23514');
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_edition_publish(:'ec', 'https://video.example.test/watch?v=TEST', '2026-11-10')::text as pb \gset
select public.hs_weekly_topic_queue(:'ec')::text as qp \gset
select 'Q25|' || ((:'pb'::jsonb ->> 'published') = 'true' and (:'pb'::jsonb ->> 'video_url') = 'https://video.example.test/watch?v=TEST'
  and (:'pb'::jsonb ->> 'published_on') = '2026-11-10'
  and (:'qp'::jsonb -> 'views' -> 'published') = jsonb_build_array(:'l1')
  and exists (select 1 from jsonb_array_elements(:'qp'::jsonb -> 'leads') x where x ->> 'id' = :'l1' and x -> 'state' ->> 'status' = 'published')
  and exists (select 1 from jsonb_array_elements(:'qp'::jsonb -> 'leads') x where x ->> 'id' = :'lb' and x -> 'state' ->> 'status' = 'dropped')
  and pg_temp.raises(format('select public.hs_weekly_edition_publish(%L, %L, %L)', :'ec', 'https://video.example.test/watch?v=OTHER', '2026-11-11'), '55000')
  -- the dropped lead, the published lead and the deferred lead are each where they belong; nothing is in two end states
  and not (:'qp'::jsonb -> 'views' -> 'published') ? :'lb' and not (:'qp'::jsonb -> 'views' -> 'published') ? :'lp'
  and (:'qp'::jsonb -> 'views' -> 'inbox') ? :'lq' and (:'qp'::jsonb -> 'views' -> 'inbox') ? :'l2' and not (:'qp'::jsonb -> 'views' -> 'inbox') ? :'l1');
reset role;
select 'Q25b|' || pg_temp.raises(format($q$update public.weekly_editions set video_url = 'https://video.example.test/other', published_on = '2026-11-12' where id = %L$q$, :'ec'), '55000');

-- A promised lead leaves the "promised" list only when it is resolved: dropped with a reason, or published.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select public.hs_weekly_edition_create('Air Quality', '2026-11-23')::text as eda3 \gset
select (:'eda3'::jsonb ->> 'id') as ea3 \gset
select public.hs_weekly_lead_assign(:'lp', :'ea3') is not null as ok \gset
select 'Q26|' || ((public.hs_weekly_topic_queue() -> 'views' -> 'promised') ? :'lp'
  and pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L)', :'lp', :'ea3', 'dropped'), '22023'));
select public.hs_weekly_lead_disposition(:'lp', :'ea3', 'dropped', 'TEST: the claim could not be confirmed from any primary record') is not null as ok \gset
select public.hs_weekly_topic_queue()::text as qz \gset
reset role;
select 'Q26b|' || (not (:'qz'::jsonb -> 'views' -> 'promised') ? :'lp' and (public.weekly_lead_state(:'lp') ->> 'status') = 'dropped'
  and (public.weekly_lead_state(:'lp') ->> 'promised_publicly') = 'true' and (public.weekly_lead_state(:'lp') ->> 'commitment_resolved') = 'true'
  and jsonb_array_length(public.weekly_lead_state(:'lp') -> 'editions') = 3
  and (select promised_publicly from public.weekly_topic_leads where id = :'lp'));

-- The queue never posted, dispatched or started anything of its own: the only dispatch since the first handoff is the
-- existing research ingest run started by pasting an answer.
select 'Q27|' || ((select count(*) from net.calls) = :'calls0'::integer + 1
  and (select url like '%/workflows/weekly-research-ingest.yml/dispatches' from net.calls order by id desc limit 1)
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
                  and p.proname in ('hs_weekly_lead_save', 'hs_weekly_lead_assign', 'hs_weekly_lead_send_to_research', 'hs_weekly_lead_disposition',
                                    'hs_weekly_edition_create', 'hs_weekly_edition_link_version', 'hs_weekly_edition_close', 'hs_weekly_edition_publish', '_wk_lead_assign')
                  and (p.prosrc ~* 'net\.http|_wk_dispatch|_wk_queue|weekly_runs|bluesky|youtube')));
