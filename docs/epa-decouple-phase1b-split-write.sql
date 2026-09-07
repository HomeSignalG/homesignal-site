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

-- ============================================================================
-- FOLLOW-UP 1 — a 67-SECOND MIGRATION WINDOW LEFT 6 ROWS WITH A STALE OVERLAY CLOCK
-- migration `epa_decouple_phase1b_repair_migration_window_overlay_clock`, same day
-- ============================================================================
-- Part 1 (add the column + backfill) applied 14:25:50Z; part 2 (the split) applied
-- 14:26:57Z. `dev-reports-rolling-refresh` runs */2, so its 14:26:00Z tick landed BETWEEN
-- them and ran the OLD dev_refresh_collect — which advanced `refreshed_at` and knew nothing
-- about the new column. 6 rows therefore read facilities_refreshed_at < refreshed_at while
-- no EPA refusal had occurred.
--
-- ⚠️ HOW IT WAS FOUND, because the shape recurs: a table-wide invariant sweep flagged ONE row
-- as "overlay held BUT facilities = 0" — a state the split makes structurally impossible
-- (the refusal requires cached facilities > 0). Chasing that single row is what surfaced the
-- window. A count of 1 against 12,722 is exactly the size of anomaly that gets rounded away;
-- it was the only visible symptom of a 6-row inconsistency.
--
-- THE REPAIR IS THE HONEST VALUE. The old function was all-or-nothing — if it wrote the row it
-- wrote BOTH planes from one payload — so for these rows the facility layer genuinely DID take
-- a write at `refreshed_at`. The clock was under-reporting. Leaving it would have made 6 pages
-- look like they had held a stale facility layer when they had not.
--
-- SCOPED BY TIME, NOT BY SYMPTOM, so it cannot touch a genuine refusal. Bounds are the two
-- migration versions. Verified: 6 repaired, 0 remaining in-window, and the 42 genuine refusals
-- outside the window were asserted UNCHANGED by the migration itself (it raises on collateral
-- damage). Control: 0 rows with a behind clock BEFORE the window — which is what proves the
-- backfill was correct in the first place.
--
-- 🔑 STANDING ANSWER: ADDING A COLUMN THAT A HOT-PATH FUNCTION MUST MAINTAIN IS ONE CHANGE,
-- NOT TWO. On a */2 cron there is no safe gap between "the column exists" and "the writer
-- maintains it". Either apply both in ONE migration, or expect to repair whatever the cron
-- wrote in between — and measure it rather than assuming the window was empty.
--
-- Table-wide after the repair (control: 12,722 rows):
--   facilities_refreshed_at > refreshed_at (impossible) ............ 0
--   facilities_refreshed_at IS NULL ................................ 0
--   overlay clock held ............................................. 43
--     of those, carrying PRESERVED non-zero facilities ............. 43
--     of those, zeroed (would be a defect) ......................... 0
--   counts.facilities <> stored facility-site count ................ 0

-- ============================================================================
-- FOLLOW-UP 2 — the verification probe table was DROPPED
-- migration `drop_epa_split_probe_20260907_diagnostic`
-- ============================================================================
-- public.epa_split_probe_20260907 froze the 80-ZIP pre-run cohort so the before/after could be
-- proven. It is gone. Reasons, in order of weight:
--   1. Nothing reads it and nothing can refresh it — it captured one instant that has passed.
--   2. `create table as` in `public` inherited this project's default grants, so it landed with
--      RLS DISABLED and `anon` holding arwdDxtm — readable AND WRITABLE through PostgREST with
--      the public anon key. That is the page_cache posture CLAUDE.md flags as a defect, created
--      for an artifact with no consumer.
--   3. Its findings are committed above, where they are reviewable in a diff.
-- Content at drop time, for the record: 80 rows, 26 EPA-refused, ZIP range 04015..99204,
-- 2,635 project records protected and 405 stored facilities preserved across the refused rows.
--
-- 🔑 STANDING ANSWER: a verification cohort that will be summarised into a committed doc should
-- be a TEMP table or doc-only. If a cohort must genuinely persist across sessions (as the
-- gov-notices gn_*_cohort_* tables do), create it EXPLICITLY with RLS enabled and no anon
-- grant, and name its owner and expiry in the same commit. `create table as` in `public` is
-- never the right way to make one.
