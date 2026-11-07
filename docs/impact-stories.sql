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
-- Story numbers (founder, 2026-11-06): every story has a sequential number starting at 8000, like the 3000-series video
-- projects. Stories that already exist are numbered 8000.. in the order they were created; new ones take the next number
-- from the sequence. Idempotent: it only numbers rows that have none. A failed insert can leave a gap, never a repeat.
create sequence if not exists public.impact_story_number_seq start with 8000 minvalue 8000;
alter table public.impact_stories add column if not exists story_number integer;
do $$ begin
  if exists (select 1 from public.impact_stories where story_number is null) then
    -- row_number() fixes the order; nextval() in a sorted subquery is not guaranteed to follow the sort.
    update public.impact_stories s set story_number = n.num
      from (select id, (select coalesce(max(story_number), 7999) from public.impact_stories)
                       + row_number() over (order by created_at, id) as num
              from public.impact_stories where story_number is null) n
     where s.id = n.id;
  end if;
  -- The sequence continues after the highest number in use (never repeats one, never goes below 8000).
  perform setval('public.impact_story_number_seq',
    greatest((select coalesce(max(story_number), 7999) from public.impact_stories) + 1,
             (select last_value + case when is_called then 1 else 0 end from public.impact_story_number_seq)), false);
end $$;
alter sequence public.impact_story_number_seq owned by public.impact_stories.story_number;
alter table public.impact_stories alter column story_number set default nextval('public.impact_story_number_seq');
alter table public.impact_stories alter column story_number set not null;
create unique index if not exists impact_stories_story_number_key on public.impact_stories (story_number);
alter table public.impact_stories drop constraint if exists impact_stories_story_number_check;
alter table public.impact_stories add constraint impact_stories_story_number_check check (story_number >= 8000);
revoke all on sequence public.impact_story_number_seq from public, anon, authenticated;
-- Where a story came from (2026-10-27, Hot Topics): 'manual' (the founder created it) or 'auto_discovery' (prepared from
-- a Bluesky-discovered topic whose source pack was verified; docs/impact-discovery.sql). Additive; existing rows are manual.
alter table public.impact_stories add column if not exists origin text not null default 'manual';
alter table public.impact_stories add column if not exists discovery_candidate_id uuid;
alter table public.impact_stories drop constraint if exists impact_stories_origin_check;
alter table public.impact_stories add constraint impact_stories_origin_check check (origin in ('manual', 'auto_discovery'));
-- One verified research pack, several videos (founder, 2026-11-06). A story whose source pack is `<base>--<video>` reuses
-- the verified claims of the story whose pack is `<base>` (homesignal-ingest impact/deliverables.py re-checks the reuse on
-- every build). `research_of` names that ORIGINAL story; the original is never changed by a video built on its research.
-- What each video is FOR is its story type (the draft's discovery.story_type), never a column here. Additive.
alter table public.impact_stories add column if not exists research_of uuid references public.impact_stories(id);
alter table public.impact_stories drop constraint if exists impact_stories_research_of_check;
alter table public.impact_stories add constraint impact_stories_research_of_check check (research_of is null or research_of <> id);
create index if not exists impact_stories_research_of on public.impact_stories (research_of) where research_of is not null;

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
  status        text not null default 'queued',   -- checked below (impact_story_fix_batches_status_check)
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
-- Plan first (founder, 2026-11-05: "is there a way i can write the fixes in the tab and they will be done correctly").
-- Fix no longer edits straight away: plan_queued -> planning (Claude reads the notes and the failed checks and writes,
-- in plain words, what it will change; it edits nothing) -> planned (the page shows the plan) -> the founder confirms
-- the exact plan shown (its md5) -> queued -> working (Claude makes exactly those changes) -> done | needs_you | failed.
-- Cancel on a plan ends the batch as cancelled, and its notes can be sent again.
alter table public.impact_story_fix_batches add column if not exists plan jsonb;
alter table public.impact_story_fix_batches add column if not exists plan_md5 text;
alter table public.impact_story_fix_batches add column if not exists planned_at timestamptz;
alter table public.impact_story_fix_batches add column if not exists confirmed_at timestamptz;
alter table public.impact_story_fix_batches add column if not exists confirmed_by text;
alter table public.impact_story_fix_batches drop constraint if exists impact_story_fix_batches_status_check;
alter table public.impact_story_fix_batches add constraint impact_story_fix_batches_status_check
  check (status in ('plan_queued', 'planning', 'planned', 'queued', 'working', 'done', 'needs_you', 'failed', 'cancelled'));
drop index if exists public.impact_story_fix_batches_one_active;
create unique index impact_story_fix_batches_one_active
  on public.impact_story_fix_batches (story_id) where status in ('plan_queued', 'planning', 'planned', 'queued', 'working');
alter table public.impact_story_fix_batches enable row level security;
revoke all on public.impact_story_fix_batches from public, anon, authenticated;

-- A note on ONE script line (founder, 2026-11-05: "a fix on each narration ... that can accept abstract fixes like look up
-- the EPA legal obligation"). kind 'fix' asks for a change to that line; 'research' asks the fixer to find the official
-- documents first (a statute, a rule, an order, an agency policy), add them to the story's source pack with verbatim
-- quotes, and only then change the line. 'withdraw' takes an earlier note back. Append-only. The id comes from the same
-- sequence as the media fix requests, so one Fix batch can carry both and every outcome names exactly one request.
create table if not exists public.impact_story_line_notes (
  id         bigint primary key default nextval('public.impact_story_media_decisions_id_seq'::regclass),
  story_id   uuid not null references public.impact_stories(id),
  version    integer not null,
  path       text not null check (path ~ '^(main|qol|shorts|packaging)(\.([a-z_]{1,20}|[0-9]{1,3})){1,10}$'),
  line_text  text check (line_text is null or char_length(line_text) <= 2000),
  kind       text not null check (kind in ('fix', 'research', 'withdraw')),
  note       text check (note is null or char_length(note) between 1 and 1000),
  withdraws  bigint references public.impact_story_line_notes(id),
  actor      text not null,
  at         timestamptz not null default now(),
  check ((kind = 'withdraw') = (withdraws is not null)),
  check (kind = 'withdraw' or note is not null)
);
create index if not exists impact_story_line_notes_story on public.impact_story_line_notes (story_id, id);
alter table public.impact_story_line_notes enable row level security;
revoke all on public.impact_story_line_notes from public, anon, authenticated;

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

-- A photo the founder uploaded for one subject of one story (plan v3 §6.3 "Upload owned/cleared photo"). The file is in
-- the private impact-media bucket at <story>/uploads/<id>.jpg|png (written by the dashboard admin's own session, see the
-- storage policy below); this row records it with the founder's permission statement, and a photo choice naming it
-- (upload_id) hands it to the next job. The engine reads it with its own key and checks this sha256 before using it
-- (homesignal-ingest impact/storycraft.py upload_problems, impact/render/assets.py storage_get). Append-only.
create table if not exists public.impact_story_uploads (
  id          uuid primary key,
  story_id    uuid not null references public.impact_stories(id),
  subject_id  text not null check (subject_id ~ '^[a-z0-9:][a-z0-9:-]{1,60}$'),
  path        text not null unique,
  mime        text not null check (mime in ('image/jpeg', 'image/png')),
  bytes       bigint not null check (bytes between 1 and 15728640),
  sha256      text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  credit      text not null check (char_length(btrim(credit)) between 2 and 120),
  shows_site  boolean not null,
  permission  text not null,          -- the statement the founder confirmed, word for word
  actor       text not null,
  at          timestamptz not null default now(),
  check (path = story_id::text || '/uploads/' || id::text || case mime when 'image/png' then '.png' else '.jpg' end)
);
alter table public.impact_story_uploads enable row level security;
revoke all on public.impact_story_uploads from public, anon, authenticated;
-- a choice comes from exactly one place: a job's candidates, or an upload
alter table public.impact_story_asset_choices alter column job_id drop not null;
alter table public.impact_story_asset_choices add column if not exists upload_id uuid references public.impact_story_uploads(id);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'impact_story_asset_choices_one_source') then
    alter table public.impact_story_asset_choices add constraint impact_story_asset_choices_one_source
      check ((job_id is null) <> (upload_id is null));
  end if;
end $$;
-- A SET OF PHOTOS PER SUBJECT (founder, 2026-10-30: "i should be able to click on a bunch of photos i approve and you can
-- select the best fits"). A choice row now adds a photo to its subject's set ('add') or takes it out ('remove'); a photo
-- is in the set while its newest row is 'add', and the engine picks the best fit for each shot from the set. Before
-- this, the newest choice per subject replaced the others. When the column is first added, every photo that the old
-- rule had already replaced gets a 'remove' row, so nothing a founder replaced comes back and each story's set is
-- exactly what it showed before.
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and table_name = 'impact_story_asset_choices' and column_name = 'action') then
    alter table public.impact_story_asset_choices add column action text not null default 'add' check (action in ('add', 'remove'));
    insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, upload_id, entry, actor, action)
    select o.story_id, o.subject_id, o.candidate_id, o.job_id, o.upload_id, o.entry, 'system:photo-set-migration', 'remove'
      from (select distinct on (story_id, subject_id, candidate_id) * from public.impact_story_asset_choices
             order by story_id, subject_id, candidate_id, id desc) o
     where not exists (select 1 from (select distinct on (story_id, subject_id) story_id, subject_id, candidate_id
                                        from public.impact_story_asset_choices order by story_id, subject_id, id desc) n
                        where n.story_id = o.story_id and n.subject_id = o.subject_id and n.candidate_id = o.candidate_id)
     order by o.id;
  end if;
end $$;

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

-- A photo the founder rejected for one story in the Visuals step (2026-10-30). Append-only: the newest row per photo
-- says whether it is rejected or restored. Rejected photos are frozen into the next visuals/render job's input
-- (rejected_photos); the engine never shows them in that story and searches new candidates for their subjects,
-- leaving the rejected file out. entry: the photo as the manifest recorded it (id, title, file_url, sha256) plus the
-- subjects its shots were about.
create table if not exists public.impact_story_photo_rejections (
  id           bigint generated always as identity primary key,
  story_id     uuid not null references public.impact_stories(id),
  photo_id     text not null check (char_length(photo_id) between 1 and 160),
  decision     text not null check (decision in ('rejected', 'restored')),
  manifest_id  bigint references public.impact_story_visual_manifests(id),
  entry        jsonb not null check (jsonb_typeof(entry) = 'object'),
  note         text check (note is null or char_length(note) <= 1000),
  actor        text not null,
  at           timestamptz not null default now()
);
alter table public.impact_story_photo_rejections enable row level security;
revoke all on public.impact_story_photo_rejections from public, anon, authenticated;

