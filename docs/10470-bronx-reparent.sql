-- ============================================================================
-- 10470 (WOODLAWN HEIGHTS) RE-PARENTED FROM WESTCHESTER TO BRONX
-- Applied to production 2026-08-02 via MCP migration `reparent_10470_woodlawn_to_bronx`.
-- This file is the reproducible SQL of record (repo convention: docs/*.sql).
--
-- THE DEFECT. 10470 is a BRONX ZIP that was modelled under Westchester County. The row
-- already CALLED itself Bronx — name "Bronx (10470)", slug "bronx-10470" — and only
-- `county` and `parent_id` said Westchester; 10470 also sat in the Westchester
-- county-level `zip_codes` array. It entered the model that way because the NYC borough
-- expansion deliberately skipped it as "already live under Westchester via the Census
-- crosswalk" (CLAUDE.md §7, NEW YORK build) — i.e. the exclusion was correct about the
-- row EXISTING and wrong about which county it belonged to.
--
-- AUTHORITY. The repo's pinned ZIP<->county source, `zipcodes` PyPI v3.0.0 (CLAUDE.md
-- §12.0, "never guess a ZIP<->county mapping"):
--     10470 -> city 'Bronx', county 'Bronx County', NY, zip_code_type STANDARD
-- Control from the SAME read, so this is one row and not a wholesale disagreement with
-- the package:
--     10803 -> city 'Pelham', county 'Westchester County', NY   (correctly Westchester)
--     10466 / 10463 -> 'Bronx County'                            (the neighbouring ZIPs)
--
-- WHY IT MATTERED BEYOND TIDINESS. The engine's coverage gate is COUNTY-granular, so the
-- NYC DOB entries (declared over the five boroughs) could not reach this page. Licensing
-- Westchester instead would have lit 10803 Pelham Manor, where NYC DOB has no
-- jurisdiction and the rows are artifacts — so the ZIP was left dark rather than
-- fabricating. Re-parenting is the fix that needs NO registry change at all.
--
-- MEASURED BEFORE APPLYING (the per-ZIP model's own risks, each checked, not assumed):
--   * subscribers on either chain root: 0 and 0 -> no subscriber is switched between
--     communities, which is the one hazard re-parenting can create;
--   * government_topics: Bronx County and Westchester County carry the IDENTICAL 6
--     canonical topics -> the subscribable set on the page does not change;
--   * cascaded civic content DOES change, and that is the point: the 29 Westchester
--     County meetings have no jurisdiction over a Bronx address and stop rendering here;
--     the 9 Bronx County alerts now do.
--
-- VERIFIED AFTER (live):
--   resolution  — '10470' appears in exactly ONE community (slug bronx-10470, level zip,
--                 county Bronx, parent bronx-county-ny); Westchester's array 75 -> 74;
--                 0 duplicate slugs anywhere.
--   engine      — re-cached through the live get-address-report (pg_net, HTTP 200):
--                 development 102 · facilities 20 · sites 122, sourced to BOTH
--                 nyc-dob-permit-issuance and nyc-dobnow-approved-permits.
--                 (The queue predicted 79 from nyc-dobnow alone; nyc-dob-permit-issuance
--                 had never placed a record until its text-date defect was fixed earlier
--                 the same day, so it now contributes too.)
--   materialize — app_refresh_zip('10470') -> "development=102/102 facilities=20/20
--                 notices=0 news=1 quality=pass"; app_projects 0 missing coordinates,
--                 0 missing source_ref; coverage_state 'populated'; indexable true.
--
-- ROLLBACK: set county='Westchester' and parent_id=(westchester-county-ny) on
--   bronx-10470, and append '10470' back to westchester-county-ny.zip_codes.
-- ============================================================================

update public.communities
   set county    = 'Bronx',
       parent_id = (select id from public.communities where slug = 'bronx-county-ny')
 where slug = 'bronx-10470';

-- Drop it from the Westchester county-level array, or the county keeps a same-level claim
-- on a ZIP it does not contain.
update public.communities
   set zip_codes = array_remove(zip_codes, '10470')
 where slug = 'westchester-county-ny';

-- ---------- Reproducible verification ---------------------------------------
-- select c.slug, c.name, c.level, c.county, p.slug parent_slug
--   from public.communities c left join public.communities p on p.id = c.parent_id
--  where '10470' = any(c.zip_codes);                        -- exactly one row, Bronx
-- select array_length(zip_codes,1) from public.communities
--  where slug = 'westchester-county-ny';                    -- 74 (was 75)
-- select count(*) from (select slug from public.communities
--   group by slug having count(*) > 1) x;                   -- 0
--
-- Then re-cache and re-materialize the page (the coverage gate is evaluated per report):
-- select net.http_post(
--   'https://qwnnmljucajnexpxdgxr.supabase.co/functions/v1/get-address-report',
--   jsonb_build_object('zip', r.zip, 'lat', r.home_lat, 'lng', r.home_lng),
--   '{}'::jsonb, '{"Content-Type":"application/json"}'::jsonb, 90000)
--   from public.development_reports r where r.zip = '10470';
-- -- wait ~60s, then the scoped form of dev_refresh_collect() over that request id, then:
-- select public.app_refresh_zip('10470');
