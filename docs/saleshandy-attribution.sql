-- Jody — Saleshandy campaign attribution + aggregate campaign stats.
-- PARKED (repo convention): review, then apply in order via db-sql / apply_migration. NOT applied.
--
-- WHAT THIS IS
--   1. public.events gains four nullable campaign columns (ref_source / ref_medium / ref_campaign /
--      ref_content), written by lib/data.js HS.referralLib.eventFields. Untagged visits write the
--      same row they always did.
--   2. outreach.saleshandy_campaign / saleshandy_campaign_daily / saleshandy_sync_run: AGGREGATE
--      Saleshandy statistics, one row per campaign per day. No prospect name, email or per-recipient row.
--   3. public.hs_saleshandy_metrics(p_days): the ONE gated reader acquisition.html calls. Aggregates only.
--
-- ORDER OF OPERATIONS (events_entry_family.sql warns about this exact trap): apply this file BEFORE the
-- site change deploys. A client insert that names a column that does not exist is refused by PostgREST
-- and the event is dropped silently. (The client only names ref_* when a campaign touch exists, so
-- ordinary visits are unaffected either way.)
--
-- PRIVACY: nothing here stores or returns a person. Campaign links carry utm_* labels only.

begin;

-- 1. events: campaign columns ------------------------------------------------------------------
alter table public.events add column if not exists ref_source   text;
alter table public.events add column if not exists ref_medium   text;
alter table public.events add column if not exists ref_campaign text;
alter table public.events add column if not exists ref_content  text;

alter table public.events drop constraint if exists events_ref_labels_bounded;
alter table public.events add constraint events_ref_labels_bounded check (
  (ref_source   is null or ref_source   ~ '^[a-z0-9._~:/_-]{1,80}$') and
  (ref_medium   is null or ref_medium   ~ '^[a-z0-9._~:/_-]{1,80}$') and
  (ref_campaign is null or ref_campaign ~ '^[a-z0-9._~:/_-]{1,80}$') and
  (ref_content  is null or ref_content  ~ '^[a-z0-9._~:/_-]{1,80}$'));

create index if not exists events_ref_campaign_idx
  on public.events (ref_campaign, event_type, created_at) where ref_campaign is not null;

comment on column public.events.ref_campaign is
  'utm_campaign of the campaign touch the visitor came through (lowercase label; Saleshandy rows match outreach.saleshandy_campaign.campaign_key). NULL = untagged.';

-- 2. Saleshandy aggregate tables ----------------------------------------------------------------
create schema if not exists outreach;

