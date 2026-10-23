-- HomeSignal / Jody Tracks — first-party acquisition attribution (Phase 1, 2026-10-23).
-- SQL of record. ADDITIVE ONLY: no row is deleted, no existing column changes meaning, no grant widens.
-- Audit that motivated it: the 2026-10-23 Acquisition Dashboard audit (acquisition_touch had 0 rows and no writer;
-- events carried no visitor, referrer or UTM; reports were not linked to a user or a source).
--
-- THE TRUTH PATH
--   browser (lib/data.js HS.attr) -> record_first_touch() -> acquisition_touch (subject 'visitor', channel decided HERE)
--   sign-in -> claim_first_touch() -> acquisition_touch (subject 'account')
--   report (public.report_snapshot) -> its brokerage's ONE active member at generation time -> that account's touch  (derived at READ time)
--   dashboard -> hs_acq_channel_report()                                 (the ONLY place that counts by channel)
-- DECISION OWNER for "which channel is this visit": public.classify_channel(). The browser never decides.
--
--
-- APPLIED IN THREE STEPS (all 2026-10-23): acquisition_attribution_phase1 (the objects below, first version), then
-- ..._classify_maps_auto, then ..._derive_reports_at_read (reports derived at read time; this file is the CUMULATIVE definition of
-- record, verified by md5(prosrc) of every function below against production, not by comparing migration text).
-- RETIRED BUT STILL PRESENT in production, inert: public.attribute_report(uuid,uuid) (all grants revoked) and the empty table
-- public.report_attribution (RLS on, no grants). A DROP of either hung through the MCP connection (the platform runs hooks on DDL
-- drops), so they were neutralised instead. Drop them later from the SQL editor: `drop function public.attribute_report(uuid,uuid);
-- drop table public.report_attribution;` (the table is empty).
--
-- WHAT IS DELIBERATELY NOT DONE
--   * No backfill of attribution. Rows that predate this file are 'not_collected', never guessed.
--   * brokerage_report_issue / evaluation_report_issue are untouched (report generation is out of scope).
--   * An evaluation credit is NOT treated as a report: reports are counted from report_snapshot rows.
--   * The report page (development-activity-reports.html) is NOT touched: it must call no extra RPC and keep no extra storage
--     (test/development-activity-reports.test.mjs 3b/4d). So no report is attributed by the browser. Instead the reader derives it:
--     report -> brokerage (evaluation_credit_all / brokerage_paid_credit) -> the brokerage's ACTIVE members at generation time ->
--     exactly one member = that user's account touch; zero or several = 'not_attributed'. Issuance does not record WHICH agent made a
--     report, so a multi-member brokerage cannot be attributed to a person (recording the creator is a report-system change).
--   * No email, address, query string or report content is stored by any object below.

-- (applied as ONE transaction by apply_migration; do not add begin/commit)

-- ---------------------------------------------------------------------------------------------- acquisition_touch
alter table public.acquisition_touch drop constraint if exists acquisition_touch_subject_type_check;
alter table public.acquisition_touch add constraint acquisition_touch_subject_type_check
  check (subject_type = any (array['account','waitlist','area_request','visitor','report']));

alter table public.acquisition_touch
  add column if not exists visitor_id  uuid,
  add column if not exists channel     text,
  add column if not exists host        text,
  add column if not exists is_internal boolean not null default false,
  add column if not exists user_id     uuid,
  add column if not exists report_id   uuid;
create index if not exists acquisition_touch_visitor_idx on public.acquisition_touch (visitor_id) where visitor_id is not null;
create index if not exists acquisition_touch_channel_idx on public.acquisition_touch (subject_type, channel, created_at);
comment on column public.acquisition_touch.channel is
  'Decided server-side by public.classify_channel(). not_collected = the visit predates attribution tracking; never guessed.';

-- ---------------------------------------------------------------------------------------------------------- events
alter table public.events
  add column if not exists visitor_id       uuid,
  add column if not exists visit_session_id text,
  add column if not exists host             text;
alter table public.events drop constraint if exists events_visit_fields_len;
alter table public.events add constraint events_visit_fields_len
  check ((visit_session_id is null or length(visit_session_id) <= 40) and (host is null or length(host) <= 100));
