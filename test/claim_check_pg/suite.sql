-- Executable acceptance suite for Tab 19 Data Center Claim Check (docs/claim-check.sql). Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', case when e is null then '' else json_build_object('email', e)::text end, false) $$;
create function pg_temp.err(q text) returns text language plpgsql as $$ begin execute q; return null; exception when others then return sqlstate || ' ' || sqlerrm; end $$;
create function pg_temp.src(k text, platform text default 'youtube') returns jsonb language sql as $$
  select jsonb_build_object('source_key', platform || ':' || k, 'platform', platform, 'publisher', 'Fox Business', 'url', 'https://www.youtube.com/watch?v=' || k,
    'embed_url', 'https://www.youtube-nocookie.com/embed/' || k, 'thumbnail_url', 'https://i.ytimg.com/vi/' || k || '/hqdefault.jpg',
    'title', 'Data center interview ' || k, 'published_at', now() - interval '1 day', 'rights', 'embed_only',
    'metrics', '{"views":1000,"comments":40}'::jsonb, 'adapter', 'youtube_broadcasters') $$;
create function pg_temp.clm(k text, srcs text[], lane text default 'trending') returns jsonb language sql as $$
  select jsonb_build_object('claim_key', k, 'lane', lane, 'topic', 'Topic ' || k, 'speaker_name', 'Kevin O''Leary',
    'source_keys', to_jsonb(srcs), 'trend_score', 72, 'score_parts', '{"shares":null}'::jsonb, 'score_confidence', 'low', 'significance', 50) $$;
create function pg_temp.good(verdict text default 'false') returns jsonb language sql as $$
  select jsonb_build_object('verdict', verdict, 'speaker_name', 'Kevin O''Leary', 'quote', 'The data center will use no water at all.',
    'quote_verified', true, 'quote_source_url', 'https://example.com/transcript', 'timestamp_s', 95, 'context', 'Asked about cooling.',
    'assertion', 'The project uses no water.', 'verdict_explanation', 'The state water permit application requests water for cooling.',
    'evidence', jsonb_build_object('supporting', '[]'::jsonb, 'contradicting', jsonb_build_array(jsonb_build_object(
      'url', 'https://waterrights.utah.gov/x', 'title', 'Application', 'finding', 'The application requests water for cooling.'))),
    'headline', 'O''Leary said the data center uses no water. Its permit says otherwise.',
    'post_text', '"The data center will use no water at all." The water-rights application says otherwise.') $$;
create function pg_temp.newscan() returns uuid language plpgsql as $$ declare sid uuid; begin
  insert into public.claim_check_scans (trigger, requested_by) values ('manual', 'test') returning id into sid;
  perform public.claim_check_scan_claim(sid); return sid; end $$;
create function pg_temp.cid(k text) returns uuid language sql as $$ select id from public.claim_check_claims where claim_key = k $$;
create function pg_temp.research(k text, body jsonb) returns jsonb language plpgsql as $$ declare r uuid; begin
  insert into public.claim_check_research_runs (claim_id, note, requested_by) values (pg_temp.cid(k), 'test', 'test') returning id into r;
  perform public.claim_check_research_claim(r);
  return public.claim_check_research_record(r, body); end $$;

-- 1. access --------------------------------------------------------------------------------------------
select pg_temp.chk('1a every table has RLS on', not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'claim_check_%' and c.relkind = 'r' and not c.relrowsecurity));
select pg_temp.chk('1b no table grant to anon/authenticated', not exists (select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name like 'claim_check_%' and grantee in ('anon', 'authenticated', 'PUBLIC')));
select pg_temp.chk('1c anon cannot call the overview', not has_function_privilege('anon', 'public.hs_claim_check_overview()', 'execute'));
select pg_temp.chk('1d authenticated cannot call the scanner door', not has_function_privilege('authenticated',
  'public.claim_check_scan_record(uuid,jsonb,jsonb,jsonb,jsonb)', 'execute'));
