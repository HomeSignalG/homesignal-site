-- Executable acceptance suite for docs/youtube-channel-sync.sql. Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', json_build_object('email', e)::text, false) $$;
create function pg_temp.throws(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create function pg_temp.job(sl text, k text) returns public.video_bluesky_jobs language sql as $$ select * from public.video_bluesky_jobs where slug=sl and file_key=k $$;
create function pg_temp.vid(v text) returns public.youtube_channel_videos language sql as $$ select * from public.youtube_channel_videos where video_id=v $$;
create function pg_temp.url(sl text) returns text language sql as $$ select youtube_url from public.youtube_video_reviews where slug=sl $$;
create function pg_temp.row(v text, sl text, k text, st text, pub boolean, priv text default 'public') returns jsonb language sql as $$
  select jsonb_build_object('video_id', v, 'title', 'T '||v, 'privacy_status', priv, 'upload_status', 'processed',
         'publish_at', case when not pub then (now() + interval '3 days')::text end, 'published_at', now()::text, 'duration_s', 300,
         'public_verified', pub, 'slug', sl, 'file_key', k, 'match_state', st, 'match_note', 'test') $$;

insert into public.youtube_video_reviews (slug, title, files, meta, bsky_posts) select s, 'Project '||s,
 jsonb_build_object('final', jsonb_build_object('path', s||'/final.mp4','bytes',2000,'sha256','f'),
                    'short1', jsonb_build_object('path', s||'/short1.mp4','bytes',900,'sha256','s1')), '{}',
 '{"final":{"caption":"Main video caption.","hashtags":["Tacoma","JodyTracks"],"alt":"Map","link_youtube":true},
   "short1":{"caption":"Will this mean more traffic?","hashtags":["Tacoma","JodyTracks"],"alt":"Short alt","link_youtube":true}}'
 from unnest(array['old','p1','p2','p3']) s;
insert into storage.objects (bucket_id, name, metadata) select 'jody-videos', s||'/'||f, jsonb_build_object('size', b)
 from unnest(array['old','p1','p2','p3']) s, (values ('final.mp4',2000),('short1.mp4',900)) v(f,b);
update public.youtube_video_reviews set reconcile_required = false;

-- 0. the composer carries the site link once
select pg_temp.chk('0a every video post carries https://jodytracks.com', public.video_bsky_text('p1','final') = E'Main video caption.\nhttps://jodytracks.com\n\n#Tacoma #JodyTracks');
update public.youtube_video_reviews set bsky_posts = jsonb_set(bsky_posts, '{short1,caption}', '"More: jodytracks.com"') where slug='p3';
select pg_temp.chk('0b a caption that already names the site does not get it twice', public.video_bsky_text('p3','short1') = E'More: jodytracks.com\n\n#Tacoma #JodyTracks');

-- 1. the first import is historical: recorded, never linked
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('OLDVIDEO001','old','final','matched',true)), 'oauth');
select pg_temp.chk('1a first import is marked historical', (pg_temp.vid('OLDVIDEO001')).historical);
select pg_temp.chk('1b a historical video never fills the project link', pg_temp.url('old') is null and (pg_temp.vid('OLDVIDEO001')).link_state = 'historical');
select pg_temp.chk('1c a run is logged', (select count(*) from public.youtube_sync_runs where ok) = 1);

-- 2. a scheduled (not yet public) full video is matched but not linked; the approved Short waits
select pg_temp.as_user('founder@example.com');
select public.hs_youtube_video_file_decide('p1','short1','approved');
select pg_temp.chk('2a the approved Short is held for its missing link', (pg_temp.job('p1','short1')).status='held' and (pg_temp.job('p1','short1')).hold_reason like '%missing_youtube_url%');
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('NEWVIDEO001','p1','final','matched',false,'private'),
                                                    pg_temp.row('NEWSHORT001','p1','short1','matched',false,'private')), 'oauth');
select pg_temp.chk('2b a new video is not historical', not (pg_temp.vid('NEWVIDEO001')).historical);
select pg_temp.chk('2c a scheduled video is waiting, its link is NOT written', (pg_temp.vid('NEWVIDEO001')).link_state='waiting_public' and pg_temp.url('p1') is null);
select pg_temp.chk('2d the scheduled time is kept', (pg_temp.vid('NEWVIDEO001')).publish_at > now());
select pg_temp.chk('2e the Short is still held', (pg_temp.job('p1','short1')).status='held');
select pg_temp.chk('2f a Short never becomes the project link', (pg_temp.vid('NEWSHORT001')).link_state is null);

-- 3. the video goes public: the link is written and the held Short is released with it
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('NEWVIDEO001','p1','final','matched',true)), 'oauth');
select pg_temp.chk('3a the verified public link is written', pg_temp.url('p1') = 'https://youtu.be/NEWVIDEO001');
select pg_temp.chk('3b the Short is released', (pg_temp.job('p1','short1')).status='scheduled');
select pg_temp.chk('3c the Short links to the FULL investigation and the site', (pg_temp.job('p1','short1')).post_text
   = E'Will this mean more traffic?\nhttps://youtu.be/NEWVIDEO001\nhttps://jodytracks.com\n\n#Tacoma #JodyTracks');