-- One row per Saleshandy sequence/campaign. campaign_key is the utm_campaign value the email links use.
create table if not exists outreach.saleshandy_campaign (
  sh_campaign_id text primary key,                       -- Saleshandy's own id, as text
  campaign_key   text not null unique
                 check (campaign_key ~ '^[a-z0-9._~:/_-]{1,80}$'),
  name           text not null,
  status         text,
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One row per campaign per day. UNIQUE (sh_campaign_id, stat_date) is the duplicate guard:
-- the sync upserts on it, so a re-run, a retry or an overlapping window can never double count.
create table if not exists outreach.saleshandy_campaign_daily (
  sh_campaign_id text not null references outreach.saleshandy_campaign (sh_campaign_id),
  stat_date      date not null,
  sent           integer not null default 0 check (sent >= 0),
  bounced        integer not null default 0 check (bounced >= 0),
  unsubscribed   integer not null default 0 check (unsubscribed >= 0),
  replied        integer,                                 -- NULL = the plan/API does not report it
  synced_at      timestamptz not null default now(),
  primary key (sh_campaign_id, stat_date)
);

-- One row per sync attempt: the heartbeat and the evidence of what a run read.
create table if not exists outreach.saleshandy_sync_run (
  id             bigint generated always as identity primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  status         text not null default 'running' check (status in ('running','ok','failed')),
  window_from    date,
  window_to      date,
  campaigns_read integer,
  rows_upserted  integer,
  error          text
);

-- Not readable or writable by any browser role; the sync (service role) and the definer reader only.
alter table outreach.saleshandy_campaign        enable row level security;
alter table outreach.saleshandy_campaign_daily  enable row level security;
alter table outreach.saleshandy_sync_run        enable row level security;
revoke all on outreach.saleshandy_campaign, outreach.saleshandy_campaign_daily, outreach.saleshandy_sync_run
  from public, anon, authenticated;
grant select, insert, update on outreach.saleshandy_campaign, outreach.saleshandy_campaign_daily,
  outreach.saleshandy_sync_run to service_role;
grant usage on schema outreach to service_role;

-- 3. The gated reader ---------------------------------------------------------------------------
-- Allowlist = public.dashboard_admins (the same gate as hs_acquisition_dashboard). Aggregates only:
-- a campaign label, counts, and rates. Registrations are counted as distinct emails INSIDE the
-- function; no email, ZIP or address is ever returned.
create or replace function public.hs_saleshandy_metrics(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public, outreach
stable
as $fn$
declare
  caller_email text := auth.jwt() ->> 'email';
  d            integer := least(greatest(coalesce(p_days, 30), 1), 365);
  since_ts     timestamptz;
  since_date   date;
  result       jsonb;
begin
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  since_ts   := now() - make_interval(days => d);
  since_date := (now() - make_interval(days => d))::date;

  with sh as (
    select c.campaign_key, c.name, c.status,
           coalesce(sum(s.sent), 0)::bigint         as sent,
           coalesce(sum(s.bounced), 0)::bigint      as bounced,
           coalesce(sum(s.unsubscribed), 0)::bigint as unsubscribed,
           case when bool_or(s.replied is not null) then sum(s.replied) end as replied,
           max(s.stat_date)                         as newest_stat_date
    from outreach.saleshandy_campaign c
    left join outreach.saleshandy_campaign_daily s
           on s.sh_campaign_id = c.sh_campaign_id and s.stat_date >= since_date
    group by c.campaign_key, c.name, c.status
  ),
  ev as (
    select e.ref_campaign as k,
           count(distinct e.session_id) filter (where e.event_type = 'campaign_landing')   as visitors,
           count(*)                     filter (where e.event_type = 'property_lookup')    as lookups,
           count(*)                     filter (where e.event_type = 'report_created')     as reports
    from public.events e
    where e.created_at >= since_ts and e.ref_campaign is not null
    group by e.ref_campaign
  ),
  us as (
    select u.referral_campaign as k, count(distinct lower(u.email)) as registrations
    from public.users u
    where u.created_at >= since_ts and u.referral_campaign is not null
    group by u.referral_campaign
  ),
  paid as (
    select u.referral_campaign as k, count(distinct lower(u.email)) as paying
    from public.users u
    join public.subscriptions sb on lower(sb.email) = lower(u.email)
    where u.referral_campaign is not null and sb.status in ('active','trialing')
    group by u.referral_campaign
  ),
  keys as (
    select campaign_key as k from sh
    union select k from ev
    union select k from us
  )
  select jsonb_build_object(
    'generated_at', now(),
    'window_days',  d,
    'last_sync',    (select jsonb_build_object('finished_at', r.finished_at, 'status', r.status,
                                               'window_to', r.window_to)
                     from outreach.saleshandy_sync_run r order by r.id desc limit 1),
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'campaign',      k.k,
        'name',          sh.name,
        'status',        sh.status,
        'sent',          coalesce(sh.sent, 0),
        'bounced',       coalesce(sh.bounced, 0),
        'unsubscribed',  coalesce(sh.unsubscribed, 0),
        'replied',       sh.replied,
        'newest_stat_date', sh.newest_stat_date,
        'visitors',      coalesce(ev.visitors, 0),
        'lookups',       coalesce(ev.lookups, 0),
        'reports',       coalesce(ev.reports, 0),
        'registrations', coalesce(us.registrations, 0),
        'paying',        coalesce(paid.paying, 0)
      ) order by coalesce(sh.sent, 0) desc, k.k collate "C")
      from keys k
      left join sh   on sh.campaign_key = k.k
      left join ev   on ev.k = k.k
      left join us   on us.k = k.k
      left join paid on paid.k = k.k
    ), '[]'::jsonb),
    -- Coverage: how many registrations in the window can be tied to a campaign at all.
    'coverage', jsonb_build_object(
      'registrations_total',        (select count(distinct lower(email)) from public.users where created_at >= since_ts),
      'registrations_campaign',     (select count(distinct lower(email)) from public.users
                                     where created_at >= since_ts and referral_campaign is not null
                                       and referral_source is not null),
      'tracking_started_at',        (select min(created_at) from public.events where ref_campaign is not null)
    )
  ) into result;
  return result;
end;
$fn$;

revoke all on function public.hs_saleshandy_metrics(integer) from public, anon;
grant execute on function public.hs_saleshandy_metrics(integer) to authenticated;

-- Post-conditions: refuse to commit a half-applied or wrongly-granted change.
do $$
begin
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'events'
        and column_name in ('ref_source','ref_medium','ref_campaign','ref_content')) <> 4 then
    raise exception 'events ref_* columns missing';
  end if;
  if has_table_privilege('anon', 'outreach.saleshandy_campaign_daily', 'select')
     or has_table_privilege('authenticated', 'outreach.saleshandy_campaign_daily', 'select') then
    raise exception 'saleshandy tables are readable by a browser role';
  end if;
  if has_function_privilege('anon', 'public.hs_saleshandy_metrics(integer)', 'execute') then
    raise exception 'hs_saleshandy_metrics is callable by anon';
  end if;
  if not has_table_privilege('anon', 'public.events', 'insert')
     or has_table_privilege('anon', 'public.events', 'select') then
    raise exception 'events browser grants changed: anon must insert and must not select';
  end if;
end $$;

commit;
