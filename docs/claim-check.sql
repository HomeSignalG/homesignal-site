-- TAB 19 · DATA CENTER CLAIM CHECK (2026-10-30). Requires docs/impact-stories.sql (for public._hs_is_admin).
--
-- What people say about data centers, against what documented evidence shows.
--
-- Chain:
--   pg_cron claim-check-tick (every 15 min) or the founder's Scan Now
--     -> a row in claim_check_scans -> pg_net dispatch of homesignal-ingest `claim-check-scan.yml`
--     -> claimcheck/scan.py reads the configured broadcaster YouTube channels, searches YouTube for each watched person,
--        searches Bluesky, scores, clusters, and reports through claim_check_scan_claim / _record / _finish.
--   The founder (or a scan) asks for research on a claim -> claim_check_research_runs -> dispatch of
--     `claim-check-research-run.yml` (Claude Code on the founder's plan, no paid API, no database key in the research step)
--     -> claimcheck/research.py validates the result -> claim_check_research_record.
--   The founder reviews in Tab 19 and approves, edits, skips, rejects, or asks for more research.
--   An APPROVED claim check becomes a public page at /fact-checks/<slug>/ on the next site build, through
--   claim_check_public_export() (the only reader the build uses).
--
-- GUARANTEES (each pinned by test/claim_check_pg/suite.sql):
--   * additive: new tables and functions only; nothing existing is altered;
--   * every table is RLS-on with no grants; the browser reaches data only through admin-gated SECURITY DEFINER functions;
--     everything the runner and the research session call is service_role only; the public export returns approved
--     claim checks only, never a candidate, never a provisional verdict;
--   * popularity never decides a verdict: the scanner writes candidates with a score and NO verdict; only a research record
--     that passed the server-side checks can set one;
--   * a False or Misleading verdict needs at least one contradicting evidence item with an http(s) source, a quote whose
--     words were found verbatim in a cited document (quote_verified), and a named speaker; approval re-checks all of it;
--   * Bluesky: Claim Check posts SHARE the MAPS and video times (founder, 2026-10-30): still 2 MAPS + 2 video times a day,
--     at most 4 posts, 150 minutes apart. 'schedule' asks public.bsky_next_slot_any() for the next free time of either kind,
--     and is refused until homesignal-ingest migration 20261030180000 (which defines it and books claim posts in
--     bsky_booked) sets claim_check_settings.bsky_slots_enabled. The publisher (bluesky/publish-worker.mjs) posts them;
--   * a failed scan stores its error and NO new rows; adapter status is written from the run's real outcome only;
--   * decisions and research versions are append-only; a correction or retraction keeps the page and its history.
begin;

-- ── settings (one row) ───────────────────────────────────────────────────────────────────────────────
create table if not exists public.claim_check_settings (
  id                   boolean primary key default true check (id),
  scan_enabled         boolean not null default true,
  scan_times           text[]  not null default array['07:30', '16:30'],
  scan_tz              text    not null default 'America/Los_Angeles',
  window_days          integer not null default 14 check (window_days between 1 and 90),
  -- Trending Claim Score weights, as the founder's brief set them. They must sum to 1.
  weights              jsonb   not null default '{"shares":0.30,"comments":0.25,"acceleration":0.20,"cross_platform":0.15,"recency":0.10}',
  trending_score       integer not null default 60 check (trending_score between 0 and 100),
  emerging_significance integer not null default 60 check (emerging_significance between 0 and 100),
  bsky_slots_enabled   boolean not null default false,   -- set only by the founder's schedule decision
  updated_at           timestamptz not null default now(),
  constraint claim_check_weights_sum check (
    abs(coalesce((weights->>'shares')::numeric,0) + coalesce((weights->>'comments')::numeric,0)
      + coalesce((weights->>'acceleration')::numeric,0) + coalesce((weights->>'cross_platform')::numeric,0)
      + coalesce((weights->>'recency')::numeric,0) - 1) < 0.001)
);
insert into public.claim_check_settings (id) values (true) on conflict (id) do nothing;

-- ── People to Watch ──────────────────────────────────────────────────────────────────────────────────
-- Priority affects how often and how widely the scanner looks for a person; it never affects a verdict.
create table if not exists public.claim_check_people (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name          text not null check (length(btrim(name)) between 2 and 120),
  organization  text,
  role          text,
  aliases       text[] not null default '{}',
  priority      smallint not null default 2 check (priority between 1 and 3),   -- 1 = highest
  status        text not null default 'active' check (status in ('active', 'suggested', 'removed')),
  origin        text not null default 'founder' check (origin in ('founder', 'scanner', 'seed')),
  reason        text,                         -- why the scanner suggested this person (appearances it counted)
  appearances   integer not null default 0,
  added_by      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
insert into public.claim_check_people (slug, name, organization, role, aliases, priority, status, origin, added_by)
values ('kevin-oleary', 'Kevin O''Leary', 'O''Leary Ventures', 'Investor; Shark Tank', array['Kevin O''Leary', 'Mr. Wonderful'],
        1, 'active', 'seed', 'founder brief 2026-10-30')
on conflict (slug) do nothing;

-- ── source adapters: one row per thing the scanner reads; status is written from real runs only ──────────
create table if not exists public.claim_check_adapters (
  key          text primary key,
  label        text not null,
  status       text not null default 'not_run' check (status in ('operational', 'degraded', 'restricted', 'unavailable', 'not_run', 'not_built')),
  detail       text,
  last_run_at  timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  stats        jsonb not null default '{}'
);
insert into public.claim_check_adapters (key, label, status, detail) values
  ('youtube_broadcasters', 'Broadcaster YouTube channels (uploads)', 'not_run', 'Reads each configured channel''s recent uploads through the YouTube Data API.'),
  ('youtube_people', 'YouTube search for People to Watch', 'not_run', 'One YouTube search per watched person per scan.'),
  ('bluesky', 'Bluesky search', 'not_run', 'app.bsky.feed.searchPosts with the HomeSignal account.'),
  ('transcripts', 'Transcripts and captions', 'not_built', 'YouTube captions can be downloaded only by the channel owner, so the scanner reads none. Research finds a published transcript or article quoting the words.'),
  ('x', 'X (Twitter)', 'not_built', 'Needs a paid X API plan. Not read.'),
  ('tiktok', 'TikTok', 'not_built', 'No research API access. Not read.'),
  ('reddit', 'Reddit', 'not_built', 'Not built yet.'),
  ('local_tv', 'Local TV station websites', 'not_built', 'Only stations whose YouTube channel is configured are read.')
on conflict (key) do nothing;

-- ── scans ─────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.claim_check_scans (
  id            uuid primary key default gen_random_uuid(),
  trigger       text not null check (trigger in ('scheduled', 'manual')),
  slot_key      text unique,                  -- scheduled scans: one per slot
  status        text not null default 'queued' check (status in ('queued', 'running', 'ok', 'partial', 'failed')),
  requested_by  text,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  stats         jsonb not null default '{}',
  errors        jsonb not null default '[]'
);

-- ── footage and posts the scanner found ─────────────────────────────────────────────────────────────────
create table if not exists public.claim_check_sources (
  id               uuid primary key default gen_random_uuid(),
  source_key       text not null unique check (source_key ~ '^(youtube|bsky|web):[A-Za-z0-9_:./=@-]+$'),
  platform         text not null check (platform in ('youtube', 'bluesky', 'web')),
  publisher        text,                      -- e.g. "Fox Business" (the channel title, as published)
  channel_id       text,
  program          text,
  url              text not null check (url ~ '^https://'),
  embed_url        text check (embed_url is null or embed_url ~ '^https://(www\.youtube-nocookie\.com|www\.youtube\.com)/embed/'),
  thumbnail_url    text check (thumbnail_url is null or thumbnail_url ~ '^https://'),
  title            text,
  description      text,
  author           text,                      -- Bluesky handle
  published_at     timestamptz,
  duration_s       integer,
  -- what we may do with the media; 'embed_only' = show the publisher's own player, never copy the file
  rights           text not null default 'unresolved' check (rights in ('reuse_authorized', 'embed_only', 'link_only', 'unresolved', 'unavailable')),
  transcript_status text not null default 'not_read' check (transcript_status in ('not_read', 'published_transcript', 'authorized_captions', 'unavailable')),
  metrics          jsonb not null default '{}',   -- what the platform reported; a missing count is absent, never 0
  metrics_prev     jsonb,
  metrics_at       timestamptz,
  metrics_prev_at  timestamptz,
  person_ids       uuid[] not null default '{}',
  adapter          text not null,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  scan_id          uuid references public.claim_check_scans(id)
);
create index if not exists claim_check_sources_seen on public.claim_check_sources (last_seen_at desc);

-- ── claims ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.claim_check_claims (
  id                 uuid primary key default gen_random_uuid(),
  claim_key          text not null unique,     -- cluster key from the scanner (dedupes one claim across platforms)
  status             text not null default 'candidate' check (status in (
                       'candidate', 'needs_research', 'researching', 'research_ready', 'approved', 'skipped', 'rejected')),
  lane               text not null default 'emerging' check (lane in ('trending', 'emerging')),
  topic              text not null,            -- what the source is about, in the scanner's words; never a quote
  speaker_name       text,
  person_id          uuid references public.claim_check_people(id),
  place              text,                     -- metadata only, never a ranking input
  source_ids         uuid[] not null default '{}',
  trend_score        integer check (trend_score between 0 and 100),
  score_parts        jsonb not null default '{}',
  score_confidence   text check (score_confidence in ('high', 'medium', 'low')),
  significance       integer check (significance between 0 and 100),
  reasons            jsonb not null default '[]',
  -- set only by a research record that passed the checks
  quote              text,
  quote_verified     boolean not null default false,
  quote_source_url   text,
  timestamp_s        integer check (timestamp_s >= 0),
  context            text,
  assertion          text,
  verdict            text check (verdict in ('false', 'misleading', 'accurate', 'needs_context', 'unverified')),
  verdict_explanation text,
  evidence           jsonb not null default '{"supporting":[],"contradicting":[]}',
  evidence_gaps      text,
  research_version   integer not null default 0,
  headline           text,
  post_text          text,
  slug               text unique check (slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  approved_at        timestamptz,
  approved_by        text,
  public_state       text not null default 'none' check (public_state in ('none', 'published', 'corrected', 'retracted')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Bluesky (founder 2026-10-30: Claim Check posts SHARE the MAPS and video times; no time is added). The slot and its
  -- kind are chosen by public.bsky_next_slot_any() (homesignal-ingest 20261030180000), the one schedule authority.
  bsky_status        text not null default 'none' check (bsky_status in ('none', 'scheduled', 'publishing', 'published', 'failed')),
  bsky_slot_kind     text check (bsky_slot_kind in ('maps', 'video')),
  scheduled_slot     timestamptz,
  bsky_uri           text,
  bsky_cid           text,
  published_at       timestamptz,
  bsky_error         text,
  constraint claim_check_verdict_needs_research check (verdict is null or research_version > 0),
  constraint claim_check_approved_has_slug check (status <> 'approved' or (slug is not null and verdict is not null and approved_at is not null)),
  constraint claim_check_public_needs_approval check (public_state = 'none' or approved_at is not null)
);
create index if not exists claim_check_claims_status on public.claim_check_claims (status, trend_score desc nulls last);
-- columns added after the first version (re-apply safe)
alter table public.claim_check_claims add column if not exists bsky_status text not null default 'none';
alter table public.claim_check_claims add column if not exists bsky_slot_kind text;
alter table public.claim_check_claims add column if not exists scheduled_slot timestamptz;
alter table public.claim_check_claims add column if not exists bsky_uri text;
alter table public.claim_check_claims add column if not exists bsky_cid text;
alter table public.claim_check_claims add column if not exists published_at timestamptz;
alter table public.claim_check_claims add column if not exists bsky_error text;
-- A scan stops listing a stored candidate it no longer finds checkable (ingest claimcheck/score.checkable); the row stays.
alter table public.claim_check_claims add column if not exists listed boolean not null default true;
create unique index if not exists claim_check_one_per_slot on public.claim_check_claims (scheduled_slot) where bsky_status in ('scheduled', 'publishing', 'published');

-- research versions (append-only)
create table if not exists public.claim_check_research (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claim_check_claims(id),
  version     integer not null,
  body        jsonb not null,
  checks      jsonb not null default '{}',
  run_id      uuid,
  created_at  timestamptz not null default now(),
  unique (claim_id, version)
);

-- research runs (one active per claim)
create table if not exists public.claim_check_research_runs (
  id            uuid primary key default gen_random_uuid(),
  claim_id      uuid not null references public.claim_check_claims(id),
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  note          text,
  requested_by  text,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  finished_at   timestamptz,
  error         text
);
create unique index if not exists claim_check_one_active_run on public.claim_check_research_runs (claim_id) where status in ('queued', 'running');

-- founder decisions (append-only)
create table if not exists public.claim_check_decisions (
  id               uuid primary key default gen_random_uuid(),
  claim_id         uuid not null references public.claim_check_claims(id),
  action           text not null check (action in ('approve', 'edit', 'request_research', 'skip', 'reject', 'restore',
                                                    'schedule', 'unschedule', 'correct', 'retract')),
  note             text,
  edits            jsonb,
  research_version integer not null,
  actor            text not null,
  created_at       timestamptz not null default now()
);

create or replace function public._cc_append_only() returns trigger language plpgsql as $$
begin raise exception '% is append-only', tg_table_name using errcode = '42501'; end $$;
drop trigger if exists claim_check_research_append_only on public.claim_check_research;
create trigger claim_check_research_append_only before update or delete on public.claim_check_research
  for each row execute function public._cc_append_only();
drop trigger if exists claim_check_decisions_append_only on public.claim_check_decisions;
create trigger claim_check_decisions_append_only before update or delete on public.claim_check_decisions
  for each row execute function public._cc_append_only();

do $$ declare t text; begin
  foreach t in array array['claim_check_settings', 'claim_check_people', 'claim_check_adapters', 'claim_check_scans',
    'claim_check_sources', 'claim_check_claims', 'claim_check_research', 'claim_check_research_runs', 'claim_check_decisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- ── helpers ───────────────────────────────────────────────────────────────────────────────────────────
create or replace function public._cc_slugify(p text) returns text language sql immutable as $$
  select nullif(left(trim(both '-' from regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', '-', 'g')), 70), '') $$;

-- The checks a research body must pass. Returns an array of problems (empty = pass). Mirrors claimcheck/research.py.
create or replace function public._cc_research_problems(b jsonb) returns jsonb language plpgsql immutable as $$
declare p text[] := '{}'; v text := b->>'verdict'; e jsonb; nc int := 0;
begin
  if v is null or v not in ('false', 'misleading', 'accurate', 'needs_context', 'unverified') then p := array_append(p, 'verdict must be one of false, misleading, accurate, needs_context, unverified'); end if;
  if length(btrim(coalesce(b->>'speaker_name', ''))) < 2 then p := array_append(p, 'speaker_name is required'); end if;
  if length(btrim(coalesce(b->>'quote', ''))) < 8 then p := array_append(p, 'quote is required (the exact words)'); end if;
  if length(btrim(coalesce(b->>'assertion', ''))) < 8 then p := array_append(p, 'assertion is required (the testable factual claim)'); end if;
  if length(btrim(coalesce(b->>'verdict_explanation', ''))) < 20 then p := array_append(p, 'verdict_explanation is required'); end if;
  if jsonb_typeof(b->'evidence'->'supporting') is distinct from 'array' or jsonb_typeof(b->'evidence'->'contradicting') is distinct from 'array' then
    p := array_append(p, 'evidence.supporting and evidence.contradicting must both be arrays (empty is allowed)');
  else
    for e in select * from jsonb_array_elements((b->'evidence'->'supporting') || (b->'evidence'->'contradicting')) loop
      if coalesce(e->>'url', '') !~ '^https?://' then p := array_append(p, ('evidence item without an http(s) url: ' || left(coalesce(e->>'title', '?'), 60))); end if;
      if length(btrim(coalesce(e->>'finding', ''))) < 8 then p := array_append(p, ('evidence item without a finding: ' || left(coalesce(e->>'url', '?'), 80))); end if;
    end loop;
    nc := jsonb_array_length(b->'evidence'->'contradicting');
  end if;
  if v in ('false', 'misleading') then
    if nc < 1 then p := array_append(p, 'a false or misleading verdict needs at least one contradicting evidence item'); end if;
    if coalesce((b->>'quote_verified')::boolean, false) is not true then
      p := array_append(p, 'a false or misleading verdict needs the quote found word for word in a cited document (quote_verified)'); end if;
  end if;
  if v = 'accurate' and jsonb_array_length(coalesce(b->'evidence'->'supporting', '[]')) < 1 then
    p := array_append(p, 'an accurate verdict needs at least one supporting evidence item'); end if;
  if coalesce((b->>'quote_verified')::boolean, false) and coalesce(b->>'quote_source_url', '') !~ '^https?://' then
    p := array_append(p, 'quote_verified needs quote_source_url'); end if;
  if b ? 'post_text' and char_length(coalesce(b->>'post_text', '')) > 300 then p := array_append(p, 'post_text is over 300 characters'); end if;
  return to_jsonb(p);
end $$;

create or replace function public._cc_dispatch(p_workflow text, p_inputs jsonb) returns boolean
language plpgsql security definer set search_path to 'public', 'extensions', 'net', 'vault', 'pg_temp' as $$
declare _pat text;
begin
  if p_workflow not in ('claim-check-scan.yml', 'claim-check-research-run.yml') then raise exception 'unknown workflow'; end if;
  select decrypted_secret into _pat from vault.decrypted_secrets where name = 'github_actions_pat';
  if _pat is null or btrim(_pat) = '' then return false; end if;
  perform net.http_post(
    url := 'https://api.github.com/repos/HomeSignalG/homesignal-ingest/actions/workflows/' || p_workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', p_inputs),
    headers := jsonb_build_object('Authorization', 'Bearer ' || _pat, 'Accept', 'application/vnd.github+json',
              'X-GitHub-Api-Version', '2022-11-28', 'User-Agent', 'homesignal-claim-check', 'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
  return true;
end $$;

create or replace function public._cc_claim_json(c public.claim_check_claims, p_full boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', c.id, 'status', c.status, 'lane', c.lane, 'topic', c.topic, 'speaker_name', c.speaker_name, 'person_id', c.person_id,
    'person_name', (select p.name from public.claim_check_people p where p.id = c.person_id),
    'place', c.place, 'trend_score', c.trend_score, 'score_parts', c.score_parts, 'score_confidence', c.score_confidence,
    'significance', c.significance, 'reasons', c.reasons, 'quote', c.quote, 'quote_verified', c.quote_verified,
    'quote_source_url', c.quote_source_url, 'timestamp_s', c.timestamp_s, 'assertion', c.assertion, 'verdict', c.verdict,
    'verdict_explanation', c.verdict_explanation, 'research_version', c.research_version, 'headline', c.headline,
    'post_text', c.post_text, 'slug', c.slug, 'public_state', c.public_state, 'approved_at', c.approved_at,
    'bsky_status', c.bsky_status, 'bsky_slot_kind', c.bsky_slot_kind, 'scheduled_slot', c.scheduled_slot, 'bsky_uri', c.bsky_uri,
    'published_at', c.published_at, 'bsky_error', c.bsky_error,
    'created_at', c.created_at, 'updated_at', c.updated_at,
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'source_key', s.source_key, 'platform', s.platform, 'publisher', s.publisher,
        'program', s.program, 'url', s.url, 'embed_url', s.embed_url, 'thumbnail_url', s.thumbnail_url, 'title', s.title,
        'author', s.author, 'published_at', s.published_at, 'rights', s.rights, 'transcript_status', s.transcript_status,
        'metrics', s.metrics, 'duration_s', s.duration_s) order by s.published_at), '[]'::jsonb)
        from public.claim_check_sources s where s.id = any(c.source_ids)),
    'research_active', (select r.status from public.claim_check_research_runs r where r.claim_id = c.id and r.status in ('queued', 'running') limit 1))
  || case when p_full then jsonb_build_object(
    'context', c.context, 'evidence', c.evidence, 'evidence_gaps', c.evidence_gaps,
    'research', (select coalesce(jsonb_agg(jsonb_build_object('version', r.version, 'checks', r.checks, 'created_at', r.created_at) order by r.version desc), '[]'::jsonb)
                   from public.claim_check_research r where r.claim_id = c.id),
    'runs', (select coalesce(jsonb_agg(jsonb_build_object('status', r.status, 'note', r.note, 'error', r.error, 'created_at', r.created_at,
                     'finished_at', r.finished_at) order by r.created_at desc), '[]'::jsonb) from public.claim_check_research_runs r where r.claim_id = c.id),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('action', d.action, 'note', d.note, 'actor', d.actor,
                     'research_version', d.research_version, 'created_at', d.created_at) order by d.created_at desc), '[]'::jsonb)
                   from public.claim_check_decisions d where d.claim_id = c.id)) else '{}'::jsonb end $$;

-- ── admin readers (Tab 19) ─────────────────────────────────────────────────────────────────────────────
create or replace function public.hs_claim_check_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin(); st public.claim_check_settings%rowtype;
begin
  select * into st from public.claim_check_settings;
  return jsonb_build_object(
    'generated_at', now(),
    'settings', to_jsonb(st),
    'adapters', (select coalesce(jsonb_agg(to_jsonb(a) order by a.key), '[]'::jsonb) from public.claim_check_adapters a),
    'last_scan', (select to_jsonb(s) from public.claim_check_scans s order by s.created_at desc limit 1),
    'counts', (select jsonb_object_agg(x.status, x.n) from (select status, count(*) n from public.claim_check_claims group by status) x),
    'trending', (select coalesce(jsonb_agg(public._cc_claim_json(c) order by c.trend_score desc nulls last), '[]'::jsonb) from (
        select * from public.claim_check_claims where lane = 'trending' and status in ('candidate', 'needs_research', 'researching')
           and (listed or status <> 'candidate')
         order by trend_score desc nulls last limit 50) c),
    'emerging', (select coalesce(jsonb_agg(public._cc_claim_json(c) order by c.significance desc nulls last, c.created_at desc), '[]'::jsonb) from (
        select * from public.claim_check_claims where lane = 'emerging' and status in ('candidate', 'needs_research', 'researching')
           and (listed or status <> 'candidate')
         order by significance desc nulls last, created_at desc limit 50) c),
    'review', (select coalesce(jsonb_agg(public._cc_claim_json(c) order by c.updated_at desc), '[]'::jsonb) from (
        select * from public.claim_check_claims where status in ('research_ready', 'approved') order by updated_at desc limit 50) c),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'organization', p.organization,
        'role', p.role, 'aliases', p.aliases, 'priority', p.priority, 'status', p.status, 'origin', p.origin, 'reason', p.reason,
        'appearances', p.appearances,
        'sources', (select count(*) from public.claim_check_sources s where p.id = any(s.person_ids)),
        'claims_open', (select count(*) from public.claim_check_claims c where c.person_id = p.id and c.status in ('candidate', 'needs_research', 'researching', 'research_ready')),
        'claims_published', (select count(*) from public.claim_check_claims c where c.person_id = p.id and c.public_state <> 'none'),
        'recent', (select coalesce(jsonb_agg(jsonb_build_object('title', s.title, 'url', s.url, 'publisher', s.publisher,
             'thumbnail_url', s.thumbnail_url, 'published_at', s.published_at) order by s.published_at desc nulls last), '[]'::jsonb)
             from (select * from public.claim_check_sources s where p.id = any(s.person_ids) order by s.published_at desc nulls last limit 5) s))
        order by p.status, p.priority, p.name), '[]'::jsonb) from public.claim_check_people p where p.status <> 'removed'),
    'footage', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'platform', s.platform, 'publisher', s.publisher,
        'url', s.url, 'embed_url', s.embed_url, 'thumbnail_url', s.thumbnail_url, 'title', s.title, 'published_at', s.published_at,
        'duration_s', s.duration_s, 'rights', s.rights, 'transcript_status', s.transcript_status, 'metrics', s.metrics,
        'claims', (select count(*) from public.claim_check_claims c where s.id = any(c.source_ids))) order by s.published_at desc nulls last), '[]'::jsonb)
        from (select * from public.claim_check_sources where platform = 'youtube' order by published_at desc nulls last limit 120) s),
    'published', (select coalesce(jsonb_agg(public._cc_claim_json(c) order by c.approved_at desc), '[]'::jsonb)
        from public.claim_check_claims c where c.public_state <> 'none'),
    'analytics', public._cc_analytics());
