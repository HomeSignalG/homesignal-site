-- Development impact analyses — Phase 2 of the Development impact system.
-- One row per OFFICIAL RECORD DOCUMENT (keyed by the record URL that
-- app_projects.source_ref / development_reports sites carry), NOT per
-- app_projects row: the materializer (app_refresh_zip) deletes and re-inserts
-- app_projects on every refresh, so anything stamped there would be wiped.
-- This table is the durable, versioned audit store; pages join it client-side
-- by source_ref.
--
-- Two-stage pipeline writes it:
--   Stage 1 (homesignal-ingest analyze_project_documents.py, CI): fetches the
--     official document at source_ref, extracts ONLY supported facts via
--     structured-output LLM extraction, stores extracted_facts + doc hash.
--   Stage 2 (homesignal-site lib/impact-resolver.js via scripts/impact-score.mjs):
--     deterministic scoring — categories, score, level, direction, sentence,
--     confidence. No free-form AI judgment in the number.
--
-- IMPORTANT: impact_score stored here is the BASE magnitude (distance weight
-- 1.0). Pages apply the documented distance-decay bands per selected home via
-- lib/impact-resolver.js at render time — the same document serves many ZIP
-- pages at different distances.
--
-- Reprocessing contract: a row is re-extracted only when the fetched document's
-- sha256 differs from doc_sha256, extraction_version is stale, or the prior
-- attempt failed (extraction_attempts < 3). Rows are re-scored when
-- scoring_version is stale or extracted_at > scored_at. Unchanged documents are
-- never re-processed.
--
-- Apply via mcp__Supabase__apply_migration or the db-sql.yml workflow.

create table if not exists public.development_impact_analyses (
  id                  uuid primary key default gen_random_uuid(),
  source_ref          text not null unique,       -- the record_url shown on the card (join key)
  doc_url             text,                       -- document actually fetched (usually = source_ref)
  doc_sha256          text,
  doc_mime            text,
  doc_bytes           integer,
  doc_fetched_at      timestamptz,

  -- Stage 1 — extraction (facts only, nulls preserved; never inferred precision)
  extracted_facts     jsonb,
  extraction_status   text not null default 'pending'
    check (extraction_status in ('pending','extracted','unreadable','fetch_failed','rejected')),
  extraction_error    text,
  extraction_attempts integer not null default 0,
  extraction_model    text,
  extraction_version  text,
  extracted_at        timestamptz,

  -- Stage 2 — deterministic scoring (base, distance weight 1.0)
  impact_score        integer check (impact_score between 0 and 100),
  impact_level        text check (impact_level in ('low','medium','high')),
  impact_direction    text check (impact_direction in ('positive','negative','mixed','neutral')),
  impact_sentence     text,
  impact_confidence   numeric check (impact_confidence >= 0 and impact_confidence <= 1),
  impact_categories   text[],
  category_scores     jsonb,                      -- [{category,magnitude,direction,confidence,evidence:[...]}]
  impact_evidence     jsonb,                      -- flat evidence list w/ quotes + page refs
  scoring_version     text,
  scored_at           timestamptz,
  analysis_basis      text check (analysis_basis in ('document','metadata_fallback')),

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists dia_status_idx
  on public.development_impact_analyses (extraction_status);

-- RLS: public read (pages join by source_ref with the anon key), NO anon
-- writes — only the service-role pipelines write (same posture as
-- development_reports, per the page_cache advisory).
alter table public.development_impact_analyses enable row level security;

drop policy if exists dia_public_read on public.development_impact_analyses;
create policy dia_public_read on public.development_impact_analyses
  for select using (true);
-- (no insert/update/delete policies: anon+authenticated cannot write;
--  service_role bypasses RLS)
