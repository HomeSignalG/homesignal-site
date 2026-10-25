-- Jody — per-item video approval -> durable Bluesky publishing queue (outbox).
-- STATUS: PARKED. NOT APPLIED to production. Apply with the founder's go, in this order (see §APPLY at the end).
--
-- WHAT THIS IS
--   One approval per item (Main Video, Short 1, Short 2), recorded by public.hs_youtube_video_file_decide
--   (docs/youtube-video-review.sql, the per-file approval of site #2220), creates EXACTLY ONE Bluesky job
--   for that item, in the same transaction as the approval, with the approved text/caption/file frozen into
--   the job. The ingest publish worker (homesignal-ingest bluesky/publish-worker.mjs) publishes due jobs as
--   NATIVE Bluesky video posts. Nothing here posts anything; this is state and gates.
--
-- WHY A SEPARATE TABLE (not social_posts)
--   social_posts carries the MAPS/ALERTS claim contract, map gates and payload fingerprint; every one of those
--   guards reasons about notices and maps. Putting videos there would mean editing hs_approve_social_post and
--   social_posts_publication_guard, which this change must leave untouched. The video jobs share the
--   publishing CALENDAR (the same weekday/weekend ladder, the same 3/day cap, counted across both tables) and
--   the same worker, not the same row type.
--
-- IDENTITY AND IDEMPOTENCY
--   unique (slug, file_key, platform): a reload, a retried approval RPC or a double-click can never add a
--   second job. A row that is 'published' or 'external' can never change state (trigger).
--
-- THE APPROVAL IS BOUND TO WHAT WAS APPROVED
--   approval_fingerprint = md5 over the exact post text, alt text, file path, file sha256 and byte size.
--   The worker's claim, and a trigger on every move into upload/publish, recompute it from the live review row
--   and refuse if it moved. Editing a caption resets that item's approval to pending (hs_video_bluesky_caption_set),
--   which cancels its unpublished job.
--
-- SECURITY: dashboard functions are gated on public.dashboard_admins (same gate as hs_youtube_video_file_decide);
--   worker functions are service_role only; the table has RLS on and no direct grants.

begin;
set local lock_timeout = '5s';

-- 1. review row: the Bluesky inputs --------------------------------------------------------------------------
do $c$
declare _fresh boolean;
begin
  _fresh := not exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'youtube_video_reviews' and column_name = 'reconcile_required');
  alter table public.youtube_video_reviews add column if not exists youtube_url text;
  alter table public.youtube_video_reviews add column if not exists bsky_posts jsonb not null default '{}'::jsonb;
  alter table public.youtube_video_reviews add column if not exists reconcile_required boolean not null default false;
  -- Every review row that exists BEFORE this change is the manually-published pilot: ambiguous until the founder
  -- verifies what is already on Bluesky. New rows default to false.
  if _fresh then
    update public.youtube_video_reviews set reconcile_required = true;
  end if;
end
$c$;

alter table public.youtube_video_reviews drop constraint if exists youtube_video_reviews_youtube_url_chk;
alter table public.youtube_video_reviews add constraint youtube_video_reviews_youtube_url_chk
  check (youtube_url is null or youtube_url ~ '^https://(youtu\.be/[A-Za-z0-9_-]{11}|www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11})$');

-- 2. the outbox -------------------------------------------------------------------------------------------------
create table if not exists public.video_bluesky_jobs (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null references public.youtube_video_reviews(slug),
  file_key         text not null check (file_key in ('final', 'short1', 'short2')),
  platform         text not null default 'bluesky' check (platform = 'bluesky'),
  status           text not null default 'held'
                     check (status in ('held', 'scheduled', 'uploading', 'processing', 'publishing',
                                       'published', 'failed', 'cancelled', 'external')),
  hold_reason      text,
  error            text,
  attempts         int  not null default 0,
  -- frozen at approval
  post_text        text,
  alt_text         text,
  file_path        text,
  file_sha256      text,
  file_bytes       bigint,
  youtube_url      text,
  approval_fingerprint text,
  approved_by      text,
  approved_at      timestamptz,
  -- calendar
  scheduled_slot   timestamptz,
  local_tz         text not null default 'America/Denver',
  next_attempt_at  timestamptz,
  -- concurrency
  lease_owner      text,
  lease_until      timestamptz,
  cancel_requested boolean not null default false,
  -- publication identity: chosen BEFORE any network side effect and reused by every retry
  rkey             text,
  video_job_id     text,
  video_blob       jsonb,
  bsky_uri         text,
  bsky_cid         text,
  published_at     timestamptz,
  -- reconciliation with posts made by hand
  external_uri     text,
  external_note    text,
  external_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (slug, file_key, platform),
  check (status <> 'published' or (bsky_uri is not null and bsky_cid is not null and published_at is not null)),
  check (status <> 'external' or external_uri is not null)
);
create index if not exists video_bluesky_jobs_due_idx on public.video_bluesky_jobs (status, scheduled_slot);
alter table public.video_bluesky_jobs enable row level security;
revoke all on public.video_bluesky_jobs from public, anon, authenticated;
-- no policies: only security-definer functions and the service role touch it.