-- "Not about this story" (founder, 2026-11-07: "the article does not matter but there is no button to disregard it and
-- continue"). The latest-development check (homesignal-ingest impact/currency.py) names every newer event with a key
-- (event_key: where it was seen, its kind and its own words). The founder can set an event aside; its key is then sent
-- with every later job's story (impact_story_job_claim: currency_dismissed) and the check lists it as dismissed instead
-- of blocking. Only a key a failed job of this story reported can be dismissed. Anything new or different gets a new
-- key and still blocks. Append-only; the newest row per key decides.
create table if not exists public.impact_story_currency_dismissals (
  id        bigint generated always as identity primary key,
  story_id  uuid not null references public.impact_stories(id),
  event_key text not null check (event_key ~ '^[0-9a-f]{16}$'),
  decision  text not null check (decision in ('dismissed', 'restored')),
  event     jsonb not null check (jsonb_typeof(event) = 'object'),
  job_id    uuid,
  actor     text not null,
  at        timestamptz not null default now()
);
alter table public.impact_story_currency_dismissals enable row level security;
revoke all on public.impact_story_currency_dismissals from public, anon, authenticated;

-- The founder's decision on ONE shot of one set of previews (2026-10-30, "an approve, reject, need new photo, under
-- every picture"). Append-only and tied to the manifest and its hash, like the media decisions; the newest row per
-- shot of the current previews is the one that counts. approved: accepted. rejected: not acceptable (a shot showing a
-- photo also rejects that photo for the story; any other shot blocks Approve all until the previews are prepared
-- again). new_photo: search new licensed photos for the shot's subject on the next Prepare.
create table if not exists public.impact_story_shot_decisions (
  id             bigint generated always as identity primary key,
  story_id       uuid not null references public.impact_stories(id),
  manifest_id    bigint not null references public.impact_story_visual_manifests(id),
  manifest_hash  text not null,
  asset          text not null check (asset in ('main', 'short_a', 'short_b', 'thumbnail')),
  shot_id        text not null check (char_length(shot_id) between 1 and 80),
  decision       text not null check (decision in ('approved', 'rejected', 'new_photo')),
  subject_id     text,
  photo_id       text,
  note           text check (note is null or char_length(note) <= 1000),
  actor          text not null,
  at             timestamptz not null default now()
);
alter table public.impact_story_shot_decisions enable row level security;
revoke all on public.impact_story_shot_decisions from public, anon, authenticated;

-- The private bucket. Readable only by dashboard admins (the same helper Tab 16's bucket uses); written only by the
-- worker's service role, apart from a dashboard admin's photo uploads (impact_media_admin_upload below).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('impact-media', 'impact-media', false, 262144000, array['video/mp4', 'image/png', 'text/plain', 'application/json', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists impact_media_admin_read on storage.objects;
create policy impact_media_admin_read on storage.objects
  for select to authenticated using (bucket_id = 'impact-media' and public.hs_is_dashboard_admin());
-- The one thing a browser session may write: a dashboard admin's photo upload, only into a story's uploads folder, only
-- as a new .jpg or .png (no update or delete policy, so an upload is never replaced). It is used only once
-- hs_impact_story_upload_photo has recorded it, with its checksum and the founder's permission statement.
drop policy if exists impact_media_admin_upload on storage.objects;
create policy impact_media_admin_upload on storage.objects
  for insert to authenticated with check (bucket_id = 'impact-media' and public.hs_is_dashboard_admin()
    and name ~ '^[0-9a-f-]{36}/uploads/[0-9a-f-]{36}\.(jpg|png)$');

-- CREATOR-DIRECTED STORIES (founder brief 2026-11-06, "Build creator-directed Impact Stories"). A story is made in one of
-- two modes: 'jody' (JODY researches and writes it; everything above) or 'creator' (the founder supplies the script scene
-- by scene; homesignal-ingest impact/creator.py). In creator mode the founder's words are LOCKED: research fact-checks
-- them and FLAGS problems with a suggested replacement, but never changes them. The words change only through the
-- founder's own revision (a row below), which travels to the engine as a Fix request of kind 'creator_script' and comes
-- back as a new version. The one narrative approval ("Approve & Lock Script") covers the script; it is refused while a
-- high-risk flag is open, a low-risk flag is undecided, or a revision is waiting (_hs_is_creator_state).
alter table public.impact_stories add column if not exists creation_mode text not null default 'jody';
alter table public.impact_stories drop constraint if exists impact_stories_creation_mode_check;
alter table public.impact_stories add constraint impact_stories_creation_mode_check check (creation_mode in ('jody', 'creator'));

-- Every version of the founder's script: the original (copied from the topic when the story is created), each revision
-- they propose (their own edits, or a suggestion they accepted), and withdrawals. Append-only. The id comes from the
-- same sequence as the fix requests, so a revision can be one request in a Fix batch.
create table if not exists public.impact_story_creator_scripts (
  id          bigint primary key default nextval('public.impact_story_media_decisions_id_seq'::regclass),
  story_id    uuid not null references public.impact_stories(id),
  kind        text not null check (kind in ('original', 'revision', 'withdraw')),
  script      jsonb,
  script_hash text check (script_hash is null or script_hash ~ '^[0-9a-f]{32}$'),
  based_on    text,                        -- the script version this revision was made from
  source      text check (source is null or source in ('topic', 'edit', 'accept_suggestion')),
  note        text check (note is null or char_length(note) <= 1000),
  withdraws   bigint references public.impact_story_creator_scripts(id),
  actor       text not null,
  at          timestamptz not null default now(),
  check ((kind = 'withdraw') = (withdraws is not null)),
  check (kind = 'withdraw' or (script is not null and script_hash is not null))
);
create index if not exists impact_story_creator_scripts_story on public.impact_story_creator_scripts (story_id, id);
alter table public.impact_story_creator_scripts enable row level security;
revoke all on public.impact_story_creator_scripts from public, anon, authenticated;

-- The founder's decision on one fact-check flag of one script version: 'keep' (keep my words; low-risk flags only) or
-- 'accept' (the suggestion went into a revision). Keyed by the engine's flag key (impact/creator.py _item_key), so a
-- decision never carries over to a different sentence, verdict, suggestion or script version. Append-only.
create table if not exists public.impact_story_creator_flag_decisions (
  id          bigint generated always as identity primary key,
  story_id    uuid not null references public.impact_stories(id),
  script_hash text not null check (script_hash ~ '^[0-9a-f]{32}$'),
  flag_key    text not null check (flag_key ~ '^[0-9a-f]{32}$'),
  decision    text not null check (decision in ('keep', 'accept')),
  note        text check (note is null or char_length(note) <= 1000),
  actor       text not null,
  at          timestamptz not null default now()
);
create index if not exists impact_story_creator_flag_decisions_story on public.impact_story_creator_flag_decisions (story_id, script_hash);
alter table public.impact_story_creator_flag_decisions enable row level security;
revoke all on public.impact_story_creator_flag_decisions from public, anon, authenticated;

-- Append-only: approvals and events are evidence, never edited.
create or replace function public._hs_is_append_only() returns trigger language plpgsql as $$
begin raise exception 'impact story % rows are append-only', tg_table_name using errcode = '42501'; end $$;
drop trigger if exists impact_story_approvals_append_only on public.impact_story_approvals;
create trigger impact_story_approvals_append_only before update or delete on public.impact_story_approvals
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_uploads_append_only on public.impact_story_uploads;
create trigger impact_story_uploads_append_only before update or delete on public.impact_story_uploads
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_shot_decisions_append_only on public.impact_story_shot_decisions;
create trigger impact_story_shot_decisions_append_only before update or delete on public.impact_story_shot_decisions
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_currency_dismissals_append_only on public.impact_story_currency_dismissals;
create trigger impact_story_currency_dismissals_append_only before update or delete on public.impact_story_currency_dismissals
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_photo_rejections_append_only on public.impact_story_photo_rejections;
create trigger impact_story_photo_rejections_append_only before update or delete on public.impact_story_photo_rejections
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
drop trigger if exists impact_story_line_notes_append_only on public.impact_story_line_notes;
create trigger impact_story_line_notes_append_only before update or delete on public.impact_story_line_notes
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_creator_scripts_append_only on public.impact_story_creator_scripts;
create trigger impact_story_creator_scripts_append_only before update or delete on public.impact_story_creator_scripts
  for each row execute function public._hs_is_append_only();
drop trigger if exists impact_story_creator_flag_decisions_append_only on public.impact_story_creator_flag_decisions;
create trigger impact_story_creator_flag_decisions_append_only before update or delete on public.impact_story_creator_flag_decisions
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

-- ── creator-directed stories: the script contract (mirrors homesignal-ingest impact/creator.py and lib/creator-script.js) ──
-- The script version: md5 of every scene's n, stage, stage_label, headline and narration, fields joined by U+001F and
-- scenes by U+001E. impact/creator.py script_hash builds the same string, so the engine and the database name a version
-- the same way.
create or replace function public._hs_is_creator_hash(p jsonb)
returns text language sql immutable as $$
  select md5(coalesce(string_agg(coalesce(s->>'n', '') || chr(31) || coalesce(s->>'stage', '') || chr(31)
           || coalesce(s->>'stage_label', '') || chr(31) || coalesce(s->>'headline', '') || chr(31) || coalesce(s->>'narration', ''),
           chr(30) order by o), ''))
    from jsonb_array_elements(case when jsonb_typeof(p->'scenes') = 'array' then p->'scenes' else '[]'::jsonb end) with ordinality x(s, o)
$$;

-- The contract's refusals in plain words (empty = usable). Mirrors impact/creator.py problems().
create or replace function public._hs_is_creator_problems(p jsonb)
returns text[] language plpgsql immutable as $$
declare out text[] := '{}'; s jsonb; i int := 0; tot int := 0; k text; u jsonb; v text; ws text := E' \t\n\r\x0b\x0c';
begin
  if p is null or jsonb_typeof(p) <> 'object' then return array['the creator script is not an object']; end if;
  if p->>'format' is distinct from 'creator-script/1' then out := out || 'the creator script''s format must be creator-script/1'::text; end if;
  if coalesce(jsonb_typeof(p->'target_seconds'), 'null') <> 'null' and (jsonb_typeof(p->'target_seconds') <> 'number'
     or (p->>'target_seconds') !~ '^[0-9]{1,6}$' or (p->>'target_seconds')::int not between 10 and 3600) then
    out := out || 'the target duration must be 10 to 3600 seconds'::text;
  end if;
  if char_length(coalesce(p->>'raw', '')) > 200000 then out := out || 'the pasted storyboard is longer than 200000 characters'::text; end if;
  if coalesce(jsonb_typeof(p->'scenes'), 'null') <> 'array' or jsonb_array_length(p->'scenes') = 0 then
    return out || 'the creator script has no scenes'::text;
  end if;
  if jsonb_array_length(p->'scenes') > 60 then out := out || format('at most 60 scenes (has %s)', jsonb_array_length(p->'scenes')); end if;
  for s in select x from jsonb_array_elements(p->'scenes') x loop
    i := i + 1;
    if jsonb_typeof(s) <> 'object' then out := out || format('Scene %s is not an object', i); continue; end if;
    if (s->>'n') is distinct from i::text or jsonb_typeof(s->'n') <> 'number' then
      out := out || format('Scene %s is numbered %s; scenes are numbered 1, 2, 3 ... in order', i, coalesce(s->>'n', 'nothing'));
    end if;
    if coalesce(s->>'stage', '') not in ('fear', 'anger', 'motivation', 'custom') then
      out := out || format('Scene %s: the emotional stage must be fear, anger, motivation or custom', i);
    end if;
    if s->>'stage' = 'custom' and char_length(coalesce(s->>'stage_label', '')) not between 1 and 60 then
      out := out || format('Scene %s: name the custom stage (1 to 60 characters)', i);
    end if;
    if coalesce(s->>'stage', '') <> 'custom' and coalesce(s->>'stage_label', '') <> '' then
      out := out || format('Scene %s: only a custom stage has a name', i);
    end if;
    if coalesce(jsonb_typeof(s->'seconds'), 'null') <> 'null' and ((s->>'seconds') !~ '^[0-9]{1,6}$' or (s->>'seconds')::int not between 1 and 600) then
      out := out || format('Scene %s: the duration must be 1 to 600 seconds', i);
    end if;
    if coalesce(btrim(s->>'narration', ws), '') = '' then out := out || format('Scene %s has no narration', i); end if;
    if char_length(coalesce(s->>'narration', '')) > 5000 then out := out || format('Scene %s: the narration is longer than 5000 characters', i); end if;
    if char_length(coalesce(s->>'headline', '')) > 300 then out := out || format('Scene %s: the headline is longer than 300 characters', i); end if;
    foreach k in array array['visual', 'audio'] loop
      if char_length(coalesce(s->>k, '')) > 2000 then out := out || format('Scene %s: the %s direction is longer than 2000 characters', i, k); end if;
    end loop;
    foreach k in array array['headline', 'narration', 'visual', 'audio', 'stage_label'] loop
      if coalesce(jsonb_typeof(s->k), 'null') not in ('null', 'string') then
        out := out || format('Scene %s: %s must be text', i, k);
      elsif jsonb_typeof(s->k) = 'string' then
        v := s->>k;
        if v <> btrim(v, ws) or position(chr(13) in v) > 0 then
          out := out || format('Scene %s: %s is not stored in its clean form (outer spaces or CR)', i, k);
        end if;
      end if;
    end loop;
    if coalesce(jsonb_typeof(s->'sources'), 'null') not in ('null', 'array') or jsonb_array_length(coalesce(nullif(s->'sources', 'null'::jsonb), '[]')) > 10 then
      out := out || format('Scene %s: at most 10 source links', i);
    else
      for u in select x from jsonb_array_elements(coalesce(nullif(s->'sources', 'null'::jsonb), '[]')) x loop
        if jsonb_typeof(u) <> 'string' or (u #>> '{}') !~* '^https?://[^\s/?#]+\.[^\s/?#]+(/\S*)?$' or char_length(u #>> '{}') > 1000 then
          out := out || format('Scene %s: %s is not a web link', i, left(u #>> '{}', 80));
        end if;
      end loop;
    end if;
    tot := tot + char_length(coalesce(s->>'narration', ''));
  end loop;
  if tot > 60000 then out := out || format('the narration totals %s characters (at most 60000)', tot); end if;
  return out;
end $$;

-- Raises the first problems in one readable message, or returns the script's version hash.
create or replace function public._hs_is_creator_require(p jsonb)
returns text language plpgsql immutable as $$
declare pr text[] := public._hs_is_creator_problems(p);
begin
  if cardinality(pr) > 0 then
    raise exception 'Your script cannot be saved: %', array_to_string(pr[1:5], '; ') using errcode = '22023';
  end if;
  return public._hs_is_creator_hash(p);
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
         -- a creator-directed story: the founder's script and its fact-check are part of what is approved (and locked)
         || case when coalesce(p_body->'creator_script', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('creator_script', p_body->'creator_script') else '{}'::jsonb end
         || case when coalesce(p_body->'creator_review', 'null'::jsonb) <> 'null'::jsonb then jsonb_build_object('creator_review', p_body->'creator_review') else '{}'::jsonb end
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
        h text; chk jsonb; st text; why text; cg jsonb;
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
  -- a creator-directed story: "Approve & Lock Script" needs every flag on the founder's words resolved and no revision waiting
  if p_artifact = 'narrative' and st = 'pending' and s.creation_mode = 'creator' then
    cg := public._hs_is_creator_state(p_story);
    if not coalesce((cg->>'ok')::boolean, false) then st := 'blocked'; why := cg->>'why'; end if;
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
  select * from (select distinct on (subject_id, candidate_id) * from public.impact_story_asset_choices where story_id = p_story
                  order by subject_id, candidate_id, id desc) c
   where c.action = 'add' order by c.subject_id, c.candidate_id
$$;

create or replace function public._hs_is_media(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare na jsonb := public._hs_is_artifact_state(p_story, 'narrative'); j public.impact_story_jobs%rowtype;
        files jsonb := '[]'::jsonb; r record; d public.impact_story_media_decisions%rowtype; st text; why text;
        cur boolean; n int := 0; nok int := 0; b public.impact_story_jobs%rowtype; blocked jsonb; choices jsonb; fixes jsonb;
        vs jsonb := public._hs_is_visuals(p_story); stale_reason text; hum boolean;
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
           'page_url', c.entry->>'page_url', 'source', coalesce(c.entry->>'source', 'commons'), 'upload_id', c.upload_id,
           'actor', c.actor, 'at', c.at) order by c.subject_id), '[]'::jsonb)
    into choices from public._hs_is_choices(p_story) c;
  if j.id is null then
    return jsonb_build_object('render_job', null, 'current', false, 'complete', false, 'files', '[]'::jsonb,
      'blocked', blocked, 'choices', choices, 'fix_requests', fixes, 'fix_batch', public._hs_is_fix_batch(p_story));
  end if;
  -- Videos are current only when they were made from BOTH the approved narrative AND the approved picture set (UI audit
  -- 2026-11-03: Stratos was rendered Oct 29, its pictures approved Nov 2, and the page still sent the founder to review the
  -- old videos). The render job records the picture set it used (input.visual_manifest.hash, hs_impact_story_render).
  stale_reason := case
    when not (na->>'state' = 'approved' and j.input->>'narrative_hash' = na->>'hash') then 'narrative'
    when not (vs->>'state' = 'approved' and j.input#>>'{visual_manifest,hash}' is not distinct from vs->>'manifest_hash'
              and j.input#>>'{visual_manifest,hash}' is not null) then 'pictures'
    end;
  cur := stale_reason is null;
  -- The background hum was removed from the engine on 2026-10-30 17:31:56Z (homesignal-ingest #980). A render job that
  -- started before then checked out the old code, so its videos still carry the hum (founder: never hum).
  hum := coalesce(j.started_at, j.created_at) < timestamptz '2026-10-30 17:31:56+00';
  for r in select * from public.impact_story_assets where job_id = j.id
           order by array_position(array['main', 'short_a', 'short_b', 'thumbnail'], asset) loop
    select * into d from public.impact_story_media_decisions where asset_id = r.id order by id desc limit 1;
    if not cur then st := 'stale';
      why := case stale_reason when 'pictures' then 'Made before you approved the current pictures. Render the videos again.'
                               else 'Made from an earlier script. Render the videos again.' end;
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
      'created_at', r.created_at, 'state', st, 'why', why, 'hum', hum and r.asset <> 'thumbnail',
      'last_decision', case when d.id is null then null else jsonb_build_object('decision', d.decision, 'note', d.note,
        'timecode', d.timecode, 'actor', d.actor, 'at', d.at) end);
  end loop;
  return jsonb_build_object('render_job', j.id, 'rendered_at', j.completed_at, 'version', j.base_version,
    'renderer', j.input->>'renderer', 'current', cur, 'stale_reason', stale_reason, 'hum', hum,
    'complete', cur and n > 0 and nok = n, 'files', files,
    'quality', j.result->'quality', 'currency', j.result->'currency', 'blocked', blocked, 'choices', choices,
    'fix_requests', fixes, 'fix_batch', public._hs_is_fix_batch(p_story));
end $$;

-- Where the story is, and the ONE next action (v2.4 J: one clearly labelled primary action).
create or replace function public._hs_is_status(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; j public.impact_story_jobs%rowtype;
        arts jsonb := '{}'::jsonb; k text; stage text; nxt text; lib text; all_ok boolean := true; m jsonb; vs jsonb;
        owner text := 'you'; cs jsonb; fb jsonb; npend int := 0; nblk int := 0; nunsent int := 0; pend_names text;
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
  elsif not all_ok then
    stage := 'script'; lib := 'needs_review';
    -- a blocked script cannot be approved (the button is off), so the next step is to fix it, never to approve it
    -- (founder, 2026-11-06: an Approve that did nothing while the step said "approve").
    nxt := case when arts->'narrative'->>'state' = 'blocked'
                then 'Fix the script first: the checks found problems, listed under Integrated narrative. Write what to change with "Fix this line", then press Fix. Approve turns on once the script passes.'
                else 'Review and approve the integrated narrative' end;
    if s.creation_mode = 'creator' then   -- a creator-directed story: the founder's script comes first
      cs := public._hs_is_creator_state(p_story);
      nxt := case when cs->'pending'->>'status' = 'proposed' then 'Send your revised script with Fix'
                  when cs->'pending'->>'status' in ('sending', 'applying') then 'Applying your revised script…'
                  when (cs->>'high')::int > 0 or (cs->>'low_open')::int > 0 then 'Review the flags on your script'
                  when (cs->>'ok')::boolean then 'Approve & lock your script'
                  else 'Review your script' end;
      if cs->'pending'->>'status' in ('sending', 'applying') then owner := 'working'; end if;
    end if;
  else
    m := public._hs_is_media(p_story);
    vs := public._hs_is_visuals(p_story);
    if (m->>'complete')::boolean then stage := 'distribution'; nxt := 'Ready to export. Publishing is not built yet.'; lib := 'ready'; owner := 'done';
    elsif (m->>'current')::boolean then stage := 'media'; lib := 'needs_review';
      -- The next step follows what the founder already did here (founder, 2026-11-07: "the update in needs you needs to be
      -- automatic once i review and complete an action"). It used to say "Review each video and the thumbnail" whatever
      -- had been approved, rejected or sent, so a finished review looked like nothing had happened.
      fb := m->'fix_batch';
      select count(*) filter (where f->>'state' = 'pending'),
             count(*) filter (where f->>'state' = 'blocked' and f->'last_decision' is null),
             string_agg(case when f->>'state' = 'pending' then case f->>'asset' when 'main' then 'main video' when 'short_a' then 'Short A'
                          when 'short_b' then 'Short B' else f->>'asset' end end, ', ')
        into npend, nblk, pend_names from jsonb_array_elements(coalesce(m->'files', '[]'::jsonb)) f;
      -- fix requests saved but not sent: a rejection nothing has acted on, in no batch (or in one that was cancelled or failed)
      select count(*) into nunsent from jsonb_array_elements(coalesce(m->'fix_requests', '[]'::jsonb)) x
       where x->>'status' = 'open' and coalesce(x->>'note', '') !~* '\mhum(ming)?\M'
         and (x->'batch' is null or jsonb_typeof(x->'batch') = 'null' or x->'batch'->>'status' in ('cancelled', 'failed'));
      if (fb->>'auto')::boolean and fb->>'status' in ('plan_queued', 'planning', 'planned', 'queued', 'working') then
        -- videos that failed the checks are being fixed by the system (_hs_is_auto_fix): nothing to watch yet
        owner := 'working'; nxt := 'Fixing the videos that failed the checks, before you review them…';
      elsif fb->>'status' = 'planned' then
        nxt := 'Read Claude''s fix plan in Media review, then press Confirm. Nothing changes until you do.';
      elsif fb->>'status' in ('plan_queued', 'planning') then
        owner := 'working'; nxt := 'Claude is reading your fix requests and writing a plan (a few minutes). Nothing changes until you confirm it.';
      elsif fb->>'status' in ('queued', 'working') then
        owner := 'working'; nxt := 'Claude is making the fixes you confirmed. When it finishes, this says what to do next.';
      elsif fb->>'status' = 'needs_you' then
        nxt := coalesce(fb->>'next_step', 'The fixer needs something from you: see Media review');
      elsif fb->>'status' = 'stalled' then
        nxt := 'The fix run stopped before it finished. Press Fix in Media review to send your requests again.';
      elsif nunsent > 0 then
        nxt := 'Send your ' || nunsent || ' fix request' || case when nunsent = 1 then '' else 's' end || ' with Fix in Media review';
      elsif npend > 0 then
        nxt := 'Review ' || case when npend = 1 then 'the ' else 'these: ' end || pend_names;
      elsif nblk > 0 then
        nxt := nblk || ' video' || case when nblk = 1 then '' else 's' end || ' failed the checks. Save a fix request in Media review, then press Fix';
      else
        nxt := coalesce(case when fb->>'status' = 'done' then fb->>'next_step' end, 'Review each video and the thumbnail');
      end if;
    elsif vs->>'state' = 'approved' then stage := 'media'; nxt := 'Render the videos'; lib := 'needs_review';
    else
      stage := 'visuals'; lib := 'needs_review';
      nxt := case vs->>'state' when 'ready' then 'Review the visuals, then Approve all visuals'
                                when 'needs_fixes' then 'Replace the blocked pictures, then prepare the visuals again'
                                when 'preparing' then 'Preparing the preview stills…'
                                else 'Prepare the visuals' end;
    end if;
  end if;
  if stage = 'archived' then owner := 'archived'; end if;
  if j.status in ('queued', 'running') and public._hs_is_not_started(j) is not null then
    nxt := 'The job did not start. Press Retry.'; owner := 'you';
  elsif j.status in ('queued', 'running') then
    owner := 'working';
    if j.kind = 'render' then lib := 'rendering'; end if;
    nxt := case j.kind when 'pack' then 'Checking sources…' when 'analyze' then 'Analyzing…' when 'generate' then 'Writing the story…'
                       when 'render' then 'Rendering the videos (about 1 to 3 hours)…'
                       when 'visuals' then 'Preparing the preview stills (about 10 to 20 minutes)…' else 'Running checks…' end;
  end if;
  -- owner: whose turn it is (UI audit 2026-11-03), so the page can say "Your next step", "Working on it" or "Done".
  return jsonb_build_object('stage', stage, 'next', nxt, 'library', lib, 'owner', owner, 'artifacts', arts,
    'fresh', public._hs_is_fresh(s), 'job', case when j.id is null then null else jsonb_build_object(
      'id', j.id, 'kind', j.kind, 'status', j.status, 'error', coalesce(j.error, public._hs_is_not_started(j)), 'attempts', j.attempts,
      'created_at', j.created_at, 'started_at', j.started_at, 'completed_at', j.completed_at,
      'not_started', public._hs_is_not_started(j) is not null,
      'visuals_changed', public._hs_is_visuals_changed(j.kind, j.status, j.result, j.error),
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

-- A render that stopped because the approved pictures no longer match what the engine plans (homesignal-ingest
-- build.VisualsChanged). Read from the engine's result code; renders failed before the code existed are read from the
-- engine's own two sentences. A retry cannot fix it; preparing the visuals again can.
create or replace function public._hs_is_visuals_changed(p_kind text, p_status text, p_result jsonb, p_error text)
returns boolean language sql immutable set search_path = public as $$
  select coalesce(p_kind = 'render' and p_status = 'failed'
     and (p_result->>'code' = 'visuals_changed'
          or (p_result is null and (p_error like 'The story''s pictures changed since you approved them%'
                                    or p_error like 'A photo you approved can no longer be used:%'))), false)
$$;

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
  if public._hs_is_visuals_changed(j.kind, j.status, j.result, j.error) then
    raise exception 'This render stopped because the pictures changed since you approved them. Prepare the visuals again and approve them; a retry would stop the same way.' using errcode = '55000';
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

-- A story's type: what its current draft declares (discovery.story_type, the engine's one record of it), else what its
-- topic resolved to (impact-discovery.sql _hs_id_story_type, read at run time), else investigative (every story written
-- before story types existed).
create or replace function public._hs_is_story_type(p_story uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare t text;
begin
  select v.body->'discovery'->>'story_type' into t from public.impact_stories s
    join public.impact_story_versions v on v.story_id = s.id and v.version = s.current_version where s.id = p_story;
  if t in ('investigative', 'public_policy', 'participation') then return t; end if;
  begin   -- the topic's resolved type, when impact-discovery.sql is applied (it is applied after this file)
    execute 'select public._hs_id_story_type(c.story_type, c.title, c.submitted_note)
               from public.impact_discovery_candidates c where c.story_id = $1 limit 1' into t using p_story;
  exception when undefined_table or undefined_function or undefined_column then t := null;
  end;
  if t in ('investigative', 'public_policy', 'participation') then return t; end if;
  return 'investigative';
end $$;

-- A participation story's deadline, as its draft states it from a cited record (discovery.action.deadline.date, checked by
-- homesignal-ingest impact/participation.py). Null for any other story, or when the draft does not state one.
create or replace function public._hs_is_record_deadline(p_story uuid)
returns date language plpgsql stable security definer set search_path = public as $$
declare d text;
begin
  if public._hs_is_story_type(p_story) <> 'participation' then return null; end if;
  select v.body->'discovery'->'action'->'deadline'->>'date' into d from public.impact_stories s
    join public.impact_story_versions v on v.story_id = s.id and v.version = s.current_version where s.id = p_story;
  if d is null or d !~ '^\d{4}-\d{2}-\d{2}$' then return null; end if;
  return d::date;
exception when others then return null;
end $$;

create or replace function public.hs_impact_story_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public._hs_is_admin();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', s.id, 'story_number', s.story_number, 'title', s.title, 'place', s.place, 'video_slug', s.video_slug, 'primary_emotion', s.primary_emotion,
      'current_version', s.current_version, 'updated_at', s.updated_at, 'archived', s.archived_at is not null,
      'verified_at', s.pack->>'verified_at', 'status', public._hs_is_status(s.id),
      'origin', s.origin, 'discovery_candidate_id', s.discovery_candidate_id,
      'story_type', x.story_type, 'deadline', x.deadline, 'research_of', s.research_of,
      'research_title', (select r.title from public.impact_stories r where r.id = s.research_of))
      -- a participation story whose record-stated deadline is in the next 21 days comes first (founder, 2026-11-06)
      order by case when s.archived_at is null and x.deadline between current_date and current_date + 21 then x.deadline end nulls last,
               s.updated_at desc)
    from public.impact_stories s
    cross join lateral (select public._hs_is_story_type(s.id) story_type, public._hs_is_record_deadline(s.id) deadline) x), '[]'::jsonb);
end $$;

-- The videos that share one verified research pack: the original story and every story built on it, each with its type.
create or replace function public._hs_is_research_videos(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  with root as (select coalesce(s.research_of, s.id) id from public.impact_stories s where s.id = p_story)
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'title', s.title, 'video_slug', s.video_slug,
           'story_type', public._hs_is_story_type(s.id), 'deadline', public._hs_is_record_deadline(s.id),
           'original', s.research_of is null, 'archived', s.archived_at is not null, 'current', s.id = p_story,
           'next', public._hs_is_status(s.id)->>'next')
           order by (s.research_of is null) desc, s.created_at), '[]'::jsonb)
    from public.impact_stories s, root where s.id = root.id or s.research_of = root.id
$$;

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
    'visuals', public._hs_is_visuals(p_story), 'line_notes', public._hs_is_line_notes(p_story),
    -- every video built on the same verified research (the original first), each with its own type and status
    'research_videos', public._hs_is_research_videos(p_story),
    'creator', public._hs_is_creator_state(p_story),
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
  insert into public.impact_stories (video_slug, title, place, duplicated_from, created_by, research_of)
  values (o.video_slug, left('Copy of ' || o.title, 200), o.place, o.id, e, o.research_of) returning * into s;
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

-- The photos a story has rejected right now: the newest row per photo, when it says rejected.
create or replace function public._hs_is_rejections(p_story uuid)
returns setof public.impact_story_photo_rejections language sql stable security definer set search_path = public as $$
  select * from (select distinct on (photo_id) * from public.impact_story_photo_rejections where story_id = p_story
                  order by photo_id, id desc) r
   where r.decision = 'rejected'
$$;

-- The photo choices and rejections of a story and their key. With no rejection the key is the same md5 the render key
-- has always carried, so previews made before rejections existed stay current.
create or replace function public._hs_is_choice_key(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'choices', coalesce((select jsonb_agg(jsonb_build_object('subject_id', c.subject_id, 'candidate_id', c.candidate_id, 'entry', c.entry)
                 order by c.subject_id, c.candidate_id) from public._hs_is_choices(p_story) c), '[]'::jsonb),
    'rejected', coalesce((select jsonb_agg(r.entry || jsonb_build_object('id', r.photo_id, 'rejected_at', r.at)
                 order by r.photo_id) from public._hs_is_rejections(p_story) r), '[]'::jsonb),
    'key', md5(coalesce((select string_agg(c.subject_id || '=' || c.candidate_id, ',' order by c.subject_id collate "C", c.candidate_id collate "C")
                           from public._hs_is_choices(p_story) c), '')
            || coalesce((select '|rejected:' || string_agg(r.photo_id, ',' order by r.photo_id collate "C")
                           from public._hs_is_rejections(p_story) r), '')))
$$;

-- The newest decision per shot of one set of previews.
create or replace function public._hs_is_shot_decisions(p_manifest bigint)
returns setof public.impact_story_shot_decisions language sql stable security definer set search_path = public as $$
  select distinct on (asset, shot_id) * from public.impact_story_shot_decisions where manifest_id = p_manifest
   order by asset, shot_id, id desc
$$;

-- What a viewer of one shot sees, as one fingerprint: the photo (its file checksum, else its id), the layout, the text
-- and map on screen, the cited records, and any drawing or missing-photo note. Narration and timing are left out: they
-- do not change the picture. Two previews of a shot with the same fingerprint show the same picture.
create or replace function public._hs_is_shot_print(p_shot jsonb)
returns text language sql immutable set search_path = public as $$
  select md5(jsonb_build_object(
    'photo', coalesce(p_shot->'photo'->'record'->>'sha256', p_shot->'photo'->>'id'),
    'layout', p_shot->'layout', 'onscreen', p_shot->'onscreen', 'map', p_shot->'map', 'label', p_shot->'label',
    'claims', p_shot->'claims', 'illustration', p_shot->'illustration', 'photo_needed', p_shot->'photo_needed',
    'subject_ref', p_shot->'subject_ref')::text)
$$;

-- Where the story's visuals stand: none | preparing | blocked | failed | stale | needs_fixes | ready | approved.
-- The CURRENT manifest is the newest one, and it counts only while the narrative it was made from is the approved one,
-- the sources are the same, the photo choices are the same and the renderer is the same.
create or replace function public._hs_is_visuals(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; na jsonb := public._hs_is_artifact_state(p_story, 'narrative');
        ck jsonb := public._hs_is_choice_key(p_story); m public.impact_story_visual_manifests%rowtype;
        ev public.impact_story_visual_events%rowtype; vj public.impact_story_jobs%rowtype; st text; why text; cur boolean := false;
        nblk int := 0; blocked jsonb; nrej int := 0; sd jsonb := '[]'::jsonb; more jsonb := '[]'::jsonb; ndrawn int := 0;
        reqs jsonb := '[]'::jsonb; npend int := 0;
        carried jsonb := '[]'::jsonb; cur_shots jsonb; cur_id bigint; changed boolean := false;
begin
  select * into s from public.impact_stories where id = p_story;
  select * into vj from public.impact_story_jobs where story_id = p_story and kind = 'visuals' order by created_at desc limit 1;
  select * into m from public.impact_story_visual_manifests where story_id = p_story order by id desc limit 1;
  if m.id is not null then
    cur := na->>'state' = 'approved' and m.narrative_hash = na->>'hash' and m.pack_hash is not distinct from s.pack_hash
           and m.choices_key = ck->>'key' and m.renderer = 'impact-render-3';
    -- No drawings, ever (founder, 2026-10-30): previews that still carry a drawn shot were made before the engine stopped
    -- drawing, so they are out of date and must be prepared again. Never approvable, whatever their stored status says.
    select count(*) into ndrawn from jsonb_each(coalesce(m.manifest->'assets', '{}'::jsonb)) a,
           jsonb_array_elements(coalesce(a.value->'shots', '[]'::jsonb)) sh
     where coalesce(sh->'illustration', 'null'::jsonb) <> 'null'::jsonb;
    cur := cur and ndrawn = 0;
    -- The newest render of these previews stopped because the engine now plans different pictures (code merged since
    -- the approval, 2026-11-06): these previews no longer describe what a render would show. Prepare them again.
    changed := exists (select 1 from public.impact_story_jobs r where r.id = (
                 select r2.id from public.impact_story_jobs r2 where r2.story_id = p_story and r2.kind = 'render'
                  order by r2.created_at desc limit 1)
               and public._hs_is_visuals_changed(r.kind, r.status, r.result, r.error)
               and r.input->'visual_manifest'->>'manifest_id' = m.id::text);
    cur := cur and not changed;
    select * into ev from public.impact_story_visual_events where manifest_id = m.id order by id desc limit 1;
    nblk := coalesce((m.counts->>'blocked')::int, 0);
    cur_shots := coalesce(m.manifest->'assets', '{}'::jsonb); cur_id := m.id;
    select coalesce(jsonb_agg(jsonb_build_object('asset', d.asset, 'shot_id', d.shot_id, 'decision', d.decision,
             'subject_id', d.subject_id, 'photo_id', d.photo_id, 'note', d.note, 'actor', d.actor, 'at', d.at) order by d.asset, d.shot_id), '[]'::jsonb),
           count(*) filter (where d.decision = 'rejected' and d.photo_id is null and d.manifest_hash = m.manifest_hash),
           coalesce(jsonb_agg(distinct d.subject_id) filter (where d.decision = 'new_photo' and d.subject_id is not null), '[]'::jsonb)
      into sd, nrej, more from public._hs_is_shot_decisions(m.id) d;
    -- What the founder asked a shot to show (founder, 2026-11-06/07): the note on "Need new photo" OR on a Reject. The
    -- engine searches those words for that shot's subject and puts a photo found for it on that shot. A request lasts
    -- across preparations: it is the shot's newest decision on ANY previews made from the APPROVED narrative, so preparing again
    -- before deciding on the new previews never drops it. Approving the shot (on new previews) ends it.
    select coalesce(jsonb_agg(jsonb_build_object('subject_id', q.subject_id, 'asset', q.asset, 'shot_id', q.shot_id, 'note', q.note)
                              order by q.asset, q.shot_id), '[]'::jsonb)
      into reqs
      from (select distinct on (d.asset, d.shot_id) d.*
              from public.impact_story_shot_decisions d
              join public.impact_story_visual_manifests m2 on m2.id = d.manifest_id
             where m2.story_id = p_story and m2.narrative_hash = na->>'hash' and na->>'state' = 'approved'   -- the approved script only (Codex, #2665)
             order by d.asset, d.shot_id, d.id desc) q
     where q.decision in ('new_photo', 'rejected') and q.subject_id is not null and nullif(btrim(q.note), '') is not null;
    -- A request these previews were not prepared with (founder, 2026-11-07: "stilll no"): the previews still show the old
    -- picture, so they are out of date until Prepare runs with the request. One the engine already searched (it is in the
    -- input of the job that made these previews) stays a request but no longer makes them stale, so nothing loops.
    select count(*) into npend from jsonb_array_elements(reqs) r
     where not coalesce((select j.input->'photo_requests' from public.impact_story_jobs j where j.id = m.job_id), '[]'::jsonb)
               @> jsonb_build_array(jsonb_build_object('asset', r->>'asset', 'shot_id', r->>'shot_id', 'note', r->>'note'));
    cur := cur and npend = 0;
    -- A shot approved on the previous previews whose picture did not change shows as approved again ("Approved
    -- earlier, same picture"), unless it has a decision of its own on these previews. Shown only; the one "Approve all
    -- visuals" decision is unchanged and is still made on these previews.
    select coalesce(jsonb_agg(jsonb_build_object('asset', d.asset, 'shot_id', d.shot_id, 'decision', d.decision,
             'actor', d.actor, 'at', d.at, 'from_manifest', d.manifest_id) order by d.asset, d.shot_id), '[]'::jsonb)
      into carried
      from public.impact_story_visual_manifests pm
      cross join lateral public._hs_is_shot_decisions(pm.id) d
      join lateral (select e1.v as old_shot from jsonb_array_elements(coalesce(pm.manifest->'assets'->d.asset->'shots', '[]'::jsonb)) e1(v)
                     where e1.v->>'id' = d.shot_id limit 1) o on true
      join lateral (select e2.v as new_shot from jsonb_array_elements(coalesce(cur_shots->d.asset->'shots', '[]'::jsonb)) e2(v)
                     where e2.v->>'id' = d.shot_id limit 1) n on true
     where pm.id = (select max(x.id) from public.impact_story_visual_manifests x where x.story_id = p_story and x.id < cur_id)
       and d.decision = 'approved'
       and public._hs_is_shot_print(o.old_shot) = public._hs_is_shot_print(n.new_shot)
       and not exists (select 1 from public._hs_is_shot_decisions(cur_id) c where c.asset = d.asset and c.shot_id = d.shot_id);
  end if;
  if vj.id is not null and vj.status = 'failed' and (m.id is null or vj.created_at > m.created_at) then
    blocked := jsonb_build_object('job_id', vj.id, 'at', vj.completed_at, 'error', vj.error,
      'blocked', coalesce((vj.result->>'blocked')::boolean, false), 'failures', coalesce(vj.result->'failures', '[]'::jsonb),
      'candidates', coalesce(vj.result->'candidates', '[]'::jsonb), 'candidates_error', vj.result->'candidates_error',
      'currency', vj.result->'currency');   -- the newer events and their keys, for "Not about this story"
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
                when m.choices_key <> ck->>'key' then 'You chose or rejected a photo since these previews were made. Prepare the visuals again.'
                when npend > 0 then 'You asked for ' || npend || ' different photo(s) since these previews were made. Prepare the visuals again to get them.'
                when changed then 'The video code changed since you approved these pictures, so the render stopped. Prepare the visuals again and approve them.'
                when ndrawn > 0 then 'These previews were made before drawings were removed (' || ndrawn || ' drawn shot(s)). Prepare the visuals again.'
                else 'The renderer changed since these previews were made. Prepare the visuals again.' end;
  elsif nblk > 0 or nrej > 0 or not m.approvable then
    st := 'needs_fixes';
    why := case when nblk > 0 then nblk || ' shot(s) cannot be shown as planned. Replace those pictures, then prepare the visuals again.'
                when nrej > 0 then 'You rejected ' || nrej || ' shot(s). Prepare the visuals again after the change, or approve them one by one.'
                else 'The previews could not be confirmed to match the render. Prepare the visuals again.' end;
  -- an approval counts only while no shot of these previews is rejected (a rejection after approving undoes it)
  elsif ev.id is not null and ev.decision = 'approved' and ev.manifest_hash = m.manifest_hash then
    st := 'approved'; why := 'Approved by ' || ev.actor || '.';
  else
    st := 'ready'; why := 'Every shot passed the checks. Look them over, then Approve all visuals.';
  end if;
  return jsonb_build_object('state', st, 'why', why, 'current', cur, 'manifest_id', m.id, 'manifest_job_id', m.job_id, 'manifest_hash', m.manifest_hash,
    'created_at', m.created_at, 'version', m.version, 'counts', m.counts, 'approvable', m.approvable, 'manifest', m.manifest,
    'job', case when vj.id is null then null else jsonb_build_object('id', vj.id, 'status', vj.status, 'created_at', vj.created_at,
      'completed_at', vj.completed_at, 'error', vj.error) end,
    'blocked', blocked, 'rejected', ck->'rejected', 'shot_decisions', sd, 'carried_decisions', carried, 'more_photos_for', more,
    'photo_requests', reqs,
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
    'narrative_hash', na->>'hash', 'renderer', 'impact-render-3', 'asset_choices', ck->'choices', 'choices_key', ck->>'key',
    'rejected_photos', ck->'rejected',
    'more_photos_for', coalesce(public._hs_is_visuals(p_story)->'more_photos_for', '[]'::jsonb),
    'photo_requests', coalesce(public._hs_is_visuals(p_story)->'photo_requests', '[]'::jsonb)), e, p_new);
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
      or coalesce(sh->'illustration', 'null'::jsonb) <> 'null'::jsonb
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
    'narrative_hash', na->>'hash', 'renderer', 'impact-render-3', 'asset_choices', ch, 'rejected_photos', ck->'rejected',
    'visual_manifest', jsonb_build_object('hash', vm.manifest_hash, 'opts', vm.opts, 'manifest_id', vm.id))
    -- a creator-directed story: the locked script version (also inside the narrative hash) is named on the job
    || case when s.creation_mode = 'creator' then jsonb_build_object('creator_script_hash',
         public._hs_is_creator_hash((select v.body->'creator_script' from public.impact_story_versions v
                                     where v.story_id = p_story and v.version = s.current_version))) else '{}'::jsonb end, e, p_new);
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
  if exists (select 1 from public._hs_is_choices(p_story) x where x.subject_id = p_subject and x.candidate_id = p_candidate) then
    return jsonb_build_object('ok', true, 'existing', true, 'subject', p_subject, 'candidate', p_candidate);
  end if;
  insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, entry, actor)
  values (p_story, p_subject, p_candidate, p_job, c, e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'asset_chosen', jsonb_build_object('subject', p_subject, 'candidate', p_candidate,
    'license', c->>'license', 'title', c->>'title'), e);
  return jsonb_build_object('ok', true, 'subject', p_subject, 'candidate', p_candidate);
end $$;

-- Take a photo out of its subject's set (the set is the photos the founder clicked; the engine picks from it).
create or replace function public.hs_impact_story_unchoose_asset(p_story uuid, p_subject text, p_candidate text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); c public.impact_story_asset_choices%rowtype;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into c from public._hs_is_choices(p_story) x where x.subject_id = p_subject and x.candidate_id = p_candidate;
  if not found then return jsonb_build_object('ok', true, 'existing', true); end if;
  insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, upload_id, entry, actor, action)
  values (p_story, p_subject, p_candidate, c.job_id, c.upload_id, c.entry, e, 'remove');
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'asset_unchosen', jsonb_build_object('subject', p_subject, 'candidate', p_candidate,
    'title', c.entry->>'title'), e);
  return jsonb_build_object('ok', true, 'subject', p_subject, 'candidate', p_candidate);
end $$;

-- Reject one photo of the newest previews for this story (2026-10-30): it is never shown again in this story, and the
-- next Prepare searches new licensed candidates for its subjects, leaving this file out. Only a photo the previews
-- actually show can be rejected; the previews then read stale until they are prepared again.
create or replace function public.hs_impact_story_photo_reject(p_story uuid, p_manifest_id bigint, p_photo text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); m public.impact_story_visual_manifests%rowtype; rec jsonb; subs jsonb;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into m from public.impact_story_visual_manifests where story_id = p_story order by id desc limit 1;
  if m.id is distinct from p_manifest_id then
    raise exception 'Newer previews exist for this story. Reload and look at those.' using errcode = '40001';
  end if;
  select x into rec from jsonb_array_elements(coalesce(m.manifest->'photos', '[]'::jsonb)) x where x->>'id' = p_photo limit 1;
  if rec is null then   -- a manifest's photo list is built from its shots: read the shot's own record of it
    select sh->'photo'->'record' || jsonb_build_object('id', p_photo) into rec
      from jsonb_each(m.manifest->'assets') a, jsonb_array_elements(a.value->'shots') sh
     where sh->'photo'->>'id' = p_photo and jsonb_typeof(sh->'photo'->'record') = 'object' limit 1;
  end if;
  if rec is null then raise exception 'That photo is not in these previews.' using errcode = '22023'; end if;
  if exists (select 1 from public._hs_is_rejections(p_story) where photo_id = p_photo) then
    return jsonb_build_object('ok', true, 'existing', true);
  end if;
  select coalesce(jsonb_agg(distinct sh->>'subject_ref') filter (where coalesce(sh->>'subject_ref', '') <> ''), '[]'::jsonb) into subs
    from jsonb_each(m.manifest->'assets') a, jsonb_array_elements(a.value->'shots') sh where sh->'photo'->>'id' = p_photo;
  insert into public.impact_story_photo_rejections (story_id, photo_id, decision, manifest_id, entry, note, actor)
  values (p_story, p_photo, 'rejected', m.id, jsonb_build_object('id', p_photo, 'title', rec->>'title', 'file_url', rec->>'file_url',
          'sha256', rec->>'sha256', 'subject_ids', subs), nullif(left(btrim(coalesce(p_note, '')), 1000), ''), e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'photo_rejected', jsonb_build_object('photo', p_photo, 'title', rec->>'title'), e);
  return jsonb_build_object('ok', true, 'photo', p_photo);
end $$;

-- Approve, reject or ask for a new photo for ONE shot of the newest previews (the page sends the hash it showed).
-- Rejecting a shot that shows a photo rejects that photo for the story (it leaves every shot that uses it); rejecting
-- any other shot needs a note and blocks Approve all until the previews are prepared again or that shot is approved.
create or replace function public.hs_impact_story_shot_decide(p_story uuid, p_manifest_id bigint, p_expected_hash text,
                                                              p_asset text, p_shot text, p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); m public.impact_story_visual_manifests%rowtype; sh jsonb; pid text; subj text;
        note text := nullif(left(btrim(coalesce(p_note, '')), 1000), '');
begin
  if p_decision not in ('approved', 'rejected', 'new_photo') then raise exception 'bad decision' using errcode = '22023'; end if;
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into m from public.impact_story_visual_manifests where story_id = p_story order by id desc limit 1;
  if m.id is distinct from p_manifest_id then
    raise exception 'Newer previews exist for this story. Reload and look at those.' using errcode = '40001';
  end if;
  if m.manifest_hash is distinct from p_expected_hash then
    raise exception 'These previews changed since you opened them. Reload first.' using errcode = '40001';
  end if;
  select x into sh from jsonb_array_elements(coalesce(m.manifest->'assets'->p_asset->'shots', '[]'::jsonb)) x where x->>'id' = p_shot limit 1;
  if sh is null then raise exception 'That shot is not in these previews.' using errcode = '22023'; end if;
  pid := case when jsonb_typeof(sh->'photo') = 'object' then sh->'photo'->>'id' end;
  subj := nullif(sh->>'subject_ref', '');
  if p_decision = 'new_photo' and subj is null then
    raise exception 'This shot is not about a subject a photo can show (it is a map, a record or a card). Use Reject with a note instead.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and pid is null and note is null then
    raise exception 'Say what is wrong with this shot.' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and pid is not null then
    perform public.hs_impact_story_photo_reject(p_story, m.id, pid, note);
  end if;
  insert into public.impact_story_shot_decisions (story_id, manifest_id, manifest_hash, asset, shot_id, decision, subject_id, photo_id, note, actor)
  values (p_story, m.id, m.manifest_hash, p_asset, p_shot, p_decision, subj, case when p_decision = 'rejected' then pid end, note, e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'shot_decision', jsonb_build_object('asset', p_asset, 'shot', p_shot, 'decision', p_decision,
    'photo', pid, 'subject', subj), e);
  return jsonb_build_object('ok', true, 'decision', p_decision, 'photo_rejected', p_decision = 'rejected' and pid is not null);
end $$;

-- Approve several shots of one video at once ("Approve this act"): all of them, or none. Each shot goes through
-- hs_impact_story_shot_decide (the same checks), inside this one transaction, so a failure part way saves nothing.
create or replace function public.hs_impact_story_shots_approve(p_story uuid, p_manifest_id bigint, p_expected_hash text,
                                                                p_asset text, p_shots text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); sid text; n int := 0;
begin
  if coalesce(cardinality(p_shots), 0) = 0 then raise exception 'No shots to approve.' using errcode = '22023'; end if;
  if cardinality(p_shots) > 500 then raise exception 'Too many shots at once.' using errcode = '22023'; end if;
  foreach sid in array (select array_agg(distinct x) from unnest(p_shots) x) loop
    perform public.hs_impact_story_shot_decide(p_story, p_manifest_id, p_expected_hash, p_asset, sid, 'approved', null);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'approved', n);
