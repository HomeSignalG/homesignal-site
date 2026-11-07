-- docs/youtube-video-outdated-parts.sql on a disposable Postgres. The case: #1049 changed only each Short's opening
-- statement, and the first live reading called every main video and every thumbnail out of date.
\set ON_ERROR_STOP 1
create function pg_temp.ok(c boolean, what text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', what; end if; raise notice 'ok %', what; end $$;
create function pg_temp.od(s text, k text) returns boolean language sql as $$
  select (public._hs_yv_file_outdated(s, k) ->> 'outdated')::boolean $$;
create function pg_temp.h(c text) returns text language sql as $$ select repeat(c, 64) $$;
select set_config('test.jwt', '{"email":"founder@example.com"}', false);

-- files made at 12:00; version 2 of each recorded with every part ('a' main, 'b' video, 'c' thumb, 'd' all)
insert into public.youtube_video_reviews (slug, title, files, file_decisions, status, meta, created_at)
values ('pt', 'Parts', '{"final":{"path":"pt/f.mp4","bytes":1,"version":2},"short1":{"path":"pt/s1.mp4","bytes":1,"version":2},
          "short2":{"path":"pt/s2.mp4","bytes":1},"thumbnail":{"path":"pt/t.png","bytes":1,"version":2}}', '{}', 'pending', '{}',
        '2026-11-07 11:00Z');
insert into public.youtube_video_versions (slug, file_key, version, path, bytes, sha256, meta, created_at)
select 'pt', k, 2, 'pt/' || k, 1, repeat('e', 64),
       jsonb_build_object('project_fp', jsonb_build_object('main', pg_temp.h('a'), 'video', pg_temp.h('b'),
                                                           'thumb', pg_temp.h('c'), 'all', pg_temp.h('d')),
                          'project_fp_basis', 'built'), '2026-11-07 12:00Z'
  from unnest(array['final', 'short1', 'thumbnail']) k;

do $$ declare r jsonb; begin
  -- an older ingest sends no parts: accepted, and the files are compared the old way
  perform public.hs_youtube_project_heads_set(jsonb_build_array(jsonb_build_object('slug', 'pt', 'fp_all', pg_temp.h('d'),
    'fp_video', pg_temp.h('b'), 'commit', repeat('1', 40), 'committed_at', '2026-11-07T10:00:00Z')));
  perform pg_temp.ok(not pg_temp.od('pt', 'final') and public._hs_yv_file_outdated('pt', 'final') ->> 'part' = 'video'
    and public._hs_yv_file_outdated('pt', 'thumbnail') ->> 'part' = 'all',
    'heads with no parts are accepted and the old comparison is used');

  -- the script on main now: only the Shorts changed ('video' and 'all' moved; 'main' and 'thumb' did not)
  perform public.hs_youtube_project_heads_set(jsonb_build_array(jsonb_build_object('slug', 'pt', 'fp_all', pg_temp.h('8'),
    'fp_video', pg_temp.h('9'), 'fp_main', pg_temp.h('a'), 'fp_thumb', pg_temp.h('c'), 'commit', repeat('2', 40),
    'committed_at', '2026-11-07T14:00:00Z', 'main_changed_at', '2026-11-07T09:00:00Z',
    'video_changed_at', '2026-11-07T14:00:00Z', 'thumb_changed_at', '2026-11-07T09:30:00Z')));
  perform pg_temp.ok(not pg_temp.od('pt', 'final') and public._hs_yv_file_outdated('pt', 'final') ->> 'part' = 'main',
    'a Shorts-only change leaves the main video current');
  perform pg_temp.ok(not pg_temp.od('pt', 'thumbnail') and public._hs_yv_file_outdated('pt', 'thumbnail') ->> 'part' = 'thumb',
    'a Shorts-only change leaves the thumbnail current');
  perform pg_temp.ok(pg_temp.od('pt', 'short1'), 'a Shorts-only change makes a Short out of date');
  -- the original upload of Short 2 (no fingerprint, made 11:00) and the Shorts changed at 14:00: time rule, out of date
  perform pg_temp.ok(pg_temp.od('pt', 'short2') and public._hs_yv_file_outdated('pt', 'short2') ->> 'state' = 'time',
    'with no fingerprint, a Short made before the Shorts last changed is out of date');
  -- the time rule reads the file's own part: a main video with no fingerprint, made 11:00, main last changed 09:00
  update public.youtube_video_versions set meta = '{}' where slug = 'pt' and file_key = 'final';
  update public.youtube_video_versions set created_at = '2026-11-07 11:00Z' where slug = 'pt' and file_key = 'final';
  perform pg_temp.ok(not pg_temp.od('pt', 'final') and public._hs_yv_file_outdated('pt', 'final') ->> 'state' = 'time',
    'with no fingerprint, the time rule uses when that file''s part last changed, not the folder');
  perform pg_temp.ok((public._hs_yv_file_outdated('pt', 'final') ->> 'script_changed_at')::timestamptz = '2026-11-07T09:00:00Z',
    'the page is told when that part changed');
  update public.youtube_video_project_heads set main_changed_at = null where slug = 'pt';
  perform pg_temp.ok(pg_temp.od('pt', 'final'), 'with no part time, the folder''s last change is used');

  -- a version recorded before the parts carries only all/video: compared on 'video', never on less
  update public.youtube_video_versions set meta = jsonb_build_object('project_fp', jsonb_build_object('all', pg_temp.h('d'),
    'video', pg_temp.h('b')), 'project_fp_basis', 'built') where slug = 'pt' and file_key = 'final';
  perform pg_temp.ok(pg_temp.od('pt', 'final') and public._hs_yv_file_outdated('pt', 'final') ->> 'part' = 'video',
    'a version with no main fingerprint is compared on the broader video one');

  -- approval follows the decision
  begin perform public.hs_youtube_video_file_decide('pt', 'short1', 'approved', null);
    perform pg_temp.ok(false, 'approving the out-of-date Short is refused');
  exception when sqlstate '55006' then perform pg_temp.ok(true, 'approving the out-of-date Short is refused'); end;
  r := public.hs_youtube_video_file_decide('pt', 'thumbnail', 'approved', null);
  perform pg_temp.ok(r ->> 'file_status' = 'approved', 'the current thumbnail can be approved');
