-- Replaces hs_youtube_video_file_decide so an approval creates its Bluesky job in the same transaction.
-- APPLY AFTER docs/video-bluesky-queue.sql (it works before it too: the call is skipped while video_bsky_sync does not exist).
-- The function text below is byte-identical to the one in docs/youtube-video-review.sql (pinned by test/video-bluesky-queue.test.mjs).
begin;
set local lock_timeout = '5s';
create or replace function public.hs_youtube_video_file_decide(p_slug text, p_key text, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  caller_email text := auth.jwt() ->> 'email';
  r public.youtube_video_reviews%rowtype;
  fd jsonb;
  overall text;
  queue_state text;
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then
    raise exception 'bad file' using errcode = '22023';
  end if;
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then
    raise exception 'unknown video' using errcode = 'P0002';
  end if;
  if not (r.files ? p_key) then
    raise exception 'file not uploaded' using errcode = 'P0002';
  end if;
  fd := coalesce(r.file_decisions, '{}'::jsonb);
  if p_status = 'pending' then
    fd := fd - p_key;
  else
    fd := jsonb_set(fd, array[p_key], jsonb_build_object(
      'status', p_status,
      'note', nullif(left(coalesce(p_note, ''), 500), ''),
      'decided_at', now(),
      'decided_by', caller_email));
  end if;
  if exists (select 1 from jsonb_each(fd) e where e.value ->> 'status' = 'rejected') then
    overall := 'rejected';
  elsif not exists (select 1 from jsonb_object_keys(r.files) k where coalesce(fd -> k ->> 'status', '') <> 'approved') then
    overall := 'approved';
  else
    overall := 'pending';
  end if;
  update public.youtube_video_reviews
     set file_decisions = fd,
         status = overall,
         note = null,
         decided_at = case when p_status = 'pending' then decided_at else now() end,
         decided_by = case when p_status = 'pending' then decided_by else caller_email end
   where slug = p_slug;
  -- The approval and its Bluesky job are ONE transaction (docs/video-bluesky-queue.sql). The review row is locked above,
  -- so two clicks or a retried call serialise here and the second finds the job already in place. Before that file is
  -- applied the function does not exist and an approval behaves exactly as it always has.
  if p_key in ('final', 'short1', 'short2') and to_regprocedure('public.video_bsky_sync(text,text)') is not null then
    execute 'select public.video_bsky_sync($1, $2)' into queue_state using p_slug, p_key;
  end if;
  return jsonb_build_object('slug', p_slug, 'key', p_key, 'file_status', p_status, 'status', overall, 'bluesky', queue_state);
end;
$fn$;

revoke all on function public.hs_youtube_video_file_decide(text, text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_file_decide(text, text, text, text) to authenticated;
commit;
