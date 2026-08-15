-- bethelak-wrong-body-cache-purge.sql — ONE-TIME, provenance-scoped cache surgery.
--
-- WHAT THIS FINISHES. Ingest PR #335 (2026-08-15, founder ruling) deactivated the
-- wrong-body CivicClerk reader gov-bethel-ak-commission: the vendor subdomain `bethelak`
-- is the CITY of Bethel, not the Bethel Census Area, so 15 municipal agenda events fanned
-- across every census-area ZIP page. #335 purged the `alerts` rows, but 26 cached
-- `development_reports` rows still carry the 15 events as civic area sites (measured
-- 2026-08-15; list in the QUEUE entry of the same date).
--
-- WHY A RE-CACHE CANNOT CLEAR THEM. Most of the 26 ZIPs have 0 EPA facilities, so the
-- post-purge engine response is ALL-EMPTY — and dev_refresh_collect's transient-safe
-- guard correctly refuses to overwrite a content row with an all-empty response (that
-- guard protects good pages from flaky FRS nights). The guard is NOT weakened here; this
-- file is the explicit, provenance-scoped operation that the guard's design requires for
-- a deliberate removal.
--
-- SCOPE PROOF (all measured 2026-08-15 before writing this file):
--   • 26 rows carry >=1 site with url LIKE 'https://bethelak.portal.civicclerk.com%'
--   • on those rows, EVERY relevance='civic' site is bethelak (non-bethelak civic = 0),
--     so counts.civic on each row is exactly the bethelak count (15)
--   • counts.comment_open is '0' on all 26 (nothing else to recompute)
--   • app_changes / app_projects hold 0 rows with bethelak provenance (nothing app-side)
-- The removal is computed per-row inside the database (never a transcribed list), the
-- surviving array is order-preserving (WITH ORDINALITY), and untouched rows are untouched.

begin;

with affected as (
  select r.zip,
    (select coalesce(jsonb_agg(s order by ord), '[]'::jsonb)
       from jsonb_array_elements(r.sites) with ordinality t(s, ord)
      where s->>'url' is null
         or s->>'url' not like 'https://bethelak.portal.civicclerk.com%') as new_sites,
    (select count(*) from jsonb_array_elements(r.sites) s
      where s->>'url' like 'https://bethelak.portal.civicclerk.com%'
        and s->>'relevance' = 'civic') as removed_civic
  from public.development_reports r
  where exists (select 1 from jsonb_array_elements(r.sites) s
                 where s->>'url' like 'https://bethelak.portal.civicclerk.com%')
)
update public.development_reports r
   set sites  = a.new_sites,
       counts = jsonb_set(r.counts, '{civic}',
                to_jsonb(greatest((r.counts->>'civic')::int - a.removed_civic, 0)))
  from affected a
 where r.zip = a.zip;

-- Expect: UPDATE 26 (the measured affected-row count; a different number = STOP and look).

commit;

-- ── VERIFICATION (run immediately after; each is a positive control) ──────────────────
-- 1. Zero bethelak provenance anywhere in the cache:
--      select count(*) from public.development_reports r
--       where exists (select 1 from jsonb_array_elements(r.sites) s
--                      where s->>'url' like 'https://bethelak.portal.civicclerk.com%');
--    -- = 0
-- 2. Positive control that the query shape still sees sites at all (a wrong LIKE would
--    also return 0 above): the same EXISTS over 'granicus' must be > 0 (Taos et al.):
--      select count(*) from public.development_reports r
--       where exists (select 1 from jsonb_array_elements(r.sites) s
--                      where s->>'url' like '%granicus%');
-- 3. Counts stayed consistent on the touched rows (civic == remaining civic sites):
--      select count(*) from public.development_reports r
--       where r.zip in ('99551','99552','99557','99559','99561','99575','99578','99589',
--                       '99607','99609','99614','99621','99622','99626','99630','99634',
--                       '99637','99641','99651','99655','99656','99668','99679','99680',
--                       '99681','99690')
--         and (r.counts->>'civic')::int <> (select count(*) from jsonb_array_elements(r.sites) s
--                                            where s->>'relevance'='civic');
--    -- = 0
-- 4. Live page check: dispatch spot-check.yml with zips=99551 — tracker column must read
--    'empty (honest, map/coverage note)', dev-app column 'empty (honest coverage block)'.
