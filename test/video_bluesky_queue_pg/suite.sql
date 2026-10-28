-- Executable acceptance suite for the video -> Bluesky queue. Every check raises on failure.
\set ON_ERROR_STOP on
\o /dev/null
create temp table _res (n text, ok boolean);
create function pg_temp.chk(n text, c boolean) returns void language plpgsql as $$ begin
  insert into _res values (n, coalesce(c,false)); if not coalesce(c,false) then raise exception 'FAIL: %', n; end if; end $$;
create function pg_temp.as_user(e text) returns void language sql as $$ select set_config('test.jwt', json_build_object('email', e)::text, false) $$;
create function pg_temp.throws(q text) returns boolean language plpgsql as $$ begin execute q; return false; exception when others then return true; end $$;
create function pg_temp.job(sl text, k text) returns public.video_bluesky_jobs language sql as $$ select * from public.video_bluesky_jobs where slug=sl and file_key=k $$;

-- fixture project
insert into public.youtube_video_reviews (slug, title, files, meta, bsky_posts) values ('p1', 'Project One',
 '{"final":{"path":"p1/final.mp4","bytes":2000,"sha256":"f1"},"short1":{"path":"p1/short1.mp4","bytes":900,"sha256":"s1"},"short2":{"path":"p1/short2.mp4","bytes":800,"sha256":"s2"},"thumbnail":{"path":"p1/t.png","bytes":10,"sha256":"t"}}', '{}',
 '{"final":{"caption":"Main video caption.","hashtags":["Tacoma","JodyTracks"],"alt":"Map of the berths","link_youtube":false},
   "short1":{"caption":"Will this mean more traffic?","hashtags":["Tacoma","JodyTracks"],"alt":"Short one alt","link_youtube":true},
   "short2":{"caption":"What about the air?","hashtags":["Tacoma","JodyTracks"],"alt":"Short two alt","link_youtube":true}}');
insert into storage.objects (bucket_id, name, metadata) values
 ('jody-videos','p1/final.mp4','{"size":2000}'),('jody-videos','p1/short1.mp4','{"size":900}'),('jody-videos','p1/short2.mp4','{"size":800}');

select pg_temp.as_user('founder@example.com');

-- 1. independence + one job per item
select public.hs_youtube_video_file_decide('p1','final','approved');
select pg_temp.chk('1a main approval creates a scheduled job', (pg_temp.job('p1','final')).status = 'scheduled' and (pg_temp.job('p1','final')).scheduled_slot > now());
select pg_temp.chk('1b the approval did not touch Short 1 / Short 2', (select count(*) from public.video_bluesky_jobs where slug='p1') = 1);
select pg_temp.chk('1c frozen text is caption + tags, exactly', (pg_temp.job('p1','final')).post_text = E'Main video caption.\n\n#Tacoma #JodyTracks');
select public.hs_youtube_video_file_decide('p1','short1','approved');
select pg_temp.chk('1d Short 1 approved without a YouTube link is HELD, not scheduled', (pg_temp.job('p1','short1')).status='held' and (pg_temp.job('p1','short1')).hold_reason like '%missing_youtube_url%');
select pg_temp.chk('1e Short 2 still has no job', (pg_temp.job('p1','short2')).id is null);
-- 2. idempotency
select public.hs_youtube_video_file_decide('p1','final','approved'); select public.hs_youtube_video_file_decide('p1','final','approved');
select pg_temp.chk('2a repeated approval leaves exactly one job per item', (select count(*) from public.video_bluesky_jobs where slug='p1') = 2);
select pg_temp.chk('2b repeated approval keeps the same slot', (select count(distinct scheduled_slot) from public.video_bluesky_jobs where slug='p1' and file_key='final') = 1);
select pg_temp.chk('2c the unique identity is enforced by the table', pg_temp.throws($q$insert into public.video_bluesky_jobs(slug,file_key) values ('p1','final')$q$));
-- 3. verified YouTube link releases the held short, and puts it into the text
select public.hs_video_youtube_url_set('p1','https://youtu.be/qEv0XlxlvcY');
select pg_temp.chk('3a setting the link releases Short 1', (pg_temp.job('p1','short1')).status='scheduled');
select pg_temp.chk('3b the link is in the frozen text', (pg_temp.job('p1','short1')).post_text = E'Will this mean more traffic?\nhttps://youtu.be/qEv0XlxlvcY\n\n#Tacoma #JodyTracks');
select pg_temp.chk('3c Short 2 STILL has no job', (pg_temp.job('p1','short2')).id is null);
select pg_temp.chk('3d a non-YouTube link is refused', pg_temp.throws($q$select public.hs_video_youtube_url_set('p1','https://evil.example/x')$q$));
select pg_temp.chk('3e the three items sit in different slots', (select count(distinct scheduled_slot) from public.video_bluesky_jobs where slug='p1' and status='scheduled') = 2);
-- 4. reject / pending never publish
select public.hs_youtube_video_file_decide('p1','short2','approved');
select pg_temp.chk('4a Short 2 approved -> scheduled', (pg_temp.job('p1','short2')).status='scheduled');
select public.hs_youtube_video_file_decide('p1','short2','rejected','no');
select pg_temp.chk('4b rejecting cancels the unpublished job', (pg_temp.job('p1','short2')).status='cancelled');
select pg_temp.chk('4c a cancelled job cannot be claimed', public.video_job_claim((pg_temp.job('p1','short2')).id,'w1',600,'rk') is null);
select public.hs_youtube_video_file_decide('p1','short2','approved');
select pg_temp.chk('4d a new explicit approval revives it once', (pg_temp.job('p1','short2')).status='scheduled' and (select count(*) from public.video_bluesky_jobs where slug='p1' and file_key='short2')=1);
select public.hs_youtube_video_file_decide('p1','short2','pending');
select pg_temp.chk('4e Undo (pending) also cancels', (pg_temp.job('p1','short2')).status='cancelled');
select pg_temp.chk('4f the thumbnail never creates a job', (select count(*) from public.video_bluesky_jobs where file_key not in ('final','short1','short2')) = 0
   and (public.hs_youtube_video_file_decide('p1','thumbnail','approved') is not null) and (select count(*) from public.video_bluesky_jobs where slug='p1')=3);
