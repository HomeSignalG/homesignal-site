-- docs/weekly-10-edition-render.sql on a DISPOSABLE database seeded by build_edition_sequence_state.py (TEST DATA).
-- Prints one "Rnn|true/false" line per check.
-- TECHNICAL FIXTURE: the Water Quality script is the Air Quality demonstration with its topic label renamed. Its text is about the EPA methane proposal, not water; it has no water sources and is not a Water Quality report.
\set ON_ERROR_STOP 0
create or replace function pg_temp.raises(q text, code text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return code is null or sqlstate = code; end $$;
create or replace function pg_temp.err(q text) returns text language plpgsql as $$
begin execute q; return null; exception when others then return sqlerrm; end $$;
grant execute on function pg_temp.raises(text, text), pg_temp.err(text) to authenticated, service_role;
\set admin '{"email":"founder@test.invalid"}'
\set nobody '{"email":"nobody@test.invalid"}'
select count(*) as n0 from net.calls \gset

select id as air from public.weekly_scripts where stage = 'script' and topic = 'Air Quality' and (public.weekly_version_status(id) ->> 'current')::boolean \gset
select id as water from public.weekly_scripts where stage = 'script' and topic = 'Water Quality' and (public.weekly_version_status(id) ->> 'current')::boolean \gset
select set_config('test.jwt', :'admin', false);
set role authenticated;
select (public.hs_weekly_edition_create('Air Quality', '2026-11-09') ->> 'id') as ed \gset
select public.hs_weekly_edition_add_topic(:'ed', 'Water Quality') is not null as t \gset
select public.hs_weekly_edition_link_version(:'ed', :'air') is not null as t \gset
select public.hs_weekly_edition_link_version(:'ed', :'water') is not null as t \gset
\set seq '[{"version_id": "' :air '", "from": 0, "to": 0}, {"version_id": "' :water '", "from": 0, "to": 1}, {"version_id": "' :air '", "from": 1, "to": 1}]'
\set seq3 '[{"version_id": "' :air '", "from": 1, "to": 1}, {"version_id": "' :water '", "from": 0, "to": 1}, {"version_id": "' :air '", "from": 0, "to": 0}]'
\set seq2 '[{"version_id": "' :water '", "from": 0, "to": 1}, {"version_id": "' :air '", "from": 0, "to": 1}]'
select (public.hs_weekly_edition_sequence_set(:'ed', :'seq'::jsonb) ->> 'digest') as dg \gset

-- R01 the table is private: RLS on, no privilege for anon or authenticated; the bucket is private with one admin read policy
reset role;
select 'R01|' || ((select relrowsecurity from pg_class where oid = 'public.weekly_edition_renders'::regclass)
  and not has_table_privilege('anon', 'public.weekly_edition_renders', 'select')
  and not has_table_privilege('authenticated', 'public.weekly_edition_renders', 'select,insert,update,delete')
  and (select not public from storage.buckets where id = 'weekly-media')
  and (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'weekly_media_admin_read'
       and roles = '{authenticated}' and cmd = 'SELECT') = 1
  and not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and qual like '%weekly-media%' and policyname <> 'weekly_media_admin_read' and 'authenticated' = any (roles)));
-- R02 only service_role may claim, finish or fail; only authenticated (admin-checked) may request or list
select 'R02|' || (not has_function_privilege('authenticated', 'public.weekly_edition_render_claim(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_edition_render_finish(uuid,jsonb,jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_edition_render_fail(uuid,text)', 'execute')
  and not has_function_privilege('anon', 'public.hs_weekly_edition_render(uuid,text)', 'execute')
  and not has_function_privilege('authenticated', 'public._wk_render_dispatch(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.weekly_edition_render_version_claim(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.weekly_edition_render_claim(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.hs_weekly_edition_render(uuid,text)', 'execute'));

