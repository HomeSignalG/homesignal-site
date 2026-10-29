-- Executable acceptance suite for Engage on Bluesky (docs/impact-engagement.sql). Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', case when e is null then '' else json_build_object('email', e)::text end, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.newscan() returns uuid language plpgsql as $$ declare sid uuid; begin
  insert into public.impact_discovery_scans (trigger, requested_by) values ('manual', 'test') returning id into sid;
  perform public.impact_discovery_scan_claim(sid); return sid; end $$;
create function pg_temp.item(k text, score int, action text, cluster text, txt text default 'What happens next?',
                             mine jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('key', 'e-' || k, 'target_uri', 'at://did:plc:a/app.bsky.feed.post/' || k,
    'target_url', 'https://bsky.app/profile/a.bsky.social/post/' || k, 'cluster_key', cluster, 'topic_title', 'Topic',
    'author', 'a.bsky.social', 'text', 'post ' || k, 'created_at', now() - interval '3 hours', 'replies', 12, 'reposts', 4, 'likes', 30,
    'quotes', 1, 'score', score, 'action', action, 'score_parts', '{"conversation":20}'::jsonb, 'reasons', '["why"]'::jsonb,
    'draft', case when action = 'SKIP' then null else jsonb_build_object('text', txt, 'graphemes', char_length(txt), 'basis', 'questions_only') end,
    'already_engaged', mine) $$;
create function pg_temp.opp(k text) returns public.impact_engagement_opportunities language sql as $$
  select * from public.impact_engagement_opportunities where opp_key = 'e-' || k $$;

-- a recorded Hot Topic to attach to
select pg_temp.as_user(null);
select pg_temp.newscan();
select public.impact_discovery_scan_record((select id from public.impact_discovery_scans order by created_at desc limit 1), jsonb_build_array(
  jsonb_build_object('cluster_key', 'c:t1', 'category', 'data_centers', 'track', 'core', 'title', 'Topic one', 'lead_uri', 'at://x/1',
    'lead_url', 'https://bsky.app/profile/a.bsky.social/post/1', 'post_uris', jsonb_build_array('at://did:plc:a/app.bsky.feed.post/aaaaaaaaaa'),
    'score', 60, 'evidence_status', 'leads_found', 'timely', true)));
create temp table _s as select id from public.impact_discovery_scans order by created_at desc limit 1;

-- 1. access ------------------------------------------------------------------------------------------
select pg_temp.chk('1a no session: overview refused', pg_temp.err('select public.hs_impact_engagement_overview()') like '42501%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('1b non-admin: decide refused', pg_temp.err($q$select public.hs_impact_engagement_decide(gen_random_uuid(), 'skip')$q$) like '42501%');
select pg_temp.chk('1c anon executes nothing', not has_function_privilege('anon', 'public.hs_impact_engagement_overview()', 'execute')
  and not has_function_privilege('anon', 'public.hs_impact_engagement_decide(uuid, text, text, text, text)', 'execute'));
select pg_temp.chk('1d authenticated cannot call the scanner functions',
  not has_function_privilege('authenticated', 'public.impact_engagement_record(uuid, jsonb, jsonb, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.impact_engagement_context()', 'execute')
  and not has_function_privilege('authenticated', 'public._hs_ie_row(public.impact_engagement_opportunities, jsonb)', 'execute'));
select pg_temp.chk('1e service_role can', has_function_privilege('service_role', 'public.impact_engagement_record(uuid, jsonb, jsonb, jsonb)', 'execute'));
select pg_temp.chk('1f every table RLS-on with no browser grant', (select bool_and(c.relrowsecurity) and bool_and(not has_table_privilege('authenticated', c.oid, 'select'))
  from pg_class c where c.relname in ('impact_engagement_opportunities', 'impact_engagement_metrics', 'impact_engagement_runs', 'impact_engagement_events')));
select pg_temp.chk('1g nothing here publishes: no pg_net, no workflow dispatch, no social_posts / video job write',
  (select bool_and(p.prosrc !~* '(net\.http|_dispatch|social_posts|video_bluesky_jobs|impact_story_jobs|_hs_is_request)')
     from pg_proc p where p.proname like '%engagement%' or p.proname like '_hs_ie_%'));

-- 2. record ------------------------------------------------------------------------------------------
select pg_temp.as_user(null);
select pg_temp.chk('2a refused unless the scan is running', pg_temp.err($q$select public.impact_engagement_record(gen_random_uuid(), '[]', '[]', '[]')$q$) like '55000%');
select public.impact_engagement_record((select id from _s), jsonb_build_array(
  pg_temp.item('aaaaaaaaaa', 82, 'REPLY', 'c:t1'), pg_temp.item('bbbbbbbbbb', 70, 'QUOTE', 'c:t1'), pg_temp.item('cccccccccc', 20, 'SKIP', 'c:t1'),
  pg_temp.item('dddddddddd', 60, 'REPLY', 'c:none', 'q', '{"posted_uri":"at://did:plc:jody/app.bsky.feed.post/r1","action":"REPLY","posted_url":"https://bsky.app/profile/jodytracks.com/post/r1"}')),
  '[]', '[]');
select pg_temp.chk('2b one row per post, attached to its topic by cluster key or post uri',
  (select count(*) from public.impact_engagement_opportunities) = 4
  and (pg_temp.opp('aaaaaaaaaa')).candidate_id = (select id from public.impact_discovery_candidates where cluster_key = 'c:t1'));
select pg_temp.chk('2c a SKIP stores no draft', (pg_temp.opp('cccccccccc')).draft is null);
select pg_temp.chk('2d a post JODY already answered is recorded as already engaged, with its post',
  (pg_temp.opp('dddddddddd')).status = 'already_engaged' and (pg_temp.opp('dddddddddd')).posted_uri like 'at://did:plc:jody/%');
select pg_temp.chk('2e a draft over 300 characters is refused', pg_temp.err(format($q$select public.impact_engagement_record(%L, %L, '[]', '[]')$q$,
  (select id from _s), jsonb_build_array(pg_temp.item('eeeeeeeeee', 50, 'REPLY', 'c:t1', repeat('x', 301)))::text)) like '22023%');
select pg_temp.chk('2f the table refuses a long draft too', pg_temp.err($q$update public.impact_engagement_opportunities set draft = jsonb_build_object('text', repeat('y', 301)) where opp_key = 'e-aaaaaaaaaa'$q$) like '23514%');
select pg_temp.chk('2g a bad action is refused', pg_temp.err(format($q$select public.impact_engagement_record(%L, %L, '[]', '[]')$q$,
  (select id from _s), jsonb_build_array(pg_temp.item('ffffffffff', 50, 'LIKE', 'c:t1'))::text)) like '22023%');
select pg_temp.chk('2h a run is recorded', (select status from public.impact_engagement_runs where scan_id = (select id from _s)) = 'ok');

-- 3. overview: strongest first, separate from stories ----------------------------------------------
select pg_temp.as_user('founder@example.com');
create temp table _ov as select public.hs_impact_engagement_overview() j;
select pg_temp.chk('3a suggested strongest first, SKIP last, already-engaged not suggested',
  (select jsonb_agg(x->>'key') from jsonb_array_elements((select j->'suggested' from _ov)) x) = '["e-aaaaaaaaaa","e-bbbbbbbbbb","e-cccccccccc"]');
select pg_temp.chk('3b per-post counts, never topic totals', (select (j->'suggested'->0->>'replies')::int from _ov) = 12
  and (select j->'suggested'->0->>'topic_title' from _ov) = 'Topic one');
select pg_temp.chk('3c a posted row with no observation shows no result (a dash), not zero', (select j->'posted'->0->'result' from _ov) = 'null'::jsonb);

-- 4. decisions: never twice ------------------------------------------------------------------------
select pg_temp.chk('4a a link that is not a Bluesky post is refused',
  pg_temp.err(format($q$select public.hs_impact_engagement_decide(%L, 'mark_posted', 'https://evil.example/x')$q$, (pg_temp.opp('aaaaaaaaaa')).id)) like '22023%');
select public.hs_impact_engagement_decide((pg_temp.opp('aaaaaaaaaa')).id, 'mark_posted', null, 'What happens next? (edited)');
select pg_temp.chk('4b mark posted keeps the text as posted and who did it',
  (pg_temp.opp('aaaaaaaaaa')).status = 'posted' and (pg_temp.opp('aaaaaaaaaa')).posted_text = 'What happens next? (edited)'
  and (pg_temp.opp('aaaaaaaaaa')).decided_by = 'founder@example.com' and (pg_temp.opp('aaaaaaaaaa')).posted_action = 'REPLY');
select pg_temp.chk('4c a second Mark Posted is refused (no duplicate engagement)',
  pg_temp.err(format($q$select public.hs_impact_engagement_decide(%L, 'mark_posted')$q$, (pg_temp.opp('aaaaaaaaaa')).id)) like '55000%');
select pg_temp.chk('4d a posted row cannot be skipped', pg_temp.err(format($q$select public.hs_impact_engagement_decide(%L, 'skip')$q$, (pg_temp.opp('aaaaaaaaaa')).id)) like '55000%');
select public.hs_impact_engagement_decide((pg_temp.opp('bbbbbbbbbb')).id, 'skip', null, null, 'not our fight');
select pg_temp.chk('4e skip records the reason', (pg_temp.opp('bbbbbbbbbb')).status = 'skipped' and (pg_temp.opp('bbbbbbbbbb')).decision_note = 'not our fight');
select public.hs_impact_engagement_decide((pg_temp.opp('cccccccccc')).id, 'copied');
select pg_temp.chk('4f copy is recorded and changes nothing', (pg_temp.opp('cccccccccc')).status = 'suggested'
  and exists (select 1 from public.impact_engagement_events where kind = 'copied'));
select pg_temp.chk('4g events are append-only', pg_temp.err('delete from public.impact_engagement_events') is not null);

-- 5. the next scan never resets a decision; it finds the founder's post and reads its counts ---------
select pg_temp.as_user(null);
update public.impact_discovery_scans set status = 'success' where id = (select id from _s);
select pg_temp.newscan();
create temp table _s2 as select id from public.impact_discovery_scans order by created_at desc limit 1;
select public.impact_engagement_record((select id from _s2), jsonb_build_array(
  pg_temp.item('aaaaaaaaaa', 99, 'QUOTE', 'c:t1', 'new draft'), pg_temp.item('bbbbbbbbbb', 99, 'REPLY', 'c:t1', 'new draft')),
  jsonb_build_array(jsonb_build_object('id', (pg_temp.opp('aaaaaaaaaa')).id, 'posted_uri', 'at://did:plc:jody/app.bsky.feed.post/r2',
    'posted_url', 'https://bsky.app/profile/jodytracks.com/post/r2', 'action', 'REPLY')),
  jsonb_build_array(jsonb_build_object('posted_uri', 'at://did:plc:jody/app.bsky.feed.post/r2', 'replies', 3, 'reposts', 1, 'likes', 9)));
select pg_temp.chk('5a posted and skipped rows keep their decision, draft and action',
  (pg_temp.opp('aaaaaaaaaa')).status = 'posted' and (pg_temp.opp('aaaaaaaaaa')).draft->>'text' = 'What happens next?'
  and (pg_temp.opp('aaaaaaaaaa')).action = 'REPLY' and (pg_temp.opp('bbbbbbbbbb')).status = 'skipped');
select pg_temp.chk('5b counts on the original post still refresh', (pg_temp.opp('aaaaaaaaaa')).last_scan_id = (select id from _s2));
select pg_temp.chk('5c the founder''s post is found and its counts stored', (pg_temp.opp('aaaaaaaaaa')).posted_uri = 'at://did:plc:jody/app.bsky.feed.post/r2'
  and (select likes from public.impact_engagement_metrics where opportunity_id = (pg_temp.opp('aaaaaaaaaa')).id) = 9);
select pg_temp.chk('5d one founder post is never attached to two targets',
  pg_temp.err($q$update public.impact_engagement_opportunities set posted_uri = 'at://did:plc:jody/app.bsky.feed.post/r2' where opp_key = 'e-cccccccccc'$q$) like '23505%');

-- 6. attribution: utm_content = the opportunity key ------------------------------------------------
create table public.acquisition_touch (subject_type text, visitor_id uuid, user_id uuid, utm_campaign text, utm_content text, is_internal boolean default false);
insert into public.acquisition_touch values ('visitor', gen_random_uuid(), null, 'engage', 'e-aaaaaaaaaa', false),
  ('visitor', gen_random_uuid(), null, 'engage', 'e-aaaaaaaaaa', false), ('visitor', gen_random_uuid(), null, 'engage', 'e-aaaaaaaaaa', true),
  ('account', null, gen_random_uuid(), 'engage', 'e-aaaaaaaaaa', false), ('visitor', gen_random_uuid(), null, 'maps', 'e-aaaaaaaaaa', false);
select pg_temp.as_user('founder@example.com');
create temp table _ov2 as select public.hs_impact_engagement_overview() j;
select pg_temp.chk('6a visits and registrations per posted draft, internal and other campaigns excluded',
  (select (x->>'visits')::int = 2 and (x->>'registrations')::int = 1 from jsonb_array_elements((select j->'posted' from _ov2)) x where x->>'key' = 'e-aaaaaaaaaa'));
select pg_temp.chk('6b the latest observed result rides with the row', (select (x->'result'->>'likes')::int from jsonb_array_elements((select j->'posted' from _ov2)) x where x->>'key' = 'e-aaaaaaaaaa') = 9);
select pg_temp.chk('6c restore brings a skipped post back', (public.hs_impact_engagement_decide((pg_temp.opp('bbbbbbbbbb')).id, 'restore')->>'status') = 'suggested');

-- 7. failure is recorded, never silent ------------------------------------------------------------
select pg_temp.as_user(null);
select public.impact_engagement_run_failed((select id from _s2), 'Bluesky 502');
select pg_temp.chk('7a a failed engagement step is recorded with its reason', (select status = 'failed' and error = 'Bluesky 502' from public.impact_engagement_runs where scan_id = (select id from _s2)));

\o
select count(*) || ' checks passed' from _res where ok;