end $$;

-- Reject several photos at once ("Reject every photo in this act"): all of them, or none, through the same checks.
create or replace function public.hs_impact_story_photos_reject(p_story uuid, p_manifest_id bigint, p_photos text[],
                                                                p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); pid text; n int := 0;
begin
  if coalesce(cardinality(p_photos), 0) = 0 then raise exception 'No photos to reject.' using errcode = '22023'; end if;
  if cardinality(p_photos) > 200 then raise exception 'Too many photos at once.' using errcode = '22023'; end if;
  foreach pid in array (select array_agg(distinct x) from unnest(p_photos) x) loop
    perform public.hs_impact_story_photo_reject(p_story, p_manifest_id, pid, p_note);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'rejected', n);
end $$;

-- Undo a rejection: the photo may be shown again after the next Prepare.
create or replace function public.hs_impact_story_photo_restore(p_story uuid, p_photo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); r public.impact_story_photo_rejections%rowtype;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into r from public._hs_is_rejections(p_story) where photo_id = p_photo;
  if r.id is null then raise exception 'That photo is not rejected.' using errcode = '55000'; end if;
  insert into public.impact_story_photo_rejections (story_id, photo_id, decision, manifest_id, entry, actor)
  values (p_story, p_photo, 'restored', r.manifest_id, r.entry, e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'photo_restored', jsonb_build_object('photo', p_photo), e);
  return jsonb_build_object('ok', true, 'photo', p_photo);
