-- =====================================================================================
-- PHASE 2 · UNIT 2 — `facilities_only` LEAVES THE CORE COVERAGE ENUM
-- Founder decision 2026-09-07: "EPA / Regulatory is a separate data plane from core
-- Map 1 projects."  Unit 1 took EPA out of the indexability decision.  This unit takes
-- it out of the COVERAGE STATE — the value that answers "what is the state of this
-- ZIP's coverage", which today can only be answered by consulting the EPA plane.
--
-- THE DEFECT, precisely.  `public.app_coverage_states.coverage_state` is one CASE
-- ladder, and one of its branches is:
--
--     WHEN COALESCE(c.fac_markers, 0) > 0 THEN 'facilities_only'
--
-- So a ZIP whose CORE plane is genuinely empty is reported as `facilities_only`
-- instead of `honestly_empty` **because EPA has records for it**.  That is rule #1 in
-- the direction nobody looks at (EPA PRESENCE deciding a core state) and rule #11
-- outright: remove the overlay and a value of the core enum disappears, so the overlay
-- is not "removable or replaceable" without changing the core model.
--
-- ⚠️ THIS FILE IS PARKED, NOT APPLIED.  It is executable and atomic.
--
-- ORDERING: this unit is INDEPENDENT of Unit 1.  It touches only the view; Unit 1
-- touches only `app_community_meta` and `app_refresh_zip`.  Either may be applied
-- first, or one without the other.
-- =====================================================================================

-- ------------------------------------------------------------------ 1. the two planes
-- `create or replace view` may only APPEND columns, never insert or reorder them, so
-- the three new columns go at the END and every existing column keeps its name, type
-- and position.  That is also why this is a REPLACE and not a DROP + CREATE: dropping
-- the view would drop its grants and any dependent object with it.
--
-- WHAT CHANGES IN `coverage_state`: exactly one branch is deleted.  The health ladder
-- above it is untouched and is ALREADY core-correct — it reads `refreshed_at` and
-- `last_refresh_attempt_at`, which Phase 1B made core-only clocks when it introduced
-- `facilities_refreshed_at`.  Nothing in the core ladder may read the overlay clock;
-- the invariants below assert that.
create or replace view public.app_coverage_states as
 SELECT m.zip,
        CASE
            WHEN r.zip IS NULL THEN 'unsupported_source'::text
            WHEN r.refreshed_at < (now() - '7 days'::interval) AND r.last_refresh_attempt_at > r.refreshed_at AND r.last_refresh_attempt_at >= (now() - '48:00:00'::interval) THEN 'failed_ingest'::text
            WHEN r.refreshed_at < (now() - '72:00:00'::interval) AND r.last_refresh_attempt_at > r.refreshed_at AND r.last_refresh_attempt_at >= (now() - '48:00:00'::interval) THEN 'temporarily_unavailable'::text
            WHEN r.refreshed_at < (now() - '72:00:00'::interval) THEN 'stale_data'::text
            WHEN COALESCE(c.dev_markers, 0::bigint) > 0 OR COALESCE(ch.changes, 0::bigint) > 0 THEN 'populated'::text
            ELSE 'honestly_empty'::text
        END AS coverage_state,
    m.data_quality,
    r.refreshed_at,
    r.last_refresh_attempt_at,
    COALESCE(c.dev_markers, 0::bigint) AS dev_markers,
    COALESCE(c.fac_markers, 0::bigint) AS fac_markers,
    COALESCE(ch.changes, 0::bigint) AS changes,
    COALESCE(ch.news_items, 0::bigint) AS news_items,
    -- ── the REGULATORY OVERLAY plane, reported separately and never mixed in ──
    -- overlay_unknown exists because "we could not read EPA" and "EPA has nothing"
    -- are different facts, and collapsing them is the exact dishonesty Phase 1B
    -- removed from `counts.facilities`.  An absent answer is never rendered as zero.
        CASE
            WHEN r.zip IS NULL THEN 'overlay_unsupported'::text
            WHEN COALESCE(c.fac_markers, 0::bigint) > 0 THEN 'overlay_records'::text
            WHEN COALESCE(r.facilities_unavailable, false) THEN 'overlay_unknown'::text
            ELSE 'overlay_empty'::text
        END AS regulatory_overlay_state,
    r.facilities_refreshed_at,
    COALESCE(r.facilities_unavailable, false) AS facilities_unavailable
   FROM app_community_meta m
     LEFT JOIN development_reports r ON r.zip = m.zip
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE p.record_kind = 'development'::text) AS dev_markers,
            count(*) FILTER (WHERE p.record_kind = 'facility'::text) AS fac_markers
           FROM app_projects p
          WHERE p.zip = m.zip) c ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE a.category <> 'Local News'::text) AS changes,
            count(*) FILTER (WHERE a.category = 'Local News'::text) AS news_items
           FROM app_changes a
          WHERE a.zip = m.zip) ch ON true;

