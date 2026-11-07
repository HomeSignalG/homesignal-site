-- Jody — an approved THUMBNAIL is a Bluesky post too (founder, 2026-11-07: "build it so thumbnails can be scheduled as
-- bluesky posts"; answered: it takes the VIDEO posting times, and it links to the YouTube main video).
--
-- WHAT CHANGES
--   The per-item queue (docs/video-bluesky-queue.sql) knew three items: final, short1, short2. This adds 'thumbnail' as a
--   fourth, with no new table, no new state and no new schedule:
--   * approving the thumbnail (hs_youtube_video_file_decide) creates or updates its ONE job, in the same transaction;
--   * its caption is edited, linked to YouTube, reconciled, marked external and listed exactly like a video item's;
--   * it takes a VIDEO time from the one picker (public.bsky_next_slot('video'), through video_next_slot) and counts in
--     the video queue's daily cap, because public.bsky_booked reads every video_bluesky_jobs row. No time is added: the
--     schedule is still 2 MAPS + 2 video posts a day (founder, 2026-10-27).
--   The publisher (homesignal-ingest bluesky/lib/video-publish.mjs) posts a thumbnail job as an IMAGE post
--   (app.bsky.embed.images), shrunk under Bluesky's 1,000,000-byte image limit by the same fitter MAPS posts use.
--
-- HOW IT IS APPLIED
--   A SPLICE of the live bodies (homesignal-ingest CLAUDE.md rule 7: never retype a body). Each function's definition is
--   read with pg_get_functiondef, ONE exact phrase is replaced, and the result is executed. Fail-closed: a function whose
--   body carries neither the old phrase (exactly once) nor the new one raises, and nothing is changed. Idempotent: a body
--   that already carries the new phrase is left alone. CREATE OR REPLACE keeps owner and grants.
--   ⚠️ Replaying docs/video-bluesky-queue.sql, docs/youtube-video-file-decide-queue-apply.sql or
--   docs/youtube-video-outdated.sql puts the three-item lists back. Re-apply THIS file after any such replay.
--
-- APPLY ORDER: homesignal-ingest (the publisher's image path and the thumbnail caption) merged first, then this file.
-- Applied before the publisher knows thumbnails, a due thumbnail job would be sent to the VIDEO upload and refused.

begin;
set local lock_timeout = '5s';

-- 1. the table accepts the fourth item
alter table public.video_bluesky_jobs drop constraint if exists video_bluesky_jobs_file_key_check;
alter table public.video_bluesky_jobs add constraint video_bluesky_jobs_file_key_check
  check (file_key in ('final', 'short1', 'short2', 'thumbnail'));

-- 2. the item lists, spliced from the live bodies
do $splice$
declare
  s record;
  def text;
  n int;
  fresh text;
begin
  for s in
    select * from (values
      ('public.video_bsky_sync(text,text)',
       $o$if p_key not in ('final', 'short1', 'short2') then return 'not_a_video_item'$o$,
       $n$if p_key not in ('final', 'short1', 'short2', 'thumbnail') then return 'not_a_video_item'$n$),
      ('public.hs_video_bluesky_caption_set(text,text,text,text[],text)',
       $o$if p_key not in ('final', 'short1', 'short2') then raise exception 'bad file'$o$,
       $n$if p_key not in ('final', 'short1', 'short2', 'thumbnail') then raise exception 'bad file'$n$),
      ('public.video_job_mark_external(text,text,text,text)',
       $o$if p_key not in ('final', 'short1', 'short2') then raise exception 'bad file'$o$,
       $n$if p_key not in ('final', 'short1', 'short2', 'thumbnail') then raise exception 'bad file'$n$),
      ('public.hs_video_reconcile_done(text)',
       $o$foreach k in array array['final', 'short1', 'short2'] loop$o$,
       $n$foreach k in array array['final', 'short1', 'short2', 'thumbnail'] loop$n$),
      ('public.hs_video_youtube_url_set(text,text)',
       $o$foreach k in array array['final', 'short1', 'short2'] loop$o$,
       $n$foreach k in array array['final', 'short1', 'short2', 'thumbnail'] loop$n$),
      ('public.hs_video_jobs_list()',
       $o$(values ('final', 1), ('short1', 2), ('short2', 3)) as k(key, ord)$o$,
       $n$(values ('final', 1), ('short1', 2), ('short2', 3), ('thumbnail', 4)) as k(key, ord)$n$),
      ('public.hs_youtube_video_file_decide(text,text,text,text)',
       $o$if p_key in ('final', 'short1', 'short2') and to_regprocedure('public.video_bsky_sync(text,text)') is not null then$o$,
       $n$if p_key in ('final', 'short1', 'short2', 'thumbnail') and to_regprocedure('public.video_bsky_sync(text,text)') is not null then$n$)
    ) v(fn, old_s, new_s)
  loop
    if to_regprocedure(s.fn) is null then
      raise exception 'video-bluesky-thumbnail: % does not exist', s.fn;
    end if;
    def := pg_get_functiondef(to_regprocedure(s.fn));
    n := (length(def) - length(replace(def, s.old_s, ''))) / length(s.old_s);
    if n = 0 and position(s.new_s in def) > 0 then
      continue;                                        -- already applied
    end if;
    if n <> 1 then
      raise exception 'video-bluesky-thumbnail: % carries the old phrase % times (expected 1) and not the new one', s.fn, n;
    end if;
    execute replace(def, s.old_s, s.new_s);
    fresh := pg_get_functiondef(to_regprocedure(s.fn));
    if position(s.new_s in fresh) = 0 or position(s.old_s in fresh) > 0 then
      raise exception 'video-bluesky-thumbnail: % did not take the change', s.fn;
    end if;
  end loop;
end
$splice$;

-- 3. post-condition: every item list now names the thumbnail
do $check$
begin
  if (select count(*) from pg_proc p
       where p.oid in ('public.video_bsky_sync(text,text)'::regprocedure,
                       'public.hs_video_bluesky_caption_set(text,text,text,text[],text)'::regprocedure,
                       'public.video_job_mark_external(text,text,text,text)'::regprocedure,
                       'public.hs_video_reconcile_done(text)'::regprocedure,
                       'public.hs_video_youtube_url_set(text,text)'::regprocedure,
                       'public.hs_video_jobs_list()'::regprocedure,
                       'public.hs_youtube_video_file_decide(text,text,text,text)'::regprocedure)
         and position('''thumbnail''' in p.prosrc) > 0) <> 7 then
    raise exception 'video-bluesky-thumbnail: not every item list names the thumbnail';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conrelid = 'public.video_bluesky_jobs'::regclass
                            and conname = 'video_bluesky_jobs_file_key_check')) not like '%thumbnail%' then
    raise exception 'video-bluesky-thumbnail: the table does not accept a thumbnail job';
  end if;
end
$check$;

commit;
