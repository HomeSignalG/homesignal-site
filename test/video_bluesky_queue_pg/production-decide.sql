-- PRODUCTION's hs_youtube_video_file_decide as read on 2026-10-25 (pg_get_functiondef; body md5 2dc922d7324d78e57ceeb4ad21a8bb3e),
-- with the two objects it needs, copied from docs/youtube-video-revisions.sql. Loaded before the apply file so the suite
-- tests the apply file against the body it will actually replace (its guard refuses any other body).
create table if not exists public.youtube_video_revisions (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null references public.youtube_video_reviews(slug),
  file_key         text not null check (file_key in ('final', 'short1', 'short2', 'thumbnail')),
  parent_version   integer not null,
  instruction      text not null check (char_length(instruction) between 1 and 500),
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'validating', 'succeeded', 'failed', 'unsupported', 'cancelled')),
  settings         jsonb not null default '{}'::jsonb,  -- cumulative settings of the parent, sent to the worker
  plan             jsonb,                               -- what the interpreter decided (corrections, unsupported)
  result           jsonb,                               -- validation report, summary, what changed
  error            text,                                -- founder-readable
  attempts         integer not null default 1,
  requested_by     text not null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  result_version   integer,
  dispatch_request_id bigint
);
create or replace function public._hs_yv_admin()
returns text language plpgsql stable security definer set search_path = public as $$
declare e text := auth.jwt() ->> 'email';
begin
  if e is null or not exists (select 1 from public.dashboard_admins da where da.email = e) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return e;
end $$;

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
  return jsonb_build_object('slug', p_slug, 'key', p_key, 'file_status', p_status, 'status', overall);
end $function$;
do $v$ begin if (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.hs_youtube_video_file_decide(text,text,text,text)')) <> '2dc922d7324d78e57ceeb4ad21a8bb3e' then raise exception 'fixture is not the production body'; end if; end $v$;
