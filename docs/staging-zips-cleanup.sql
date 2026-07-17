-- ============================================================================
-- Staging _*_zips cleanup — RLS-advisory follow-up (applied 2026-07-17 via
-- migration `staging_zips_cleanup_rls`). DDL of record.
--
-- The advisory: 15 public tables had RLS disabled (anon key = full read/write).
-- Founder call: split dead-vs-referenced — DROP the dead scratch, secure with
-- RLS *and policies* what's still in use, and leave `spatial_ref_sys` alone
-- (PostGIS system table; it stays flagged on purpose).
--
-- Evidence backing each verdict (verified before executing):
--   * 0 references for ALL 14 candidate tables in pg_proc (function bodies),
--     pg_views, and cron.job — nothing recurring reads them.
--   * Each completed state's _<st>_zips is referenced ONLY by its committed
--     docs/<state>-development-reports-seed.sql, which itself begins
--     `drop table if exists` and recreates the table from literal pinned
--     values — so dropping the live table loses nothing (re-running the seed
--     rebuilds it byte-identically). AZ (364) / MD (315) / PA (560) had rows,
--     but those builds are complete and the rows ARE the seed's literal list.
--   * _dfw_zips's only repo mention is a comment; _den_zips/_den_res_dbg are
--     wholly unreferenced debug scratch.
--   * _fl_zips is an IN-FLIGHT Florida batch worklist — 441 ZIPs, all 441
--     already cached in development_reports, refreshed_at 2026-07-17 00:05 UTC,
--     and it carries live worklist columns (request_id, status) the completed
--     states' tables don't. KEPT and secured, not dropped: the batch writes as
--     service-role/postgres (bypasses RLS), so RLS-on + revoked anon grants is
--     zero-impact on the running build. The owning session should
--     `drop table public._fl_zips;` when Florida go-live completes.
-- ============================================================================

drop table if exists public._dfw_zips;
drop table if exists public._den_res_dbg;
drop table if exists public._den_zips;
drop table if exists public._wa_zips;
drop table if exists public._mn_zips;
drop table if exists public._il_zips;
drop table if exists public._mi_zips;
drop table if exists public._ma_zips;
drop table if exists public._ny_zips;
drop table if exists public._ca_zips;
drop table if exists public._az_zips;
drop table if exists public._md_zips;
drop table if exists public._pa_zips;

alter table public._fl_zips enable row level security;
revoke all on table public._fl_zips from anon, authenticated;
-- Explicit statement of the access model (service_role bypasses RLS; this documents
-- intent and keeps the table policy-bearing rather than silently policy-less):
drop policy if exists "service role only (batch worklist)" on public._fl_zips;
create policy "service role only (batch worklist)" on public._fl_zips
  for all to service_role using (true) with check (true);

-- Post-apply receipt (2026-07-17): rls_disabled_in_public advisory reduced to
-- exactly `spatial_ref_sys` (left as-is on purpose); _fl_zips absent from all
-- lints; _fl_zips rows intact (441) with RLS on + 1 policy.

-- ⏳ _fl_zips DROP-BY NOTE: this table is the Florida batch's worklist and must be
-- dropped BY THE OWNING SESSION when that build completes (like every prior state's).
-- If you find public._fl_zips still present AFTER 2026-07-24: it has been orphaned —
-- verify the FL build is done (its ZIPs cached in development_reports / the FL
-- go-live status note exists in CLAUDE.md) and `drop table public._fl_zips;`.
