-- docs/weekly-8-edition-sequence.sql and weekly-9-edition-topics.sql on a DISPOSABLE database seeded by build_edition_sequence_state.py (TEST DATA).
-- Prints one "Qnn|true/false" line per check.
-- TECHNICAL FIXTURE: the Water Quality script is the Air Quality demonstration with its topic label renamed. Its text is about the EPA methane proposal, not water; it has no water sources and is not a Water Quality report.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return code is null or sqlstate = code; end $$;
create or replace function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.raises(text, text), pg_temp.err(text) to authenticated;
\set admin '{"email":"founder@test.invalid"}'

-- the content: Air version 3 (2 segments, segment 0 carries a person-chosen document cue) and Water's newest script
select id as air from public.weekly_scripts where stage = 'script' and topic = 'Air Quality'
  and (public.weekly_version_status(id) ->> 'current')::boolean \gset
select id as water from public.weekly_scripts where stage = 'script' and topic = 'Water Quality'
  and (public.weekly_version_status(id) ->> 'current')::boolean \gset
select 'Q00|' || ((select count(*) from public.weekly_scripts where stage = 'script'
  and (public.weekly_version_status(id) ->> 'current')::boolean) = 2
  and jsonb_typeof((select body -> 'segments' -> 0 -> 'visual' from public.weekly_scripts where id = :'air')) = 'object');

select (body -> 'segments' -> 0)::text as air_s0, (body -> 'segments' -> 1)::text as air_s1 from public.weekly_scripts where id = :'air' \gset
select ((g -> 'visual') - 'quote' || '{"quote": "words that are not on that page"}'::jsonb)::text as badcue
  from public.weekly_scripts v, jsonb_array_elements(v.body -> 'segments') g where v.id = :'air' and jsonb_typeof(g -> 'visual') = 'object' limit 1 \gset
select set_config('test.jwt', :'admin', false);
set role authenticated;
select (public.hs_weekly_edition_create('Air Quality', '2026-11-09') ->> 'id') as ed \gset
\set seq '[{"version_id": "' :air '", "from": 0, "to": 0}, {"version_id": "' :water '", "from": 0, "to": 1}, {"version_id": "' :air '", "from": 1, "to": 1}]'

-- ── membership (files 7, 8, 9) ──────────────────────────────────────────────────────────────────────────────────
-- Q20 an approved version linked to no edition is refused: the sequence is not a way round edition membership
select 'Q20|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', :'seq'))
  like '%not linked to this edition; link it first%'), false);
-- Q21 an edition covers only its first topic until a person adds another: linking Water is refused, Air is accepted
select 'Q21|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_link_version(%L, %L)', :'ed', :'water')) like '%edition % covers Air Quality%'), false);
select 'Q21b|' || coalesce((public.hs_weekly_edition_link_version(:'ed', :'air') ->> 'existing') = 'false', false);
-- Q22 adding a topic: catalog topics only, idempotent, the first topic stays first
select 'Q22|' || pg_temp.raises(format('select public.hs_weekly_edition_add_topic(%L, %L)', :'ed', 'Not A Category'), '22023');
select public.hs_weekly_edition_add_topic(:'ed', 'Water Quality') as t1 \gset
select 'Q22b|' || ((:'t1'::jsonb -> 'topics') = '["Air Quality", "Water Quality"]'::jsonb and (:'t1'::jsonb ->> 'existing') = 'false'
  and (public.hs_weekly_edition_add_topic(:'ed', 'Water Quality') ->> 'existing') = 'true'
  and (public.hs_weekly_edition_add_topic(:'ed', 'Air Quality') ->> 'existing') = 'true');
select 'Q22c|' || coalesce((public.hs_weekly_edition_link_version(:'ed', :'water') ->> 'existing') = 'false', false);
-- Q23 a covered topic's lead is assignable, and its research request is filed under the LEAD's topic (per-topic research)
select (public.hs_weekly_lead_save(null, '{"title": "TEST DATA Water lead", "topic": "Water Quality"}'::jsonb) ->> 'lead_id') as lw \gset
select public.hs_weekly_lead_send_to_research(:'lw', :'ed', 'TEST FORMAT') as hw \gset
reset role;
select 'Q23|' || coalesce((select r.topic = 'Water Quality' and r.request_text like '%(Water Quality), edition %'
  from public.weekly_research_requests r where r.id = (:'hw'::jsonb ->> 'request_id')::uuid), false);
