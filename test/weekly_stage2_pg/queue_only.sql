-- The QUEUE-ONLY release (docs/weekly-1-base.sql + docs/weekly-2-topic-queue.sql, nothing else) on a DISPOSABLE Postgres
-- (never production). Every line 'Knn|true' is one check. Run by run_queue_only.sh with -v leads=<the lead fixture>.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return code is null or sqlstate = code; end $$;
grant execute on function pg_temp.raises(text, text) to anon, authenticated, service_role;
\set admin '{"email":"founder@test.invalid"}'
\set other '{"email":"someone@test.invalid"}'
\set fmt 'TEST ANSWER FORMAT: answer only in the WEEKLY-ANSWER v1 format.'

-- K01 exactly the queue-only objects are installed: six tables, no script, source, finding or title object
select 'K01|' || ((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v') and c.relname like 'weekly\_%')
  = array['weekly_editions', 'weekly_research_answers', 'weekly_research_requests', 'weekly_runs', 'weekly_topic_lead_events', 'weekly_topic_leads']);
-- K02 the admin functions installed are the queue's eight, and only those
select 'K02|' || ((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'hs\_weekly\_%')
  = array['hs_weekly_edition_close', 'hs_weekly_edition_create', 'hs_weekly_edition_publish', 'hs_weekly_lead_assign', 'hs_weekly_lead_disposition',
          'hs_weekly_lead_save', 'hs_weekly_lead_send_to_research', 'hs_weekly_topic_queue']);
-- K03 NOTHING installed can dispatch a workflow, queue an engine run, save an answer or touch storage
select 'K03|' || (not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'weekly\_%' or p.proname like 'hs\_weekly\_%' or p.proname like '\_wk\_%')
      and p.prosrc ~* '(net\.http|_wk_dispatch|_wk_queue|insert\s+into\s+(public\.)?weekly_runs|insert\s+into\s+(public\.)?weekly_research_answers|storage\.|vault\.)')
  and to_regprocedure('public.hs_weekly_paste_answer(uuid,text)') is null and to_regprocedure('public._wk_dispatch(text,uuid)') is null
  and to_regprocedure('public.hs_weekly_edition_link_version(uuid,uuid)') is null and to_regclass('public.weekly_scripts') is null
  and not exists (select 1 from pg_trigger where tgname = 'weekly_edition_approval_gate'));
-- K04 access: no direct table access, RLS on all six; admin functions for authenticated only; a non-admin is refused
select 'K04|' || (not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'weekly\_%'
      and (has_table_privilege('anon', c.oid, 'select,insert,update,delete') or has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')
           or not c.relrowsecurity))
  and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'weekly\_%' or p.proname like 'hs\_weekly\_%' or p.proname like '\_wk\_%') and p.prorettype <> 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'execute') or (p.proname not like 'hs\_weekly\_%' and has_function_privilege('authenticated', p.oid, 'execute'))))
  and (select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and p.prosecdef) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'hs\_weekly\_%'));
set role authenticated;
select set_config('test.jwt', :'other', false);
select 'K05|' || (pg_temp.raises($q$select public.hs_weekly_lead_save(null, '{"title":"TEST not allowed"}')$q$, '42501')
  and pg_temp.raises($q$select public.hs_weekly_topic_queue()$q$, '42501')
  and pg_temp.raises($q$select public.hs_weekly_edition_create('Water Quality', '2026-11-09')$q$, '42501'));
set role anon;
select 'K05b|' || (pg_temp.raises($q$select public.hs_weekly_topic_queue()$q$, '42501') and pg_temp.raises($q$select count(*) from public.weekly_topic_leads$q$, '42501'));
reset role;

-- CAPTURE and RELOAD. A title is enough; the read model returns it on the next read.
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_save(null, '{"title":"TEST quick lead"}') ->> 'lead_id') as lq \gset
select public.hs_weekly_topic_queue() as q0 \gset
select 'K06|' || ((select x -> 'state' ->> 'status' = 'captured' and x ->> 'topic' is null and not (x ->> 'promised_publicly')::boolean
                   from jsonb_array_elements(:'q0'::jsonb -> 'leads') x where x ->> 'id' = :'lq')
  and (:'q0'::jsonb -> 'views' -> 'inbox') ? :'lq');
