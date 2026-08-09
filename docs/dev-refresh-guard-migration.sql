-- ============================================================================
-- REFRESH-PIPELINE HARDENING — two migrations applied to qwnnmljucajnexpxdgxr
-- on 2026-08-09. Parked here per CLAUDE.md §1 row 3 so the schema stays
-- reproducible. Full working: docs/accuracy-audit-2026-08.md §T, §V, §W.
--
-- 1. dev_refresh_collect_facilities_guard — stop the refresh erasing the EPA
--    facilities layer during an upstream outage.
-- 2. dev_refresh_fire_timeout_180s — stop the pipeline discarding its own
--    successful work by timing out below the engine's runtime.
--
-- Both patch the live function body TEXTUALLY from pg_get_functiondef rather
-- than restating it, with the anchor asserted first, so a ~130-line body cannot
-- drift by transcription. Neither is safe to re-run blind: the anchor
-- assertions deliberately refuse a second application.
-- ============================================================================

-- ── 1. FACILITIES GUARD ─────────────────────────────────────────────────────
-- WHY. EPA FRS returned 502 and frsFacilities() exhausted its retry ladder to
-- []. dev_refresh_collect refused a write only when BOTH dimensions were zero,
-- or when DEVELOPMENT was zero — so every page carrying permit records was
-- written through with its facilities erased: 1,722 of 12,722 cached pages,
-- and 486 of 486 refreshed on 2026-08-09.
--
-- TRIGGER BREADTH — deliberately wider than "on a reported fetch failure":
-- it fires on ANY zero-facility payload for a page that has cached facilities,
-- because the connector SWALLOWS the error. frsFacilities() returns [] on total
-- failure, byte-identical to a genuinely empty rural area, and FRS is not a
-- registry source, so dev_failed_sources() — which reads only the connector
-- reports — never sees it. A failure-conditioned guard would have missed the
-- actual case entirely.
do $do$
declare src text; nd text; anchor text; addition text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'dev_refresh_collect';
  if src is null then raise exception 'dev_refresh_collect not found'; end if;

  anchor := E'    and not (\n'
         || E'      d.refreshed_at >= now() - interval ''7 days''\n'
         || E'      and coalesce((j->''counts''->>''development'')::int, 0) = 0\n'
         || E'      and coalesce((d.counts->>''development'')::int, 0) > 0\n'
         || E'      and not exists (select 1 from explained x where x.zip = d.zip)\n'
         || E'    );';
  if position(anchor in src) = 0 then
    raise exception 'development-dimension clause not found verbatim — refusing to patch blind';
  end if;

  -- Same shape as the development clause, with ONE deliberate difference: no
  -- `explained` escape. `explained` means a RETIRED REGISTRY SOURCE stopped
  -- being reported, which can legitimately explain a development drop. FRS is
  -- not a registry source, so it could never explain a facilities drop —
  -- carrying the clause across would open a hole.
  addition := E'    and not (\n'
           || E'      d.refreshed_at >= now() - interval ''7 days''\n'
           || E'      and coalesce((j->''counts''->>''facilities'')::int, 0) = 0\n'
           || E'      and coalesce((d.counts->>''facilities'')::int, 0) > 0\n'
           || E'    );';

  nd := replace(src, anchor, replace(anchor, ');', ')') || E'\n' || addition);
  if nd = src then raise exception 'no change produced'; end if;
  execute nd;
end $do$;

-- RELEASE VALVE (inherited from the development clause, and load-bearing): a
-- refused write does not update refreshed_at, so the row ages. After 7 days of
-- consistently zero responses the `refreshed_at >= now() - interval '7 days'`
-- test goes false and a GENUINE zero writes through. A transient outage is
-- absorbed; a real delisting still lands, one week late.

-- ── 2. FIRE TIMEOUT: 90 s → 180 s ───────────────────────────────────────────
-- WHY. Both fire functions hard-coded a 90,000 ms pg_net timeout while the edge
-- function's own logs show ZIP reports returning 200 at 100–152.7 s. A run that
-- SUCCEEDS server-side was discarded client-side: 299 of 370 fires in one
-- 40-minute window were client timeouts at exactly 90,000 ms.
--
-- 180,000 ms is set from measurement, not rounded for comfort: longest observed
-- SUCCESS 152,656 ms, and Supabase's own gateway starts returning 504 at
-- ~150–154 s. 180 s sits above both; waiting longer cannot buy a response the
-- platform will never deliver.
do $do$
declare fn text; src text; nd text; n int := 0;
begin
  foreach fn in array array['dev_refresh_fire_targets', 'dev_refresh_fire_batch'] loop
    select pg_get_functiondef(p.oid) into src
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.proname = fn;
    if src is null then raise exception '% not found', fn; end if;
    if position('90000)' in src) = 0 then
      raise exception '%: the 90000 ms timeout literal is not present — refusing to patch blind', fn;
    end if;
    nd := replace(src, '90000)', '180000)');
    if nd = src then raise exception '%: no change produced', fn; end if;
    execute nd;
    n := n + 1;
  end loop;
  if n <> 2 then raise exception 'expected 2 functions patched, got %', n; end if;
end $do$;

-- ── VERIFICATION actually run after applying ────────────────────────────────
--   select position('coalesce((j->''counts''->>''facilities'')::int, 0) = 0'
--            in pg_get_functiondef(p.oid)) > 0  as facilities_clause_present,    -- true
--          position('coalesce((j->''counts''->>''development'')::int, 0) = 0'
--            in pg_get_functiondef(p.oid)) > 0  as development_clause_present    -- true
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.proname='dev_refresh_collect';
--
--   select p.proname,
--          position('180000)' in pg_get_functiondef(p.oid)) > 0 as has_180s,     -- true, both
--          position('90000)'  in pg_get_functiondef(p.oid)) > 0 as still_has_90s -- false, both
--     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname in ('dev_refresh_fire_targets','dev_refresh_fire_batch');
