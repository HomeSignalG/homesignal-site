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
--
-- ---------------------------------------------------------------------------
-- CORRECTION 2026-08-02 — `changes` MEANT CIVIC CHANGES, AND LOCAL NEWS SILENTLY
-- WIDENED IT. Applied via MCP migration `app_coverage_state_view_civic_changes`.
--
-- At rollout the two definitions were verified IDENTICAL (legacy1 = legacy2 = 0
-- above). They could be, because `app_changes` then held only civic rows:
-- 'Government & civic' + 'Planning & zoning' — exactly the set app_refresh_zip
-- counts into `_nc` when it stamps data_quality. Local News later began
-- materializing into the SAME table (79,424 rows across 9,796 ZIPs), and because
-- this view counted `app_changes` with no category filter, it started reading
-- news as coverage. The materializer never drifted: it counts `_nc` BEFORE the
-- Local News insert, so `data_quality` has always been civic-only BY
-- CONSTRUCTION. The view is the half that moved.
--
-- Measured cost of the drift (2026-08-02, full population 12,722):
--   • 5,072 ZIPs reported `populated` whose only map content is the national EPA
--     facility floor — real state `facilities_only`. They were therefore ALSO
--     denied the accurate "meeting and permit feeds … still being wired" banner
--     that facilities_only renders on community.html.
--   •   662 ZIPs reported `populated` with ZERO markers of any kind and zero
--     civic notices — real state `honestly_empty`. These are the 662 that made
--     `legacy: populated/facilities_only => pass` fail in CI every day.
--   → 5,734 pages carrying an OVERSTATED coverage state. Nothing rendered
--     changed and no layout gate moved (that is keyed on data_quality, untouched)
--     — but the instrument was asserting coverage the data does not support.
--
-- THE RULE, now explicit: coverage means SOURCED CIVIC/DEVELOPMENT RECORDS —
-- permits, planning + government notices, EPA-registered facilities. A Local
-- News article is real, sourced content and still rides the page's news list;
-- it is NOT coverage and can never lift a ZIP's coverage state on its own.
-- `changes` counts civic rows only; `news_items` is reported ADDITIVELY so the
-- news is visible in the instrument rather than hidden by the narrower count.
-- ============================================================================
-- PHASE 2 UNIT 2 — APPLIED 2026-09-07, migration
-- `20260907200252 epa_decouple_phase2_unit2_coverage_state_split_from_d25efff`.
-- TWO INDEPENDENT PLANES. `coverage_state` describes the CORE project plane only and
-- never reads an EPA facility count or the overlay clock; `regulatory_overlay_state`
-- describes the EPA/FRS overlay with its own freshness in `facilities_refreshed_at`.
-- `facilities_only` is GONE from the core enum — it was the composition of the two
-- planes collapsed into one core value, which made a core state readable only by
-- consulting EPA (founder rules #1 and #11).
-- ⚠️ `with (security_invoker = true)` is RESTATED on purpose. Measured on this database:
-- a bare `create or replace view` leaves `reloptions = (none)`, i.e. it DROPS the option
-- and silently promotes the view to the owner's rights. Never replay this file without it.
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
    -- `changes` here is CIVIC changes only (see the 2026-08-02 correction above):
    -- the same set app_refresh_zip counts into `_nc`. Local News is content, not
    -- coverage, and is reported separately as `news_items`.
    when coalesce(c.dev_markers,0) > 0 or coalesce(ch.changes,0) > 0
      then 'populated'
    -- NOTE: the `facilities_only` branch that used to sit here is GONE (Phase 2 Unit 2,
    -- applied 2026-09-07). A ZIP whose CORE plane is empty is `honestly_empty` even when
    -- EPA has records for it; the overlay reports itself below.
    else 'honestly_empty'
  end as coverage_state,
  m.data_quality,
  r.refreshed_at,
  r.last_refresh_attempt_at,
  coalesce(c.dev_markers,0)  as dev_markers,
  coalesce(c.fac_markers,0)  as fac_markers,
  coalesce(ch.changes,0)     as changes,
  coalesce(ch.news_items,0)  as news_items,
  -- ── the REGULATORY OVERLAY plane, reported separately and never mixed in ──
  -- overlay_unknown exists because "we could not read EPA" and "EPA has nothing" are
  -- different facts, and collapsing them is the exact dishonesty Phase 1B removed from
  -- `counts.facilities`. An absent answer is never rendered as zero.
  case
    when r.zip is null then 'overlay_unsupported'
    when coalesce(c.fac_markers,0) > 0 then 'overlay_records'
    when coalesce(r.facilities_unavailable,false) then 'overlay_unknown'
    else 'overlay_empty'
  end as regulatory_overlay_state,
  r.facilities_refreshed_at,
  coalesce(r.facilities_unavailable,false) as facilities_unavailable
from public.app_community_meta m
left join public.development_reports r on r.zip = m.zip
left join lateral (
  select count(*) filter (where p.record_kind='development') dev_markers,
         count(*) filter (where p.record_kind='facility')    fac_markers
  from public.app_projects p where p.zip = m.zip
) c on true
left join lateral (
  select count(*) filter (where a.category <> 'Local News') changes,
         count(*) filter (where a.category  = 'Local News') news_items
  from public.app_changes a where a.zip = m.zip
) ch on true;

grant select on public.app_coverage_states to anon, authenticated;

-- ---------- Reproducible verification SQL ----------------------------------
-- ⚠️ DO NOT RUN THE UNFILTERED FORM. Measured 2026-09-07: this view plans correctly
-- (index scans on both laterals) and still costs ~9.3M — 12,722 ZIPs x ~622
-- app_projects rows each, ~7.9M index+heap reads PER PASS against a 3.21M-row table.
-- ONE unfiltered pass exceeded 60s warm; even the slice `zip < '15000'` exceeded 50s.
-- The Unit 2 migration's first verify block ran FIVE such passes and could therefore
-- never finish — it was structurally reviewed and NEVER ONCE EXECUTED. Verify by KEYED
-- probe; the universe counts are a REPORTING question, run deliberately with a long
-- statement_timeout and never inside a migration.
--   (see scripts/verify-coverage-state.mjs for the automated CI form, which is
--    keyset-paginated rather than a single unfiltered aggregate)
--
-- KEYED verification — what the applied migration itself asserts:
-- select zip, coverage_state, regulatory_overlay_state, data_quality,
--        dev_markers, changes, fac_markers, facilities_unavailable
--   from public.app_coverage_states
--  where zip in ('01001','01002','03224','03268','01034','02543') order by zip;
-- expected: 01001/01002 populated + overlay_records
--           03224/03268 honestly_empty + overlay_records, data_quality 'pass'
--           01034/02543 honestly_empty + overlay_unknown
--
-- UNIVERSE counts (slow — set statement_timeout high, run outside a migration):
-- with s as (select * from public.app_coverage_states)
-- select
--   (select count(*) from s) total,
--   (select count(*) from s where coverage_state is null
--      or coverage_state not in ('populated','honestly_empty',
--        'unsupported_source','temporarily_unavailable','failed_ingest','stale_data')
--      or regulatory_overlay_state not in ('overlay_records','overlay_empty',
--        'overlay_unknown','overlay_unsupported')) invalid,
--   (select count(*) from s where coverage_state='honestly_empty'
--      and (dev_markers>0 or changes>0)) imp1,
--   (select count(*) from s where coverage_state='populated'
--      and dev_markers=0 and changes=0) imp3,
--   (select count(*) from s where coverage_state='unsupported_source'
--      and refreshed_at is not null) imp4,
--   (select count(*) from s where regulatory_overlay_state='overlay_empty'
--      and facilities_unavailable) imp5,
--   (select count(*) from s where coverage_state='honestly_empty'
--      and regulatory_overlay_state='overlay_records') was_facilities_only,
--   (select count(*) from s where coverage_state='honestly_empty'
--      and regulatory_overlay_state='overlay_unknown') empty_but_epa_unverified;
-- NOTE: `honestly_empty` no longer implies `coverage_coming` — a core-empty ZIP whose
-- overlay holds records is legitimately data_quality 'pass' (data_quality still counts
-- EPA; it is the LAYOUT gate, and Unit 1 deliberately leaves it alone).
-- Rule-branch fixtures (states with no production rows):
--   unsupported_source: a meta zip with no report row → left join r.zip is null.
--   temporarily_unavailable: refreshed_at = now()-4 days, attempt = now()-1 hour.
