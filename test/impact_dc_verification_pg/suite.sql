-- Checks for docs/impact-dc-verification.sql. Output: name|t|detail (or |f|).
create temp table chk (n serial, name text, ok boolean, detail text);
create or replace function pg_temp.c1() returns uuid language sql as $$ select '11111111-1111-1111-1111-111111111111'::uuid $$;
create or replace function pg_temp.res(pk text, avail boolean, ready boolean, zip text default '20187') returns jsonb language sql as $$
  select jsonb_build_object('outcome', case when ready then 'verified' else 'missing_documentation' end,
    'match', jsonb_build_object('project_key', pk, 'zip', zip),
    'link', jsonb_build_object('available', avail), 'reply', jsonb_build_object('ready', ready)) $$;
-- claim exactly one candidate: park every other due job far in the future first
create or replace function pg_temp.claim(c uuid) returns uuid language plpgsql as $$
declare j jsonb; e jsonb;
begin
  update public.impact_dc_verification set next_attempt_at = now() + interval '100 days' where status = 'queued' and candidate_id <> c;
  update public.impact_dc_verification set next_attempt_at = now() - interval '1 second' where candidate_id = c and status = 'queued';
  j := public.impact_dc_verification_claim('suite', 20);
  for e in select * from jsonb_array_elements(j) loop
    if (e->>'candidate_id')::uuid = c then return (e->>'run_id')::uuid; end if;
  end loop;
  return null;
end $$;
create or replace function pg_temp.v(c uuid) returns public.impact_dc_verification language sql as $$
  select * from public.impact_dc_verification where candidate_id = c $$;
create or replace function pg_temp.view(c uuid) returns jsonb language sql as $$
  select public.impact_dc_verification_view(v) from public.impact_dc_verification v where candidate_id = c $$;

insert into public.fx_map values ('dcrec:a', 'found', '20187', 'dc:aaa', 'CyrusOne Vint Hill', 'Proposed', 'proposed', 38.75, -77.67, 'Vint Hill, VA', 'https://atlas.example/a');

-- 0. backfill and parity of the place rule
insert into chk (name, ok, detail) select 'B1 an existing data-center topic is queued by the backfill',
  (select status = 'queued' and queued_reason = 'backfill' and topic_fingerprint is not null from public.impact_dc_verification where candidate_id = '00000000-0000-0000-0000-000000000000'), null;
insert into chk (name, ok, detail) select 'B2 the ZIP rule equals Hot Topics coverage (' || p::text || ')',
  cardinality(public.impact_dc_topic_zips(p)) = (select coalesce(sum((x->>'zip_pages')::int), 0) from jsonb_array_elements(public.impact_discovery_coverage(p)) x),
  public.impact_dc_topic_zips(p)::text
from (values ('[{"state":"VA","county":"Fauquier County"}]'::jsonb), ('[{"state":"la","county":"Caddo"}]'), ('[{"state":"VA","city":"Ashburn"}]'),
             ('[{"state":"VA"}]'), ('[{"state":"VA","county":"Fauquier"},{"state":"TX","county":"Travis"}]'), ('[]')) t(p);
insert into chk (name, ok, detail) select 'B3 no places, or places that are not a list: no ZIPs',
  public.impact_dc_topic_zips('{}') = '{}' and public.impact_dc_topic_zips('null') = '{}' and public.impact_dc_topic_zips(null) = '{}', null;

-- 0b. places fallback, states, and the statewide name points (2026-11-13)
insert into chk (name, ok, detail) select 'Q1 coverage places are used when present',
  public.impact_dc_topic_places('{"places":[{"state":"VA","county":"Fauquier"}]}', 'Somewhere, TX') = '[{"state":"VA","county":"Fauquier"}]'::jsonb, null;
insert into chk (name, ok, detail) select 'Q2 no coverage places: "<county>, ST" becomes a county place',
  public.impact_dc_topic_zips(public.impact_dc_topic_places(null, 'Fauquier County, VA')) = '{20186,20187}'
  and public.impact_dc_topic_zips(public.impact_dc_topic_places('{"places":[]}', 'Ashburn, VA')) = '{20147}', null;
insert into chk (name, ok, detail) select 'Q3 a place that is not "<name>, ST" gives no places',
  public.impact_dc_topic_places(null, 'Minnesota') = '[]'::jsonb and public.impact_dc_topic_places(null, null) = '[]'::jsonb, null;