end $$;

-- The event keys currently set aside for a story (newest row per key is 'dismissed').
create or replace function public._hs_is_currency_dismissed(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(event_key order by event_key), '[]'::jsonb) from (
    select distinct on (event_key) event_key, decision from public.impact_story_currency_dismissals
     where story_id = p_story order by event_key, id desc) d where decision = 'dismissed';
$$;

-- "Not about this story — continue": set aside newer events the check reported, then the page prepares again. Each key
-- must be one a failed job of this story reported in its latest-development check (result.currency.events[].key).
create or replace function public.hs_impact_story_currency_dismiss(p_story uuid, p_keys text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); k text; ev jsonb; jid uuid; n int := 0;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if coalesce(cardinality(p_keys), 0) = 0 then raise exception 'Nothing to set aside.' using errcode = '22023'; end if;
  if cardinality(p_keys) > 50 then raise exception 'Too many at once.' using errcode = '22023'; end if;
  foreach k in array (select array_agg(distinct x) from unnest(p_keys) x) loop
    select x, j.id into ev, jid
      from public.impact_story_jobs j, jsonb_array_elements(coalesce(j.result->'currency'->'events', '[]'::jsonb)) x
     where j.story_id = p_story and j.status = 'failed' and x->>'key' = k
     order by j.created_at desc limit 1;
    if ev is null then
      raise exception 'That update was not reported by a check of this story.' using errcode = '22023';
    end if;
    insert into public.impact_story_currency_dismissals (story_id, event_key, decision, event, job_id, actor)
    values (p_story, k, 'dismissed', jsonb_build_object('summary', left(ev->>'summary', 400), 'source', ev->>'source',
                                                       'kind', ev->>'kind'), jid, e);
    n := n + 1;
  end loop;
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'currency_dismissed', jsonb_build_object('keys', to_jsonb(p_keys)), e);
  return jsonb_build_object('ok', true, 'dismissed', n);