set role authenticated;
-- Q24 a lead of a topic the edition does not cover is still refused, and so is a lead already live in another edition
select (public.hs_weekly_lead_save(null, '{"title": "TEST DATA Data-centre lead", "topic": "Data Centers"}'::jsonb) ->> 'lead_id') as ld \gset
select 'Q24|' || coalesce((pg_temp.err(format('select public.hs_weekly_lead_assign(%L, %L)', :'ld', :'ed')) like '%is filed under "Data Centers"; edition % covers Air Quality, Water Quality%'), false);
select (public.hs_weekly_edition_create('Water Quality', '2026-11-09') ->> 'id') as ed2 \gset
select 'Q24b|' || pg_temp.raises(format('select public.hs_weekly_lead_assign(%L, %L)', :'lw', :'ed2'), '55006');
-- Q25 a version can belong to one edition only; another edition's sequence cannot use it
select 'Q25|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_link_version(%L, %L)', :'ed2', :'water')) like '%already belongs to edition%'), false);
\set other_seq '[{"version_id": "' :water '", "from": 0, "to": 0}]'
select 'Q25b|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed2', :'other_seq')) like '%belongs to another edition%'), false);
-- Q26 a lead assigned to the edition with no disposition blocks the sequence (approved content cannot skip that gate)
select 'Q26|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', :'seq')) like '%1 lead(s) assigned to this edition have no disposition yet%'), false);
-- Q29 what the editor may offer: exactly the current approved script versions linked to this edition, with segments
select public.hs_weekly_edition_video(:'ed') as cv \gset
select 'Q29|' || ((select jsonb_agg(c ->> 'version_id' order by c ->> 'version_id') from jsonb_array_elements(:'cv'::jsonb -> 'candidates') c)
  = (select jsonb_agg(x order by x) from (values (:'air'), (:'water')) t (x))
  and (select bool_and(jsonb_array_length(c -> 'segments') >= 2) from jsonb_array_elements(:'cv'::jsonb -> 'candidates') c)
  and (select (c -> 'segments' -> 0 ->> 'document_cue')::boolean from jsonb_array_elements(:'cv'::jsonb -> 'candidates') c where c ->> 'version_id' = :'air'));
-- Q27 "included" means kept for the edition's reporting; it does not require the lead's content to be in the video
select public.hs_weekly_lead_disposition(:'lw', :'ed', 'included') is not null as disp \gset
select 'Q27|' || (:'disp' = 't');

-- Q01 Air story 1 -> Water -> Air story 2 is accepted: a topic may return
select public.hs_weekly_edition_sequence_set(:'ed', :'seq'::jsonb) as v1 \gset
select 'Q01|' || (jsonb_array_length(:'v1'::jsonb -> 'problems') = 0 and jsonb_array_length(:'v1'::jsonb -> 'items') = 3);
-- Q02 video order is exactly the chosen order; the topic of each entry is the version's own topic
select 'Q02|' || ((select jsonb_agg(i ->> 'topic' order by (i ->> 'n')::int) from jsonb_array_elements(:'v1'::jsonb -> 'items') i)
  = '["Air Quality", "Water Quality", "Air Quality"]'::jsonb);
-- Q03 the opening/thumbnail topic list: each topic once, in order of first appearance
select 'Q03|' || ((:'v1'::jsonb -> 'topics') = '["Air Quality", "Water Quality"]'::jsonb);
-- Q04 a section card at every topic change (the returning Air gets one)
select 'Q04|' || ((select jsonb_agg(i -> 'section_card' order by (i ->> 'n')::int) from jsonb_array_elements(:'v1'::jsonb -> 'items') i)
  = '[true, true, true]'::jsonb);