insert into chk (name, ok, detail) select 'Q4 states come from the places',
  public.impact_dc_topic_states('[{"state":"va"},{"state":"TX","county":"Travis"},{"state":null},{"state":"Texas"}]') = '{TX,VA}'
  and public.impact_dc_topic_states(null) = '{}', null;
insert into chk (name, ok, detail) select 'Q5 statewide name points: every current name of a confirmed, resolved point in the state''s ZIP pages',
  (select coalesce(array_agg(zip || ':' || project_name order by zip || ':' || project_name collate "C"), '{}')
     from public.impact_dc_state_name_points(array['va'])) = '{20147:Ashburn Plaza DC,20187:CyrusOne Vint Hill}',
  (select string_agg(zip || ':' || project_name, ',') from public.impact_dc_state_name_points(array['VA']));
insert into chk (name, ok, detail) select 'Q6 another state, or none, returns nothing',
  not exists (select 1 from public.impact_dc_state_name_points(array['TX'])) and not exists (select 1 from public.impact_dc_state_name_points(null)), null;

-- 1. topic trigger
insert into public.impact_discovery_candidates (id, category, title, place, coverage, evidence)
values (pg_temp.c1(), 'data_centers', 'CyrusOne Vint Hill expansion', 'Fauquier County, VA', '{"places":[{"state":"VA","county":"Fauquier"}]}',
        '{"leads":[{"url":"https://www.fauquiercounty.gov/a.pdf"}]}');
insert into public.impact_discovery_candidates (id, category, title) values ('22222222-2222-2222-2222-222222222222', 'water', 'Not a data center');
insert into chk (name, ok, detail) select 'T1 a new data-center topic is queued once', (select count(*) = 1 and bool_and(status = 'queued' and queued_reason = 'topic_new' and attempts = 0) from public.impact_dc_verification where candidate_id = pg_temp.c1()), null;
insert into chk (name, ok, detail) select 'T2 another category is not queued', not exists (select 1 from public.impact_dc_verification where candidate_id = '22222222-2222-2222-2222-222222222222'), null;

-- 2. claim, duplicate prevention, rerun while running
select set_config('fx.run', pg_temp.claim(pg_temp.c1())::text, false);
insert into chk (name, ok, detail) select 'C1 the claim starts one run with the topic and its ZIPs',
  current_setting('fx.run') <> '' and (pg_temp.v(pg_temp.c1())).status = 'running'
  and (select count(*) = 1 from public.impact_dc_verification_runs where candidate_id = pg_temp.c1() and outcome = 'running'), current_setting('fx.run');
insert into chk (name, ok, detail) select 'C2 the claim carries the ZIP pages of the topic''s places',
  (select (e->'candidate'->'zips') = '["20186","20187"]'::jsonb from jsonb_array_elements(
     (select jsonb_agg(x) from (select jsonb_build_object('candidate', jsonb_build_object('zips', to_jsonb(public.impact_dc_topic_zips(coverage->'places')))) x
        from public.impact_discovery_candidates where id = pg_temp.c1()) s)) e), null;
update public.impact_dc_verification set next_attempt_at = now() - interval '1 second' where candidate_id = pg_temp.c1();
insert into chk (name, ok, detail) select 'C3 a running job is never claimed twice',
  not exists (select 1 from jsonb_array_elements(public.impact_dc_verification_claim('suite', 20)) e where (e->>'candidate_id')::uuid = pg_temp.c1()), null;
update public.impact_discovery_candidates set title = 'CyrusOne Vint Hill expansion vote' where id = pg_temp.c1();
insert into chk (name, ok, detail) select 'C4 a topic change while running asks for a rerun, not a second job',
  (pg_temp.v(pg_temp.c1())).status = 'running' and (pg_temp.v(pg_temp.c1())).rerun_requested, null;
select public.impact_dc_verification_record(current_setting('fx.run')::uuid, pg_temp.res('dcrec:a', true, true));
insert into chk (name, ok, detail) select 'C5 recording a run with a rerun pending queues it again', (pg_temp.v(pg_temp.c1())).status = 'queued'
  and (pg_temp.v(pg_temp.c1())).result is not null and ((pg_temp.v(pg_temp.c1())).result_facts->>'map_key') = 'dc:aaa', (pg_temp.v(pg_temp.c1())).result_facts::text;
