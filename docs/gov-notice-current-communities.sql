-- public.gov_notice_current_communities
--
-- WHY THIS EXISTS (2026-10-09). scripts/gen-gov-notice-coverage.mjs decides which canonical ZIP
-- pages have a Government Notices source by reading DELIVERED government_notice alerts. It read
-- `alerts` with the public anon key. Anon SELECT on `alerts` was revoked 2026-09-26 (Phase 3 of
-- the anon read-surface lockdown, homesignal-ingest #610), so every read has returned 401 since.
-- Both gen-gov-notice-coverage and verify-gov-notice-coverage have been red ever since, and the
-- daily drift report has been blind.
--
-- WHY NOT `alerts_public`. That view deliberately omits `pipeline_type`, and the Government
-- Notices tile is defined by pipeline_type = 'government_notice'. Measured 2026-10-09: the
-- category "Stratos data center project" occurs under BOTH pipeline_type='news' (108 rows) and
-- 'government_notice' (3 rows), so category cannot stand in for it. Guessing from category would
-- be a second, silently different definition of "government notice".
--
-- WHAT IT IS. One decision, made once, in the database: the set of communities that hold at least
-- one government_notice alert inside the source-currentness window (founder ruling 2026-09-06,
-- symmetric -90/+90 days, UTC dates). The generator keeps the parent_id chain walk; only the
-- source read moves. It exposes community_id and nothing else -- no title, no URL, no agency, no
-- date. The alerts table stays closed to anon.
--
-- The window is the SAME predicate the generator sent as PostgREST filters:
--     published_at >= <UTC today - 90>::date   and   published_at <= <UTC today + 90>::date
-- i.e. both bounds are midnight UTC of a date, so the ceiling excludes later hours of its own day.
-- Reproduced exactly (not widened to the whole day) so the artifact cannot change because the
-- read moved. SOURCE_CURRENT_DAYS = 90 now lives HERE; the generator no longer carries it.
--
-- Additive only: one new view, one grant. No table, no existing object changes.
-- Rollback:  drop view public.gov_notice_current_communities;
--
-- ALSO REQUIRED: add "gov_notice_current_communities" to homesignal-ingest
-- data/anon_read_allowlist.json, or the daily check-anon-read-surface guard fails (the live anon
-- surface must EQUAL the allow-list).

create or replace view public.gov_notice_current_communities
with (security_invoker = false) as
select distinct a.community_id
from public.alerts a
where a.pipeline_type = 'government_notice'
  and a.community_id is not null
  and a.published_at >= ((((now() at time zone 'utc')::date) - 90)::timestamp at time zone 'utc')
  and a.published_at <= ((((now() at time zone 'utc')::date) + 90)::timestamp at time zone 'utc');

comment on view public.gov_notice_current_communities is
  'Communities holding a government_notice alert inside the -90/+90 day source-currentness window (UTC midnight bounds). community_id only. Reader: scripts/gen-gov-notice-coverage.mjs. Owner-rights view: anon has no SELECT on public.alerts.';

-- Supabase default privileges grant arwdDxtm to anon/authenticated on a new object. This view is
-- read-only by construction; make the grants say so.
revoke all on public.gov_notice_current_communities from public, anon, authenticated;
grant select on public.gov_notice_current_communities to anon, authenticated, service_role;