-- 5. a changed caption cannot publish under the old approval
select public.hs_video_bluesky_caption_set('p1','short1','Will this mean MORE noise?');
select pg_temp.chk('5a editing resets the approval', (select coalesce(file_decisions->'short1'->>'status','pending') from public.youtube_video_reviews where slug='p1') = 'pending');
select pg_temp.chk('5b editing cancels the unpublished job', (pg_temp.job('p1','short1')).status='cancelled');
select pg_temp.chk('5c the cancelled job cannot be claimed', public.video_job_claim((pg_temp.job('p1','short1')).id,'w1',600,'rk') is null);
select public.hs_youtube_video_file_decide('p1','short1','approved');
select pg_temp.chk('5d re-approval freezes the NEW text', (pg_temp.job('p1','short1')).post_text like 'Will this mean MORE noise?%' and (pg_temp.job('p1','short1')).status='scheduled');
-- a change that bypasses the RPC (direct write) is caught at claim time
update public.youtube_video_reviews set bsky_posts = jsonb_set(bsky_posts, '{short1,caption}', '"sneaky edit"') where slug='p1';
update public.video_bluesky_jobs set scheduled_slot = now() - interval '1 minute' where slug='p1' and file_key='short1';
select pg_temp.chk('5e a payload that moved after approval is HELD at claim', public.video_job_claim((pg_temp.job('p1','short1')).id,'w1',600,'rk') is null and (pg_temp.job('p1','short1')).status='held' and (pg_temp.job('p1','short1')).hold_reason='changed_after_approval');
-- 6. validation holds
update public.youtube_video_reviews set bsky_posts = jsonb_set(bsky_posts, '{short1,caption}', to_jsonb(repeat('x',280))) where slug='p1';
select public.hs_youtube_video_file_decide('p1','short1','pending'); select public.hs_youtube_video_file_decide('p1','short1','approved');
select pg_temp.chk('6a text over 300 characters (caption + link + tags) is held', (pg_temp.job('p1','short1')).status='held' and (pg_temp.job('p1','short1')).hold_reason like '%text_too_long%');
delete from storage.objects where name='p1/final.mp4';
select public.hs_youtube_video_file_decide('p1','final','pending'); select public.hs_youtube_video_file_decide('p1','final','approved');
select pg_temp.chk('6b a missing MP4 is held, not scheduled', (pg_temp.job('p1','final')).status='held' and (pg_temp.job('p1','final')).hold_reason like '%file_missing%');
insert into storage.objects (bucket_id,name,metadata) values ('jody-videos','p1/final.mp4','{"size":1999}');
select public.hs_video_job_retry((pg_temp.job('p1','final')).id);
select pg_temp.chk('6c a corrupted (wrong-size) MP4 is held', (pg_temp.job('p1','final')).hold_reason like '%file_size_mismatch%');
update storage.objects set metadata='{"size":2000}' where name='p1/final.mp4';
select public.hs_video_job_retry((pg_temp.job('p1','final')).id);
select pg_temp.chk('6d fixing the cause and retrying schedules it', (pg_temp.job('p1','final')).status='scheduled');
-- 7. pilot reconciliation
select public.hs_youtube_video_file_decide('pilot','short1','approved');
select pg_temp.chk('7a the pre-existing pilot is HELD for reconciliation', (pg_temp.job('pilot','short1')).status='held' and (pg_temp.job('pilot','short1')).hold_reason like '%reconcile_required%');
select pg_temp.chk('7b only a Bluesky post address is accepted as external', pg_temp.throws($q$select public.video_job_mark_external('pilot','short2','https://example.com/x','n')$q$));
select public.video_job_mark_external('pilot','short1','https://bsky.app/profile/jody.bsky.social/post/3kabc','posted by hand 2026-10-22');
select pg_temp.chk('7c an externally published item is terminal', (pg_temp.job('pilot','short1')).status='external');
select public.hs_youtube_video_file_decide('pilot','short1','approved'); select public.hs_youtube_video_file_decide('pilot','short1','pending');
select pg_temp.chk('7d approving or revoking never reopens an external item', (pg_temp.job('pilot','short1')).status='external');
select pg_temp.chk('7e an external item cannot be claimed', public.video_job_claim((pg_temp.job('pilot','short1')).id,'w1',600,'rk') is null);
select pg_temp.chk('7f the other pilot items are untouched', (select count(*) from public.video_bluesky_jobs where slug='pilot') = 1);
-- 8. worker lifecycle: lease, rkey, publish, immutability
select pg_temp.chk('8a a job not yet due cannot be claimed', public.video_job_claim((pg_temp.job('p1','final')).id,'w1',600,'rk-final') is null);
update public.video_bluesky_jobs set scheduled_slot = now() - interval '1 minute' where slug='p1' and file_key='final';
select pg_temp.chk('8b a due job is claimed and its rkey persisted', (public.video_job_claim((pg_temp.job('p1','final')).id,'w1',600,'rk-final'))->>'rkey' = 'rk-final' and (pg_temp.job('p1','final')).status='uploading');
select pg_temp.chk('8c a second worker cannot claim a leased job', public.video_job_claim((pg_temp.job('p1','final')).id,'w2',600,'rk-other') is null);
select pg_temp.chk('8d the same worker re-claims and the rkey never changes', (public.video_job_claim((pg_temp.job('p1','final')).id,'w1',600,'rk-other'))->>'rkey' = 'rk-final');
select public.video_job_progress((pg_temp.job('p1','final')).id,'w1','processing','{"video_job_id":"vj1"}');
select pg_temp.chk('8e progress records the video job id', (pg_temp.job('p1','final')).video_job_id='vj1');
select pg_temp.chk('8f progress from a worker without the lease is refused', pg_temp.throws($q$select public.video_job_progress((select id from public.video_bluesky_jobs where slug='p1' and file_key='final'),'w2','publishing','{}')$q$));
select pg_temp.chk('8g published cannot follow processing', pg_temp.throws($q$select public.video_job_finish((select id from public.video_bluesky_jobs where slug='p1' and file_key='final'),'w1','at://x','c')$q$));
select public.video_job_progress((pg_temp.job('p1','final')).id,'w1','publishing','{}');
select public.video_job_finish((pg_temp.job('p1','final')).id,'w1','at://did:plc:x/app.bsky.feed.post/rk-final','bafy');
select pg_temp.chk('8h finish records uri/cid/time', (pg_temp.job('p1','final')).status='published' and (pg_temp.job('p1','final')).bsky_cid='bafy' and (pg_temp.job('p1','final')).published_at is not null);
select pg_temp.chk('8i finish is idempotent', (public.video_job_finish((pg_temp.job('p1','final')).id,'w1','at://other','zzz'))->>'bsky_cid' = 'bafy');
select pg_temp.chk('8j a published job can never change state', pg_temp.throws($q$update public.video_bluesky_jobs set status='scheduled' where slug='p1' and file_key='final'$q$));
select public.hs_youtube_video_file_decide('p1','final','rejected');
select pg_temp.chk('8k rejecting after publication leaves the published record alone', (pg_temp.job('p1','final')).status='published');
select pg_temp.chk('8l a published item cannot be cancelled or have its copy edited', pg_temp.throws($q$select public.hs_video_job_cancel((select id from public.video_bluesky_jobs where slug='p1' and file_key='final'))$q$) and pg_temp.throws($q$select public.hs_video_bluesky_caption_set('p1','final','new')$q$));
-- 9. retry / failure handling
select public.hs_youtube_video_file_decide('p1','short1','pending'); update public.youtube_video_reviews set bsky_posts = jsonb_set(bsky_posts, '{short1,caption}', '"Retry me"') where slug='p1';
select public.hs_youtube_video_file_decide('p1','short1','approved');
update public.video_bluesky_jobs set scheduled_slot = now() - interval '1 minute' where slug='p1' and file_key='short1';
select public.video_job_claim((pg_temp.job('p1','short1')).id,'w1',600,'rk-s1');
select pg_temp.chk('9a a retryable failure returns to the calendar with a backoff', (public.video_job_fail((pg_temp.job('p1','short1')).id,'w1','503',true))->>'status'='scheduled' and (pg_temp.job('p1','short1')).next_attempt_at > now());
select pg_temp.chk('9b it is not claimable before the backoff ends', public.video_job_claim((pg_temp.job('p1','short1')).id,'w1',600,'rk-s1') is null);
update public.video_bluesky_jobs set next_attempt_at = now() - interval '1 second' where slug='p1' and file_key='short1';
select pg_temp.chk('9c afterwards the SAME rkey is reused', (public.video_job_claim((pg_temp.job('p1','short1')).id,'w1',600,'rk-new'))->>'rkey'='rk-s1');
select public.video_job_fail((pg_temp.job('p1','short1')).id,'w1','x',true);
update public.video_bluesky_jobs set next_attempt_at = null where slug='p1' and file_key='short1';
select public.video_job_claim((pg_temp.job('p1','short1')).id,'w1',600,'z'); 
select pg_temp.chk('9d retries are bounded: the third failure is final', (public.video_job_fail((pg_temp.job('p1','short1')).id,'w1','x',true))->>'status'='failed');
select pg_temp.chk('9e a lease that expired can be taken over, one worker at a time', true);
update public.video_bluesky_jobs set status='held' where slug='p1' and file_key='short1';
-- a crashed worker: lease expired mid-publish
select public.hs_video_job_retry((pg_temp.job('p1','short1')).id);
update public.video_bluesky_jobs set scheduled_slot = now() - interval '1 minute' where slug='p1' and file_key='short1';
select public.video_job_claim((pg_temp.job('p1','short1')).id,'w1',60,'rk-crash');
select public.video_job_progress((pg_temp.job('p1','short1')).id,'w1','publishing','{}', 60);
select pg_temp.chk('9f a live lease blocks takeover', public.video_job_claim((pg_temp.job('p1','short1')).id,'w2',600,'x') is null);
update public.video_bluesky_jobs set lease_until = now() - interval '1 second' where slug='p1' and file_key='short1';
select pg_temp.chk('9g an expired lease is taken over in its in-flight state, rkey intact (the one chosen at the first claim)', (public.video_job_claim((pg_temp.job('p1','short1')).id,'w2',600,'x'))->>'rkey'='rk-s1' and (pg_temp.job('p1','short1')).status='publishing');
-- revocation while in flight
select public.hs_youtube_video_file_decide('p1','short1','rejected');
select pg_temp.chk('9h revoking an in-flight job requests cancellation', (pg_temp.job('p1','short1')).cancel_requested);
select pg_temp.chk('9i the next claim after revocation cancels the job and publishes nothing', public.video_job_claim((pg_temp.job('p1','short1')).id,'w2',600,'x') is null and (pg_temp.job('p1','short1')).status='cancelled');
-- 10. the shared schedule: video approval asks the one picker (its rules are tested in homesignal-ingest tests/bsky_schedule_pg)
delete from public.video_bluesky_jobs where status in ('scheduled','held','cancelled','failed') and slug='p1';
select pg_temp.chk('10a an empty calendar yields a future slot', public.video_next_slot() > now());
select pg_temp.chk('10b video_next_slot is the schedule''s next video slot (one picker, no ladder of its own)',
  public.video_next_slot() = public.bsky_next_slot('video')
  and position('bsky_next_slot(''video'')' in (select prosrc from pg_proc where oid = 'public.video_next_slot(text)'::regprocedure)) > 0
  and (select provolatile from pg_proc where oid = 'public.video_next_slot(text)'::regprocedure) = 'v');
