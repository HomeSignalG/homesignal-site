-- Executable acceptance suite for Impact Stories auto-discovery (docs/impact-discovery.sql). Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', case when e is null then '' else json_build_object('email', e)::text end, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create temp table _ids (k text primary key, v text);
create function pg_temp.id(k text) returns uuid language sql as $$ select v::uuid from _ids where _ids.k = id.k $$;
create function pg_temp.put(k text, v text) returns void language sql as $$ insert into _ids values (k, v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.cand(k text) returns public.impact_discovery_candidates language sql as $$
  select * from public.impact_discovery_candidates where cluster_key = k $$;
-- a candidate as the scanner sends it
create function pg_temp.c(k text, score int, ev text, timely boolean, track text default 'core', uris text[] default null,
                          links text[] default '{}', category text default 'data_centers') returns jsonb language sql as $$
  select jsonb_build_object('cluster_key', k, 'category', category, 'track', track, 'title', 'Topic ' || k, 'place', 'Somewhere, NY',
    'lead_uri', 'at://did:plc:x/app.bsky.feed.post/' || k, 'lead_url', 'https://bsky.app/profile/someone.bsky.social/post/' || k,
    'lead_author', 'someone.bsky.social', 'lead_created_at', now() - interval '5 hours',
    'post_uris', to_jsonb(coalesce(uris, array['at://did:plc:x/app.bsky.feed.post/' || k])), 'link_keys', to_jsonb(links),
    'related', jsonb_build_array(jsonb_build_object('uri', 'at://did:plc:x/app.bsky.feed.post/' || k, 'replies', 30, 'reposts', 12, 'likes', 80)),
    'metrics', '{"replies":30,"reposts":12,"likes":80}'::jsonb, 'score', score,
    'score_parts', jsonb_build_object('mission', 20, 'key_terms', jsonb_build_array('data center', k)),
    'reasons', '["test"]'::jsonb, 'evidence_status', ev, 'timely', timely,
    'evidence', jsonb_build_object('leads', case when ev = 'leads_found' then '[{"url":"https://example.gov/x","kind":"official"}]'::jsonb else '[]'::jsonb end),
    'concept', '{"hook":"?","verified":false}'::jsonb) $$;
create function pg_temp.scan() returns uuid language sql as $$ select id from public.impact_discovery_scans order by created_at desc limit 1 $$;
create function pg_temp.lastjob(s uuid) returns public.impact_story_jobs language sql as $$
  select * from public.impact_story_jobs where story_id = s order by created_at desc, attempts desc limit 1 $$;
create function pg_temp.work(s uuid, res jsonb) returns jsonb language plpgsql as $$ declare j uuid := (pg_temp.lastjob(s)).id; begin
  if not (public.hs_impact_story_job_claim(j)->>'claimed')::boolean then raise exception 'not claimable'; end if;
  return public.hs_impact_story_job_complete(j, res); end $$;
create function pg_temp.newscan() returns uuid language plpgsql as $$ declare sid uuid; begin
  insert into public.impact_discovery_scans (trigger, requested_by) values ('manual', 'test') returning id into sid;
  perform public.impact_discovery_scan_claim(sid); return sid; end $$;

create function pg_temp.newscan_unclaimed() returns uuid language sql as $$
  insert into public.impact_discovery_scans (trigger, requested_by) values ('manual', 'test') returning id $$;

-- 1. access ------------------------------------------------------------------------------------------
select pg_temp.as_user(null);
select pg_temp.chk('1a no session: overview refused', pg_temp.err('select public.hs_impact_discovery_overview()') like '42501%');
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('1b non-admin: scan now refused', pg_temp.err('select public.hs_impact_discovery_scan_now()') like '42501%');
select pg_temp.chk('1c non-admin: settings refused', pg_temp.err($q$select public.hs_impact_discovery_settings_save('{"nominate_score":10}')$q$) like '42501%');
select pg_temp.chk('1d anon cannot execute a founder function', not has_function_privilege('anon', 'public.hs_impact_discovery_overview(boolean)', 'execute'));
select pg_temp.chk('1e authenticated can execute the founder functions (each checks the allowlist)',
  has_function_privilege('authenticated', 'public.hs_impact_discovery_scan_now()', 'execute'));
select pg_temp.chk('1f authenticated cannot execute a scanner or research function',
  not has_function_privilege('authenticated', 'public.impact_discovery_scan_record(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.impact_discovery_research(uuid, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.impact_discovery_prepare(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.impact_discovery_tick(timestamptz)', 'execute'));
select pg_temp.chk('1g service_role can execute the scanner and research functions',
  has_function_privilege('service_role', 'public.impact_discovery_scan_claim(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.impact_discovery_prepare(uuid)', 'execute'));
select pg_temp.chk('1h the internal helpers are callable by no browser role',
  not has_function_privilege('authenticated', 'public._hs_id_create_story(uuid, text, boolean)', 'execute')
  and not has_function_privilege('anon', 'public._hs_id_dispatch(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public._hs_is_request(uuid, text, text, boolean, text)', 'execute'));
select pg_temp.chk('1i every discovery table has RLS on and no browser grant',
  (select bool_and(relrowsecurity) from pg_class where relname like 'impact_discovery%' and relkind = 'r')
  and (select count(*) from pg_class where relname like 'impact_discovery%' and relkind = 'r') = 8
  and not has_table_privilege('authenticated', 'public.impact_discovery_candidates', 'select')
  and not has_table_privilege('anon', 'public.impact_discovery_scans', 'select'));
select pg_temp.chk('1j settings are one row with the founder defaults (8:00 and 14:00 Pacific, 72h, 80, 1 per scan)',
  (select count(*) from public.impact_discovery_settings) = 1
  and (select scan_times = array['08:00','14:00'] and scan_tz = 'America/Los_Angeles' and window_hours = 72 and nominate_score = 80
          and max_prepare_per_scan = 1 and target_replies = 20 and target_likes = 50 and target_reposts = 10 and not experimental_auto
       from public.impact_discovery_settings));

-- 2. performance before the attribution tables exist: an explained absence, never zeros --------------------
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('2a performance with no attribution tables says so', public._hs_id_performance()->0 ? 'error');
select pg_temp.chk('2b learning is empty when performance cannot be measured', public._hs_id_learning() = '{}'::jsonb);

-- 3. Scan Now ----------------------------------------------------------------------------------------
select pg_temp.put('scan1', public.hs_impact_discovery_scan_now()->>'scan_id');
select pg_temp.chk('3a scan now queues a manual scan', (select status = 'queued' and trigger = 'manual' and requested_by = 'founder@example.com'
   from public.impact_discovery_scans where id = pg_temp.id('scan1')));
select pg_temp.chk('3b it dispatches impact-discovery-scan.yml on main with the scan id',
  (select url like '%/actions/workflows/impact-discovery-scan.yml/dispatches' and body->>'ref' = 'main' and body->'inputs'->>'scan_id' = pg_temp.id('scan1')::text
     from net.requests where id = (select dispatch_request_id from public.impact_discovery_scans where id = pg_temp.id('scan1'))));
select pg_temp.chk('3c a second press returns the scan already queued',
  (public.hs_impact_discovery_scan_now()->>'scan_id')::uuid = pg_temp.id('scan1')
  and (select count(*) from public.impact_discovery_scans) = 1);
update public.impact_discovery_scans set status = 'success', finished_at = now() where id = pg_temp.id('scan1');
select pg_temp.chk('3d a new scan within 5 minutes is refused with a reason', pg_temp.err('select public.hs_impact_discovery_scan_now()') like '%less than 5 minutes%');

-- 4. no credential: the scan fails with the reason, and the overview says so --------------------------------
update public.impact_discovery_scans set created_at = now() - interval '10 minutes' where id = pg_temp.id('scan1');
delete from vault.decrypted_secrets where name = 'github_actions_pat';
select pg_temp.put('scan2', public.hs_impact_discovery_scan_now()->>'scan_id');
select pg_temp.chk('4a with no credential the scan is failed with a readable reason, not queued forever',
  (select status = 'failed' and errors->0->>'message' like '%no GitHub credential%' from public.impact_discovery_scans where id = pg_temp.id('scan2')));
select pg_temp.chk('4b the overview shows the failure as the latest scan, and no false success',
  (public.hs_impact_discovery_overview()->'latest_scan'->>'status') = 'failed'
  and (public.hs_impact_discovery_overview()->'last_success'->>'id')::uuid = pg_temp.id('scan1'));
insert into vault.decrypted_secrets values ('github_actions_pat', 'test-pat');

-- 5. reap: a refused dispatch, a scan nobody started, a scan that stopped reporting -----------------------
insert into public.impact_discovery_scans (trigger, requested_by, dispatch_request_id) values ('manual', 't', 9001) returning id \gset r1_
select pg_temp.put('r1', :'r1_id');
insert into net._http_response (id, status_code) values (9001, 401);
insert into public.impact_discovery_scans (trigger, requested_by, created_at) values ('manual', 't', now() - interval '25 minutes') returning id \gset r2_
select pg_temp.put('r2', :'r2_id');
insert into public.impact_discovery_scans (trigger, requested_by, status, started_at) values ('manual', 't', 'running', now() - interval '50 minutes') returning id \gset r3_
select pg_temp.put('r3', :'r3_id');
select public._hs_id_reap();
select pg_temp.chk('5a a refused dispatch fails the scan with the HTTP code',
  (select status = 'failed' and errors->0->>'message' like '%HTTP 401%' from public.impact_discovery_scans where id = pg_temp.id('r1')));
select pg_temp.chk('5b a scan no runner started in 20 minutes is failed',
  (select status = 'failed' and errors->0->>'message' like '%within 20 minutes%' from public.impact_discovery_scans where id = pg_temp.id('r2')));
select pg_temp.chk('5c a running scan silent for 45 minutes is failed',
  (select status = 'failed' and errors->0->>'kind' = 'timeout' from public.impact_discovery_scans where id = pg_temp.id('r3')));

-- 6. the schedule: each slot once, only near its time, in Pacific time across the DST change -------------
create temp table _t as select public.impact_discovery_tick('2026-10-28 15:05+00') a;  -- 08:05 PDT
select pg_temp.chk('6a the 8:00 Pacific slot starts at 08:05 PDT', (select (a->>'scans_started')::int from _t) = 1
  and exists (select 1 from public.impact_discovery_scans where slot_key = '2026-10-28|08:00' and trigger = 'scheduled'));
select pg_temp.chk('6b the same slot never starts twice', (public.impact_discovery_tick('2026-10-28 15:15+00')->>'scans_started')::int = 0);
select pg_temp.chk('6c a slot is not started more than 3 hours late (no burst after an outage)',
  (public.impact_discovery_tick('2026-10-29 18:30+00')->>'scans_started')::int = 0
  and not exists (select 1 from public.impact_discovery_scans where slot_key = '2026-10-29|08:00'));
select pg_temp.chk('6d the 14:00 slot starts at 14:00 PDT', (public.impact_discovery_tick('2026-10-28 21:00+00')->>'scans_started')::int = 1);
select pg_temp.chk('6e after DST ends, 08:00 Pacific is 16:00 UTC, not 15:00',
  (public.impact_discovery_tick('2026-11-02 15:30+00')->>'scans_started')::int = 0
  and (public.impact_discovery_tick('2026-11-02 16:01+00')->>'scans_started')::int = 1);
select pg_temp.chk('6f next scan time is the next local slot', public._hs_id_next_scan('2026-10-28 16:00+00') = '2026-10-28 21:00+00'
  and public._hs_id_next_scan('2026-10-28 22:00+00') = '2026-10-29 15:00+00');
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('6g settings reject a bad time', pg_temp.err($q$select public.hs_impact_discovery_settings_save('{"scan_times":["8am"]}')$q$) like '%HH:MM%');
select pg_temp.chk('6h settings reject an unknown time zone', pg_temp.err($q$select public.hs_impact_discovery_settings_save('{"scan_tz":"Mars/Base"}')$q$) like '%Unknown time zone%');
select public.hs_impact_discovery_settings_save('{"scan_enabled":false}');
select pg_temp.chk('6i with scanning off nothing is scheduled and no next time is shown',
  (public.impact_discovery_tick('2026-10-30 15:05+00')->>'scans_started')::int = 0 and public._hs_id_next_scan(now()) is null);
select public.hs_impact_discovery_settings_save('{"scan_enabled":true,"scan_times":["09:30","08:00"]}');
select pg_temp.chk('6j saved times are kept in order', (select scan_times = array['08:00','09:30'] from public.impact_discovery_settings));
select public.hs_impact_discovery_settings_save('{"scan_times":["23:55"]}');
create temp table _t6k as select public.impact_discovery_tick('2026-10-29 07:00+00') a;   -- 00:00 PDT on the 29th
select pg_temp.chk('6k a 23:55 slot still starts after local midnight, under its own date',
  (select (a->>'scans_started')::int from _t6k) = 1
  and exists (select 1 from public.impact_discovery_scans where slot_key = '2026-10-28|23:55'));
select public.hs_impact_discovery_settings_save('{"scan_times":["08:00","14:00"]}');
update public.impact_discovery_scans set status = 'failed', finished_at = now() where status = 'queued';

-- 7. claim -------------------------------------------------------------------------------------------
insert into public.impact_discovery_scans (trigger, requested_by) values ('manual', 't') returning id \gset s_
select pg_temp.put('s', :'s_id');
select pg_temp.chk('7a a queued scan is claimed once', (public.impact_discovery_scan_claim(pg_temp.id('s'))->>'claimed')::boolean
  and not (public.impact_discovery_scan_claim(pg_temp.id('s'))->>'claimed')::boolean);
select pg_temp.chk('7b recording into a scan that is not running is refused',
  pg_temp.err(format($q$select public.impact_discovery_scan_record(%L, '[]')$q$, pg_temp.id('r1'))) like '%not running%');

-- 8. record: ranking gates and duplicates ----------------------------------------------------------------
select public.impact_discovery_scan_record(pg_temp.id('s'), jsonb_build_array(
  pg_temp.c('wny', 85, 'leads_found', true, links => array['news.example/wny']),          -- relevant, sourced, timely
  pg_temp.c('viral', 30, 'social_only', true, category => 'other'),                        -- viral but irrelevant
  pg_temp.c('rumor', 90, 'social_only', true),                                             -- high score, allegations only
  pg_temp.c('old', 70, 'leads_found', false),                                              -- old story, nothing new
  pg_temp.c('vote', 90, 'leads_found', true, 'experimental', category => 'elections'),     -- experimental track
  pg_temp.c('wny-dupe', 60, 'social_only', true, uris => array['at://did:plc:x/app.bsky.feed.post/wny'])));   -- same event
select pg_temp.chk('8a a relevant, sourced, timely topic at 85 is nominated', (pg_temp.cand('wny')).status = 'nominated'
  and (pg_temp.cand('wny')).nominated_scan_id = pg_temp.id('s'));
select pg_temp.chk('8b a viral irrelevant post is not nominated', (pg_temp.cand('viral')).status = 'open');
select pg_temp.chk('8c a topic with only social posts is never nominated, whatever its score', (pg_temp.cand('rumor')).status = 'open'
  and (pg_temp.cand('rumor')).evidence_status = 'social_only');
select pg_temp.chk('8d an old story with no new development is stale', (pg_temp.cand('old')).status = 'stale');
select pg_temp.chk('8e the experimental track is not nominated for automatic preparation', (pg_temp.cand('vote')).status = 'open');
select pg_temp.chk('8f a post already in a topic joins it instead of making a second topic',
  (pg_temp.cand('wny-dupe')).id is null and (select count(*) from public.impact_discovery_candidates) = 5);
select pg_temp.chk('8g observed metrics are stored per post', (select count(*) from public.impact_discovery_post_metrics) = 6);
select pg_temp.chk('8h a candidate without a Bluesky link is refused',
  pg_temp.err(format('select public.impact_discovery_scan_record(%L, %L)', pg_temp.id('s'),
     jsonb_build_array(pg_temp.c('bad', 50, 'social_only', true) || '{"lead_url":"https://evil.example/x"}'))) like '%without a Bluesky link%');
select pg_temp.chk('8i a scanner cannot claim research it did not do (verified is recorded as social_only)',
  (select pg_temp.err(format('select public.impact_discovery_scan_record(%L, %L)', pg_temp.id('s'),
     jsonb_build_array(pg_temp.c('fake', 95, 'verified', true))))) is null
  and (pg_temp.cand('fake')).evidence_status = 'social_only' and (pg_temp.cand('fake')).status = 'open');

-- 9. finish ------------------------------------------------------------------------------------------
create temp table _f as select public.impact_discovery_scan_finish(pg_temp.id('s'), 'success',
   '{"posts_examined":412,"queries_run":30,"api_calls":44,"clusters":17,"candidates_qualified":5}',
   '[]', '[{"category":"data_centers","term":"hyperscale campus","hits":3}]') r;
select pg_temp.chk('9a finish records the counts and the nominations', (select (r->>'ok')::boolean from _f)
  and (select posts_examined = 412 and candidates_nominated = 1 and status = 'success' from public.impact_discovery_scans where id = pg_temp.id('s')));
select pg_temp.chk('9b a learned term is stored for the next scan',
  exists (select 1 from public.impact_discovery_terms where term = 'hyperscale campus' and origin = 'expanded'));
select pg_temp.chk('9c a scan finishes once', not (public.impact_discovery_scan_finish(pg_temp.id('s'), 'failed', '{}', '[]', '[]')->>'ok')::boolean);
select pg_temp.put('sf', pg_temp.newscan()::text);
select public.impact_discovery_scan_finish(pg_temp.id('sf'), 'failed', '{"api_calls":1,"rate_limited":true}',
  '[{"kind":"bluesky","message":"Bluesky answered 429 Too Many Requests; nothing was recorded."}]', '[]');
select pg_temp.chk('9d a failed scan stores its error, writes no candidates, and is shown as failed',
  (select count(*) from public.impact_discovery_candidates where last_scan_id = pg_temp.id('sf')) = 0
  and (public.hs_impact_discovery_overview()->'latest_scan'->>'status') = 'failed'
  and (public.hs_impact_discovery_overview()->'latest_scan'->>'rate_limited')::boolean
  and (public.hs_impact_discovery_overview()->'latest_scan'->'errors'->0->>'message') like '%429%'
  and (public.hs_impact_discovery_overview()->'latest_scan'->>'posts_examined') is null);
select pg_temp.chk('9e the overview ranks core topics first, by score',
  (public.hs_impact_discovery_overview()->'candidates'->0->>'title') = 'Topic fake'
  and (select bool_and(x->>'track' = 'core') from jsonb_array_elements(public.hs_impact_discovery_overview()->'candidates') with ordinality t(x, n) where n <= 4));

-- 10. founder decisions ----------------------------------------------------------------------------------
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('10a a non-admin cannot reject', pg_temp.err(format($q$select public.hs_impact_discovery_decide(%L, 'reject')$q$, (pg_temp.cand('viral')).id)) like '42501%');
select pg_temp.as_user('founder@example.com');
select public.hs_impact_discovery_decide((pg_temp.cand('viral')).id, 'reject', 'Not a development story.');
select pg_temp.chk('10b reject hides it from the list, and show-closed shows it',
  not exists (select 1 from jsonb_array_elements(public.hs_impact_discovery_overview()->'candidates') x where x->>'title' = 'Topic viral')
  and exists (select 1 from jsonb_array_elements(public.hs_impact_discovery_overview(true)->'candidates') x where x->>'title' = 'Topic viral' and x->>'status' = 'rejected'));
select public.hs_impact_discovery_decide((pg_temp.cand('old')).id, 'exclude_similar');
select pg_temp.chk('10c exclude similar stores the topic''s terms and links for the scanner',
  (public.impact_discovery_scan_claim(pg_temp.newscan_unclaimed())->'exclusions'->0->'value'->'terms') ? 'old');
select pg_temp.put('s2', pg_temp.scan()::text);
select public.impact_discovery_scan_record(pg_temp.id('s2'), jsonb_build_array(pg_temp.c('viral', 99, 'leads_found', true)));
select pg_temp.chk('10d a later scan never undoes a founder decision', (pg_temp.cand('viral')).status = 'rejected');
select public.hs_impact_discovery_decide((pg_temp.cand('old')).id, 'restore');
select pg_temp.chk('10e restore brings it back and lifts its exclusion', (pg_temp.cand('old')).status = 'open'
  and not exists (select 1 from public.impact_discovery_exclusions where active));
select pg_temp.chk('10f every decision is in the append-only event log',
  (select count(*) from public.impact_discovery_events where kind = 'decision') = 3
  and pg_temp.err('delete from public.impact_discovery_events') is not null);

-- 11. research results -----------------------------------------------------------------------------------
select pg_temp.chk('11a insufficient needs the list of missing evidence',
  pg_temp.err(format($q$select public.impact_discovery_research(%L, '{"outcome":"insufficient"}')$q$, (pg_temp.cand('rumor')).id)) like '%missing evidence%');
select public.impact_discovery_research((pg_temp.cand('rumor')).id,
  '{"outcome":"insufficient","evidence":{"missing":["No agency record or independent report of the alleged spill."]}}');
select pg_temp.chk('11b a topic with no primary source stays a candidate and says what is missing',
  (pg_temp.cand('rumor')).status = 'insufficient' and (pg_temp.cand('rumor')).evidence->'missing'->>0 like 'No agency record%'
  and (pg_temp.cand('rumor')).story_id is null);
select pg_temp.chk('11c verified needs the source pack slug',
  pg_temp.err(format($q$select public.impact_discovery_research(%L, '{"outcome":"verified"}')$q$, (pg_temp.cand('wny')).id)) like '%source pack slug%');
select public.impact_discovery_research((pg_temp.cand('wny')).id, '{"outcome":"researching"}');
select public.impact_discovery_scan_record(pg_temp.id('s2'), jsonb_build_array(pg_temp.c('wny', 40, 'social_only', true)));
select pg_temp.chk('11d a scan never downgrades research in progress', (pg_temp.cand('wny')).status = 'researching'
  and (pg_temp.cand('wny')).evidence_status = 'researching');
select public.impact_discovery_research((pg_temp.cand('wny')).id,
  '{"outcome":"verified","source_slug":"wny-data-center","concept":{"hook":"Who decides?"}}');
select pg_temp.chk('11e verified records the slug and marks the concept verified',
  (pg_temp.cand('wny')).evidence_status = 'verified' and (pg_temp.cand('wny')).source_slug = 'wny-data-center'
  and ((pg_temp.cand('wny')).concept->>'verified')::boolean);
select pg_temp.chk('11f research on a topic the founder closed is refused',
  pg_temp.err(format($q$select public.impact_discovery_research(%L, '{"outcome":"researching"}')$q$, (pg_temp.cand('viral')).id)) like '%closed%');

select pg_temp.chk('11g the research session sees nominated and in-progress topics, and the library',
  (select jsonb_array_length(public.impact_discovery_nominations()->'nominated')) >= 1
  and public.impact_discovery_nominations() ? 'library'
  and not has_function_privilege('authenticated', 'public.impact_discovery_nominations()', 'execute'));

-- 12. prepare: only verified, at most one per scan, never twice ---------------------------------------------
select pg_temp.chk('12a an insufficient topic cannot become a story',
  pg_temp.err(format('select public.impact_discovery_prepare(%L)', (pg_temp.cand('rumor')).id)) like '%no verified source pack%');
select public.impact_discovery_research((pg_temp.cand('vote')).id, '{"outcome":"verified","source_slug":"county-election-office"}');
select pg_temp.chk('12b an experimental topic is not prepared automatically',
  pg_temp.err(format('select public.impact_discovery_prepare(%L)', (pg_temp.cand('vote')).id)) like '%not prepared automatically%');
select pg_temp.chk('12b2 an experimental topic is listed while the track is on',
  public.hs_impact_discovery_overview()->'candidates' @> jsonb_build_array(jsonb_build_object('id', (pg_temp.cand('vote')).id)));
update public.impact_discovery_settings set experimental_enabled = false where id;
select pg_temp.chk('12b3 turning the track off hides existing experimental topics too, closed ones included',
  not (public.hs_impact_discovery_overview()->'candidates' @> jsonb_build_array(jsonb_build_object('id', (pg_temp.cand('vote')).id)))
  and not (public.hs_impact_discovery_overview(true)->'candidates' @> jsonb_build_array(jsonb_build_object('id', (pg_temp.cand('vote')).id)))
  and jsonb_array_length(public.hs_impact_discovery_overview()->'candidates') > 0);
update public.impact_discovery_settings set experimental_enabled = true where id;
select pg_temp.put('st', public.impact_discovery_prepare((pg_temp.cand('wny')).id)->>'story_id');
select pg_temp.chk('12c prepare creates an auto-discovery story from the verified pack and queues Check Sources',
  (select origin = 'auto_discovery' and video_slug = 'wny-data-center' and discovery_candidate_id = (pg_temp.cand('wny')).id
     from public.impact_stories where id = pg_temp.id('st'))
  and (pg_temp.lastjob(pg_temp.id('st'))).kind = 'pack' and (pg_temp.cand('wny')).status = 'preparing');
select pg_temp.chk('12d preparing again returns the same story', (public.impact_discovery_prepare((pg_temp.cand('wny')).id)->>'story_id')::uuid = pg_temp.id('st')
  and (select count(*) from public.impact_stories) = 1);
update public.impact_discovery_candidates set nominated_scan_id = pg_temp.id('s') where cluster_key = 'old';
select public.impact_discovery_research((pg_temp.cand('old')).id, '{"outcome":"verified","source_slug":"another-pack"}');
select pg_temp.chk('12e a second story from the same scan is refused (limit 1)',
  pg_temp.err(format('select public.impact_discovery_prepare(%L)', (pg_temp.cand('old')).id)) like '%already prepared 1 story%');
select public.impact_discovery_research((pg_temp.cand('fake')).id, '{"outcome":"verified","source_slug":"wny-data-center"}');
select pg_temp.chk('12f a topic on the same source pack is marked a duplicate, never a second story',
  (public.impact_discovery_prepare((pg_temp.cand('fake')).id)->>'story_id')::uuid = pg_temp.id('st')
  and (pg_temp.cand('fake')).duplicate_of = (pg_temp.cand('wny')).id and (pg_temp.cand('fake')).story_id is null
  and (select count(*) from public.impact_stories) = 1);
select pg_temp.chk('12f2 the duplicate leaves the research queue (closed as dismissed)',
  (pg_temp.cand('fake')).status = 'dismissed'
  and not exists (select 1 from jsonb_array_elements(public.impact_discovery_nominations()->'nominated') x
                   where (x->>'id')::uuid = (pg_temp.cand('fake')).id));
select pg_temp.chk('12g the founder cannot reject a topic that already has a story',
  pg_temp.err(format($q$select public.hs_impact_discovery_decide(%L, 'reject')$q$, (pg_temp.cand('wny')).id)) like '%already has an Impact Story%');
select pg_temp.chk('12h the library lists the story as auto-discovered',
  exists (select 1 from jsonb_array_elements(public.hs_impact_story_list()) x where x->>'origin' = 'auto_discovery'));

select pg_temp.chk('12i story creation takes one shared lock before the cross-topic checks',
  position('pg_advisory_xact_lock' in pg_get_functiondef('public._hs_id_create_story(uuid,text,boolean)'::regprocedure)) > 0);

-- 13. the tick walks the story to Ready for Review, and stops there ------------------------------------------
select pg_temp.work(pg_temp.id('st'), jsonb_build_object('pack', jsonb_build_object('hash', 'h1', 'title', 'WNY', 'verified_at', now(),
  'fresh_days', 30, 'claims', '[{"id":"c1"},{"id":"c2"}]'::jsonb)));
select public.impact_discovery_tick();
select pg_temp.chk('13a after Check Sources the tick queues Analyze', (pg_temp.lastjob(pg_temp.id('st'))).kind = 'analyze');
select public.impact_discovery_tick();
select pg_temp.chk('13b a job in flight is never doubled', (select count(*) from public.impact_story_jobs where story_id = pg_temp.id('st') and kind = 'analyze') = 1);
select pg_temp.work(pg_temp.id('st'), jsonb_build_object('body', '{"schema":"impact-story/3","arc":{"fear":{}},"outline":[{"act":1}]}'::jsonb));
select public.impact_discovery_tick();
select pg_temp.chk('13c with an outline the tick queues Generate', (pg_temp.lastjob(pg_temp.id('st'))).kind = 'generate');
select pg_temp.work(pg_temp.id('st'), jsonb_build_object('body', '{"schema":"impact-story/3","arc":{"fear":{}},"outline":[{"act":1}],"main":{"acts":[]}}'::jsonb));
select public.impact_discovery_tick();
select pg_temp.chk('13d with a script the topic is Ready for Review and the story says so',
  (pg_temp.cand('wny')).status = 'ready_for_review'
  and exists (select 1 from public.impact_story_events where story_id = pg_temp.id('st') and kind = 'auto_discovery_ready'));
select public.impact_discovery_tick(); select public.impact_discovery_tick();
select pg_temp.chk('13e nothing is approved, rendered or published automatically',
  not exists (select 1 from public.impact_story_approvals where story_id = pg_temp.id('st'))
  and not exists (select 1 from public.impact_story_jobs where story_id = pg_temp.id('st') and kind = 'render')
  and (select count(*) from public.impact_story_events where story_id = pg_temp.id('st') and kind = 'auto_discovery_ready') = 1);
-- an out-of-date pack: the same gate as the founder's button, explained once
update public.impact_discovery_candidates set nominated_scan_id = null where cluster_key = 'old';
select pg_temp.put('st2', public.impact_discovery_prepare((pg_temp.cand('old')).id)->>'story_id');
select pg_temp.work(pg_temp.id('st2'), jsonb_build_object('pack', jsonb_build_object('hash', 'h2', 'title', 'Old', 'verified_at', now() - interval '40 days',
  'fresh_days', 30, 'claims', '[{"id":"c1"}]'::jsonb)));
select public.impact_discovery_tick(); select public.impact_discovery_tick();
select pg_temp.chk('13f an out-of-date pack is not analyzed; the reason is shown once',
  not exists (select 1 from public.impact_story_jobs where story_id = pg_temp.id('st2') and kind = 'analyze')
  and (pg_temp.cand('old')).status_note like '%out of date%'
  and (select count(*) from public.impact_discovery_events where kind = 'auto_advance_blocked') = 1);

-- 14. performance from first-party attribution only ----------------------------------------------------------
create table public.acquisition_touch (subject_type text, visitor_id text, user_id uuid, utm_campaign text, is_internal boolean default false);
create table public.report_snapshot (report_id uuid, generated_at timestamptz);
create table public.brokerage_paid_credit (report_id uuid);
create function public._report_account(p_report uuid, p_at timestamptz) returns table (user_id uuid) language sql as $$ select null::uuid $$;
insert into public.acquisition_touch (subject_type, visitor_id, utm_campaign)
  select 'visitor', 'v' || g, 'impact-' || left(pg_temp.id('st')::text, 8) from generate_series(1, 7) g;
insert into public.acquisition_touch (subject_type, visitor_id, utm_campaign, is_internal) values ('visitor', 'me', 'impact-' || left(pg_temp.id('st')::text, 8), true);
select pg_temp.chk('14a visits are counted per category from the story''s own campaign, without internal traffic',
  (select (x->>'visits')::int = 7 and x->>'youtube_retention' = 'not_collected' from jsonb_array_elements(public._hs_id_performance()) x
    where x->>'category' = 'data_centers'));
select pg_temp.chk('14b a handful of visits never moves the ranking', public._hs_id_learning() = '{}'::jsonb);

-- 15. coverage ---------------------------------------------------------------------------------------------
create table public.communities (id uuid default gen_random_uuid(), name text, county text, state text, level text);
insert into public.communities (name, county, state, level) values
  ('Lakewood (98499)', 'Pierce', 'WA', 'zip'), ('Tacoma (98402)', 'Pierce', 'WA', 'zip'), ('Seattle (98101)', 'King', 'WA', 'zip'),
  ('Pierce County, WA', 'Pierce', 'WA', 'county');
select pg_temp.chk('15a coverage counts the ZIP pages a county mention reaches',
  (public.impact_discovery_coverage('[{"state":"wa","county":"Pierce County"}]')->0->>'zip_pages')::int = 2
  and (public.impact_discovery_coverage('[{"state":"wa","city":"Seattle"}]')->0->>'zip_pages')::int = 1
  and (public.impact_discovery_coverage('[{"state":"NY","county":"Erie"}]')->0->>'zip_pages')::int = 0);

-- 16. the 60-topic limit keeps core topics first: 70 higher-scoring experimental topics cannot push a core topic out
update public.impact_discovery_settings set experimental_enabled = true where id;
insert into public.impact_discovery_candidates (cluster_key, category, track, title, lead_uri, lead_url, score, status)
select 'exp-' || g, 'elections', 'experimental', 'Experimental ' || g, 'at://x/' || g, 'https://bsky.app/profile/x/post/' || g, 99, 'open'
  from generate_series(1, 70) g;
select pg_temp.chk('16a core topics survive the 60-topic limit ahead of higher-scoring experimental ones',
  (select count(*) from jsonb_array_elements(public.hs_impact_discovery_overview()->'candidates') x where x->>'track' = 'core')
    = (select count(*) from public.impact_discovery_candidates where track = 'core' and status not in ('rejected', 'dismissed', 'excluded', 'stale'))
  and (select count(*) from jsonb_array_elements(public.hs_impact_discovery_overview()->'candidates') x where x->>'track' = 'core') > 0
  and jsonb_array_length(public.hs_impact_discovery_overview()->'candidates') = 60);


-- 17. founder-suggested topics ("Suggest a topic", 2026-10-28) --------------------------------------------
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('17a a non-admin cannot suggest a topic',
  pg_temp.err($q$select public.hs_impact_discovery_suggest('{"title":"Fill project next to a park"}')$q$) like '42501%');
select pg_temp.chk('17a2 anon cannot execute it; authenticated can (it checks the allowlist)',
  not has_function_privilege('anon', 'public.hs_impact_discovery_suggest(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_impact_discovery_suggest(jsonb)', 'execute'));
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('17b a too-short title is refused', pg_temp.err($q$select public.hs_impact_discovery_suggest('{"title":"abc"}')$q$) like '%5 to 300%');
select pg_temp.chk('17c a link that is not http(s) is refused',
  pg_temp.err($q$select public.hs_impact_discovery_suggest('{"title":"Van Tramp fill project","links":["javascript:alert(1)"]}')$q$) like '%not a web link%');
select pg_temp.chk('17c2 a bad category is refused',
  pg_temp.err($q$select public.hs_impact_discovery_suggest('{"title":"Van Tramp fill project","category":"Bad Cat!"}')$q$) like '%Unknown category%');
select pg_temp.put('f1', public.hs_impact_discovery_suggest(jsonb_build_object('title', 'Van Tramp fill project next to Wildwood Park',
  'place', 'Puyallup, WA', 'category', 'zoning_development', 'note', 'Up to 95 trucks a day.',
  'links', jsonb_build_array('https://www.cityofpuyallup.org/permit/123', ' https://www.cityofpuyallup.org/permit/123 ', 'https://news.example.com/story'))) ->> 'id');
select pg_temp.chk('17d the suggestion goes straight to research as a founder topic, with its links as leads and no Bluesky post',
  (select origin = 'founder' and status = 'nominated' and evidence_status = 'leads_found' and lead_url is null and lead_uri is null
     and submitted_by = 'founder@example.com' and submitted_note = 'Up to 95 trucks a day.' and track = 'core'
     and jsonb_array_length(evidence->'leads') = 2 and evidence->'leads'->0->>'kind' = 'founder' and post_uris = '{}' and link_keys = '{}'
     from public.impact_discovery_candidates where id = pg_temp.id('f1')));
select pg_temp.chk('17e the same title twice is refused while the first is open',
  pg_temp.err($q$select public.hs_impact_discovery_suggest('{"title":"VAN TRAMP FILL PROJECT NEXT TO WILDWOOD PARK"}')$q$) like '%already suggested%');
select pg_temp.put('f2', public.hs_impact_discovery_suggest('{"title":"Second founder topic, no links"}') ->> 'id');
select pg_temp.chk('17f a suggestion with no links is still queued, marked as having no sources yet',
  (select status = 'nominated' and evidence_status = 'social_only' from public.impact_discovery_candidates where id = pg_temp.id('f2')));
select pg_temp.chk('17g a scanned topic still needs its Bluesky lead',
  pg_temp.err($q$insert into public.impact_discovery_candidates (cluster_key, category, track, title) values ('x-nolead', 'other', 'core', 'No lead')$q$) like '%lead_check%');
select pg_temp.chk('17h founder topics are listed first in the overview, with their origin and note',
  public.hs_impact_discovery_overview()->'candidates'->0->>'origin' = 'founder'
  and public.hs_impact_discovery_overview()->'candidates' @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('f1'), 'submitted_note', 'Up to 95 trucks a day.')));
