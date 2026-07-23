-- ============================================================================
-- MAPS DEDUP — eliminate duplicate development records from the Maps pipeline.
-- Applied to production 2026-07-23 via MCP migrations
--   `dev_sites_exact_identity_dedup` (functions below) and a one-time data
--   cleanup (section 3). This file is the reproducible SQL of record.
--
-- WHERE THE DUPLICATION IS INTRODUCED (DB-verified 2026-07-23):
--   CACHE GENERATION — the get-address-report engine's arcgis + socrata
--   connectors page with resultOffset/$offset but no guaranteed-unique total
--   order (ArcGIS sends no orderByFields unless the entry has an
--   incremental_field; Socrata orders by the incremental date column, whose
--   ties straddle page boundaries), so the same source row can be emitted on
--   several pages of one fetch. 100% of the excess traced to those two
--   connectors: 4,759 duplicate groups / 9,631 excess copies across 273 cached
--   development_reports rows (worst: one Minneapolis permit cached 510×).
--   The nightly refresh (dev_refresh_collect) introduces nothing — it replaces
--   sites wholesale from a single engine response. The materializer
--   (app_refresh_zip) introduced nothing but inherited the cache verbatim.
--
-- THE IDENTITY (chosen from production evidence — collapses ONLY true
-- identical records):
--   title | label | case_number | record_url | url | file_date | decision_date
--   | lat | lng | bucket | scope | relevance | registry_id | source_registry_id
--   | source_id
--   • file_date IS in the key: the same case number re-issued on a new date is
--     a distinct real filing (NYC DOB renewals) — verified in production; those
--     survive.
--   • case_number IS in the key: same-title per-unit permits (e.g. Mesa 85234's
--     "27 Unit Townhome Project" = 27 distinct case numbers at one coordinate)
--     survive.
--   • registry ids are in the key so no two distinct facilities can ever be
--     collapsed (facilities had zero duplicates in production; belt-and-braces).
--   Production proof of safety: dedup by this key removes 9,631 elements;
--   dedup by WHOLE-ELEMENT identity removes 9,618 — the 13-element delta was
--   inspected row by row and differs only in no-information fields
--   (status_raw "Approved" vs "Issued" mapping to the same bucket; placeholder
--   address text). Nothing that differs in any meaningful field is collapsed.
--
-- THE FIX, three layers:
--   1. ENGINE (root, cache generation): get-address-report v22 dedupes the
--      combined permit-connector output at assembly with the same identity
--      (supabase/functions/get-address-report/index.ts, dedupeExactPermits);
--      deployed via deploy-edge-functions.yml. Counts are computed downstream
--      of the dedup so future cached counts are accurate by construction.
--   2. MATERIALIZER (defensive safeguard): app_refresh_zip reads sites through
--      dev_sites_deduped() below, so even a bad cached array can never
--      materialize duplicate markers or duplicate panel records.
--   3. ONE-TIME CLEANUP (section 3): order-preserving dedup of the 273
--      affected cached rows + counts recomputed with the engine's own
--      formulas (formulas verified to reproduce stored counts exactly on
--      unaffected rows), then app_refresh_zip re-run for exactly those ZIPs.
-- ============================================================================

-- ---------- 1. dev_sites_deduped — exact-identity, order-preserving ---------
create or replace function public.dev_sites_deduped(_zip text)
returns table(el jsonb) language sql stable as $$
  select x.el from (
    select e.el, e.ord, row_number() over (
      partition by md5(
        coalesce(e.el->>'title','')||'|'||coalesce(e.el->>'label','')||'|'||
        coalesce(e.el->>'case_number','')||'|'||coalesce(e.el->>'record_url','')||'|'||
        coalesce(e.el->>'url','')||'|'||coalesce(e.el->>'file_date','')||'|'||
        coalesce(e.el->>'decision_date','')||'|'||coalesce(e.el->>'lat','')||'|'||
        coalesce(e.el->>'lng','')||'|'||coalesce(e.el->>'bucket','')||'|'||
        coalesce(e.el->>'scope','')||'|'||coalesce(e.el->>'relevance','')||'|'||
        coalesce(e.el->>'registry_id','')||'|'||coalesce(e.el->>'source_registry_id','')||'|'||
        coalesce(e.el->>'source_id','')
      ) order by e.ord
    ) rn
    from public.development_reports dr,
         lateral jsonb_array_elements(dr.sites) with ordinality e(el, ord)
    where dr.zip = _zip
  ) x where x.rn = 1 order by x.ord
