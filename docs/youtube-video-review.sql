-- Jody — "YouTube Videos" review tab (Acquisition Dashboard): storage + decision record.
-- PARKED (repo convention): review, then apply via db-sql / apply_migration. NOT applied.
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
drop policy if exists jody_videos_admin_read on storage.objects;
create policy jody_videos_admin_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'jody-videos'
    and exists (select 1 from public.dashboard_admins da where da.email = (auth.jwt() ->> 'email'))
  );

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
  note        text check (note is null or char_length(note) <= 500)
);
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

create or replace function public.hs_youtube_video_decide(p_slug text, p_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  caller_email text := auth.jwt() ->> 'email';
  n integer;
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  update public.youtube_video_reviews
     set status = p_status,
         note = nullif(left(coalesce(p_note, ''), 500), ''),
         decided_at = case when p_status = 'pending' then null else now() end,
         decided_by = case when p_status = 'pending' then null else caller_email end
   where slug = p_slug;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'unknown video' using errcode = 'P0002';
  end if;
  return jsonb_build_object('slug', p_slug, 'status', p_status);
end;
$fn$;

revoke all on function public.hs_youtube_videos_list() from public, anon;
revoke all on function public.hs_youtube_video_decide(text, text, text) from public, anon;
grant execute on function public.hs_youtube_videos_list() to authenticated;
grant execute on function public.hs_youtube_video_decide(text, text, text) to authenticated;

commit;