-- R03 a signed-in non-admin is refused
select set_config('test.jwt', :'nobody', false);
set role authenticated;
select 'R03|' || pg_temp.raises(format('select public.hs_weekly_edition_render(%L, %L)', :'ed', :'dg'), '42501');
select set_config('test.jwt', :'admin', false);
-- R04 a sequence that is not approved cannot be rendered
select 'R04|' || coalesce(pg_temp.err(format('select public.hs_weekly_edition_render(%L, %L)', :'ed', :'dg')) like '%not approved%', false);
select public.hs_weekly_edition_sequence_approve(:'ed', :'dg') is not null as t \gset
-- R05 only the digest the person reviewed: another digest is refused with 40001 and creates nothing
select 'R05|' || pg_temp.raises(format('select public.hs_weekly_edition_render(%L, %L)', :'ed', repeat('0', 64)), '40001');
reset role;
select 'R05b|' || ((select count(*) from public.weekly_edition_renders) = 0 and (select count(*) from net.calls) = :n0);
-- R06 a request creates one queued render and dispatches weekly-render.yml on main with that render's id
select set_config('test.jwt', :'admin', false);
set role authenticated;
select public.hs_weekly_edition_render(:'ed', :'dg') as r1 \gset
reset role;
select (:'r1'::jsonb ->> 'id') as rid \gset
select 'R06|' || ((:'r1'::jsonb ->> 'status') = 'queued' and (:'r1'::jsonb ->> 'existing') = 'false' and (:'r1'::jsonb ->> 'dispatched') = 'true'
  and (select count(*) from net.calls) = :n0 + 1
  and (select url from net.calls order by id desc limit 1) = 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/weekly-render.yml/dispatches'
  and (select body from net.calls order by id desc limit 1) = jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('render', :'rid')));
-- R07 asking again while it is queued returns the same render and dispatches nothing more
set role authenticated;
select public.hs_weekly_edition_render(:'ed', :'dg') as r2 \gset
reset role;
select 'R07|' || ((:'r2'::jsonb ->> 'id') = :'rid' and (:'r2'::jsonb ->> 'existing') = 'true'
  and (select count(*) from net.calls) = :n0 + 1 and (select count(*) from public.weekly_edition_renders) = 1);
-- R08 the claim: running, the render export (approved) and one stored-document claim per version in the sequence
set role service_role;
select public.weekly_edition_render_claim(:'rid') as c1 \gset
reset role;
select 'R08|' || ((:'c1'::jsonb ->> 'ok') = 'true' and (:'c1'::jsonb -> 'export' ->> 'approved') = 'true'
  and (:'c1'::jsonb -> 'export' ->> 'digest') = :'dg'
  and jsonb_array_length(:'c1'::jsonb -> 'claims') = 2
  and (:'c1'::jsonb ->> 'output_prefix') = :'ed' || '/' || :'rid' || '/'
  and (select status from public.weekly_edition_renders where id = :'rid') = 'running'
  and (select started_at is not null from public.weekly_edition_renders where id = :'rid'));
-- R09 a render is claimed once
set role service_role;
select 'R09|' || pg_temp.raises(format('select public.weekly_edition_render_claim(%L)', :'rid'), '55000');
reset role;

-- R10 finishing needs a video, captions and a thumbnail, inside its own folder, each stored with the stated size
\set p :ed '/' :rid '/'
\set sha 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
select format('[{"path":"%sweekly.mp4","kind":"video","bytes":1000,"sha256":"%s"},{"path":"%sweekly.srt","kind":"captions","bytes":10,"sha256":"%s"},{"path":"%sthumbnail.png","kind":"thumbnail","bytes":20,"sha256":"%s"}]',
  :'p', :'sha', :'p', :'sha', :'p', :'sha') as files \gset
select format('[{"path":"%sweekly.mp4","kind":"video","bytes":1000,"sha256":"%s"},{"path":"%sweekly.srt","kind":"captions","bytes":10,"sha256":"%s"}]',
  :'p', :'sha', :'p', :'sha') as nothumb \gset
select format('[{"path":"%sweekly.mp4","kind":"video","bytes":1000,"sha256":"%s"},{"path":"%sweekly.srt","kind":"captions","bytes":10,"sha256":"%s"},{"path":"other/thumbnail.png","kind":"thumbnail","bytes":20,"sha256":"%s"}]',
  :'p', :'sha', :'p', :'sha', :'sha') as outside \gset
set role service_role;
select 'R10|' || coalesce(pg_temp.err(format('select public.weekly_edition_render_finish(%L, %L::jsonb, %L::jsonb)', :'rid', :'nothumb', '{}')) like '%no thumbnail file%', false);
select 'R10b|' || coalesce(pg_temp.err(format('select public.weekly_edition_render_finish(%L, %L::jsonb, %L::jsonb)', :'rid', :'outside', '{}')) like '%is outside%', false);
select 'R10c|' || coalesce(pg_temp.err(format('select public.weekly_edition_render_finish(%L, %L::jsonb, %L::jsonb)', :'rid', :'files', '{}')) like '%is not in weekly-media%', false);
insert into storage.objects (bucket_id, name, metadata) values
  ('weekly-media', :'p' || 'weekly.mp4', '{"size": 1000}'), ('weekly-media', :'p' || 'weekly.srt', '{"size": 11}'),
  ('weekly-media', :'p' || 'thumbnail.png', '{"size": 20}');
