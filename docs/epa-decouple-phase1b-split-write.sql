-- ============================================================================
-- PHASE 1B — dev_refresh_collect() writes TWO INDEPENDENT PLANES.
--
-- ⚠️ STATUS, READ FIRST (2026-09-07). This file is now a COMPLETE, EXECUTABLE,
--    ATOMIC record of the intended Phase 1B transition. It supersedes an earlier
--    version of this file whose step (d) was a COMMENTED reproduction — that version
--    was not replayable: running it added the column and the predicate while leaving
--    dev_refresh_collect() as the OLD all-or-nothing body, i.e. it permanently
--    recreated the very hazard window it documented. Caught in review of PR #1102.
--
-- ⚠️ THE PARKED FUNCTION BELOW LEADS PRODUCTION BY TWO REVIEW FIXES.
--    Applied live 2026-09-07: pg_get_functiondef md5 bccdb1149f85cc71d31f5e949cb9e47e
--    (9,596 chars / 190 lines). That deployed body does NOT yet contain:
--      (1) the payload-shape guard  `jsonb_typeof(j->'sites') = 'array'`;
--      (2) the facilities_unavailable freshness-limb correction.
--    Both are review-required fixes and are present in the definition below.
--
--    "DIFFER BY EXACTLY THOSE TWO FIXES" IS MEASURED, NOT ASSERTED. Normalizing both
--    bodies identically (strip comment and blank lines, collapse whitespace runs) and
--    then removing the two fixes from the parked copy reproduces the live body EXACTLY:
--
--      parked body, normalized, WITH both fixes ...... md5 1d2020c1ba7d78bc50d50c53f34c87b9  (141 lines)
--      parked body, normalized, fixes removed ........ md5 1f75eb3d5a0205a908ff5e01dcf4d4a5  (139 lines)
--      LIVE body, normalized (pg_get_functiondef) .... md5 1f75eb3d5a0205a908ff5e01dcf4d4a5  (139 lines)
--
--    The last two are identical, which proves the parked function is a faithful copy of
--    the deployed one and that the delta is exactly the 2 added lines — not a
--    hand-transcription that happens to look right (CLAUDE.md rules 7-8).
--
--    BEFORE ANY LATER RELEASE: apply this file, then record the resulting
--    pg_get_functiondef md5 and confirm it against the definition parked here. The
--    pre-apply live md5 to expect is bccdb1149f85cc71d31f5e949cb9e47e (9,596 chars);
--    it MUST change once this file is applied, and if it has not, the apply did not
--    take.
--
-- ============================================================================
-- WHAT WAS WRONG (the original Phase 1B defect)
-- ----------------------------------------------------------------------------
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
-- 2026-09-07 during a real FRS outage (429 / "Failure when receiving data from the
-- peer" on both probe targets): in ONE HOUR, 51 ZIP refreshes refused, 46 of them
-- holding project data, and 6,532 core project records fetched from first-party
-- permit and planning sources were discarded. Structural exposure: 11,565 of 12,722
-- cached reports (90.9%) carry counts.facilities > 0, and 10,344 also carry projects.
-- The refusal also left `refreshed_at` untouched, so app_coverage_states then reported
-- the ZIP stale_data / temporarily_unavailable: 2,533 of the 2,563 rows attempted-
-- but-not-written in 48h carried cached facilities (98.8%).
--
-- THE SPLIT
-- ----------------------------------------------------------------------------
--   CORE plane        sites without a registry_id, counts.* except facilities,
--                     refreshed_at, paywall, source_vintage.
--                     Guarded ONLY by CORE GUARD 1 (per-source fetch failure where
--                     that source already contributes) and CORE GUARD 2 (unexplained
--                     development reduction while fresh). An EPA failure cannot reach
--                     any of these columns.
--
--   REGULATORY plane  sites WITH a registry_id, counts.facilities,
--                     facilities_unavailable, facilities_refreshed_at.
--                     Guarded by dev_epa_write_refused().
--
-- THE REFUSAL SEMANTICS ARE NOT RELAXED. Phase 1B changed the BLAST RADIUS of the EPA
-- refusal, never the refusal itself. When it fires, the STORED facility sites and count
-- are carried forward verbatim and facilities_refreshed_at does not advance.
--
-- THE PLANE DISCRIMINATOR — `x ? 'registry_id'`, verified in BOTH directions
-- ----------------------------------------------------------------------------
-- Across ALL 3,515,892 stored sites at audit time, three independent tests agreed with
-- ZERO disagreements: "has a registry_id key" = 215,398, "relevance is null" = 215,398,
-- and "src starts with 'EPA FRS'" (control: 3,300,494 non-facility sites, so the zero
-- means something). On 359 live payloads the count of registry_id-bearing sites equals
-- `counts.facilities` on 359 of 359, so the split REPRODUCES the engine's own number
-- rather than recomputing it. `?` is an EXACT key test: the core connectors' own
-- `source_registry_id` does not match it.
--
-- ⚠️ The discriminator is a CONVENTION, not an enforced constraint. index.ts:297 is the
-- sole emitter of a site-level `registry_id`. If a connector ever emitted one, its core
-- records would silently migrate into the overlay plane and be frozen with EPA. The
-- invariant that catches it is `counts.facilities` = count of registry_id sites; it held
-- on 0 mismatches of 12,722 but is not yet enforced anywhere. Logged, not fixed here.
--
-- ORDER IS PRESERVED. The engine emits allSites = [...dev, ...permitSites, ...fac] —
-- facilities LAST — so `core || facility` reproduces the payload array exactly when both
-- planes write. `with ordinality` + `order by o` makes that explicit rather than relying
-- on jsonb_agg's incidental input order. Verified on stored data: across 12,444 rows with
-- sites (11,565 carrying facilities), 0 interleaved, 0 where facilities are not a
-- contiguous suffix, 0 duplicated (zip, registry_id) pairs.
--
-- THE OLD COMBINED-ZERO GUARD IS SUBSUMED, NOT DROPPED
-- ----------------------------------------------------------------------------
-- It fired on (fresh AND newFac=0 AND newDev=0 AND (cachedFac+cachedDev)>0 AND
-- unexplained). With the planes split:
--   * cachedDev > 0  -> CORE GUARD 2 fires, core write refused.  OK
--   * cachedDev = 0  -> the core write is development 0 over 0, a no-op with nothing to
--                      lose, and the facility half is caught by dev_epa_write_refused. OK
-- Both limbs are pinned by test/dev-refresh-plane-split.test.mjs.
--
-- WHY facilities_refreshed_at EXISTS
-- ----------------------------------------------------------------------------
-- Before the split the two planes could only move together, so one timestamp was honest.
-- After it, core advances while EPA is down — a shared timestamp would start claiming the
-- facility layer had been refreshed when it had not, a NEW dishonesty introduced by the
-- fix. Backfilled to refreshed_at, the correct historical value for every prior row.
--
-- OUT OF SCOPE, DELIBERATELY (Phase 2, founder decision pending)
-- ----------------------------------------------------------------------------
-- Nothing here touches app_refresh_zip's data_quality / indexable, the
-- app_coverage_states facilities_only state, the sitemap, robots, or eligibility. EPA
-- facilities still count toward pass and indexable exactly as before this change.
-- ============================================================================


-- ── 1. overlay freshness column + initialization ────────────────────────────
-- Additive, nullable, no default, no index: nothing reads it yet, and a speculative
-- index on a 12,722-row table would be cost without a reader.
alter table public.development_reports
  add column if not exists facilities_refreshed_at timestamptz;

update public.development_reports
   set facilities_refreshed_at = refreshed_at
 where facilities_refreshed_at is null;

comment on column public.development_reports.facilities_refreshed_at is
  'When the REGULATORY overlay plane (EPA/FRS facilities) last took a write. Diverges from '
  'refreshed_at (the CORE project plane) whenever the EPA write was refused as untrustworthy. '
  'Added by the Phase 1B plane split, 2026-09-07.';


-- ── 2. the ONE definition of the EPA refusal ───────────────────────────────
-- Needed in five places in the write below (counts, both sites branches, the overlay
-- timestamp, and the unavailable flag). Five copies of a guard is how the halves of a
-- guard drift apart; this repo has paid for that more than once. One definition.
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


-- ── 3. dev_refresh_collect() — the FULL final intended body ────────────────
-- Steps (a) fetch-failure recording, (b) truncation recording and (c) retirement
-- recording are unchanged from the pre-split function. Step (d) is the plane split
-- plus the two review fixes marked REVIEW FIX 1 and REVIEW FIX 2 below.
create or replace function public.dev_refresh_collect()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'net'
as $function$
declare n integer;
  epa_ok boolean;
begin
  -- EPA FRS health, read once per collect from the probe cron (job 16).
  -- EVERY target must be healthy, not whichever resolved last. epa_frs_probe_tick()
  -- fires two points on purpose because FRS fails density-dependently
  -- (sheridan-rural r=3, atlanta-dense r=1). A last-row read would flip epa_ok true
  -- the moment the rural point recovered, while dense pages were still failing.
  -- STALENESS BOUND: a signal older than 60 minutes is NOT evidence of health. Without
  -- it, epa_ok would hold whatever the probe last said indefinitely, so a stopped job 16
  -- would OPEN the guard instead of closing it.
  -- FAIL-CLOSED: no rows, any false, or a stale newest all resolve to false.
  select coalesce(
           (select count(*) > 0
                   and bool_and(t.ok)
                   and max(t.resolved_at) > now() - interval '60 minutes'
              from (select distinct on (target) target, ok, resolved_at
                      from public.epa_frs_probes
                     where resolved_at is not null
                     order by target, probed_at desc) t),
           false)
    into epa_ok;

  -- (a) per-source FETCH FAILURES — refuse the write when the source already contributes.
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  ),
  fails as (
    select (r.j->>'zip') as zip, f.registry_id, min(f.reason) as reason
    from resp r, lateral public.dev_failed_sources(r.j) f
    group by 1, 2
  ),
  scored as (
    select fl.zip, fl.registry_id, fl.reason,
           (select count(*)
              from public.development_reports d,
                   lateral jsonb_array_elements(d.sites) e
             where d.zip = fl.zip
               and e->>'source_registry_id' = fl.registry_id)::int as cached_records
    from fails fl
  )
  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update, kind)
  select zip, registry_id, reason, cached_records, cached_records > 0, 'fetch_failed' from scored;

  -- (b) BOUNDED fetches — visible, never blocking (deterministic; a refusal would freeze).
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  )
  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update, kind, detail)
  select (r.j->>'zip'), t.registry_id,
         'max_rows bound the fetch at ' || t.cap || ' — this page is INCOMPLETE',
         t.fetched, false, 'truncated',
         jsonb_build_object('cap', t.cap, 'fetched', t.fetched)
  from resp r, lateral public.dev_truncated_sources(r.j) t;

  -- (c) RETIRED sources — record the explanation that lets step (d) accept a real reduction.
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  )
  insert into public.dev_refresh_source_failures
        (zip, registry_id, reason, cached_records, blocked_update, kind, detail)
  select (r.j->>'zip'), t.registry_id,
         'source no longer reported for this ZIP (retired from the registry, or coverage changed) — its '
           || t.cached_records || ' cached records are being dropped',
         t.cached_records, false, 'retired',
         jsonb_build_object('cached_records', t.cached_records)
  from resp r, lateral public.dev_retired_sources(r.j->>'zip', r.j) t;

  -- (d) write — TWO INDEPENDENT PLANES composed into one row.
  with resp as (
    select distinct on (content::jsonb->>'zip') content::jsonb as j
    from net._http_response
    where status_code = 200
      and created > now() - interval '20 minutes'
      and (content::jsonb->>'mode') = 'zip'
      and left(ltrim(content), 1) = '{'
    order by content::jsonb->>'zip', id desc
  ),
  blocked as (
    select distinct (r.j->>'zip') as zip
    from resp r, lateral public.dev_failed_sources(r.j) f
    where exists (
      select 1 from public.development_reports d,
                    lateral jsonb_array_elements(d.sites) e
       where d.zip = (r.j->>'zip')
         and e->>'source_registry_id' = f.registry_id)
  ),
  explained as (
    select distinct (r.j->>'zip') as zip
    from resp r
    where exists (select 1 from public.dev_retired_sources(r.j->>'zip', r.j))
  )
  update public.development_reports d set
    -- counts: core keys from the payload; facilities preserved when the EPA write is refused.
    counts = case
               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
                 then (j->'counts') || jsonb_build_object(
                        'facilities', coalesce((d.counts->>'facilities')::int, 0))
               else j->'counts'
             end,
    -- sites: payload project records, then EITHER the payload facilities or the stored ones.
    sites = coalesce((select jsonb_agg(x order by o)
                        from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                       where not (x ? 'registry_id')), '[]'::jsonb)
            || case
                 when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
                   then coalesce((select jsonb_agg(x order by o)
                                    from jsonb_array_elements(d.sites) with ordinality t(x, o)
                                   where x ? 'registry_id'), '[]'::jsonb)
                 else coalesce((select jsonb_agg(x order by o)
                                  from jsonb_array_elements(j->'sites') with ordinality t(x, o)
                                 where x ? 'registry_id'), '[]'::jsonb)
               end,
    paywall        = coalesce((j->>'paywall')::boolean, false),
    source_vintage = 'get-address-report ZIP mode; pg_cron daily auto-refresh',
    -- CORE freshness. Advances on every accepted core write, EPA up or down. This is the
    -- whole point of Phase 1B: an EPA outage must not make a ZIP look stale.
    refreshed_at   = now(),
    -- REGULATORY freshness. Advances only when the facility layer actually took a write.
    facilities_refreshed_at = case
                                when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at)
                                  then d.facilities_refreshed_at
                                else now()
                              end,
    -- ⚖️ REVIEW FIX 2 — THE FLAG FOLLOWS THE FACILITY PLANE, NOT THE EPA READ.
    -- The first Phase 1B build kept the pre-split expression, which had only ever run on
    -- rows where BOTH planes wrote. Under the split it also runs on REFUSED rows, and on
    -- the FRESHNESS limb (EPA healthy, legitimately returns 0, row < 7 days old, cached
    -- count > 0) it evaluated to FALSE while the stale cached count was preserved — so the
    -- page asserted a count EPA had just contradicted as confirmed fact. Pre-split the row
    -- was not written at all, so the flag kept its prior "unknown". Measured 0 rows in that
    -- state at review time, but reachable the moment EPA recovers for a recently-refreshed
    -- ZIP. The refusal branch now leads: if the facility plane did NOT take a trusted write,
    -- the stored result is not current and the count renders as UNKNOWN, never as fact.
    -- Reversion is still a side-effect of the repair: once a refresh actually stores a real
    -- facility count, refused is false, the first branch below fires, and the page stops
    -- saying "unavailable".
    facilities_unavailable = case
                               when public.dev_epa_write_refused(epa_ok, j, d.counts, d.refreshed_at) then true
                               when coalesce((j->'counts'->>'facilities')::int, 0) > 0 then false
                               when not (epa_ok and coalesce((j->'epa'->>'ok')::boolean, true)) then true
                               else false
                             end
  from resp
  where d.zip = (j->>'zip')
    -- ⚖️ REVIEW FIX 1 — PAYLOAD SHAPE GUARD, AT THE WRITE ELIGIBILITY BOUNDARY.
    -- The split iterates j->'sites'; jsonb_array_elements raises 22023 ("cannot extract
    -- elements from a scalar") on anything that is not an array, which aborts the WHOLE
    -- statement — every ZIP in the 20-minute window, re-failing every 2 minutes until the
    -- bad response ages out. The pre-split code assigned `sites = j->'sites'` without
    -- iterating, so this failure mode is one the split introduced. Withholding the row is
    -- the fail-closed answer: no core write, no facility write, no freshness advanced, no
    -- facility data zeroed, and every other row in the batch proceeds untouched.
    -- jsonb_typeof(NULL) is NULL and NULL = 'array' is NULL, so a missing `sites` key is
    -- withheld too. Deliberately NOT applied to d.sites: steps (a) and (c) above already
    -- iterate the stored array, so a malformed STORED value is a pre-existing condition
    -- this guard neither creates nor claims to fix.
    and jsonb_typeof(j->'sites') = 'array'
    -- CORE GUARD 1 — per-source fetch failure where that source already contributes.
    -- dev_failed_sources() reads the first-party connector reports only; EPA reports through
    -- j->'epa'->>'ok' and can never appear here.
    and not exists (select 1 from blocked b where b.zip = d.zip)
    -- CORE GUARD 2 — an unexplained development reduction while the row is FRESH (<7 days).
    -- "Explained" means some contributing source is no longer reported at all (retired entry
    -- or coverage change), which is structural and will not resolve by waiting.
    and not (
      d.refreshed_at >= now() - interval '7 days'
      and coalesce((j->'counts'->>'development')::int, 0) = 0
      and coalesce((d.counts->>'development')::int, 0) > 0
      and not exists (select 1 from explained x where x.zip = d.zip)
    );
  get diagnostics n = row_count;
  return n;
end $function$;


-- ── 4. scoped repair of the original migration-window artifact ─────────────
-- RETAINED FROM THE ORIGINAL APPLY, with its fail-loud guard and non-collateral
-- assertions intact. On a fresh replay of this file it is a NO-OP that raises nothing,
-- because the window it targets cannot exist: the column and the function now land in
-- ONE script, so there is no interval in which the column exists while the old
-- all-or-nothing body still runs.
--
-- WHAT IT REPAIRED. On the original 2026-09-07 apply the column landed at 14:25:50Z and
-- the writer at 14:26:57Z. `dev-reports-rolling-refresh` runs */2, so its 14:26:00Z tick
-- fell in that 67-second gap and ran the OLD dev_refresh_collect — advancing
-- refreshed_at while knowing nothing about the new column. 6 rows.
--
-- HOW IT WAS FOUND, because the shape recurs: a table-wide sweep flagged ONE row as
-- "overlay held BUT facilities = 0" — a state the split makes structurally impossible,
-- since the refusal requires cached facilities > 0. A count of 1 against 12,722 is
-- exactly the anomaly size that gets rounded away; it was the only visible symptom of a
-- 6-row inconsistency.
--
-- WHY THE REPAIR IS THE HONEST VALUE. The old function was all-or-nothing — if it wrote
-- the row it wrote BOTH planes from one payload — so for these rows the facility layer
-- genuinely DID take a write at refreshed_at. Leaving it would make 6 pages look like
-- they had held a stale facility layer when they had not.
--
-- SCOPED BY TIME, NOT BY SYMPTOM, so it cannot touch a genuine refusal: the bounds are
-- the two original migration versions, and the new function did not exist until the
-- later one. Guarded, not idempotent — a second run raises rather than silently doing
-- nothing.
do $repair$
declare n_before int; n_after int; n_genuine_before int; n_genuine_after int;
begin
  select count(*) into n_before from public.development_reports
   where facilities_refreshed_at < refreshed_at
     and refreshed_at >  timestamptz '2026-09-07 14:25:50+00'
     and refreshed_at <= timestamptz '2026-09-07 14:26:57+00';

  if n_before = 0 then
    raise notice 'no migration-window artifact present (expected on a fresh replay) — skipping';
    return;
  end if;

  select count(*) into n_genuine_before from public.development_reports
   where facilities_refreshed_at < refreshed_at
     and refreshed_at > timestamptz '2026-09-07 14:26:57+00';

  if n_before <> 6 then
    raise exception 'refusing: expected 6 migration-window rows, found %', n_before;
  end if;

  update public.development_reports
     set facilities_refreshed_at = refreshed_at
   where facilities_refreshed_at < refreshed_at
     and refreshed_at >  timestamptz '2026-09-07 14:25:50+00'
     and refreshed_at <= timestamptz '2026-09-07 14:26:57+00';

  select count(*) into n_after from public.development_reports
   where facilities_refreshed_at < refreshed_at
     and refreshed_at >  timestamptz '2026-09-07 14:25:50+00'
     and refreshed_at <= timestamptz '2026-09-07 14:26:57+00';

  select count(*) into n_genuine_after from public.development_reports
   where facilities_refreshed_at < refreshed_at
     and refreshed_at > timestamptz '2026-09-07 14:26:57+00';

  if n_after <> 0 then raise exception 'repair incomplete: % remain', n_after; end if;

  -- The genuine refusals must be UNTOUCHED. A repair that also "fixed" those would have
  -- erased the very signal the split exists to record.
  if n_genuine_after <> n_genuine_before then
    raise exception 'COLLATERAL DAMAGE: genuine refusals moved % -> %', n_genuine_before, n_genuine_after;
  end if;

  raise notice 'repaired % artifact rows; % genuine refusals untouched', n_before, n_genuine_after;
end $repair$;


-- ── 5. post-apply invariants ───────────────────────────────────────────────
-- The overlay clock can never be AHEAD of core (they are written in one statement, and
-- the overlay either takes now() or holds an older value).
do $verify$
declare bad int;
begin
  select count(*) into bad from public.development_reports where facilities_refreshed_at > refreshed_at;
  if bad <> 0 then raise exception 'overlay clock ahead of core on % row(s)', bad; end if;

  select count(*) into bad from public.development_reports where facilities_refreshed_at is null;
  if bad <> 0 then raise exception 'null overlay clock on % row(s)', bad; end if;

  select count(*) into bad from public.development_reports
   where coalesce((counts->>'facilities')::int, 0)
      <> (select count(*) from jsonb_array_elements(sites) x where x ? 'registry_id');
  if bad <> 0 then raise exception 'counts.facilities disagrees with stored facility sites on % row(s)', bad; end if;
end $verify$;

-- ============================================================================
-- VERIFIED AFTER THE ORIGINAL APPLY, 2026-09-07 — one dev_refresh_collect() run,
-- 78 rows written. Cohort frozen beforehand (that probe table has since been dropped;
-- see FOLLOW-UP below).
--   cohort                                        80
--   EPA-refused                                   26
--     of those, CORE plane advanced               26   <- was 0 before the split
--     of those, overlay clock correctly held      26
--     of those, facility COUNT preserved exactly  26
--     of those, facility SITES preserved exactly  26
--     of those, facilities zeroed                  0
--   not refused, both planes advanced             52
--   core-blocked by CORE GUARD 1                   2   (22192, 22307 — 'ArcGIS error:
--                                                       Token Required', protecting
--                                                       40->21 and 373->33; epa_refused
--                                                       FALSE on both, so the core guard
--                                                       fires independently of EPA)
--   26 + 52 + 2 = 80, and 26 + 52 = 78 = rows written.  Exact.
--
-- RE-VERIFIED AT REVIEW, during a second live FRS degradation:
--   core refreshed in 60 min ............................ 299
--   overlay refreshed in 60 min ......................... 204
--   core advanced while overlay held .................... 95
--   overlay clock ahead of core ......................... 0
--   null overlay clock .................................. 0
--   held clock with facilities zeroed ................... 0
--   counts.facilities vs stored facility sites mismatch . 0
--   core-source failures still blocking ................. 73
--   duplicated (zip, registry_id) pairs ................. 0
--   facility sites not a contiguous suffix .............. 0
--
-- FOLLOW-UP — the verification probe table was DROPPED
-- migration `drop_epa_split_probe_20260907_diagnostic`
--   public.epa_split_probe_20260907 froze the 80-ZIP pre-run cohort. It is gone:
--   nothing read it and nothing could refresh it, and `create table as` in `public`
--   inherited this project's default grants, so it landed with RLS DISABLED and `anon`
--   holding arwdDxtm — readable AND WRITABLE through PostgREST. That is the page_cache
--   posture CLAUDE.md flags as a defect, created for an artifact with no consumer.
--   Content at drop time: 80 rows, 26 EPA-refused, ZIP range 04015..99204, 2,635 project
--   records protected and 405 stored facilities preserved across the refused rows.
--
-- 🔑 STANDING ANSWER: a verification cohort that will be summarised into a committed doc
-- should be a TEMP table or doc-only. If one must genuinely persist across sessions (as
-- the gov-notices gn_*_cohort_* tables do), create it EXPLICITLY with RLS enabled and no
-- anon grant, and name its owner and expiry in the same commit. `create table as` in
-- `public` is never the right way to make one.
--
-- 🔑 STANDING ANSWER: ADDING A COLUMN A HOT-PATH FUNCTION MUST MAINTAIN IS ONE MIGRATION,
-- NOT TWO. On a */2 cron there is no safe gap between "the column exists" and "the writer
-- maintains it". This file now lands both in one script for exactly that reason.
--
-- 🔑 STANDING ANSWER: A PARKED MIGRATION THAT IS MOSTLY COMMENTS IS NOT A MIGRATION. The
-- first version of this file reproduced step (d) as a comment; replaying it would have
-- created the column, skipped the writer, and left the hazard open indefinitely — while
-- looking complete. Park executable SQL, and let the structural tests read the executable
-- statements rather than the prose around them.
-- ============================================================================