end $$;

-- backfill: parts are added to a code_commit backfill, never to a build-time record, and nothing recorded is replaced
insert into public.youtube_video_versions (slug, file_key, version, path, bytes, sha256, meta, created_at) values
  ('pt', 'short2', 3, 'pt/s2v3', 1, repeat('e', 64), jsonb_build_object('project_fp', jsonb_build_object('all',
     repeat('d', 64), 'video', repeat('b', 64)), 'project_fp_basis', 'code_commit'), now()),
  ('pt', 'short2', 4, 'pt/s2v4', 1, repeat('e', 64), jsonb_build_object('project_fp', jsonb_build_object('all',
     repeat('d', 64), 'video', repeat('b', 64)), 'project_fp_basis', 'built'), now());
do $$ declare fp jsonb := jsonb_build_object('all', repeat('7', 64), 'video', repeat('7', 64), 'main', repeat('6', 64),
                                             'thumb', repeat('5', 64)); r jsonb; begin
  r := public.hs_youtube_version_fp_set('pt', 'short2', 3, fp, 'code_commit');
  perform pg_temp.ok((r ->> 'updated')::int = 1 and (select meta -> 'project_fp' from public.youtube_video_versions
      where slug = 'pt' and file_key = 'short2' and version = 3)
    = jsonb_build_object('all', repeat('d', 64), 'video', repeat('b', 64), 'main', repeat('6', 64), 'thumb', repeat('5', 64)),
    'a code-commit backfill gains the missing parts and keeps the recorded ones');
  r := public.hs_youtube_version_fp_set('pt', 'short2', 3, fp, 'code_commit');
  perform pg_temp.ok((r ->> 'updated')::int = 0, 'a second backfill changes nothing');
  r := public.hs_youtube_version_fp_set('pt', 'short2', 4, fp, 'code_commit');
  perform pg_temp.ok((r ->> 'updated')::int = 0 and not ((select meta -> 'project_fp' from public.youtube_video_versions
      where slug = 'pt' and file_key = 'short2' and version = 4) ? 'main'), 'a build-time record is never backfilled');
  begin perform public.hs_youtube_version_fp_set('pt', 'short2', 3, fp || '{"main":"X"}', 'code_commit');
    perform pg_temp.ok(false, 'a malformed part is refused');
  exception when sqlstate '22023' then perform pg_temp.ok(true, 'a malformed part is refused'); end;
end $$;
\echo all outdated-parts checks passed
