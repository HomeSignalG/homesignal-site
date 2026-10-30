-- YouTube note box, step 7: one pronunciation fix, every video that says the word. SQL of record, applied AFTER
-- docs/youtube-video-revision-plans.sql. Engine half: homesignal-ingest video/note_plan.py also_plans().
--
--   hs_youtube_video_plan_start   now also records, on the plan row, every OTHER video file of the project as it is
--       right now (`others`: {file_key: {version, settings}}). The worker plans the same pronunciation steps for each
--       of them that says the word and stores them inside the plan as plan.also.
--   hs_youtube_video_plan_confirm(plan, md5, also)   `also` names the other files to fix too (the founder ticks them
--       on the plan). Each becomes its own revision, rejected with the same note and built from its own plan. The md5
--       covers plan.also, so only what the founder was shown can be built.
--
-- Additive: one nullable column; plan_start replaced; confirm gains a third argument with a default (the two-argument
-- form is dropped so a call by name cannot be ambiguous). Both replaced bodies are guarded on their live md5.
begin;
set local lock_timeout = '5s';

do $g$
declare s1 text := (select prosrc from pg_proc where oid = to_regprocedure('public.hs_youtube_video_plan_start(text,text,text)'));
        s2 text := coalesce((select prosrc from pg_proc where oid = to_regprocedure('public.hs_youtube_video_plan_confirm(uuid,text)')),
                            (select prosrc from pg_proc where oid = to_regprocedure('public.hs_youtube_video_plan_confirm(uuid,text,text[])')));
begin
  -- the live bodies this file was written against (read 2026-10-30), or this file's own (a re-run)
  if md5(s1) <> '8592f443c2327704e93bcd6c41e2cd68' and position('others := others' in s1) = 0 then
    raise exception 'hs_youtube_video_plan_start changed since this file was written; rebuild it from the live body';
  end if;
  if md5(s2) <> 'bc4d20b94e6cbdea168b53d8a61c35f6' and position('p_also' in s2) = 0 then
    raise exception 'hs_youtube_video_plan_confirm changed since this file was written; rebuild it from the live body';
  end if;
end $g$;

alter table public.youtube_video_revision_plans add column if not exists others jsonb not null default '{}'::jsonb;

