-- dev_zip_source_ids — per-ZIP PAGE record evidence for the Live scoreboard.
--
-- ⚠️ CORRECTED 2026-07-31 (migration `dev_zip_source_ids_reads_pages_not_cache`). The first
-- version read development_reports — the CONNECTOR'S CACHE — so the scoreboard reported cache
-- coverage as PAGE coverage. Delaware was declared Live at 68/68 while all 22 Sussex pages still
-- served pre-materialization data and app_projects held ZERO rows from the new source; the cache
-- held 468. Both numbers were real. Only one is what a resident sees. It now reads app_projects.
-- APPLIED to project qwnnmljucajnexpxdgxr as migration `dev_zip_source_ids_readonly_rpc`
-- (2026-07-31). Parked here so the schema stays reproducible (CLAUDE.md §1, source #3).
--
-- WHY: the scoreboard's denominator was the COVERAGE GATE — does a complete registry entry
-- DECLARE this ZIP's county — while workbook row 419's baseline is RECORDS LANDING. They
-- disagree by construction, because declaring a county does not put a permit within three miles
-- of a ZIP centroid. Measured 2026-07-30: UT reads Live on the gate and 35.2% on records.
-- Rows 258/259 warn the gate overstates; row 429 makes fixing it the highest-value queue item.
--
-- WHY AN RPC AND NOT A CLIENT-SIDE READ: development_reports.sites is multi-MB per row
-- (Cleveland 44127 = 5.98 MB / 5,511 sites). Aggregating server-side returns only the ids.
--
-- EPA-FRS IS EXCLUDED BY CONSTRUCTION: facility sites carry a null source_registry_id, so the
-- national floor can never make a state Live. That is row 272's requirement, met structurally
-- rather than by a name filter that could drift.
--
-- SECURITY INVOKER on purpose: development_reports already grants public select under RLS, so
-- the anon key runs this with no privilege escalation. STABLE, read-only, no writes.
--
-- PAGINATION IS LOAD-BEARING, NOT BOILERPLATE: a single un-paginated call returns the first
-- p_limit ZIPs by sort order only. At p_limit=5000 that stopped before NV's 89xxx range, every
-- NV page read as dark, and the resulting 0/158 looked exactly like a real finding. Callers
-- MUST loop on p_after until a short page comes back.

create or replace function public.dev_zip_source_ids(p_after text default '', p_limit int default 1000)
returns table (zip text, source_ids text[])
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select d.zip,
         coalesce(
           (select array_agg(distinct x) filter (where x is not null)
              from jsonb_array_elements_text(
                     jsonb_path_query_array(d.sites, '$[*].source_registry_id')) x),
           '{}'::text[])
  from public.development_reports d
  where d.zip > coalesce(p_after, '')
  order by d.zip
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.dev_zip_source_ids(text, int) from public;
grant execute on function public.dev_zip_source_ids(text, int) to anon, authenticated;

comment on function public.dev_zip_source_ids(text, int) is
  'Read-only, keyset-paginated (order by zip, p_after exclusive). Returns each cached ZIP report''s distinct non-null source_registry_id values. Feeds the Live scoreboard''s RECORD-based denominator (workbook rows 419/429). EPA-FRS floor excluded by construction: its sites carry a null source_registry_id.';

-- POSITIVE CONTROL used to accept this (2026-07-31): paginated over all 12,722 cached ZIPs, NV
-- returns 139 of 158 record-backed — reproducing the hand-measured figure behind rows 419/421
-- exactly. The un-paginated version of the same query returned 0, which is why the control
-- exists at all.

-- ─────────────────────────────────────────────────────────────────────────────
-- CORRECTED DEFINITION, 2026-07-31 — this is the version in production.
--
-- TWO TRAPS, both hit while fixing this:
--   1. record_kind, NOT registry_id, separates development from the EPA facilities floor. In
--      app_projects a facility row carries the FRS facility's OWN id in registry_id (e.g.
--      '110054576320'), so `registry_id <> 'epa-frs'` counts the floor as coverage and returns a
--      plausible WRONG NON-ZERO — it reported Sussex 22/22 when the truth was 0/22.
--   2. Emission is not coverage. A connector can emit correctly into the cache and leave every
--      page unchanged until app_refresh_zip() materializes it.
--
-- POSITIVE CONTROL that accepted this version: it reproduces the founder's independently
-- measured row-419 baseline EXACTLY across ten states — TX 666/668 · NV 139/158 · NC 83/170 ·
-- TN 88/199 · VA 73/184 · WA 136/362 · MD 119/317 · AZ 134/364 · UT 109/310 — with DE at 68/68
-- after materialization. The cache-based version did not.

