-- IMPACT STORIES (Acquisition Dashboard Tab 17): story library, versioned drafts, jobs, and the editorial gate.
-- Founder handoff: JODY_IMPACT_STORIES v2.4 CTO/UX build handoff (2026-10-25).
--
-- Chain:  Tab 17 button -> hs_impact_story_* (admin gate, validates, idempotent) -> durable row in impact_story_jobs
--         -> pg_net dispatch of homesignal-ingest `impact-story-job.yml` (impact/worker.py)
--         -> hs_impact_story_job_claim / _complete / _fail (service role) -> a NEW version row, never an overwrite.
--
-- GUARANTEES (each pinned by test/impact_stories_pg/):
--   * additive only: new tables and functions; nothing existing is altered. Tab 11 and Tab 16 objects are only READ
--     (hs_impact_story_catalog reads youtube_video_reviews slug/title, nothing else);
--   * every table is RLS-on with no grants; the browser reaches data only through admin-gated SECURITY DEFINER
--     functions, and the worker functions are service_role only;
--   * versions are immutable rows; a save with a stale expected version is refused (optimistic lock);
--   * an approval is stamped with the version and the md5 of the artifact it approved. It stays effective only while
--     the current version's artifact is byte-identical, the current version passed the engine's checks for that
--     artifact against the CURRENT source pack, and the pack is fresh. So editing a Short never un-approves the
--     main script, and changing the angle un-approves everything written from it (first build; since 2026-10-26
--     one 'narrative' approval covers the whole story, so any change to it needs approving again);
--   * one active job per story; an identical request (same story, kind, version, scope, pack) returns the existing
--     job instead of starting and billing a second run;
--   * a result computed from a version the founder has since replaced is kept on the job and never becomes a version;
--   * nothing here publishes. Rendering (founder, 2026-10-26 "build") is a job like the others: it runs only on a
--     version whose integrated narrative is approved, writes masters to the PRIVATE `impact-media` bucket, and records
--     each file in impact_story_assets (append-only). Every file has its own media decision (gate 2), recorded in
--     impact_story_media_decisions (append-only). A file approved for one narrative is never approved for another:
--     an asset belongs to the narrative hash it was rendered from, and any change to the narrative makes it stale.
--
-- VISUALS (2026-10-29, homesignal-ingest docs/impact-visuals/PLAN-v3-2026-10-29.md P2): between the narrative approval
-- and Render sits one more gate. hs_impact_story_visuals_prepare queues a 'visuals' job (same render workflow) that
-- renders one still per shot; hs_impact_story_visuals_approve approves the whole set in ONE action after re-checking it
-- on the server; hs_impact_story_render then requires that approval and freezes the manifest hash into the job.
-- APPLY ORDER: merge the homesignal-ingest engine (which knows the 'visuals' kind and the approved hash) FIRST.
--
-- ONE INTEGRATED NARRATIVE (founder, 2026-10-26): Fear, Anger and Motivation are not competing choices. Analyze
-- returns the story arc (all three sections, each with its own evidence and status) and the eight-act outline;
-- Generate writes one script from it; ONE approval, 'narrative', covers the arc, outline, main script,
-- Quality-of-Life, both Shorts and the packaging. The per-artifact 'angle' / 'main' / 'short_*' / 'packaging'
-- approvals of the first build stay readable as history and can no longer be decided.
begin;

create table if not exists public.impact_stories (
  id               uuid primary key default gen_random_uuid(),
  video_slug       text not null check (video_slug ~ '^[a-z0-9][a-z0-9-]{0,80}$'),  -- the verified source pack it is written from
  title            text not null check (char_length(title) between 1 and 200),
  place            text,
  primary_emotion  text check (primary_emotion in ('FEAR', 'ANGER', 'MOTIVATION')),
  pack             jsonb,                     -- impact/pack.py output (claims, sources, conflicts, freshness)
  pack_hash        text,
  pack_checked_at  timestamptz,
  current_version  integer not null default 0,
  duplicated_from  uuid references public.impact_stories(id),
  archived_at      timestamptz,
  archived_by      text,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.impact_stories enable row level security;
revoke all on public.impact_stories from public, anon, authenticated;
-- Where a story came from (2026-10-27, Hot Topics): 'manual' (the founder created it) or 'auto_discovery' (prepared from
-- a Bluesky-discovered topic whose source pack was verified; docs/impact-discovery.sql). Additive; existing rows are manual.
alter table public.impact_stories add column if not exists origin text not null default 'manual';
alter table public.impact_stories add column if not exists discovery_candidate_id uuid;
alter table public.impact_stories drop constraint if exists impact_stories_origin_check;
alter table public.impact_stories add constraint impact_stories_origin_check check (origin in ('manual', 'auto_discovery'));

create table if not exists public.impact_story_versions (
  story_id     uuid not null references public.impact_stories(id),
  version      integer not null check (version >= 1),
  parent       integer,
  origin       text not null check (origin in ('analyze', 'generate', 'founder_edit', 'select_angle', 'reject_angle')),
  body         jsonb not null check (jsonb_typeof(body) = 'object'),
  validation   jsonb,                         -- rules.validate output for THIS body against pack_hash below
  validated_pack_hash text,
  derived      jsonb,                         -- ledger + platform variants (export copy), recomputed with validation
  job_id       uuid,
  created_by   text not null,
  created_at   timestamptz not null default now(),
  primary key (story_id, version)
);
alter table public.impact_story_versions enable row level security;
revoke all on public.impact_story_versions from public, anon, authenticated;

create table if not exists public.impact_story_jobs (
  id               uuid primary key default gen_random_uuid(),
  story_id         uuid not null references public.impact_stories(id),
  kind             text not null check (kind in ('pack', 'analyze', 'generate', 'validate', 'render', 'visuals')),
  input            jsonb not null default '{}'::jsonb,
  base_version     integer not null default 0,
  idempotency_key  text not null unique,
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'complete', 'failed', 'superseded')),
  result           jsonb,
  result_version   integer,
  error            text,
  attempts         integer not null default 1,
  requested_by     text not null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  dispatch_request_id bigint
);
alter table public.impact_story_jobs enable row level security;
revoke all on public.impact_story_jobs from public, anon, authenticated;
alter table public.impact_story_jobs drop constraint if exists impact_story_jobs_kind_check;
alter table public.impact_story_jobs add constraint impact_story_jobs_kind_check
  check (kind in ('pack', 'analyze', 'generate', 'validate', 'render', 'visuals'));
create unique index if not exists impact_story_jobs_one_active
  on public.impact_story_jobs (story_id) where status in ('queued', 'running');

create table if not exists public.impact_story_approvals (
  id             bigint generated always as identity primary key,
  story_id       uuid not null references public.impact_stories(id),
  gate           text not null default 'editorial' check (gate in ('editorial')),
  artifact       text not null check (artifact in ('angle', 'main', 'short_a', 'short_b', 'packaging', 'narrative')),
  version        integer not null,
  artifact_hash  text not null,
  decision       text not null check (decision in ('approved', 'rejected', 'revoked')),
  note           text check (note is null or char_length(note) <= 1000),
  target         text check (target is null or char_length(target) <= 200),   -- script line / scene the note is about
  actor          text not null,
  at             timestamptz not null default now()
);
-- an existing table (created before 'narrative') widens its list; nothing is removed
alter table public.impact_story_approvals drop constraint if exists impact_story_approvals_artifact_check;
alter table public.impact_story_approvals add constraint impact_story_approvals_artifact_check
  check (artifact in ('angle', 'main', 'short_a', 'short_b', 'packaging', 'narrative'));
alter table public.impact_story_approvals enable row level security;
revoke all on public.impact_story_approvals from public, anon, authenticated;

create table if not exists public.impact_story_events (
  id         bigint generated always as identity primary key,
  story_id   uuid not null references public.impact_stories(id),
  kind       text not null,
  detail     jsonb not null default '{}'::jsonb,
  actor      text not null,
  at         timestamptz not null default now()
);
alter table public.impact_story_events enable row level security;
revoke all on public.impact_story_events from public, anon, authenticated;

-- Rendered files (one row per file per render job). Masters live in the PRIVATE bucket `impact-media`.
create table if not exists public.impact_story_assets (
  id              bigint generated always as identity primary key,
  story_id        uuid not null references public.impact_stories(id),
  job_id          uuid not null references public.impact_story_jobs(id),
  version         integer not null,
  narrative_hash  text not null,          -- the approved narrative this file was rendered from
  renderer        text not null,          -- impact/render/plan.py RENDERER_VERSION
  asset           text not null check (asset in ('main', 'short_a', 'short_b', 'thumbnail')),
  path            text not null,          -- object name in impact-media: <story>/<job>/<file>
  captions_path   text,
  bytes           bigint not null check (bytes > 0),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  width           integer not null,
  height          integer not null,
  duration_s      numeric,
  preset          text not null,
  qc              jsonb not null default '{}'::jsonb,   -- media checks: dimensions, codecs, loudness, sync
  stills          jsonb not null default '[]'::jsonb,   -- object names of one full-size still per shot
  shots           jsonb not null default '[]'::jsonb,   -- shot list: id, layout, label, claims, start, length
  created_at      timestamptz not null default now(),
  unique (job_id, asset)
);
alter table public.impact_story_assets enable row level security;
revoke all on public.impact_story_assets from public, anon, authenticated;

-- Gate 2: one decision per file, append-only. A rejection says what to fix and may point at a moment (m:ss).
create table if not exists public.impact_story_media_decisions (
  id         bigint generated always as identity primary key,
  story_id   uuid not null references public.impact_stories(id),
  asset_id   bigint not null references public.impact_story_assets(id),
  decision   text not null check (decision in ('approved', 'rejected', 'revoked')),
  note       text check (note is null or char_length(note) <= 1000),
  timecode   text check (timecode is null or timecode ~ '^[0-9]{1,2}:[0-5][0-9](:[0-5][0-9])?$'),
  actor      text not null,
  at         timestamptz not null default now()
);
alter table public.impact_story_media_decisions enable row level security;
revoke all on public.impact_story_media_decisions from public, anon, authenticated;

-- "Fix" (founder, 2026-10-28). One batch = the open fix requests of one story, sent together. The button starts
-- homesignal-ingest impact-fix-run.yml for the batch at once (no schedule): Claude Code on the founder's plan, no paid API
-- (impact/fixes/FIXES.md). It claims the batch, changes the story or the renderer, and records per request what it did. The batch is the visible state: queued -> working -> done |
-- needs_you | failed. One active batch per story. Not append-only (its status moves); every move is a story event.
create table if not exists public.impact_story_fix_batches (
  id            uuid primary key default gen_random_uuid(),
  story_id      uuid not null references public.impact_stories(id),
  status        text not null default 'queued' check (status in ('queued', 'working', 'done', 'needs_you', 'failed')),
  requests      jsonb not null check (jsonb_typeof(requests) = 'array' and jsonb_array_length(requests) > 0),
  requested_by  text not null,
  requested_at  timestamptz not null default now(),
  attempts      integer not null default 0,
  claimed_at    timestamptz,
  completed_at  timestamptz,
  summary       text check (summary is null or char_length(summary) <= 2000),
  next_step     text check (next_step is null or char_length(next_step) <= 300),
  outcomes      jsonb not null default '[]'::jsonb,   -- [{decision_id, outcome: fixed|needs_you|not_changed, note}]
  version_after integer,
  pr_url        text check (pr_url is null or pr_url ~ '^https://github\.com/HomeSignalG/[A-Za-z0-9._-]+/pull/[0-9]+$')
);
create unique index if not exists impact_story_fix_batches_one_active
  on public.impact_story_fix_batches (story_id) where status in ('queued', 'working');
