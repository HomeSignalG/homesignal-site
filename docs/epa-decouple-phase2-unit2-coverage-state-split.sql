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
--
-- 🔒 `WITH (security_invoker = true)` IS RESTATED, AND OMITTING IT WOULD HAVE BEEN A
-- SILENT PRIVILEGE ESCALATION.  The live view already carries
-- `reloptions = {security_invoker=true}` and is owned by `postgres`.  Measured on this
-- database rather than recalled: creating a view WITH the option and then issuing a
-- bare `create or replace view` WITHOUT it leaves `reloptions = (none)` — the option is
-- DROPPED, not preserved.  So the first draft of this file would have converted an
-- anon-readable view into one executing with the owner's rights, bypassing RLS on
-- app_community_meta, development_reports, app_projects and app_changes.  Restating it
-- makes the file reproduce production exactly; against production it is a no-op.
create or replace view public.app_coverage_states
  with (security_invoker = true) as
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
   FROM public.app_community_meta m
     LEFT JOIN public.development_reports r ON r.zip = m.zip
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE p.record_kind = 'development'::text) AS dev_markers,
            count(*) FILTER (WHERE p.record_kind = 'facility'::text) AS fac_markers
           FROM public.app_projects p
          WHERE p.zip = m.zip) c ON true
     LEFT JOIN LATERAL ( SELECT count(*) FILTER (WHERE a.category <> 'Local News'::text) AS changes,
            count(*) FILTER (WHERE a.category = 'Local News'::text) AS news_items
           FROM public.app_changes a
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
  n_bad     int := 0;
  r         record;
begin
  -- ⚠️ THE INVARIANTS ARE CATALOG READS PLUS KEYED PROBES, NOT UNIVERSE SCANS.
  --    The first version of this block ran FIVE unfiltered aggregates over this view.
  --    Measured on production 2026-09-07: the view plans correctly (index scans on both
  --    laterals) but costs ~9.3M — 12,722 ZIPs x ~622 app_projects rows each, ~7.9M
  --    index+heap reads PER PASS against a 3.21M-row table. ONE pass exceeded 60s with a
  --    warm cache, and even the slice `zip < '15000'` exceeded 50s, so the block could
  --    not finish inside any client's patience and was never once executed. A migration
  --    whose verification cannot run is not verified — it is only long.
  --    So: the catalog checks below are free, and the semantic checks are asserted on
  --    NAMED ZIPs whose expected values were measured read-only before the apply. The
  --    universe counts (766 / 226) are a REPORTING question, measured separately after
  --    commit; they were never what made this migration safe.

  -- ⚠️ LOWERCASE BOTH SIDES. `pg_get_viewdef` renders keywords in upper case today, but
  --    the isolation below must not depend on that: a slice anchored on a casing that
  --    changes silently returns the WRONG substring, and an EPA term inside it would then
  --    go unseen — a guard that stops guarding without failing. Every needle is lower
  --    case and the haystack is lowered once.
  select lower(pg_get_viewdef('public.app_coverage_states'::regclass, true)) into def;

  -- (a) THE CORE INVARIANT: no EPA term survives anywhere in the core ladder. The
  --     ladder is everything from the opening CASE to its END ... AS coverage_state.
  core_def := substring(def from position('case' in def) for
                        position('as coverage_state' in def) - position('case' in def));
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

  -- (c2) The view must still execute with the INVOKER's rights. A bare
  --      `create or replace view` drops reloptions (measured on this database), so this
  --      is the difference between reproducing production and silently escalating it.
  if not exists (
        select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relname = 'app_coverage_states'
           and 'security_invoker=true' = any (c.reloptions)) then
    raise exception 'VERIFY FAILED: app_coverage_states is not security_invoker — it would bypass RLS';
  end if;

  -- (d)(e)(f)(g) THE SPLIT, ASSERTED ON NAMED ZIPs. Six keyed lookups, each an index
  --     probe, covering every case the universe scans covered:
  --       (d) both planes carry a legal value            — all six
  --       (e) the two planes are INDEPENDENT             — 03224 / 03268 are core-empty
  --                                                        while the overlay holds records
  --       (f) a core state agrees with CORE content only — populated has core content,
  --                                                        honestly_empty has none
  --       (g) the overlay never claims an unverified zero — 01034 / 02543 read
  --                                                        overlay_unknown, not _empty
  --     Expected values were measured read-only against production before the apply.
  for r in
    select e.zip, e.want_core, e.want_overlay, e.want_dq,
           v.coverage_state, v.regulatory_overlay_state, v.data_quality,
           v.dev_markers, v.changes, v.facilities_unavailable
      from (values
              ('01001', 'populated',      'overlay_records', null),
              ('01002', 'populated',      'overlay_records', null),
              ('03224', 'honestly_empty', 'overlay_records', 'pass'),
              ('03268', 'honestly_empty', 'overlay_records', 'pass'),
              ('01034', 'honestly_empty', 'overlay_unknown', null),
              ('02543', 'honestly_empty', 'overlay_unknown', null)
           ) as e(zip, want_core, want_overlay, want_dq)
      left join public.app_coverage_states v on v.zip = e.zip
  loop
    if r.coverage_state is null or r.regulatory_overlay_state is null then
      n_bad := n_bad + 1;
      raise warning 'VERIFY: probe ZIP % is absent from the view or carries a NULL plane', r.zip;
    elsif r.coverage_state <> r.want_core or r.regulatory_overlay_state <> r.want_overlay then
      n_bad := n_bad + 1;
      raise warning 'VERIFY: probe ZIP % reads %/%, expected %/%',
        r.zip, r.coverage_state, r.regulatory_overlay_state, r.want_core, r.want_overlay;
    elsif r.want_dq is not null and r.data_quality is distinct from r.want_dq then
      n_bad := n_bad + 1;
      raise warning 'VERIFY: probe ZIP % has data_quality %, expected %',
        r.zip, r.data_quality, r.want_dq;
    elsif (r.coverage_state = 'populated'      and r.dev_markers = 0 and r.changes = 0)
       or (r.coverage_state = 'honestly_empty' and (r.dev_markers > 0 or r.changes > 0)) then
      n_bad := n_bad + 1;
      raise warning 'VERIFY: probe ZIP %, whose core state disagrees with core content (state % / dev % / changes %)',
        r.zip, r.coverage_state, r.dev_markers, r.changes;
    elsif r.regulatory_overlay_state = 'overlay_empty' and r.facilities_unavailable then
      n_bad := n_bad + 1;
      raise warning 'VERIFY: probe ZIP % would report overlay_empty over an unverified EPA read', r.zip;
    end if;
  end loop;
  if n_bad > 0 then
    raise exception 'VERIFY FAILED: % of 6 probe ZIP(s) carry an invalid state on one of the planes', n_bad;
  end if;

  -- (e2) THE DECOUPLING, stated as data rather than as text, and keyed rather than
  --      scanned: a ZIP that is honestly_empty on core while the overlay holds records
  --      is the ENTIRE POINT of this unit. If 03224 is not that ZIP, either the split
  --      did not take or there was nothing to split, and both deserve to fail loudly
  --      rather than pass vacuously.
  if not exists (select 1 from public.app_coverage_states
                  where zip = '03224'
                    and coverage_state = 'honestly_empty'
                    and regulatory_overlay_state = 'overlay_records') then
    raise exception 'VERIFY FAILED: no ZIP is core-empty with overlay records — the split is vacuous';
  end if;
  raise notice 'core-empty + overlay-records (was facilities_only): confirmed on 03224 and 03268; the universe count is measured separately after commit';

  raise notice 'PHASE 2 UNIT 2 VERIFIED on 6 keyed probe ZIP(s) + 5 catalog assertions';
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
