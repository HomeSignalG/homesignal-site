-- YouTube note box, step 8: a full rebuild that keeps the fixes already accepted, and every fix built with the code
-- that made the video it corrects. SQL of record, applied AFTER docs/youtube-video-revision-plans-also.sql. Engine half:
-- homesignal-ingest .github/workflows/video-revise.yml (inputs `mode` and `code`) and video/revise.py --rebuild
-- (homesignal-ingest #977, which must be on main first: a dispatch carrying an input that is not there is refused).
--
--   _hs_yv_dispatch   now also sends
--       mode  'rebuild' for a full rebuild (the revision's plan says so), else 'build';
--       code  for a fix, the commit recorded on the version being fixed (meta.code_commit, written by the worker);
--             for a first version, 'run:<id>' of the build run its master copy came from; else '' (main's code).
--   hs_youtube_video_rebuild(slug, key)   the Full rebuild button. It makes the file again from the current script with
--       the current version's settings (every accepted fix). It needs no note and rejects nothing; the new version
--       waits for approval like any other.
--
-- Additive: no column; _hs_yv_dispatch replaced (guarded on its live md5); one new function.
begin;
set local lock_timeout = '5s';

do $g$
declare s text := (select prosrc from pg_proc where oid = to_regprocedure('public._hs_yv_dispatch(uuid)'));
begin
  -- the live body this file was written against (read 2026-10-30), or this file's own (a re-run)
  if md5(s) <> '786c9b52f66b143a1c62c34b6430aaa8' and position('''code'', code_in' in s) = 0 then
    raise exception '_hs_yv_dispatch changed since this file was written; rebuild it from the live body';
  end if;
end $g$;

create or replace function public._hs_yv_dispatch(p_id uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare rv public.youtube_video_revisions%rowtype; _pat text; _req bigint; pm jsonb; mode_in text; code_in text := ''; run_id text;
begin
  select * into rv from public.youtube_video_revisions where id = p_id;
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.youtube_video_revisions set status = 'failed', completed_at = now(),
      error = 'Revision could not start because no GitHub credential is stored for the video worker. Your original video is safe. Retry Generation once the credential is restored.'
     where id = p_id;
    return;
  end if;
  select coalesce(meta, '{}'::jsonb) into pm from public.youtube_video_versions
   where slug = rv.slug and file_key = rv.file_key and version = rv.parent_version;
  mode_in := case when rv.plan ->> 'mode' = 'rebuild' then 'rebuild' else 'build' end;
  if mode_in = 'build' then
    -- step 8: a fix is built with the video code that made the version it corrects
    if coalesce(pm ->> 'code_commit', '') ~ '^[0-9a-f]{40}$' then
      code_in := pm ->> 'code_commit';
    elsif rv.parent_version = 1 then
      run_id := substring((select r.meta -> 'master' ->> 'url' from public.youtube_video_reviews r where r.slug = rv.slug)
                          from '-run([0-9]{1,20})$');
      if run_id is not null then code_in := 'run:' || run_id; end if;
    end if;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/video-revise.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object(
              'revision_id', rv.id::text, 'slug', rv.slug, 'asset', rv.file_key,
              'instruction', rv.instruction, 'settings', rv.settings::text, 'parent_meta', coalesce(pm, '{}'::jsonb)::text,
              'parent_version', rv.parent_version::text, 'plan', coalesce(rv.confirmed_plan::text, ''),
              'mode', mode_in, 'code', code_in)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-video-revisions', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.youtube_video_revisions set dispatch_request_id = _req where id = p_id;
end $$;

create or replace function public.hs_youtube_video_rebuild(p_slug text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  r public.youtube_video_reviews%rowtype;
  cur integer; st jsonb; active public.youtube_video_revisions%rowtype; new_id uuid; broken_n integer;
begin
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then raise exception 'bad file' using errcode = '22023'; end if;
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if not (r.files ? p_key) then raise exception 'file not uploaded' using errcode = 'P0002'; end if;
  -- idempotent: a click while this file is being built returns THAT job
  select * into active from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status in ('queued', 'running', 'validating');
  if found then
    return jsonb_build_object('revision_id', active.id, 'status', active.status, 'already_active', true);
  end if;
  if exists (select 1 from public.youtube_video_revision_plans where slug = p_slug and file_key = p_key and status = 'planning') then
    raise exception 'Claude is reading a note for this file; wait for the plan, or cancel it, then rebuild' using errcode = '55006';
  end if;
  select count(*) into broken_n from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status = 'failed' and created_at > now() - interval '24 hours';
  if broken_n >= 10 then
    raise exception 'revisions of this file failed 10 times in the last 24 hours because of a system problem; ask Claude to look at it' using errcode = '55000';
  end if;
  perform public._hs_yv_ensure_v1(p_slug, p_key);
  cur := public._hs_yv_current_version(p_slug, p_key);
  select settings into st from public.youtube_video_versions where slug = p_slug and file_key = p_key and version = cur;
  -- a plan made on this version would now be built on an older one; let it go stale rather than build
  update public.youtube_video_revision_plans set status = 'cancelled', decided_at = now()
   where slug = p_slug and file_key = p_key and status = 'ready';
  insert into public.youtube_video_revisions (slug, file_key, parent_version, instruction, settings, requested_by, attempts, plan)
  values (p_slug, p_key, cur, 'Full rebuild from the current script, keeping every fix already accepted.',
          coalesce(st, '{}'::jsonb), who, 1, '{"mode":"rebuild"}'::jsonb)
  returning id into new_id;
  perform public._hs_yv_dispatch(new_id);
  return jsonb_build_object('revision_id', new_id, 'status', (select status from public.youtube_video_revisions where id = new_id), 'already_active', false);
end $fn$;

revoke all on function public.hs_youtube_video_rebuild(text, text) from public, anon;
grant execute on function public.hs_youtube_video_rebuild(text, text) to authenticated;
revoke all on function public._hs_yv_dispatch(uuid) from public, anon, authenticated;
commit;