-- Q05 each entry carries exactly its own segments' text, nothing regrouped or duplicated
select 'Q05|' || ((:'v1'::jsonb -> 'items' -> 0 -> 'segments') = jsonb_build_array(:'air_s0'::jsonb)
  and (:'v1'::jsonb -> 'items' -> 2 -> 'segments') = jsonb_build_array(:'air_s1'::jsonb)
  and jsonb_array_length(:'v1'::jsonb -> 'items' -> 1 -> 'segments') = 2);
-- Q06 not approved until a person approves
select 'Q06|' || (not (:'v1'::jsonb ->> 'approved')::boolean and :'v1'::jsonb ->> 'why_not' = 'not approved yet');
-- Q07 an approval naming a digest other than the recomputed one is refused (stale page)
select 'Q07|' || pg_temp.raises(format('select public.hs_weekly_edition_sequence_approve(%L, %L)', :'ed', repeat('a', 64)), '40001');
-- Q08 the reviewed digest approves it
select public.hs_weekly_edition_sequence_approve(:'ed', :'v1'::jsonb ->> 'digest') as v2 \gset
select 'Q08|' || ((:'v2'::jsonb ->> 'approved')::boolean and (:'v2'::jsonb -> 'approval' ->> 'digest') = (:'v1'::jsonb ->> 'digest'));
-- Q09 the digest is recomputed from the content: it equals sha256 over the version ids, ranges, topics, the bodies'
--     own hashes recomputed from body::text, and the edition's series, key and period
reset role;
select 'Q09|' || ((:'v1'::jsonb ->> 'digest') = public.weekly_sha256(jsonb_build_object('series', ed.series, 'edition_key', ed.edition_key,
  'period_start', ed.period_start, 'period_end', ed.period_end, 'entries', jsonb_build_array(
    jsonb_build_object('version_id', :'air', 'from', 0, 'to', 0, 'topic', 'Air Quality', 'body_sha256', (select public.weekly_sha256(body::text) from public.weekly_scripts where id = :'air')),
    jsonb_build_object('version_id', :'water', 'from', 0, 'to', 1, 'topic', 'Water Quality', 'body_sha256', (select public.weekly_sha256(body::text) from public.weekly_scripts where id = :'water')),
    jsonb_build_object('version_id', :'air', 'from', 1, 'to', 1, 'topic', 'Air Quality', 'body_sha256', (select public.weekly_sha256(body::text) from public.weekly_scripts where id = :'air'))))::text))
  from public.weekly_editions ed where ed.id = :'ed';
-- Q10 edition details cannot change after creation (the existing guard), and if they did the digest would move
select 'Q10|' || pg_temp.raises(format($q$update public.weekly_editions set period_end = period_end + 1 where id = %L$q$, :'ed'), '55000');
begin;
alter table public.weekly_editions disable trigger weekly_editions_guard;
update public.weekly_editions set series = series || ' (changed)' where id = :'ed';
select 'Q10b|' || (public.weekly_edition_sequence_digest((select max(id) from public.weekly_edition_sequences where edition_id = :'ed')) <> (:'v1'::jsonb ->> 'digest')
  and not (public.weekly_edition_video(:'ed') ->> 'approved')::boolean);
rollback;
-- Q11 the content cannot change in place: script versions are append-only
select 'Q11|' || pg_temp.raises(format($q$update public.weekly_scripts set body = jsonb_set(body, '{segments,1,text}', '"changed"') where id = %L$q$, :'air'), null);
-- Q12 reordering makes a new sequence; the earlier approval no longer holds
select set_config('test.jwt', :'admin', false);
set role authenticated;
\set reord '[{"version_id": "' :water '", "from": 0, "to": 1}, {"version_id": "' :air '", "from": 0, "to": 1}]'
select public.hs_weekly_edition_sequence_set(:'ed', :'reord'::jsonb) as v3 \gset
select 'Q12|' || (not (:'v3'::jsonb ->> 'approved')::boolean and :'v3'::jsonb ->> 'why_not' = 'the sequence changed after the newest approval'
  and (:'v3'::jsonb -> 'topics') = '["Water Quality", "Air Quality"]'::jsonb);