select 'R10d|' || coalesce(pg_temp.err(format('select public.weekly_edition_render_finish(%L, %L::jsonb, %L::jsonb)', :'rid', :'files', '{}')) like '%has 11 bytes, not 10%', false);
reset role;
select 'R10e|' || ((select status from public.weekly_edition_renders where id = :'rid') = 'running');
update storage.objects set metadata = '{"size": 10}' where name = :'p' || 'weekly.srt';
-- R11 a complete set is recorded: done, and current while the approved digest is the one rendered
set role service_role;
select public.weekly_edition_render_finish(:'rid', :'files'::jsonb, '{"duration_s": 60}'::jsonb) as f1 \gset
reset role;
select 'R11|' || ((:'f1'::jsonb ->> 'status') = 'done' and (:'f1'::jsonb ->> 'current') = 'true' and jsonb_array_length(:'f1'::jsonb -> 'files') = 3);
-- R12 the stored video: an admin can read it, a signed-in non-admin and anon cannot
select set_config('test.jwt', :'admin', false);
set role authenticated;
select 'R12|' || ((select count(*) from storage.objects where bucket_id = 'weekly-media') = 3);
select set_config('test.jwt', :'nobody', false);
select 'R12b|' || ((select count(*) from storage.objects where bucket_id = 'weekly-media') = 0);
reset role;
set role anon;
select 'R12c|' || ((select count(*) from storage.objects where bucket_id = 'weekly-media') = 0);
reset role;
-- R13 asking again for content already rendered returns that render: no second render, no dispatch
select set_config('test.jwt', :'admin', false);
set role authenticated;
select public.hs_weekly_edition_render(:'ed', :'dg') as r3 \gset
reset role;
select 'R13|' || ((:'r3'::jsonb ->> 'id') = :'rid' and (:'r3'::jsonb ->> 'existing') = 'true'
  and (select count(*) from net.calls) = :n0 + 1 and (select count(*) from public.weekly_edition_renders) = 1);
-- R14 a finished render is final, and its identity never changes; no row is deleted
select 'R14|' || pg_temp.raises(format('update public.weekly_edition_renders set status = %L where id = %L', 'running', :'rid'), '55000');
select 'R14b|' || pg_temp.raises(format('update public.weekly_edition_renders set digest = repeat(%L, 64) where id = %L', 'b', :'rid'), '55000');
select 'R14c|' || pg_temp.raises(format('delete from public.weekly_edition_renders where id = %L', :'rid'), '55000');
-- R15 a new order and its approval: the old render is no longer current, and a new request makes a new render
select set_config('test.jwt', :'admin', false);
set role authenticated;
select (public.hs_weekly_edition_sequence_set(:'ed', :'seq2'::jsonb) ->> 'digest') as dg2 \gset
select public.hs_weekly_edition_sequence_approve(:'ed', :'dg2') is not null as t \gset
select ((public.hs_weekly_edition_renders(:'ed') -> 0) ->> 'current') as old_current \gset
select public.hs_weekly_edition_render(:'ed', :'dg2') as r4 \gset
reset role;
select (:'r4'::jsonb ->> 'id') as rid2 \gset
select 'R15|' || (:'old_current' = 'false' and (:'r4'::jsonb ->> 'existing') = 'false' and :'rid2' <> :'rid'
  and (select count(*) from net.calls) = :n0 + 2);
-- R16 the approval changed after the request: the claim fails the render with that reason and returns nothing to render
set role authenticated;
select public.hs_weekly_edition_sequence_set(:'ed', :'seq3'::jsonb) is not null as t \gset
reset role;
set role service_role;
select public.weekly_edition_render_claim(:'rid2') as c2 \gset
reset role;
select 'R16|' || ((:'c2'::jsonb ->> 'ok') = 'false' and not (:'c2'::jsonb ? 'export')
  and (select status from public.weekly_edition_renders where id = :'rid2') = 'failed'
  and (select error from public.weekly_edition_renders where id = :'rid2') like 'the sequence is no longer approved%');
-- R17 no dispatch credential: the render is recorded as failed with the reason, and nothing was started
delete from vault.decrypted_secrets where name = 'github_actions_pat';
select (public.weekly_edition_video(:'ed') ->> 'digest') as dg3 \gset
set role authenticated;
select public.hs_weekly_edition_sequence_approve(:'ed', :'dg3') is not null as t \gset
select public.hs_weekly_edition_render(:'ed', :'dg3') as r5 \gset
reset role;
select 'R17|' || ((:'r5'::jsonb ->> 'status') = 'failed' and (:'r5'::jsonb ->> 'dispatched') = 'false'
  and (:'r5'::jsonb ->> 'error') like '%github_actions_pat%' and (select count(*) from net.calls) = :n0 + 2);
