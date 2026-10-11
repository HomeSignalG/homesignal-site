-- scripts/verify-canary-collection.sql — READ-ONLY. Did THIS canary's request get collected?
-- Run through db-sql.yml (or the SQL editor) after a canary refresh of ONE ZIP. Parameters are the two lines marked <<.
--
-- WHY IT EXISTS. HTTP 200 from get-address-report, a green workflow, or unrelated successful dev_refresh_tick runs prove
-- NOTHING about this ZIP: dev_refresh_collect rolls the WHOLE tick back when its statement times out, and the cursor
-- (development_reports.last_collected_response_id) only moves for a response that was actually applied. Measured
-- 2026-10-11: ~25% of job-14 ticks fail at 120 s, in runs of 7-9 consecutive failures lasting ~the 20-minute response window.
--
-- A canary PASSES only if EVERY check below is true. Any NULL/false is a FAIL, not "unknown".
with p as (
  select '76258'::text as zip,                                  -- << the canary ZIP
         '2026-10-11 00:00:00+00'::timestamptz as fired_after   -- << the instant the canary fire was issued
), r as (
  -- the response(s) to THIS ZIP's fire, newest first. net._http_response is kept ~6 h: run this inside that window.
  select h.id, h.created, h.status_code
    from net._http_response h, p
   where h.created >= p.fired_after
     and h.status_code = 200
     and substring(h.content from '"zip":"(\d{5})"') = p.zip
   order by h.id desc limit 1
), d as (
  select dr.zip, dr.last_collected_response_id, dr.refreshed_at, dr.facilities_refreshed_at, dr.epa_last_outcome,
         jsonb_array_length(dr.sites) as cached_sites
    from public.development_reports dr, p where dr.zip = p.zip
)
select
  (select id from r)                                                                    as response_id,
  (select count(*) from r) = 1                                                          as c1_response_exists,
  (select d.last_collected_response_id >= r.id from d, r)                               as c2_cursor_advanced_to_this_response,
  (select d.refreshed_at > p.fired_after from d, p)                                     as c3_refreshed_at_advanced,
  (select count(*) from public.dev_refresh_source_failures f, p
     where f.zip = p.zip and f.seen_at >= p.fired_after and f.blocked_update)           as c4_blocked_update_rows_must_be_0,
  (select count(*) from public.app_projects a, p
     where a.zip = p.zip and a.record_kind = 'development'
       and (a.provenance->>'refreshed_at')::timestamptz >= (select d.refreshed_at from d))  as c5_materialised_rows_at_or_after_refresh;
-- c5 > 0 only after app_refresh_zip has materialised the new cache; the recovered source_keys are then compared
-- against the expected set by key (docs/zip-scope-bounds-runbook.md gate 2), never by count.
