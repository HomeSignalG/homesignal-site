-- Bluesky MAPS vs Shorts: which kind of post brings visitors, registrations and reports (2026-10-27). SQL of record.
-- Founder brief "JODY TRACKS — Bluesky Scheduling Redesign" §8. ADDITIVE: one channel value, one admin-only reader.
--
-- THE TRUTH PATH (unchanged; this file only reads it)
--   publisher (homesignal-ingest bluesky/publish-worker.mjs) tags every link to our site with
--     utm_source=bluesky & utm_medium=social & utm_campaign=maps|shorts & utm_content=<social_posts.id | video job id>
--   browser (lib/data.js HS.attr) -> record_first_touch() -> acquisition_touch (channel decided by classify_channel)
--   sign-in -> claim_first_touch() -> the account's touch (same channel and utm_content)
--   report_snapshot -> _report_account() -> that account's touch                     (derived at read time, as before)
-- DECISION OWNER for "which channel": public.classify_channel(). This file adds 'shorts' -> 'bluesky_shorts' to it and
-- nothing else; docs/acquisition-attribution.sql (the cumulative record) carries the same line.
--
-- WHAT IS MEASURED AND WHAT IS NOT (the reader says so in its own output)
--   measured:     published posts per kind; first-visit visitors, registrations and saved reports credited to a kind and to
--                 the exact post (utm_content), from the first touch only.
--   not measured: YouTube views or clicks from Bluesky (no YouTube Analytics data is collected); visits to YouTube itself;
--                 a returning visitor's later visits (only the first touch is credited); posts before 2026-10-27 carry no
--                 utm_content and MAPS posts before that carry campaign=maps only.
--
-- (applied as ONE transaction by apply_migration; do not add begin/commit)

-- 1. the channel: utm_campaign=shorts -> bluesky_shorts. Spliced from the LIVE body (never retyped), fail-closed.
do $splice$
declare
  d text := pg_get_functiondef('public.classify_channel(text,text,text,text,text)'::regprocedure);
  a text := $a$      if c = 'maps' then return 'bluesky_maps_auto'; end if;$a$;
  n int;
begin
  if position($q$'bluesky_shorts'$q$ in d) > 0 then return; end if;          -- already applied
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'classify_channel anchor matched % times (expected 1). Not applied.', n; end if;
  d := replace(d, a, a || E'\n      if c = ''shorts'' then return ''bluesky_shorts''; end if;      -- video posts (2026-10-27)');
  execute d;
  if public.classify_channel('bluesky', 'social', 'shorts', null, '/') <> 'bluesky_shorts'
     or public.classify_channel('bluesky', 'social', 'maps', null, '/') <> 'bluesky_maps_auto' then
    raise exception 'classify_channel splice did not take. Rolled back.';
  end if;
end $splice$;

