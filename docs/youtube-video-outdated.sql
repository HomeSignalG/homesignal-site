-- Tab 16: a video file built from an older script is OUT OF DATE, and cannot be approved until it is rebuilt.
--
-- Why (founder, 2026-11-07: "fix this error so never happens again"). Video 3014's main video version 4 was rebuilt
-- at 15:16Z from code saved at 15:05Z, six minutes BEFORE the founder's note "remove the act that has the quality of
-- life checklist" reached the script on main (#1051, 15:21Z). The page then showed it as "Revised, awaiting review",
-- checklist and all. The thumbnail the same day: version 4 was built at 15:26Z, before the sentence and the Take
-- action line reached the script (#1060, 16:17Z). Nothing on the page said either file was older than its script.
--
-- The rule, decided ONCE here (_hs_yv_file_outdated) and read by the list (the page) and by file_decide (approval):
--   * homesignal-ingest writes the CURRENT script of every video project on main into youtube_video_project_heads:
--     two fingerprints of video/projects/<slug> ('all' for the thumbnail; 'video' for the main video and the Shorts,
--     which leaves out the project.json keys no video shows: thumbnail, action links, YouTube texts, notes), the
--     commit that last changed it and its time. On every push to main that touches video/projects, hourly, and after
--     every revision (workflow video-project-heads.yml, scripts/video_project_heads.py);
--   * each video file version records the fingerprints it was BUILT from (meta.project_fp {all, video}, written by
--     the revise worker; older versions are backfilled by the same script from the commit that built them; an
--     original upload's are on the review row's meta);
--   * a file's current version is out of date when its fingerprint (thumbnail: 'all', videos: 'video') differs from
--     the head's. A version with none recorded is out of date when the script changed after it was made (time rule).
--   * No head row for the project (not on main yet) reads 'unknown' and blocks nothing.
-- Approving an out-of-date file is refused (55006). Rejecting, Full rebuild and revisions are unchanged.
--
-- Apply after youtube-video-rebuild-applies-note.sql. The two functions below are SPLICED from their live bodies
-- (md5-guarded), never retyped; this file is now the definition of record for both splices. Re-running is a no-op.

create table if not exists public.youtube_video_project_heads (
  slug         text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
  fp_all       text not null check (fp_all ~ '^[0-9a-f]{64}$'),
  fp_video     text not null check (fp_video ~ '^[0-9a-f]{64}$'),
  commit       text not null check (commit ~ '^[0-9a-f]{40}$'),
  committed_at timestamptz not null,
  read_at      timestamptz not null default now()
);
alter table public.youtube_video_project_heads enable row level security;
revoke all on public.youtube_video_project_heads from public, anon, authenticated;

-- Writer: service role only (the ingest workflow). Replaces the heads it is given; never deletes a project.
create or replace function public.hs_youtube_project_heads_set(p_heads jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare h jsonb; n int := 0;
begin
  if jsonb_typeof(p_heads) <> 'array' then raise exception 'heads must be an array' using errcode = '22023'; end if;
  for h in select * from jsonb_array_elements(p_heads) loop
    insert into public.youtube_video_project_heads (slug, fp_all, fp_video, commit, committed_at, read_at)
    values (h ->> 'slug', h ->> 'fp_all', h ->> 'fp_video', h ->> 'commit', (h ->> 'committed_at')::timestamptz, now())
    on conflict (slug) do update set fp_all = excluded.fp_all, fp_video = excluded.fp_video, commit = excluded.commit,
      committed_at = excluded.committed_at, read_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('heads', n);
end $fn$;
revoke all on function public.hs_youtube_project_heads_set(jsonb) from public, anon, authenticated;
grant execute on function public.hs_youtube_project_heads_set(jsonb) to service_role;

-- Backfill: the fingerprints a version (or, for p_key 'original', the original upload) was built from.
-- Sets them only where none are recorded; fingerprints written by the worker at build time are never replaced.
create or replace function public.hs_youtube_version_fp_set(p_slug text, p_key text, p_version int, p_fp jsonb, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n int := 0; fp jsonb;
begin
  if coalesce(p_fp ->> 'all', '') !~ '^[0-9a-f]{64}$' or coalesce(p_fp ->> 'video', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'bad fingerprints' using errcode = '22023';
  end if;
  if p_basis not in ('code_commit', 'build_run') then raise exception 'bad basis' using errcode = '22023'; end if;
  fp := jsonb_build_object('project_fp', jsonb_build_object('all', p_fp ->> 'all', 'video', p_fp ->> 'video'),
                           'project_fp_basis', p_basis);
  if p_key = 'original' then
    update public.youtube_video_reviews set meta = coalesce(meta, '{}'::jsonb) || fp
     where slug = p_slug and not (coalesce(meta, '{}'::jsonb) ? 'project_fp');
  else
    update public.youtube_video_versions set meta = coalesce(meta, '{}'::jsonb) || fp
     where slug = p_slug and file_key = p_key and version = p_version and not (coalesce(meta, '{}'::jsonb) ? 'project_fp');
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $fn$;
revoke all on function public.hs_youtube_version_fp_set(text, text, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.hs_youtube_version_fp_set(text, text, int, jsonb, text) to service_role;

-- THE ONE DECISION: is this file's current version older than the project's current script?
create or replace function public._hs_yv_file_outdated(p_slug text, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  r public.youtube_video_reviews%rowtype;
  h public.youtube_video_project_heads%rowtype;
  cur int; vmeta jsonb; vmade timestamptz; part text; mine text; head text; made timestamptz;
begin
  select * into r from public.youtube_video_reviews where slug = p_slug;
  if not found or not (coalesce(r.files, '{}'::jsonb) ? p_key) then return null; end if;
  select * into h from public.youtube_video_project_heads where slug = p_slug;
  if not found then return jsonb_build_object('state', 'unknown', 'outdated', false); end if;
  cur := coalesce((r.files -> p_key ->> 'version')::int, 1);
  part := case when p_key = 'thumbnail' then 'all' else 'video' end;
  head := case when part = 'all' then h.fp_all else h.fp_video end;
  select v.meta, v.created_at into vmeta, vmade from public.youtube_video_versions v
   where v.slug = p_slug and v.file_key = p_key and v.version = cur;
  if cur = 1 then
    -- version 1 is the original upload; its versions row (if any) is written later, at the first revision
    mine := coalesce(vmeta -> 'project_fp' ->> part, r.meta -> 'project_fp' ->> part);
    made := r.created_at;
  else
    mine := vmeta -> 'project_fp' ->> part;
    made := coalesce(vmade, r.created_at);
  end if;
  return jsonb_build_object(
    'state', case when mine is not null then 'script' else 'time' end,
    'outdated', case when mine is not null then mine <> head else h.committed_at > made end,
    'version', cur,
    'script_changed_at', h.committed_at,
    'script_commit', h.commit);
end $fn$;
revoke all on function public._hs_yv_file_outdated(text, text) from public, anon, authenticated;

create or replace function public._hs_yv_files_outdated(p_slug text)
returns jsonb language sql stable security definer set search_path = public as $fn$
  select coalesce(jsonb_object_agg(k, public._hs_yv_file_outdated(p_slug, k)), '{}'::jsonb)
    from public.youtube_video_reviews r, jsonb_object_keys(coalesce(r.files, '{}'::jsonb)) k
   where r.slug = p_slug;
$fn$;
revoke all on function public._hs_yv_files_outdated(text) from public, anon, authenticated;

-- Splices of the two live functions. Each refuses a body it does not recognise, and skips one already spliced.
do $splice$
declare
  src text; m text; anchor text; n int;
begin
  -- 1. the list sends 'outdated' {file_key -> decision} with each video
  select p.prosrc into src from pg_proc p where p.oid = 'public.hs_youtube_videos_list()'::regprocedure;
  if position('_hs_yv_files_outdated' in src) = 0 then
    m := md5(src);
    if m <> '09eecdd3a42974994a243305b9f192d2' then
      raise exception 'hs_youtube_videos_list body is not the one this splice was written against (md5 %)', m;
    end if;
    anchor := $a$to_jsonb(r) || jsonb_build_object($a$;
    n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
    if n <> 1 then raise exception 'list anchor appeared % times', n; end if;
    src := replace(src, anchor, anchor || $a$
      'outdated', public._hs_yv_files_outdated(r.slug),$a$);
    execute format($f$create or replace function public.hs_youtube_videos_list() returns jsonb
      language plpgsql stable security definer set search_path to 'public' as %L$f$, src);
    if position('_hs_yv_files_outdated' in (select prosrc from pg_proc where oid = 'public.hs_youtube_videos_list()'::regprocedure)) = 0 then
      raise exception 'list splice did not take';
    end if;
  end if;

  -- 2. approval is refused for a file whose current version is out of date
  select p.prosrc into src from pg_proc p
   where p.oid = 'public.hs_youtube_video_file_decide(text,text,text,text)'::regprocedure;
  if position('_hs_yv_file_outdated' in src) = 0 then
    m := md5(src);
    if m <> '9c507923ee83f1144cd74b17f314c9df' then
      raise exception 'hs_youtube_video_file_decide body is not the one this splice was written against (md5 %)', m;
    end if;
    anchor := $a$  fd := coalesce(r.file_decisions, '{}'::jsonb);$a$;
    n := (length(src) - length(replace(src, anchor, ''))) / length(anchor);
    if n <> 1 then raise exception 'decide anchor appeared % times', n; end if;
    src := replace(src, anchor, $a$  if p_status = 'approved'
     and coalesce((public._hs_yv_file_outdated(p_slug, p_key) ->> 'outdated')::boolean, false) then
    raise exception 'this file was made before the latest script change; press Full rebuild, then review the new version'
      using errcode = '55006';
  end if;
$a$ || anchor);
    execute format($f$create or replace function public.hs_youtube_video_file_decide(p_slug text, p_key text, p_status text,
      p_note text default null) returns jsonb language plpgsql security definer set search_path to 'public' as %L$f$, src);
    if position('_hs_yv_file_outdated' in (select prosrc from pg_proc
        where oid = 'public.hs_youtube_video_file_decide(text,text,text,text)'::regprocedure)) = 0 then
      raise exception 'decide splice did not take';
    end if;
  end if;
end $splice$;

-- create or replace keeps grants; restate them so a fresh database gets the same posture.
revoke all on function public.hs_youtube_videos_list() from public, anon;
grant execute on function public.hs_youtube_videos_list() to authenticated, service_role;
revoke all on function public.hs_youtube_video_file_decide(text, text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_file_decide(text, text, text, text) to authenticated, service_role;
