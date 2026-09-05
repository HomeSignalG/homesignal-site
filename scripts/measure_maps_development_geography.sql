-- National Development-geography state across all 12,722 canonical ZIP pages.
--
-- THE POINT OF THIS FILE: batches 01-03 each re-derived this shape from a chat
-- transcript. The counts got re-run but the QUERY SHAPE got remembered, and a remembered
-- join is a naked assertion. This is the committed shape; run it, quote it, never recall
-- it. (Same lesson as scripts/measure_gov_notices.sql in the ingest repo.)
--
-- Every canonical ZIP lands in EXACTLY ONE bucket and the buckets sum to 12,722. That
-- sum is the control: if it does not equal the registry count, the classification is
-- wrong, however plausible the individual numbers look.
--
-- The buckets, and why they are not interchangeable:
--   A  cut over, carrying authoritative projects
--   B  cut over, MEASURED zero - the spatial test ran and matched nothing. A real answer.
--   C  measured (boundary_complete) but not yet cut over - work in flight
--   D  NOT measured - no ZCTA exists in TIGER 2025, so nothing was ever tested. This is
--      NOT the same as B and must never be folded into it: B is an answer, D is the
--      absence of one. (Andover IRS 05501/05544, Manhattan/Flint/Lansing PO ZIPs, etc.)
--   E  no shard in the 544-shard universe, because the frozen snapshot carries zero
--      development projects for the prefix. Provably zero development, no acquisition
--      needed. Verify with the two controls recorded in N5-NATIONAL-BATCH-03-EVIDENCE.md
--      before quoting it.
--   F  still awaiting acquisition
with canon as (select zip from public.canonical_zip_registry),
 cls as (
   select c.zip,
     case
       when cut.production_geography_verified_at is not null and cut.membership_rows > 0
            then 'A_authoritative_with_projects'
       when cut.production_geography_verified_at is not null
            then 'B_authoritative_measured_zero'
       when s.status = 'boundary_complete' then 'C_measured_not_yet_cut_over'
       when s.status = 'not_measured'      then 'D_not_measured_no_zcta'
       when left(c.zip,3) not in (select z3::text from geo.n5_shard)
            then 'E_no_shard_zero_dev_in_freeze'
       else 'F_pending_acquisition'
     end bucket
   from canon c
   left join public.app_zip_geography_cutover cut on cut.zip = c.zip
   left join geo.maps_zip_geography_status s on s.zip = c.zip)
select bucket, count(*) zips, round(100.0*count(*)/12722, 2) pct
from cls group by 1
union all select 'TOTAL (control: must be 12722)', count(*), round(100.0*count(*)/12722,2) from cls
order by 1;

-- Reading, 2026-09-03 after cutover group 3 (744 verified ZIPs):
--   A 443 (3.48%) · B 301 (2.37%) · C 0 · D 76 (0.60%) · E 445 (3.50%) · F 11,457 (90.06%)
--   TOTAL 12,722. C = 0 means cutover has kept pace with measurement.