comment on view public.app_coverage_states is
  'Two independent planes. coverage_state describes the CORE project plane only '
  '(populated | honestly_empty | unsupported_source | failed_ingest | '
  'temporarily_unavailable | stale_data) and never reads EPA facility counts or the '
  'overlay clock. regulatory_overlay_state describes the EPA/FRS overlay '
  '(overlay_records | overlay_empty | overlay_unknown | overlay_unsupported) with its '
  'own freshness in facilities_refreshed_at. A page that shows both composes them; '
  'neither may be derived from the other.';

-- ------------------------------------------------------------------- 2. the grants
-- The view is read with the public anon key by community.html and by the CI verifier.
-- `create or replace view` preserves grants, but re-stating them costs nothing and
-- makes a future DROP + CREATE (which does not) impossible to get silently wrong.
grant select on public.app_coverage_states to anon, authenticated;

-- ------------------------------------------------------------------ 3. the invariants
do $verify$
declare
  def       text;
  core_def  text;
  n_rows    bigint;
  n_bad     bigint;
begin
  select pg_get_viewdef('public.app_coverage_states'::regclass, true) into def;

  -- (a) THE CORE INVARIANT: no EPA term survives anywhere in the core ladder. The
  --     ladder is everything from the opening CASE to its END ... AS coverage_state.
  core_def := substring(def from position('CASE' in def) for
                        position('AS coverage_state' in def) - position('CASE' in def));
  if core_def is null or length(core_def) < 100 then
    raise exception 'VERIFY FAILED: could not isolate the coverage_state ladder';
  end if;
  if position('fac_markers'             in core_def) > 0
     or position('facilities_unavailable' in core_def) > 0
     or position('facilities_refreshed_at' in core_def) > 0
     or position('facilities_only'         in core_def) > 0 then
    raise exception 'VERIFY FAILED: the core coverage ladder still reads the EPA plane';
  end if;

  -- (b) `facilities_only` is gone from the whole view, not merely from the ladder.
  if position('facilities_only' in def) > 0 then
    raise exception 'VERIFY FAILED: facilities_only survives in the view definition';
  end if;

  -- (c) The overlay plane is actually present and self-describing.
  if position('regulatory_overlay_state'  in def) = 0
     or position('overlay_records'         in def) = 0
     or position('overlay_unknown'         in def) = 0
     or position('facilities_refreshed_at' in def) = 0 then
    raise exception 'VERIFY FAILED: the regulatory overlay plane is not exposed';
  end if;

  -- (d) Every ZIP still classifies, on BOTH planes, with no NULLs and no strays.
  select count(*) into n_rows from public.app_coverage_states;
  select count(*) into n_bad  from public.app_coverage_states
   where coverage_state is null or regulatory_overlay_state is null
      or coverage_state not in ('populated','honestly_empty','unsupported_source',
                                'failed_ingest','temporarily_unavailable','stale_data')
      or regulatory_overlay_state not in ('overlay_records','overlay_empty',
                                          'overlay_unknown','overlay_unsupported');
  if n_bad > 0 then
    raise exception 'VERIFY FAILED: % of % rows carry an invalid state on one of the planes', n_bad, n_rows;
  end if;

  -- (e) THE DECOUPLING, stated as data rather than as text: the two planes must not be
  --     functionally dependent. A ZIP that is honestly_empty on core while the overlay
  --     holds records is the ENTIRE POINT of this unit — if none exists, either the
  --     split did not take or there was nothing to split, and both deserve to fail
  --     loudly rather than pass vacuously.
  select count(*) into n_bad from public.app_coverage_states
   where coverage_state = 'honestly_empty' and regulatory_overlay_state = 'overlay_records';
  if n_bad = 0 then
    raise exception 'VERIFY FAILED: no ZIP is core-empty with overlay records — the split is vacuous';
  end if;
  raise notice 'core-empty + overlay-records (was facilities_only): % ZIP(s)', n_bad;

  -- (f) A core state must never be reachable ONLY through the overlay: populated must
  --     be backed by core content, honestly_empty must have none.
  select count(*) into n_bad from public.app_coverage_states
   where (coverage_state = 'populated'      and dev_markers = 0 and changes = 0)
      or (coverage_state = 'honestly_empty' and (dev_markers > 0 or changes > 0));
  if n_bad > 0 then
    raise exception 'VERIFY FAILED: % rows whose core state disagrees with core content', n_bad;
  end if;

  -- (g) The overlay must never claim emptiness it did not verify.
  select count(*) into n_bad from public.app_coverage_states
   where regulatory_overlay_state = 'overlay_empty' and facilities_unavailable;
  if n_bad > 0 then
    raise exception 'VERIFY FAILED: % rows report overlay_empty over an unverified EPA read', n_bad;
  end if;

  raise notice 'PHASE 2 UNIT 2 VERIFIED over % rows', n_rows;