create index if not exists events_pageview_idx on public.events (created_at) where event_type = 'page_view';
create index if not exists events_visitor_idx  on public.events (visitor_id, created_at) where visitor_id is not null;
comment on column public.events.session_id is
  'LEGACY: a permanent per-browser id (it never expired). Not a session. New events also carry visit_session_id (30-minute idle).';

-- ------------------------------------------------------------------------------------------- analytics_exclusion
create table if not exists public.analytics_exclusion (
  user_id    uuid primary key,
  reason     text not null,
  created_at timestamptz not null default now()
);
alter table public.analytics_exclusion enable row level security;
revoke all on public.analytics_exclusion from public, anon, authenticated;

-- ------------------------------------------------------------------------------------------------------ zip_set
create table if not exists public.zip_set (
  set_key               text not null,
  zip                   text not null check (zip ~ '^[0-9]{5}$'),
  overlaps_other_county boolean,           -- NULL = not evaluated (no ZCTA-county shares file is committed)
  note                  text,
  primary key (set_key, zip)
);
alter table public.zip_set enable row level security;
revoke all on public.zip_set from public, anon, authenticated;

-- Computed in the database from the canonical ZIP communities (never transcribed). 65 expected (data/seo-focus-areas.json).
insert into public.zip_set (set_key, zip, note)
select 'pierce_wa', z, 'ZIP page whose community county is Pierce, WA'
from (select distinct unnest(c.zip_codes) z from public.communities c
      where c.level = 'zip' and c.state = 'WA' and c.county = 'Pierce') s
where z ~ '^[0-9]{5}$'
on conflict do nothing;

-- ------------------------------------------------------------------------------------------ small helper objects
create or replace function public.analytics_is_excluded(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from public.analytics_exclusion x where x.user_id = p_user)
    or exists (select 1 from auth.users u join public.dashboard_admins a on lower(a.email) = lower(u.email) where u.id = p_user));
$$;
revoke all on function public.analytics_is_excluded(uuid) from public, anon, authenticated;

create or replace function public._acq_bucket(p_ts timestamptz, p_grain text) returns date
language sql stable as $$
  select case p_grain
           when 'week' then date_trunc('week', p_ts at time zone 'America/Los_Angeles')::date
           when 'all'  then null
           else (p_ts at time zone 'America/Los_Angeles')::date end;
$$;

-- The ONE definition of a channel. Order matters: an explicit UTM wins over a referrer.
create or replace function public.classify_channel(p_source text, p_medium text, p_campaign text, p_ref_host text, p_landing text)
returns text language plpgsql immutable set search_path = public as $$
declare
  s text := lower(coalesce(p_source, ''));   m text := lower(coalesce(p_medium, ''));
  c text := lower(coalesce(p_campaign, ''));  h text := lower(coalesce(p_ref_host, ''));
  l text := coalesce(p_landing, '');
begin
  if s <> '' then
    if s = 'saleshandy' then return 'saleshandy'; end if;
    if s = 'bluesky' then
      if c = 'pierce-zip' then return 'bluesky_pierce_auto'; end if;
      if c = 'maps' then return 'bluesky_maps_auto'; end if;          -- the live automated MAPS posts (national); Pierce = this + the Pierce ZIP filter
      if c = 'profile' or c like 'engage%' then return 'bluesky_engagement'; end if;
      return 'bluesky_other_tagged';                 -- legacy 'drip' and anything else tagged bluesky
    end if;
    if s in ('google', 'bing') and m in ('', 'organic') then return s || '_organic'; end if;
    return 'other_tagged';
  end if;
  if h <> '' then
    if h ~ '^(www\.)?google\.[a-z.]{2,}$' then return 'google_organic'; end if;   -- mail.google.com etc. are NOT search
    if h ~ '^(www\.)?bing\.com$' then return 'bing_organic'; end if;
    if h ~ '^(www\.)?(duckduckgo\.com|search\.yahoo\.com|yahoo\.com|ecosia\.org|search\.brave\.com)$' then return 'other_search'; end if;
    if h ~ '(^|\.)bsky\.(app|social)$' then return 'bluesky_untagged'; end if;
    if h in ('jodytracks.com', 'www.jodytracks.com', 'homesignal.net', 'www.homesignal.net') then return 'unknown'; end if;
    return 'other_referral';
  end if;
  -- No UTM and no referrer. 'direct' is claimed only for a landing on the home page (typed/bookmarked address);
  -- a deep landing with no referrer is 'unknown' (app, email client or privacy tool stripped it). Heuristic, labelled as such.
  if l in ('', '/', '/index.html') then return 'direct'; end if;
  return 'unknown';