select pg_temp.chk('1e authenticated cannot record research', not has_function_privilege('authenticated', 'public.claim_check_research_record(uuid,jsonb,jsonb)', 'execute'));
select pg_temp.chk('1f anon may read the public export', has_function_privilege('anon', 'public.claim_check_public_export()', 'execute'));
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('1g a non-admin is refused', pg_temp.err('select public.hs_claim_check_overview()') like '42501%');
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('1h the admin reads the overview', (public.hs_claim_check_overview() ->> 'generated_at') is not null);
select pg_temp.chk('1i Kevin O''Leary is seeded on the watchlist', exists (select 1 from public.claim_check_people where slug = 'kevin-oleary' and status = 'active'));
select pg_temp.chk('1j weights must sum to 1', pg_temp.err($q$update public.claim_check_settings set weights = '{"shares":0.5}'$q$) like '23514%');

-- 2. scan -------------------------------------------------------------------------------------------------
do $$ declare sid uuid := pg_temp.newscan(); r jsonb; begin
  r := public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('vidA'), pg_temp.src('vidB')),
         jsonb_build_array(pg_temp.clm('k1', array['youtube:vidA']), pg_temp.clm('k2', array['youtube:nope'])),
         '[{"key":"youtube_broadcasters","status":"operational","stats":{"channels":12}},{"key":"bluesky","status":"unavailable","error":"no password"}]'::jsonb,
         '[{"name":"Jane Builder","organization":"Acme DC","reason":"appeared in 3 videos","appearances":3}]'::jsonb);
  perform pg_temp.chk('2a two sources recorded', (r->>'sources')::int = 2);
  perform pg_temp.chk('2b a claim with no known source is dropped', (r->>'claims_new')::int = 1 and pg_temp.cid('k2') is null);
  perform pg_temp.chk('2c a scan cannot set a verdict', pg_temp.err(format('select public.claim_check_scan_record(%L, %L, %L, %L)', sid, '[]',
     jsonb_build_array(pg_temp.clm('k3', array['youtube:vidA']) || '{"verdict":"false"}'), '[]')) like '42501%');
  perform pg_temp.chk('2d adapter status comes from the run', (select status from public.claim_check_adapters where key = 'youtube_broadcasters') = 'operational'
     and (select last_error from public.claim_check_adapters where key = 'bluesky') = 'no password');
  perform pg_temp.chk('2e the scanner suggests a person, not activates', (select status from public.claim_check_people where slug = 'jane-builder') = 'suggested');
  -- a second sighting moves metrics to metrics_prev
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('vidA') || '{"metrics":{"views":5000}}'), '[]', '[]');
  perform pg_temp.chk('2f metrics history kept', (select (metrics_prev->>'views')::int = 1000 and (metrics->>'views')::int = 5000
     from public.claim_check_sources where source_key = 'youtube:vidA'));
  -- a later scan fills a missing display name / speaker; it never replaces one already stored
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('bskyP', 'bluesky') || '{"source_key":"bsky:bskyP","publisher":null}'),
     jsonb_build_array(pg_temp.clm('kS', array['bsky:bskyP']) || '{"speaker_name":null}'), '[]');
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('bskyP', 'bluesky') || '{"source_key":"bsky:bskyP","publisher":"Aaron Rupar"}'),
     jsonb_build_array(pg_temp.clm('kS', array['bsky:bskyP']) || '{"speaker_name":"Donald Trump"}'), '[]');
  perform pg_temp.chk('2f2 a re-scan fills a missing publisher and speaker',
     (select publisher from public.claim_check_sources where source_key = 'bsky:bskyP') = 'Aaron Rupar'
     and (select speaker_name from public.claim_check_claims where claim_key = 'kS') = 'Donald Trump');
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('bskyP', 'bluesky') || '{"source_key":"bsky:bskyP","publisher":"Someone Else"}'),
     jsonb_build_array(pg_temp.clm('kS', array['bsky:bskyP']) || '{"speaker_name":"Someone Else"}'), '[]');
  perform pg_temp.chk('2f3 a re-scan never replaces a stored publisher or speaker',
     (select publisher from public.claim_check_sources where source_key = 'bsky:bskyP') = 'Aaron Rupar'
     and (select speaker_name from public.claim_check_claims where claim_key = 'kS') = 'Donald Trump');
  -- a scan that no longer finds a stored candidate checkable unlists it; the row stays, and a later scan can list it again
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('vidU')), jsonb_build_array(pg_temp.clm('kU', array['youtube:vidU'])), '[]');
  perform pg_temp.chk('2f4 a new claim is listed', (select listed from public.claim_check_claims where claim_key = 'kU')
     and exists (select 1 from jsonb_array_elements(public.hs_claim_check_overview()->'trending') e where e->>'id' = pg_temp.cid('kU')::text));
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('vidU')), jsonb_build_array(pg_temp.clm('kU', array['youtube:vidU'], 'emerging') || '{"listed":false}'), '[]');
  perform pg_temp.chk('2f5 an unlisted candidate leaves both lists but stays stored', pg_temp.cid('kU') is not null
     and not exists (select 1 from jsonb_array_elements(public.hs_claim_check_overview()->'trending') e where e->>'id' = pg_temp.cid('kU')::text)
     and not exists (select 1 from jsonb_array_elements(public.hs_claim_check_overview()->'emerging') e where e->>'id' = pg_temp.cid('kU')::text));
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('vidU')), jsonb_build_array(pg_temp.clm('kU', array['youtube:vidU'])), '[]');
  perform pg_temp.chk('2f6 a later scan lists it again', (select listed from public.claim_check_claims where claim_key = 'kU'));
  perform public.claim_check_scan_finish(sid, 'partial', '{}', '[{"kind":"bluesky"}]');
  perform pg_temp.chk('2g finishing twice is refused', pg_temp.err(format('select public.claim_check_scan_finish(%L, %L, %L, %L)', sid, 'ok', '{}', '[]')) like '55000%');