end
$verify$;

-- ----------------------------------------------------------------- 4. what this moves
-- Measured from the STORED stamps 2026-09-07 (one self-consistent read of
-- app_community_meta; `growth_pressure IS NULL` is the stamped proxy for `_nd = 0`,
-- `_nc` and `_nfc` are the materializer's own labels).  A live recount of
-- app_projects / app_changes returns different figures because the rolling
-- materializer moves those tables under the query — name the instrument.
--
--   app_community_meta rows                                       12,722
--   core content present (stamped)                                11,678
--   core empty + EPA facilities  -> was `facilities_only`             766
--   core empty + no EPA facilities -> `honestly_empty` either way      278
--   11,678 + 766 + 278 = 12,722                                     exact
--   of the 766, data_quality = 'pass'                            766 / 766
--
-- After the split those 766 read `coverage_state = 'honestly_empty'` +
-- `regulatory_overlay_state = 'overlay_records'`.
--
-- ── DRY RUN, read-only, against production (the view was NOT replaced) ──
-- Running the SELECT above beside the live view for six ZIPs, 2026-09-07:
--   01001 populated -> populated + overlay_records         (unchanged)
--   01002 populated -> populated + overlay_records         (unchanged)
--   03224 facilities_only -> honestly_empty + overlay_records, data_quality pass
--   03268 facilities_only -> honestly_empty + overlay_records, data_quality pass
--   01034 honestly_empty -> honestly_empty + overlay_UNKNOWN (facilities_unavailable)
--   02543 honestly_empty -> honestly_empty + overlay_UNKNOWN (facilities_unavailable)
-- So the file is executable and the equivalence holds — and the last two rows are a
-- FINDING, recorded below.
--
-- 🔑 ONE RENDERED SENTENCE DOES CHANGE, ON UP TO 226 PAGES, AND IT IS A CORRECTION.
-- community.html's honest-empty copy reads "We checked every supported public source
-- for this area — government registries, permit feeds, and the EPA facility registry —
-- and found no qualifying records yet."  Measured 2026-09-07: of the 278 ZIPs that are
-- empty on both planes, **226 carry `facilities_unavailable = true`** — the EPA read was
-- REFUSED, so its count is UNKNOWN rather than zero (Phase 1B's whole point), and the
-- page is claiming a verified absence it did not verify.  1,197 ZIPs carry that flag
-- overall.  The split is what makes the distinction expressible: `overlay_unknown`.
-- The same commit gates that sentence on the overlay agreeing, so those pages fall
-- through to the existing "Coverage for this ZIP is being wired" copy, which is true and
-- claims nothing about EPA.  A dedicated "we could not reach the EPA registry" sentence
-- would be more precise and is a founder copy decision, deliberately not invented here.
--
-- ⚠️ APART FROM THAT SENTENCE, NOTHING A RESIDENT SEES CHANGES, and that is a
-- requirement of this unit rather than a happy accident.  The banner those pages carry
-- today
--   "Local government meeting and permit feeds for this area are still being wired —
--    the EPA-registered facility records below are live public data."
-- is keyed on `facilities_only` in lib/community-page.js.  The same commit re-keys it
-- on the COMPOSITION (`honestly_empty` + `overlay_records`), which is the same set of
-- pages and the same words.  The page keeps reading `facilities_only` as well, so the
-- banner is correct both before and after the apply — the code may merge first.
--
-- WHAT THIS UNIT DELIBERATELY DOES **NOT** TOUCH:
--   * `data_quality` — still `(_nd+_nf+_nc)>0`, still the layout gate (audit §14.1).
--     Its CI assertion `honestly_empty => coverage_coming` therefore becomes FALSE for
--     these 766 and is replaced by the composed pair in scripts/verify-coverage-state.mjs.
--   * The core health ladder — already core-only since Phase 1B.
--   * The single `sites` jsonb (Unit 3) and Promise.all([devSites, facilitySites]) (Unit 4).
