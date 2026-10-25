-- Adds the Bluesky queue hook to the LIVE hs_youtube_video_file_decide (read from production 2026-10-25,
-- body md5 2dc922d7324d78e57ceeb4ad21a8bb3e, which carries #2224's revision guard, _hs_yv_admin() and 'version').
-- Two insertions only: the queue_state variable and the video_bsky_sync call before the return. Refuses to run if
-- the live body has moved since it was read, so it can never revert someone else's change.
begin;
set local lock_timeout = '5s';
do $g$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_file_decide(text,text,text,text)'))
     is distinct from '2dc922d7324d78e57ceeb4ad21a8bb3e' then
    raise exception 'hs_youtube_video_file_decide changed since this file was built; rebuild it from the live body';
  end if;
  if to_regprocedure('public.video_bsky_sync(text,text)') is null then raise exception 'apply docs/video-bluesky-queue.sql first'; end if;
end $g$;
CREATE OR REPLACE FUNCTION public.hs_youtube_video_file_decide(p_slug text, p_key text, p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  caller_email text := public._hs_yv_admin();
  r public.youtube_video_reviews%rowtype;
  fd jsonb; overall text;
  queue_state text;
begin
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then raise exception 'bad file' using errcode = '22023'; end if;
  if p_status not in ('approved', 'rejected', 'pending') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if not (r.files ? p_key) then raise exception 'file not uploaded' using errcode = 'P0002'; end if;
  if p_status = 'approved' and exists (select 1 from public.youtube_video_revisions v
        where v.slug = p_slug and v.file_key = p_key and v.status in ('queued', 'running', 'validating')) then
    raise exception 'a revision of this file is being generated; wait for it to finish' using errcode = '55006';
  end if;
  fd := coalesce(r.file_decisions, '{}'::jsonb);
  if p_status = 'pending' then
    fd := fd - p_key;
  else
    fd := jsonb_set(fd, array[p_key], jsonb_build_object(
      'status', p_status, 'note', nullif(left(coalesce(p_note, ''), 500), ''),
      'decided_at', now(), 'decided_by', caller_email,
      'version', coalesce((r.files -> p_key ->> 'version')::int, 1)));
  end if;
  if exists (select 1 from jsonb_each(fd) e where e.value ->> 'status' = 'rejected') then overall := 'rejected';
  elsif not exists (select 1 from jsonb_object_keys(r.files) k where coalesce(fd -> k ->> 'status', '') <> 'approved') then overall := 'approved';
  else overall := 'pending'; end if;
  update public.youtube_video_reviews
     set file_decisions = fd, status = overall, note = null,
         decided_at = case when p_status = 'pending' then decided_at else now() end,
         decided_by = case when p_status = 'pending' then decided_by else caller_email end
   where slug = p_slug;
  -- The approval and its Bluesky job are ONE transaction (docs/video-bluesky-queue.sql). The review row is locked above,
  -- so two clicks or a retried call serialise here and the second finds the job already in place.
  if p_key in ('final', 'short1', 'short2') and to_regprocedure('public.video_bsky_sync(text,text)') is not null then
    execute 'select public.video_bsky_sync($1, $2)' into queue_state using p_slug, p_key;
  end if;
  return jsonb_build_object('slug', p_slug, 'key', p_key, 'file_status', p_status, 'status', overall, 'bluesky', queue_state);
end $function$;
revoke all on function public.hs_youtube_video_file_decide(text, text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_file_decide(text, text, text, text) to authenticated;
do $v$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_file_decide(text,text,text,text)'))
     is distinct from '9c507923ee83f1144cd74b17f314c9df' then raise exception 'post-check failed'; end if;
end $v$;
commit;