end $$;
select pg_temp.chk('2h a candidate has no verdict', (select verdict is null and status = 'candidate' from public.claim_check_claims where claim_key = 'k1'));
select pg_temp.chk('2i a bad source url is refused', pg_temp.err($q$insert into public.claim_check_sources (source_key, platform, url, adapter) values ('youtube:x', 'youtube', 'http://x', 'a')$q$) like '23514%');

-- 3. approval needs research ---------------------------------------------------------------------------------
select pg_temp.chk('3a a candidate cannot be approved', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L)', pg_temp.cid('k1'), 'approve')) like '55000%');
select pg_temp.chk('3b research without contradicting evidence fails for a false verdict',
  (pg_temp.research('k1', pg_temp.good() #- '{evidence,contradicting,0}') ->> 'ok')::boolean = false);
select pg_temp.chk('3c a failed research run leaves no verdict', (select verdict is null and status = 'needs_research' from public.claim_check_claims where claim_key = 'k1'));
select pg_temp.chk('3d an unverified quote cannot support false', (pg_temp.research('k1', pg_temp.good() || '{"quote_verified":false}') ->> 'ok')::boolean = false);
select pg_temp.chk('3e an evidence item without a url fails', (pg_temp.research('k1', jsonb_set(pg_temp.good(), '{evidence,contradicting,0,url}', '"ftp://x"')) ->> 'ok')::boolean = false);
select pg_temp.chk('3f good research passes', (pg_temp.research('k1', pg_temp.good()) ->> 'ok')::boolean);
select pg_temp.chk('3g the claim is ready for review', (select status = 'research_ready' and verdict = 'false' and research_version = 1 from public.claim_check_claims where claim_key = 'k1'));
select pg_temp.chk('3h research versions are append-only', pg_temp.err('delete from public.claim_check_research') like '42501%');
select pg_temp.chk('3i nothing is public before approval', jsonb_array_length(public.claim_check_public_export()) = 0);
select pg_temp.chk('3j a stale review is refused', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L, null, null, 0)', pg_temp.cid('k1'), 'approve')) like '40001%');
select pg_temp.chk('3k a post over 300 characters is refused', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L, null, %L)',
  pg_temp.cid('k1'), 'edit', jsonb_build_object('post_text', repeat('x', 301)))) like '22023%');
select pg_temp.chk('3l reject needs a reason', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L)', pg_temp.cid('k1'), 'reject')) like '22023%');