-- Q13 consecutive entries of one topic share one section card
\set same '[{"version_id": "' :air '", "from": 0, "to": 0}, {"version_id": "' :air '", "from": 1, "to": 1}, {"version_id": "' :water '", "from": 0, "to": 0}]'
select public.hs_weekly_edition_sequence_set(:'ed', :'same'::jsonb) as v4 \gset
select 'Q13|' || ((select jsonb_agg(i -> 'section_card' order by (i ->> 'n')::int) from jsonb_array_elements(:'v4'::jsonb -> 'items') i) = '[true, false, true]'::jsonb);
-- Q14 refused: a segment used twice; a range outside the version; a missing version; a non-script version; bad keys
\set dup '[{"version_id": "' :air '", "from": 0, "to": 1}, {"version_id": "' :air '", "from": 1, "to": 1}]'
select 'Q14|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', :'dup')) like '%already in the sequence%'), false);
\set out '[{"version_id": "' :air '", "from": 1, "to": 2}]'
select 'Q14b|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', :'out')) like '%not within that version%'), false);
select 'Q14c|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed',
  '[{"version_id": "00000000-0000-4000-8000-000000000000", "from": 0, "to": 0}]')) like '%no such script version%'), false);
reset role;
select id as outline from public.weekly_scripts where stage = 'outline' and topic = 'Air Quality' order by created_at desc limit 1 \gset
set role authenticated;
select 'Q14d|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed',
  '[{"version_id": "' || :'outline' || '", "from": 0, "to": 0}]')) like '%not a script%'), false);
select 'Q14e|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed',
  '[{"version_id": "' || :'air' || '", "from": 0, "to": 0, "story": "air"}]')) like '%version_id, from and to only%'), false);