select pg_temp.chk('17i the research session sees founder topics first, with the note',
  public.impact_discovery_nominations()->'nominated'->0->>'origin' = 'founder'
  and public.impact_discovery_nominations()->'nominated' @> jsonb_build_array(jsonb_build_object('id', pg_temp.id('f1'), 'submitted_note', 'Up to 95 trucks a day.')));
select pg_temp.chk('17j a scan is never handed a founder topic to match against',
  not exists (select 1 from jsonb_array_elements(public.impact_discovery_scan_claim(pg_temp.newscan_unclaimed())->'open') x where x->>'id' = pg_temp.id('f1')::text));
select pg_temp.put('s17', pg_temp.scan()::text);
select pg_temp.chk('17k a scan can never take over a founder topic: a scan record carrying its key is refused, and the topic is unchanged',
  pg_temp.err(format('select public.impact_discovery_scan_record(%L, %L)', pg_temp.id('s17'),
    jsonb_build_array(pg_temp.c('founder-clash', 95, 'leads_found', true) || jsonb_build_object('cluster_key',
      (select cluster_key from public.impact_discovery_candidates where id = pg_temp.id('f1')))))) like '23505%'
  and (select title = 'Van Tramp fill project next to Wildwood Park' and lead_url is null and status = 'nominated' and score = 0
     from public.impact_discovery_candidates where id = pg_temp.id('f1')));