end $$;

create or replace function public._cc_analytics() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; touch jsonb := null;
begin
  r := jsonb_build_object(
    'videos_discovered', (select count(*) from public.claim_check_sources where platform = 'youtube'),
    'posts_discovered', (select count(*) from public.claim_check_sources where platform = 'bluesky'),
    'claims_found', (select count(*) from public.claim_check_claims),
    'claims_researched', (select count(*) from public.claim_check_claims where research_version > 0),
    'verdicts', (select coalesce(jsonb_object_agg(v, n), '{}'::jsonb) from (select verdict v, count(*) n from public.claim_check_claims where verdict is not null group by verdict) x),
    'rejected', (select count(*) from public.claim_check_claims where status in ('rejected', 'skipped')),
    'published', (select count(*) from public.claim_check_claims where public_state <> 'none'),
    'corrections', (select count(*) from public.claim_check_decisions where action in ('correct', 'retract')),
    'median_hours_found_to_approved', (select round(extract(epoch from percentile_cont(0.5) within group (order by approved_at - created_at)) / 3600.0, 1)
                                         from public.claim_check_claims where approved_at is not null));
  if to_regclass('public.acquisition_touch') is not null then
    execute $q$select jsonb_build_object(
        'visitors', count(distinct visitor_id) filter (where subject_type = 'visitor'),
        'registrations', count(*) filter (where subject_type = 'account'),
        -- keyed by utm_content: the claim's id on Bluesky links (the publisher's tag), or its slug on links made by hand
        'by_content', coalesce((select jsonb_object_agg(k, n) from (select utm_content k, count(distinct visitor_id) n from public.acquisition_touch
             where utm_campaign = 'claim-check' and subject_type = 'visitor' and utm_content is not null and not is_internal group by utm_content) z), '{}'::jsonb))
      from public.acquisition_touch where utm_campaign = 'claim-check' and not is_internal$q$ into touch;
  end if;
  return r || jsonb_build_object('site', coalesce(touch, '"not_collected"'::jsonb),
    'unavailable', jsonb_build_array(
      'Bluesky likes, reposts and replies on Claim Check posts: not collected yet.',
      'Impressions: Bluesky publishes none.',
      'Paid conversions credited to a claim check: not attributed yet.'));
