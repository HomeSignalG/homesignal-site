-- YouTube channel engagement (2026-10-27). SQL of record. ADDITIVE: two count tables, one channel value, one admin-only
-- reader. Founder: "we have a you tube channel now. so you tube channel needs to be tracked".
--
-- THE TRUTH PATH
--   counts:  homesignal-ingest scripts/youtube_channel_sync.py (hourly, youtube-channel-sync.yml) already lists the
--            channel's uploads; it now also asks for `statistics` on the same two calls (no extra quota) and appends one
--            row per video to public.youtube_video_metrics and one row to public.youtube_channel_metrics. Which videos are
--            the channel's is public.youtube_channel_videos (written by youtube_sync_record), unchanged.
--   visits:  browser (lib/data.js HS.attr) -> record_first_touch() -> acquisition_touch.channel = classify_channel(...).
--            This file adds ONE value to classify_channel: 'youtube', for utm_source=youtube OR a youtube.com / youtu.be
--            referrer. The video descriptions link to https://jodytracks.com/ without tags (founder's exact closing text,
--            video/build.py V1_CLOSING), so most YouTube visits arrive by referrer and cannot be credited to one video;
--            a link tagged utm_source=youtube&utm_content=<video id or slug> can.
-- DECISION OWNERS: "which channel" = classify_channel(); "is this video a Short" = duration_s <= 180 (the same 3-minute
--   rule youtube_channel_sync.py uses, SHORT_MAX_S). The page decides neither.
--
-- WHAT IS MEASURED AND WHAT IS NOT (the reader says so in its own output)
--   measured:     views, likes and comments per public video and subscribers / total views for the channel, as YouTube
--                 reported them at each hourly read; first-visit visitors, registrations and reports from YouTube.
--   not measured: watch time, impressions, click-through rate, traffic sources and audience (those need YouTube Analytics
--                 with the channel owner's consent; the sync runs with a public API key); counts before the first read
--                 (2026-10-27); visits before this rule existed (filed as other_referral / other_tagged, not re-filed).
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

-- 1. counts, append-only history ------------------------------------------------------------------------------------------
create table if not exists public.youtube_video_metrics (
  id bigint generated always as identity primary key,
  video_id text not null,
  captured_at timestamptz not null default now(),
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  run_id text);
create index if not exists youtube_video_metrics_video_time on public.youtube_video_metrics (video_id, captured_at desc);
comment on table public.youtube_video_metrics is
  'One row per video per hourly read of the JODY Tracks channel (homesignal-ingest youtube_channel_sync.py). A count YouTube did not return (hidden likes) is null, never 0.';

create table if not exists public.youtube_channel_metrics (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  channel_id text,
  subscribers bigint check (subscribers >= 0),
  subscribers_hidden boolean not null default false,
  views bigint check (views >= 0),
  videos int check (videos >= 0),
  run_id text);
create index if not exists youtube_channel_metrics_time on public.youtube_channel_metrics (captured_at desc);
comment on table public.youtube_channel_metrics is
  'One row per hourly read of the JODY Tracks channel. subscribers is null when the channel hides its count.';

alter table public.youtube_video_metrics enable row level security;
alter table public.youtube_channel_metrics enable row level security;
revoke all on table public.youtube_video_metrics, public.youtube_channel_metrics from public, anon, authenticated;
grant select, insert on table public.youtube_video_metrics, public.youtube_channel_metrics to service_role;

-- 2. the channel: utm_source=youtube or a YouTube referrer -> 'youtube'. Spliced from the LIVE body (never retyped),
--    fail-closed. docs/acquisition-attribution.sql (the cumulative record) carries the same two lines.
do $splice$
declare
  d text := pg_get_functiondef('public.classify_channel(text,text,text,text,text)'::regprocedure);
  a1 text := $a$    if s = 'saleshandy' then return 'saleshandy'; end if;$a$;
  a2 text := $a$    if h ~ '(^|\.)bsky\.(app|social)$' then return 'bluesky_untagged'; end if;$a$;
  n1 int; n2 int;
begin
  if position($q$'youtube'$q$ in d) > 0 then return; end if;                -- already applied
  n1 := (length(d) - length(replace(d, a1, ''))) / length(a1);
  n2 := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n1 <> 1 or n2 <> 1 then raise exception 'classify_channel anchors matched % and % times (expected 1, 1). Not applied.', n1, n2; end if;
  d := replace(d, a1, a1 || E'\n    if s = ''youtube'' then return ''youtube''; end if;      -- YouTube channel links (2026-10-27)');
  d := replace(d, a2, a2 || E'\n    if h ~ ''(^|\\.)(youtube\\.com|youtu\\.be|youtube-nocookie\\.com)$'' then return ''youtube''; end if;');
  execute d;
  if public.classify_channel('youtube', 'video', null, null, '/') <> 'youtube'
     or public.classify_channel(null, null, null, 'www.youtube.com', '/') <> 'youtube'
     or public.classify_channel(null, null, null, 'm.youtube.com', '/x') <> 'youtube'
     or public.classify_channel(null, null, null, 'youtu.be', '/') <> 'youtube'
     or public.classify_channel(null, null, null, 'notyoutube.com', '/') <> 'other_referral'
     or public.classify_channel('bluesky', 'social', 'shorts', null, '/') <> 'bluesky_shorts'
     or public.classify_channel(null, null, null, 'bsky.app', '/') <> 'bluesky_untagged' then
    raise exception 'classify_channel splice did not take. Rolled back.';
  end if;
end $splice$;

-- 3. the reader ------------------------------------------------------------------------------------------------------------
create or replace function public.hs_youtube_engagement(p_days int default 30, p_include_internal boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  tz constant text := 'America/Los_Angeles';
  v_to   date := (now() at time zone tz)::date;
  v_from date;
  t0 timestamptz; t1 timestamptz;
  r jsonb;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 400 then raise exception 'p_days must be 1..400' using errcode = '22023'; end if;
  v_from := v_to - (p_days - 1);
  t0 := v_from::timestamp at time zone tz;
  t1 := (v_to + 1)::timestamp at time zone tz;

  with
  vids as (
    select v.video_id, v.url, v.title, v.published_at, v.duration_s,
           case when v.duration_s is null then null when v.duration_s <= 180 then 'short' else 'main' end kind
      from public.youtube_channel_videos v
     where v.privacy_status = 'public'),
  latest as (
    select distinct on (m.video_id) m.video_id, m.views, m.likes, m.comments, m.captured_at
      from public.youtube_video_metrics m order by m.video_id, m.captured_at desc),
  base as (            -- the last read at or before the start of the period, and at most 2 days before it: the baseline
                       -- for "in this period". An older reading would add views from before the period, so it is not used.
    select distinct on (m.video_id) m.video_id, m.views, m.likes, m.captured_at
      from public.youtube_video_metrics m where m.captured_at <= t0 and m.captured_at > t0 - interval '2 days'
     order by m.video_id, m.captured_at desc),
  vis as (
    select t.visitor_id, t.utm_content from public.acquisition_touch t
     where t.channel = 'youtube' and t.subject_type = 'visitor' and t.created_at >= t0 and t.created_at < t1
       and (p_include_internal or not t.is_internal)),
  acc as (
    select t.subject_id user_id, t.utm_content from public.acquisition_touch t
     where t.channel = 'youtube' and t.subject_type = 'account' and t.created_at >= t0 and t.created_at < t1
       and (p_include_internal or not (t.is_internal or public.analytics_is_excluded(t.subject_id::uuid)))),
  rep as (
    select tch.utm_content, s.report_id
      from public.report_snapshot s
      cross join lateral public._report_account(s.report_id, s.generated_at) ra
      join public.acquisition_touch tch on tch.subject_type = 'account' and tch.subject_id = ra.user_id::text and tch.channel = 'youtube'
     where s.generated_at >= t0 and s.generated_at < t1
       and (p_include_internal or not (tch.is_internal or public.analytics_is_excluded(ra.user_id)))),
  per_video as (
    select v.video_id, v.url, v.title, v.published_at, v.duration_s, v.kind,
           l.views, l.likes, l.comments, l.captured_at counted_at,
           -- views in the period: latest minus the baseline; a video published inside the period starts from 0;
           -- with no baseline (counts began after the period started) it is unknown, never a guess
           case when b.video_id is not null then l.views - b.views
                when v.published_at >= t0 then l.views end views_in_period,
           (select count(distinct x.visitor_id) from vis x where x.utm_content in (v.video_id, v.url)) visitors
      from vids v left join latest l using (video_id) left join base b using (video_id)),
  ch_latest as (select * from public.youtube_channel_metrics order by captured_at desc limit 1),
  ch_base as (select * from public.youtube_channel_metrics where captured_at <= t0 and captured_at > t0 - interval '2 days'
               order by captured_at desc limit 1),
  ch_first as (select min(captured_at) first_at from public.youtube_channel_metrics)
  select jsonb_build_object(
    'generated_at', now(), 'timezone', tz, 'from', v_from, 'to', v_to, 'days', p_days, 'include_internal', p_include_internal,
    'channel', (select jsonb_build_object(
        'subscribers', l.subscribers, 'subscribers_hidden', l.subscribers_hidden, 'views', l.views, 'videos', l.videos,
        'counted_at', l.captured_at, 'counting_since', (select first_at from ch_first),
        'subscribers_in_period', (select l.subscribers - b.subscribers from ch_base b),
        'views_in_period', (select l.views - b.views from ch_base b))
      from ch_latest l),
    'summary', jsonb_build_object(
        'videos', (select count(*) from vids), 'mains', (select count(*) from vids where kind = 'main'),
        'shorts', (select count(*) from vids where kind = 'short'),
        'published_in_period', (select count(*) from vids where published_at >= t0 and published_at < t1),
        'visitors', (select count(distinct visitor_id) from vis), 'registrations', (select count(*) from acc),
        'reports', (select count(*) from rep),
        'visitors_with_video_tag', (select count(distinct visitor_id) from vis where utm_content is not null)),
    'videos', (select coalesce(jsonb_agg(to_jsonb(pv) order by pv.published_at desc nulls last), '[]'::jsonb) from per_video pv),
    'unavailable', jsonb_build_array(
      'Watch time, impressions, click-through rate, traffic sources and audience: these need YouTube Analytics with the channel owner''s consent; the hourly read uses a public API key.',
      'Counts before the first hourly read on 2026-10-27, so "in this period" is blank until a reading exists from the start of the period.',
      'Which video sent a visitor, unless the link carries utm_content: the video descriptions link to jodytracks.com without tags.',
      'YouTube visits before 2026-10-27 were filed as other referral / other tagged and are not re-filed.'),
    'caveats', jsonb_build_array(
      'Views, likes and comments are YouTube''s public counts at the last hourly read; YouTube can revise them later.',
      'A video is a Short when it is 3 minutes or less (the rule the channel sync uses).',
      'Visitors are browsers whose FIRST visit came from YouTube in this period (America/Los_Angeles days); registrations and reports are credited to the account''s first touch.')) into r;
  return r;
end $$;
revoke all on function public.hs_youtube_engagement(int, boolean) from public, anon;
grant execute on function public.hs_youtube_engagement(int, boolean) to authenticated;