-- 4. duplicate sync events change nothing
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('NEWVIDEO001','p1','final','matched',true)), 'oauth');
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('NEWVIDEO001','p1','final','matched',true)), 'oauth');
select pg_temp.chk('4a one row per video', (select count(*) from public.youtube_channel_videos where video_id='NEWVIDEO001') = 1);
select pg_temp.chk('4b one job, still scheduled, same text', (select count(*) from public.video_bluesky_jobs where slug='p1' and file_key='short1')=1
   and (pg_temp.job('p1','short1')).status='scheduled');
select pg_temp.chk('4c video ids are unique in the table', pg_temp.throws($q$insert into public.youtube_channel_videos(video_id) values ('NEWVIDEO001')$q$));
-- 5. a second video claiming the same item is put up for review, not linked
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('REUPLOAD001','p1','final','matched',true)), 'oauth');
select pg_temp.chk('5a a re-upload of the same item needs review', (pg_temp.vid('REUPLOAD001')).match_state='needs_review' and pg_temp.url('p1') = 'https://youtu.be/NEWVIDEO001');
-- 6. an existing different link is never replaced
update public.youtube_video_reviews set youtube_url = 'https://youtu.be/HANDENTERED' where slug='p2';
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('P2VIDEO0001','p2','final','matched',true)), 'oauth');
select pg_temp.chk('6a conflict is recorded and the hand-entered link stays', (pg_temp.vid('P2VIDEO0001')).link_state='conflict' and pg_temp.url('p2')='https://youtu.be/HANDENTERED');
-- 7. unmatched / needs_review never link anything
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('UNKNOWN0001',null,null,'unmatched',true), pg_temp.row('UNSURE00001','p3','final','needs_review',true)), 'oauth');
select pg_temp.chk('7a unmatched and uncertain videos carry no project', (pg_temp.vid('UNKNOWN0001')).slug is null and (pg_temp.vid('UNSURE00001')).slug is null and pg_temp.url('p3') is null);
select pg_temp.chk('7b a bad match state is refused', pg_temp.throws($q$select public.youtube_sync_record('[{"video_id":"BADSTATE001","match_state":"linked"}]')$q$));
-- 8. a link to a channel video that is not public holds the item
select public.hs_youtube_video_file_decide('p3','short1','pending');
update public.youtube_video_reviews set youtube_url = 'https://youtu.be/UNSURE00001' where slug='p3';
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('UNSURE00001',null,null,'needs_review',false,'private')), 'oauth');
select pg_temp.chk('8a youtube_not_public is a problem', 'youtube_not_public' = any(public.video_bsky_problems('p3','short1')));
select public.hs_youtube_video_file_decide('p3','short1','approved');
select pg_temp.chk('8b approving it holds the job', (pg_temp.job('p3','short1')).status='held' and (pg_temp.job('p3','short1')).hold_reason like '%youtube_not_public%');
-- 9. manual correction
select public.hs_youtube_channel_video_match('UNSURE00001','p3','final');
select pg_temp.chk('9a a manual match sticks', (pg_temp.vid('UNSURE00001')).match_method='manual' and (pg_temp.vid('UNSURE00001')).match_state='matched');
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('UNSURE00001',null,null,'unmatched',true)), 'oauth');
select pg_temp.chk('9b the sync does not undo a manual match, and releases the job when public', (pg_temp.vid('UNSURE00001')).match_state='matched'
   and (pg_temp.job('p3','short1')).status='scheduled');
select public.hs_youtube_channel_video_match('UNKNOWN0001', null, null);
select public.youtube_sync_record(jsonb_build_array(pg_temp.row('UNKNOWN0001','p2','short1','matched',true)), 'oauth');
select pg_temp.chk('9c "not ours" sticks', (pg_temp.vid('UNKNOWN0001')).match_state='not_ours');
select pg_temp.chk('9d two videos cannot be matched to one item by hand', pg_temp.throws($q$select public.hs_youtube_channel_video_match('REUPLOAD001','p1','final')$q$));
select pg_temp.chk('9f the list says public-only, never the credential mode', not (public.hs_youtube_channel_videos_list()->'last_run' ? 'mode') and (public.hs_youtube_channel_videos_list()->'last_run'->>'public_only') = 'false');
select pg_temp.chk('9e the founder sees the list', jsonb_array_length(public.hs_youtube_channel_videos_list()->'videos') >= 6);
-- 10. permissions
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('10a a non-admin cannot list or match', pg_temp.throws($q$select public.hs_youtube_channel_videos_list()$q$) and pg_temp.throws($q$select public.hs_youtube_channel_video_match('UNKNOWN0001',null,null)$q$));
select pg_temp.chk('10b anon/authenticated cannot write sync data', not has_function_privilege('authenticated','public.youtube_sync_record(jsonb,text,jsonb)','execute')
   and not has_function_privilege('anon','public.youtube_sync_record(jsonb,text,jsonb)','execute')
   and not has_function_privilege('authenticated','public.video_youtube_link_attach(text)','execute'));
select pg_temp.chk('10c the tables have no direct grants', not has_table_privilege('authenticated','public.youtube_channel_videos','select') and not has_table_privilege('anon','public.youtube_sync_runs','select'));
select pg_temp.chk('10d service_role can write', has_function_privilege('service_role','public.youtube_sync_record(jsonb,text,jsonb)','execute'));
\o
select 'ALL ' || count(*) || ' CHECKS PASSED' from _res where ok;
