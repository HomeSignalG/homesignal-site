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
-- |                         | refreshed_at AND attempt within 72h (trying + failing,        |
-- |                         | chronically stale)                                            |
-- | temporarily_unavailable | refreshed_at 72h–7d old AND attempt newer than refreshed_at   |
-- |                         | AND attempt within 72h (recent attempt failed, not chronic)   |
-- | stale_data              | refreshed_at >72h old, no recent failed-attempt evidence      |
-- | populated               | fresh report; dev markers > 0 OR app_changes > 0              |
-- | facilities_only         | fresh report; only EPA-facility markers (national baseline)   |
-- | honestly_empty          | fresh report; every source check returned 0 records           |
-- Thresholds: 7d = chronic. The 72h figures are explained by the 2026-09-15
-- correction below — they were originally 3× the Phase-1 24h sweep SLA, and the
-- recent-attempt window is now pinned to the sweep period the scheduler implies.
-- During the Phase-1 convergence week the stale classes are inflated and converge to ~0.
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

-- ============================================================================
-- CORRECTION 2026-09-15 — THE RECENT-ATTEMPT WINDOW WAS SHORTER THAN THE SWEEP
-- PERIOD, SO A HEALTHY MID-SWEEP ZIP READ AS `stale_data`.
-- Applied via MCP migration `coverage_state_recent_attempt_window_72h`.
-- Full rationale, measurements and invariants: docs/coverage-state-recent-attempt-window.sql
--
-- `failed_ingest` and `temporarily_unavailable` both required an attempt within 48h to
-- mean "still being actively retried"; a ZIP failing that clause fell through to
-- `stale_data`, which asserts there is NO recent failed-attempt evidence.
--
-- 48h was right for the scheduler the ladder was written against (250 rows/tick every
-- 15 min ⇒ a full 12,722-ZIP sweep in ~16.7h against a 24h SLA, so 48h was ~2× it).
-- THE SCHEDULER CHANGED AND THE CLASSIFICATION DID NOT FOLLOW. Measured 2026-09-15,
-- cron jobid 14: `*/2 * * * *` → `dev_refresh_tick(8, 20)` = 8 × 30 = 240 attempts/hour
-- ⇒ 12,722 / 240 = 53.0h per sweep. 53.0h > 48h, so for ~5h of every sweep an
-- on-schedule ZIP had no attempt inside the window and was named `stale_data`.
--
-- Production before (12,722 ZIPs): never_attempted 0 · attempted ≤24h 5,760 · ≤48h 11,520
-- · oldest attempt 53.03h. `stale_data` = 25, attempt-age band 48.00h..51.94h with ZERO
-- outside it, and 25/25 carrying last_refresh_attempt_at > refreshed_at — i.e. every one
-- of them HAD the retry evidence the state claims is absent. The scheduler was healthy;
-- the boundary was wrong.
--
-- Window widened 48h → 72h in BOTH branches. Nothing else moves — the 72h/7d
-- `refreshed_at` thresholds, the content branches, the overlay plane, the column list and
-- the grants are untouched. 72h must exceed the 53.0h sweep or the defect persists by
-- construction; it leaves ~19h of headroom for retry interleaving and cron jitter, and
-- reuses a threshold the ladder already carries rather than adding a third constant.
--
-- IT DOES NOT WEAKEN VERIFICATION — IT SHARPENS IT. Exactly 25 rows changed state:
-- 22 → temporarily_unavailable (last SUCCESS 4.18..6.43d, inside the designed,
-- self-releasing 7-day hold) and 3 → failed_ingest (last SUCCESS 19.21..23.54d). The
-- 7-day bound is measured from `refreshed_at` and is untouched, so it remains the
-- backstop: nothing broken can hide. Those 3 had been failing for 19–23 days while being
-- retried, buried among 22 false positives the boundary itself produced — the instrument
-- went from 25 findings of which 0 were real to 3 of which 3 are real.
-- After apply: stale_data 0 · temporarily_unavailable 187 · failed_ingest 97 (97/97 with
-- last success >7d). Deployed-view keyed probe: 20191 (52.03h attempt / 20.09d success)
-- and 22035 (50.03h / 23.55d) → failed_ingest; 10460, 11420, 20764, 21056 →
-- temporarily_unavailable. 10460 and 11420 are two of the ZIPs the daily verifier had
-- been failing as "unintentionally STALE".
--
-- RESIDENT-VISIBLE SURFACE: NONE, measured. lib/community-page.js:97 renders all three
-- of stale_data / temporarily_unavailable / failed_ingest through ONE banner whose text
-- comes from `refreshed_at`, never from which state it is, and all 25 rows are inside
-- that group before AND after — byte-identical copy on all 25 pages. lib/coverage-copy.js
-- does not read coverage_state at all. The `data_quality` layout gate is untouched. What
-- changes is the `data-coverage-state` attribute on 25 pages, an instrument.
--
-- 🔒 THE COUPLING IS NOW ENFORCED, NOT COMMENTED. The defect was a constant that
-- silently stopped matching the scheduler. Invariant (d) of the migration asserts the
-- window against the live cron row, and scripts/verify-coverage-state.mjs asserts it
-- daily against the observed sweep — so the next cadence change fails loudly, naming the
-- scheduler, instead of relabelling healthy ZIPs.
-- ============================================================================

create or replace view public.app_coverage_states
with (security_invoker = true) as
select
  m.zip,
  case
    when r.zip is null then 'unsupported_source'
    when r.refreshed_at < now() - interval '7 days'
         and r.last_refresh_attempt_at > r.refreshed_at
         and r.last_refresh_attempt_at >= now() - interval '72 hours'
      then 'failed_ingest'
    when r.refreshed_at < now() - interval '72 hours'
         and r.last_refresh_attempt_at > r.refreshed_at
         and r.last_refresh_attempt_at >= now() - interval '72 hours'
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