end $$;

create or replace function public.hs_claim_check_claim(p_claim uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e text := public._hs_is_admin(); c public.claim_check_claims%rowtype;
begin
  select * into c from public.claim_check_claims where id = p_claim;
  if not found then raise exception 'no such claim' using errcode = 'P0002'; end if;
  return public._cc_claim_json(c, true);
end $$;

-- ── founder actions ───────────────────────────────────────────────────────────────────────────────────
create or replace function public.hs_claim_check_decide(p_claim uuid, p_action text, p_note text default null,
                                                        p_edits jsonb default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); c public.claim_check_claims%rowtype; probs jsonb; nt text := nullif(btrim(coalesce(p_note, '')), '');
        st public.claim_check_settings%rowtype; run_id uuid; base text; n int := 0; sent boolean; k text; ns timestamptz;
begin
  select * into c from public.claim_check_claims where id = p_claim for update;
  if not found then raise exception 'no such claim' using errcode = 'P0002'; end if;
  if p_expected_version is not null and p_expected_version <> c.research_version then
    raise exception 'This claim check changed since you opened it (research version % is now %). Reload it.', p_expected_version, c.research_version using errcode = '40001';
  end if;
  if p_action = 'approve' then
    if c.status <> 'research_ready' then raise exception 'Only researched claim checks can be approved (this one is %).', c.status using errcode = '55000'; end if;
    probs := public._cc_research_problems(jsonb_build_object('verdict', c.verdict, 'speaker_name', c.speaker_name, 'quote', c.quote,
      'assertion', c.assertion, 'verdict_explanation', c.verdict_explanation, 'evidence', c.evidence, 'quote_verified', c.quote_verified,
      'quote_source_url', c.quote_source_url, 'post_text', coalesce(c.post_text, '')));
    if jsonb_array_length(probs) > 0 then raise exception 'Not approvable: %', probs::text using errcode = '55000'; end if;
    if length(btrim(coalesce(c.headline, ''))) < 8 then raise exception 'Write a headline before approving.' using errcode = '55000'; end if;
    if c.slug is null then
      base := coalesce(public._cc_slugify(c.speaker_name || ' ' || coalesce(c.headline, c.topic)), 'claim-check');
      c.slug := base;
      while exists (select 1 from public.claim_check_claims where slug = c.slug and id <> c.id) loop n := n + 1; c.slug := base || '-' || n; end loop;
    end if;
    update public.claim_check_claims set status = 'approved', slug = c.slug, approved_at = now(), approved_by = e,
      public_state = case when public_state = 'none' then 'published' else public_state end, updated_at = now() where id = c.id;
  elsif p_action = 'edit' then
    if c.status not in ('research_ready', 'approved') then raise exception 'Only researched claim checks can be edited.' using errcode = '55000'; end if;
    if p_edits is null or not (p_edits ?| array['headline', 'post_text']) then raise exception 'Nothing to edit.' using errcode = '22023'; end if;
    if p_edits ? 'post_text' and char_length(coalesce(p_edits->>'post_text', '')) > 300 then raise exception 'The post is over 300 characters.' using errcode = '22023'; end if;
    if p_edits ? 'headline' and length(btrim(coalesce(p_edits->>'headline', ''))) < 8 then raise exception 'The headline is too short.' using errcode = '22023'; end if;
    -- an edit after approval needs approving again; a published page keeps showing the approved text until then
    if c.bsky_status in ('publishing', 'published') then raise exception 'This post is already on Bluesky. Publish a correction instead.' using errcode = '55000'; end if;
    -- edited text was never approved, so a booked Bluesky time is released until it is approved and scheduled again
    update public.claim_check_claims set headline = coalesce(p_edits->>'headline', headline), post_text = coalesce(p_edits->>'post_text', post_text),
      status = 'research_ready', bsky_status = 'none', bsky_slot_kind = null, scheduled_slot = null, updated_at = now() where id = c.id;
  elsif p_action = 'request_research' then
    if nt is null then raise exception 'Say what to research.' using errcode = '22023'; end if;
    if c.public_state <> 'none' then raise exception 'This claim check is published. Use Correct instead.' using errcode = '55000'; end if;
    if c.status in ('rejected') then raise exception 'Restore it first.' using errcode = '55000'; end if;
    select id into run_id from public.claim_check_research_runs where claim_id = c.id and status in ('queued', 'running');
    if run_id is null then
      insert into public.claim_check_research_runs (claim_id, note, requested_by) values (c.id, nt, e) returning id into run_id;
    end if;
    update public.claim_check_claims set status = 'needs_research', updated_at = now() where id = c.id;
    sent := public._cc_dispatch('claim-check-research-run.yml', jsonb_build_object('run', run_id::text));
    if not sent then
      update public.claim_check_research_runs set status = 'failed', finished_at = now(),
        error = 'No GitHub credential is stored, so research could not start. Nothing was lost.' where id = run_id;
    end if;
  elsif p_action in ('skip', 'reject') then
    if c.public_state <> 'none' then raise exception 'This claim check is published. Use Retract instead.' using errcode = '55000'; end if;
    if p_action = 'reject' and nt is null then raise exception 'Say why it is rejected.' using errcode = '22023'; end if;
    update public.claim_check_claims set status = case p_action when 'skip' then 'skipped' else 'rejected' end, updated_at = now() where id = c.id;
  elsif p_action = 'restore' then
    if c.status not in ('skipped', 'rejected') then raise exception 'Only skipped or rejected claims can be restored.' using errcode = '55000'; end if;
    update public.claim_check_claims set status = case when research_version > 0 then 'research_ready' else 'candidate' end, updated_at = now() where id = c.id;
  elsif p_action = 'schedule' then
    select * into st from public.claim_check_settings;
    if not st.bsky_slots_enabled then
      raise exception 'Claim Check posts cannot be scheduled yet: the schedule change that lets them share the MAPS and video times is not applied.' using errcode = '55000';
    end if;
    if c.status <> 'approved' or c.public_state not in ('published', 'corrected') then
      raise exception 'Only an approved, public claim check can be posted.' using errcode = '55000';
    end if;
    if c.bsky_status in ('scheduled', 'publishing', 'published') then
      raise exception 'This claim check is already %.', c.bsky_status using errcode = '55000';
    end if;
    if char_length(coalesce(c.post_text, '')) < 10 then raise exception 'Write the Bluesky post first.' using errcode = '55000'; end if;
    -- the ONE schedule authority picks the next free MAPS or video time (whichever comes first)
    select x.kind, x.slot into k, ns from public.bsky_next_slot_any(now()) x;
    update public.claim_check_claims set bsky_status = 'scheduled', bsky_slot_kind = k, scheduled_slot = ns, bsky_error = null,
      bsky_uri = null, updated_at = now() where id = c.id;
  elsif p_action = 'unschedule' then
    if c.bsky_status <> 'scheduled' then raise exception 'Only a scheduled post can be taken off the schedule.' using errcode = '55000'; end if;
    update public.claim_check_claims set bsky_status = 'none', bsky_slot_kind = null, scheduled_slot = null, updated_at = now() where id = c.id;
  elsif p_action in ('correct', 'retract') then
    if c.public_state = 'none' then raise exception 'Only a published claim check can be corrected or retracted.' using errcode = '55000'; end if;
    if nt is null then raise exception 'Write the correction notice readers will see.' using errcode = '22023'; end if;
    update public.claim_check_claims set public_state = case p_action when 'correct' then 'corrected' else 'retracted' end,
      -- a retracted claim check never goes out on Bluesky; one already posted stays posted (its page carries the retraction)
      bsky_status = case when p_action = 'retract' and bsky_status = 'scheduled' then 'none' else bsky_status end,
      scheduled_slot = case when p_action = 'retract' and bsky_status = 'scheduled' then null else scheduled_slot end,
      bsky_slot_kind = case when p_action = 'retract' and bsky_status = 'scheduled' then null else bsky_slot_kind end,
      updated_at = now() where id = c.id;
  else
    raise exception 'unknown action %', p_action using errcode = '22023';
  end if;
  insert into public.claim_check_decisions (claim_id, action, note, edits, research_version, actor)
    values (c.id, p_action, nt, p_edits, c.research_version, e);
  select * into c from public.claim_check_claims where id = p_claim;
  return public._cc_claim_json(c, true);
end $$;

create or replace function public.hs_claim_check_person_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); r public.claim_check_people%rowtype; nm text := btrim(coalesce(p->>'name', ''));
begin
  if length(nm) < 2 then raise exception 'A name is required.' using errcode = '22023'; end if;
  if coalesce(p->>'priority', '2') !~ '^[123]$' then raise exception 'Priority is 1, 2 or 3.' using errcode = '22023'; end if;
  if p ? 'id' and p->>'id' is not null then
    update public.claim_check_people set name = nm, organization = nullif(btrim(coalesce(p->>'organization', '')), ''),
      role = nullif(btrim(coalesce(p->>'role', '')), ''), priority = (p->>'priority')::smallint,
      aliases = coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p->'aliases', '[]')) x where btrim(x) <> ''), '{}'),
      status = case when status = 'suggested' then 'active' else status end, updated_at = now()
     where id = (p->>'id')::uuid returning * into r;
    if not found then raise exception 'no such person' using errcode = 'P0002'; end if;
  else
    insert into public.claim_check_people (slug, name, organization, role, aliases, priority, status, origin, added_by)
    values (public._cc_slugify(nm), nm, nullif(btrim(coalesce(p->>'organization', '')), ''), nullif(btrim(coalesce(p->>'role', '')), ''),
            coalesce(array(select btrim(x) from jsonb_array_elements_text(coalesce(p->'aliases', '[]')) x where btrim(x) <> ''), '{}'),
            (p->>'priority')::smallint, 'active', 'founder', e)
    on conflict (slug) do update set status = 'active', priority = excluded.priority, updated_at = now()
    returning * into r;
  end if;
  return to_jsonb(r);
