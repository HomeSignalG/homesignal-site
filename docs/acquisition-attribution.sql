-- HomeSignal — acquisition attribution (P0-4 + P0-6 of the MAPS1 Bluesky audit)
--
-- ONE migration, not two, deliberately: hs_acquisition_metrics grows an `attribution`
-- block that reads public.acquisition_touch, so shipping the table and the reader
-- separately would leave a window where the dashboard RPC references a missing relation.
-- (Same rule the EPA Phase-1B note records: adding a column a hot-path function must
-- maintain is one migration.)
--
-- WHAT THIS FIXES, measured 2026-09-15 before the change:
--   auth.users 28 · public.users 11 · overlap 5
--     -> hs_acquisition_metrics reported `users_total` and the funnel's `signup` stage
--        from public.users, the DIGEST-SUBSCRIBER table, not from free accounts.
--   users.referral_source non-null on 5 of 11 rows, every one 'bluesky'/'test-manual'
--     -> no shipped code path had ever written a real referral.
--   events where page_url like '%utm_%' : 0 of 8,768
--     -> no UTM traffic has ever been observed.
--
-- PARITY WITH PRODUCTION, PROVEN NOT ASSERTED (2026-09-15, applied then re-read):
--   A raw md5 of this file against pg_get_functiondef can never match — Postgres
--   re-renders the header (RETURNS/LANGUAGE casing, attribute order). The body between
--   the $function$ markers IS stored verbatim, so that is what gets fingerprinted, and
--   this file carries commentary the catalog does not. Stripping `--` comments from both
--   sides and collapsing whitespace:
--     hs_acquisition_metrics       parked = live = bbc96d434e5bacd97d118b7d56158798 (5,241 chars)
--     hs_record_acquisition_touch  parked = live = 3c2006d877e7af9e8b8608b34cf16626 (1,732 chars)
--   Identical md5 AND identical length on both, so the EXECUTABLE content matches and the
--   only difference is comments. Re-run that check after any apply; a length match alone
--   would not be evidence, and neither would an md5 over a body whose comments differ.
--
-- POSTURE, copied verbatim from app_premium_waitlist / community_requests (probed):
--   table  : RLS ENABLED, acl = postgres + service_role only. No anon, no authenticated.
--   writer : SECURITY DEFINER, owner postgres, execute granted to anon/authenticated.
-- There is therefore no direct read or write for the browser to reach by accident.

-- ---------------------------------------------------------------- the table ----
create table if not exists public.acquisition_touch (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),

  -- WHAT converted. Checked, so a typo cannot silently create a fourth kind.
  subject_type    text not null check (subject_type in ('account','waitlist','area_request')),
  -- WHICH row converted, resolved SERVER-SIDE (see the function). Never an email:
  -- this table duplicates no PII that the source tables already hold.
  subject_id      text not null,

  -- The first touch, exactly as the landing URL stated it. Absent stays absent.
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  referrer        text,
  landing_path    text,
  zip             text,
  first_touch_at  timestamptz
);

-- FIRST-TOUCH-WINS, enforced in the database rather than trusted from the browser.
-- shell.js::captureReferral already refuses to overwrite a stored first touch, but a
-- cleared localStorage, a second device or a re-submit must not be able to re-attribute
-- a conversion that already happened. The writer below is `on conflict do nothing`.
create unique index if not exists acquisition_touch_subject_key
  on public.acquisition_touch (subject_type, subject_id);

create index if not exists acquisition_touch_created_at_idx
  on public.acquisition_touch (created_at desc);
create index if not exists acquisition_touch_campaign_idx
  on public.acquisition_touch (utm_campaign, utm_content);

alter table public.acquisition_touch enable row level security;
-- No policies and no anon/authenticated grant: RLS fails closed, and every read is a
-- dashboard RPC while every write is the SECURITY DEFINER writer below.
revoke all on public.acquisition_touch from anon, authenticated;

