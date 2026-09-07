-- ============================================================================
-- PHASE 1B — dev_refresh_collect() writes TWO INDEPENDENT PLANES.
-- Migrations `epa_decouple_phase1b_overlay_freshness_and_predicate` and
-- `epa_decouple_phase1b_split_core_and_facility_write`, applied to qwnnmljucajnexpxdgxr
-- on 2026-09-07. Parked here per CLAUDE.md §1 row 3.
--
-- WHAT WAS WRONG
-- --------------
-- ONE `update public.development_reports` set `sites`, `counts` and `refreshed_at`
-- together, and the EPA guard was a WHERE predicate on it:
--
--     and not (
--       (not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true))
--        or d.refreshed_at >= now() - interval '7 days')
--       and coalesce((j->'counts'->>'facilities')::int, 0) = 0
--       and coalesce((d.counts->>'facilities')::int, 0) > 0
--     );
--
-- So refusing the REGULATORY half refused the CORE half with it. Measured live
-- 2026-09-07 while FRS was returning 429 / "Failure when receiving data from the peer"
-- on both probe targets: in ONE HOUR, 51 ZIP refreshes refused, 46 of them holding
-- project data, and 6,532 core project records fetched from first-party permit and
-- planning sources were discarded. Structural exposure: 11,565 of 12,722 cached
-- reports (90.9%) carry counts.facilities > 0, and 10,344 of those also carry projects.
--
-- The refusal ALSO left `refreshed_at` untouched, so app_coverage_states then reported
-- the ZIP `stale_data` / `temporarily_unavailable`: 2,533 of the 2,563 rows attempted-
-- but-not-written in 48h carried cached facilities (98.8%).
--
-- WHAT CHANGED
-- ------------
-- Only step (d). Steps (a) fetch-failure recording, (b) truncation recording and (c)
-- retirement recording are carried across byte-for-byte (applied as an anchored splice
-- of the live pg_get_functiondef output, with the untouched prefix re-asserted after).
--
--   CORE plane        sites without a registry_id, counts.* except facilities,
--                     refreshed_at, paywall, source_vintage.
--                     Guarded ONLY by CORE GUARD 1 (per-source fetch failure where that
--                     source already contributes) and CORE GUARD 2 (unexplained
--                     development reduction while fresh). An EPA failure cannot reach
--                     any of these columns.
--
--   REGULATORY plane  sites WITH a registry_id, counts.facilities,
--                     facilities_unavailable, facilities_refreshed_at.
--                     Guarded by dev_epa_write_refused() — the pre-split rule, unchanged.
--
-- THE REFUSAL SEMANTICS ARE NOT RELAXED. Phase 1B changes the BLAST RADIUS of the EPA
-- refusal, never the refusal itself. When it fires, the STORED facility sites and count
-- are carried forward verbatim, facilities_unavailable still reports the count as
-- unknown rather than zero, and facilities_refreshed_at correctly does not advance.
--
-- THE PLANE DISCRIMINATOR — `x ? 'registry_id'`, verified in BOTH directions before use
-- ------------------------------------------------------------------------------------
-- Across ALL 3,515,892 stored sites, three independent tests agree with ZERO
-- disagreements: "has a registry_id key" = 215,398, "relevance is null" = 215,398, and
-- "src starts with 'EPA FRS'" — 0 rows where any pair disagrees (control: 3,300,494
-- non-facility sites, so the zero is meaningful). On 359 live payloads the count of
-- registry_id-bearing sites equals `counts.facilities` on 359 of 359, so the split
-- REPRODUCES the engine's own number rather than recomputing it.
--
-- ORDER IS PRESERVED. The engine emits allSites = [...dev, ...permitSites, ...fac] —
-- facilities last — so `core || facility` reproduces the payload array exactly when both
-- planes write. `with ordinality` + `order by o` makes that explicit rather than relying
-- on jsonb_agg's incidental input order.
--
-- THE OLD COMBINED-ZERO GUARD IS SUBSUMED, NOT DROPPED
-- ----------------------------------------------------
-- It fired on (fresh AND newFac=0 AND newDev=0 AND (cachedFac+cachedDev)>0 AND
-- unexplained). With the planes split:
--   * cachedDev > 0  → CORE GUARD 2 fires, core write refused.  ✔
--   * cachedDev = 0  → the core write is development 0 over 0, a no-op with nothing to
--                      lose, and the facility half is caught by dev_epa_write_refused. ✔
-- Both limbs are pinned by test/dev-refresh-plane-split.test.mjs, which fails if either
-- is removed.
--
-- WHY facilities_refreshed_at EXISTS
-- ----------------------------------
-- Before the split the two planes could only move together, so one timestamp was honest.
-- After it, core advances while EPA is down — a shared timestamp would start claiming the
-- facility layer had been refreshed when it had not, a NEW dishonesty introduced by the
-- fix. Backfilled to refreshed_at, which is the correct historical value for every
-- pre-existing row.
--
-- OUT OF SCOPE, DELIBERATELY (Phase 2, founder decision pending)
-- -------------------------------------------------------------
-- Nothing here touches app_refresh_zip's data_quality / indexable, the
-- app_coverage_states `facilities_only` state, the sitemap, robots, or eligibility. EPA
-- facilities still count toward `pass` and `indexable` exactly as before this change.
-- ============================================================================

-- ── part 1: overlay freshness column + the ONE definition of the refusal ────
alter table public.development_reports
  add column if not exists facilities_refreshed_at timestamptz;

update public.development_reports
   set facilities_refreshed_at = refreshed_at
 where facilities_refreshed_at is null;