insert into chk (name, ok, detail) select 'C6 that result is stale: the topic changed after the run started',
  pg_temp.view(pg_temp.c1())->>'freshness' = 'stale' and not (pg_temp.view(pg_temp.c1())->>'reply_ready')::boolean
  and not (pg_temp.view(pg_temp.c1())->>'link_available')::boolean, (pg_temp.view(pg_temp.c1()))->>'stale_reasons';
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true));
insert into chk (name, ok, detail) select 'C7 a fresh result is current, its link available and its reply ready',
  (pg_temp.v(pg_temp.c1())).status = 'done' and pg_temp.view(pg_temp.c1())->>'freshness' = 'current'
  and (pg_temp.view(pg_temp.c1())->>'link_available')::boolean and (pg_temp.view(pg_temp.c1())->>'reply_ready')::boolean, pg_temp.view(pg_temp.c1())::text;

-- 3. topic edits that do and do not matter
-- a scan re-records the topic: the same title and evidence written again, a new score
update public.impact_discovery_candidates set title = title, evidence = evidence, coverage = coverage, score = 77, metrics = '{"likes":4}', last_seen_at = now() where id = pg_temp.c1();
insert into chk (name, ok, detail) select 'T3 a score or metrics change touches nothing', (pg_temp.v(pg_temp.c1())).status = 'done' and pg_temp.view(pg_temp.c1())->>'freshness' = 'current', null;
update public.impact_discovery_candidates set evidence = '{"leads":[{"url":"https://www.fauquiercounty.gov/b.pdf"}]}' where id = pg_temp.c1();
insert into chk (name, ok, detail) select 'T4 an evidence change invalidates and queues',
  (pg_temp.v(pg_temp.c1())).status = 'queued' and (pg_temp.v(pg_temp.c1())).queued_reason = 'topic_changed'
  and pg_temp.view(pg_temp.c1())->>'freshness' = 'stale' and (pg_temp.view(pg_temp.c1())->>'stale_reasons') like '%The topic changed%', pg_temp.view(pg_temp.c1())::text;
insert into chk (name, ok, detail) select 'T5 a stale result is still shown, with its last success time',
  pg_temp.view(pg_temp.c1())->'result' is not null and pg_temp.view(pg_temp.c1())->>'last_success_at' is not null, null;
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true));

-- 4. document decisions
insert into public.map1_project_document (document_id, project_key) values
  ('d0000000-0000-0000-0000-000000000001', 'dcrec:a'), ('d0000000-0000-0000-0000-000000000002', 'dcrec:other');
insert into public.map1_project_document_decision (document_id, decision) values ('d0000000-0000-0000-0000-000000000002', 'approved');
insert into chk (name, ok, detail) select 'D1 a decision on another project changes nothing', (pg_temp.v(pg_temp.c1())).status = 'done' and pg_temp.view(pg_temp.c1())->>'freshness' = 'current', null;
insert into public.map1_project_document_decision (document_id, decision) values ('d0000000-0000-0000-0000-000000000001', 'revoked');
insert into chk (name, ok, detail) select 'D2 a decision on this project invalidates and queues it',
  (pg_temp.v(pg_temp.c1())).status = 'queued' and (pg_temp.v(pg_temp.c1())).queued_reason = 'document_revoked'
  and (pg_temp.view(pg_temp.c1())->>'stale_reasons') like '%revoked%', pg_temp.view(pg_temp.c1())->>'stale_reasons';
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true));

