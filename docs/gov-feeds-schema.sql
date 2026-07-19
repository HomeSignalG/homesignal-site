-- public.feeds — live schema reference (verified 2026-07-19 via PostgREST column probe).
-- Applied in Supabase; homesignal-ingest load_config reads active rows at runtime.
-- Authoring surface: homesignal-ingest/feeds.csv (NOT duplicated in homesignal-site).
--
-- Verified columns (GET /rest/v1/feeds?select=<col>&limit=1 → 200):
--   feed_id, community_id, source, source_type, category, pipeline_type,
--   agency_name, geographic_reference, impact_level, active, sort_order,
--   target_table, filter_expr, dedupe_on, status_notes, updated_at
--
-- NOT present (400 on select=): source_url, destination, notes, filter, id

create table if not exists public.feeds (
  feed_id               text primary key,
  community_id          uuid not null references public.communities(id),
  source                text not null,
  source_type           text not null check (source_type in ('rss', 'keyword', 'html', 'email')),
  category              text not null,
  pipeline_type         text not null,
  agency_name           text not null,
  geographic_reference  text not null,
  impact_level          text default 'medium',
  active                boolean not null default false,
  sort_order            integer not null default 0,
  target_table          text not null default 'meetings',
  filter_expr           text not null default '',
  dedupe_on             text not null default '',
  status_notes          text not null default '',
  updated_at            timestamptz default now()
);

create index if not exists feeds_community_id_idx on public.feeds (community_id);
create index if not exists feeds_active_idx on public.feeds (active) where active = true;

comment on table public.feeds is
  'Ingest engine feed registry (DB-first). homesignal-ingest load_config reads active rows.';
comment on column public.feeds.source is
  'Feed locator: http(s) URL for rss/html; keyword phrase or search URL for keyword; mailbox address for email.';
comment on column public.feeds.source_type is
  'Production values: rss | keyword | html | email. Vendor adapters: Granicus=rss, Legistar/CivicClerk=html.';
comment on column public.feeds.target_table is
  'Destination table for ingested items: alerts | meetings (engine routing).';
comment on column public.feeds.filter_expr is
  'Optional engine-side filter (vendor/body selector, PMN publicbody path fragment, etc.).';
comment on column public.feeds.dedupe_on is
  'Dedupe key fields for the ingest engine (e.g. guid|link).';
comment on column public.feeds.status_notes is
  'Operator notes; not used by ingest matching.';