comment on table public.acquisition_touch is
  'First-touch marketing attribution for a conversion. One row per (subject_type, '
  'subject_id), first touch wins. Written only by hs_record_acquisition_touch().';

-- ------------------------------------------------------------- the writer ------
-- hs_record_acquisition_touch(p_subject_type, p_email, p_zip, p_utm) -> jsonb
--
-- THE NON-ORACLE PROPERTY IS LOAD-BEARING. app_premium_waitlist's join RPC returns an
-- identical shape for a new lead and a repeat "so the response cannot be used to
-- discover whether an address is already on the list". A writer that answered
-- {ok:false,'not_found'} when an email is absent would reintroduce exactly that oracle
-- through a different door. So a well-formed call ALWAYS returns {ok:true}; whether a
-- subject resolved, and whether a row was written, is deliberately not observable.
create or replace function public.hs_record_acquisition_touch(
  p_subject_type text,
  p_email        text default null,
  p_zip          text default null,
  p_utm          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  _type    text := lower(btrim(coalesce(p_subject_type, '')));
  _email   text := lower(btrim(coalesce(p_email, '')));
  _zip     text := btrim(coalesce(p_zip, ''));
  _subject text;
  -- Everything the browser hands us is length-capped at the insert below. The browser
  -- half caps too; this side is the authority, not that one.
  _u       jsonb := coalesce(p_utm, '{}'::jsonb);
begin
  if _type not in ('account','waitlist','area_request') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_subject_type');
  end if;

  -- An absent UTM is not an error: a direct visit converts too, and recording it with
  -- every field null is the honest row. What is refused is a malformed CALL.
  if jsonb_typeof(_u) <> 'object' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_utm');
  end if;

  if _zip !~ '^\d{5}$' then _zip := null; end if;

  -- ---- resolve the subject, server-side, without trusting or storing the email ----
  if _type = 'account' then
    -- The caller cannot name someone else's account: it is their own JWT or nothing.
    _subject := auth.uid()::text;
  elsif _email = '' then
    _subject := null;
  elsif _type = 'waitlist' then
    select w.id::text into _subject
      from public.app_premium_waitlist w
     where w.email = _email
     order by w.created_at desc
     limit 1;
  elsif _type = 'area_request' then
    select r.id::text into _subject
      from public.community_requests r
     where r.email = _email
       and (_zip is null or r.requested_zip = _zip)
     order by r.created_at desc
     limit 1;
  end if;

  -- Unresolved is a silent no-op, NOT a reported failure. See the non-oracle note.
  if _subject is null or _subject = '' then
    return jsonb_build_object('ok', true);
  end if;

  insert into public.acquisition_touch (
    subject_type, subject_id,
    utm_source, utm_medium, utm_campaign, utm_content,
    referrer, landing_path, zip, first_touch_at
  ) values (
    _type, _subject,
    nullif(left(btrim(_u->>'source'),   120), ''),
    nullif(left(btrim(_u->>'medium'),   120), ''),
    nullif(left(btrim(_u->>'campaign'), 200), ''),
    nullif(left(btrim(_u->>'content'),  200), ''),
    nullif(left(btrim(_u->>'referrer'), 500), ''),
    nullif(left(btrim(_u->>'landing'),  500), ''),
    _zip,
    -- A browser-supplied timestamp is advisory; an unparseable one becomes absent
    -- rather than now(), which would claim a first touch we never observed.
    (case when (_u->>'ts') ~ '^\d{4}-\d{2}-\d{2}T' then (_u->>'ts')::timestamptz else null end)
  )
  on conflict (subject_type, subject_id) do nothing;   -- first touch wins

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.hs_record_acquisition_touch(text, text, text, jsonb) from public;
grant execute on function public.hs_record_acquisition_touch(text, text, text, jsonb)
  to anon, authenticated, service_role;

comment on function public.hs_record_acquisition_touch(text, text, text, jsonb) is
  'Record one first-touch attribution row for a conversion. Resolves the subject '
  'server-side and stores no email. Always returns {ok:true} for a well-formed call '
  'so it cannot be used as a membership oracle.';

-- ========================================================================= P0-6 ====
-- hs_acquisition_metrics: measure the product's actual signup, and report attribution.
--
-- THE DEFECT: `users_total` and the funnel's `signup` stage both read public.users —
-- the digest-subscriber table the ingest pipeline writes. A HomeSignal free account is
-- an auth.users row created by shell.js::authSubmit -> signInWithOtp. Measured
-- 2026-09-15: auth.users 28, public.users 11, overlap 5. The headline conversion number
-- was undercounting free accounts by 23 of 28 and describing a different product.
--
-- THE SHAPE IS BACKWARD-COMPATIBLE ON PURPOSE. The static site and the database deploy
-- separately, so for a window the OLD acquisition.html reads this NEW function. Every
-- key it reads (`kpis.users_total`, `kpis.users_active`, `funnel.signup`, …) is still
-- present; what changed is that they now mean what their labels always claimed. The
-- digest numbers are ADDED under new, explicitly-digest names rather than removed, so
-- nothing that was measurable stops being measurable.
-- funnel.page_view is the LANDING STAGE and is brand new: nothing defined hsLogEvent
-- until 2026-09-15, so it reads 0 until real traffic arrives. That zero is honest, not a
-- defect — and the dashboard takes its funnel denominator from the LARGEST stage, so a 0
-- here cannot inflate the stages below it (acquisition.html::acqMetricsCard).
create or replace function public.hs_acquisition_metrics()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  caller_email text := auth.jwt() ->> 'email';
  result       jsonb;
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),
    'kpis', jsonb_build_object(
      -- FREE ACCOUNTS — the conversion this product actually sells. auth.users is the
      -- table signInWithOtp({shouldCreateUser:true}) writes.
      'users_total',        (select count(*) from auth.users),
      -- ACTIVATED = the account did the thing the account is for: saved an address or
      -- followed a ZIP. This is the funnel's activation stage, which had no measure at all.
      'users_active',       (select count(distinct u.id) from auth.users u
                              where exists (select 1 from public.app_properties p where p.user_id = u.id)
                                 or exists (select 1 from public.app_follows f
                                             where f.user_id = u.id and f.target_type = 'community')),
      -- DIGEST SUBSCRIBERS — the old users_total, under a name that says what it is.
      'digest_subscribers', (select count(*) from public.users),
      'digest_active',      (select count(*) from public.users where coalesce(unsubscribed,false) = false),
      'unsub_rate_pct',     (select round(100.0 * count(*) filter (where unsubscribed) / nullif(count(*),0), 1) from public.users),
      'subscriptions_total',(select count(*) from public.user_subscriptions),
      'communities_live',   (select count(*) from public.communities),
      'emails_sent',        (select count(*) filter (where status = 'sent') from public.email_events),
      'email_error_rate_pct',(select round(100.0 * count(*) filter (where status <> 'sent') / nullif(count(*),0), 1) from public.email_events),
      'signup_intents',     (select count(*) from public.events where event_type = 'signup_intent'),
      'community_requests', (select count(*) from public.community_requests),
      'attributed_touches', (select count(*) from public.acquisition_touch)
    ),
    -- Weekly signups now count ACCOUNTS. auth.users has no created_at alias problem —
    -- the column is created_at, same as public.users, so the shape is unchanged.
    'signups_by_week', coalesce((
      select jsonb_agg(row_to_json(t) order by t.week)
      from (select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, count(*)::int as count
            from auth.users group by 1) t), '[]'::jsonb),
    'funnel', jsonb_build_object(
      'page_view',    (select count(*) from public.events where event_type='page_view'     and created_at > now() - interval '30 days'),
      'alert_view',   (select count(*) from public.events where event_type='alert_view'    and created_at > now() - interval '30 days'),
      'alert_read',   (select count(*) from public.events where event_type='alert_read'    and created_at > now() - interval '30 days'),
      'signup_intent',(select count(*) from public.events where event_type='signup_intent' and created_at > now() - interval '30 days'),
      -- CORRECTED: free accounts, not digest subscribers.
      'signup',       (select count(*) from auth.users   where created_at > now() - interval '30 days'),
      'activated',    (select count(distinct u.id) from auth.users u
                        where u.created_at > now() - interval '30 days'
                          and (exists (select 1 from public.app_properties p where p.user_id = u.id)
                            or exists (select 1 from public.app_follows f
                                        where f.user_id = u.id and f.target_type = 'community'))),
      -- The old number, kept visible under a name that says which table it came from.
      'signup_digest',(select count(*) from public.users where created_at > now() - interval '30 days')
    ),
    -- NEW: where conversions came from. Null source is a direct/unattributed visit and
    -- is reported as such rather than dropped — an absent campaign is a real finding.
    'attribution', jsonb_build_object(
      'by_source', coalesce((
        select jsonb_agg(row_to_json(t) order by t.conversions desc, t.source)
        from (select coalesce(utm_source,'(direct)') as source,
                     coalesce(utm_medium,'(none)')   as medium,
                     count(*)::int                   as conversions,
                     count(*) filter (where subject_type='account')::int      as accounts,
                     count(*) filter (where subject_type='waitlist')::int     as waitlist,
                     count(*) filter (where subject_type='area_request')::int as area_requests
              from public.acquisition_touch group by 1,2) t), '[]'::jsonb),
      'by_campaign', coalesce((
        select jsonb_agg(row_to_json(t) order by t.conversions desc, t.campaign)
        from (select coalesce(utm_campaign,'(none)') as campaign,
                     count(*)::int as conversions,
                     count(*) filter (where subject_type='account')::int as accounts
              from public.acquisition_touch group by 1) t), '[]'::jsonb),
      -- PER-CREATIVE. This is the row the Bluesky campaign is measured by: one
      -- utm_content value per post.
      'by_content', coalesce((
        select jsonb_agg(row_to_json(t) order by t.conversions desc, t.content)
        from (select coalesce(utm_content,'(none)') as content,
                     coalesce(utm_campaign,'(none)') as campaign,
                     count(*)::int as conversions,
                     count(*) filter (where subject_type='account')::int as accounts,
                     min(created_at) as first_seen,
                     max(created_at) as last_seen
              from public.acquisition_touch
              where utm_content is not null group by 1,2) t), '[]'::jsonb)
    ),
    'topics_top', coalesce((
      select jsonb_agg(row_to_json(t)) from (
        select topic, count(*)::int as followers from public.user_subscriptions
        where topic is not null group by topic order by count(*) desc, topic limit 8) t), '[]'::jsonb),
    'communities', coalesce((
      select jsonb_agg(row_to_json(t) order by t.users desc, t.name) from (
        select c.name,
               (select count(*) from public.users u where u.community_id = c.id)::int as users,
               (select count(*) from public.user_subscriptions s where s.community_id = c.id)::int as subscriptions
        from public.communities c) t), '[]'::jsonb),
    'paid', jsonb_build_object(
      'active',   (select count(*) from public.subscriptions where status='active'),
      'trialing', (select count(*) from public.subscriptions where status='trialing'),
      'canceled', (select count(*) from public.subscriptions where status='canceled')
    ),
    -- Event-logging drop accounting (events.dropped_before). measured_rows counts
    -- rows written by an instrumented client; NULL (older) rows are excluded, so
    -- dropped_measured is the KNOWN floor, not the whole history (which is unknown).
    'data_quality', jsonb_build_object(
      'events_total',            (select count(*) from public.events),
      'events_measured_rows',    (select count(*) from public.events where dropped_before is not null),
      'events_dropped_measured', (select coalesce(sum(dropped_before),0)::int from public.events),
      'events_newest',           (select max(created_at) from public.events)
    )
  ) into result;

  return result;
end;
$function$;