$$;

-- ---------- 2. app_refresh_zip — all six sites reads go through the dedup ---
-- Full body identical to the production `app_refresh_full_zip_universe_and_
-- geometry_fence` version except that every
--   `from public.development_reports dr, jsonb_array_elements(dr.sites) el
--    where dr.zip=_zip and …`
-- becomes
--   `from public.dev_sites_deduped(_zip) as t where …`
-- (six occurrences: the development insert, the _ndp count, the _nfc count,
-- the facility insert, and the two area/civic app_changes inserts). No other
-- logic, cap, order, fence, or count changes. The applied definition is in the
-- Supabase migration history as `dev_sites_exact_identity_dedup`.

-- ---------- 3. One-time cleanup of the affected cached rows -----------------
-- Idempotent: a row with no duplicates is rewritten to itself; counts are
-- recomputed with the engine's own formulas (verified to reproduce the stored
-- counts exactly on current data). Only rows that actually contain a duplicate
-- are touched.
with affected as (
  select dr.zip
  from public.development_reports dr,
       lateral jsonb_array_elements(dr.sites) e(el)
  group by dr.zip
  having count(*) > count(distinct md5(
    coalesce(e.el->>'title','')||'|'||coalesce(e.el->>'label','')||'|'||
    coalesce(e.el->>'case_number','')||'|'||coalesce(e.el->>'record_url','')||'|'||
    coalesce(e.el->>'url','')||'|'||coalesce(e.el->>'file_date','')||'|'||
    coalesce(e.el->>'decision_date','')||'|'||coalesce(e.el->>'lat','')||'|'||
    coalesce(e.el->>'lng','')||'|'||coalesce(e.el->>'bucket','')||'|'||
    coalesce(e.el->>'scope','')||'|'||coalesce(e.el->>'relevance','')||'|'||
    coalesce(e.el->>'registry_id','')||'|'||coalesce(e.el->>'source_registry_id','')||'|'||
    coalesce(e.el->>'source_id','')))
)
update public.development_reports r
set sites = d.sites,
    counts = r.counts
      || jsonb_build_object(
           'facilities', d.fac, 'civic', d.civic,
           'proposed', d.proposed, 'approved', d.approved, 'operating', d.operating,
           'development', d.proposed + d.approved + d.operating)
from (
  select z.zip,
         coalesce(jsonb_agg(x.el order by x.ord) filter (where x.rn = 1), '[]'::jsonb) as sites,
         count(*) filter (where x.rn = 1 and coalesce(x.el->>'relevance','') not in ('development','civic')) as fac,
         count(*) filter (where x.rn = 1 and x.el->>'relevance' = 'civic') as civic,
         count(*) filter (where x.rn = 1 and x.el->>'relevance' = 'development' and x.el->>'type' = 'proposed') as proposed,
         count(*) filter (where x.rn = 1 and x.el->>'relevance' = 'development' and x.el->>'type' = 'approved') as approved,
         count(*) filter (where x.rn = 1 and x.el->>'relevance' = 'development' and x.el->>'type' = 'built') as operating
  from affected z
  cross join lateral (
    select e.el, e.ord, row_number() over (
      partition by md5(
        coalesce(e.el->>'title','')||'|'||coalesce(e.el->>'label','')||'|'||
        coalesce(e.el->>'case_number','')||'|'||coalesce(e.el->>'record_url','')||'|'||
        coalesce(e.el->>'url','')||'|'||coalesce(e.el->>'file_date','')||'|'||
        coalesce(e.el->>'decision_date','')||'|'||coalesce(e.el->>'lat','')||'|'||
        coalesce(e.el->>'lng','')||'|'||coalesce(e.el->>'bucket','')||'|'||
        coalesce(e.el->>'scope','')||'|'||coalesce(e.el->>'relevance','')||'|'||
        coalesce(e.el->>'registry_id','')||'|'||coalesce(e.el->>'source_registry_id','')||'|'||
        coalesce(e.el->>'source_id','')
      ) order by e.ord) rn
    from public.development_reports dr,
         lateral jsonb_array_elements(dr.sites) with ordinality e(el, ord)
    where dr.zip = z.zip
  ) x
  group by z.zip
) d
where r.zip = d.zip;

-- ---------- 4. Re-materialize exactly the affected ZIPs ---------------------
-- (run in batches; app_refresh_zip is idempotent per ZIP)
--   select public.app_refresh_zip(zip) from <the affected list>;
