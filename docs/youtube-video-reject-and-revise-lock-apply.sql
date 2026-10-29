-- GENERATED from docs/youtube-video-revisions.sql for the production apply of 2026-10-29 (second step, after
-- docs/youtube-video-reject-and-revise-apply.sql). Replaces only hs_youtube_video_reject_and_revise: it now locks the
-- review row before checking for a running revision, so two simultaneous clicks are served one after the other.
-- Refuses unless the live body is the one the first apply installed.
begin;
set local lock_timeout = '5s';
do $g$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_reject_and_revise(text,text,text)'))
     is distinct from 'fab4b3b850638f37a26fb288d17d9c9f' then
    raise exception 'hs_youtube_video_reject_and_revise changed since this file was built; rebuild it from the live body';
  end if;
end $g$;
create or replace function public.hs_youtube_video_reject_and_revise(p_slug text, p_key text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  active public.youtube_video_revisions%rowtype;
  note text := nullif(btrim(left(coalesce(p_note, ''), 500)), '');
begin
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then
    raise exception 'bad file' using errcode = '22023';
  end if;
  if note is null then
    raise exception 'write what to change in the note box first' using errcode = '22023';
  end if;
  -- Lock the review row FIRST, so two clicks at once are served one after the other: the second then sees the first's
  -- running revision and leaves the saved note alone, instead of overwriting it after the check.
  perform 1 from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  select * into active from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status in ('queued', 'running', 'validating');
  if found then
    return jsonb_build_object('revision_id', active.id, 'status', active.status, 'already_active', true);
  end if;
  perform public.hs_youtube_video_file_decide(p_slug, p_key, 'rejected', note);
  return public.hs_youtube_video_revise(p_slug, p_key);
end $fn$;

do $v$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_reject_and_revise(text,text,text)')) is distinct from '2748d92a23d36f6ac89d4540c6d83365'
  then raise exception 'post-check failed'; end if;
end $v$;
commit;