end $$;

create or replace function public.hs_claim_check_person_status(p_person uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); r public.claim_check_people%rowtype;
begin
  if p_status not in ('active', 'removed') then raise exception 'status is active or removed' using errcode = '22023'; end if;
  update public.claim_check_people set status = p_status, updated_at = now() where id = p_person returning * into r;
  if not found then raise exception 'no such person' using errcode = 'P0002'; end if;
  return to_jsonb(r);
end $$;

create or replace function public.hs_claim_check_scan_now() returns jsonb
language plpgsql security definer set search_path = public as $$
declare e text := public._hs_is_admin(); s public.claim_check_scans%rowtype; sent boolean;
begin
  select * into s from public.claim_check_scans where status in ('queued', 'running') and created_at > now() - interval '45 minutes'
   order by created_at desc limit 1;
  if found then return jsonb_build_object('existing', true, 'scan', to_jsonb(s)); end if;
  insert into public.claim_check_scans (trigger, requested_by) values ('manual', e) returning * into s;
  sent := public._cc_dispatch('claim-check-scan.yml', jsonb_build_object('scan_id', s.id::text));
  if not sent then
    update public.claim_check_scans set status = 'failed', finished_at = now(),
      errors = '[{"kind":"dispatch","message":"No GitHub credential is stored, so the scan could not start."}]' where id = s.id returning * into s;
  end if;
  return jsonb_build_object('existing', false, 'scan', to_jsonb(s));