-- 4. approve, publish, correct ------------------------------------------------------------------------------
select pg_temp.chk('4a approve', (public.hs_claim_check_decide(pg_temp.cid('k1'), 'approve', null, null, 1) ->> 'status') = 'approved');
select pg_temp.chk('4b approval gives a slug and a public page', (select slug is not null and public_state = 'published' from public.claim_check_claims where claim_key = 'k1'));
select pg_temp.chk('4c the export carries the approved claim check only', jsonb_array_length(public.claim_check_public_export()) = 1
  and (public.claim_check_public_export() -> 0 ->> 'verdict') = 'false');
select pg_temp.chk('4d the export shows the embed for embed_only footage', (public.claim_check_public_export() -> 0 -> 'sources' -> 0 ->> 'embed_url') like 'https://www.youtube-nocookie.com/embed/%');
select pg_temp.chk('4e schedule is refused until the shared-slot schedule change is applied', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L)', pg_temp.cid('k1'), 'schedule')) like '55000%MAPS and video times%');
-- stand-in for homesignal-ingest's schedule authority (tested there): the next free MAPS or video time
create function public.bsky_next_slot_any(p_after timestamptz default null) returns table (kind text, slot timestamptz) language sql as $$
  select 'video'::text, date_trunc('hour', now()) + interval '1 day' + (select count(*) from public.claim_check_claims where bsky_status = 'scheduled') * interval '3 hours' $$;
update public.claim_check_settings set bsky_slots_enabled = true;
select pg_temp.chk('4e2 schedule takes the next shared time', (public.hs_claim_check_decide(pg_temp.cid('k1'), 'schedule') ->> 'bsky_status') = 'scheduled');
select pg_temp.chk('4e2b with its kind and time', (select bsky_slot_kind = 'video' and scheduled_slot > now() from public.claim_check_claims where claim_key = 'k1'));
select pg_temp.chk('4e3 scheduling twice is refused', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L)', pg_temp.cid('k1'), 'schedule')) like '55000%already scheduled%');
select pg_temp.chk('4e4 unschedule frees the time', (public.hs_claim_check_decide(pg_temp.cid('k1'), 'unschedule') ->> 'bsky_status') = 'none');
select pg_temp.chk('4e4b and clears it', (select scheduled_slot is null from public.claim_check_claims where claim_key = 'k1'));
select public.hs_claim_check_decide(pg_temp.cid('k1'), 'schedule');
select pg_temp.chk('4f an edit after approval needs approval again', (public.hs_claim_check_decide(pg_temp.cid('k1'), 'edit', null, '{"headline":"A shorter, plainer headline"}') ->> 'status') = 'research_ready');
select pg_temp.chk('4f2 an edit releases the booked Bluesky time', (select bsky_status = 'none' and scheduled_slot is null from public.claim_check_claims where claim_key = 'k1'));
select pg_temp.chk('4g the page stays published while re-approval waits', (select public_state = 'published' from public.claim_check_claims where claim_key = 'k1'));
select pg_temp.chk('4h skip is refused on a published claim', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L)', pg_temp.cid('k1'), 'skip')) like '55000%');
select pg_temp.chk('4i a correction needs a notice', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L)', pg_temp.cid('k1'), 'correct')) like '22023%');
select public.hs_claim_check_decide(pg_temp.cid('k1'), 'approve');
select public.hs_claim_check_decide(pg_temp.cid('k1'), 'schedule');
select public.hs_claim_check_decide(pg_temp.cid('k1'), 'correct', 'The timestamp was 1:35, not 1:53.');
select pg_temp.chk('4j a correction shows on the page', (public.claim_check_public_export() -> 0 ->> 'public_state') = 'corrected'
  and (public.claim_check_public_export() -> 0 -> 'corrections' -> 0 ->> 'note') like 'The timestamp%');
select pg_temp.chk('4j2 a scheduled post survives a correction', (select bsky_status = 'scheduled' from public.claim_check_claims where claim_key = 'k1'));
update public.claim_check_claims set bsky_status = 'published', published_at = now() where claim_key = 'k1';
select pg_temp.chk('4j3 a posted claim check cannot be edited', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L, null, %L)', pg_temp.cid('k1'), 'edit', '{"headline":"Another headline here"}')) like '55000%already on Bluesky%');
select pg_temp.chk('4k decisions are append-only', pg_temp.err('update public.claim_check_decisions set note = null') like '42501%');