comment on column public.development_reports.facilities_refreshed_at is
  'When the REGULATORY overlay plane (EPA/FRS facilities) last took a write. Diverges from '
  'refreshed_at (the CORE project plane) whenever the EPA write was refused as untrustworthy. '
  'Added by the Phase 1B plane split, 2026-09-07.';

-- The predicate is needed in FOUR places in the new write (counts, both sites branches,
-- the overlay timestamp). Four copies of a guard is how the two halves of a guard drift
-- apart; this repo has paid for that more than once. One definition, called four times.
-- Fail-closed in every degenerate case: a NULL epa_ok, a missing `epa` key, or a null
-- counts object all resolve toward preserving what is already stored.
create or replace function public.dev_epa_write_refused(
  _epa_ok boolean,
  _j jsonb,
  _cached_counts jsonb,
  _cached_refreshed_at timestamptz
) returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select (
      (not (coalesce(_epa_ok, false) and coalesce((_j->'epa'->>'ok')::boolean, true))
       or _cached_refreshed_at >= now() - interval '7 days')
      and coalesce((_j->'counts'->>'facilities')::int, 0) = 0
      and coalesce((_cached_counts->>'facilities')::int, 0) > 0
  );
$function$;

comment on function public.dev_epa_write_refused(boolean, jsonb, jsonb, timestamptz) is
  'True when the incoming EPA facility payload must NOT overwrite the stored one. The single '
  'source of truth for the regulatory-plane refusal in dev_refresh_collect().';

-- ── part 2: step (d) of dev_refresh_collect, as applied ─────────────────────
-- Reproduced here as the SQL of record. The live application was an anchored splice
-- (anchors: '  -- (d) write.' and '  get diagnostics n = row_count;', each asserted to
-- appear exactly once, with a re-apply refused once dev_epa_write_refused is present).
-- Steps (a)-(c) and the epa_ok probe read above them are UNCHANGED and are not repeated
-- here; read the live body with pg_get_functiondef for the whole function.
--
--   with resp as (... unchanged ...),
--   blocked as (... unchanged ...),
--   explained as (... unchanged ...)
--   update public.development_reports d set
--     counts = case
--                when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
--                  then (j->'counts') || jsonb_build_object(
--                         'facilities', coalesce((d.counts->>'facilities')::int, 0))
--                else j->'counts'
--              end,
--     sites = coalesce((select jsonb_agg(x order by o)
--                         from jsonb_array_elements(j->'sites') with ordinality t(x, o)
--                        where not (x ? 'registry_id')), '[]'::jsonb)
--             || case
--                  when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
--                    then coalesce((select jsonb_agg(x order by o)
--                                     from jsonb_array_elements(d.sites) with ordinality t(x, o)
--                                    where x ? 'registry_id'), '[]'::jsonb)
--                  else coalesce((select jsonb_agg(x order by o)
--                                   from jsonb_array_elements(j->'sites') with ordinality t(x, o)
--                                  where x ? 'registry_id'), '[]'::jsonb)
--                end,
--     paywall        = coalesce((j->>'paywall')::boolean, false),
--     source_vintage = 'get-address-report ZIP mode; pg_cron daily auto-refresh',
--     refreshed_at   = now(),
--     facilities_refreshed_at = case
--                                 when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
--                                   then d.facilities_refreshed_at
--                                 else now()
--                               end,
--     facilities_unavailable = case
--                                when coalesce((j->'counts'->>'facilities')::int, 0) > 0 then false
--                                when not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true)) then true
--                                else false
--                              end
--   from resp
--   where d.zip = (j->>'zip')
--     and not exists (select 1 from blocked b where b.zip = d.zip)          -- CORE GUARD 1
--     and not (                                                            -- CORE GUARD 2
--       d.refreshed_at >= now() - interval '7 days'
--       and coalesce((j->'counts'->>'development')::int, 0) = 0
--       and coalesce((d.counts->>'development')::int, 0) > 0
--       and not exists (select 1 from explained x where x.zip = d.zip)
--     );
--
-- Live body after apply: md5 bccdb1149f85cc71d31f5e949cb9e47e, 9,596 chars
-- (was be992297dfe96a95daf3f5c857264abb, 7,346 chars).

-- ============================================================================
-- VERIFIED AFTER APPLY, 2026-09-07 — one dev_refresh_collect() run, 78 rows written
-- ============================================================================
-- Cohort frozen BEFORE the run in public.epa_split_probe_20260907 (80 responding ZIPs).
-- EPA had recovered by run time (both probes 200 at 14:15Z), so the 26 refusals below
-- come from the freshness limb — the same code path, exercised on the healthy-EPA side.
-- The EPA-down limb is pinned deterministically by test/dev-refresh-plane-split.test.mjs.
--
--   cohort                                        80
--   EPA-refused                                   26
--     of those, CORE plane advanced               26  ← was 0 before the split
--     of those, overlay clock correctly held      26
--     of those, facility COUNT preserved exactly  26
--     of those, facility SITES preserved exactly  26
--     of those, facilities zeroed                  0
--   not refused, both planes advanced             52
--   core-blocked by CORE GUARD 1                   2  (22192, 22307 — 'ArcGIS error:
--                                                      Token Required', protecting
--                                                      40→21 and 373→33; epa_refused
--                                                      FALSE on both, so the core guard
--                                                      fires independently of EPA)
--   26 + 52 + 2 = 80, and 26 + 52 = 78 = rows written.  Exact.
--
-- Table-wide invariants after the run (control: 12,722 reports, 3,516,047 sites):
--   counts.facilities <> stored registry_id site count ......... 0 rows
--   facilities_refreshed_at > refreshed_at (impossible) ........ 0 rows
--   facilities_refreshed_at < refreshed_at (the split, visible) . 32 rows
