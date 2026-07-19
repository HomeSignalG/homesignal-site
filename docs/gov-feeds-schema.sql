-- public.feeds — live schema reference (verified 2026-07-19 via PostgREST column probe).
-- Applied in Supabase; homesignal-ingest load_config reads active rows at runtime.
-- Authoring surface: homesignal-ingest/feeds.csv (NOT duplicated in homesignal-site).

-- Verified columns (200 on anon select=col):
--   feed_id, community_id, source, source_type, category, pipeline_type,
--   agency_name, geographic_reference, impact_level, active, sort_order, updated_at
--
-- NOT present (removed from Phase 1A draft): source_url, destination, notes, id

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
  updated_at            timestamptz default now()
);

create index if not exists feeds_community_id_idx on public.feeds (community_id);
create index if not exists feeds_active_idx on public.feeds (active) where active = true;

comment on table public.feeds is
  'Ingest engine feed registry (DB-first). homesignal-ingest load_config reads active rows.';
comment on column public.feeds.source is
  'Feed URL. Granicus: ViewPublisherRSS.php; Legistar: Calendar.aspx; CivicClerk: portal root.';
comment on column public.feeds.source_type is
  'Production values: rss | keyword | html | email. Vendor adapters: Granicus=rss, Legistar/CivicClerk=html.';
