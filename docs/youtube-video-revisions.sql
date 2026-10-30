-- YouTube Videos: the REVISION ENGINE (founder, 2026-10-24).
--
-- A rejected asset carries the founder's plain-English note. "Generate Revised Video / Thumbnail" turns that note
-- into a corrected NEW VERSION of that ONE asset, without the founder touching Claude Code, GitHub or an MP4.
--
-- Chain:  dashboard button -> hs_youtube_video_revise (admin gate, validates, idempotent) -> durable row in
--         youtube_video_revisions -> pg_net dispatch of homesignal-ingest `video-revise.yml` (the SAME build.py every
--         original was made with) -> private storage jody-videos/<slug>/versions/<key>/v<N>.<ext>
--         -> hs_youtube_revision_complete (service role, atomic) -> new version "Revised - awaiting review".
--
-- WHAT THIS FILE GUARANTEES (each pinned by test/youtube_revisions_pg/):
--   * a previous version is NEVER overwritten or deleted: versions are rows, files are new paths;
--   * a revision creates ONLY the target file's new version; every other file's decision is untouched;
--   * a new version starts with NO decision (old approvals do not transfer);
--   * an approval is stamped with the version it approved, and hs_youtube_publishable_files() returns a file only
--     while its approved version is still the current one and no revision is in flight (the publish contract);
--   * one active revision per file (double clicks, refreshes and retries cannot start two runs);
--   * a result for a stale or cancelled revision is refused;
--   * the worker functions are service_role only; the browser only ever calls the three admin-gated functions.
-- Additive: new tables and functions; the two existing functions are replaced with supersets of themselves.
-- NOT APPLIED by the session that wrote it. Apply through db-sql after the ingest workflow video-revise.yml is on
-- main (a dispatch of an undeclared workflow is a 404, recorded as a failed revision, not a crash).
begin;

create table if not exists public.youtube_video_versions (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null references public.youtube_video_reviews(slug),
  file_key    text not null check (file_key in ('final', 'short1', 'short2', 'thumbnail')),
  version     integer not null check (version >= 1),
  path        text not null,
  bytes       bigint,
  sha256      text,
  meta        jsonb not null default '{}'::jsonb,      -- measurements of this file (duration, loudness, ...)
  settings    jsonb not null default '{}'::jsonb,      -- cumulative production settings that built it
  revision_id uuid,                                    -- null for the original upload
  decision    jsonb,                                   -- the founder's decision on THIS version, kept when it is superseded
  created_at  timestamptz not null default now(),
  unique (slug, file_key, version),
  unique (path)
);
alter table public.youtube_video_versions enable row level security;
revoke all on public.youtube_video_versions from public, anon, authenticated;

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
alter table public.youtube_video_revisions enable row level security;
revoke all on public.youtube_video_revisions from public, anon, authenticated;
-- ONE active revision per file: a double click, a refresh or a retry cannot start a second run.
create unique index if not exists youtube_video_revisions_one_active
  on public.youtube_video_revisions (slug, file_key) where status in ('queued', 'running', 'validating');

-- ── helpers (no grants: only the functions below call them) ──────────────────────────────────────────
create or replace function public._hs_yv_current_version(p_slug text, p_key text)
returns integer language sql stable security definer set search_path = public as $$
  select coalesce(max(version), 1) from public.youtube_video_versions where slug = p_slug and file_key = p_key
$$;