insert into vault.decrypted_secrets values ('github_actions_pat', 'TEST-PAT-not-real');
-- R18 the worker can record a failure; it is final
set role authenticated;
select public.hs_weekly_edition_render(:'ed', :'dg3') as r6 \gset
reset role;
select (:'r6'::jsonb ->> 'id') as rid3 \gset
set role service_role;
select public.weekly_edition_render_fail(:'rid3', 'the audio gate refused the mix') is null as t \gset
reset role;
select 'R18|' || ((select status from public.weekly_edition_renders where id = :'rid3') = 'failed'
  and (select error from public.weekly_edition_renders where id = :'rid3') = 'the audio gate refused the mix');
-- R19 a published edition cannot be rendered, and a queued render of it fails at claim
set role authenticated;
select public.hs_weekly_edition_render(:'ed', :'dg3') as r7 \gset
reset role;
select (:'r7'::jsonb ->> 'id') as rid4 \gset
update public.weekly_editions set video_url = 'https://example.invalid/published', published_on = current_date,
  publication_recorded_by = 'suite', publication_recorded_at = now() where id = :'ed';
set role authenticated;
select 'R19|' || pg_temp.raises(format('select public.hs_weekly_edition_render(%L, %L)', :'ed', :'dg3'), '55000');
reset role;
set role service_role;
select public.weekly_edition_render_claim(:'rid4') as c4 \gset
reset role;
select 'R19b|' || ((:'c4'::jsonb ->> 'ok') = 'false' and (:'c4'::jsonb ->> 'reason') = 'the edition is published');
-- R20 the per-version claim equals what weekly_run_claim (3) returns for a visual_check run of the same version
insert into public.weekly_runs (kind, topic, input, status, requested_by)
  select 'visual_check', topic, jsonb_build_object('version_id', id), 'queued', 'suite' from public.weekly_scripts where id = :'air'
  returning id as vrun \gset
select public.weekly_run_claim(:'vrun') as rc \gset
select public.weekly_edition_render_version_claim(:'air') as mc \gset
select 'R20|' || ((:'rc'::jsonb -> 'cue_version') = (:'mc'::jsonb -> 'cue_version') and (:'rc'::jsonb -> 'sources') = (:'mc'::jsonb -> 'sources')
  and (:'rc'::jsonb -> 'findings') = (:'mc'::jsonb -> 'findings') and (:'rc'::jsonb -> 'topic') = (:'mc'::jsonb -> 'topic')
  and jsonb_array_length(:'mc'::jsonb -> 'sources') > 0 and jsonb_array_length(:'mc'::jsonb -> 'findings') > 0
  and (:'mc'::jsonb ->> 'run') is not null);
-- R20b a stored document that belongs to another topic's library is not offered for this version: a copy of Air's
-- stored source, linked only to a Water finding (seeded with triggers off, TEST DATA), stays out of Air's claim
set session_replication_role = replica;
create temp table src_copy as select * from public.weekly_sources where document_path is not null limit 1;
update src_copy set id = gen_random_uuid();
update src_copy set document_path = 'weekly-sources/' || id::text || '/' || document_sha256 || '.' || document_kind;
insert into public.weekly_sources select * from src_copy;
insert into public.weekly_finding_sources (finding_id, source_id)
  select (select f.id from public.weekly_findings f join public.weekly_library_version_findings x on x.finding_id = f.id
          join public.weekly_scripts v on v.library_version_id = x.library_version_id where v.id = :'water' limit 1), id from src_copy;
set session_replication_role = origin;
select 'R20b|' || (jsonb_array_length(public.weekly_edition_render_version_claim(:'air') -> 'sources') = jsonb_array_length(:'mc'::jsonb -> 'sources')
  and not (public.weekly_edition_render_version_claim(:'air') -> 'sources')::text like '%' || (select id from src_copy)::text || '%');
-- R21 a render that is not finished keeps its identity, moves only forward, and is never deleted
insert into public.weekly_edition_renders (edition_id, sequence_id, approval_id, digest, requested_by)
  select edition_id, sequence_id, approval_id, digest, 'suite' from public.weekly_edition_renders where id = :'rid'
  returning id as rq \gset
select 'R21|' || pg_temp.raises(format('update public.weekly_edition_renders set digest = repeat(%L, 64) where id = %L', 'c', :'rq'), '55000');
select 'R21b|' || pg_temp.raises(format('update public.weekly_edition_renders set status = %L where id = %L', 'done', :'rq'), '55000');
select 'R21c|' || pg_temp.raises(format('delete from public.weekly_edition_renders where id = %L', :'rq'), '55000');
select 'R21d|' || pg_temp.raises(format('update public.weekly_edition_renders set error = %L where id = %L', 'rewritten', :'rid3'), '55000');