end $$;

-- ── scheduled scans (pg_cron) ────────────────────────────────────────────────────────────────────────
create or replace function public.claim_check_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare st public.claim_check_settings%rowtype; t text; local_now timestamp; slot timestamp; k text; sid uuid; queued int := 0;
begin
  select * into st from public.claim_check_settings;
  -- a scan that never reported back is closed, so it cannot look like it is still running
  update public.claim_check_scans set status = 'failed', finished_at = now(),
    errors = errors || '[{"kind":"stalled","message":"The scan did not report back within 2 hours."}]'::jsonb
   where status in ('queued', 'running') and created_at < now() - interval '2 hours';
  if not st.scan_enabled then return jsonb_build_object('queued', 0, 'reason', 'scans are off'); end if;
  local_now := now() at time zone st.scan_tz;
  foreach t in array st.scan_times loop
    slot := local_now::date + t::time;
    if slot <= local_now and slot > local_now - interval '2 hours' then
      k := to_char(slot, 'YYYY-MM-DD"T"HH24:MI');
      insert into public.claim_check_scans (trigger, slot_key) values ('scheduled', k) on conflict (slot_key) do nothing returning id into sid;
      if sid is not null then
        if not public._cc_dispatch('claim-check-scan.yml', jsonb_build_object('scan_id', sid::text)) then
          update public.claim_check_scans set status = 'failed', finished_at = now(),
            errors = '[{"kind":"dispatch","message":"No GitHub credential is stored."}]' where id = sid;
        end if;
        queued := queued + 1; sid := null;
      end if;
    end if;
  end loop;
  return jsonb_build_object('queued', queued);