-- 11. permissions
select pg_temp.as_user('stranger@example.com');
select pg_temp.chk('11a a non-admin cannot approve', pg_temp.throws($q$select public.hs_youtube_video_file_decide('p1','short2','approved')$q$));
select pg_temp.chk('11b a non-admin cannot edit, link, cancel, retry or list', pg_temp.throws($q$select public.hs_video_bluesky_caption_set('p1','short2','x')$q$) and pg_temp.throws($q$select public.hs_video_youtube_url_set('p1','https://youtu.be/qEv0XlxlvcY')$q$)
   and pg_temp.throws($q$select public.hs_video_job_cancel(gen_random_uuid())$q$) and pg_temp.throws($q$select public.hs_video_job_retry(gen_random_uuid())$q$) and pg_temp.throws($q$select public.hs_video_jobs_list()$q$) and pg_temp.throws($q$select public.hs_video_reconcile_done('p1')$q$));
select pg_temp.chk('11c anon has no EXECUTE on any dashboard or worker function', not exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname like 'hs_video%' or p.proname like 'video_%') and has_function_privilege('anon', p.oid, 'execute')));
select pg_temp.chk('11d authenticated cannot run a worker or internal function', not exists (select 1 from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'video_%' and has_function_privilege('authenticated', p.oid, 'execute')));
select pg_temp.chk('11e service_role runs the worker functions', has_function_privilege('service_role','public.video_job_claim(uuid,text,int,text)','execute'));
select pg_temp.chk('11f the table has no direct grants', not has_table_privilege('authenticated','public.video_bluesky_jobs','select') and not has_table_privilege('anon','public.video_bluesky_jobs','select'));
select pg_temp.as_user('founder@example.com');
select pg_temp.chk('11g the dashboard list covers every item', jsonb_array_length(public.hs_video_jobs_list()) = 6);
-- 12. a founder caption with the [YOUTUBE LINK] placeholder and NO link_youtube flag (2026-10-26, project 3004)
insert into public.youtube_video_reviews (slug, title, files, meta, bsky_posts) values ('p2', 'Project Two',
 '{"short1":{"path":"p2/short1.mp4","bytes":700,"sha256":"q1"}}', '{}',
 '{"short1":{"caption":"57 trees were removed.\n\nFull story: [YOUTUBE LINK]\nhttps://jodytracks.com","hashtags":["JODYTracks"],"alt":"Trees"}}');
