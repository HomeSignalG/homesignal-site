-- YouTube channel sync: JODY Tracks finds its own YouTube links (2026-10-25). PARKED, NOT APPLIED.
--
-- Apply AFTER docs/video-bluesky-queue.sql and docs/youtube-video-file-decide-queue-apply.sql (both live since 2026-10-25).
-- It refuses unless the two functions it replaces still match the live bodies of video-bluesky-queue.sql.
--
-- What it adds:
--   * public.youtube_channel_videos: one row per video on the JODY Tracks YouTube channel (unique video id), written ONLY by
--     the scheduled sync (homesignal-ingest scripts/youtube_channel_sync.py) through youtube_sync_record(), plus a manual
--     correction from the dashboard.
--   * Matching is decided by the sync from each project's own description text (project.json), never by title. A video
--     that matches no project, or more than one, is 'unmatched' / 'needs_review' and is never linked to anything.
--   * When a project's FULL video is matched AND verified public, its link is written to youtube_video_reviews.youtube_url
--     (only when that is empty) and the held link-bearing jobs are re-checked, exactly as a hand-entered first link does
--     (hs_video_youtube_url_set). An existing different link is never replaced: the row is marked 'conflict'.
--   * A video seen in the FIRST import is 'historical': recorded, never linked automatically, so it cannot release a post.
--   * video_bsky_problems: a link-bearing item whose link is a channel video that is not public yet is held
--     ('youtube_not_public'), and the sync releases it when the video goes public.
--   * video_bsky_text: every video post also carries https://jodytracks.com (unless the caption already names the site).
--     A caption that carries its own #hashtags gets no generated ones (2026-11-01).
-- Nothing here posts anything; posting is still only the approved-job path in bluesky/publish-worker.mjs.

do $$
declare
  t text; p text;
begin
  select md5(prosrc) into t from pg_proc where oid = 'public.video_bsky_text(text,text)'::regprocedure;
  select md5(prosrc) into p from pg_proc where oid = 'public.video_bsky_problems(text,text)'::regprocedure;
  -- a re-apply (this file already applied) is recognised by youtube_sync_record existing
  if t is distinct from 'f83c474ba08852f8d2689bb8d747515e'
     and not exists (select 1 from pg_proc where proname = 'youtube_sync_record' and pronamespace = 'public'::regnamespace) then
    raise exception 'video_bsky_text is not the body of docs/video-bluesky-queue.sql (md5 %); refusing', t;
  end if;
  if p is distinct from '8d7d2f34e3565ca66e3638e15f7c7165'
     and not exists (select 1 from pg_proc where proname = 'youtube_sync_record' and pronamespace = 'public'::regnamespace) then
    raise exception 'video_bsky_problems is not the body of docs/video-bluesky-queue.sql (md5 %); refusing', p;
  end if;
end $$;

-- 1. the channel's videos --------------------------------------------------------------------------------------------
create table if not exists public.youtube_channel_videos (
  video_id           text primary key check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  url                text generated always as ('https://youtu.be/' || video_id) stored,
  title              text,
  privacy_status     text,                    -- public | unlisted | private (as YouTube reports it)
  upload_status      text,                    -- processed | uploaded | ... (as YouTube reports it)
  publish_at         timestamptz,             -- the scheduled release time, when YouTube reports one
  published_at       timestamptz,             -- YouTube's own publish time
  duration_s         integer,
  public_verified_at timestamptz,             -- set only when YouTube says public+processed AND the public oEmbed answers
  slug               text,
  file_key           text check (file_key is null or file_key in ('final', 'short1', 'short2')),
  match_state        text not null default 'unmatched'
                       check (match_state in ('matched', 'needs_review', 'unmatched', 'not_ours')),
  match_method       text,                    -- 'description' (the sync) | 'manual' (the dashboard)
  match_note         text,
  historical         boolean not null default false,
  link_state         text,                    -- null | 'linked' | 'conflict' | 'waiting_public' | 'historical'
  first_seen_at      timestamptz not null default now(),
  last_synced_at     timestamptz not null default now(),
  last_error         text,
  check (match_state <> 'matched' or (slug is not null and file_key is not null))
);
-- one YouTube video per project item; two videos can never both be the same project's main video
create unique index if not exists youtube_channel_videos_item_uq on public.youtube_channel_videos (slug, file_key)
  where match_state = 'matched';
