-- public.feeds — government ingest configuration (DDL reference for Phase 1A)
-- Applied manually in Supabase; mirrors homesignal-ingest load_config expectations.
-- If live schema differs, treat the DB as truth and update scripts/gov-feeds/lib/schema.mjs.

-- NOTE: This file documents the contract; it is NOT applied by Phase 1A automation.

create table if not exists public.feeds (
  feed_id               text primary key,
  community_id          uuid not null references public.communities(id),
  source_url            text not null,
  source_type           text not null,
  category              text not null,
  pipeline_type         text not null,
  destination           text not null default 'meetings'
    check (destination in ('meetings', 'alerts')),
  agency_name           text not null,
  geographic_reference  text not null,
  impact_level          text default 'medium',
  active                boolean not null default false,
  notes                 text,
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

create index if not exists feeds_community_id_idx on public.feeds (community_id);
create index if not exists feeds_active_idx on public.feeds (active) where active = true;

comment on table public.feeds is
  'Ingest engine feed registry (DB-first). homesignal-ingest load_config reads active rows.';
comment on column public.feeds.destination is
  'meetings → public.meetings; alerts → public.alerts (vendor county adapters use meetings).';
comment on column public.feeds.source_type is
  'granicus_rss | legistar | civicclerk | rss | html | … — must match an ingest adapter.';
