-- hillsborough-nh-wrong-body-cache-purge.sql — ONE-TIME, provenance-scoped cache surgery.
-- Companion to docs/bethelak-wrong-body-cache-purge.sql; same shape, one critical difference
-- recorded below.
--
-- WHAT THIS FINISHES. gov-hillsborough-nh-commission read
-- https://hillsboroughcounty.legistar.com/Calendar.aspx — the Legistar tenant of Hillsborough
-- County *FLORIDA* — onto the New Hampshire county root bac33320-b4e9-42de-ae72-54d2b06226ba.
-- The reader is active=false (ingest PR #482) and its `alerts` rows are archived+deleted
-- (public.wrong_body_alerts_archive, 2026-08-31 20:49:29Z n=26 and 2026-09-09 15:19:32Z n=26,
-- fingerprint 528e2ba1f70a1063b81ceccd6fe13c93). NH now holds 0 government_notice alerts.
--
-- But 34 cached development_reports rows still carry that tenant's events, because
-- get-address-report's devSites() reads public.alerts for the ZIP's resolved communities and
-- those rows were cached BEFORE the delete (newest NH refreshed_at 2026-09-09 02:56:00Z, the
-- delete 15:19:32Z). app_refresh_zip then copies them into app_changes as 'Government & civic'
-- and 'Planning & zoning' — NOT category='Government notices' — so no Government-Notices
-- measurement, and not the GN coverage artifact, can see them. Measured: 238 rendered rows on
-- the 34 NH ZIP pages; /community/03101/ and /community/03060/ served BOCC, Land Use Hearing
-- Officer and Zoning Hearing Master.
--
-- THE WRITER IS ALREADY CLOSED — PROVEN, NOT ASSUMED. resolveCommunityIds() resolves a ZIP with
-- communities.zip_codes @> [zip] (no state/name matching), and devSites() filters
-- .in("community_id", communityIds). With NH GN alerts at 0 the engine emits nothing from that
-- tenant. Fired live 2026-09-09 against the deployed function for both dirty ZIPs:
--   03060 -> HTTP 200, 15 sites, 0 on hillsboroughcounty.legistar.com, counts.civic 0
--   03101 -> HTTP 200, 17 sites, 0 on hillsboroughcounty.legistar.com, counts.civic 0
-- So this is RESIDUE, not a live refill; no writer fix is required and none is made here.
--
-- ⚠️ WHY A RE-CACHE IS THE WRONG TOOL, AND IT IS NOT THE BETHELAK REASON. Both live responses
-- above returned counts.facilities = 0 while the stored rows hold 23 (03101) and 40 (03060).
-- Overwriting with a live response would have deleted real EPA facility coverage from these
-- pages. dev_refresh_collect's transient-safe / EPA-refusal guards exist precisely to stop that
-- and are NOT weakened here. This file removes the wrong-body provenance and leaves every other
-- site, and the facility layer, untouched.
--
-- ⚠️ THE HOST IS LEGITIMATE ELSEWHERE — this is the difference from bethelak, where the
-- subdomain was globally wrong. hillsboroughcounty.legistar.com is the CORRECT source for
-- Hillsborough County FLORIDA and must keep serving its own ZIPs (33602 carries 26 such sites;
-- 1,508 across all FL Hillsborough ZIPs). The delete is therefore scoped by ZIP to the NH
-- county's children, joined from public.communities inside the statement — never a transcribed
-- ZIP list (CLAUDE.md rule 7) — and it must never touch a Florida row.
--
-- SCOPE PROOF (measured 2026-09-09 before writing this file):
--   • NH ZIP children of bac33320-… = 34; development_reports rows for them = 34
--   • sites on those rows = 1,725; on hillsboroughcounty.legistar.com = 884
--       (relevance 'civic' 34 — exactly one per ZIP — and 'development' 850)
--   • surviving non-tenant sites = 841
--   • FL control: 33602 = 26 tenant sites, all FL Hillsborough ZIPs = 1,508
--   • national control: 259 distinct civic hosts in the cache
-- Both counts.civic AND counts.development are decremented: bethelak only needed civic because
-- every civic site on those rows was the wrong body; here 850 of the removed 884 are
-- relevance='development', and leaving counts.development overstated by 25 per ZIP would swap
-- one inaccuracy for another.
--
-- The host is PARSED from record_url/url, never matched with LIKE on the string
-- 'Hillsborough' and never on src (src = 'Hillsborough County' is correct in Florida).
-- A site carrying neither record_url nor url parses to '' and is KEPT — removal on absence
-- would be a false exclusion.

begin;

with nh_zips as (
  select distinct unnest(cm.zip_codes) as zip
  from public.communities cm
  where cm.level = 'zip'
    and cm.parent_id = 'bac33320-b4e9-42de-ae72-54d2b06226ba'::uuid
),
affected as (
  select r.zip,
    (select coalesce(jsonb_agg(s order by ord), '[]'::jsonb)
       from jsonb_array_elements(r.sites) with ordinality t(s, ord)
      where split_part(split_part(coalesce(s->>'record_url', s->>'url'), '//', 2), '/', 1)
            <> 'hillsboroughcounty.legistar.com') as new_sites,
    (select count(*) from jsonb_array_elements(r.sites) s
      where split_part(split_part(coalesce(s->>'record_url', s->>'url'), '//', 2), '/', 1)
            = 'hillsboroughcounty.legistar.com'
        and s->>'relevance' = 'civic') as removed_civic,
    (select count(*) from jsonb_array_elements(r.sites) s
      where split_part(split_part(coalesce(s->>'record_url', s->>'url'), '//', 2), '/', 1)
            = 'hillsboroughcounty.legistar.com'
        and s->>'relevance' = 'development') as removed_development
  from public.development_reports r
  where r.zip in (select zip from nh_zips)
    and exists (select 1 from jsonb_array_elements(r.sites) s
                 where split_part(split_part(coalesce(s->>'record_url', s->>'url'), '//', 2), '/', 1)
                       = 'hillsboroughcounty.legistar.com')
)
update public.development_reports r
   set sites  = a.new_sites,
       counts = jsonb_set(
                  jsonb_set(r.counts, '{civic}',
                    to_jsonb(greatest((r.counts->>'civic')::int - a.removed_civic, 0))),
                  '{development}',
                    to_jsonb(greatest((r.counts->>'development')::int - a.removed_development, 0)))
  from affected a
 where r.zip = a.zip;

-- Expect: UPDATE 34 (the measured affected-row count). Any other n: ROLLBACK and look.

commit;

-- ── VERIFICATION (each paired with a positive control) ────────────────────────────────
-- 1. Zero wrong-body provenance on the NH ZIPs:
--      0 rows on the 34 NH ZIPs carrying that host
-- 2. Positive control — the same predicate still finds the tenant in FLORIDA:
--      33602 = 26, all FL Hillsborough ZIPs = 1,508   (a wrong host string would zero these too)
-- 3. Positive control — other civic hosts survive nationally (259 distinct)
-- 4. On the 34 rows, counts.civic = remaining civic sites and counts.development =
--    remaining development sites
-- Then: select public.app_refresh_zip(zip) for each of the 34, and re-fetch
-- /community/03101/ and /community/03060/ (Florida vocabulary must be 0) and
-- /community/33602/ (must stay > 0).