end $$;

-- --------------------------------------------------------------------------------------- 1. record the first touch
create or replace function public.record_first_touch(
  p_visitor_id uuid, p_host text, p_utm_source text, p_utm_medium text, p_utm_campaign text, p_utm_content text,
  p_ref_host text, p_landing_path text, p_zip text, p_first_touch_at timestamptz default null, p_prior_browser boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  tok constant text := '^[a-z0-9][a-z0-9_.-]{0,39}$';
  v_src text := lower(trim(p_utm_source));   v_med text := lower(trim(p_utm_medium));
  v_cam text := lower(trim(p_utm_campaign)); v_con text := lower(trim(p_utm_content));
  v_ref text := lower(trim(p_ref_host));     v_host text := lower(trim(p_host));
  v_path text; v_zip text; v_chan text; v_internal boolean; v_at timestamptz;
begin
  if p_visitor_id is null then return; end if;
  if v_host is null or v_host not in ('jodytracks.com','www.jodytracks.com','homesignal.net','www.homesignal.net') then return; end if;
  if v_src !~ tok then v_src := null; end if;
  if v_med !~ tok then v_med := null; end if;
  if v_cam !~ tok then v_cam := null; end if;
  if v_con !~ tok then v_con := null; end if;
  if v_ref is null or v_ref !~ '^[a-z0-9.-]{1,100}$' then v_ref := null; end if;
  v_path := split_part(split_part(coalesce(p_landing_path, ''), '?', 1), '#', 1);
  if v_path !~ '^/[A-Za-z0-9._~/%-]{0,199}$' then v_path := null; end if;     -- path only: no query, no fragment, no address
  v_zip := case when p_zip ~ '^[0-9]{5}$' then p_zip end;
  v_at := case when p_first_touch_at is null or p_first_touch_at > now() or p_first_touch_at < now() - interval '400 days'
               then now() else p_first_touch_at end;
  v_chan := public.classify_channel(v_src, v_med, v_cam, v_ref, v_path);
  -- A browser that already held our storage before this tracking existed has an unknown true first touch.
  if p_prior_browser and v_src is null then v_chan := 'not_collected'; end if;
  -- Controlled test visits never count as marketing results.
  v_internal := coalesce(v_cam, '') like 'audit-test%' or coalesce(v_con, '') like 'audit-test%';
  insert into public.acquisition_touch
    (subject_type, subject_id, visitor_id, utm_source, utm_medium, utm_campaign, utm_content, referrer, landing_path, zip,
     first_touch_at, channel, host, is_internal)
  values ('visitor', p_visitor_id::text, p_visitor_id, v_src, v_med, v_cam, v_con, v_ref, v_path, v_zip,
          v_at, v_chan, v_host, v_internal)
  on conflict (subject_type, subject_id) do nothing;         -- first touch wins, at the database
end $$;
revoke all on function public.record_first_touch(uuid,text,text,text,text,text,text,text,text,timestamptz,boolean) from public;
grant execute on function public.record_first_touch(uuid,text,text,text,text,text,text,text,text,timestamptz,boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------------- 2. sign-in: link account to touch
create or replace function public.claim_first_touch(p_visitor_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  v   public.acquisition_touch%rowtype;
  u_created timestamptz;
  v_internal boolean;
  v_chan text;
begin
  if uid is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if exists (select 1 from public.acquisition_touch where subject_type = 'account' and subject_id = uid::text) then return; end if;
  select * into v from public.acquisition_touch where subject_type = 'visitor' and subject_id = p_visitor_id::text;
  select created_at into u_created from auth.users where id = uid;
  v_internal := public.analytics_is_excluded(uid) or coalesce(v.is_internal, false);
  -- Only a visit that came BEFORE the account existed can have acquired it. An older account signing in on a new device is not
  -- a new acquisition, and a person with no recorded visit has no known source.
  if v.id is null or u_created < v.created_at - interval '30 minutes' then v_chan := 'not_collected'; else v_chan := coalesce(v.channel, 'not_collected'); end if;
  insert into public.acquisition_touch
    (subject_type, subject_id, visitor_id, user_id, utm_source, utm_medium, utm_campaign, utm_content, referrer, landing_path, zip,
     first_touch_at, channel, host, is_internal)
  values ('account', uid::text, case when v_chan = 'not_collected' then null else v.visitor_id end, uid,
          case when v_chan = 'not_collected' then null else v.utm_source end, case when v_chan = 'not_collected' then null else v.utm_medium end,
          case when v_chan = 'not_collected' then null else v.utm_campaign end, case when v_chan = 'not_collected' then null else v.utm_content end,
          case when v_chan = 'not_collected' then null else v.referrer end, case when v_chan = 'not_collected' then null else v.landing_path end,
          case when v_chan = 'not_collected' then null else v.zip end, case when v_chan = 'not_collected' then null else v.first_touch_at end,
          v_chan, v.host, v_internal)
  on conflict (subject_type, subject_id) do nothing;
  if v_internal and v.id is not null and not v.is_internal then
    update public.acquisition_touch set is_internal = true where id = v.id;      -- an admin's visitor id is internal traffic
  end if;
end $$;
revoke all on function public.claim_first_touch(uuid) from public, anon;
grant execute on function public.claim_first_touch(uuid) to authenticated;

-- ------------------------------------------------------------------------ 3. a stored report -> the person it is credited to
-- Read-only. The account that made a report, as far as the database knows: the brokerage's single ACTIVE member when the report was
-- generated. Returns no row when the brokerage had zero or several active members (the creator is not recorded).
create or replace function public._report_account(p_report_id uuid, p_at timestamptz)
returns table (brokerage_id uuid, user_id uuid)
language sql stable security definer set search_path = public as $$
  with b as (
    select e.brokerage_id from public.evaluation_credit_all c join public.evaluation e on e.evaluation_id = c.evaluation_id where c.report_id = p_report_id
    union select brokerage_id from public.brokerage_paid_credit where report_id = p_report_id),
  m as (
    select b.brokerage_id, mm.user_id from b join public.brokerage_member mm on mm.brokerage_id = b.brokerage_id
     where mm.joined_at <= p_at and (mm.deactivated_at is null or mm.deactivated_at > p_at))
  select (select brokerage_id from b limit 1), case when (select count(*) from m) = 1 then (select user_id from m) end;
$$;
revoke all on function public._report_account(uuid, timestamptz) from public, anon, authenticated;

-- -------------------------------------------------------------------------------------- 4. the dashboard reader
create or replace function public._acq_channel_rows(p_from date, p_to date, p_grain text, p_zips text[], p_internal boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tz constant text := 'America/Los_Angeles';
  t0 timestamptz := p_from::timestamp at time zone tz;
  t1 timestamptz := (p_to + 1)::timestamp at time zone tz;
  r jsonb;
begin
  with
  vt as (select visitor_id, coalesce(channel, 'not_collected') channel, is_internal, created_at, zip
           from public.acquisition_touch where subject_type = 'visitor'),
  in_set as (select visitor_id from public.events where p_zips is not null and zip_code = any(p_zips) and visitor_id is not null
             union select visitor_id from vt where p_zips is not null and zip = any(p_zips)),
  pv as (select e.visitor_id, e.visit_session_id, e.created_at from public.events e
          where e.event_type = 'page_view' and e.visitor_id is not null and e.created_at >= t0 and e.created_at < t1
            and (p_zips is null or e.zip_code = any(p_zips))),
  visitors as (
    select public._acq_bucket(pv.created_at, p_grain) period, coalesce(vt.channel, 'not_collected') channel,
           count(distinct pv.visitor_id) visitors, count(distinct pv.visit_session_id) sessions,
           count(distinct pv.visitor_id) filter (where vt.created_at is not null
                 and public._acq_bucket(vt.created_at, p_grain) is not distinct from public._acq_bucket(pv.created_at, p_grain)) new_visitors
      from pv left join vt on vt.visitor_id = pv.visitor_id
     where p_internal or not coalesce(vt.is_internal, false)
     group by 1, 2),
  repeat_v as (
    select null::date period, coalesce(vt.channel, 'not_collected') channel, count(*) repeat_visitors from (
        select visitor_id from pv group by visitor_id having count(distinct (created_at at time zone tz)::date) >= 2) rv
      left join vt on vt.visitor_id = rv.visitor_id
     where p_grain = 'all' and (p_internal or not coalesce(vt.is_internal, false)) group by 2),
  reg as (
    select public._acq_bucket(u.created_at, p_grain) period, coalesce(t.channel, 'not_collected') channel, count(*) registered_users
      from auth.users u left join public.acquisition_touch t on t.subject_type = 'account' and t.subject_id = u.id::text
     where u.created_at >= t0 and u.created_at < t1
       and (p_internal or not (public.analytics_is_excluded(u.id) or coalesce(t.is_internal, false)))
       and (p_zips is null or t.visitor_id in (select visitor_id from in_set))
     group by 1, 2),
  dig as (
    select public._acq_bucket(first_at, p_grain) period,
           case when rs is null then 'not_collected'
                else public.classify_channel(case when rs ~ '\.' then null else rs end, null, rc, case when rs ~ '\.' then rs end, '/') end channel,
           count(*) digest_subscriptions
      from (select lower(email) em, min(created_at) first_at, (array_agg(referral_source order by created_at))[1] rs,
                   (array_agg(referral_campaign order by created_at))[1] rc, (array_agg(zip_code order by created_at))[1] z
              from public.users group by lower(email)) d
     where first_at >= t0 and first_at < t1
       and (p_zips is null or z = any(p_zips))
       and (p_internal or not (coalesce(rs, '') = 'admin_test' or coalesce(rc, '') like '%test%'
            or exists (select 1 from auth.users au where lower(au.email) = d.em and public.analytics_is_excluded(au.id))))
     group by 1, 2),
  rep as (
    select public._acq_bucket(s.generated_at, p_grain) period, coalesce(tch.channel, 'not_attributed') channel,
           count(*) reports_created, count(distinct ra.user_id) report_users
      from public.report_snapshot s
      left join lateral public._report_account(s.report_id, s.generated_at) ra on true
      left join public.acquisition_touch tch on tch.subject_type = 'account' and tch.subject_id = ra.user_id::text
     where s.generated_at >= t0 and s.generated_at < t1
       and (p_internal or not (public.analytics_is_excluded(ra.user_id) or coalesce(tch.is_internal, false)))
       and (p_zips is null or tch.visitor_id in (select visitor_id from in_set))
     group by 1, 2),
  allr as (
    select period, channel, visitors, new_visitors, sessions, 0 repeat_visitors, 0 registered_users, 0 digest_subscriptions, 0 reports_created, 0 report_users from visitors
    union all select period, channel, 0, 0, 0, repeat_visitors, 0, 0, 0, 0 from repeat_v
    union all select period, channel, 0, 0, 0, 0, registered_users, 0, 0, 0 from reg
    union all select period, channel, 0, 0, 0, 0, 0, digest_subscriptions, 0, 0 from dig
    union all select period, channel, 0, 0, 0, 0, 0, 0, reports_created, report_users from rep),
  agg as (
    select period, channel, sum(visitors)::int visitors, sum(new_visitors)::int new_visitors,
           greatest(sum(visitors) - sum(new_visitors), 0)::int returning_visitors, sum(sessions)::int sessions,
           sum(repeat_visitors)::int repeat_visitors, sum(registered_users)::int registered_users,
           sum(digest_subscriptions)::int digest_subscriptions, sum(reports_created)::int reports_created, sum(report_users)::int report_users
      from allr group by 1, 2)
  select coalesce(jsonb_agg(row_to_json(a) order by a.period nulls first, a.channel), '[]'::jsonb) into r from agg a;
  return r;
end $$;
revoke all on function public._acq_channel_rows(date,date,text,text[],boolean) from public, anon, authenticated;

create or replace function public.hs_acq_channel_report(
  p_from date default null, p_to date default null, p_grain text default 'day',
  p_zip_set text default null, p_include_internal boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  tz constant text := 'America/Los_Angeles';
  v_to   date := coalesce(p_to, (now() at time zone tz)::date);
  v_from date := coalesce(p_from, coalesce(p_to, (now() at time zone tz)::date) - 29);
  v_zips text[];
  v_start timestamptz;
begin
  if caller_email is null or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_grain not in ('day', 'week') then raise exception 'grain must be day or week' using errcode = '22023'; end if;
  if v_to < v_from or v_to - v_from > 400 then raise exception 'bad date range' using errcode = '22023'; end if;
  if p_zip_set is not null then
    select array_agg(zip) into v_zips from public.zip_set where set_key = p_zip_set;
    if v_zips is null then raise exception 'unknown zip set' using errcode = '22023'; end if;
  end if;
  select min(created_at) into v_start from public.events where event_type = 'page_view' and visitor_id is not null;
  return jsonb_build_object(
    'generated_at', now(), 'timezone', tz, 'grain', p_grain, 'from', v_from, 'to', v_to, 'include_internal', p_include_internal,
    'zip_set', case when p_zip_set is null then null else jsonb_build_object('key', p_zip_set, 'zips', coalesce(array_length(v_zips, 1), 0),
        'overlap_evaluated', (select bool_or(overlaps_other_county is not null) from public.zip_set where set_key = p_zip_set)) end,
    'tracking_started_at', v_start,
    'rows',  public._acq_channel_rows(v_from, v_to, p_grain, v_zips, p_include_internal),
    'range', public._acq_channel_rows(v_from, v_to, 'all', v_zips, p_include_internal),
    'caveats', jsonb_build_array(
      'Visitor, session and channel figures start at tracking_started_at; earlier periods were not collected and are not estimated.',
      'not_collected = a visit or account that predates attribution tracking. not_attributed = a report whose creator is not known (the brokerage had several active members, or the account has no recorded source).',
      'direct is claimed only for home-page landings with no referrer; other referrer-less landings are unknown.',
      'Google and Bing organic are read from the referring domain; either may hide it, which shows as unknown.',
      'A report counts only when a stored report snapshot exists. Evaluation credits are not reports.',
      'With a ZIP set, visitors and sessions count page views of those ZIP pages; registrations and reports count people whose visit viewed one. Reports of accounts with no recorded visit are excluded under a ZIP set.',
      'Weekly figures at the range edges cover only the days inside the range. Weeks start Monday, Los Angeles time.'));
end $$;
revoke all on function public.hs_acq_channel_report(date,date,text,text,boolean) from public, anon;
grant execute on function public.hs_acq_channel_report(date,date,text,text,boolean) to authenticated;

-- -------------------------------------------------------------------------------- 5. exclusions (ids only, no emails)
insert into public.analytics_exclusion (user_id, reason)
select u.id, 'dashboard admin' from auth.users u join public.dashboard_admins a on lower(a.email) = lower(u.email)
on conflict do nothing;
insert into public.analytics_exclusion (user_id, reason)
select distinct au.id, 'known test signup (' || coalesce(pu.referral_source, '') || '/' || coalesce(pu.referral_campaign, '') || ')'
  from public.users pu join auth.users au on lower(au.email) = lower(pu.email)
 where pu.referral_source = 'admin_test' or (pu.referral_source = 'bluesky' and pu.referral_campaign = 'test-manual')
on conflict do nothing;

-- ------------------------------------------- 6. existing hs_acquisition_metrics: stop counting test/other subjects as marketing
-- Spliced from the LIVE body (never retyped); each anchor must match exactly once or the migration aborts.
do $splice$
declare
  d text := pg_get_functiondef('public.hs_acquisition_metrics'::regproc);
  n int;
  pairs text[][] := array[
    array['from public.acquisition_touch group by 1,2) t)',
          'from public.acquisition_touch where subject_type in (''account'',''waitlist'',''area_request'') and not is_internal group by 1,2) t)'],
    array['from public.acquisition_touch group by 1) t)',
          'from public.acquisition_touch where subject_type in (''account'',''waitlist'',''area_request'') and not is_internal group by 1) t)'],
    array['where utm_content is not null group by 1,2) t)',
          'where utm_content is not null and subject_type in (''account'',''waitlist'',''area_request'') and not is_internal group by 1,2) t)'],
    array['(select count(*) from public.acquisition_touch)',
          '(select count(*) from public.acquisition_touch where subject_type in (''account'',''waitlist'',''area_request'') and not is_internal)'],
    array['''users_active'',       (select count(distinct u.id)',
          '''registered_external'', (select count(*) from auth.users u where not public.analytics_is_excluded(u.id)),
      ''users_active'',       (select count(distinct u.id)']];
  i int;
begin
  for i in 1 .. array_length(pairs, 1) loop
    n := (length(d) - length(replace(d, pairs[i][1], ''))) / length(pairs[i][1]);
    if n <> 1 then raise exception 'splice anchor % matched % times (expected 1): %', i, n, pairs[i][1]; end if;
    d := replace(d, pairs[i][1], pairs[i][2]);
  end loop;
  execute d;
end $splice$;