-- 5. project changes found by the detector
select public.impact_dc_verification_detect_changes(50);
insert into chk (name, ok, detail) select 'P1 an unchanged, recent project is left alone', (pg_temp.v(pg_temp.c1())).status = 'done' and pg_temp.view(pg_temp.c1())->>'freshness' = 'current', null;
update public.fx_map set status = 'Approved', raw_status = 'approved' where project_key = 'dcrec:a';
select public.impact_dc_verification_detect_changes(50);
insert into chk (name, ok, detail) select 'P2 a status change (Proposed to Approved) invalidates and queues',
  (pg_temp.v(pg_temp.c1())).status = 'queued' and (pg_temp.v(pg_temp.c1())).invalidated_reason = 'The project''s status changed.', (pg_temp.v(pg_temp.c1())).invalidated_reason;
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true));
update public.fx_map set map_key = 'dc:merged' where project_key = 'dcrec:a';
select public.impact_dc_verification_detect_changes(50);
insert into chk (name, ok, detail) select 'P3 a merge (new map key, same project key) invalidates and queues',
  (pg_temp.v(pg_temp.c1())).invalidated_reason = 'The project was merged or re-keyed.' and (pg_temp.v(pg_temp.c1())).status = 'queued', (pg_temp.v(pg_temp.c1())).invalidated_reason;
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true));
update public.fx_map set zip = '20186' where project_key = 'dcrec:a';
select public.impact_dc_verification_detect_changes(50);
insert into chk (name, ok, detail) select 'P4 a move to another ZIP invalidates and queues', (pg_temp.v(pg_temp.c1())).invalidated_reason = 'The project moved to another ZIP.', (pg_temp.v(pg_temp.c1())).invalidated_reason;
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true, '20186'));
update public.fx_map set location_text = 'Vint Hill Parkway, VA' where project_key = 'dcrec:a';
select public.impact_dc_verification_detect_changes(50);
insert into chk (name, ok, detail) select 'P5 a change to the published details invalidates', (pg_temp.v(pg_temp.c1())).invalidated_reason = 'The project''s published details changed.', (pg_temp.v(pg_temp.c1())).invalidated_reason;
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true, '20186'));
update public.fx_map set state = 'not_on_map' where project_key = 'dcrec:a';
select public.impact_dc_verification_detect_changes(50);
insert into chk (name, ok, detail) select 'P6 a project no longer on the map invalidates', (pg_temp.v(pg_temp.c1())).invalidated_reason like 'The project is no longer found on Map 1 (not_on_map)%', (pg_temp.v(pg_temp.c1())).invalidated_reason;
update public.fx_map set state = 'found' where project_key = 'dcrec:a';
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true, '20186'));
update public.impact_dc_verification set last_success_at = now() - interval '49 hours' where candidate_id = pg_temp.c1();
insert into chk (name, ok, detail) select 'S1 a result older than 48 hours is stale, never ready',
  pg_temp.view(pg_temp.c1())->>'freshness' = 'stale' and not (pg_temp.view(pg_temp.c1())->>'reply_ready')::boolean
  and (pg_temp.view(pg_temp.c1())->>'stale_reasons') like '%48 hours%', null;
select public.impact_dc_verification_detect_changes(50);
insert into chk (name, ok, detail) select 'S2 the detector requeues an old result', (pg_temp.v(pg_temp.c1())).status = 'queued' and (pg_temp.v(pg_temp.c1())).queued_reason = 'max_age', null;
insert into public.app_projects (zip, record_kind, source_key, name, status, lat, lng) values ('78617', 'development', 'arc:1', 'Caldwell Lane warehouse', 'Proposed', 30.2, -97.6);
insert into public.fx_map (project_key, state, zip, map_key) values ('n5:arc:1', 'found', '78617', 'n5:arc:1');
insert into chk (name, ok, detail) select 'P7 facts for a development record come from app_projects',
  public.impact_dc_project_facts('n5:arc:1') @> '{"state":"found","name":"Caldwell Lane warehouse","status":"Proposed","zip":"78617"}', public.impact_dc_project_facts('n5:arc:1')::text;

-- 6. failures, retries, leases
select public.impact_dc_verification_fail(pg_temp.claim(pg_temp.c1()), 'map1_dc_zip_members -> HTTP 500');
insert into chk (name, ok, detail) select 'R1 a failed attempt waits 5 minutes',
  (pg_temp.v(pg_temp.c1())).status = 'queued' and (pg_temp.v(pg_temp.c1())).attempts = 1
  and (pg_temp.v(pg_temp.c1())).next_attempt_at between now() + interval '4 minutes' and now() + interval '6 minutes', (pg_temp.v(pg_temp.c1())).next_attempt_at::text;
insert into chk (name, ok, detail) select 'R2 it is not claimed before then',
  not exists (select 1 from jsonb_array_elements(public.impact_dc_verification_claim('suite', 20)) e where (e->>'candidate_id')::uuid = pg_temp.c1()), null;