-- Make sure the ORIGINAL upload exists as version 1 (first revision of a file records it).
create or replace function public._hs_yv_ensure_v1(p_slug text, p_key text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.youtube_video_reviews%rowtype;
begin
  select * into r from public.youtube_video_reviews where slug = p_slug;
  if not found or not (r.files ? p_key) then return; end if;
  insert into public.youtube_video_versions (slug, file_key, version, path, bytes, sha256)
  values (p_slug, p_key, 1, r.files -> p_key ->> 'path', nullif(r.files -> p_key ->> 'bytes', '')::bigint, r.files -> p_key ->> 'sha256')
  on conflict (slug, file_key, version) do nothing;
end $$;

-- The one place a worker run is requested (button, retry). Never raises on a missing credential: it records the
-- revision as failed with a founder-readable reason, so the dashboard shows it instead of a silent spinner.
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
              'parent_version', rv.parent_version::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-video-revisions', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.youtube_video_revisions set dispatch_request_id = _req where id = p_id;
end $$;

create or replace function public._hs_yv_admin()
returns text language plpgsql stable security definer set search_path = public as $$
declare e text := auth.jwt() ->> 'email';
begin
  if e is null or not exists (select 1 from public.dashboard_admins da where da.email = e) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return e;
end $$;

-- ── THE BUTTON ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.hs_youtube_video_revise(p_slug text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  r public.youtube_video_reviews%rowtype;
  d jsonb; note text; cur integer; active public.youtube_video_revisions%rowtype;
  st jsonb; new_id uuid; failed_n integer; broken_n integer;
begin
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then
    raise exception 'bad file' using errcode = '22023';
  end if;
  select * into r from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  if not (r.files ? p_key) then raise exception 'file not uploaded' using errcode = 'P0002'; end if;

  -- idempotent: a click while a revision is already running returns THAT revision.
  select * into active from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status in ('queued', 'running', 'validating');
  if found then
    return jsonb_build_object('revision_id', active.id, 'status', active.status, 'already_active', true);
  end if;

  d := coalesce(r.file_decisions, '{}'::jsonb) -> p_key;
  if d is null or d ->> 'status' <> 'rejected' then
    raise exception 'only a rejected file can be revised; reject it with a note first' using errcode = '22023';
  end if;
  note := nullif(btrim(coalesce(d ->> 'note', '')), '');
  if note is null then
    raise exception 'write a note saying what is wrong, then reject again' using errcode = '22023';
  end if;
  cur := public._hs_yv_current_version(p_slug, p_key);
  perform public._hs_yv_ensure_v1(p_slug, p_key);
  cur := public._hs_yv_current_version(p_slug, p_key);

  -- Runaway limits. Only a note the reviser could NOT understand ('unsupported') counts against the note: once one
  -- exact note came back 'unsupported' on this version, the same words would only fail the same way, so they are
  -- refused until the founder rewords them (2026-10-29: the same note was sent up to 3 times, every time unsupported). A 'failed' revision is our system breaking (render, upload, a dead runner),
  -- not the note, so it never uses up the note's tries (2026-10-29: three render failures caused by a workflow bug
  -- blocked two correct notes). Those are capped separately, 10 in 24 hours per file, so a broken pipeline cannot
  -- be clicked into an endless loop of runs.
  select count(*) filter (where status = 'unsupported' and parent_version = cur and instruction = note),
         count(*) filter (where status = 'failed' and created_at > now() - interval '24 hours')
    into failed_n, broken_n
    from public.youtube_video_revisions where slug = p_slug and file_key = p_key;
  if failed_n >= 1 then
    raise exception 'this exact note was already tried on this version and could not be applied; change the wording, then try again' using errcode = '55000';
  end if;
  if broken_n >= 10 then
    raise exception 'revisions of this file failed 10 times in the last 24 hours because of a system problem; ask Claude to look at it' using errcode = '55000';
  end if;

  select settings into st from public.youtube_video_versions where slug = p_slug and file_key = p_key and version = cur;
  insert into public.youtube_video_revisions (slug, file_key, parent_version, instruction, settings, requested_by, attempts)
  values (p_slug, p_key, cur, note, coalesce(st, '{}'::jsonb), who, failed_n + 1)
  returning id into new_id;
  perform public._hs_yv_dispatch(new_id);
  return jsonb_build_object('revision_id', new_id, 'status', (select status from public.youtube_video_revisions where id = new_id), 'already_active', false);
end $fn$;

-- ── THE BUTTON, FROM ANY STATE: save the note as the rejection AND start the revision, as ONE transaction ───────
-- (2026-10-29). The page used to save the rejection, then start the revision, as two calls. When the second call was
-- refused (a refused note, the failure limit), the first had already replaced an approval and cancelled its Bluesky
-- post. Here either both happen or neither does: any refusal inside hs_youtube_video_revise rolls back the rejection.
-- A revision already running is returned as it is, and the saved decision is left alone.
create or replace function public.hs_youtube_video_reject_and_revise(p_slug text, p_key text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  who text := public._hs_yv_admin();
  active public.youtube_video_revisions%rowtype;
  note text := nullif(btrim(left(coalesce(p_note, ''), 500)), '');
begin
  if p_key not in ('final', 'short1', 'short2', 'thumbnail') then
    raise exception 'bad file' using errcode = '22023';
  end if;
  if note is null then
    raise exception 'write what to change in the note box first' using errcode = '22023';
  end if;
  -- Lock the review row FIRST, so two clicks at once are served one after the other: the second then sees the first's
  -- running revision and leaves the saved note alone, instead of overwriting it after the check.
  perform 1 from public.youtube_video_reviews where slug = p_slug for update;
  if not found then raise exception 'unknown video' using errcode = 'P0002'; end if;
  select * into active from public.youtube_video_revisions
   where slug = p_slug and file_key = p_key and status in ('queued', 'running', 'validating');
  if found then
    return jsonb_build_object('revision_id', active.id, 'status', active.status, 'already_active', true);
  end if;
  perform public.hs_youtube_video_file_decide(p_slug, p_key, 'rejected', note);
  return public.hs_youtube_video_revise(p_slug, p_key);
end $fn$;

create or replace function public.hs_youtube_video_revision_retry(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare who text := public._hs_yv_admin(); rv public.youtube_video_revisions%rowtype;
begin
  select * into rv from public.youtube_video_revisions where id = p_revision_id for update;
  if not found then raise exception 'unknown revision' using errcode = 'P0002'; end if;
  if rv.status not in ('failed') then raise exception 'only a failed revision can be retried' using errcode = '22023'; end if;
  if rv.attempts >= 3 then raise exception 'three attempts already used; change the note and generate again' using errcode = '55000'; end if;
  if public._hs_yv_current_version(rv.slug, rv.file_key) <> rv.parent_version then
    raise exception 'a newer version exists; reject it with a note and generate again' using errcode = '22023';
  end if;
  if exists (select 1 from public.youtube_video_revisions where slug = rv.slug and file_key = rv.file_key and status in ('queued', 'running', 'validating')) then
    raise exception 'a revision of this file is already running' using errcode = '55006';
  end if;
  update public.youtube_video_revisions set status = 'queued', error = null, completed_at = null, started_at = null,
         attempts = attempts + 1, requested_by = who where id = p_revision_id;
  perform public._hs_yv_dispatch(p_revision_id);
  return jsonb_build_object('revision_id', p_revision_id, 'status', (select status from public.youtube_video_revisions where id = p_revision_id));
end $fn$;

create or replace function public.hs_youtube_video_revision_cancel(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare who text := public._hs_yv_admin(); n integer;
begin
  update public.youtube_video_revisions set status = 'cancelled', completed_at = now(),
         error = 'Cancelled by ' || who || '. Your original video is safe.'
   where id = p_revision_id and status in ('queued', 'running', 'validating');
  get diagnostics n = row_count;
  return jsonb_build_object('cancelled', n = 1);
end $fn$;

-- ── WORKER SIDE (service_role only) ──────────────────────────────────────────────────────────────────
create or replace function public.hs_youtube_revision_mark(p_id uuid, p_status text, p_detail jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare n integer;
begin
  if p_status not in ('running', 'validating', 'failed', 'unsupported') then
    raise exception 'bad status' using errcode = '22023';
  end if;
  update public.youtube_video_revisions set
      status = p_status,
      started_at = case when p_status = 'running' then coalesce(started_at, now()) else started_at end,
      completed_at = case when p_status in ('failed', 'unsupported') then now() else completed_at end,
      plan = coalesce(p_detail -> 'plan', plan),
      result = coalesce(p_detail -> 'result', result),
      error = case when p_status in ('failed', 'unsupported') then left(coalesce(p_detail ->> 'error', 'The revision did not complete.'), 1000) else error end
   where id = p_id and status in ('queued', 'running', 'validating');   -- a cancelled or finished revision is never moved
  get diagnostics n = row_count;
  return jsonb_build_object('updated', n = 1);
end $fn$;

-- Atomic: the new version, the pointer switch and the revision's own completion happen together or not at all.
create or replace function public.hs_youtube_revision_complete(p_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  rv public.youtube_video_revisions%rowtype;
  r public.youtube_video_reviews%rowtype;
  cur integer; nv integer; fd jsonb; overall text; old jsonb;
begin
  select * into rv from public.youtube_video_revisions where id = p_id for update;
  if not found then raise exception 'unknown revision' using errcode = 'P0002'; end if;
  if rv.status not in ('queued', 'running', 'validating') then
    raise exception 'revision is %, not accepting a result', rv.status using errcode = '55000';
  end if;
  select * into r from public.youtube_video_reviews where slug = rv.slug for update;
  cur := public._hs_yv_current_version(rv.slug, rv.file_key);
  if cur <> rv.parent_version then
    update public.youtube_video_revisions set status = 'cancelled', completed_at = now(),
      error = 'A newer version of this file was created while this revision ran, so this result was discarded.' where id = p_id;
    return jsonb_build_object('accepted', false, 'reason', 'stale');
  end if;
  if coalesce(p_result ->> 'path', '') = '' or p_result ->> 'path' !~ ('^' || rv.slug || '/versions/' || rv.file_key || '/v[0-9]+[A-Za-z0-9._-]*$') then
    raise exception 'result path is not under this file''s versions folder' using errcode = '22023';
  end if;
  nv := cur + 1;
  fd := coalesce(r.file_decisions, '{}'::jsonb);
  old := fd -> rv.file_key;
  -- keep the founder's decision on the superseded version with that version (the history he can replay)
  update public.youtube_video_versions set decision = old where slug = rv.slug and file_key = rv.file_key and version = cur;
  -- the worker copied the superseded file to a version-named path first, so a later re-upload of the package cannot
  -- overwrite it; point the old version at the copy
  if coalesce(p_result ->> 'parent_path', '') <> '' then
    if p_result ->> 'parent_path' !~ ('^' || rv.slug || '/versions/' || rv.file_key || '/v[0-9]+[A-Za-z0-9._-]*$') then
      raise exception 'parent path is not under this file''s versions folder' using errcode = '22023';
    end if;
    update public.youtube_video_versions set path = p_result ->> 'parent_path'
     where slug = rv.slug and file_key = rv.file_key and version = cur;
  end if;
  insert into public.youtube_video_versions (slug, file_key, version, path, bytes, sha256, meta, settings, revision_id)
  values (rv.slug, rv.file_key, nv, p_result ->> 'path', (p_result ->> 'bytes')::bigint, p_result ->> 'sha256',
          coalesce(p_result -> 'meta', '{}'::jsonb), coalesce(p_result -> 'settings', '{}'::jsonb), rv.id);
  fd := fd - rv.file_key;                                    -- the new version starts with NO decision
  if exists (select 1 from jsonb_each(fd) e where e.value ->> 'status' = 'rejected') then overall := 'rejected';
  elsif not exists (select 1 from jsonb_object_keys(r.files) k where coalesce(fd -> k ->> 'status', '') <> 'approved') then overall := 'approved';
  else overall := 'pending'; end if;
  update public.youtube_video_reviews
     set files = jsonb_set(files, array[rv.file_key],
           jsonb_build_object('path', p_result ->> 'path', 'bytes', (p_result ->> 'bytes')::bigint,
                              'sha256', p_result ->> 'sha256', 'version', nv, 'revised', true)),
         file_decisions = fd, status = overall
   where slug = rv.slug;
  update public.youtube_video_revisions
     set status = 'succeeded', completed_at = now(), result_version = nv, error = null,
         plan = coalesce(p_result -> 'plan', plan), result = p_result - 'path' - 'settings' - 'parent_path'
   where id = p_id;
  return jsonb_build_object('accepted', true, 'version', nv);
end $fn$;

-- A revision that never reports back (runner lost, dispatch refused) must not spin forever.
create or replace function public.hs_youtube_revision_sweep()
returns integer language plpgsql security definer
set search_path to 'public', 'net', 'pg_temp' as $fn$
declare n integer := 0; k integer; bad record;
begin
  for bad in
    select v.id, h.status_code from public.youtube_video_revisions v
    join net._http_response h on h.id = v.dispatch_request_id
    where v.status = 'queued' and h.status_code is not null and h.status_code <> 204
  loop
    update public.youtube_video_revisions set status = 'failed', completed_at = now(),
      error = 'Revision failed because the video worker could not be started (GitHub answered ' || bad.status_code
              || '). Your original video is safe. Retry Generation.' where id = bad.id and status = 'queued';
    get diagnostics k = row_count; n := n + k;
  end loop;
  update public.youtube_video_revisions set status = 'failed', completed_at = now(),
    error = 'Revision failed because it did not finish within 90 minutes. Your original video is safe. Retry Generation.'
   where status in ('queued', 'running', 'validating') and created_at < now() - interval '90 minutes';
  get diagnostics k = row_count; n := n + k;
  return n;
end $fn$;

-- ── THE PUBLISH CONTRACT (for the Bluesky publisher) ─────────────────────────────────────────────────
-- A file is publishable only if (1) the founder approved it, (2) that approval was of the version that is current
-- now, and (3) no revision of it is in flight. There is no second approval and no Bluesky-specific status.
create or replace function public.hs_youtube_publishable_files(p_slug text)
returns table (file_key text, version integer, path text, sha256 text)
language sql stable security definer set search_path = public as $$
  select k, coalesce((r.files -> k ->> 'version')::int, 1), r.files -> k ->> 'path', r.files -> k ->> 'sha256'
    from public.youtube_video_reviews r, jsonb_object_keys(r.files) k
   where r.slug = p_slug
     and r.file_decisions -> k ->> 'status' = 'approved'
     and coalesce((r.file_decisions -> k ->> 'version')::int, 1) = coalesce((r.files -> k ->> 'version')::int, 1)
     and not exists (select 1 from public.youtube_video_revisions v
                      where v.slug = r.slug and v.file_key = k and v.status in ('queued', 'running', 'validating'))
$$;

-- ── REPLACED (supersets of the existing functions) ───────────────────────────────────────────────────
create or replace function public.hs_youtube_videos_list()
returns jsonb language plpgsql security definer set search_path = public stable as $fn$
begin
  perform public._hs_yv_admin();
  return coalesce((
    select jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'versions', coalesce((select jsonb_agg(jsonb_build_object('file_key', v.file_key, 'version', v.version, 'path', v.path,
                   'bytes', v.bytes, 'created_at', v.created_at, 'decision', v.decision, 'meta', v.meta,
                   'revision_id', v.revision_id) order by v.file_key, v.version)
                   from public.youtube_video_versions v where v.slug = r.slug), '[]'::jsonb),
      'revisions', coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'file_key', q.file_key, 'parent_version', q.parent_version,
                   'instruction', q.instruction, 'status', q.status, 'error', q.error, 'attempts', q.attempts,
                   'created_at', q.created_at, 'started_at', q.started_at, 'completed_at', q.completed_at,
                   'result_version', q.result_version, 'plan', q.plan, 'result', q.result) order by q.created_at)
                   from public.youtube_video_revisions q where q.slug = r.slug), '[]'::jsonb))
      order by r.created_at desc)
    from public.youtube_video_reviews r
  ), '[]'::jsonb);
