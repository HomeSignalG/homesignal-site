-- Applies the per-file review change (column + hs_youtube_video_file_decide + drop of the whole-package function).
-- Same statements as the matching section of docs/youtube-video-review.sql, tested first in a rolled-back transaction
-- (8 cases: approve, reject, undo, all-approved, bad key, unknown slug, non-admin, anon). Idempotent.
begin;
set local lock_timeout = '5s';
alter table public.youtube_video_reviews add column if not exists file_decisions jsonb not null default '{}'::jsonb;
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

revoke all on function public.hs_youtube_video_file_decide(text, text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_file_decide(text, text, text, text) to authenticated;
commit;
select (select count(*) from information_schema.columns where table_schema='public' and table_name='youtube_video_reviews' and column_name='file_decisions') has_col,
       (select count(*) from pg_proc where proname='hs_youtube_video_file_decide') new_fn,
       (select count(*) from pg_proc where proname='hs_youtube_video_decide') old_fn,
       has_function_privilege('anon','public.hs_youtube_video_file_decide(text,text,text,text)','execute') anon_x,
       has_function_privilege('authenticated','public.hs_youtube_video_file_decide(text,text,text,text)','execute') auth_x;
