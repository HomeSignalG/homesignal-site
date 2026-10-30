-- YouTube note box, step 6: Claude reads the note, the founder sees "Here's what I'll change", and nothing is built
-- until he confirms. SQL of record. Engine half: homesignal-ingest video/note_plan.py + video-revise.yml mode=plan.
--
-- APPLY ORDER: homesignal-ingest #973 (the `mode` and `plan` workflow inputs) must be on main first. GitHub refuses a
-- dispatch carrying an input the workflow does not declare (422), so applying this earlier would stop every revision.
--
-- The flow:
--   hs_youtube_video_plan_start(slug, key, note)  stores a 'planning' row and dispatches mode=plan. It changes NO
--       decision: an approved file stays approved while its plan is read (the old button rejected first).
--   hs_youtube_revision_plan_ready / _fail        (service role only) the worker stores the plan, or why there is none.
--   hs_youtube_video_plan_confirm(plan, md5)      the founder confirms exactly the plan he saw (md5 of the stored plan):
--       the note becomes the rejection, one revision is created carrying the plan, and the build is dispatched with it.
--   hs_youtube_video_plan_cancel(plan)            drops a plan; nothing else changes.
--   hs_youtube_video_plans()                      the plans of the last 7 days, for Tab 16.
-- Additive: one new table, one new nullable column, new functions, and _hs_yv_dispatch gains the `plan` input (guarded on
-- its live body).
begin;
set local lock_timeout = '5s';

do $g$ declare src text := (select prosrc from pg_proc where oid = to_regprocedure('public._hs_yv_dispatch(uuid)'));
begin
  -- the live body this file was written against (read 2026-10-30), or this file's own (a re-run)
  if md5(src) <> 'bb1205cf3d1de40b0901a3e08341f876' and position('rv.confirmed_plan::text' in src) = 0 then
    raise exception '_hs_yv_dispatch changed since this file was written; rebuild it from the live body';
  end if;
end $g$;

create table if not exists public.youtube_video_revision_plans (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null references public.youtube_video_reviews(slug),
  file_key         text not null check (file_key in ('final', 'short1', 'short2', 'thumbnail')),
  parent_version   integer not null,
  note             text not null check (char_length(note) between 1 and 500),
  settings         jsonb not null default '{}'::jsonb,
  status           text not null default 'planning'
                   check (status in ('planning', 'ready', 'failed', 'confirmed', 'cancelled', 'stale')),
  plan             jsonb,
  plan_md5         text,
  error            text,
  requested_by     text not null,
  created_at       timestamptz not null default now(),
  completed_at     timestamptz,
  decided_at       timestamptz,
  revision_id      uuid references public.youtube_video_revisions(id),
  dispatch_request_id bigint
);
alter table public.youtube_video_revision_plans enable row level security;
revoke all on public.youtube_video_revision_plans from public, anon, authenticated;
-- ONE open plan per file: a double click cannot read the note twice.
create unique index if not exists youtube_video_revision_plans_one_open
  on public.youtube_video_revision_plans (slug, file_key) where status in ('planning', 'ready');

-- The plan a revision was confirmed from, sent to the worker on every dispatch (a retry builds the same plan).
alter table public.youtube_video_revisions add column if not exists confirmed_plan jsonb;

create or replace function public._hs_yv_dispatch(p_id uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare rv public.youtube_video_revisions%rowtype; _pat text; _req bigint; pm jsonb;
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
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/video-revise.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object(
              'revision_id', rv.id::text, 'slug', rv.slug, 'asset', rv.file_key,
              'instruction', rv.instruction, 'settings', rv.settings::text, 'parent_meta', coalesce(pm, '{}'::jsonb)::text,
              'parent_version', rv.parent_version::text, 'plan', coalesce(rv.confirmed_plan::text, ''))),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-video-revisions', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.youtube_video_revisions set dispatch_request_id = _req where id = p_id;
end $$;

create or replace function public._hs_yv_plan_dispatch(p_id uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare pl public.youtube_video_revision_plans%rowtype; _pat text; _req bigint;
begin
  select * into pl from public.youtube_video_revision_plans where id = p_id;
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.youtube_video_revision_plans set status = 'failed', completed_at = now(),
      error = 'Claude could not be asked to read the note because no GitHub credential is stored. Your video is unchanged.'
     where id = p_id;
    return;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/video-revise.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object(
              'revision_id', pl.id::text, 'slug', pl.slug, 'asset', pl.file_key, 'instruction', pl.note,
              'settings', pl.settings::text, 'parent_meta', '{}', 'parent_version', pl.parent_version::text,
              'mode', 'plan', 'plan', '')),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-video-revisions', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.youtube_video_revision_plans set dispatch_request_id = _req where id = p_id;
end $$;