end $$;

-- ── the scanner's door (service role) ───────────────────────────────────────────────────────────────
create or replace function public.claim_check_scan_claim(p_scan uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.claim_check_scans%rowtype;
begin
  update public.claim_check_scans set status = 'running', claimed_at = now() where id = p_scan and status = 'queued' returning * into s;
  if not found then return jsonb_build_object('claimed', false); end if;
  return jsonb_build_object('claimed', true, 'scan_id', s.id,
    'settings', (select to_jsonb(x) from public.claim_check_settings x),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'name', p.name, 'aliases', p.aliases,
                 'priority', p.priority, 'organization', p.organization) order by p.priority, p.name), '[]'::jsonb)
                 from public.claim_check_people p where p.status = 'active'),
    'known_sources', (select coalesce(jsonb_object_agg(source_key, jsonb_build_object('metrics', metrics, 'metrics_at', metrics_at)), '{}'::jsonb)
                 from public.claim_check_sources where last_seen_at > now() - interval '30 days'));
end $$;

-- Records what one scan found. Sources upsert by source_key (metrics move to metrics_prev); claims upsert by claim_key and
-- never touch a claim that is past 'candidate' except its score. No verdict, quote or evidence can arrive this way.
create or replace function public.claim_check_scan_record(p_scan uuid, p_sources jsonb, p_claims jsonb, p_adapters jsonb, p_suggestions jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.claim_check_scans%rowtype; x jsonb; ids uuid[]; n_src int := 0; n_new int := 0; ins boolean;
begin
  select * into s from public.claim_check_scans where id = p_scan;
  if not found or s.status <> 'running' then raise exception 'scan % is not running', p_scan using errcode = '55000'; end if;
  for x in select * from jsonb_array_elements(coalesce(p_sources, '[]')) loop
    insert into public.claim_check_sources as cs (source_key, platform, publisher, channel_id, program, url, embed_url, thumbnail_url, title,
        description, author, published_at, duration_s, rights, transcript_status, metrics, metrics_at, person_ids, adapter, scan_id)
    values (x->>'source_key', x->>'platform', x->>'publisher', x->>'channel_id', x->>'program', x->>'url', x->>'embed_url',
        x->>'thumbnail_url', left(x->>'title', 300), left(x->>'description', 4000), x->>'author', (x->>'published_at')::timestamptz,
        (x->>'duration_s')::int, coalesce(x->>'rights', 'unresolved'), coalesce(x->>'transcript_status', 'not_read'),
        coalesce(x->'metrics', '{}'), now(),
        coalesce(array(select (v)::uuid from jsonb_array_elements_text(coalesce(x->'person_ids', '[]')) v), '{}'), x->>'adapter', p_scan)
    on conflict (source_key) do update set
        metrics_prev = cs.metrics, metrics_prev_at = cs.metrics_at, metrics = excluded.metrics, metrics_at = now(),
        title = excluded.title, thumbnail_url = coalesce(excluded.thumbnail_url, cs.thumbnail_url),
        publisher = coalesce(cs.publisher, excluded.publisher),
        person_ids = (select array(select distinct u from unnest(cs.person_ids || excluded.person_ids) u)),
        last_seen_at = now(), scan_id = p_scan;
    n_src := n_src + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_claims, '[]')) loop
    if x ? 'verdict' or x ? 'quote' or x ? 'evidence' then raise exception 'a scan cannot set a verdict, quote or evidence' using errcode = '42501'; end if;
    ids := array(select cs.id from public.claim_check_sources cs where cs.source_key in (select jsonb_array_elements_text(coalesce(x->'source_keys', '[]'))));
    if coalesce(array_length(ids, 1), 0) = 0 then continue; end if;
    insert into public.claim_check_claims as c (claim_key, lane, topic, speaker_name, person_id, place, source_ids, trend_score,
        score_parts, score_confidence, significance, reasons, listed)
    values (x->>'claim_key', coalesce(x->>'lane', 'emerging'), left(x->>'topic', 300), x->>'speaker_name', (x->>'person_id')::uuid,
        x->>'place', ids, (x->>'trend_score')::int, coalesce(x->'score_parts', '{}'), x->>'score_confidence',
        (x->>'significance')::int, coalesce(x->'reasons', '[]'), coalesce((x->>'listed')::boolean, true))
    on conflict (claim_key) do update set
        trend_score = excluded.trend_score, score_parts = excluded.score_parts, score_confidence = excluded.score_confidence,
        significance = greatest(c.significance, excluded.significance),
        source_ids = (select array(select distinct u from unnest(c.source_ids || excluded.source_ids) u)),
        lane = case when c.status = 'candidate' then excluded.lane else c.lane end,
        listed = case when c.status = 'candidate' then excluded.listed else c.listed end,
        -- a later scan may name a speaker an earlier one missed; it never replaces one already set (research may have)
        speaker_name = coalesce(c.speaker_name, excluded.speaker_name), person_id = coalesce(c.person_id, excluded.person_id),
        reasons = excluded.reasons, updated_at = now()
    returning (xmax = 0) into ins;
    if ins then n_new := n_new + 1; end if;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_adapters, '[]')) loop
    update public.claim_check_adapters set status = x->>'status', detail = coalesce(x->>'detail', detail), last_run_at = now(),
      last_ok_at = case when x->>'status' = 'operational' then now() else last_ok_at end,
      last_error = x->>'error', stats = coalesce(x->'stats', '{}') where key = x->>'key';
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_suggestions, '[]')) loop
    insert into public.claim_check_people (slug, name, organization, status, origin, reason, appearances)
    values (public._cc_slugify(x->>'name'), x->>'name', x->>'organization', 'suggested', 'scanner', x->>'reason', coalesce((x->>'appearances')::int, 0))
    on conflict (slug) do update set appearances = greatest(public.claim_check_people.appearances, excluded.appearances),
      reason = case when public.claim_check_people.origin = 'scanner' then excluded.reason else public.claim_check_people.reason end;
  end loop;
  return jsonb_build_object('sources', n_src, 'claims_new', n_new);
