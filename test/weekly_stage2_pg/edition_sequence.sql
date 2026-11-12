-- docs/weekly-8-edition-sequence.sql on a DISPOSABLE database seeded by build_edition_sequence_state.py (TEST DATA).
-- Prints one "Qnn|true/false" line per check.
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
  and (select relrowsecurity from pg_class where oid = 'public.weekly_edition_sequences'::regclass));
-- Q18 history is append-only
select 'Q18|' || (pg_temp.raises('delete from public.weekly_edition_sequences', null)
  and pg_temp.raises('update public.weekly_edition_approvals set digest = repeat(''b'', 64)', null));