-- K07 the read model says what is NOT installed: no version linking, no answer processing
select 'K07|' || ((:'q0'::jsonb -> 'capabilities') = '{"version_linking": false, "answer_processing_installed": false}'::jsonb
  and (:'q0'::jsonb -> 'categories') @> '["Water Quality", "Data Centers", "Air Quality"]'::jsonb);

-- WATER and DATA CENTERS: the founder's two leads (test fixture, UNVERIFIED), each with an edition of its own category
select (public.hs_weekly_lead_save(null, (:'leads'::jsonb -> 'leads' -> 0)) ->> 'lead_id') as l1 \gset
select (public.hs_weekly_lead_save(null, (:'leads'::jsonb -> 'leads' -> 1)) ->> 'lead_id') as l2 \gset
select (public.hs_weekly_edition_create('Data Centers', '2026-11-09') ->> 'id') as ec \gset
select (public.hs_weekly_edition_create('Water Quality', '2026-11-09') ->> 'id') as ew \gset
select (public.hs_weekly_edition_create('Water Quality', '2026-11-16') ->> 'id') as ew2 \gset
-- PREPARE A RESEARCH REQUEST: one request is written and linked. Nothing is submitted, queued or dispatched.
select public.hs_weekly_lead_send_to_research(:'l1', :'ec', :'fmt') as h1 \gset
select public.hs_weekly_lead_send_to_research(:'l2', :'ew', :'fmt') as h2 \gset
select public.hs_weekly_lead_send_to_research(:'l2', :'ew', :'fmt') as h2b \gset
reset role;
select 'K08|' || ((:'h1'::jsonb ->> 'existing') = 'false' and (:'h2'::jsonb ->> 'existing') = 'false'
  and (:'h2b'::jsonb ->> 'existing') = 'true' and (:'h2b'::jsonb ->> 'request_id') = (:'h2'::jsonb ->> 'request_id')
  and (select count(*) from public.weekly_research_requests) = 2
  and (select topic from public.weekly_research_requests where id = (:'h1'::jsonb ->> 'request_id')::uuid) = 'Data Centers'
  and (select topic from public.weekly_research_requests where id = (:'h2'::jsonb ->> 'request_id')::uuid) = 'Water Quality'
  and (select request_text like '%1. Which lake is it?%' and request_text like '%8. What is the appeal status?%' and request_text like '%WEEKLY-ANSWER v1%'
       from public.weekly_research_requests where id = (:'h2'::jsonb ->> 'request_id')::uuid));
-- K09 a prepared request is NOT research in progress: the status stops at queued_for_research, and no run, answer or call exists
select 'K09|' || ((public.weekly_lead_state(:'l1') ->> 'status') = 'queued_for_research' and (public.weekly_lead_state(:'l2') ->> 'status') = 'queued_for_research'
  and (select count(*) from public.weekly_runs) = 0 and (select count(*) from public.weekly_research_answers) = 0
  and (select count(*) from net.calls) = 0);
-- K10 a request that cannot be prepared (wrong category) changes nothing
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'K10|' || (pg_temp.raises(format($q$select public.hs_weekly_lead_send_to_research(%L, %L, 'x')$q$, :'lq', null), '22023')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_send_to_research(%L, %L, 'x')$q$, :'l2', :'ec'), '22023'));
reset role;
select 'K10b|' || ((public.weekly_lead_state(:'l2') -> 'current' -> 'edition' ->> 'id') = :'ew' and (select count(*) from public.weekly_research_requests) = 2
  and (public.weekly_lead_state(:'lq') ->> 'status') = 'captured');

