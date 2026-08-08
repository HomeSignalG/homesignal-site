-- ============================================================================
-- DATE SEMANTICS, PIECE (a) — stamp what a development record's date MEANS.
-- Applied to project qwnnmljucajnexpxdgxr as migration `app_projects_date_kind_stamp`
-- (2026-08-08). Parked here per CLAUDE.md §1 row 3 so the schema stays reproducible.
--
-- WHY. One unlabelled date slot on homesignalmap.html (`.fdate`) was carrying four
-- different meanings at once: FILED (most permit ledgers), ISSUED (bentonville),
-- SCHEDULED/ESTIMATED start (fdot StartDate, lexington EstimatedStartDate) and DECIDED
-- (anne-arundel ×2 + dallas — where the materializer's coalesce(file_date, decision_date)
-- silently substitutes the decision date into the filing slot). A resident reading
-- "Mar 2026" cannot tell which. Full measurement: docs/accuracy-audit-2026-08.md §F3, §G1.
--
-- THIS STEP CHANGES NOTHING A RESIDENT SEES. It only records the meaning:
--   • the engine emits `file_date_kind` on every registry-sourced site, defaulting to
--     "filed" (sources/{arcgis,socrata,ckan,csv,carto}.ts), so no registry entry needs
--     editing to keep today's behaviour;
--   • the materializer stamps it onto app_projects.date_kind, writing 'decided' where it
--     falls through to decision_date — the only way that substitution becomes visible;
--   • NULL when the record carries no date at all: there is nothing to label.
-- Piece (b) classifies the known non-filing entries; piece (c) renders the label.
-- ============================================================================

alter table public.app_projects add column if not exists date_kind text;

-- The function is patched textually from its own live definition rather than restated, so
-- the ~180-line body cannot drift by transcription. Both anchors are asserted before use.
do $do$
declare src text; nd text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'app_refresh_zip';
  if src is null then raise exception 'app_refresh_zip not found'; end if;

  -- Anchor A: the DEVELOPMENT insert's column list. The facility insert shares the prefix
  -- but ends `registry_id, facility_env)`, so the trailing paren makes this unambiguous.
  if position($q$impact_score, source_ref, record_kind, registry_id)$q$ in src) = 0 then
    raise exception 'anchor A (development insert column list) not found';
  end if;
  nd := replace(src,
    $q$impact_score, source_ref, record_kind, registry_id)$q$,
    $q$impact_score, source_ref, record_kind, registry_id, date_kind)$q$);

  -- Anchor B: the same insert's final value expression ('facility' for the other one).
  if position($q$'development', nullif(el->>'source_registry_id','')$q$ in nd) = 0 then
    raise exception 'anchor B (development insert value list) not found';
  end if;
  nd := replace(nd,
    $q$'development', nullif(el->>'source_registry_id','')$q$,
    $q$'development', nullif(el->>'source_registry_id',''),
      case when el->>'file_date' ~ '^\d{4}-\d{2}-\d{2}'
             then coalesce(nullif(el->>'file_date_kind',''), 'filed')
           when el->>'decision_date' ~ '^\d{4}-\d{2}-\d{2}'
             then 'decided' end$q$);

  if nd = src then raise exception 'no change produced'; end if;
  execute nd;
end $do$;

-- ── Backfill of the 12,722 already-materialized pages ───────────────────────────────
-- `date_kind` is only written when a ZIP re-materializes, so existing rows were filled two
-- ways. Both compute exactly what app_refresh_zip would.
--
-- (1) Set-based, for the three entries whose EVERY dated row is substituted. Premise measured
--     over all ten ZIP shards (left(zip,1) = 0-9, so coverage is complete): each entry's
--     substituted count equals its dated count — dallas 30,975, anne-arundel-subdivision
--     5,149, anne-arundel-commercial 2,367 — i.e. they carry no file_date at all. No entry
--     declares file_date_kind yet, so every other dated row is 'filed'. The six entries with
--     PARTIAL substitution (fdot 577, austin-subdivision 19, denton 7, austin-site-plan 6,
--     charlotte 5, columbia-mo-capital 5) are deliberately excluded here — per-row, not
--     per-entry — and were left to (2).
update public.app_projects set date_kind = 'decided'
 where record_kind = 'development' and date_kind is null and submitted_at is not null
   and registry_id in ('dallas-specific-use-permits',
                       'anne-arundel-subdivision-activity',
                       'anne-arundel-commercial-site-plans');

update public.app_projects set date_kind = 'filed'
 where record_kind = 'development' and date_kind is null and submitted_at is not null
   and (registry_id is null or registry_id not in (
        'dallas-specific-use-permits','anne-arundel-subdivision-activity',
        'anne-arundel-commercial-site-plans','fdot-active-construction-projects',
        'austin-subdivision-cases','denton-county-dev-permits','austin-site-plan-cases',
        'charlotte-land-dev-commercial-projects','columbia-mo-capital-projects'));

-- (2) Re-materialize whatever is left (the partial-substitution entries' pages). Idempotent;
--     app_refresh_zip is the same path the nightly refresh runs. Run until `remaining` is 0.
do $do$
declare z text; t0 timestamptz := clock_timestamp();
begin
  for z in select distinct zip from public.app_projects
            where record_kind = 'development' and submitted_at is not null and date_kind is null
            order by zip
  loop
    perform public.app_refresh_zip(z);
    exit when clock_timestamp() - t0 > interval '35 seconds';
  end loop;
end $do$;

-- Verification actually run after the backfill (cross-instrument control): the materializer's
-- 'decided' stamp reproduces the cache-side measurement EXACTLY —
--   date_kind='decided' → 39,110 rows / 390 pages / 9 entries
--   date_kind='filed'   → 2,700,721 rows / 6,344 pages / 162 entries
--   date_kind is null   →    86,723 rows /   774 pages /  32 entries  (undated records)
-- and 0 rows remain with a date but no kind.
--   select date_kind, count(*), count(distinct zip), count(distinct registry_id)
--     from public.app_projects where record_kind='development' group by 1;
