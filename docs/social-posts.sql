-- social_posts — Bluesky post pipeline (docs/bluesky-posts-build.md §2).
-- Applied manually in the Supabase SQL editor (project qwnnmljucajnexpxdgxr);
-- recorded here per CLAUDE.md §1 so the DDL of record stays reproducible.
--
-- SUPERSEDE NOTE: a prior social_posts pipeline existed (schema
-- platform/kind/caption/image_path/status(queued/sent), 70 rows incl. 1 sent,
-- wired to the social-approve edge function). The runbook design supersedes it;
-- the old table was RENAMED to social_posts_legacy (preserved, not dropped) and
-- this new table created. The social-approve edge function + the old generator
-- reference social_posts by name and expect the OLD schema — they are superseded
-- by bluesky/publish-worker.mjs (§7) + bluesky/generate.mjs (§3) and must be
-- disabled/updated so they don't error against the new schema.

alter table if exists public.social_posts rename to social_posts_legacy;   -- one-time, preserve prior data

create table public.social_posts (
  id             uuid primary key default gen_random_uuid(),
  status         text not null default 'draft'
                   check (status in ('draft','approved','skipped','published','failed')),
  tile           text not null
                   check (tile in ('gov_notice','meeting','local_news','best_practice','emerging_tech')),
  community_id   uuid references public.communities(id),
  zip            text,
  source_table   text not null,
  source_id      text not null,
  source_url     text not null,      -- ANTI-FABRICATION: enforced not null (§0)
  post_text      text not null,
  hashtags       text[] not null default '{}',
  embed_kind     text check (embed_kind in ('external','images','video')),
  embed          jsonb,
  local_tz       text,
  scheduled_slot timestamptz,
  bsky_uri       text,
  bsky_cid       text,
  error          text,
  created_at     timestamptz not null default now(),
  approved_at    timestamptz,
  published_at   timestamptz,
  unique (source_table, source_id)
);

-- RLS: OWNER-ONLY read/write; service-role worker bypasses RLS. NO anon access.
alter table public.social_posts enable row level security;
create policy social_posts_owner_all on public.social_posts
  for all
  using  ( (auth.jwt() ->> 'email') = 'sdsutca@proton.me' )
  with check ( (auth.jwt() ->> 'email') = 'sdsutca@proton.me' );

create index social_posts_status_slot_idx on public.social_posts (status, scheduled_slot);
create index social_posts_created_idx on public.social_posts (created_at desc);

-- Owner-gated approve: sets status='approved' + resolves scheduled_slot from the
-- §5 ladder (single writer of the slot, so the browser never duplicates the logic).
-- Full body in migration hs_approve_social_post; summary: weekday ladder
-- [09:00,17:30,12:30,19:00,08:00], weekend 10:30, cap 5/day, skips full/past slots,
-- times in the community's local tz (default America/Denver). authenticated-only;
-- the in-function owner check gates it. Skip/Edit are direct owner-session RLS updates.