-- COMMITMENT TRACKING: wording alone is a draft; the published post's address makes it a promise, at every stage
set role authenticated;
select set_config('test.jwt', :'admin', false);
select (public.hs_weekly_lead_save(null, '{"title":"TEST draft promise","topic":"Water Quality","commitment_wording":"TEST: we may cover this."}') ->> 'lead_id') as ld \gset
select (public.hs_weekly_lead_save(null, '{"title":"TEST promised","topic":"Water Quality","commitment_wording":"TEST: we will cover this.","commitment_post_url":"https://social.example.test/post/9"}') ->> 'lead_id') as lp \gset
select public.hs_weekly_lead_assign(:'lp', :'ew') is not null as c \gset
select 'K11|' || (pg_temp.raises(format($q$select public.hs_weekly_lead_disposition(%L, %L, 'deferred')$q$, :'lp', :'ew'), '22023')
  and pg_temp.raises(format($q$select public.hs_weekly_lead_save(%L, '{"title":"TEST promised","commitment_post_url":"https://social.example.test/post/10"}')$q$, :'lp'), null));
-- DISPOSITION and CARRY FORWARD
select public.hs_weekly_lead_disposition(:'lp', :'ew', 'deferred', 'TEST: the record is not public yet') is not null as c \gset
select public.hs_weekly_lead_disposition(:'l2', :'ew', 'included') is not null as c \gset
select public.hs_weekly_topic_queue(:'ew') as q1 \gset
reset role;
select 'K12|' || (not (select promised_publicly from public.weekly_topic_leads where id = :'ld') and (select promised_publicly from public.weekly_topic_leads where id = :'lp')
  and (:'q1'::jsonb -> 'views' -> 'promised') ? :'lp' and not (:'q1'::jsonb -> 'views' -> 'promised') ? :'ld'
  and (:'q1'::jsonb -> 'views' -> 'deferred') ? :'lp'
  and (public.weekly_lead_state(:'lp') ->> 'status') = 'deferred' and (public.weekly_lead_state(:'lp') ->> 'assigned') = 'false'
  and (public.weekly_lead_state(:'lp') -> 'last_disposition' ->> 'reason') = 'TEST: the record is not public yet'
  and (public.weekly_lead_state(:'l2') ->> 'status') = 'included');
-- PUBLICATION needs our video's address AND its date; a lead's own post is not our video
set role authenticated;
select set_config('test.jwt', :'admin', false);
select 'K13|' || (pg_temp.raises(format($q$select public.hs_weekly_edition_publish(%L, 'https://video.example.test/watch?v=K', null)$q$, :'ew'), '22023')
  and pg_temp.raises(format($q$select public.hs_weekly_edition_publish(%L, null, current_date)$q$, :'ew'), '22023')
  and pg_temp.raises(format($q$select public.hs_weekly_edition_publish(%L, 'https://social.example.test/post/9', current_date)$q$, :'ew'), '22023'));
select public.hs_weekly_edition_publish(:'ew', 'https://video.example.test/watch?v=K', current_date) is not null as c \gset
-- the deferred promise is carried into the next Water edition; its earlier deferral and reason stay on record
select public.hs_weekly_lead_send_to_research(:'lp', :'ew2', :'fmt') as h3 \gset
select public.hs_weekly_topic_queue(:'ew2') as q2 \gset
reset role;
select 'K14|' || ((public.weekly_lead_state(:'l2') ->> 'status') = 'published'
  and (:'q2'::jsonb -> 'views' -> 'published') ? :'l2'
  and (public.weekly_lead_state(:'lp') ->> 'status') = 'queued_for_research' and (public.weekly_lead_state(:'lp') -> 'current' -> 'edition' ->> 'id') = :'ew2'
  and (select count(*) from jsonb_array_elements(public.weekly_lead_state(:'lp') -> 'editions') h
       where h ->> 'disposition' = 'deferred' and h ->> 'reason' = 'TEST: the record is not public yet' and h -> 'edition' ->> 'id' = :'ew') = 1
  and (:'q2'::jsonb -> 'views' -> 'promised') ? :'lp' and (:'h3'::jsonb ->> 'existing') = 'false'
  and (select bool_and(e -> 'linked_versions' = '[]'::jsonb) from jsonb_array_elements(:'q2'::jsonb -> 'editions') e));
-- K15 after the whole flow: still no engine run, no saved answer, no outbound call
select 'K15|' || ((select count(*) from public.weekly_runs) = 0 and (select count(*) from public.weekly_research_answers) = 0
  and (select count(*) from net.calls) = 0 and (select count(*) from public.weekly_research_requests) = 3);