insert into chk (name, ok, detail) select 'R3 the last result is kept and labelled stale after a failure',
  pg_temp.view(pg_temp.c1())->'result' is not null and pg_temp.view(pg_temp.c1())->>'freshness' = 'stale'
  and (pg_temp.view(pg_temp.c1())->>'stale_reasons') like '%latest check failed: map1_dc_zip_members -> HTTP 500%'
  and not (pg_temp.view(pg_temp.c1())->>'link_available')::boolean, pg_temp.view(pg_temp.c1())->>'stale_reasons';
select public.impact_dc_verification_fail(pg_temp.claim(pg_temp.c1()), 'timeout');
insert into chk (name, ok, detail) select 'R4 the second failure waits 30 minutes',
  (pg_temp.v(pg_temp.c1())).attempts = 2 and (pg_temp.v(pg_temp.c1())).next_attempt_at between now() + interval '29 minutes' and now() + interval '31 minutes', null;
select public.impact_dc_verification_fail(pg_temp.claim(pg_temp.c1()), 'timeout again');
insert into chk (name, ok, detail) select 'R5 the third failure gives up', (pg_temp.v(pg_temp.c1())).status = 'gave_up' and (pg_temp.v(pg_temp.c1())).attempts = 3, null;
insert into chk (name, ok, detail) select 'R6 a gave-up job is not claimed', pg_temp.claim(pg_temp.c1()) is null, null;
update public.fx_admin set ok = false;
do $$ begin perform public.hs_impact_dc_verification_recheck('11111111-1111-1111-1111-111111111111');
  insert into chk (name, ok) values ('M2 a non-admin Recheck is refused', false);
exception when sqlstate '42501' then insert into chk (name, ok) values ('M2 a non-admin Recheck is refused', true); end $$;
do $$ begin perform public.hs_impact_dc_verification_state(array['11111111-1111-1111-1111-111111111111'::uuid]);
  insert into chk (name, ok) values ('M3 a non-admin cannot read the results', false);
exception when sqlstate '42501' then insert into chk (name, ok) values ('M3 a non-admin cannot read the results', true); end $$;
update public.fx_admin set ok = true;
insert into chk (name, ok, detail) select 'M4 Recheck queues a gave-up job and resets its attempts',
  public.hs_impact_dc_verification_recheck(pg_temp.c1()) = 'queued' and (pg_temp.v(pg_temp.c1())).status = 'queued'
  and (pg_temp.v(pg_temp.c1())).attempts = 0 and (pg_temp.v(pg_temp.c1())).queued_reason = 'manual', null;
do $$ begin perform public.hs_impact_dc_verification_recheck('22222222-2222-2222-2222-222222222222');
  insert into chk (name, ok) values ('M5 Recheck refuses a topic that is not about data centers', false);
exception when sqlstate 'P0002' then insert into chk (name, ok) values ('M5 Recheck refuses a topic that is not about data centers', true); end $$;
select set_config('fx.run', pg_temp.claim(pg_temp.c1())::text, false);
insert into chk (name, ok, detail) select 'M6 Recheck while running asks for a rerun',
  public.hs_impact_dc_verification_recheck(pg_temp.c1()) = 'running' and (pg_temp.v(pg_temp.c1())).rerun_requested, null;
update public.impact_dc_verification set lease_expires_at = now() - interval '1 second' where candidate_id = pg_temp.c1();
select public.impact_dc_verification_claim('suite', 20);
insert into chk (name, ok, detail) select 'L1 an expired lease ends the run as expired and is retried at once when a rerun was asked',
  (select outcome = 'expired' from public.impact_dc_verification_runs where run_id = current_setting('fx.run')::uuid)
  and (pg_temp.v(pg_temp.c1())).attempts = 1 and not (pg_temp.v(pg_temp.c1())).rerun_requested, null;
do $$ begin perform public.impact_dc_verification_record(current_setting('fx.run')::uuid, '{"outcome":"verified"}');
  insert into chk (name, ok) values ('L2 an expired run cannot be recorded', false);
exception when sqlstate 'P0002' then insert into chk (name, ok) values ('L2 an expired run cannot be recorded', true); end $$;
do $$ begin perform public.impact_dc_verification_record(pg_temp.claim('11111111-1111-1111-1111-111111111111'), '{"outcome":"approved"}');
  insert into chk (name, ok) values ('L3 an unknown outcome is refused', false);
