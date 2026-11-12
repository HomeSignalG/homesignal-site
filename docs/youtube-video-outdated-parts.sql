-- Tab 16 "Out of date": compare each kind of file on what it actually reads. Apply after youtube-video-outdated.sql.
--
-- Why (2026-11-07, the first live reading). youtube-video-outdated.sql compared the thumbnail on the whole project
-- ('all') and the main video on the same fingerprint as the Shorts ('video'). So #1049, which changed only each
-- Short's opening statement, called every main video and every thumbnail out of date (21 already-approved files
-- across 13 projects). A file built from an older script is still caught; what changes is which edits count:
--   * main video:  'main'  = the script without the Shorts, thumbnail, action links, YouTube texts and notes;
--   * each Short:  'video' = as 'main' plus the Shorts (unchanged);
--   * thumbnail:   'thumb' = the script without scenes, Shorts, voice and notes (it draws the thumbnail block, the
--                  action-link badge and the map tiles);
--   * any other file in video/projects/<slug> (fetched records, map tiles) counts for every part.
-- The fingerprints are made by homesignal-ingest scripts/video_project_heads.py (PARTS). A version recorded before
-- the parts existed carries only 'all' and 'video', and is compared on those (the old, broader rule): never weaker.
-- A file with no fingerprint uses the time rule against the time ITS part last changed on main (<part>_changed_at),
-- not the time any file in the folder changed.
--
-- Additive: new nullable columns, three functions replaced. The writer still accepts the two-fingerprint input,
-- so either repo can go first. Re-running is a no-op.

alter table public.youtube_video_project_heads
  add column if not exists fp_main          text check (fp_main  ~ '^[0-9a-f]{64}$'),
  add column if not exists fp_thumb         text check (fp_thumb ~ '^[0-9a-f]{64}$'),
  add column if not exists main_changed_at  timestamptz,
  add column if not exists video_changed_at timestamptz,
  add column if not exists thumb_changed_at timestamptz;