alter table public.impact_story_fix_batches enable row level security;
revoke all on public.impact_story_fix_batches from public, anon, authenticated;

-- A licensed photo a person chose for a subject the render could not show (impact/assets/acquire.py found the
-- candidates; the blocked render job carries them). Append-only: the newest choice per subject is the one used, and
-- it is frozen into the next render job's input, so a render always says which photos it was given.
create table if not exists public.impact_story_asset_choices (
  id           bigint generated always as identity primary key,
  story_id     uuid not null references public.impact_stories(id),
  subject_id   text not null check (subject_id ~ '^[a-z0-9:][a-z0-9:-]{1,60}$'),
  candidate_id text not null check (char_length(candidate_id) between 1 and 120),
  job_id       uuid not null references public.impact_story_jobs(id),   -- the blocked render whose candidates it came from
  entry        jsonb not null,                                          -- the candidate exactly as the engine recorded it
  actor        text not null,
  at           timestamptz not null default now()
);
alter table public.impact_story_asset_choices enable row level security;
revoke all on public.impact_story_asset_choices from public, anon, authenticated;

-- VISUALS (2026-10-29, homesignal-ingest docs/impact-visuals/PLAN-v3-2026-10-29.md P2). A `visuals` job plans the story
-- exactly as a render does and renders ONE still per shot with the real compositor (impact/render/build.py
-- build_stills), uploaded as JPEG previews under impact-media/<story>/visuals/<job>/. Its manifest (one row here,
-- immutable) lists every shot of the main video, both Shorts and the thumbnail with its photo, credit, rights record and
-- a status: clear, flagged (worth a look) or blocked (cannot be shown as planned). The founder approves the whole set
-- with ONE action (hs_impact_story_visuals_approve); a render then needs that approval and carries the manifest's hash,
-- and the engine refuses to render a plan that hashes to anything else.
create table if not exists public.impact_story_visual_manifests (
  id              bigint generated always as identity primary key,
  story_id        uuid not null references public.impact_stories(id),
  job_id          uuid not null unique references public.impact_story_jobs(id),
  version         integer not null,
  narrative_hash  text not null,            -- the approved narrative the previews were made from
  pack_hash       text,
  renderer        text not null,
  manifest_hash   text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),   -- impact/visuals/manifest.py plan_hash
  choices_key     text not null,            -- md5 of the photo choices the job used (as the render key has it)
  opts            jsonb not null default '{}'::jsonb,
  counts          jsonb not null default '{}'::jsonb,
  approvable      boolean not null,
  manifest        jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_at      timestamptz not null default now()
);
alter table public.impact_story_visual_manifests enable row level security;
revoke all on public.impact_story_visual_manifests from public, anon, authenticated;
-- Approve all visuals, or revoke that approval. Append-only: the newest row per manifest is its state.
create table if not exists public.impact_story_visual_events (
  id             bigint generated always as identity primary key,
  story_id       uuid not null references public.impact_stories(id),
  manifest_id    bigint not null references public.impact_story_visual_manifests(id),
  manifest_hash  text not null,
  decision       text not null check (decision in ('approved', 'revoked')),
  note           text check (note is null or char_length(note) <= 1000),
  actor          text not null,
  at             timestamptz not null default now()
);
alter table public.impact_story_visual_events enable row level security;
revoke all on public.impact_story_visual_events from public, anon, authenticated;

