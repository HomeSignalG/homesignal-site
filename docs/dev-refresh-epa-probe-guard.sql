-- ============================================================================
-- EPA-PROBE-AWARE FACILITIES GUARD — migration applied to qwnnmljucajnexpxdgxr
-- on 2026-08-11. Parked here per CLAUDE.md §1 row 3 so the schema stays
-- reproducible. Amends the age-based guard added on 2026-08-09
-- (docs/dev-refresh-guard-migration.sql §1) and completes the #662 flag
-- lifecycle. Full working: docs/accuracy-audit-2026-08.md §V2.
--
-- WHY. Two measured defects in the 2026-08-09 guard, both surfaced by the
-- pre-flight for un-pausing pg_cron job 14 while EPA FRS is down:
--
--   1. THE AGE CLIFF. The facilities refusal is keyed on
--      `d.refreshed_at >= now() - interval '7 days'`. A refused write does not
--      update refreshed_at, so a blocked row AGES toward the boundary. Measured
--      2026-08-11: 15 rows were already past it, the 2026-08-07 batch (1,978
--      pages carrying facilities) crosses it ~2026-08-14 and the 2026-08-08
--      batch (9,005 pages) ~2026-08-15. With the refresh running and FRS still
--      returning 502/503, ~11,000 pages would have had their facilities layer
--      written to zero on schedule.
--
--   2. THE FLAG WAS WRITE-ONLY-FALSE. `facilities_unavailable` is referenced by
--      exactly one function in the database — this one — and inside it the flag
--      was only ever set to FALSE (on recovery). Nothing set it TRUE. The 486
--      pages carrying it were stamped by a one-time repair. So a zeroing write
--      during the outage would have rendered "0 EPA facilities" rather than
--      "unavailable" — precisely the claim #662 exists to prevent.
--
-- Patches the live body TEXTUALLY from pg_get_functiondef with each anchor
-- asserted verbatim first, so a ~130-line body cannot drift by transcription.
-- Not safe to re-run blind: the anchor assertions refuse a second application.
-- ============================================================================

do $do$
declare src text; nd text; anchor text; repl text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dev_refresh_collect';
  if src is null then raise exception 'dev_refresh_collect not found'; end if;

  -- ── (i) declare epa_ok and read the probe ONCE per collect ────────────────
  -- Read from what already exists (the epa-frs-probe cron, job 16). FAIL-CLOSED
  -- in every degenerate case: ok=false, ok NULL, no resolved probe, or an empty
  -- table all coalesce to false, i.e. "EPA is failing", i.e. refuse to zero.
  anchor := E'declare n integer;\nbegin\n';
  if position(anchor in src) = 0 then
    raise exception 'declare/begin header not found verbatim — refusing to patch blind';
  end if;
  repl := E'declare n integer;\n'
       || E'  epa_ok boolean;\n'
       || E'begin\n'
       || E'  -- EPA FRS health, read once per collect from the probe cron (job 16).\n'
       || E'  -- FAIL-CLOSED: false / NULL / no resolved probe all mean "failing".\n'
       || E'  select coalesce(\n'
       || E'           (select p.ok from public.epa_frs_probes p\n'
       || E'             where p.resolved_at is not null\n'
       || E'             order by p.probed_at desc\n'
       || E'             limit 1),\n'
       || E'           false)\n'
       || E'    into epa_ok;\n\n';
  nd := replace(src, anchor, repl);
  if nd = src then raise exception 'probe read produced no change'; end if;
  src := nd;

  -- ── (ii) the facilities refusal becomes probe-aware ───────────────────────
  -- DELIBERATE DEVIATION FROM "replace the age predicate": the age test is kept
  -- and OR-ed with the probe test rather than swapped out. Strictly more
  -- conservative than either alone. The age test is what absorbs a TRANSIENT
  -- FRS flake between two 15-minute probes (the class that read Box Elder
  -- 23 -> 18 on a single 502); dropping it would have traded a slow leak for a
  -- fast one. Nothing freezes permanently: once EPA is healthy the probe test
  -- is false and the ORIGINAL release valve still applies — a genuinely
  -- delisted page ages past 7 days and its real zero writes through.
  anchor := E'    and not (\n'
         || E'      d.refreshed_at >= now() - interval ''7 days''\n'
         || E'      and coalesce((j->''counts''->>''facilities'')::int, 0) = 0\n'
         || E'      and coalesce((d.counts->>''facilities'')::int, 0) > 0\n'
         || E'    );';
  if position(anchor in src) = 0 then
    raise exception 'facilities clause not found verbatim — refusing to patch blind';
  end if;
  repl := E'    and not (\n'
       || E'      (not epa_ok or d.refreshed_at >= now() - interval ''7 days'')\n'
       || E'      and coalesce((j->''counts''->>''facilities'')::int, 0) = 0\n'
       || E'      and coalesce((d.counts->>''facilities'')::int, 0) > 0\n'
       || E'    );';
  nd := replace(src, anchor, repl);
  if nd = src then raise exception 'facilities clause patch produced no change'; end if;
  src := nd;

  -- ── (iii) the flag finally gets a SET-TRUE path ───────────────────────────
  -- Server-derived, never inferred from a count on the client
  -- (test/facilities-unavailable-copy.test.mjs pins that and stays green).
  --   payload facilities > 0            -> false  (recovery clears it, as before)
  --   payload = 0 AND EPA failing       -> true   (honest "unavailable")
  --   payload = 0 AND EPA healthy       -> false  (a real rural empty; do not flag)
  anchor := E'    facilities_unavailable = case when coalesce((j->''counts''->>''facilities'')::int, 0) > 0\n'
         || E'                                  then false else d.facilities_unavailable end';
  if position(anchor in src) = 0 then
    raise exception 'facilities_unavailable assignment not found verbatim — refusing to patch blind';
  end if;
  repl := E'    facilities_unavailable = case\n'
       || E'                               when coalesce((j->''counts''->>''facilities'')::int, 0) > 0 then false\n'
       || E'                               when not epa_ok then true\n'
       || E'                               else false\n'
       || E'                             end';
  nd := replace(src, anchor, repl);
  if nd = src then raise exception 'flag assignment patch produced no change'; end if;

  execute nd;
