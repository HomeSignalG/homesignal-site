-- docs/video-endings.sql. Every check raises on failure (exit code = result).
\set ON_ERROR_STOP 1
create function pg_temp.ok(c boolean, what text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FAIL %', what; end if; raise notice 'ok %', what; end $$;
create function pg_temp.last_inputs() returns jsonb language sql as $$ select body -> 'inputs' from net.calls order by id desc limit 1 $$;
create function pg_temp.refused(sql text, what text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then raise notice 'ok refused: % (%)', what, sqlerrm; return; end;
  raise exception 'FAIL % was accepted', what;
end $$;

-- a visitor is refused everything
select set_config('test.jwt', '{"email":"someone@example.com"}', false);
select pg_temp.refused($$ select public.hs_video_endings_list() $$, 'a non-admin listing endings');
select set_config('test.jwt', '{"email":"founder@example.com"}', false);

insert into storage.objects (bucket_id, name, metadata)
values ('video-endings', '11111111-1111-1111-1111-111111111111.mp4', '{"size": 1234, "mimetype": "video/mp4"}'),
       ('video-endings', '22222222-2222-2222-2222-222222222222.mov', '{"size": 99, "mimetype": "video/quicktime"}');
insert into public.youtube_video_reviews (slug, title, files, file_decisions, status, meta)
values ('ve', 'Endings', '{"final":{"path":"ve/final.mp4","bytes":10},"short1":{"path":"ve/short1.mp4","bytes":5}}',
        '{}', 'pending', '{}');

do $$ declare e jsonb; e2 jsonb; r jsonb; rv public.youtube_video_revisions%rowtype; i jsonb; begin
  perform pg_temp.ok((select public from storage.buckets where id = 'video-endings') = false, 'the bucket is private');
  e := public.hs_video_ending_register('11111111-1111-1111-1111-111111111111.mp4', 'Sign-off A', repeat('a', 64));
  perform pg_temp.ok(e ->> 'id' = '11111111-1111-1111-1111-111111111111' and (e ->> 'bytes')::int = 1234, 'an upload is recorded with its size');
  perform pg_temp.ok(public.hs_video_ending_register('11111111-1111-1111-1111-111111111111.mp4', 'Again', repeat('a', 64)) ->> 'label' = 'Sign-off A',
                     'registering twice keeps the first record');
  e2 := public.hs_video_ending_register('22222222-2222-2222-2222-222222222222.mov', 'Sign-off B', repeat('b', 64));
  perform pg_temp.ok(jsonb_array_length(public.hs_video_endings_list()) = 2, 'both are listed');

  -- Tab 16: choosing starts a rebuild whose settings carry the ending
  perform public._hs_yv_ensure_v1('ve', 'short1');
  update public.youtube_video_versions set settings = '{"speed":0.95}' where slug = 've' and file_key = 'short1';
  r := public.hs_video_ending_choose('youtube', 've', 'short1', (e ->> 'id')::uuid);
  select * into rv from public.youtube_video_revisions where id = (r ->> 'revision_id')::uuid;
  i := pg_temp.last_inputs();
  perform pg_temp.ok(rv.plan ->> 'mode' = 'rebuild' and i ->> 'mode' = 'rebuild', 'choosing an ending rebuilds the file');
  perform pg_temp.ok((i ->> 'settings')::jsonb -> 'ending' ->> 'sha256' = repeat('a', 64)
                     and (i ->> 'settings')::jsonb ->> 'speed' = '0.95', 'the dispatch carries the ending and keeps the accepted fixes');
  perform pg_temp.ok(public.hs_video_ending_choices('youtube', 've') -> 'short1' ->> 'label' = 'Sign-off A', 'the choice is shown');
  perform pg_temp.ok((public.hs_video_ending_choose('youtube', 've', 'short1', (e ->> 'id')::uuid) ->> 'changed')::boolean = false,
                     'choosing the same ending again does nothing');
  perform pg_temp.refused(format($q$ select public.hs_video_ending_choose('youtube', 've', 'short1', %L) $q$, e2 ->> 'id'),
                          'a second ending while the file is being built');
  update public.youtube_video_revisions set status = 'succeeded' where id = rv.id;
  insert into public.youtube_video_versions (slug, file_key, version, settings, path, bytes)
  select 've', 'short1', 2, rv.settings, 've/short1-v2.mp4', 5;
  -- removing it rebuilds without it
  r := public.hs_video_ending_choose('youtube', 've', 'short1', null);
  perform pg_temp.ok(not ((pg_temp.last_inputs() ->> 'settings')::jsonb ? 'ending') and r ->> 'revision_id' is not null,
                     'removing the ending rebuilds without it');
  perform pg_temp.refused($q$ select public.hs_video_ending_choose('youtube', 've', 'thumbnail', null) $q$, 'an ending on a thumbnail');

  -- Tab 17 and Tab 20: the choice only; the engine reads it
  r := public.hs_video_ending_choose('impact', 'story-1', 'short_a', (e2 ->> 'id')::uuid);
  perform pg_temp.ok((r ->> 'prepare_again')::boolean and r ->> 'revision_id' is null, 'a Tab 17 choice asks to prepare the visuals again');
  perform pg_temp.ok(public.video_endings_current('impact', 'story-1') -> 'short_a' ->> 'path' = '22222222-2222-2222-2222-222222222222.mov',
                     'the engine reads the chosen recording');
  perform public.hs_video_ending_choose('impact', 'story-1', 'short_a', null);
  perform pg_temp.ok(public.video_endings_current('impact', 'story-1') = '{}'::jsonb, 'after removal the engine reads none');
  perform public.hs_video_ending_choose('weekly', 'edition-1', 'main', (e ->> 'id')::uuid);
  perform pg_temp.ok(public.hs_video_ending_choices('weekly', 'edition-1') -> 'main' ->> 'label' = 'Sign-off A', 'Tab 20 stores its choice');
  perform pg_temp.refused($q$ select public.hs_video_ending_choose('impact', 'story-1', 'final', null) $q$, 'a Tab 16 file name on Tab 17');

  -- archived recordings cannot be chosen; choices are append-only
  perform public.hs_video_ending_archive((e2 ->> 'id')::uuid);
  perform pg_temp.ok(jsonb_array_length(public.hs_video_endings_list()) = 1, 'an archived recording leaves the list');
  perform pg_temp.refused(format($q$ select public.hs_video_ending_choose('impact', 'story-2', 'main', %L) $q$, e2 ->> 'id'),
                          'choosing an archived recording');
  perform pg_temp.refused($q$ delete from public.video_ending_choices $q$, 'deleting choices');
  perform pg_temp.refused($q$ select public.hs_video_ending_register('33333333-3333-3333-3333-333333333333.mp4', 'X', repeat('c', 64)) $q$,
                          'registering a file that never arrived');
  perform pg_temp.refused($q$ select public.hs_video_ending_register('../x.mp4', 'X', repeat('c', 64)) $q$, 'a path outside the layout');
end $$;

-- two kinds of recording: vertical ends Shorts, horizontal ends main videos
insert into storage.objects (bucket_id, name, metadata)
values ('video-endings', '44444444-4444-4444-4444-444444444444.mp4', '{"size": 10, "mimetype": "video/mp4"}'),
       ('video-endings', '55555555-5555-5555-5555-555555555555.mp4', '{"size": 10, "mimetype": "video/mp4"}');
do $$ declare v jsonb; h jsonb; begin
  v := public.hs_video_ending_register('44444444-4444-4444-4444-444444444444.mp4', 'Vertical', repeat('d', 64), 'vertical');
  h := public.hs_video_ending_register('55555555-5555-5555-5555-555555555555.mp4', 'Horizontal', repeat('e', 64), 'horizontal');
  perform pg_temp.ok(v ->> 'shape' = 'vertical' and h ->> 'shape' = 'horizontal', 'each recording keeps its kind');
  perform pg_temp.ok(exists (select 1 from jsonb_array_elements(public.hs_video_endings_list()) x where x ->> 'shape' = 'vertical'),
                     'the list says which kind each is');
  perform pg_temp.refused(format($q$ select public.hs_video_ending_choose('impact', 'story-3', 'main', %L) $q$, v ->> 'id'),
                          'a vertical recording on a main video');
  perform pg_temp.refused(format($q$ select public.hs_video_ending_choose('impact', 'story-3', 'short_a', %L) $q$, h ->> 'id'),
                          'a horizontal recording on a Short');
  perform pg_temp.ok((public.hs_video_ending_choose('impact', 'story-3', 'short_b', (v ->> 'id')::uuid) ->> 'changed')::boolean
                     and (public.hs_video_ending_choose('impact', 'story-3', 'main', (h ->> 'id')::uuid) ->> 'changed')::boolean,
                     'each kind goes on its own kind of file');
  perform pg_temp.ok(public.video_endings_current('impact', 'story-3') -> 'short_b' ->> 'shape' = 'vertical', 'the engine sees the kind');
  perform pg_temp.refused($q$ select public.hs_video_ending_register('44444444-4444-4444-4444-444444444444.mp4', 'X', repeat('d', 64), 'square') $q$,
                          'a kind other than vertical or horizontal');
end $$;

-- grants: the engine reader is service-role only
select pg_temp.ok(not has_function_privilege('authenticated', 'public.video_endings_current(text,text)', 'execute')
                  and not has_function_privilege('anon', 'public.video_endings_current(text,text)', 'execute')
                  and has_function_privilege('service_role', 'public.video_endings_current(text,text)', 'execute'),
                  'only the service role reads the engine view');
select pg_temp.ok(not has_function_privilege('anon', 'public.hs_video_ending_choose(text,text,text,uuid)', 'execute'), 'visitors cannot choose');