select pg_temp.chk('17l an unverified founder topic cannot become a story',
  pg_temp.err(format('select public.impact_discovery_prepare(%L)', pg_temp.id('f1'))) like '%no verified source pack%');
select public.impact_discovery_research(pg_temp.id('f1'), '{"outcome":"verified","source_slug":"van-tramp-fill-founder"}');
select public.impact_discovery_research(pg_temp.id('f2'), '{"outcome":"verified","source_slug":"second-founder-pack"}');
select pg_temp.put('fs1', public.impact_discovery_prepare(pg_temp.id('f1'))->>'story_id');
select pg_temp.put('fs2', public.impact_discovery_prepare(pg_temp.id('f2'))->>'story_id');
select pg_temp.chk('17m two founder topics can each be prepared (the per-scan limit is for scanned topics)',
  pg_temp.id('fs1') is not null and pg_temp.id('fs2') is not null and pg_temp.id('fs1') <> pg_temp.id('fs2')
  and (select count(*) from public.impact_stories where discovery_candidate_id in (pg_temp.id('f1'), pg_temp.id('f2'))) = 2
  and (select origin from public.impact_stories where id = pg_temp.id('fs1')) = 'auto_discovery');
select pg_temp.chk('17n preparing a founder topic again returns the same story',
  (public.impact_discovery_prepare(pg_temp.id('f1'))->>'story_id')::uuid = pg_temp.id('fs1'));