end $$;

-- "Update the story with this news" (founder, 2026-11-07: "there are no buttons to give me options to do something"). The
-- other answer to an Outdated-status stop, beside "Not about this story": one research note naming the newer events
-- (path main.status, which the fixer reads as "every line that states the status", homesignal-ingest FIXES.md), then Fix:
-- Claude reads the newest record, adds it to the pack and writes a plan the founder confirms. Each key must be one a
-- failed job of this story reported, as for a dismissal. A second press while that note is open or with Claude adds none.
create or replace function public.hs_impact_story_currency_update(p_story uuid, p_keys text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; k text; ev jsonb; parts text[] := '{}'; nt text; nid bigint;
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if coalesce(cardinality(p_keys), 0) = 0 then raise exception 'Nothing to update the story with.' using errcode = '22023'; end if;
  if cardinality(p_keys) > 50 then raise exception 'Too many at once.' using errcode = '22023'; end if;
  foreach k in array (select array_agg(distinct x order by x) from unnest(p_keys) x) loop
    ev := null;
    select x into ev
      from public.impact_story_jobs j, jsonb_array_elements(coalesce(j.result->'currency'->'events', '[]'::jsonb)) x
     where j.story_id = p_story and j.status = 'failed' and x->>'key' = k
     order by j.created_at desc limit 1;
    if ev is null then
      raise exception 'That update was not reported by a check of this story.' using errcode = '22023';
    end if;
    parts := parts || format('"%s" (%s)', left(coalesce(ev->>'summary', ev->>'text', ''), 220), coalesce(ev->>'source', 'our notices'));
  end loop;
  nt := left('A source read again shows something newer than the script says: ' || array_to_string(parts, '; '), 900) ||
        ' Read the newest record, add it to the source pack, and update every line that states the status.';
  select (l->>'id')::bigint into nid from jsonb_array_elements(public._hs_is_line_notes(s.id)) l
   where l->>'status' in ('open', 'sending') and l->>'path' = 'main.status' limit 1;
  if nid is null then
    insert into public.impact_story_line_notes (story_id, version, path, line_text, kind, note, actor)
    values (s.id, s.current_version, 'main.status', null, 'research', nt, e) returning id into nid;
    perform public._hs_is_event(s.id, 'line_note', jsonb_build_object('id', nid, 'path', 'main.status', 'research', true,
                                                                     'keys', to_jsonb(p_keys)), e);
  end if;
  return public.hs_impact_story_fix_start(s.id) || jsonb_build_object('note_id', nid);
end $$;

-- Record a photo the founder uploaded (the file is already in impact-media at <story>/uploads/<p_upload>.jpg|png, put
-- there by the dashboard with the admin's own session) and make it this subject's photo choice. The founder must
-- confirm the permission statement; the credit is shown on screen with the photo. The engine checks p_sha256 against
-- the file's bytes, so a wrong checksum means the photo is refused, never shown differently.
create or replace function public.hs_impact_story_upload_photo(p_story uuid, p_subject text, p_upload uuid, p_mime text,
  p_sha256 text, p_credit text, p_shows_site boolean, p_permission boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; subj jsonb; p text; sz bigint; mt text;
        cid text; c jsonb;
        stmt constant text := 'I own this photo or have permission to use it in JODY Tracks videos.';
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if not coalesce(p_permission, false) then
    raise exception 'Confirm that you own this photo or have permission to use it.' using errcode = '22023';
  end if;
  if coalesce(p_mime, '') not in ('image/jpeg', 'image/png') then raise exception 'Upload a JPEG or PNG photo.' using errcode = '22023'; end if;
  if coalesce(p_sha256, '') !~ '^[0-9a-f]{64}$' then raise exception 'The photo''s checksum is missing. Upload it again.' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_credit, ''))) not between 2 and 120 then
    raise exception 'Say who took the photo (2 to 120 characters). It is shown on screen as the credit.' using errcode = '22023';
  end if;
  select x into subj from public.impact_story_versions v, jsonb_array_elements(coalesce(v.body->'discovery'->'subjects', '[]'::jsonb)) x
   where v.story_id = p_story and v.version = s.current_version and x->>'id' = p_subject limit 1;
  if subj is null then raise exception 'That is not one of this story''s subjects.' using errcode = '22023'; end if;
  if exists (select 1 from public.impact_story_uploads where id = p_upload) then
    raise exception 'That upload is already recorded.' using errcode = '23505';
  end if;
  p := p_story::text || '/uploads/' || p_upload::text || case when p_mime = 'image/png' then '.png' else '.jpg' end;
  select (o.metadata->>'size')::bigint, o.metadata->>'mimetype' into sz, mt
    from storage.objects o where o.bucket_id = 'impact-media' and o.name = p;
  if not found then raise exception 'The photo was not found in storage. Upload it again.' using errcode = '55000'; end if;
  if coalesce(sz, 0) not between 1 and 15728640 then raise exception 'The photo must be smaller than 15 MB.' using errcode = '22023'; end if;
  if coalesce(mt, '') <> p_mime then raise exception 'The stored file is not the kind of image that was uploaded.' using errcode = '22023'; end if;
  insert into public.impact_story_uploads (id, story_id, subject_id, path, mime, bytes, sha256, credit, shows_site, permission, actor)
  values (p_upload, p_story, p_subject, p, p_mime, sz, p_sha256, btrim(p_credit), coalesce(p_shows_site, false), stmt, e);
  cid := 'upload-' || left(replace(p_upload::text, '-', ''), 12);
  c := jsonb_build_object('id', cid, 'source', 'founder_upload', 'subject_id', p_subject, 'file_url', 'storage:impact-media/' || p,
    'sha256', p_sha256, 'mime', p_mime, 'title', 'Photo', 'author', btrim(p_credit), 'license', 'Used with permission',
    'rights_status', 'cleared', 'site_specific', coalesce(p_shows_site, false),
    'site_relation', case when p_shows_site then 'actual_site' else 'representative' end,
    'category', coalesce(subj->>'category', 'place'), 'depicts', coalesce(subj->>'subject', p_subject),
    'verified_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'uploaded_by', e, 'permission', stmt);
  insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, upload_id, entry, actor)
  values (p_story, p_subject, cid, null, p_upload, c, e);
  update public.impact_stories set updated_at = now() where id = p_story;
  perform public._hs_is_event(p_story, 'photo_uploaded', jsonb_build_object('subject', p_subject, 'upload', p_upload,
    'shows_site', coalesce(p_shows_site, false), 'credit', btrim(p_credit)), e);
  return jsonb_build_object('ok', true, 'subject', p_subject, 'candidate', cid);
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
                       'discovery', 'concepts', 'visuals', 'accountability', 'participation') then
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
    'story', jsonb_build_object('id', s.id, 'video_slug', s.video_slug, 'title', s.title, 'pack', s.pack,
                                'currency_dismissed', public._hs_is_currency_dismissed(s.id)),
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
        ac jsonb; nauto int := 0; ck_before text; vkey text; af jsonb;
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
    if j.input->>'then' in ('generate', 'analyze') then   -- a Fix batch that added sources: write the new version from them
      begin
        perform public._hs_is_request(s.id, j.input->>'then', 'all', true, 'worker');
      exception when others then
        perform public._hs_is_event(s.id, 'followup_failed', jsonb_build_object('then', j.input->>'then', 'reason', sqlerrm), 'worker');
      end;
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
    -- videos that failed the checks are fixed (or rendered again) before the founder is asked to watch anything; a
    -- problem here never undoes the finished render
    begin
      af := public._hs_is_auto_fix(j.story_id, j.id);
    exception when others then
      perform public._hs_is_event(j.story_id, 'auto_fix_failed', jsonb_build_object('job_id', j.id, 'reason', sqlerrm), 'worker');
    end;
    perform public._hs_is_followup(s.id, 'worker');   -- a save made during the render is checked now
    return jsonb_build_object('ok', true, 'files', jsonb_array_length(p_result->'assets'), 'auto_fix', af);
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
    -- Photos the engine found and used itself for an essential subject with none (founder, 2026-11-04: "i never upload.
    -- the code is responsible for finding pics"). Recorded as the story's photos, like a person's choice, so the render
    -- plans with exactly them; Reject / Remove work on them as on any photo. Only a complete licensed entry, never a
    -- photo the founder rejected, never one already chosen. The previews were made with them: when the founder changed
    -- nothing while the job ran, the previews' key is the key with them, so the previews read current.
    ck_before := public._hs_is_choice_key(j.story_id)->>'key';
    for ac in select x from jsonb_array_elements(coalesce(vman->'auto_choices', '[]'::jsonb)) x loop
      if coalesce(ac->>'subject_id', '') = '' or coalesce(ac->>'candidate_id', '') = ''
         or coalesce(ac->'entry'->>'sha256', '') !~ '^[0-9a-f]{64}$' or coalesce(ac->'entry'->>'license', '') = ''
         or coalesce(ac->'entry'->>'file_url', '') = '' or ac->'entry'->>'id' is distinct from ac->>'candidate_id' then
        continue;
      end if;
      if exists (select 1 from public._hs_is_rejections(j.story_id) r where r.photo_id = ac->>'candidate_id'
                   or r.entry->>'file_url' = ac->'entry'->>'file_url' or r.entry->>'sha256' = ac->'entry'->>'sha256')
         or exists (select 1 from public._hs_is_choices(j.story_id) c where c.subject_id = ac->>'subject_id' and c.candidate_id = ac->>'candidate_id') then
        continue;
      end if;
      insert into public.impact_story_asset_choices (story_id, subject_id, candidate_id, job_id, entry, actor)
      values (j.story_id, ac->>'subject_id', ac->>'candidate_id', j.id, ac->'entry', 'system:auto-photo');
      nauto := nauto + 1;
    end loop;
    vkey := case when nauto > 0 and coalesce(j.input->>'choices_key', '') = ck_before
                 then public._hs_is_choice_key(j.story_id)->>'key' else coalesce(j.input->>'choices_key', '') end;
    insert into public.impact_story_visual_manifests (story_id, job_id, version, narrative_hash, pack_hash, renderer, manifest_hash,
      choices_key, opts, counts, approvable, manifest)
    values (j.story_id, j.id, j.base_version, j.input->>'narrative_hash', vman->>'pack_hash', coalesce(vman->>'renderer', j.input->>'renderer'),
      vman->>'hash', vkey, coalesce(vman->'opts', '{}'::jsonb), coalesce(vman->'counts', '{}'::jsonb),
      coalesce((vman->>'approvable')::boolean, false) and coalesce((vman->'identity'->>'same')::boolean, false), vman)
    returning id into mid;
    update public.impact_story_jobs set status = 'complete', completed_at = now(),
           result = jsonb_build_object('manifest_id', mid, 'hash', vman->>'hash', 'counts', vman->'counts', 'timing', vman->'timing')
     where id = p_job_id;
    perform public._hs_is_event(j.story_id, 'visuals_prepared', jsonb_build_object('job_id', j.id, 'manifest_id', mid,
      'counts', vman->'counts', 'photos_found', nauto), 'worker');
    perform public._hs_is_followup(s.id, 'worker');   -- a save made while the previews were prepared is checked now
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
  select jsonb_build_object('id', b.id, 'status', case when b.status in ('working', 'planning') and b.claimed_at < now() - interval '3 hours' then 'stalled' else b.status end,
           'phase', case when b.status in ('plan_queued', 'planning', 'planned') or (b.status in ('failed', 'cancelled') and b.confirmed_at is null) then 'plan' else 'work' end,
           'plan', b.plan, 'plan_md5', b.plan_md5, 'planned_at', b.planned_at, 'confirmed_at', b.confirmed_at,
           'requests', jsonb_array_length(b.requests), 'requested_by', b.requested_by, 'requested_at', b.requested_at,
           'claimed_at', b.claimed_at, 'completed_at', b.completed_at, 'attempts', b.attempts, 'summary', b.summary,
           'next_step', b.next_step, 'outcomes', b.outcomes, 'version_after', b.version_after, 'pr_url', b.pr_url,
           -- started by the system because a render failed its checks (_hs_is_auto_fix), not by the founder
           'auto', b.requested_by = 'system:auto-fix')
    from public.impact_story_fix_batches b where b.story_id = p_story order by b.requested_at desc limit 1
$$;

-- The fix requests a new batch would carry: rejected decisions nothing has acted on (no later approval of that file, no
-- render since), not already in an active batch, and not already fixed by an earlier batch.
-- Every note on a script line, newest first, and where it stands: open (not sent) · sending (in a batch the fixer has
-- not finished) · fixed / not_changed / needs_you (what the fixer said, in a finished batch) · withdrawn. A note whose
-- batch failed is open again.
create or replace function public._hs_is_line_notes(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'id')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', n.id, 'path', n.path, 'line', n.line_text, 'note', n.note, 'research', n.kind = 'research',
             'version', n.version, 'actor', n.actor, 'at', n.at,
             'status', case
               when exists (select 1 from public.impact_story_line_notes w where w.withdraws = n.id) then 'withdrawn'
               when fb.status in ('plan_queued', 'planning', 'planned', 'queued', 'working') then 'sending'
               when fb.status in ('done', 'needs_you') then coalesce(fo.o->>'outcome', 'needs_you')
               else 'open' end,
             'answer', case when fb.status in ('done', 'needs_you') then fo.o->>'note' end,
             'batch', case when fb.id is null then null else jsonb_build_object('id', fb.id, 'status', fb.status,
                        'completed_at', fb.completed_at, 'next_step', fb.next_step) end) x
      from public.impact_story_line_notes n
      left join lateral (select b.* from public.impact_story_fix_batches b where b.story_id = p_story
                          and b.requests @> jsonb_build_array(jsonb_build_object('id', n.id))
                          order by b.requested_at desc limit 1) fb on true
      left join lateral (select o from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = n.id limit 1) fo(o) on true
     where n.story_id = p_story and n.kind <> 'withdraw') q
