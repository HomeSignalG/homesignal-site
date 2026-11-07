-- docs/youtube-video-outdated.sql on a disposable Postgres. The case: video 3014's main video version 4 was built
-- from a script older than the founder's checklist note, and the page showed it as ready to review.
\set ON_ERROR_STOP 1
create function pg_temp.ok(c boolean, what text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', what; end if; raise notice 'ok %', what; end $$;
create function pg_temp.od(s text, k text) returns boolean language sql as $$
  select (public._hs_yv_file_outdated(s, k) ->> 'outdated')::boolean $$;
select set_config('test.jwt', '{"email":"founder@example.com"}', false);

insert into public.youtube_video_reviews (slug, title, files, file_decisions, status, meta, created_at)
values ('od', 'Outdated', '{"final":{"path":"od/final.mp4","bytes":10,"version":4},"short1":{"path":"od/s1.mp4","bytes":5},
          "thumbnail":{"path":"od/t.png","bytes":5,"version":2}}', '{}', 'pending', '{}', '2026-11-07 01:00Z');
insert into public.youtube_video_versions (slug, file_key, version, path, bytes, sha256, meta, created_at) values
  ('od', 'final', 4, 'od/v4.mp4', 10, repeat('a', 64), '{"project_fp":{"all":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","video":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}', '2026-11-07 15:25Z'),
  ('od', 'thumbnail', 2, 'od/t2.png', 5, repeat('b', 64), '{}', '2026-11-07 15:26Z');

do $$ declare r jsonb; begin
  -- no head yet: nothing is called out of date, nothing blocked
  perform pg_temp.ok(public._hs_yv_file_outdated('od', 'final') ->> 'state' = 'unknown' and not pg_temp.od('od', 'final'),
    'a project not on main reads unknown and blocks nothing');
  -- the script on main changed at 15:21, i.e. BEFORE version 4 was made at 15:25
  perform public.hs_youtube_project_heads_set('[{"slug":"od","fp_all":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","fp_video":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "commit":"3333333333333333333333333333333333333333","committed_at":"2026-11-07T15:21:29Z"}]');
  perform pg_temp.ok(pg_temp.od('od', 'final'), 'a version built from an older script is out of date even though it was made later');
  -- no recorded fingerprint: the time rule. Thumbnail v2 made 15:26, after the 15:21 change: not called out of date
  perform pg_temp.ok(not pg_temp.od('od', 'thumbnail') and public._hs_yv_file_outdated('od', 'thumbnail') ->> 'state' = 'time',
    'with no recorded fingerprint, a file made after the last script change is not called out of date');
  -- the original upload (version 1, no versions row) was made at 01:00, before the change
  perform pg_temp.ok(pg_temp.od('od', 'short1'), 'an original upload older than the script change is out of date');
  -- approval is refused, rejecting is not
  begin perform public.hs_youtube_video_file_decide('od', 'final', 'approved', null);
    perform pg_temp.ok(false, 'approving an out-of-date file is refused');
  exception when sqlstate '55006' then perform pg_temp.ok(true, 'approving an out-of-date file is refused'); end;
  r := public.hs_youtube_video_file_decide('od', 'final', 'rejected', 'still has the checklist');
  perform pg_temp.ok(r ->> 'file_status' = 'rejected', 'rejecting an out-of-date file still works');
  -- a backfill sets fingerprints only where none are recorded
  perform public.hs_youtube_version_fp_set('od', 'final', 4, '{"all":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","video":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}', 'code_commit');
  perform pg_temp.ok((select meta -> 'project_fp' ->> 'video' from public.youtube_video_versions where slug = 'od' and file_key = 'final' and version = 4)
    = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'fingerprints recorded at build time are never replaced');
  perform public.hs_youtube_version_fp_set('od', 'original', 1, '{"all":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","video":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}', 'build_run');
  perform pg_temp.ok(not pg_temp.od('od', 'short1'), 'an original upload built from the current script is current');
  -- the thumbnail compares 'all', the videos 'video': a thumbnail-only change leaves the videos current
  update public.youtube_video_project_heads set fp_all = 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' where slug = 'od';
  update public.youtube_video_versions set meta = '{"project_fp":{"all":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","video":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}'
   where slug = 'od' and file_key = 'thumbnail' and version = 2;
  perform pg_temp.ok(pg_temp.od('od', 'thumbnail') and not pg_temp.od('od', 'short1'),
    'a thumbnail-only change makes the thumbnail out of date and not the videos');
  -- a version built from the current script is current and can be approved
  update public.youtube_video_versions set meta = '{"project_fp":{"all":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","video":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}}'
   where slug = 'od' and file_key = 'final' and version = 4;
  r := public.hs_youtube_video_file_decide('od', 'final', 'approved', null);
  perform pg_temp.ok(r ->> 'file_status' = 'approved', 'a file built from the current script can be approved');
  -- the list carries the decision per file
  r := (select e from jsonb_array_elements(public.hs_youtube_videos_list()) e where e ->> 'slug' = 'od');
  perform pg_temp.ok(r -> 'outdated' -> 'final' ->> 'outdated' = 'false' and r -> 'outdated' ? 'thumbnail',
    'the list sends each file''s decision');
end $$;

-- only the service role writes heads and fingerprints; nobody else can run the helpers
do $$ begin
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.hs_youtube_project_heads_set(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.hs_youtube_version_fp_set(text,text,int,jsonb,text)', 'execute')
    and not has_function_privilege('authenticated', 'public._hs_yv_file_outdated(text,text)', 'execute')
    and has_function_privilege('service_role', 'public.hs_youtube_project_heads_set(jsonb)', 'execute'),
    'heads and fingerprints are service-role only');
end $$;
\echo all outdated checks passed
