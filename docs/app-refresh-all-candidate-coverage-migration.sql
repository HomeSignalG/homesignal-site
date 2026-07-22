-- ============================================================================
-- Migration: app_refresh_all_candidate_coverage
-- Scope: FIX THE NIGHTLY REFRESH CANDIDATE SELECTION ONLY.
--
-- Root cause (production-verified 2026-07-22):
--   public.app_refresh_all() iterates candidates ONLY from public.development_reports:
--       for r in select zip from public.development_reports loop
--         perform public.app_refresh_zip(r.zip); ...
--   But app_refresh_zip() ALSO materializes government notices, meetings, and Local
--   News (all keyed to the chain-root community) for any ZIP it is called with. A
--   covered ZIP that has an app_community_meta row but NO development_reports row is
--   therefore never in the loop, so app_refresh_zip() never runs for it and its
--   content freezes. Measured: 7,910 covered ZIPs, 7,761 with development_reports,
--   149 covered-without-development_reports — including 40 ZIPs across 5 news-bearing
--   Utah counties (Summit/Grand/San Juan/Uintah/Duchesne) holding 301 Local News
--   records that never materialize.
--
-- The defect is CANDIDATE SELECTION, not the materializer. This migration changes
-- ONLY app_refresh_all()'s candidate query. app_refresh_zip() is untouched:
--   * Local News filters / 14-day window / newest-48 cap: UNCHANGED (inside app_refresh_zip).
--   * indexability + data_quality gates: UNCHANGED (computed inside app_refresh_zip).
--   * No development_reports rows are fabricated; no feeds activated; no data modified.
--
-- New candidate set = union of two legitimate materialization paths (dedup by UNION):
--   (1) every development_reports ZIP  -> preserves existing behavior EXACTLY.
--   (2) covered ZIPs (app_community_meta) with no development_reports row whose
--       chain-root community has an eligible NON-development content path the same
--       loop fills: recent sourced Local News OR recent sourced government notices
--       (both 14-day, source_url required) OR an upcoming sourced meeting.
--   A covered ZIP with none of these paths is NOT added (no wasted refresh).
--
-- Determinism: candidates are de-duplicated (UNION) and iterated `order by zip`.
-- The 14-day / upcoming predicates mirror app_refresh_zip()'s own insert conditions,
-- so a ZIP is a candidate exactly while it has something to materialize; this does
-- NOT change any window or cap inside the materializer.
--
-- Measured impact (read-only, 2026-07-22): candidates 7,761 -> 7,910 (+149).
--   +149 all valid 5-digit ZIPs; 0 coverage_coming; 0 currently indexable
--   (this migration indexes NO ZIP); qualifying paths: 149 gov, 42 news, 73 meetings.
--   Existing candidates removed: 0. Full list: app-refresh-all-candidate-coverage-added-zips.csv.
--
-- Security/permissions: CREATE OR REPLACE preserves owner + GRANTs. app_refresh_all
--   stays LANGUAGE plpgsql, SECURITY INVOKER (matches current: prosecdef=false).
--   The existing pg_cron job `app-content-refresh` (20 9 * * *) is UNCHANGED and keeps
--   calling select public.app_refresh_all();.
--
-- REVERT: re-apply the prior one-source body:
--   create or replace function public.app_refresh_all() returns integer language plpgsql
--   as $revert$ declare n int:=0; r record; begin
--     for r in select zip from public.development_reports loop
--       perform public.app_refresh_zip(r.zip); n:=n+1; end loop; return n; end $revert$;
-- ============================================================================

create or replace function public.app_refresh_all()
 returns integer
 language plpgsql
as $function$
declare n int := 0; r record;
begin
  for r in
    select zip from (
      -- (1) existing behavior: every development_reports ZIP (development + facility path)
      select zip from public.development_reports
      union
      -- (2) covered ZIPs with no development_reports row but an eligible NON-development
      --     content path the same app_refresh_zip loop materializes (news / gov / meetings)
      select m.zip
      from public.app_community_meta m
      join public.communities c on c.id = m.community_id
      where not exists (select 1 from public.development_reports d where d.zip = m.zip)
        and (
          exists (select 1 from public.alerts a
                  where a.community_id = coalesce(c.parent_id, m.community_id)
                    and a.pipeline_type = 'news' and a.category = 'local_news'
                    and a.created_at >= now() - interval '14 days'
                    and coalesce(a.source_url,'') <> '')
          or exists (select 1 from public.alerts a
                  where a.community_id = coalesce(c.parent_id, m.community_id)
                    and a.pipeline_type = 'government_notice'
                    and a.created_at >= now() - interval '14 days'
                    and coalesce(a.source_url,'') <> '')
          or exists (select 1 from public.meetings mt
                  where mt.community_id = coalesce(c.parent_id, m.community_id)
                    and mt.meeting_date >= now()
                    and coalesce(mt.source_url,'') <> '')
        )
    ) cand
    order by zip
  loop
    perform public.app_refresh_zip(r.zip);
    n := n + 1;
  end loop;
  return n;
end $function$;