$$;

-- Where a creator-directed story's script stands: the version in the current draft (locked), every revision with its status
-- (current · proposed · sending · applying · superseded · withdrawn), the fact-check flags of the current version with the
-- founder's decisions, and whether "Approve & Lock Script" may be pressed now (ok / why). A JODY-written story returns
-- {mode: 'jody'}. The engine's flags are read only from a validation made against the CURRENT source pack.
create or replace function public._hs_is_creator_state(p_story uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s public.impact_stories%rowtype; v public.impact_story_versions%rowtype; cur text; val jsonb; revs jsonb; pend jsonb;
        flags jsonb; hi int; lo int; why text; okk boolean;
begin
  select * into s from public.impact_stories where id = p_story;
  if not found or s.creation_mode <> 'creator' then return jsonb_build_object('mode', 'jody'); end if;
  select * into v from public.impact_story_versions where story_id = p_story and version = s.current_version;
  cur := case when v.body ? 'creator_script' then public._hs_is_creator_hash(v.body->'creator_script') end;
  val := case when v.validation is not null and v.validated_pack_hash is not distinct from s.pack_hash then v.validation->'creator' end;
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint desc), '[]'::jsonb) into revs from (
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'script_hash', c.script_hash, 'based_on', c.based_on, 'source', c.source,
             'note', c.note, 'actor', c.actor, 'at', c.at, 'script', c.script,
             'status', case
               when exists (select 1 from public.impact_story_creator_scripts w where w.withdraws = c.id) then 'withdrawn'
               when c.script_hash = cur then 'current'
               when fb.status in ('plan_queued', 'planning', 'planned', 'queued', 'working') then 'sending'
               when fb.status = 'done' and c.id = (select max(x.id) from public.impact_story_creator_scripts x
                                                    where x.story_id = p_story and x.kind = 'revision') then 'applying'
               when c.kind = 'revision' and c.id = (select max(x.id) from public.impact_story_creator_scripts x
                                                     where x.story_id = p_story and x.kind = 'revision'
                                                       and not exists (select 1 from public.impact_story_creator_scripts w where w.withdraws = x.id))
                 then 'proposed'
               else 'superseded' end,
             'batch', case when fb.id is null then null else jsonb_build_object('id', fb.id, 'status', fb.status, 'next_step', fb.next_step,
                        'outcome', (select o->>'outcome' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = c.id limit 1),
                        'answer', (select o->>'note' from jsonb_array_elements(fb.outcomes) o where (o->>'decision_id')::bigint = c.id limit 1)) end) r
      from public.impact_story_creator_scripts c
      left join lateral (select b.* from public.impact_story_fix_batches b where b.story_id = p_story
                          and b.requests @> jsonb_build_array(jsonb_build_object('id', c.id))
                          order by b.requested_at desc limit 1) fb on true
     where c.story_id = p_story and c.kind <> 'withdraw') q;
  select r into pend from jsonb_array_elements(revs) r where r->>'status' in ('proposed', 'sending', 'applying') order by (r->>'id')::bigint desc limit 1;
  select coalesce(jsonb_agg(f || jsonb_build_object(
           'decision', (select d.decision from public.impact_story_creator_flag_decisions d where d.story_id = p_story
                         and d.script_hash = cur and d.flag_key = f->>'key' order by d.id desc limit 1),
           'decision_note', (select d.note from public.impact_story_creator_flag_decisions d where d.story_id = p_story
                         and d.script_hash = cur and d.flag_key = f->>'key' order by d.id desc limit 1),
           'in_revision', pend is not null and (f->>'field') in ('narration', 'headline') and coalesce(f->>'sentence', '') <> ''
             and position(f->>'sentence' in coalesce((select sc->>(f->>'field') from jsonb_array_elements(pend->'script'->'scenes') sc
                                                   where sc->>'n' = f->>'scene' limit 1), '')) = 0)
         order by (f->>'scene')::int nulls last), '[]'::jsonb)
    into flags from jsonb_array_elements(coalesce(val->'flags', '[]'::jsonb)) f;
  select count(*) filter (where f->>'risk' = 'high'),
         count(*) filter (where f->>'risk' = 'low' and f->>'decision' is null and not (f->>'in_revision')::boolean)
    into hi, lo from jsonb_array_elements(flags) f;
  okk := false;
  if cur is null then why := 'The story has no copy of your script yet. Research writes it.';
  elsif v.validation is null or v.validated_pack_hash is distinct from s.pack_hash then why := 'Your script is being fact-checked against the current sources.';
  elsif val is null then why := 'This version carries no fact-check of your script. Ask Claude to redo it (send your script again with Fix).';
  elsif pend is not null and pend->>'status' = 'proposed' then why := 'You proposed a revised script. Send it with Fix (or withdraw it) before you approve.';
  elsif pend is not null then why := 'Your revised script is being applied and fact-checked. Approve the new version when it is ready.';
  elsif hi > 0 then why := format('%s sentence%s of your script %s a high-risk problem. Accept the suggestion or edit the scene; it cannot be kept as is.',
                              hi, case when hi = 1 then '' else 's' end, case when hi = 1 then 'has' else 'have' end);
  elsif lo > 0 then why := format('Decide on %s flag%s: accept the suggestion, edit, or keep your words.', lo, case when lo = 1 then '' else 's' end);
  elsif not coalesce((val->>'ok')::boolean, false) then why := coalesce('Your script: ' || (val->'blocking'->>0), 'Your script does not pass its checks.');
  else okk := true; why := 'Your script is checked. Approving locks it for production.';
  end if;
  return jsonb_build_object('mode', 'creator', 'current_hash', cur, 'script', v.body->'creator_script', 'checked', val is not null,
    'flags', flags, 'items', jsonb_array_length(coalesce(val->'items', '[]'::jsonb)), 'high', hi, 'low_open', lo,
    'timing', coalesce(val->'timing', '[]'::jsonb), 'arc', coalesce(val->'arc', '[]'::jsonb), 'scenes', coalesce(val->'scenes', '[]'::jsonb),
    'revisions', revs, 'pending', pend, 'ok', okk, 'why', why);
end $$;