-- 3. text, fingerprint, problems ----------------------------------------------------------------------------------
-- The ONE composer of the post text. Caption body, then the verified full YouTube link when the item links to it,
-- then the hashtags. The dashboard preview and the frozen job text both come from here.
create or replace function public.video_bsky_text(p_slug text, p_key text)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select case when coalesce(b ->> 'caption', '') = '' then null else
           (b ->> 'caption')
           || case when coalesce((b ->> 'link_youtube')::boolean, false) and coalesce(r.youtube_url, '') <> ''
                   then E'\n' || r.youtube_url else '' end
           || case when jsonb_typeof(b -> 'hashtags') = 'array' and jsonb_array_length(b -> 'hashtags') > 0
                   then E'\n\n' || (select string_agg('#' || t, ' ') from jsonb_array_elements_text(b -> 'hashtags') t) else '' end
         end
    from public.youtube_video_reviews r
    cross join lateral (select r.bsky_posts -> p_key as b) x
   where r.slug = p_slug;
$fn$;

create or replace function public.video_bsky_fingerprint(p_slug text, p_key text)
returns text
language sql stable security definer
set search_path = public, pg_temp
as $fn$
  select md5(concat_ws(E'\n\u001e',
           coalesce(public.video_bsky_text(p_slug, p_key), ''),
           coalesce(r.bsky_posts -> p_key ->> 'alt', ''),
           coalesce(r.files -> p_key ->> 'path', ''),
           coalesce(r.files -> p_key ->> 'sha256', ''),
           coalesce(r.files -> p_key ->> 'bytes', '')))
    from public.youtube_video_reviews r where r.slug = p_slug;
$fn$;

-- Why an approved item cannot be scheduled yet. Empty array = it can. Codes are stable; the dashboard words them.
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
  if coalesce((b ->> 'link_youtube')::boolean, false) and coalesce(r.youtube_url, '') = '' then
    probs := array_append(probs, 'missing_youtube_url'::text);
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

-- 4. the shared calendar ---------------------------------------------------------------------------------------------
-- The same ladder as hs_approve_social_post (weekday fill 1/2/3 -> 09:00, 17:30, 12:30; weekend one slot at 10:30; cap
-- 3 per local day; a slot already past rolls to the next day). Differences, all in the SAFE direction: the day's fill
-- counts BOTH tables, so a video can never take a slot past the shared cap, and a candidate within 150 minutes of any
-- existing slot is skipped. hs_approve_social_post is not changed (MAPS/ALERTS untouched) and does not see video slots;
-- the worker's own 3/day cap counts both tables, so an overlap rolls forward instead of over-posting.
create or replace function public.video_next_slot(p_tz text default 'America/Denver')
returns timestamptz
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare
  ld text[] := array['09:00', '17:30', '12:30'];
  d date := (now() at time zone p_tz)::date;
  fill int;
  slot timestamptz;
  guard int := 0;