-- Writer: service role only. A value the ingest does not send stays null (an older ingest sends no parts).
create or replace function public.hs_youtube_project_heads_set(p_heads jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare h jsonb; n int := 0;
begin
  if jsonb_typeof(p_heads) <> 'array' then raise exception 'heads must be an array' using errcode = '22023'; end if;
  for h in select * from jsonb_array_elements(p_heads) loop
    insert into public.youtube_video_project_heads (slug, fp_all, fp_video, fp_main, fp_thumb, commit, committed_at,
                                                    main_changed_at, video_changed_at, thumb_changed_at, read_at)
    values (h ->> 'slug', h ->> 'fp_all', h ->> 'fp_video', h ->> 'fp_main', h ->> 'fp_thumb', h ->> 'commit',
            (h ->> 'committed_at')::timestamptz, (h ->> 'main_changed_at')::timestamptz,
            (h ->> 'video_changed_at')::timestamptz, (h ->> 'thumb_changed_at')::timestamptz, now())
    on conflict (slug) do update set fp_all = excluded.fp_all, fp_video = excluded.fp_video,
      fp_main = excluded.fp_main, fp_thumb = excluded.fp_thumb, commit = excluded.commit,
      committed_at = excluded.committed_at, main_changed_at = excluded.main_changed_at,
      video_changed_at = excluded.video_changed_at, thumb_changed_at = excluded.thumb_changed_at, read_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('heads', n);
end $fn$;
revoke all on function public.hs_youtube_project_heads_set(jsonb) from public, anon, authenticated;
grant execute on function public.hs_youtube_project_heads_set(jsonb) to service_role;

-- Backfill. 'all' and 'video' are required; 'main' and 'thumb' are kept when sent. Sets them where none are recorded;
-- a version backfilled from its code commit before the parts existed gets the MISSING parts added from the same
-- commit. Fingerprints recorded at build time (basis 'built') are never touched, and no recorded value is replaced.
create or replace function public.hs_youtube_version_fp_set(p_slug text, p_key text, p_version int, p_fp jsonb, p_basis text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n int := 0; parts jsonb := '{}'::jsonb; k text;
begin
  if coalesce(p_fp ->> 'all', '') !~ '^[0-9a-f]{64}$' or coalesce(p_fp ->> 'video', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'bad fingerprints' using errcode = '22023';
  end if;
  foreach k in array array['all', 'video', 'main', 'thumb'] loop
    if p_fp ? k then
      if coalesce(p_fp ->> k, '') !~ '^[0-9a-f]{64}$' then raise exception 'bad fingerprints' using errcode = '22023'; end if;
      parts := parts || jsonb_build_object(k, p_fp ->> k);
    end if;
  end loop;
  if p_basis not in ('code_commit', 'build_run') then raise exception 'bad basis' using errcode = '22023'; end if;
  if p_key = 'original' then
    update public.youtube_video_reviews
       set meta = case when coalesce(meta, '{}'::jsonb) ? 'project_fp'
                       then meta || jsonb_build_object('project_fp', parts || (meta -> 'project_fp'))
                       else coalesce(meta, '{}'::jsonb) || jsonb_build_object('project_fp', parts, 'project_fp_basis', p_basis) end
     where slug = p_slug
       and (not (coalesce(meta, '{}'::jsonb) ? 'project_fp')
            or (meta ->> 'project_fp_basis' = p_basis and p_basis = 'code_commit' and exists (select 1 from jsonb_object_keys(parts) pk(name) where not ((meta -> 'project_fp') ? pk.name))));
  else
    update public.youtube_video_versions
       set meta = case when coalesce(meta, '{}'::jsonb) ? 'project_fp'
                       then meta || jsonb_build_object('project_fp', parts || (meta -> 'project_fp'))
                       else coalesce(meta, '{}'::jsonb) || jsonb_build_object('project_fp', parts, 'project_fp_basis', p_basis) end
     where slug = p_slug and file_key = p_key and version = p_version
       and (not (coalesce(meta, '{}'::jsonb) ? 'project_fp')
            or (meta ->> 'project_fp_basis' = p_basis and p_basis = 'code_commit' and exists (select 1 from jsonb_object_keys(parts) pk(name) where not ((meta -> 'project_fp') ? pk.name))));
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n);
end $fn$;
revoke all on function public.hs_youtube_version_fp_set(text, text, int, jsonb, text) from public, anon, authenticated;
grant execute on function public.hs_youtube_version_fp_set(text, text, int, jsonb, text) to service_role;

-- THE ONE DECISION, now per kind of file. Each kind lists the parts it can be compared on, narrowest first; the first
-- part both the version and the head carry decides.
create or replace function public._hs_yv_file_outdated(p_slug text, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare
  r public.youtube_video_reviews%rowtype;
  h public.youtube_video_project_heads%rowtype;
  cur int; vmeta jsonb; vmade timestamptz; rec jsonb; prefs text[]; p text; part text; mine text; head text;
  made timestamptz; since timestamptz;
begin
  select * into r from public.youtube_video_reviews where slug = p_slug;
  if not found or not (coalesce(r.files, '{}'::jsonb) ? p_key) then return null; end if;
  select * into h from public.youtube_video_project_heads where slug = p_slug;
  if not found then return jsonb_build_object('state', 'unknown', 'outdated', false); end if;
  cur := coalesce((r.files -> p_key ->> 'version')::int, 1);
  prefs := case when p_key = 'thumbnail' then array['thumb', 'all']
                when p_key = 'final' then array['main', 'video']
                else array['video'] end;
  select v.meta, v.created_at into vmeta, vmade from public.youtube_video_versions v
   where v.slug = p_slug and v.file_key = p_key and v.version = cur;
  if cur = 1 then
    -- version 1 is the original upload; its versions row (if any) is written later, at the first revision
    rec := coalesce(vmeta -> 'project_fp', r.meta -> 'project_fp');
    made := r.created_at;
  else
    rec := vmeta -> 'project_fp';
    made := coalesce(vmade, r.created_at);
  end if;
  foreach p in array prefs loop
    head := case p when 'all' then h.fp_all when 'video' then h.fp_video when 'main' then h.fp_main else h.fp_thumb end;
    if rec ->> p is not null and head is not null then
      part := p; mine := rec ->> p; exit;
    end if;
  end loop;
  since := coalesce(case when p_key = 'thumbnail' then h.thumb_changed_at
                         when p_key = 'final' then h.main_changed_at
                         else h.video_changed_at end, h.committed_at);
  return jsonb_build_object(
    'state', case when mine is not null then 'script' else 'time' end,
    'outdated', case when mine is not null then mine <> head else since > made end,
    'part', part,
    'version', cur,
    'script_changed_at', since,
    'script_commit', h.commit);
end $fn$;
revoke all on function public._hs_yv_file_outdated(text, text) from public, anon, authenticated;