-- Save a revised script (the founder's own edits). Becomes the one waiting revision; Fix sends it to the engine, which
-- applies it word for word, redoes the fact-check and writes a new version.
create or replace function public.hs_impact_story_creator_revise(p_story uuid, p_expected_version integer, p_script jsonb,
                                                                 p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; h text; st jsonb; rid bigint;
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.creation_mode <> 'creator' then raise exception 'This story was written by JODY; it has no creator script.' using errcode = '55000'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload first.', s.current_version using errcode = '40001';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = '22023'; end if;
  h := public._hs_is_creator_require(p_script);
  st := public._hs_is_creator_state(p_story);
  if h = st->>'current_hash' then raise exception 'This is the script the story has now. Change something first.' using errcode = '22023'; end if;
  if st->'pending'->>'status' in ('sending', 'applying') then
    raise exception 'Your last revision is being applied. Wait for the new version, then revise it.' using errcode = '55000';
  end if;
  if st->'pending'->>'script_hash' = h then return jsonb_build_object('unchanged', true, 'creator', st); end if;
  insert into public.impact_story_creator_scripts (story_id, kind, script, script_hash, based_on, source, note, actor)
  values (p_story, 'revision', p_script, h, st->>'current_hash', 'edit', nullif(btrim(p_note), ''), e) returning id into rid;
  perform public._hs_is_event(p_story, 'creator_revision', jsonb_build_object('id', rid, 'script_hash', h, 'source', 'edit'), e);
  return jsonb_build_object('id', rid, 'creator', public._hs_is_creator_state(p_story));
end $$;

-- The founder's answer to one flag of the current script version. 'keep' keeps their words (a low-risk flag only; a
-- high-risk problem is never kept). 'accept' puts the suggestion into the waiting revision (or starts one from the
-- current script): the sentence must appear exactly once in that scene's field.
create or replace function public.hs_impact_story_creator_flag_decide(p_story uuid, p_expected_version integer, p_flag_key text,
                                                                      p_decision text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; st jsonb; f jsonb; base jsonb; based text; fld text; txt text;
        sent text; sug text; n int; i int := 0; sc jsonb; newsc jsonb := '[]'::jsonb; h text; rid bigint; pend jsonb;
begin
  if p_decision not in ('keep', 'accept') then raise exception 'Choose keep or accept.' using errcode = '22023'; end if;
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.creation_mode <> 'creator' then raise exception 'This story was written by JODY; it has no creator script.' using errcode = '55000'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.current_version <> p_expected_version then
    raise exception 'This story changed since you opened it (now version %). Reload first.', s.current_version using errcode = '40001';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = '22023'; end if;
  st := public._hs_is_creator_state(p_story);
  select x into f from jsonb_array_elements(st->'flags') x where x->>'key' = p_flag_key limit 1;
  if f is null then raise exception 'That flag is not on the current version of your script.' using errcode = 'P0002'; end if;
  if p_decision = 'keep' then
    if f->>'risk' <> 'low' then
      raise exception 'A high-risk problem cannot be kept. Accept the suggestion or edit the scene.' using errcode = '55000';
    end if;
    insert into public.impact_story_creator_flag_decisions (story_id, script_hash, flag_key, decision, note, actor)
    values (p_story, st->>'current_hash', p_flag_key, 'keep', nullif(btrim(p_note), ''), e);
    perform public._hs_is_event(p_story, 'creator_flag_kept', jsonb_build_object('flag', p_flag_key, 'scene', f->'scene'), e);
    return jsonb_build_object('creator', public._hs_is_creator_state(p_story));
  end if;
  sug := f->>'suggestion'; sent := f->>'sentence'; fld := f->>'field';
  if nullif(btrim(coalesce(sug, '')), '') is null or coalesce(sent, '') = '' or fld not in ('narration', 'headline') then
    raise exception 'This flag has no suggestion to accept. Edit the scene yourself.' using errcode = '55000';
  end if;
  pend := st->'pending';
  if pend->>'status' in ('sending', 'applying') then
    raise exception 'Your last revision is being applied. Wait for the new version.' using errcode = '55000';
  end if;
  if pend->>'status' = 'proposed' then base := pend->'script'; based := pend->>'based_on';
  else base := st->'script'; based := st->>'current_hash'; end if;
  for sc in select x from jsonb_array_elements(base->'scenes') x loop
    i := i + 1;
    if sc->>'n' = f->>'scene' then
      txt := coalesce(sc->>fld, '');
      n := case when sent = '' then 0 else (char_length(txt) - char_length(replace(txt, sent, ''))) / char_length(sent) end;
      if n <> 1 then
        raise exception 'Scene % does not contain that sentence exactly once any more (your revision already changed it). Edit the scene yourself.', f->>'scene'
          using errcode = '55000';
      end if;
      sc := jsonb_set(sc, array[fld], to_jsonb(btrim(replace(txt, sent, btrim(sug)))));
    end if;
    newsc := newsc || jsonb_build_array(sc);
  end loop;
  base := jsonb_set(base, '{scenes}', newsc);
  h := public._hs_is_creator_require(base);
  insert into public.impact_story_creator_scripts (story_id, kind, script, script_hash, based_on, source, note, actor)
  values (p_story, 'revision', base, h, based, 'accept_suggestion',
          left(coalesce(nullif(btrim(p_note), ''), 'Accepted the suggestion for scene ' || (f->>'scene') || '.'), 1000), e) returning id into rid;
  insert into public.impact_story_creator_flag_decisions (story_id, script_hash, flag_key, decision, note, actor)
  values (p_story, st->>'current_hash', p_flag_key, 'accept', nullif(btrim(p_note), ''), e);
  perform public._hs_is_event(p_story, 'creator_revision', jsonb_build_object('id', rid, 'script_hash', h, 'source', 'accept_suggestion', 'flag', p_flag_key), e);
  return jsonb_build_object('id', rid, 'creator', public._hs_is_creator_state(p_story));
end $$;

-- Take back the waiting revision before it is sent. The current (locked) script is unchanged.
create or replace function public.hs_impact_story_creator_revision_withdraw(p_story uuid, p_revision bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); st jsonb; r jsonb;
begin
  st := public._hs_is_creator_state(p_story);
  select x into r from jsonb_array_elements(coalesce(st->'revisions', '[]'::jsonb)) x where (x->>'id')::bigint = p_revision;
  if r is null then raise exception 'No such revision on this story.' using errcode = 'P0002'; end if;
  if r->>'status' <> 'proposed' then raise exception 'Only a revision you have not sent can be withdrawn (this one is %).', r->>'status' using errcode = '55000'; end if;
  insert into public.impact_story_creator_scripts (story_id, kind, withdraws, actor) values (p_story, 'withdraw', p_revision, e);
  perform public._hs_is_event(p_story, 'creator_revision_withdrawn', jsonb_build_object('id', p_revision), e);
  return jsonb_build_object('creator', public._hs_is_creator_state(p_story));
end $$;

-- The fix requests a new batch would carry: rejected decisions nothing has acted on (no later approval of that file, no
-- render since), not already in an active batch, and not already fixed by an earlier batch; plus every open note on a
-- script line (kind 'line', with the line's path and text, and whether research comes first); plus, in a creator-directed
-- story, the founder's waiting script revision (kind 'creator_script': the engine applies it word for word).
create or replace function public._hs_is_fix_eligible(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(r order by (r->>'id')::bigint), '[]'::jsonb) from (
    select jsonb_build_object('id', (x->>'id')::bigint, 'kind', 'media', 'asset', x->>'asset', 'note', x->>'note',
             'timecode', x->>'timecode', 'at', x->>'at') r
      from jsonb_array_elements(public._hs_is_media(p_story)->'fix_requests') x
     where x->>'status' = 'open'
       and not exists (select 1 from public.impact_story_fix_batches b where b.story_id = p_story
                         and b.requests @> jsonb_build_array(jsonb_build_object('id', (x->>'id')::bigint))
                         and (b.status in ('plan_queued', 'planning', 'planned', 'queued', 'working')
                              or exists (select 1 from jsonb_array_elements(b.outcomes) o
                                          where (o->>'decision_id')::bigint = (x->>'id')::bigint and o->>'outcome' = 'fixed')))
    union all
    select jsonb_build_object('id', (l->>'id')::bigint, 'kind', 'line', 'asset', 'script', 'path', l->>'path', 'line', l->>'line',
             'note', l->>'note', 'research', (l->>'research')::boolean, 'version', (l->>'version')::int, 'at', l->>'at')
      from jsonb_array_elements(public._hs_is_line_notes(p_story)) l
     where l->>'status' = 'open'
    union all
    select jsonb_build_object('id', (c->'pending'->>'id')::bigint, 'kind', 'creator_script', 'asset', 'script',
             'script', c->'pending'->'script', 'script_hash', c->'pending'->>'script_hash', 'rev', (c->'pending'->>'id')::bigint,
             'based_on', c->'pending'->>'based_on', 'note', coalesce(c->'pending'->>'note', 'My revised script.'), 'at', c->'pending'->>'at')
      from (select public._hs_is_creator_state(p_story) c) x
     where c->'pending'->>'status' = 'proposed') q
$$;

-- Save a note on one script line. p_research = true asks the fixer to look up the official documents first.
create or replace function public.hs_impact_story_line_note(p_story uuid, p_path text, p_line text, p_note text, p_research boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; nid bigint;
begin
  if nullif(btrim(p_note), '') is null then raise exception 'Say what to fix or what to look up.' using errcode = '22023'; end if;
  if char_length(btrim(p_note)) > 1000 then raise exception 'Keep the note under 1000 characters.' using errcode = '22023'; end if;
  if p_path is null or p_path !~ '^(main|qol|shorts|packaging)(\.([a-z_]{1,20}|[0-9]{1,3})){1,10}$' then
    raise exception 'That is not a line of this story.' using errcode = '22023';
  end if;
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  if s.creation_mode = 'creator' and p_path ~ '^main\.(.*\.)?(narration|onscreen)(\.|$)' then
    raise exception 'These are your own words, and they are locked. Change them under Your script (Edit scene), so the change is fact-checked and versioned.'
      using errcode = '55000';
  end if;
  insert into public.impact_story_line_notes (story_id, version, path, line_text, kind, note, actor)
  values (p_story, s.current_version, p_path, left(p_line, 2000), case when p_research then 'research' else 'fix' end, btrim(p_note), e)
  returning id into nid;
  perform public._hs_is_event(p_story, 'line_note', jsonb_build_object('id', nid, 'path', p_path, 'research', coalesce(p_research, false)), e);
  return jsonb_build_object('id', nid, 'line_notes', public._hs_is_line_notes(p_story));
end $$;

-- Take a note back before it is sent. A note already in a batch the fixer is working on cannot be taken back.
create or replace function public.hs_impact_story_line_note_withdraw(p_story uuid, p_note bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); st text;
begin
  select x->>'status' into st from jsonb_array_elements(public._hs_is_line_notes(p_story)) x where (x->>'id')::bigint = p_note;
  if st is null then raise exception 'No such note on this story.' using errcode = 'P0002'; end if;
  if st = 'withdrawn' then return jsonb_build_object('line_notes', public._hs_is_line_notes(p_story)); end if;
  if st = 'sending' then raise exception 'The fixer is already working on this note.' using errcode = '55000'; end if;
  insert into public.impact_story_line_notes (story_id, version, path, kind, withdraws, actor)
  select n.story_id, n.version, n.path, 'withdraw', n.id, e from public.impact_story_line_notes n where n.id = p_note;
  return jsonb_build_object('line_notes', public._hs_is_line_notes(p_story));
end $$;

-- Starts the Fix job for a batch (homesignal-ingest impact-fix-run.yml, on main). Never raises on a missing credential:
-- the batch is recorded failed with a readable reason, so the page shows it instead of a batch that never moves.
-- p_mode: 'plan' (Claude writes what it will change, edits nothing) or 'work' (Claude makes the confirmed plan).
drop function if exists public._hs_is_fix_dispatch(uuid);
create or replace function public._hs_is_fix_dispatch(p_batch uuid, p_mode text)
returns void language plpgsql security definer
set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text;
begin
  if p_mode not in ('plan', 'work') then raise exception 'bad fix mode' using errcode = '22023'; end if;
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then
    update public.impact_story_fix_batches set status = 'failed', completed_at = now(),
      summary = 'The fix could not start because no GitHub credential is stored. Nothing was lost. Press Fix again once it is restored.'
     where id = p_batch and status in ('queued', 'plan_queued');
    return;
  end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/impact-fix-run.yml/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('batch', p_batch::text, 'mode', p_mode)),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-impact-stories', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
end $$;

-- Videos that fail the automatic checks are dealt with before the founder is asked to watch anything (founder,
-- 2026-11-07: "if you have to fix things, than you should fix before i have to watch"). Called when a render finishes.
--  * Every failed video only needs the renderer to try again (a technical media check failed, or the renderer did not
--    draw what was planned): render again, once. A render that was itself such a retry goes to the fixer instead.
--  * Otherwise: one fix request per failed video, written by the system (actor system:auto-fix, the failed checks named),
--    sent as a batch. Claude plans it, and impact_fix_batch_plan carries the plan out without waiting for a confirm.
--    Only these requests are in it: the founder's own notes never ride in an automatic batch.
-- Nothing is approved here. A fix that changes the script makes a new version, which the founder approves as always.
-- Never twice for one render (a request already written for a file is not written again), and never while a fix batch
-- is active (that batch finishes first).
create or replace function public._hs_is_auto_fix(p_story uuid, p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m jsonb := public._hs_is_media(p_story); j public.impact_story_jobs%rowtype; f jsonb; bl jsonb; ids bigint[] := '{}';
        did bigint; reqs jsonb; b public.impact_story_fix_batches%rowtype; q jsonb; lab text;
begin
  select * into j from public.impact_story_jobs where id = p_job;
  if not found or m->>'render_job' is distinct from p_job::text or not coalesce((m->>'current')::boolean, false) then
    return jsonb_build_object('action', 'none', 'reason', 'not the current render');
  end if;
  select coalesce(jsonb_agg(x), '[]'::jsonb) into bl from jsonb_array_elements(m->'files') x
   where x->>'state' = 'blocked' and x->>'asset' <> 'thumbnail';
  if jsonb_array_length(bl) = 0 then return jsonb_build_object('action', 'none'); end if;
  -- rendering again helps only when, for every failed video, the media checks failed or the one problem is the
  -- renderer not drawing what was planned (the page's renderAgainHelps says the same)
  if j.input->>'auto_rerender_of' is null and not exists (select 1 from jsonb_array_elements(bl) x
       where coalesce((x->'qc'->>'ok')::boolean, false)
         and not (jsonb_array_length(coalesce(x->'qc'->'quality'->'failures', '[]'::jsonb)) > 0
                  and not exists (select 1 from jsonb_array_elements(x->'qc'->'quality'->'failures') y
                                   where y->>'code' is distinct from 'render_mismatch'))) then
    q := public._hs_is_queue(p_story, 'render', j.input || jsonb_build_object('auto_rerender_of', p_job), 'system:auto-fix', true);
    perform public._hs_is_event(p_story, 'auto_rerender', jsonb_build_object('job_id', p_job, 'new_job', q->>'job_id',
      'files', (select jsonb_agg(x->>'asset') from jsonb_array_elements(bl) x)), 'system:auto-fix');
    return jsonb_build_object('action', 'render', 'job', q);
  end if;
  if exists (select 1 from public.impact_story_fix_batches where story_id = p_story
               and status in ('plan_queued', 'planning', 'planned', 'queued', 'working')) then
    return jsonb_build_object('action', 'none', 'reason', 'a fix batch is already active');
  end if;
  for f in select x from jsonb_array_elements(bl) x loop
    if exists (select 1 from public.impact_story_media_decisions where asset_id = (f->>'id')::bigint and actor = 'system:auto-fix') then
      continue;
    end if;
    select string_agg(distinct l, '; ') into lab from (
      select y->>'label' l from jsonb_array_elements(coalesce(f->'qc'->'quality'->'failures', '[]'::jsonb)) y
      union all
      select c->>'name' from jsonb_array_elements(coalesce(f->'qc'->'checks', '[]'::jsonb)) c where not coalesce((c->>'ok')::boolean, true)) z
     where l is not null;
    insert into public.impact_story_media_decisions (story_id, asset_id, decision, note, actor)
    values (p_story, (f->>'id')::bigint, 'rejected',
            left('The automatic checks failed on this video' || coalesce(': ' || lab, '') || '. It was not shown for review. '
                 || 'Fix every failed check in the checks report for this video.', 1000), 'system:auto-fix')
    returning id into did;
    ids := ids || did;
  end loop;
  if cardinality(ids) = 0 then return jsonb_build_object('action', 'none', 'reason', 'already sent'); end if;
  select coalesce(jsonb_agg(r), '[]'::jsonb) into reqs from jsonb_array_elements(public._hs_is_fix_eligible(p_story)) r
   where r->>'kind' = 'media' and (r->>'id')::bigint = any (ids);
  if jsonb_array_length(reqs) = 0 then return jsonb_build_object('action', 'none', 'reason', 'nothing eligible'); end if;
  insert into public.impact_story_fix_batches (story_id, requests, requested_by, status)
  values (p_story, reqs, 'system:auto-fix', 'plan_queued') returning * into b;
  perform public._hs_is_event(p_story, 'fix_batch_queued', jsonb_build_object('batch', b.id, 'requests', jsonb_array_length(reqs),
    'phase', 'plan', 'auto', true, 'job_id', p_job), 'system:auto-fix');
  perform public._hs_is_fix_dispatch(b.id, 'plan');
  return jsonb_build_object('action', 'fix', 'batch', b.id, 'requests', jsonb_array_length(reqs));
end $$;

-- The founder's Fix button. Sends every eligible fix request of the story as one batch and starts the PLAN run: Claude
-- reads the notes and the failed checks and writes what it will change; nothing is edited until the founder confirms
-- (hs_impact_story_fix_confirm). A second press while the batch is waiting to start, or stalled (claimed over 3 hours
-- ago), starts that run again (the first start may have been lost; a second run cannot claim a batch the first already
-- took). While a plan waits for the founder, or a run is working, it returns that batch.
create or replace function public.hs_impact_story_fix_start(p_story uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.impact_stories%rowtype; reqs jsonb; b public.impact_story_fix_batches%rowtype;
begin
  select * into s from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  if s.archived_at is not null then raise exception 'This story is archived. Restore it first.' using errcode = '55000'; end if;
  select * into b from public.impact_story_fix_batches where story_id = p_story
     and status in ('plan_queued', 'planning', 'planned', 'queued', 'working');
  if found then
    if b.status = 'plan_queued' or (b.status = 'planning' and b.claimed_at < now() - interval '3 hours') then
      perform public._hs_is_fix_dispatch(b.id, 'plan');
    elsif b.status = 'queued' or (b.status = 'working' and b.claimed_at < now() - interval '3 hours') then
      perform public._hs_is_fix_dispatch(b.id, 'work');
    end if;
    return jsonb_build_object('existing', true, 'batch', public._hs_is_fix_batch(p_story));
  end if;
  reqs := public._hs_is_fix_eligible(p_story);
  if jsonb_array_length(reqs) = 0 then
    raise exception 'There are no open fix requests to send.' using errcode = '55000';
  end if;
  insert into public.impact_story_fix_batches (story_id, requests, requested_by, status) values (p_story, reqs, e, 'plan_queued') returning * into b;
  perform public._hs_is_event(p_story, 'fix_batch_queued', jsonb_build_object('batch', b.id, 'requests', jsonb_array_length(reqs), 'phase', 'plan'), e);
  perform public._hs_is_fix_dispatch(b.id, 'plan');
  return jsonb_build_object('existing', false, 'batch', public._hs_is_fix_batch(p_story));
end $$;

-- The founder confirms the plan exactly as the page showed it (its md5). Only then does Claude change anything.
create or replace function public.hs_impact_story_fix_confirm(p_story uuid, p_batch uuid, p_plan_md5 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); b public.impact_story_fix_batches%rowtype;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into b from public.impact_story_fix_batches where id = p_batch and story_id = p_story for update;
  if not found then raise exception 'no such fix batch' using errcode = 'P0002'; end if;
  if b.status <> 'planned' then raise exception 'This plan is %, so there is nothing to confirm.', b.status using errcode = '55000'; end if;
  if p_plan_md5 is distinct from b.plan_md5 then
    raise exception 'The plan changed since this page loaded. Read it again, then confirm.' using errcode = '55000';
  end if;
  update public.impact_story_fix_batches set status = 'queued', confirmed_at = now(), confirmed_by = e, attempts = 0,
         claimed_at = null where id = b.id;
  perform public._hs_is_event(p_story, 'fix_plan_confirmed', jsonb_build_object('batch', b.id, 'plan_md5', b.plan_md5), e);
  perform public._hs_is_fix_dispatch(b.id, 'work');
  return jsonb_build_object('ok', true, 'batch', public._hs_is_fix_batch(p_story));
end $$;

-- Cancel a plan (waiting, written, or stalled while writing). Nothing was changed; the notes can be sent again.
create or replace function public.hs_impact_story_fix_cancel(p_story uuid, p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); b public.impact_story_fix_batches%rowtype;
begin
  perform 1 from public.impact_stories where id = p_story for update;
  if not found then raise exception 'no such story' using errcode = 'P0002'; end if;
  select * into b from public.impact_story_fix_batches where id = p_batch and story_id = p_story for update;
  if not found then raise exception 'no such fix batch' using errcode = 'P0002'; end if;
  if not (b.status in ('plan_queued', 'planned') or (b.status = 'planning' and b.claimed_at < now() - interval '3 hours')) then
    raise exception 'Only a plan that has not been confirmed can be cancelled (this one is %).', b.status using errcode = '55000';
  end if;
  update public.impact_story_fix_batches set status = 'cancelled', completed_at = now(),
         summary = coalesce(summary, 'Cancelled before anything was changed.') where id = b.id;
  perform public._hs_is_event(p_story, 'fix_plan_cancelled', jsonb_build_object('batch', b.id), e);
  return jsonb_build_object('ok', true, 'batch', public._hs_is_fix_batch(p_story));
end $$;

-- The Fix job's door (service role only, through homesignal-ingest impact-fix-run.yml / impact-fix-batch.yml).
create or replace function public.impact_fix_batches_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'story_id', b.story_id, 'title', s.title, 'video_slug', s.video_slug,
           'current_version', s.current_version, 'status', b.status, 'requested_at', b.requested_at, 'claimed_at', b.claimed_at,
           'phase', case when b.status in ('plan_queued', 'planning') then 'plan' else 'work' end,
           'attempts', b.attempts, 'requests', b.requests) order by b.requested_at), '[]'::jsonb)
    from public.impact_story_fix_batches b join public.impact_stories s on s.id = b.story_id
   where b.status in ('queued', 'plan_queued') or (b.status in ('working', 'planning') and b.claimed_at < now() - interval '3 hours')
$$;

-- What the newest finished render's checks found, per file, for the fixer to read beside the founder's notes: each
-- failed check (label, measurement, what to do), the measurements and the shots (when each starts, its layout and
-- picture). The page shows the same report under Details.
create or replace function public._hs_is_fix_checks(p_story uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('asset', a.asset, 'duration_s', a.duration_s,
           'ok', coalesce((a.qc->'quality'->>'ok')::boolean, true) and coalesce((a.qc->>'ok')::boolean, true),
           'failures', coalesce(a.qc->'quality'->'failures', '[]'::jsonb),
           'media_checks_failed', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(coalesce(a.qc->'checks', '[]'::jsonb)) c
                                    where not coalesce((c->>'ok')::boolean, true)),
           'storyboard', a.qc->'quality'->'storyboard'->'metrics', 'rendered', a.qc->'quality'->'frames'->'metrics',
           'targets', coalesce(a.qc->'quality'->'frames'->'targets', a.qc->'quality'->'storyboard'->'targets'),
           'shots', a.shots) order by a.asset), '[]'::jsonb)
    from public.impact_story_assets a
   where a.job_id = (select j.id from public.impact_story_jobs j where j.story_id = p_story and j.kind = 'render'
                        and j.status = 'complete' order by j.completed_at desc limit 1)
$$;

create or replace function public.impact_fix_batch_claim(p_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.impact_story_fix_batches%rowtype; nxt text;
begin
  select * into b from public.impact_story_fix_batches where id = p_batch for update;
  if not found then raise exception 'no such batch' using errcode = 'P0002'; end if;
  nxt := case when b.status = 'plan_queued' then 'planning' when b.status = 'queued' then 'working'
              when b.status in ('planning', 'working') and b.claimed_at < now() - interval '3 hours' then b.status end;
  if nxt is null then
    raise exception 'batch is % and cannot be claimed', b.status using errcode = '55000';
  end if;
  if b.attempts >= 3 then
    update public.impact_story_fix_batches set status = 'failed', completed_at = now(),
           summary = 'Three attempts did not finish. Press Fix to try again.' where id = b.id;
    perform public._hs_is_event(b.story_id, 'fix_batch_failed', jsonb_build_object('batch', b.id, 'reason', 'attempts'), 'fixer');
    raise exception 'batch failed after 3 attempts' using errcode = '55000';
  end if;
  update public.impact_story_fix_batches set status = nxt, claimed_at = now(), attempts = attempts + 1 where id = b.id;
  perform public._hs_is_event(b.story_id, 'fix_batch_' || nxt, jsonb_build_object('batch', b.id, 'attempt', b.attempts + 1), 'fixer');
  return jsonb_build_object('ok', true, 'batch', b.id, 'story_id', b.story_id, 'requests', b.requests,
    'phase', case when nxt = 'planning' then 'plan' else 'work' end,
    'plan', case when nxt = 'working' then b.plan end, 'checks', public._hs_is_fix_checks(b.story_id));
end $$;

-- The plan run's report. p_plan: {summary, items: [{decision_id, understood, changes: [..], will_not}]}, one item per
-- request of the batch, in plain words. Stored as written; the md5 is what the founder confirms.
create or replace function public.impact_fix_batch_plan(p_batch uuid, p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.impact_story_fix_batches%rowtype; items jsonb := p_plan->'items';
begin
  select * into b from public.impact_story_fix_batches where id = p_batch for update;
  if not found then raise exception 'no such batch' using errcode = 'P0002'; end if;
  if b.status <> 'planning' then raise exception 'batch is %, not planning', b.status using errcode = '55000'; end if;
  if jsonb_typeof(p_plan) <> 'object' or nullif(btrim(p_plan->>'summary'), '') is null or char_length(p_plan->>'summary') > 1000 then
    raise exception 'the plan needs a summary of at most 1000 characters' using errcode = '22023';
  end if;
  if jsonb_typeof(items) <> 'array' or exists (select 1 from jsonb_array_elements(items) i
       where jsonb_typeof(i) <> 'object'
          or not (b.requests @> jsonb_build_array(jsonb_build_object('id', (i->>'decision_id')::bigint)))
          or nullif(btrim(i->>'understood'), '') is null or char_length(i->>'understood') > 500
          or jsonb_typeof(coalesce(i->'changes', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(i->'changes', '[]'::jsonb)) > 12
          or exists (select 1 from jsonb_array_elements(coalesce(i->'changes', '[]'::jsonb)) c
                      where jsonb_typeof(c) <> 'string' or btrim(c #>> '{}') = '' or char_length(c #>> '{}') > 400)
          or char_length(coalesce(i->>'will_not', '')) > 500
          or (jsonb_array_length(coalesce(i->'changes', '[]'::jsonb)) = 0 and nullif(btrim(i->>'will_not'), '') is null)) then
    raise exception 'each plan item names a request of this batch, says what was understood, and lists changes or why not' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(b.requests) r
              where (select count(*) from jsonb_array_elements(items) i where (i->>'decision_id')::bigint = (r->>'id')::bigint) <> 1) then
    raise exception 'the plan needs exactly one item per request' using errcode = '22023';
  end if;
  update public.impact_story_fix_batches set status = 'planned', plan = p_plan, plan_md5 = md5(p_plan::text), planned_at = now(),
         summary = null where id = b.id;
  perform public._hs_is_event(b.story_id, 'fix_plan_ready', jsonb_build_object('batch', b.id, 'plan_md5', md5(p_plan::text)), 'fixer');
  -- A batch the system started because videos failed their checks (_hs_is_auto_fix) is carried out at once: nobody is
  -- asked to read a plan for fixes they did not ask for (founder, 2026-11-07). The plan stays on the batch as the record
  -- of what was done. The founder's own notes are never in such a batch, so their plans still wait for a confirm.
  if b.requested_by = 'system:auto-fix' then
    update public.impact_story_fix_batches set status = 'queued', confirmed_at = now(), confirmed_by = 'system:auto-fix',
           attempts = 0, claimed_at = null where id = b.id;
    perform public._hs_is_event(b.story_id, 'fix_plan_confirmed', jsonb_build_object('batch', b.id, 'plan_md5', md5(p_plan::text), 'auto', true), 'system:auto-fix');
    perform public._hs_is_fix_dispatch(b.id, 'work');
    return jsonb_build_object('ok', true, 'plan_md5', md5(p_plan::text), 'confirmed', true);
  end if;
  return jsonb_build_object('ok', true, 'plan_md5', md5(p_plan::text));
end $$;

-- Finish a batch. p_payload: {status: done|needs_you|failed, summary, next_step, pr_url, regenerate: generate|analyze|pack|null,
-- outcomes: [{decision_id, outcome: fixed|needs_you|not_changed, note}]}. done/needs_you must account for every request.
-- regenerate queues that job on the story (as the Generate / Analyze buttons do) so the fixed script becomes a new version;
-- approving it and rendering stay with the founder. A plan run that could not write its plan finishes as failed.
create or replace function public.impact_fix_batch_complete(p_batch uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.impact_story_fix_batches%rowtype; st text := p_payload->>'status'; outs jsonb := coalesce(p_payload->'outcomes', '[]'::jsonb);
        regen text := nullif(p_payload->>'regenerate', ''); job jsonb;
begin
  select * into b from public.impact_story_fix_batches where id = p_batch for update;
  if not found then raise exception 'no such batch' using errcode = 'P0002'; end if;
  if b.status not in ('working', 'planning') then raise exception 'batch is %, not working', b.status using errcode = '55000'; end if;
  if st not in ('done', 'needs_you', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  if b.status = 'planning' and (st <> 'failed' or regen is not null) then
    raise exception 'a plan run can only finish as failed (a written plan is recorded with impact_fix_batch_plan)' using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'summary'), '') is null then raise exception 'say what was done' using errcode = '22023'; end if;
  if regen is not null and regen not in ('generate', 'analyze', 'pack') then raise exception 'bad regenerate' using errcode = '22023'; end if;
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
  if regen = 'pack' then
    -- research added documents to the source pack: check the sources again, then write the new version from them
    job := public._hs_is_queue(b.story_id, 'pack', jsonb_build_object('scope', 'all', 'then', 'generate'), 'fixer', true);
  elsif regen is not null then
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
    'public._hs_is_story_type(uuid)', 'public._hs_is_record_deadline(uuid)', 'public._hs_is_research_videos(uuid)',
    'public._hs_is_event(uuid, text, jsonb, text)', 'public._hs_is_dispatch(uuid)', 'public._hs_is_queue(uuid, text, jsonb, text, boolean)',
    'public._hs_is_retry(uuid, text)', 'public._hs_is_followup(uuid, text)', 'public._hs_is_append_only()', 'public._hs_is_version_guard()',
    'public._hs_is_stuck_after(text)', 'public._hs_is_media(uuid)', 'public._hs_is_not_started(public.impact_story_jobs)',
    'public._hs_is_request(uuid, text, text, boolean, text)', 'public._hs_is_choices(uuid)',
    'public._hs_is_fix_batch(uuid)', 'public._hs_is_fix_eligible(uuid)', 'public._hs_is_auto_fix(uuid, uuid)', 'public._hs_is_fix_dispatch(uuid, text)', 'public._hs_is_fix_checks(uuid)',
    'public._hs_is_line_notes(uuid)',
    'public._hs_is_choice_key(uuid)', 'public._hs_is_visuals(uuid)', 'public._hs_is_rejections(uuid)', 'public._hs_is_shot_decisions(bigint)',
    'public._hs_is_shot_print(jsonb)', 'public._hs_is_creator_hash(jsonb)', 'public._hs_is_creator_problems(jsonb)',
    'public._hs_is_creator_require(jsonb)', 'public._hs_is_creator_state(uuid)',
    'public._hs_is_visuals_changed(text, text, jsonb, text)', 'public._hs_is_currency_dismissed(uuid)'] loop
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
    'public.hs_impact_story_unchoose_asset(uuid, text, text)',
    'public.hs_impact_story_fix_start(uuid)', 'public.hs_impact_story_fix_confirm(uuid, uuid, text)', 'public.hs_impact_story_fix_cancel(uuid, uuid)',
    'public.hs_impact_story_visuals_prepare(uuid, integer, boolean)',
    'public.hs_impact_story_line_note(uuid, text, text, text, boolean)', 'public.hs_impact_story_line_note_withdraw(uuid, bigint)',
    'public.hs_impact_story_visuals_approve(uuid, bigint, text)', 'public.hs_impact_story_visuals_revoke(uuid, bigint, text)',
    'public.hs_impact_story_upload_photo(uuid, text, uuid, text, text, text, boolean, boolean)',
    'public.hs_impact_story_photo_reject(uuid, bigint, text, text)', 'public.hs_impact_story_photo_restore(uuid, text)',
    'public.hs_impact_story_shot_decide(uuid, bigint, text, text, text, text, text)',
    'public.hs_impact_story_shots_approve(uuid, bigint, text, text, _text)', 'public.hs_impact_story_photos_reject(uuid, bigint, _text, text)',
    'public.hs_impact_story_creator_revise(uuid, integer, jsonb, text)', 'public.hs_impact_story_creator_flag_decide(uuid, integer, text, text, text)',
    'public.hs_impact_story_creator_revision_withdraw(uuid, bigint)', 'public.hs_impact_story_currency_dismiss(uuid, _text)',
    'public.hs_impact_story_currency_update(uuid, _text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon';
    execute 'grant execute on function ' || f || ' to authenticated';
  end loop;
  foreach f in array array['public.hs_impact_story_job_claim(uuid)', 'public.hs_impact_story_job_fail(uuid, text, jsonb)',
                           'public.hs_impact_story_job_complete(uuid, jsonb)', 'public.impact_fix_batches_list()',
                           'public.impact_fix_batch_claim(uuid)', 'public.impact_fix_batch_complete(uuid, jsonb)', 'public.impact_fix_batch_plan(uuid, jsonb)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
end $$;

commit;