begin
  loop
    guard := guard + 1;
    if guard > 60 then raise exception 'video_next_slot: no open slot in 60 days'; end if;
    select count(*) into fill from (
      select scheduled_slot from public.social_posts
       where status in ('approved', 'published') and scheduled_slot is not null
      union all
      select scheduled_slot from public.video_bluesky_jobs
       where status in ('scheduled', 'uploading', 'processing', 'publishing', 'published') and scheduled_slot is not null
    ) s where (s.scheduled_slot at time zone p_tz)::date = d;
    slot := null;
    if extract(dow from d) in (0, 6) then
      if fill < 1 then slot := (d::text || ' 10:30')::timestamp at time zone p_tz; end if;
    else
      if fill < 3 then slot := (d::text || ' ' || ld[fill + 1])::timestamp at time zone p_tz; end if;
    end if;
    if slot is not null and slot > now() and not exists (
         select 1 from (
           select scheduled_slot from public.social_posts where status in ('approved', 'published') and scheduled_slot is not null
           union all
           select scheduled_slot from public.video_bluesky_jobs
            where status in ('scheduled', 'uploading', 'processing', 'publishing', 'published') and scheduled_slot is not null
         ) g where abs(extract(epoch from (g.scheduled_slot - slot))) < 150 * 60) then
      return slot;
    end if;
    d := d + 1;
  end loop;
end;
$fn$;

-- 5. approval -> job (the outbox write) ---------------------------------------------------------------------------------
-- Called from hs_youtube_video_file_decide in the SAME transaction as the approval, with the review row locked.
-- Idempotent: any number of calls for the same decision leave one row in one state.
create or replace function public.video_bsky_apply(p_job uuid)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  j public.video_bluesky_jobs%rowtype;
  r public.youtube_video_reviews%rowtype;
  probs text[];
  nowtxt text;
begin
  select * into j from public.video_bluesky_jobs where id = p_job for update;
  if not found then return 'none'; end if;
  if j.status in ('published', 'external', 'uploading', 'processing', 'publishing') then return j.status; end if;
  select * into r from public.youtube_video_reviews where slug = j.slug;
  if coalesce(r.file_decisions -> j.file_key ->> 'status', '') <> 'approved' then
    update public.video_bluesky_jobs set status = 'cancelled', hold_reason = 'not_approved', scheduled_slot = null, error = null where id = j.id;
    return 'cancelled';
  end if;
  probs := public.video_bsky_problems(j.slug, j.file_key);
  update public.video_bluesky_jobs set
      post_text = public.video_bsky_text(j.slug, j.file_key),
      alt_text = r.bsky_posts -> j.file_key ->> 'alt',
      file_path = r.files -> j.file_key ->> 'path',
      file_sha256 = r.files -> j.file_key ->> 'sha256',
      file_bytes = nullif(r.files -> j.file_key ->> 'bytes', '')::bigint,
      youtube_url = case when coalesce((r.bsky_posts -> j.file_key ->> 'link_youtube')::boolean, false) then r.youtube_url end,
      approval_fingerprint = public.video_bsky_fingerprint(j.slug, j.file_key),
      approved_by = r.file_decisions -> j.file_key ->> 'decided_by',
      approved_at = (r.file_decisions -> j.file_key ->> 'decided_at')::timestamptz,
      cancel_requested = false, error = null, next_attempt_at = null, attempts = 0,
      -- a changed file never inherits the previous file's upload
      video_job_id = case when file_sha256 is not distinct from (r.files -> j.file_key ->> 'sha256') then video_job_id end,
      video_blob = case when file_sha256 is not distinct from (r.files -> j.file_key ->> 'sha256') then video_blob end,
      status = case when array_length(probs, 1) is null then 'scheduled' else 'held' end,
      hold_reason = case when array_length(probs, 1) is null then null else array_to_string(probs, ',') end,
      scheduled_slot = case when array_length(probs, 1) is null then coalesce(
          case when j.status = 'scheduled' then j.scheduled_slot end, public.video_next_slot(j.local_tz)) end
    where id = j.id;
  select status into nowtxt from public.video_bluesky_jobs where id = j.id;
  return nowtxt;
end;
$fn$;

