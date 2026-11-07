-- Full rebuild carries out the founder's saved rejection note (2026-11-07). SQL of record, applied AFTER
-- docs/youtube-video-rebuild.sql, and only once homesignal-ingest's video-revise.yml with the script-note jobs is on
-- main (it reads plan.apply_note; an older worker would rebuild without the note, which is the defect this fixes).
--
-- The defect: video 3014's main video was rejected with "remove the act that has the quality of life checklist" and
-- then sent to Full rebuild. hs_youtube_video_rebuild read no note, so the worker made the same script again, the page
-- called it "Revised" and asked for a review of a video that was never changed. Same on both Shorts.
--
-- Now: when the file's current version is rejected with a saved note, the rebuild carries that note
-- (instruction = the note, plan and confirmed_plan = {"mode":"rebuild","apply_note":true}). The worker changes the
-- project's script first (video/script_fix.py), checks it, lands it on main and rebuilds from it; a note that changes
-- nothing ends the revision "unsupported" with the reason and no new version. A rebuild with no saved note is unchanged.
-- The same note already tried by a rebuild on this version and refused is refused again, until it is reworded or undone.
--
-- Additive: hs_youtube_video_rebuild replaced (guarded on its live md5); signature, grants and owner unchanged.
begin;
set local lock_timeout = '5s';

do $g$
declare s text := (select prosrc from pg_proc where oid = to_regprocedure('public.hs_youtube_video_rebuild(text,text)'));
begin
  -- the live body this file was written against (read 2026-11-07), or this file's own (a re-run)
  if md5(s) <> '1d951d0cbea340f1d0f3f9dd847491cd' and position('apply_note' in s) = 0 then
    raise exception 'hs_youtube_video_rebuild changed since this file was written; rebuild it from the live body';
  end if;
end $g$;

create or replace function public.hs_youtube_video_rebuild(p_slug text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  r public.youtube_video_reviews%rowtype;
  cur integer; st jsonb; active public.youtube_video_revisions%rowtype; new_id uuid; broken_n integer;
  dec jsonb; note text; pl jsonb := '{"mode":"rebuild"}'::jsonb;
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
  -- The saved rejection note on the CURRENT version: on the version row, else the review's per-file decision.
  select decision into dec from public.youtube_video_versions where slug = p_slug and file_key = p_key and version = cur;
  if dec is null or dec ->> 'status' is distinct from 'rejected' then
    dec := coalesce(r.file_decisions, '{}'::jsonb) -> p_key;
    if dec is not null and dec ? 'version' and (dec ->> 'version') is distinct from cur::text then dec := null; end if;
  end if;
  if dec is not null and dec ->> 'status' = 'rejected' then
    note := nullif(btrim(left(coalesce(dec ->> 'note', ''), 500)), '');
  end if;
  if note is not null then
    if exists (select 1 from public.youtube_video_revisions
                where slug = p_slug and file_key = p_key and parent_version = cur and status = 'unsupported'
                  and instruction = note and coalesce((plan ->> 'apply_note')::boolean, false)) then
      raise exception 'this note was already tried by Full rebuild on this version and could not be carried out; reword the note and save it, or press Undo to rebuild without it'
        using errcode = '55000';
    end if;
    pl := '{"mode":"rebuild","apply_note":true}'::jsonb;
  end if;
  -- a plan made on this version would now be built on an older one; let it go stale rather than build
  update public.youtube_video_revision_plans set status = 'cancelled', decided_at = now()
   where slug = p_slug and file_key = p_key and status = 'ready';
  insert into public.youtube_video_revisions (slug, file_key, parent_version, instruction, settings, requested_by, attempts, plan, confirmed_plan)
  values (p_slug, p_key, cur, coalesce(note, 'Full rebuild from the current script, keeping every fix already accepted.'),
          coalesce(st, '{}'::jsonb), who, 1, pl, case when note is not null then pl end)
  returning id into new_id;
  perform public._hs_yv_dispatch(new_id);
  return jsonb_build_object('revision_id', new_id, 'status', (select status from public.youtube_video_revisions where id = new_id),
                            'already_active', false, 'applies_note', note is not null);
end $fn$;

revoke all on function public.hs_youtube_video_rebuild(text, text) from public, anon;
grant execute on function public.hs_youtube_video_rebuild(text, text) to authenticated;
commit;