create or replace function public.hs_youtube_video_plan_start(p_slug text, p_key text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  r public.youtube_video_reviews%rowtype;
  note text := nullif(btrim(left(coalesce(p_note, ''), 500)), '');
  cur integer; st jsonb; open_p public.youtube_video_revision_plans%rowtype; active public.youtube_video_revisions%rowtype;
  new_id uuid; n24 integer; others jsonb := '{}'::jsonb; k text; kv integer;
begin
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then raise exception 'bad file' using errcode = '22023'; end if;
  if note is null then raise exception 'write what to change in the note box first' using errcode = '22023'; end if;
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if not (r.files ? p_key) then raise exception 'file not uploaded' using errcode = 'P0002'; end if;
  select * into active from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status in ('queued', 'running', 'validating');
  if found then
    raise exception 'a revision of this file is being generated; wait for it to finish' using errcode = '55006';
  end if;
  -- a reader that never answered (runner lost) must not hold the file forever
  update public.youtube_video_revision_plans set status = 'failed', completed_at = now(),
         error = 'Claude did not answer within 30 minutes. Your video is unchanged. Press the button again to retry.'
   where slug = p_slug and file_key = p_key and status = 'planning' and created_at < now() - interval '30 minutes';
  perform public._hs_yv_ensure_v1(p_slug, p_key);
  cur := public._hs_yv_current_version(p_slug, p_key);
  select * into open_p from public.youtube_video_revision_plans
   where slug = p_slug and file_key = p_key and status in ('planning', 'ready');
  if found then
    if open_p.note = note and open_p.parent_version = cur then
      return jsonb_build_object('plan_id', open_p.id, 'status', open_p.status, 'already_open', true);
    end if;
    update public.youtube_video_revision_plans set status = 'cancelled', decided_at = now() where id = open_p.id;
  end if;
  select count(*) into n24 from public.youtube_video_revision_plans
   where slug = p_slug and file_key = p_key and created_at > now() - interval '24 hours';
  if n24 >= 20 then
    raise exception 'this file''s notes were read 20 times in the last 24 hours; ask Claude to look at it' using errcode = '55000';
  end if;
  select settings into st from public.youtube_video_versions where slug = p_slug and file_key = p_key and version = cur;
  -- step 7: the other video files as they are now, so a pronunciation fix can be planned for them too
  if p_key <> 'thumbnail' then
    for k in select x from unnest(array['final', 'short1', 'short2']) x where x <> p_key and r.files ? x loop
      perform public._hs_yv_ensure_v1(p_slug, k);
      kv := public._hs_yv_current_version(p_slug, k);
      others := others || jsonb_build_object(k, jsonb_build_object('version', kv, 'settings',
                  coalesce((select v.settings from public.youtube_video_versions v
                             where v.slug = p_slug and v.file_key = k and v.version = kv), '{}'::jsonb)));
    end loop;
  end if;
  insert into public.youtube_video_revision_plans (slug, file_key, parent_version, note, settings, requested_by, others)
  values (p_slug, p_key, cur, note, coalesce(st, '{}'::jsonb), who, others)
  returning id into new_id;
  perform public._hs_yv_plan_dispatch(new_id);
  return jsonb_build_object('plan_id', new_id, 'status', (select status from public.youtube_video_revision_plans where id = new_id), 'already_open', false);
end $fn$;

drop function if exists public.hs_youtube_video_plan_confirm(uuid, text);

create or replace function public.hs_youtube_video_plan_confirm(p_plan_id uuid, p_plan_md5 text, p_also text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  pl public.youtube_video_revision_plans%rowtype;
  cur integer; new_id uuid; also_id uuid; broken_n integer; k text; a jsonb; also_ids jsonb := '{}'::jsonb; keys text[];
begin
  select * into pl from public.youtube_video_revision_plans where id = p_plan_id;
  if not found then raise exception 'unknown plan' using errcode = 'P0002'; end if;
  perform 1 from public.youtube_video_reviews where slug = pl.slug for update;   -- serialise with every other button
  select * into pl from public.youtube_video_revision_plans where id = p_plan_id for update;
  if pl.status = 'confirmed' then
    return jsonb_build_object('revision_id', pl.revision_id, 'already_confirmed', true);
  end if;
  if pl.status <> 'ready' then
    raise exception 'this plan is %, so it cannot be confirmed', pl.status using errcode = '55000';
  end if;
  if p_plan_md5 is distinct from pl.plan_md5 then
    raise exception 'the plan changed since you looked at it; look at it again' using errcode = '55000';
  end if;
  if jsonb_array_length(coalesce(pl.plan -> 'corrections', '[]'::jsonb)) = 0 then
    raise exception 'this plan changes nothing, so there is nothing to build' using errcode = '22023';
  end if;
  keys := array(select distinct x from unnest(coalesce(p_also, '{}')) x order by 1);
  foreach k in array keys loop
    a := pl.plan -> 'also' -> k;
    if a is null or k = pl.file_key or jsonb_array_length(coalesce(a -> 'plan' -> 'corrections', '[]'::jsonb)) = 0
       or (a ->> 'parent_version') is distinct from (pl.others -> k ->> 'version')
       or (a -> 'plan' ->> 'asset') is distinct from k then
      raise exception 'the plan has no fix for %', k using errcode = '22023';
    end if;
  end loop;
  cur := public._hs_yv_current_version(pl.slug, pl.file_key);
  if cur <> pl.parent_version or exists (select 1 from unnest(keys) k2
       where public._hs_yv_current_version(pl.slug, k2) <> (pl.others -> k2 ->> 'version')::int) then
    -- returned, not raised: a raise would undo the stale mark with it
    update public.youtube_video_revision_plans set status = 'stale', decided_at = now() where id = p_plan_id;
    return jsonb_build_object('stale', true, 'error', 'A newer version of this file was made after this plan. Write the note again to get a new plan.');
  end if;
  if exists (select 1 from public.youtube_video_revisions where slug = pl.slug and file_key = any (array_append(keys, pl.file_key))
              and status in ('queued', 'running', 'validating')) then
    raise exception 'a revision of this file is being generated; wait for it to finish' using errcode = '55006';
  end if;
  select count(*) into broken_n from public.youtube_video_revisions
   where slug = pl.slug and file_key = pl.file_key and status = 'failed' and created_at > now() - interval '24 hours';
  if broken_n >= 10 then
    raise exception 'revisions of this file failed 10 times in the last 24 hours because of a system problem; ask Claude to look at it' using errcode = '55000';
  end if;
  perform public.hs_youtube_video_file_decide(pl.slug, pl.file_key, 'rejected', pl.note);
  insert into public.youtube_video_revisions (slug, file_key, parent_version, instruction, settings, requested_by, attempts, plan, confirmed_plan)
  values (pl.slug, pl.file_key, cur, pl.note, pl.settings, who, 1,
          jsonb_build_object('corrections', pl.plan -> 'corrections', 'unsupported', coalesce(pl.plan -> 'not_done', '[]'::jsonb),
                             'steps', pl.plan -> 'steps', 'reader', pl.plan -> 'reader'),
          pl.plan - 'also')
  returning id into new_id;
  -- step 7: the same note fixes each ticked file, each its own revision built from its own plan
  foreach k in array keys loop
    a := pl.plan -> 'also' -> k;
    perform public.hs_youtube_video_file_decide(pl.slug, k, 'rejected', pl.note);
    insert into public.youtube_video_revisions (slug, file_key, parent_version, instruction, settings, requested_by, attempts, plan, confirmed_plan)
    values (pl.slug, k, (a ->> 'parent_version')::int, pl.note, coalesce(pl.others -> k -> 'settings', '{}'::jsonb), who, 1,
            jsonb_build_object('corrections', a -> 'plan' -> 'corrections', 'unsupported', coalesce(a -> 'plan' -> 'not_done', '[]'::jsonb),
                               'steps', a -> 'plan' -> 'steps', 'reader', a -> 'plan' -> 'reader'),
            a -> 'plan')
    returning id into also_id;
    also_ids := also_ids || jsonb_build_object(k, also_id);
  end loop;
  update public.youtube_video_revision_plans set status = 'confirmed', decided_at = now(), revision_id = new_id where id = p_plan_id;
  perform public._hs_yv_dispatch(new_id);
  foreach k in array keys loop
    perform public._hs_yv_dispatch((also_ids ->> k)::uuid);
  end loop;
  return jsonb_build_object('revision_id', new_id, 'status', (select status from public.youtube_video_revisions where id = new_id),
                            'also', also_ids, 'already_confirmed', false);
end $fn$;

revoke all on function public.hs_youtube_video_plan_confirm(uuid, text, text[]) from public, anon;
grant execute on function public.hs_youtube_video_plan_confirm(uuid, text, text[]) to authenticated;
revoke all on function public.hs_youtube_video_plan_start(text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_plan_start(text, text, text) to authenticated;
commit;