exception when sqlstate '22023' then insert into chk (name, ok) values ('L3 an unknown outcome is refused', true); end $$;

-- 7. a topic that stops being a data-center topic
update public.impact_discovery_candidates set status = 'rejected' where id = '00000000-0000-0000-0000-000000000000';
insert into chk (name, ok, detail) select 'X1 a rejected topic''s job is retired', (pg_temp.v('00000000-0000-0000-0000-000000000000')).status = 'retired', null;
insert into chk (name, ok, detail) select 'X2 a retired job is never claimed', pg_temp.claim('00000000-0000-0000-0000-000000000000') is null, null;

-- 8. the tick (dispatch), with the stand-in network. Each tick runs in its own statement; the check reads its saved answer.
create temp table tk (n int, a jsonb);
update public.impact_dc_verification set status = 'done', next_attempt_at = now(), last_success_at = now(), invalidated_at = null where status in ('queued','running');
insert into tk select 1, public.impact_dc_verification_tick();
insert into chk (name, ok, detail) select 'K1 nothing due: nothing dispatched', (a->>'dispatched')::boolean = false and not exists (select 1 from net.fx_posts), a::text from tk where n = 1;
update public.impact_dc_verification set status = 'queued', next_attempt_at = now() - interval '1 second', last_success_at = now() where candidate_id = pg_temp.c1();
insert into tk select 2, public.impact_dc_verification_tick();
insert into chk (name, ok, detail) select 'K2 due but no GitHub credential: nothing dispatched, the reason recorded',
  a->>'error' = 'no credential' and not exists (select 1 from net.fx_posts)
  and exists (select 1 from public.impact_dc_verification_dispatches where note like 'no GitHub credential%'), a::text from tk where n = 2;
delete from public.impact_dc_verification_dispatches;
insert into vault.decrypted_secrets values ('github_actions_pat', 'ghp_test');
insert into tk select 3, public.impact_dc_verification_tick();
insert into chk (name, ok, detail) select 'K3 due: one dispatch of the worker on main',
  (a->>'dispatched')::boolean and (select count(*) = 1 and bool_and(url like '%/homesignal-site/actions/workflows/impact-dc-verify.yml/dispatches' and body = '{"ref":"main"}') from net.fx_posts), a::text from tk where n = 3;
insert into tk select 4, public.impact_dc_verification_tick();
insert into chk (name, ok, detail) select 'K4 never twice in 10 minutes', (a->>'dispatched')::boolean = false and (select count(*) = 1 from net.fx_posts), a::text from tk where n = 4;

-- 8b. saved reply edits (stage 3)
update public.impact_dc_verification set result = pg_temp.res('dcrec:a', true, true) || '{"link":{"available":true,"url":"https://jodytracks.com/map/20187/?project=dcrec%3Aa"},"reply":{"ready":true,"text":"Suggested https://jodytracks.com/map/20187/?project=dcrec%3Aa"}}'::jsonb,
  result_facts = '{"state":"found","status":"Proposed"}' where candidate_id = pg_temp.c1();
insert into chk (name, ok, detail) select 'E1 no edit: the tile shows the suggested reply',
  (select e->'reply_edit' = 'null'::jsonb from jsonb_array_elements(public.hs_impact_dc_verification_state(array[pg_temp.c1()])) e), null;
select public.hs_impact_dc_reply_save(pg_temp.c1(), '  My words: https://jodytracks.com/map/20187/?project=dcrec%3Aa  ');
insert into chk (name, ok, detail) select 'E2 a saved edit is returned, trimmed, with who saved it and nothing changed since',
  (select e->'reply_edit'->>'text' = 'My words: https://jodytracks.com/map/20187/?project=dcrec%3Aa' and e->'reply_edit'->>'saved_by' = 'founder@example.test'
     and not (e->'reply_edit'->>'link_changed')::boolean and not (e->'reply_edit'->>'facts_changed')::boolean and (e->'reply_edit'->>'has_current_link')::boolean
   from jsonb_array_elements(public.hs_impact_dc_verification_state(array[pg_temp.c1()])) e), null;
