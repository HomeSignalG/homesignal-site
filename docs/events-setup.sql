-- HomeSignal — anonymous interaction logging for acquisition data.
-- Run once in Supabase (SQL Editor). The browser can only INSERT (write) here,
-- never SELECT (read), so visitors can log events but cannot read anyone's data.
-- No personal contact info is stored — only an anonymous session id + topic/tier.

create table if not exists public.events (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  session_id    text,                 -- anonymous, random, from localStorage (no PII)
  event_type    text not null,        -- 'alert_view' | 'alert_read' | 'signup_intent' | ...
  topic         text,                 -- the matched popup topic (subtopic)
  pipeline_type text,                 -- 'government_notice' | 'news_alert' | ...
  community_id  uuid,
  alert_id      text,
  page_url      text
);

-- Helpful for the acquisition queries (topic interest over time, by community).
create index if not exists events_topic_idx        on public.events (topic);
create index if not exists events_type_created_idx  on public.events (event_type, created_at);
create index if not exists events_community_idx     on public.events (community_id);

-- Row Level Security: browser roles may INSERT, but never SELECT/UPDATE/DELETE.
alter table public.events enable row level security;

drop policy if exists "events insert (anon+auth)" on public.events;
create policy "events insert (anon+auth)"
  on public.events for insert
  to anon, authenticated
  with check (true);

-- Table privileges: grant INSERT only; explicitly no SELECT/UPDATE/DELETE.
revoke all on table public.events from anon, authenticated;
grant insert on table public.events to anon, authenticated;
-- The identity column needs USAGE on its sequence for inserts:
grant usage, select on all sequences in schema public to anon, authenticated;

-- ============================================================================
-- Example acquisition queries (run as the postgres/service role):
--
--   -- Topic demand: views -> reads -> signup-intent, last 30 days
--   select topic,
--          count(*) filter (where event_type='alert_view')   as views,
--          count(*) filter (where event_type='alert_read')   as reads,
--          count(*) filter (where event_type='signup_intent') as intent
--   from public.events
--   where created_at > now() - interval '30 days' and topic is not null
--   group by topic order by intent desc nulls last;
--
--   -- Read-through rate by topic
--   select topic,
--          round(100.0 * count(*) filter (where event_type='alert_read')
--                / nullif(count(*) filter (where event_type='alert_view'),0), 1) as read_pct
--   from public.events group by topic order by read_pct desc nulls last;
-- ============================================================================