end $fn$;

create or replace function public.hs_youtube_video_file_decide(p_slug text, p_key text, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
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
  -- a version that is being replaced cannot be approved: the approval would be of something about to be superseded
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
end $fn$;

-- ── GRANTS ───────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public._hs_yv_current_version(text, text), public._hs_yv_ensure_v1(text, text),
  public._hs_yv_dispatch(uuid), public._hs_yv_admin() from public, anon, authenticated;
revoke all on function public.hs_youtube_video_reject_and_revise(text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_reject_and_revise(text, text, text) to authenticated;
revoke all on function public.hs_youtube_video_revise(text, text), public.hs_youtube_video_revision_retry(uuid),
  public.hs_youtube_video_revision_cancel(uuid), public.hs_youtube_videos_list(),
  public.hs_youtube_video_file_decide(text, text, text, text) from public, anon;
grant execute on function public.hs_youtube_video_revise(text, text), public.hs_youtube_video_revision_retry(uuid),
  public.hs_youtube_video_revision_cancel(uuid), public.hs_youtube_videos_list(),
  public.hs_youtube_video_file_decide(text, text, text, text) to authenticated;
revoke all on function public.hs_youtube_revision_mark(uuid, text, jsonb), public.hs_youtube_revision_complete(uuid, jsonb),
  public.hs_youtube_revision_sweep(), public.hs_youtube_publishable_files(text) from public, anon, authenticated;
grant execute on function public.hs_youtube_revision_mark(uuid, text, jsonb), public.hs_youtube_revision_complete(uuid, jsonb),
  public.hs_youtube_revision_sweep(), public.hs_youtube_publishable_files(text) to service_role;

commit;

-- Schedule the sweeper (every 5 minutes). Kept outside the transaction and guarded so a database without
-- pg_cron (the disposable test one) still applies the file.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('youtube-video-revision-sweep', '*/5 * * * *', 'select public.hs_youtube_revision_sweep()');
  end if;
end $$;
