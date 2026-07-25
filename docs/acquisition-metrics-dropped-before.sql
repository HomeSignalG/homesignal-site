-- HomeSignal — extend hs_acquisition_metrics() with event-drop accounting.
-- Parked DDL of record (applied to project qwnnmljucajnexpxdgxr via MCP). Additive
-- only: adds a top-level `data_quality` key surfacing events.dropped_before so the
-- acquisition dashboard can show the MEASURED event-drop floor. Everything else in
-- the function is unchanged from its prior definition.
--
-- data_quality = {
--   events_total            : all rows in public.events
--   events_measured_rows    : rows with dropped_before NOT NULL (written by an
--                             instrumented client) — the denominator that is actually
--                             measured. 0 until events.js drop-flush ships to prod.
--   events_dropped_measured : sum(dropped_before) — the KNOWN floor of dropped events.
--                             NULL rows are excluded, so this is NOT whole-history;
--                             pre-instrumentation drops remain unknown (never 0).
-- }
-- The dashboard renders "not yet measured" when events_measured_rows = 0, so a 0 is
-- never misread as "zero drops" over the unmeasured window.

CREATE OR REPLACE FUNCTION public.hs_acquisition_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      'users_total',        (select count(*) from public.users),
      'users_active',       (select count(*) from public.users where coalesce(unsubscribed,false) = false),
      'unsub_rate_pct',     (select round(100.0 * count(*) filter (where unsubscribed) / nullif(count(*),0), 1) from public.users),
      'subscriptions_total',(select count(*) from public.user_subscriptions),
      'communities_live',   (select count(*) from public.communities),
      'emails_sent',        (select count(*) filter (where status = 'sent') from public.email_events),
      'email_error_rate_pct',(select round(100.0 * count(*) filter (where status <> 'sent') / nullif(count(*),0), 1) from public.email_events),
      'signup_intents',     (select count(*) from public.events where event_type = 'signup_intent'),
      'community_requests', (select count(*) from public.community_requests)
    ),
    'signups_by_week', coalesce((
      select jsonb_agg(row_to_json(t) order by t.week)
      from (select to_char(date_trunc('week', created_at), 'YYYY-MM-DD') as week, count(*)::int as count
            from public.users group by 1) t), '[]'::jsonb),
    'funnel', jsonb_build_object(
      'alert_view',   (select count(*) from public.events where event_type='alert_view'    and created_at > now() - interval '30 days'),
      'alert_read',   (select count(*) from public.events where event_type='alert_read'    and created_at > now() - interval '30 days'),
      'signup_intent',(select count(*) from public.events where event_type='signup_intent' and created_at > now() - interval '30 days'),
      'signup',       (select count(*) from public.users  where created_at > now() - interval '30 days')
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
      'events_dropped_measured', (select coalesce(sum(dropped_before),0)::int from public.events)
    )
  ) into result;

  return result;
end;
$function$;