-- The private bucket. Readable only by dashboard admins (the same helper Tab 16's bucket uses); written only by the
-- worker's service role (no insert/update/delete policy exists, so no browser session can write to it).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('impact-media', 'impact-media', false, 262144000, array['video/mp4', 'image/png', 'text/plain', 'application/json', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists impact_media_admin_read on storage.objects;
create policy impact_media_admin_read on storage.objects
  for select to authenticated using (bucket_id = 'impact-media' and public.hs_is_dashboard_admin());

-- Append-only: approvals and events are evidence, never edited.
create or replace function public._hs_is_append_only() returns trigger language plpgsql as $$
begin raise exception 'impact story % rows are append-only', tg_table_name using errcode = '42501'; end $$;
drop trigger if exists impact_story_approvals_append_only on public.impact_story_approvals;
create trigger impact_story_approvals_append_only before update or delete on public.impact_story_approvals
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_asset_choices_append_only on public.impact_story_asset_choices;
create trigger impact_story_asset_choices_append_only before update or delete on public.impact_story_asset_choices
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_events_append_only on public.impact_story_events;
create trigger impact_story_events_append_only before update or delete on public.impact_story_events
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_assets_append_only on public.impact_story_assets;
create trigger impact_story_assets_append_only before update or delete on public.impact_story_assets
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_visual_manifests_append_only on public.impact_story_visual_manifests;
create trigger impact_story_visual_manifests_append_only before update or delete on public.impact_story_visual_manifests
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_visual_events_append_only on public.impact_story_visual_events;
create trigger impact_story_visual_events_append_only before update or delete on public.impact_story_visual_events
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_media_decisions_append_only on public.impact_story_media_decisions;
create trigger impact_story_media_decisions_append_only before update or delete on public.impact_story_media_decisions
  for each row execute function public._hs_is_append_only();
-- Versions are immutable except the engine's check results, which the validate job fills in.
create or replace function public._hs_is_version_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'impact story versions are never deleted' using errcode = '42501'; end if;
  if new.body is distinct from old.body or new.version <> old.version or new.story_id <> old.story_id
     or new.origin <> old.origin or new.created_by <> old.created_by then
    raise exception 'an impact story version is immutable; save a new version' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists impact_story_versions_immutable on public.impact_story_versions;
create trigger impact_story_versions_immutable before update or delete on public.impact_story_versions
  for each row execute function public._hs_is_version_guard();

-- ── helpers (no grants) ─────────────────────────────────────────────────────────────────────────────
create or replace function public._hs_is_admin()
returns text language plpgsql stable security definer set search_path = public as $$
declare e text := auth.jwt() ->> 'email';
begin
  if e is null or not exists (select 1 from public.dashboard_admins da where da.email = e) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return e;
end $$;

-- The slice of a body one approval covers. Mirrors impact/rules.py::artifact_slice.
create or replace function public._hs_is_artifact(p_body jsonb, p_artifact text)
returns jsonb language sql immutable as $$
  select case p_artifact
    -- impact-story/3 adds discovery, concepts and selection, each only when present, so an impact-story/2 body
    -- hashes exactly as before and an approval given before V3 still stands.
    when 'narrative' then jsonb_build_object('arc', p_body->'arc', 'outline', p_body->'outline', 'main', p_body->'main',
         'qol', p_body->'qol', 'shorts', p_body->'shorts', 'packaging', p_body->'packaging')
         || case when coalesce(p_body->'discovery', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('discovery', p_body->'discovery') else '{}'::jsonb end
         || case when coalesce(p_body->'concepts', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('concepts', p_body->'concepts') else '{}'::jsonb end
         || case when coalesce(p_body->'selection', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('selection', p_body->'selection') else '{}'::jsonb end
    when 'angle' then jsonb_build_object('selected', p_body->'selected_angle',
         'card', (select a from jsonb_array_elements(coalesce(p_body->'angles', '[]'::jsonb)) a
                   where a->>'id' = p_body->>'selected_angle' limit 1))
    when 'main' then jsonb_build_object('main', p_body->'main', 'qol', p_body->'qol', 'selected', p_body->'selected_angle')
    when 'short_a' then p_body->'shorts'->'a'
    when 'short_b' then jsonb_build_object('b', p_body->'shorts'->'b', 'exception', p_body->'shorts'->'b_exception')
    when 'packaging' then p_body->'packaging'
  end
$$;

create or replace function public._hs_is_hash(p_body jsonb, p_artifact text)
returns text language sql immutable as $$ select md5(coalesce(public._hs_is_artifact(p_body, p_artifact), 'null'::jsonb)::text) $$;

create or replace function public._hs_is_fresh(s public.impact_stories)
returns boolean language sql stable as $$
  select s.pack is not null and (s.pack->>'verified_at') is not null
     and (s.pack->>'verified_at')::timestamptz >= now() - make_interval(days => coalesce((s.pack->>'fresh_days')::int, 30))
$$;

-- Per-artifact effective state: approved | rejected | revoked | stale | checking | blocked | pending.
create or replace function public._hs_is_artifact_state(p_story uuid, p_artifact text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; a public.impact_story_approvals%rowtype;
        h text; chk jsonb; st text; why text;
begin
  select * into s from public.impact_stories where id = p_story;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  if not found then return jsonb_build_object('state', 'pending', 'why', 'Nothing written yet.'); end if;
  h := public._hs_is_hash(v.body, p_artifact);
  chk := v.validation -> p_artifact;
  select * into a from public.impact_story_approvals where story_id = p_story and artifact = p_artifact order by id desc limit 1;
  if v.validation is null or v.validated_pack_hash is distinct from s.pack_hash then
    st := 'checking'; why := 'The engine has not checked this version against the current sources yet.';
  elsif not coalesce((chk->>'ok')::boolean, false) then
    st := 'blocked'; why := coalesce(chk->'blocking'->>0, (v.validation->'pack'->'blocking')->>0, 'Blocked by the evidence checks.');
  elsif not public._hs_is_fresh(s) then
    st := 'blocked'; why := 'The sources were last checked more than ' || coalesce(s.pack->>'fresh_days', '30') || ' days ago. Re-check sources.';
  else
    st := 'pending'; why := 'Ready for your decision.';
  end if;
  if a.id is not null then
    if a.decision = 'approved' and a.artifact_hash = h and st = 'pending' then st := 'approved'; why := 'Approved on version ' || a.version || '.';
    elsif a.decision = 'approved' and a.artifact_hash = h then why := 'Your approval of version ' || a.version || ' is on hold: ' || why;
    elsif a.decision = 'approved' then why := 'Changed since you approved version ' || a.version || '. ' || why;
    elsif a.decision = 'rejected' and a.artifact_hash = h then st := 'rejected'; why := coalesce('Rejected: ' || a.note, 'Rejected.');
    elsif a.decision = 'revoked' and a.artifact_hash = h then st := 'revoked'; why := 'Approval revoked' || coalesce(': ' || a.note, '.');
    end if;
  end if;
  return jsonb_build_object('state', st, 'why', why, 'hash', h, 'version', s.current_version,
                            'last_decision', case when a.id is null then null else
                              jsonb_build_object('decision', a.decision, 'version', a.version, 'actor', a.actor, 'at', a.at, 'note', a.note) end);
end $$;

-- A render takes far longer than a text job, so it is called stuck later (the render workflow times out at 120 minutes).
create or replace function public._hs_is_stuck_after(p_kind text)
returns interval language sql immutable as $$ select case when p_kind in ('render', 'visuals') then interval '345 minutes' else interval '40 minutes' end $$;
-- A render's stuck limit stays above the worker's own 330-minute job timeout (impact-story-render.yml), so a render
-- GitHub is still allowed to finish is never offered for Retry. Measured 2026-10-27 on two ubuntu-latest runners: the
-- whole Gig Harbor render took 66 minutes on one and its main video alone 107 minutes on the next.

-- Why a queued job never started, or null. GitHub can refuse the start request (seen 2026-10-26: HTTP 500 on the
-- first Render), and then the job would sit "queued" until the render stuck limit. pg_net keeps the answer to
-- the dispatch for a few hours, so a refusal is read from it at once; a job no worker has claimed 15 minutes after
-- the request is treated the same way. Both make the job retryable now.
create or replace function public._hs_is_not_started(j public.impact_story_jobs)
returns text language plpgsql stable security definer set search_path = public, net as $$
declare code int; err text; timed boolean; seen boolean := false;
begin
  if j.id is null or j.status <> 'queued' or j.started_at is not null then return null; end if;
  if j.dispatch_request_id is not null then
    select true, r.status_code, r.error_msg, r.timed_out into seen, code, err, timed
      from net._http_response r where r.id = j.dispatch_request_id;
    if seen and (code is null or code < 200 or code > 299) then
      return 'GitHub did not start the worker' || case when code is not null then ' (HTTP ' || code || ')'
        when coalesce(timed, false) then ' (the request timed out)' else '' end || '. Nothing ran and nothing was lost. Press Retry.';
    end if;
  end if;
  if j.created_at < now() - interval '15 minutes' then
    return 'No worker has picked this job up in 15 minutes. Nothing ran and nothing was lost. Press Retry.';
  end if;
  return null;
end $$;

-- Rendered files of a story and their media decisions. The CURRENT set is the newest completed render job's files, and
-- it counts only while it was rendered from the narrative that is approved right now; otherwise it is listed as stale.
-- The photo chosen for each subject: the newest choice per subject wins.
create or replace function public._hs_is_choices(p_story uuid)
returns setof public.impact_story_asset_choices language sql stable security definer set search_path = public as $$
  select distinct on (subject_id) * from public.impact_story_asset_choices where story_id = p_story
   order by subject_id, id desc
$$;

create or replace function public._hs_is_media(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare na jsonb := public._hs_is_artifact_state(p_story, 'narrative'); j public.impact_story_jobs%rowtype;
        files jsonb := '[]'::jsonb; r record; d public.impact_story_media_decisions%rowtype; st text; why text;
        cur boolean; n int := 0; nok int := 0; b public.impact_story_jobs%rowtype; blocked jsonb; choices jsonb; fixes jsonb;
begin
  select * into j from public.impact_story_jobs where story_id = p_story and kind = 'render' and status = 'complete'
   order by completed_at desc limit 1;
  -- EVERY fix request ever made on this story's files, newest first, and where each one stands. A file card shows only
  -- its latest decision; this list never drops one. Status: closed (that file was approved later) · rendering (a render
  -- started after the request is queued or running) · rerendered (a render finished after it; narrative_changed says
  -- whether the narrative differs from the one the file was made from) · open (nothing has happened yet).
  -- Nothing here proves a fix was made: a request is a note until a Claude Code session changes the story and renders again.
  select coalesce(jsonb_agg(jsonb_build_object('id', md.id, 'asset', ia.asset, 'note', md.note, 'timecode', md.timecode,
           'actor', md.actor, 'at', md.at,
           'status', case
             when exists (select 1 from public.impact_story_media_decisions xd where xd.asset_id = md.asset_id and xd.id > md.id and xd.decision = 'approved') then 'closed'
             when exists (select 1 from public.impact_story_jobs rj where rj.story_id = p_story and rj.kind = 'render'
                           and rj.status in ('queued', 'running') and rj.created_at > md.at) then 'rendering'
             when exists (select 1 from public.impact_story_jobs rj where rj.story_id = p_story and rj.kind = 'render'
                           and rj.status = 'complete' and rj.completed_at > md.at) then 'rerendered'
             else 'open' end,
           'rerendered_at', (select max(rj.completed_at) from public.impact_story_jobs rj where rj.story_id = p_story
                              and rj.kind = 'render' and rj.status = 'complete' and rj.completed_at > md.at),
           'narrative_changed', (select rj.input->>'narrative_hash' is distinct from ia.narrative_hash
                                   from public.impact_story_jobs rj where rj.story_id = p_story and rj.kind = 'render'
                                    and rj.status = 'complete' and rj.completed_at > md.at
                                  order by rj.completed_at desc limit 1),
           -- the newest "Start fixes" batch that carried this request, and what it did with it
           'batch', (select jsonb_build_object('id', fb.id, 'status', fb.status, 'requested_at', fb.requested_at,
                       'claimed_at', fb.claimed_at, 'completed_at', fb.completed_at, 'next_step', fb.next_step,
                       'outcome', (select o->>'outcome' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = md.id limit 1),
                       'note', (select o->>'note' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = md.id limit 1))
                       from public.impact_story_fix_batches fb
                      where fb.story_id = p_story and fb.requests @> jsonb_build_array(jsonb_build_object('id', md.id))
                      order by fb.requested_at desc limit 1)
         ) order by md.id desc), '[]'::jsonb)
    into fixes
    from public.impact_story_media_decisions md join public.impact_story_assets ia on ia.id = md.asset_id
   where md.story_id = p_story and md.decision = 'rejected';
  -- a newer render the engine stopped before rendering (a missing essential photo, an outdated status): what is
  -- missing, the licensed candidates it found, and what a person must do. Shown until a later render completes.
  select * into b from public.impact_story_jobs where story_id = p_story and kind = 'render' and status = 'failed'
     and coalesce((result->>'blocked')::boolean, false)
     and (j.id is null or completed_at > j.completed_at)
   order by completed_at desc limit 1;
  if b.id is not null then
    blocked := jsonb_build_object('job_id', b.id, 'at', b.completed_at, 'error', b.error,
      'failures', coalesce(b.result->'failures', '[]'::jsonb), 'candidates', coalesce(b.result->'candidates', '[]'::jsonb),
      'candidates_error', b.result->'candidates_error', 'currency', b.result->'currency');
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('subject_id', c.subject_id, 'candidate_id', c.candidate_id, 'job_id', c.job_id,
           'title', c.entry->>'title', 'license', c.entry->>'license', 'author', c.entry->>'author',
           'page_url', c.entry->>'page_url', 'actor', c.actor, 'at', c.at) order by c.subject_id), '[]'::jsonb)
    into choices from public._hs_is_choices(p_story) c;
  if j.id is null then
    return jsonb_build_object('render_job', null, 'current', false, 'complete', false, 'files', '[]'::jsonb,
      'blocked', blocked, 'choices', choices, 'fix_requests', fixes, 'fix_batch', public._hs_is_fix_batch(p_story));
  end if;
  cur := na->>'state' = 'approved' and j.input->>'narrative_hash' = na->>'hash';
  for r in select * from public.impact_story_assets where job_id = j.id
           order by array_position(array['main', 'short_a', 'short_b', 'thumbnail'], asset) loop
    select * into d from public.impact_story_media_decisions where asset_id = r.id order by id desc limit 1;
    if not cur then st := 'stale'; why := 'Rendered from an earlier narrative. Render again.';
    elsif not coalesce((r.qc->>'ok')::boolean, r.asset = 'thumbnail') then st := 'blocked'; why := 'The media checks failed: see the checks below.';
    elsif (r.qc->'quality'->>'ok') = 'false' then   -- the storyboard and frame gates (impact/visual_gate.py)
      st := 'blocked';
      why := 'The visual quality gate failed: ' || coalesce((select string_agg(distinct f->>'label', '; ')
               from jsonb_array_elements(coalesce(r.qc->'quality'->'failures', '[]'::jsonb)) f), 'see the checks below') || '.';
    elsif d.id is null then st := 'pending'; why := 'Watch it, then approve or reject.';
    elsif d.decision = 'approved' then st := 'approved'; why := 'Approved by ' || d.actor || '.';
    elsif d.decision = 'rejected' then st := 'rejected'; why := 'Rejected: ' || coalesce(d.note, '') || coalesce(' (at ' || d.timecode || ')', '');
    else st := 'revoked'; why := 'Approval revoked' || coalesce(': ' || d.note, '.');
    end if;
    n := n + 1; if st = 'approved' then nok := nok + 1; end if;
    files := files || jsonb_build_object('id', r.id, 'asset', r.asset, 'path', r.path, 'captions_path', r.captions_path,
      'bytes', r.bytes, 'sha256', r.sha256, 'width', r.width, 'height', r.height, 'duration_s', r.duration_s,
      'preset', r.preset, 'qc', r.qc, 'stills', r.stills, 'shots', r.shots, 'version', r.version, 'renderer', r.renderer,
      'created_at', r.created_at, 'state', st, 'why', why,
      'last_decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'note', d.note,
        'timecode', d.timecode, 'actor', d.actor, 'at', d.at) end);
  end loop;
  return jsonb_build_object('render_job', j.id, 'rendered_at', j.completed_at, 'version', j.base_version,
    'renderer', j.input->>'renderer', 'current', cur, 'complete', cur and n > 0 and nok = n, 'files', files,
    'quality', j.result->'quality', 'currency', j.result->'currency', 'blocked', blocked, 'choices', choices,
    'fix_requests', fixes, 'fix_batch', public._hs_is_fix_batch(p_story));
end $$;

-- Where the story is, and the ONE next action (v2.4 J: one clearly labelled primary action).
create or replace function public._hs_is_status(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; j public.impact_story_jobs%rowtype;
        arts jsonb := '{}'::jsonb; k text; stage text; nxt text; lib text; all_ok boolean := true; m jsonb; vs jsonb;
begin
  select * into s from public.impact_stories where id = p_story;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  select * into j from public.impact_story_jobs where story_id = p_story order by created_at desc limit 1;
  arts := jsonb_build_object('narrative', public._hs_is_artifact_state(p_story, 'narrative'));
  all_ok := arts->'narrative'->>'state' = 'approved';
  if s.archived_at is not null then stage := 'archived'; nxt := 'Archived.'; lib := 'archived';
  elsif s.pack is null then stage := 'intake'; nxt := 'Check sources'; lib := 'draft';
  elsif jsonb_array_length(coalesce(s.pack->'claims', '[]')) = 0 then stage := 'sources_needed'; nxt := 'Sources needed'; lib := 'draft';
  elsif not public._hs_is_fresh(s) then stage := 'sources_needed'; nxt := 'Re-check sources'; lib := 'draft';
  elsif v.version is null or v.body->'arc' is null then
    stage := 'outline'; lib := 'draft';
    nxt := case when v.body ? 'angles' then 'Analyze again to get the story outline' else 'Analyze story' end;
  elsif v.body->'main' is null then stage := 'outline'; nxt := 'Review the outline, then Generate story'; lib := 'needs_review';
  elsif not all_ok then stage := 'script'; nxt := 'Review and approve the integrated narrative'; lib := 'needs_review';
  else
    m := public._hs_is_media(p_story);
    vs := public._hs_is_visuals(p_story);
    if (m->>'complete')::boolean then stage := 'distribution'; nxt := 'Ready to export. Publishing is not built yet.'; lib := 'ready';
    elsif (m->>'current')::boolean then stage := 'media'; nxt := 'Review each video and the thumbnail'; lib := 'needs_review';
    elsif vs->>'state' = 'approved' then stage := 'media'; nxt := 'Render the videos'; lib := 'ready';
    else
      stage := 'visuals'; lib := 'needs_review';
      nxt := case vs->>'state' when 'ready' then 'Review the visuals, then Approve all visuals'
                                when 'needs_fixes' then 'Replace the blocked pictures, then prepare the visuals again'
                                when 'preparing' then 'Preparing the preview stills…'
                                else 'Prepare the visuals' end;
    end if;
  end if;
  if j.status in ('queued', 'running') and public._hs_is_not_started(j) is not null then
    nxt := 'The job did not start. Press Retry.';
  elsif j.status in ('queued', 'running') then
    nxt := case j.kind when 'pack' then 'Checking sources…' when 'analyze' then 'Analyzing…' when 'generate' then 'Writing the story…'
                       when 'render' then 'Rendering the videos (about 30 to 60 minutes)…'
                       when 'visuals' then 'Preparing the preview stills (about 10 to 20 minutes)…' else 'Running checks…' end;
  end if;
  return jsonb_build_object('stage', stage, 'next', nxt, 'library', lib, 'artifacts', arts,
    'fresh', public._hs_is_fresh(s), 'job', case when j.id is null then null else jsonb_build_object(
      'id', j.id, 'kind', j.kind, 'status', j.status, 'error', coalesce(j.error, public._hs_is_not_started(j)), 'attempts', j.attempts,
      'created_at', j.created_at, 'started_at', j.started_at, 'completed_at', j.completed_at,
      'not_started', public._hs_is_not_started(j) is not null,
      'stuck', (j.status in ('queued', 'running') and j.created_at < now() - public._hs_is_stuck_after(j.kind))
               or public._hs_is_not_started(j) is not null) end);
end $$;

create or replace function public._hs_is_event(p_story uuid, p_kind text, p_detail jsonb, p_actor text)
returns void language sql security definer set search_path = public as $$
  insert into public.impact_story_events (story_id, kind, detail, actor) values (p_story, p_kind, coalesce(p_detail, '{}'::jsonb), p_actor)
$$;

-- The one place a worker run is requested. Never raises on a missing credential: the job is recorded as failed with
-- a founder-readable reason, so the dashboard shows it instead of a silent spinner.
create or replace function public._hs_is_dispatch(p_job uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text; _req bigint; _wf text;
begin
  select case when kind in ('render', 'visuals') then 'impact-story-render.yml' else 'impact-story-job.yml' end into _wf
    from public.impact_story_jobs where id = p_job;
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.impact_story_jobs set status = 'failed', completed_at = now(),
      error = 'The job could not start because no GitHub credential is stored for the worker. Nothing was lost. Retry once the credential is restored.'
     where id = p_job;
    return;
  end if;
  select net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/' || _wf || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('job_id', p_job::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-impact-stories', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000) into _req;
  update public.impact_story_jobs set dispatch_request_id = _req where id = p_job;
end $$;

-- Queue a job, idempotently. Same story + kind + version + scope + pack -> the existing job (unless p_new).
create or replace function public._hs_is_queue(p_story uuid, p_kind text, p_input jsonb, p_actor text, p_new boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.impact_stories%rowtype; key text; j public.impact_story_jobs%rowtype; active public.impact_story_jobs%rowtype;
begin
  select * into s from public.impact_stories where id = p_story for update;
  key := p_story || '|' || p_kind || '|v' || s.current_version || '|' || coalesce(p_input->>'scope', 'all') || '|' || coalesce(s.pack_hash, 'nopack')
         || case when p_new then '|new:' || gen_random_uuid() else '' end;
  select * into j from public.impact_story_jobs where idempotency_key = key;
  if found and j.status <> 'failed' then
    return jsonb_build_object('job_id', j.id, 'status', j.status, 'existing', true);
  end if;
  if found then   -- an identical failed request: retry it rather than creating a duplicate
    return public._hs_is_retry(j.id, p_actor);
  end if;
  select * into active from public.impact_story_jobs where story_id = p_story and status in ('queued', 'running');
  if found then
    raise exception 'Another job is already running for this story (%). Wait for it, or retry it if it is stuck.', active.kind using errcode = '55000';
  end if;
  insert into public.impact_story_jobs (story_id, kind, input, base_version, idempotency_key, requested_by)
  values (p_story, p_kind, coalesce(p_input, '{}'::jsonb), s.current_version, key, p_actor) returning * into j;
  perform public._hs_is_event(p_story, 'job_queued', jsonb_build_object('job_id', j.id, 'kind', p_kind, 'version', s.current_version), p_actor);
  perform public._hs_is_dispatch(j.id);
  return jsonb_build_object('job_id', j.id, 'status', 'queued', 'existing', false);
end $$;

create or replace function public._hs_is_retry(p_job uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.impact_story_jobs%rowtype; other int;
begin
  select * into j from public.impact_story_jobs where id = p_job for update;
  if not found then raise exception 'no such job' using errcode = 'P0002'; end if;
  if not (j.status = 'failed' or (j.status in ('queued', 'running') and j.created_at < now() - public._hs_is_stuck_after(j.kind))
          or public._hs_is_not_started(j) is not null) then
    raise exception 'This job is not failed or stuck, so it cannot be retried.' using errcode = '55000';
  end if;
  if j.attempts >= 5 then raise exception 'This job has been tried 5 times. Check the error and start a new request.' using errcode = '55000'; end if;
  select count(*) into other from public.impact_story_jobs where story_id = j.story_id and status in ('queued', 'running') and id <> p_job;
  if other > 0 then raise exception 'Another job is already running for this story.' using errcode = '55000'; end if;
  update public.impact_story_jobs set status = 'queued', error = null, result = null, attempts = attempts + 1,
         created_at = now(), started_at = null, completed_at = null where id = p_job;
  perform public._hs_is_event(j.story_id, 'job_retried', jsonb_build_object('job_id', p_job, 'attempt', j.attempts + 1), p_actor);
  perform public._hs_is_dispatch(p_job);
  return jsonb_build_object('job_id', p_job, 'status', 'queued', 'existing', true, 'retried', true);
end $$;

-- After a save or a finished job: if the current version has not been checked against the current pack and nothing is
-- running, queue the check. A save made while another job runs therefore still lands, and is checked right after.
create or replace function public._hs_is_followup(p_story uuid, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype;
begin
  select * into s from public.impact_stories where id = p_story;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  if v.version is null or (v.validation is not null and v.validated_pack_hash is not distinct from s.pack_hash) then return null; end if;
  if exists (select 1 from public.impact_story_jobs where story_id = p_story and status in ('queued', 'running')) then
    return jsonb_build_object('status', 'waiting', 'message', 'Saved. The checks will run when the current job finishes.');
  end if;
  return public._hs_is_queue(p_story, 'validate', '{}'::jsonb, p_actor);
end $$;

-- ── founder functions (authenticated; every one checks the dashboard allowlist) ──────────────────────
create or replace function public.hs_impact_story_catalog()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._hs_is_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('slug', r.slug, 'title', r.title) order by r.created_at)
                     from public.youtube_video_reviews r), '[]'::jsonb);
end $$;

create or replace function public.hs_impact_story_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._hs_is_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'title', s.title, 'place', s.place, 'video_slug', s.video_slug, 'primary_emotion', s.primary_emotion,
      'current_version', s.current_version, 'updated_at', s.updated_at, 'archived', s.archived_at is not null,
      'verified_at', s.pack->>'verified_at', 'status', public._hs_is_status(s.id),
      'origin', s.origin, 'discovery_candidate_id', s.discovery_candidate_id) order by s.updated_at desc)
    from public.impact_stories s), '[]'::jsonb);
