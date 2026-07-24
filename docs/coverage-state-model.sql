-- ============================================================================
-- PHASE 2 — ADDITIVE COVERAGE-STATE MODEL (app_coverage_states view)
-- Applied to production 2026-07-24 via MCP migration `app_coverage_state_view`.
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
--
-- GOAL: truthfully communicate what has actually been checked and what is
-- available for every ZIP — WITHOUT changing the underlying data or the legacy
-- gate. `app_community_meta.data_quality` ('pass'|'coverage_coming') is NOT
-- touched; pages keep gating LAYOUT on it. The new state only drives honest
-- copy + a `data-coverage-state` attribute on community.html.
--
-- WHY A VIEW (not a stored column): the freshness states (stale_data /
-- temporarily_unavailable / failed_ingest) change every 15-min refresh tick,
-- while materialization runs daily — a stored value would be wrong most of the
-- day. The view is a PURE FUNCTION of production columns: same inputs → same
-- state (deterministic transitions), nothing stored to drift, and rollback is
-- one DROP VIEW.
--
-- STATES + DETERMINISTIC RULES (CASE precedence top-down ⇒ exactly one state):
-- | state                   | rule (production columns)                                     |
-- |-------------------------|---------------------------------------------------------------|
-- | unsupported_source      | no development_reports row for the ZIP (engine never covered) |
-- | failed_ingest           | refreshed_at >7d old AND last_refresh_attempt_at newer than   |
-- |                         | refreshed_at AND attempt within 48h (trying + failing,        |
-- |                         | chronically stale)                                            |
-- | temporarily_unavailable | refreshed_at 72h–7d old AND attempt newer than refreshed_at   |
-- |                         | AND attempt within 48h (recent attempt failed, not chronic)   |
-- | stale_data              | refreshed_at >72h old, no recent failed-attempt evidence      |
-- | populated               | fresh report; dev markers > 0 OR app_changes > 0              |
-- | facilities_only         | fresh report; only EPA-facility markers (national baseline)   |
-- | honestly_empty          | fresh report; every source check returned 0 records           |
-- Thresholds: 72h = 3× the Phase-1 24h sweep SLA; 7d = chronic. During the
-- Phase-1 convergence week the stale classes are inflated and converge to ~0.
--
-- VERIFIED AT ROLLOUT (full population, 12,722):
--   0 null/invalid states · 0 impossible combinations (honestly_empty with
--   content; facilities_only with local content; populated without content;
--   unsupported_source with a report) · 0 legacy inconsistencies
--   (honestly_empty ⇒ coverage_coming; populated/facilities_only ⇒ pass).
--   Distribution at rollout: populated 946 · facilities_only 5,684 ·
--   honestly_empty 823 · stale_data 4,962 · failed_ingest 307 ·
--   temporarily_unavailable 0 · unsupported_source 0.
--   Exemplars: 78617 populated · 35801 facilities_only · 02061 honestly_empty ·
--   01002 stale_data · 01033 failed_ingest · unsupported_source branch proven
--   by fixture (no prod row — every ZIP has an engine report).
--
-- ROLLBACK: drop view public.app_coverage_states;
--   lib/data.js coverageState() fails soft (null) → pages render exactly the
--   pre-Phase-2 behavior (data_quality gate untouched throughout).
-- ============================================================================

create or replace view public.app_coverage_states
with (security_invoker = true) as
select
  m.zip,
  case
    when r.zip is null then 'unsupported_source'
    when r.refreshed_at < now() - interval '7 days'
         and r.last_refresh_attempt_at > r.refreshed_at
         and r.last_refresh_attempt_at >= now() - interval '48 hours'
      then 'failed_ingest'
    when r.refreshed_at < now() - interval '72 hours'
         and r.last_refresh_attempt_at > r.refreshed_at
         and r.last_refresh_attempt_at >= now() - interval '48 hours'
      then 'temporarily_unavailable'
    when r.refreshed_at < now() - interval '72 hours'
      then 'stale_data'
    when coalesce(c.dev_markers,0) > 0 or coalesce(ch.changes,0) > 0
      then 'populated'
    when coalesce(c.fac_markers,0) > 0
      then 'facilities_only'
    else 'honestly_empty'
  end as coverage_state,
  m.data_quality,
  r.refreshed_at,
  r.last_refresh_attempt_at,
  coalesce(c.dev_markers,0) as dev_markers,
  coalesce(c.fac_markers,0) as fac_markers,
  coalesce(ch.changes,0)    as changes
from public.app_community_meta m
left join public.development_reports r on r.zip = m.zip
left join lateral (
  select count(*) filter (where p.record_kind='development') dev_markers,
         count(*) filter (where p.record_kind='facility')    fac_markers
  from public.app_projects p where p.zip = m.zip
) c on true
left join lateral (
  select count(*) changes from public.app_changes a where a.zip = m.zip
) ch on true;

grant select on public.app_coverage_states to anon, authenticated;

-- ---------- Reproducible verification SQL ----------------------------------
-- Exactly one valid state per ZIP + no impossible combos + legacy consistency:
--   (see scripts/verify-coverage-state.mjs for the automated CI form)
-- with s as (select * from public.app_coverage_states)
-- select
--   (select count(*) from s) total,
--   (select count(*) from s where coverage_state is null
--      or coverage_state not in ('populated','facilities_only','honestly_empty',
--        'unsupported_source','temporarily_unavailable','failed_ingest','stale_data')) invalid,
--   (select count(*) from s where coverage_state='honestly_empty'
--      and (dev_markers>0 or fac_markers>0 or changes>0)) imp1,
--   (select count(*) from s where coverage_state='facilities_only'
--      and (dev_markers>0 or changes>0)) imp2,
--   (select count(*) from s where coverage_state='populated'
--      and dev_markers=0 and changes=0) imp3,
--   (select count(*) from s where coverage_state='unsupported_source'
--      and refreshed_at is not null) imp4,
--   (select count(*) from s where coverage_state='honestly_empty'
--      and data_quality<>'coverage_coming') legacy1,
--   (select count(*) from s where coverage_state in ('populated','facilities_only')
--      and data_quality<>'pass') legacy2;
-- Rule-branch fixtures (states with no production rows):
--   unsupported_source: a meta zip with no report row → left join r.zip is null.
--   temporarily_unavailable: refreshed_at = now()-4 days, attempt = now()-1 hour.
