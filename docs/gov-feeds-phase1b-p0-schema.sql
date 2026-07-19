-- Phase 1B P0 — feed_candidates registry schema (DOCS ONLY — do not auto-apply).
-- Generated registry columns align with scripts/gov-feeds/spec/registry-schema.v1.json
-- transition_spec_version: 1.0 (see transition-spec.v1.json)

create table if not exists public.feed_candidates (
  id                        uuid primary key default gen_random_uuid(),
  community_id              uuid not null,
  feed_id                   text not null unique,
  vendor                    text not null check (vendor in ('granicus', 'legistar', 'civicclerk')),
  source                    text not null,
  source_type               text not null,
  state                     text not null,
  status_reason             text,
  batch_id                  text,
  confidence                numeric(4, 3),
  discovery_version         text,
  claimed_by                text,
  claim_expires_at          timestamptz,
  title_verified_at         timestamptz,
  activated_at              timestamptz,
  target_table              text not null default 'meetings',
  lock_version              integer not null default 0,
  state_entered_at          timestamptz not null default now(),
  blocked_by                text,
  source_normalized         text,
  discovery_artifact_path   text,
  golive_attempts           integer not null default 0,
  superseded_by_feed_id     text,
  schema_version            integer not null default 1,
  transition_spec_version   integer not null default 1,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists feed_candidates_community_id_idx
  on public.feed_candidates (community_id);

create index if not exists feed_candidates_state_idx
  on public.feed_candidates (state);

create index if not exists feed_candidates_batch_id_idx
  on public.feed_candidates (batch_id)
  where batch_id is not null;

comment on table public.feed_candidates is
  'Phase 1B candidate registry — pipeline orchestration until active. P0 schema only; apply manually.';

comment on column public.feed_candidates.feed_id is
  'Canonical: {communities.slug}-{vendor}-{target_table} e.g. wake-county-nc-granicus-meetings';

comment on column public.feed_candidates.title_verified_at is
  'Required before activation; set after feed-scoped L2 title verification passes.';

comment on column public.feed_candidates.schema_version is
  'Registry row schema version; see registry-schema.v1.json';

comment on column public.feed_candidates.transition_spec_version is
  'State machine spec version; see transition-spec.v1.json';

-- Audit log table (transition history)
create table if not exists public.feed_candidate_audit (
  id              bigserial primary key,
  feed_id         text not null,
  from_state      text not null,
  to_state        text not null,
  event           text not null,
  actor           text not null,
  status_reason   text,
  created_at      timestamptz not null default now()
);

create index if not exists feed_candidate_audit_feed_id_idx
  on public.feed_candidate_audit (feed_id, created_at desc);

-- Circuit breaker status (batch-level; P0 schema only)
create table if not exists public.feed_batch_circuit (
  batch_id        text primary key,
  circuit_status  text not null default 'closed'
    check (circuit_status in ('closed', 'open', 'half_open', 'halted')),
  updated_at      timestamptz not null default now()
);