select pg_temp.put('f3', public.hs_impact_discovery_suggest('{"title":"Third founder topic"}') ->> 'id');
select public.hs_impact_discovery_decide(pg_temp.id('f3'), 'dismiss', 'not now');
select public.hs_impact_discovery_decide(pg_temp.id('f3'), 'restore', null);
select pg_temp.chk('17o a restored founder topic goes back to research, not to the candidate pile',
  (select status from public.impact_discovery_candidates where id = pg_temp.id('f3')) = 'nominated');
select pg_temp.chk('17p each suggestion is recorded in the event log',
  (select count(*) from public.impact_discovery_events where kind = 'suggested') = 3);


-- 18. Start research and Create video (founder, 2026-10-28) ----------------------------------------------
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('18a a non-admin cannot start research',
  pg_temp.err(format('select public.hs_impact_discovery_research_start(%L)', pg_temp.id('f3'))) like '42501%');
select pg_temp.chk('18b the research job functions are service-role only',
  not has_function_privilege('authenticated', 'public.impact_discovery_research_claim(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.impact_discovery_research_complete(uuid, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.impact_discovery_research_claim(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_impact_discovery_research_start(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hs_impact_discovery_research_start(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public._hs_id_research_dispatch(uuid)', 'execute'));
select pg_temp.as_user('founder@example.com');
select pg_temp.put('n0', (select count(*) from net.requests)::text);
select pg_temp.put('r1', public.hs_impact_discovery_research_start(pg_temp.id('f3'))->'research'->>'id');
select pg_temp.chk('18c Start research queues one run and starts the research workflow on main for it',
  (select status from public.impact_discovery_research_runs where id = pg_temp.id('r1')) = 'queued'
  and (select count(*) from net.requests where url like '%/impact-research-run.yml/dispatches'
         and body->>'ref' = 'main' and body->'inputs'->>'run' = pg_temp.id('r1')::text) = 1);