end $$;

create or replace function public.claim_check_scan_finish(p_scan uuid, p_status text, p_stats jsonb, p_errors jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.claim_check_scans%rowtype;
begin
  if p_status not in ('ok', 'partial', 'failed') then raise exception 'bad status' using errcode = '22023'; end if;
  update public.claim_check_scans set status = p_status, finished_at = now(), stats = coalesce(p_stats, '{}'), errors = coalesce(p_errors, '[]')
   where id = p_scan and status = 'running' returning * into s;
  if not found then raise exception 'scan % is not running', p_scan using errcode = '55000'; end if;
  return to_jsonb(s);
end $$;

-- ── the research run's door (service role) ──────────────────────────────────────────────────────────
create or replace function public.claim_check_research_claim(p_run uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.claim_check_research_runs%rowtype; c public.claim_check_claims%rowtype;
begin
  update public.claim_check_research_runs set status = 'running', claimed_at = now() where id = p_run and status = 'queued' returning * into r;
  if not found then return jsonb_build_object('claimed', false); end if;
  update public.claim_check_claims set status = 'researching', updated_at = now() where id = r.claim_id returning * into c;
  return jsonb_build_object('claimed', true, 'run_id', r.id, 'note', r.note,
    'claim', public._cc_claim_json(c, true) || jsonb_build_object('source_detail',
      (select coalesce(jsonb_agg(jsonb_build_object('url', s.url, 'title', s.title, 'description', s.description, 'publisher', s.publisher,
          'published_at', s.published_at, 'author', s.author, 'platform', s.platform)), '[]'::jsonb)
         from public.claim_check_sources s where s.id = any(c.source_ids))));
end $$;

create or replace function public.claim_check_research_record(p_run uuid, p_body jsonb, p_checks jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.claim_check_research_runs%rowtype; c public.claim_check_claims%rowtype; probs jsonb; v int;
begin
  select * into r from public.claim_check_research_runs where id = p_run for update;
  if not found or r.status <> 'running' then raise exception 'research run % is not running', p_run using errcode = '55000'; end if;
  probs := public._cc_research_problems(p_body);
  if jsonb_array_length(probs) > 0 then
    update public.claim_check_research_runs set status = 'failed', finished_at = now(), error = 'Research did not pass the checks: ' || probs::text where id = p_run;
    update public.claim_check_claims set status = 'needs_research', updated_at = now() where id = r.claim_id;
    return jsonb_build_object('ok', false, 'problems', probs);
  end if;
  select * into c from public.claim_check_claims where id = r.claim_id for update;
  v := c.research_version + 1;
  insert into public.claim_check_research (claim_id, version, body, checks, run_id) values (c.id, v, p_body, coalesce(p_checks, '{}'), p_run);
  update public.claim_check_claims set research_version = v, status = 'research_ready',
    speaker_name = p_body->>'speaker_name', quote = p_body->>'quote', quote_verified = coalesce((p_body->>'quote_verified')::boolean, false),
    quote_source_url = p_body->>'quote_source_url', timestamp_s = (p_body->>'timestamp_s')::int, context = p_body->>'context',
    assertion = p_body->>'assertion', verdict = p_body->>'verdict', verdict_explanation = p_body->>'verdict_explanation',
    evidence = p_body->'evidence', evidence_gaps = p_body->>'evidence_gaps',
    headline = coalesce(nullif(p_body->>'headline', ''), headline), post_text = coalesce(nullif(p_body->>'post_text', ''), post_text),
    updated_at = now()
   where id = c.id;
  update public.claim_check_research_runs set status = 'done', finished_at = now() where id = p_run;
  return jsonb_build_object('ok', true, 'version', v);
end $$;

create or replace function public.claim_check_research_failed(p_run uuid, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare r public.claim_check_research_runs%rowtype;
begin
  update public.claim_check_research_runs set status = 'failed', finished_at = now(), error = left(coalesce(p_error, 'unknown error'), 2000)
   where id = p_run and status in ('queued', 'running') returning * into r;
  if found then
    update public.claim_check_claims set status = case when research_version > 0 then 'research_ready' else 'needs_research' end, updated_at = now()
     where id = r.claim_id and status = 'researching';
  end if;
end $$;

-- ── public export: approved claim checks only (the site build reads this; anon may call it) ──────────────
create or replace function public.claim_check_public_export() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', c.slug, 'headline', c.headline, 'speaker_name', c.speaker_name,
    'speaker_org', (select p.organization from public.claim_check_people p where p.id = c.person_id),
    'quote', c.quote, 'quote_source_url', c.quote_source_url, 'timestamp_s', c.timestamp_s, 'context', c.context,
    'assertion', c.assertion, 'verdict', c.verdict, 'verdict_explanation', c.verdict_explanation,
    'evidence', c.evidence, 'evidence_gaps', c.evidence_gaps, 'public_state', c.public_state,
    'reviewed_at', c.approved_at, 'updated_at', c.updated_at,
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('platform', s.platform, 'publisher', s.publisher, 'program', s.program,
        'url', s.url, 'embed_url', case when s.rights in ('embed_only', 'reuse_authorized') then s.embed_url end,
        'thumbnail_url', s.thumbnail_url, 'title', s.title, 'published_at', s.published_at) order by s.published_at), '[]'::jsonb)
        from public.claim_check_sources s where s.id = any(c.source_ids)),
    'corrections', (select coalesce(jsonb_agg(jsonb_build_object('kind', d.action, 'note', d.note, 'at', d.created_at) order by d.created_at), '[]'::jsonb)
        from public.claim_check_decisions d where d.claim_id = c.id and d.action in ('correct', 'retract')))
    order by c.approved_at desc), '[]'::jsonb)
  from public.claim_check_claims c
  where c.public_state <> 'none' and c.approved_at is not null and c.slug is not null and c.verdict is not null $$;