create or replace function public.video_bsky_sync(p_slug text, p_key text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  r public.youtube_video_reviews%rowtype;
  dec text;
  j public.video_bluesky_jobs%rowtype;
  jid uuid;
begin
  if p_key not in ('final', 'short1', 'short2') then return 'not_a_video_item'; end if;
  select * into r from public.youtube_video_reviews where slug = p_slug;
  if not found then return 'unknown_project'; end if;
  dec := coalesce(r.file_decisions -> p_key ->> 'status', 'pending');
  select * into j from public.video_bluesky_jobs where slug = p_slug and file_key = p_key and platform = 'bluesky' for update;
  if dec = 'approved' then
    if not found then
      insert into public.video_bluesky_jobs (slug, file_key) values (p_slug, p_key)
        on conflict (slug, file_key, platform) do nothing
        returning id into jid;
      if jid is null then
        select id into jid from public.video_bluesky_jobs where slug = p_slug and file_key = p_key and platform = 'bluesky';
      end if;
    else
      jid := j.id;
      -- already live in the pipeline with the same approval: nothing to do (double-click / retry)
      if j.status = 'scheduled' and j.approval_fingerprint = public.video_bsky_fingerprint(p_slug, p_key) then
        return j.status;
      end if;
    end if;
    return public.video_bsky_apply(jid);
  end if;
  -- rejected or pending: nothing may publish
  if found then
    if j.status in ('held', 'scheduled', 'failed') then
      update public.video_bluesky_jobs set status = 'cancelled', hold_reason = 'approval_' || dec, scheduled_slot = null where id = j.id;
      return 'cancelled';
    elsif j.status in ('uploading', 'processing', 'publishing') then
      update public.video_bluesky_jobs set cancel_requested = true where id = j.id;
      return 'cancel_requested';
    end if;
    return j.status;
  end if;
  return 'none';
end;
$fn$;

-- State guard: a published or externally-published job never changes state; "published" can only follow "publishing";
-- every move into upload/processing/publishing re-checks that the item is STILL approved and unchanged.
create or replace function public.video_bluesky_jobs_guard()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare dec text;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' and new.status <> 'held' then
    raise exception 'video_bluesky_jobs: a job is created held and moved by video_bsky_apply' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.status in ('published', 'external') and new.status is distinct from old.status then
      raise exception 'video_bluesky_jobs %: a % job cannot change state', old.id, old.status using errcode = '23514';
    end if;
    if new.status = 'published' and old.status <> 'published' and old.status <> 'publishing' then
      raise exception 'video_bluesky_jobs %: published must follow publishing (was %)', old.id, old.status using errcode = '23514';
    end if;
    if new.status in ('uploading', 'processing', 'publishing') and new.status is distinct from old.status then
      select coalesce(r.file_decisions -> new.file_key ->> 'status', 'pending') into dec
        from public.youtube_video_reviews r where r.slug = new.slug;
      if dec <> 'approved' then
        raise exception 'video_bluesky_jobs %: the item is % now, not approved', old.id, dec using errcode = '23514';
      end if;
      if new.approval_fingerprint is distinct from public.video_bsky_fingerprint(new.slug, new.file_key) then
        raise exception 'video_bluesky_jobs %: the item changed after approval', old.id using errcode = '23514';
      end if;
      if new.cancel_requested then
        raise exception 'video_bluesky_jobs %: cancellation was requested', old.id using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$fn$;
drop trigger if exists video_bluesky_jobs_guard_trg on public.video_bluesky_jobs;
create trigger video_bluesky_jobs_guard_trg before insert or update on public.video_bluesky_jobs
  for each row execute function public.video_bluesky_jobs_guard();

-- 6. dashboard functions (admin-gated) -------------------------------------------------------------------------------
create or replace function public.hs_video_assert_admin()
returns text
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
declare e text := auth.jwt() ->> 'email';
begin
  if e is null or not exists (select 1 from public.dashboard_admins da where da.email = e) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return e;
end;
$fn$;

-- Edit the proposed Bluesky copy of ONE item. An approval never survives a change to its text: an approved item goes
-- back to pending (which cancels its unpublished job). A published item's copy cannot be edited here.
create or replace function public.hs_video_bluesky_caption_set(p_slug text, p_key text, p_caption text, p_hashtags text[] default null, p_alt text default null)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  r public.youtube_video_reviews%rowtype;
  b jsonb;
  t text;
  tag text;
  reset boolean := false;
begin
  perform public.hs_video_assert_admin();
  if p_key not in ('final', 'short1', 'short2') then raise exception 'bad file' using errcode = '22023'; end if;
  if p_caption is null or btrim(p_caption) = '' or char_length(p_caption) > 280 then
    raise exception 'caption must be 1 to 280 characters' using errcode = '22023';
  end if;
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if exists (select 1 from public.video_bluesky_jobs where slug = p_slug and file_key = p_key and status in ('published', 'external', 'uploading', 'processing', 'publishing')) then
    raise exception 'this item is already published or being published' using errcode = 'P0001';
  end if;
  b := coalesce(r.bsky_posts -> p_key, '{}'::jsonb) || jsonb_build_object('caption', btrim(p_caption));
  if p_hashtags is not null then
    foreach tag in array p_hashtags loop
      if tag !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$' then raise exception 'bad hashtag %', tag using errcode = '22023'; end if;
    end loop;
    b := b || jsonb_build_object('hashtags', to_jsonb(p_hashtags));
  end if;
  if p_alt is not null then
    if char_length(p_alt) > 1000 then raise exception 'alt text over 1000 characters' using errcode = '22023'; end if;
    b := b || jsonb_build_object('alt', btrim(p_alt));
  end if;
  update public.youtube_video_reviews set bsky_posts = jsonb_set(coalesce(bsky_posts, '{}'::jsonb), array[p_key], b) where slug = p_slug;
  if coalesce(r.file_decisions -> p_key ->> 'status', '') = 'approved'
     and (r.bsky_posts -> p_key) is distinct from b then
    perform public.hs_youtube_video_file_decide(p_slug, p_key, 'pending', 'Caption edited after approval: approve again.');
    reset := true;
  end if;
  t := public.video_bsky_text(p_slug, p_key);
  return jsonb_build_object('slug', p_slug, 'key', p_key, 'text', t, 'chars', char_length(coalesce(t, '')), 'approval_reset', reset);
end;
$fn$;

-- The verified full YouTube link of a project. First time: releases jobs held only for the missing link. A CHANGE of an
-- existing link alters the text of every link-bearing item, so those approvals are reset (re-approve).
create or replace function public.hs_video_youtube_url_set(p_slug text, p_url text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  r public.youtube_video_reviews%rowtype;
  k text;
  n int := 0;
  moved boolean;
begin
  perform public.hs_video_assert_admin();
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if p_url is not null and p_url !~ '^https://(youtu\.be/[A-Za-z0-9_-]{11}|www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11})$' then
    raise exception 'not a YouTube video link' using errcode = '22023';
  end if;
  moved := r.youtube_url is not null and r.youtube_url is distinct from p_url;
  update public.youtube_video_reviews set youtube_url = p_url where slug = p_slug;
  foreach k in array array['final', 'short1', 'short2'] loop
    continue when not coalesce((r.bsky_posts -> k ->> 'link_youtube')::boolean, false);
    if moved and coalesce(r.file_decisions -> k ->> 'status', '') = 'approved' then
      perform public.hs_youtube_video_file_decide(p_slug, k, 'pending', 'YouTube link changed: approve again.');
      n := n + 1;
    elsif not moved then
      perform public.video_bsky_sync(p_slug, k);  -- releases a job held for the missing link
    end if;
  end loop;
  return jsonb_build_object('slug', p_slug, 'youtube_url', p_url, 'approvals_reset', n);
end;
$fn$;

-- The founder confirms they checked what is already on Bluesky for this project (the manually posted pilot).
create or replace function public.hs_video_reconcile_done(p_slug text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare k text;
begin
  perform public.hs_video_assert_admin();
  perform 1 from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  update public.youtube_video_reviews set reconcile_required = false where slug = p_slug;
  foreach k in array array['final', 'short1', 'short2'] loop
    perform public.video_bsky_sync(p_slug, k);
  end loop;
  return jsonb_build_object('slug', p_slug, 'reconcile_required', false);
end;
$fn$;

-- Cancel an unpublished job. It also puts the item back to pending, so it is sticky: only a new explicit approval revives it.
create or replace function public.hs_video_job_cancel(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare j public.video_bluesky_jobs%rowtype;
begin
  perform public.hs_video_assert_admin();
  select * into j from public.video_bluesky_jobs where id = p_id for update;
  if not found then raise exception 'unknown job' using errcode = 'P0002'; end if;
  if j.status in ('published', 'external') then raise exception 'already published' using errcode = 'P0001'; end if;
  perform public.hs_youtube_video_file_decide(j.slug, j.file_key, 'pending', 'Cancelled from the Bluesky queue.');
  return jsonb_build_object('id', p_id, 'status', (select status from public.video_bluesky_jobs where id = p_id));
end;
$fn$;

-- Re-evaluate a held or failed job (after fixing the cause). Never touches a published/external/in-flight one.
create or replace function public.hs_video_job_retry(p_id uuid)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare j public.video_bluesky_jobs%rowtype; s text;
begin
  perform public.hs_video_assert_admin();
  select * into j from public.video_bluesky_jobs where id = p_id for update;
  if not found then raise exception 'unknown job' using errcode = 'P0002'; end if;
  if j.status not in ('held', 'failed') then raise exception 'only a held or failed job can be retried' using errcode = 'P0001'; end if;
  update public.video_bluesky_jobs set status = 'held', approval_fingerprint = null where id = p_id;
  s := public.video_bsky_apply(p_id);
  return jsonb_build_object('id', p_id, 'status', s);
end;
$fn$;

-- Everything Tab 12 -> VIDEOS needs: one object per video item of every project, with its job when it has one.
create or replace function public.hs_video_jobs_list()
returns jsonb
language plpgsql stable security definer
set search_path = public, pg_temp
as $fn$
begin
  perform public.hs_video_assert_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.sort_slot nulls last, x.slug, x.ord)
    from (
      select r.slug, r.title, k.key as file_key, k.ord,
             coalesce(r.file_decisions -> k.key ->> 'status', 'pending') as decision,
             r.youtube_url, r.reconcile_required,
             coalesce(j.post_text, public.video_bsky_text(r.slug, k.key)) as text,
             coalesce(j.alt_text, r.bsky_posts -> k.key ->> 'alt') as alt,
             coalesce(j.file_path, r.files -> k.key ->> 'path') as file_path,
             j.id as job_id, j.status as job_status, j.hold_reason, j.error, j.attempts, j.scheduled_slot, j.local_tz,
             j.bsky_uri, j.published_at, j.external_uri, j.external_note,
             (select b -> 'link_youtube' from (select r.bsky_posts -> k.key as b) q) as link_youtube,
             coalesce(j.scheduled_slot, j.published_at) as sort_slot
        from public.youtube_video_reviews r
        cross join (values ('final', 1), ('short1', 2), ('short2', 3)) as k(key, ord)
        left join public.video_bluesky_jobs j on j.slug = r.slug and j.file_key = k.key and j.platform = 'bluesky'
       where r.files ? k.key
    ) x
  ), '[]'::jsonb);
end;
$fn$;

-- 7. worker functions (service_role only) ---------------------------------------------------------------------------------
-- Claim one due job for p_lease_secs. Returns the job as jsonb, or null when it is not claimable. The rkey (the Bluesky
-- record key, a TID chosen by the worker) is persisted on first claim and then NEVER replaced, so every retry addresses the
-- same record. Re-checks approval, fingerprint and cancellation; a job that no longer matches is held, not published.
create or replace function public.video_job_claim(p_id uuid, p_owner text, p_lease_secs int, p_rkey text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare
  j public.video_bluesky_jobs%rowtype;
  dec text;
begin
  select * into j from public.video_bluesky_jobs where id = p_id for update;
  if not found then return null; end if;
  if j.status not in ('scheduled', 'uploading', 'processing', 'publishing') then return null; end if;
  if j.lease_until is not null and j.lease_until > now() and j.lease_owner is distinct from p_owner then return null; end if;
  if j.status = 'scheduled' and (j.scheduled_slot is null or j.scheduled_slot > now()
       or (j.next_attempt_at is not null and j.next_attempt_at > now())) then return null; end if;
  if j.cancel_requested then
    update public.video_bluesky_jobs set status = 'cancelled', hold_reason = 'cancel_requested', lease_owner = null, lease_until = null where id = j.id;
    return null;
  end if;
  select coalesce(r.file_decisions -> j.file_key ->> 'status', 'pending') into dec
    from public.youtube_video_reviews r where r.slug = j.slug;
  if dec <> 'approved' then
    update public.video_bluesky_jobs set status = 'cancelled', hold_reason = 'approval_' || coalesce(dec, 'gone'), scheduled_slot = null, lease_owner = null, lease_until = null where id = j.id;
    return null;
  end if;
  if j.approval_fingerprint is distinct from public.video_bsky_fingerprint(j.slug, j.file_key) then
    update public.video_bluesky_jobs set status = 'held', hold_reason = 'changed_after_approval', scheduled_slot = null, lease_owner = null, lease_until = null where id = j.id;
    return null;
  end if;
  if j.attempts >= 6 then
    update public.video_bluesky_jobs set status = 'failed', error = 'too many attempts', lease_owner = null, lease_until = null where id = j.id;
    return null;
  end if;
  update public.video_bluesky_jobs set
      status = case when j.status = 'scheduled' then 'uploading' else j.status end,
      attempts = j.attempts + 1,
      rkey = coalesce(j.rkey, p_rkey),
      lease_owner = p_owner,
      lease_until = now() + make_interval(secs => greatest(60, least(p_lease_secs, 3600))),
      error = null
    where id = j.id returning * into j;
  return to_jsonb(j);
end;
$fn$;

create or replace function public.video_job_progress(p_id uuid, p_owner text, p_status text, p_patch jsonb, p_lease_secs int default 900)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare j public.video_bluesky_jobs%rowtype;
begin
  if p_status not in ('uploading', 'processing', 'publishing') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into j from public.video_bluesky_jobs where id = p_id for update;
  if not found or j.lease_owner is distinct from p_owner or j.status not in ('uploading', 'processing', 'publishing') then
    raise exception 'lease lost' using errcode = 'P0001';
  end if;
  update public.video_bluesky_jobs set
      status = p_status,
      video_job_id = coalesce(p_patch ->> 'video_job_id', video_job_id),
      video_blob = coalesce(p_patch -> 'video_blob', video_blob),
      lease_until = now() + make_interval(secs => greatest(60, least(p_lease_secs, 3600)))
    where id = p_id returning * into j;
  return to_jsonb(j);
end;
$fn$;

create or replace function public.video_job_finish(p_id uuid, p_owner text, p_uri text, p_cid text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare j public.video_bluesky_jobs%rowtype;
begin
  select * into j from public.video_bluesky_jobs where id = p_id for update;
  if not found then raise exception 'unknown job' using errcode = 'P0002'; end if;
  if j.status = 'published' then return to_jsonb(j); end if;   -- idempotent
  if j.lease_owner is distinct from p_owner or j.status <> 'publishing' then raise exception 'lease lost' using errcode = 'P0001'; end if;
  update public.video_bluesky_jobs set status = 'published', bsky_uri = p_uri, bsky_cid = p_cid, published_at = now(),
      error = null, lease_owner = null, lease_until = null where id = p_id returning * into j;
  return to_jsonb(j);
end;
$fn$;

create or replace function public.video_job_fail(p_id uuid, p_owner text, p_error text, p_retryable boolean)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare j public.video_bluesky_jobs%rowtype;
begin
  select * into j from public.video_bluesky_jobs where id = p_id for update;
  if not found or j.lease_owner is distinct from p_owner or j.status not in ('uploading', 'processing', 'publishing') then
    raise exception 'lease lost' using errcode = 'P0001';
  end if;
  if p_retryable and j.attempts < 3 then
    -- back to the calendar with exponential backoff (15, 30 minutes); the rkey and any uploaded blob are kept
    update public.video_bluesky_jobs set status = 'scheduled', error = left(p_error, 300), lease_owner = null, lease_until = null,
        next_attempt_at = now() + make_interval(mins => 15 * power(2, j.attempts - 1)::int) where id = p_id returning * into j;
  else
    update public.video_bluesky_jobs set status = 'failed', error = left(p_error, 300), lease_owner = null, lease_until = null
      where id = p_id returning * into j;
  end if;
  return to_jsonb(j);
end;
$fn$;

create or replace function public.video_job_hold(p_id uuid, p_owner text, p_reason text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare j public.video_bluesky_jobs%rowtype;
begin
  select * into j from public.video_bluesky_jobs where id = p_id for update;
  if not found or j.lease_owner is distinct from p_owner or j.status not in ('uploading', 'processing', 'publishing') then
    raise exception 'lease lost' using errcode = 'P0001';
  end if;
  update public.video_bluesky_jobs set status = 'held', hold_reason = left(p_reason, 200), scheduled_slot = null,
      lease_owner = null, lease_until = null where id = p_id returning * into j;
  return to_jsonb(j);
end;
$fn$;

-- Reconciliation: a post the founder made by hand. Only a confirmed Bluesky address is accepted, and it permanently
-- occupies the item's (project, file, platform) identity, so nothing can ever publish it again.
create or replace function public.video_job_mark_external(p_slug text, p_key text, p_uri text, p_note text)
returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $fn$
declare j public.video_bluesky_jobs%rowtype;
begin
  if p_key not in ('final', 'short1', 'short2') then raise exception 'bad file' using errcode = '22023'; end if;
  if p_uri is null or p_uri !~ '^(at://did:[a-z0-9:]+/app\.bsky\.feed\.post/[A-Za-z0-9._~-]+|https://bsky\.app/profile/[^/]+/post/[A-Za-z0-9._~-]+)$' then
    raise exception 'not a Bluesky post address' using errcode = '22023';
  end if;
  perform 1 from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  insert into public.video_bluesky_jobs (slug, file_key) values (p_slug, p_key) on conflict (slug, file_key, platform) do nothing;
  select * into j from public.video_bluesky_jobs where slug = p_slug and file_key = p_key and platform = 'bluesky' for update;
  if j.status in ('uploading', 'processing', 'publishing') then raise exception 'in flight; wait for it to finish' using errcode = 'P0001'; end if;
  if j.status = 'published' then raise exception 'already published by this system' using errcode = 'P0001'; end if;
  update public.video_bluesky_jobs set status = 'external', external_uri = p_uri, external_note = left(p_note, 500), external_at = now(),
      scheduled_slot = null, hold_reason = null, lease_owner = null, lease_until = null where id = j.id returning * into j;
  return to_jsonb(j);
end;
$fn$;

-- 8. grants --------------------------------------------------------------------------------------------------------------------
revoke all on function public.video_bsky_text(text, text), public.video_bsky_fingerprint(text, text), public.video_bsky_problems(text, text),
  public.video_next_slot(text), public.video_bsky_apply(uuid), public.video_bsky_sync(text, text),
  public.video_bluesky_jobs_guard(), public.hs_video_assert_admin() from public, anon, authenticated;
revoke all on function public.hs_video_bluesky_caption_set(text, text, text, text[], text), public.hs_video_youtube_url_set(text, text),
  public.hs_video_reconcile_done(text), public.hs_video_job_cancel(uuid), public.hs_video_job_retry(uuid), public.hs_video_jobs_list() from public, anon;
grant execute on function public.hs_video_bluesky_caption_set(text, text, text, text[], text), public.hs_video_youtube_url_set(text, text),
  public.hs_video_reconcile_done(text), public.hs_video_job_cancel(uuid), public.hs_video_job_retry(uuid), public.hs_video_jobs_list() to authenticated;
revoke all on function public.video_job_claim(uuid, text, int, text), public.video_job_progress(uuid, text, text, jsonb, int),
  public.video_job_finish(uuid, text, text, text), public.video_job_fail(uuid, text, text, boolean),
  public.video_job_hold(uuid, text, text), public.video_job_mark_external(text, text, text, text) from public, anon, authenticated;
grant execute on function public.video_job_claim(uuid, text, int, text), public.video_job_progress(uuid, text, text, jsonb, int),
  public.video_job_finish(uuid, text, text, text), public.video_job_fail(uuid, text, text, boolean),
  public.video_job_hold(uuid, text, text), public.video_job_mark_external(text, text, text, text) to service_role;

commit;

-- §APPLY (founder go required; nothing has been applied):
--   1. this file (tables + functions; it does not change hs_youtube_video_file_decide),
--   2. docs/youtube-video-file-decide-queue-apply.sql (replaces hs_youtube_video_file_decide so an approval calls
--      video_bsky_sync in the same transaction; byte-identical to the function in docs/youtube-video-review.sql),
--   3. homesignal-ingest supabase/migrations/20261024130000_video_bluesky_dispatch.sql (the pg_cron dispatch also fires for due video jobs).
-- Before step 2 an approval behaves exactly as today (no job is created).