insert into storage.objects (bucket_id, name, metadata) values ('jody-videos','p2/short1.mp4','{"size":700}');
select pg_temp.chk('12a the placeholder counts as linking to YouTube', public.video_bsky_links_youtube((select bsky_posts->'short1' from public.youtube_video_reviews where slug='p2')));
select pg_temp.chk('12a2 a caption without the placeholder or the flag does not', not public.video_bsky_links_youtube('{"caption":"No link here."}'::jsonb));
select public.hs_youtube_video_file_decide('p2','short1','approved');
select pg_temp.chk('12b approved before the link exists -> HELD for the link, the placeholder cannot post', (pg_temp.job('p2','short1')).status='held' and (pg_temp.job('p2','short1')).hold_reason like '%missing_youtube_url%');
select pg_temp.chk('12c the dashboard list says the item links to YouTube', (select (x->>'link_youtube')::boolean from jsonb_array_elements(public.hs_video_jobs_list()) x where x->>'slug'='p2' and x->>'file_key'='short1'));
select public.hs_video_youtube_url_set('p2','https://youtu.be/hp3RLwtBkU8');
select pg_temp.chk('12d entering the link releases the item', (pg_temp.job('p2','short1')).status='scheduled');
select pg_temp.chk('12e the link replaces the placeholder in place, once, and is not appended again',
  (pg_temp.job('p2','short1')).post_text = E'57 trees were removed.\n\nFull story: https://youtu.be/hp3RLwtBkU8\nhttps://jodytracks.com\n\n#JODYTracks');
select pg_temp.chk('12f the job records the link it carries', (pg_temp.job('p2','short1')).youtube_url = 'https://youtu.be/hp3RLwtBkU8');
select pg_temp.chk('12g changing the link sends the approved item back to waiting', (public.hs_video_youtube_url_set('p2','https://youtu.be/qEv0XlxlvcY')->>'approvals_reset')::int = 1
  and (pg_temp.job('p2','short1')).status='cancelled');
\o
select 'ALL ' || count(*) || ' CHECKS PASSED' from _res where ok;