-- ── grants ────────────────────────────────────────────────────────────────────────────────────────────
do $$ declare f text; begin
  foreach f in array array['hs_claim_check_overview()', 'hs_claim_check_claim(uuid)',
      'hs_claim_check_decide(uuid,text,text,jsonb,integer)', 'hs_claim_check_person_save(jsonb)',
      'hs_claim_check_person_status(uuid,text)', 'hs_claim_check_scan_now()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['claim_check_tick()', 'claim_check_scan_claim(uuid)', 'claim_check_scan_record(uuid,jsonb,jsonb,jsonb,jsonb)',
      'claim_check_scan_finish(uuid,text,jsonb,jsonb)', 'claim_check_research_claim(uuid)',
      'claim_check_research_record(uuid,jsonb,jsonb)', 'claim_check_research_failed(uuid,text)',
      '_cc_dispatch(text,jsonb)', '_cc_claim_json(public.claim_check_claims,boolean)', '_cc_analytics()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  revoke all on function public.claim_check_public_export() from public;
  grant execute on function public.claim_check_public_export() to anon, authenticated, service_role;
end $$;

-- ── schedule (only where pg_cron exists) ──────────────────────────────────────────────────────────────
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'claim-check-tick';
    perform cron.schedule('claim-check-tick', '*/15 * * * *', 'select public.claim_check_tick()');
  end if;
end $$;

commit;
