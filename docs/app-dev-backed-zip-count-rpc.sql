-- app_dev_backed_zip_count() — EXACT dev-backed ZIP coverage for the nightly source monitor.
--
-- APPLIED to production 2026-08-26 as migration `app_dev_backed_zip_count_rpc`. This file is the
-- parked DDL of record (CLAUDE.md §1 row 3); the text below was read back with
-- pg_get_functiondef() after apply, not transcribed from the migration I wrote.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHY IT EXISTS
--
-- scripts/source-monitor.mjs measured this metric client-side, paging public.app_projects over
-- PostgREST:
--
--     for (let page = 0; page < 100; page++) {
--       fetch(`…/app_projects?select=zip&record_kind=eq.development&limit=1000&offset=${page*1000}`)
--       …
--       if (rows.length < 1000) break;
--     }
--
-- Two faults compounding:
--   1. A HARD CAP AT 100,000 ROWS against a 3,092,322-row table. The early exit could never fire,
--      so the walk truncated at ~3% on EVERY run and reported the partial result as the whole.
--   2. NO `order=`. PostgREST therefore returned an unstable slice, so the distinct-ZIP count
--      depended on which arbitrary 100k rows that night happened to produce.
--
-- Measured effect on the nightly report: 472 / 478 / 477 / 3154 / 480 / 3501 / 3444 / 478 across
-- consecutive nights with no production change. The true value is 10,039. Under-reported by ~21x
-- — and, the part that actually mattered, a REAL collapse in dev-backed pages would have looked
-- exactly like that nightly noise. The alarm was unbelievable in both directions.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- WHY IT IS AN RPC AND NOT A QUERY
--
-- A plain `select count(distinct zip) from public.app_projects` exceeds the 60s statement timeout
-- at this table size. The recursive CTE below is a LOOSE INDEX SCAN (skip-scan): it walks the
-- (zip, record_kind, …) index one distinct key at a time — roughly 12k index seeks instead of 3M
-- row reads.
--
-- ⚠️ pg_stats.n_distinct is NOT a substitute. It is an ESTIMATOR: it read 4,552 here against a
-- true 12,116 — a 2.7x undercount that looks like a measurement.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- POSITIVE CONTROL (run 2026-08-27, and the reason this is trusted at all)
--
-- A skip-scan that silently loses keys returns a plausible number. So the same slice was counted
-- BOTH ways — bounded to 84xxx so a plain count(distinct) could finish:
--
--     skipscan_distinct  292  |  plain_distinct  292
--     skipscan_devbacked 282  |  plain_devbacked 282
--
-- Exact agreement on both. Full-table result, same day: distinct_zips 12,116 · dev_backed_zips
-- 10,039 — unchanged from the 2026-08-26 reading, which is itself the stability the old walk
-- never had.
--
-- Re-run the control after any change to app_projects' indexes or to the CTE.
--
-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- CONSUMER CONTRACT
--
-- scripts/source-monitor.mjs reads `dev_backed_zips` by name and FAILS CLOSED — a non-200, a
-- malformed body, or a non-integer all yield null, and the report prints 'unavailable'. It never
-- degrades to 0: a zero here would read as "every page went dark". Pinned by
-- test/source-monitor-dev-backed.test.mjs, which is proven to fail on six mutations including a
-- revert to the paging walk.
--
-- The monitor also renamed its emitted label to "Dev-backed ZIP pages (exact)" and matches ONLY
-- that label when computing a night-over-night delta. Every historical "Dev-backed ZIPs snapshot"
-- value came from the truncated walk; comparing across the fix would print a ~+9,500 overnight
-- delta that is purely the instrument being repaired.

create or replace function public.app_dev_backed_zip_count()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with recursive z as (
    select (select min(zip) from public.app_projects) as zip
    union all
    select (select min(p.zip) from public.app_projects p where p.zip > z.zip)
    from z where z.zip is not null
  )
  select jsonb_build_object(
    'distinct_zips',   count(*) filter (where zip is not null),
    'dev_backed_zips', count(*) filter (where zip is not null and exists (
                         select 1 from public.app_projects p
                          where p.zip = z.zip and p.record_kind = 'development')),
    'measured_at',     now()
  )
  from z;
$function$;

revoke all on function public.app_dev_backed_zip_count() from public;
grant execute on function public.app_dev_backed_zip_count() to anon, authenticated, service_role;

-- Grants verified live after apply (information_schema.role_routine_grants):
--   anon, authenticated, postgres, service_role
-- The monitor calls it with the ANON key, so `anon` is load-bearing. It is read-only (stable, no
-- writes) and returns three aggregate numbers — no row-level data crosses the boundary, which is
-- what makes SECURITY DEFINER acceptable here.
