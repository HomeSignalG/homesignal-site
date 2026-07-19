-- public.feeds — illustrative DDL reference (NOT an extracted production schema).
--
-- What IS verified (2026-07-19 PostgREST column probe only):
--   GET /rest/v1/feeds?select=<col>&limit=1 → 200 when present, 400 when absent.
--
-- Columns verified PRESENT:
--   feed_id, community_id, county, source, source_type, category, pipeline_type,
--   agency_name, geographic_reference, impact_level, active, sort_order,
--   target_table, filter_expr, dedupe_on, status_notes, updated_at
--
-- Names verified ABSENT (400 on select=):
--   source_url, destination, notes, filter, id, status
--
-- What is NOT verified by that probe: column types, nullability, defaults, check
-- constraints, FK definitions, and index definitions below. Reconcile against live
-- information_schema or the Supabase dashboard before applying any DDL.
--
-- feeds.csv: canonical header (parsed by column name; order-independent). Known
-- columns include feed_id, county, community_id, source, source_type, category,
-- pipeline_type, agency_name, geographic_reference, impact_level, active, sort_order,
-- target_table, filter (alias → filter_expr), dedupe_on, status / notes (alias →
-- status_notes). The authoritative file lives in homesignal-ingest/feeds.csv.
--
-- Column notes (specific items called out in review):
--   community_id  — uuid; FK to public.communities(id) shown illustratively (UNVERIFIED)
--   active        — boolean; DB default UNVERIFIED (scripts default candidates to false)
--   county        — text; nullability and default UNVERIFIED (scripts default to '')
--   sort_order    — integer; DB default UNVERIFIED (scripts default to 0)
--   target_table  — text; DB default UNVERIFIED (scripts default candidates to 'meetings')

create table if not exists public.feeds (
  feed_id               text primary key,
  community_id          uuid not null,  -- FK UNVERIFIED: references public.communities(id)
  county                text,           -- nullability/default UNVERIFIED
  source                text not null,
  source_type           text not null,  -- check constraint UNVERIFIED; contract: rss|keyword|html|email
  category              text not null,
  pipeline_type         text not null,
  agency_name           text not null,
  geographic_reference  text not null,
  impact_level          text,           -- default UNVERIFIED
  active                boolean not null,  -- default UNVERIFIED
  sort_order            integer not null,  -- default UNVERIFIED
  target_table          text not null,     -- default UNVERIFIED
  filter_expr           text not null default '',
  dedupe_on             text not null default '',
  status_notes          text not null default '',
  updated_at            timestamptz default now()  -- nullability UNVERIFIED
);

-- Indexes shown illustratively; confirm against live DB before creating.
create index if not exists feeds_community_id_idx on public.feeds (community_id);
create index if not exists feeds_active_idx on public.feeds (active) where active = true;

comment on table public.feeds is
  'Ingest engine feed registry (DB-first). homesignal-ingest load_config reads active rows.';
comment on column public.feeds.county is
  'Denormalized county label from feeds.csv for operator readability; ingest routes by community_id.';
comment on column public.feeds.source is
  'Feed locator: http(s) URL for rss/html; keyword phrase or search URL for keyword; mailbox address for email.';
comment on column public.feeds.source_type is
  'Contract values: rss | keyword | html | email. Vendor adapters: Granicus=rss, Legistar/CivicClerk=html.';
comment on column public.feeds.target_table is
  'Destination table for ingested items: alerts | meetings (engine routing).';
comment on column public.feeds.filter_expr is
  'Optional engine-side filter. feeds.csv column: filter (alias).';
comment on column public.feeds.dedupe_on is
  'Dedupe key fields for the ingest engine (e.g. guid|link).';
comment on column public.feeds.status_notes is
  'Operator notes. feeds.csv column: status / notes (alias).';