end $$;

create or replace function public.hs_impact_story_get(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype;
begin
  perform public._hs_is_admin();
  select * into s from public.impact_stories where id = p_story;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  return jsonb_build_object(
    'story', to_jsonb(s) - 'pack', 'pack', s.pack, 'status', public._hs_is_status(p_story), 'media', public._hs_is_media(p_story),
    'visuals', public._hs_is_visuals(p_story),
    'version', case when v.version is null then null else jsonb_build_object('version', v.version, 'parent', v.parent,
      'origin', v.origin, 'body', v.body, 'validation', v.validation, 'derived', v.derived,
      'checked', v.validated_pack_hash is not distinct from s.pack_hash and v.validation is not null,
      'created_by', v.created_by, 'created_at', v.created_at) end,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('version', x.version, 'parent', x.parent, 'origin', x.origin,
      'created_by', x.created_by, 'created_at', x.created_at) order by x.version desc) from public.impact_story_versions x where x.story_id = p_story), '[]'),
    'approvals', coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from public.impact_story_approvals a where a.story_id = p_story), '[]'),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) - 'result' order by j.created_at desc) from public.impact_story_jobs j where j.story_id = p_story), '[]'),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id desc) from (select * from public.impact_story_events e where e.story_id = p_story order by id desc limit 200) e), '[]'));
end $$;