alter table public.youtube_channel_videos enable row level security;
revoke all on public.youtube_channel_videos from public, anon, authenticated;

create table if not exists public.youtube_sync_runs (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  ok          boolean not null,
  mode        text,                -- 'oauth' (sees scheduled/private uploads) | 'api_key' (public uploads only)
  seen        integer,
  detail      jsonb
);
alter table public.youtube_sync_runs enable row level security;
revoke all on public.youtube_sync_runs from public, anon, authenticated;

-- 2. the composer and the problems (replacing the queue's versions) ----------------------------------------------------
create or replace function public.video_bsky_text(p_slug text, p_key text)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select case when coalesce(b ->> 'caption', '') = '' then null else
           case when position('[YOUTUBE LINK]' in (b ->> 'caption')) > 0 and coalesce(r.youtube_url, '') <> ''
                then replace(b ->> 'caption', '[YOUTUBE LINK]', r.youtube_url)
                else b ->> 'caption' end
           || case when position('[YOUTUBE LINK]' in (b ->> 'caption')) = 0
                    and coalesce((b ->> 'link_youtube')::boolean, false) and coalesce(r.youtube_url, '') <> ''
                   then E'\n' || r.youtube_url else '' end
           || case when (b ->> 'caption') ~* 'jodytracks\.com' then '' else E'\nhttps://jodytracks.com' end
           -- a caption that carries its own hashtags keeps exactly those (2026-11-01): appending the generated ones too
           -- doubled #JodyTracks on Stratos and pushed it to 330 characters, and Proctor's tag list had been emptied by hand
           || case when (b ->> 'caption') !~ '(^|\s)#[A-Za-z0-9_]*[A-Za-z]'
                    and jsonb_typeof(b -> 'hashtags') = 'array' and jsonb_array_length(b -> 'hashtags') > 0
                   then E'\n\n' || (select string_agg('#' || t, ' ') from jsonb_array_elements_text(b -> 'hashtags') t) else '' end
         end
    from public.youtube_video_reviews r
    cross join lateral (select r.bsky_posts -> p_key as b) x
   where r.slug = p_slug;
$fn$;

create or replace function public.video_bsky_problems(p_slug text, p_key text)
returns text[]
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  r public.youtube_video_reviews%rowtype;
  b jsonb;
  f jsonb;
  t text;
  probs text[] := '{}';
  sz bigint;
  vid text;
begin
  select * into r from public.youtube_video_reviews where slug = p_slug;
  if not found then return array['unknown_project']; end if;
  b := r.bsky_posts -> p_key;
  f := r.files -> p_key;
  if r.reconcile_required then probs := array_append(probs, 'reconcile_required'::text); end if;
  t := public.video_bsky_text(p_slug, p_key);
  if t is null then probs := array_append(probs, 'no_caption'::text);
  elsif char_length(t) > 300 then probs := array_append(probs, 'text_too_long'::text); end if;
  if coalesce(b ->> 'alt', '') = '' then probs := array_append(probs, 'no_alt_text'::text); end if;
  if public.video_bsky_links_youtube(b) and coalesce(r.youtube_url, '') = '' then
    probs := array_append(probs, 'missing_youtube_url'::text);
  end if;
  -- a link to one of our own channel videos is only usable once that video is verified public
  if public.video_bsky_links_youtube(b) and coalesce(r.youtube_url, '') <> '' then
    vid := substring(r.youtube_url from '([A-Za-z0-9_-]{11})$');
    if exists (select 1 from public.youtube_channel_videos c where c.video_id = vid and c.public_verified_at is null) then
      probs := array_append(probs, 'youtube_not_public'::text);
    end if;
  end if;
  if f is null or coalesce(f ->> 'path', '') = '' then probs := array_append(probs, 'file_missing'::text);
  else
    select (o.metadata ->> 'size')::bigint into sz
      from storage.objects o where o.bucket_id = 'jody-videos' and o.name = f ->> 'path';
    if not found then probs := array_append(probs, 'file_missing'::text);
    elsif f ->> 'bytes' is not null and sz is distinct from (f ->> 'bytes')::bigint then probs := array_append(probs, 'file_size_mismatch'::text);
    end if;
    if coalesce(f ->> 'sha256', '') = '' then probs := array_append(probs, 'no_file_hash'::text); end if;
  end if;
  return probs;
end;
$fn$;

-- 3. linking a verified full video to its project ----------------------------------------------------------------------
-- The automatic half of hs_video_youtube_url_set: FIRST link only. Returns 'linked', 'already', or 'conflict'.
create or replace function public.video_youtube_link_attach(p_video_id text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  c public.youtube_channel_videos%rowtype;
  r public.youtube_video_reviews%rowtype;
  k text;
  st text;
begin
  select * into c from public.youtube_channel_videos where video_id = p_video_id for update;
  if not found or c.match_state <> 'matched' or c.file_key <> 'final' then return null; end if;
  if c.historical and coalesce(c.match_method, '') <> 'manual' then st := 'historical';
  elsif c.public_verified_at is null then st := 'waiting_public';
  else
    select * into r from public.youtube_video_reviews where slug = c.slug for update;
    if not found then st := 'conflict';
    elsif r.youtube_url is not null and substring(r.youtube_url from '([A-Za-z0-9_-]{11})$') = c.video_id then st := 'linked';
    elsif r.youtube_url is not null then st := 'conflict';
    else
      update public.youtube_video_reviews set youtube_url = c.url where slug = c.slug;
      st := 'linked';
    end if;
  end if;
  update public.youtube_channel_videos set link_state = st where video_id = c.video_id;
  -- re-check every link-bearing item: releases a job held for the missing link or a not-yet-public video
  if st in ('linked', 'waiting_public') then
    foreach k in array array['final', 'short1', 'short2'] loop
      perform public.video_bsky_sync(c.slug, k) from public.youtube_video_reviews x
        where x.slug = c.slug and public.video_bsky_links_youtube(x.bsky_posts -> k);
    end loop;
  end if;
  return st;
end;
$fn$;

-- 4. the sync's single write -------------------------------------------------------------------------------------------
-- p_rows: [{video_id, title, privacy_status, upload_status, publish_at, published_at, duration_s, public_verified (bool),
--           slug, file_key, match_state, match_note}]. A manual match or "not ours" is never overwritten by the sync.
create or replace function public.youtube_sync_record(p_rows jsonb, p_mode text default null, p_detail jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  first_import boolean := not exists (select 1 from public.youtube_channel_videos);
  x jsonb;
  n int := 0;
  out jsonb := '{}'::jsonb;
  st text;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be an array' using errcode = '22023'; end if;
  for x in select * from jsonb_array_elements(p_rows) loop
    if coalesce(x ->> 'match_state', 'unmatched') not in ('matched', 'needs_review', 'unmatched') then
      raise exception 'bad match_state %', x ->> 'match_state' using errcode = '22023';
    end if;
    -- a second video claiming an item another video already holds (a re-upload, a duplicate) is never linked: review it
    if x ->> 'match_state' = 'matched' and exists (select 1 from public.youtube_channel_videos o
         where o.slug = x ->> 'slug' and o.file_key = x ->> 'file_key' and o.match_state = 'matched' and o.video_id <> x ->> 'video_id') then
      x := x || jsonb_build_object('match_state', 'needs_review',
             'match_note', 'another video is already matched to ' || (x ->> 'slug') || '/' || (x ->> 'file_key'));
    end if;
    insert into public.youtube_channel_videos as c (video_id, title, privacy_status, upload_status, publish_at, published_at,
        duration_s, public_verified_at, slug, file_key, match_state, match_method, match_note, historical)
    values (x ->> 'video_id', x ->> 'title', x ->> 'privacy_status', x ->> 'upload_status',
        nullif(x ->> 'publish_at', '')::timestamptz, nullif(x ->> 'published_at', '')::timestamptz,
        nullif(x ->> 'duration_s', '')::int,
        case when coalesce((x ->> 'public_verified')::boolean, false) then now() end,
        case when x ->> 'match_state' = 'matched' then x ->> 'slug' end,
        case when x ->> 'match_state' = 'matched' then x ->> 'file_key' end,
        coalesce(x ->> 'match_state', 'unmatched'), 'description', x ->> 'match_note', first_import)
    on conflict (video_id) do update set
        title = excluded.title, privacy_status = excluded.privacy_status, upload_status = excluded.upload_status,
        publish_at = excluded.publish_at, published_at = excluded.published_at, duration_s = excluded.duration_s,
        -- verified public stays verified until YouTube reports it is not public any more
        public_verified_at = case when excluded.public_verified_at is null then null
                                  else coalesce(c.public_verified_at, excluded.public_verified_at) end,
        slug = case when c.match_method = 'manual' then c.slug else excluded.slug end,
        file_key = case when c.match_method = 'manual' then c.file_key else excluded.file_key end,
        match_state = case when c.match_method = 'manual' then c.match_state else excluded.match_state end,
        match_note = case when c.match_method = 'manual' then c.match_note else excluded.match_note end,
        last_synced_at = now(), last_error = null;
    st := public.video_youtube_link_attach(x ->> 'video_id');
    if st is not null then out := out || jsonb_build_object(x ->> 'video_id', st); end if;
    n := n + 1;
  end loop;
  insert into public.youtube_sync_runs (ok, mode, seen, detail) values (true, p_mode, n, coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('links', out));
  return jsonb_build_object('seen', n, 'first_import', first_import, 'links', out);
end;
$fn$;

create or replace function public.youtube_sync_failed(p_mode text, p_error text)
returns void
language sql security definer
set search_path = public, pg_temp
as $fn$
  insert into public.youtube_sync_runs (ok, mode, seen, detail) values (false, p_mode, 0, jsonb_build_object('error', left(p_error, 500)));
$fn$;

-- 5. dashboard (admin-gated) -------------------------------------------------------------------------------------------
create or replace function public.hs_youtube_channel_videos_list()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.hs_video_assert_admin();
  return jsonb_build_object(
    'videos', coalesce((select jsonb_agg(to_jsonb(c) order by coalesce(c.publish_at, c.published_at, c.first_seen_at) desc)
                          from public.youtube_channel_videos c), '[]'::jsonb),
    'last_run', (select to_jsonb(s) - 'mode' || jsonb_build_object('public_only', s.mode is distinct from 'oauth') from public.youtube_sync_runs s order by s.id desc limit 1),
    'last_ok', (select max(ran_at) from public.youtube_sync_runs where ok));
end;
$fn$;

-- Exceptional matching failures only: assign a video to a project item, or mark it not ours (p_slug null).
-- A manual match also lets a historical full video link its project (the founder chose it).
create or replace function public.hs_youtube_channel_video_match(p_video_id text, p_slug text, p_key text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  st text;
begin
  perform public.hs_video_assert_admin();
  perform 1 from public.youtube_channel_videos where video_id = p_video_id for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if p_slug is null then
    update public.youtube_channel_videos set slug = null, file_key = null, match_state = 'not_ours', match_method = 'manual',
        match_note = 'marked not a JODY project video', link_state = null where video_id = p_video_id;
    return jsonb_build_object('video_id', p_video_id, 'match_state', 'not_ours');
  end if;
  if p_key not in ('final', 'short1', 'short2') then raise exception 'bad file' using errcode = '22023'; end if;
  if not exists (select 1 from public.youtube_video_reviews where slug = p_slug) then raise exception 'unknown project' using errcode = 'P0002'; end if;
  if exists (select 1 from public.youtube_channel_videos where slug = p_slug and file_key = p_key and match_state = 'matched' and video_id <> p_video_id) then
    raise exception 'another video is already matched to this item' using errcode = 'P0001';
  end if;
  update public.youtube_channel_videos set slug = p_slug, file_key = p_key, match_state = 'matched', match_method = 'manual',
      match_note = 'matched by hand in the dashboard' where video_id = p_video_id;
  st := public.video_youtube_link_attach(p_video_id);
  return jsonb_build_object('video_id', p_video_id, 'match_state', 'matched', 'link_state', st);
end;
$fn$;

revoke all on function public.video_youtube_link_attach(text), public.youtube_sync_record(jsonb, text, jsonb),
  public.youtube_sync_failed(text, text), public.hs_youtube_channel_videos_list(), public.hs_youtube_channel_video_match(text, text, text)
  from public, anon, authenticated;
grant execute on function public.youtube_sync_record(jsonb, text, jsonb), public.youtube_sync_failed(text, text) to service_role;
grant execute on function public.hs_youtube_channel_videos_list(), public.hs_youtube_channel_video_match(text, text, text) to authenticated;
grant select on public.youtube_channel_videos, public.youtube_sync_runs to service_role;