select pg_temp.put('r1b', public.hs_impact_discovery_research_start(pg_temp.id('f3'))->'research'->>'id');
select pg_temp.chk('18d pressing again while queued returns the same run and starts it again (a lost start is retried)',
  pg_temp.id('r1b') = pg_temp.id('r1')
  and (select count(*) from public.impact_discovery_research_runs where candidate_id = pg_temp.id('f3')) = 1
  and (select count(*) from net.requests where body->'inputs'->>'run' = pg_temp.id('r1')::text) = 2);
select pg_temp.chk('18e the overview shows the run on its topic',
  (select x->'research'->>'status' from jsonb_array_elements(public.hs_impact_discovery_overview()->'candidates') x
    where x->>'id' = pg_temp.id('f3')::text) = 'queued');
select pg_temp.chk('18f a closed topic, or one that already has a story, cannot be researched',
  pg_temp.err(format('select public.hs_impact_discovery_research_start(%L)', pg_temp.id('f1'))) like '%already has an Impact Story%');
select pg_temp.as_user(null);
create temp table _claim as select public.impact_discovery_research_claim(pg_temp.id('r1')) j;
select pg_temp.chk('18g claiming marks the topic as being researched and hands over the topic and the library',
  (select j->'candidate'->>'title' from _claim) = 'Third founder topic' and jsonb_typeof((select j->'library' from _claim)) = 'array'
  and (select status = 'researching' and evidence_status = 'researching' from public.impact_discovery_candidates where id = pg_temp.id('f3'))
  and (select status from public.impact_discovery_research_runs where id = pg_temp.id('r1')) = 'working');
