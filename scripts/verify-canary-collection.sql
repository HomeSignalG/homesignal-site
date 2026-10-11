-- scripts/verify-canary-collection.sql — READ-ONLY. Was THIS canary's recorded request collected and persisted?
-- Run through db-sql.yml (or the SQL editor) after a canary refresh of ONE ZIP. Parameters are the three lines marked <<.
--
-- WHY IT EXISTS. HTTP 200 from get-address-report, a green workflow, or unrelated successful dev_refresh_tick runs prove
-- NOTHING about this ZIP: dev_refresh_collect rolls the WHOLE tick back when its statement times out, and it evaluates
-- only the NEWEST response per ZIP inside a 20-minute window. So if the canary's response is lost or never evaluated, a
-- LATER rolling refresh of the same ZIP produces a newer response, a higher cursor and an advanced refreshed_at — every
-- "something happened to this ZIP" signal goes green while the canary itself was never collected. The previous version of
-- this script selected the response by ZIP + time and tested cursor >= id, so it PASSED in exactly that case.
--
-- THE FIX: bind everything to the ONE request id recorded when the canary was fired (the id returned by net.http_post).
-- A canary PASSES only if EVERY check is true. NULL is false: a missing row is a FAIL, never "unknown".
--   c1  net._http_response holds a row with exactly this id, HTTP 200, no error, created after the fire, naming this ZIP.
--   c2  the ZIP's cursor EQUALS this id (a higher cursor means a later response was evaluated: this one was superseded
--       or lost, which is a FAIL here — rerun the canary, do not infer).
--   c3  the cache was written after this response arrived and after the fire (refreshed_at >= response.created). With
--       c2 this proves the collector APPLIED this response (an evaluated-but-refused response sets the cursor but does
--       not advance refreshed_at).
--   c4  no blocked-update failure row for this ZIP since the fire.
--   c5  (reported, not part of the verdict) rows materialised at the cache clock; only meaningful after app_refresh_zip.
with p as (
  select '76258'::text as zip,                                  -- << the canary ZIP
         0::bigint as request_id,                               -- << the id RECORDED when the canary was fired
         '2026-10-11 00:00:00+00'::timestamptz as fired_after   -- << the instant the canary fire was issued
), r as (
  select h.id, h.created, h.status_code, h.error_msg, h.content
    from net._http_response h, p
   where h.id = p.request_id
), d as (
  select dr.last_collected_response_id as cursor_id, dr.refreshed_at, jsonb_array_length(dr.sites) as cached_sites
    from public.development_reports dr, p where dr.zip = p.zip
), chk as (
  select
    coalesce((select r.status_code = 200 and r.error_msg is null and r.created >= p.fired_after
                     and substring(r.content from '"zip":"(\d{5})"') = p.zip from r, p), false)          as c1,
    coalesce((select d.cursor_id = p.request_id from d, p), false)                                       as c2,
    coalesce((select d.refreshed_at >= r.created and d.refreshed_at > p.fired_after
                from d, r, p), false)                                                                    as c3,
    coalesce((select count(*) = 0 from public.dev_refresh_source_failures f, p
               where f.zip = p.zip and f.seen_at >= p.fired_after and f.blocked_update), false)          as c4
)
select
  chk.c1 as c1_this_requests_response_exists_ok,
  chk.c2 as c2_cursor_equals_this_request,
  chk.c3 as c3_cache_written_from_this_response,
  chk.c4 as c4_no_blocked_update_since_fire,
  (select count(*) from public.app_projects a, d, p
    where a.zip = p.zip and a.record_kind = 'development'
      and (a.provenance->>'refreshed_at')::timestamptz = d.refreshed_at)                                  as c5_rows_at_cache_clock_report_only,
  (chk.c1 and chk.c2 and chk.c3 and chk.c4)                                                               as canary_collected
from chk;