-- 5. request research, people, scan now ---------------------------------------------------------------------
do $$ declare sid uuid := pg_temp.newscan(); begin
  perform public.claim_check_scan_record(sid, jsonb_build_array(pg_temp.src('vidC')), jsonb_build_array(pg_temp.clm('k5', array['youtube:vidC'], 'emerging')), '[]');
  perform public.claim_check_scan_finish(sid, 'ok', '{}', '[]');
end $$;
select pg_temp.chk('5a request_research needs a note', pg_temp.err(format('select public.hs_claim_check_decide(%L, %L)', pg_temp.cid('k5'), 'request_research')) like '22023%');
select public.hs_claim_check_decide(pg_temp.cid('k5'), 'request_research', 'Find the transcript.');
select pg_temp.chk('5b research is queued and dispatched', (select count(*) from public.claim_check_research_runs where claim_id = pg_temp.cid('k5') and status = 'queued') = 1);
select pg_temp.chk('5b2 dispatched', exists (select 1 from net.requests where url like '%claim-check-research-run.yml/dispatches'));
select public.hs_claim_check_decide(pg_temp.cid('k5'), 'request_research', 'Again.');
select pg_temp.chk('5c one active run per claim', (select count(*) from public.claim_check_research_runs where claim_id = pg_temp.cid('k5')) = 1);
select pg_temp.chk('5d the overview lists the emerging claim', jsonb_array_length(public.hs_claim_check_overview() -> 'emerging') = 1);
select pg_temp.chk('5e add a person', (public.hs_claim_check_person_save('{"name":"Ana Utility","organization":"Power Co","priority":"1"}') ->> 'status') = 'active');
select pg_temp.chk('5f a bad priority is refused', pg_temp.err($q$select public.hs_claim_check_person_save('{"name":"X Y","priority":"9"}')$q$) like '22023%');
select pg_temp.chk('5g activate a suggested person by saving it', (public.hs_claim_check_person_save(jsonb_build_object('id',
  (select id from public.claim_check_people where slug = 'jane-builder'), 'name', 'Jane Builder', 'priority', '2')) ->> 'status') = 'active');
select pg_temp.chk('5h remove a person', (public.hs_claim_check_person_status((select id from public.claim_check_people where slug = 'ana-utility'), 'removed') ->> 'status') = 'removed');
select pg_temp.chk('5i scan now queues one scan', (public.hs_claim_check_scan_now() -> 'scan' ->> 'status') = 'queued');
select pg_temp.chk('5i2 and dispatches it', exists (select 1 from net.requests where url like '%claim-check-scan.yml/dispatches'));
select pg_temp.chk('5j a second scan now returns the first', (public.hs_claim_check_scan_now() ->> 'existing')::boolean);
delete from vault.decrypted_secrets;
update public.claim_check_scans set status = 'failed' where status = 'queued';
select pg_temp.chk('5k no credential: the scan says so', (public.hs_claim_check_scan_now() -> 'scan' ->> 'status') = 'failed');

-- 6. analytics and the scheduler ------------------------------------------------------------------------------
insert into public.acquisition_touch (subject_type, utm_campaign, utm_content, visitor_id)
  values ('visitor', 'claim-check', (select slug from public.claim_check_claims where claim_key = 'k1'), gen_random_uuid());
select pg_temp.chk('6a analytics count claim-check visitors', (public.hs_claim_check_overview() -> 'analytics' -> 'site' ->> 'visitors')::int = 1);
select pg_temp.chk('6b analytics name what is not measured', jsonb_array_length(public.hs_claim_check_overview() -> 'analytics' -> 'unavailable') >= 2);
update public.claim_check_settings set scan_enabled = false;
select pg_temp.chk('6c ticks do nothing while scans are off', (public.claim_check_tick() ->> 'queued')::int = 0);
select pg_temp.chk('6d a stalled scan is closed by the tick', not exists (select 1 from public.claim_check_scans where status in ('queued','running') and created_at < now() - interval '2 hours'));

\o
select 'claim-check suite: ' || count(*) filter (where ok) || ' of ' || count(*) || ' checks passed' from _res;
