-- ============================================================================
-- Local News Phase C2 — PROTECTED enrichment store (SQL of record)
-- Applied to live project qwnnmljucajnexpxdgxr via MCP as migration
-- `local_news_enrichment_protected` on 2026-07-24. This file is the
-- reproducible copy per repo convention (docs/*.sql = schema of record).
--
-- WHY THIS TABLE EXISTS (founder decisions FD-C1..C3, 2026-07-24):
--   The geographic resolver needs the first-party text ingest already fetched
--   (RSS summary / NWS description / news_html enrichment) to route local news
--   below county level, and replay/audit needs the EXACT text a decision was
--   made on. That text must NOT live on `alerts` — alerts is anon-readable
--   ("public read alerts" policy), and FD-C2 forbids publisher prose from
--   being publicly accessible. Hence a separate table that no public API role
--   can touch. Necessity was proven before creation: no existing protected
--   table carries a per-alert text payload keyed by the alerts natural key.
--
-- ACCESS MODEL (FD-C2):
--   * RLS ENABLED with ZERO policies  -> RLS denies every request that
--     arrives through PostgREST under anon/authenticated.
--   * Belt-and-braces: ALL privileges REVOKED from anon + authenticated, so
--     even a future accidental policy cannot expose more than it states.
--   * Only the ingest engine (service-role key, GitHub Actions secret)
--     reads/writes. The site never queries this table.
--
-- DATA CONTRACT (FD-C1 as modified):
--   blob         capped first-party text (ENRICH_CAP = 2000 chars in
--                ingest.py) — NEVER a full article body; nullable so the
--                blob can be purged while the row's evidence survives.
--   blob_sha256/blob_len/source_kind
--                content fingerprint of the resolver's exact input; the SAME
--                fingerprint is stamped publicly in alerts.geo_evidence.input
--                (metadata only — prose never leaves this table).
--   evidence     jsonb: bounded quotation-scale snippets per matched place
--                (cut from the exact resolver input), plus status/method.
--   resolver_version  the resolver that consumed this input (1.1.0+).
--   captured_at  drives retention: ingest deletes rows older than
--                ENRICH_RETENTION_DAYS (60) once per run (FD-C3).
--
-- KEY: (community_id, source_url) — the alerts natural upsert key, so an
-- enrichment row joins 1:1 to its alert and re-ingest upserts idempotently.
-- ============================================================================

create table if not exists public.local_news_enrichment (
  community_id     uuid        not null,
  source_url       text        not null,
  blob             text,
  blob_sha256      text        not null,
  blob_len         integer     not null,
  source_kind      text        not null,
  evidence         jsonb,
  resolver_version text,
  captured_at      timestamptz not null default now(),
  primary key (community_id, source_url)
);

alter table public.local_news_enrichment enable row level security;

revoke all on public.local_news_enrichment from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Live verification receipts (2026-07-24, information_schema/pg_catalog):
--   relrowsecurity = true, policy_count = 0,
--   grants to anon/authenticated = none (NULL aggregate).
-- Columns match this DDL exactly (9 columns, defaults as above).
-- ----------------------------------------------------------------------------