-- ── the founder's buttons ───────────────────────────────────────────────────────────────────────
create or replace function public.hs_youtube_video_plan_start(p_slug text, p_key text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  r public.youtube_video_reviews%rowtype;
  note text := nullif(btrim(left(coalesce(p_note, ''), 500)), '');
  cur integer; st jsonb; open_p public.youtube_video_revision_plans%rowtype; active public.youtube_video_revisions%rowtype;
  new_id uuid; n24 integer;
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
  insert into public.youtube_video_revision_plans (slug, file_key, parent_version, note, settings, requested_by)
  values (p_slug, p_key, cur, note, coalesce(st, '{}'::jsonb), who)
  returning id into new_id;
  perform public._hs_yv_plan_dispatch(new_id);
  return jsonb_build_object('plan_id', new_id, 'status', (select status from public.youtube_video_revision_plans where id = new_id), 'already_open', false);
end $fn$;

create or replace function public.hs_youtube_video_plan_confirm(p_plan_id uuid, p_plan_md5 text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  pl public.youtube_video_revision_plans%rowtype;
  cur integer; new_id uuid; broken_n integer;
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
  cur := public._hs_yv_current_version(pl.slug, pl.file_key);
  if cur <> pl.parent_version then
    -- returned, not raised: a raise would undo the stale mark with it
    update public.youtube_video_revision_plans set status = 'stale', decided_at = now() where id = p_plan_id;
    return jsonb_build_object('stale', true, 'error', 'A newer version of this file was made after this plan. Write the note again to get a new plan.');
  end if;
  if exists (select 1 from public.youtube_video_revisions where slug = pl.slug and file_key = pl.file_key
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
          pl.plan)
  returning id into new_id;
  update public.youtube_video_revision_plans set status = 'confirmed', decided_at = now(), revision_id = new_id where id = p_plan_id;
  perform public._hs_yv_dispatch(new_id);
  return jsonb_build_object('revision_id', new_id, 'status', (select status from public.youtube_video_revisions where id = new_id), 'already_confirmed', false);
end $fn$;

create or replace function public.hs_youtube_video_plan_cancel(p_plan_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  perform public._hs_yv_admin();
  update public.youtube_video_revision_plans set status = 'cancelled', decided_at = now()
   where id = p_plan_id and status in ('planning', 'ready');
  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n = 1);
end $fn$;

create or replace function public.hs_youtube_video_plans()
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
begin
  perform public._hs_yv_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'file_key', p.file_key, 'parent_version', p.parent_version, 'note', p.note,
      'status', p.status, 'plan', p.plan, 'plan_md5', p.plan_md5, 'error', p.error, 'created_at', p.created_at,
      'completed_at', p.completed_at, 'decided_at', p.decided_at, 'revision_id', p.revision_id) order by p.created_at)
    from public.youtube_video_revision_plans p where p.created_at > now() - interval '7 days'), '[]'::jsonb);
end $fn$;

-- ── the worker (service role only) ──────────────────────────────────────────────────────────────
create or replace function public.hs_youtube_revision_plan_ready(p_id uuid, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  if jsonb_typeof(p_plan) <> 'object' or jsonb_typeof(p_plan -> 'steps') <> 'array'
     or jsonb_typeof(p_plan -> 'corrections') <> 'array' or jsonb_typeof(p_plan -> 'not_done') <> 'array' then
    raise exception 'malformed plan' using errcode = '22023';
  end if;
  update public.youtube_video_revision_plans
     set status = 'ready', plan = p_plan, plan_md5 = md5(p_plan::text), completed_at = now(), error = null
   where id = p_id and status = 'planning';   -- a cancelled or replaced plan is never brought back
  get diagnostics n = row_count;
  return jsonb_build_object('stored', n = 1);
end $fn$;

create or replace function public.hs_youtube_revision_plan_fail(p_id uuid, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  update public.youtube_video_revision_plans
     set status = 'failed', completed_at = now(),
         error = left(coalesce(nullif(btrim(p_error), ''), 'Claude could not read the note. Your video is unchanged.'), 500)
   where id = p_id and status = 'planning';
  get diagnostics n = row_count;
  return jsonb_build_object('stored', n = 1);
end $fn$;

revoke all on function public._hs_yv_plan_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.hs_youtube_revision_plan_ready(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.hs_youtube_revision_plan_fail(uuid, text) from public, anon, authenticated;
grant execute on function public.hs_youtube_revision_plan_ready(uuid, jsonb) to service_role;
grant execute on function public.hs_youtube_revision_plan_fail(uuid, text) to service_role;
revoke all on function public.hs_youtube_video_plan_start(text, text, text) from public, anon;
revoke all on function public.hs_youtube_video_plan_confirm(uuid, text) from public, anon;
revoke all on function public.hs_youtube_video_plan_cancel(uuid) from public, anon;
revoke all on function public.hs_youtube_video_plans() from public, anon;
grant execute on function public.hs_youtube_video_plan_start(text, text, text) to authenticated;
grant execute on function public.hs_youtube_video_plan_confirm(uuid, text) to authenticated;
grant execute on function public.hs_youtube_video_plan_cancel(uuid) to authenticated;
grant execute on function public.hs_youtube_video_plans() to authenticated;
commit;
