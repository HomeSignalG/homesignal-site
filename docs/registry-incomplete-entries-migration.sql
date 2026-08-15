-- registry-incomplete-entries-migration.sql
-- One computed home for the live-metric exclusion list — retires the hand-maintained
-- 10-entry array that was restated inline in every Live-page query (QUEUE.md, sessions,
-- dashboards) with nothing enforcing it.
--
-- WHO WRITES IT: only the loader step in .github/workflows/deploy-edge-functions.yml,
-- which runs scripts/compute-incomplete-registry.mjs against the exact registry JSON it
-- just deployed and full-replaces the rows in one transaction. The step is fail-loud:
-- if the load errors after a successful deploy, the WORKFLOW fails — never a silent
-- stale list. registry_sha256 fingerprints the JSON each row was computed from, so
-- staleness is checkable, not assumed (see the verification block below).
--
-- WHO READS IT: every consumer of the Live-page metric, via the view:
--   and p.registry_id not in (select registry_id from public.v_incomplete_registry_entries)
--
-- CRITERIA (must match scripts/compute-incomplete-registry.mjs and QUEUE.md verbatim):
--   incomplete ⇔ (no type_map AND no use_type_const)
--                OR (no mapped status_to_bucket value AND NOT (socrata entry with status_const))
--   The socrata clause exists because socrata's status_const IS the bucket (all-empty
--   status_to_bucket is that family's shipped idiom), while an arcgis status_const is a raw
--   value that must resolve through status_to_bucket — the connector asymmetry documented in
--   test/status-const-must-be-mapped.test.mjs.
--
-- Applied via the db-sql workflow or the Supabase SQL editor. Idempotent.

create table if not exists public.registry_incomplete_entries (
  registry_id     text primary key,
  reason          text not null,
  registry_sha256 text not null,
  computed_at     timestamptz not null default now()
);

comment on table public.registry_incomplete_entries is
  'Computed live-metric exclusion list. Written ONLY by the deploy-edge-functions loader '
  'step (scripts/compute-incomplete-registry.mjs); never hand-edited. registry_sha256 = '
  'sha256 of the jurisdiction-registry.json the list was computed from.';

-- RLS ON with public read, no anon writes — the development_reports pattern, never the
-- page_cache one (which ships RLS disabled and is flagged in a live DB advisory).
alter table public.registry_incomplete_entries enable row level security;
drop policy if exists registry_incomplete_entries_public_read on public.registry_incomplete_entries;
create policy registry_incomplete_entries_public_read
  on public.registry_incomplete_entries for select
  to anon, authenticated using (true);

create or replace view public.v_incomplete_registry_entries as
  select registry_id from public.registry_incomplete_entries;

comment on view public.v_incomplete_registry_entries is
  'THE exclusion list for the Live-page metric. Consumers join this; nobody inlines the '
  'ids. Before relying on it, verify freshness (see migration file verification block).';

-- ── SEED ─────────────────────────────────────────────────────────────────────────────
-- The first load happens on the next deploy-edge-functions run. Until then the table is
-- EMPTY, and an empty exclusion list OVERSTATES the Live metric by up to 10 pages' worth
-- of degraded entries. Seeding here would be transcription — the exact disease this
-- migration treats — so instead: APPLY THIS FILE, THEN IMMEDIATELY DISPATCH
-- deploy-edge-functions (a no-op redeploy is byte-exact and harmless; its loader step
-- performs the first computed load). Do not run Live queries against the view in the gap.

-- ── VERIFICATION (run after the first load; each is a positive control) ──────────────
-- 1. Row count and fingerprint:
--      select count(*) as n, min(registry_sha256) as sha, max(computed_at) as at
--        from public.registry_incomplete_entries;
--    n must be >0 (10 at time of writing) and sha must equal the local computation:
--      git show origin/main:supabase/functions/get-address-report/jurisdiction-registry.json \
--        | sha256sum
--    (deploys are byte-exact from repo source, so main's file hash IS the deployed hash
--     whenever the deploy workflow last ran from main).
-- 2. Exactly one fingerprint present (a partial load is impossible in-transaction, so >1
--    distinct sha means something wrote outside the loader):
--      select count(distinct registry_sha256) from public.registry_incomplete_entries;  -- = 1
-- 3. Parity with the hand list it replaces (one-time, 2026-08-15): the computed 10 matched
--    the QUEUE.md hand list exactly, both directions — receipts in the QUEUE entry of the
--    same date.