-- 2. the reader -----------------------------------------------------------------------------------------------------------
create or replace function public.hs_bsky_maps_vs_shorts(p_days int default 30, p_include_internal boolean default false)
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
  posts as (
    select 'maps'::text kind, p.id::text post_id, p.published_at,
           coalesce(p.zip, '') || case when p.evidence ->> 'theme' = 'datacenter' then ' · data center' else '' end label
      from public.social_posts p
     where p.status = 'published' and p.content_family = 'MAPS' and p.published_at >= t0 and p.published_at < t1
    union all
    select 'shorts', j.id::text, coalesce(j.published_at, j.external_at), j.slug || ' · ' || j.file_key
      from public.video_bluesky_jobs j
     where j.status in ('published', 'external') and coalesce(j.published_at, j.external_at) >= t0
       and coalesce(j.published_at, j.external_at) < t1),
  kinds(kind, channels) as (values ('maps', array['bluesky_maps_auto', 'bluesky_pierce_auto']), ('shorts', array['bluesky_shorts'])),
  vis as (
    select k.kind, t.visitor_id, t.utm_content, t.created_at
      from public.acquisition_touch t join kinds k on t.channel = any(k.channels)
     where t.subject_type = 'visitor' and t.created_at >= t0 and t.created_at < t1 and (p_include_internal or not t.is_internal)),
  acc as (
    select k.kind, t.subject_id user_id, t.utm_content, t.created_at
      from public.acquisition_touch t join kinds k on t.channel = any(k.channels)
     where t.subject_type = 'account' and t.created_at >= t0 and t.created_at < t1
       and (p_include_internal or not (t.is_internal or public.analytics_is_excluded(t.subject_id::uuid)))),
  rep as (
    select k.kind, tch.utm_content, s.report_id
      from public.report_snapshot s
      cross join lateral public._report_account(s.report_id, s.generated_at) ra
      join public.acquisition_touch tch on tch.subject_type = 'account' and tch.subject_id = ra.user_id::text
      join kinds k on tch.channel = any(k.channels)
     where s.generated_at >= t0 and s.generated_at < t1
       and (p_include_internal or not (tch.is_internal or public.analytics_is_excluded(ra.user_id)))),
  summary as (
    select k.kind,
           (select count(*) from posts p where p.kind = k.kind) posts,
           (select count(distinct v.visitor_id) from vis v where v.kind = k.kind) visitors,
           (select count(*) from acc a where a.kind = k.kind) registrations,
           (select count(*) from rep x where x.kind = k.kind) reports,
           (select count(distinct v.visitor_id) from vis v where v.kind = k.kind and v.utm_content is not null) visitors_with_post_id
      from kinds k),
  per_post as (
    select p.kind, p.post_id, p.label, p.published_at,
           (select count(distinct v.visitor_id) from vis v where v.utm_content = p.post_id) visitors,
           (select count(*) from acc a where a.utm_content = p.post_id) registrations,
           (select count(*) from rep x where x.utm_content = p.post_id) reports
      from posts p)
  select jsonb_build_object(
    'generated_at', now(), 'timezone', tz, 'from', v_from, 'to', v_to, 'days', p_days, 'include_internal', p_include_internal,
    'summary', (select jsonb_object_agg(s.kind, jsonb_build_object(
        'posts', s.posts, 'visitors', s.visitors, 'registrations', s.registrations, 'reports', s.reports,
        'visitors_with_post_id', s.visitors_with_post_id,
        'visitors_per_post', case when s.posts > 0 then round(s.visitors::numeric / s.posts, 2) end,
        'registrations_per_100_visitors', case when s.visitors > 0 then round(100.0 * s.registrations / s.visitors, 1) end,
        'reports_per_registration', case when s.registrations > 0 then round(s.reports::numeric / s.registrations, 2) end))
      from summary s),
    'posts', (select coalesce(jsonb_agg(to_jsonb(pp) order by pp.published_at desc), '[]'::jsonb) from per_post pp),
    'untagged_bluesky_visitors', (select count(distinct t.visitor_id) from public.acquisition_touch t
       where t.subject_type = 'visitor' and t.channel in ('bluesky_untagged', 'bluesky_other_tagged')
         and t.created_at >= t0 and t.created_at < t1 and (p_include_internal or not t.is_internal)),
    'unavailable', jsonb_build_array(
      'YouTube views and clicks that came from Bluesky: no YouTube Analytics data is collected.',
      'A returning visitor''s later visits: only the first visit of each browser is credited.',
      'Posts published before 2026-10-27 carry no post id in their links, so they cannot be credited per post.'),
    'caveats', jsonb_build_array(
      'Visitors are browsers whose FIRST visit came from a Bluesky link of that kind, in this period (America/Los_Angeles days).',
      'Registrations and reports are credited to the account''s first touch. A report counts only when a stored report snapshot exists and its brokerage had one active member.',
      'Untagged Bluesky visitors (a link without our tags, or the profile link) are shown separately and belong to neither kind.')) into r;
  return r;
end $$;
revoke all on function public.hs_bsky_maps_vs_shorts(int, boolean) from public, anon;
grant execute on function public.hs_bsky_maps_vs_shorts(int, boolean) to authenticated;