select pg_temp.chk('18h a working run cannot be claimed twice',
  pg_temp.err(format('select public.impact_discovery_research_claim(%L)', pg_temp.id('r1'))) like '55000%');
select pg_temp.chk('18i a run cannot be closed as verified before the verified outcome is recorded',
  pg_temp.err(format($q$select public.impact_discovery_research_complete(%L, '{"status":"verified","summary":"x","source_slug":"third-pack"}')$q$, pg_temp.id('r1'))) like '%record the verified outcome%');
select public.impact_discovery_research_complete(pg_temp.id('r1'), '{"status":"failed","summary":"The runner stopped."}');
select pg_temp.chk('18j a failed run puts the topic back where it was (a founder pick waiting for research)',
  (select status = 'nominated' and evidence_status = 'social_only' from public.impact_discovery_candidates where id = pg_temp.id('f3'))
  and (select status from public.impact_discovery_research_runs where id = pg_temp.id('r1')) = 'failed');
select pg_temp.as_user('founder@example.com');
select pg_temp.put('r2', public.hs_impact_discovery_research_start(pg_temp.id('f3'))->'research'->>'id');
select pg_temp.as_user(null);
select public.impact_discovery_research_claim(pg_temp.id('r2'));
select public.impact_discovery_research(pg_temp.id('f3'), '{"outcome":"verified","source_slug":"third-pack","evidence":{"sources":[{"url":"https://example.gov/a"}]}}');
select pg_temp.put('rc', public.impact_discovery_research_complete(pg_temp.id('r2'), '{"status":"verified","summary":"Checked 4 records.","source_slug":"third-pack"}')::text);
select pg_temp.chk('18k a verified run creates the Impact Story for the founder who pressed the button, with its Check Sources job',
  (select story_id is not null and status = 'preparing' from public.impact_discovery_candidates where id = pg_temp.id('f3'))
  and (select created_by from public.impact_stories s join public.impact_discovery_candidates c on c.story_id = s.id where c.id = pg_temp.id('f3')) = 'founder@example.com'
  and (select story_id from public.impact_discovery_research_runs where id = pg_temp.id('r2'))
      = (select story_id from public.impact_discovery_candidates where id = pg_temp.id('f3'))
  and (pg_temp.lastjob((select story_id from public.impact_discovery_candidates where id = pg_temp.id('f3')))).kind = 'pack');
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('18l the overview shows the story is not ready for a video yet (no approved script)',
  (select x->'video'->>'narrative' <> 'approved' and (x->'video'->>'script_ready')::boolean = false
     from jsonb_array_elements(public.hs_impact_discovery_overview()->'candidates') x where x->>'id' = pg_temp.id('f3')::text));
select pg_temp.chk('18m Create video (Render) is refused until the script is approved',
  pg_temp.err(format('select public.hs_impact_story_render(%L, 0, false)',
    (select story_id from public.impact_discovery_candidates where id = pg_temp.id('f3')))) like '%Approve the integrated narrative%');

\o
select count(*) || ' checks passed' as result from _res where ok;