create or replace function public.dev_zip_source_ids(p_after text default '', p_limit int default 1000)
returns table (zip text, source_ids text[])
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select p.zip,
         coalesce(array_agg(distinct p.registry_id)
                    filter (where p.registry_id is not null), '{}'::text[])
  from public.app_projects p
  where p.record_kind = 'development'
    and p.zip > coalesce(p_after, '')
  group by p.zip
  order by p.zip
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.dev_zip_source_ids(text, int) from public;
grant execute on function public.dev_zip_source_ids(text, int) to anon, authenticated;

-- PAGINATION FOOTGUN, found by this change: `coalesce(p_after,'')` turns a NULL cursor back into
-- "start from the beginning". An ad-hoc union-all that feeds max(zip) of an EMPTY window into the
-- next call therefore RE-READS EVERYTHING and double-counts — DE read 136 of 68. The shipped
-- runner is safe because it breaks on a short page, but any hand-written pagination must too.


-- ─────────────────────────────────────────────────────────────────────────────
-- v3, 2026-08-19 — migration `dev_zip_source_ids_reads_summary_table`. THIS IS PRODUCTION.
--
-- v1 read development_reports (the connector CACHE) and reported cache coverage as page
-- coverage. v2 (above) corrected the SOURCE to app_projects but kept aggregating 3,079,005 rows
-- / 4,209 MB on every call. That is what exceeded anon's `statement_timeout=3s`, and because a
-- reporting step was ordered ahead of the drift gates it took the whole source-monitor job down
-- with it from 2026-08-16 to 2026-08-19. #823 fixed the ordering; this fixes the cost.
--
-- The aggregate is over rows only app_refresh_zip() writes, so it is now computed once per WRITE
-- into public.app_zip_source_ids and merely READ here. Full rationale, the programmatic function
-- patch, the backfill and the per-chunk md5 parity receipts: docs/app-zip-source-ids.sql.
--
-- ⚠️ `dev_rows > 0` IS LOAD-BEARING, not a tidy-up. v2's GROUP BY emitted a row only for a ZIP
-- that HAS development rows. The summary carries a row for every ZIP app_refresh_zip has
-- visited, including ones at zero — deliberately, so a ZIP that loses its last record is
-- positively written to 0 instead of left stale. Without this filter the RPC would emit ZIPs v2
-- never did, and the scoreboard's denominator would silently change meaning.
--
-- Signature, keyset pagination, ordering and the 5000 clamp are all UNCHANGED, so every caller
-- keeps working untouched. Pagination stays load-bearing for the reason recorded above.
--
-- MEASURED as anon after the swap: p_limit 250 -> 1.6 ms · 1000 -> 0.8 ms · 5000 -> 3.1 ms
-- (v2's 5000-row page measured 14,350 ms). Flat rather than linear in page size.

create or replace function public.dev_zip_source_ids(p_after text default '', p_limit int default 1000)
returns table (zip text, source_ids text[])
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.zip, s.source_ids
  from public.app_zip_source_ids s
  where s.dev_rows > 0
    and s.zip > coalesce(p_after, '')
  order by s.zip
  limit least(greatest(coalesce(p_limit, 1000), 1), 5000);
$$;

revoke all on function public.dev_zip_source_ids(text, int) from public;
grant execute on function public.dev_zip_source_ids(text, int) to anon, authenticated;

-- ⚠️ CALLER HAZARD INTRODUCED BY THE CLAMP, pinned in test/live-scoreboard.test.mjs: a caller
-- whose page size is >= 5000 gets a FULL page back SHORT, breaks its loop after one page, and
-- ranks on a fraction of the ZIPs with no error at all. Request strictly below the clamp.
