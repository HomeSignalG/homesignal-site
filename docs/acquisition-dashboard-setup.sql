-- ============================================================
-- HomeSignal — Acquisition Dashboard setup
-- Backs acquisition.html (investor + internal-staff growth dashboard).
-- Run once in Supabase -> SQL Editor. REVIEW BEFORE RUNNING.
--
-- APPLIED to project qwnnmljucajnexpxdgxr on 2026-07-04 (migration
-- `acquisition_dashboard_setup`); allowlist seeded with the founder email.
-- Kept here as the annotated reference / re-runnable source. It creates:
--   1) dashboard_admins  — email allowlist (who may see the dashboard)
--   2) hs_acquisition_metrics() — a SECURITY DEFINER function that returns
--      AGGREGATES ONLY (no PII) to allowlisted, logged-in callers.
--
-- Why a function instead of direct table reads? The site talks to Supabase
-- with the public anon key + the logged-in user's JWT. RLS scopes table reads
-- to a row's owner and `events` is INSERT-only for the browser, so the client
-- cannot compute these aggregates directly — nor should PII ever reach it. The
-- function bypasses RLS to COUNT, but returns only numbers/rates/time-series.
-- ============================================================

-- 1) ADMIN ALLOWLIST -------------------------------------------------
-- One row per person allowed to view the dashboard. `note` is just a label
-- (e.g. 'staff', 'investor: Acme Ventures'). Seed it in step 4.
create table if not exists public.dashboard_admins (
  email     text primary key,
  note      text,
  added_at  timestamptz not null default now()
);

-- RLS on, with NO policies for anon/authenticated: the browser can never read
-- or write this table. The function below reads it as its definer (postgres),
-- which bypasses RLS. Manage rows from the SQL editor / service role only.
alter table public.dashboard_admins enable row level security;
revoke all on table public.dashboard_admins from anon, authenticated;

-- 2) METRICS FUNCTION ------------------------------------------------
-- Gated by the caller's JWT email against dashboard_admins. Returns one jsonb
-- blob of aggregates. Raises 'not authorized' for everyone else, which the
-- page maps to its "no access" state.
create or replace function public.hs_acquisition_metrics()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_email text := auth.jwt() ->> 'email';
  result       jsonb;
begin
  -- Gate: must be a logged-in, allowlisted email.
  if caller_email is null
     or not exists (select 1 from public.dashboard_admins da where da.email = caller_email) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'generated_at', now(),

    'kpis', jsonb_build_object(
      'users_total',        (select count(*) from public.users),
      'users_active',       (select count(*) from public.users where coalesce(unsubscribed,false) = false),
      'unsub_rate_pct',     (select round(100.0 * count(*) filter (where unsubscribed)
                                          / nullif(count(*),0), 1) from public.users),
      'subscriptions_total',(select count(*) from public.user_subscriptions),
      'communities_live',   (select count(*) from public.communities),
      'emails_sent',        (select count(*) filter (where status = 'sent') from public.email_events),
      'email_error_rate_pct',(select round(100.0 * count(*) filter (where status <> 'sent')
                                          / nullif(count(*),0), 1) from public.email_events),
      'signup_intents',     (select count(*) from public.events where event_type = 'signup_intent'),
      'community_requests', (select count(*) from public.community_requests)
    ),

    -- Signups per ISO week (oldest -> newest).
    'signups_by_week', coalesce((
      select jsonb_agg(row_to_json(t) order by t.week)
      from (
        select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week,
               count(*)::int as count
        from public.users
        group by 1
      ) t
    ), '[]'::jsonb),

    -- Anonymous acquisition funnel, last 30 days.
    'funnel', jsonb_build_object(
      'alert_view',   (select count(*) from public.events
                        where event_type = 'alert_view'   and created_at > now() - interval '30 days'),
      'alert_read',   (select count(*) from public.events
                        where event_type = 'alert_read'   and created_at > now() - interval '30 days'),
      'signup_intent',(select count(*) from public.events
                        where event_type = 'signup_intent' and created_at > now() - interval '30 days'),
      'signup',       (select count(*) from public.users
                        where created_at > now() - interval '30 days')
    ),

    -- Top topics by follower count.
    'topics_top', coalesce((
      select jsonb_agg(row_to_json(t))
      from (
        select topic, count(*)::int as followers
        from public.user_subscriptions
        where topic is not null
        group by topic
        order by count(*) desc, topic
        limit 8
      ) t
    ), '[]'::jsonb),

    -- Per-community users + topic follows.
    'communities', coalesce((
      select jsonb_agg(row_to_json(t) order by t.users desc, t.name)
      from (
        select c.name,
               (select count(*) from public.users u where u.community_id = c.id)::int as users,
               (select count(*) from public.user_subscriptions s where s.community_id = c.id)::int as subscriptions
        from public.communities c
      ) t
    ), '[]'::jsonb),

    -- Paid subscriptions by status (placeholder until billing is live).
    'paid', jsonb_build_object(
      'active',   (select count(*) from public.subscriptions where status = 'active'),
      'trialing', (select count(*) from public.subscriptions where status = 'trialing'),
      'canceled', (select count(*) from public.subscriptions where status = 'canceled')
    )
  ) into result;

  return result;
end;
$$;

-- 3) GRANTS ----------------------------------------------------------
-- Only logged-in roles may CALL the function; the allowlist check inside is the
-- real gate. anon (not logged in) cannot execute it at all.
revoke all on function public.hs_acquisition_metrics() from public, anon;
grant execute on function public.hs_acquisition_metrics() to authenticated;

-- 4) SEED THE ALLOWLIST (edit before running, or run separately) -----
-- Add every staff member and investor who should see the dashboard.
--   insert into public.dashboard_admins (email, note) values
--     ('you@homesignal.net', 'staff'),
--     ('investor@example.com', 'investor: Example Fund')
--   on conflict (email) do nothing;

-- 5) VERIFY ----------------------------------------------------------
--   select public.hs_acquisition_metrics();      -- as an allowlisted user's JWT
--   -- From the SQL editor (postgres) the gate is bypassed only if your email
--   -- is null; seed your email first, or test via the page while logged in.