select public.impact_dc_verification_record(pg_temp.claim(pg_temp.c1()), pg_temp.res('dcrec:a', true, true));
insert into chk (name, ok, detail) select 'E3 a new check never overwrites the edit; it says the link changed',
  (select e->'reply_edit'->>'text' like 'My words:%' and (e->'reply_edit'->>'link_changed')::boolean
   from jsonb_array_elements(public.hs_impact_dc_verification_state(array[pg_temp.c1()])) e),
  (select (e->'reply_edit')::text from jsonb_array_elements(public.hs_impact_dc_verification_state(array[pg_temp.c1()])) e);
update public.impact_dc_verification set result_facts = '{"state":"found","status":"Approved"}' where candidate_id = pg_temp.c1();
insert into chk (name, ok, detail) select 'E4 changed project facts are flagged on the edit',
  (select (e->'reply_edit'->>'facts_changed')::boolean from jsonb_array_elements(public.hs_impact_dc_verification_state(array[pg_temp.c1()])) e), null;
select public.hs_impact_dc_reply_save(pg_temp.c1(), '');
insert into chk (name, ok, detail) select 'E5 clearing the edit goes back to the suggested reply; the history is kept',
  (select e->'reply_edit' = 'null'::jsonb from jsonb_array_elements(public.hs_impact_dc_verification_state(array[pg_temp.c1()])) e)
  and (select count(*) = 2 from public.impact_dc_reply_edits where candidate_id = pg_temp.c1()), null;
do $$ begin update public.impact_dc_reply_edits set text = 'x';
  insert into chk (name, ok) values ('E6 saved edits are append-only', false);
exception when sqlstate '55000' then insert into chk (name, ok) values ('E6 saved edits are append-only', true); end $$;
update public.fx_admin set ok = false;
do $$ begin perform public.hs_impact_dc_reply_save('11111111-1111-1111-1111-111111111111', 'x');
  insert into chk (name, ok) values ('E7 a non-admin cannot save a reply', false);
exception when sqlstate '42501' then insert into chk (name, ok) values ('E7 a non-admin cannot save a reply', true); end $$;
do $$ begin perform public.hs_impact_dc_project_documents('dcrec:a');
  insert into chk (name, ok) values ('E8 a non-admin cannot list documents for review', false);
exception when sqlstate '42501' then insert into chk (name, ok) values ('E8 a non-admin cannot list documents for review', true); end $$;
update public.fx_admin set ok = true;
insert into chk (name, ok, detail) select 'E9 documents for review carry their current state',
  (select jsonb_agg(e->>'state' order by e->>'document_id') from jsonb_array_elements(public.hs_impact_dc_project_documents('dcrec:a')) e) = '["revoked"]'
  and jsonb_array_length(public.hs_impact_dc_project_documents('dcrec:other')) = 1
  and (public.hs_impact_dc_project_documents('dcrec:other')->0->>'state') = 'approved', public.hs_impact_dc_project_documents('dcrec:a')::text;

-- 9. grants
insert into chk (name, ok, detail) select 'G1 visitors cannot run the worker''s functions or the tick',
  not has_function_privilege('anon', 'public.impact_dc_verification_claim(text,integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.impact_dc_verification_record(uuid,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.impact_dc_verification_fail(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.impact_dc_verification_tick()', 'execute')
  and not has_function_privilege('anon', 'public.impact_dc_project_facts(text,text)', 'execute')
  and has_function_privilege('service_role', 'public.impact_dc_verification_claim(text,integer)', 'execute'), null;
insert into chk (name, ok, detail) select 'G2 visitors cannot read the tables',
  not has_table_privilege('anon', 'public.impact_dc_verification', 'select') and not has_table_privilege('authenticated', 'public.impact_dc_verification_runs', 'select'), null;
insert into chk (name, ok, detail) select 'G3 the dashboard reads and rechecks through two admin functions',
  has_function_privilege('authenticated', 'public.hs_impact_dc_verification_state(uuid[])', 'execute')
  and has_function_privilege('authenticated', 'public.hs_impact_dc_verification_recheck(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.hs_impact_dc_verification_recheck(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_impact_dc_reply_save(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_impact_dc_reply_save(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_impact_dc_project_documents(text)', 'execute')
  and not has_table_privilege('authenticated', 'public.impact_dc_reply_edits', 'select'), null;
insert into chk (name, ok, detail) select 'G4 no schedule is created', not exists (select 1 from pg_namespace where nspname = 'cron'), null;

select name, case when ok then 't' else 'f' end, coalesce(left(detail, 200), '') from chk order by n;