select 'Q14f|' || pg_temp.raises(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', '[]'), '22023');
-- Q15 a version that is not the current approved one is refused; a cue not checked against its document is reported.
--     A person moves Air's cue: that writes a NEW version (not approved, cue not yet checked), and Air version 3 is
--     superseded, so the approved edition goes stale too.
select public.hs_weekly_doc_cue_set(:'air', 0, null) as cue0 \gset
reset role;
select id as air4 from public.weekly_scripts where parent_id = :'air' \gset
set role authenticated;
select (public.hs_weekly_doc_cue_set(:'air4', 0, :'badcue'::jsonb)
  ->> 'script_version') as air5 \gset
\set cue '[{"version_id": "' :air5 '", "from": 0, "to": 0}]'
select pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', :'cue')) as cueerr \gset
select 'Q15|' || coalesce(:'cueerr' like '%not the current approved version%' and :'cueerr' like '%document cue in these segments is not resolved%', false);
select 'Q15b|' || coalesce((pg_temp.err(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', :'seq')) like '%not the current approved version%'), false);
-- Q16 the earlier approval of sequence 1 is now stale for two reasons; the newest sequence reads its problems
select public.hs_weekly_edition_video(:'ed') as v5 \gset
select 'Q16|' || (not (:'v5'::jsonb ->> 'approved')::boolean and jsonb_array_length(:'v5'::jsonb -> 'problems') > 0);
-- Q17 a non-admin is refused; anon and authenticated cannot read the tables or the render export
select set_config('test.jwt', '{"email":"someone@test.invalid"}', false);
select 'Q17|' || pg_temp.raises(format('select public.hs_weekly_edition_video(%L)', :'ed'), '42501');
reset role;
select 'Q17b|' || (not has_table_privilege('authenticated', 'public.weekly_edition_sequences', 'select')
  and not has_table_privilege('anon', 'public.weekly_edition_approvals', 'select')
  and not has_function_privilege('authenticated', 'public.weekly_edition_render_export(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.weekly_edition_render_export(uuid)', 'execute')
  and (select relrowsecurity from pg_class where oid = 'public.weekly_edition_sequences'::regclass)
  and not has_table_privilege('authenticated', 'public.weekly_edition_topic_events', 'select,insert,update,delete')
  and not has_function_privilege('anon', 'public.hs_weekly_edition_add_topic(uuid,text)', 'execute'));
-- Q18 history is append-only
select 'Q18|' || (pg_temp.raises('delete from public.weekly_edition_sequences', null)
  and pg_temp.raises('update public.weekly_edition_approvals set digest = repeat(''b'', 64)', null)
  and pg_temp.raises('delete from public.weekly_edition_topic_events', null));
-- Q28 a non-admin cannot add a topic
select set_config('test.jwt', '{"email":"someone@test.invalid"}', false);
set role authenticated;
select 'Q28|' || pg_temp.raises(format('select public.hs_weekly_edition_add_topic(%L, %L)', :'ed', 'Data Centers'), '42501');
reset role;

-- ── a stored approval holds only while its eligibility conditions hold (Q30-Q34) ───────────────────────────────────
-- From here on: the Water version (current, approved, linked to ed) is the whole sequence.
select set_config('test.jwt', :'admin', false);
set role authenticated;
\set wseq '[{"version_id": "' :water '", "from": 0, "to": 1}]'
select public.hs_weekly_edition_sequence_set(:'ed', :'wseq'::jsonb) ->> 'digest' as wdg \gset
select public.hs_weekly_edition_sequence_approve(:'ed', :'wdg') is not null as ok \gset
select 'Q30|' || coalesce((public.hs_weekly_edition_video(:'ed') ->> 'approved')::boolean, false);
-- Q31 a lead newly assigned to the edition, with no decision yet: the stored approval stops holding, and says why;
--     the approval itself is not deleted, and holds again once the lead is decided (the video's content never changed)
select (public.hs_weekly_lead_save(null, '{"title": "TEST DATA late Air lead", "topic": "Air Quality"}'::jsonb) ->> 'lead_id') as l2 \gset
select public.hs_weekly_lead_assign(:'l2', :'ed') is not null as ok \gset
select public.hs_weekly_edition_video(:'ed') as w1 \gset
select 'Q31|' || (not (:'w1'::jsonb ->> 'approved')::boolean and :'w1'::jsonb ->> 'problems' like '%have no disposition yet%');
select public.hs_weekly_lead_disposition(:'l2', :'ed', 'deferred', 'TEST DATA: not this week') is not null as ok \gset
select 'Q31b|' || coalesce((public.hs_weekly_edition_video(:'ed') ->> 'approved')::boolean, false);
reset role;
-- Q32 membership withdrawn (no function can do this: links are append-only, so it is simulated as the table owner in a
--     transaction that is rolled back): the approval stops holding, and the render export says not approved
begin;
alter table public.weekly_topic_lead_events disable trigger weekly_topic_lead_events_append_only;
delete from public.weekly_topic_lead_events where kind = 'version_linked' and version_id = :'water';
select 'Q32|' || (not (public.weekly_edition_video(:'ed') ->> 'approved')::boolean
  and public.weekly_edition_video(:'ed') ->> 'problems' like '%not linked to this edition%'
  and not (public.weekly_edition_render_export(:'ed') ->> 'approved')::boolean);
rollback;
-- Q33 coverage withdrawn (simulated the same way): Water is no longer a topic the edition covers -> not approved
begin;
alter table public.weekly_edition_topic_events disable trigger weekly_edition_topic_events_append_only;
delete from public.weekly_edition_topic_events where edition_id = :'ed' and topic = 'Water Quality';
select 'Q33|' || (not (public.weekly_edition_video(:'ed') ->> 'approved')::boolean
  and public.weekly_edition_video(:'ed') ->> 'problems' like '%is not one this edition covers%');
rollback;
-- Q34 control: with nothing withdrawn, the same approval holds (so Q32 and Q33 measured the withdrawal, not the setup)
select 'Q34|' || coalesce((public.weekly_edition_video(:'ed') ->> 'approved')::boolean, false);

-- ── a published edition is locked on the server (Q35-Q37) ──────────────────────────────────────────────────────────
select set_config('test.jwt', :'admin', false);
set role authenticated;
-- a lead assigned and included WITHOUT a research request, before publication: the one path on which a research request
-- reaches send's own check rather than the assignment's
select (public.hs_weekly_lead_save(null, '{"title": "TEST DATA lead included without research", "topic": "Air Quality"}'::jsonb) ->> 'lead_id') as l4 \gset
select public.hs_weekly_lead_assign(:'l4', :'ed') is not null as ok \gset
select public.hs_weekly_lead_disposition(:'l4', :'ed', 'included') is not null as ok \gset
select public.hs_weekly_edition_publish(:'ed', 'https://video.test.invalid/weekly-test', current_date) is not null as ok \gset
select (public.hs_weekly_lead_save(null, '{"title": "TEST DATA lead after publication", "topic": "Air Quality"}'::jsonb) ->> 'lead_id') as l3 \gset
reset role;
select id as unlinked from public.weekly_scripts where stage = 'script' and topic = 'Air Quality' and public.weekly_version_edition(id) is null
  order by created_at limit 1 \gset
select id as linked_air from public.weekly_scripts where stage = 'script' and topic = 'Air Quality' and public.weekly_version_edition(id) = :'ed'
  order by created_at desc limit 1 \gset
-- every weekly row, fingerprinted before the attempts (order-independent: no collation involved)
select (select string_agg(t || ':' || n || ':' || h, ',' order by t collate "C") from (
  select 'leads' t, count(*) n, coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) h from public.weekly_topic_leads x union all
  select 'lead_events', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_topic_lead_events x union all
  select 'editions', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_editions x union all
  select 'topic_events', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_edition_topic_events x union all
  select 'sequences', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_edition_sequences x union all
  select 'approvals', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_edition_approvals x union all
  select 'requests', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_research_requests x union all
  select 'scripts', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_scripts x union all
  select 'script_approvals', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_script_approvals x) q) as fp0 \gset
select set_config('test.jwt', :'admin', false);
set role authenticated;
select 'Q35|' || (pg_temp.raises(format('select public.hs_weekly_lead_assign(%L, %L)', :'l3', :'ed'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, %L, %L)', :'l3', :'ed', 'TEST FORMAT'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_lead_send_to_research(%L, %L, %L)', :'l4', :'ed', 'TEST FORMAT'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_lead_disposition(%L, %L, %L, %L)', :'lw', :'ed', 'dropped', 'TEST DATA: trying to change a decision'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_edition_add_topic(%L, %L)', :'ed', 'Data Centers'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_edition_link_version(%L, %L)', :'ed', :'unlinked'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_edition_sequence_set(%L, %L::jsonb)', :'ed', :'wseq'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_edition_sequence_approve(%L, %L)', :'ed', :'wdg'), '55000')
  and pg_temp.raises(format('select public.hs_weekly_doc_cue_set(%L, 0, null)', :'linked_air'), '55000'));
reset role;
-- an approval written straight into the table, as the owner, for content of the published edition: refused too
select 'Q35b|' || pg_temp.raises(format($q$insert into public.weekly_script_approvals (script_id, body_sha256, approved_by)
  select id, body_sha256, 'TEST' from public.weekly_scripts where id = %L$q$, :'water'), '55000');
-- Q36 the refusals left every weekly row exactly as it was
select (select string_agg(t || ':' || n || ':' || h, ',' order by t collate "C") from (
  select 'leads' t, count(*) n, coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) h from public.weekly_topic_leads x union all
  select 'lead_events', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_topic_lead_events x union all
  select 'editions', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_editions x union all
  select 'topic_events', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_edition_topic_events x union all
  select 'sequences', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_edition_sequences x union all
  select 'approvals', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_edition_approvals x union all
  select 'requests', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_research_requests x union all
  select 'scripts', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_scripts x union all
  select 'script_approvals', count(*), coalesce(sum(('x' || substr(md5(to_jsonb(x)::text), 1, 8))::bit(32)::bigint), 0) from public.weekly_script_approvals x) q) as fp1 \gset
select 'Q36|' || (:'fp0' = :'fp1' and :'fp0' like '%scripts:%');
-- Q37 control: the lock is about THIS edition. Another, open edition still takes the same new lead.
select set_config('test.jwt', :'admin', false);
set role authenticated;
select (public.hs_weekly_edition_create('Air Quality', '2026-11-16') ->> 'id') as ed4 \gset
select 'Q37|' || coalesce((public.hs_weekly_lead_assign(:'l3', :'ed4') ->> 'existing') = 'false', false);
reset role;