-- A previous version, for the diff against the approved text (v2.4 K).
create or replace function public.hs_impact_story_version(p_story uuid, p_version integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.impact_story_versions%rowtype;
begin
  perform public._hs_is_admin();
  select * into v from public.impact_story_versions where story_id = p_story and version = p_version;
  if not found then raise exception 'no such version' using errcode = 'P0002'; end if;
  return jsonb_build_object('version', v.version, 'origin', v.origin, 'body', v.body, 'created_at', v.created_at, 'created_by', v.created_by);
end $$;

create or replace function public.hs_impact_story_create(p_video_slug text, p_title text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; t text;
begin
  if p_video_slug is null or p_video_slug !~ '^[a-z0-9][a-z0-9-]{0,80}$' then
    raise exception 'Choose a verified project.' using errcode = '22023';
  end if;
  select coalesce(nullif(btrim(p_title), ''), r.title, p_video_slug) into t
    from (select 1) x left join public.youtube_video_reviews r on r.slug = p_video_slug;
  insert into public.impact_stories (video_slug, title, created_by) values (p_video_slug, left(t, 200), e) returning * into s;
  perform public._hs_is_event(s.id, 'created', jsonb_build_object('video_slug', p_video_slug), e);
  return jsonb_build_object('story_id', s.id, 'job', public._hs_is_queue(s.id, 'pack', '{}'::jsonb, e));
end $$;

-- Duplicate as a NEW Impact Story: same source project, fresh workflow, no approvals copied.
create or replace function public.hs_impact_story_duplicate(p_story uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); o public.impact_stories%rowtype; s public.impact_stories%rowtype;
begin
  select * into o from public.impact_stories where id = p_story;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  insert into public.impact_stories (video_slug, title, place, duplicated_from, created_by)
  values (o.video_slug, left('Copy of ' || o.title, 200), o.place, o.id, e) returning * into s;
  perform public._hs_is_event(s.id, 'duplicated', jsonb_build_object('from', o.id), e);
  return jsonb_build_object('story_id', s.id, 'job', public._hs_is_queue(s.id, 'pack', '{}'::jsonb, e));
end $$;

create or replace function public.hs_impact_story_archive(p_story uuid, p_confirm text, p_restore boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype;
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if p_restore then
    update public.impact_stories set archived_at = null, archived_by = null, updated_at = now() where id = p_story;
    perform public._hs_is_event(p_story, 'restored', '{}'::jsonb, e);
    return jsonb_build_object('archived', false);
  end if;
  if p_confirm is distinct from 'ARCHIVE' then raise exception 'Type ARCHIVE to confirm.' using errcode = '22023'; end if;
  update public.impact_stories set archived_at = now(), archived_by = e, updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'archived', '{}'::jsonb, e);
  return jsonb_build_object('archived', true);
end $$;

-- Check Sources / Analyze / Generate / Re-check. Returns a job receipt, never a finished result.
-- The one set of checks before a pack / analyze / generate / validate job. The founder's button and the auto-discovery
-- tick (docs/impact-discovery.sql) both come through here, so an automatic story meets exactly the same gates.
create or replace function public._hs_is_request(p_story uuid, p_kind text, p_scope text, p_new boolean, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.impact_stories%rowtype;
begin
  select * into s from public.impact_stories where id = p_story;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if p_kind not in ('pack', 'analyze', 'generate', 'validate') then raise exception 'bad kind' using errcode = '22023'; end if;
  if p_scope not in ('all', 'short_b', 'packaging') then raise exception 'bad scope' using errcode = '22023'; end if;
  if p_kind in ('analyze', 'generate') then
    if s.pack is null or jsonb_array_length(coalesce(s.pack->'claims', '[]')) = 0 then
      raise exception 'Sources needed: check sources first.' using errcode = '55000';
    end if;
    if not public._hs_is_fresh(s) then
      raise exception 'The sources are out of date. Re-check sources first.' using errcode = '55000';
    end if;
  end if;
  if p_kind = 'generate' then
    if not exists (select 1 from public.impact_story_versions x where x.story_id = p_story and x.version = s.current_version
                   and x.body->'arc' is not null and x.body->'outline' is not null) then
      raise exception 'Analyze the story first: there is no story outline to write from.' using errcode = '55000';
    end if;
  end if;
  if p_kind = 'validate' and s.current_version = 0 then raise exception 'Nothing to check yet.' using errcode = '55000'; end if;
  return public._hs_is_queue(p_story, p_kind, jsonb_build_object('scope', p_scope), p_actor, p_new);
end $$;

create or replace function public.hs_impact_story_request(p_story uuid, p_kind text, p_scope text default 'all', p_new boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin();
begin
  return public._hs_is_request(p_story, p_kind, p_scope, p_new, e);
end $$;

create or replace function public.hs_impact_story_job_retry(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin return public._hs_is_retry(p_job, public._hs_is_admin()); end $$;

-- The photo choices of a story and their key: the same md5 the render key has always carried.
create or replace function public._hs_is_choice_key(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'choices', coalesce(jsonb_agg(jsonb_build_object('subject_id', c.subject_id, 'candidate_id', c.candidate_id, 'entry', c.entry)
                 order by c.subject_id), '[]'::jsonb),
    'key', md5(coalesce(string_agg(c.subject_id || '=' || c.candidate_id, ',' order by c.subject_id collate "C"), '')))
    from public._hs_is_choices(p_story) c
$$;

-- Where the story's visuals stand: none | preparing | blocked | failed | stale | needs_fixes | ready | approved.
-- The CURRENT manifest is the newest one, and it counts only while the narrative it was made from is the approved one,
-- the sources are the same, the photo choices are the same and the renderer is the same.
create or replace function public._hs_is_visuals(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; na jsonb := public._hs_is_artifact_state(p_story, 'narrative');
        ck jsonb := public._hs_is_choice_key(p_story); m public.impact_story_visual_manifests%rowtype;
        ev public.impact_story_visual_events%rowtype; vj public.impact_story_jobs%rowtype; st text; why text; cur boolean := false;
        nblk int := 0; blocked jsonb;
begin
  select * into s from public.impact_stories where id = p_story;
  select * into vj from public.impact_story_jobs where story_id = p_story and kind = 'visuals' order by created_at desc limit 1;
  select * into m from public.impact_story_visual_manifests where story_id = p_story order by id desc limit 1;
  if m.id is not null then
    cur := na->>'state' = 'approved' and m.narrative_hash = na->>'hash' and m.pack_hash is not distinct from s.pack_hash
           and m.choices_key = ck->>'key' and m.renderer = 'impact-render-3';
    select * into ev from public.impact_story_visual_events where manifest_id = m.id order by id desc limit 1;
    nblk := coalesce((m.counts->>'blocked')::int, 0);
  end if;
  if vj.id is not null and vj.status = 'failed' and (m.id is null or vj.created_at > m.created_at) then
    blocked := jsonb_build_object('job_id', vj.id, 'at', vj.completed_at, 'error', vj.error,
      'blocked', coalesce((vj.result->>'blocked')::boolean, false), 'failures', coalesce(vj.result->'failures', '[]'::jsonb),
      'candidates', coalesce(vj.result->'candidates', '[]'::jsonb), 'candidates_error', vj.result->'candidates_error');
  end if;
  if vj.id is not null and vj.status in ('queued', 'running') then
    st := 'preparing'; why := 'Preparing the preview stills.';
  elsif blocked is not null then
    st := case when (blocked->>'blocked')::boolean then 'blocked' else 'failed' end; why := vj.error;
  elsif m.id is null then
    st := 'none'; why := 'Prepare the visuals to see every shot as it will look, before anything is rendered.';
  elsif not cur then
    st := 'stale';
    why := case when na->>'state' <> 'approved' then 'Approve the integrated narrative first.'
                when m.narrative_hash <> na->>'hash' then 'The narrative changed since these previews were made. Prepare the visuals again.'
                when m.pack_hash is distinct from s.pack_hash then 'The sources changed since these previews were made. Prepare the visuals again.'
                when m.choices_key <> ck->>'key' then 'You chose another photo since these previews were made. Prepare the visuals again.'
                else 'The renderer changed since these previews were made. Prepare the visuals again.' end;
  elsif ev.id is not null and ev.decision = 'approved' and ev.manifest_hash = m.manifest_hash then
    st := 'approved'; why := 'Approved by ' || ev.actor || '.';
  elsif nblk > 0 or not m.approvable then
    st := 'needs_fixes';
    why := case when nblk > 0 then nblk || ' shot(s) cannot be shown as planned. Replace those pictures, then prepare the visuals again.'
                else 'The previews could not be confirmed to match the render. Prepare the visuals again.' end;
  else
    st := 'ready'; why := 'Every shot passed the checks. Look them over, then Approve all visuals.';
  end if;
  return jsonb_build_object('state', st, 'why', why, 'current', cur, 'manifest_id', m.id, 'manifest_hash', m.manifest_hash,
    'created_at', m.created_at, 'version', m.version, 'counts', m.counts, 'approvable', m.approvable, 'manifest', m.manifest,
    'job', case when vj.id is null then null else jsonb_build_object('id', vj.id, 'status', vj.status, 'created_at', vj.created_at,
      'completed_at', vj.completed_at, 'error', vj.error) end,
    'blocked', blocked,
    'last_decision', case when ev.id is null then null else jsonb_build_object('decision', ev.decision, 'actor', ev.actor,
      'at', ev.at, 'note', ev.note) end);
end $$;

-- Prepare the visuals: plan the approved narrative and render one still per shot (no video). Same narrative + photo
-- choices returns the existing job unless p_new (Prepare again).
create or replace function public.hs_impact_story_visuals_prepare(p_story uuid, p_expected_version integer, p_new boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; na jsonb; ck jsonb;
begin
  select * into s from public.impact_stories where id = p_story;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload first.', s.current_version using errcode = '40001';
  end if;
  na := public._hs_is_artifact_state(p_story, 'narrative');
  if na->>'state' <> 'approved' then
    raise exception 'Approve the integrated narrative before preparing the visuals. %', na->>'why' using errcode = '55000';
  end if;
  ck := public._hs_is_choice_key(p_story);
  return public._hs_is_queue(p_story, 'visuals', jsonb_build_object('scope', 'visuals|' || (na->>'hash') || '|impact-render-3|' || (ck->>'key'),
    'narrative_hash', na->>'hash', 'renderer', 'impact-render-3', 'asset_choices', ck->'choices', 'choices_key', ck->>'key'), e, p_new);
end $$;

-- Approve all visuals: ONE action for the whole set. Re-checks on the server what the page showed: the manifest is the
-- current one and the one the page had (p_expected_hash), no shot is blocked, every photo has its license, file and
-- checksum and cleared rights, every shot has its preview inside the job's folder, and the previews matched the render.
create or replace function public.hs_impact_story_visuals_approve(p_story uuid, p_manifest_id bigint, p_expected_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); v jsonb; m public.impact_story_visual_manifests%rowtype; bad int; pfx text;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  v := public._hs_is_visuals(p_story);
  if (v->>'manifest_id')::bigint is distinct from p_manifest_id then
    raise exception 'Newer previews exist for this story. Reload and look at those.' using errcode = '40001';
  end if;
  select * into m from public.impact_story_visual_manifests where id = p_manifest_id and story_id = p_story;
  if m.manifest_hash is distinct from p_expected_hash then
    raise exception 'These previews changed since you opened them. Reload first.' using errcode = '40001';
  end if;
  if v->>'state' = 'approved' then return jsonb_build_object('ok', true, 'existing', true); end if;
  if v->>'state' <> 'ready' then raise exception 'These visuals cannot be approved: %', v->>'why' using errcode = '55000'; end if;
  pfx := p_story::text || '/visuals/' || m.job_id::text || '/';
  select count(*) into bad from jsonb_each(m.manifest->'assets') a, jsonb_array_elements(a.value->'shots') sh
   where sh->>'status' not in ('clear', 'flagged')
      or left(coalesce(sh->'preview'->>'path', ''), length(pfx)) <> pfx
      or (sh->'photo' is not null and jsonb_typeof(sh->'photo') = 'object' and (
            coalesce(sh->'photo'->'record'->>'license', '') = ''
         or coalesce(sh->'photo'->'record'->>'sha256', '') !~ '^[0-9a-f]{64}$'
         or coalesce(sh->'photo'->'record'->>'file_url', '') = ''
         or coalesce(sh->'photo'->'record'->>'rights_status', 'cleared') not in ('', 'cleared')));
  if bad > 0 then raise exception '% shot(s) failed the server check (blocked, no preview, or a photo without its license, file, checksum or cleared rights). Prepare the visuals again.', bad using errcode = '55000'; end if;
  if not exists (select 1 from jsonb_each(m.manifest->'assets') a where a.key = 'main' and jsonb_array_length(a.value->'shots') > 0)
     or not exists (select 1 from jsonb_each(m.manifest->'assets') a where a.key = 'thumbnail' and jsonb_array_length(a.value->'shots') > 0) then
    raise exception 'These previews have no main video or no thumbnail.' using errcode = '55000';
  end if;
  insert into public.impact_story_visual_events (story_id, manifest_id, manifest_hash, decision, actor)
  values (p_story, m.id, m.manifest_hash, 'approved', e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'visuals_approved', jsonb_build_object('manifest_id', m.id, 'hash', m.manifest_hash,
    'shots', (select count(*) from jsonb_each(m.manifest->'assets') a, jsonb_array_elements(a.value->'shots') sh)), e);
  return jsonb_build_object('ok', true, 'manifest_id', m.id);
end $$;

create or replace function public.hs_impact_story_visuals_revoke(p_story uuid, p_manifest_id bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); m public.impact_story_visual_manifests%rowtype;
begin
  select * into m from public.impact_story_visual_manifests where id = p_manifest_id and story_id = p_story;
  if not found then raise exception 'no such previews' using errcode = 'P0002'; end if;
  insert into public.impact_story_visual_events (story_id, manifest_id, manifest_hash, decision, note, actor)
  values (p_story, m.id, m.manifest_hash, 'revoked', left(p_note, 1000), e);
  perform public._hs_is_event(p_story, 'visuals_revoked', jsonb_build_object('manifest_id', m.id, 'note', p_note), e);
  return jsonb_build_object('ok', true);
end $$;

-- Save the founder's edits as a NEW version (optimistic lock), then re-check it.
-- Render the approved narrative (16:9 main, 9:16 Shorts, thumbnail, captions, QC stills). Only an APPROVED, checked,
-- fresh narrative can be rendered; the same narrative + renderer returns the existing render unless p_new.
create or replace function public.hs_impact_story_render(p_story uuid, p_expected_version integer, p_new boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; na jsonb; ch jsonb; ck jsonb; vs jsonb;
        vm public.impact_story_visual_manifests%rowtype;
begin
  select * into s from public.impact_stories where id = p_story;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload first.', s.current_version using errcode = '40001';
  end if;
  na := public._hs_is_artifact_state(p_story, 'narrative');
  if na->>'state' <> 'approved' then
    raise exception 'Approve the integrated narrative before rendering. %', na->>'why' using errcode = '55000';
  end if;
  -- the visuals (every shot's picture) must be approved too (2026-10-29): the render carries that manifest's hash and
  -- the engine refuses a plan that hashes to anything else, so the video shows exactly what was approved
  vs := public._hs_is_visuals(p_story);
  if vs->>'state' <> 'approved' then
    raise exception 'Approve the visuals before rendering. %', vs->>'why' using errcode = '55000';
  end if;
  select * into vm from public.impact_story_visual_manifests where id = (vs->>'manifest_id')::bigint;
  ck := public._hs_is_choice_key(p_story);
  ch := ck->'choices';
  -- the photos chosen are frozen into the job, and their ids and the approved visuals are part of its key, so a new
  -- choice or a new approval makes the next Render a new job while the same ones never render twice
  return public._hs_is_queue(p_story, 'render', jsonb_build_object('scope', 'render|' || (na->>'hash') || '|impact-render-3|'
    || (ck->>'key') || '|' || vm.manifest_hash,
    'narrative_hash', na->>'hash', 'renderer', 'impact-render-3', 'asset_choices', ch,
    'visual_manifest', jsonb_build_object('hash', vm.manifest_hash, 'opts', vm.opts, 'manifest_id', vm.id)), e, p_new);
end $$;

-- Gate 2: approve, reject (with what to fix, optionally at m:ss) or revoke ONE rendered file of the current set.
create or replace function public.hs_impact_story_media_decide(p_story uuid, p_asset_id bigint, p_decision text,
                                                               p_note text default null, p_timecode text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); m jsonb; f jsonb;
begin
  if p_decision not in ('approved', 'rejected', 'revoked') then raise exception 'bad decision' using errcode = '22023'; end if;
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  m := public._hs_is_media(p_story);
  select x into f from jsonb_array_elements(m->'files') x where (x->>'id')::bigint = p_asset_id;
  if f is null then raise exception 'That file is not part of the current render.' using errcode = '55000'; end if;
  if f->>'state' = 'stale' then raise exception 'That file was rendered from an earlier narrative. Render again.' using errcode = '55000'; end if;
  if p_decision = 'approved' then
    if f->>'state' = 'approved' then return jsonb_build_object('state', 'approved', 'unchanged', true); end if;
    if f->>'state' = 'blocked' then raise exception 'Cannot approve: %', f->>'why' using errcode = '55000'; end if;
  elsif p_decision = 'rejected' then
    if nullif(btrim(p_note), '') is null then raise exception 'Say what to fix.' using errcode = '22023'; end if;
  elsif f->>'state' <> 'approved' then
    raise exception 'There is no approval to revoke.' using errcode = '55000';
  end if;
  insert into public.impact_story_media_decisions (story_id, asset_id, decision, note, timecode, actor)
  values (p_story, p_asset_id, p_decision, nullif(btrim(p_note), ''), nullif(btrim(p_timecode), ''), e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'media_decision', jsonb_build_object('asset', f->>'asset', 'asset_id', p_asset_id,
    'decision', p_decision, 'timecode', nullif(btrim(p_timecode), '')), e);
  return jsonb_build_object('state', p_decision);
end $$;

-- A missing essential photo: choose one of the licensed candidates the blocked render found. Only a candidate that
-- render recorded can be chosen (license, author, sha256 and file exactly as the engine checked them); the choice
-- is used by the next Render, which downloads the file again and refuses it if its bytes differ.
create or replace function public.hs_impact_story_choose_asset(p_story uuid, p_job uuid, p_subject text, p_candidate text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); j public.impact_story_jobs%rowtype; c jsonb; cands jsonb;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  -- a render or visuals job that stopped for a missing photo offers candidates in its result; finished visuals offer
  -- alternatives for the subjects drawn as illustrations in their manifest
  select * into j from public.impact_story_jobs where id = p_job and story_id = p_story
     and ((kind in ('render', 'visuals') and status = 'failed' and coalesce((result->>'blocked')::boolean, false))
          or (kind = 'visuals' and status = 'complete'));
  if not found then raise exception 'That render did not stop for a missing photo.' using errcode = '55000'; end if;
  if j.status = 'complete' then
    cands := (select manifest->'alternatives' from public.impact_story_visual_manifests where job_id = p_job);
  else
    cands := j.result->'candidates';
  end if;
  select x into c from jsonb_array_elements(coalesce(cands, '[]'::jsonb)) g,
                       jsonb_array_elements(coalesce(g->'candidates', '[]'::jsonb)) x
   where g->>'subject_id' = p_subject and x->>'id' = p_candidate limit 1;
  if c is null then raise exception 'That photo is not one of the candidates found for this subject.' using errcode = '22023'; end if;
  if coalesce(c->>'sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(c->>'license', '') = '' or coalesce(c->>'file_url', '') = '' then
    raise exception 'That candidate is missing its license, file or checksum.' using errcode = '22023';
  end if;
  insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, entry, actor)
  values (p_story, p_subject, p_candidate, p_job, c, e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'asset_chosen', jsonb_build_object('subject', p_subject, 'candidate', p_candidate,
    'license', c->>'license', 'title', c->>'title'), e);
  return jsonb_build_object('ok', true, 'subject', p_subject, 'candidate', p_candidate);
end $$;

create or replace function public.hs_impact_story_save(p_story uuid, p_expected_version integer, p_body jsonb, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; nv int;
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %, you edited version %). Reload to see the new version; your text is still in the editor.', s.current_version, p_expected_version using errcode = '40001';
  end if;
  if p_body is null or jsonb_typeof(p_body) <> 'object' or octet_length(p_body::text) > 600000 then
    raise exception 'That draft is not a valid story body.' using errcode = '22023';
  end if;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  if v.body = p_body then return jsonb_build_object('version', s.current_version, 'unchanged', true); end if;
  nv := s.current_version + 1;
  insert into public.impact_story_versions (story_id, version, parent, origin, body, created_by)
  values (p_story, nv, nullif(s.current_version, 0), 'founder_edit', p_body, e);
  update public.impact_stories set current_version = nv, updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'saved', jsonb_build_object('version', nv, 'note', left(p_note, 300),
    'changed', (select jsonb_agg(k) from unnest(array['narrative']) k
                 where public._hs_is_hash(v.body, k) is distinct from public._hs_is_hash(p_body, k))), e);
  return jsonb_build_object('version', nv, 'unchanged', false, 'job', public._hs_is_followup(p_story, e));
end $$;

-- Choosing one angle was replaced by the integrated story outline (founder, 2026-10-26). Kept so an old page or a
-- stale tab gets a readable answer instead of a missing function; it changes nothing.
create or replace function public.hs_impact_story_angle(p_story uuid, p_expected_version integer, p_angle text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._hs_is_admin();
  raise exception 'Choosing one angle was replaced by the story outline. Reload the page and press Analyze.' using errcode = '55000';
end $$;

-- A revision note on one part of the outline or script (FEAR, ANGER, MOTIVATION, the outline, the script, a Short,
-- the packaging). Recorded as a story event on the current version; nothing is rewritten here. A Claude Code
-- session reads these notes and rewrites the draft, and the founder presses Analyze again.
create or replace function public.hs_impact_story_section_revision(p_story uuid, p_expected_version integer, p_section text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype;
begin
  if p_section not in ('fear', 'anger', 'motivation', 'outline', 'script', 'short_a', 'short_b', 'packaging',
                       'discovery', 'concepts', 'visuals', 'accountability') then
    raise exception 'bad section' using errcode = '22023';
  end if;
  if nullif(btrim(p_note), '') is null then raise exception 'Say what to change.' using errcode = '22023'; end if;
  if char_length(p_note) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = '22023'; end if;
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.current_version <> p_expected_version then raise exception 'This story changed since you opened it. Reload.' using errcode = '40001'; end if;
  perform public._hs_is_event(p_story, 'section_revision',
    jsonb_build_object('section', p_section, 'version', s.current_version, 'note', btrim(p_note)), e);
  update public.impact_stories set updated_at = now() where id = p_story;
  return jsonb_build_object('recorded', true, 'section', p_section, 'version', s.current_version);
end $$;

-- Gate 1 decisions, on the ONE integrated narrative. Approve needs it to have passed the engine's checks on the
-- current version and pack. Reject needs a note. Revoke withdraws an approval and blocks anything after it.
create or replace function public.hs_impact_story_decide(p_story uuid, p_artifact text, p_decision text, p_expected_version integer,
                                                         p_note text default null, p_target text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; st jsonb; h text;
begin
  if p_artifact in ('angle', 'main', 'short_a', 'short_b', 'packaging') then
    raise exception 'One approval now covers the whole story: approve the integrated narrative.' using errcode = '22023';
  end if;
  if p_artifact <> 'narrative' then raise exception 'bad artifact' using errcode = '22023'; end if;
  if p_decision not in ('approved', 'rejected', 'revoked') then raise exception 'bad decision' using errcode = '22023'; end if;
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload before deciding.', s.current_version using errcode = '40001';
  end if;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  if not found then raise exception 'Nothing to decide on yet.' using errcode = '55000'; end if;
  st := public._hs_is_artifact_state(p_story, p_artifact);
  h := public._hs_is_hash(v.body, p_artifact);
  if p_decision = 'approved' then
    if st->>'state' = 'approved' then return jsonb_build_object('state', 'approved', 'unchanged', true); end if;
    if st->>'state' in ('checking', 'blocked') then raise exception 'Cannot approve yet: %', st->>'why' using errcode = '55000'; end if;
  elsif p_decision = 'rejected' then
    if nullif(btrim(p_note), '') is null then raise exception 'Say what to change.' using errcode = '22023'; end if;
  elsif p_decision = 'revoked' then
    if st->>'state' <> 'approved' and coalesce(st->'last_decision'->>'decision', '') <> 'approved' then
      raise exception 'There is no approval to revoke.' using errcode = '55000';
    end if;
  end if;
  insert into public.impact_story_approvals (story_id, artifact, version, artifact_hash, decision, note, target, actor)
  values (p_story, p_artifact, s.current_version, h, p_decision, nullif(btrim(p_note), ''), nullif(btrim(p_target), ''), e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'decision', jsonb_build_object('artifact', p_artifact, 'decision', p_decision, 'version', s.current_version), e);
  return jsonb_build_object('state', public._hs_is_artifact_state(p_story, p_artifact));
end $$;

-- ── worker functions (service_role only) ──────────────────────────────────────────────────────────────
create or replace function public.hs_impact_story_job_claim(p_job_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.impact_story_jobs%rowtype; s public.impact_stories%rowtype; v public.impact_story_versions%rowtype;
begin
  select * into j from public.impact_story_jobs where id = p_job_id for update;
  if not found or j.status <> 'queued' then
    return jsonb_build_object('claimed', false, 'status', j.status);
  end if;
  update public.impact_story_jobs set status = 'running', started_at = now() where id = p_job_id;
  select * into s from public.impact_stories where id = j.story_id;
  select * into v from public.impact_story_versions where story_id = j.story_id and version = j.base_version;
  return jsonb_build_object('claimed', true, 'id', j.id, 'kind', j.kind, 'input', j.input, 'base_version', j.base_version,
    'story', jsonb_build_object('id', s.id, 'video_slug', s.video_slug, 'title', s.title, 'pack', s.pack),
    'base_body', v.body, 'asset_choices', coalesce(j.input->'asset_choices', '[]'::jsonb));
end $$;

-- p_result: what the worker found before it stopped (a blocked render: the failed checks, the missing subjects'
-- licensed candidates, the latest-development check). Kept on the job so Media Review can show it.
drop function if exists public.hs_impact_story_job_fail(uuid, text);
create or replace function public.hs_impact_story_job_fail(p_job_id uuid, p_error text, p_result jsonb default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.impact_story_jobs%rowtype;
begin
  if p_result is not null and (jsonb_typeof(p_result) <> 'object' or octet_length(p_result::text) > 400000) then
    p_result := null;
  end if;
  update public.impact_story_jobs set status = 'failed', completed_at = now(), error = left(coalesce(p_error, 'The worker failed.'), 900),
         result = p_result    -- this attempt's findings only; an unstructured failure never shows an earlier attempt's
   where id = p_job_id and status = 'running' returning * into j;
  if found then
    perform public._hs_is_event(j.story_id, 'job_failed', jsonb_build_object('job_id', j.id, 'kind', j.kind, 'error', j.error), 'worker');
    if j.kind <> 'validate' then perform public._hs_is_followup(j.story_id, 'worker'); end if;
  end if;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.hs_impact_story_job_complete(p_job_id uuid, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.impact_story_jobs%rowtype; s public.impact_stories%rowtype; nv int; d jsonb; vman jsonb; pfx text; mid bigint;
begin
  select * into j from public.impact_story_jobs where id = p_job_id for update;
  if not found or j.status <> 'running' then
    return jsonb_build_object('ok', false, 'reason', 'job is not running (' || coalesce(j.status, 'missing') || ')');
  end if;
  select * into s from public.impact_stories where id = j.story_id for update;
  d := p_result->'derived';
  if j.kind = 'pack' then
    if jsonb_typeof(p_result->'pack') <> 'object' then
      return public.hs_impact_story_job_fail(p_job_id, 'The worker returned no source pack.');
    end if;
    update public.impact_stories set pack = p_result->'pack', pack_hash = p_result->'pack'->>'hash', pack_checked_at = now(),
           title = case when s.title = s.video_slug then coalesce(p_result->'pack'->>'title', s.title) else s.title end,
           updated_at = now() where id = s.id;
    update public.impact_story_jobs set status = 'complete', completed_at = now(), result = jsonb_build_object('pack_hash', p_result->'pack'->>'hash')
     where id = p_job_id;
    perform public._hs_is_event(s.id, 'pack_checked', jsonb_build_object('hash', p_result->'pack'->>'hash',
      'claims', jsonb_array_length(coalesce(p_result->'pack'->'claims', '[]')), 'verified_at', p_result->'pack'->>'verified_at'), 'worker');
    if s.current_version > 0 and s.pack_hash is distinct from p_result->'pack'->>'hash' then   -- new evidence
      perform public._hs_is_event(s.id, 'freshness_warning', jsonb_build_object('reason', 'The source pack changed. Dependent claims must be re-checked.'), 'worker');
    end if;
    perform public._hs_is_followup(s.id, 'worker');
    return jsonb_build_object('ok', true);
  end if;
  if j.kind = 'render' then
    if jsonb_typeof(p_result->'assets') <> 'array'
       or not exists (select 1 from jsonb_array_elements(p_result->'assets') a where a->>'asset' = 'main')
       or not exists (select 1 from jsonb_array_elements(p_result->'assets') a where a->>'asset' = 'thumbnail') then
      return public.hs_impact_story_job_fail(p_job_id, 'The render returned no main video or no thumbnail.');
    end if;
    if exists (select 1 from jsonb_array_elements(p_result->'assets') a
               where left(a->>'path', length(j.story_id::text || '/' || j.id::text || '/')) <> j.story_id::text || '/' || j.id::text || '/') then
      return public.hs_impact_story_job_fail(p_job_id, 'The render returned a file outside this job''s folder.');
    end if;
    insert into public.impact_story_assets (story_id, job_id, version, narrative_hash, renderer, asset, path, captions_path,
      bytes, sha256, width, height, duration_s, preset, qc, stills, shots)
    select j.story_id, j.id, j.base_version, j.input->>'narrative_hash', j.input->>'renderer', a->>'asset', a->>'path', a->>'captions_path',
           (a->>'bytes')::bigint, a->>'sha256', (a->>'width')::int, (a->>'height')::int, (a->>'duration_s')::numeric, a->>'preset',
           coalesce(a->'qc', '{}'::jsonb), coalesce(a->'stills', '[]'::jsonb), coalesce(a->'shots', '[]'::jsonb)
      from jsonb_array_elements(p_result->'assets') a;
    update public.impact_story_jobs set status = 'complete', completed_at = now(),
           result = jsonb_build_object('files', jsonb_array_length(p_result->'assets'), 'storyboard', p_result->'storyboard',
                                       'quality', p_result->'quality', 'currency', p_result->'currency')
     where id = p_job_id;
    perform public._hs_is_event(j.story_id, 'rendered', jsonb_build_object('job_id', j.id, 'version', j.base_version,
      'files', (select jsonb_agg(a->>'asset') from jsonb_array_elements(p_result->'assets') a)), 'worker');
    return jsonb_build_object('ok', true, 'files', jsonb_array_length(p_result->'assets'));
  end if;
  if j.kind = 'visuals' then
    vman := p_result->'manifest';
    pfx := j.story_id::text || '/visuals/' || j.id::text || '/';
    if jsonb_typeof(vman) <> 'object' or coalesce(vman->>'hash', '') !~ '^[0-9a-f]{64}$' or jsonb_typeof(vman->'assets') <> 'object'
       or not exists (select 1 from jsonb_each(vman->'assets') a where a.key = 'main')
       or not exists (select 1 from jsonb_each(vman->'assets') a where a.key = 'thumbnail') then
      return public.hs_impact_story_job_fail(p_job_id, 'The visuals job returned no manifest, or one with no main video or no thumbnail.');
    end if;
    if exists (select 1 from jsonb_each(vman->'assets') a, jsonb_array_elements(a.value->'shots') sh
               where left(coalesce(sh->'preview'->>'path', ''), length(pfx)) <> pfx)
       or exists (select 1 from jsonb_array_elements(coalesce(vman->'alternatives', '[]'::jsonb)) g,
                         jsonb_array_elements(coalesce(g->'candidates', '[]'::jsonb)) x
                  where x->'preview' is not null and left(coalesce(x->'preview'->>'path', ''), length(pfx)) <> pfx) then
      return public.hs_impact_story_job_fail(p_job_id, 'The visuals job returned a preview outside this job''s folder.');
    end if;
    insert into public.impact_story_visual_manifests (story_id, job_id, version, narrative_hash, pack_hash, renderer, manifest_hash,
      choices_key, opts, counts, approvable, manifest)
    values (j.story_id, j.id, j.base_version, j.input->>'narrative_hash', vman->>'pack_hash', coalesce(vman->>'renderer', j.input->>'renderer'),
      vman->>'hash', coalesce(j.input->>'choices_key', ''), coalesce(vman->'opts', '{}'::jsonb), coalesce(vman->'counts', '{}'::jsonb),
      coalesce((vman->>'approvable')::boolean, false) and coalesce((vman->'identity'->>'same')::boolean, false), vman)
    returning id into mid;
    update public.impact_story_jobs set status = 'complete', completed_at = now(),
           result = jsonb_build_object('manifest_id', mid, 'hash', vman->>'hash', 'counts', vman->'counts', 'timing', vman->'timing')
     where id = p_job_id;
    perform public._hs_is_event(j.story_id, 'visuals_prepared', jsonb_build_object('job_id', j.id, 'manifest_id', mid,
      'counts', vman->'counts'), 'worker');
    return jsonb_build_object('ok', true, 'manifest_id', mid);
  end if;
  if j.kind = 'validate' then
    update public.impact_story_versions set validation = d->'validation', validated_pack_hash = d->'validation'->>'pack_hash', derived = d
     where story_id = s.id and version = j.base_version;
    update public.impact_story_jobs set status = 'complete', completed_at = now(), result_version = j.base_version where id = p_job_id;
    perform public._hs_is_event(s.id, 'checked', jsonb_build_object('version', j.base_version), 'worker');
    perform public._hs_is_followup(s.id, 'worker');   -- a newer save may be waiting for its check
    return jsonb_build_object('ok', true, 'version', j.base_version);
  end if;
  -- analyze / generate: a new version, unless the founder has saved something newer in the meantime
  if s.current_version <> j.base_version then
    update public.impact_story_jobs set status = 'superseded', completed_at = now(), result = p_result,
           error = 'You saved version ' || s.current_version || ' while this ran on version ' || j.base_version || '. The result is kept here and was not applied.'
     where id = p_job_id;
    perform public._hs_is_event(s.id, 'job_superseded', jsonb_build_object('job_id', j.id), 'worker');
    perform public._hs_is_followup(s.id, 'worker');
    return jsonb_build_object('ok', true, 'superseded', true);
  end if;
  if jsonb_typeof(p_result->'body') <> 'object' then
    return public.hs_impact_story_job_fail(p_job_id, 'The worker returned no draft.');
  end if;
  nv := s.current_version + 1;
  insert into public.impact_story_versions (story_id, version, parent, origin, body, validation, validated_pack_hash, derived, job_id, created_by)
  values (s.id, nv, nullif(s.current_version, 0), j.kind, p_result->'body', d->'validation', d->'validation'->>'pack_hash', d, j.id, 'worker');
  update public.impact_stories set current_version = nv, updated_at = now() where id = s.id;
  update public.impact_story_jobs set status = 'complete', completed_at = now(), result_version = nv where id = p_job_id;
  perform public._hs_is_event(s.id, j.kind || '_done', jsonb_build_object('version', nv, 'job_id', j.id), 'worker');
  return jsonb_build_object('ok', true, 'version', nv);
end $$;

-- ── "Fix" (was "Start fixes") ─────────────────────────────────────────────────────────────────────────────────────
-- The newest batch of a story, as the page shows it. A batch claimed more than 3 hours ago and not finished is
-- reported 'stalled' (the run died); pressing Fix again starts a run that may claim it.
create or replace function public._hs_is_fix_batch(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', b.id, 'status', case when b.status = 'working' and b.claimed_at < now() - interval '3 hours' then 'stalled' else b.status end,
           'requests', jsonb_array_length(b.requests), 'requested_by', b.requested_by, 'requested_at', b.requested_at,
           'claimed_at', b.claimed_at, 'completed_at', b.completed_at, 'attempts', b.attempts, 'summary', b.summary,
           'next_step', b.next_step, 'outcomes', b.outcomes, 'version_after', b.version_after, 'pr_url', b.pr_url)
    from public.impact_story_fix_batches b where b.story_id = p_story order by b.requested_at desc limit 1
$$;

-- The fix requests a new batch would carry: rejected decisions nothing has acted on (no later approval of that file, no
-- render since), not already in an active batch, and not already fixed by an earlier batch.
create or replace function public._hs_is_fix_eligible(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', (x->>'id')::bigint, 'asset', x->>'asset', 'note', x->>'note',
           'timecode', x->>'timecode', 'at', x->>'at') order by (x->>'id')::bigint), '[]'::jsonb)
    from jsonb_array_elements(public._hs_is_media(p_story)->'fix_requests') x
   where x->>'status' = 'open'
     and not exists (select 1 from public.impact_story_fix_batches b where b.story_id = p_story
                       and b.requests @> jsonb_build_array(jsonb_build_object('id', (x->>'id')::bigint))
                       and (b.status in ('queued', 'working')
                            or exists (select 1 from jsonb_array_elements(b.outcomes) o
                                        where (o->>'decision_id')::bigint = (x->>'id')::bigint and o->>'outcome' = 'fixed')))
$$;

-- Starts the Fix job for a batch (homesignal-ingest impact-fix-run.yml, on main). Never raises on a missing credential:
-- the batch is recorded failed with a readable reason, so the page shows it instead of a batch that never moves.
create or replace function public._hs_is_fix_dispatch(p_batch uuid)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text;
begin
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.impact_story_fix_batches set status = 'failed', completed_at = now(),
      summary = 'The fix could not start because no GitHub credential is stored. Nothing was lost. Press Fix again once it is restored.'
     where id = p_batch and status = 'queued';
    return;
  end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/impact-fix-run.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('batch', p_batch::text)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-impact-stories', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
end $$;

-- The founder's Fix button. Sends every eligible fix request of the story as one batch and starts the Fix job. A second
-- press while the batch is still queued, or stalled (claimed over 3 hours ago), starts the job again (the first start may
-- have been lost; a second run cannot claim a batch the first already took); while it is working, it returns that batch.
create or replace function public.hs_impact_story_fix_start(p_story uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; reqs jsonb; b public.impact_story_fix_batches%rowtype;
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  select * into b from public.impact_story_fix_batches where story_id = p_story and status in ('queued', 'working');
  if found then
    if b.status = 'queued' or b.claimed_at < now() - interval '3 hours' then perform public._hs_is_fix_dispatch(b.id); end if;
    return jsonb_build_object('existing', true, 'batch', public._hs_is_fix_batch(p_story));
  end if;
  reqs := public._hs_is_fix_eligible(p_story);
  if jsonb_array_length(reqs) = 0 then
    raise exception 'There are no open fix requests to send.' using errcode = '55000';
  end if;
  insert into public.impact_story_fix_batches (story_id, requests, requested_by) values (p_story, reqs, e) returning * into b;
  perform public._hs_is_event(p_story, 'fix_batch_queued', jsonb_build_object('batch', b.id, 'requests', jsonb_array_length(reqs)), e);
  perform public._hs_is_fix_dispatch(b.id);
  return jsonb_build_object('existing', false, 'batch', public._hs_is_fix_batch(p_story));
end $$;

-- The Fix job's door (service role only, through homesignal-ingest impact-fix-run.yml / impact-fix-batch.yml).
create or replace function public.impact_fix_batches_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'story_id', b.story_id, 'title', s.title, 'video_slug', s.video_slug,
           'current_version', s.current_version, 'status', b.status, 'requested_at', b.requested_at, 'claimed_at', b.claimed_at,
           'attempts', b.attempts, 'requests', b.requests) order by b.requested_at), '[]'::jsonb)
    from public.impact_story_fix_batches b join public.impact_stories s on s.id = b.story_id
   where b.status = 'queued' or (b.status = 'working' and b.claimed_at < now() - interval '3 hours')
$$;

create or replace function public.impact_fix_batch_claim(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.impact_story_fix_batches%rowtype;
begin
  select * into b from public.impact_story_fix_batches where id = p_batch for update;
  if not found then raise exception 'no such batch' using errcode = 'P0002'; end if;
  if not (b.status = 'queued' or (b.status = 'working' and b.claimed_at < now() - interval '3 hours')) then
    raise exception 'batch is % and cannot be claimed', b.status using errcode = '55000';
  end if;
  if b.attempts >= 3 then
    update public.impact_story_fix_batches set status = 'failed', completed_at = now(),
           summary = 'Three attempts did not finish. Press Fix to try again.' where id = b.id;
    perform public._hs_is_event(b.story_id, 'fix_batch_failed', jsonb_build_object('batch', b.id, 'reason', 'attempts'), 'fixer');
    raise exception 'batch failed after 3 attempts' using errcode = '55000';
  end if;
  update public.impact_story_fix_batches set status = 'working', claimed_at = now(), attempts = attempts + 1 where id = b.id;
  perform public._hs_is_event(b.story_id, 'fix_batch_working', jsonb_build_object('batch', b.id, 'attempt', b.attempts + 1), 'fixer');
  return jsonb_build_object('ok', true, 'batch', b.id, 'story_id', b.story_id, 'requests', b.requests);
end $$;

-- Finish a batch. p_payload: {status: done|needs_you|failed, summary, next_step, pr_url, regenerate: generate|analyze|null,
-- outcomes: [{decision_id, outcome: fixed|needs_you|not_changed, note}]}. done/needs_you must account for every request.
-- regenerate queues that job on the story (as the Generate / Analyze buttons do) so the fixed script becomes a new version;
-- approving it and rendering stay with the founder.
create or replace function public.impact_fix_batch_complete(p_batch uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.impact_story_fix_batches%rowtype; st text := p_payload->>'status'; outs jsonb := coalesce(p_payload->'outcomes', '[]'::jsonb);
        regen text := nullif(p_payload->>'regenerate', ''); job jsonb;
begin
  select * into b from public.impact_story_fix_batches where id = p_batch for update;
  if not found then raise exception 'no such batch' using errcode = 'P0002'; end if;
  if b.status <> 'working' then raise exception 'batch is %, not working', b.status using errcode = '55000'; end if;
  if st not in ('done', 'needs_you', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  if nullif(btrim(p_payload->>'summary'), '') is null then raise exception 'say what was done' using errcode = '22023'; end if;
  if regen is not null and regen not in ('generate', 'analyze') then raise exception 'bad regenerate' using errcode = '22023'; end if;
  if jsonb_typeof(outs) <> 'array' or exists (select 1 from jsonb_array_elements(outs) o
       where o->>'outcome' not in ('fixed', 'needs_you', 'not_changed')
          or not (b.requests @> jsonb_build_array(jsonb_build_object('id', (o->>'decision_id')::bigint)))) then
    raise exception 'outcomes must name requests of this batch with fixed, needs_you or not_changed' using errcode = '22023';
  end if;
  if st in ('done', 'needs_you') and exists (select 1 from jsonb_array_elements(b.requests) r
       where not exists (select 1 from jsonb_array_elements(outs) o where (o->>'decision_id')::bigint = (r->>'id')::bigint)) then
    raise exception 'every request needs an outcome' using errcode = '22023';
  end if;
  if st = 'done' and exists (select 1 from jsonb_array_elements(outs) o where o->>'outcome' = 'needs_you') then
    raise exception 'a request that needs the founder makes the batch needs_you' using errcode = '22023';
  end if;
  if regen is not null then
    job := public._hs_is_request(b.story_id, regen, 'all', true, 'fixer');
  end if;
  update public.impact_story_fix_batches set status = st, completed_at = now(), summary = left(p_payload->>'summary', 2000),
         next_step = left(nullif(p_payload->>'next_step', ''), 300), outcomes = outs, pr_url = nullif(p_payload->>'pr_url', '')
   where id = b.id;
  perform public._hs_is_event(b.story_id, 'fix_batch_' || st, jsonb_build_object('batch', b.id, 'regenerate', regen,
    'fixed', (select count(*) from jsonb_array_elements(outs) o where o->>'outcome' = 'fixed')), 'fixer');
  return jsonb_build_object('ok', true, 'status', st, 'job', job);
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'public._hs_is_admin()', 'public._hs_is_artifact(jsonb, text)', 'public._hs_is_hash(jsonb, text)',
    'public._hs_is_fresh(public.impact_stories)', 'public._hs_is_artifact_state(uuid, text)', 'public._hs_is_status(uuid)',
    'public._hs_is_event(uuid, text, jsonb, text)', 'public._hs_is_dispatch(uuid)', 'public._hs_is_queue(uuid, text, jsonb, text, boolean)',
    'public._hs_is_retry(uuid, text)', 'public._hs_is_followup(uuid, text)', 'public._hs_is_append_only()', 'public._hs_is_version_guard()',
    'public._hs_is_stuck_after(text)', 'public._hs_is_media(uuid)', 'public._hs_is_not_started(public.impact_story_jobs)',
    'public._hs_is_request(uuid, text, text, boolean, text)', 'public._hs_is_choices(uuid)',
    'public._hs_is_fix_batch(uuid)', 'public._hs_is_fix_eligible(uuid)', 'public._hs_is_fix_dispatch(uuid)',
    'public._hs_is_choice_key(uuid)', 'public._hs_is_visuals(uuid)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
  foreach f in array array[
    'public.hs_impact_story_catalog()', 'public.hs_impact_story_list()', 'public.hs_impact_story_get(uuid)',
    'public.hs_impact_story_version(uuid, integer)', 'public.hs_impact_story_create(text, text)', 'public.hs_impact_story_duplicate(uuid)',
    'public.hs_impact_story_archive(uuid, text, boolean)', 'public.hs_impact_story_request(uuid, text, text, boolean)',
    'public.hs_impact_story_job_retry(uuid)', 'public.hs_impact_story_save(uuid, integer, jsonb, text)',
    'public.hs_impact_story_angle(uuid, integer, text, text)', 'public.hs_impact_story_decide(uuid, text, text, integer, text, text)',
    'public.hs_impact_story_section_revision(uuid, integer, text, text)', 'public.hs_impact_story_render(uuid, integer, boolean)',
    'public.hs_impact_story_media_decide(uuid, bigint, text, text, text)', 'public.hs_impact_story_choose_asset(uuid, uuid, text, text)',
    'public.hs_impact_story_fix_start(uuid)', 'public.hs_impact_story_visuals_prepare(uuid, integer, boolean)',
    'public.hs_impact_story_visuals_approve(uuid, bigint, text)', 'public.hs_impact_story_visuals_revoke(uuid, bigint, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['public.hs_impact_story_job_claim(uuid)', 'public.hs_impact_story_job_fail(uuid, text, jsonb)',
                           'public.hs_impact_story_job_complete(uuid, jsonb)', 'public.impact_fix_batches_list()',
                           'public.impact_fix_batch_claim(uuid)', 'public.impact_fix_batch_complete(uuid, jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

commit;
