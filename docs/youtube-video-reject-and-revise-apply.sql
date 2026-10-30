-- GENERATED from docs/youtube-video-revisions.sql (the SQL of record) for the production apply of 2026-10-29.
-- Only two functions: hs_youtube_video_revise (an identical note is refused after ONE 'unsupported' result, not three)
-- and the new hs_youtube_video_reject_and_revise (save the rejection and start the revision in one transaction).
-- It must NOT replay the whole record file: that file also carries an older hs_youtube_video_file_decide without the
-- Bluesky queue hook (live body is docs/youtube-video-file-decide-queue-apply.sql). Refuses if the live body moved.
begin;
set local lock_timeout = '5s';
do $g$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_revise(text,text)'))
     is distinct from 'dfae581562a286808f850772074f4d0a' then
    raise exception 'hs_youtube_video_revise changed since this file was built; rebuild it from the live body';
  end if;
end $g$;
create or replace function public.hs_youtube_video_revise(p_slug text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  r public.youtube_video_reviews%rowtype;
  d jsonb; note text; cur integer; active public.youtube_video_revisions%rowtype;
  st jsonb; new_id uuid; failed_n integer; broken_n integer;
begin
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then
    raise exception 'bad file' using errcode = '22023';
  end if;
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if not (r.files ? p_key) then raise exception 'file not uploaded' using errcode = 'P0002'; end if;

  -- idempotent: a click while a revision is already running returns THAT revision.
  select * into active from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status in ('queued', 'running', 'validating');
  if found then
    return jsonb_build_object('revision_id', active.id, 'status', active.status, 'already_active', true);
  end if;

  d := coalesce(r.file_decisions, '{}'::jsonb) -> p_key;
  if d is null or d ->> 'status' <> 'rejected' then
    raise exception 'only a rejected file can be revised; reject it with a note first' using errcode = '22023';
  end if;
  note := nullif(btrim(coalesce(d ->> 'note', '')), '');
  if note is null then
    raise exception 'write a note saying what is wrong, then reject again' using errcode = '22023';
  end if;
  cur := public._hs_yv_current_version(p_slug, p_key);
  perform public._hs_yv_ensure_v1(p_slug, p_key);
  cur := public._hs_yv_current_version(p_slug, p_key);

  -- Runaway limits. Only a note the reviser could NOT understand ('unsupported') counts against the note: once one
  -- exact note came back 'unsupported' on this version, the same words would only fail the same way, so they are
  -- refused until the founder rewords them (2026-10-29: the same note was sent up to 3 times, every time unsupported). A 'failed' revision is our system breaking (render, upload, a dead runner),
  -- not the note, so it never uses up the note's tries (2026-10-29: three render failures caused by a workflow bug
  -- blocked two correct notes). Those are capped separately, 10 in 24 hours per file, so a broken pipeline cannot
  -- be clicked into an endless loop of runs.
  select count(*) filter (where status = 'unsupported' and parent_version = cur and instruction = note),
         count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')
    into failed_n, broken_n
    from public.youtube_video_revisions where slug = p_slug and file_key = p_key;
  if failed_n >= 1 then
    raise exception 'this exact note was already tried on this version and could not be applied; change the wording, then try again' using errcode = '55000';
  end if;
  if broken_n >= 10 then
    raise exception 'revisions of this file failed 10 times in the last 24 hours because of a system problem; ask Claude to look at it' using errcode = '55000';
  end if;

  select settings into st from public.youtube_video_versions where slug = p_slug and file_key = p_key and version = cur;
  insert into public.youtube_video_revisions (slug, file_key, parent_version, instruction, settings, requested_by, attempts)
  values (p_slug, p_key, cur, note, coalesce(st, '{}'::jsonb), who, failed_n + 1)
  returning id into new_id;
  perform public._hs_yv_dispatch(new_id);
  return jsonb_build_object('revision_id', new_id, 'status', (select status from public.youtube_video_revisions where id = new_id), 'already_active', false);
end $fn$;

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
  select * into active from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status in ('queued', 'running', 'validating');
  if found then
    return jsonb_build_object('revision_id', active.id, 'status', active.status, 'already_active', true);
  end if;
  perform public.hs_youtube_video_file_decide(p_slug, p_key, 'rejected', note);
  return public.hs_youtube_video_revise(p_slug, p_key);
end $fn$;

revoke all on function public.hs_youtube_video_reject_and_revise(text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_reject_and_revise(text, text, text) to authenticated;
do $v$ begin
  if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_revise(text,text)')) is distinct from '528e59f386a31512c201d15531b25346'
     or (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_reject_and_revise(text,text,text)')) is distinct from 'fab4b3b850638f37a26fb288d17d9c9f'
  then raise exception 'post-check failed'; end if;
end $v$;
commit;