end $do$;

-- LEFT UNCHANGED ON PURPOSE: both development-dimension clauses, the
-- both-dimensions-zero clause, and the per-source `blocked` refusal. No
-- `explained` escape is added to the facilities clause — `explained` means a
-- RETIRED REGISTRY SOURCE stopped being reported, and FRS is not a registry
-- source, so it could never legitimately explain a facilities drop.

-- ============================================================================
-- STEP 2 — the probe read must AND ALL TARGETS and refuse a STALE signal.
-- Applied 2026-08-11 as migration `dev_refresh_collect_epa_probe_both_targets`,
-- minutes after step 1 and before #664 merged. Step 1 above is left as applied
-- so this file replays the real sequence; running the file top to bottom
-- produces the final state.
--
-- DEFECT IN STEP 1. It read ONE row — `order by probed_at desc limit 1` — which
-- takes whichever target resolved most recently and discards the other.
-- `epa_frs_probe_tick()` fires TWO points on purpose, because FRS fails
-- density-dependently: `sheridan-rural` (44.7973 / -106.9562, r=3) and
-- `atlanta-dense` (33.7490 / -84.3760, r=1). Harmless during a total outage
-- (0 of 382 resolved probes OK), load-bearing at RECOVERY: if the rural point
-- answers first, epa_ok flips true while dense pages are still failing, every
-- dense page past 7 days makes both sides of the OR false, and the zero writes
-- through with the flag FALSE. Silent zeros at scale, at the one moment nobody
-- is watching.
--
-- STALENESS BOUND. Without it epa_ok holds whatever the probe last said,
-- indefinitely — so if job 16 ever stops, the guard OPENS rather than closes.
-- An instrument must prove it RAN before its silence counts as evidence.
-- ============================================================================

do $do$
declare src text; nd text; anchor text; repl text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dev_refresh_collect';
  if src is null then raise exception 'dev_refresh_collect not found'; end if;

  anchor := E'  -- EPA FRS health, read once per collect from the probe cron (job 16).\n'
         || E'  -- FAIL-CLOSED: false / NULL / no resolved probe all mean "failing".\n'
         || E'  select coalesce(\n'
         || E'           (select p.ok from public.epa_frs_probes p\n'
         || E'             where p.resolved_at is not null\n'
         || E'             order by p.probed_at desc\n'
         || E'             limit 1),\n'
         || E'           false)\n'
         || E'    into epa_ok;';
  if position(anchor in src) = 0 then
    raise exception 'single-target probe read not found verbatim — refusing to patch blind';
  end if;

  repl := E'  -- EPA FRS health, read once per collect from the probe cron (job 16).\n'
       || E'  -- EVERY target must be healthy, not whichever resolved last. epa_frs_probe_tick()\n'
       || E'  -- fires two points on purpose because FRS fails density-dependently\n'
       || E'  -- (sheridan-rural r=3, atlanta-dense r=1). A last-row read would flip epa_ok true\n'
       || E'  -- the moment the rural point recovered, while dense pages were still failing.\n'
       || E'  -- STALENESS BOUND: a signal older than 60 minutes is NOT evidence of health. Without\n'
       || E'  -- it, epa_ok would hold whatever the probe last said indefinitely, so a stopped job 16\n'
       || E'  -- would OPEN the guard instead of closing it.\n'
       || E'  -- FAIL-CLOSED: no rows, any false, or a stale newest all resolve to false.\n'
       || E'  select coalesce(\n'
       || E'           (select count(*) > 0\n'
       || E'                   and bool_and(t.ok)\n'
       || E'                   and max(t.resolved_at) > now() - interval ''60 minutes''\n'
       || E'              from (select distinct on (target) target, ok, resolved_at\n'
       || E'                      from public.epa_frs_probes\n'
       || E'                     where resolved_at is not null\n'
       || E'                     order by target, probed_at desc) t),\n'
       || E'           false)\n'
       || E'    into epa_ok;';

  nd := replace(src, anchor, repl);
  if nd = src then raise exception 'probe read patch produced no change'; end if;
  execute nd;
end $do$;

-- RESIDUAL, LOGGED NOT BUILT: two probe points are a NATIONAL PROXY. A partial
-- FRS recovery that answers Sheridan and Atlanta while failing elsewhere still
-- gets through. The durable fix is the one docs/accuracy-audit-2026-08.md §V2
-- names and deliberately does not build: have the engine emit an `frs_report`
-- carrying ok:false on retry exhaustion, and refuse on that PER-PAGE evidence
-- instead of on a global proxy.
