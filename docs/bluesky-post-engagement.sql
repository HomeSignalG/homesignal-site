-- Bluesky post engagement for the current queues (MAPS posts and video posts), 2026-10-27. SQL of record. ADDITIVE.
--
-- WHY: public.social_post_metrics is foreign-keyed to public.social_posts_legacy (the July pilot queue). The DB-queue
-- posts (public.social_posts MAPS rows, public.video_bluesky_jobs) had nowhere to store likes, so the Engagement Tracker
-- (Tab 5) measured ONE orphaned pilot post while 42 MAPS posts were published (measured 2026-10-27: social_post_metrics
-- 122 rows, 1 post_id, 0 of them a published social_posts row).
--
-- WRITER: homesignal-ingest scripts/collect-social-metrics.js (service role, after every ingest run), from Bluesky's
--         PUBLIC API app.bsky.feed.getPosts. Append-only snapshots; a failed pull writes nothing (never a zero).
-- READER: public.hs_bsky_post_engagement() — admin-only, returns the LATEST snapshot per post. It counts no visitors,
--         registrations or reports and decides no channel: those come from public.hs_bsky_maps_vs_shorts(), and the page
--         joins the two by post id.
-- DIRECT POSTS (added 2026-10-27): posts made on Bluesky by hand, outside both queues (e.g. videos uploaded in the
--         Bluesky app), are read from the account's own feed and stored as kind 'direct', post_id = the post's at:// uri,
--         with label (first line of the text), posted_at (the record's createdAt) and media ('video' | 'image' | 'link' |
--         'none'), plus utm_content: the tag in the post's own link to our site, when it has one (added the same day).
--         Visitors are credited to a direct post only through that tag (hs_bsky_maps_vs_shorts().shorts_by_content).
-- NOT AVAILABLE: impressions (Bluesky has no impressions API) and follows gained per post (a follow is not tied to a post).
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

create table if not exists public.bsky_post_metrics (
  id          bigserial primary key,
  kind        text not null check (kind in ('maps', 'shorts')),
  post_id     text not null,              -- social_posts.id (maps) or video_bluesky_jobs.id (shorts), as text
  bsky_uri    text not null,
  captured_at timestamptz not null default now(),
  likes       integer check (likes >= 0),
  reposts     integer check (reposts >= 0),
  replies     integer check (replies >= 0),
  quotes      integer check (quotes >= 0)
);
-- Direct posts (added 2026-10-27; additive, existing rows unchanged).
alter table public.bsky_post_metrics drop constraint if exists bsky_post_metrics_kind_check;
alter table public.bsky_post_metrics add constraint bsky_post_metrics_kind_check check (kind in ('maps', 'shorts', 'direct'));
alter table public.bsky_post_metrics add column if not exists label     text;
alter table public.bsky_post_metrics add column if not exists posted_at timestamptz;
alter table public.bsky_post_metrics add column if not exists media     text check (media in ('video', 'image', 'link', 'none'));
-- The tag in a direct post's own link to our site (utm_content, read by the collector; null when untagged). The page
-- uses it to credit that post with hs_bsky_maps_vs_shorts().shorts_by_content[tag]. A plain label only, never a URL.
alter table public.bsky_post_metrics add column if not exists utm_content text check (utm_content ~ '^[a-z0-9._~:/-]{1,80}$');
create index if not exists bsky_post_metrics_post_time_idx on public.bsky_post_metrics (post_id, captured_at desc);
alter table public.bsky_post_metrics enable row level security;
revoke all on table public.bsky_post_metrics from public, anon, authenticated;
revoke all on sequence public.bsky_post_metrics_id_seq from public, anon, authenticated;

create or replace function public.hs_bsky_post_engagement()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  r jsonb;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  with latest as (
    select distinct on (m.post_id) m.kind, m.post_id, m.bsky_uri, m.captured_at, m.likes, m.reposts, m.replies, m.quotes,
           m.label, m.posted_at, m.media, m.utm_content
      from public.bsky_post_metrics m
     order by m.post_id, m.captured_at desc, m.id desc)
  select jsonb_build_object(
    'generated_at', now(),
    'collected_at', (select max(captured_at) from public.bsky_post_metrics),
    'posts', (select coalesce(jsonb_object_agg(l.post_id, jsonb_build_object(
        'kind', l.kind, 'bsky_uri', l.bsky_uri, 'measured_at', l.captured_at,
        'likes', l.likes, 'reposts', l.reposts, 'replies', l.replies, 'quotes', l.quotes,
        'label', l.label, 'posted_at', l.posted_at, 'media', l.media, 'utm_content', l.utm_content)), '{}'::jsonb) from latest l),
    'unavailable', jsonb_build_array(
      'Impressions: Bluesky has no impressions or views API.',
      'Follows gained per post: a follow is not tied to the post that caused it; only the account total is known.',
      'Visitors from a post made directly on Bluesky: credited only when its link to jodytracks.com carries utm_source=bluesky, utm_campaign=shorts and a utm_content tag; otherwise they count only as untagged Bluesky visitors.')) into r;
  return r;
end $$;
revoke all on function public.hs_bsky_post_engagement() from public, anon;
grant execute on function public.hs_bsky_post_engagement() to authenticated;
