-- Jody — "YouTube Videos" review tab (Acquisition Dashboard): storage + decision record.
-- APPLIED 2026-10-23 to production (founder approval), in pieces through execute_sql because apply_migration timed out
-- on the storage.objects policy; verified: bucket private, one SELECT-only policy, table RLS-on with no grants, anon refused,
-- non-admin authenticated refused (see PR description). The file is the DDL of record.
--
-- WHAT THIS IS
--   1. A PRIVATE storage bucket `jody-videos` holding each finished project's MP4s, Shorts and thumbnail.
--      Readable only by dashboard admins (storage policy below). Written only by the service role
--      (the homesignal-ingest video pipeline runs on a GitHub runner with the write key); there is NO
--      insert/update/delete policy, so no browser session can write to it.
--   2. public.youtube_video_reviews: one row per project: file paths, the title/description/ledger text,
--      and the founder's decision (pending / approved / rejected). RLS on, no direct grants.
--   3. public.hs_youtube_videos_list() and public.hs_youtube_video_decide(...): the ONLY two things the
--      dashboard calls. Both gated on public.dashboard_admins (the same gate as hs_saleshandy_metrics).
--
-- WHAT IT DOES NOT DO: publish anything. Nothing here knows about YouTube. "approved" is a recorded
-- decision, not an action.
--
-- PRIVACY: no subscriber data, no personal data. Public-record summaries only.

begin;

-- 1. bucket (private) ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('jody-videos', 'jody-videos', false, 262144000,
        array['video/mp4', 'image/png', 'image/jpeg', 'text/plain', 'text/markdown'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- read: dashboard admins only (the same allowlist the dashboard RPCs use)
-- The policy asks a SECURITY DEFINER helper, never public.dashboard_admins directly: `authenticated` has no
-- SELECT on that table (RLS on, no grant), so an inline EXISTS sees no rows and the admin's own download is
-- refused ("Could not read the file", found 2026-10-23 on the first real review). Re-tested after the fix as
-- admin (4 objects visible), non-admin (0) and anon (0).
create or replace function public.hs_is_dashboard_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.dashboard_admins da where da.email = (auth.jwt() ->> 'email'));
$$;
revoke all on function public.hs_is_dashboard_admin() from public, anon;
grant execute on function public.hs_is_dashboard_admin() to authenticated;

drop policy if exists jody_videos_admin_read on storage.objects;
create policy jody_videos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'jody-videos' and public.hs_is_dashboard_admin());

-- 2. decision record ----------------------------------------------------------------------------
create table if not exists public.youtube_video_reviews (
  slug        text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),
  title       text not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  files       jsonb not null default '{}'::jsonb,   -- {final|short1|short2|thumbnail: {path, bytes}}
  meta        jsonb not null default '{}'::jsonb,   -- {titles[], description, tags, ledger}
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  text,
  note        text check (note is null or char_length(note) <= 500),
  file_decisions jsonb not null default '{}'::jsonb  -- {final|short1|short2|thumbnail: {status, note, decided_at, decided_by}}
);
-- added 2026-10-24 (per-file review): idempotent for databases created before this column existed
alter table public.youtube_video_reviews add column if not exists file_decisions jsonb not null default '{}'::jsonb;
alter table public.youtube_video_reviews enable row level security;
revoke all on public.youtube_video_reviews from public, anon, authenticated;
-- no policies: only the service role (pipeline upload) and the two security-definer functions touch it.

-- 3. the two gated functions ----------------------------------------------------------------------
create or replace function public.hs_youtube_videos_list()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $fn$
declare
  caller_email text := auth.jwt() ->> 'email';
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.created_at desc)
    from public.youtube_video_reviews r
  ), '[]'::jsonb);
end;
$fn$;

-- Per-file decision (founder, 2026-10-24: "approve video, short 2 and thumbnail and only reject short 1").
-- The review's overall status is DERIVED here and nowhere else: any rejected file -> rejected; every uploaded
-- file approved -> approved; otherwise pending. The earlier whole-package function is dropped, so there is one
-- way to record a decision and the overall status cannot disagree with the files.
drop function if exists public.hs_youtube_video_decide(text, text, text);
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
  return jsonb_build_object('slug', p_slug, 'key', p_key, 'file_status', p_status, 'status', overall);
end;
$fn$;

revoke all on function public.hs_youtube_videos_list() from public, anon;
revoke all on function public.hs_youtube_video_file_decide(text, text, text, text) from public, anon;
grant execute on function public.hs_youtube_videos_list() to authenticated;
grant execute on function public.hs_youtube_video_file_decide(text, text, text, text) to authenticated;

commit;
